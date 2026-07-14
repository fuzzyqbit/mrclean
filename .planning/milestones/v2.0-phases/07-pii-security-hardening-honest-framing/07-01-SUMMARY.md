---
phase: 07-pii-security-hardening-honest-framing
plan: 01
subsystem: testing
tags: [pii, security, sanitization, audit-log, vitest, fail-closed, ner]

# Dependency graph
requires:
  - phase: 02-detection-core
    provides: Finding interface + redactedHash + assertNoCanaryLeak audit-safe primitives
  - phase: 03-mcp-surface
    provides: supervisedToolCall discriminated-union API + writeFailClosedError stderr writer
  - phase: 06-pii-ner
    provides: Layer 6b NER fail-closed contract (getNerPipeline / pipe boundaries)
provides:
  - "sanitizeForOutput() — single no-raw error/diagnostic chokepoint (two-mode: with-context scrub + context-free static)"
  - "supervisor.ts + failclosed.ts error sinks routed through the chokepoint (D-03/D-04)"
  - "PII leak-grep regression proof split across both vitest projects (audit.jsonl integration + stderr unit)"
  - "wired integration include so the audit.jsonl leak proof actually runs (non-vacuous)"
affects: [audit, mcp, hook, future-pii-phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-locked-sink chokepoint with greppable LOCKED comment (mirrors findingToAuditRecord)"
    - "Two-mode sanitizer: with-context literal scrub (ReDoS-free split/join) vs context-free static message"
    - "Leak-proof split across vitest projects so a file belongs to exactly one (non-vacuity gate)"

key-files:
  created:
    - src/shared/sanitize-output.ts
    - tests/audit/pii-canary-leak.test.ts
    - tests/audit/pii-stderr-leak.test.ts
  modified:
    - src/mcp/supervisor.ts
    - src/hook/failclosed.ts
    - vitest.config.ts
    - tests/hook/failclosed.test.ts
    - tests/mcp/supervisor.test.ts
    - tests/hook/integration.test.ts

key-decisions:
  - "Context-free chokepoint returns a STATIC payload-independent message — pre-parse failures have no spans to scrub, so echoing the raw message is unsafe (D-04)"
  - "failclosed drops raw err.stack entirely and redacts the echoed reason field, replacing both with static markers to preserve payload shape"
  - "Leak-encoding tests (failclosed/supervisor/integration) were updated to assert the no-leak contract — they previously asserted raw throw text pass-through"
  - "Rebuilt + committed dist/cli.js + dist/mcp.js so the shipped git-clone plugin stays in sync with the chokepoint source"

patterns-established:
  - "Pattern: every error/diagnostic string crossing to stderr/MCP text passes through sanitizeForOutput (LOCKED invariant, enforced by leak-grep tests)"
  - "Pattern: cold-path/hot-path fence — the chokepoint imports only redactedHash/types, no engine/ML, never on the <100ms hook gate"

requirements-completed: [PIISEC-01]

# Metrics
duration: 13min
completed: 2026-06-03
---

# Phase 7 Plan 01: PII Leak Hardening + Error Chokepoint Summary

**Single `sanitizeForOutput()` chokepoint scrubs detected PII from error/diagnostic output (with-context) and emits static safe messages (context-free, D-04); supervisor + failclosed error sinks routed through it; and a two-project leak-grep proof shows no synthetic PII canary reaches audit.jsonl (integration, non-vacuous) or stderr (unit, three forced-failure paths).**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-06-03T20:06:00Z
- **Completed:** 2026-06-03T20:19:53Z
- **Tasks:** 3
- **Files modified:** 11 (3 created, 8 modified incl. rebuilt dist)

## Accomplishments
- `sanitizeForOutput()` — the single no-raw chokepoint: with-context mode literal-replaces each raw `value` with its `redactedHash` (ReDoS-free split/join, reusing the existing hash — never re-hashing); context-free mode returns a static, payload-independent message that never echoes input. LOCKED invariant comment + cold-path fence (no engine/ML imports).
- Both known raw-error leak vectors routed through the chokepoint: `supervisedToolCall` (context-free, the error flows into MCP tool text) and `writeFailClosedError` (the prime D-04 pre-parse vector — message scrubbed, raw `err.stack` dropped, echoed `reason` redacted), with the single-line-JSON and discriminated-union contracts preserved.
- Leak proof split across both vitest projects: an INTEGRATION test feeds a synthetic PII canary corpus through the full NER-on pipeline and asserts `assertNoCanaryLeak` on `.mrclean/audit.jsonl` plus a non-empty line-count guard; a UNIT test (model-free, mocked NER) asserts no canary reaches stderr across three forced-failure paths.
- Wired the integration `include` allow-list so the audit.jsonl proof actually runs — **non-vacuity verified concretely** (see below).

## Task Commits

1. **Task 1: sanitizeForOutput() chokepoint** — RED `664483f` (pre-seeded at plan base, `test`) → GREEN `cb4795b` (`feat`). No REFACTOR needed (file ~85 lines, helper already extracted).
2. **Task 2: Route supervisor + failclosed through chokepoint** — `71948df` (`fix`)
3. **Task 3: Split leak proof across both vitest projects + wire include** — `98d2404` (`test`)
4. **dist rebuild** — `31c3cf7` (`chore` — regenerated committed plugin artifacts)

_TDD gates satisfied: `test(07-01)` RED commit (`664483f`) precedes the `feat(07-01)` GREEN commit (`cb4795b`); Task 3's `test(07-01)` commit is the leak-proof RED step._

## Files Created/Modified
- `src/shared/sanitize-output.ts` — single no-raw chokepoint (two-mode), reuses `redactedHash`, LOCKED comment, cold-path fence
- `tests/audit/pii-canary-leak.test.ts` — integration audit.jsonl leak proof (full NER-on pipeline + line-count guard)
- `tests/audit/pii-stderr-leak.test.ts` — unit stderr leak proof (3 forced-failure paths, mocked NER)
- `src/mcp/supervisor.ts` — catch routes through `sanitizeForOutput` (context-free) before returning `{ ok:false, error }`
- `src/hook/failclosed.ts` — message scrubbed, raw stack dropped, reason redacted; single-line-JSON preserved
- `vitest.config.ts` — `pii-canary-leak` added to integration `include` AND unit `exclude` (file belongs to exactly one project)
- `tests/hook/failclosed.test.ts`, `tests/mcp/supervisor.test.ts`, `tests/hook/integration.test.ts` — assertions updated to the no-leak contract
- `dist/cli.js`, `dist/mcp.js` — rebuilt to ship the chokepoint

## Decisions Made
- **Context-free static message:** pre-parse failures carry no detection spans, so the chokepoint returns a fixed `mrclean: an internal error occurred; details withheld...` string rather than risk echoing unparsed PII (D-04).
- **Drop raw stack + redact reason:** `writeFailClosedError` now writes `stack: 'redacted'` and `reason: 'redacted'` markers instead of the raw values, preserving payload shape while closing the leak.
- **Rebuild + commit dist:** the repo ships `dist/cli.js`/`dist/mcp.js` for git-clone plugin installs, so they were regenerated to stay in sync (committed separately as a chore).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Leak-encoding tests asserted the raw-throw-text pass-through contract**
- **Found during:** Task 2 (routing supervisor + failclosed)
- **Issue:** `tests/hook/failclosed.test.ts` (Tests 4/5/6), `tests/mcp/supervisor.test.ts` (sync/async throw), and `tests/hook/integration.test.ts` (Test 7) asserted that raw error text (`'boom'`, `'async-boom'`, `'synthetic'`, `'x'`) appears verbatim in stderr / the returned error — i.e. they encoded the exact leak the chokepoint closes. Left unchanged they would fail against the now-safe contract.
- **Fix:** Updated each to assert the raw text is ABSENT and the message is the static safe string (and `stack`/`reason` are `'redacted'`). This makes the no-leak guarantee committed and re-runnable.
- **Files modified:** tests/hook/failclosed.test.ts, tests/mcp/supervisor.test.ts, tests/hook/integration.test.ts
- **Verification:** `npx vitest run tests/mcp tests/hook` → 89 passed.
- **Committed in:** 71948df (Task 2 commit)

**2. [Rule 3 - Blocking] Child-process tests could not resolve tsx in the worktree**
- **Found during:** Task 2 (running failclosed tests)
- **Issue:** `runInChildProcess` resolved the tsx CLI via the worktree-relative `../../node_modules/.bin/tsx`, which does not exist in a sparse git-worktree `node_modules` (no `.bin/`). `spawnSync` returned `status: null`, failing Tests 4 and 5 regardless of source correctness.
- **Fix:** Resolve tsx via `require.resolve('tsx/package.json')` (Node walks up to the parent repo) and derive `dist/cli.mjs`, then spawn it through `process.execPath` so the `.mjs` CLI runs without an executable bit.
- **Files modified:** tests/hook/failclosed.test.ts
- **Verification:** `npx vitest run tests/hook/failclosed.test.ts` → 3 passed.
- **Committed in:** 71948df (Task 2 commit)

**3. [Rule 2 - Missing Critical] failclosed also echoed the raw `reason` field**
- **Found during:** Task 2 (failclosed edit)
- **Issue:** `installCrashGuards` passes `reason: String(reason)` (the stringified throw) in `context`, which was blind-spread into the stderr payload — a second copy of the raw error text beyond `message`/`stack`. The plan called out message + stack; the `reason` echo was an additional un-scrubbed surface.
- **Fix:** Destructure `reason` out of the spread and replace with a static `'redacted'` marker when present.
- **Files modified:** src/hook/failclosed.ts
- **Verification:** failclosed Test 5 asserts `parsed.reason === 'redacted'` and the raw `'async-boom'` is absent.
- **Committed in:** 71948df (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 1 blocking, 1 missing critical)
**Impact on plan:** All three were required to land the no-leak contract and run the proof. The test updates align the suite with the deliberate behavior change; no scope creep.

## Non-Vacuity Evidence (Task 3 acceptance)

**(a) INTEGRATION non-vacuity** — measured both ways:
- Include entry PRESENT: `npx vitest run --project=integration tests/audit/pii-canary-leak.test.ts` →
  `Test Files  1 passed (1)` / `Tests  2 passed (2)`.
- Include entry REMOVED (transient local check, NOT committed): same command →
  `No test files found, exiting with code 1` (with `filter: tests/audit/pii-canary-leak.test.ts`).
- Conclusion: the proof matches exactly one file only because of the wired include — it is not a silent zero-file pass. The removal was reverted (config restored from backup); both `pii-canary-leak` entries (integration include + unit exclude) are committed.

**(b) STDERR non-vacuity** — asserted INSIDE the committed unit test (re-runnable, not a manual revert):
- `pii-stderr-leak.test.ts` path (3) first asserts `rawError.message` DOES contain `'457-55-5462'` (proving the canary is present pre-chokepoint), then asserts the post-chokepoint `supervisedToolCall` error and captured stderr contain none of the four canaries. The absence assertion is therefore demonstrably load-bearing.
- All three forced-failure paths (model-load throw, inference throw, supervisor catch) are distinct `it(...)` blocks driven by a mocked NER pipeline singleton (no real model load).

## Verification Results
- `npx vitest run tests/shared/sanitize-output.test.ts` → 6 passed
- `npx vitest run tests/mcp tests/hook` → 89 passed (vectors routed, no API regression)
- `npm run build && npx vitest run --project=integration tests/audit/pii-canary-leak.test.ts` → 1 file, 2 passed (end-to-end audit.jsonl proof, non-vacuous)
- `npx vitest run --project=unit tests/audit/pii-stderr-leak.test.ts` → 3 passed (fast < 30s feedback signal)
- `grep -rn sanitizeForOutput src/mcp/supervisor.ts src/hook/failclosed.ts` → both vectors routed
- `grep -n pii-canary-leak vitest.config.ts` → integration include + unit exclude present

## Latency Note
The integration `<verify>` command runs `npm run build` (the integration project's globalSetup performs a tsup build) and therefore exceeds the < 30s VALIDATION feedback target — this is the accepted slower outer-loop / pre-commit gate. The fast inner-loop signal is `npx vitest run --project=unit tests/audit/pii-stderr-leak.test.ts` (model-free, no build), which completes in well under a second.

## Known Stubs
None — no placeholder/empty-data stubs introduced. The context-free static message is an intentional security design (D-04), not a stub.

## Threat Flags
None — no new network endpoints, auth paths, file-access patterns, or trust-boundary schema changes beyond the threat register already documented in the plan.

## Issues Encountered
- Worktree `node_modules` is sparse (no `.bin/`), breaking the child-process tsx spawn in `failclosed.test.ts`. Resolved via `require.resolve` + `process.execPath` (Deviation 2).

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- PIISEC-01 satisfied: the error/diagnostic surface is structurally no-raw and proven by a non-vacuous regression test. The chokepoint stays off the <100ms hook hot path.
- Remaining Phase 7 plans (07-02, 07-03) can build on the `sanitizeForOutput` chokepoint for any further error-surface hardening.

## Self-Check: PASSED
- Created files verified present: src/shared/sanitize-output.ts, tests/audit/pii-canary-leak.test.ts, tests/audit/pii-stderr-leak.test.ts
- Commits verified in git log: cb4795b (feat), 71948df (fix), 98d2404 (test), 31c3cf7 (chore)

---
*Phase: 07-pii-security-hardening-honest-framing*
*Completed: 2026-06-03*
