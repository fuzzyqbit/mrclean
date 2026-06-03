---
phase: 07-pii-security-hardening-honest-framing
plan: 02
subsystem: mcp-tools
tags: [pii, ner, honest-framing, mcp, zod, dto]
requires:
  - "src/detect/findings.ts Finding.source union (incl. 'pii-ner')"
  - "src/detect/index.ts ResolvedFinding (carries source at map time)"
  - "src/mcp/tools/check.ts + redact.ts findingSchema/toFindingDTO (03-01)"
  - "DetectionResult.nerStatus (06-03)"
provides:
  - "bestEffort: boolean on the per-finding MCP DTO in mrclean_check + mrclean_redact"
  - "machine-distinguishable probabilistic NER lane (SC-3 / D-06)"
affects:
  - "any programmatic MCP consumer reading structuredContent.findings[]"
tech-stack:
  added: []
  patterns:
    - "typed-boolean-not-free-text flag derived from source at map time (mirrors nerStatus enum discipline)"
key-files:
  created:
    - .planning/phases/07-pii-security-hardening-honest-framing/07-02-SUMMARY.md
    - .planning/phases/07-pii-security-hardening-honest-framing/deferred-items.md
  modified:
    - src/mcp/tools/check.ts
    - src/mcp/tools/redact.ts
    - tests/mcp/check.test.ts
    - tests/mcp/redact.test.ts
decisions:
  - "bestEffort is always-emitted (not optional) for a stable, predictable schema (Open Question 2)"
  - "value derived purely from source === 'pii-ner'; source never serialized (Pitfall 4 / T-07-02-01)"
  - "pii-ner finding driven via vi.spyOn mock (model-free), mirroring redact T5 budgetExhausted precedent"
metrics:
  duration: ~10m
  completed: 2026-06-03
  tasks: 1
  files: 4
---

# Phase 7 Plan 2: bestEffort flag for MCP NER findings Summary

Adds an always-emitted, typed `bestEffort: boolean` to the per-finding DTO in both MCP tools — `true` only for the probabilistic NER lane (`source === 'pii-ner'`), `false` for every deterministic finding — delivering the D-06 slice of PIISEC-02 (SC-3) without per-finding visual noise and without ever exposing matched PII.

## What Was Built

- `findingSchema` in `src/mcp/tools/check.ts` and `src/mcp/tools/redact.ts` gained `bestEffort: z.boolean()` (typed, never free text — cannot carry matched PII per T-07-02-01).
- `toFindingDTO` in both tools derives `bestEffort: f.source === 'pii-ner'` at map time. `source` is read locally but never added to the schema or serialized (Pitfall 4).
- The two tools remain exact mirrors (schema + mapper).
- Unit coverage added in `tests/mcp/check.test.ts` (T6 deterministic → false, T7 mocked pii-ner → true) and `tests/mcp/redact.test.ts` (mirror T6/T7). The NER finding is driven via a `vi.spyOn` mock of the detection layer (no model download), following the existing redact T5 pattern.

## TDD Gate Compliance

- RED commit: `52c952d` test(07-02) — 4 new assertions failed (bestEffort undefined), 10 existing passed.
- GREEN commit: `aa0344c` feat(07-02) — all 14 tests pass.
- REFACTOR: none (single-field additive change; skipped per plan).
- Gate sequence (test → feat) present in git log. Compliant.

## Verification

- `npx vitest run tests/mcp/check.test.ts tests/mcp/redact.test.ts` → 14 passed.
- `npx vitest run tests/mcp/check-redact-ner.test.ts` → 4 passed (no regression).
- `grep -c bestEffort src/mcp/tools/check.ts` = 3, `redact.ts` = 3 (>= 2 each).
- `grep "bestEffort: f.source === 'pii-ner'"` present in both files.
- `grep "bestEffort: z.boolean"` present in both files (typed boolean, not string).
- `npm run typecheck` clean for `src/mcp/tools/check.ts` and `src/mcp/tools/redact.ts` (schema ↔ z.infer DTO consistent; `source` not added to findingSchema).

## Deviations from Plan

None — plan executed as written. The plan's suggested NER driver (`tests/mcp/check-redact-ner.test.ts`) runs with NER disabled and produces no real `pii-ner` finding, so the model-free `vi.spyOn` mock (explicitly sanctioned by the plan's reference to the redact T5 mock precedent) was used to synthesize a `pii-ner` finding. This is the planned approach, not a deviation.

## Deferred Issues

Pre-existing project-wide test-typecheck debt was surfaced by `npm run typecheck` but is OUT OF SCOPE (not caused by this plan's changes). Logged to `deferred-items.md`. Notably `tests/mcp/redact.test.ts:240` (the pre-existing T5 budgetExhausted mock) omits the `nerStatus` field added in 06-03 — the two new 07-02 mocks correctly include it. None affect the runtime build or 07-02 test outcomes.

## Threat Surface

No new security-relevant surface. `bestEffort` is a derived boolean; `source`/`value`/`span` remain excluded from the DTO (T-07-02-01 mitigated). No new dependency added (T-07-02-SC).

## Scope Note

This plan owns ONLY D-06 (machine-readable flag). The user-facing honest-framing copy (D-05 disclaimer surfaces), framing stance (D-07), and banned-phrase CI test (D-08) are delivered in 07-03. Together 07-02 + 07-03 cover all of PIISEC-02.

## Self-Check: PASSED

- src/mcp/tools/check.ts — FOUND (bestEffort schema + derivation)
- src/mcp/tools/redact.ts — FOUND (bestEffort schema + derivation)
- tests/mcp/check.test.ts — FOUND (T6/T7)
- tests/mcp/redact.test.ts — FOUND (T6/T7)
- Commit 52c952d (RED) — verified in git log
- Commit aa0344c (GREEN) — verified in git log
