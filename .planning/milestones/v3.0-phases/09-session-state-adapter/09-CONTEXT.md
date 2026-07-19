# Phase 9: Session State Adapter - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning
**Mode:** --auto (all gray areas auto-resolved on recommended options; every pick logged in 09-DISCUSSION-LOG.md for audit)

<domain>
## Phase Boundary

An enabled reversible session persists an encrypted, cross-process placeholder→original map with stable content-addressed allocation, a structural secret floor, and a reason-aware lifecycle janitor — while the one-way default stays byte-identical (code path and shipped placeholder format untouched when `[reversible]` is absent/false).

Delivers REVMODE-02 (encrypted session store), REVMODE-04 (content-addressed cross-process allocation), REVMODE-05 (session-tagged v2 tokens, reversible-only), REVMODE-06 (structural secret floor), REVMODE-07 (reason-aware janitor + TTL sweep — completes here; installer/dispatcher groundwork shipped in Phase 8).

NOT this phase: `mrclean restore` CLI (Phase 10), any model-facing or hook-path restore (banned — T1/T6 locked), CI canary/chaos/stress *gates* (Phase 11 — but the adapter must already hold at integration level: 8–16-process stress loses no entries, corrupt/missing/chmod'd map treated as absent).

</domain>

<decisions>
## Implementation Decisions

### Store mechanism (T2 reconciliation — ROADMAP-flagged, pinned here)
- **D-01:** Whole-file encrypt + short locked transaction (ARCHITECTURE variant) over append-only JSONL + lock-free hot path (STACK variant). Deciding argument: REVMODE-04's allocate-if-absent semantics (same original → same placeholder across concurrent processes) requires read-check-allocate-persist atomicity — a lock-free append log cannot give it without post-hoc dedup that breaks placeholder stability; and REVMODE-05's ratified `NNN` counter needs coordinated increment anyway. Whole-file also has fewer failure shapes: no torn-JSONL-tail handling, no compaction sub-janitor. ARCHITECTURE measured the locked allocate-and-persist step at ~2 ms — fits the <100 ms UserPromptSubmit budget.
- **D-02:** Mutual exclusion via a real lock (e.g. `mkdir`-style O_EXCL lockdir or `proper-lockfile` semantics) around the allocate-and-persist transaction only. Invariants locked from research (all four files converge): never hold the lock across detection; `write-file-atomic` alone is NOT mutual exclusion; lock scope is the ~2 ms read→allocate→encrypt→rename window.
- **D-03:** Map I/O invariants (converged, restated as build contract): ciphertext-only on disk INCLUDING temp files (encrypt before any write, then atomic rename); AES-256-GCM, fresh random 12-byte IV per encryption event; GCM tag failure ⇒ map treated as absent (fail-safe, redaction unaffected); map never inside the project tree.

### Key custody layout (ROADMAP-flagged "exact key layout", pinned here)
- **D-04:** Per-session random 256-bit key, generated with CSPRNG at first reversible allocation. Key file `~/.mrclean/keys/<session_id>.key` (0600) in `~/.mrclean/keys/` (0700); ciphertext `~/.mrclean/sessions/<session_id>.map` (0600) in `~/.mrclean/sessions/` (0700). Key and ciphertext in different directories per SC1. Key CONTENT is never derived from `session_id`/hostname/env (random material only — the session_id appears solely in file NAMES for lookup/janitor pairing).
- **D-05:** No passphrase/KDF, no MCP-server-resident key custody (PITFALLS-13 alternative rejected with T2 Option B — server restart loses map + resets counter; hook-only installs get nothing). Janitor deletes key file and map file together; a deleted key makes any orphaned ciphertext permanently dead — that IS the crash-cleanup story. Honest framing carried from THREAT_MODEL: file custody stops casual single-artifact exfiltration, not a same-user local attacker.

### Janitor semantics (T5 converged + one new edge pinned)
- **D-06:** Retention is an ALLOWLIST: retain the map only on `reason === 'resume'`. Every other reason — the documented delete set (`clear`/`logout`/`prompt_input_exit`/`other`) AND any unknown future reason string (SessionEndInput.reason is an open string per 08-01) — deletes map + key. Fail-toward-privacy: over-deletion costs a cosmetic re-redaction; under-deletion leaves recoverable originals resting on disk.
- **D-07:** TTL orphan sweep runs at SessionStart hook and MCP-server boot (both sites — headless sessions never fire SessionEnd, proven E5). Sweep pairs: map without key, key without map, and either older than TTL → delete. Map must survive `compact` (SessionStart matcher fires on compact; sweep must not treat a live session's map as orphaned — age by mtime refreshed on write).
- **D-08:** `handleSessionEnd` replaces the Phase 8 no-op with the reason-aware janitor, keeping the fail-closed wrapper contract: janitor errors must never produce exit-2 noise at session end (swallow-and-audit, never throw).

### Config surface ([reversible] table widening)
- **D-09:** `[reversible]` gains exactly one new key this phase: `ttl_hours` (integer ≥ 1, default 24). Fail-closed validation per the 08-01 precedent (wrong type ⇒ ConfigReadError naming file + reason); unknown keys stay tolerated-and-dropped; partial-layer merge semantics from 08-07 apply (user opt-in survives project partial tables). YAGNI fence holds: no other knobs (no cipher choice, no path overrides — paths are fixed contract).

### Placeholder format & allocation (T4 — ratified by REVMODE-05, restated)
- **D-10:** One-way default: v1 `<MRCLEAN:TYPE:NNN>` format and per-process counter code path byte-identical (regression-gated, same discipline as Phase 8's SC2). Reversible sessions: v2 `<MRCLEAN:TYPE:NNN:nonce8>` with a per-session CSPRNG nonce (kills planted-token enumeration); allocation is content-addressed against the shared store — lookup by per-session hash of the original; same original (any TYPE) → identical placeholder from any hook process.
- **D-11:** Secret floor at map-WRITE time (T3, converged): all secret TYPEs, ENV, ENTROPY, and checksummed PII (SSN/credit-card) persist `{placeholder, type, hash, counter}` with NO `original` field — structurally unrestorable, needed for cross-process stability. No config can widen the restorable set, only narrow it. (Read-time enforcement is Phase 10's second gate.)

### Claude's Discretion
- Exact lockfile primitive (lockdir vs lockfile lib) — planner/researcher pick against the stress criterion (SC5) and zero-new-heavy-deps preference.
- Map file internal schema (JSON shape inside the encrypted envelope), hash function for content-addressing (non-cryptographic OK for dedup; collision = same placeholder for different originals, which restore-scope makes cosmetic — document the residual).
- Doctor check-8 copy update (enabled path drops "plumbing only" once the adapter is real) and mrclean_status counters wording.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Store mechanism & invariants (the T2 reconciliation inputs)
- `.planning/research/SUMMARY.md` §T2–T6 — conflict analysis, converged invariants, recommended resolutions (T3/T5 settled; T2 mechanism pinned by D-01 above)
- `.planning/research/ARCHITECTURE.md` — Option A decision matrix, two-phase locked transaction design (D-01's chosen variant)
- `.planning/research/STACK.md` — crypto specifics (AES-256-GCM parameters), the rejected JSONL alternative (context for why), key-handling rules
- `.planning/research/PITFALLS.md` — Pitfall 5 (single-writer IPC rejected), Pitfall 13 (key custody), planted-token enumeration threat (drives v2 nonce)

### Empirical hook-contract ground truth (Phase 8 outputs)
- `docs/HOOK-CONTRACT.md` — §E3 session_id continuity across --resume (T5 rehydration REAL — retain-on-resume has a substrate); §E5 SessionEnd does NOT fire headless (TTL sweep is primary there, not backstop); §E4 no 10K cap at ~15K (map growth bounded by tool-output size, not a hook cap)
- `tests/uat/artifacts/contract-findings.json` — version-stamped evidence (CC 2.1.209, 2026-07-14) behind every HOOK-CONTRACT verdict

### Threat model & requirements
- `THREAT_MODEL.md` §"Reversible Mode (v3.0)" — map blast radius, structural secret floor, wire re-entry deferral, key-custody honesty, accepted residuals; drift-gated by tests/copy-drift.test.ts (extend the gate when copy changes)
- `.planning/REQUIREMENTS.md` — REVMODE-02/04/05/06/07 exact texts (REVMODE-07 completes HERE — its checkbox was prematurely flipped once in Phase 8 and reverted; do not mark until janitor + TTL sweep ship)

### Build discipline
- `.planning/phases/08-contract-verification-reversible-plumbing/deferred-items.md` — 36-error typecheck baseline + differential gate discipline (suite baseline now 642 passed / 14 skipped after 08-12)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/placeholder/manager.ts` — v1 `<MRCLEAN:TYPE:NNN>` formatter, per-process counter, OVF variant (line 94-96); v2 token + content-addressed allocation layer on top, one-way path untouched
- `src/config/index.ts` — `validateReversibleConfig` (08-01) + partial-layer merge (08-07): widen for `ttl_hours` following the exact same fail-closed + conditional-spread patterns
- `src/hook/handlers/session-end.ts` — Phase 8 no-op with JSDoc explicitly documenting this phase's janitor replacement; fail-closed wrapper already routes SessionEnd
- `src/install/settings.ts` — 5-event surface + widened SessionStart matcher SHIPPED (08-02); REVMODE-07's installer clause is already done — do not re-plan it
- `src/install/atomic-json.ts` — atomic tmp-write+rename precedent (now with mkdir, 08-12); NOTE: research invariant says atomic-write ≠ mutual exclusion — reuse the rename pattern, add the lock separately

### Established Patterns
- Fail-closed config errors: ConfigReadError with file + reason (Test B pattern, 08-01)
- Byte-identical default gate: full-suite green with zero edits to detection/placeholder/audit suites when the feature is off (Phase 8 SC2 discipline — reuse for v1 path)
- Doctor reporting-only check 8 (`reversible mode: enabled — plumbing only...`) — copy update lands here; check stays reporting-only until Phase 10's FAIL-loud
- Differential typecheck gate vs 36-error baseline; dist rebuild as separate chore commit

### Integration Points
- Hook dispatcher (`src/hook/dispatcher.ts`) — SessionEnd routes to janitor; SessionStart handler gains TTL sweep call
- MCP server boot (`src/mcp/server.ts`) — second TTL sweep site (headless coverage)
- `src/mcp/tools/status.ts` — mrclean_status gains entry-count-by-class counters (never values) if in scope per plan; hash-only discipline from audit module applies
- Doctor check 8 (`src/doctor/checks.ts:557-559`) — constant detail strings updated when adapter is real

</code_context>

<specifics>
## Specific Ideas

- SC1's operator-inspection framing is a real acceptance test: `ls -la ~/.mrclean/sessions/` shows ciphertext-only files (including any temp files mid-write), keys live in the separate 0700 `~/.mrclean/keys/`, nothing in the project tree — write the integration test to literally inspect the dirs.
- SC3's proof shape: decrypt-and-dump test asserts secret-class entries structurally lack `original` (property absent, not empty/null).
- SC5 integration-level stress: 8–16 concurrent processes allocating overlapping originals, zero lost/corrupted entries, identical placeholders for identical originals; corrupt/missing/chmod 000 map ⇒ redaction output identical to one-way mode.

</specifics>

<deferred>
## Deferred Ideas

- Restore-path work of any kind (CLI, policy filter, pass-through rules) — Phase 10 (REVMODE-01).
- Live canary round-trip, fs-write interception, chaos gates as CI — Phase 11 (build against their named criteria now, gate later).
- Per-type restore allowlist narrowing knob + restore-miss telemetry — v3.x (research "Defer" list).
- Unpackaged spike findings (`.planning/spikes/MANIFEST.md` — positioning/comparison spikes 001, follow-ups 002/002b proposed): unrelated to session-state scope; run `/gsd:spike --wrap-up` when relevant to a detection-coverage phase.

</deferred>

---

*Phase: 09-session-state-adapter*
*Context gathered: 2026-07-17 (auto mode — single pass)*
