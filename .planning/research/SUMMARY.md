# Project Research Summary

**Project:** mrclean — milestone v3.0 Reversible Redact Mode (REVMODE-01/02/03)
**Domain:** Opt-in reversible/pseudonymous redaction (session-scoped placeholder→original map + restore-on-return-path) for an in-session LLM-boundary sanitizer
**Researched:** 2026-07-14
**Confidence:** HIGH

> Scope: This summary covers ONLY the v3.0 Reversible Redact Mode milestone. Prior milestone summaries preserved at `SUMMARY.v1.md` (v1.0 MVP) and `SUMMARY.v2.md` (v2.0 PII/NER). All four research files treat the shipped v1.0/v2.0 substrate (detection layers, `<MRCLEAN:TYPE:NNN>` placeholder manager, hash-only audit, fail-closed hook wrapper, MCP stdio server, leak-grep/copy-drift CI gates) as a fixed foundation.

## Executive Summary

Reversible redact mode inverts every property that made mrclean's one-way design safe: it **stores originals** (the map file is a new leak surface), it **writes originals back into content** (restore is a new reinsertion surface), and it **shares mutable state across short-lived parallel processes** (the map is a new race surface). Every comparable tool (LLM Guard Vault, LiteLLM `output_parse_pii`, Kong `recover_redacted`, Pangea FPE/unredact, Vault detokenization) holds its map in one long-lived process spanning request and response. mrclean cannot — hook processes are spawned fresh per event and die immediately — so the map must live outside hook memory, which is the entire reason REVMODE-02 (Session State Adapter) is a hard prerequisite for REVMODE-01 (restore path). The platform contract is confirmed: PostToolUse `hookSpecificOutput.updatedToolOutput` rewrites tool results for all tools since Claude Code 2.1.121, and PreToolUse `updatedInput` covers the input direction.

The recommended approach: an **encrypted per-session map file** (AES-256-GCM via `node:crypto`, stored outside the project tree) acting as the **allocation authority** — placeholder allocation moves into a locked read-modify-write transaction so two parallel hook processes can never mint colliding placeholders — combined with a **reversible-mode-only placeholder format v2** (per-session CSPRNG nonce segment + content-derived IDs) that makes planted/guessed tokens structurally inert. The single most important design rule is structural, not cryptographic: **secret-class originals never enter the map at the type level** — the map entry type cannot represent a secret original, so no restore bug, config flip, or map leak can ever reinsert a credential. Restore is asymmetric to sanitize by design: sanitize stays fail-closed (a failure blocks), restore fails safe (a failure leaves placeholders visible — ugly, zero leak).

The key risks are all *design* decisions, not implementation hazards, and most must be settled at requirements time: restored content re-enters model context and therefore the wire (restore policy must be a per-type allowlist with a hardcoded secret floor); the shipped code **CI-bans a `restore` MCP tool** (PROJECT.md's "wire the stub" target is stale — restore must be hook-side plus an operator-only CLI); and three live behaviors are unverifiable from docs alone (session_id continuity across `--resume`, whether `updatedInput` echoes into model context, whether the terminal renders `updatedToolOutput`) and need an empirical spike before the restore path is designed. New dependency surface is tiny: `proper-lockfile` and `write-file-atomic@^7` (pinned — v8 breaks the Node 20 floor); everything else is stdlib.

## Cross-Cutting Decisions for Requirements (resolve BEFORE roadmap phases execute)

These nine decisions cut across all four research files. Recommended resolutions are given; items marked OPEN need a requirements ruling or an empirical spike.

| # | Decision | Recommended Resolution | Status |
|---|----------|------------------------|--------|
| 1 | **`restore` MCP tool vs the CI ban.** PROJECT.md says "wire the `restore` MCP tool (stub since Phase 1)" — but the stub was deleted in Plan 03-01, `restore` sits on `FORBIDDEN_TOOL_NAMES` (`tests/mcp/tools-list.test.ts:44-60`, CI-enforced), the v1 decision record rules restoration non-model-facing (03-03-PLAN.md:460, prompt-injection Pitfall #10), and the MCP server never learns the Claude Code `session_id`. | **Keep the ban.** Restore surface = PostToolUse hook pass (deterministic, operator-configured) + operator-only `mrclean restore` CLI. **Amend PROJECT.md** to remove the stale target. A model-facing restore tool is a prompt-injectable deanonymization oracle. | Recommended — ratify |
| 2 | **Map medium + key custody.** Encrypted per-session file vs MCP-server-resident memory. | **Encrypted per-session file** (Option A): MCP-memory custody loses the map on server restart mid-session (counter/identity corruption against the live transcript) and excludes hook-only installs entirely. Key custody: random master key file `0600` in a **different directory** from ciphertext + HKDF per-session keys; never derived from `session_id`, never in env vars. THREAT_MODEL.md must state honestly what file-based custody does NOT stop (same-user malware). | Recommended — ratify custody |
| 3 | **Placeholder scheme in reversible mode.** v1 sequential `NNN` counters are guessable (spray-and-see enumeration = exfiltration oracle for restorable-class values) and collide across processes/sessions. | **Format v2 for reversible mode only:** per-session CSPRNG nonce segment (planted/foreign-session tokens can't match) + content-derived IDs (same original → same placeholder, idempotent across processes). One-way mode keeps the shipped v1 format untouched — this resolves FEATURES' compatibility objection while closing PITFALLS' injection oracle. | Recommended — ratify |
| 4 | **Session store as allocation authority.** | The store is NOT a passive dump of what each process allocated — allocation itself moves into a **locked read-modify-write transaction** (two-phase: detect lock-free, allocate+persist under a ~2ms lock, reconcile foreign allocations by hash). This is the only way `same value → same placeholder` holds across parallel hook processes. Fixes the latent v1 cross-process collision as a side effect. | Recommended — ratify |
| 5 | **Failure asymmetry policy.** | Sanitize direction: **fail-closed** (unchanged from Phase 01). Restore direction: **fail-safe no-op** — missing/corrupt/undecryptable map ⇒ placeholders stay visible + one-time `systemMessage`, never block, never guess. PostToolUse exit 2 is non-blocking anyway. Two separate error domains, no shared kill switch — restore breakage must never disable redaction. | Recommended — ratify |
| 6 | **Secrets never enter the map — structurally.** | Type-level exclusion: the persistent map entry type **cannot represent** a secret-class original (secret entries carry hash+counter only, no `original` field). Enforced at map-write time AND restore-read time; hardcoded denylist (all 14 secret TYPEs + ENV + ENTROPY + SECRET + PII_SSN + PII_CREDIT_CARD), never config-widenable. Restore-by-construction cannot reinsert secrets. | Recommended — ratify |
| 7 | **Claude Code >= 2.1.121 floor.** `updatedToolOutput` for all tools ships at 2.1.121; older versions silently ignore the field (silent no-op, not an error), and the upstream changelog rolls old entries off so runtime verification from docs is impossible. | Install-time version gate (`claude --version`, refuse to enable reversible mode below floor) **+ doctor behavioral canary** — a headless round-trip proving `updatedToolOutput` was *honored*, not just emitted (UAT-2b harness precedent). | Recommended — ratify |
| 8 | **SessionEnd is best-effort + fires on `resume`.** Not crash-guaranteed (SIGKILL/power loss), output ignored, has a double-fire/missed-fire history (v2.1.72/78), and `reason: resume` means *suspend*, not terminate. | **Janitor TTL sweep is mandatory**, multi-point (SessionStart, MCP boot, throttled lazy hook sweep), reason-aware (delete on `clear`/`logout`/`prompt_input_exit`/`other`). **OPEN:** retention on `reason: resume` — recommend keep-with-TTL (deleting breaks resumed-session round-trip), but this interacts with the unverified session_id-continuity question. | Partially OPEN |
| 9 | **Per-destination restore policy.** Hook events serve opposite roles by tool destination: for local tools, input is inbound-from-model (restore at PreToolUse makes tools actually work) and output is outbound (redact then restore); for remote MCP tools, input is *outbound to the wire* (must stay redacted). No comparable tool faces this split. | **OPEN** — requirements must define tool-destination classification before REVMODE-01 lands. Likely needs a phase spike; also gated on the unverified `updatedInput` model-context echo question. | OPEN — probable spike |

## Key Findings

### Recommended Stack

Almost everything v3.0 needs is stdlib: `node:crypto` (AES-256-GCM with fresh 12-byte IV per write, HKDF per-session key derivation, AAD = session_id so records can't be spliced between sessions) and `node:fs` (`O_EXCL` create-once, atomic tmp+fsync+rename). Two small runtime deps: `proper-lockfile@^4.1.2` for slow-path mutual exclusion (janitor, compaction — **never on the hook hot path**, where its 2s staleness floor would destroy the <100/200ms budgets) and `write-file-atomic@^7.0.1` (**pinned — v8 requires Node 22.22+ and silently breaks the Node 20 floor**; guard the major in renovate/dependabot). Reversible-mode code must be lazy-imported behind the config flag so the default one-way path stays byte-identical.

**Core technologies:**
- **Claude Code >= 2.1.121** (platform floor): `updatedToolOutput` on PostToolUse for all tools — the entire restore path hangs on this; enforce at install + doctor
- **`node:crypto` AES-256-GCM + HKDF**: encryption-at-rest with tamper detection (a tampered map is an injection surface — GCM auth failure ⇒ record skipped, fail-safe) — zero new crypto deps; every npm alternative is strictly worse
- **`proper-lockfile@^4.1.2`**: slow-path locking only — the one maintained pure-JS cross-process lock (mkdir-based, POSIX+win32+NFS safe)
- **`write-file-atomic@^7.0.1`** (pinned): atomic replace for locked compaction/rewrite — fsync ordering + Windows EPERM retry
- **What NOT to use:** SQLite/lmdb (native addons break `npx` zero-config), socket IPC to the MCP server (not guaranteed alive; fail-closed hook would block on a dead socket), `fs.watch` (unreliable; use stat-based invalidation), keys in env vars or derived from `session_id` (public data — encryption theater), the deprecated `updatedMCPToolOutput` field

Performance is comfortable: reversible mode adds ~4–8ms typical / ~60ms worst-case contended to PostToolUse — detection remains the dominant cost.

### Expected Features

The ecosystem shape (LLM Guard, LiteLLM, Kong, Presidio, Pangea, Vault) is consistent: redact outbound with indexed placeholders, map somewhere the response path reaches, restore inbound by **string-search substitution** (never position-based — model output is new text that merely quotes placeholders). mrclean's genuine differentiator: no tool ships a **hardcoded, non-configurable secret-class exclusion** (Kong restores credentials!), and no tool solves the cross-process map problem (they're all single-process).

**Must have (table stakes):**
- `[reversible]` opt-in config flag, **default OFF** — every reference tool makes restore an explicit operator choice (Kong's opt-out default is the outlier and is ruled out by the existing Key Decision)
- Session State Adapter (`src/state/`): session-keyed map, locking, atomic rewrite, corrupt-map ⇒ treated-as-missing — the prerequisite for everything
- Encryption-at-rest (plaintext map cannot ship even as an interim — PROJECT.md constraint is explicit)
- Class-based restore policy with the hardcoded secret floor, enforced at map-write time
- Restore on return path per the destination policy (PostToolUse `updatedToolOutput` + PreToolUse `updatedInput` for local tools)
- Unmatched/missing/corrupt ⇒ fail one-way with `systemMessage`, never block, never guess (ecosystem-validated safe degradation — LiteLLM's observed failure mode is placeholders-visible, annoying but safe)
- SessionEnd janitor + TTL crash-orphan sweep (Vault `tidy` analog)
- Operator restore surface: `mrclean restore` CLI (replaces the stale MCP-tool target per Decision 1)
- Hash-only restore audit events + leak-grep extension; round-trip re-redaction regression (restored value re-caught → same placeholder); doctor version gate

**Should have (competitive):**
- Structural secret-class exclusion (unique in the ecosystem — the milestone's actual thesis)
- Fail-closed session state adapter with cross-process correctness proofs (engineering none of the reference tools have)
- Restore-scope transparency in `mrclean_status` (counts/classes only, never values)
- THREAT_MODEL.md blast-radius section with honest key-custody framing (v2.0 honest-framing discipline, copy-drift CI gate)

**Defer (v3.x+):**
- Delimiter/case-tolerant placeholder matching + near-miss telemetry (add when real transcripts show mangling; **never fuzzy** — distance-1 edits are different identities)
- Per-type restore allowlist config narrowing; keychain-backed persistence (POLISH-03); cross-session persistence (explicitly out of scope — blast radius)

### Architecture Approach

The core tension: hook processes are ephemeral (fresh process per event, `process.exit()` every time) while the map must span the session — and hooks run **in parallel**, so the map is contested state. The resolution is a locked-transaction file store behind a single facade (`src/state/`), with allocation as a two-phase transaction (detect lock-free → allocate+persist under a ~2ms lock → substitute lock-free) so the lock is never held across detection. Restore is a **different algorithm** than redact — a single-pass token-regex scan with map lookup (~80 LOC pure function in `src/restore/`), never `substituteFindings` reuse, never per-entry `replaceAll` loops (substring clobbering past 999 entries), never fixpoint iteration (injection amplifier). PostToolUse ordering: **redact first, then restore** (placeholder tokens are inert to detection layers). Map schema makes original-retention opt-in per entry: secret-class entries are hash+counter only.

**Major components (new):**
1. `src/state/` — Session State Adapter: `withSessionMap()` locked read-modify-write facade, encrypted map-store, lock, janitor; the ONLY module touching `node:crypto`/lockfiles (enforce with import-graph test)
2. `src/restore/restore-text.ts` — pure single-pass token-scan restore engine + `RestorePolicy` type filter; deliberately outside `src/placeholder/` (opposite trust direction — it *introduces* sensitive data)
3. `src/hook/handlers/session-end.ts` + dispatcher/types/installer changes — SessionEnd registration, **SessionStart matcher widening** (currently `'startup'` only — resume/clear/compact never fire today), migration for existing installs
4. `mrclean restore` CLI subcommand — operator-only recovery surface, no model in the loop

**Modified:** PlaceholderManager (hydrate/serialize seam, policy-scoped `retainOriginals`), detection orchestrator (manager injection seam; one-way path byte-identical), Pre/PostToolUse handlers (persist + restore branches), doctor (SessionEnd registered, version floor, stale-dir report, perms), config (`[reversible]` table), audit (`action: 'restore'`, LOCKED schema amendment).

### Critical Pitfalls

1. **`updatedToolOutput` is model-facing — restored values re-enter the wire.** There is no user-display-only rewrite channel; the terminal renders the same transcript the model consumes, and transcript contamination is a ratchet (history is never re-sanitized; values re-ship on every subsequent call and on `--resume`). The restore-identifier-classes-to-wire decision must be **explicit and documented** in THREAT_MODEL.md, backed by a canary round-trip CI test capturing the next outbound request body. This is the milestone's go/no-go question.
2. **The map file is the leak vector.** A curated, typed index of everything mrclean deemed sensitive. Mitigate: state dir outside the project tree (`0700`/`0600`, `sha256(session_id)` filenames — no traversal), ciphertext-only-on-disk invariant (temp files included — encrypt in memory first), PreToolUse denylist on the state dir, and above all the structural secret exclusion (a leaked map exposes paths/names, never credentials).
3. **Placeholder collision/injection across processes and sessions.** Parallel processes minting `<MRCLEAN:PATH:007>` for different originals ⇒ restore substitutes the *wrong* value; guessable sequential tokens planted in attacker-controlled content (fetched web pages, cloned READMEs) turn restore into an exfiltration oracle — including **to disk** via Write/Edit tool inputs. Fix: allocation authority under lock + format v2 nonce + content-derived IDs + single-pass engine + restore never runs on file-write payloads.
4. **Fail-open temptation.** A shared error domain where "reversible mode broke, disable mrclean" ships a leak in one code review — sanitize and restore need separate error taxonomies with no shared kill switch, proven by chaos tests (corrupt/delete/chmod the map ⇒ canary secret still redacted on the next event, no tool call blocked).
5. **Key-management footguns.** Key beside ciphertext, key derived from session_id, GCM nonce reuse across rewrites, decrypt-without-tag-verification, "encrypted at rest" copy overclaiming local-attacker protection. All resolved by Decision 2's custody scheme + fresh IV per write + tag-failure ⇒ map-absent + copy-drift gate over the claims.

## Implications for Roadmap

Based on combined research, **4 phases**, mirroring the pitfall-to-phase mapping all four files converged on. Threat model comes FIRST, not last — Pitfalls 1, 2, 3, 6, 10, 13 are design decisions, and the store cannot be built before the class policy and custody are fixed (secret exclusion is enforced at map-*write* time; ordering the other way leaves a window where secret originals sit in shared state).

### Phase 1: Threat Model, Contract Verification & Plumbing (REVMODE-03 + go/no-go)
**Rationale:** Contains the milestone's go/no-go question (wire-exposure decision, Pitfall 1) and every unverified platform behavior the later phases depend on. Also independently-shippable plumbing with zero behavior change.
**Delivers:** Empirical verification spike (does `updatedToolOutput` render in the terminal? does `updatedInput` echo into model context? does `session_id` survive `--resume`? does the 10K-char hook output cap bind? per-tool structured `tool_response` shapes) via the UAT-2b headless harness; ratified decisions 1–9; THREAT_MODEL.md blast-radius section + opt-in consent copy; `SessionEndInput` type + dispatcher route + no-op handler; `[reversible]` config table (default off); installer SessionEnd registration + SessionStart matcher widening + migration; doctor version gate; PROJECT.md amendment (stale restore-MCP-tool target).
**Addresses:** Opt-in flag; doctor gate; THREAT_MODEL section (FEATURES table stakes).
**Avoids:** Pitfalls 1 (wire exposure), 2/13 (custody decided before build), 3 (scope fence), 6 (trust boundaries), 10 (asymmetry policy).

### Phase 2: Session State Adapter (REVMODE-02)
**Rationale:** Hard prerequisite for restore — without the adapter there is nothing to restore *from*. Heaviest unit-test surface; build and gate it before anything consumes it. The cross-process placeholder-stability fix lands here and is valuable even before restore exists.
**Delivers:** `src/state/` (schema, AES-256-GCM store, key mgmt, lock, atomic writes), placeholder format v2 (nonce + content-derived IDs), allocation authority (two-phase locked transaction), PlaceholderManager hydrate/serialize seam, redact-write integration in Pre/PostToolUse, multi-point janitor (reason-aware SessionEnd + SessionStart TTL sweep + doctor stale-dir report).
**Uses:** `node:crypto`, `proper-lockfile`, `write-file-atomic@^7` (STACK).
**Implements:** Session State Adapter + janitor (ARCHITECTURE components 1, 3).
**Avoids:** Pitfalls 4/5 (collision/corruption — gated by an 8–16-process concurrency stress test in CI, real child processes, not in-process fakes), 7 (format v2), 8 (content-addressed allocation), 12 (multi-point janitor), 13 (custody implementation: fresh IV per write, tag-failure ⇒ absent, fs-write ciphertext interception test).

### Phase 3: Restore Path (REVMODE-01)
**Rationale:** Consumes the adapter; shape depends on Phase 1's verification results (per-destination policy, input-side restore).
**Delivers:** `restoreText` pure engine + `RestorePolicy` (table-driven tests: OVF skip, unknown skip, adjacency, placeholder-shaped originals, >999 entries, planted/cross-session tokens); PostToolUse redact→persist→restore wiring with degrade paths; PreToolUse input-restore if Phase 1 verification clears it; contract module (`src/hooks/contract.ts` — field names, version floors, Zod payload validation); `mrclean restore` operator CLI; hash-only restore audit events through the `sanitizeForOutput()` chokepoint; Write/Edit placeholder tripwire.
**Avoids:** Pitfalls 3 (type-separated restore), 7 (single-pass engine + adversarial fixtures), 9 (chokepoint wiring), 11 (contract module + version gate).

### Phase 4: Verification, UAT & Hardening
**Rationale:** The milestone's guarantee is a negative ("restored secrets can never reach the wire") — only adversarial end-to-end verification proves it. Every earlier phase named its gate here.
**Delivers:** Canary round-trip gate (seeded fake AWS key + fake project path → path round-trips, key placeholder survives EVERY surface including the next outbound API request body and `~/.claude/projects/**/*.jsonl`); chaos tests (corrupt/delete/chmod/truncate map ⇒ sanitize survives, nothing blocks); leak-grep extension to state dir + stderr + debug transcript; map-plateau assertion (distinct placeholders per value-hash == 1); doctor behavioral canary (`updatedToolOutput` honored, not just emitted); kill -9/resume/compact test matrix; copy-drift gate over "encrypted at rest" claims; perf CI extension (decrypt+substitute+re-encrypt inside budget).
**Avoids:** Regression of every pitfall; the "looks done but isn't" checklist from PITFALLS.md is this phase's acceptance list.

### Phase Ordering Rationale

- **Decisions before disk:** the secret-exclusion fence and key custody must exist before the adapter persists anything (Phase 1 → 2 hard ordering).
- **Store before restore:** REVMODE-01 has nothing to read without REVMODE-02; the FEATURES dependency graph and ARCHITECTURE build order agree.
- **Phase 2's stability fix is independently valuable:** cross-process placeholder stability repairs a latent v1 gap even if restore slipped.
- **Verification last but specified first:** each phase names its Phase-4 gate up front so tests are built alongside, not retrofitted.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** `/gsd:plan-phase --research-phase` — three LOW-confidence platform behaviors (session_id continuity across `--resume`, `updatedInput` model-context echo, terminal rendering of `updatedToolOutput`) are unverifiable from docs and gate the milestone's shape; the 10K-char output cap and per-tool `tool_response` shapes need empirical probing.
- **Phase 3:** possible spike on the per-destination restore policy (Decision 9) if Phase 1 doesn't fully resolve tool-destination classification — no ecosystem precedent exists to borrow from.

Phases with standard patterns (skip research-phase):
- **Phase 2:** AES-GCM/HKDF/locking/atomic-write patterns are fully specified in STACK.md + ARCHITECTURE.md with verified APIs; the concurrency test approach is prescribed. Execution risk, not knowledge risk.
- **Phase 4:** extends existing CI harnesses (UAT-2b, leak-grep, copy-drift) with well-defined assertions.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Hook contract verified against live docs + SDK changelog + issue tracker; package engines verified live on npm 2026-07-14; crypto APIs via Context7 `/nodejs/node` |
| Features | HIGH | Five reference restore surfaces verified via official docs/source (LLM Guard, LiteLLM, Kong, Presidio, Pangea) + two governance precedents (Vault, Private-AI pattern) |
| Architecture | HIGH on integration points (verified against shipped source, file:line cites); MEDIUM on MCP-server lifecycle; LOW on resume session_id continuity (flagged) |
| Pitfalls | HIGH on contract facts + architecture-derived reasoning; MEDIUM on concurrency-corruption prevalence and placeholder-mangling frequency (community postmortems, multiple sources agree) |

**Overall confidence:** HIGH

### Gaps to Address

- **session_id continuity across `--resume`** (LOW): determines whether resume-rehydration is real or dead code, and interacts with Decision 8's retention policy — verify empirically in Phase 1.
- **`updatedInput` model-context echo** (LOW): gates input-side restore safety (ratchet hazard if rewritten inputs reflect into the transcript) — canary-test in Phase 1 before designing Phase 3.
- **Terminal rendering of `updatedToolOutput`** (LOW): determines how much "round-trips back into the user's view" value restore actually delivers — quick live test in Phase 1.
- **10K-char hook output cap vs large tool results** (LOW): if it binds on `updatedToolOutput`, restoring inside big file reads may truncate — test with >10KB result, define chunk/skip behavior.
- **Structured `tool_response` shapes for built-in tools** (MEDIUM): hook authors are responsible for preserving schema invariants when replacing output — per-tool empirical verification in Phase 1/3.
- **Per-destination restore policy** (OPEN, Decision 9): no ecosystem precedent; requirements must classify tool destinations before REVMODE-01.

## Sources

### Primary (HIGH confidence)
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) (fetched 2026-07-14) — `updatedToolOutput` semantics ("replaces the tool's result"), PostToolUse non-blocking, parallel hook execution, SessionStart sources / SessionEnd reasons + output-ignored, `session_id` in all events, `CLAUDE_ENV_FILE` hazard, 10K output cap
- [anthropics/claude-agent-sdk-typescript CHANGELOG](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md) v0.2.121 + issues #32105/#36843/#24788 — 2.1.121 floor, `updatedMCPToolOutput` deprecation
- Shipped source (read 2026-07-14): `src/hook/*`, `src/detect/*`, `src/placeholder/*`, `src/mcp/*`, `src/install/*`, `tests/mcp/tools-list.test.ts` (FORBIDDEN_TOOL_NAMES), `03-03-PLAN.md:460` (non-model-facing restore decision)
- npm registry (live 2026-07-14) — `write-file-atomic` v7/v8 engines, `proper-lockfile@4.1.2`; Context7 `/nodejs/node` (AES-GCM, HKDF), `/moxystudio/node-proper-lockfile` (staleness clamps)
- LLM Guard Deanonymize source, Presidio DeanonymizeEngine (Context7), LiteLLM `output_parse_pii` docs, Kong `ai-sanitizer` config reference, Pangea Redact/unredact docs, Vault tokenization transform docs

### Secondary (MEDIUM confidence)
- claudefa.st + Build This Now changelog mirrors — 2.1.121 corroboration; v2.1.72/78 SessionEnd reliability fixes
- LiteLLM issues #22821/#6247 — real-world restore failure = degraded-but-safe (placeholders visible)
- Community hooks postmortems — parallel-hook JSON corruption; last-writer-wins on concurrent rewrites
- OWASP LLM01 + Unit 42 indirect prompt injection; tokenization reversal-path guidance (NHIMG, Baffle) — restore as the highest-privilege surface

### Tertiary (LOW confidence — needs validation)
- Kong/LiteLLM map internals (undocumented, inferred); Private-AI session-nonce token pattern (practitioner writeups)
- All items in Gaps to Address above — resolve via Phase 1 empirical spike

---
*Research completed: 2026-07-14*
*Ready for roadmap: yes — after requirements ratifies Decisions 1–9 (items 8 and 9 remain open)*
