---
phase: 9
slug: session-state-adapter
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-17
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.x (unit + integration + uat projects) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --project=unit <changed test files>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~90 seconds (full; integration project sequential, rebuilds dist via globalSetup) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project=unit <touched suites>`
- **After every plan wave:** Run `npm test` (baseline after 08-12: 642 passed / 14 skipped, exit 0)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled by planner — one row per task; REVMODE-02/04/05/06/07 must each appear) | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/session/` (new suite directory) — store envelope, key custody, allocation, janitor unit stubs
- [ ] Multi-process stress harness fixture (SC5 — child-process spawner; RESEARCH §Validation Architecture has the validated shape)
- [ ] No framework install needed — vitest projects already configured; new `tests/session/**` must be routed to the correct vitest project (unit for pure logic, integration for real-fs/multi-process)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator inspection of `~/.mrclean/sessions/` shows ciphertext only | REVMODE-02 (SC1) | Human-eye acceptance framing in SC1; automated equivalent exists (entropy/parse assertion on dir contents) so manual pass is a spot-check | `ls -la ~/.mrclean/sessions/ ~/.mrclean/keys/` during an enabled session; open a .map file — must be binary/ciphertext |

*All other phase behaviors have automated verification (incl. chmod/corrupt/absent-map chaos cases as unit tests per RESEARCH).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
