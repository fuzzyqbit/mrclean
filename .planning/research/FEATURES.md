# Feature Research — v3.0 Reversible Redact Mode

**Domain:** Opt-in reversible/pseudonymous redaction (session-scoped placeholder→original map + return-path restore) for an in-session LLM-boundary sanitizer (mrclean v3.0)
**Researched:** 2026-07-14
**Confidence:** HIGH (LLM Guard Vault/Deanonymize verified via official docs + source; Presidio DeanonymizeEngine via Context7 official docs; LiteLLM `output_parse_pii` via official docs + issue tracker; Kong `recover_redacted`/`stop_on_error` via official config reference; Pangea FPE/`unredact` and Vault tokenization via official vendor docs; Claude Code hook fields via official hooks reference)

> **Milestone scope:** This file covers ONLY the NEW reversible-mode surface for v3.0. Existing machinery — one-way redaction with stable `<MRCLEAN:TYPE:NNN>` placeholders, block-on-detect, per-rule action override, hash-only audit, `mrclean_check`/`mrclean_redact`/`mrclean_status` MCP tools, and the `restore` MCP stub registered since Phase 1 — is a fixed substrate, not re-researched. Prior milestone research preserved in `FEATURES.v1.md` / `FEATURES.v2.md`.

---

## How Reversible Redaction Works in Comparable Tools (Reference Models)

Five LLM-facing tools ship a documented restore/deanonymize surface. Their common shape and their divergences define the feature landscape.

### The common shape (all five)

1. **Redact outbound** (client → LLM): detected values replaced with indexed placeholders (`[REDACTED_PERSON_1]`, `{{EMAIL_ADDRESS_1}}`, `PLACEHOLDER{i}`). Same value → same placeholder within the scope (mrclean already does this with `<MRCLEAN:TYPE:NNN>`).
2. **Map placeholder→original** somewhere the response path can reach.
3. **Restore inbound** (LLM → client): string-search the model output for placeholders, substitute originals *at the boundary where data re-enters the trusted side*. The LLM only ever sees placeholders; the user only ever sees originals.

### Where each tool diverges (the design space)

| Dimension | LLM Guard (ProtectAI) | LiteLLM Presidio guardrail | Kong AI Gateway `ai-sanitizer` | Presidio (raw SDK) | Portkey |
|---|---|---|---|---|---|
| **Restore trigger** | `Deanonymize` output scanner run on model output | `output_parse_pii: true` config flag; unmask on response before returning to caller | `recover_redacted` config; originals reinstated in response before returning to client | Caller invokes `DeanonymizeEngine.deanonymize()` explicitly | **No restore.** One-way redact + `transformed` flag in response metadata |
| **Map storage** | `Vault` object: in-memory list of `(placeholder, original)` tuples, caller-owned lifetime | Per-request in-memory (undocumented internals) | Per request/response transaction via external PII service (internals undocumented) | Caller-supplied `entity_mapping` dict or `encrypt`/`decrypt` key (stateless) | N/A |
| **Matching** | 4 strategies: `exact` (default), `case_insensitive`, `fuzzy` (Levenshtein ≤3), `combined_exact_fuzzy` | Exact token match | Undocumented | **Position-based** (`OperatorResult` start/end offsets) | N/A |
| **Placeholder not in map** | Left as-is, unreplaced; empty vault → warn + continue, scan still returns valid | Left as-is (observed failure mode in bugs #22821, #6247: user sees `[PERSON]` tokens — degraded, never a leak) | Undocumented | Error (positions required) | N/A |
| **Opt-in default** | Explicit code opt-in (must construct Vault + add scanner) | **Off** by default | **`recover_redacted: true` by default** (gateway context: restoring to the original client is safe) | Explicit code opt-in | Redact toggle off by default |
| **What gets restored** | Everything in vault — all-or-nothing | Everything masked — all-or-nothing | Everything redacted, including `credentials` category — all-or-nothing | Whatever caller passes | N/A |
| **Error handling** | Restore failure degrades to placeholders-visible | Unmask only on "success" path, `/chat/completions` only | `stop_on_error: true` (default) halts the transaction on sanitizer error | Caller's problem | N/A |

### Adjacent precedents (tokenization systems — restore as a governed operation)

Two non-gateway systems supply the governance patterns the LLM gateways lack:

- **Pangea Redact** — reversibility is a **per-rule redaction method**: `mask`/`hash`/`replacement` are permanently one-way; `FPE` (format-preserving encryption) is reversible via a dedicated `/v1/unredact` endpoint + an `fpe_context` blob. With `llm_request: true` it returns a value→entity mapping so restore works regardless of where the entity lands in LLM output (position-independent by design). This is the closest existing precedent for **per-type reversibility policy** — the ruleset decides, entity class by entity class, whether recovery is even possible.
- **HashiCorp Vault (transform/tokenization)** — `decode` (detokenize) is a **separately-authorized, policy-gated operation**, not a symmetric default; token↔plaintext map entries carry a **TTL** and are purged by `tidy` (the direct analog of mrclean's janitor + orphan sweep); the `convergent` option makes the same plaintext tokenize to the same token (the precedent for mrclean's stable placeholders).
- **Private-AI-style privacy proxies** (session-keyed re-identification endpoints) — the response is posted back with a **session ID**, the service looks up that session's map and restores. Notably, several implementations embed a **per-session random hex in the token itself** (`{{SG_ENTITY_TYPE_a3f9…}}`) specifically to make cross-session placeholder collisions impossible. mrclean's fixed `<MRCLEAN:TYPE:NNN>` format does not do this — see the collision analysis below.

**Load-bearing insights for mrclean:**

1. **String-search restore, not position-based.** Presidio's raw `deanonymize()` needs entity offsets — useless against LLM output, which is *new* text that merely quotes placeholders. Every LLM-facing tool (LLM Guard, LiteLLM, Kong) does global string substitution keyed on the placeholder token; Pangea's `llm_request` mapping exists for the same reason. mrclean's `<MRCLEAN:TYPE:NNN>` format is already a grep-able token; restore = scan-and-substitute.
2. **LLMs mangle placeholders.** LLM Guard ships four matching strategies *because models alter case and spelling of placeholders in output* (LangChain's `PresidioReversibleAnonymizer` ships the same ladder — exact → case-insensitive → fuzzy → ngram-fuzzy — for the same reason). But note the trap: fuzzy matching with Levenshtein ≤3 would conflate `<MRCLEAN:PATH:001>` and `<MRCLEAN:PATH:002>` (distance 1) — wrong-value restoration. Case/delimiter tolerance: yes. Fuzzy distance: never (see Anti-Features).
3. **Restore failure is cosmetic; redact failure is a leak.** The ecosystem's observed failure mode when unmask breaks (LiteLLM #22821) is placeholders visible to the user — annoying, safe. This licenses **asymmetric failure semantics**: redact path stays fail-closed (block, as hardened in Phase 01), restore path fails *one-way* (pass through with placeholders intact, warn, never block, never guess).
4. **All-or-nothing restore is the gateway norm — and wrong for mrclean.** Kong restores credentials it redacted; LLM Guard restores whatever's in the vault. Fine for a gateway returning data to the client that originally sent it. The exception proving per-type policy is viable: **Pangea already ships per-entity-class reversibility** (FPE rules recover, hash/mask rules never do). What *no* tool ships is a **hardcoded, non-configurable secret-class exclusion** — Pangea lets the operator put FPE on anything. mrclean's core value ("secrets never reach the wire") plus the map-blast-radius constraint means secrets must be *class-excluded* from the reversible map entirely, as a floor config cannot lower. That floor is mrclean's actual differentiator.
5. **The single-process assumption doesn't hold for mrclean.** LLM Guard's Vault, LiteLLM's map, Kong's transaction scope all live inside one long-lived process spanning request and response. mrclean's hook bin is **spawned per event** — the map must survive across process invocations (hook ↔ hook, hook ↔ MCP server). This is why REVMODE-02 (Session State Adapter with locking + atomic rewrite) is a hard prerequisite, and why the "in-memory only by default" constraint is in tension with a per-invocation hook (the REVMODE-02 plaintext-session-file tension PROJECT.md flags for requirements to resolve). Vault's TTL + `tidy` is the reference pattern for bounding whatever store the adapter uses.
6. **Cross-session collision is bounded but real.** Placeholder numbering restarts per session, so `<MRCLEAN:PATH:001>` from yesterday's transcript can exact-match *today's* map and restore to a **different** original. Severity analysis: the substituted value is one of *this* session's own locally-known values — a correctness wart, **not a leak** (nothing crosses the wire that wasn't already local). A placeholder with no entry in the current map simply passes through (safe). The Private-AI fix (per-session nonce in the token) would be a breaking change to the shipped v1.0 placeholder contract; the proportionate v3.0 answer is map-scoped restore + documenting collision as an accepted residual risk in THREAT_MODEL.md (see Anti-Features).

### mrclean's restore surfaces (Claude Code hook contract, verified)

The hooks reference confirms the fields REVMODE-01 depends on:

- **PreToolUse** → `hookSpecificOutput.updatedInput` replaces tool arguments before the tool runs. When the model emits `Read <MRCLEAN:PATH:001>`, this is where the placeholder must become the real path or the local tool call fails. *Restore-before-local-execution is what makes reversible mode functional, not just cosmetic* — the exact motivation LiteLLM documents for `output_parse_pii` ("LLM responses contain the masked tokens themselves").
- **PostToolUse** → `hookSpecificOutput.updatedToolOutput` replaces the tool's result (this is the ≥ 2.1.121 dependency PROJECT.md pins for REVMODE-01).
- **SessionEnd** → fires on session termination with matcher values (`clear`, `resume`, `logout`, `prompt_input_exit`, ...); no decision control, side-effects only — purpose-built for the REVMODE-02 janitor (map deletion on exit).

**Directionality warning for requirements:** each hook event serves *opposite* roles depending on where the tool executes. For local tools (Read/Bash), tool input is inbound-from-model (restore at PreToolUse) and tool output is outbound-to-model (redact at PostToolUse — already shipped). For remote MCP tools, tool input is *outbound* (must stay/get redacted) and results may echo placeholders back. The restore policy must be **per-destination, not per-event**. No comparable tool faces this split (gateways have one wire); this is mrclean-specific and must be resolved in requirements, not assumed.

**Re-entry warning:** anything restored via `updatedToolOutput` becomes **model-visible context** and re-enters the outbound path on the next turn. This is safe for restorable classes only because stable placeholders make restore→re-redact idempotent (the value maps back to the same token). It is exactly why secret classes can never be restored: a restored secret's wire-safety would depend on the outbound redactor winning *every* subsequent turn — defense-in-depth inverted.

---

## Feature Landscape

### Table Stakes (Users Expect These)

What every documented restore feature does; missing any of these makes reversible mode broken or unsafe.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Single opt-in switch, default OFF** | LiteLLM `output_parse_pii: true`, Portkey's Redact toggle, LLM Guard explicit vault construction — restore is always an explicit operator choice. mrclean's Key Decision already fixes default = one-way. (Kong's `recover_redacted: true` default is the outlier and is ruled out by that decision.) | LOW | One key in existing config (e.g. `[reversible] enabled = true`), consistent with the `[pii]` sub-table precedent. Zero-config first-run stays one-way. |
| **Restore = string-search substitution of exact placeholders** | LLM Guard/LiteLLM/Kong all key restore on the placeholder token, not text positions; Pangea's `llm_request` mapping exists to make FPE restore position-independent. Presidio's position-based API demonstrates why: model output is new text. | LOW–MED | `<MRCLEAN:TYPE:NNN>` is already collision-free within a session and grep-able. Single pass, longest-token-safe (fixed format avoids overlap issues). Pure map lookup — no re-detection on the return path — keeps the <200ms PostToolUse budget trivially. |
| **Session-scoped `(placeholder → original)` map** | LLM Guard Vault = list of pairs scoped to the conversation; Kong scopes to the transaction; Private-AI proxies key by session ID; PROJECT.md scopes to the session and rules out cross-session persistence (Out of Scope). | **HIGH** | The hard part is not the map, it's the lifecycle: mrclean's per-event hook processes require a cross-invocation store (REVMODE-02 Session State Adapter: locking, atomic rewrite, keyed by session id). This is where mrclean diverges from every reference tool. |
| **Unmatched placeholder → left as-is, never guessed** | LLM Guard leaves unknown placeholders unreplaced; empty vault warns and continues. LiteLLM's failure mode (placeholders visible) is the ecosystem's de-facto safe degradation. | LOW | "Fail one-way": map missing/corrupt/stale ⇒ output passes through with placeholders intact + user-visible warning (`systemMessage`). Never block the session for a restore miss; never fuzzy-guess a value. Stale cross-session placeholders that miss the map degrade the same way — visible, safe. |
| **Map cleanup on session end** | Kong's map dies with the transaction; Vault bounds every token map entry with a TTL and purges via `tidy`; PROJECT.md constraint: removed on session exit. | LOW–MED | SessionEnd hook janitor (verified: side-effect-only event, matcher covers `clear`/`logout`/etc.). Must also handle crash leftovers: janitor sweeps orphaned maps from dead sessions on next start (age-based TTL, Vault-style). |
| **Secrets class-excluded from the reversible map** | Not table stakes in the gateway ecosystem (Kong restores credentials!). Pangea's per-rule method choice is the nearest precedent — hash/mask rules are irrecoverable by construction. For mrclean it is table stakes: core value = "secrets never reach the wire", and the security constraint says the map is the blast radius. A map holding raw secret values converts a cosmetic feature into a secret store. | MED | Reversibility is a per-TYPE property: `PATH`/`NAME`/`WORD`-class placeholders enter the map; `SECRET`/`ENV`-class **never do** (their placeholders simply stay placeholders in the user's view — which is today's shipped behavior). Enforce at map-*write* time, not restore time, so a map leak or restore bug cannot re-emit a credential. Builds on the existing `<MRCLEAN:TYPE:NNN>` taxonomy. |
| **Restore events in the hash-only audit** | Consistency with the shipped audit contract ("never raw values"). Portkey's `transformed`/`check_results` metadata is the precedent for signaling that transformation happened. | LOW | Log `{event: "restore", type, placeholder, count, hash}` — never the original value. The existing leak-grep regression must be extended to the restore path. |
| **Wire the `restore` MCP tool to the real map** | The stub has been advertised in the tool listing since Phase 1; an advertised no-op is a broken promise once reversible mode ships. Vault's precedent: detokenization is an explicit, separately-authorized operation — the right mental model for a tool-invoked restore. | LOW–MED | Surface: `restore(text, session_id?) → {restored_text, restored_count, unmatched: [placeholders]}`. Mirrors LLM Guard's `Deanonymize.scan()` contract (returns text + validity). Session-scoped: only the caller's session map. Must respect the same class policy: refuses to restore secret-class placeholders, reports them in `unmatched` with a structured reason. |

### Restore vs Never-Restore (explicit per-type policy)

The distinction the milestone turns on, derived from the evidence above:

| Placeholder class (existing taxonomy) | Restore? | Rationale |
|---|---|---|
| `PATH` / file names / project identifiers (`WORD` dirty-word class) | **YES** | The milestone's stated purpose ("paths/names/identifiers round-trip"). Low blast radius: local-context labels, not credentials. The class every reference tool restores. |
| PII identifiers (`EMAIL`/`PHONE`/`PERSON`/`LOC` from L6a/L6b) | **YES, config-narrowable** | LiteLLM restores exactly this class (MASK'd PII). Values the user typed or holds locally; restoring aids readability. Per-type allowlist lets operators narrow (Pangea per-rule precedent). |
| `SECRET` (L1 regex), `ENV` (L3 extracted), `ENTROPY` (L2) | **NEVER — hardcoded floor, not configurable** | Restored content is model-visible and re-enters the outbound path; map becomes a secret store if these ever enter it. Config can make *fewer* types reversible, never more. |
| Unknown / stale / cross-session placeholders (no map entry) | **NEVER (pass-through + audit count)** | Fail one-way. Ecosystem-validated safe degradation. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Class-based restore policy with a hardcoded secret floor** | Gateways restore everything (Kong even restores credentials). Pangea's per-rule FPE-vs-hash choice proves per-class reversibility is viable — but it's fully operator-configurable. mrclean's split is stricter: secret classes are non-reversible **regardless of config** (config can only narrow the restorable set, never widen it past the floor). Deterministic secret protection stays absolute while paths/names round-trip — the milestone's actual thesis, and unique in the ecosystem. | MED | Per-TYPE reversibility flag in config with the safe hardcoded floor. Pair with a leak-grep-style regression proving no secret-class original ever lands in session state. |
| **Fail-closed session state adapter** | Reference tools get map integrity for free (one process). mrclean's cross-process map with locking + atomic rewrite + corrupt-map detection (fail one-way on checksum mismatch) is engineering none of them have — and it's what makes reversible mode trustworthy in a spawned-per-event architecture. | HIGH | REVMODE-02. Corrupt/unparseable map ⇒ treat as missing ⇒ one-way degradation + warning. Atomic rewrite (write-temp + rename) prevents torn reads between concurrent hook invocations. |
| **Encrypted-at-rest map (if disk-backed)** | LLM Guard's Vault is plaintext process memory; Kong's mapping transits an external service. An OS-keychain-free, session-key-encrypted map file (key held by the long-lived MCP server or derived per session) exceeds ecosystem practice and satisfies the PROJECT.md constraint directly. | MED–HIGH | This is the resolution space for the REVMODE-02 plaintext-file tension: either (a) map lives only in the long-lived MCP server's memory and hooks query it, or (b) disk file encrypted at rest, key never on disk. Requirements must pick; both beat every reference tool. |
| **Delimiter/case-tolerant placeholder matching (bounded, no fuzz)** | LLM Guard and LangChain needed fuzzy ladders because models mangle placeholders. mrclean can match `<mrclean:path:001>`, `<MRCLEAN: PATH: 001>` etc. with a tolerant regex over its *fixed* format — recovering real-world mangles without fuzzy-matching risk — and *report* near-misses it declines to restore. | LOW–MED | Tolerate case, internal whitespace, dropped angle brackets. Never tolerate digit edits (index NNN is identity). A single tolerant regex, not Levenshtein. Near-miss detection feeds the audit (restore-miss telemetry). |
| **Restore-scope transparency in `mrclean_status`** | Every gateway restores silently; Portkey signals `transformed: true` at most; nobody shows the operator the live map's shape. `mrclean_status` reporting `{reversible: on, entries: 14, classes: {PATH: 9, NAME: 5}, secrets_excluded: true}` plus restored/unmatched counters gives auditable confidence without exposing values — "did the round-trip work?" answered out-of-band. | LOW | Counts and classes only — never keys or values. Extends the existing status tool. |
| **THREAT_MODEL.md blast-radius section (REVMODE-03)** | Continuation of the v2.0 "honest framing" discipline that already has a CI copy-drift gate. No gateway documents its map's blast radius; mrclean documenting "what an attacker gets if the map leaks, and why secrets aren't in it" is the trust story. | LOW | Covers: map contents policy, at-rest posture, lifecycle, crash-orphan handling, restored-value re-entry loop, **cross-session collision as an accepted residual risk** (bounded to wrong-local-value substitution, never a leak), and the explicit statement that reversible mode does not weaken the wire guarantee. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Fuzzy restore matching (Levenshtein-style)** | LLM Guard ships it (`fuzzy`, distance ≤3), LangChain ships `fuzzy`/`ngram_fuzzy`/`combined` — all to catch mangled placeholders | With numbered placeholders, distance-1 edits are *different identities*: `<MRCLEAN:PATH:001>` vs `<MRCLEAN:PATH:002>`. Fuzzy restore = restoring the wrong file path into a tool call — silent data corruption in a security tool. Chat UX can absorb that risk; a coding agent cannot. | Bounded tolerant regex over the fixed format (case/whitespace/delimiter), digits always exact. Unmatched → leave as-is + report near-miss in audit. |
| **Restore secrets to "complete" the round-trip** | Symmetry feels clean; Kong restores its `credentials` category; users may ask why `<MRCLEAN:SECRET:001>` stays visible | Puts raw secret values in the map artifact — the exact blast radius the security constraint exists to cap. Worse: restored content is model-visible context, so a restored secret can be re-emitted into files, commands, and summaries, relying on outbound re-redaction winning every turn. Also pointless: the user already has the secret locally; the placeholder in the transcript is informative, not obstructive. | Class exclusion enforced at map-write time (secrets never enter the map). Structured refusal from the `restore` tool. Document in THREAT_MODEL.md why secret placeholders are permanent. |
| **Cross-session / persistent map** | "Resume my session tomorrow and placeholders still resolve" | Explicitly Out of Scope in PROJECT.md (limits blast radius if the map file leaks); turns a session artifact into a growing secret-adjacent database; conflicts with SessionEnd cleanup. Vault mitigates the identical risk with TTLs for the identical reason. | Session-scoped only. Keychain-backed persistence remains deferred (POLISH-03). On `resume`, placeholders from prior sessions degrade to one-way — visible, safe. |
| **Placeholder format redesign with per-session nonce (collision fix)** | Private-AI-style proxies embed per-session random hex in tokens to make cross-session collisions structurally impossible | Breaking change to the shipped, stable v1.0 `<MRCLEAN:TYPE:NNN>` contract (audit tooling, user muscle memory, existing transcripts). The collision failure mode it prevents is bounded: a stale token either misses the current map (pass-through, safe) or restores to one of *this* session's own local values — a correctness wart, never a leak. | Map-scoped restore + THREAT_MODEL.md documents collision as accepted residual risk. Revisit the format only if field reports show real collisions. |
| **Plaintext session map file** | Simplest way to share state across per-event hook processes | Violates the PROJECT.md constraint (disk persistence must be encrypted at rest); a plaintext `(placeholder → original)` file in `.mrclean/` is a better exfil target than the data it protects. | MCP-server-held memory (hooks query it) or encrypted-at-rest file with key never on disk. Requirements decision REVMODE-02. |
| **Blocking the session when restore fails** | Kong's `stop_on_error: true` default halts on sanitizer error; "fail-closed everywhere" sounds consistent with Phase 01 hardening | Fail-closed is correct for *redaction* (failure = leak). For *restoration*, failure = cosmetic placeholders. Halting an agent session because a nicety failed inverts the availability/safety tradeoff — and pushes users to disable reversible mode (or worse, mrclean). | Asymmetric semantics: redact path fail-closed (unchanged), restore path fail-one-way + `systemMessage` warning. Never `decision: block` from a restore failure. |
| **Synthetic replacements (fake-but-realistic values)** | Kong `redact_type: synthetic`, LLM Guard `use_faker` — models reason more naturally over realistic values | Breaks determinism (needs a second reverse map), risks collision with real project data, and fake *paths/identifiers* actively break tool execution and code edits in an agent context. Built for chat, not for coding agents. | Keep structured placeholders. The model handles opaque tokens in code fine; round-trip fidelity matters more than naturalness. |
| **Restoring originals into the audit log** | "Audit should show what actually happened" | Violates the shipped hash-only audit contract; the v2.0 leak-grep regression exists precisely to prevent raw values in `audit.jsonl`. | Hash-only restore events; counts + types + placeholder ids. |
| **Inline restore markers in content ("[restored by mrclean]")** | Visibility — user wants to know a value was restored | Markers pollute content that is model-visible and may be written to files or executed; breaks the content-fidelity promise restore exists to deliver. | Out-of-band visibility: hash-only audit events + `mrclean_status` counters (differentiator above). |
| **Position/offset-based restore (Presidio-style API)** | It's what the reference SDK's `DeanonymizeEngine` does | Positions are meaningless in model-generated text that quotes placeholders in new sentences; guaranteed drift. Presidio itself is only used position-free (string ops) by every LLM-facing wrapper. | String-search substitution keyed on placeholder tokens. |
| **Re-detection scan on the return path** | Seems symmetric with the outbound scan ("scan responses for originals") | No comparable tool does this — restore is map lookup only. Re-detection adds latency against the <200ms PostToolUse budget and cannot resolve placeholders anyway. | Pure map lookup; O(placeholders present). |

## Feature Dependencies

```
Opt-in flag ([reversible] config)
    └──gates──> everything below (default OFF preserves shipped one-way behavior)

Restore on return path (REVMODE-01)
    └──requires──> Session State Adapter (REVMODE-02: cross-invocation map, locking, atomic rewrite)
    └──requires──> Claude Code ≥ 2.1.121 (PostToolUse hookSpecificOutput.updatedToolOutput — verified in hooks reference)
    └──requires──> PreToolUse updatedInput (already in hook contract) for local-tool placeholder→path restore
    └──requires──> Per-destination restore policy (local tool vs remote MCP) — requirements decision, no ecosystem precedent
    └──requires──> Class-based restore policy (fence decided BEFORE map is ever written)

Session State Adapter (REVMODE-02)
    └──requires──> SessionEnd janitor (verified: side-effect-only hook event, matcher support)
    └──requires──> Encryption-at-rest decision (MCP-server memory vs encrypted file) — resolves plaintext tension
    └──requires──> Existing session identity (map keyed by session id)
    └──requires──> TTL-based orphan sweep for crashed sessions (SessionEnd never fires) — Vault tidy analog

Class-based restore policy
    └──requires──> Existing <MRCLEAN:TYPE:NNN> taxonomy (shipped v1.0)
    └──requires──> Secret-class hardcoded non-reversible floor (enforced at map-write time)

restore MCP tool (wire the Phase-1 stub)
    └──requires──> Session State Adapter (shared map between hook processes and long-lived MCP server)
    └──requires──> Class-based restore policy (refuses secret-class placeholders, structured reason)

doctor version gate (≥ 2.1.121) ──enhances──> Restore on return path (fail loudly, not silent no-op)

Restore audit events ──extends──> Hash-only audit + leak-grep regression (shipped v1.0/v2.0)

Re-redaction safety net ──provided by──> Existing detection layers + stable placeholders (a restored
    value leaving again on the next outbound hop is re-caught and maps to the SAME placeholder —
    no new work, but must be asserted by a round-trip idempotence test)

Delimiter-tolerant matching ──enhances──> Restore on return path
Near-miss (mangled placeholder) detection ──enhances──> Restore audit events

Fail-one-way degradation ──conflicts──> stop_on_error-style blocking on restore failure
Synthetic replacements ──conflicts──> Stable placeholder round-trip + tool execution
Cross-session persistence ──conflicts──> SessionEnd janitor + PROJECT.md Out of Scope
Fuzzy restore ──conflicts──> deterministic-guarantee posture (index digits are identity)
```

### Dependency Notes

- **REVMODE-01 requires REVMODE-02 (hard):** every reference tool holds the map in one process across request/response. mrclean's hook is a fresh process per event; without the state adapter there is nothing to restore *from*. Phase ordering: state adapter before (or with) restore path, never after.
- **Class policy before state adapter writes:** the secret floor is enforced at map-*write* time (secret originals never enter the restorable store). Ordering the other way leaves a window where secret originals sit in shared state — the fence must exist before the adapter persists anything.
- **restore MCP tool requires the adapter, not just a map:** the MCP server is long-lived; the hooks are ephemeral. They must read the *same* session map — the adapter is the only correct meeting point.
- **Class policy requires the TYPE taxonomy:** reversibility keys off the TYPE segment of `<MRCLEAN:TYPE:NNN>`; this is why the shipped stable-placeholder format is load-bearing for v3.0 (and why the session-nonce format change is an anti-feature).
- **Per-destination policy conflicts with naive per-event wiring:** PreToolUse restore is correct for local tools and *wrong* (a leak) for remote MCP tools whose input goes off-machine. Requirements must define tool-destination classification before REVMODE-01 lands.
- **Janitor needs the installer:** SessionEnd hook registration is an installer change; the orphan sweep covers the crash path where SessionEnd never fires.
- **Re-redaction round-trip test:** restore → next outbound redact must be proven idempotent-safe (restored value re-caught, same placeholder). Extends the existing canary/UAT harness (Phase 01 UAT-2b precedent).

## MVP Definition

### Launch With (v3.0)

- [ ] `[reversible]` opt-in config flag, default OFF — preserves the shipped safety default; matches every reference tool's opt-in posture (except Kong, whose opt-out default mrclean's Key Decision rules out)
- [ ] Session State Adapter (`src/state/`): session-keyed map, file locking, atomic rewrite, corrupt-map ⇒ treated-as-missing — the prerequisite for everything
- [ ] Encryption-at-rest resolution (MCP-memory or encrypted file) — the PROJECT.md constraint is non-negotiable; a plaintext map cannot ship even as an interim
- [ ] Class-based restore policy with hardcoded secret-class exclusion, enforced at map-write time — the milestone's thesis; without it reversible mode contradicts the core value
- [ ] Restore on return path: PreToolUse `updatedInput` (local tools) + PostToolUse `updatedToolOutput` per the destination policy — the feature itself
- [ ] Unmatched/missing/corrupt-map ⇒ fail one-way with `systemMessage` warning, never block, never guess — ecosystem-validated safe degradation
- [ ] SessionEnd janitor + TTL crash-orphan sweep — constraint: map removed on session exit (Vault tidy analog for the crash path)
- [ ] Wire `restore` MCP tool: `restore(text) → {restored_text, restored_count, unmatched[]}`, secret-class refused with structured reason — closes the Phase-1 stub debt
- [ ] Hash-only restore audit events + leak-grep extension to the restore path — audit contract continuity
- [ ] Round-trip regression: redact → restore → re-redact proves no restored value escapes on the next outbound hop and maps to the same stable placeholder
- [ ] `doctor` gate: reversible enabled + Claude Code < 2.1.121 ⇒ loud FAIL (consistent with Phase 01 fail-closed posture), never a silent no-op
- [ ] THREAT_MODEL.md reversible-mode section (REVMODE-03) — opt-in flow, blast radius, why secrets are excluded, re-entry loop, collision accepted-risk

### Add After Validation (v3.x)

- [ ] Delimiter/case-tolerant placeholder matching + near-miss detection in audit — add when real transcripts show mangled placeholders (LLM Guard's and LangChain's experience says they will; measure first — the fixed format may survive better than free-text placeholders)
- [ ] `mrclean_status` reversible-mode panel (entry counts by class, restored/unmatched counters) — once operators ask "what's in the map right now / did restore run"
- [ ] Per-type restore allowlist config sub-table (narrow beyond the floor, e.g. restore PATH but not PERSON) — trigger: first user request; default all-non-secret-types-on is fine at launch
- [ ] Restore-miss telemetry in audit (count of placeholders seen but unrestorable) — signal for map-lifecycle bugs

### Future Consideration (v4+)

- [ ] Keychain-backed map persistence (POLISH-03) — already deferred; only if resume-across-restart demand is real, and it reopens the blast-radius analysis
- [ ] Crash-recovery map restore within one session — only meaningful with encrypted persistence; scope after the at-rest story is proven
- [ ] Reversible mode for the planned Layer-5 `--deep` classifier findings (v4.0) — class policy must be decided per new TYPE as they appear
- [ ] Placeholder format revision with session tag — only if cross-session collision reports materialize in the field

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Session State Adapter (locking, atomic, corrupt-safe) | HIGH (enables everything) | HIGH | P1 |
| Restore on return path (per-destination) | HIGH (the feature) | MEDIUM | P1 |
| Opt-in flag, default OFF | HIGH (safety posture) | LOW | P1 |
| Secret-class exclusion (hardcoded floor, write-time) | HIGH (core-value guard) | MEDIUM | P1 |
| Fail-one-way degradation semantics | HIGH (trust + availability) | LOW | P1 |
| SessionEnd janitor + orphan sweep | HIGH (constraint compliance) | LOW–MED | P1 |
| Encrypted-at-rest / MCP-memory map | HIGH (constraint compliance) | MED–HIGH | P1 |
| `restore` MCP tool wiring | MEDIUM (stub debt, operator surface) | LOW–MED | P1 |
| Hash-only restore audit + leak-grep extension | MEDIUM (contract continuity) | LOW | P1 |
| Round-trip re-redaction regression | HIGH (proves the wire guarantee holds) | MEDIUM | P1 |
| doctor version gate | MEDIUM (fail-loud posture) | LOW | P1 |
| THREAT_MODEL.md section | MEDIUM (trust story) | LOW | P1 |
| Tolerant placeholder matching + near-miss audit | MEDIUM | LOW–MED | P2 |
| Status-panel map introspection | MEDIUM | LOW | P2 |
| Per-type restore allowlist | LOW–MED | LOW | P2 |
| Restore-miss telemetry | LOW–MED | LOW | P2 |
| Keychain persistence | LOW (deferred demand) | HIGH | P3 |

## Competitor Feature Analysis

| Feature | LLM Guard | LiteLLM | Kong ai-sanitizer | Presidio SDK | Pangea Redact | Vault tokenization | Our Approach |
|---------|-----------|---------|-------------------|--------------|---------------|--------------------|--------------|
| Enable restore | Construct `Vault` + add `Deanonymize` scanner | `output_parse_pii: true` (off by default) | `recover_redacted` (**on** by default) | Explicit `deanonymize()` call | Per-rule FPE method + explicit `unredact` API | Policy-gated `decode` (privileged) | `[reversible]` config, **off** by default (Key Decision) |
| Map storage | In-memory Vault (single process, caller-owned) | Per-request in-memory | Per-transaction via PII service | Caller-supplied mapping / crypto key | `fpe_context` encrypted blob (portable) | Server-side token map, TTL-bounded | Session-scoped adapter across processes; memory-first, encrypted if disked; janitored on SessionEnd |
| What restores | Everything in vault | Everything masked | Everything incl. credentials | Whatever caller passes | Only FPE-method rules; hash/mask rules never | Anything, but decode separately authorized | **Identifiers/paths/names only; secret classes never — hardcoded floor** (unique) |
| Match strategy | exact / case_insensitive / fuzzy(≤3) / combined | exact | undocumented | position offsets | FPE decrypt via context (position-independent) | token lookup | exact now; bounded format-tolerant regex later; **no fuzzy ever** (index digits are identity) |
| Placeholder miss | Leave as-is, warn on empty vault | Leave as-is (observed in bugs) | undocumented | error | n/a (crypto, not lookup) | decode error | Leave as-is + `systemMessage`; fail one-way; audit count |
| Restore failure | Degrades to visible placeholders | Success-path only; known gaps (Anthropic native path) | `stop_on_error: true` halts | n/a | API error to caller | error to caller | Never halt on restore failure; redact path stays fail-closed (asymmetric) |
| Map lifetime | Conversation (caller-owned) | One request | One transaction, never persisted | Caller-owned | Context blob lifetime (caller-held) | TTL + `tidy` purge | Session + SessionEnd janitor + TTL orphan sweep |
| Transparency | risk score per scan | guardrail logs | audit log | n/a | API-explicit | audit device logs decode | hash-only audit events + status counts; never raw values (differentiator) |

## Sources

**HIGH confidence (official docs / source):**
- LLM Guard Deanonymize scanner docs + `deanonymize.py` source (github.com/protectai/llm-guard) — Vault contract, 4 matching strategies (EXACT, CASE_INSENSITIVE, FUZZY ≤3, COMBINED_EXACT_FUZZY), unmatched-placeholder pass-through, empty-vault warn-and-continue (verified in source)
- LLM Guard Anonymize scanner docs (Context7) — Vault population, `(placeholder, original)` tuples, `use_faker` synthetic option
- Presidio anonymizer docs (Context7, /data-privacy-stack/presidio) — `DeanonymizeEngine`, `decrypt` operator, custom `InstanceCounterDeanonymizer` with caller-owned `entity_mapping`, session-ID-keyed mapping in the official OpenAI anonymize/deanonymize best-practices sample, position-based `OperatorResult` API
- LiteLLM PII masking docs (docs.litellm.ai/docs/proxy/guardrails/pii_masking_v2 + presidio tutorial; Context7) — `output_parse_pii` semantics, response-path unmask for MASK/replace ops only, pre_call-only, `/chat/completions`-only, success-path-only
- Kong AI PII Sanitizer plugin + configuration reference (developer.konghq.com/plugins/ai-sanitizer) — `recover_redacted` (default `true`), `stop_on_error` (default `true`), `redact_type: placeholder|synthetic`, `anonymize` categories incl. `credentials`
- [Pangea Redact rulesets + API](https://pangea.cloud/docs/redact/using-redact/redact-rules) — per-rule redaction method (mask/hash/replacement one-way vs FPE reversible), `/v1/unredact` + `fpe_context`, `llm_request: true` value→entity mapping for position-independent LLM-output recovery
- [Vault tokenization transform docs](https://developer.hashicorp.com/vault/docs/secrets/transform/tokenization) — policy-gated `decode`, TTL + `tidy` purge of token maps, `convergent` tokenization (stable tokens)
- [LangChain deanonymizer matching strategies (source)](https://github.com/langchain-ai/langchain-experimental) — `exact`, `case_insensitive`, `fuzzy` (Levenshtein), `ngram_fuzzy`, `combined_exact_fuzzy` (exact first, then fuzzy); built specifically because LLMs alter placeholder case/whitespace/characters
- Claude Code hooks reference (code.claude.com/docs/en/hooks) — PostToolUse `hookSpecificOutput.updatedToolOutput`, PreToolUse `hookSpecificOutput.updatedInput` + `permissionDecision`, SessionEnd event (side-effects only, matcher values) — verified 2026-07-14

**MEDIUM confidence:**
- LiteLLM issues #22821 (Anthropic native path masks but never unmasks) and #6247 (output parsing gaps) — real-world restore failure modes = degraded-but-safe
- Portkey PII Redaction docs (portkey.ai) — `{{EMAIL_ADDRESS_1}}` placeholders, `transformed` flag + `check_results` metadata, no restore surface documented (one-way inferred from absence + third-party comparisons)
- Kong 3.10 release materials — restoration positioning ("reinsert original sanitized data back into the response"); per-request map internals inferred
- Private-AI-style privacy-proxy pattern — session-ID-keyed re-identification endpoint; per-session random hex embedded in tokens to prevent cross-session collision (multiple consistent practitioner writeups, no single official doc)

**LOW confidence / gaps:**
- Kong's internal mapping storage and lifetime (undocumented; inferred per-transaction from plugin architecture)
- LiteLLM's map internals (undocumented; inferred per-request in-memory)

---
*Feature research for: mrclean v3.0 reversible redact mode*
*Researched: 2026-07-14*
