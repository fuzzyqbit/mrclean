---
phase: 09-session-state-adapter
plan: 08
subsystem: state
tags: [stress-test, chaos-test, aes-256-gcm, proper-lockfile, write-file-atomic, tsup, vitest, doctor]

# Dependency graph
requires:
  - phase: 09-session-state-adapter (09-03..09-05)
    provides: encrypted map store, lock wrapper, state facade under test
  - phase: 09-session-state-adapter (09-06, 09-07)
    provides: janitor lifecycle + reversible handler wiring the chaos suite drives end-to-end
provides:
  - SC5 16-process integration stress gate (tests/state/stress.test.ts + dist-bundled worker fixture)
  - chaos one-way-parity proofs for six corruption shapes at handler level
  - SC1 operator dir-inspection as a literal executable test
  - doctor check-8 enabled copy updated + byte-locked for the live adapter
  - tsup shims fix making the SHIPPED bundle's reversible persist path actually work
  - withMapLock ELOCKED re-arm so the deadline (not the randomized ladder) is the effective bound
affects: [10-operator-restore, 11-wire-safety-verification, phase-11-ci-gates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TEST-ONLY tsup entry + gitignored dist artifact (detect-layer1 precedent extended to state-stress-worker)"
    - "go-file barrier multi-process stress harness with zero-degrade load-bearing assertion"
    - "handler-level chaos parity via vi.stubEnv('HOME') + real state modules + v2 nonce-tail normalization"

key-files:
  created:
    - tests/state/fixtures/stress-worker.ts
    - tests/state/stress.test.ts
    - tests/state/chaos.test.ts
    - tests/state/inspection.test.ts
  modified:
    - tsup.config.ts
    - vitest.config.ts
    - src/state/lock.ts
    - src/doctor/checks.ts
    - tests/doctor/checks.test.ts
    - .gitignore
    - dist/cli.js
    - dist/mcp.js

key-decisions:
  - "tsup shims:true — bundled CJS write-file-atomic references __filename, unshimmed in ESM output; every dist-bundle persist threw and degraded (stress gate caught a real shipped-bundle bug)"
  - "withMapLock re-arms proper-lockfile's ELOCKED ladder while wall-clock budget remains — only ELOCKED re-arms; ENOENT/EACCES keep immediate-degrade semantics"
  - "Stress harness deadline 500ms on measured evidence (T-09-08-06); production UPS/POST constants untouched at 50/100"
  - "dist/state-stress-worker.* gitignored per detect-layer1 test-only-artifact precedent"
  - "Typecheck differential ran against the 38-error baseline (Phase 9 deferred-items), not the plan's stale 36 figure"

patterns-established:
  - "Zero-degrade assertion as the anti-vacuity spine of concurrency gates (Pitfall 3)"
  - "Non-vacuity probes in parity tests: assert the enabled branch REALLY engaged (v2 tails present) before asserting equality"

requirements-completed: [REVMODE-02, REVMODE-04]

# Metrics
duration: 28min
completed: 2026-07-17
---

# Phase 9 Plan 08: Stress/Chaos/Inspection Gates + Phase Close Summary

**SC5 proven at integration level — 16 real processes / 400 contended transactions with 0 lost / 0 dups / 0 disagreements / 0 degrades — after the stress gate flushed out two real shipped-bundle bugs (unshimmed `__filename` in bundled write-file-atomic; premature ELOCKED degrade before the deadline)**

## Performance

- **Duration:** 28 min
- **Started:** 2026-07-17T03:45:28Z
- **Completed:** 2026-07-17T04:13:37Z
- **Tasks:** 3
- **Files modified:** 12

## Stress Gate Numbers (SC5, recorded per plan output spec)

| Metric | Value |
|--------|-------|
| Processes | 16 (real `spawn`, go-file barrier) |
| Transactions | 400 (25 per worker: 20 shared + 5 unique) |
| Entries in decrypted final map | 100 / 100 expected (zero lost) |
| Counter | 100 (integrity exact) |
| Distinct NNN placeholders | 100 (zero dups; zero OVF present) |
| Cross-process placeholder disagreements | 0 (all 16 workers agree on all 20 shared originals, matching the store) |
| Degrade fallbacks | 0 (load-bearing assertion — Pitfall 3) |
| Burst wall-time | 263 ms (first passing run), 252 ms (stability re-run) |
| Secret floor under stress | AWS_KEY-typed shared entries lack `original`; WORD-typed carry it |

## Accomplishments

- **SC5 stress gate green** at integration level with all six mandatory assertion families — the Phase 11 CI gate now has a passing substrate.
- **Chaos one-way parity proven at handler level** for all six corruption shapes (corrupt byte, truncated envelope, chmod 000, map-is-a-directory, deleted mid-session, garbage key): `handlePostToolUse` output is deep-equal to the one-way baseline after v2 nonce-tail normalization — never a throw, never a block. Case (e) additionally proves a mid-transaction map deletion persists ok-or-degraded without throwing.
- **SC1 is a literal test**: after a real two-event flow, `sessions/` holds only ciphertext (`<sid>.map`, zero tmp residue, no originals/JSON markers in raw bytes), keys live in the separate 0700 `keys/`, files are 0600, and a recursive scan of `process.cwd()` finds zero `.mrclean/keys|sessions` dirs in the project tree.
- **Two real shipped-bundle bugs found and fixed** (details under Deviations) — the stress gate did exactly the job it exists for.
- **Doctor check-8 honest**: enabled copy now reads `reversible mode: enabled — encrypted session state adapter active`, byte-locked by Test 16; `plumbing only` no longer appears anywhere under src/.
- **Phase regression gates green**: 851 passed / 15 skipped (baseline 843/14 + 8 new + 1 visible win32 skip); coverage 86.86/80.73/85.99/87.82 vs 80/70/75/80 thresholds; typecheck error set byte-identical to the 38-error baseline; `git diff --stat b5a16b0 -- tests/placeholder tests/detect tests/audit` EMPTY (zero edits across the whole phase — byte-identical one-way proof).

## Task Commits

Each task was committed atomically:

1. **Task 1: Stress worker fixture + build/test config + SC5 stress gate** - `2f32030` (test)
2. **Task 2: Chaos parity suite + SC1 operator-inspection test** - `f291628` (test)
3. **Task 3: Doctor check-8 copy update** - `d14d02a` (fix)
4. **Task 3 gate follow-up: chaos suite optional-chaining typecheck fix** - `e903b18` (fix)
5. **Task 3 final: dist rebuild (dist-only paths)** - `551cfef` (chore)

## Files Created/Modified

- `tests/state/fixtures/stress-worker.ts` - spawn-barrier worker driving the REAL facade + manager per transaction (public APIs only, zero crypto imports)
- `tests/state/stress.test.ts` - SC5 gate with the six mandatory assertion families
- `tests/state/chaos.test.ts` - six-shape one-way parity at handler level, real state modules, HOME-stub seam only
- `tests/state/inspection.test.ts` - SC1 literal dir inspection + SC3 floor round-trip sanity
- `tsup.config.ts` - `state-stress-worker` TEST-ONLY entry + `shims: true` (bug fix)
- `vitest.config.ts` - stress test dual-listed (unit exclude / integration include, non-vacuity comments)
- `src/state/lock.ts` - `acquireWithDeadline`: ELOCKED re-arm until the wall-clock deadline (bug fix)
- `src/doctor/checks.ts` - REVERSIBLE_DETAIL_ENABLED copy for the live adapter
- `tests/doctor/checks.test.ts` - Test 16 byte-for-byte lock on the new copy
- `.gitignore` - `dist/state-stress-worker.*` (detect-layer1 precedent)
- `dist/cli.js`, `dist/mcp.js` - rebuilt (separate chore commit)

## Decisions Made

- **Typecheck baseline is 38, not the plan's 36** — Phase 9 deferred-items documents the 36→38 drift (two pre-existing `src/model/pipeline-singleton.ts` errors from a transformers minor bump). Differential gate applied against the actual 38-error set: post-plan error set is byte-identical.
- **Harness deadline 500 ms** — see Deviations item 3; production constants untouched.
- **`dist/state-stress-worker.*` gitignored, not committed** — repo convention for test-only dist entries (detect-layer1); npm exclusion already guaranteed by `files[]` enumeration (verified unchanged).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] tsup ESM bundle lacked CJS global shims — every shipped-bundle reversible persist threw**
- **Found during:** Task 1 (first stress run: all 400 transactions degraded, map never written)
- **Issue:** bundled `write-file-atomic` (CJS) references `__filename` as a free variable in `getTmpname()`; esbuild only auto-shims `__filename`/`__dirname` for cjs OUTPUT format. In the ESM bundle every `writeSessionMapFile` threw `ReferenceError: __filename is not defined` inside the locked transaction → facade degrade. Source runs (vitest/tsx) never hit it — which is why every prior unit/integration suite stayed green while the SHIPPED `dist/cli.js` reversible persist path was broken since 09-07.
- **Fix:** `shims: true` in tsup.config.ts (tsup injects the `import.meta.url`-based shim only into modules that use the globals).
- **Files modified:** tsup.config.ts
- **Verification:** single-worker probe 25/25 transactions, 0 degrades; full gate green twice; full suite green
- **Committed in:** 2f32030 (Task 1 commit)

**2. [Rule 1 - Bug] withMapLock treated proper-lockfile's first ELOCKED as terminal, degrading contenders that still had deadline budget**
- **Found during:** Task 1 (5/400 degrades after fix 1; lock.ts's own comment claims "the deadline race below is the effective bound")
- **Issue:** one retry-ladder pass rejects ELOCKED after ~46-190 ms RANDOMIZED (09-05 re-measured giveup ~119 ms). Under the 16-way boot storm, low-end ladder passes rejected while most of the deadline budget remained — the documented contract ("give up after deadlineMs") did not hold, and SC5's zero-degrade bar is unreachable without it.
- **Fix:** extracted `acquireWithDeadline`: re-arm the ladder ONLY on ELOCKED while `Date.now() < deadlineAt`; non-transient classes (ENOENT missing parent, EACCES) keep immediate-degrade semantics; deadline expiry path (late-acquire release) unchanged. All six pinned behaviors in tests/state/lock.test.ts pass with zero edits.
- **Files modified:** src/state/lock.ts (outside the plan's files list — justified: blocks SC5 and contradicts the module's documented contract)
- **Verification:** lock.test.ts 6/6 green unmodified; degrades dropped 5→2 (remaining 2 were true deadline expiries, see item 3)
- **Committed in:** 2f32030 (Task 1 commit)

**3. [Documented tuning per T-09-08-06] Stress harness deadline 150 ms → 500 ms on perf-gate evidence**
- **Found during:** Task 1 (2/400 pure-deadline degrades remained at 150 ms after fixes 1-2)
- **Issue:** RESEARCH's 150 ms reference (400 txns/117 ms/0 timeouts) was measured against the zero-dep mkdir-lockdir fallback probing every 0.5-2 ms; the shipped proper-lockfile ladder probes at 2→10 ms — first-transaction acquire tails exceed 150 ms under the 16-process boot storm on the executor machine.
- **Fix:** WORKER_DEADLINE_MS = 500 (harness-only knob; measured 0/400 degrades across three consecutive runs). Production constants UPS_LOCK_DEADLINE_MS=50 / POST_LOCK_DEADLINE_MS=100 untouched; the zero-degrade assertion untouched (never the knob — Pitfall 3).
- **Files modified:** tests/state/stress.test.ts, tests/state/fixtures/stress-worker.ts (comments)
- **Verification:** gate green twice (burst 263 ms / 252 ms, 0 degrades both)
- **Committed in:** 2f32030 (Task 1 commit)

**4. [Rule 2 - Repo hygiene] Gitignored the new test-only dist artifacts**
- **Found during:** Task 1 (build produced untracked dist/state-stress-worker.{js,d.ts})
- **Issue:** executor policy forbids leaving generated files untracked; repo precedent (`dist/detect-layer1.*` in .gitignore) is that test-only dist entries are ignored, not committed.
- **Fix:** added `dist/state-stress-worker.*` to .gitignore beside the detect-layer1 line.
- **Files modified:** .gitignore
- **Committed in:** 2f32030 (Task 1 commit)

**5. [Rule 1 - Bug in own new code] TS2532 in chaos suite under strict indexing**
- **Found during:** Task 3 differential typecheck (2 new errors vs the 38 baseline)
- **Issue:** `baseline!.hookSpecificOutput.hookEventName` — `hookSpecificOutput` is optional on PostToolUseOutput.
- **Fix:** optional chaining (`?.`) on both accesses; assertions unchanged in strength (toBe fails on undefined).
- **Files modified:** tests/state/chaos.test.ts
- **Verification:** typecheck back to byte-identical 38-error baseline; chaos suite 6/6 green
- **Committed in:** e903b18

---

**Total deviations:** 5 (4 auto-fixed under Rules 1-2, 1 sanctioned harness tuning under T-09-08-06)
**Impact on plan:** Fixes 1-2 are exactly the class of shipped-bundle defect this plan's gates exist to catch — without them, reversible persist through `dist/cli.js` silently degraded on every event. No scope creep; production deadline constants and all locked suites untouched.

## Issues Encountered

- Plan frontmatter cited a 36-error typecheck baseline; the authoritative Phase 9 baseline is 38 (deferred-items.md, 09-01 note). Ran the differential against the captured 38-error set — byte-identical after the plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 9 closes with all five plans' gates green: SC5 stress + chaos parity at integration level, SC1 by literal inspection, byte-identical one-way proof across the phase, coverage and typecheck baselines held.
- Phase 10 (operator restore) builds on: decrypted-map read path (`readSessionMapFile`), the secret floor (never-restorable entries structurally lack `original`), and v2 token addressing — all now regression-locked under contention and corruption.
- Phase 11 elevates these exact suites to CI gates; the stress harness deadline note (500 ms harness / 50-100 ms production, T-09-08-06) documents the knob CI may need to re-measure on Linux.

## Self-Check: PASSED

- tests/state/fixtures/stress-worker.ts: FOUND
- tests/state/stress.test.ts: FOUND
- tests/state/chaos.test.ts: FOUND
- tests/state/inspection.test.ts: FOUND
- Commits 2f32030, f291628, d14d02a, e903b18, 551cfef: FOUND in git log

---
*Phase: 09-session-state-adapter*
*Completed: 2026-07-17*
