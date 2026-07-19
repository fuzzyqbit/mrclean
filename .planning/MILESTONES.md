# Milestones

## v3.0 Reversible Redact Mode — Foundations + Operator Restore (Shipped: 2026-07-19)

**Phases completed:** 4 phases, 37 plans, ~67 tasks
**Timeline:** 4 days (2026-07-14 → 2026-07-18) · **Git range:** `9bfca45`..`6a171d0`, 306 commits, 221 files changed (+45,826/-860)
**Requirements:** 12/12 REVMODE satisfied (see `.planning/milestones/v3.0-MILESTONE-AUDIT.md` for full coverage + integration verification)

**Key accomplishments:**

- **Hook-contract unknowns settled empirically** (Phase 8) — live headless sessions proved `updatedToolOutput` object-shape IS honored for Bash (no 10K cap), locked into `docs/HOOK-CONTRACT.md`; `[reversible]` config table landed with zero behavior change to the shipped one-way default.
- **Encrypted session-scoped state adapter** (Phase 9) — AES-256-GCM placeholder→original map with content-addressed allocation (16-process/400-transaction stress: 0 lost, 0 dupes, 0 disagreements), a structural secret floor (secret-class originals never persisted, not config-widenable), and a reason-aware SessionEnd janitor + TTL sweep.
- **Operator-only `mrclean restore` CLI** (Phase 10) — pure single-pass exact-lookup restore engine, 7-row fail-one-way degrade matrix (including a real held lock), hash-only audit, zero model-facing surface (`restore` stays CI-banned from both the MCP tool list and the hook path).
- **CI adversarially proves no wire re-exposure** (Phase 11) — dist-spawn parity, fs-write interception (incl. atomic temp files), chaos (corrupt/missing/chmod'd map), and 8–16-process concurrency stress all gate the build by name; THREAT_MODEL.md finalized against shipped code with a copy-drift lock.
- **Gap-closure round found and fixed 3 additional real issues** the first live/CI runs surfaced (test-scope bug in the transcript-leak grep, ANSI-breaking CI count-guard, stale `engines.node` floor) — both deferred human-verification legs (SC1b live leg, first ubuntu CI run) independently re-confirmed green by this close, not just trusted from prior docs.

---

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
