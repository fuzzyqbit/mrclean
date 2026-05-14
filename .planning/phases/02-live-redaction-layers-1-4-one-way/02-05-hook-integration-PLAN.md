---
phase: 02-live-redaction-layers-1-4-one-way
plan: "05"
type: execute
wave: 4
depends_on: ["04"]
files_modified:
  - src/hook/handlers/session-start.ts
  - src/hook/handlers/user-prompt-submit.ts
  - src/hook/handlers/pre-tool-use.ts
  - src/hook/handlers/post-tool-use.ts
  - src/hook/banner.ts
  - src/hook/index.ts
  - src/cli.ts
  - src/install/markers.ts
  - src/install/ignore.ts
  - src/shared/types.ts
  - src/doctor/version-check.ts
  - tests/hook/handlers-detection.test.ts
  - tests/hook/integration-detection.test.ts
  - tests/cli/ignore.test.ts
autonomous: true
requirements: [HOOK-02, HOOK-03, HOOK-04, CFG-04]
tags: [hook-integration, user-prompt-submit, pre-tool-use, post-tool-use, banner, ignore, cli]
must_haves:
  truths:
    - "UserPromptSubmit with a CRITICAL or HIGH detection returns `{ decision: 'block', reason: '[mrclean] <ruleId> ...' }` at TOP LEVEL (not in hookSpecificOutput)"
    - "UserPromptSubmit with MEDIUM/LOW detection passes through with an additionalContext warning"
    - "PreToolUse with any detection emits `hookSpecificOutput.updatedInput` carrying the COMPLETE tool_input object with secrets substituted by placeholders"
    - "PostToolUse with detections in tool_response emits `hookSpecificOutput.updatedToolOutput` (Claude Code >= v2.1.121) with placeholder-substituted output"
    - "SessionStart triggers Layer 3 + Layer 4 reload and emits the long-form banner `mrclean active vN.N.N (rules: NNN, allowlist: NN, mode: M)`"
    - "dry_run=true: UserPromptSubmit never blocks; PreToolUse/PostToolUse do not substitute; audit log still records detections"
    - "Budget exhaustion (5 pattern timeouts) produces a structured deny on UserPromptSubmit and PreToolUse; PostToolUse logs and passes through"
    - "`mrclean ignore <fingerprint>` appends the fingerprint to `<cwd>/.mrclean/config.toml [allowlist].fingerprints` idempotently"
    - "Doctor reports Claude Code version >= 2.1.121 (or yellow-warns if older — updatedToolOutput required)"
  artifacts:
    - path: "src/hook/handlers/user-prompt-submit.ts"
      provides: "Full UserPromptSubmit handler with detection + block/allow + banner"
      contains: "decision"
    - path: "src/hook/handlers/pre-tool-use.ts"
      provides: "Full PreToolUse handler with updatedInput substitution"
      contains: "updatedInput"
    - path: "src/hook/handlers/post-tool-use.ts"
      provides: "Full PostToolUse handler with updatedToolOutput substitution"
      contains: "updatedToolOutput"
    - path: "src/hook/handlers/session-start.ts"
      provides: "SessionStart handler bootstraps SessionState + long-form banner"
      contains: "initSessionState"
    - path: "src/hook/banner.ts"
      provides: "buildBanner(config, ruleCount, allowlistCount): string"
      exports: ["buildBanner", "computeAllowlistCount"]
    - path: "src/install/ignore.ts"
      provides: "appendFingerprintToConfig(cwd, fingerprint)"
      exports: ["runIgnore", "appendFingerprintToConfig"]
    - path: "src/cli.ts"
      provides: "ignore subcommand wired"
      contains: "ignore"
  key_links:
    - from: "src/hook/handlers/*"
      to: "src/detect/index.ts"
      via: "runDetection + DetectionResult"
      pattern: "runDetection"
    - from: "src/hook/handlers/session-start.ts"
      to: "src/detect/session-state.ts"
      via: "initSessionState + setCachedSessionState"
      pattern: "initSessionState"
    - from: "src/cli.ts"
      to: "src/install/ignore.ts"
      via: "runIgnore subcommand action"
      pattern: "runIgnore"
---

<objective>
Wire the Phase 2 detection orchestrator into the four hook handlers (replacing Phase 1's no-op bodies), upgrade the HOOK-07 banner to the long form, add the `mrclean ignore <fingerprint>` CLI subcommand, and update doctor's Claude Code version check to require >= 2.1.121 (since PostToolUse `updatedToolOutput` requires that version).

Purpose: This is the plan that operators see — pasting an AWS key into Claude Code MUST be blocked, secrets in tool arguments MUST be substituted, and the wiring banner MUST reflect live rule counts. Without this plan, all of Plans 02-00..04 are invisible to the user.

Output: Four populated hook handlers, a banner module, an ignore subcommand, a doctor version-floor bump, and integration tests proving each event type behaves correctly under detection AND under dry_run AND under budget exhaustion.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md
@.planning/phases/01-wired-skeleton/01-03-SUMMARY.md
@.planning/phases/01-wired-skeleton/01-05-SUMMARY.md
@CLAUDE.md

<interfaces>
Inputs (Plan 02-04 outputs):
- `runDetection(text, config, sessionState, ctx): Promise<DetectionResult>`
- `DetectionResult = { findings: ResolvedFinding[]; substitutedText: string; budgetExhausted: boolean; rawTimeoutCount: number }`
- `ResolvedFinding = Finding & { placeholder: string; effectiveAction: 'block'|'substitute'|'audit' }`
- `shutdownDetection()` for hook process exit (optional; one-shot model usually skips it).
- `loadEffectiveConfig({ homeDir, cwd })` (Plan 02-00 — Phase 2 schema).
- `initSessionState({ sessionId, homeDir, cwd, config })` + `setCachedSessionState`/`getCachedSessionState` (Plan 02-02).
- `getRuleCount(): { secretlint, gitleaks, total }` (Plan 02-01).

Phase 1 hook scaffolding to preserve:
- `runHook()` orchestrator in `src/hook/index.ts` (Phase 1 — reads stdin, dispatches via dispatcher.ts, writes stdout JSON, exits 0 on success / 2 on fail-closed crash).
- `installCrashGuards()` (fail-closed contract).
- `handleSessionStart`, `handleUserPromptSubmit`, `handlePreToolUse`, `handlePostToolUse` exports (called by dispatcher).
- Hook output types from `src/shared/types.ts`.

Locked Claude Code JSON shapes (RESEARCH §9 — corrected from CONTEXT):

UserPromptSubmit deny (RESEARCH §9.2 — top-level, NOT in hookSpecificOutput):
```json
{
  "decision": "block",
  "reason": "[mrclean] AWSAccessKey (HIGH): detected at offset 12 — rewrite prompt before submitting",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "mrclean blocked: AWSAccessKey <MRCLEAN:AWS_KEY:001>"
  }
}
```

UserPromptSubmit allow-with-warning (MEDIUM/LOW or budget-not-exhausted-low-confidence):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "[mrclean] LOW-confidence detection: ..."
  }
}
```

PreToolUse substitute (RESEARCH §9.3):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "[mrclean] substituted N secret(s)",
    "updatedInput": <FULL_TOOL_INPUT_WITH_SUBSTITUTIONS>
  }
}
```

PreToolUse budget-exhausted (RESEARCH §9.5):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "[mrclean] detection budget exhausted — tool call blocked for safety"
  }
}
```

PostToolUse substitute (RESEARCH §9.4 — requires Claude Code >= v2.1.121):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "updatedToolOutput": "Command output: token=<MRCLEAN:GH_TOKEN:002> ...",
    "additionalContext": "[mrclean] substituted N secret(s) in tool output"
  }
}
```

Banner format (RESEARCH §9.6):
`mrclean active v${VERSION} (rules: ${ruleCount}, allowlist: ${allowlistCount}, mode: ${mode})`
- ruleCount = `getRuleCount().total`
- allowlistCount = sum of all 5 `allowlist.*.length` from the merged config
- mode = `'dry-run'` if `config.dry_run` else `'active'` else `'off'` (the off mode is not currently triggered by any input — keep the string in case a future opt-out flag emits it).

PostToolUse tool_response coercion (RESEARCH Pitfall #7):
- `const text = typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response)`.
- The substituted output is always a STRING when emitted as `updatedToolOutput`.

Hook output types — Plan 02-00 has NOT updated these yet. This plan updates `src/shared/types.ts`:
- `PostToolUseOutput.hookSpecificOutput.updatedToolOutput?: string` — ADD this field.
- `UserPromptSubmitOutput` already has `decision?: 'block'` and `reason?: string` (Phase 1 — keep as-is).

`mrclean ignore <fingerprint>` (CFG-04):
- CLI: `mrclean ignore <fingerprint>` action handler calls `runIgnore(fingerprint, cwd)`.
- `runIgnore`:
  1. Resolves `<cwd>/.mrclean/config.toml`.
  2. Reads via `readConfigLayer` (returns {} if missing).
  3. Extracts current `allowlist.fingerprints` array (default []).
  4. If fingerprint already present → write to stderr "[mrclean] already allowlisted" and return.
  5. Else: append fingerprint to the array and write the file back. Use `smol-toml`'s stringify if it exists (RESEARCH OQ-4); if not, use a targeted append strategy: parse, mutate `result.allowlist.fingerprints`, re-emit via stringify OR if stringify is unavailable, fall back to plain text append at the end of the file with a comment header. **Decision: test whether smol-toml exports `stringify` at implementation time; prefer stringify; fall back to plain-append.**
  6. Print success message to stderr.

Doctor version-floor bump:
- `src/doctor/version-check.ts` currently classifies green/yellow/red based on a Phase 1 threshold. Update the threshold for the `updatedToolOutput` feature: `>= 2.1.121` → green; `< 2.1.121` → yellow with "PostToolUse output substitution requires Claude Code >= 2.1.121"; not-found → red as before.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Hook handlers + banner — UserPromptSubmit, PreToolUse, PostToolUse, SessionStart</name>
  <files>src/hook/handlers/user-prompt-submit.ts, src/hook/handlers/pre-tool-use.ts, src/hook/handlers/post-tool-use.ts, src/hook/handlers/session-start.ts, src/hook/banner.ts, src/shared/types.ts, tests/hook/handlers-detection.test.ts, tests/hook/integration-detection.test.ts</files>
  <read_first>
    - src/hook/handlers/user-prompt-submit.ts (Phase 1 no-op — replace body)
    - src/hook/handlers/pre-tool-use.ts (Phase 1 no-op — replace body)
    - src/hook/handlers/post-tool-use.ts (Phase 1 no-op — replace body)
    - src/hook/handlers/session-start.ts (Phase 1 banner-only — replace body)
    - src/hook/index.ts (Phase 1 — preserve runHook orchestrator + fail-closed)
    - src/hook/dispatcher.ts (Phase 1 — confirm dispatch routes)
    - src/shared/types.ts (Phase 1 types — extend `PostToolUseOutput` with `updatedToolOutput`)
    - src/detect/index.ts (Plan 02-04 — runDetection + DetectionResult + shutdownDetection)
    - src/detect/session-state.ts (Plan 02-02 — initSessionState + cache)
    - src/detect/layer1-regex/index.ts (Plan 02-01 — getRuleCount)
    - src/config/index.ts (Plan 02-00 — loadEffectiveConfig)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §9 (hook JSON shapes — LOCKED)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md §Hook Integration + §Banner Upgrade
  </read_first>
  <behavior>
    Each handler is an `async` function (Phase 1 handlers were sync; the dispatcher is already `await`-aware per Plan 01-03's pattern of `await handler(input)`). All handlers must be made async-compatible — the dispatcher in src/hook/dispatcher.ts may already support this; if not, this plan amends it to `await` the result before returning.

    handleSessionStart(input):
    1. Load config: `const config = await loadEffectiveConfig({ homeDir: homedir(), cwd: input.cwd })`. On `ConfigReadError` → fail closed (re-throw; the existing `installCrashGuards` catches this for exit 2).
    2. Init session state: `const state = await initSessionState({ sessionId: input.session_id, homeDir: homedir(), cwd: input.cwd, config })`.
    3. Cache: `setCachedSessionState(state)`.
    4. Build banner: `const banner = buildBanner(config, getRuleCount().total, computeAllowlistCount(config))`.
    5. Return `{ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: banner } }`.

    handleUserPromptSubmit(input):
    1. Load config + ensure SessionState cached for `input.session_id`. If `getCachedSessionState(input.session_id)` is null → bootstrap it now (defensive — SessionStart may not fire in `/clear`/compact cases; per Phase 1 SessionStartInput source field).
    2. `const result = await runDetection(input.prompt, config, state, { sessionId: input.session_id, hookEvent: 'UserPromptSubmit', cwd: input.cwd })`.
    3. **Budget exhausted** → return `{ decision: 'block', reason: '[mrclean] detection budget exhausted (5 pattern timeouts) — prompt blocked for safety' }` (top-level).
    4. **dry_run=true** → return `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: '<banner-from-buildBanner-OR-low-priority-warning>' } }`. NEVER block in dry_run.
    5. **Any CRITICAL or HIGH finding** → return `{ decision: 'block', reason: ..., hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: '<summary including placeholders>' } }`. Reason format: `[mrclean] ${ruleId} (${severity}): detected at offset ${span.start} — rewrite prompt before submitting`.
    6. **Only MEDIUM/LOW findings** → return `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: '[mrclean] ${count} detection(s) (${severities}) — placeholders: ${list}' } }`. **Do NOT** substitute the prompt itself — Claude Code does not support silent prompt rewrite for UserPromptSubmit. We only emit an additionalContext warning so the operator sees the audit hint.
    7. **No findings** → return the banner-style `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: <banner> } }` so the wiring signal still fires.

    handlePreToolUse(input):
    1. Same config/state bootstrap as UserPromptSubmit.
    2. Coerce `tool_input` to a string for detection: scan ALL string-valued leaf fields of the JSON object. **Implementation: `JSON.stringify(input.tool_input)` is the simplest representation; detection runs on this stringified form**. Document this in code: substitution happens by re-stringifying after placeholder replacement.
    3. Actually substitution must happen on the original object's string fields, not a JSON-string serialization (Pitfall #4: `updatedInput` must be the COMPLETE tool_input object). Approach: walk the object, for each string leaf field, run detection on it; if findings exist, apply substituteFindings to that field's value; write the result back. Use a generic helper `substituteToolInputDeep(input, runDetectionFn): Promise<{ updatedInput, allFindings, budgetExhausted }>` that recurses into objects/arrays.
    4. **Budget exhausted** → return `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '[mrclean] detection budget exhausted — tool call blocked for safety' } }`.
    5. **dry_run=true** → return `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: '[mrclean] dry_run: ${count} detection(s) logged, no substitution' } }`. NO updatedInput.
    6. **Any detection** → return `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: '[mrclean] substituted ${count} secret(s)', updatedInput: <FULL_TOOL_INPUT_WITH_SUBSTITUTIONS> } }`. The updatedInput is the complete object.
    7. **No findings** → return `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }` (Phase 1 default).

    handlePostToolUse(input):
    1. Same bootstrap.
    2. Coerce `tool_response` to string per RESEARCH Pitfall #7: `const text = typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response)`.
    3. Run detection on `text`.
    4. **Budget exhausted** → return `null` (PostToolUse is non-blocking; we log to stderr a structured warning and pass through). Write `process.stderr.write(JSON.stringify({ warn: 'mrclean detection budget exhausted on PostToolUse', sessionId }) + '\n')`.
    5. **dry_run=true** → return `null` (no substitution; detections already logged by runDetection).
    6. **Any detection** → return `{ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: result.substitutedText, additionalContext: '[mrclean] substituted ${count} secret(s) in tool output' } }`.
    7. **No findings** → return `null`.
  </behavior>
  <action>
    buildBanner + computeAllowlistCount (src/hook/banner.ts):
    - `export function buildBanner(config: MrcleanConfig, ruleCount: number, allowlistCount: number): string` returning the long-form string. Mode token: `dry_run ? 'dry-run' : 'active'`.
    - `export function computeAllowlistCount(config: MrcleanConfig): number` returning `config.allowlist.rules.length + config.allowlist.paths.length + config.allowlist.stopwords.length + config.allowlist.regexes.length + config.allowlist.fingerprints.length`.

    Update `src/shared/types.ts`:
    - Add `updatedToolOutput?: string` to `PostToolUseOutput.hookSpecificOutput`.
    - Preserve all other fields.

    Update `src/hook/dispatcher.ts` if needed:
    - Confirm handlers return `Promise<HookOutput>` (was sync in Phase 1; async now). The runHook orchestrator must `await` the dispatch result. If dispatcher is already async (likely), no change needed.

    Tests:

    tests/hook/handlers-detection.test.ts (unit tests for each handler — ~10 tests):

    1. **SessionStart bootstraps state + emits long-form banner**: mock loadEffectiveConfig + initSessionState; call handler; assert banner string matches the format with mode='active' and the right rule count from a mock `getRuleCount()`.
    2. **UserPromptSubmit blocks on HIGH finding**: prompt contains AWS fixture; result.findings has 1 HIGH; handler returns `{ decision: 'block', reason: <starts with [mrclean]>, hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: <contains placeholder> } }`.
    3. **UserPromptSubmit passes through MEDIUM**: mock detection returning 1 MEDIUM finding; handler returns hookSpecificOutput only, NO decision: 'block'.
    4. **UserPromptSubmit dry_run=true with HIGH finding still allows**: same prompt, config.dry_run=true; handler returns hookSpecificOutput with additionalContext, NO decision field.
    5. **UserPromptSubmit budget exhausted blocks**: mock budgetExhausted=true; handler returns decision='block' with budget message.
    6. **PreToolUse substitutes in tool_input.command**: tool_input = `{ command: 'curl -H ... sk_live_X' }`; handler returns updatedInput with the command rewritten to contain `<MRCLEAN:STRIPE_KEY:001>`.
    7. **PreToolUse preserves untouched fields**: tool_input = `{ command: 'echo sk_live_X', file_path: '/tmp/x' }`; updatedInput preserves file_path AND substitutes command.
    8. **PreToolUse budget exhausted denies**: returns permissionDecision='deny' with budget message.
    9. **PostToolUse substitutes string tool_response**: input.tool_response is a string containing a token; handler returns updatedToolOutput with the substituted version.
    10. **PostToolUse non-string tool_response coerces to JSON**: input.tool_response is `{ output: '... token ...' }`; handler stringifies, detects, substitutes, returns updatedToolOutput.

    tests/hook/integration-detection.test.ts (~6 end-to-end tests):

    1. **End-to-end UserPromptSubmit block via stdin/stdout**: spawn `node dist/cli.js hook`, write a SessionStart payload first (to populate the cached state — note: this requires a SHARED process for SessionStart + UserPromptSubmit, but Phase 1's hook is one-shot; resolution: this test calls runHook ONLY for the UserPromptSubmit event and relies on the handler's defensive bootstrap-when-cache-miss path). Spawn with stdin JSON of a UserPromptSubmit payload with AWS fixture in prompt. Assert exit code 0, stdout JSON contains `decision: 'block'` and a `reason` starting with `[mrclean]`. (Requires `npm run build` first.)
    2. **End-to-end PreToolUse substitution**: stdin PreToolUse payload with `tool_input.command` containing stripe key fixture; assert stdout JSON.hookSpecificOutput.updatedInput.command contains `<MRCLEAN:STRIPE_KEY:`.
    3. **End-to-end PostToolUse updatedToolOutput**: PostToolUse payload with `tool_response: "... sk_live_X ..."`; assert stdout JSON.hookSpecificOutput.updatedToolOutput contains the placeholder.
    4. **End-to-end SessionStart banner**: assert additionalContext matches the long-form banner pattern.
    5. **End-to-end dry_run audit-only**: temp project with `.mrclean/config.toml` containing `dry_run = true`; UserPromptSubmit with AWS fixture; assert exit code 0, NO `decision` field in stdout JSON, the audit log file has 1 line.
    6. **End-to-end fail-closed on uncaught error**: trigger a synthetic error by passing malformed JSON to stdin; assert exit code 2 and a structured stderr error (validates Phase 1 fail-closed still works after Phase 2 wiring).

    Tests 1-5 require `npm run build` to be run before the test suite. Use a `beforeAll` hook that calls `await execAsync('npm run build')` with a 60s timeout, skipping if `dist/cli.js` is newer than `src/`.

    Commit as `feat(02-05): hook integration — UserPromptSubmit block, PreToolUse + PostToolUse substitute, long-form banner`.
  </action>
  <verify>
    <automated>
      grep -c "runDetection" src/hook/handlers/user-prompt-submit.ts &&
      grep -c "runDetection" src/hook/handlers/pre-tool-use.ts &&
      grep -c "runDetection" src/hook/handlers/post-tool-use.ts &&
      grep -c "initSessionState" src/hook/handlers/session-start.ts &&
      grep -cE "decision.*block|'block'" src/hook/handlers/user-prompt-submit.ts &&
      grep -c "updatedInput" src/hook/handlers/pre-tool-use.ts &&
      grep -c "updatedToolOutput" src/hook/handlers/post-tool-use.ts &&
      grep -cE "^export function buildBanner" src/hook/banner.ts &&
      grep -c "updatedToolOutput" src/shared/types.ts &&
      npx vitest run tests/hook/handlers-detection.test.ts 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      npm run build &&
      npx vitest run tests/hook/integration-detection.test.ts 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      git log -1 --format=%s | grep -E "^feat\(02-05\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - All four handlers call `runDetection` and use `loadEffectiveConfig` + `initSessionState`/`getCachedSessionState`.
    - `src/hook/handlers/user-prompt-submit.ts` uses `decision` + `reason` at top level (NOT `permissionDecision`).
    - `src/hook/handlers/pre-tool-use.ts` emits `updatedInput` with the full tool_input object (verified by integration test 2).
    - `src/hook/handlers/post-tool-use.ts` emits `updatedToolOutput` (Claude Code >= 2.1.121 feature).
    - `src/hook/banner.ts` exports `buildBanner` and `computeAllowlistCount`.
    - `src/shared/types.ts` includes `updatedToolOutput?: string` in PostToolUseOutput.hookSpecificOutput.

    Behavior assertions:
    - All 10 unit tests + 6 integration tests pass.
    - Block path verified end-to-end via spawned `dist/cli.js hook`.
    - Substitution paths verified end-to-end for both PreToolUse and PostToolUse.
    - dry_run mode verified end-to-end (no block, audit log populated).
    - Fail-closed contract still works (Phase 1 invariant preserved).

    Commit assertion:
    - `git log -1 --format=%s` matches `^feat\(02-05\)`.
  </acceptance_criteria>
  <done>Four hook handlers wired to runDetection; long-form banner emitted; UserPromptSubmit blocks on CRITICAL/HIGH per RESEARCH-corrected shape; PreToolUse + PostToolUse substitute; dry_run honored; budget exhaustion translates to deny paths; integration tests prove end-to-end via dist/cli.js.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: `mrclean ignore <fingerprint>` CLI + doctor Claude Code version-floor bump</name>
  <files>src/install/ignore.ts, src/install/markers.ts, src/cli.ts, src/doctor/version-check.ts, tests/cli/ignore.test.ts</files>
  <read_first>
    - src/install/markers.ts (Phase 1 — read existing markers; consider whether to add an `IGNORE_MARKER` or just append cleanly)
    - src/cli.ts (Phase 1 — add `ignore` subcommand to the program)
    - src/config/index.ts (Plan 02-00 — readConfigLayer for reading existing config.toml)
    - src/doctor/version-check.ts (Phase 1 — existing yellow/red/green thresholds; bump for 2.1.121)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §11.5 + OQ-4 (smol-toml stringify availability — verify at implementation time)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md §Configuration `mrclean ignore` description
  </read_first>
  <behavior>
    runIgnore:
    - Idempotent: same fingerprint appended twice → no duplicate.
    - Creates `<cwd>/.mrclean/config.toml` if missing (with just `[allowlist]\nfingerprints = ['<fp>']`).
    - Existing config.toml is preserved: only the `allowlist.fingerprints` array is mutated.
    - Prints a one-line stderr success message identifying the modified file path.

    smol-toml stringify strategy:
    - Check at implementation time: `import * as smol from 'smol-toml'; if (typeof smol.stringify === 'function') ...`.
    - If stringify exists: parse → mutate → stringify → atomic-write (re-use Phase 1's atomicWriteJson pattern, adapted for TOML — actually atomic-write for TOML is just `writeFile` to tmp + rename).
    - If stringify does not exist (RESEARCH OQ-4): use a minimal append strategy:
      1. Parse existing file.
      2. If `allowlist.fingerprints` array already has the fingerprint → no-op.
      3. Else: read the raw file content; if a `[allowlist]\n... fingerprints = [...]` block exists, REGEX-replace the array (target the exact line `fingerprints = [...]` and append the new fingerprint inside the brackets); if not, append `\n[allowlist]\nfingerprints = ["<fp>"]\n` to the file.
      4. Document the regex-replace approach is fragile and recommend smol-toml stringify when it lands upstream.

    Doctor version-floor:
    - Update `checkClaudeCodeVersion` (or its underlying classify function) to:
      - green: Claude Code version >= 2.1.121.
      - yellow: 2.1.x with x < 121 — "PostToolUse output substitution requires Claude Code >= 2.1.121; current version supports prompt block + PreToolUse substitution but not tool-output rewrite. Upgrade for full Phase 2 functionality."
      - red: < 2.1.0 or missing.
    - Preserve existing tests; update the yellow message and the green threshold.
    - DO NOT bump the version in any installer or hook output — operators on 2.1.119 still get most of Phase 2 (everything except PostToolUse rewrite). The doctor yellow is the observable signal.
  </behavior>
  <action>
    Step 1 — `src/install/ignore.ts`:
    - Export `async function runIgnore(opts: { fingerprint: string; cwd?: string }): Promise<void>`:
      - cwd default to `process.cwd()`.
      - validate fingerprint shape: must match `/^[a-z0-9:_.-]+:[0-9a-f]{16}$/i` (ruleId + ':' + 16-char redactedHash). On invalid → stderr error + process.exit(2) — fail-closed CLI behavior.
      - delegate to `appendFingerprintToConfig(cwd, fingerprint)`.
      - stderr success message: `[mrclean] added ${fingerprint} to ${configPath}`.
    - Export `async function appendFingerprintToConfig(cwd: string, fingerprint: string): Promise<{ added: boolean; path: string }>`:
      - configPath = `join(cwd, '.mrclean', 'config.toml')`.
      - readConfigLayer(configPath) → existing Partial<MrcleanConfig>.
      - existing fingerprints = `existing.allowlist?.fingerprints ?? []`.
      - If existing.includes(fingerprint) → return `{ added: false, path: configPath }` (no-op).
      - Else: implement either smol-toml stringify path OR text-append path (see behavior). Write the result.
      - Return `{ added: true, path: configPath }`.

    Step 2 — `src/install/markers.ts`:
    - No new markers needed. Confirm no changes required (this task touches `markers.ts` only if there's a legitimate need to identify mrclean-managed sections of `config.toml`; the IGNORE block likely just appends without a marker since it's the operator's own file).

    Step 3 — `src/cli.ts`:
    - Add an `ignore` subcommand:
      ```
      program
        .command('ignore <fingerprint>')
        .description('Add a fingerprint to the project-local allowlist')
        .action(async (fingerprint: string) => {
          const { runIgnore } = await import('./install/ignore.js')
          await runIgnore({ fingerprint })
        })
      ```
    - Confirm the existing entrypoint guard wraps `parseAsync`.

    Step 4 — `src/doctor/version-check.ts`:
    - Locate the version-comparison logic. Update the green threshold to `>= 2.1.121`.
    - Update the yellow message to include the `updatedToolOutput requires >= 2.1.121` text.
    - Preserve the not-found / red classification logic.

    Step 5 — `tests/cli/ignore.test.ts` (~5 tests):
    1. New config.toml: tmp cwd with no `.mrclean/`; runIgnore creates `.mrclean/config.toml` containing the fingerprint.
    2. Existing config.toml with no allowlist: tmp cwd with `.mrclean/config.toml` containing only `dry_run = false`; runIgnore appends the allowlist section without losing `dry_run`.
    3. Existing config.toml with allowlist.fingerprints=['existing']: runIgnore appends 'newfp' → result file parses to allowlist.fingerprints=['existing','newfp'].
    4. Idempotent: runIgnore('existingfp') against a config that already lists it → no-op; file unchanged (byte-compare).
    5. Invalid fingerprint shape: runIgnore('not-a-fingerprint') → exit(2) with stderr error.

    Optionally extend tests/doctor/version-check.test.ts (existing from Phase 1) with 2 new cases:
    - 2.1.121 → green.
    - 2.1.120 → yellow with updatedToolOutput message.

    Run `npx vitest run tests/cli/ignore.test.ts tests/doctor/version-check.test.ts` — all pass.

    Commit as `feat(02-05): mrclean ignore subcommand + doctor 2.1.121 floor bump`.
  </action>
  <verify>
    <automated>
      grep -cE "^export async function runIgnore|^export async function appendFingerprintToConfig" src/install/ignore.ts &&
      grep -c "'ignore" src/cli.ts &&
      grep -c "2.1.121" src/doctor/version-check.ts &&
      npx vitest run tests/cli/ignore.test.ts tests/doctor/version-check.test.ts 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      git log -1 --format=%s | grep -E "^feat\(02-05\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - `src/install/ignore.ts` exports `runIgnore` and `appendFingerprintToConfig`.
    - `src/cli.ts` registers the `ignore <fingerprint>` subcommand.
    - `src/doctor/version-check.ts` references `2.1.121` (grep = 1+).

    Behavior assertions:
    - All 5 ignore tests pass.
    - Doctor classifies 2.1.121 → green; 2.1.120 → yellow.
    - Idempotency proven by byte-compare in test 4.
    - Invalid fingerprint shape fails-closed (exit 2).

    Commit assertion:
    - `git log -1 --format=%s` matches `^feat\(02-05\)`.
  </acceptance_criteria>
  <done>`mrclean ignore <fingerprint>` works idempotently against fresh or existing config.toml files; doctor reports yellow for Claude Code versions < 2.1.121; CFG-04 + version-floor compatibility check delivered.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| stdin (Claude Code) → hook process | Hook input JSON arrives from a parent process; treat as untrusted. Existing Phase 1 stdin guards (timeout + JSON parse + crash guard) remain. |
| Hook output JSON → stdout (Claude Code) | The JSON we emit IS the model-facing instruction. A bug here can deny tool calls or, worse, leak the raw secret in `reason`. |
| `mrclean ignore` CLI → local config.toml | Operator-invoked; the fingerprint shape regex prevents arbitrary text from being injected into the config. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-05-01 | Information disclosure | The `reason` field in a `decision: 'block'` response is shown back to Claude (the model context). If `reason` accidentally includes the raw secret value, the secret leaks to the model. | mitigate | `reason` uses ONLY `ruleId + severity + offset + placeholder` — verified by integration test 1 (assert `reason` does NOT contain the original fixture value). |
| T-02-05-02 | Information disclosure | `additionalContext` likewise must not contain raw secret. | mitigate | Same construction rule; integration test asserts placeholders, not raw values. |
| T-02-05-03 | Tampering | `updatedInput` substitution corrupts a non-string field of `tool_input` (e.g., a numeric `count` field) | mitigate | The deep-substitute helper ONLY rewrites string-typed leaves (Pitfall #4 from RESEARCH); non-string fields pass through untouched. Integration test 7 verifies a multi-field tool_input. |
| T-02-05-04 | Spoofing | A malicious prompt contains a placeholder-shaped string like `<MRCLEAN:AWS_KEY:001>`, fooling downstream tooling. | accept | Phase 2 does not defend against placeholder-shape collisions in untrusted input. The audit log does NOT lie (the placeholder was never allocated for that token). Defense is purely informational. Documented limitation. |
| T-02-05-05 | DoS | A prompt with 100,000 small high-entropy tokens overruns the placeholder counter and floods stderr with overflow warnings | mitigate | PlaceholderManager emits the overflow warning ONCE per session (Plan 02-03 — `overflowed` flag). Subsequent overflows use OVF placeholder silently. |
| T-02-05-06 | Information disclosure | A budget-exhausted response on UserPromptSubmit also includes the raw text in `reason` | mitigate | The budget-exhausted message is STATIC: `[mrclean] detection budget exhausted (5 pattern timeouts) — prompt blocked for safety` — contains no input data. Verified by inspection in the integration test. |
| T-02-05-07 | Information disclosure | `mrclean ignore` accepts an arbitrary string as fingerprint and writes it into config.toml; an attacker who controls the CLI can inject TOML | mitigate | Fingerprint regex `/^[a-z0-9:_.-]+:[0-9a-f]{16}$/i` rejects anything that isn't shaped like a fingerprint. Even if bypassed, the operator's own config.toml is the surface — out-of-process trust boundary. |
| T-02-05-08 | Repudiation | `mrclean ignore` modifies `config.toml` without a marker; an audit of who-added-what is hard. | accept | Operator owns their config; v1 does not log ignore actions to a separate audit trail. Documented as a v1 limitation. |
| T-02-05-09 | Tampering | The deep-substitute helper enters an infinite loop on a cyclic `tool_input` object. | mitigate | Use `JSON.stringify`-based cycle detection OR limit recursion depth to 32. Document the limit in code. |
</threat_model>

<verification>
- All Layer 1..4 tests + Plan 02-04 tests still pass after this plan's changes (no regressions).
- Plan 02-05 tests (handlers-detection + integration-detection + ignore + version-check) all pass.
- `node dist/cli.js hook` invoked via `spawnSync` with the AWS-fixture UserPromptSubmit payload returns exit 0, stdout JSON contains `decision: 'block'`.
- Long-form banner appears as `mrclean active v0.1.0 (rules: NNN, allowlist: M, mode: active)` where NNN matches `getRuleCount().total`.
- Phase 1 fail-closed contract still holds: malformed stdin → exit 2.
- `mrclean ignore <fp>` idempotency proven by byte-identical file output on second invocation.
- Doctor version-check correctly classifies 2.1.121 (green) and 2.1.120 (yellow).
- `grep -rE "permissionDecision.*block" src/hook/handlers/user-prompt-submit.ts` returns 0 — UserPromptSubmit uses `decision`, NOT `permissionDecision`.
</verification>

<success_criteria>
- HOOK-02: UserPromptSubmit CRITICAL/HIGH → `{ decision: 'block', reason: ... }` at top level (RESEARCH-corrected shape).
- HOOK-03: PreToolUse → `hookSpecificOutput.updatedInput` carrying the complete tool_input with substitutions.
- HOOK-04: PostToolUse → `hookSpecificOutput.updatedToolOutput` (CC v2.1.121+).
- CFG-04: `mrclean ignore <fingerprint>` appends to project allowlist idempotently.
- HOOK-07 long-form banner emitted at SessionStart and first UserPromptSubmit.
- dry_run honored across all three event handlers.
- Detection-budget bail-out translates to deny on UserPromptSubmit + PreToolUse; logs-and-passes on PostToolUse.
- Doctor surfaces a yellow warning for Claude Code < 2.1.121.
</success_criteria>

<output>
After completion, create `.planning/phases/02-live-redaction-layers-1-4-one-way/02-05-SUMMARY.md` documenting:
- Each handler's behavior matrix (no findings / MEDIUM / HIGH / dry_run / budget-exhausted).
- The deep-substitute helper for `updatedInput`.
- The buildBanner format with live ruleCount + allowlistCount + mode.
- The mrclean ignore subcommand + smol-toml stringify availability outcome (text-append or stringify).
- The doctor version-floor bump rationale.
- Any pitfalls encountered while wiring (especially RESEARCH OQ A3 — worker_threads in the bundle, which Plan 02-01 already verified).
</output>
