# Roadmap: mrclean

> Vertical-slice MVP roadmap. Each phase delivers a capability the operator verifies by running `npx mrclean ...` and observing real Claude Code behavior.

**Granularity:** coarse · **Project mode:** mvp (vertical slices, end-to-end)

## Milestones

- ✅ **v1.0 MVP** — Phases 1–3 (shipped 2026-05-14) — in-session secret redaction + MCP tools + public release
- ✅ **v2.0 Native-Node PII/NER Layer** — Phases 4–7 (shipped 2026-06-03) — opt-in PII/NER detection, no Python, no egress, hot-path-safe

Full detail + coverage tables: [`milestones/v2.0-ROADMAP.md`](milestones/v2.0-ROADMAP.md) · requirements: [`milestones/v2.0-REQUIREMENTS.md`](milestones/v2.0-REQUIREMENTS.md)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1–3) — SHIPPED 2026-05-14</summary>

- [x] **Phase 1: Wired Skeleton** — `npx mrclean install` lands a working hook + MCP server; "mrclean active" banner + green `mrclean doctor`
- [x] **Phase 2: Live Redaction (Layers 1–4 + One-Way)** — real secrets blocked-with-reason on prompts, `<MRCLEAN:TYPE:NNN>` placeholders in tool calls; `.env`/regex/entropy/word-list caught; hash-only audit log
- [x] **Phase 3: MCP Tools, Performance Gate, Public Release** — `mrclean_check / mrclean_redact / mrclean_status`; CI `<100ms / <200ms` budgets; README + THREAT_MODEL; published `mrclean-claude` 1.0.0

</details>

<details>
<summary>✅ v2.0 Native-Node PII/NER Layer (Phases 4–7) — SHIPPED 2026-06-03</summary>

- [x] **Phase 4: PII Contracts & Architecture Foundations** — `[pii]` config sub-table (off by default), PII finding-shape + audit-schema, ML deps as `optionalDependencies`, documented+enforced scope fence; core secret tool provably unchanged
- [x] **Phase 5: Regex PII Hot-Path Lane (L6a) + Model Acquisition** — structured PII (email/SSN/credit-card/phone/IP) in-budget with no model, through the existing placeholder/audit/allowlist pipeline; model download/cache/integrity infra verifiable via `mrclean doctor`
- [x] **Phase 6: NER Inference (L6b) + MCP Wiring** — opt-in PERSON/ORG/LOC as a warm singleton in the long-lived MCP server only (never the hook), advisory-by-default, fail-closed-for-NER, model provenance in every PII audit entry
- [x] **Phase 7: PII Security Hardening & Honest Framing** — leak-grep regression proves no raw PII reaches audit logs or error paths; `sanitizeForOutput()` chokepoint; honest best-effort framing across all surfaces + copy-drift CI gate

</details>

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1. Wired Skeleton | v1.0 | ✓ | Complete | 2026-05-14 |
| 2. Live Redaction (L1–4 + One-Way) | v1.0 | ✓ | Complete | 2026-05-14 |
| 3. MCP Tools, Perf Gate, Release | v1.0 | 6/6 | Complete | 2026-05-14 |
| 4. PII Contracts & Architecture | v2.0 | 3/3 | Complete | 2026-06-03 |
| 5. Regex PII Hot-Path (L6a) + Model | v2.0 | 2/2 | Complete | 2026-06-03 |
| 6. NER Inference (L6b) + MCP Wiring | v2.0 | 4/4 | Complete | 2026-06-03 |
| 7. PII Security Hardening & Framing | v2.0 | 3/3 | Complete | 2026-06-03 |

> Coverage validation (54 v1 reqs, 14 v2.0 reqs — all mapped) archived in the per-milestone roadmap files under `milestones/`.

---
*Last updated: 2026-06-03 — v2.0 milestone shipped (Phases 4–7). Next milestone via `/gsd:new-milestone`.*
