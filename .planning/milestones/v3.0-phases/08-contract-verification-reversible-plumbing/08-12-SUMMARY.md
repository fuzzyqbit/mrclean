---
phase: 08-contract-verification-reversible-plumbing
plan: 12
subsystem: install
tags: [install, zero-config, atomic-write, banner-honesty, tdd, gap-closure]

# Dependency graph
requires:
  - phase: 08-02
    provides: 5-event HOOK_EVENTS surface (SessionEnd added, SessionStart matcher widened) that the banner must honestly report
provides:
  - atomicWriteJson creates missing parent directories (recursive mkdir before tmp write) — every JSON writer is fresh-HOME safe
  - HOOK_EVENTS exported from settings.ts as the single source of truth for the registered hook surface
  - Install success banner hook count derived from HOOK_EVENTS.length (stale hardcoded literal gone)
  - tests/install/fresh-home.test.ts — fresh-HOME flow lock + banner-vs-ground-truth lock
affects: [09-session-state-adapter, install, doctor]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic JSON writers own parent-dir creation (mkdir recursive, no-op when present) — callers never pre-mkdir"
    - "User-facing counts derive from exported constants, test-locked to on-disk ground truth"

key-files:
  created:
    - tests/install/fresh-home.test.ts
  modified:
    - src/install/atomic-json.ts
    - src/install/settings.ts
    - src/install/index.ts
    - tests/install/atomic-json.test.ts
    - dist/cli.js
    - dist/mcp.js

key-decisions:
  - "mkdir placed BEFORE the try block in atomicWriteJson — no tmp file exists yet, so the catch/unlink cleanup contract is untouched"
  - "Fix landed inside atomicWriteJson (not at the settings-write call site) so every caller — settings.json, ~/.claude.json, future Phase 9 writers — is protected"
  - "Banner test asserts against on-disk _mrclean ground truth, not a literal 5 — survives future HOOK_EVENTS changes"

patterns-established:
  - "Fresh-HOME test fixture: beforeEach creates tempHome but deliberately NOT .claude (contrast idempotency.test.ts which pre-creates it and masked gap 1)"
  - "stdout spy with try/finally restore immediately after the awaited call — assertion failures render normally; vi.restoreAllMocks() in afterEach as rejection-path safety net"

requirements-completed: []  # REVMODE-07 NOT complete — installer-surface groundwork only; janitor + TTL sweep land in Phase 9 (traceability corrected post-verification)

# Metrics
duration: 8min
completed: 2026-07-17
---

# Phase 08 Plan 12: Zero-config Fresh-HOME Install + Honest Banner Summary

**Fresh-HOME `mrclean install` no longer crashes with a raw ENOENT stack (atomicWriteJson now mkdirs its parent chain) and the success banner reports `hooks: 5` derived from HOOK_EVENTS.length — both 08-UAT test-2 gaps closed and locked by 3 new TDD tests.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-17T00:35:38Z
- **Completed:** 2026-07-17T00:44:00Z
- **Tasks:** 2/2 (RED → GREEN + dist chore)
- **Files modified:** 7

## Accomplishments

- **UAT gap 1 (major) closed at both levels:** `atomicWriteJson` now runs `await mkdir(dir, { recursive: true })` before its tmp write — a fresh machine where `~/.claude` does not exist installs cleanly (zero-config first-run constraint restored). Locked by a missing-parent unit test AND a fresh-HOME `runInstall` flow test that asserts one `_mrclean` entry per each of the 5 events plus the `~/.claude.json` MCP entry.
- **UAT gap 2 (cosmetic) closed and future-proofed:** `HOOK_EVENTS` exported from settings.ts; the banner interpolates `HOOK_EVENTS.length` instead of the stale `hooks: 4` literal. The lock test parses the banner count and compares it to the count of `_mrclean`-tagged events actually written to settings.json (ground truth = 5) — a future HOOK_EVENTS change can never silently de-sync the banner again.
- **TDD discipline preserved:** RED commit (3 failing tests reproducing both UAT observations offline: 2× ENOENT, 1× 4-vs-5 assertion) → GREEN commit (three minimal src edits) → dist chore commit, with the full suite and the 36-error typecheck baseline both clean at the gate.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing tests reproducing both UAT test-2 defects** - `d0fdd6b` (test) — exactly 3 failed / 11 passed on the targeted run; only the two test files staged
2. **Task 2 (GREEN): mkdir in atomicWriteJson + banner from HOOK_EVENTS.length** - `73e006f` (feat) — only the three src files staged
3. **Task 2 (chore): dist rebuild** - `0c0a7f7` (chore) — `npm run build` from current src; absorbed and normalized the pre-existing uncommitted dist churn; `git status --porcelain dist/` empty afterwards

## Files Created/Modified

- `src/install/atomic-json.ts` - `mkdir` added to the fs/promises import; `await mkdir(dir, { recursive: true })` before the try block (tmp-write/rename/cleanup contract untouched); JSDoc documents the fresh-HOME rationale
- `src/install/settings.ts` - `HOOK_EVENTS` now exported; JSDoc notes it is the banner's single source of truth
- `src/install/index.ts` - imports `HOOK_EVENTS`; banner uses `` ` (hooks: ${HOOK_EVENTS.length}, MCP server: mrclean)` ``
- `tests/install/atomic-json.test.ts` - Test A: "creates missing parent directories before writing (fresh-HOME defense)"
- `tests/install/fresh-home.test.ts` - Tests B/C: fresh-HOME flow lock (no pre-created `.claude` in beforeEach) + banner-count-vs-ground-truth lock (pre-creates `.claude` inline to isolate gap 2 from gap 1)
- `dist/cli.js`, `dist/mcp.js` - rebuilt from current src (chore commit per repo convention)

## Verification Results

- Targeted integration run: 18/18 (atomic-json 12, fresh-home 2, idempotency 4); banner now prints `(hooks: 5, MCP server: mrclean)`
- Full regression: `npm test` exit 0 — 642 passed / 14 skipped (see Deviations for the plan's 641 expectation)
- Differential typecheck: 36 errors, per-file distribution identical to the deferred-items.md baseline (handlers-detection 22, idempotency 3, version-check 3, + 8 singletons); zero errors from the three touched src files or the two test files
- Comment-filtered grep gates: `HOOK_EVENTS.length` in index.ts = 1; stale `hooks: 4` = 0; `export const HOOK_EVENTS` = 1; `mkdir(dir, { recursive: true })` = 1
- dist gates: `hooks: 4` absent from dist/cli.js (0); mkdir call present (1); `git status --porcelain dist/` empty after chore commit

## Decisions Made

- mkdir goes inside `atomicWriteJson` (not the call site) so settings.json, `~/.claude.json` (mcp-config.ts), and future writers are all protected — matches the `ignore.ts:99` / `project-dir.ts:78` recursive-mkdir precedent
- Banner lock test compares parsed banner count to the on-disk `_mrclean` ground truth rather than a hardcoded 5, so the test survives (and enforces honesty across) future HOOK_EVENTS changes
- REFACTOR gate skipped per plan — three-line-scale edits, nothing emerged

## Deviations from Plan

**1. [Expectation drift — documented, nothing fixed] Full-suite count 642 vs the plan's expected 641**
- **Found during:** Task 2 (full regression gate)
- **Issue:** Plan expected 641 passed / 14 skipped (638-passed 08-11 baseline + 3 new tests). Actual: 642 passed / 14 skipped — the pre-plan passing baseline was 639, not 638.
- **Evidence it pre-dates this plan:** this plan's diff adds exactly 3 tests (targeted files went 11→12 and 0→2); no tests/, src/, or fixture commits exist between 08-11 completion and this plan (all interim commits are `.planning/`-only docs); the skip set is byte-identical at 14 (rules out a skip→pass flip from this plan's changes).
- **Disposition:** Gate substance holds — zero failures, no new skips, all 3 new tests green, exit 0. Recorded here so the next plan uses 642/14 as its baseline.

No other deviations — plan executed exactly as written. No auth gates encountered.

## TDD Gate Compliance

- RED gate: `d0fdd6b` `test(08-12): ...` — verified failing first (exactly 3 failed, for the diagnosed reasons: 2× ENOENT, 1× `expected 4 to be 5`)
- GREEN gate: `73e006f` `feat(08-12): ...` — after RED, all 3 tests green plus full suite
- REFACTOR gate: intentionally skipped (plan directive: three-line-scale edits)

## Next Phase Readiness

- Phase 9 session-state writers can rely on the atomic-write pattern being parent-dir-safe (`~/.mrclean/sessions/` may not exist on first reversible session)
- `HOOK_EVENTS` is now importable wherever the registered surface must be reported honestly (doctor already derives its own view; banner now matches)
- 08-UAT.md test 2 is re-testable: fresh-HOME install completes with the friendly banner `mrclean v1.0.0-rc.9 installed (hooks: 5, MCP server: mrclean)`

## Self-Check: PASSED

All 7 claimed files exist on disk; all 3 task commits (`d0fdd6b`, `73e006f`, `0c0a7f7`) present in git history.
