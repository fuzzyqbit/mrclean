---
phase: 11-wire-safety-verification-hardening
plan: 04
subsystem: restore-cli
tags: [degrade-honesty, tdd, revmode-11, in-01]
requires:
  - "10-05: runRestore CLI action (outer belt-and-braces catch, ZERO_COUNTS, degrade matrix)"
provides:
  - "IN-01 hardening: outer catch resets counts to ZERO_COUNTS before summary emission"
  - "Guarded fallback pass-through write — double-throw contained inside the catch"
  - "Degrade rows: late-throw stale-counts row + double-throw containment row"
affects:
  - "11-06 (if any): THREAT_MODEL.md reversible rewrite can cite IN-01 as shipped fact"
tech-stack:
  added: []
  patterns:
    - "Honest degrade: a run whose catch fired reports ZERO work — counts reset is the catch's first statement"
    - "Documented swallow as error handling: innermost fallback failure has nothing safer to do; stderr warning + zero-counts summary are the signal"
key-files:
  created: []
  modified:
    - src/restore/cli.ts
    - tests/restore/degrade.test.ts
key-decisions:
  - "Row 1 throw seam = the main payload stdout write (step 6), stubbed to throw on FIRST call only — the only seam that provably fires the OUTER catch post-counts on current code"
  - "captureRun harness extended additively with stdoutThrows?: 'first' | 'always'; absent means rows (a)-(g) behavior is byte-identical"
duration: 8min
completed: 2026-07-18
---

# Phase 11 Plan 04: Zero-Counts Honesty + Guarded Fallback in Restore Outer Catch Summary

**One-liner:** IN-01 adopted via RED→GREEN — the restore CLI's outer catch now resets counts to ZERO_COUNTS before the summary (never stale restored=1 after a failed delivery) and the fallback pass-through write is try/catch-guarded so a double throw cannot break the exit-0 one-way degrade contract.

## What Was Built

Two-task TDD cycle on the `mrclean restore` degrade path:

1. **RED (`5277436`)** — appended describe block `IN-01: outer-catch honesty — zero counts + guarded fallback` to `tests/restore/degrade.test.ts`:
   - **Row 1 (stale counts):** real encrypted map with one WORD entry, input carrying its v2 token; stdout stub throws on its FIRST call. On pre-fix code the summary read `restored=1 unmatched=0 secret-skipped=0 sessions=1` — a delivery claim for output that never landed. The row asserts the byte-exact `[mrclean] restore: restored=0 unmatched=0 secret-skipped=0 sessions=0` form, LAST on stderr.
   - **Row 2 (double-throw containment):** stdout stub throws on EVERY call — the catch's fallback write also throws. On pre-fix code the rethrow escaped `runRestore` (harness observed the propagated stub error). The row asserts containment: normal resolution, exit 0, warning + zero-counts summary on stderr.
   - Plus a pin-consistency check (`ZERO_SUMMARY === summaryLine(0,0,0,0)`) so the literal can never drift from the shared summary pin.
   - Harness change is additive-only: `captureRun` gained optional `stdoutThrows?: 'first' | 'always'`; the option is destructured out before `runRestore(runOpts)` so the CLI never sees it.

2. **GREEN (`7ae579d`)** — ~11-line edit confined to the catch block of `src/restore/cli.ts`:
   - `counts = ZERO_COUNTS` as the catch's first statement (IN-01a).
   - Fallback `process.stdout.write(input)` wrapped in its own try/catch with a documented no-op body (IN-01b): degrade is one-way — if even the fallback write fails there is nothing safer to do; the warning + zero-counts summary on stderr are the signal.
   - Untouched: imports (zero changes), `stdoutWritten`/`warnedNoMaps` flag logic, audit-specific inner catch, warning constants, summary emission site (still always-last on stderr), exitCode-and-return WR-03 discipline.

## Throw Seam Choice (plan output requirement)

**Chosen seam: the main payload stdout write (step 6), stubbed to throw on its first call.**

Why it provably reaches the OUTER catch after counts exist:

- `counts` is assigned at step (5) — lexically BEFORE step (6)'s `process.stdout.write(result.text)`.
- Step (6) sits inside the outer try but BEFORE `stdoutWritten = true`, so the catch's fallback branch executes (which is exactly what Row 2 needs to double-throw).
- The plan's alternative seam ("a late non-AuditWriteError throw past the audit-specific handler") is **impossible on current code**: the step (7) inner catch is a bare total `catch { }` — no throw raised inside the audit block can ever propagate to the outer catch. The stdout write is therefore the only post-counts statement in the outer try whose throw reaches the outer catch.

## Verification Evidence

| Check | Result |
|-------|--------|
| RED: both rows fail for the RIGHT reasons | Row 1: assertion diff shows stale `restored=1 ... sessions=1`; Row 2: escaped `Error: stdout write stubbed to throw (IN-01 seam)` |
| RED: rows (a)-(g) stay green | 8 passed / 1 skipped (platform-gap visible-skip) alongside the 2 failures |
| GREEN: pinned suites | `degrade.test.ts` + `cli/restore.test.ts` + `state/cold-path.test.ts` — 28 passed / 1 skipped |
| `tests/cli/restore.test.ts` | Green **unmodified** (no harness parameterization needed there — degrade file owns its duplicated-by-value harness) |
| Diff confinement | `git diff` on src/restore/cli.ts: 11 insertions / 1 deletion, all inside the catch block; no import lines |
| Cold-path fence (Rule 3 outbound allowlist) | Green — zero new imports |
| `npm run typecheck` | 38 errors — exactly at baseline |
| Full `npm test` | 101 files passed / 2 skipped; 965 tests passed / 18 skipped |
| TDD gate order | `test(11-04)` 5277436 → `feat(11-04)` 7ae579d |

## Threat Register Outcomes

| Threat ID | Disposition | Outcome |
|-----------|-------------|---------|
| T-11-04-01 (Repudiation — stale counts) | mitigate | `counts = ZERO_COUNTS` first-in-catch; Row 1 byte-exact summary assertion |
| T-11-04-02 (DoS on degrade contract — fallback rethrow) | mitigate | Guarded fallback with documented no-op catch; Row 2 containment + throwing process.exit stub guard |
| T-11-04-03 (Elevation — import widening) | mitigate | Zero import changes; cold-path outbound allowlist fence green in verify |

## Deviations from Plan

**1. [Environment] dist/cli.js rebuilt by `npm test` integration globalSetup — excluded from commits**
- **Found during:** Task 2 verification (full `npm test`)
- **Issue:** The integration project's globalSetup runs `tsup --clean`, rebuilding `dist/cli.js` with worktree-relative shim paths (known worktree pollution, memory-enforced repo policy: never commit dist/ from a worktree)
- **Fix:** `git checkout -- dist/cli.js` (targeted single-file restore to HEAD) before staging; only `src/restore/cli.ts` committed
- **Files modified:** none committed beyond plan scope

No other deviations — plan executed exactly as written.

## Known Stubs

None — the change wires no data paths; `ZERO_COUNTS` is the intentional honest-degrade reset constant, not a placeholder.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 (RED) | 5277436 | test(11-04): add failing outer-catch honesty rows (IN-01) |
| 2 (GREEN) | 7ae579d | feat(11-04): zero counts + guarded fallback in restore outer catch (IN-01) |

## TDD Gate Compliance

RED gate (`test(11-04)`) committed before GREEN gate (`feat(11-04)`); no REFACTOR commit needed (the GREEN edit is already minimal — 11 lines, comment-heavy by design). Both RED rows failed pre-fix for their intended reasons and pass post-fix.

## Self-Check: PASSED

- Files exist: src/restore/cli.ts, tests/restore/degrade.test.ts, 11-04-SUMMARY.md
- Commits exist: 5277436 (RED), 7ae579d (GREEN)
- must_haves contains-checks: ZERO_COUNTS in src/restore/cli.ts; byte-exact zero-summary literal in tests/restore/degrade.test.ts
