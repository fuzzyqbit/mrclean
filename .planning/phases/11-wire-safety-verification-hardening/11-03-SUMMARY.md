---
phase: 11-wire-safety-verification-hardening
plan: 03
subsystem: restore
tags: [typescript, session-index, collision-demote, hardening, tdd]

# Dependency graph
requires:
  - phase: 10-operator-restore
    provides: buildRestoreIndex union index + RestoreIndex shape (10-02), hand-built poisoned-map real-cipher fixture recipe, cold-path outbound allowlist fence (10-07 rule 3)
provides:
  - IN-02/AR-10-05 hardening — cross-session placeholder collisions demote to unmatched (sticky Set spanning the whole union build); an ambiguous token restores NOTHING, never last-write-wins
  - persistHandBuiltMap test helper — generalized 10-02 poisoned-map recipe (explicit placeholder strings, valid SessionMapV1 JSON, encrypted under REAL per-session keys)
  - collision test rows (demote, sticky third-occurrence, benign-duplicate control) pinning the demote contract
affects: [11-07 THREAT_MODEL finalization (AR-10-05 residual shrinks to documented note)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Demote-on-conflict with sticky demotion Set: ambiguous cross-session claims resolve to NOTHING (mirrors the OVF ambiguity treatment at the same fix site); a bare delete would let a third occurrence re-enter"
    - "Forced-collision fixtures REQUIRE the hand-built-map path: serializer-built fixtures embed per-map nonce8 via formatV2Token, so buildFixtureMap maps can never collide"

key-files:
  created: []
  modified:
    - src/restore/session-index.ts
    - tests/restore/session-index.test.ts

key-decisions:
  - "IN-02 describe block nested inside the existing top-level describe — reuses freshBaseDir/cleanupDirs/afterEach machinery instead of forking it (extend, never fork)"
  - "Sticky-demotion row seeds O1, O2, O1 across three sessions with NO map-iteration-order assumption — the sticky Set yields absence in every readdir order, and RED fails deterministically in every order under last-write-wins"
  - "buildRestoreIndex JSDoc collision claim corrected in the same commit: 'structurally absent' -> birthday-bounded (~2^-32 per session pair) with demote treatment — the old sentence was the exact overclaim AR-10-05 flagged"

patterns-established:
  - "Demoted placeholder lands in NEITHER placeholders nor secretPlaceholders (identical to OVF): unmatched pass-through, no candidate original anywhere in the index"

requirements-completed: [REVMODE-11 (partial — hardening leg; REVMODE-11 spans all phase-11 plans, orchestrator reconciles traceability after the wave)]

# Metrics
duration: 9min
completed: 2026-07-18
---

# Phase 11 Plan 03: Cross-Session Collision Demote-to-Unmatched Summary

**IN-02/AR-10-05 adopted: the union index's silent last-write-wins on cross-session placeholder collisions is now sticky demote-to-unmatched — a disputed token restores NOTHING, proven via forced-collision fixtures encrypted under real per-session keys**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-18T03:01:51Z
- **Completed:** 2026-07-18T03:11:00Z
- **Tasks:** 2 (RED, GREEN)
- **Files modified:** 2

## Accomplishments

- **Silent wrong-value restore is structurally impossible** (T-11-03-01 mitigated): two sessions carrying the SAME placeholder with DIFFERENT originals produce a union index where that placeholder is in NEITHER `placeholders` nor `secretPlaceholders` — the token passes through unmatched, and neither candidate original appears anywhere in the serialized index
- **Demotion is sticky across the whole union build**: a third session re-carrying the first original cannot re-enter the index — the function-scoped `demoted` Set (not a bare delete) is load-bearing, asserted with a 3-session O1/O2/O1 row that holds in every readdir order
- **Benign duplicates still restore**: same placeholder + same original across two sessions is an idempotent re-set (`placeholders.get(P) === O1`), not a collision
- **Import surface unchanged** (T-11-03-02 mitigated): the fix adds zero imports; the cold-path outbound allowlist fence (rule 3) stays green; file stays read-only fs surface (readdir + readSessionMapFile only)
- **Fixtures ride the real cipher path** (T-11-03-03 mitigated): `persistHandBuiltMap` builds valid SessionMapV1 JSON with explicit placeholder strings, encrypts via `encryptMapBuffer` under `ensureSessionKey`'s REAL key, writes envelope bytes with 0o700/0o600 modes — the 10-02 poisoned-map recipe generalized; every collision row asserts `sessions` count FIRST (non-vacuity) before any absence assertion
- All 12 pre-existing session-index rows (union, OVF exclusion, poisoned-map, secretPlaceholders, corrupt-skip, filters, no-write proof) green unchanged

## Task Commits

Each task was committed atomically (TDD gate sequence):

1. **Task 1 (RED): Failing collision rows — demote, sticky demotion, benign duplicate** - `a584ae5` (test)
2. **Task 2 (GREEN): Sticky demote fix at the union-build set site** - `17a73b2` (feat)

## Files Created/Modified

- `src/restore/session-index.ts` (+21/-2) - Function-scoped `demoted` Set; skip-if-demoted → demote-on-conflict (delete + add + continue) → else set, placed after the untouched isRestorableType / `'original' in entry` / OVF gates; JSDoc collision-claim correction
- `tests/restore/session-index.test.ts` (+170, now 561 lines) - `HandBuiltEntrySpec` + `persistHandBuiltMap` helper; nested describe `IN-02: cross-session collision demotes to unmatched (AR-10-05)` with Cases A/B/C

## TDD Gate Compliance

- RED gate: `test(11-03): add failing cross-session collision demote rows (IN-02)` (`a584ae5`) — Cases A and B failed for the RIGHT reason: `expect(result.placeholders.has(collidedToken)).toBe(false)` received `true` (last-write-wins had put the disputed token IN the index — the wrong-value entry itself, not a fixture error), with the `sessions === 2/3` non-vacuity assertions passing first; Case C control and all 12 pre-existing rows passed
- GREEN gate: `feat(11-03): demote cross-session placeholder collisions to unmatched (IN-02/AR-10-05)` (`17a73b2`) — all 15 session-index tests pass unmodified
- REFACTOR gate: not applicable — the plan defines only RED/GREEN tasks; the GREEN implementation matches the PATTERNS fix shape exactly, nothing to clean

## Verification Results

- `npx vitest run tests/restore/session-index.test.ts tests/state/cold-path.test.ts --project=unit` — 24/24 passed (15 session-index + 9 cold-path fence)
- `npm test` — 965 passed | 18 skipped, 0 failures
- `npm run typecheck` — 38 errors (exactly the pre-existing baseline), ZERO errors referencing restore/session-index files
- `git diff` on src/restore/session-index.ts: no import lines touched (grep `^[+-]import` empty); only the accumulator declaration, the loop-local demote logic, and the adjacent JSDoc sentence
- TDD gate order: `test(11-03)` (`a584ae5`) precedes `feat(11-03)` (`17a73b2`) in git log
- must_haves: `src/restore/session-index.ts` contains `demoted` (5 occurrences); test file 561 lines (>= 120); key links live (`buildRestoreIndex` x17 in test file, `readSessionMapFile` unchanged in source)

## Decisions Made

- **Nested the IN-02 describe inside the existing top-level describe** — reuses the file's `freshBaseDir`/`cleanupDirs`/`afterEach` machinery; a second top-level describe would have duplicated ~13 lines of cleanup plumbing
- **One shared `collidedToken` (`formatV2Token('WORD', 1, 'aabbccdd')`) across all three rows** — each test gets an isolated mkdtemp baseDir, so reuse is safe and keeps the fixture surface minimal; the fixed nonce8 keeps the token a structurally valid v2 shape
- **Case A's leak assertion materializes Map/Set to arrays before JSON.stringify** — same rationale as the 10-02 poisoned-map row: raw stringify of a Map yields `{}`, making the "neither original anywhere" assertion vacuous

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Doc bug] Corrected the now-false JSDoc collision claim at the fix site**
- **Found during:** Task 2
- **Issue:** `buildRestoreIndex`'s JSDoc stated "nonce8 in every token makes cross-session collisions structurally absent" — the exact overclaim AR-10-05 flagged (collisions are birthday-bounded ~2^-32 per session pair, not impossible), and the sentence would directly contradict the demote logic being added three lines below it
- **Fix:** Sentence rewritten to birthday-bounded + demote-to-unmatched semantics (IN-02/AR-10-05 cited)
- **Files modified:** src/restore/session-index.ts (comment-only; zero imports, zero behavior)
- **Commit:** `17a73b2` (same GREEN commit)

No other deviations — code change is exactly the PATTERNS fix shape.

## Issues Encountered

- `npm test`'s integration project globalSetup (`tsup --clean`) regenerated `dist/cli.js` in the worktree after the GREEN fix landed in src. Per repo policy (worktree dist pollution — embedded worktree-relative shim paths), the artifact was reverted via `git checkout -- dist/cli.js` and NOT committed; dist rebuilds on main post-merge

## Deferred Issues

- **Pre-existing typecheck errors (38) in unrelated files** — unchanged baseline from the phase base commit (`f7bd15d`); none reference phase files. Recorded here (not a shared deferred-items.md) to avoid parallel-worktree merge conflicts; orchestrator can consolidate from wave SUMMARYs

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data paths introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **AR-10-05 residual handoff to 11-07**: with demote-to-unmatched shipped, THREAT_MODEL.md's AR-10-05 residual ("cross-session token collision → silent last-write-wins") shrinks to a documented note — 11-07's rewrite should cite this plan's gates (collision rows + sticky-Set) as the shipped mitigation
- The demote treatment is greppable via the `demoted` Set and the IN-02/AR-10-05 comment markers at the fix site
- `persistHandBuiltMap` is available in the session-index suite for any future row needing explicit placeholder strings under real encryption

## Self-Check: PASSED

- FOUND: src/restore/session-index.ts
- FOUND: tests/restore/session-index.test.ts
- FOUND: commit a584ae5 (test(11-03))
- FOUND: commit 17a73b2 (feat(11-03))
- 24/24 targeted + 965 full-suite tests green on final run; no deletions in any plan commit; no untracked files left; no dist/ artifacts committed

---
*Phase: 11-wire-safety-verification-hardening*
*Completed: 2026-07-18*
