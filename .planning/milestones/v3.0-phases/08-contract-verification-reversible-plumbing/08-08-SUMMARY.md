---
phase: 08-contract-verification-reversible-plumbing
plan: 08
subsystem: testing
tags: [uat, hook-contract, findings-durability, tdd, gap-closure]
requires: [08-04]
provides:
  - "buildFindingsArtifact — pure guarded findings assembly (null on zero verdicts, verbatim carry-forward, verbatim_hook_error field fallback)"
  - "E1/Bash-object + E1/Read-object harness legs recording an E1_shape_validation-shaped verdict"
  - "Object-gated E4: prefers the honored Bash-object leg with a ~15K object-shaped fixture"
  - "tests/uat/fixtures/e4-object-large-output-hook.sh (~15K object-shaped updatedToolOutput instrument)"
affects: [08-09]
tech-stack:
  added: []
  patterns:
    - "Pure builder module extracted from test lifecycle hook (no I/O, no vitest imports) so durability logic is unit-testable offline"
    - "Record-don't-assert probes with transcript regex-scan for hook-error excerpts"
key-files:
  created:
    - tests/uat/findings-builder.ts
    - tests/uat/findings-builder.test.ts
    - tests/uat/fixtures/e4-object-large-output-hook.sh
  modified:
    - tests/uat/contract-verification.test.ts
key-decisions:
  - "E1 per-tool verdicts intentionally NOT carried forward (plan-specified carry list: E1.rendering, E1_shape_validation, E2, E3, E4, E5 sub-records) — a partial run honestly reports not-run tools"
  - "E5 re-emits the previous record verbatim only when the run contributed neither sub-record; otherwise sub-record-level merge with re-derived combined verdict"
  - "REQUIREMENTS.md untouched: REVMODE-10 is shared with plan 08-09 (live rerun) — marking complete now would be premature"
metrics:
  duration-minutes: 12
  tasks: 2
  files-changed: 4
completed: 2026-07-14
---

# Phase 8 Plan 08: Findings Durability + Object-Shape Legs Summary

**One-liner:** Pure guarded findings builder (null-guard + verbatim carry-forward, 6 offline unit tests) plus harness-owned E1/Bash-object, E1/Read-object, and object-gated E4 legs with a new ~15K object-shaped fixture — a skipped or broken run can no longer clobber contract-findings.json, and the phase's pivotal shape-validation discovery is reproducible by the committed harness (WR-01/WR-02 closed).

## What Was Built

### Task 1 — Guarded findings builder (TDD)

- **RED** (`0014aa6`): `tests/uat/findings-builder.test.ts` — six offline behaviors (AAA style, no MRCLEAN_UAT gate, no claude spawns): zero-verdict guard returns null; E1.rendering + E1_shape_validation carried verbatim from the committed artifact; run-supplied shapeValidation wins; field-level `verbatim_hook_error` fallback; `not-recorded` stub only when absent from both sides; `pending-interactive` literal only as last resort.
- **GREEN** (`b965dc1`): `tests/uat/findings-builder.ts` — pure `buildFindingsArtifact(previous, run)` (no I/O, no vitest imports, never mutates inputs). Absorbed the afterAll's inline experiments assembly, `missingRecord` stubs, `e1Summary`, and E4 `control_additionalContext` nesting. The afterAll in `contract-verification.test.ts` now reads the committed artifact defensively (parse failure → treated as absent), calls the builder, and **refuses to write on null** ("artifact left untouched" warning). The hardcoded `rendering: 'pending-interactive'` line is gone from the suite file.

### Task 2 — Object-shape legs (`17f6467`)

- **E1/Bash-object** (directly after E1/Bash): wires the previously orphaned `e1-object-rewrite-hook.sh` to a committed test; records `buildE1Verdict` into `e1ObjectBash`; regex-scans the stashed E1/Bash string-leg transcript for the shape-rejection hook error (`updatedToolOutput` + `does not match`/`invalid_type`, ≤600-char excerpt).
- **E1/Read-object**: same object fixture on a `Read` matcher, record-don't-assert — honored / rejected-with-excerpt / indeterminate all close the `read_object_shape` open follow-up. Assembles the module-level `shapeValidationRecord` (verdict wording degrades honestly per observed combination; `verbatim_hook_error` left undefined when not re-observed so the builder's field fallback preserves the committed excerpt) and passes it as `run.shapeValidation`.
- **Object-gated E4**: first preference is `e1ObjectBash?.verdict === 'honored'` → Bash leg with the new `e4-object-large-output-hook.sh` (~15K `{stdout, stderr, interrupted, isImage}` payload, E4 HEAD/TAIL markers); legacy string-form gating is the fallback; the neither-honored verdict now cites the object-leg result instead of the stale "#68951 blocked" premise. HEAD/TAIL verdict derivation unchanged; added `payload_shape` signal.
- Suite header doc updated for both object legs; all new tests live inside the `describe.skipIf(!UAT_ENABLED)` gate.

## Verification Results

| Gate | Result |
|------|--------|
| `npx vitest run --project=uat tests/uat/findings-builder.test.ts` (no MRCLEAN_UAT) | 6 passed, 0 skipped, exit 0 |
| `npx vitest run --project=uat tests/uat/contract-verification.test.ts` (no MRCLEAN_UAT) | 11 skipped (9 existing + 2 object legs), 0 failed |
| `git diff --stat tests/uat/artifacts/` after skipped runs | empty — guard proven, artifact byte-identical |
| `grep -c "pending-interactive" tests/uat/contract-verification.test.ts` | 0 |
| `grep -c "findings-builder" tests/uat/contract-verification.test.ts` | 1 (import wired) |
| `grep -c "e1-object-rewrite-hook"` / `"e4-object-large-output-hook"` in suite | 5 / 3 (WR-02: fixtures no longer orphaned) |
| Fixture hygiene | executable bit set; `isImage` + both E4 markers present; leak-grep (`AKIA\|ghp_\|sk-ant`) clean |
| Typecheck differential | 36 errors before and after — zero new |
| TDD gate order | `test(08-08)` `0014aa6` → `feat(08-08)` `b965dc1` ✓ |

## Deviations from Plan

None — plan executed as written. (Environment note, not a deviation: a PreToolUse commit-guard hook false-positived on the first compound commit command; resolved by running the staged commit as a plain `git commit` — hooks ran normally, nothing bypassed.)

## Known Stubs

None. The `pending-interactive` literal in `findings-builder.ts` is the plan-specified last-resort fallback (Test 6), not a stub; live-run verdict population is plan 08-09's job.

## Threat Model Compliance

- T-08-08-01 (Tampering, HIGH): mitigated — guard + carry-forward proven by 6 offline unit tests before any live run.
- T-08-08-02 (Repudiation): mitigated — e1-object-rewrite-hook.sh wired to E1/Bash-object and E1/Read-object.
- T-08-08-03 (Info disclosure): mitigated — new fixture is marker-strings-only; leak-grep clean.
- T-08-08-04 (DoS): accepted — findings-builder.test.ts is pure, <1s, token-free.
- No new threat surface introduced beyond the plan's register.

## Notes for Plan 08-09 (live rerun)

- Pass `shapeValidation` is already wired — the live run only needs MRCLEAN_UAT=1.
- The writer now guarantees: partial/failed runs merge into (never destroy) the committed artifact; `verbatim_hook_error` survives runs that do not re-observe the string rejection.
- REVMODE-10 left unchecked in REQUIREMENTS.md — 08-09 completes the live-rerun half.

## Self-Check: PASSED

- FOUND: tests/uat/findings-builder.ts
- FOUND: tests/uat/findings-builder.test.ts
- FOUND: tests/uat/fixtures/e4-object-large-output-hook.sh (executable)
- FOUND: commit 0014aa6 (test — RED gate)
- FOUND: commit b965dc1 (feat — GREEN gate)
- FOUND: commit 17f6467 (test — object-shape legs)
