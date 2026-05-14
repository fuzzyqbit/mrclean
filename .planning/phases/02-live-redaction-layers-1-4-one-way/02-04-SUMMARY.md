---
phase: 02-live-redaction-layers-1-4-one-way
plan: "04"
subsystem: detect
tags: [orchestrator, dry-run, detection, span-dedup, detection-budget, audit-log, placeholder]

requires:
  - phase: 02-live-redaction-layers-1-4-one-way
    plan: "00"
    provides: "Finding interface, dedupBySpan, sha256hex, redactedHash, fingerprint, getTypeForRuleId"
  - phase: 02-live-redaction-layers-1-4-one-way
    plan: "01"
    provides: "runLayer1(text, config, pool): Promise<{ findings, timeoutCount }>, WorkerPool"
  - phase: 02-live-redaction-layers-1-4-one-way
    plan: "02"
    provides: "runLayer2Entropy, runLayer3Env, runLayer4Words, SessionState, initSessionState"
  - phase: 02-live-redaction-layers-1-4-one-way
    plan: "03"
    provides: "PlaceholderManager.allocate, substituteFindings, writeAuditRecord, findingToAuditRecord, AuditRecord"

provides:
  - "runDetection(text, config, sessionState, ctx): Promise<DetectionResult> — single entry point for all hook handlers"
  - "DetectionContext, ResolvedFinding, DetectionResult interface exports for Plan 02-05"
  - "getOrCreatePool(): WorkerPool — for Plan 02-05 lifecycle management"
  - "shutdownDetection(): Promise<void> — for Plan 02-05 process exit cleanup"
  - "applyDryRun<T>(findings): T[] — pure dry-run action coercion helper"

affects:
  - 02-05-hook-handlers
  - 02-06-integration-tests
  - phase-3-qa

tech-stack:
  added: []
  patterns:
    - "Layer execution order: L1→L2→L3→L4 with running coveredSpans accumulation"
    - "warn→audit normalization: single in-place rewrite at step 8a before effectiveAction assignment"
    - "Severity-default resolution: CRITICAL/HIGH→block, MEDIUM→substitute, LOW→audit"
    - "dry_run coercion via applyDryRun generic helper; substitutedText=original when active"
    - "Promise.allSettled for parallel audit writes; rejection logged to stderr, never thrown"
    - "Module-level WorkerPool + PlaceholderManager cache (Map<sessionId, manager>)"
    - "Detection-budget bail-out: timeoutCount>=5 surfaces budgetExhausted:true"

key-files:
  created:
    - src/detect/index.ts
    - src/detect/dry-run.ts
    - tests/detect/orchestrator.test.ts
    - tests/detect/dry-run.test.ts
  modified: []

key-decisions:
  - "warn→audit normalization happens in-place at step 8a (before effectiveAction assignment), not in Layer 4 — preserves Layer 4's design that 'warn' is a user-facing alias"
  - "applyDryRun uses generic constraint T extends { effectiveAction: ... } to avoid circular import with index.ts while remaining type-safe"
  - "Promise.allSettled for audit writes: failures never break hook response path (audit-log is observability, not control plane)"
  - "WorkerPool and PlaceholderManager caches are module-level singletons; shutdownDetection() resets both — Plan 02-05 calls it on process exit"
  - "budgetExhausted is a signal, not an early exit: findings collected before timeout are still included in DetectionResult"

patterns-established:
  - "DetectionResult shape: { findings: ResolvedFinding[], substitutedText, budgetExhausted, rawTimeoutCount } — stable contract for Plan 02-05"
  - "ResolvedFinding = Finding + { placeholder: string, effectiveAction: 'block' | 'substitute' | 'audit' } — effectiveAction NEVER 'warn'"
  - "Audit resilience: writeAuditRecord rejection → stderr JSON warning only; DetectionResult still returned"

requirements-completed: [MODE-01, MODE-02]

duration: 20min
completed: 2026-05-14
---

# Phase 2 Plan 04: Detection Orchestrator + dry_run + warn→audit Normalization + Budget Bail-out Summary

**runDetection orchestrator wiring all four detection layers (L1→L2→L3→L4) with span-coverage dedup, warn→audit normalization, dry_run coercion, parallel audit writes, and detection-budget bail-out flag**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-14T10:30:00Z
- **Completed:** 2026-05-14T10:50:00Z
- **Tasks:** 1 (TDD, combined RED+GREEN)
- **Files created:** 4 (2 src + 2 tests)

## Accomplishments

- `runDetection(text, config, sessionState, ctx)` orchestrates all four detection layers in fixed order (L1→L2→L3→L4), passing cumulative `coveredSpans` to each subsequent layer to prevent re-detection of already-claimed spans. `dedupBySpan` applied after Layer 4 as defense-in-depth.
- **warn→audit normalization (LOCKED CRITERION):** Layer 4 emits `finding.action = 'warn'` as a user-friendly word-list token. The orchestrator normalises this to `'audit'` at step 8a (in-place rewrite, single point). Proven by orchestrator test 4: `wordEntry.action='warn'` → `ResolvedFinding.effectiveAction='audit'`.
- **dry_run mode (MODE-01):** `applyDryRun<T>` coerces every `effectiveAction` to `'audit'`; `substitutedText === original text` (placeholders are still computed for audit-log accuracy but not applied). Proven by test 5.
- **Detection-budget bail-out:** `runLayer1` returning `timeoutCount >= 5` surfaces `budgetExhausted: true` in `DetectionResult`. Plan 02-05 translates this to a deny path (fail-closed). Proven by test 6.
- **Audit log resilience:** `Promise.allSettled` for parallel writes; `AuditWriteError` from missing `.mrclean/` directory is caught and logged to stderr as single-line JSON — the `DetectionResult` is still returned and the hook response is preserved. Proven by test 8.
- **Placeholder stability:** Module-level `Map<sessionId, PlaceholderManager>` ensures same value → same placeholder across calls within the same process. Proven by test 7.

## Task Commits

1. **Task 1: runDetection orchestrator + applyDryRun + all tests** - `f7caef7` (feat)

## Files Created/Modified

- `src/detect/index.ts` — runDetection orchestrator; DetectionContext, ResolvedFinding, DetectionResult interfaces; getOrCreatePool, shutdownDetection; module-level WorkerPool + PlaceholderManager cache
- `src/detect/dry-run.ts` — applyDryRun generic helper (pure, no mutation, uses structural generic constraint to avoid circular import)
- `tests/detect/orchestrator.test.ts` — 8 integration tests: AWS key pipeline (L1), span-dedup (L1 suppresses L2), Layer 3 env detection, Layer 4 warn→audit normalization (LOCKED), dry_run=true, budget bail-out, placeholder stability, audit log resilience
- `tests/detect/dry-run.test.ts` — 3 unit tests: all actions coerced to audit, no mutation, empty array

## runDetection Algorithm Steps

```
1. getOrCreatePool()                            — module-level WorkerPool singleton
2. getOrCreateManager(ctx.sessionId)            — module-level PlaceholderManager per session
3. l1 = await runLayer1(text, config, pool)     — secretlint + gitleaks (async)
4. l2 = runLayer2Entropy(text, config, l1.spans)— entropy (sync, skips l1 spans)
5. l3 = runLayer3Env(text, envBlocklist, spans)  — env literal (sync, skips l1+l2 spans)
6. l4 = runLayer4Words(text, wordEntries, spans) — dirty-word list (sync, skips l1-l3 spans)
7. deduped = dedupBySpan([...l1, l2, l3, l4])  — defense-in-depth cross-layer dedup
8a. for f in deduped: if f.action==='warn' f.action='audit'  — LOCKED normalization
8b/c. per finding: effectiveAction = f.action ?? severityDefault(f.severity)
9. allocate placeholder per finding via manager.allocate(value, type)
dry_run: finalFindings = applyDryRun(resolved) ; substitutedText = text
else:    finalFindings = resolved               ; substitutedText = substituteFindings(...)
12. await Promise.allSettled(writes) — audit log, failures → stderr warning only
13. return { findings, substitutedText, budgetExhausted: timeoutCount>=5, rawTimeoutCount }
```

## effectiveAction Resolution Rules

| Step | Condition | effectiveAction |
|------|-----------|-----------------|
| 8a | `finding.action === 'warn'` | normalize to `'audit'` (in-place) |
| 8b | `finding.action !== undefined` (after 8a) | `= finding.action` |
| 8c | `finding.action === undefined` + CRITICAL/HIGH | `'block'` |
| 8c | `finding.action === undefined` + MEDIUM | `'substitute'` |
| 8c | `finding.action === undefined` + LOW | `'audit'` |
| dry_run | `config.dry_run === true` | `applyDryRun` forces all to `'audit'` |

## Plan 02-05 Integration Points

| Export | Signature | Purpose |
|--------|-----------|---------|
| `runDetection` | `(text, config, sessionState, ctx) => Promise<DetectionResult>` | Main hook handler entry point |
| `getOrCreatePool` | `() => WorkerPool` | Retrieve pool for lifecycle management |
| `shutdownDetection` | `() => Promise<void>` | Call on process exit to terminate workers |
| `DetectionContext` | Interface | Pass sessionId + hookEvent + cwd |
| `ResolvedFinding` | Interface | Consuming the findings array |
| `DetectionResult` | Interface | Consuming the full result |

## Decisions Made

- **warn→audit normalization in orchestrator (not in Layer 4):** Keeps Layer 4's API clean — it emits 'warn' as a word-list user-facing concept. The orchestrator is the single normalization point where the 'warn' token enters the 'block'|'substitute'|'audit' effectiveAction space.
- **Generic applyDryRun to avoid circular import:** `index.ts` imports `applyDryRun` from `dry-run.ts`, and `dry-run.ts` would need `ResolvedFinding` from `index.ts`. Using `T extends { effectiveAction: ... }` breaks the dependency — TypeScript type-checks correctly at both call sites.
- **budgetExhausted as signal, not early exit:** Findings collected before Layer 1 timeouts are preserved in the result. The hook handler (Plan 02-05) can inspect findings even in the budget-exhausted path before deciding on the deny response.
- **Promise.allSettled for audit writes:** If a single finding's write fails (e.g., disk full), the remaining findings still get written. Neither the hook response nor other audit writes are blocked by one failure.

## Deviations from Plan

None — plan executed exactly as written.

The test for the budget bail-out (test 6) uses `vi.doMock` with a cache-busting query string `?budget=1`. This is a vitest-specific pattern for module cache isolation in dynamic-import tests. It's not documented in the plan but is the standard vitest approach.

## Issues Encountered

Pre-existing test ordering failures in the full suite (`tests/doctor/end-to-end.test.ts` and `tests/install/idempotency.test.ts`) due to shared filesystem state between test files. These failures are not caused by this plan's changes — they occur without the new files (verified by excluding new test files from the run). The plan-scoped tests (`orchestrator.test.ts` + `dry-run.test.ts`) pass 100% in isolation and in combination with the full `tests/detect/` directory.

## Next Phase Readiness

Plan 02-05 (hook handlers) has a stable contract:
- `runDetection(text, config, sessionState, ctx)` is the single entry point
- `DetectionResult.budgetExhausted` signals the deny path
- `shutdownDetection()` for process exit cleanup
- `getOrCreatePool()` for pool lifecycle management

MODE-01 (dry_run) and MODE-02 (one-way) are both proven:
- MODE-01: `config.dry_run=true` → all actions audit, substitutedText=original (test 5)
- MODE-02: no restore/unsubstitute functions in `src/detect/` (grep gate clean)

---
*Phase: 02-live-redaction-layers-1-4-one-way*
*Completed: 2026-05-14*
