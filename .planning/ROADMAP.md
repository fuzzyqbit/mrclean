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
**Plans**: 12 plans (11 executed + 1 gap-closure round 3)

Plans:
**Wave 1**
- [x] 08-01-PLAN.md — `[reversible]` config table + Phase 8 type contracts (TDD; wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 08-02-PLAN.md — SessionEnd no-op routing + installer 5-event widening/migration (wave 2)
- [x] 08-03-PLAN.md — Doctor reversible-state reporting + 5-event REQUIRED_EVENTS (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 08-04-PLAN.md — Live contract experiments E1–E5 + interactive rendering checkpoint (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 08-05-PLAN.md — docs/HOOK-CONTRACT.md + shipped-copy honesty + upstream issue filing (wave 4)
- [x] 08-06-PLAN.md — THREAT_MODEL reversible section + copy-drift gate + PROJECT/CLAUDE amendment (wave 4)

**Wave 5 — gap closure** *(from 08-VERIFICATION.md, 2026-07-14)*
- [x] 08-07-PLAN.md — CR-01 fix: Partial-shaped config layers + merge-time default filling + cross-layer tests (TDD; wave 5)
- [x] 08-08-PLAN.md — Harness durability: guarded findings writer + object-shape legs wired (E1/Bash-object, E1/Read-object, object-gated E4) (wave 5)

**Wave 6 — gap closure** *(blocked on 08-08)*
- [x] 08-09-PLAN.md — Live E4 rerun via object-shaped Bash payload + HOOK-CONTRACT/THREAT_MODEL refresh (wave 6)

**Wave 7 — gap closure round 2** *(from 08-VERIFICATION.md re-verification 14/16, 2026-07-14; offline-only, zero live tokens)*
- [x] 08-10-PLAN.md — E1 per-tool carry-forward in the findings builder + partial-rerun unit tests (TDD; closes CR-01 evidence destruction) (wave 7)
- [x] 08-11-PLAN.md — E4/Read-object record-nothing gating + HOOK-CONTRACT citation refresh + UUID traceability gate (WR-01/WR-03) (wave 7)

**Wave 8 — gap closure round 3** *(from 08-UAT.md diagnosed gaps, 2026-07-16; UAT test 2 — fresh-HOME zero-config install)*
- [x] 08-12-PLAN.md — Fresh-HOME install mkdir defense + banner count derived from HOOK_EVENTS.length (TDD; closes UAT gaps 1–2) (wave 8)

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
**Plans**: 8 plans

Plans:
**Wave 1**
- [x] 09-01-PLAN.md — Pinned deps install (proper-lockfile/write-file-atomic/@types) + `ttl_hours` config widening (wave 1)
- [x] 09-02-PLAN.md — Session-map schema + structural secret floor + HMAC addressing + v2 formatter contracts (TDD; wave 1)

**Wave 2** *(blocked on Wave 1)*
- [x] 09-03-PLAN.md — Encrypted map store: GCM envelope (authTagLength:16), key custody, total-error read, wfa fsync:false write (TDD; wave 2)
- [x] 09-04-PLAN.md — v2 token layer on PlaceholderManager: hydrate seam + drainable pending; v1 byte-identical (TDD; wave 2)

**Wave 3** *(blocked on Wave 2)*
- [x] 09-05-PLAN.md — Lock recipe + deadline-degrade wrapper + locked allocate-and-persist transaction with reconcile/renames (TDD; wave 3)
- [x] 09-06-PLAN.md — Reason-aware SessionEnd janitor + TTL sweep at SessionStart/MCP boot (TDD; wave 3)

**Wave 4** *(blocked on Wave 3)*
- [x] 09-07-PLAN.md — PreToolUse/PostToolUse reversible branches (hydrate→detect→persist→rename) + cold-path import-graph fence (wave 4)

**Wave 5** *(blocked on Wave 4)*
- [x] 09-08-PLAN.md — 16-process SC5 stress gate + chaos parity + SC1 inspection test + doctor check-8 copy + phase regression gates (wave 5)

**Note**: The T2 mechanism reconciliation was pinned at plan time (09-CONTEXT D-01..D-05): whole-file AES-256-GCM encrypt + short locked `proper-lockfile` transaction (never held across detection), per-session key in separate 0700 `~/.mrclean/keys/`, no fsync inside the lock (RESEARCH-measured), TTL aging by map mtime only, key-before-map janitor deletes.

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
**Plans**: 8 plans

Plans:
**Wave 1** *(4 parallel TDD plans, zero file overlap)*
- [x] 10-01-PLAN.md — Single-pass restore engine `restoreText()` + `V2_TOKEN_SCAN_RE` grammar export (TDD; wave 1)
- [x] 10-02-PLAN.md — Session discovery + policy-filtered inverted index with poisoned-map defense (TDD; wave 1)
- [x] 10-03-PLAN.md — Hash-only restore audit record + counters aggregator (`src/audit/restore-log.ts`) (TDD; wave 1)
- [x] 10-04-PLAN.md — Doctor FAIL-loud on unknown `[reversible]` keys (raw-layer scan, reserved exit 1) (TDD; wave 1)

**Wave 2** *(blocked on Wave 1)*
- [x] 10-05-PLAN.md — `mrclean restore` CLI (stdin/file/--session) + REVMODE-08 degrade matrix (wave 2)
- [x] 10-06-PLAN.md — `mrclean_status` reversible counters via state-confined reducer + audit aggregation (wave 2)

**Wave 3** *(blocked on Wave 2)*
- [ ] 10-07-PLAN.md — Trust-boundary fences (both directions) + mixed-content canary (Phase 11 gate substrate) (wave 3)
- [ ] 10-08-PLAN.md — Leak-grep extension over restore surfaces/error paths + phase regression gate (wave 3)

**Note**: Restore engine is a pure single-pass function with exhaustive ecosystem prior art (LLM Guard/LiteLLM string substitution) — standard patterns, skip research-phase. Build directly against the Phase 11 canary round-trip and mixed-content canary gates by name. Planner pins (2026-07-17, resolving 10-RESEARCH A1–A5): doctor FAIL = unknown `[reversible]` keys only; status restore counters aggregate from `action:'restore'` audit records; restore audit is a discriminated sibling record (log.ts LOCKED unions untouched); default restore scope = union across all live maps with `--session` narrowing; exit 0 on cosmetic degrade, exit 2 for hard input errors.

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
**Note**: Every gate extends an existing shipped harness (UAT-2b headless canary, leak-grep, copy-drift, perf CI) — standard patterns, skip research-phase. Phase 10 re-homed the stale STATE.md todo "per-tool empirical verification of structured `tool_response` shapes" here (pre-reshape concern; belongs to the live canary gate, not the operator CLI).

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
| 8. Contract Verification & Reversible Plumbing | v3.0 | 11/12 | Gap closure (round 3) | - |
| 9. Session State Adapter | v3.0 | 0/8 | Planned | - |
| 10. Operator Restore | v3.0 | 6/8 | In Progress|  |
| 11. Wire-Safety Verification & Hardening | v3.0 | 0/TBD | Not started | - |

> Coverage validation (54 v1 reqs, 14 v2.0 reqs — all mapped) archived in the per-milestone roadmap files under `milestones/`. v3.0 coverage: 12/12 REVMODE requirements mapped (see REQUIREMENTS.md traceability).

---
*Last updated: 2026-07-17 — Phase 10 planned (8 plans, 3 waves; RESEARCH assumptions A1–A5 pinned in the phase note). Next: `/gsd:execute-phase 10`.*
