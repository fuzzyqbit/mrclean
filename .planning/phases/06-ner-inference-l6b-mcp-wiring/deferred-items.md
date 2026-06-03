# Phase 06 — Deferred Items

Out-of-scope discoveries logged during execution. NOT fixed in the originating plan
(SCOPE BOUNDARY rule — only auto-fix issues directly caused by the current task's changes).

## 06-01

### tests/hook/failclosed.test.ts — Test 4 & Test 5 fail with `expected null to be 2`

- **Found during:** Plan 06-01 Task 2 full-suite regression check.
- **Symptom:** `installCrashGuards > Test 4 (uncaughtException → exit 2)` and `Test 5
  (unhandledRejection → exit 2)` assert a spawned child process exits with code `2`, but the
  child's `status` is `null` (process did not exit normally / was killed).
- **Root cause (suspected):** the test uses `spawnSync(tsxBin, ...)` to launch a child TS script
  via `node_modules/.bin/tsx`; in this execution environment the child does not reach the
  `process.exit(2)` path (likely a tsx/spawn/sandbox interaction), yielding `status: null`.
- **Why deferred:** byte-identical to base commit `d7e58d2`; imports only
  `src/hook/failclosed.js` + `node:child_process` — NONE of the files touched by Plan 06-01
  (config defaults, shared types, NER modules). Pre-existing and unrelated to the NER work.
- **Recommended owner:** a hook/test-infra fix (verify tsx child-process exit semantics in CI),
  tracked separately from the Phase 6 NER lane.
