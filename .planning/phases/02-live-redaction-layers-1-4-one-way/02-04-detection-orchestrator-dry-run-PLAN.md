---
phase: 02-live-redaction-layers-1-4-one-way
plan: "04"
type: execute
wave: 3
depends_on: ["00", "01", "02", "03"]
files_modified:
  - src/detect/index.ts
  - src/detect/dry-run.ts
  - tests/detect/orchestrator.test.ts
  - tests/detect/dry-run.test.ts
autonomous: true
requirements: [MODE-01, MODE-02]
tags: [orchestrator, dry-run, detection, span-dedup, detection-budget]
must_haves:
  truths:
    - "runDetection runs Layers 1→2→3→4 in fixed order with span-coverage dedup between layers"
    - "Each finding gets a resolved placeholder allocated from the session-scoped PlaceholderManager"
    - "Every finding produces one audit log record (action reflects effective config)"
    - "When `dry_run = true` every effective action becomes 'audit'; placeholders are still computed but substitution does NOT change the output text"
    - "When 5 pattern-timeouts occur in a single hook invocation, the orchestrator returns a budgetExhausted flag for the hook to translate into a deny path"
    - "One-way only: no restoration paths exist in this plan"
  artifacts:
    - path: "src/detect/index.ts"
      provides: "runDetection(text, config, sessionState, ctx) → DetectionResult"
      exports: ["runDetection", "DetectionResult", "DetectionContext"]
    - path: "src/detect/dry-run.ts"
      provides: "Helper that coerces all actions to 'audit' when config.dry_run is true"
      exports: ["applyDryRun"]
  key_links:
    - from: "src/detect/index.ts"
      to: "src/detect/layer1-regex/index.ts"
      via: "runLayer1 + WorkerPool"
      pattern: "runLayer1"
    - from: "src/detect/index.ts"
      to: "src/detect/layer2-entropy.ts AND layer3-env.ts AND layer4-words.ts"
      via: "runLayer2Entropy / runLayer3Env / runLayer4Words"
      pattern: "runLayer2Entropy|runLayer3Env|runLayer4Words"
    - from: "src/detect/index.ts"
      to: "src/placeholder/manager.ts"
      via: "PlaceholderManager.allocate for each finding"
      pattern: "PlaceholderManager"
    - from: "src/detect/index.ts"
      to: "src/audit/log.ts"
      via: "writeAuditRecord + findingToAuditRecord for each finding"
      pattern: "writeAuditRecord|findingToAuditRecord"
---

<objective>
Compose the four detection layers, the placeholder manager, and the audit-log writer into a single `runDetection` orchestrator that the hook handlers will call. Implement the `dry_run` mode by coercing every effective action to `audit` while preserving placeholder computation for audit-log accuracy.

Purpose: This is the central glue that makes Phase 2's value-delivery slice operational. Without this orchestrator the hook handlers in Plan 02-05 have no entry point.

Output: A single async `runDetection(text, config, sessionState, ctx) → DetectionResult` function plus a `dry_run`-coercion helper, both tested end-to-end across the four layers.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-00-deps-config-schema-toml-migration-PLAN.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-01-layer1-regex-engine-PLAN.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-02-layers-2-3-4-PLAN.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-03-placeholder-manager-audit-log-PLAN.md
@CLAUDE.md

<interfaces>
Imports this plan depends on:
- `runLayer1(text, config, pool): Promise<{ findings: Finding[]; timeoutCount: number }>` (Plan 02-01)
- `runLayer2Entropy(text, config, coveredSpans): Finding[]` (Plan 02-02)
- `runLayer3Env(text, envBlocklist, coveredSpans): Finding[]` (Plan 02-02)
- `runLayer4Words(text, wordEntries, coveredSpans): Finding[]` (Plan 02-02)
- `SessionState` + `initSessionState` + `getCachedSessionState` + `setCachedSessionState` (Plan 02-02)
- `WorkerPool` (Plan 02-01)
- `PlaceholderManager` + `PlaceholderEntry` (Plan 02-03)
- `substituteFindings` (Plan 02-03)
- `writeAuditRecord` + `findingToAuditRecord` + `AuditRecord` (Plan 02-03)
- `getTypeForRuleId` (Plan 02-01 / 02-03)
- `dedupBySpan` + `Finding` (Plan 02-01)

Plan-locked behaviors:

Layer ordering (CONTEXT §Detection-Layer Ordering):
- Fixed order: 1 → 2 → 3 → 4.
- After each layer, accumulate findings; pass `coveredSpans = findings.map(f => f.span)` to the next layer.
- After all layers run, `dedupBySpan` resolves any residual overlap (defense in depth).

Effective action resolution:
- Each Finding may already carry `.action` (set by Plan 02-01's `runLayer1` from `config.rules` overrides, or by Plan 02-02's `runLayer4Words` from `word|action`).
- If `.action` is undefined, the orchestrator assigns:
  - CRITICAL/HIGH → `'block'`
  - MEDIUM → `'substitute'`
  - LOW → `'audit'`
- Then if `config.dry_run === true`, applyDryRun forces every effective action to `'audit'`.
- The `block` action is meaningful ONLY in `UserPromptSubmit` hook context — for PreToolUse/PostToolUse it's treated as `'substitute'`. The orchestrator does NOT downgrade; that translation lives in Plan 02-05's handlers.

DetectionResult shape (this plan's main export):
```typescript
export interface DetectionContext {
  sessionId: string
  hookEvent: 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse'
  cwd: string                  // for audit log path resolution
}

export interface ResolvedFinding extends Finding {
  placeholder: string          // allocated by PlaceholderManager
  effectiveAction: 'block' | 'substitute' | 'audit'   // post-dry_run coercion
}

export interface DetectionResult {
  findings: ResolvedFinding[]
  substitutedText: string      // text with placeholders substituted (or original text if dry_run)
  budgetExhausted: boolean     // true if Layer 1 timeoutCount >= 5
  rawTimeoutCount: number
}
```

Detection-budget bail-out (CONTEXT §Hook Integration cold-path):
- If `runLayer1` returns `timeoutCount >= 5`, the orchestrator does NOT skip detection — it surfaces `budgetExhausted: true`. The hook handlers (Plan 02-05) translate this into a deny path. Findings collected before the timeout are still included in the result.
- Note: this is per-invocation, not cumulative across hook events.

Audit log writes:
- The orchestrator calls `writeAuditRecord(cwd, findingToAuditRecord(finding, sessionId, hookEvent, effectiveAction))` for EVERY finding (regardless of dry_run or budget state). Writes are awaited but happen in parallel via `Promise.allSettled` to avoid latency cascades.

WorkerPool lifetime:
- The orchestrator creates a module-level `WorkerPool` lazily on first call. Plan 02-05's hook process exits naturally after responding (one-shot model from Phase 1) — pool workers are GC'd. For long-lived MCP usage (Phase 3), Plan 02-05's lifecycle handler will call `pool.terminate()`.
- This plan exports a `getOrCreatePool(): WorkerPool` so Plan 02-05 can call `terminate()` on shutdown.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: runDetection orchestrator + applyDryRun + DetectionResult</name>
  <files>src/detect/index.ts, src/detect/dry-run.ts, tests/detect/orchestrator.test.ts, tests/detect/dry-run.test.ts</files>
  <read_first>
    - All four layer outputs: src/detect/layer1-regex/index.ts, src/detect/layer2-entropy.ts, src/detect/layer3-env.ts, src/detect/layer4-words.ts
    - src/detect/session-state.ts (Plan 02-02 — for SessionState shape + cache helpers)
    - src/placeholder/manager.ts (Plan 02-03 — PlaceholderManager)
    - src/placeholder/substitute.ts (Plan 02-03)
    - src/audit/log.ts (Plan 02-03 — writeAuditRecord + findingToAuditRecord)
    - src/detect/findings.ts (Plan 02-01 — Finding, dedupBySpan, redactedHash, fingerprint)
    - src/detect/type-map.ts (Plan 02-01 — getTypeForRuleId)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md §Detection-Layer Ordering + §Modes
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §9 (hook outputs) + §11 (dry_run)
  </read_first>
  <behavior>
    runDetection algorithm:
    1. Get-or-create `WorkerPool` (module-level singleton).
    2. Get-or-create `PlaceholderManager` keyed on `ctx.sessionId`. Reuse via `setCachedSessionState`/`getCachedSessionState`-style pattern for the manager too — module-level `cachedManagers: Map<sessionId, PlaceholderManager>`.
    3. Run Layer 1: `const l1 = await runLayer1(text, config, pool)`. Initialize `findings = [...l1.findings]`. `timeoutCount = l1.timeoutCount`.
    4. Run Layer 2: `const l2 = runLayer2Entropy(text, config, findings.map(f => f.span))`. Append.
    5. Run Layer 3: `const l3 = runLayer3Env(text, sessionState.envBlocklist, findings.map(f => f.span))`. Append.
    6. Run Layer 4: `const l4 = runLayer4Words(text, sessionState.wordEntries, findings.map(f => f.span))`. Append.
    7. `findings = dedupBySpan(findings)` (defense-in-depth — each layer already gets coveredSpans, but cross-layer pathological overlaps may slip through).
    8. For each finding, assign effective action:
      - If `finding.action` is defined → use it.
      - Else if severity is CRITICAL or HIGH → `'block'`.
      - Else if MEDIUM → `'substitute'`.
      - Else (LOW) → `'audit'`.
    9. Allocate placeholder for each finding: `const type = getTypeForRuleId(finding.ruleId); const entry = manager.allocate(finding.value, type); const resolved = { ...finding, placeholder: entry.placeholder, effectiveAction }`.
    10. If `config.dry_run === true`, run `applyDryRun(resolvedFindings)` to coerce every effectiveAction to `'audit'`. Substituted text becomes the ORIGINAL text (no substitution).
    11. If not dry_run: `substitutedText = substituteFindings(text, resolvedFindings)`.
    12. Write audit records via `Promise.allSettled(resolvedFindings.map(f => writeAuditRecord(ctx.cwd, findingToAuditRecord(f, ctx.sessionId, ctx.hookEvent, f.effectiveAction))))`. Failures are LOGGED to stderr (single-line JSON warning) but do NOT throw — audit-log failures must not break the hook response.
    13. Return `{ findings: resolvedFindings, substitutedText, budgetExhausted: timeoutCount >= 5, rawTimeoutCount: timeoutCount }`.

    applyDryRun:
    - Pure function: `applyDryRun(findings: ResolvedFinding[]): ResolvedFinding[]` returns a new array with `.effectiveAction = 'audit'` for every entry. Does NOT mutate input.

    Module-level pool + manager cache management:
    - `let pool: WorkerPool | null = null; export function getOrCreatePool(): WorkerPool { if (!pool) pool = new WorkerPool(4); return pool }`.
    - `const cachedManagers = new Map<string, PlaceholderManager>(); function getOrCreateManager(sessionId: string): PlaceholderManager { let m = cachedManagers.get(sessionId); if (!m) { m = new PlaceholderManager({ sessionId }); cachedManagers.set(sessionId, m) } return m }`.
    - `export async function shutdownDetection(): Promise<void> { if (pool) await pool.terminate(); pool = null; cachedManagers.clear() }` — Plan 02-05 calls this on hook process exit.
  </behavior>
  <action>
    Step 1 — `src/detect/dry-run.ts`:
    - Tiny pure module.
    - Export `applyDryRun(findings: ResolvedFinding[]): ResolvedFinding[]` returning `findings.map(f => ({ ...f, effectiveAction: 'audit' as const }))`.
    - JSDoc explains MODE-01 semantics: detections still flow into the audit log; placeholders are still computed for log accuracy; substitution is NOT applied to hook output.

    Step 2 — `src/detect/index.ts`:
    - Import everything per the interfaces block.
    - Define and export `DetectionContext`, `ResolvedFinding`, `DetectionResult` interfaces.
    - Implement `getOrCreatePool` + `getOrCreateManager` + `shutdownDetection` per behavior block.
    - Implement `runDetection(text, config, sessionState, ctx): Promise<DetectionResult>` per behavior block.
    - The Layer 1 worker pool must be passed through: `runLayer1(text, config, getOrCreatePool())`.
    - The action-assignment + placeholder-allocation loop must call `getTypeForRuleId(finding.ruleId)` and `manager.allocate(value, type)`.
    - Audit log writes use `Promise.allSettled` and log rejection reasons to stderr as `JSON.stringify({ warn: 'mrclean audit write failed', reason }) + '\n'`.
    - The complete file should be ~150 LOC including JSDoc and imports.

    Step 3 — `tests/detect/orchestrator.test.ts` (~8 tests):
    For each test, build a synthetic config + sessionState (mock SessionState with a small envBlocklist and a few wordEntries) and assert the result shape.

    Tests:
    1. **Layer 1 fires, places placeholder, writes audit record**: text with AWS fixture → result has 1 finding, `effectiveAction: 'block'` (HIGH default), `placeholder: '<MRCLEAN:AWS_KEY:001>'`, `substitutedText.includes('<MRCLEAN:AWS_KEY:001>')`. Verify `.mrclean/audit.jsonl` (in tmpdir cwd) has 1 line. Use temp dir as `ctx.cwd`.
    2. **Span-dedup proven**: text where Layer 1 catches a span [0,20], assert Layer 2 entropy does NOT produce an overlapping finding. (Use a synthesized fixture where the AWS key would also be high-entropy.)
    3. **Layer 3 fires when env value present**: sessionState with `envBlocklist.values = new Set(['secretvalue12345'])`; text `"the secretvalue12345 leaked"` → 1 finding with `source: 'env'`, placeholder TYPE `'ENV'`.
    4. **Layer 4 fires when word present**: sessionState with `wordEntries = [{ word: 'ACME', action: 'warn', re: /\bACME\b/gi }]`; text `"contact ACME today"` → 1 finding with `source: 'words'`, `effectiveAction: 'warn'`... WAIT: 'warn' is a Layer 4 action but DetectionResult specifies `'block'|'substitute'|'audit'`. Resolution: this orchestrator treats `'warn'` as a synonym for `'audit'` (it logs but does not substitute). Document this mapping and add a normalization step: `if (finding.action === 'warn') finding.action = 'audit'`. Adjust the test accordingly.
    5. **dry_run=true coerces every action to audit**: config with `dry_run: true`; AWS fixture in text → result has 1 finding with `effectiveAction: 'audit'`; `substitutedText === text` (original).
    6. **Budget bail-out flag**: mock `runLayer1` to return `{ findings: [], timeoutCount: 5 }`; result has `budgetExhausted: true`, `rawTimeoutCount: 5`.
    7. **Placeholder stability across calls**: call runDetection twice with the same sessionId + same secret value → both calls return the same placeholder string.
    8. **Audit log resilience**: cwd points to a directory where `.mrclean/` does NOT exist; runDetection still returns a DetectionResult without throwing (the audit-write error is logged to stderr; the hook response is preserved).

    Step 4 — `tests/detect/dry-run.test.ts` (~3 tests):
    1. applyDryRun returns array with every effectiveAction='audit'.
    2. applyDryRun does NOT mutate input.
    3. applyDryRun on empty array returns empty array.

    Commit as `feat(02-04): detection orchestrator + dry_run coercion + audit log integration`.
  </action>
  <verify>
    <automated>
      grep -cE "^export async function runDetection|^export function getOrCreatePool|^export async function shutdownDetection" src/detect/index.ts &&
      grep -cE "^export function applyDryRun" src/detect/dry-run.ts &&
      grep -c "dedupBySpan" src/detect/index.ts &&
      grep -c "writeAuditRecord" src/detect/index.ts &&
      grep -c "PlaceholderManager" src/detect/index.ts &&
      grep -cE "runLayer1|runLayer2Entropy|runLayer3Env|runLayer4Words" src/detect/index.ts &&
      grep -c "Promise.allSettled" src/detect/index.ts &&
      npx vitest run tests/detect/orchestrator.test.ts tests/detect/dry-run.test.ts 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      git log -1 --format=%s | grep -E "^feat\(02-04\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - `src/detect/index.ts` exports `runDetection`, `DetectionContext`, `ResolvedFinding`, `DetectionResult`, `getOrCreatePool`, `shutdownDetection`.
    - `src/detect/dry-run.ts` exports `applyDryRun`.
    - Orchestrator calls all four `runLayerN` functions (grep all four names).
    - Orchestrator calls `writeAuditRecord` (grep >= 1).
    - Orchestrator uses `Promise.allSettled` for audit writes (grep = 1).
    - Orchestrator calls `dedupBySpan` once after Layer 4 (grep >= 1).
    - applyDryRun does not mutate inputs (verified by test).

    Behavior assertions:
    - All ~11 tests across orchestrator.test.ts + dry-run.test.ts pass.
    - dry_run test proves MODE-01: every action becomes 'audit', substitutedText equals original.
    - Budget bail-out test proves the flag surfaces correctly (Plan 02-05 will use it).
    - Audit log resilience: a write failure does NOT throw out of runDetection.

    Commit assertion:
    - `git log -1 --format=%s` matches `^feat\(02-04\):`.
  </acceptance_criteria>
  <done>runDetection orchestrator is the single entry point for hook handlers; dry_run mode proven; budget bail-out signal exposed; audit log integration end-to-end.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Layer outputs → orchestrator | Findings cross from per-layer modules into the orchestrator. Trust: each layer is in-process Node code; no extra serialization or sanitization needed. |
| orchestrator → audit log file | Findings include `value` in memory; the `findingToAuditRecord` helper (Plan 02-03) is contractually forbidden from persisting value. This plan does NOT touch that contract. |
| dry_run flag → effective action | Config-driven; the operator's choice. No threat from this surface — dry_run cannot make detection MORE permissive than active mode. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-04-01 | DoS | A pathological hook input triggers 50ms × 5 = 250ms of timeouts then continues running additional layers | mitigate | After Layer 1 returns timeoutCount >= 5, the orchestrator surfaces `budgetExhausted: true`. The hook handler (Plan 02-05) translates this to a deny path — failure is fail-CLOSED, not skip-detection. |
| T-02-04-02 | DoS | Audit-log filesystem fills up; every write fails; runDetection latency grows | accept | Audit writes use `Promise.allSettled`; failures log a single-line stderr warning but the hook response is unaffected. v1 has no rotation; a full disk is operator's problem. |
| T-02-04-03 | Information disclosure | The `value` field on `ResolvedFinding` is in-memory; if Plan 02-05 logs the whole DetectionResult, the secret leaks | mitigate | Plan 02-05 documents that `ResolvedFinding.value` is RAW and must never be logged. DetectionResult is consumed and discarded after the hook response is sent. |
| T-02-04-04 | Spoofing | An attacker crafts a prompt that makes the audit log say `action: "off"` for their secret | accept | Per-rule `action: 'off'` requires the operator's config — attacker cannot inject a config from a prompt. |
| T-02-04-05 | Tampering | A custom `MrcleanRuleOverride` sets `action: 'off'` on all rules | accept | Documented CFG-02 feature. Banner (Plan 02-05) surfaces mode + rule count for operator visibility. |
</threat_model>

<verification>
- `npx vitest run tests/detect/orchestrator.test.ts tests/detect/dry-run.test.ts` — all ~11 tests pass.
- Layer-ordering proof: Layer 1's covered span suppresses Layer 2 entropy on the same span (test 2).
- MODE-01 dry_run proof: with `config.dry_run = true`, the AWS fixture produces a finding with `effectiveAction: 'audit'` AND `result.substitutedText === text` (no substitution).
- MODE-02 one-way enforcement: there is no `restore` / `undo` / `unsubstitute` function in `src/detect/`. `grep -rE "restore|unsubstitute|reverse" src/detect/` (excluding comment lines) returns no implementation matches.
- Detection budget: `runLayer1` returning `timeoutCount: 5` surfaces `budgetExhausted: true` in DetectionResult.
- Placeholder stability: same sessionId + same value across two `runDetection` calls returns the same placeholder.
- All four layer functions are invoked in fixed order (Layer 1 → Layer 4).
</verification>

<success_criteria>
- MODE-01: dry_run=true → every action becomes 'audit'; placeholders computed; substitution skipped. Proven end-to-end.
- MODE-02: one-way only; no restoration functions exist in the detect subsystem. Grep gate verified.
- Plan 02-05 has a stable contract (`runDetection`, `DetectionResult`, `shutdownDetection`) for the hook handler integration.
- Span-coverage dedup proven (Pitfall #6 defended).
- Detection-budget bail-out flag is observable + actionable.
</success_criteria>

<output>
After completion, create `.planning/phases/02-live-redaction-layers-1-4-one-way/02-04-SUMMARY.md` documenting:
- runDetection algorithm steps + interface contract.
- effectiveAction resolution rules (action → severity-default → dry_run coercion).
- Module-level pool + manager cache design.
- Plan 02-05's integration points (getOrCreatePool, runDetection, shutdownDetection).
</output>
