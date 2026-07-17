---
phase: 09-session-state-adapter
plan: 06
subsystem: state
tags: [session-lifecycle, ttl-sweep, janitor, node-fs, reversible-mode, fail-toward-privacy]

# Dependency graph
requires:
  - phase: 09-01
    provides: config.reversible.ttl_hours knob (integer >= 1, default 24) on the effective config
  - phase: 09-03
    provides: statePaths/keyPathFor/mapPathFor path helpers (every janitor delete target derives from them)
  - phase: 09-02
    provides: SESSION_ID_RE / isValidSessionId sid allowlist (Pitfall 5 gate)
provides:
  - src/state/janitor.ts — runSessionEndJanitor (D-06 reason allowlist) + runTtlSweep (D-07 orphan sweep), total-error, clock/baseDir injectable, ORPHAN_GRACE_MS=60s
  - SessionEnd handler wired: lazy-imported swallow-and-audit janitor call (Phase 8 no-op replaced)
  - SessionStart hook: gated non-fatal TTL sweep after config load (rethrow contract untouched)
  - MCP-server boot: second TTL sweep site (headless sessions never fire SessionEnd, E5)
affects: [09-07 import-graph cold-path test, 09-08, phase-10 restore CLI]

# Tech tracking
tech-stack:
  added: []
  patterns: [retention-as-allowlist (reason === 'resume' only), key-before-map delete ordering, map-mtime-only TTL aging, total-error janitor (per-target try/catch + hash-only stderr warn), abort-sweep-on-unreadable-dir]

key-files:
  created:
    - src/state/janitor.ts
    - tests/state/janitor.test.ts
    - tests/hook/session-end.test.ts
  modified:
    - src/hook/handlers/session-end.ts
    - src/hook/handlers/session-start.ts
    - src/mcp/server.ts
    - tests/hook/handlers.test.ts
    - tests/hook/dispatcher.test.ts

key-decisions:
  - "bypass_permissions_disabled resolves to the DELETE side of D-06 — documented reason, not in the ['resume'] allowlist (Phase 8 JSDoc note closed)"
  - "Unreadable state dir aborts the whole sweep (warn + return): classifying against an unreadable dir would misread live pairs as orphans and delete their keys"
  - "Missing keys/ or sessions/ dir returns silently per the pinned interface — even an old orphan map survives that degenerate layout"
  - "ENOENT on unlink is success-equivalent (no warn noise): the janitor runs unconditionally at SessionEnd and deleting nonexistent files is a no-op"

patterns-established:
  - "Retention allowlist: retain on exactly reason === 'resume'; every other string (documented, bypass_permissions_disabled, unknown future) deletes — fail-toward-privacy"
  - "Key-before-map deletion order (D-05): dead ciphertext needs no lock; each delete individually isolated"
  - "Paired TTL aging by MAP mtime ONLY (Pitfall 4): key mtime never refreshes — a live session with an old key and fresh map survives"
  - "Sweep candidacy by name shape only: <uuid>.key / <uuid>.map / *.tmp — never delete what we did not create (T-09-06-06)"

requirements-completed: [REVMODE-07]

# Metrics
duration: 14min
completed: 2026-07-17
---

# Phase 9 Plan 06: Reason-aware SessionEnd janitor + TTL orphan sweep Summary

**Reason-aware janitor (retain only on 'resume', key-before-map deletes) plus map-mtime TTL sweep wired at SessionStart and MCP boot — REVMODE-07 complete**

## Performance

- **Duration:** 14 min
- **Started:** 2026-07-17T03:05:15Z
- **Completed:** 2026-07-17T03:19:30Z
- **Tasks:** 3 (RED, GREEN, REFACTOR-evaluated)
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments

- `src/state/janitor.ts` (304 lines): `runSessionEndJanitor` gates on `isValidSessionId` FIRST (invalid sid deletes nothing — Pitfall 5), retains only on `reason === 'resume'` (D-06 allowlist), and deletes KEY before MAP with per-target error isolation (D-05 — a stuck map cannot save the key). `runTtlSweep` classifies dir listings into paired/orphan-map/orphan-key/tmp candidates via the pure `classifySweepEntries` helper, ages paired sessions by MAP mtime ONLY (Pitfall 4), applies the 60s `ORPHAN_GRACE_MS` to unpaired halves and `sessions/*.tmp` litter, and only ever touches `<uuid>.key` / `<uuid>.map` / `*.tmp` names.
- SessionEnd handler: Phase 8 no-op replaced with unconditional, config-free, lazy-imported janitor call inside a total try/catch (D-08 — no exit-2 noise possible); JSDoc explicitly resolves `bypass_permissions_disabled` to the delete side.
- TTL sweep live at BOTH mandated sites: SessionStart (gated on `config.reversible.enabled`, try/catch around ONLY the sweep — the ConfigReadError rethrow contract is byte-untouched) and MCP-server boot (headless sessions never fire SessionEnd; MCP-lane fence kept — redact tool stays unwired from the store).
- 33 new tests (24 janitor + 9 session-end): 7-reason matrix with `bypass_permissions_disabled` and a fabricated future reason on the delete side, key-first ordering proven via undeletable-map (non-empty directory) observable, traversal/synthetic sid decoy survival, the load-bearing live-session case (48h-old key + fresh map survives ttlHours 24), ttl knob 24-vs-48, orphan grace both directions, tmp litter both directions, non-conforming-name immunity, missing-dir silence, unreadable-dir warn-and-bail with canary-key survival.

## Task Commits

Each task was committed atomically (TDD gate order):

1. **Task 1 (RED): failing janitor + session-end suites** - `eff2f67` (test)
2. **Task 2 (GREEN): janitor implementation + three call sites** - `7440960` (feat)
3. **Task 3 (REFACTOR): evaluated, no commit** — the pure `classifySweepEntries` extraction Task 3 contemplates already landed inside the GREEN commit; nothing further warranted ("commit only if changed").

## Files Created/Modified

- `src/state/janitor.ts` - Reason-aware SessionEnd delete + TTL sweep; total-error; exports `runSessionEndJanitor`, `runTtlSweep`, `ORPHAN_GRACE_MS`
- `tests/state/janitor.test.ts` - 24-case lifecycle contract suite (tmpdir baseDir, utimes-backdated mtimes, stderr spy)
- `tests/hook/session-end.test.ts` - 9-case handler contract via mocked `src/state/janitor.js` seam
- `src/hook/handlers/session-end.ts` - No-op body replaced with lazy-import + swallow-and-audit janitor call
- `src/hook/handlers/session-start.ts` - Step 1b gated non-fatal sweep inserted after config load (purely additive diff)
- `src/mcp/server.ts` - Boot-time gated non-fatal sweep between config load and session-state init
- `tests/hook/handlers.test.ts` - Config mock gains type-required `reversible` key (deviation, Rule 3)
- `tests/hook/dispatcher.test.ts` - Same mock fix

## Decisions Made

- `bypass_permissions_disabled` deletes: it is a documented reason (types.ts:76-78) but not `'resume'`, so the D-06 allowlist deletes map+key — stated explicitly in the new handler JSDoc, closing the Phase 8 "decide there" note.
- Unreadable (EACCES) state dir aborts the sweep after one warn: proceeding with partial visibility would misclassify live pairs as orphans and delete their keys out from under running sessions (canary-key test pins this).
- ENOENT during delete is silent success — the janitor runs unconditionally, and warning on every clean-exit-with-no-state session would be pure stderr noise.
- Missing keys/ or sessions/ dir returns silently per the pinned interface ("missing dirs => return"), pinned by test including the keys-missing/sessions-present degenerate case.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stale config mocks in existing hook suites lacked the type-required `reversible` key**
- **Found during:** Task 2 (GREEN — wiring the session-start sweep)
- **Issue:** `tests/hook/handlers.test.ts` and `tests/hook/dispatcher.test.ts` hand-roll `loadEffectiveConfig` mock objects (Phase 2 vintage) without `reversible`, which `MrcleanConfig` requires. The new pinned gate `if (config.reversible.enabled)` would TypeError on those mocks, failing SessionStart tests 7 and 11a.
- **Fix:** Added `reversible: { enabled: false, ttl_hours: 24 }` (the shipped default) to both mock objects — making the mocks honest to the type, with a 09-06 comment.
- **Files modified:** tests/hook/handlers.test.ts, tests/hook/dispatcher.test.ts
- **Verification:** Full tests/hook + tests/mcp unit suites green (92 tests); full `npm test` green (805 passed)
- **Committed in:** 7440960 (GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minimal additive mock fix required for the pinned call-site shape to hold against pre-Phase-9 test fixtures. No scope creep; `handlers-detection.test.ts` needed nothing (it spreads `DEFAULT_CONFIG`, which already carries `reversible`).

## Verification Evidence

- `npx vitest run tests/state/janitor.test.ts tests/hook/session-end.test.ts --project=unit` — 33/33 green
- `npx vitest run tests/hook tests/mcp --project=unit` — 15 files, 92 tests green
- `npm test` (all projects) — 805 passed, 14 skipped, 0 failed
- Differential typecheck: 38 errors before and after, `comm` diff empty both directions (zero new, zero resolved) against the documented 38-error baseline (deferred-items.md)
- grep gates: `await import('../../state/janitor.js')` present in session-end.ts:32 and session-start.ts:39; `await import('../state/janitor.js')` in mcp/server.ts:93; NO static `from '../../state/` in src/hook/handlers/; key unlink precedes map unlink in `runSessionEndJanitor` source order
- session-start.ts diff purely additive — `loadEffectiveConfig` line and its rethrow comment are untouched context lines
- Zero edits to tests/placeholder, tests/detect, tests/audit; dist/ rebuild (integration globalSetup) left uncommitted per worktree rules

## TDD Gate Compliance

- RED gate: `eff2f67` `test(09-06): add failing janitor + session-end suites` — both suites confirmed failing on absent module before implementation
- GREEN gate: `7440960` `feat(09-06): implement reason-aware janitor and TTL sweep at both sites` — all RED tests pass unmodified
- REFACTOR gate: evaluated, skipped with cause (extraction target already present in GREEN)

## Issues Encountered

None beyond the documented deviation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- REVMODE-07 is complete: reason-aware deletion live at SessionEnd, TTL sweep live at SessionStart + MCP boot, all failure-proof (SC4 realized). The requirement checkbox flip is left to the orchestrator (REQUIREMENTS.md is orchestrator-owned in this wave).
- 09-07's import-graph cold-path test can now assert: `src/hook/handlers/session-end.ts` reaches `src/state/janitor.ts` ONLY via dynamic import (grep-verified here in advance).
- Known coordination point: 09-05 (lock/transaction, concurrent wave sibling) also gates hook call sites on `config.reversible.enabled` — if it edits the same two test mocks, the merge conflict is a trivial identical-intent addition.

## Self-Check: PASSED

All claimed files exist on disk (janitor.ts, both test suites, session-end.ts, this SUMMARY); both task commits (`eff2f67`, `7440960`) present in git log.

---
*Phase: 09-session-state-adapter*
*Completed: 2026-07-17*
