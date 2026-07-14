# Architecture Research — v3.0 Reversible Redact Mode

**Domain:** In-session AI-payload redaction for Claude Code — reversible restore path atop shipped v2.0 architecture
**Researched:** 2026-07-14
**Confidence:** HIGH on hook contract + existing-code integration points (verified against code.claude.com/docs/en/hooks and the shipped source); MEDIUM on MCP-server lifecycle assumptions; LOW on session_id continuity across `--resume` (flagged as open question)

> Prior-milestone research preserved at `ARCHITECTURE.v1.md` (v1.0 MVP) and `ARCHITECTURE-v2-pii.md` (v2.0 PII/NER). This document covers ONLY what v3.0 adds.

---

## TL;DR

1. **The core tension is real and cannot be dissolved in-process.** Hook processes are spawned fresh per event (`src/hook/index.ts` → `process.exit()` every time); the module-level `Map<sessionId, PlaceholderManager>` in `src/detect/index.ts` dies with each process. Any restore in a later PostToolUse process requires the placeholder→original map to live *outside* hook process memory. Three ownership options exist (encrypted per-session file, MCP-server-resident map + IPC, hybrid); the decision matrix below leans strongly toward the **encrypted per-session file under `~/.mrclean/sessions/<session_id>/`**, but this is the requirements-step decision (REVMODE-02) — do not treat it as settled here.

2. **The single biggest blast-radius lever is not encryption — it is what goes in the map.** Today `PlaceholderManager` stores only `sha256(value)`; originals are discarded the moment substitution completes. Reversible mode is the FIRST time any original value is retained anywhere. Recommendation: persist originals **only for restorable-policy types** (WORD/paths/identifiers/PII names); secret-type entries persist `{placeholder, type, hash, counter}` with **no original** — they are needed only for cross-process stability, not restore. A fully exfiltrated map file then leaks one session's paths/names, never keys.

3. **Locking is correctness-critical, not hygiene.** Verified: Claude Code runs matching hooks **in parallel**, and parallel tool calls fire concurrent PostToolUse processes. Today each process has its own counter starting at 0 — cross-process placeholder collisions (`<MRCLEAN:AWS_KEY:001>` meaning two different values) are *already latent in v1/v2*, merely cosmetic in one-way mode. In reversible mode a counter collision makes restore substitute the **wrong original**. The persisted map + lock fixes the latent PH-02/PH-03 cross-process hole as a side effect.

4. **Restore is a different algorithm than redact — do not reuse `substituteFindings`.** Forward redaction is span-based, right-to-left. Restore is a single-pass token-regex scan (`/<MRCLEAN:([A-Z0-9_]+):(\d{3}|OVF)>/g`) with a lookup map. "Longest-first ordering" is **not needed**: placeholder tokens are delimited, non-overlapping regex matches, and a single-pass `replace()` never rescans inserted text (no recursive expansion). `OVF` tokens must be **skipped** (last-writer-wins ambiguity in the manager makes them unrestorable).

5. **Restored content re-enters the conversation context and therefore the wire.** `updatedToolOutput` replaces the tool result Claude sees — the restored originals ride the next API call. This is the fundamental reversible-mode hazard: restore MUST be type-policy-scoped (never secrets), opt-in, and the centerpiece of the THREAT_MODEL.md update (REVMODE-03).

6. **PROJECT.md's "wire the `restore` MCP tool (stub since Phase 1)" target is stale against shipped code.** The stub was deleted in Plan 03-01; `restore` sits on `FORBIDDEN_TOOL_NAMES` (`tests/mcp/tools-list.test.ts:44-60`, CI-enforced), and the v1 decision record says restoration "runs server-side, not as a model-facing tool" (`03-03-PLAN.md:460`, prompt-injection Pitfall #10). Separately, the MCP server never learns the Claude Code `session_id` (`src/mcp/server.ts:87` boots as `'mcp-server'`; `mrclean_redact` defaults to `randomUUID()` per call), so an MCP restore tool cannot even locate the right session map. Requirements must resolve this conflict — see Open Question 6. Recommended default: keep the ban; deliver restore hook-side plus an operator-only `mrclean restore` CLI.

---

## The Core Tension: Ephemeral Hooks vs Session-Persistent Map

```
   Claude Code session (one session_id, minutes-to-hours)
   ─────────────────────────────────────────────────────────────────►
     │            │             │             │              │
     ▼            ▼             ▼             ▼              ▼
  ┌──────┐   ┌──────┐      ┌──────┐      ┌──────┐       ┌──────┐
  │hook  │   │hook  │      │hook  │      │hook  │       │hook  │
  │proc 1│   │proc 2│      │proc 3│      │proc 4│  ...  │proc N│
  │(UPS) │   │(Pre) │      │(Post)│      │(Post)│       │(End) │
  └──┬───┘   └──┬───┘      └──┬───┘      └──┬───┘       └──┬───┘
     │ alloc    │ alloc       │ alloc+     │ alloc+        │ cleanup
     │ :001     │ :002        │ RESTORE    │ RESTORE       │
     ▼          ▼             ▼            ▼               ▼
  ╳ dies     ╳ dies    needs :001,:002  procs 3+4 can   must find
  with map   with map  from procs 1+2   run in PARALLEL  the artifact
```

Facts that constrain every option (all verified in source / official docs):

| Fact | Source | Confidence |
|------|--------|------------|
| Hook process exits after every event; no shared memory across events | `src/hook/index.ts` (`runHook` always `process.exit()`s) | HIGH |
| `cachedManagers` Map + `cachedSessionState` are module-level, per-process only | `src/detect/index.ts:157`, `src/detect/session-state.ts:62` | HIGH |
| Matching hooks run **in parallel**; parallel tool calls → concurrent PostToolUse processes | code.claude.com/docs/en/hooks ("All matching hooks run in parallel") | HIGH |
| `SessionEnd` hook event exists; receives `session_id`, `cwd`, `reason` (`clear`/`logout`/`prompt_input_exit`/`other`...); cannot block — "used for side effects like logging or cleanup" | code.claude.com/docs/en/hooks | HIGH |
| `SessionStart` carries `source`: `startup` / `resume` / `clear` / `compact` | code.claude.com/docs/en/hooks | HIGH |
| PostToolUse `updatedToolOutput` rewrites the tool result (CC ≥ 2.1.121; already the shipped redact path) | `src/shared/types.ts:124`, `src/hook/handlers/post-tool-use.ts` | HIGH |
| PostToolUse is non-blocking — restore failures can only degrade to pass-through, never halt the session | doc + shipped handler comment | HIGH |
| `PlaceholderManager` discards originals — only `hash` + `placeholder` retained | `src/placeholder/manager.ts` (byHash/byPlaceholder store hash, never value) | HIGH |
| Counter is per-process today → cross-process collisions already possible | `src/detect/index.ts` `getOrCreateManager` (fresh manager per process) | HIGH |
| `restore` is a CI-banned MCP tool name; only check/redact/status may exist | `tests/mcp/tools-list.test.ts:44-60, 87-99` (T2 exact-list + T2b forbidden-list) | HIGH |
| MCP server never receives Claude Code's `session_id` | `src/mcp/server.ts:87` (`sessionId: 'mcp-server'`), `src/mcp/tools/redact.ts:116` (`providedSessionId ?? randomUUID()`) | HIGH |

---

## Map Ownership — The REVMODE-02 Decision

Three candidate owners. **This matrix is input to the requirements step, not a fait accompli.** The PROJECT.md constraint — "in-memory only by default; if persisted to disk, must be encrypted at rest and removed on session exit" — is literally unsatisfiable for cross-hook-process state without a resident process, so the requirements step must either (a) read "in-memory by default" as describing one-way mode (the default mode has no map at all; opting into reversible = consenting to encrypted session-scoped disk state), or (b) mandate Option B and accept its availability/recovery costs.

### Option A — Encrypted per-session file (`~/.mrclean/sessions/<session_id>/`)

Artifacts: `map.enc` (AES-256-GCM whole-file: `magic|iv|authTag|ciphertext`), `map.key` (32 random bytes, mode 0600, sibling file), `map.lock` (O_EXCL lockfile). Directory mode 0700. **Never inside the project `.mrclean/`** — project dirs get committed, synced, and backed up.

| Axis | Assessment |
|------|------------|
| **Crash recovery** | Best-in-class. Hook crashes are irrelevant (state on disk between events). Claude Code crash → map survives; `SessionStart source=resume` can rehydrate (subject to the session_id-continuity open question). Counter is persisted → a mid-session restart can never re-issue an NNN already living in the transcript. |
| **SessionEnd cleanup** | Good but not perfect. SessionEnd handler deletes the session dir. SessionEnd does NOT fire on SIGKILL/power loss → residual encrypted artifact until the janitor sweep (next SessionStart) or TTL. Belt-and-braces janitor required (see Pattern 3). |
| **Concurrent hooks** | Requires lock + atomic rewrite — exactly what REVMODE-02 already scopes. ~200 LOC of well-understood mechanism. Contention cost bounded (see perf table). Fixes the latent v1 cross-process counter collision as a side effect. |
| **Perf (<200ms PostToolUse)** | Comfortable. AES-256-GCM in Node (OpenSSL + AES-NI) runs GB/s; a 50 KB map costs <1 ms each way. Itemized budget below: ~4–8 ms typical added, ~60 ms worst-case contended — detection remains the dominant cost. |
| **Blast radius if leaked** | Ciphertext + key are sibling files, so encryption defends against *partial* exfil (backup/sync tools grabbing one file, cross-user reads, casual disk scans) — not a same-user live attacker (nothing on disk can). Mitigated decisively by the restorable-types-only rule: secrets' originals never touch disk. Session-scoped: one leaked map = one session's paths/names. |
| **Availability** | Always works — including hook-only installs with no MCP server registered. |

### Option B — MCP-server-resident map + hook→server IPC

The long-lived stdio MCP server (already home to the warm NER singleton) owns a `Map<sessionId, SessionMap>` in memory. Hooks cannot speak MCP (that transport is owned by Claude Code), so the server must open a **second channel** — Unix domain socket / localhost HTTP — plus a discovery file and an auth token (any local process could otherwise connect).

| Axis | Assessment |
|------|------------|
| **Crash recovery** | Worst-in-class, and dangerously so: an MCP server restart mid-session (crash, `/mcp` reconnect, config reload) silently loses the map. Restore goes dark for placeholders already in the transcript, AND the counter resets to 0 → **new allocations collide with placeholder NNNs already in the conversation with different meanings**. That is a correctness failure, not a degradation. |
| **SessionEnd cleanup** | Perfect — memory vanishes with the process; OS guarantees it. (Eviction for multi-session servers still needs SessionEnd → IPC.) |
| **Concurrent hooks** | Free — single process, event-loop serialization, atomic counter. |
| **Perf** | ~1 ms socket round-trip. Fine — but adds a connect-timeout failure mode to every hook event. |
| **Blast radius** | Best — nothing at rest; matches the constraint's letter. Process memory is dumpable by a same-user attacker, but so is everything else. |
| **Availability** | Poor. The MCP server is optional (hook-only installs exist) and its liveness at hook time is not guaranteed. Additional identity problem: the server has no Claude Code `session_id` of its own (`src/mcp/server.ts:87`), so hooks would have to push session identity in-band over the new channel. New surface: socket auth, discovery, lifecycle supervision, fail-open-vs-closed policy when the socket is down. v1 research already rejected a sidecar daemon for exactly this class of cost. |

### Option C — Hybrid (server-resident memory + encrypted write-through file)

Fast path through the server when alive, file as source of truth for recovery. Gets A's recovery and B's serialization — and both implementations' complexity plus a cache-coherence problem between them. Nothing in the v3.0 feature set needs the extra ~1–3 ms the fast path saves. Classic YAGNI; only revisit if profiling shows lock contention actually hurting.

### Leaning (to be ratified or overturned by requirements)

**Option A.** The decisive arguments: (1) mid-session map loss under B is a *correctness* hazard (counter reuse against a transcript that already contains those NNNs), (2) B makes reversible mode unavailable for hook-only installs, (3) A's at-rest risk collapses once secrets' originals are excluded from the file. What would flip it: a requirements ruling that *nothing* plaintext-recoverable may ever rest on disk even session-scoped — then B is the only option and reversible mode must be documented as requiring the MCP server and as non-recoverable across server restarts.

---

## Critical Design Insights (what the phases must get right)

### Insight 1 — The map is the first place originals ever persist; scope it by restore policy

`PlaceholderManager.allocate()` keeps `sha256(value)` and throws the value away. The map file schema must make original-retention **opt-in per entry**:

```typescript
interface SessionMapEntry {
  placeholder: string      // '<MRCLEAN:WORD:007>'
  type: string             // locked vocabulary (src/detect/type-map.ts)
  index: number            // global counter value
  hash: string             // sha256 hex — always present (stability key)
  original?: string        // ONLY for types on the restorable allowlist
  firstSeenTs: string
}

interface SessionMap {
  version: 1
  sessionId: string
  counter: number          // authoritative cross-process counter
  entries: SessionMapEntry[]
}
```

Secret types (AWS_KEY, JWT, …) get entries **without** `original` — they participate in counter/stability, are structurally unrestorable, and never touch disk in recoverable form. This single rule does more for blast radius than any encryption choice. Against the locked vocabulary (`src/detect/type-map.ts:37-66`): all 14 secret TYPEs + ENV + ENTROPY + SECRET are never-restorable (hardcoded denylist, not config-overridable); WORD is the primary restorable class; PII_EMAIL/PHONE/PERSON/ORG/LOC/IP are policy-configurable (narrowing only); PII_SSN and PII_CREDIT_CARD are treated as secret-class (their default action is already `block`, `src/config/defaults.ts:44-50`).

### Insight 2 — Two-phase allocation transaction; never hold the lock across detection

Detection (L1 worker pool + layers) can take most of the 100–200 ms budget. Holding the file lock across it would serialize parallel PostToolUse hooks and blow the budget under contention. Correct shape:

```
Phase 1 (lock-free):   read map snapshot → hydrate manager → runDetection layers
Phase 2 (locked, ~2ms): acquire lock → re-read map → allocate for deduped findings
                        (re-check byHash: another process may have allocated the same
                        value meanwhile — take ITS placeholder, don't burn a counter)
                        → serialize → encrypt → tmp-write + fsync + rename → unlock
Phase 3 (lock-free):   substituteFindings with the reconciled placeholders
```

This maps cleanly onto the existing orchestrator: allocation already happens *after* the layers (step 8 in `runDetection`); the transaction wraps only the allocate-and-persist step.

### Insight 3 — PostToolUse ordering: redact first, then restore

An inbound tool result may contain BOTH fresh secrets (must redact) and known placeholders (may restore). Order matters:

- **Redact first** on the raw text — detection layers cannot match placeholder tokens (angle-bracket format, PH-04), so existing placeholders pass through the redact pass untouched.
- **Restore second**, policy-filtered — restored values are by definition previously-detected values of restorable types; re-inserting them is policy-consistent, and single-pass replacement never re-triggers detection in this process.
- The reverse order (restore→redact) creates a tug-of-war: restored WORD values whose action is `substitute` would be immediately re-redacted (stable placeholders make it a churn-only no-op, but it wastes budget and re-audits).

### Insight 4 — Restore is token-scan, not span-substitution

New pure function, ~80 LOC, no I/O:

```typescript
const PLACEHOLDER_RE = /<MRCLEAN:([A-Z0-9_]+):(\d{3}|OVF)>/g

function restoreText(
  text: string,
  map: ReadonlyMap<string, SessionMapEntry>,  // placeholder → entry
  policy: RestorePolicy,                       // type allowlist
): { restored: string; hits: number; skipped: number }
```

Properties that fall out of the single-pass `replace()` design:
- **No ordering problem.** Regex matches are disjoint delimited tokens; longest-first sorting (needed nowhere) and right-to-left processing (a forward-redaction concern) do not apply.
- **No recursive expansion.** `replace()` never rescans inserted text, so an original that happens to contain placeholder-shaped text cannot trigger a second substitution.
- **`OVF` skipped.** `byPlaceholder` is last-writer-wins for OVF (manager.ts:108) — ambiguous, therefore unrestorable. Count it in `skipped`.
- **Unknown placeholders left intact** (other session, pre-reversible history) — never guess.

### Insight 5 — Restored output re-enters the wire; the threat model owns this

`updatedToolOutput` is what Claude sees and what persists in the transcript/context — the next API call carries restored originals to Anthropic. This is *the point* of reversible mode for paths/names (usability) and *the catastrophe* for secrets. Consequences for architecture: restore policy is a **type allowlist in config** (default: WORD + PII name/loc types + any future PATH type; never secret types), reversible mode is opt-in config (`[reversible] enabled = false` default), and THREAT_MODEL.md (REVMODE-03) documents: map artifact contents, key/ciphertext split, residual-file window, and the wire-reentry property. Same hazard applies if requirements later add PreToolUse input-restore (see Open Questions).

---

## Component Map: New vs Modified

### New components

| Component | Path | Responsibility |
|-----------|------|----------------|
| Session State Adapter (facade) | `src/state/index.ts` | `withSessionMap(sessionId, fn)` locked read-modify-write transaction; `readSessionMap(sessionId)` lock-free read for restore; single import surface for handlers + MCP |
| Map schema + (de)serialization | `src/state/session-map.ts` | Types above; version field; migration guard |
| Encrypted store | `src/state/map-store.ts` | AES-256-GCM encrypt/decrypt (`node:crypto`, random 96-bit IV per write); per-session random key file (0600); tmp-in-same-dir + fsync + rename atomic write (extend the `install/atomic-json.ts` pattern — that helper writes plaintext JSON without fsync, so extend, don't reuse as-is); path layout under `~/.mrclean/sessions/<id>/` |
| Lock | `src/state/lock.ts` | O_EXCL lockfile (`fs.open(path,'wx')`), retry w/ ~5 ms backoff, hard deadline (~50 ms), stale-break by mtime age (hook processes are short-lived; >10 s = dead holder). If edge cases bite in practice, `proper-lockfile` is the battle-tested fallback dep — a STACK-level call |
| Janitor | `src/state/janitor.ts` | Delete session dir on SessionEnd; sweep stale dirs (TTL) on SessionStart |
| Restore engine | `src/restore/restore-text.ts` | Pure token-scan restore (Insight 4) + `RestorePolicy` type filter |
| SessionEnd handler | `src/hook/handlers/session-end.ts` | Invoke janitor delete; always exit 0 (SessionEnd cannot block; cleanup failure = stderr warn) |
| Operator restore CLI | `src/cli.ts` subcommand (or `src/restore/cli.ts`) | `mrclean restore <text|file>` — human-invoked, local-only reverse lookup via `src/state/`. Delivers the "recover my originals" value with **no model in the loop**; recommended replacement for the MCP tool below |
| `mrclean_restore` MCP tool — **CONTINGENT, decide in requirements (Open Question 6)** | `src/mcp/tools/restore.ts` | Reads map via `src/state/` (same library — **no IPC needed under Option A**); applies same policy filter; gated on `[reversible] enabled`. **Counter-record before building this:** no stub exists today (PROJECT.md's "stub since Phase 1" is stale — Plan 03-01 deleted it with "NO aliases retained", `src/mcp/server.ts:12-16`); `restore` is CI-banned on `FORBIDDEN_TOOL_NAMES` (`tests/mcp/tools-list.test.ts:44-60`); v1 explicitly decided restoration "runs server-side, not as a model-facing tool" (`03-03-PLAN.md:460`, prompt-injection Pitfall #10 — a prompt-injected model calling restore pulls originals into its own context); and the MCP server has no Claude Code `session_id` to select the map with (`src/mcp/server.ts:87`, `redact.ts:116`). Building it means a conscious amendment of the MCP-03 invariant + tests AND a session-identity handshake design. Cut-first candidate |

### Modified components

| Component | Path | Change |
|-----------|------|--------|
| PlaceholderManager | `src/placeholder/manager.ts` | Hydrate-from/serialize-to `SessionMap` (counter + entries); opt-in `retainOriginals(policy)` so originals are captured only for restorable types; keep default construction byte-identical for one-way mode |
| Detection orchestrator | `src/detect/index.ts` | Injection seam: `DetectionOptions.placeholderManager?` (or a manager-provider) so handlers can pass a map-hydrated manager; `getOrCreateManager` remains the one-way default. Allocation step gains the phase-2 reconcile hook (Insight 2) |
| PostToolUse handler | `src/hook/handlers/post-tool-use.ts` | Reversible branch: hydrated manager into `runDetection`; persist allocations (locked txn); then `restoreText()` pass; emit combined `updatedToolOutput`; restore failures degrade to redact-only pass-through + stderr warn (PostToolUse can't block anyway) |
| PreToolUse handler | `src/hook/handlers/pre-tool-use.ts` | Persist allocations in reversible mode (write path — its `updatedInput` substitutions are exactly what later needs restoring). Note `substituteToolInputDeep` calls `runDetection` per string leaf — batch the persist into ONE locked transaction per hook event, not per leaf |
| UserPromptSubmit handler | `src/hook/handlers/user-prompt-submit.ts` | Optional: persist allocations for counter monotonicity (no substitution occurs on this path — UPS can only block — so this is uniformity, not necessity) |
| SessionStart handler | `src/hook/handlers/session-start.ts` | Janitor sweep; on `source=resume` attempt map rehydration (subject to open question); on `source=clear` treat as fresh |
| Hook types + dispatcher | `src/shared/types.ts`, `src/hook/dispatcher.ts` | Add `SessionEndInput` (`reason` field) to the `HookInput` union; route in `dispatch()`. Ship types+dispatcher with (or before) installer registration — `dispatch()` throws on unknown events (`dispatcher.ts:45-49`) → crash guard → exit 2 noise on every session end if sequenced wrong |
| Installer | `src/install/settings.ts` | Register SessionEnd hook entry; **extend the SessionStart matcher** — currently `'startup'` only, so resume/clear/compact never fire the janitor/rehydration today. Migration path for existing installs |
| Doctor | `src/doctor/checks.ts`, `version-check.ts` | Checks: SessionEnd hook registered; CC ≥ 2.1.121 floor (exists — keep); stale session dirs report; key/dir permission check (0600/0700) |
| Config | `src/config/defaults.ts`, `src/shared/types.ts` | `[reversible]` table: `enabled=false`, `restore_types` allowlist, `ttl_hours`, `max_map_bytes` |
| Audit | `src/audit/log.ts` | `action` union gains `'restore'` (schema is LOCKED — extend deliberately, update canary-leak test); restore events log placeholder + hash only, never the restored value |
| MCP server registration | `src/mcp/server.ts` | ONLY if Open Question 6 resolves toward the tool: conditionally register `mrclean_restore`; update the "exactly three tools" invariant comment/tests. Otherwise unchanged |
| THREAT_MODEL.md | repo root | REVMODE-03: map artifact, key split, residual window, wire-reentry, opt-in flow |

---

## Recommended Project Structure (delta only)

```
src/
├── state/                    # Session State Adapter (REVMODE-02) — NEW
│   ├── index.ts              # facade: withSessionMap / readSessionMap
│   ├── session-map.ts        # SessionMap types + (de)serialize + version guard
│   ├── map-store.ts          # AES-256-GCM store, key mgmt, atomic write, paths
│   ├── lock.ts               # O_EXCL lockfile, backoff, deadline, stale-break
│   └── janitor.ts            # SessionEnd delete + SessionStart TTL sweep
├── restore/                  # NEW — kept out of placeholder/ deliberately:
│   └── restore-text.ts       #   different algorithm, different trust direction
├── hook/handlers/
│   └── session-end.ts        # NEW
└── mcp/tools/
    └── restore.ts            # CONTINGENT — only if OQ6 amends the MCP-03 ban
```

**Rationale:** `src/state/` matches the milestone's named deliverable and isolates every byte of disk-I/O policy behind one facade — handlers and MCP tools never touch `node:crypto` or lockfiles directly, which keeps the leak-grep and canary-leak CI gates pointed at one module. `src/restore/` is separate from `src/placeholder/` because reverse substitution shares no code with forward substitution (Insight 4) and has the opposite trust direction (it *introduces* sensitive data rather than removing it) — a reviewer auditing "what can put originals back" should find exactly one directory. Note `src/detect/session-state.ts` (env blocklist + words cache) keeps its name; the new adapter is a different concern under `src/state/` — flag the near-collision in docs to avoid confusion.

---

## Data Flow

### Redact-write path (reversible mode; PreToolUse shown, PostToolUse redact identical in shape)

```
Claude Code ──spawn──► hook proc (PreToolUse)
                          │ stdin JSON {session_id, tool_input, cwd}
                          ▼
              ┌─ Phase 1 (lock-free) ────────────────────────────┐
              │ readSessionMap(sid) ──► hydrate PlaceholderManager│
              │ runDetection layers L1→L2→L3→L4[→L6a]            │
              └──────────────────────────────────────────────────┘
                          │ deduped findings
                          ▼
              ┌─ Phase 2 (locked, ~2ms) ─────────────────────────┐
              │ lock.acquire(~50ms deadline)                      │
              │ re-read map ► reconcile (foreign allocations win) │
              │ allocate new ► entry.original ONLY if policy type │
              │ encrypt(AES-256-GCM) ► tmp+fsync+rename ► unlock  │
              └──────────────────────────────────────────────────┘
                          │ resolved placeholders
                          ▼
              substituteFindings (existing, span-based, unchanged)
                          │
                          ▼
              stdout: permissionDecision:allow + updatedInput
                          │
Claude Code ◄─────────────┘        ~/.mrclean/sessions/<sid>/
                                     ├── map.enc   (ciphertext)
                                     ├── map.key   (0600)
                                     └── map.lock  (transient)
```

### Restore-read path (PostToolUse, CC ≥ 2.1.121)

```
tool executes locally ──► Claude Code ──spawn──► hook proc (PostToolUse)
                                                    │ {session_id, tool_response}
                                                    ▼
                                        1. REDACT pass (existing runDetection
                                           + Phase-2 persist as above)
                                           — placeholder tokens in the input
                                             are inert to detection layers
                                                    ▼
                                        2. readSessionMap(sid)   (lock-free;
                                           decrypt ~<1ms; missing/corrupt file
                                           → skip restore, stderr warn)
                                                    ▼
                                        3. restoreText(redacted, map, policy)
                                           — single regex pass
                                           — policy: restorable types only
                                           — OVF + unknown tokens skipped
                                                    ▼
                                        4. stdout: hookSpecificOutput.
                                           updatedToolOutput = restored text
                                                    │
Claude Code ◄───────────────────────────────────────┘
   │  transcript/context now holds restored originals
   ▼  (⚠ next API call carries them — THREAT_MODEL REVMODE-03)
conversation continues; user's view shows real paths/names
```

**Parallel-safety note:** two concurrent PostToolUse processes both execute Phase 2 under the lock — the second re-reads the first's allocations, so counters never collide and `same value → same placeholder` finally holds across processes (fixes latent v1 PH-02/PH-03 gap).

### Lifecycle / janitor flow

```
SessionStart(source=startup) ─► janitor.sweep(TTL) ─► fresh map on first alloc
SessionStart(source=resume)  ─► attempt rehydrate <sid> (open question below)
SessionStart(source=clear)   ─► fresh session id ─► sweep catches the old dir
SessionEnd(reason=*)         ─► janitor.delete(<sid>) — best effort
SIGKILL / power loss         ─► nothing fires ─► encrypted residue until next
                                sweep or TTL — documented residual window
```

---

## Performance Budget (<200 ms PostToolUse, itemized)

| Step | Typical | Worst case | Notes |
|------|--------:|-----------:|-------|
| Read + decrypt map (50 KB) | <1 ms | 2 ms | AES-256-GCM via OpenSSL/AES-NI runs GB/s; dominated by file open |
| Lock acquire (uncontended) | ~0.1 ms | — | single `open(wx)` syscall |
| Lock acquire (contended) | ~5–10 ms | 50 ms (deadline) | 5 ms backoff; deadline → degrade path, never block session |
| Allocate + reconcile + serialize | <1 ms | 2 ms | in-memory map ops |
| Encrypt + tmp-write + fsync + rename | 1–2 ms | 5 ms | fsync dominates |
| `restoreText` scan (100 KB tool output) | <1 ms | 3 ms | one regex pass + Map lookups |
| **Total added by reversible mode** | **~4–8 ms** | **~60 ms** | detection layers remain the dominant cost; fits the existing envelope |

Degrade policies when budget/deadline is hit (PostToolUse cannot block, so all are non-fatal):
- **Lock deadline on write path** → proceed with process-local allocations (v1 behavior), stderr warn `mrclean map lock timeout`. Restore may later miss these placeholders — cosmetic, not a leak.
- **Missing/corrupt/undecryptable map on read path** → skip restore entirely, redact-only output, stderr warn. Fail-safe direction: a broken map can never cause a leak, only unrestored placeholders.

---

## Architectural Patterns

### Pattern 1: Locked read-modify-write transaction behind a facade

**What:** All map mutation flows through `withSessionMap(sessionId, fn)` — acquire lock, decrypt-read, run `fn(map) → newMap` (immutable update), encrypt, atomic-rename, release. Reads for restore use lock-free `readSessionMap` (atomic rename guarantees readers never see a torn file).
**When:** Every allocation-persisting hook event and the MCP redact tool.
**Trade-offs:** Serializes writers (~2 ms hold) — irrelevant at human tool-call rates; buys single-writer counter integrity, which reversible mode cannot function without.

### Pattern 2: Restore-policy allowlist as a first-class type

**What:** `RestorePolicy` = set of TYPE strings permitted to (a) retain `original` in the map and (b) be substituted back by `restoreText`. Enforced at BOTH write time (map-store refuses to serialize `original` for non-policy types) and read time (restore skips non-policy tokens) — two independent gates, same rule.
**When:** Always; not configurable to include secret types without editing source (make the footgun require a fork, not a config line).
**Trade-offs:** Slightly duplicated enforcement; that redundancy is the point for a security tool.

### Pattern 3: Belt-and-braces janitor

**What:** Three overlapping cleanup mechanisms: SessionEnd delete (primary), SessionStart TTL sweep (catches missed ends), and doctor reporting stale dirs (visibility). None is individually reliable; together the residual window is "until the next session or TTL, encrypted".
**Trade-offs:** Sweep adds ~1 ms of `readdir` to SessionStart. Requires the installer to widen the SessionStart matcher beyond `'startup'`.

---

## Anti-Patterns

### Anti-Pattern 1: Holding the lock across detection
**What people do:** Wrap the whole hook body in the file lock for simplicity.
**Why wrong:** Detection can consume most of the 100–200 ms budget; parallel PostToolUse hooks would serialize and stack deadlines.
**Instead:** Two-phase transaction (Insight 2) — detect lock-free, allocate+persist under a ~2 ms lock.

### Anti-Pattern 2: "It's encrypted, so store everything"
**What people do:** Persist originals for all types because the file is AES-256-GCM anyway.
**Why wrong:** The key is a sibling file on the same disk; encryption here defends against partial exfil and accident, not a same-user attacker. Secrets in the map turn a paths-and-names leak into a credentials leak.
**Instead:** Restorable-types-only originals (Insight 1); secret entries are hash+counter, exactly as safe as today's audit log.

### Anti-Pattern 3: Blanket reversal
**What people do:** Restore every `<MRCLEAN:*>` token found.
**Why wrong:** `updatedToolOutput` re-enters conversation context → next API call ships restored values to the wire. Restoring a secret placeholder is a direct violation of the core value.
**Instead:** Policy allowlist enforced at write AND read (Pattern 2); OVF and unknown tokens always skipped.

### Anti-Pattern 4: Daemon/IPC for state a locked file can hold
**What people do:** Reach for the MCP server (or a new sidecar) as the map owner because "memory is cleaner."
**Why wrong:** Server restart mid-session loses the map AND resets the counter into NNN-collision territory against the live transcript; hook-only installs get nothing; new socket-auth surface; the server doesn't even know the session_id. v1 research rejected the daemon for the same reasons.
**Instead:** Option A file, unless requirements explicitly forbid any at-rest artifact — then accept and document B's costs.

### Anti-Pattern 5: Reusing `substituteFindings` for restore
**What people do:** Model restore as findings-with-spans and feed the existing right-to-left substituter.
**Why wrong:** There are no detection spans on the restore path — placeholders are self-delimiting tokens; forcing span bookkeeping adds drift bugs for zero benefit.
**Instead:** Single-pass token regex in a new `src/restore/` module (Insight 4).

### Anti-Pattern 6: Keying encryption off session_id or storing the map in the project
**What people do:** Derive the AES key from `session_id` ("no key file needed!") or write `map.enc` into project `.mrclean/` next to the audit log.
**Why wrong:** `session_id` appears in transcripts and hook payloads — it is not a secret. Project dirs get committed, synced, and backed up.
**Instead:** 32 random bytes per session in a 0600 sibling file; map lives under `~/.mrclean/sessions/`.

### Anti-Pattern 7: A model-facing restore tool
**What people do:** Re-add `restore`/`unredact` to the MCP tool surface "since the map exists anyway".
**Why wrong:** A prompt-injected model can call it and pull originals into its own context — the exact attack MCP-03 was written to prevent (Pitfall #10, enforced by `FORBIDDEN_TOOL_NAMES` in CI). Policy scoping softens but does not eliminate this: it still converts every restorable-class value into something the model can request on demand, and the MCP server cannot even scope the request to the right session (no session_id).
**Instead:** Restore lives in the PostToolUse hook (deterministic, operator-configured policy, no model discretion) plus an operator-only `mrclean restore` CLI for manual recovery.

---

## Integration Points

### External (Claude Code contract)

| Surface | Integration | Notes |
|---------|-------------|-------|
| PostToolUse `updatedToolOutput` | Restore output rides the same field the redact pass already uses | CC ≥ 2.1.121 floor already enforced by doctor; one combined redact+restore string per event |
| SessionEnd hook | New handler + installer registration | Cannot block; `reason` field available; NOT guaranteed on hard kill → janitor |
| SessionStart `source` | Janitor sweep + resume rehydration branch | Installer matcher currently `'startup'` only — must widen (`startup|resume|clear|compact`) + migrate existing installs |
| Parallel hook execution | Lock + reconcile makes concurrent PostToolUse safe | Verified: "All matching hooks run in parallel" |

### Internal boundaries

| Boundary | Communication | Considerations |
|----------|---------------|----------------|
| handlers ↔ `src/state/` | Direct import of facade only | No `node:crypto`/lock imports outside `src/state/` — enforce with an import-graph test (precedent: NER cold-path test T-06-02-01). Lazy `await import()` behind `config.reversible.enabled` keeps the cold path byte-identical when off |
| `src/state/` ↔ `src/placeholder/manager.ts` | `SessionMap` ⇄ manager hydrate/serialize | Manager stays I/O-free; adapter owns all disk concerns |
| `src/detect/index.ts` ↔ handlers | New `opts.placeholderManager` injection seam | One-way mode path byte-identical when opt not passed |
| `src/restore/` ↔ `src/state/` | `readSessionMap` (lock-free) | Restore engine itself is pure — trivially unit-testable |
| MCP server ↔ `src/state/` | Same library, direct file access — **no IPC under Option A** | Two caveats: (1) the MCP process must re-read per call (its module cache goes stale vs hook writes) — mtime check or always-read (~1 ms); (2) **the MCP server has no Claude Code session_id** (`src/mcp/server.ts:87` boots as `'mcp-server'`; `mrclean_redact` defaults `providedSessionId ?? randomUUID()`, `redact.ts:116`) — it cannot select the correct map file without a caller-supplied sessionId or a new identity handshake. MCP-lane allocations are therefore non-restorable in v3.0 unless OQ6 designs that handshake |
| Audit ↔ restore | New `action:'restore'` records, placeholder+hash only | LOCKED schema amendment; extend canary-leak + leak-grep gates to the map key/plaintext |

---

## Suggested Build Order

Dependencies drive the order; steps 4/5 are the first user-visible behavior change.

1. **Contract plumbing (no behavior change):** `SessionEndInput` type + dispatcher route + no-op handler; `[reversible]` config table (default off); installer SessionEnd registration + SessionStart matcher widening + migration; doctor checks. Resolve the requirements conflicts up front: OQ6 (MCP restore tool vs MCP-03 ban), OQ1 (resume continuity), restorable-type policy. *Unblocks everything; independently shippable.*
2. **`src/state/` core (pure + I/O, no integration):** session-map schema, encrypted map-store (key mgmt, atomic write, 0600/0700), lock. Heaviest unit-test surface (corrupt file, wrong key, torn write, stale lock, contention) — build and gate it before anything consumes it.
3. **PlaceholderManager persistence seam:** hydrate/serialize + policy-scoped `retainOriginals`; `runDetection` injection seam. One-way path proven byte-identical by existing tests.
4. **Redact-write integration (REVMODE-02 lands):** PreToolUse/PostToolUse (+ optionally UserPromptSubmit) persist allocations via the two-phase transaction. *Cross-process placeholder stability fix lands here — valuable even before restore exists.* (MCP redact-tool persistence is blocked on the OQ6 identity gap — exclude unless resolved.)
5. **Restore engine (parallel with 4):** `restoreText` + `RestorePolicy` — pure function, table-driven tests (OVF skip, unknown skip, adjacency, placeholder-shaped originals, policy filter).
6. **PostToolUse restore wiring (REVMODE-01):** redact→persist→restore ordering; degrade paths (lock timeout, missing/corrupt map); perf gate extension covering decrypt+substitute+re-encrypt in CI.
7. **Janitor:** SessionEnd delete + SessionStart sweep + doctor stale-dir report. (Depends only on 2; can run parallel to 4–6, but janitor-before-restore-ships keeps residue from ever accumulating in the wild.)
8. **Operator restore surface:** `mrclean restore` CLI subcommand wired to `src/state/` + policy. The `mrclean_restore` MCP tool happens here ONLY if OQ6 resolved toward amending MCP-03 + tests + an identity handshake — default expectation is that it does not.
9. **THREAT_MODEL.md (REVMODE-03) + CI hardening:** blast-radius section, opt-in flow docs; extend leak-grep to assert no plaintext originals in `map.enc` fixtures, no key material in logs; import-graph test for the `src/state/` crypto boundary; PROJECT.md amendment removing the stale "restore MCP tool stub" wording.

---

## Open Questions (for requirements / phase research)

1. **session_id continuity across `--resume`** — does a resumed session keep the old `session_id` (map rehydratable) or mint a new one (`source=resume` with fresh id → old map is orphaned and only TTL-swept)? Not verified anywhere; determines whether resume-rehydration in step 1 is real or dead code. **LOW confidence — verify empirically in Phase 1 of this milestone.**
2. **Does the user's terminal render `updatedToolOutput` or the raw tool result?** The docs confirm it replaces what Claude sees; whether the local UI shows the updated text determines how much of the "round-trips back into the user's view" value restore actually delivers vs. only improving Claude's context. **Unverified — quick live test.**
3. **Should PreToolUse also restore placeholders in `tool_input`?** When Claude echoes `<MRCLEAN:WORD:001>` into a `Read` path, the tool fails unless PreToolUse restores it via `updatedInput` — and today the placeholder literal lands verbatim in files Claude writes. Milestone scopes REVMODE-01 to PostToolUse only — but without input-restore, round-tripping may break the moment Claude acts on a redacted path. Wire-reentry caveat: official docs do NOT state whether `updatedInput` is echoed back into the model context (**LOW confidence — verify live before designing**). **Product call for requirements; architecture above supports it with zero new components (same map, same policy, `restoreText` on string leaves).**
4. **TTL and sweep aggressiveness** — 24 h vs 7 d residual window for missed SessionEnds; requirements should set it alongside the opt-in consent copy.
5. **`reason=clear` semantics** — `/clear` fires SessionEnd(clear) then SessionStart(source=clear) with a new session; confirm the old id's dir is deleted by the End handler rather than waiting for sweep.
6. **MCP restore tool vs the MCP-03 ban + session-identity gap (requirements conflict — must be resolved before roadmapping the MCP surface).** PROJECT.md's v3 target says "Wire the `restore` MCP tool (stub since Phase 1)" — but (a) the stub was deleted in Plan 03-01 (`src/mcp/server.ts:12-16`), (b) `restore` is CI-banned (`tests/mcp/tools-list.test.ts:44-60` FORBIDDEN_TOOL_NAMES; T2 asserts *exactly* three tools), (c) the v1 decision record rules restoration non-model-facing (`03-03-PLAN.md:460`, prompt-injection Pitfall #10), and (d) the MCP server never receives the Claude Code `session_id` (`server.ts:87`, `redact.ts:116`), so the tool cannot locate the right map without a new handshake. **Recommended resolution: keep the ban; deliver restore as the PostToolUse hook pass + operator-only `mrclean restore` CLI; amend PROJECT.md.** Alternative (amend MCP-03 + tests + identity handshake) is architecturally supported but expands the prompt-injection surface for marginal value. **HIGH confidence on all four code facts.**

---

## Sources

- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) — fetched 2026-07-14: SessionEnd event (+`reason`, cannot block, "side effects like logging or cleanup"), parallel hook execution ("All matching hooks run in parallel"), SessionStart `source` field (`startup`/`resume`/`clear`/`compact`), PostToolUse input shape + `updatedToolOutput`; `updatedInput` model-context echo unspecified. **HIGH (except the `updatedInput` echo question — LOW, flagged)**
- Shipped source (read 2026-07-14): `src/hook/index.ts`, `src/hook/dispatcher.ts`, `src/hook/handlers/{session-start,user-prompt-submit,pre-tool-use,post-tool-use}.ts`, `src/detect/index.ts`, `src/detect/session-state.ts`, `src/detect/type-map.ts`, `src/placeholder/{manager,substitute}.ts`, `src/mcp/server.ts`, `src/mcp/tools/redact.ts`, `src/audit/log.ts`, `src/install/{settings,atomic-json}.ts`, `src/config/defaults.ts`, `src/shared/types.ts`, `src/doctor/version-check.ts`, `src/cli.ts`. **HIGH**
- MCP-03 ban + non-model-facing-restore decision record: `tests/mcp/tools-list.test.ts:44-60, 87-99`; `.planning/milestones/v1.0-phases/03-mcp-tools-performance-gate-public-release/03-03-PLAN.md:460`; `src/mcp/server.ts:12-16`. **HIGH**
- `updatedToolOutput` ≥ 2.1.121 floor — already encoded in shipped code (`src/shared/types.ts:124`) and doctor version floor from Plan 02-05 research. **HIGH**
- Node `crypto` AES-256-GCM / `fs` atomic-rename semantics — stable platform APIs, matching the project's existing `atomic-json.ts` pattern. **HIGH**
- MCP server lifecycle (stdio servers restarted on reconnect/config change; liveness not guaranteed at hook time) — training-data + v1 research daemon analysis; load-bearing only for Option B's downsides. **MEDIUM**
- session_id continuity across resume; terminal rendering of `updatedToolOutput`; `updatedInput` context echo — **unverified, LOW; flagged above.**

---
*Architecture research for: mrclean v3.0 Reversible Redact Mode*
*Researched: 2026-07-14*
