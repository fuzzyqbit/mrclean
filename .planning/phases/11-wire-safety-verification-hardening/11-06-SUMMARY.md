---
phase: 11-wire-safety-verification-hardening
plan: "06"
subsystem: ci
tags: [github-actions, vitest, anti-vacuity, count-guard, pipefail, canary-corpus, workflow-dispatch, perf-gate, reversible-mode]

# Dependency graph
requires:
  - phase: 11-wire-safety-verification-hardening
    provides: "11-01: tests/hook/dist-parity.test.ts (integration dual-listing) + 11-02: tests/state/fs-interception.test.ts (unit) — the gate files the CI steps name"
  - phase: 09-reversible-state-store
    provides: "chaos.test.ts + stress.test.ts harnesses; handlePostToolUse reversible branch (Step 2b) the perf row measures"
  - phase: 10-operator-restore
    provides: "tests/audit/restore-canary-leak.test.ts + the pinned 10-08 canary corpus (zz-canary-project-path-7g2, kim.canary@zz.invalid, AKIAIOSFODNN7EXAMPLX)"
provides:
  - "canary-leak.yml names every wire-safety suite explicitly with exact-count 'Test Files N passed' guards (unit 3-file + integration 2-file) — zero-file vacuous pass structurally closed (T-11-06-01)"
  - "Defense-in-depth grep loop over the reversible canary corpus (word, email, non-EXAMPLE AWS key) — ::error + exit 1 on any audit-log hit"
  - "test.yml + canary-leak.yml fire from gsd/** pushes and workflow_dispatch — the milestone branch's next push to origin fires the first ubuntu run BEFORE the merge PR"
  - "tests/perf/post-tool-use-reversible.perf.test.ts — reversible PostToolUse p95 gated < 200 ms with overhead delta logged; STATE.md TBD metric now has measured values"
affects: [11-07 THREAT_MODEL finalization, milestone audit, verify-work (A4 ubuntu observation), STATE.md metrics table]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Exact-count anti-vacuity CI guard: `vitest ... | tee /dev/stderr | grep -Eq 'Test Files\\s+N passed'` with `set -o pipefail` as the run block's first line (plain run: is bash -e only — never pipefail)"
    - "Perf block-pair measurement: same handler, two HOME stubs (one-way vs reversible), fresh sid per iteration, non-vacuity probes before trusting the delta"

key-files:
  created:
    - tests/perf/post-tool-use-reversible.perf.test.ts
  modified:
    - .github/workflows/canary-leak.yml
    - .github/workflows/test.yml

key-decisions:
  - "Exact-count guard (N passed) over the RESEARCH's looser [1-9] option — a partial mis-route where one of two files still collects would exit 0 and pass a nonzero-count grep; the exact count fails it"
  - "Task 2 outcome (c) taken as pre-declared by the orchestrator: executing in a worktree on a derived branch — no push, deferred commands documented, A4 flagged open for verify-work"
  - "Perf row carries the chaos win32 visible-skip placeholder (HOME-stub seam is POSIX-only) — consistent with WR-04 precedent, not in the plan text but required for the non-vacuity probe to be honest on win32"

patterns-established:
  - "Sabotage spot-check discipline (10-07): every new count-guarded CI step proven to FAIL under deliberate mis-rooting before commit, output quoted in SUMMARY"

requirements-completed: [REVMODE-11]

# Metrics
duration: 16min
completed: 2026-07-18
---

# Phase 11 Plan 06: Explicit CI Gates, Ubuntu Pre-Run Triggers + Reversible Perf Row Summary

**SC3/SC4 are now literal named build gates — five wire-safety suites invoked explicitly in canary-leak.yml under pipefail + exact-count guards with the reversible canary corpus in the defense-in-depth grep, gsd/** push + dispatch triggers armed so the stress gate's first ubuntu run precedes the milestone-merge PR, and the reversible PostToolUse overhead measured at p95 5.36 ms (delta +2.75 ms vs one-way, 97% headroom under the 200 ms budget)**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-07-18T03:31:15Z
- **Completed:** 2026-07-18T03:47:00Z
- **Tasks:** 3
- **Files modified:** 3 (2 workflows extended, 1 new perf test — 215 lines)

## Accomplishments

### Task 1 — Explicit non-vacuous wire-safety gates (commit 1b583d8)

Two steps appended to `.github/workflows/canary-leak.yml`:

1. **`Wire-safety gates — REVMODE-11 (SC2/SC3 unit + SC1a/SC4 integration)`** — run block's first line is `set -o pipefail`, then:
   - `npx vitest run --project=unit tests/audit/restore-canary-leak.test.ts tests/state/chaos.test.ts tests/state/fs-interception.test.ts | tee /dev/stderr | grep -Eq "Test Files\s+3 passed"`
   - `npx vitest run --project=integration tests/hook/dist-parity.test.ts tests/state/stress.test.ts | tee /dev/stderr | grep -Eq "Test Files\s+2 passed"`

   The step comment states exactly why pipefail is load-bearing: GitHub Actions runs plain `run:` steps with `bash -e {0}` — no pipefail unless `shell: bash` is set — so a non-zero vitest exit whose output still contains an intact "Test Files N passed" line (teardown/unhandled-rejection failure) would otherwise pass the guard silently. The integration pipeline runs after the workflow's existing `npm ci` + `npm run build`; the integration project's globalSetup owns the tsup rebuild.

2. **`Defense-in-depth grep — reversible canary corpus`** — extends the existing array-driven loop pattern with the pinned 10-08 corpus (`zz-canary-project-path-7g2`, `kim.canary@zz.invalid`, `AKIAIOSFODNN7EXAMPLX`) over `.mrclean/audit*.jsonl`, `::error` + `exit 1` on any hit.

**Local proof (exact step commands):**
- Unit pipeline: `Test Files  3 passed (3)` / `Tests  12 passed | 3 skipped (15)` → guard PASS
- Integration pipeline: `Test Files  2 passed (2)` / `Tests  2 passed | 1 skipped (3)` → guard PASS

**Sabotage spot-check (10-07 discipline)** — the integration files deliberately mis-rooted into `--project=unit`:

```
 RUN  v4.1.6 /Users/.../agent-a16c6cc77d3222783
No test files found, exiting with code 1
→ SABOTAGE: GUARD FAILED AS EXPECTED (count guard works)
```

Zero files collected; the count grep found no "Test Files 2 passed" and the pipeline failed. Note: on vitest 4.1.6 this invocation shape ALSO exits 1 itself — the guard is belt-and-suspenders on top of that: (a) `pipefail` preserves any non-zero vitest exit through the pipe, and (b) the **exact-count** grep additionally fails a *partial* mis-route (e.g. 1 of 2 files collected and passing prints "Test Files 1 passed", exits 0, and would slip past both pipefail and a loose nonzero-count grep).

**Planted-canary spot-check** — a scratch line containing `zz-canary-project-path-7g2` written to `.mrclean/audit-scratch-spotcheck.jsonl`, exact loop body executed:

```
{"type":"WORD","value":"zz-canary-project-path-7g2","note":"planted scratch line"}
::error::Reversible canary leak: 'zz-canary-project-path-7g2' found in audit log
LOOP_EXIT=1 (expected 1 with planted canary)
scratch file removed
```

### Task 2 — workflow_dispatch + gsd/** push triggers (commit 422a362)

Both workflows' `on:` blocks now carry `workflow_dispatch:` and push branches widened from `[main]` to `[main, 'gsd/**']`. `pull_request` remains `[main]` only (PR gating unchanged). No secrets or permissions added; both files re-validated as parseable YAML.

**Ubuntu run outcome: (c) — documented deferral.** `git branch --show-current` → `worktree-agent-a16c6cc77d3222783` (parallel-executor worktree, not the milestone branch). Pushing a non-milestone derived branch is prohibited; the observation transfers to the orchestrator/verify-work after merge. **A4 remains OPEN** until the following commands are run from the milestone branch:

```bash
# from gsd/v3.0-reversible-redact-mode-foundations-operator-restore after this wave merges:
git push origin gsd/v3.0-reversible-redact-mode-foundations-operator-restore
# the push itself fires both workflows (the gsd/** trigger is self-verifying — it ships on the very push that fires it)
gh run list --workflow=test.yml --branch gsd/v3.0-reversible-redact-mode-foundations-operator-restore --limit 1
gh run watch <run-id> --exit-status   # tolerate the multi-minute 3-Node matrix
gh run list --workflow=canary-leak.yml --branch gsd/v3.0-reversible-redact-mode-foundations-operator-restore --limit 1
gh run watch <run-id> --exit-status
```

Contingency if the stress deadline flakes on ubuntu (outcome (b)): per T-09-08-06, re-measure and raise ONLY `WORKER_DEADLINE_MS` (`tests/state/stress.test.ts` line 59) with a measured-margin comment — the zero-degrade assertion is never the knob.

### Task 3 — Reversible PostToolUse overhead perf row (commit 90bdeb1)

`tests/perf/post-tool-use-reversible.perf.test.ts` (integration project via the existing `tests/perf/**` glob — zero config edits; perf.yml picks it up unchanged). Two measured blocks drive the REAL `handlePostToolUse` with the chaos secret-bearing payload and a fresh `randomUUID()` session_id per iteration (full config-load + bootstrap + hydrate/persist/lock cost every event): block 1 under `makeHome(false)` (one-way), block 2 under `makeHome(true)` (`[reversible] enabled = true`). N=50, WARMUP=5, manual p95 identical to the analog. Non-vacuity before numbers: the reversible sample matches `V2_TAIL_PROBE` (duplicated non-global constant), the baseline sample does not; raw secret absent from both.

**Measured values (executor machine, 2026-07-18, N=50) — closes the STATE.md "Reversible-mode PostToolUse overhead — TBD (Phase 9/11)" row:**

```
[perf] PostToolUse reversible p95=5.36ms, one-way baseline p95=2.60ms,
       overhead delta=2.75ms (N=50, threshold=200ms, headroom=97%)
```

The delta (+2.75 ms) sits inside the research estimate band (~4–8 ms typical for the full reversible event; detection remains the dominant cost). For the state updater: suggested metric cell — `p95 5.36 ms reversible / 2.60 ms one-way, delta +2.75 ms (11-06 perf row, executor machine, 50 iterations)`.

## Verification

| Check | Result |
|-------|--------|
| Exact unit step command (3-file count guard) | PASS — `Test Files  3 passed (3)` |
| Exact integration step command (2-file count guard) | PASS — `Test Files  2 passed (2)` |
| Sabotage mis-rooting fails the guard | PASS — zero files, guard failed as expected |
| Planted canary makes grep loop exit 1 | PASS — `::error` emitted, exit 1, scratch removed |
| `grep workflow_dispatch + gsd/**` both workflows | PASS |
| `pull_request` still main-only in both | PASS |
| `npx vitest run --project=integration tests/perf/` | PASS — `Test Files  4 passed (4)` (3 existing + new row) |
| Full integration project | PASS — 23/23 files (observed during perf measurement run) |
| `npm test` | PASS — 105 files passed, 2 skipped; 975 tests passed, 29 skipped |
| `npm run typecheck` | PASS — exactly the 38-error baseline |
| `randomUUID` inside iteration loops | PASS (warmup + measured loops) |
| Zero edits to src/** or vitest.config.ts | PASS — commits touch only the 2 workflows + 1 new test |

Reporter note (not a defect): vitest 4.1.6's default reporter in this non-TTY environment does not surface in-test `console.log` lines (the shipped analog behaves identically); measured values were captured via `--disable-console-intercept`. The perf GATE is the `expect(reversible.p95Ms).toBeLessThan(THRESHOLD)` assertion, which is reporter-independent.

## Deviations from Plan

None — plan executed as written. Task 2's outcome (c) is one of the plan's three pre-sanctioned outcomes (worktree/derived-branch execution → documented deferral), pre-declared by the orchestrator; `tests/state/stress.test.ts` was NOT touched (its files_modified entry was conditional on outcome (b) only).

## Known Stubs

None.

## Threat Flags

None — no new security surface beyond the plan's threat model. T-11-06-01 mitigated (count guards + pipefail + sabotage proof), T-11-06-02 not exercised (no knob change — outcome (c)), T-11-06-03 accepted as designed (corpus values are synthetic markers; the grep prints values only on failure).

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 1b583d8 | ci(11-06): explicit non-vacuous wire-safety gates + reversible corpus greps (SC3/SC4 elevation) |
| 2 | 422a362 | ci(11-06): workflow_dispatch + gsd/** push triggers — ubuntu pre-run before milestone merge |
| 3 | 90bdeb1 | test(11-06): reversible PostToolUse overhead perf row — p95 budget + delta logged |

## Next-Step Handoff (verify-work / orchestrator)

1. **A4 retirement (open):** after merging this wave to the milestone branch, push and observe the first ubuntu runs of test.yml + canary-leak.yml using the exact commands in Task 2 above. Green → record "stress gate green on ubuntu-latest first run; 500 ms harness deadline held; A4 retired". Flake → outcome (b) knob procedure (WORKER_DEADLINE_MS only).
2. **STATE.md metric update (orchestrator-owned):** replace the "Reversible-mode PostToolUse overhead — TBD (Phase 9/11)" row with the measured values above.

## Self-Check: PASSED

- All 3 task artifacts + SUMMARY exist on disk
- All 3 task commits present in git log (1b583d8, 422a362, 90bdeb1)
- must_haves artifact contents verified: canary-leak.yml contains "dist-parity" + pipefail first line, test.yml contains "workflow_dispatch", perf row contains "handlePostToolUse"
