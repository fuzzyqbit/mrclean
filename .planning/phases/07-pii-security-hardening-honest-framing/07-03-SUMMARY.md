---
phase: 07-pii-security-hardening-honest-framing
plan: 03
subsystem: framing-and-ci
tags: [pii, ner, honest-framing, copy-drift, ci, mcp, doctor, hook]
requires:
  - "src/shared/sanitize-output.ts sanitizeForOutput chokepoint (07-01)"
  - "src/mcp/tools/check.ts + redact.ts findingSchema/toFindingDTO (07-02)"
  - "src/hook/handlers/session-start.ts additionalContext banner return"
  - "src/doctor/report.ts renderReport"
  - ".github/workflows/canary-leak.yml secrets leak job"
provides:
  - "PII_BEST_EFFORT_DISCLAIMER single source of truth (src/shared/strings.ts)"
  - "disclaimer surfaced once-per-output on README + doctor + SessionStart banner + MCP tool descriptions (D-05/D-07)"
  - "copy-drift banned-phrase build gate (tests/copy-drift.test.ts, D-08)"
  - "canary-leak.yml PII leak-test CI job + belt-and-suspenders grep (PIISEC-01 CI)"
  - "MCP check/redact isError text routed through sanitizeForOutput (D-03)"
affects:
  - "all user-facing PII/NER copy surfaces"
  - "CI gate on user-facing strings"
tech-stack:
  added: []
  patterns:
    - "single-source-of-truth string constant fanned out to all surfaces"
    - "claim-shape (not bare-term) banned-phrase regexes to avoid self-tripping on the honest disclaimer"
    - "SessionStart disclaimer via additionalContext append (banner.ts kept pure)"
key-files:
  created:
    - .planning/phases/07-pii-security-hardening-honest-framing/07-03-SUMMARY.md
    - src/shared/strings.ts
    - tests/copy-drift.test.ts
  modified:
    - src/mcp/tools/check.ts
    - src/mcp/tools/redact.ts
    - src/doctor/report.ts
    - src/hook/handlers/session-start.ts
    - tests/hook/handlers.test.ts
    - README.md
    - docs/SCOPE-FENCE.md
    - .github/workflows/canary-leak.yml
decisions:
  - "SessionStart disclaimer appended to additionalContext (banner + '\\n' + DISCLAIMER), NOT stderr; buildBanner kept pure; Test 7 BANNER_PATTERN updated to first-line + disclaimer-presence (plan-checker blocker fix)"
  - "doctor disclaimer on renderReport trailing line (ALWAYS printed), not the conditional checkModelCache detail (SC-3 surface coverage)"
  - "banned-phrase gate bans claim SHAPES only ('redacts all PII', 'GDPR compliant'); 'not a guarantee' passes by design (Pitfall 5)"
  - "README line rephrased 'does not claim to redact all PII' -> 'does not promise complete PII coverage' because the literal claim-shape trips the strict gate even inside a negation"
  - "human copy-review checkpoint (D-07) approved 2026-06-03"
metrics:
  duration: ~11m
  completed: 2026-06-03
  tasks: 5
  files: 9
---

# Phase 7 Plan 3: Honest Framing + Copy-Drift Gate + CI Wiring Summary

Frames the PII/NER layer honestly on every surface it appears, locks that framing against future copy-drift with a build gate, wires the PIISEC-01 leak test into CI, and closes the D-03 MCP isError chokepoint gap. Delivers the D-05/D-07/D-08 half of PIISEC-02 plus the CI gate + isError routing for PIISEC-01.

## What Was Built

- **Single source of truth** (`src/shared/strings.ts` → `PII_BEST_EFFORT_DISCLAIMER`): "PII/NER detection is a best-effort ML hint, not a guarantee — NER false negatives can leak; for data that must not leak, rely on words.txt and the deterministic layers (secrets + checksummed PII)."
- **Four surfaces, once per output (D-05):**
  1. MCP tool descriptions — constant appended to `mrclean_check` + `mrclean_redact` descriptions.
  2. `mrclean doctor` / CLI report — dimmed trailing line on every `renderReport` run (always printed, model-state independent).
  3. SessionStart banner — appended to `additionalContext` as `banner + '\n' + DISCLAIMER`; `buildBanner` stays pure.
  4. README §9 ("PII and NER detection — best-effort, not a guarantee") — expanded D-07 prose stance.
- **Copy-drift gate (D-08)** — `tests/copy-drift.test.ts` fails the build on compliance/guarantee CLAIM shapes across user-facing string sources; claim-shape regexes only, so the honest disclaimer passes.
- **CI (PIISEC-01)** — `.github/workflows/canary-leak.yml` gains a PII leak-test job running 07-01's leak proof plus a belt-and-suspenders `grep -F`.
- **isError routing (D-03)** — MCP `check`/`redact` error text now flows through 07-01's `sanitizeForOutput`.

## TDD Gate Compliance

- Task 3 copy-drift test committed with a non-vacuous positive control (`0db139f`).
- Task 1 Test 7 (`tests/hook/handlers.test.ts`) updated alongside the additionalContext change (`626fc00`).
- Behavior-adding changes paired with assertions; doc/copy content gated by the copy-drift test.

## Verification

- `npx vitest run tests/copy-drift.test.ts tests/mcp tests/hook tests/doctor` → 138 passed (23 files).
- `node dist/cli.js doctor` → trailing disclaimer prints (confirmed).
- Full suite post-finalize: 574 unit + 118 integration green (run at wave-1 merge; re-confirmed affected set here).
- `grep -c PII_BEST_EFFORT_DISCLAIMER src/shared/strings.ts` = 2 (defined + exported).

## Commits

- `626fc00` feat(07-03): centralize PII disclaimer + surface on all runtime surfaces
- `2a450c6` docs(07-03): add honest PII/NER framing section to README (D-07)
- `0db139f` test(07-03): copy-drift banned-phrase gate + PII CI leak job (D-08)
- `eb02383` fix(07-03): route MCP check/redact isError text through sanitizeForOutput (D-03)
- `build(07-03)` rebuild dist with centralized PII disclaimer + isError routing

## Human Checkpoint (D-07)

Disclaimer wording across all four surfaces was surfaced for human copy-review (blocking, not auto-approved) and **approved 2026-06-03**.

## Deviations from Plan

- One README line rephrased from "does not claim to redact all PII" → "does not promise complete PII coverage": the literal claim-shape `redact all PII` trips the strict copy-drift gate even inside a negation. Kept the gate strict rather than carving a negation exception.

## Orchestration Note

This plan ran SEQUENTIAL on the main working tree (no worktree isolation) — single-plan wave, zero parallelism benefit, and it sidestepped the worktree-contamination incident that affected 07-01. Finalized by the orchestrator after checkpoint approval (rebuild dist, SUMMARY, tracking) because the SDK has no SendMessage to resume the paused executor.

## Self-Check: PASSED

- src/shared/strings.ts — FOUND (PII_BEST_EFFORT_DISCLAIMER)
- src/doctor/report.ts — FOUND (trailing disclaimer line)
- src/hook/handlers/session-start.ts — FOUND (additionalContext append)
- tests/copy-drift.test.ts — FOUND (banned-phrase gate)
- .github/workflows/canary-leak.yml — FOUND (PII leak job)
- Commits 626fc00 / 2a450c6 / 0db139f / eb02383 — verified in git log
