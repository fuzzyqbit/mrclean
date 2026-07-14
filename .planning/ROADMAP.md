# Roadmap: mrclean

> Vertical-slice MVP roadmap. Each phase delivers a capability the operator verifies by running `npx mrclean ...` and observing real Claude Code behavior.

**Granularity:** coarse · **Project mode:** mvp (vertical slices, end-to-end)

## Milestones

- ✅ **v1.0 MVP** — Phases 1–3 (shipped 2026-05-14) — in-session secret redaction + MCP tools + public release
- ✅ **v2.0 Native-Node PII/NER Layer** — Phases 4–7 (shipped 2026-06-03) — opt-in PII/NER detection, no Python, no egress, hot-path-safe
- 🚧 **v3.0 Reversible Redact Mode — Foundations + Operator Restore** — Phases 8–11 (in progress) — encrypted session-scoped placeholder→original map + operator-only `mrclean restore` CLI; zero model-facing restore surface, zero wire re-exposure; default stays one-way

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

### v3.0 Reversible Redact Mode — Foundations + Operator Restore (Phases 8–11)

- [ ] **Phase 8: Contract Verification & Reversible Plumbing** — hook-contract unknowns settled empirically in live headless sessions; `[reversible]` config table + SessionEnd/SessionStart plumbing landed with zero behavior change; THREAT_MODEL.md reversible-mode section drafted
- [ ] **Phase 9: Session State Adapter** — encrypted cross-process session map with content-addressed allocation, session-tagged v2 tokens, structural secret floor, and reason-aware janitor + TTL orphan sweep
- [ ] **Phase 10: Operator Restore** — `mrclean restore` CLI with policy-filtered exact-map restore, fail-one-way degradation, hash-only restore audit, honest doctor/status
- [ ] **Phase 11: Wire-Safety Verification & Hardening** — CI proves no wire re-exposure: live canary round-trip, fs-write interception, chaos + concurrency stress gates, THREAT_MODEL finalization + copy-drift

## Phase Details (v3.0)

### Phase 8: Contract Verification & Reversible Plumbing
**Goal**: Hook-contract unknowns are empirically settled and documented, reversible-mode config/lifecycle plumbing exists with zero behavior change, and THREAT_MODEL.md honestly frames reversible mode before any state code is written
**Depends on**: Nothing (first v3.0 phase; builds on shipped v2.0 substrate)
**Requirements**: REVMODE-10, REVMODE-03
**Success Criteria** (what must be TRUE):
  1. Operator can read documented, empirically-verified answers (from live headless sessions) to each LOW-confidence contract question — terminal rendering of `updatedToolOutput`, PreToolUse `updatedInput` context echo, `session_id` continuity across `--resume`, 10K-char output-cap applicability — and the upstream feature request for a display-only rewrite channel is filed and linked
  2. Operator can set the `[reversible]` config table (default OFF) and `mrclean doctor` reports reversible-mode state; with the table absent, all shipped v1/v2 behavior is byte-identical (existing suites pass unchanged)
  3. A fresh `npx mrclean install` registers SessionEnd routing and the widened SessionStart matcher (`startup|resume|clear|compact`); re-running install on an existing v2.0 install migrates the matcher without duplicating entries, and session start/end events produce no exit-2 noise
  4. Operator can read a THREAT_MODEL.md reversible-mode section covering map blast radius, the structural secret floor, wire re-entry analysis (why in-session restore is deferred: `updatedToolOutput` is model-facing and the transcript ratchet is permanent), key-custody honesty, and accepted residual risks — and PROJECT.md's stale "restore MCP tool stub" wording is amended
**Plans**: 6 plans

Plans:
**Wave 1**
- [x] 08-01-PLAN.md — `[reversible]` config table + Phase 8 type contracts (TDD; wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 08-02-PLAN.md — SessionEnd no-op routing + installer 5-event widening/migration (wave 2)
- [x] 08-03-PLAN.md — Doctor reversible-state reporting + 5-event REQUIRED_EVENTS (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 08-04-PLAN.md — Live contract experiments E1–E5 + interactive rendering checkpoint (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 08-05-PLAN.md — docs/HOOK-CONTRACT.md + shipped-copy honesty + upstream issue filing (wave 4)
- [ ] 08-06-PLAN.md — THREAT_MODEL reversible section + copy-drift gate + PROJECT/CLAUDE amendment (wave 4)

**Research flag**: `--research-phase` recommended — live headless contract experiments (UAT-2b harness precedent); the answers feed Phase 9's resume/rehydration design (T5) and Phase 10's input-restore scope fence
**Note**: This phase lays REVMODE-07's installer/dispatcher groundwork (no-op handlers, matcher widening + migration); the janitor requirement itself completes in Phase 9. The Phase 11 canary/chaos/stress gates are named in Phases 8–10 criteria so implementations are built against them, not retrofitted.

### Phase 9: Session State Adapter
**Goal**: An enabled reversible session persists an encrypted, cross-process placeholder→original map with stable content-addressed allocation, a structural secret floor, and a reason-aware lifecycle janitor — while the one-way default stays byte-identical
**Depends on**: Phase 8 (contract answers, `[reversible]` config table, SessionEnd/SessionStart plumbing)
**Requirements**: REVMODE-02, REVMODE-04, REVMODE-05, REVMODE-06, REVMODE-07
**Success Criteria** (what must be TRUE):
  1. With `[reversible]` enabled, placeholders allocated in one hook event resolve to their originals in a later hook process — the map persists as an encrypted file (AES-256-GCM, fresh IV per write); operator inspection of `~/.mrclean/sessions/` shows ciphertext only (including temp files), key material in a separate 0700 directory, and nothing inside the project tree
  2. Concurrent hook processes redacting the same original get the identical placeholder (content-addressed allocation under shared session state), and reversible sessions issue session-tagged v2 tokens `<MRCLEAN:TYPE:NNN:nonce8>` while the one-way default keeps the v1 placeholder format and code path byte-identical
  3. Decrypting and dumping a session map in a test shows secret-class entries (all secret TYPEs, ENV, ENTROPY, checksum'd PII such as SSN/credit-card) structurally lack an `original` field, and no configuration can widen the restorable set — only narrow it
  4. SessionEnd with reason `clear`/`logout`/`prompt_input_exit`/`other` deletes the session map; `resume` retains it; orphaned maps older than the TTL (24h default, configurable) are swept at SessionStart and MCP-server boot
  5. The adapter holds against the named Phase 11 gates at integration level: an 8–16-process stress run loses/corrupts no entries, and a corrupt/missing/chmod'd map is treated as absent — redaction provably unaffected
**Plans**: TBD
**Note**: Phase-planning-time reconciliation required before the store is built: append-only JSONL + lock-free hot path (STACK) vs whole-file encrypt + short locked transaction (ARCHITECTURE), plus exact key layout — invariants already converged (research SUMMARY.md T2); pin the mechanism during `/gsd-plan-phase 9`, no new research needed.

### Phase 10: Operator Restore
**Goal**: Operator can round-trip redacted content locally — `mrclean restore` turns policy-permitted placeholders back into originals with fail-one-way degradation, hash-only audit, and honest doctor/status reporting; zero model-facing restore surface
**Depends on**: Phase 9 (session state adapter — without the map there is nothing to restore from)
**Requirements**: REVMODE-01, REVMODE-08, REVMODE-09, REVMODE-12
**Success Criteria** (what must be TRUE):
  1. Operator can pipe redacted text (stdin or file) through `mrclean restore` and receive restored output on stdout — exact map lookup, single-pass token scan; unknown, stale, and OVF tokens pass through unchanged, and planted/enumerated tokens never issued by this session's map are never restored
  2. Restoring a mixed document returns real paths/names/identifiers while every secret-class placeholder survives untouched; no `restore` MCP tool exists and no hook-path restore runs (`restore` stays on FORBIDDEN_TOOL_NAMES with the CI check passing)
  3. With the map missing, corrupt, or locked, restore degrades one-way — placeholders stay visible with a warning, no tool call is ever blocked, and redaction is provably unaffected (separate error domains, no shared kill switch)
  4. Every restore operation is audited hash-only (never raw values), and the extended leak-grep regression passes over map artifacts, restore code paths, and their error paths
  5. `mrclean doctor` FAILs loud (never silent no-op) on unsupported reversible configuration, and `mrclean_status` reports map entry counts by class plus restored/unmatched counters — never values
**Plans**: TBD
**Note**: Restore engine is a pure single-pass function with exhaustive ecosystem prior art (LLM Guard/LiteLLM string substitution) — standard patterns, skip research-phase. Build directly against the Phase 11 canary round-trip and mixed-content canary gates by name.

### Phase 11: Wire-Safety Verification & Hardening
**Goal**: CI proves the milestone's negative claims — reversible mode never re-exposes originals on any wire path — via adversarial end-to-end gates, and the honest copy is locked against drift
**Depends on**: Phase 10 (verifies the fully integrated reversible surface)
**Requirements**: REVMODE-11
**Success Criteria** (what must be TRUE):
  1. A live headless canary gate (UAT-2b precedent) proves hook stdout is unchanged by reversible mode and no restored canary value appears in the next outbound request body or in `~/.claude/projects/**/*.jsonl`
  2. An fs-write interception test proves no plaintext canary appears in any written buffer, including atomic-write temp files
  3. Chaos tests gate CI: with a corrupt, missing, or chmod'd map, the canary is still redacted and no tool call is blocked
  4. An 8–16-process concurrency stress test gates the build: no lost or corrupted map entries, no duplicate placeholders for distinct originals, identical placeholders for identical originals
  5. THREAT_MODEL.md's reversible-mode section is finalized against the shipped implementation, and the copy-drift CI gate covers the "encrypted at rest" and honest-framing claims
**Plans**: TBD
**Note**: Every gate extends an existing shipped harness (UAT-2b headless canary, leak-grep, copy-drift, perf CI) — standard patterns, skip research-phase.

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1. Wired Skeleton | v1.0 | 8/8 | Complete   | 2026-07-13 |
| 2. Live Redaction (L1–4 + One-Way) | v1.0 | ✓ | Complete | 2026-05-14 |
| 3. MCP Tools, Perf Gate, Release | v1.0 | 6/6 | Complete | 2026-05-14 |
| 4. PII Contracts & Architecture | v2.0 | 3/3 | Complete | 2026-06-03 |
| 5. Regex PII Hot-Path (L6a) + Model | v2.0 | 2/2 | Complete | 2026-06-03 |
| 6. NER Inference (L6b) + MCP Wiring | v2.0 | 4/4 | Complete | 2026-06-03 |
| 7. PII Security Hardening & Framing | v2.0 | 3/3 | Complete | 2026-06-03 |
| 8. Contract Verification & Reversible Plumbing | v3.0 | 0/6 | Planned | - |
| 9. Session State Adapter | v3.0 | 0/TBD | Not started | - |
| 10. Operator Restore | v3.0 | 0/TBD | Not started | - |
| 11. Wire-Safety Verification & Hardening | v3.0 | 0/TBD | Not started | - |

> Coverage validation (54 v1 reqs, 14 v2.0 reqs — all mapped) archived in the per-milestone roadmap files under `milestones/`. v3.0 coverage: 12/12 REVMODE requirements mapped (see REQUIREMENTS.md traceability).

---
*Last updated: 2026-07-14 — Phase 8 planned (6 plans, waves 1–4). Next: `/gsd-execute-phase 8`.*
