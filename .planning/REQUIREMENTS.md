# Requirements: mrclean

> v3.0 "Reversible Redact Mode — Foundations + Operator Restore". Reshaped 2026-07-14 after research proved the hook contract has no display-only rewrite channel (T1): in-session restore is deferred; this milestone ships the encrypted session-map foundations, cross-process placeholder stability, and an operator-only restore CLI. Zero model-facing restore surface, zero wire re-exposure. Default mode stays one-way, byte-identical to v2.0 behavior.

## v3.0 Requirements

### Session State Adapter (map foundations)

- [ ] **REVMODE-02**: Operator can enable reversible mode via a `[reversible]` config table (default OFF); an enabled session persists a session-scoped placeholder→original map across hook events as an encrypted file (AES-256-GCM, fresh IV per write, key material in a separate 0700 directory, ciphertext-only on disk including temp files, never inside the project tree)
- [ ] **REVMODE-04**: Concurrent hook processes in a reversible session allocate collision-free, stable placeholders — content-addressed allocation under the shared session store (same original → same placeholder across processes), closing the latent per-process counter-collision gap for reversible sessions
- [ ] **REVMODE-05**: Reversible sessions issue session-tagged v2 tokens `<MRCLEAN:TYPE:NNN:nonce8>` (per-session CSPRNG nonce, kills planted-token enumeration); the one-way default keeps the shipped v1 placeholder format and code path byte-identical
- [ ] **REVMODE-06**: Secret-class originals (all secret TYPEs, ENV, ENTROPY, checksum'd PII such as SSN/credit-card) are never persisted anywhere — map entries for these types structurally lack an `original` field; no configuration can widen this floor, only narrow the restorable set
- [ ] **REVMODE-07**: Map lifecycle janitor — reason-aware SessionEnd handling (delete on `clear`/`logout`/`prompt_input_exit`/`other`; retain on `resume`) plus a TTL orphan sweep (24 h default, configurable) at SessionStart and MCP-server boot; installer widens the SessionStart matcher (`startup|resume|clear|compact`) with migration for existing installs

### Operator Restore

- [ ] **REVMODE-01**: Operator can restore placeholders to originals locally via a `mrclean restore` CLI (stdin or file input → restored output on stdout) — exact map lookup, single-pass token scan, policy-filtered; unknown, stale, and OVF tokens pass through unchanged; no hook-path restore, no MCP tool (`restore` stays on FORBIDDEN_TOOL_NAMES with CI enforcement)
- [ ] **REVMODE-08**: Restore failures degrade one-way (placeholders remain visible plus a warning) and never block a tool call or disable redaction — restore and redact have separate error domains with no shared kill switch
- [ ] **REVMODE-09**: Restore operations are audited hash-only (never raw values), and the leak-grep regression is extended over map artifacts, restore code paths, and their error paths

### Contract Verification & Hardening

- [ ] **REVMODE-10**: Hook-contract behaviors are empirically verified in live headless sessions and documented — terminal rendering of `updatedToolOutput`, PreToolUse `updatedInput` context echo, `session_id` continuity across `--resume`, 10K-char output-cap applicability — and an upstream feature request for a display-only rewrite channel is filed
- [ ] **REVMODE-11**: CI proves reversible mode never re-exposes originals on any wire path — hook stdout is unchanged by reversible mode, no plaintext canary appears in any written buffer (including atomic-write temp files), chaos tests show redaction survives a corrupt/missing/chmod'd map, and an 8–16-process concurrency stress test gates the build
- [ ] **REVMODE-12**: Doctor and status stay honest — `mrclean doctor` reports reversible-mode state and FAILs loud (never silent no-op) on unsupported configuration; `mrclean_status` exposes map entry counts by class and restored/unmatched counters, never values

### Threat Model & Docs

- [ ] **REVMODE-03**: THREAT_MODEL.md gains a reversible-mode section — map blast radius, secret-floor rationale, wire re-entry analysis (why in-session restore is deferred: `updatedToolOutput` is model-facing and the transcript ratchet is permanent), key-custody honesty (what file-based custody does and does not defend against), and accepted residual risks; PROJECT.md's stale "restore MCP tool stub" wording amended

## Future Requirements (deferred)

- [ ] In-session restore on the return path — becomes a v3.x fast-follow if/when Claude Code ships a display-only rewrite channel (upstream request filed under REVMODE-10)
- [ ] PreToolUse input-side restore for local tools — only if REVMODE-10's `updatedInput` echo verification proves it safe
- [ ] Delimiter/case-tolerant token matching with near-miss audit — only on field evidence of model-mangled tokens (never Levenshtein fuzzy matching)
- [ ] Keychain-backed key custody (POLISH-03) — `getMachineKey()` is the single swap point
- [ ] Layer 5 `--deep` LLM classifier (planned v4.0)

## Out of Scope

| Item | Reason |
|------|--------|
| In-session restore via `updatedToolOutput` (or any hook-path restore) | No display-only channel exists; restored values enter model context and re-ship to the API permanently (transcript ratchet) — T1 decision 2026-07-14 |
| Model-facing `restore` MCP tool | Prompt-injected model calling restore = self-service deanonymization oracle; v1 ban reaffirmed |
| Restoring secret-class values ("complete the round-trip") | Defeats the tool's core guarantee; floor is structural, not configurable |
| Fuzzy/Levenshtein placeholder matching | Distance-1 edits are different identities (`:001` vs `:002`); wrong-value restore is silent corruption in a security tool |
| Cross-session or persistent placeholder map | Session-scoped only, per original Key Decision — limits blast radius |
| Plaintext map file (even interim) | PROJECT.md security constraint is explicit: encrypted at rest or nothing |
| Blocking tool calls on restore failure | Restore is cosmetic; blocking pushes users to uninstall — fail one-way only |
| MCP-server-resident map (IPC state) | Server restart mid-session loses map and resets counter → wrong-value restore; hook-only installs get nothing — T2 decision 2026-07-14 |

## Traceability

Populated by roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|

---
*Defined: 2026-07-14 — v3.0 milestone requirements (12 REQ-IDs) after research synthesis + T1 reshape*
