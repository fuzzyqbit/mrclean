---
phase: 01-wired-skeleton
plan: 03
subsystem: hook
tags: [hook, stdin, stdout, fail-closed, tdd]
dependency_graph:
  requires: [01-01, shared/types.ts, shared/version.ts]
  provides: [src/hook/index.ts, src/hook/dispatcher.ts, src/hook/handlers/*, src/hook/stdin.ts, src/hook/failclosed.ts]
  affects: [dist/cli.js, operator-visible banner, HOOK-01, HOOK-05, HOOK-06, HOOK-07-phase1]
tech_stack:
  added: []
  patterns: [stdin-timeout-guard, fail-closed-exit-2, dispatcher-switch, additionalContext-banner]
key_files:
  created:
    - src/hook/stdin.ts
    - src/hook/failclosed.ts
    - src/hook/dispatcher.ts
    - src/hook/handlers/session-start.ts
    - src/hook/handlers/user-prompt-submit.ts
    - src/hook/handlers/pre-tool-use.ts
    - src/hook/handlers/post-tool-use.ts
    - tests/hook/stdin.test.ts
    - tests/hook/failclosed.test.ts
    - tests/hook/handlers.test.ts
    - tests/hook/dispatcher.test.ts
    - tests/hook/integration.test.ts
  modified:
    - src/hook/index.ts
decisions:
  - "Phase 1 short-form HOOK-07 banner: mrclean active v{VERSION} (no-op mode — detection not yet enabled)"
  - "Stdin timeout exits 0 silently on stall (Pitfall #4 — Windows/Git Bash pipe stall prevention)"
  - "MRCLEAN_TEST_THROW env var is a TEST-ONLY crash injection escape hatch in dispatcher.ts"
  - "tsx is used for child process scripts in failclosed tests (ESM + TS import resolution)"
  - "writeFailClosedError embeds stack as JSON string value — stays on one line due to JSON escape of newlines"
metrics:
  duration_seconds: 304
  completed_date: "2026-05-14"
  tasks_completed: 2
  files_created: 13
  tests_added: 23
---

# Phase 1 Plan 3: Hook Handler — Summary

**One-liner:** Fail-closed stdin/stdout hook handler with 10s timeout guard, per-event dispatcher, and Phase 1 short-form "mrclean active" wiring banner via `additionalContext`.

## What Was Built

### Phase 1 Short Banner String (LOCKED)

```
mrclean active v0.1.0 (no-op mode — detection not yet enabled)
```

Emitted via `hookSpecificOutput.additionalContext` for both `SessionStart` and `UserPromptSubmit` events. This is the operator-visible wiring proof for Phase 1.

### HOOK-07 Phase 1 Scope Divergence (Documented)

REQUIREMENTS.md HOOK-07 specifies the long-form banner:
```
mrclean active vN.N.N (rules: NNN, allowlist: NN)
```

Phase 1 deliberately delivers the **short form** — rule/allowlist counts cannot be computed until Phase 2 ships the detection engine (Layers 1–4, DET1-01..DET4-03) and the config-driven allowlist (CFG-02).

**The wiring-signal intent of HOOK-07 IS satisfied in Phase 1** — the operator sees an operator-visible banner so silent-misconfig is impossible. Only the format string is reduced.

**Phase 2 action:** Swap the `PHASE1_BANNER` constant in both `session-start.ts` and `user-prompt-submit.ts` for the long-form banner once detection ship and allowlist counts are available at hook startup.

verify-phase MUST NOT flag HOOK-07 as failing on the missing rule/allowlist counts — this is a documented Phase 1 scope reduction, not a gap.

### Four Event Handlers (Phase 1 no-op behavior)

| Event | Handler | Phase 1 Output |
|-------|---------|----------------|
| `SessionStart` | `session-start.ts` | `{ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: PHASE1_BANNER } }` |
| `UserPromptSubmit` | `user-prompt-submit.ts` | `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: PHASE1_BANNER } }` |
| `PreToolUse` | `pre-tool-use.ts` | `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }` |
| `PostToolUse` | `post-tool-use.ts` | `null` (pass-through — no stdout write) |

### Stdin Timeout (10s) and Rationale

Value: **10,000ms**

Rationale (Pitfall #4, RESEARCH.md §8.2): On Windows/Git Bash, stdin pipes can stall when Claude Code has a slow pipe or the operating system delays the `end` event. A 10s timeout that exits 0 silently prevents the hook from hanging until Claude Code's 600s session timeout kills it with a visible error. This is the same value used in the production GSD hook infrastructure (`gsd-context-monitor.js`, issues #775, #1162).

A `StdinTimeoutError` is thrown on timeout; `runHook` catches it specifically and exits 0 (not 2) to avoid false-positive blocking.

### RESEARCH Pitfalls Defended

| Pitfall | Status |
|---------|--------|
| Pitfall #2: banner-to-stderr for SessionStart | DEFENDED — banner goes through `additionalContext` in JSON stdout, never to stderr |
| Pitfall #4: stdin pipe stall on Windows/Git Bash | DEFENDED — 10s timeout exits 0 silently |
| Fail-closed exit 2 on uncaught exception (HOOK-05) | DEFENDED — `installCrashGuards` wires both `uncaughtException` and `unhandledRejection` |

### MRCLEAN_TEST_THROW Escape Hatch

`src/hook/dispatcher.ts` contains a TEST-ONLY crash injection point:

```typescript
// TEST-ONLY: synthetic crash injection for integration test 7
if (process.env['MRCLEAN_TEST_THROW']) {
  throw new Error('synthetic mrclean crash')
}
```

This is documented with a `TEST-ONLY` comment. It MUST NOT be set in production. It is used exclusively by `tests/hook/integration.test.ts` Test 7 to verify that the fail-closed crash guards (exit 2 + structured stderr) fire correctly for dispatcher-level crashes.

## Tests

23 tests total (16 unit + 7 integration):

| File | Tests | What's Covered |
|------|-------|----------------|
| `tests/hook/stdin.test.ts` | 4 | Resolve on close, StdinTimeoutError, chunk accumulation, error class |
| `tests/hook/failclosed.test.ts` | 3 | uncaughtException→exit 2, unhandledRejection→exit 2, single-line stderr |
| `tests/hook/handlers.test.ts` | 4 | All four handlers with exact output assertions |
| `tests/hook/dispatcher.test.ts` | 5 | All four routes + unknown event throw |
| `tests/hook/integration.test.ts` | 7 | End-to-end against dist/cli.js binary |

Key implementation note: `tests/hook/failclosed.test.ts` uses `tsx` (not bare `node`) for child process scripts because ESM TypeScript files cannot be imported via `.js` extension by `node --input-type=module -e` alone.

## Acceptance Criteria Status

- [x] stdin reader: 10s timeout, structured error on timeout or malformed JSON
- [x] Dispatcher routes UserPromptSubmit + PreToolUse + PostToolUse + SessionStart
- [x] SessionStart + UserPromptSubmit emit Phase 1 short banner via `additionalContext`
- [x] Stdout is JSON-only (`grep -c 'console\.' src/hook/` returns 0)
- [x] PreToolUse/PostToolUse pass through with exit 0
- [x] PostToolUse returns null → empty stdout
- [x] Fail-closed: uncaught error → exit 2 with structured stderr (JSON error envelope)
- [x] Phase 1 HOOK-07 banner is SHORT — documented in SUMMARY as deliberate Phase 1 scope
- [x] All hook tests pass (23/23)
- [x] Round-trip wiring proof: `echo '...' | node dist/cli.js hook` → `hookSpecificOutput.additionalContext` starts with `mrclean active v`

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as specified.

### Implementation Notes

**tsx child process for failclosed tests:** The plan specified `child_process.spawnSync(process.execPath, ['-e', '...'])` for testing crash guards. Bare `node --input-type=module -e` cannot import TypeScript `.ts` files via `.js` extension aliases at runtime. The fix uses `tsx` (the project's dev-time TS runner) as the child process executor — same outcome, correct import resolution. This is a test-infrastructure-only deviation; no production code was changed.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. This plan implements an in-process stdin/stdout handler with no I/O beyond `process.stdin`, `process.stdout`, and `process.stderr`.

## Known Stubs

None — Phase 1 no-op behavior is intentional and fully documented. The "no-op mode" string in the banner is the stub marker. Phase 2 will replace the banner and wire in real detection.
