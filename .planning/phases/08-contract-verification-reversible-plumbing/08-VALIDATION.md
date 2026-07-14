---
phase: 8
slug: contract-verification-reversible-plumbing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-14
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit + integration projects) |
| **Config file** | `vitest.config.ts` (unit parallel; integration owns globalSetup tsup --clean) |
| **Quick run command** | `npx vitest run --project=unit` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~60 seconds (full, incl. integration rebuild) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project=unit`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled by planner) | | | REVMODE-10 / REVMODE-03 | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Existing suites are the byte-identical gate (SC2): full suite must pass unchanged with `[reversible]` absent
- [ ] Live contract experiments live in `tests/uat/` (UAT-2b precedent, opt-in, not CI-gating)

*Existing infrastructure covers all phase requirements — no new framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live headless contract experiments (E1–E4) | REVMODE-10 | Requires live Claude Code session + API credit; opt-in harness | Run UAT harness per RESEARCH.md experiment plan; record verdicts per CC version |
| Upstream feature request filed | REVMODE-10 | Outward-facing GitHub action; operator checkpoint | Operator reviews draft, files issue, links URL back into docs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
