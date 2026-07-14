# Stack Research

**Domain:** Reversible redact mode (v3.0) — session-scoped placeholder→original map with restore-on-return-path for mrclean, an existing Node 20+/TS Claude Code hook + MCP redaction tool
**Researched:** 2026-07-14
**Confidence:** HIGH (hook contract verified against live code.claude.com docs + Claude Code GitHub issues/changelogs; package versions/engines verified live against npm registry; proper-lockfile internals via Context7; node:crypto AEAD/HKDF API via Context7 `/nodejs/node`)

> Scope note: This file covers ONLY the NEW capabilities for milestone v3.0 (REVMODE-01/02/03).
> The existing Node >= 20/TS stack, hook interception, MCP stdio server (`@modelcontextprotocol/sdk` ^1.29),
> PlaceholderManager, detection layers 1-4 + 6a/6b, hash-only audit log, TOML config, and tsup/vitest
> toolchain are validated (v1.0/v2.0) — see CLAUDE.md. Nothing here changes those picks.

## Platform Contract: Claude Code Hooks (load-bearing for REVMODE-01)

### PostToolUse CAN rewrite tool output — since Claude Code v2.1.121

**VERDICT: SUPPORTED. The backlog note "requires Claude Code >= 2.1.121" is confirmed correct.**

| Fact | Detail | Confidence |
|------|--------|------------|
| Field | `hookSpecificOutput.updatedToolOutput` (string) in PostToolUse JSON stdout — **"replaces the tool's result"** before it re-enters model context | HIGH — live docs (code.claude.com/docs/en/hooks, fetched 2026-07-14) |
| Since | **v2.1.121**: `updatedToolOutput` honored for **all tools** (built-in + MCP). Mirrored in Agent SDK changelog `0.2.121`: "Added `updatedToolOutput` to `PostToolUseHookSpecificOutput` for replacing tool output on all tools. `updatedMCPToolOutput` is deprecated." Independently corroborated by two changelog mirrors: "PostToolUse hooks can now replace tool output for all tools via `hookSpecificOutput.updatedToolOutput` (previously MCP-only)." | HIGH — official agent-sdk-typescript CHANGELOG + two independent mirrors |
| Before 2.1.121 | Only `updatedMCPToolOutput` existed and it rewrote **MCP tool results only** (GitHub issues #32105, #36843, #24788 document the built-in-tool gap that 2.1.121 closed) | HIGH |
| Payload shape | String replacement. Issue #32105 (closed): hook authors are "responsible for preserving schema invariants" of the tool result they replace — built-in tools like Write/Read return structured responses, so per-tool handling needs Phase verification | MEDIUM — issue text + docs example; per-tool shapes not enumerated in docs |
| Blocking semantics | PostToolUse is **non-blocking** (tool already ran). Exit code 2 only shows stderr to Claude. Rewrite must go via JSON stdout, not exit codes. `decision: "block"` + `reason` still available (existing one-way block path). `additionalContext` also available. | HIGH — live docs |
| Required envelope | `{"hookSpecificOutput": {"hookEventName": "PostToolUse", "updatedToolOutput": "..."}}` | HIGH — live docs example |

**Integration implications:**
- Current Claude Code is ~2.1.209+ (July 2026), so >= 2.1.121 is an old floor — most users already satisfy it. Still: `mrclean install` should check `claude --version` and refuse to enable reversible mode below 2.1.121 (print actionable "update Claude Code" message). Do NOT attempt runtime feature detection inside the hook — there is no version field in hook input, and the hook cannot detect that its output field was silently ignored on an older version.
- Do NOT target the deprecated `updatedMCPToolOutput` field. Target `updatedToolOutput` only.
- PreToolUse `updatedInput` (already in the contract, already used by v1 one-way mode) covers the outbound direction — placeholders in model-emitted tool inputs can be restored to originals so local tools actually work. Both directions of REVMODE-01 are contract-supported.
- **⚠ Restore re-leak hazard (THREAT_MODEL.md / REVMODE-03 item):** `updatedToolOutput` replaces what *Claude sees* — restored values re-enter model context and therefore **reach the wire on the next API call**. A naive "restore everything in PostToolUse" re-leaks exactly what mrclean redacted. Restore eligibility must be a type-scoped allowlist (the paths/names/identifiers the operator opted in for) and must **NEVER include `SECRET`/`ENV` placeholder types**. This is a policy split inside PlaceholderManager, not a stack item, but it constrains the state adapter's API (restore calls must pass a type filter) and belongs in THREAT_MODEL.md's blast-radius section.

### Session lifecycle: SessionStart / SessionEnd (REVMODE-02)

| Fact | Detail | Confidence |
|------|--------|------------|
| `session_id` | Present in the **common input fields of every hook event** (UserPromptSubmit, PreToolUse, PostToolUse, SessionStart, SessionEnd, ...). This is the natural key for the session map file. | HIGH — live docs |
| SessionStart | Matchers/`source`: `startup`, `resume`, `clear`, `compact`. Non-blocking. Good place to eagerly create/warm the session state file and run the stale-session janitor sweep. | HIGH — live docs |
| SessionEnd | Fires with `reason` ∈ `clear`, `resume`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, `other`. **Non-blocking, no decision control** — cleanup/logging only. Correct place for map deletion (janitor). Treat the reason list as non-exhaustive; clean up on every value. | HIGH — live docs (existence/no-block); MEDIUM (exhaustiveness of reason list) |
| SessionEnd is NOT guaranteed | It fires on graceful ends only. Crash / SIGKILL / power loss will NOT fire it. Known reliability history: v2.1.72 fixed "SessionEnd hooks firing twice on `--resume`"; v2.1.78 fixed "not firing on interactive `/resume` session switch" — the janitor must be idempotent. **A janitor sweep (delete session files older than a TTL, e.g. 24h, on every SessionStart / CLI invocation) is mandatory**, not optional — this is the crash-recovery story the encrypted-at-rest constraint anticipates. | HIGH (documented behavior + changelog fixes) |
| Resume nuance | `SessionEnd(reason: "resume")` means the session is being *suspended* and may return via `--resume` with the **same `session_id`** (`SessionStart(source: "resume")`). Deleting the map on `reason: "resume"` breaks placeholder round-trip after resume; keeping it means the map outlives the process. **Requirements must decide** (recommend: keep on `resume`, delete on `clear`/`logout`/`prompt_input_exit`/`other`, janitor TTL as backstop). Same for `compact` — placeholders survive compaction in context, so the map must survive it too. | HIGH on contract facts; decision flagged for requirements |
| Availability at our floor | Both SessionStart and SessionEnd predate 2.1.121 by a wide margin; the REVMODE-01 floor dominates. No separate version gate needed. | MEDIUM on exact introduction versions, HIGH that both exist at >= 2.1.121 (live docs) |

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Claude Code** (platform floor) | **>= 2.1.121** | `updatedToolOutput` on PostToolUse for all tools | The entire REVMODE-01 restore path hangs on this. Enforce at `mrclean install` time via `claude --version`; document in README + THREAT_MODEL.md. |
| **`node:crypto`** (stdlib) | Node >= 20 (already the floor) | AES-256-GCM encryption-at-rest for the persisted map; HKDF per-session key derivation | Zero new deps. `createCipheriv('aes-256-gcm')` + `randomBytes` + `hkdfSync` (available since Node 15) cover everything; API shapes verified via Context7 `/nodejs/node` (16-byte default auth tag for GCM; tampered ciphertext throws at `decipher.final()` after `setAuthTag()`). GCM gives authenticated encryption — tamper detection for free, which matters because the map is an *injection surface* (a tampered map could restore attacker-chosen strings into tool results). No userland crypto lib needed or wanted. Sub-millisecond for a few-KB map — invisible inside the 100/200ms budgets. |
| **`node:fs` / `node:fs/promises`** (stdlib) | Node >= 20 | Append-only session map writes (`appendFileSync` with `flag: 'a'`), stat-based change detection, `O_EXCL` (`flag: 'wx'`) for create-once key file | The hot path (<100ms/<200ms budgets) must stay lock-free — see Stack Patterns. Stdlib append + stat is all it needs. |
| **`proper-lockfile`** | `^4.1.2` | Mutual exclusion for the SLOW paths only: janitor cleanup, map compaction/rewrite, session-file deletion | The only maintained-quality cross-process lock in pure JS: mkdir-based lock dir (`${file}.lock`) is atomic on POSIX **and** win32 and NFS-safe; mtime-heartbeat staleness (default `stale: 10000`ms, floor 2000ms; auto-refresh at `stale/2`); `retries` with exponential backoff; `onCompromised` callback with `ECOMPROMISED` for steal detection. Deps: `graceful-fs`, `retry`, `signal-exit@3` — small, audited-many-times tree. Last release Jan 2021 = stable/maintenance-mode, not abandoned (it's the locking layer inside many build tools); the algorithm hasn't needed changes. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **`write-file-atomic`** | **`^7.0.1` — pin, do NOT float to ^8** | Atomic replace (tmp + fsync + rename) when the janitor compacts or rewrites a map file | Only on the locked slow path. **Engines verified live 2026-07-14:** v7.0.1 requires `^20.17.0 \|\| >=22.9.0` — fits our Node >= 20.18 floor and is the newest compatible major (published July 2026, npm-org maintained, single dep `signal-exit@4`). **v8.0.0 requires `^22.22.2 \|\| ^24.15.0 \|\| >=26` and would silently break the Node 20 floor.** (`^6.0.0`, engines `^18.17.0 \|\| >=20.5.0`, is also compatible if a lower floor is ever wanted.) `signal-exit@4` coexists fine with proper-lockfile's `signal-exit@3` — different majors, npm dedupes per-range. Alternative: inline ~30 LOC tmp+rename (mrclean precedent: inlined Shannon entropy) — acceptable if we want zero new deps; w-f-a earns its keep via fsync ordering, Windows rename-retry (`EPERM` under AV scanners), and signal-exit cleanup of temp files. |
| `@types/proper-lockfile`, `@types/write-file-atomic` | latest | TS types | Dev deps only; neither package bundles types. |
| — no other new runtime deps — | | | Encryption, key derivation, append, stat, `O_EXCL`, UUIDs (`crypto.randomUUID`) are all stdlib. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Existing vitest 4.x | Concurrency tests for the state adapter | Spawn real child processes (`node:child_process`) hammering concurrent appends + a locked compaction to prove no lost records / torn reads. In-process fake concurrency will NOT catch cross-process bugs. |
| Existing tsup | No change | `src/state/` compiles into the existing single ESM bundle; proper-lockfile is CJS — fine, tsup/esbuild interops it. |
| Existing leak-grep CI gate | Extend to the map artifacts | Assert seeded canary originals never appear as plaintext in `~/.mrclean/sessions/*.map.jsonl` fixtures — proves the encrypt call isn't bypassed on any write path. |

## Installation

```bash
# Runtime (slow-path only; hot path is stdlib-only)
npm install proper-lockfile@^4.1.2 write-file-atomic@^7.0.1

# Dev
npm install -D @types/proper-lockfile @types/write-file-atomic
```

## Design Answers to the Four Research Questions

### 1. Hook contract — answered above (Platform Contract section)

PostToolUse rewrite: YES, `hookSpecificOutput.updatedToolOutput`, all tools, since **v2.1.121**. SessionStart (`startup|resume|clear|compact`) + SessionEnd (`reason`, non-blocking, not crash-guaranteed). `session_id` in every event's input. Restore eligibility must exclude secret types (re-leak hazard above).

### 2. File locking + atomic writes — pattern: lock-free hot path, locked slow path

**Do not put any lock acquisition on the hook hot path.** proper-lockfile's clamped minimums (stale >= 2000ms, update >= 1000ms) mean a crashed lock-holder blocks contenders for seconds — instant blowout of the <100ms/<200ms budgets, and a fail-closed hook would then block the user's tool call.

Instead:

- **Map growth = append-only JSONL.** Each new placeholder→original record is ONE `fs.appendFileSync(file, line, { flag: 'a' })` call (O_APPEND). Single-syscall appends of small records (< 4KB) do not interleave on local filesystems (POSIX O_APPEND atomic seek+write; same behavior mrclean already relies on for multi-process `audit.jsonl` appends). Readers tolerate a torn trailing line (skip lines that fail GCM auth/parse). No lock, no retry, no latency.
- **`O_EXCL` (`flag: 'wx'`) only for create-once artifacts:** the master key file and per-session file initialization — atomic "create if absent, fail if present", loser of the race just reads the winner's file.
- **proper-lockfile ONLY for**: janitor deletion sweeps, compaction (rewrite deduped map via write-file-atomic then rename), and SessionEnd cleanup. Config: `{ stale: 5000, retries: { retries: 3, minTimeout: 50, maxTimeout: 250, randomize: true }, onCompromised: log-and-abort-compaction }`. If the lock can't be acquired, skip the janitor run — never block a user-facing path on it.
- **flock is not an option in pure Node**: `fs-ext` (the only flock binding) is a native addon — breaks zero-config `npx` install. Not needed given the design above.

### 3. Encryption at rest — stdlib AES-256-GCM, file-based key, no keychain

- **Cipher:** `crypto.createCipheriv('aes-256-gcm', key, iv)` with a fresh 12-byte `randomBytes` IV per record; store `base64(iv || ciphertext || authTag)` per JSONL line. Set AAD = `session_id` (+ record type) via `cipher.setAAD()` so records can't be spliced between session files undetected — a map file renamed to another session's ID fails auth.
- **Key hierarchy (no OS keychain — POLISH-03 keychain integration stays deferred):**
  - Master key: 32 `randomBytes`, written once with `flag: 'wx'`, `mode: 0o600` to `~/.mrclean/keys/master.key` (dir `0o700`).
  - Per-session key: `crypto.hkdfSync('sha256', masterKey, utf8(session_id), 'mrclean-revmode-v1', 32)`. HKDF is the correct KDF here — the IKM is already high-entropy random, so scrypt/PBKDF2 password-stretching would burn hot-path milliseconds for zero gain. Different key per session; shredding the master key kills all recorded sessions at once. `getMachineKey()` in `src/state/` is the single swap point when POLISH-03 moves the key into an OS keychain.
  - **Key and map live in different directories and never in the project tree.** Session maps at `~/.mrclean/sessions/<session_id>.map.jsonl` (`0o600`). Never under project `.mrclean/` — one accidental `git add`/cloud-sync of the project dir must not ship the map (even ciphertext) alongside code.
- **Decrypt failure = fail closed for restore:** a record failing GCM auth is skipped (placeholders stay visible — cosmetic degradation, not a leak), audited hash-only, never "best-effort parsed". A fully unreadable map file is deleted and the session continues un-restored.
- **Honest threat framing for THREAT_MODEL.md (REVMODE-03):** file-based key + map on the same disk defends against backups, cloud sync, other local users, and casual post-mortem reads — NOT against same-user malware running as the user (it can read both files). Say so explicitly; this is the same honest-framing discipline as the v2.0 NER copy. `chmod 0600` is advisory-only on win32 — document as part of the existing win32 known-gap. If `CLAUDE_CODE_REMOTE=true` (remote web environments), "machine key" scope = the remote sandbox, not the user's laptop — documentation note, no stack change.
- No userland crypto packages. Anything on npm here (e.g. `crypto-js` — unmaintained, no GCM AEAD) is strictly worse than stdlib.
- **Do NOT stash the key in `CLAUDE_ENV_FILE` or any env var:** `CLAUDE_ENV_FILE` (SessionStart) persists env into every subsequent Bash tool subprocess — the key would be readable by every command Claude runs and can leak into transcripts, which go to the wire.

### 4. Cross-process cache coherence — stat-based invalidation + append offsets

- **Hook processes (fresh per event): no coherence problem.** They read the map file cold on every invocation. Session maps are small (hundreds of records max); read+decrypt is single-digit ms — fits the 100/200ms budgets.
- **Long-lived MCP server: `tail -F` pattern.** Keep `{ ino, size, mtimeMs, offset }` after each read. Before every `restore`/`redact` op: `fs.statSync` (microseconds). Size grew + same inode → incrementally read/decrypt from stored offset. Inode changed or size shrank (janitor compacted/rotated) → full reread. This is deterministic, event-loop-free, and costs nothing when idle. The `restore` MCP tool (stub since Phase 1) wires to the same `src/state/` adapter with the same type-scoped eligibility filter.
- **Do NOT use `fs.watch`** — unreliable on macOS/network filesystems, adds an event race where the server acts on a stale map between the write and the notification. On-demand stat has no such window.
- **Do NOT introduce an IPC/socket channel** (hook → MCP server) for state: the MCP server is not guaranteed to be running (hook-only installs are valid), and a fail-closed hook waiting on a dead socket blocks the user. The file IS the IPC.
- **⚠ Placeholder ID allocation is the one true concurrency hazard.** Two concurrent writers (hook + MCP server) allocating sequential `<MRCLEAN:TYPE:NNN>` counters from the same file WILL collide under append-only. Requirements must pick one: (a) content-derived IDs in reversible mode (e.g. `<MRCLEAN:TYPE:hash8(original+session_id)>` — same original converges to the same placeholder, no counter, collision probability negligible per-session), or (b) per-writer ID namespaces. Option (a) recommended: it also makes appends idempotent (duplicate records are harmless). Flagged for the requirements step.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| proper-lockfile (slow path) | Hand-rolled `O_EXCL` PID-lockfile + `process.kill(pid, 0)` liveness | If we decide even proper-lockfile's 3-dep tree is too much supply chain. ~80 LOC but staleness/mtime-precision/steal edge cases are subtle — proper-lockfile has a decade of soak on exactly these. Only justified if a supply-chain audit rejects it. |
| write-file-atomic@^7 | Inline tmp+`fsync`+rename (~30 LOC) | Legitimate per mrclean's inline-small-things precedent (Shannon entropy). Choose during phase planning; either is fine. Do not use steno/lowdb for this (single-process design). |
| write-file-atomic@^7.0.1 | write-file-atomic@^6.0.0 | Only if the Node floor ever drops below 20.17 (engines `^18.17.0 \|\| >=20.5.0`). At the current 20.18 floor, ^7 is the newer, equally-maintained pin. |
| File-based master key + HKDF | OS keychain (`@napi-rs/keyring`) | Deferred as POLISH-03. Native addon breaks zero-config `npx`; revisit only as an opt-in enhancement, never a requirement for reversible mode. Do NOT use `keytar` — archived. |
| Append-only JSONL map | Single JSON blob rewritten under lock per mutation | Only if requirements add cross-record invariants that appends can't express. Costs a lock on the hot path — currently disqualifying. |
| stat-based invalidation in MCP server | Full reread on every operation | Fine fallback if incremental-offset bookkeeping proves fiddly; maps are small. Start with full-reread-on-change (simplest), optimize to offsets only if profiling demands. |
| AES-256-GCM | `chacha20-poly1305` (also in node:crypto) | Equivalent AEAD security; GCM chosen because AES-NI is universal on dev machines and GCM is the pattern reviewers expect. No reason to switch. |
| Session maps in `~/.mrclean/sessions/` | `os.tmpdir()` | tmpdir gets per-boot cleanup for free, but Linux `/tmp` visibility and backup-exclusion behavior vary; a `0o700` dir under the user's home is predictable cross-platform. Revisit only if cloud-synced home dirs emerge as a real user pattern — then split key and map across locations. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **`updatedMCPToolOutput`** (hook field) | Deprecated as of 2.1.121 / SDK 0.2.121; MCP-tools-only | `hookSpecificOutput.updatedToolOutput` |
| **`write-file-atomic@^8`** | engines `^22.22.2 \|\| ^24.15.0 \|\| >=26` — breaks the project's Node >= 20 floor at install time | Pin `^7.0.1` (engines `^20.17.0 \|\| >=22.9.0`, verified live); add a renovate/dependabot guard on the major |
| **`fs-ext`** (flock binding) | Native addon; breaks zero-config `npx` install; unmaintained | proper-lockfile (mkdir lock) + O_EXCL patterns |
| **`lockfile`** (npm's old package) | Deprecated by npm themselves; stale since 2018 | proper-lockfile |
| **`keytar`** | Archived with the Atom sunset; native addon | File key + HKDF now; `@napi-rs/keyring` later under POLISH-03 if ever |
| **`node-ipc`** or any socket IPC for state | 2022 protestware incident (supply chain); and architecturally wrong — MCP server not guaranteed alive, fail-closed hook would block on it | The map file is the IPC; stat-based coherence |
| **`better-sqlite3` / SQLite / `lmdb` / `level`** | Native addons (prebuilds mitigate but still a compile fallback risk on `npx`); massive overkill for a per-session KV map of hundreds of entries | Encrypted append-only JSONL |
| **`lowdb` / `steno`** | Single-process write-queue design; no cross-process story — our writers are separate processes by construction; would give false confidence | stdlib append + proper-lockfile slow path |
| **`crypto-js` / `node-forge` / `tweetnacl` / `libsodium-wrappers`** | Unmaintained (crypto-js, CVE-2023-46233) or redundant pure-JS crypto; nothing here needs primitives the OpenSSL-backed stdlib lacks | `node:crypto` AES-256-GCM |
| **`fs.watch`** for coherence | Unreliable on macOS/NFS; notification race window | On-demand `statSync` before each read |
| **Locks on the hook hot path** | proper-lockfile staleness floor (2s) means a crashed holder stalls contenders for seconds — destroys the <100/200ms budget and fail-closed would block user tool calls | Append-only writes; locks confined to janitor/compaction |
| **Key material in `CLAUDE_ENV_FILE` / env vars** | Persists into every Bash tool subprocess and can leak into transcripts → the wire — the exact leak mrclean exists to prevent | Master key file `0o600` + HKDF |
| **Deriving the key from `session_id` alone** | `session_id` appears in every hook payload and the transcript — public data within the threat model; that's obfuscation, not encryption | Random master key as HKDF IKM; `session_id` only as salt/AAD |
| **Restoring `SECRET`/`ENV` placeholder types via `updatedToolOutput`** | Restored values re-enter model context → wire on the next turn; defeats the core value prop | Type-scoped restore allowlist (paths/names/identifiers only); document in THREAT_MODEL.md |
| **Persisting maps across sessions** | Explicitly out of scope in PROJECT.md — blast-radius containment | SessionEnd delete + janitor TTL |

## Stack Patterns by Variant

**If reversible mode is OFF (default — one-way):**
- Nothing in this document activates. No key file, no session map, no new deps on the hot path. `src/state/` must be lazy-imported behind the config flag (same discipline as the Layer 5 / NER lazy-import rules).

**If reversible mode is ON, hook process (short-lived):**
- Read map cold (decrypt all lines, skip torn/failing lines), do placeholder work in memory, append any NEW records (one `appendFileSync` per record), emit `updatedToolOutput` / `updatedInput` JSON. No locks. No key generation on this path if avoidable — `mrclean install`/SessionStart should pre-create the master key so the hot path never pays `randomBytes`+`wx` create.

**If reversible mode is ON, MCP server (long-lived):**
- In-memory Map is the working copy; stat-check before every operation; incremental append-read on growth; full reload on inode change/shrink. Appends its own new records the same way hooks do.

**If Claude Code < 2.1.121 detected at install:**
- Refuse to enable reversible mode with an actionable message. One-way mode continues to work unchanged. (Optional degraded mode — restore on MCP tool results only via the pre-2.1.121 `updatedMCPToolOutput` — is NOT recommended: partial restore is a confusing half-feature and the field is deprecated.)

**On SessionEnd:**
- `reason: clear | logout | prompt_input_exit | other` → acquire lock, delete `<session_id>.map.jsonl`.
- `reason: resume` → recommend keep (session may resume with same `session_id`); janitor TTL is the backstop. Requirements decision — flagged.
- Always: opportunistic janitor sweep of session files past TTL (SessionEnd is not crash-guaranteed and has a double-fire/missed-fire history — v2.1.72/78).

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Claude Code `>= 2.1.121` | REVMODE-01 (`updatedToolOutput`, all tools) | Load-bearing floor. Current release train is 2.1.209+ (July 2026). Check at install time. |
| `write-file-atomic@7.0.1` | Node `^20.17.0 \|\| >=22.9.0` | Verified live 2026-07-14. Fits the Node >= 20.18 floor. **v8 does not** (needs 22.22+). Renovate/dependabot must not auto-bump this major until the Node floor moves. `^6.0.0` (engines `^18.17.0 \|\| >=20.5.0`) remains a fallback. |
| `proper-lockfile@4.1.2` | Node >= 8 (no engines field); `signal-exit@^3` | Coexists with write-file-atomic's `signal-exit@^4` (npm installs both majors, no conflict). CJS package — esbuild/tsup interop is automatic. |
| `crypto.hkdfSync` / `randomUUID` / AES-256-GCM | Node >= 15 / 14.17 / all LTS | Comfortably inside the Node 20 floor; no polyfills. |
| `src/state/` adapter | Existing PlaceholderManager | Requires the placeholder-ID allocation decision (content-derived vs namespaced) BEFORE the adapter is built — sequential NNN counters are unsafe under multi-process append-only writes. |

## Sources

### Primary / Official (HIGH confidence)
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) (fetched 2026-07-14) — PostToolUse `hookSpecificOutput.updatedToolOutput` semantics ("replaces the tool's result"), PostToolUse input shape (`tool_name`/`tool_input`/`tool_response`), `additionalContext`, non-blocking nature; SessionStart matchers (`startup|resume|clear|compact`); SessionEnd `reason` values and no-decision-control; `session_id` in common input fields for all events; `CLAUDE_ENV_FILE` / `CLAUDE_CODE_REMOTE` env vars; 10,000-char hook output string cap.
- [anthropics/claude-agent-sdk-typescript CHANGELOG](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md) — v0.2.121: "Added `updatedToolOutput` to `PostToolUseHookSpecificOutput` for replacing tool output on all tools. `updatedMCPToolOutput` is deprecated."
- [anthropics/claude-code issue #32105](https://github.com/anthropics/claude-code/issues/32105) (closed) and [#36843](https://github.com/anthropics/claude-code/issues/36843) — document the pre-2.1.121 built-in-tool gap (`updatedMCPToolOutput` MCP-only, per #24788); `updatedToolOutput` is a string; hook authors "responsible for preserving schema invariants".
- `npm view` (live, 2026-07-14) — `proper-lockfile@4.1.2` (deps `graceful-fs`/`retry`/`signal-exit@3`, no engines field); `write-file-atomic@8.0.0` engines `^22.22.2 || ^24.15.0 || >=26.0.0` (incompatible); `write-file-atomic@7.0.1` engines `^20.17.0 || >=22.9.0` (compatible, July 2026); `write-file-atomic@6.0.0` engines `^18.17.0 || >=20.5.0`; `steno@4.0.2`; `lockfile@1.0.4` (stale since 2018).
- Context7 `/moxystudio/node-proper-lockfile` — verified defaults (`stale: 10000` clamped min 2000, `update = stale/2` clamped min 1000), mkdir+mtime-heartbeat mechanism, `retries` config shape, `onCompromised`/`ECOMPROMISED` steal detection.
- Context7 `/nodejs/node` — `createCipheriv`/`createDecipheriv` AES-GCM (16-byte default auth tag), `getAuthTag`/`setAuthTag` semantics (tamper → `final()` throws), `hkdfSync(digest, ikm, salt, info, keylen)` signature and constraints.

### Secondary / Corroborating (MEDIUM confidence)
- [claudefa.st Claude Code changelog mirror](https://claudefa.st/blog/guide/changelog) — v2.1.121: "PostToolUse hooks can now replace tool output for all tools via `hookSpecificOutput.updatedToolOutput` (previously MCP-only)"; v2.1.72 ("SessionEnd hooks firing twice on `--resume`") and v2.1.78 ("SessionEnd hooks not firing on interactive `/resume` session switch") reliability fixes. (Official GitHub CHANGELOG.md fetch only reached back to ~2.1.154, so the 2.1.121 entry is mirror-sourced + consistent with the SDK changelog and issue tracker.)
- [Build This Now — Claude Code v2.1.122 notes](https://www.buildthisnow.com/blog/guide/development/claude-code-v2-1-122-whats-new) — second independent corroboration of the 2.1.121 expansion.
- POSIX O_APPEND single-write atomicity for small records on local filesystems — standard, and mrclean already depends on it for multi-process `audit.jsonl` appends; readers still defend against torn trailing lines (GCM auth failure → skip).

### Open Questions / flagged for requirements & Phase research (not stack blockers)
- **Does the 10,000-char hook output cap apply to `updatedToolOutput`?** The docs cap "hook output strings" at 10K chars; if it binds here, restoring inside large tool results (big file reads) may truncate. Phase must test with a >10KB tool result and define chunk/skip behavior. (LOW confidence either way — verify empirically.)
- **Structured `tool_response` for built-in tools vs string `updatedToolOutput`** — Write/Read return structured responses; docs only show a Bash string example, and #32105 puts schema-invariant responsibility on the hook. Per-tool empirical verification needed in the first phase.
- **SessionEnd `reason: "resume"` map retention** — keep (round-trip survives `--resume`) vs delete (strictest reading of "removed on session exit"). Janitor TTL backstops either choice.
- **Placeholder ID scheme in reversible mode** — content-derived IDs (recommended) vs per-writer namespaces; must be decided before REVMODE-02 build. Sequential counters are unsafe with two writer processes.
- Exact Claude Code versions that introduced SessionStart/SessionEnd — not pinned (changelog excerpt didn't reach that far back), but both provably exist at the >= 2.1.121 floor, which dominates.

---
*Stack research for: mrclean v3.0 Reversible Redact Mode (REVMODE-01/02/03)*
*Researched: 2026-07-14*
