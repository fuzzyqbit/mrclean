---
phase: 08-contract-verification-reversible-plumbing
plan: 10
subsystem: testing
tags: [uat, hook-contract, findings-durability, tdd, gap-closure, vitest]

# Dependency graph
requires:
  - phase: 08-contract-verification-reversible-plumbing (plan 08-08)
    provides: buildFindingsArtifact pure findings assembly module + offline unit suite
provides:
  - buildE1 per-tool carry-forward (fresh -> previous -> stub) with merged-map verdict derivation
  - Partial-rerun unit tests whose previousArtifact() fixture carries populated E1.tools (closes the tools: {} coverage hole)
  - Module header CARRY-FORWARD guarantee now factually true for E1 per-tool records
affects: [contract-verification harness reruns, 08-VERIFICATION gap 1, HOOK-CONTRACT.md E1 evidence durability]

# Tech tracking
tech-stack:
  added: []
  patterns: [per-field carry-forward resolution (fresh -> previous -> stub) shared conceptually with resolveExperiment, verdict derivation from merged output map instead of raw run input]

key-files:
  created: []
  modified:
    - tests/uat/findings-builder.ts
    - tests/uat/findings-builder.test.ts

key-decisions:
  - "Followed the 08-REVIEW.md CR-01 fix sketch verbatim as the authoritative design (toolRecord helper, recordAt(prevE1, 'tools') lookup)"
  - "Derived E1 verdict from typed toolEntries tuples instead of indexing the Object.fromEntries result — holds the 36-error typecheck baseline without a cast"
  - "Skipped the REFACTOR gate: unifying toolRecord with resolveExperiment would generalize over different stub shapes and source maps for no real repetition pressure (YAGNI)"

patterns-established:
  - "Merged-map verdict derivation: summary strings must read the OUTPUT map (post carry-forward), never the raw run input"
  - "Fixture fidelity: previousArtifact() test fixtures mirror the committed artifact's populated shape so durability tests cannot vacuously pass"

requirements-completed: [REVMODE-10]

# Metrics
duration: 8min
completed: 2026-07-15
---

# Phase 8 Plan 10: buildE1 Per-Tool Carry-Forward Summary

**buildE1 now carries E1 per-tool records forward individually (fresh -> previous -> stub) and derives the verdict string from the merged tool map, closing the CR-01 partial-rerun evidence-destruction path — proven RED-first offline and by repro against the real committed artifact, zero live tokens.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-15T00:37:53Z
- **Completed:** 2026-07-15T00:45:30Z
- **Tasks:** 2/2 (RED + GREEN; REFACTOR skipped intentionally)
- **Files modified:** 2

## Accomplishments

- Closed 08-VERIFICATION.md gap 1 (review CR-01, Critical): a partial harness rerun recording only E2 now leaves the committed E1 per-tool verdicts ("Bash: ignored (original output reached the model unchanged); Read: ignored (original output reached the model unchanged); MCP: honored") byte-identical — verified against the REAL committed `tests/uat/artifacts/contract-findings.json` (repro printed `true`).
- Closed the `tools: {}` coverage hole named by the verifier: `previousArtifact()` now mirrors the committed artifact's populated E1.tools and full-format verdict string, so a future carry-forward regression fails 3 named tests instead of passing vacuously.
- The module header guarantee ("stubs appear only when NEITHER side has the record", findings-builder.ts lines 15-19) is now factually true for E1 per-tool records and states so explicitly.

## Task Commits

Each task was committed atomically (TDD gate order: test before feat):

1. **Task 1 (RED): failing partial-rerun tests with populated previous E1.tools** - `066e2d3` (test) — 3 failed / 6 passed, failures were not-run stubs destroying committed evidence (right-reason RED)
2. **Task 2 (GREEN): buildE1 per-tool carry-forward** - `2038e45` (feat) — 9/9 passed; REFACTOR gate skipped (no cleanup emerged)

## Files Created/Modified

- `tests/uat/findings-builder.ts` - buildE1 resolves prevTools via `recordAt(prevE1 ?? {}, 'tools')`, adds a `toolRecord` helper (fresh spread copy -> previous spread copy -> stub), assembles tools from typed toolEntries, and derives the verdict from the MERGED map; header CARRY-FORWARD bullet updated
- `tests/uat/findings-builder.test.ts` - `previousE1Tools()` fixture mirroring the committed artifact, `freshE2()` guard-passing fixture, `COMMITTED_E1_VERDICT` constant, and 3 partial-rerun tests (disjoint rerun carry, per-tool merge with merged-map verdict, stub-only-when-neither-side)

## Verification Results

- Offline suite: `npx vitest run --project=uat tests/uat/findings-builder.test.ts` -> 9 passed (6 existing + 3 partial-rerun), no MRCLEAN_UAT.
- Real-artifact repro (the verifier's reproduction, inverted): `E1 per-tool evidence survives partial rerun against the REAL committed artifact: true`, exit 0.
- Full regression: `npm test` -> 636 passed | 14 skipped, exit 0.
- `git status --porcelain tests/uat/artifacts/` empty — committed artifact untouched.
- `npm run typecheck` -> 36 errors, unchanged from the 36-error baseline.
- Grep gates: `prevTools` present (2 non-comment occurrences); zero non-comment `run.e1Tools[tool]?.verdict` reads; zero `tools: {}` in the test file; `previousE1Tools` appears 8 times.

## TDD Gate Compliance

- RED gate: `066e2d3` `test(08-10):` — committed first, `git show --stat` lists only tests/uat/findings-builder.test.ts.
- GREEN gate: `2038e45` `feat(08-10):` — committed after RED, lists only tests/uat/findings-builder.ts.
- REFACTOR gate: intentionally skipped per plan instruction — no obvious cleanup emerged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TS2532 from the CR-01 sketch's indexed-access verdict read**
- **Found during:** Task 2 (GREEN), typecheck acceptance criterion
- **Issue:** The review sketch's `tools[tool]['verdict']` read (sketch used an `as Record<string, unknown>` cast) trips `Object is possibly 'undefined'` under the project's index-access checking — 37 errors vs the 36 baseline
- **Fix:** Built `toolEntries` as typed `[tool, record]` tuples once, derived both `tools` (Object.fromEntries) and the verdict string from the same entries — no cast, same merged-map semantics
- **Files modified:** tests/uat/findings-builder.ts
- **Commit:** `2038e45` (folded into the GREEN commit)

## Threat Model Disposition

- T-08-10-01 (Tampering, HIGH): mitigated — per-tool carry-forward proven by failing-first tests plus the real-artifact repro; the T-08-08-01 partial-rerun evidence-destruction path is closed.
- T-08-10-02 (Repudiation): mitigated — fixtures now mirror populated E1.tools; the suite can no longer vacuously pass.
- T-08-10-03 / T-08-10-SC: accepted per plan (pure offline tests, zero package installs).

No new security-relevant surface introduced — no Threat Flags.

## Known Stubs

None — the only `not-run` stub emission is the intended last-resort branch, now provably reachable only when NEITHER the run nor the previous artifact has the record.

## Self-Check: PASSED

- tests/uat/findings-builder.ts: FOUND
- tests/uat/findings-builder.test.ts: FOUND
- 08-10-SUMMARY.md: FOUND
- Commit 066e2d3 (test RED gate): FOUND
- Commit 2038e45 (feat GREEN gate): FOUND
