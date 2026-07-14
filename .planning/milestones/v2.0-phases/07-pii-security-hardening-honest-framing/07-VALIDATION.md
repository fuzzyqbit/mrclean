---
phase: 7
slug: pii-security-hardening-honest-framing
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-03
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --project unit` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds (unit); integration adds a tsup build |

---

## Sampling Rate

- **After every task commit:** Run the task's own automated verify (see Per-Task Verification Map)
- **Fast inner-loop signal (< 30s):** `npx vitest run --project unit` (model-free, no build)
- **After every plan wave:** Run `npx vitest run` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30s for the unit inner loop; the audit.jsonl integration leak proof + canary-leak.yml job run the slower build+integration outer loop (cost accepted, see 07-01 Task 3 LATENCY NOTE)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | New Test File | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|---------------|-------------------|-------------|--------|
| 7-01-01 | 01 | 1 | PIISEC-01 | T-07-01-02/03/05 | `sanitizeForOutput` scrubs detected spans (with-context) and emits a static message with no input echo (context-free, D-04); off the <100ms hot path | unit | `tests/shared/sanitize-output.test.ts` | `npx vitest run tests/shared/sanitize-output.test.ts` | ❌ W0 (this task creates it) | ⬜ pending |
| 7-01-02 | 01 | 1 | PIISEC-01 | T-07-01-02/03 | supervisor catch + failclosed stderr writer route raw error text through the chokepoint; raw `err.stack` echo dropped | unit | (no new file — edits `supervisor.ts`/`failclosed.ts`, covered by existing `tests/mcp` + `tests/hook` + the 7-01-03 stderr file) | `npx vitest run tests/mcp tests/hook` | ✅ existing | ⬜ pending |
| 7-01-03 | 01 | 1 | PIISEC-01 | T-07-01-01/04/06 | No raw PII canary reaches `.mrclean/audit.jsonl` (full NER-on pipeline, non-vacuous via wired include + line-count guard) or stderr (three forced-failure paths) | integration + unit | `tests/audit/pii-canary-leak.test.ts` (integration), `tests/audit/pii-stderr-leak.test.ts` (unit) | `npm run build && npx vitest run --project=integration tests/audit/pii-canary-leak.test.ts && npx vitest run --project=unit tests/audit/pii-stderr-leak.test.ts` | ❌ W0 (this task creates both) | ⬜ pending |
| 7-02-01 | 02 | 1 | PIISEC-02 | T-07-02-01/02/03 | Every `pii-ner` finding DTO carries `bestEffort: true`, every deterministic finding `bestEffort: false`; typed boolean, `source`/`span`/`value` stay hidden | unit | (extends `tests/mcp/check.test.ts` + `tests/mcp/redact.test.ts`) | `npx vitest run tests/mcp/check.test.ts tests/mcp/redact.test.ts` | ⚠️ extends existing | ⬜ pending |
| 7-03-01 | 03 | 2 | PIISEC-02 | T-07-03-01/07 | Centralized disclaimer surfaces once-per-output on MCP descriptions, the renderReport trailing line (always printed), and SessionStart additionalContext; banner.ts + checks.ts untouched | unit | (extends `tests/hook/handlers.test.ts` Test 7; covered by `tests/copy-drift.test.ts`) | `npx vitest run tests/mcp tests/hook tests/doctor` | ⚠️ extends existing | ⬜ pending |
| 7-03-02 | 03 | 2 | PIISEC-02 | T-07-03-03 | README PII/NER section frames NER as best-effort (not a guarantee), names words.txt + deterministic layers, consistent with SCOPE-FENCE | unit (content gate) | (README content gated by `tests/copy-drift.test.ts`) | `npx vitest run tests/copy-drift.test.ts` | ❌ W0 (file created in 7-03-03) | ⬜ pending |
| 7-03-03 | 03 | 2 | PIISEC-01, PIISEC-02 | T-07-03-02/04/05 | Copy-drift test fails the build on banned CLAIM phrases (non-vacuous positive control), asserts disclaimer present in README; canary-leak.yml runs 07-01's PII leak test + belt-and-suspenders grep | unit + CI | `tests/copy-drift.test.ts` (+ `.github/workflows/canary-leak.yml` job) | `npx vitest run tests/copy-drift.test.ts` | ❌ W0 (this task creates it) | ⬜ pending |
| 7-03-04 | 03 | 2 | PIISEC-01 | T-07-03-06 | MCP `check`/`redact` isError text routes through `sanitizeForOutput` (D-03), including the budget-exhausted return | unit | (covered by `tests/mcp`) | `npx vitest run tests/mcp` | ✅ existing | ⬜ pending |
| 7-03-05 | 03 | 2 | PIISEC-02 | T-07-03-01 | Human sign-off on disclaimer WORDING across all four surfaces (D-07 stance locked, phrasing reviewed) | manual | (re-runs `tests/copy-drift.test.ts` after any wording edit) | `<human-check>` + `npx vitest run tests/copy-drift.test.ts` | n/a (checkpoint) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

The new test files below are created inside the plan tasks that depend on them (the executor writes the test
RED before the implementation), so there is no separate pre-wave scaffolding task — each is owned by its task above:

- [x] `tests/shared/sanitize-output.test.ts` — created RED in 7-01-01 (chokepoint behavior, PIISEC-01)
- [x] `tests/audit/pii-canary-leak.test.ts` — created RED in 7-01-03 (audit.jsonl integration leak proof, PIISEC-01)
- [x] `tests/audit/pii-stderr-leak.test.ts` — created RED in 7-01-03 (stderr forced-failure leak proof, PIISEC-01)
- [x] `tests/copy-drift.test.ts` — created in 7-03-03 (banned-phrase + disclaimer-presence gate, PIISEC-02)
- [x] `bestEffort` assertions extended into `tests/mcp/check.test.ts` + `tests/mcp/redact.test.ts` — 7-02-01 (PIISEC-02)
- [x] Test 7 (`tests/hook/handlers.test.ts`) updated for the SessionStart disclaimer line — 7-03-01 (PIISEC-02)

*Existing vitest infrastructure covers framework needs — no install required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Exact disclaimer wording in README PII section / doctor trailing note / SessionStart additionalContext / MCP descriptions | PIISEC-02 | Copy stance is a human-review checkpoint (D-07, 07-03 Task 5) | Read README PII section, run `mrclean doctor` (confirm trailing note appears even with NO model cached), inspect SessionStart additionalContext + MCP descriptions; confirm "best-effort ML PII hint, not a guarantee" stance, no overclaiming |

*Automated banned-phrase gate (`tests/copy-drift.test.ts`) covers drift; wording quality is the manual sign-off.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (every code task carries an automated command; 7-03-05 is a human checkpoint that re-runs the copy-drift gate)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (every new test file is owned by the task that creates it RED)
- [x] No watch-mode flags
- [x] Feedback latency < 30s (unit inner loop; audit/CI integration build cost accepted per 07-01 Task 3 LATENCY NOTE)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
