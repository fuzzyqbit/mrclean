---
phase: 11-wire-safety-verification-hardening
plan: "02"
subsystem: testing
tags: [vitest, fs-interception, monkey-patch, syncBuiltinESMExports, write-file-atomic, reversible-mode, canary, aes-256-gcm]

# Dependency graph
requires:
  - phase: 09-reversible-state-store
    provides: encrypted map store (map-store.ts envelope + publishKeyOnce), persistAllocations facade, POST_LOCK_DEADLINE_MS
  - phase: 10-operator-restore
    provides: runRestore CLI (RunRestoreOpts seams baseDir/cwd/stdin), restore audit append (restore-log.ts), inspection.test.ts helpers (runReversibleEvent, captureRestoreRun)
provides:
  - SC2 fs-write interception gate — tests/state/fs-interception.test.ts (unit project, CI via npm test)
  - Proof that NO buffer handed to any fs write API during a real reversible flow + restore run carries a plaintext canary or the '"entries"' map-JSON marker — including write-file-atomic's fd-based temp-file writes that post-hoc byte-scans cannot see
  - Reusable-in-principle patch-seam recipe: builtin fs property patch + syncBuiltinESMExports, 8 APIs wrapped, finally + idempotent afterEach hygiene
affects: [11-wire-safety remaining plans, THREAT_MODEL finalization (SC5), milestone audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Builtin-fs property patch + module.syncBuiltinESMExports() seam — reaches BOTH ESM named-import writes AND externalized CJS deps' promisify(fs.write) fd writes (vi.mock('node:fs') cannot)"
    - "Non-vacuity-before-absence assertion ordering (10-08 discipline) extended with three mandatory channel probes"

key-files:
  created:
    - tests/state/fs-interception.test.ts
  modified: []

key-decisions:
  - "Wrapper deliberately does NOT carry util.promisify.custom — wfa's per-call promisify(fs.write) must promisify the wrapper (capture), not shortcut to the builtin custom implementation (bypass)"
  - "Hygiene proven three ways: finally-restore, idempotent afterEach(restorePatch), and a permanent sibling test asserting all 8 builtins are identity-restored plus a live un-captured ESM named-import write"
  - "MRCLNMAP magic duplicated by value (private constant in map-store.ts) — grammar/offset sync-lock tests own drift, per chaos/map-store duplicate-verbatim precedent"

patterns-established:
  - "fs interception harness: wrap<T>(original, record) delegating with identical args + this-binding; captures {api, target, bytes} with toBuf normalization"
  - "Channel-probe non-vacuity: every intercepted write channel needs a positive capture proof before absence assertions may count"

requirements-completed: [REVMODE-11]

# Metrics
duration: 14min
completed: 2026-07-18
---

# Phase 11 Plan 02: fs-Write Interception Gate Summary

**SC2 proven at the write-call boundary: 8 patched fs write APIs captured every buffer of a real two-event reversible flow + restore run — zero plaintext canaries anywhere, including wfa's transient temp-file writes, with all three channels (map envelope, key tmp, audit append) non-vacuously probed**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-07-18T03:00:57Z
- **Completed:** 2026-07-18T03:14:54Z
- **Tasks:** 2
- **Files modified:** 1 (new test file, 469 lines)

## Accomplishments

- The transient-write dimension SC2 demanded is now gated: a plaintext buffer written to an atomic-write temp file and renamed-then-deleted would evade `tests/state/inspection.test.ts`'s post-hoc byte-scan — the interception seam catches it at the write call itself.
- The seam (11-RESEARCH Pattern 3, probe-verified 2026-07-17) reaches BOTH map-store's ESM named-import `writeFile` AND write-file-atomic's fd-based `promisify(fs.write)` temp writes — confirmed against `node_modules/write-file-atomic/lib/index.js:116` (`await promisify(fs.write)(fd, data, 0, data.length, 0)`, result unused, re-promisified per call).
- Patch hygiene is guaranteed under failure: finally-restore + idempotent `afterEach(restorePatch)` + `syncBuiltinESMExports()` re-sync after restore, plus a permanent sibling test proving identity restoration and an un-captured post-restore write. Full `npm test` (102 files passed, 964 tests) confirms zero patched-builtin leakage into sibling suites.

## Task Commits

Each task was committed atomically:

1. **Task 1: Patch seam + real two-event reversible flow with absence and channel probes** - `4be1b9b` (test)
2. **Task 2: Restore-run leg under the same patch + audit channel probe + hygiene proof** - `2af4781` (test)

## Files Created/Modified

- `tests/state/fs-interception.test.ts` - SC2 gate (unit project, default glob — no vitest.config edit). Module-scope `installPatch()`/`restorePatch()` over 8 APIs (`fs.write`, `fs.writev`, `fs.writeFile`, `fs.writeFileSync`, `fs.appendFile`, `fs.appendFileSync`, `fsPromises.writeFile`, `fsPromises.appendFile`); `runReversibleEvent` and `captureRestoreRun` duplicated by value from inspection.test.ts per the never-cross-imported convention; win32 visible-skip placeholder describe (chaos WR-04 precedent).

## Channel-Probe Evidence (plan-required)

Evidence run of the identical seam against the real modules (Node v22.22.0, this session; the committed test asserts these same shapes on every CI run):

```
captures total: 4
probe1 MRCLNMAP via fs.write:          count=2  sample={target:fd:22, len:402, head:'MRCLNMAP..KQ...'}   ← wfa temp-file envelope, ciphertext-framed from byte 0
probe2 key tmp via promises.writeFile: count=1  sample={target:...<sid>.key.138977726, len:32}           ← publishKeyOnce exact tmp naming, exactly 32 key bytes
probe3 audit via promises.appendFile:  count=1  sample={target:....mrclean/audit.jsonl, bytes:{"ts":"2026-07-18T03:14:50.726Z","action":"restore","sessionScope":"all","restored":1,"unmatched":0,"skippedSecret":1,"hashes":["c63dc2b93910185d"]}}
absence sweep over 4 captures: leak=false
```

The audit capture is hash-only (first-16-hex SHA-256 of the restored WORD original) — both canaries asserted absent from that specific capture in the committed test.

## Hygiene Sabotage Check (plan-required)

Per Task 2, a throwing expect (`expect(true, 'SABOTAGE — hygiene drill, must be removed').toBe(false)`) was temporarily inserted mid-flow between event 1 and event 2 — after `installPatch()`, before the finally could be reached normally:

- **Sabotaged run:** main test FAILED at the sabotage line (as designed); the sibling hygiene test **PASSED** — all 8 builtins identity-restored (`fs.write === ORIGINALS.write` etc.) and a subsequent trivial write through the ESM named-import binding was un-captured. Result: `1 failed | 1 passed | 1 skipped`.
- **Conclusion:** a mid-flow throw cannot leak patched builtins into the worker — the finally + afterEach + re-sync chain holds under failure (T-11-02-02 mitigated).
- Sabotage removed; suite re-run green (`2 passed | 1 skipped`), then full `npm test` green.

## Decisions Made

- Wrapper functions intentionally drop `util.promisify.custom`: preserving it would let wfa's `promisify(fs.write)` shortcut to the builtin custom implementation and BYPASS the capture. Standard promisification of the wrapper is safe — wfa discards the resolved value (verified at lib/index.js:116).
- Envelope-magic probe asserts `>= 1` fs.write capture per the plan spec (observed count is 2 — one wfa temp write per persist event); key probe pins EXACT tmp naming (`<sid>.key.<uint32-decimal>` suffix all-digits) against `publishKeyOnce` in map-store.ts.
- The main assertion block runs after the finally restores the patch — assertions need no patched builtins, and a failing assertion can then never contribute to leakage.

## Deviations from Plan

None - plan executed exactly as written.

(Environment setup note, not a deviation: fresh worktree lacked node_modules — lockfile-pinned `npm ci` run per phase-10 executor notes; no new packages, no dist/ artifacts staged in any commit.)

## Issues Encountered

None. The TS2540 risk of assigning to fs module properties did not materialize (default-import binding pattern typechecks clean); typecheck stayed at the 38-error repo baseline with zero errors in the new file.

## Verification

- `npx vitest run tests/state/fs-interception.test.ts --project=unit` — green, non-vacuous collection (1 file, 2 passed + 1 visible win32 skip)
- `npm test` — 102 files passed | 2 skipped, 964 tests passed | 19 skipped, zero failures (no builtin-patch leakage into sibling suites)
- `npm run typecheck` — 38 errors (repo baseline), none in the new file
- `git diff --stat 8f370b9 -- src/hook src/detect src/placeholder tests/placeholder tests/detect` — empty (frozen trees untouched)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SC2 is complete and CI-reachable (unit project → `npm test` → test.yml at PR-to-main): every write channel on the reversible + restore surface is intercepted, probed non-vacuous, and canary-free — including atomic-write temp buffers.
- The patch-seam + channel-probe pattern is documented in the test header for the THREAT_MODEL finalization plan (SC5) to cite as a shipped gate.

## Self-Check: PASSED

- FOUND: tests/state/fs-interception.test.ts (469 lines — min_lines 120 met; contains `syncBuiltinESMExports`)
- FOUND: .planning/phases/11-wire-safety-verification-hardening/11-02-SUMMARY.md
- FOUND: commit 4be1b9b (Task 1)
- FOUND: commit 2af4781 (Task 2)

---
*Phase: 11-wire-safety-verification-hardening*
*Completed: 2026-07-18*
