---
phase: 10-operator-restore
plan: 04
subsystem: doctor
tags: [doctor, config, reversible, revmode-12, tdd, smol-toml]

requires:
  - phase: 08-contract-verification
    provides: "[reversible] config table, checkReversibleState reporting-only check, reserved exit 1 in the check-8 header"
  - phase: 09-session-state-adapter
    provides: "REVERSIBLE_DETAIL_ENABLED adapter-active copy (09-08) that this plan byte-locks"
provides:
  - "readRawReversibleKeys + SUPPORTED_REVERSIBLE_KEYS exports in src/config/index.ts (raw-layer [reversible] key scan, pre-validation)"
  - "checkReversibleState FAIL-loud branch: unknown [reversible] keys in either layer => FAIL exitCodeOnFail 1 naming file + key"
affects:
  - "10-06 (mrclean_status reversible counters — the other REVMODE-12 half)"
  - "phase 11 verification (doctor FAIL matrix is now part of the shipped surface)"

tech-stack:
  added: []
  patterns:
    - "Raw-parse-before-validation scan: FAIL-loud checks must read raw TOML keys, never route through a tolerant validator that drops what they need to see (Pitfall 4)"

key-files:
  created:
    - tests/config/reversible-raw-keys.test.ts
  modified:
    - src/config/index.ts
    - src/doctor/checks.ts
    - tests/doctor/checks.test.ts

key-decisions:
  - "Single try/catch keeps exactly ONE SKIP return site — the constants grep-count lock (5 matching lines) survives byte-identical"
  - "formatReversibleOffenders extracted at GREEN time; checkReversibleState lands at 44 lines, so the REFACTOR task had nothing to clean and its commit was skipped per plan instruction"
  - "REVMODE-12 NOT marked complete in REQUIREMENTS.md: 10-04 ships the doctor half only; 10-06 owns the mrclean_status counters half (also avoids a parallel-worktree merge conflict on REQUIREMENTS.md)"

patterns-established:
  - "Offender pair format: 'unsupported [reversible] key(s): <file>: <key>[; <file>: <key>...]' — user layer first, byte-locked by Test 21"

requirements-completed: []
requirements-partial: [REVMODE-12]

duration: 12min
completed: 2026-07-17
---

# Phase 10 Plan 04: Doctor FAIL-loud on unknown [reversible] keys Summary

**Doctor check 8 now FAILs (exit 1) on any key outside {enabled, ttl_hours} in either config layer's raw [reversible] table via a pre-validation smol-toml key scan — the silent unknown-key no-op REVMODE-12 bans is test-locked dead.**

## Performance

- **Duration:** ~12 min (22:53Z–23:05Z)
- **Started:** 2026-07-17T22:53:35Z
- **Completed:** 2026-07-17T23:05:00Z
- **Tasks:** 3 (RED committed, GREEN committed, REFACTOR evaluated → skip per plan)
- **Files modified:** 4

## RED / GREEN / REFACTOR narrative

**RED (`32d2761`)** — `test(10-04): add failing FAIL-loud reversible-config rows`
- `tests/config/reversible-raw-keys.test.ts`: 8 rows pinning `readRawReversibleKeys` semantics — supported keys, unknown key (`restore_secrets`), ENOENT, empty file, no-`[reversible]`-table, non-record scalar, malformed-TOML-throws-`ConfigReadError` — plus a frozen-set lock on `SUPPORTED_REVERSIBLE_KEYS`.
- `tests/doctor/checks.test.ts` Tests 18–21 appended in a NEW describe (Tests 15–17 byte-untouched, additions-only diff verified): user-layer offender, project-layer typo (`ttl_hour`), both-layers aggregate with user-first ordering, and a full `toEqual` byte-shape lock on the FAIL detail.
- Confirmed RED: 12 failed (8 on missing exports, 4 on the current check returning PASS), 20 pre-existing tests still green.

**GREEN (`a3c149c`)** — `feat(10-04): doctor FAILs loud on unknown [reversible] keys`
- `src/config/index.ts` (additive only): `SUPPORTED_REVERSIBLE_KEYS` (`Object.freeze(['enabled', 'ttl_hours'])`) and `readRawReversibleKeys` beside `readConfigLayer`, reusing its readFile + ENOENT-catch + `ConfigReadError`-wrap idioms and returning `Object.keys` of the raw `[reversible]` record before validation drops anything. Zero changes to existing exports, `loadEffectiveConfig`, or validator behavior.
- `src/doctor/checks.ts`: `checkReversibleState` runs the two raw-key reads FIRST inside the existing try/catch — offenders (keys outside the supported set) across BOTH layers aggregate into one FAIL naming each `<file>: <key>` pair, user layer first; no offenders falls through to the verbatim PASS body; any `ConfigReadError` routes to the single existing SKIP site (`checkConfigLoad` owns that FAIL — T-08-10, one root cause never double-FAILs).
- Confirmed GREEN: 91/91 across `tests/config/` + `tests/doctor/checks.test.ts`; full unit project 727 passed / 2 pre-existing skips.

**REFACTOR** — skipped (plan-sanctioned): offender formatting already lives in the named `formatReversibleOffenders` helper and `checkReversibleState` is 44 lines (< 50). Nothing to clean, no commit.

## Locked-surface proof (must_haves)

| Lock | Evidence |
|------|----------|
| Three `REVERSIBLE_DETAIL_*` constants byte-identical | `grep -c` = 5 matching lines before and after the edit; Tests 15–17 pass unmodified via `toEqual` |
| LOCKED exit-code map (1,2,3,4,6) untouched | map comment unedited; FAIL uses the exit 1 Phase 8 reserved for exactly this |
| Malformed config keeps SKIP | Test 17 passes unmodified; `ConfigReadError` from raw reads hits the same single SKIP site |
| Scan never routes through the tolerant loader | `readRawReversibleKeys` referenced 4x in checks.ts; `loadEffectiveConfig` remains only in the pre-existing PASS body + checkConfigLoad |
| `src/doctor/index.ts` zero edits | `git diff --stat e950d76..HEAD -- src/hook src/detect src/placeholder src/doctor/index.ts` empty (doctor wiring already pushes check 8 and aggregates exitCodeOnFail) |
| Typecheck baseline held | 38 errors before and after; the 4 touching `src/doctor/` are all in untouched `bench.ts`/`version-check.ts` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fresh worktree had no node_modules**
- **Found during:** Pre-Task-1 environment check
- **Issue:** Parallel-executor worktree is created without `node_modules`; no test could run
- **Fix:** `npm ci --no-audit --no-fund` (lockfile-pinned restore of the committed dependency set — no new packages added, so the package-install checkpoint exclusion does not apply)
- **Files modified:** none (environment only)
- **Commit:** n/a

No other deviations — plan executed as written. The REFACTOR commit skip is the plan's own "skip the commit if nothing to clean" branch, not a deviation.

## Threat Model Disposition

All four register rows implemented as mitigations:
- **T-10-04-01** (silent unknown-key tolerance): raw-layer scan sees keys pre-validation; FAIL exit 1 names file + key; Tests 18–21 lock it.
- **T-10-04-02** (config-widened restore, e.g. `restore_secrets = true`): any unrecognized key FAILs — planted `restore_secrets` is the primary test fixture.
- **T-10-04-03** (over-broad FAIL / noisy doctor): FAIL set = unknown keys ONLY (A1 pin); win32+enabled adds no copy; existing rows byte-locked.
- **T-10-04-04** (malformed double-FAIL): `ConfigReadError` → existing SKIP; `checkConfigLoad` keeps sole ownership of that FAIL.

No new threat surface beyond the plan's register — no Threat Flags.

## Known Stubs

None — the FAIL branch, helper, and all test rows are fully wired to real behavior.

## Next Phase Readiness

- 10-06 can now source `SUPPORTED_REVERSIBLE_KEYS` if its status copy needs the supported set; REVMODE-12 completes when its `mrclean_status` counters land.
- Phase 11's doctor-surface verification inherits a deterministic FAIL matrix: plant any unknown `[reversible]` key in either layer → exit 1 naming file + key.

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| `32d2761` | test(10-04) | RED — 8-row raw-keys suite + doctor Tests 18–21, all failing |
| `a3c149c` | feat(10-04) | GREEN — helper exports + FAIL-loud check upgrade, 727/727 unit green |

## Self-Check: PASSED

- Created files exist (reversible-raw-keys.test.ts, SUMMARY.md) ✓
- Commits 32d2761 + a3c149c present in git log ✓
- readRawReversibleKeys exported from src/config/index.ts ✓
- 'unsupported [reversible] key' present in src/doctor/checks.ts ✓
