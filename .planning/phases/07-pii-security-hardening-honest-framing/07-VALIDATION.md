---
phase: 7
slug: pii-security-hardening-honest-framing
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| **Quick run command** | `npx vitest run --project integration` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project integration`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 7-01-01 | 01 | 1 | PIISEC-01 | T-7-01 / — | No raw PII value reaches audit.jsonl or stderr/error/exception paths | integration | `npx vitest run --project integration` | ❌ W0 | ⬜ pending |
| 7-01-02 | 01 | 1 | PIISEC-02 | — | User-facing copy frames NER as best-effort, never claims guarantee/compliance | integration | `npx vitest run --project integration` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Planner: refine this map per-task during planning — one row per task with concrete file + command.*

---

## Wave 0 Requirements

- [ ] PII leak corpus + forced-failure-path coverage in `tests/audit/canary-leak.test.ts` (extends existing secrets harness) — stubs for PIISEC-01
- [ ] Banned-phrase / copy-drift CI grep test over user-facing string sources — stubs for PIISEC-02

*Existing vitest infrastructure covers framework needs — no install required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Exact disclaimer wording in README PII section / doctor note / CLI banner | PIISEC-02 | Copy stance is a human-review checkpoint (D-07) | Read README PII section, run `mrclean doctor`, run CLI banner; confirm "best-effort ML PII hint, not a guarantee" stance, no overclaiming |

*Automated banned-phrase gate covers drift; wording quality is the manual sign-off.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
