---
phase: 6
slug: ner-inference-l6b-mcp-wiring
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-02
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/detect` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/detect`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 1 | NER-01 | — | N/A | unit | `npx vitest run tests/detect` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Planner fills this map per task during planning.*

---

## Wave 0 Requirements

- [ ] `tests/detect/layer6b-ner.test.ts` — stubs for NER-01..NER-04
- [ ] `tests/mcp/*.test.ts` — stubs for MODEL-04 MCP wiring
- [ ] Existing vitest infrastructure covers framework needs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live MCP server handshake under Claude Code | MODEL-04 | Requires real Claude Code session | Run `mrclean serve`, connect, observe sanitize round-trip |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
