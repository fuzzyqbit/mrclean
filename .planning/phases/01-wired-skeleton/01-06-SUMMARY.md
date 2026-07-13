---
phase: 01-wired-skeleton
plan: 06
subsystem: infra
tags: [hook, settings.json, fail-closed, doctor, claude-code, install, uat]

# Dependency graph
requires:
  - phase: 01-wired-skeleton
    provides: writeHookEntries + settings.json hook registration, doctor checks, UAT harness
provides:
  - Fail-closed POSIX /bin/sh hook wrapper (buildHookCommand) — any spawn/inner failure of node<bin>hook remaps to exit 2 so Claude Code blocks
  - Deterministic spawnSync exit-code remap proof (missing bin->2, exit0->0, exit2->2, stdout passthrough) with no live Claude session
  - Doctor path-extraction realigned to the wrapper arg tail (+legacy/win32 fallback) and fail-closed bins messaging
  - Migration/idempotency: old-shape _mrclean entries replaced in place by the wrapper (no duplicate)
  - UAT harness + idempotency test synced to the single-source-of-truth wrapper; corrected 01-VERIFICATION.md human items
affects: [01-07 live-UAT gate, any future change to the Claude Code hook contract or installer shape]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-closed spawn wrapper: /bin/sh -c '\"$1\" \"$2\" hook || exit 2' with positional params (injection-safe, space-safe) living in the OS shell, not the deletable dist/"
    - "Single source of truth for the hook command shape: buildHookCommand() consumed by the installer, doctor fixtures, and the UAT harness"

key-files:
  created:
    - .planning/phases/01-wired-skeleton/01-06-SUMMARY.md
  modified:
    - src/install/settings.ts
    - src/doctor/checks.ts
    - tests/install/settings.test.ts
    - tests/doctor/checks.test.ts
    - tests/uat/live-session.test.ts
    - tests/install/idempotency.test.ts
    - .planning/phases/01-wired-skeleton/01-VERIFICATION.md
    - dist/cli.js
    - dist/mcp.js

key-decisions:
  - "Installer writes a fail-closed POSIX /bin/sh wrapper so ANY inner failure (missing bin, ENOENT, exit 1, module-not-found, signal) remaps to exit 2 — closes the SC4/HOOK-05 fail-open hole"
  - "win32 stays plain-exec (documented known-gap, fail-OPEN on spawn failure) — an untested cmd.exe nested-quote wrapper would risk false-blocking every tool call"
  - "Doctor reads node+bin from the wrapper arg tail (args[len-2]/args[len-1]) with a '.js'-at-args[0] legacy/win32 fallback so both shapes are tolerated during migration"

patterns-established:
  - "Fail-closed-at-the-spawn-layer: put the exit-code remap in the OS shell wrapper (survives dist/ deletion) rather than trusting the inner process to reach its own crash guard"
  - "Test the shipped wrapper, not a hand-built copy: buildHookCommand is imported by every fixture/harness so shape drift is impossible"

requirements-completed: [HOOK-05, INST-01]

# Metrics
duration: 10min
completed: 2026-07-13
---

# Phase 1 Plan 06: Fail-Closed Hook Wrapper Summary

**A fail-closed POSIX `/bin/sh` hook wrapper (`"$1" "$2" hook || exit 2`) that converts any spawn/inner failure of `node <bin> hook` into exit 2 — closing the SC4/HOOK-05 hole where deleting the mrclean bin silently disabled all protection — with doctor, migration, and the UAT harness realigned to the same shape.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-13T22:43:48Z
- **Completed:** 2026-07-13T22:53:31Z
- **Tasks:** 3 (Task 1 executed TDD: RED then GREEN)
- **Files modified:** 9

## Accomplishments

- **`buildHookCommand()`** added/exported in `src/install/settings.ts`. POSIX branch returns the fail-closed `/bin/sh` wrapper with positional params (`['-c', '"$1" "$2" hook || exit 2', 'mrclean-hook', node, bin]`); win32 keeps the plain exec form as a documented known-gap. `writeHookEntries` now builds the entry via this function; the `_mrclean` marker stays on the outer entry so idempotent replace/remove is untouched.
- **Deterministic exit-code proof** via `spawnSync` (no live Claude): missing bin → 2, inner exit 0 → 0, inner exit 2 → 2, plus a stdout-passthrough case proving the banner / `permissionDecision` JSON survives the `sh` wrapper.
- **Migration proof:** `writeHookEntries` over a hand-built OLD-shape `_mrclean` entry yields exactly one NEW wrapper entry per event (no duplication).
- **Doctor realigned:** `collectRegisteredBinPaths` + `extractRegisteredPaths` read node+bin from the wrapper arg tail via a new `extractHookNodeAndBin` helper (legacy plain-exec and win32 shapes tolerated via the `.js`-at-args[0] fallback). The bins-missing FAIL now reports the fail-closed block-until-reinstall consequence (exit 2) and points to `mrclean install`.
- **Coupled tests synced:** doctor fixtures, the UAT harness (`buildHookSettings`), and the idempotency test all build/read the hook command via the shared `buildHookCommand` — the UAT-2b broken-bin variant now exercises the exact shipped fail-closed wrapper.
- **Stale docs corrected:** `01-VERIFICATION.md` human items now describe the long-form banner (now automated by UAT-1) and the delete/rename-bin fail-closed scenario (now automated by UAT-2b), replacing the stale `v0.1.0` no-op banner string and the untestable `chmod -x` wording. SC1–SC5 results table left unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1 (TDD RED): failing wrapper exit-code + migration tests** — `f537436` (test)
2. **Task 1 (TDD GREEN): fail-closed POSIX hook wrapper via buildHookCommand** — `40c2f4f` (feat)
3. **Task 2: realign doctor path-extraction to the wrapper** — `313c0bf` (fix)
4. **Task 3: sync UAT + idempotency to shared wrapper; fix stale verification docs** — `6256aa2` (test)
5. **Rebuild dist for the fail-closed wrapper** — `b1b5acc` (chore)

## Files Created/Modified

- `src/install/settings.ts` — added/exported `buildHookCommand(nodePath, binPath, platform)`; `writeHookEntries` now uses it
- `src/doctor/checks.ts` — `extractHookNodeAndBin` helper; wrapper-aware `collectRegisteredBinPaths`/`extractRegisteredPaths`; fail-closed bins FAIL detail
- `tests/install/settings.test.ts` — wrapper-shape assertions, spawnSync exit-code remap (4 cases incl. stdout passthrough), migration test, win32/POSIX unit branches
- `tests/doctor/checks.test.ts` — fixtures rebuilt via `buildHookCommand`; bins-not-executable case asserts the new fail-closed wording
- `tests/uat/live-session.test.ts` — `buildHookSettings` builds the hook command via `buildHookCommand` (single source of truth)
- `tests/install/idempotency.test.ts` — reads the mrclean bin from the wrapper arg tail (`args[len-1]`) instead of `args[0]`
- `.planning/phases/01-wired-skeleton/01-VERIFICATION.md` — corrected the two stale human-verification items + prose (frontmatter and body)
- `dist/cli.js`, `dist/mcp.js` — rebuilt from tsup so the shipped installer/doctor carry the wrapper behavior

## Decisions Made

- **Fail-closed at the spawn layer.** The remap lives in the OS `/bin/sh` wrapper (which survives `dist/` deletion), not inside the inner process — the inner process never runs when the bin is missing, so its own crash guard cannot help.
- **POSIX positional params, not string interpolation.** `"$1" "$2"` are shell-quoted, so paths with spaces/metacharacters are injection-safe.
- **win32 = documented known-gap.** Shipping an untested cmd.exe nested-quote wrapper risks a mis-quote false-blocking every tool call; win32 keeps the plain exec form and stays fail-OPEN on spawn failure until a tested wrapper ships. Tracked in Next Phase Readiness.
- **Doctor tolerates all three shapes** (wrapper / legacy plain-exec / win32) via the `.js`-at-args[0] discriminator so migration and cross-platform reads never break.

## Deviations from Plan

None — plan executed exactly as written (Rules 1–4 not triggered; no bugs, missing critical functionality, blocking issues, or architectural changes discovered).

**Note (non-deviation):** `tests/doctor/end-to-end.test.ts` was listed in the plan's `files_modified`, but a scan confirmed it hard-codes no old-shape hook assertions (it drives `runInstall` + `computeDoctorReport` and asserts exit codes / result names). Its globalSetup rebuilds `dist/`, so Test 8's CLI round-trip exercises the new shape automatically. It therefore required no edits, and it stays green — continuing to prove the 6x-PASS-on-fresh-install claim.

## Issues Encountered

- **Transient cross-task coupling (expected):** after Task 1 shipped the wrapper but before Task 2 realigned doctor, the doctor path-extraction would have read `args[0] === '-c'` as the bin. This is exactly why the plan couples the installer and doctor changes in one plan; Task 2 is the fix. Full `vitest run` was only asserted after both landed. No net regression.
- **STATE.md handlers in a re-execution context:** `state.update-progress` and `state.record-session` reported "field not found" (this milestone's STATE.md uses a different section layout); `state.record-metric`/`state.add-decision` needed `--flag` form rather than positional args. Position/metric/roadmap/decisions were recorded successfully; the two no-op handlers are cosmetic and non-blocking.

## User Setup Required

None — no external service configuration required. Zero new runtime deps (wrapper uses OS `/bin/sh`; the proof uses `node:child_process`).

## Next Phase Readiness

- **POSIX fail-closed guarantee restored and proven deterministically.** The live end-to-end confirmation (real `claude -p`, UAT-2b flip) is gated by **plan 01-07** (`npm run test:uat`, opt-in).
- **Open known-gap:** win32 stays fail-OPEN on hook spawn failure (missing bin) until a tested cmd.exe wrapper ships. Accepted this plan (threat T-01-06-01/02 disposition = mitigate POSIX / accept win32); a future plan can add and test the Windows wrapper.
- Full suite green: 76 files / 588 tests passed, 3 UAT tests skipped (opt-in). No new dependencies; atomic settings.json writes preserved.

## Self-Check: PASSED

- All 9 modified files verified present on disk.
- All 5 task commits verified in git history (`f537436`, `40c2f4f`, `313c0bf`, `6256aa2`, `b1b5acc`).
- `dist/cli.js` contains `buildHookCommand` (confirms the shipped artifact carries the wrapper).

---
*Phase: 01-wired-skeleton*
*Completed: 2026-07-13*
