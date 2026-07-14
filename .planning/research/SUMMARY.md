# Project Research Summary

**Project:** mrclean
**Domain:** Reversible redact mode (session-scoped placeholder→original map + return-path restore) for an in-session LLM-boundary sanitizer — milestone v3.0 (REVMODE-01/02/03)
**Researched:** 2026-07-14
**Confidence:** HIGH overall, with specific LOW-confidence contract questions gating Phase 1 (see Gaps)

> Scope: This summary covers ONLY the v3.0 "Reversible Redact Mode" milestone. Prior syntheses are preserved at `SUMMARY.v1.md` (v1.0 MVP) and `SUMMARY.v2.md` (v2.0 PII/NER). All four research files treat the shipped v1/v2 substrate — one-way redaction with stable `<MRCLEAN:TYPE:NNN>` placeholders, fail-closed hook wrapper, hash-only audit + leak-grep gate, three-tool MCP server, `sanitizeForOutput()` chokepoint — as fixed foundation.

## Executive Summary

v3.0 inverts the property that made v1/v2 safe by construction: a one-way sanitizer stores nothing, so it has nothing to leak, nothing to restore into the wrong place, and nothing to race over. Reversible mode adds all three — a persisted originals map (new leak surface), a restore pass that writes originals back into content (new reinsertion surface), and mutable state shared across parallel, per-event hook processes (new race surface). Every reference tool with a restore feature (LLM Guard Vault, LiteLLM `output_parse_pii`, Kong `recover_redacted`, Presidio, Pangea FPE, HashiCorp Vault tokenization) holds its map inside one long-lived process spanning request and response; mrclean's hook is spawned fresh per event, which is why the Session State Adapter (REVMODE-02) is a hard prerequisite for the restore path (REVMODE-01), not a sibling.

The recommended approach is well-supported: the Claude Code contract provides everything needed (PostToolUse `hookSpecificOutput.updatedToolOutput` rewrites tool results for all tools since v2.1.121 — the backlog's version floor is confirmed correct; PreToolUse `updatedInput` covers the input direction; SessionStart/SessionEnd + `session_id` cover lifecycle). The stack is almost entirely stdlib: `node:crypto` AES-256-GCM + HKDF for encryption at rest, `fs` primitives for atomic/append writes, plus two small, pinned deps (`proper-lockfile@^4.1.2` for slow-path mutual exclusion, `write-file-atomic@^7.0.1` — pinned because ^8 silently breaks the Node 20 floor). Restore itself is a ~80-LOC single-pass token-regex scan with map lookup — never fuzzy matching, never re-detection, never position-based.

The defining risk of the milestone is not implementation difficulty — it is a set of design decisions that must be made before any code exists, because several are irreversible (the transcript is a ratchet: once a value enters model context it re-ships on every subsequent API call and no hook can claw it back). The single go/no-go question: **there is no display-only restore channel in the hook contract** — `updatedToolOutput` replaces what the *model* sees, so restored values re-enter the outbound wire on the next turn, in direct tension with REVMODE-01's "back into the user's view" framing. Either that wire re-exposure for identifier classes is a deliberate, documented decision, or the milestone shape must change. All four research files converge on the one non-negotiable floor that makes either answer survivable: SECRET/ENV/ENTROPY placeholder types are never restorable, enforced structurally at map-write time (their originals never persist anywhere), not by a config filter.

## Cross-Cutting Tensions Requirements Must Resolve

These five conflicts appear across multiple research files and CANNOT be deferred to implementation. They are the requirements step's primary work product. Numbered here for traceability; each maps to a Phase 1 decision below.

### T1 — GO/NO-GO: `updatedToolOutput` is model-facing; no user-display-only channel exists

- **The conflict:** REVMODE-01 is framed as restoring values "back into the user's view." But the verified hook contract offers no display-only rewrite surface: `updatedToolOutput` replaces what the model sees, `additionalContext` enters model context, and the terminal renders from the same transcript the model consumes (PITFALLS Pitfall 1; STACK re-leak hazard; ARCHITECTURE Insight 5). Restored identifier-class values (paths, names, Layer-4 dirty words) therefore re-enter model context → the wire on the next API call — and the transcript ratchet makes it permanent (history is never re-sanitized; `~/.claude/projects/**/*.jsonl` re-ships on resume).
- **Why it's invisible in testing:** the user's view and the model's view are the same transcript — a local test looks correct while quietly un-redacting the proprietary terms the user listed.
- **Resolution space:** (a) make the per-class wire-exposure decision explicitly — "reversible mode re-exposes path/name/identifier classes to Anthropic's API" — written into THREAT_MODEL.md with the v2.0 honest-framing/copy-drift-gate discipline; or (b) restrict restore to surfaces mrclean owns (operator-only `mrclean restore`/`mrclean show` CLI), gutting the in-session round-trip value. Mitigating fact: restore→re-redact is idempotent for restorable classes (stable placeholders re-map to the same token), so (a) is coherent *for identifier classes only* — it is exactly why secrets can never be in the restorable set (T3).
- **Non-negotiable regardless of the answer:** a canary round-trip CI gate capturing the next outbound API request body (Phase-01 UAT-2b harness precedent) proving the implementation matches the documented policy.
- **Verify empirically in Phase 1 (LOW confidence today):** whether the terminal renders `updatedToolOutput`; whether PreToolUse `updatedInput` rewrites echo into model context; whether the 10K-char hook output cap binds `updatedToolOutput`.

### T2 — Map ownership: encrypted per-session file vs MCP-server-resident memory

- **The conflict:** PROJECT.md's "in-memory only by default; encrypted at rest if persisted" is literally unsatisfiable for cross-hook-process state without a resident process (ARCHITECTURE). ARCHITECTURE's decision matrix leans strongly to **Option A: encrypted per-session file** under `~/.mrclean/sessions/` (crash-safe, works for hook-only installs, counter survives restarts); PITFALLS Pitfall 13 prefers **MCP-server-memory key custody** (crash kills the key → orphans become dead ciphertext) paired with the Pitfall-5 single-writer IPC alternative — which ARCHITECTURE's Option B analysis rejects as a correctness hazard (server restart mid-session loses the map AND resets the counter into NNN-collision against the live transcript) and an availability hole (hook-only installs get nothing; the MCP server doesn't even know the Claude Code `session_id`).
- **Recommended resolution:** Option A, reading "in-memory by default" as describing one-way mode (the default has no map at all; opting into reversible = consenting to encrypted session-scoped disk state). What would flip it: a requirements ruling that nothing plaintext-recoverable may ever rest on disk — then Option B with its documented costs.
- **Mechanism-level divergence to reconcile in Phase 2 planning (both satisfy the same invariants):** STACK recommends append-only JSONL with per-record AES-GCM (AAD = session_id) and a fully lock-free hot path (locks only for janitor/compaction); ARCHITECTURE recommends whole-file encrypt + a two-phase transaction with a ~2 ms locked allocate-and-persist step. Convergent invariants either way: never hold a lock across detection; ciphertext-only-on-disk including temp files; fresh random 12-byte IV per encryption event; GCM tag failure = map treated as absent (fail-safe); key never derived from `session_id`/hostname/env (random key material, key and ciphertext in different directories, 0600/0700); map never in the project tree; `write-file-atomic` alone is NOT mutual exclusion.

### T3 — Hardcoded restore-type floor: SECRET/ENV/ENTROPY never restorable (CONVERGED — treat as settled)

- All four files independently converge: reversibility is a per-TYPE property; secret classes (all 14 secret TYPEs + ENV + ENTROPY; PII_SSN/PII_CREDIT_CARD treated as secret-class) are excluded from the restorable set **by construction, not by filter** — no config knob can widen the floor, only narrow the restorable set. Enforced at map-*write* time (secret entries persist `{placeholder, type, hash, counter}` with no original — needed for cross-process stability, structurally unrestorable) AND at read time (restore skips non-policy tokens) — two independent gates, same rule. This is mrclean's actual differentiator: no ecosystem tool ships a non-configurable secret exclusion (Kong restores credentials; Pangea lets operators put FPE on anything). It is also what caps the map's blast radius: a fully exfiltrated map leaks one session's paths/names, never keys.
- Requirements should ratify the specific restorable set: WORD/paths/identifiers = yes; PII_EMAIL/PHONE/PERSON/ORG/LOC/IP = yes but config-narrowable; unknown/stale/OVF tokens = never (pass through).

### T4 — Placeholder scheme: enumeration + cross-process collision vs the shipped v1.0 contract (3-WAY DIVERGENCE)

- **What everyone agrees on:** sequential per-process NNN counters are unsafe in reversible mode — two concurrent hook processes each allocate `<MRCLEAN:PATH:007>` for different originals and restore substitutes the wrong value. Allocation must become content-addressed against shared session state (same original → same placeholder, idempotent across processes). This also fixes the latent v1/v2 cross-process stability gap and prevents restore→redact churn (map plateaus instead of growing every turn).
- **Where they diverge:** PITFALLS argues the v1.0 format is a security hole in reversible mode — sequential NNN is enumerable, so attacker-controlled content (fetched web page, cloned README) can spray literal `<MRCLEAN:TYPE:001..050>` tokens and turn restore into a deanonymization oracle; it mandates a **format v2 with per-session CSPRNG nonce** (`<MRCLEAN:TYPE:NNN:xxxxxxxx>`) for reversible mode ("never" reuse v1 format — tech-debt table). FEATURES calls the nonce redesign an **anti-feature** — a breaking change to the shipped v1.0 placeholder contract, arguing the collision failure mode is bounded (wrong-local-value substitution, never a wire leak) and map-scoped restore + documented residual risk is proportionate. STACK recommends **content-derived IDs** (`hash8(original + session_id)`) which eliminates counters entirely and is collision-proof per session but is also a format change.
- **Recommended resolution:** decide in requirements with the injection-oracle analysis given the most weight — PITFALLS' threat is about *planted* tokens restoring *real* values into content that flows onward (including to disk via Write/Edit tool inputs), which "restore only tokens this session's map actually issued" only partially mitigates when tokens are enumerable. A middle path preserving the shipped contract: v1 format stays for one-way mode (default, unchanged); reversible mode — already opt-in, new behavior — issues session-tagged tokens. Whatever is chosen, "only map-issued tokens ever match" + single-pass replacement + the Write/Edit placeholder tripwire are mandatory regardless.

### T5 — Janitor: SessionEnd is best-effort; reason-aware retention; TTL sweep is mandatory (CONVERGED — treat as settled)

- SessionEnd does not fire on crash/SIGKILL/power loss, its output is ignored by design, and it has a double-fire/missed-fire history (v2.1.72/78 fixes) — so it is the *primary* cleanup point, never the *only* one. A TTL orphan sweep (24h default, configurable) at SessionStart + MCP boot + throttled lazy hook-path checks is mandatory, not optional.
- **Reason-aware handling:** delete map on `clear`/`logout`/`prompt_input_exit`/`other`; **retain on `resume`** (the session may return with the same `session_id`; deleting breaks round-trip after `--resume`) with TTL as backstop; map must survive `compact` (placeholders survive compaction in context). Requirements should ratify retain-on-resume; note `session_id` continuity across `--resume` is unverified (LOW) — Phase 1 empirical check.
- **Installer implication:** the shipped SessionStart matcher is `'startup'` only — resume/clear/compact never fire today; the installer must widen it and migrate existing installs. The dispatcher throws on unknown events, so SessionEnd types/dispatcher routing must ship with-or-before installer registration or every session end produces exit-2 noise.

### T6 — MCP `restore` tool: PROJECT.md's target is stale and conflicts with shipped invariants

- PROJECT.md says "wire the `restore` MCP tool (stub since Phase 1)" — but the stub was deleted in Plan 03-01; `restore` is on `FORBIDDEN_TOOL_NAMES` with a CI test asserting exactly three tools; the v1 decision record explicitly rules restoration non-model-facing (prompt-injection Pitfall #10: an injected model calling restore pulls originals into its own context → the wire); and the MCP server never receives the Claude Code `session_id`, so the tool couldn't select the right map without a new identity handshake (all four facts HIGH confidence, verified in source).
- **Recommended resolution (ARCHITECTURE + PITFALLS agree):** keep the ban; deliver restore as the PostToolUse hook pass (deterministic, operator-configured policy, no model discretion) plus an **operator-only `mrclean restore` CLI**; amend PROJECT.md's stale wording. If requirements insist on the tool anyway: transport-derived session binding only (never a model-supplied `session_id` argument — spoofable), metadata-only responses to model-initiated calls, and a conscious amendment of MCP-03 + its tests.

## Key Findings

### Recommended Stack

Almost everything is stdlib; the platform floor matters more than any package. Claude Code **>= 2.1.121** is load-bearing (PostToolUse `updatedToolOutput` for all tools — verified against live docs, the SDK changelog, and two independent mirrors; current release train ~2.1.209 so most users already satisfy it). Enforce at `mrclean install`/doctor time via `claude --version` — there is no runtime feature detection (the hook cannot tell its output field was ignored), and the upstream changelog rolls old versions off so historical capability can't be checked from docs. Do NOT target the deprecated `updatedMCPToolOutput`.

**Core technologies:**
- **`node:crypto` (stdlib)** — AES-256-GCM encryption-at-rest + HKDF per-session key derivation — zero new deps; authenticated encryption gives tamper detection for free (a tampered map is an injection surface); sub-ms for a few-KB map. Never `createCipher` (IV-less), never key-from-`session_id` (public data), never key in env vars (`CLAUDE_ENV_FILE` leaks into every Bash subprocess → transcripts → wire).
- **`proper-lockfile@^4.1.2`** — cross-process mutual exclusion for SLOW paths only (janitor, compaction, deletion) — the only maintained-quality pure-JS cross-process lock (mkdir-based, win32+NFS safe, stale-heartbeat). Its clamped 2s staleness floor is exactly why **no lock ever goes on the hook hot path**.
- **`write-file-atomic@^7.0.1` — pin, do NOT float to ^8** — atomic replace on the locked slow path — v8's engines (`^22.22.2||^24.15.0||>=26`) silently break the Node 20 floor at install time (verified live); guard the major in renovate/dependabot. Inlining ~30 LOC tmp+fsync+rename is an acceptable alternative (Shannon-entropy precedent).
- **`fs` primitives** — `O_APPEND` single-syscall appends (no interleave for <4KB records — same guarantee audit.jsonl already relies on), `O_EXCL` (`wx`) for create-once key files, `statSync` for the MCP server's cache coherence (`tail -F` pattern; never `fs.watch` — unreliable + race window).

**Explicitly rejected:** SQLite/lmdb/level (native addons break zero-config npx; massive overkill), keytar (archived) and any keychain dep (POLISH-03 stays deferred; `getMachineKey()` is the single future swap point), fs-ext/flock (native addon), node-ipc or any socket IPC for state (MCP server not guaranteed alive; the file IS the IPC), userland crypto (crypto-js et al.), lowdb/steno (single-process designs — false confidence).

### Expected Features

The ecosystem's common shape is settled: redact outbound with indexed placeholders, map placeholder→original, restore inbound by **string-search substitution** (never position-based — model output is new text that merely quotes tokens; Presidio's offset API is unusable here and every LLM-facing wrapper avoids it). mrclean diverges from all five reference tools in two ways: the map must survive across process invocations (their single-process assumption doesn't hold), and restore policy must be per-TYPE with a hardcoded secret floor (they all restore everything — Kong even restores credentials).

**Must have (table stakes, all P1):**
- `[reversible]` opt-in config flag, **default OFF** — every reference tool except Kong is opt-in; mrclean's Key Decision already fixes this; zero-config first run stays one-way.
- Session State Adapter (`src/state/`): session-keyed cross-process map, locking, atomic writes, corrupt-map ⇒ treated-as-missing — the prerequisite for everything (REVMODE-02 before/with REVMODE-01, never after).
- Encryption-at-rest resolution per T2 — a plaintext map cannot ship even as an interim (PROJECT.md constraint is explicit; tech-debt table says "never").
- Class-based restore policy with the hardcoded secret floor (T3), enforced at map-write time.
- Restore on return path per the T1 decision: PostToolUse `updatedToolOutput` (+ PreToolUse `updatedInput` for local-tool input restore if the echo question clears) with **per-destination policy** — local tools vs remote MCP tools have opposite data directions; no ecosystem precedent exists for this split.
- **Fail one-way, never block:** unmatched/missing/corrupt map ⇒ pass through with placeholders intact + `systemMessage` warning. Asymmetric by design: redact stays fail-closed (leak), restore fails safe (cosmetic). Ecosystem-validated (LiteLLM's observed failure mode is visible placeholders — annoying, safe).
- SessionEnd janitor + TTL orphan sweep (T5).
- Hash-only restore audit events + leak-grep extension to the restore path and map artifacts.
- Round-trip regression: redact → restore → re-redact proves restored values re-map to the SAME placeholder (idempotence) and never escape on the next outbound hop.
- Doctor gate: reversible enabled + CC < 2.1.121 ⇒ loud FAIL, never silent no-op; plus a behavioral canary (prove `updatedToolOutput` was *honored*, not just emitted).
- THREAT_MODEL.md reversible-mode section (REVMODE-03): blast radius, secret exclusion rationale, wire re-entry loop, collision residual risk, honest key-custody framing.

**Should have (differentiators):**
- The hardcoded secret floor itself — unique in the ecosystem (T3).
- Fail-closed cross-process state adapter — engineering none of the reference tools have.
- Restore-scope transparency in `mrclean_status` (entry counts by class, restored/unmatched counters — never values).

**Defer (v3.x+):**
- Delimiter/case-tolerant matching + near-miss audit — add when real transcripts show mangled placeholders (measure first; the fixed format may survive better than free-text placeholders). **Never Levenshtein fuzzy** — distance-1 edits are different identities (`:001` vs `:002`); wrong-value restoration is silent data corruption in a security tool.
- Per-type restore allowlist config narrowing; restore-miss telemetry.
- Keychain persistence (POLISH-03), cross-session/crash-recovery restore, format revision — only on field evidence.

**Anti-features (hard "no" list):** fuzzy restore; restoring secrets ("complete the round-trip" symmetry); cross-session/persistent map (Out of Scope; Vault mitigates the identical risk with TTLs); plaintext map file; blocking on restore failure (Kong's `stop_on_error` inverted for our context — pushes users to uninstall); synthetic/faker replacements (breaks tool execution in an agent context); originals in audit; inline restore markers in content; position-based restore; re-detection on the return path (map lookup only — keeps <200ms trivially).

### Architecture Approach

The core tension: hook processes are spawned fresh per event and die (`process.exit()` every time), while the map must span the session — so the map lives outside hook memory (T2, leaning Option A: encrypted per-session file under `~/.mrclean/sessions/`, key material in a separate directory, never the project tree). Restore is a **different algorithm than redact** — a new pure `restoreText()` (~80 LOC): single-pass token-regex scan + map lookup; no ordering problem (delimited disjoint tokens), no recursive expansion (`replace()` never rescans inserted text), OVF tokens skipped (last-writer-wins ambiguity), unknown tokens left intact. Do NOT reuse `substituteFindings` (span-based, wrong trust direction). PostToolUse ordering is **redact first, then restore** — placeholder tokens are inert to detection layers, and the reverse order creates churn. Allocation becomes a **two-phase transaction**: detect lock-free (the expensive part), then a ~2 ms locked allocate-reconcile-persist step (re-check by hash — a concurrent process may have allocated the same value; take its placeholder), then substitute lock-free. This fixes the latent v1/v2 cross-process counter collision as a side effect — valuable even before restore ships.

**Major components (new):**
1. **`src/state/`** (Session State Adapter, REVMODE-02) — facade (`withSessionMap`/`readSessionMap`), map schema (+version guard; secret-type entries structurally lack `original`), encrypted store (AES-256-GCM, atomic write, 0600/0700), lock, janitor. All disk-I/O policy behind one facade; no `node:crypto`/lock imports outside it (enforce with an import-graph test); lazy-imported behind the config flag so the one-way cold path stays byte-identical.
2. **`src/restore/restore-text.ts`** — pure token-scan restore + `RestorePolicy` filter, deliberately separate from `src/placeholder/` (opposite trust direction: it *introduces* sensitive data — a reviewer auditing "what can put originals back" finds exactly one directory).
3. **`src/hook/handlers/session-end.ts`** + dispatcher/types/installer changes — SessionEnd routing, SessionStart matcher widening (`startup|resume|clear|compact`), migration for existing installs.
4. **Operator restore CLI** (`mrclean restore`) — the recommended replacement for the banned MCP tool (T6).
5. **Modified:** PlaceholderManager (hydrate/serialize seam, policy-scoped `retainOriginals`, default construction byte-identical), detection orchestrator (manager injection seam), PreToolUse/PostToolUse handlers (persist + restore branches, batched to ONE locked transaction per event), doctor, config (`[reversible]` table), audit (`action:'restore'` — LOCKED schema, extend deliberately), THREAT_MODEL.md.

Performance fits comfortably: reversible mode adds ~4–8 ms typical / ~60 ms worst-case contended to PostToolUse (decrypt <1 ms, lock ~0.1 ms uncontended with a ~50 ms deadline → degrade, encrypt+fsync+rename 1–2 ms, restore scan <1 ms) — detection remains the dominant cost. All degrade paths are non-fatal and lean one-way-safe.

### Critical Pitfalls

1. **"User-view only" restore has no hook-native home (go/no-go)** — `updatedToolOutput` is model-facing; restored values ratchet into the transcript and re-ship on every subsequent request, invisibly (user view == model view). Avoid: T1 decision first, canary round-trip CI gate capturing the actual outbound request body, THREAT_MODEL honest framing. *Prevent-only — there is no recovery once shipped.*
2. **Restore reinserts secrets / model-facing restore oracle** — class-blind `map.get(ph)` restore sends secrets back to the wire; a model-invocable restore tool is a prompt-injected self-service deanonymization oracle. Avoid: structural type separation (secret originals never persist — T3), no model-facing restore surface (T6), canary regression across every surface.
3. **The map file becomes the leak vector** — a curated, labeled index of everything mrclean deemed sensitive; plaintext (or key-beside-ciphertext, or plaintext temp files from atomic writes) makes it a better exfil target than the repo. Avoid: ciphertext-only-on-disk invariant (encrypt in memory first, fs-write interception test), state dir outside the project tree with 0700/0600 + O_EXCL, key in a different directory, PreToolUse denylist on the state dir, restorable-types-only originals.
4. **Cross-process placeholder collision + concurrent map corruption** — parallel hooks (verified: hooks run in parallel) with per-process counters allocate the same NNN for different originals → restore substitutes the wrong value; unlocked read-modify-write corrupts/loses entries. Avoid: content-addressed allocation under shared state (T4), locking + atomic writes, 8–16-process stress test gating CI. Never fuzzy-match to compensate for model-mangled tokens — bounded normalization + log-and-skip only.
5. **Placeholder injection via enumerable format** — guessable sequential tokens planted in attacker-controlled content get swapped for real values, flowing onward to the wire or to disk via Write/Edit inputs. Avoid: T4 decision (nonce/content-derived IDs), single-pass replacement, only-map-issued tokens match, restore never runs on tool inputs/file-write payloads, adversarial fixture suite (planted/cross-session/nested tokens, >999 entries).
6. **Fail-open temptation + key-management footguns** — shared error handling where restore breakage disables redaction; key derived from session_id; GCM nonce reuse across rewrites; "encrypted at rest" copy overclaiming local-attacker protection. Avoid: two error domains with no shared kill switch (chaos test proves a canary is still redacted after restore breaks), fresh IV per write, tag-failure = map absent, THREAT_MODEL names the adversary classes file-based custody does NOT stop, copy-drift CI gate.

## Implications for Roadmap

PITFALLS' phase mapping and ARCHITECTURE's build order converge cleanly on a four-phase structure with one hard rule: **the threat model and design decisions come FIRST, not last** — Pitfalls 1, 2, 3, 6, 10, 13 are design decisions, and the transcript ratchet makes the T1 mistake unrecoverable after the fact.

### Phase 1: Go/No-Go, Threat Model & Contract Plumbing (REVMODE-03 decisions)
**Rationale:** T1–T6 gate everything; three contract questions are empirically unverified (LOW confidence) and cheap to test; the SessionEnd/installer plumbing is independently shippable with zero behavior change and unblocks all later phases.
**Delivers:** Ratified decisions for T1 (restore surface + per-class wire-exposure policy), T2 (map ownership — expected: Option A), T4 (placeholder scheme for reversible mode), T5 (retain-on-resume), T6 (keep MCP ban + operator CLI; amend PROJECT.md's stale stub wording). Empirical verification: terminal rendering of `updatedToolOutput`, `updatedInput` context echo, `session_id` continuity across `--resume`, 10K-char cap behavior, structured `tool_response` shapes for built-in tools. Plumbing: `SessionEndInput` type + dispatcher route + no-op handler; `[reversible]` config table (default off); installer SessionEnd registration + SessionStart matcher widening + migration; doctor version-floor check. THREAT_MODEL.md draft (blast radius, secret-floor rationale, wire re-entry, custody honesty).
**Addresses:** opt-in flag; doctor gate; THREAT_MODEL section.
**Avoids:** Pitfalls 1 (go/no-go), 2/13 (custody decided before build), 3 (floor as scope fence), 6 (trust boundaries), 10 (failure-asymmetry policy).

### Phase 2: Session State Adapter (REVMODE-02)
**Rationale:** Hard prerequisite for restore — without it there is nothing to restore from. Heaviest unit-test surface; build and gate before anything consumes it. Also where the STACK-vs-ARCHITECTURE storage-mechanics divergence (append-only JSONL vs whole-file + short lock) gets reconciled during phase planning.
**Delivers:** `src/state/` (schema with structurally-original-free secret entries, encrypted store with fresh-IV-per-write + tag-failure = absent, lock confined off the detection path, janitor with reason-aware SessionEnd + multi-point TTL sweep); content-addressed allocation under the shared store; PlaceholderManager hydrate/serialize seam (one-way path proven byte-identical); error taxonomy (`SanitizeError` fail-closed / `RestoreError` fail-safe, no shared kill switch).
**Uses:** `node:crypto` AES-256-GCM + HKDF, `proper-lockfile@^4.1.2`, `write-file-atomic@^7.0.1` (pinned), O_EXCL/O_APPEND patterns.
**Implements:** the state adapter + janitor components; the two-phase allocation transaction.
**Avoids:** Pitfalls 2 (ciphertext-only + placement + perms), 4 (locked content-addressed allocation), 5 (locking + atomic writes + stress test), 8 (idempotent allocation), 12 (multi-point janitor, kill-9/resume/compact matrix), 13 (crypto mechanics).

### Phase 3: Restore Path (REVMODE-01)
**Rationale:** Consumes Phase 2's adapter and Phase 1's decisions. The restore engine is a pure function (parallel-buildable with late Phase 2); the wiring is where ordering, degrade paths, and the contract module land.
**Delivers:** `restoreText()` + `RestorePolicy` (table-driven tests: OVF skip, unknown skip, adjacency, placeholder-shaped originals, policy filter, >999 entries, adversarial fixtures); PostToolUse redact→persist→restore wiring with degrade paths (lock timeout → process-local allocations + warn; missing/corrupt map → redact-only + warn; never block); PreToolUse allocation persistence (+ input restore only if Phase 1 cleared the echo question); contract module (`src/hooks/contract.ts` — field names, version floors, Zod validation, one place to absorb upstream drift); audit `action:'restore'` through the `sanitizeForOutput()` chokepoint; operator `mrclean restore` CLI; perf-gate extension.
**Addresses:** restore on return path; per-destination policy; fail-one-way semantics; hash-only restore audit; stub-debt closure via CLI (per T6).
**Avoids:** Pitfalls 3 (policy-filtered engine), 7 (single-pass + Write/Edit tripwire), 8 (ordering invariant), 9 (chokepoint wiring), 11 (contract module + version gate).

### Phase 4: Verification, Hardening & Honest Copy
**Rationale:** The milestone's guarantees are negative claims — only adversarial, end-to-end verification proves them. Everything here has shipped precedent (UAT-2b headless harness, leak-grep, copy-drift gate).
**Delivers:** Canary round-trip gate (restored canary absent from — or present only per documented policy in — the next outbound request body AND `~/.claude/projects/**/*.jsonl`); mixed-content canary (fake AWS key + fake path: path round-trips, key placeholder survives every surface); chaos tests (corrupt/delete/chmod/truncate map → placeholders pass through, canary still redacted, no tool blocked); 8–16-process concurrency stress test gating CI; fs-write interception test (no plaintext canary in any written buffer incl. temp files); map plateau + distinct-placeholder-per-value-hash assertions; doctor behavioral canary (`updatedToolOutput` honored); leak-grep extended to map artifacts/stderr/debug transcript; THREAT_MODEL.md finalization + copy-drift gate over "encrypted at rest" claims; PROJECT.md amendment (stale restore-stub wording).
**Avoids:** the verification half of every pitfall; the "looks done but isn't" checklist is this phase's acceptance criteria.

### Phase Ordering Rationale

- **Decisions before code** because T1 is unrecoverable if gotten wrong (transcript ratchet), and T2/T4 shape the adapter's schema and API — reversing the order forces a map-schema migration mid-milestone.
- **Adapter before restore** because every reference tool proves restore is trivial *given* a map; mrclean's entire novelty (and risk) is the cross-process map. The cross-process stability fix also delivers standalone value (fixes latent v1/v2 collision) even if restore slips.
- **Policy fence before persistence** — the secret floor is enforced at write time; sequencing it after the adapter leaves a window where secret originals sit in shared state.
- **Verification last but specified first** — the canary/chaos/stress gates are named in Phases 1–3's acceptance criteria so implementations are built against them, not retrofitted.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** `--research-phase` recommended — three LOW-confidence contract behaviors need live empirical verification (terminal rendering of `updatedToolOutput`, `updatedInput` context echo, `session_id` continuity across `--resume`, 10K-char cap, per-tool structured `tool_response` shapes). These are quick headless-session experiments, but their answers change the milestone's shape (T1) and the resume/rehydration design (T5).
- **Phase 2:** design-level reconciliation needed at phase start — append-only JSONL + lock-free hot path (STACK) vs whole-file + short locked transaction (ARCHITECTURE), and the exact key layout (master+HKDF vs per-session sibling; PITFALLS' key-not-beside-ciphertext guidance favors STACK's separate `~/.mrclean/keys/` directory). Not a blocker — both satisfy the same invariants — but it must be pinned before the store is built.

Phases with standard patterns (skip research-phase):
- **Phase 3:** the restore engine is a pure function with exhaustive prior art (LLM Guard/LiteLLM string substitution); hook wiring follows shipped v1/v2 handler patterns; the contract module mirrors existing doctor/version-check precedent.
- **Phase 4:** every gate extends an existing, shipped harness (UAT-2b headless canary, leak-grep, copy-drift, perf CI).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Hook contract verified against live docs + SDK changelog + two independent mirrors; package versions/engines verified live via `npm view` on 2026-07-14 (incl. the write-file-atomic ^8 Node-floor break); crypto/locking APIs via Context7. |
| Features | HIGH | Five reference tools verified via official docs/source (LLM Guard, LiteLLM, Kong, Presidio, Pangea) + Vault tokenization governance patterns; mrclean-specific divergences grounded in the verified hook contract. Kong/LiteLLM map internals are inferred (LOW) but not load-bearing. |
| Architecture | HIGH on code facts and hook contract (read directly from shipped source, incl. the MCP-ban/no-stub/no-session-id facts); MEDIUM on MCP-server lifecycle assumptions; LOW on `session_id` resume continuity (flagged, Phase 1). |
| Pitfalls | HIGH on contract facts and architecture-derived reasoning; MEDIUM on concurrency-corruption prevalence and LLM placeholder-mangling frequency (community postmortems + vendor docs, multiple sources agree). |

**Overall confidence:** HIGH — with the explicit caveat that the milestone's go/no-go question (T1) rests on a verified *absence* (no display-only channel found in current docs) and three unverified behaviors that Phase 1 must test empirically before the design is frozen.

### Gaps to Address

- **Display semantics of `updatedToolOutput`** (does the terminal render it, or only the model see it?) — determines how much "back into the user's view" the feature actually delivers. Handle: live headless test in Phase 1; the T1 decision consumes the answer.
- **PreToolUse `updatedInput` context echo** — determines whether input-side restore (tools executing against real paths) is safe or has the same ratchet problem. Handle: same canary methodology, Phase 1; input restore is scoped out until cleared.
- **`session_id` continuity across `--resume`** — determines whether resume-rehydration is real or dead code, and the retain-on-resume janitor policy's value. Handle: empirical check, Phase 1.
- **10K-char hook output cap vs large tool results** — if it binds `updatedToolOutput`, restoring inside big file reads may truncate. Handle: test with >10KB tool result in Phase 1; define chunk/skip behavior.
- **Structured `tool_response` shapes for built-in tools** — docs only show a Bash string example; hook authors own schema invariants. Handle: per-tool empirical verification early in Phase 3.
- **Placeholder-scheme arbitration (T4)** — a genuine 3-way researcher divergence (nonce format vs anti-feature vs content-derived IDs). Handle: requirements decision with the injection-oracle threat weighted heaviest; content-addressed allocation is mandatory under every option.
- **Storage mechanics reconciliation (T2 tail)** — append-only vs whole-file, key layout. Handle: Phase 2 planning; invariants already converged.

## Sources

### Primary (HIGH confidence)
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) (fetched 2026-07-14 by all four researchers) — `updatedToolOutput` semantics ("replaces the tool's result"), PostToolUse non-blocking, `updatedInput`, `additionalContext`, SessionStart sources (`startup|resume|clear|compact`), SessionEnd reasons + output-ignored + not-crash-guaranteed, `session_id` in all events, parallel hook execution, 10K-char output cap, `CLAUDE_ENV_FILE`/`CLAUDE_CODE_REMOTE`.
- [anthropics/claude-agent-sdk-typescript CHANGELOG](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md) v0.2.121 + issues #32105/#36843/#24788 — `updatedToolOutput` all-tools expansion at 2.1.121; `updatedMCPToolOutput` deprecated; schema-invariant responsibility on hook authors.
- `npm view` (live 2026-07-14) — `proper-lockfile@4.1.2`, `write-file-atomic` 6/7/8 engines matrix (v8 breaks Node 20 floor), `lockfile` (deprecated), `steno`.
- Context7 `/nodejs/node` (AES-GCM/`hkdfSync` semantics), `/moxystudio/node-proper-lockfile` (staleness clamps, mkdir mechanism), `/protectai/llm-guard` (Deanonymize matching strategies, Vault contract), `/data-privacy-stack/presidio` (DeanonymizeEngine, position-based API).
- Vendor docs: LiteLLM `output_parse_pii`, Kong `ai-sanitizer` (`recover_redacted`/`stop_on_error`), [Pangea Redact FPE/`unredact`](https://pangea.cloud/docs/redact/using-redact/redact-rules), [Vault tokenization `decode`/TTL/`tidy`](https://developer.hashicorp.com/vault/docs/secrets/transform/tokenization), LangChain deanonymizer source.
- mrclean shipped source (read 2026-07-14): `src/hook/*`, `src/detect/*`, `src/placeholder/*`, `src/mcp/server.ts` + `tools/redact.ts`, `src/audit/log.ts`, `src/install/*`, `src/config/defaults.ts`, `src/shared/types.ts`, `src/doctor/*`, `tests/mcp/tools-list.test.ts` (FORBIDDEN_TOOL_NAMES), `03-03-PLAN.md:460` (non-model-facing restore decision); `.planning/PROJECT.md` constraints.

### Secondary (MEDIUM confidence)
- Claude Code changelog mirrors (claudefa.st, buildthisnow.com) — 2.1.121 entry (official changelog rolls off old versions), v2.1.72/78 SessionEnd reliability fixes.
- LiteLLM issues #22821/#6247 — real-world restore failure modes = degraded-but-safe (licenses fail-one-way).
- Community hooks postmortems (blakecrosley.com, claudefa.st, totalum.app) — parallel-hook JSON corruption, last-writer-wins on concurrent rewrites.
- Microsoft PII Shield, DZone/Medium reversible-tokenization writeups, NHIMG/Baffle detokenization-path analyses, OWASP LLM01 + Unit 42 — restore path as highest-privilege surface; injection/enumeration attack chains; Private-AI-style per-session token nonces.

### Tertiary (LOW confidence — verify in Phase 1)
- Terminal rendering of `updatedToolOutput`; `updatedInput` transcript echo; `session_id` continuity across `--resume`; 10K-char cap applicability; per-tool structured `tool_response` shapes; Kong/LiteLLM map internals (inferred, not load-bearing).

---
*Research completed: 2026-07-14*
*Ready for roadmap: yes*
