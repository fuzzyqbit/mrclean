# Deferred Items — Phase 07

Out-of-scope discoveries logged during execution. NOT fixed here (scope boundary:
only auto-fix issues directly caused by the current task's changes).

## Pre-existing typecheck errors (discovered during 07-02, NOT introduced by it)

`npm run typecheck` reports these errors in test files unrelated to the 07-02
bestEffort change. They predate this plan (the 07-02 edits to check.ts/redact.ts and
their tests are type-clean). Listed here so a future plan can address the project-wide
test typecheck debt:

- `tests/hook/handlers-detection.test.ts` — `SessionState.envBlocklist` mocks use a bare
  `Map` missing the required `meta` field; several `ResolvedFinding` mocks omit `source`
  and `runDetection` mocks omit `nerStatus`.
- `tests/mcp/redact.test.ts:240` — the pre-existing **T5 budgetExhausted** mock of
  `runDetection` omits the required `nerStatus` field on `DetectionResult` (added in 06-03).
  The two new 07-02 mocks (T7) DO include `nerStatus`. T5 untouched by 07-02.
- `tests/install/idempotency.test.ts` — `Object is possibly 'undefined'` on `firstArg`.
- `tests/mcp/server-ner-preload.test.ts:93` — parameter `c` implicitly `any`.
- `tests/shared/sanitize-output.test.ts:13` — imports a missing module
  `../../src/shared/sanitize-output.js`.

These do not affect the runtime build or the 07-02 test outcomes (the relevant Vitest
suites pass). They are project-wide test-typing debt, deferred per the executor scope boundary.
