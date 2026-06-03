# mrclean — Living Retrospective

> Per-milestone reflections + cross-milestone trends. Append newest milestone above the trends section.

## Milestone: v2.0 — Native-Node PII/NER Layer

**Shipped:** 2026-06-03
**Phases:** 4 (Phases 4–7) | **Plans:** 12 | **Tasks:** 19

### What Was Built
- PII contracts + architecture foundations: `[pii]` config sub-table (off by default), PII finding-shape + audit-schema, ML deps as `optionalDependencies`, enforced scope fence (no cloud PII APIs, no model-facing unredact, no Presidio sidecar).
- Layer 6a regex structured-PII (email/SSN/credit-card/phone/IP) inside the `<100ms` hot-path budget, through the existing placeholder/audit/allowlist pipeline; model acquisition/cache/integrity infra verifiable via `mrclean doctor`.
- Layer 6b opt-in NER (PERSON/LOC) as a warm singleton in the long-lived MCP server only — never the hook — advisory-by-default, fail-closed-for-NER, model provenance in every PII audit entry; opt-in piiranha tier (cc-by-nc-nd-4.0, operator-approved, pinned SHA-256).
- Security hardening: single `sanitizeForOutput()` error/diagnostic chokepoint (two-mode, never echoes raw input on context-free failures); two-project leak-grep regression (audit.jsonl integration + stderr unit, 3 forced-failure paths); machine-readable `bestEffort` flag on MCP DTOs; honest best-effort framing across README/doctor/banner/MCP descriptions + a copy-drift CI gate.

### What Worked
- Vertical-slice MVP phasing kept each phase independently verifiable via real `npx mrclean` behavior.
- Hot-path fence held end-to-end: NER's ML import boundary is isolated and proven unreachable from the hook by an import-graph test + cold-start perf gate.
- Plan-checker caught a real BLOCKER pre-execution (Phase 7 SessionStart banner used `additionalContext`, not stderr) — fixed in planning, not after shipping.
- Independent verifier ran its own probes rather than trusting SUMMARYs.

### What Was Inefficient
- A parallel worktree executor (Phase 7, 07-01) leaked a partial duplicate onto the orchestrator branch (cwd-drift class), forcing a reset+remerge recovery. Mitigation adopted: run single-plan waves sequentially; verify git state before merge.
- Milestone branch diverged 99 commits ahead of `origin` (nothing pushed across v2.0), making the standard fork-off-origin assumptions wrong — handled by branching off local HEAD.
- The decision-coverage gate first read stale (pre-citation) state, costing an investigation detour before a re-run passed 7/7.

### Patterns Established
- Single-source-of-truth string constant fanned out to all user-facing surfaces, with a copy-drift CI gate banning claim *shapes* (not bare negated terms).
- Error-path-only sanitization chokepoint mirroring the audit no-raw-value single-sink discipline.
- Typed-boolean advisory flag derived from `finding.source` at map time (never serializes raw PII).

### Key Lessons
- For a security tool, an error message leaking the PII it scrubs is the worst-case trust failure — defense-in-depth (runtime chokepoint + regression test) beats test-only.
- Worktree isolation is not free of contamination risk; verify orchestrator git state before merging parallel executors.

### Cost Observations
- Model mix: Opus on all GSD subagents (per project preference).
- Notable: parallel Wave-1 executors saved wall-clock but introduced the contamination recovery cost; single-plan Wave 2 ran sequentially and cleanly.

---

## Cross-Milestone Trends

| Milestone | Phases | Plans | Shipped | Notable |
|-----------|--------|-------|---------|---------|
| v1.0 MVP | 1–3 | — | 2026-05-14 | In-session secret redaction, MCP tools, public release |
| v2.0 Native-Node PII/NER | 4–7 | 12 | 2026-06-03 | Opt-in PII/NER, no Python/egress, hot-path-safe, honest framing |

**Recurring strengths:** layered detection; perf-budget discipline; verifier independence.
**Recurring watch-items:** unpushed-branch divergence; worktree-executor contamination.
