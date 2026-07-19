# mrclean — Living Retrospective

> Per-milestone reflections + cross-milestone trends. Append newest milestone above the trends section.

## Milestone: v3.0 — Reversible Redact Mode — Foundations + Operator Restore

**Shipped:** 2026-07-18 (audited 2026-07-18, archived 2026-07-19)
**Phases:** 4 (Phases 8–11) | **Plans:** 37 | **Tasks:** ~67 | **Timeline:** 4 days | **Commits:** 306

### What Was Built
- Contract verification + reversible plumbing: hook-contract unknowns settled empirically in live headless sessions (object-shaped `updatedToolOutput` IS honored for Bash, no 10K cap), `[reversible]` config table with zero-behavior-change default.
- Encrypted session-scoped state adapter: AES-256-GCM placeholder→original map, content-addressed allocation (16-process stress-proven collision-free), structural secret floor, reason-aware janitor + TTL sweep.
- Operator-only `mrclean restore` CLI: single-pass exact-lookup engine, 7-row fail-one-way degrade matrix, hash-only audit, zero model-facing surface.
- CI adversarial wire-safety proof: dist-parity, fs-write interception, chaos, 8–16-process concurrency stress all gate the build by name; THREAT_MODEL.md finalized + copy-drift locked.

### What Worked
- Naming Phase 11's verification gates (canary round-trip, fs-interception, chaos, stress) inside Phases 8–10's own success criteria meant the implementations were built *against* the gates from day one, not retrofitted — no rework needed when Phase 11 actually wired the CI steps.
- Adversarial re-running caught real bugs twice: re-running the SC1b live leg after the first fix found a *second*, identical instance of the same unscoped-grep vulnerability in the same file — a single pass would have shipped a false "resolved."
- The first-ever ubuntu CI run for the branch surfaced three real, previously-invisible environment gaps (ANSI-breaking a count-guard, a stale `engines.node` floor 20.18 vs. the toolchain's actual 20.19 requirement, a too-tight stress deadline under shared-runner overhead) — proving the "test on CI before merge" discipline earns its cost even when local suites are fully green.
- The milestone audit (`/gsd:audit-milestone`) did not trust "resolved" claims in prior docs at face value — it independently re-read the live-run artifact and re-queried `gh run list` directly, which is what caught the one genuine process gap (see below) that every other layer of documentation had missed.

### What Was Inefficient
- `11-VERIFICATION.md`'s frontmatter was never regenerated after the two deferred human-verification items (SC1b live leg, first ubuntu CI run) closed — it still reads `status: human_needed` even though both are genuinely resolved. The milestone audit had to reconstruct "actually passed" from three separate downstream artifacts (`11-HUMAN-UAT.md`, `contract-findings.json`, a live `gh run list` query) instead of one authoritative source. Same pattern hit `10-VALIDATION.md`/`11-VALIDATION.md`'s per-task tracking tables — both stuck at "⬜ pending" post-execution despite the phase actually shipping.
- A specific instance of the above pattern became a real (if minor) shipped gap: the Phase 11 plan explicitly called for re-stamping `docs/HOOK-CONTRACT.md`'s per-tool matrix from the live-run findings artifact "in the same commit" — the artifact was updated, the docs were not, and PROJECT.md/11-HUMAN-UAT.md still declared the round "fully resolved." Caught at milestone-audit time, not before.

### Patterns Established
- Adversarial CI gates named explicitly by test file (not just "the suite passes") with exact-count guards, specifically to kill the vacuous-pass hazard where a routing mistake makes a gate match zero files and exit 0.
- Independent re-verification at audit time (re-run the live-run evidence check, re-query CI directly) rather than trusting a prior session's "resolved" status field — this is now the standard this milestone's audit set, worth carrying forward.
- Structural secret floors enforced at three independent layers (write-time type strip, parse-time drop, read-time policy gate) rather than one checkpoint — repeated from v2.0's PII chokepoint pattern, now applied to the reversible-mode map.

### Key Lessons
- A "gap resolved" claim in a SUMMARY/PROJECT.md is only as good as whether the artifact that *proves* it (VERIFICATION.md, VALIDATION.md task tables, doc re-stamps) was actually regenerated — status fields drift stale even when the underlying engineering work is genuinely done. Worth adding a lint/gate that flags VERIFICATION.md files whose frontmatter status doesn't match a newer HUMAN-UAT resolution record.
- "It works locally" and "it works on the CI runner that will actually gate merges" are different claims — this milestone's first real ubuntu run found three issues zero number of local macOS runs had surfaced, none of them product defects.

### Cost Observations
- Model mix: `model_overrides: inherit` for all GSD subagents this milestone (switched from a prior Fable-based profile after hitting a Fable usage limit mid-Phase-8 diagnosis — see memory `fable-for-gsd-agents`).
- Notable: the milestone audit's `gsd-integration-checker` spawn re-ran the full test suite and typecheck itself rather than trusting phase VERIFICATION.md reports — the extra cost caught nothing new here (all green), but is the same discipline that caught the HOOK-CONTRACT gap elsewhere in the same audit.

---

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
| v3.0 Reversible Redact Mode | 8–11 | 37 | 2026-07-18 | Encrypted session state, operator restore CLI, CI adversarially proves no wire re-exposure |

**Recurring strengths:** layered detection; perf-budget discipline; verifier independence; naming downstream verification gates inside earlier phases' success criteria so later phases build against them instead of retrofitting.
**Recurring watch-items:** unpushed-branch divergence; worktree-executor contamination; verification-artifact staleness (status fields not regenerated after a gap-closure round resolves them — v3.0's first concrete instance, worth a lint/gate).
