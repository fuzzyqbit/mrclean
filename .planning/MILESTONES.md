# Milestones

## v2.0 Native-Node PII/NER Layer (Shipped: 2026-06-03)

**Phases completed:** 4 phases, 12 plans, 19 tasks

**Key accomplishments:**

- One-liner:
- MrcleanPiiConfig interface (src/shared/types.ts):
- `optionalDependencies` declaration for ML deps (MODEL-01) + documented v2.0 scope fence banning cloud PII APIs, model-facing unredact tools, and Presidio sidecar (PIISEC-03), with CI-enforced forbidden-tool extension and per-phase transition checklist
- One-liner:
- One-liner:
- Four pure, download-free NER building blocks — warm-singleton pipeline (sole ML-dep import boundary), L6b BIO-aggregation engine with min_score floor + dual fail-closed, per-model label map, and the D-11 cross-source overlap-drop filter — plus the D-07 confidence default reconcile, all unit-tested with a mocked pipeline.
- Threaded an MCP-only `opts.ner` gate into both detection orchestrators so the Layer 6b NER engine (and its `@huggingface/transformers` dynamic import) runs only on explicit opt-in, ran the D-11 overlap drop before dedup, stamped every pii-ner audit entry with reproducible model provenance (no raw PII), and proved with an import-graph test + cold-start perf gate that the hook path can never reach the NER code.
- Surfaced NER end-to-end through the MCP server: an eager fire-and-forget fail-closed preload that warms the NER singleton at boot without ever blocking `server.connect()`, `{ner:true}` threaded into both check/redact tools with `nerStatus` in their structuredContent (DTOs still PII-free), plus the opt-in piiranha NER-04 tier with its real 64-hex pinned SHA-256 (operator-approved, cc-by-nc-nd-4.0) and a per-model label remap to PERSON/LOC with no ORG concept — MCP-03 tool surface unchanged.
- Single `sanitizeForOutput()` chokepoint scrubs detected PII from error/diagnostic output (with-context) and emits static safe messages (context-free, D-04); supervisor + failclosed error sinks routed through it; and a two-project leak-grep proof shows no synthetic PII canary reaches audit.jsonl (integration, non-vacuous) or stderr (unit, three forced-failure paths).

---

## v1.0 MVP (Shipped: 2026-05-14)

> Backfilled 2026-07-14 during phase-archive cleanup — v1.0 shipped before MILESTONES.md existed.

**Phases completed:** 3 phases (1–3), 20 plans

**Key accomplishments:**

- Phase 1 — Wired Skeleton: `npx mrclean install` lands hook + MCP server; "mrclean active" banner; green `mrclean doctor`. Gap-closure 2026-07-13: SC4/HOOK-05 fail-open hole closed with fail-closed POSIX `/bin/sh` wrapper, confirmed via live headless-Claude UAT; code-review warnings WR-01..03 fixed 2026-07-14.
- Phase 2 — Live Redaction (Layers 1–4 + One-Way): real secrets blocked-with-reason on prompts, `<MRCLEAN:TYPE:NNN>` placeholders in tool calls; `.env`/regex/entropy/word-list detection; hash-only audit log.
- Phase 3 — MCP Tools, Performance Gate, Public Release: `mrclean_check / mrclean_redact / mrclean_status` tools; CI `<100ms / <200ms` perf budgets; README + THREAT_MODEL; published `mrclean-claude` 1.0.0.

**Phase archives:** `.planning/milestones/v1.0-phases/`

---
