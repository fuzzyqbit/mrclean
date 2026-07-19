# Deferred Items — Phase 10

Out-of-scope discoveries logged by executors (scope boundary: not caused by the current plan's changes; do not fix in-plan).

## Pre-existing `npm run typecheck` errors (found during 10-07, present at base 880f55d)

Unrelated to 10-07's files (zero errors in `tests/state/cold-path.test.ts` / `tests/restore/mixed-canary.test.ts`):

- `tests/install/idempotency.test.ts(112,12)` / `(113,12)`: TS18048 `'binArg' is possibly 'undefined'`
- `tests/mcp/redact.test.ts(240,66)`: TS2345 — fixture object missing `nerStatus` required by `DetectionResult`
- `tests/mcp/server-ner-preload.test.ts(93,47)`: TS7006 — parameter `c` implicitly `any`

These files' suites pass at runtime; the errors are strict-mode typecheck drift. Candidates for a phase-11 chore or quick task.
