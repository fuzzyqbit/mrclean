---
phase: 10-operator-restore
plan: 07
subsystem: testing
tags: [fence, trust-boundary, canary, restore, vitest, revmode-01, revmode-08]
requires: [10-05, 10-06]
provides:
  - "Both-direction restore import fences (CI-locked): inbound '/restore/' ban on hook set + full-src confinement to cli.ts's dynamic site; outbound five-pattern allowlist"
  - "tests/restore/mixed-canary.test.ts — real-pipeline mixed-content round-trip (Phase 11 gate substrate, greppable describe name)"
affects: [10-08, phase-11]
tech-stack:
  added: []
  patterns:
    - "allImportSpecifiers total edge scan (static + type + side-effect + re-export + dynamic) layered on the shipped stripComments/walkTsFiles machinery"
    - "offenders-array toEqual([]) + anti-vacuity positive controls (walk floors, exactly-one dynamic import, restore-file floor)"
key-files:
  created:
    - tests/restore/mixed-canary.test.ts
  modified:
    - tests/state/cold-path.test.ts
key-decisions:
  - "Rule 2 exactness: cli.ts's restore edge set asserted toEqual(['./restore/cli.js']) — a second dynamic import of a different restore module trips the fence, not just static imports"
  - "Rule 1 is a total substring ban ('/restore/' anywhere in stripped source of the 9-module hook set) — stricter than the import-specifier scan, per the plan's interface spec"
  - "tools-list SC2 gate runs under --project=unit (its actual routing) after npm run build — the plan's --project=integration invocation matches zero files and passes vacuously"
metrics:
  duration: 13m
  tasks: 2
  files: 2
  completed: "2026-07-17"
---

# Phase 10 Plan 07: Trust-Boundary Fences + Mixed-Content Canary Summary

Both-direction restore import fences (inbound: cli.ts dynamic-site-only with total hook-set ban; outbound: five-pattern allowlist proving no shared kill switch) plus a real-pipeline mixed-content canary — WORD-term round-trips via runRestore while the secret-class AWS placeholder survives byte-identical.

## What Was Built

### Task 1 — Cold-path fence extension (commit 451e94e)

Appended `describe('restore trust-boundary fences (Phase 10)')` to `tests/state/cold-path.test.ts` (161 insertions, existing invariants 1–4 byte-untouched):

- **Rule 1 (INBOUND, hook set):** no module in the 9-file `HOOK_REACHABLE` set contains the substring `'/restore/'` in stripped source at all — runtime, type-only, or dynamic (REVMODE-01 zero-model-facing-surface).
- **Rule 2 (INBOUND, full src/):** `walkTsFiles(SRC)` — every `/restore/` import specifier outside `src/restore/` is an offender except `cli.ts`. Positive controls: walk floor >= 60 (actual: 79), cli.ts restore edge set exactly `['./restore/cli.js']`, `countAwaitImports === 1`, `hasRuntimeStaticImport === false`.
- **Rule 3 (OUTBOUND allowlist):** every import in `src/restore/` must match one of exactly five patterns — `/^node:/`, `/^\.\//`, `/^\.\.\/state\//`, `'../detect/findings.js'`, `'../audit/restore-log.js'`. A `'../config/'` or `'../hook/'` edge turns CI red (REVMODE-08 no-shared-kill-switch structural proof). Positive control: restore walk floor >= 3.

New `allImportSpecifiers` helper sees the TOTAL module-graph edge set (static, `import type`, side-effect, `export ... from` re-exports, dynamic `import()`), built on the file's existing `stripComments` — nothing forked.

### Task 2 — Mixed-content canary (commit bb8cc5e)

Created `tests/restore/mixed-canary.test.ts` (248 lines, unit project via default glob — NOT added to the integration include list):

- Drives TWO real reversible events (hydrate → allocate → drain → persist, the `runReversibleEvent` recipe with `POST_LOCK_DEADLINE_MS`) against a tmp baseDir: `WORD_ORIGINAL = 'zz-canary-project-path-7g2'` as `WORD` (the "fake path" — WORD-typed by design, there is no PATH type) and an X-suffixed fake AWS key as `AWS_KEY` (never the gitleaks-allowlisted EXAMPLE key).
- Placeholders captured from the PERSISTED map (`readSessionMapFile` + `hmacAddress`) — zero hand-formatted tokens (grep: `formatV2Token` appears nowhere in the file); both probed against a local non-global v2 token regex.
- `runRestore({ baseDir, cwd, stdin: Readable.from([doc]) })` with stdout/stderr/exit captured (ignore.test.ts harness precedent; `process.exit` stubbed to throw).
- All four assertion groups green: (1) WORD original on stdout, word token gone, summary `restored >= 1`; (2) AWS placeholder byte-identical on stdout, raw secret absent; (3) `secret-skipped=1` + `sessions=1` (real map read); (4) audit line under injected cwd is hash-only — neither canary raw, parsed record `restored=1 / skippedSecret=1 / hashes.length=1`.

### SC2 re-verification

`npm run build` then `tests/mcp/tools-list.test.ts` — 8/8 green with zero edits: T2 exact-three `['mrclean_check','mrclean_redact','mrclean_status']`, T2b `restore` (and the full FORBIDDEN_TOOL_NAMES list) absent. dist/ reverted to committed state after the build; `git status --porcelain dist/` empty at both commit times.

## Sabotage Spot-Check (required by acceptance criteria)

Temporarily planted `import '../restore/index.js'` at the top of `src/detect/index.ts`:

- Rule 1 FAILED: `detect/index.ts references /restore/`
- Rule 2 FAILED: `detect/index.ts imports ../restore/index.js`
- Both failures named the exact offender in the assertion message; reverted to byte-identical (`git diff` empty), suite back to 9/9 green.

The fences are live, not vacuous (T-10-07-04 mitigated) — mirror of the 09-07 planted-import verification.

## Verification Results

| Check | Result |
|-------|--------|
| `npx vitest run tests/state/cold-path.test.ts tests/restore/mixed-canary.test.ts --project=unit` | 10/10 green |
| `npm run build && tools-list gate` (T2/T2b) | 8/8 green, file unmodified |
| `git diff --stat e950d76..HEAD -- src/hook src/detect src/placeholder tests/placeholder tests/detect` | empty |
| dist/ paths in any commit (`git diff --name-only 880f55d..HEAD`) | none |
| `npm run typecheck` errors in the two plan files | 0 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan verify command for the tools-list gate is vacuous**
- **Found during:** Task 2 verification
- **Issue:** The plan specifies `npx vitest run tests/mcp/tools-list.test.ts --project=integration`, but the file is routed to the **unit** project (it is not in the integration include allowlist in `vitest.config.ts`). The integration invocation matches ZERO files and exits 0 — a vacuous pass of exactly the kind T-10-07-04 targets.
- **Fix:** Ran the gate as `npm run build && npx vitest run tests/mcp/tools-list.test.ts --project=unit` (build first because the test spawns `dist/mcp.js`). Confirmed 8/8 including T2/T2b. No file edits.
- **Files modified:** none
- **Commit:** n/a (verification-only)

### Executor Process Incident (not a plan deviation — operator attention required)

**Accidental `git stash` in a worktree — prohibited operation, recovered, litter remains.**
- **What happened:** During Task 1's typecheck verification, a compound shell command accidentally included `git stash -q`, which ran and stashed the in-progress `cold-path.test.ts` extension onto the SHARED stash stack (`refs/stash` is global across the main checkout and all worktrees).
- **Recovery:** The work was re-applied from executor context and verified byte-identical to the stashed copy via read-only `git show refs/stash:tests/state/cold-path.test.ts | diff` (IDENTICAL), then re-verified 9/9 green before committing. Nothing was lost; commit 451e94e supersedes the stash content entirely.
- **Residual litter:** stash entry `e42c551` ("WIP on worktree-agent-a7b2c3de2f1c70f69") remains at the TOP of the shared stash stack. Per the worktree prohibition, no further `git stash` subcommands (including `drop`) were run. **Operator action:** from the main checkout, verify with `git stash list` / `git stash show -p stash@{0}` that the top entry is the 161-line `tests/state/cold-path.test.ts` insertion, then `git stash drop` it. Until dropped, a `git stash pop` from ANY worktree would apply this stale WIP (#3542 hazard).

### Out-of-scope discoveries

Pre-existing `npm run typecheck` errors in `tests/install/idempotency.test.ts`, `tests/mcp/redact.test.ts`, `tests/mcp/server-ner-preload.test.ts` (present at base 880f55d, zero relation to this plan's files) — logged to `deferred-items.md` in the phase directory, not fixed.

## Known Stubs

None — test-only plan; no production code touched.

## Threat Flags

None — no new network/auth/file surface; both threat-register mitigations for this plan (fences with positive controls, real-pipeline canary) are implemented as specified.

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| 451e94e | test | fence src/restore both directions — cli.ts dynamic site only, allowlist imports |
| bb8cc5e | test | mixed-content canary — WORD round-trips, secret placeholder survives |

## Self-Check: PASSED

- tests/state/cold-path.test.ts — FOUND
- tests/restore/mixed-canary.test.ts — FOUND
- .planning/phases/10-operator-restore/10-07-SUMMARY.md — FOUND
- Commit 451e94e — FOUND
- Commit bb8cc5e — FOUND
