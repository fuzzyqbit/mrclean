---
phase: 09-session-state-adapter
plan: 01
subsystem: config
tags: [toml, smol-toml, proper-lockfile, write-file-atomic, config-validation, tdd]

# Dependency graph
requires:
  - phase: 08-contract-verification-reversible-plumbing
    provides: "[reversible] config table with fail-closed validateReversibleConfig (08-01) and true-partial merge semantics (08-07 / CR-01)"
provides:
  - "proper-lockfile@^4.1.2 + write-file-atomic@^7.0.1 in dependencies, @types/proper-lockfile@^4.1.4 in devDependencies (supply-chain gated, T-09-SC)"
  - "[reversible].ttl_hours config knob: fail-closed validated (integer >= 1), true-partial layered, per-field merged, default 24 (D-09)"
  - "MrcleanReversibleConfig/Layer widened with ttl_hours (required on effective, optional on layer)"
affects: [09-03, 09-05, 09-06, session-state, janitor, operator-restore]

# Tech tracking
tech-stack:
  added: ["proper-lockfile@^4.1.2", "write-file-atomic@^7.0.1", "@types/proper-lockfile@^4.1.4"]
  patterns:
    - "Per-field ?? accumulation for [reversible] merge (guarded by layer.reversible !== undefined; new object, never a layer alias)"
    - "Conditional-spread true-partial validator return for multi-key [reversible] (validatePiiNerConfig idiom)"

key-files:
  created: []
  modified:
    - package.json
    - package-lock.json
    - src/shared/types.ts
    - src/config/index.ts
    - src/config/defaults.ts
    - tests/config/reader.test.ts
    - tests/config/merge.test.ts

key-decisions:
  - "write-file-atomic PINNED at ^7.0.1 — v8 engines (^22.22.2 || ^24.15.0 || >=26) break the Node >=20.18.0 floor; rationale recorded in the dep-install commit for renovate/dependabot paper trail"
  - "Differential typecheck gate applied against the ACTUAL 38-error base set (36 documented + 2 pre-existing transformers type-drift errors in src/model/pipeline-singleton.ts) — drift logged to deferred-items.md, not fixed (scope boundary)"
  - "Test F expectation widened to { enabled: false, ttl_hours: 24 } — plan-driven consequence of the default-shape change, updated in the GREEN commit"

patterns-established:
  - "Per-field last-wins-when-set for [reversible]: enabled/ttl_hours each independently keep the accumulated value unless a layer sets them"
  - "toStrictEqual for true-partial layer assertions (fails on undefined-assigned keys, unlike toEqual)"

requirements-completed: [REVMODE-02, REVMODE-07]

# Metrics
duration: 13min
completed: 2026-07-17
---

# Phase 9 Plan 01: Deps + [reversible].ttl_hours Summary

**Pinned Phase 9 runtime deps (proper-lockfile ^4.1.2, write-file-atomic ^7.0.1 — v8 floor-break guarded) installed, and [reversible] widened with fail-closed ttl_hours (integer >= 1, default 24, per-field true-partial merge) via TDD**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-07-17T02:31:12Z
- **Completed:** 2026-07-17T02:44:30Z
- **Tasks:** 2 (Task 2 TDD: RED + GREEN commits)
- **Files modified:** 7

## Accomplishments

- Three supply-chain-gated packages installed at exact pinned ranges in the correct sections; lockfile committed; suite stayed at the 642/14 baseline post-install
- `[reversible].ttl_hours` lands as the ONLY new config key this phase (D-09): rejected fail-closed unless integer >= 1 (reason names the file and the exact bound), true-partial at the layer level, per-field last-wins-when-set at merge, default 24
- 8 new behavior tests (5 validator, 3 merge/default) following the shipped Test B/C/G/I shapes with AAA comments; full suite now 650 passed / 14 skipped
- Differential typecheck gate: post-change error set byte-identical to the base set (zero new errors)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install pinned deps** - `37d71d1` (chore) — wfa ^7 pin rationale recorded in the commit body
2. **Task 2: Widen [reversible] with ttl_hours (TDD)**
   - RED: `badabf9` (test) — 7 failing behavior tests + 1 regression mirror
   - GREEN: `1f7d04a` (feat) — types, validator, merge, defaults; all 59 config tests green
   - REFACTOR: not needed — implementation follows the shipped validatePiiNerConfig / pii-merge idioms exactly

## TDD Gate Compliance

- RED gate: `badabf9` `test(09-01)` — verified 7 failed / 52 passed before implementation
- GREEN gate: `1f7d04a` `feat(09-01)` — verified 59/59 config, 650/14 full suite
- Note: Test P (unknown-keys-only table parses to `{}`) passes at RED **by design** — it is the plan-specified Test C/I regression mirror guarding the new conditional-spread return path, not a new behavior.

## Files Created/Modified

- `package.json` / `package-lock.json` - proper-lockfile ^4.1.2 + write-file-atomic ^7.0.1 (deps), @types/proper-lockfile ^4.1.4 (devDeps)
- `src/shared/types.ts` - MrcleanReversibleConfig gains required `ttl_hours: number`; Layer gains optional; Phase-9-ownership JSDoc updated to "landed"
- `src/config/index.ts` - validateReversibleConfig ttl_hours clause (RESEARCH Code Example 5) + conditional-spread return; mergeConfigs per-field `??` accumulation seeded from both DEFAULT_CONFIG.reversible fields
- `src/config/defaults.ts` - frozen reversible sub-object gains `ttl_hours: 24` with D-09 comment
- `tests/config/reader.test.ts` - Tests L/M/N (fail-closed 0 / "24" / 1.5), O (true partial { ttl_hours: 48 }), P (unknown-keys mirror)
- `tests/config/merge.test.ts` - Tests Q (default { enabled: false, ttl_hours: 24 } via loadEffectiveConfig), R (partial project table never resets user fields), S (last-wins-when-set); Test F expectation widened to the new default shape

## Decisions Made

- write-file-atomic stays at ^7.0.1 (v8 engines break the Node 20 floor) — commit body carries the guard rationale
- Differential typecheck gate re-anchored on the measured 38-error base set at b5a16b0 (fresh-install transformers type drift added 2 pre-existing errors over the documented 36) — logged to `deferred-items.md`, not fixed (scope boundary)
- Test 8 (last-wins) uses ttl-only layers on both sides so the enabled field independently proves untouched-default behavior in the same assertion

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Planned-behavior consequence] Test F expectation widened to the new default shape**
- **Found during:** Task 2 (GREEN)
- **Issue:** Test F asserted `result.reversible` toEqual `{ enabled: false }`; the plan's default-shape change (ttl_hours: 24 joins the frozen default) makes the merged default `{ enabled: false, ttl_hours: 24 }`, failing the stale expectation
- **Fix:** Expectation updated to `{ enabled: false, ttl_hours: 24 }` with a 09-01 provenance comment — exactly the "newly-surfaced sites" class the plan action anticipated
- **Files modified:** tests/config/merge.test.ts
- **Verification:** Full suite green (650/14)
- **Committed in:** 1f7d04a (GREEN commit)

### Out-of-scope discoveries (logged, NOT fixed)

**2. [Scope boundary] Typecheck baseline drift 36 → 38 (pre-existing)**
- **Found during:** Task 2 baseline capture (before any edit)
- **Issue:** 2 errors in `src/model/pipeline-singleton.ts` (unused @ts-expect-error + DType union mismatch) beyond the documented 36 — caused by fresh-install resolution of `@huggingface/transformers` ^4.2.0 to a newer minor with a changed type surface
- **Disposition:** Logged to `.planning/phases/09-session-state-adapter/deferred-items.md`; differential gate applied against the actual 38-error set (post-change set byte-identical)

---

**Total deviations:** 1 auto-fixed (planned-behavior test expectation), 1 logged out-of-scope
**Impact on plan:** No scope creep; all changes within planned files.

## Issues Encountered

- Fresh worktree had no node_modules — the Task 1 install created the full tree (expected in worktree isolation; dist/ rebuilds by the integration globalSetup were left uncommitted per repo precedent: the orchestrator regenerates dist post-merge)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `write-file-atomic` ready for 09-03 (atomic ciphertext writes), `proper-lockfile` ready for 09-05 (allocate-and-persist lock), `reversible.ttl_hours` ready for the 09-06 janitor (its first consumer — the knob is validated and merged but intentionally unread until then)
- Config surface for Phase 9 is now frozen per D-09: no further [reversible] keys this phase
- Differential typecheck base for later 09-xx plans: the 38-error set at b5a16b0 (see deferred-items.md)

## Self-Check: PASSED

- FOUND: package.json deps at pinned ranges (field check + npm ls 4.1.2 / 7.0.1)
- FOUND: src/config/index.ts ttl_hours clause (1 source line with the exact reason)
- FOUND: src/config/defaults.ts ttl_hours: 24
- FOUND: commits 37d71d1, badabf9, 1f7d04a on worktree-agent-a1a2a5bfa04409728
- PASSED: 650/14 full suite; 59/59 tests/config; zero new typecheck errors; tests/placeholder tests/detect tests/audit byte-identical

---
*Phase: 09-session-state-adapter*
*Completed: 2026-07-17*
