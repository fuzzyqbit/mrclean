# Phase 9: Session State Adapter - Research

**Researched:** 2026-07-17
**Domain:** Cross-process encrypted session state (AES-256-GCM store, file locking, content-addressed allocation, lifecycle janitor) for Node >= 20 hook processes
**Confidence:** HIGH — core mechanics verified empirically on the dev platform this session (live Node 22.22.0 probes + a 16-process stress run), APIs confirmed via Context7 `/nodejs/node`, all integration points read from shipped source

<user_constraints>
## User Constraints (from 09-CONTEXT.md)

### Locked Decisions

#### Store mechanism (T2 reconciliation — ROADMAP-flagged, pinned here)
- **D-01:** Whole-file encrypt + short locked transaction (ARCHITECTURE variant) over append-only JSONL + lock-free hot path (STACK variant). Deciding argument: REVMODE-04's allocate-if-absent semantics (same original → same placeholder across concurrent processes) requires read-check-allocate-persist atomicity — a lock-free append log cannot give it without post-hoc dedup that breaks placeholder stability; and REVMODE-05's ratified `NNN` counter needs coordinated increment anyway. Whole-file also has fewer failure shapes: no torn-JSONL-tail handling, no compaction sub-janitor. ARCHITECTURE measured the locked allocate-and-persist step at ~2 ms — fits the <100 ms UserPromptSubmit budget.
- **D-02:** Mutual exclusion via a real lock (e.g. `mkdir`-style O_EXCL lockdir or `proper-lockfile` semantics) around the allocate-and-persist transaction only. Invariants locked from research (all four files converge): never hold the lock across detection; `write-file-atomic` alone is NOT mutual exclusion; lock scope is the ~2 ms read→allocate→encrypt→rename window.
- **D-03:** Map I/O invariants (converged, restated as build contract): ciphertext-only on disk INCLUDING temp files (encrypt before any write, then atomic rename); AES-256-GCM, fresh random 12-byte IV per encryption event; GCM tag failure ⇒ map treated as absent (fail-safe, redaction unaffected); map never inside the project tree.

#### Key custody layout (ROADMAP-flagged "exact key layout", pinned here)
- **D-04:** Per-session random 256-bit key, generated with CSPRNG at first reversible allocation. Key file `~/.mrclean/keys/<session_id>.key` (0600) in `~/.mrclean/keys/` (0700); ciphertext `~/.mrclean/sessions/<session_id>.map` (0600) in `~/.mrclean/sessions/` (0700). Key and ciphertext in different directories per SC1. Key CONTENT is never derived from `session_id`/hostname/env (random material only — the session_id appears solely in file NAMES for lookup/janitor pairing).
- **D-05:** No passphrase/KDF, no MCP-server-resident key custody (PITFALLS-13 alternative rejected with T2 Option B — server restart loses map + resets counter; hook-only installs get nothing). Janitor deletes key file and map file together; a deleted key makes any orphaned ciphertext permanently dead — that IS the crash-cleanup story. Honest framing carried from THREAT_MODEL: file custody stops casual single-artifact exfiltration, not a same-user local attacker.

#### Janitor semantics (T5 converged + one new edge pinned)
- **D-06:** Retention is an ALLOWLIST: retain the map only on `reason === 'resume'`. Every other reason — the documented delete set (`clear`/`logout`/`prompt_input_exit`/`other`) AND any unknown future reason string (SessionEndInput.reason is an open string per 08-01) — deletes map + key. Fail-toward-privacy: over-deletion costs a cosmetic re-redaction; under-deletion leaves recoverable originals resting on disk.
- **D-07:** TTL orphan sweep runs at SessionStart hook and MCP-server boot (both sites — headless sessions never fire SessionEnd, proven E5). Sweep pairs: map without key, key without map, and either older than TTL → delete. Map must survive `compact` (SessionStart matcher fires on compact; sweep must not treat a live session's map as orphaned — age by mtime refreshed on write).
- **D-08:** `handleSessionEnd` replaces the Phase 8 no-op with the reason-aware janitor, keeping the fail-closed wrapper contract: janitor errors must never produce exit-2 noise at session end (swallow-and-audit, never throw).

#### Config surface ([reversible] table widening)
- **D-09:** `[reversible]` gains exactly one new key this phase: `ttl_hours` (integer ≥ 1, default 24). Fail-closed validation per the 08-01 precedent (wrong type ⇒ ConfigReadError naming file + reason); unknown keys stay tolerated-and-dropped; partial-layer merge semantics from 08-07 apply (user opt-in survives project partial tables). YAGNI fence holds: no other knobs (no cipher choice, no path overrides — paths are fixed contract).

#### Placeholder format & allocation (T4 — ratified by REVMODE-05, restated)
- **D-10:** One-way default: v1 `<MRCLEAN:TYPE:NNN>` format and per-process counter code path byte-identical (regression-gated, same discipline as Phase 8's SC2). Reversible sessions: v2 `<MRCLEAN:TYPE:NNN:nonce8>` with a per-session CSPRNG nonce (kills planted-token enumeration); allocation is content-addressed against the shared store — lookup by per-session hash of the original; same original (any TYPE) → identical placeholder from any hook process.
- **D-11:** Secret floor at map-WRITE time (T3, converged): all secret TYPEs, ENV, ENTROPY, and checksummed PII (SSN/credit-card) persist `{placeholder, type, hash, counter}` with NO `original` field — structurally unrestorable, needed for cross-process stability. No config can widen the restorable set, only narrow it. (Read-time enforcement is Phase 10's second gate.)

### Claude's Discretion
- Exact lockfile primitive (lockdir vs lockfile lib) — planner/researcher pick against the stress criterion (SC5) and zero-new-heavy-deps preference.
- Map file internal schema (JSON shape inside the encrypted envelope), hash function for content-addressing (non-cryptographic OK for dedup; collision = same placeholder for different originals, which restore-scope makes cosmetic — document the residual).
- Doctor check-8 copy update (enabled path drops "plumbing only" once the adapter is real) and mrclean_status counters wording.

### Deferred Ideas (OUT OF SCOPE)
- Restore-path work of any kind (CLI, policy filter, pass-through rules) — Phase 10 (REVMODE-01).
- Live canary round-trip, fs-write interception, chaos gates as CI — Phase 11 (build against their named criteria now, gate later).
- Per-type restore allowlist narrowing knob + restore-miss telemetry — v3.x (research "Defer" list).
- Unpackaged spike findings (`.planning/spikes/MANIFEST.md`): unrelated to session-state scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REVMODE-02 | Encrypted session store: AES-256-GCM, fresh IV per write, key in separate 0700 dir, ciphertext-only incl. temp files, never in project tree | §Envelope format + §Code Examples 1–2 (verified GCM API shapes, tag-truncation mitigation, 0600/0700 mode behavior proven live); §Pitfall 1 (DEP0182), §Pitfall 2 (fsync policy) |
| REVMODE-04 | Content-addressed cross-process allocation — same original → same placeholder, collision-free under concurrency | §Content-addressed allocation design; 16-process stress experiment (0 lost entries, 0 disagreements, 0 timeouts — validated live this session); §Code Example 4 harness shape |
| REVMODE-05 | v2 tokens `<MRCLEAN:TYPE:NNN:nonce8>` reversible-only; v1 path byte-identical | §v2 token layer; existing `manager.ts` read (v1 formatter lines 94–96 untouched); byte-identical gate strategy per Phase 8 SC2 discipline |
| REVMODE-06 | Secret-class entries structurally lack `original`; floor not widenable by config | §Secret floor implementation (TYPE partition against the 25-entry locked vocabulary, discriminated-union entry types, serializer guard, SC3 decrypt-and-dump test shape) |
| REVMODE-07 | Reason-aware SessionEnd janitor + TTL sweep at SessionStart and MCP boot | §Janitor design (delete-key-first ordering, map-mtime-only TTL aging — D-07 letter/intent contradiction resolved, grace window for the first-allocation race); integration points read from shipped handlers |
</phase_requirements>

## Summary

Every load-bearing mechanism for this phase was verified live this session on the dev platform (macOS, Node 22.22.0, APFS): the AES-256-GCM envelope roundtrip, the GCM tag-truncation hazard and its mitigation, `wx`/mkdir atomicity, 0600/0700 mode behavior, rename-replace mtime semantics, and — decisively — a 16-process stress run of the exact locked content-addressed transaction design, which lost zero entries, produced zero placeholder disagreements on shared originals, and hit zero lock timeouts in a 117 ms burst of 400 contended transactions.

Two empirical findings materially adjust the inherited design numbers. First, **ARCHITECTURE's ~2 ms locked-transaction estimate holds ONLY without fsync**: `fsync` costs a flat ~6–8 ms on macOS APFS, pushing the hold to p95 ≈ 10 ms — under 16-way contention that breaches the UserPromptSubmit budget. The recommendation is to **skip fsync on the hot-path transaction**: the design already treats any torn/stale map as absent (GCM auth catches all partial states), so fsync buys durability the failure model does not need. Second, **Node 22's DEP0182 window is real on this machine**: a truncated 4-byte auth tag is silently ACCEPTED by `createDecipheriv` unless `authTagLength: 16` is passed explicitly — the decrypt path MUST pass it and MUST length-validate the envelope before slicing.

On the lock primitive (Claude's discretion): `proper-lockfile@4.1.2`, `write-file-atomic@7.0.1`, and `@types/proper-lockfile` were installed TRANSIENTLY during research probes and REVERTED by the orchestrator (no operator gate ran; research agents do not own dependency mutations). The versions match the STATE.md open-todo pins (line ~109: "PIN — do NOT float to ^8, breaks Node 20 floor"); all three audited slopcheck-clean, no postinstall scripts. The PLAN must carry the install as an explicit task with a supply-chain threat disposition (repo convention: every install rides a plan's T-SC row), placing `@types/proper-lockfile` in devDependencies. The recommendation is therefore **proper-lockfile as the primary lock** with a precise config recipe (`realpath: false` is mandatory — verified: default config throws ENOENT on the not-yet-existing map file; tight retries give up in ~46 ms), with the raw mkdir-lockdir loop (validated by the stress run) documented as the zero-dep fallback. `write-file-atomic` is used for the ciphertext rename step with `fsync: false` and pre-encrypted input only.

**Primary recommendation:** Build `src/state/` exactly as pinned (whole-file AES-256-GCM + short locked transaction), with: explicit `authTagLength: 16` + envelope length-validation on decrypt, no fsync inside the lock, proper-lockfile configured `{realpath:false, stale:2500, retries:{retries:12, factor:1.5, minTimeout:2, maxTimeout:10, randomize:true}}` behind a ~50/100 ms deadline-degrade wrapper, HMAC-SHA256 (per-session random salt) content addressing, delete-key-before-map janitor ordering, and TTL aging by **map mtime only** (never key mtime — an active session's key mtime never refreshes).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Encrypted map store (encrypt/decrypt/atomic write) | `src/state/` library (new) | — | Single crypto+I/O chokepoint; no `node:crypto`/lock imports outside it (import-graph test) |
| Locked allocate-and-persist transaction | `src/state/` facade, invoked by hook handlers | — | Only PreToolUse + PostToolUse substitute today (UPS only blocks/warns — verified in `user-prompt-submit.ts`); batch ONE transaction per event |
| v2 token formatting + content addressing | `src/placeholder/manager.ts` (extended) | `src/state/` (store side) | v1 formatter/counter path stays byte-identical; v2 is a layered, reversible-only branch |
| Secret floor (no `original` for secret classes) | `src/state/` entry constructors (write time) | — | Structural: entry type for secret classes cannot represent `original`; Phase 10 adds the read gate |
| Reason-aware SessionEnd janitor | `src/hook/handlers/session-end.ts` → `src/state/janitor.ts` | — | Replaces Phase 8 no-op; swallow-and-audit, config-free (allowlist is code) |
| TTL sweep | SessionStart handler + `src/mcp/server.ts` boot | `src/state/janitor.ts` | Both sites mandatory (E5: SessionEnd never fires headless); non-fatal try/catch at both call sites |
| `ttl_hours` config knob | `src/config/index.ts` | `src/shared/types.ts` | Follow `validateReversibleConfig` fail-closed pattern + 08-07 per-field merge |
| Doctor check-8 copy | `src/doctor/checks.ts` | `tests/doctor/checks.test.ts` | Byte-for-byte asserted constants — update both together |
| session_id validation (path safety) | `src/state/` facade boundary | — | Strict UUID regex at the single entry point; non-matching sid ⇒ reversible unavailable for the event (fail one-way) |

**Scope fence:** the MCP redact tool (`src/mcp/tools/redact.ts`) must NOT be wired into the state adapter — the MCP server has no Claude Code session_id (T6/OQ6 settled; MCP-lane allocations are non-restorable in v3.0). The MCP server's only Phase 9 touch is the boot-time TTL sweep (sid-agnostic) and optionally status counters.

## Project Constraints (from CLAUDE.md)

- **Perf budgets:** hook <100 ms UserPromptSubmit / <200 ms PostToolUse — drives the no-fsync decision and lock deadline sizing below.
- **Minimal supply-chain surface** for a security tool — no userland crypto; new deps limited to the two already accepted + types.
- **Security:** placeholder→original map encrypted at rest, removed on session exit; audit log never contains raw values — restated as D-03/D-06.
- **Node >= 20.18.0 floor / TS ^5.6 / ESM** — all APIs used are in-floor (`hkdfSync` not needed; `randomUUID`, `wx`, GCM all >= Node 15).
- **Coding style (user rules):** immutability (transaction fn returns new map object), small files (split `src/state/` into facade/store/lock/janitor/schema modules), early returns, named constants for thresholds (deadlines, TTL grace), TDD with AAA tests, 80% coverage floor.
- **GSD workflow enforcement:** file edits only via GSD execution — this document feeds `/gsd:plan-phase 9`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:crypto` | stdlib (Node >= 20) | AES-256-GCM envelope, `randomBytes` keys/IVs/nonce, HMAC-SHA256 content addressing | Zero-dep, OpenSSL-backed; roundtrip + tamper/AAD rejection verified live this session `[VERIFIED: local Node 22.22.0 probe]` |
| `node:fs` / `node:fs/promises` | stdlib | `wx` create-once key file, tmp-write + rename, `statSync` mtime aging, `mkdir` 0700 dirs | All semantics (EEXIST on `wx`, EEXIST on non-recursive mkdir, mode 0600/0700 under umask 022, rename-over-existing, mtime refresh on rename) verified live `[VERIFIED: local probe]` |
| `proper-lockfile` | `^4.1.2` (installed) | Cross-process mutual exclusion for the allocate-and-persist transaction | Accepted into package.json this session (STATE.md pin); mkdir-based (same primitive the stress run validated), signal-exit lock release on kill, win32-safe; behavior probed live on the installed copy `[VERIFIED: npm registry + local probe]` |
| `write-file-atomic` | `^7.0.1` (installed — PIN, do NOT float to ^8) | Atomic ciphertext replace (tmp+rename) inside the lock | v7 engines `^20.17.0 \|\| >=22.9.0` fit the Node 20 floor `[VERIFIED: npm view]`; **v8 engines break the floor** — renovate/dependabot must guard the major. MUST be called with ciphertext input and `fsync: false`, `mode: 0o600` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/proper-lockfile` | `^4.1.4` (installed) | TS types for proper-lockfile | Dev-only — **currently misplaced in `dependencies`; planner must move it to `devDependencies`** |
| Existing `sha256hex` (`src/detect/findings.ts`) | shipped | In-memory PH-02 keying (v1 path, unchanged) | Do not change; store-side addressing uses HMAC (below), memory-side stays sha256 |
| vitest / tsx / tsup | installed (4.1.6 / 4.20 / 8.5.1) | Stress harness spawning, test-only dist entry | Dev loop only |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| proper-lockfile | Hand-rolled mkdir lockdir (~80 LOC, zero deps) | Validated live under 16-way stress this session; exact deadline control. Loses signal-exit release-on-kill and a decade of stale-edge soak. Keep as fallback if the stress gate exposes retry-granularity issues |
| write-file-atomic | Inline tmp+rename (~15 LOC, the `atomic-json.ts` pattern + mode + ciphertext) | Equal correctness; wfa adds win32 EPERM rename retry + signal-exit tmp cleanup. Both acceptable; wfa is installed, so use it |
| HMAC-SHA256 content addressing | Plain sha256(original) / non-crypto hash (xxhash) | Plain sha256 lets a map-file holder dictionary-confirm secret-class originals from their stored hashes; non-crypto adds a dep or inline code for zero gain. HMAC with per-session salt kills guess-confirmation and cross-session correlation at negligible cost |
| No fsync (recommended) | fsync inside the lock | fsync = +6–8 ms per txn on macOS `[VERIFIED: local benchmark]` → 16-way burst ~160 ms, breaching budgets. Fail-safe design makes durability optional: any torn state ⇒ GCM auth fail ⇒ map absent ⇒ cosmetic |

**Installation:** none required — all runtime deps already in `package.json` (accepted this session). No new installs in this phase's plans.

**Version verification (2026-07-17):** `proper-lockfile@4.1.2` (deps: graceful-fs, retry, signal-exit@3; last modified 2022 — stable/maintenance), `write-file-atomic@7.0.1` (engines verified), `@types/proper-lockfile@4.1.4` — all confirmed via `npm view` + installed-copy inspection.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| proper-lockfile | npm | ~9 yrs (last publish 2022) | high (build-tool substrate) | github.com/moxystudio/node-proper-lockfile | [OK] | Approved (installed) |
| write-file-atomic | npm | ~10 yrs, npm-org maintained | very high | github.com/npm/write-file-atomic | [OK] | Approved (installed; major PINNED at ^7) |
| @types/proper-lockfile | npm | DefinitelyTyped | high | github.com/DefinitelyTyped/DefinitelyTyped | [OK] | Approved — move to devDependencies |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**postinstall scripts:** none on any of the three (`npm view … scripts.postinstall` empty) `[VERIFIED: npm view]`

Post-install notes for the planner: (1) `npm audit` reports 5 pre-existing vulnerabilities (1 low / 2 moderate / 2 high) — inspected: they sit under `node_modules/vite` (transitive dev-dep of vitest), not in the runtime tree; triage as a chore, not a Phase 9 blocker. (2) The install also surfaced a deprecated transitive `boolean@3.2.0` warning — unrelated to the three new packages.

## Architecture Patterns

### System Architecture Diagram

```
Claude Code (one session, session_id = UUID)
   │ spawns per event
   ▼
hook proc (PreToolUse / PostToolUse, reversible ON)
   │
   ├── Phase 1 (LOCK-FREE) ──────────────────────────────────────────┐
   │     validate sid (UUID regex) ─ fail ⇒ one-way mode             │
   │     readSessionMap(sid)  ── decrypt (authTagLength:16, AAD)     │
   │        └─ ANY error (ENOENT/EACCES/short envelope/tag fail/     │
   │           schema fail) ⇒ map := ABSENT (fresh empty)            │
   │     hydrate PlaceholderManager (v2 branch) → runDetection       │
   ├── Phase 2 (LOCKED, target hold ≤3 ms) ──────────────────────────┤
   │     acquire lock (deadline 50 ms UPS-class / 100 ms PostToolUse)│
   │        └─ deadline hit ⇒ DEGRADE: process-local v2 alloc + warn │
   │     ensure key (wx create 0600; loser reads winner's)           │
   │     re-read map → reconcile (foreign allocations win by HMAC)   │
   │     allocate new: counter++, v2 token, entry (secret ⇒ no       │
   │       original) → encrypt fresh IV → wfa write (fsync:false,    │
   │       mode 0600, ciphertext only) → release                     │
   ├── Phase 3 (LOCK-FREE) ──────────────────────────────────────────┤
   │     substituteFindings with reconciled placeholders (unchanged) │
   ▼
stdout JSON (updatedInput / updatedToolOutput — Phase 9 does NOT
change the emitted PostToolUse shape; string-form E1 verdict stands)

Lifecycle:
SessionEnd(reason)  ──► reason === 'resume' ? retain : delete KEY then MAP (swallow-and-audit)
SessionStart(any source) ──► TTL sweep (non-fatal)     ~/.mrclean/keys/<sid>.key      (0600, dir 0700)
MCP server boot          ──► TTL sweep (non-fatal)     ~/.mrclean/sessions/<sid>.map  (0600, dir 0700)
                                                       ~/.mrclean/sessions/<sid>.map.lock (transient dir)
                                                       ~/.mrclean/sessions/<sid>.map.<uuid>.tmp (ciphertext, transient)
```

### Recommended Project Structure
```
src/state/
├── index.ts          # facade: withSessionMap(sid, fn) / readSessionMap(sid) / sid validation
├── session-map.ts    # SessionMapV1 types, entry constructors (secret floor), (de)serialize + guards
├── map-store.ts      # envelope encrypt/decrypt, key ensure (wx), wfa write, paths, permissions
├── lock.ts           # proper-lockfile wrapper: config recipe + deadline-degrade semantics
└── janitor.ts        # reason-aware SessionEnd delete + TTL sweep (both call sites import this)
```
Keep `node:crypto` and proper-lockfile imports confined to `src/state/` (import-graph test; precedent: NER cold-path test discipline). Lazy `await import('../state/index.js')` behind `config.reversible.enabled` in handlers — the one-way cold path never loads it.

### Pattern 1: Envelope format (fixed offsets, validate-before-slice)

**What:** `MRCLNMAP`(8) | version `0x01`(1) | IV(12) | authTag(16) | ciphertext(N). Minimum valid length 37 bytes + nonempty ciphertext. AAD = `mrclean-map-v1:<session_id>` — a map file renamed to another session's name fails auth (verified live: wrong AAD ⇒ `final()` throws).
**When to use:** every read/write in `map-store.ts`; the decrypt path checks magic, version, and total length BEFORE slicing IV/tag (a short file must fail the length check, never produce a short tag slice — see Pitfall 1).

### Pattern 2: Two-phase transaction with reconcile (D-01/D-02 shape)

**What:** detection runs lock-free; the lock wraps only read→reconcile→allocate→encrypt→rename. Reconcile = re-read the store under the lock and adopt any concurrent process's allocation for the same HMAC key instead of burning a counter.
**When to use:** exactly one locked transaction per hook event — PreToolUse's `substituteToolInputDeep` recurses per string leaf; collect allocations across leaves, persist once.
**Measured:** full txn (no fsync) p50 0.34–1.9 ms, p95 ≤ 2.9 ms at 50–2000 entries; 16 procs × 25 txns = 400 contended cycles in 117 ms, zero timeouts at 150 ms deadline `[VERIFIED: local stress run]`.

### Pattern 3: Content-addressed allocation (D-10 mechanics)

**What:** store key = `HMAC-SHA256(hashSalt, original)` hex, where `hashSalt` is 32 random bytes generated at map creation and stored INSIDE the encrypted envelope. Lookup by HMAC; hit ⇒ return existing placeholder (any TYPE — D-10: "same original (any TYPE) → identical placeholder"); miss ⇒ `counter++`, format v2 token, insert.
**Why HMAC over plain sha256:** secret-class entries store hash-without-original; unsalted sha256 lets anyone holding a decrypted map dictionary-confirm guessed secrets/paths. Salt also kills cross-session hash correlation. The in-memory v1 manager keeps plain `sha256hex` (memory-only, unchanged).
**Collision residual (document in code + THREAT_MODEL if copy changes):** HMAC-SHA256 collision ⇒ two originals share a placeholder ⇒ wrong-value restore in Phase 10. Probability ~2⁻¹²⁸ per pair — negligible; recorded as accepted residual.

### Pattern 4: v2 token layer (D-10)

**What:** `nonce8 = randomBytes(4).toString('hex')` generated once per session at map creation, stored in the envelope. v2 format `<MRCLEAN:TYPE:NNN:nonce8>`; v2 regex `/^<MRCLEAN:([A-Z0-9_]+):(\d{3}|OVF):([a-f0-9]{8})>$/`. Overflow keeps OVF semantics: `<MRCLEAN:TYPE:OVF:nonce8>` — note multiple distinct originals of one TYPE can share an OVF token string (same as v1); the stress/plateau "distinct placeholder per entry" assertion must exempt OVF entries.
**v1 untouched:** `manager.ts` lines 94–96 and the per-process counter are not edited; the v2 path is an additive branch (hydrate/serialize seam + reversible-only formatter), gated so default construction is byte-identical.

### Pattern 5: Secret floor as a type partition (D-11)

**What:** partition the 25-entry locked vocabulary (`src/detect/type-map.ts`):
- NEVER_RESTORABLE (18): the 13 named secret TYPEs (`AWS_KEY` … `CF_KEY`), `SECRET`, `ENV`, `ENTROPY`, `PII_SSN`, `PII_CREDIT_CARD` — **plus any TYPE not in the vocabulary (unknown ⇒ secret-class, fail-toward-privacy)**.
- RESTORABLE (7): `WORD`, `PII_EMAIL`, `PII_PHONE`, `PII_IP`, `PII_PERSON`, `PII_ORG`, `PII_LOC`.
Entry construction is a discriminated union — `SecretMapEntry` has no `original` property at the type level; the serializer additionally deletes `original` for non-restorable types (defense in depth); SC3's test decrypts and asserts the PROPERTY IS ABSENT (`'original' in entry === false`), not null/empty. No config input reaches this partition in Phase 9 (narrowing knob is Phase 10+).

### Pattern 6: Janitor ordering + TTL aging (D-06/D-07)

**What:**
- SessionEnd: `reason === 'resume'` ⇒ retain; ANY other string ⇒ delete **key first, then map**. Ordering is load-bearing: key deletion makes any concurrently-recreated ciphertext permanently dead (D-05's crash story), so the janitor needs no lock.
- TTL sweep (SessionStart + MCP boot): delete (a) unpaired files (map w/o key, key w/o map) older than a short grace (recommend 60 s — see the first-allocation race in Pitfalls), (b) paired sessions whose **map mtime** exceeds `ttl_hours`, (c) stale `*.tmp` files older than grace.
- **Aging is by MAP mtime only.** The key file is written once — its mtime never refreshes. Reading D-07's "either older than TTL" literally against key mtime would delete every active session after 24 h of wall time. D-07's own intent sentence ("age by mtime refreshed on write") resolves this: only the map's mtime refreshes on write (verified live: rename-replace refreshes target mtime).
- To close the first-allocation window (key exists ms before the map), the first locked transaction writes the key AND an initial map before releasing.
**Error contract:** every janitor function is total — try/catch around each unlink/readdir, stderr JSON warn (hash-only), never throw (D-08). SessionStart/MCP-boot sweep call sites additionally wrap in try/catch so a sweep bug can never turn SessionStart into exit-2 (SessionStart's ConfigReadError rethrow contract stays untouched).

### Anti-Patterns to Avoid
- **fsync inside the lock (by default):** +6–8 ms per txn on macOS `[VERIFIED]`; wfa defaults `fsync: true` — must pass `fsync: false` explicitly.
- **`fs.mkdir(..., { recursive: true })` for locking:** recursive mkdir does NOT throw EEXIST (verified live — returns undefined) — a lock built on it is no lock. Non-recursive only (proper-lockfile does this internally).
- **Locking with proper-lockfile defaults:** default `lock(target)` throws ENOENT when the map file doesn't exist yet (verified live) and default retry timings are seconds-scale. Always pass the recipe in Code Example 3.
- **Zod in `src/state/`:** the MCP server deliberately lazy-imports zod off the CLI/hook cold path; use hand-rolled guards like `config/index.ts`'s `isRecord` pattern for map-schema validation.
- **Reusing `atomicWriteJson` for the map:** it writes plaintext JSON, no mode, no fsync option — reuse the tmp+rename *pattern*, not the function (CONTEXT code-insight already flags this).
- **Key mtime in TTL decisions / raw sid in paths / sanitize-by-transform:** see Pitfalls 4 and 5.
- **Wiring the state adapter into `src/mcp/tools/redact.ts`:** MCP lane has no CC session_id; per-call `randomUUID()` sids would spray orphan map files. Boot sweep only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-process mutex | Custom flock binding / IPC daemon | proper-lockfile (installed) or the validated mkdir loop | flock needs a native addon (breaks npx); daemon rejected by T2/Pitfall-5 record |
| Atomic replace on win32 | Custom EPERM retry loop | write-file-atomic@7 (installed) | AV-scanner rename retries + signal-exit tmp cleanup already solved |
| AEAD crypto | Any userland crypto (crypto-js, forge, tweetnacl) | `node:crypto` AES-256-GCM | OpenSSL-backed, tamper detection built in; userland crypto is pure added attack surface |
| UUID / nonces / keys | Custom randomness | `crypto.randomBytes` / `crypto.randomUUID` | CSPRNG requirement (D-04/D-10) |
| Map schema validation | New validation framework | Hand guards per `config/index.ts` precedent | Consistency + cold-path weight |

**Key insight:** the one thing that MUST be hand-built is the ~40-line deadline-degrade wrapper around the lock — no library expresses "give up after N ms and fall back to process-local allocation," and that degrade path is what keeps the hook budget safe under pathological contention.

## Common Pitfalls

### Pitfall 1: GCM tag truncation silently accepted (DEP0182 window is OPEN on Node 22)
**What goes wrong:** `createDecipheriv('aes-256-gcm', key, iv)` without options ACCEPTS truncated auth tags — verified live on Node 22.22.0: a 4-byte tag decrypted successfully; even a 12-byte tag passed. A mis-sliced envelope or an attacker-truncated tag drops forgery resistance to 2⁻³².
**Why it happens:** Node's DEP0182 is still a deprecation, not an error, at the project's Node floor.
**How to avoid:** (1) always `createDecipheriv(..., { authTagLength: 16 })` — verified: rejects a short tag immediately with `Invalid authentication tag length: 4`; (2) validate envelope total length ≥ 37 and magic/version BEFORE slicing; (3) unit test feeds a truncated-tag envelope and asserts map-treated-as-absent.
**Warning signs:** any `createDecipheriv` call without the options argument.

### Pitfall 2: fsync blows the lock-hold budget (and skipping it is safe HERE)
**What goes wrong:** the inherited "~2 ms locked step" estimate assumed no fsync. Measured on APFS: 50-entry map +fsync p50 6.0 ms; 2000-entry +fsync p50 9.0 ms; without fsync 0.3–1.9 ms. At 16-way contention, fsync-inclusive holds serialize to ~160 ms — over the UPS budget.
**How to avoid:** `fsync: false` on the wfa call. Safety argument to record in code: crash-without-OS-crash loses nothing (rename already ordered through the page cache); OS crash/power loss can lose recent writes or leave a torn file — both land in "GCM auth fails or file short ⇒ map absent ⇒ cosmetic re-redaction," which D-03 already accepts. Also note ext4's rename-over-existing implicit-flush heuristic covers the classic zero-length-file case on Linux.
**Warning signs:** perf test showing PostToolUse reversible overhead > ~15 ms p95 uncontended.

### Pitfall 3: Lock deadline vs 16-way contention math
**What goes wrong:** a 50 ms deadline with seconds-scale retry defaults (proper-lockfile's `retry` dep defaults minTimeout 1000 ms) means the FIRST retry already busts the deadline — contenders degrade instantly and SC5 "loses" entries to process-local fallback.
**How to avoid:** explicit retry recipe (Code Example 3): `{retries: 12, factor: 1.5, minTimeout: 2, maxTimeout: 10, randomize: true}` measured giving up at ~46 ms; deadline 50 ms for UPS-class, 100 ms for PostToolUse (budget 200 ms). With no-fsync holds of ~1–3 ms, 16 contenders serialize in ≪100 ms (validated: 400 contended txns in 117 ms). The SC5 harness must assert zero degrade-fallbacks occurred (count stderr warns), not just final-map integrity.
**Warning signs:** stress test passing only because degraded workers' entries weren't counted.

### Pitfall 4: TTL aging by the wrong file's mtime kills live sessions
**What goes wrong:** D-07's letter ("either older than TTL → delete") applied to the KEY file — whose mtime is fixed at creation — deletes every session older than 24 h wall-time, including active ones mid-conversation.
**How to avoid:** paired-session age = map mtime only (refreshes on every write — verified). Unpaired files use their own mtime but only against the 60 s grace + orphan rule. Accepted residual to document: a session idle past `ttl_hours` (e.g., laptop asleep 25 h) gets swept by another session's SessionStart; next activity re-creates fresh state; older transcript placeholders become permanently unrestorable — fail-toward-privacy, cosmetic.
**Warning signs:** janitor test matrix lacking a "live session, old key, fresh map survives sweep" case.

### Pitfall 5: session_id trust and path traversal
**What goes wrong:** sid comes from the hook payload and is interpolated into `~/.mrclean/keys/<sid>.key` per D-04. A hostile/companion process feeding `../../../etc/foo` as sid (or a future CC change to sid format) turns key/map/janitor paths into traversal primitives — the janitor DELETES paths derived from sid.
**How to avoid:** strict allowlist validation at the facade boundary: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` (observed sids are UUIDs — HOOK-CONTRACT E3 evidence). Non-matching ⇒ reversible unavailable for the event (one-way fallback + single stderr warn). NEVER sanitize-by-transform (collisions). Bonus: `'mcp-server'` and other synthetic ids fail the regex, structurally enforcing the MCP-lane fence.
**Warning signs:** `path.join(dir, sid + '.key')` reachable without the regex check; janitor deriving delete targets from unvalidated input.

### Pitfall 6: Probing a hostile store must never throw out of the facade
**What goes wrong:** `readSessionMap` meeting EACCES (chmod 000), EISDIR, a directory named `<sid>.map`, short/garbage envelope, valid envelope + wrong key, valid crypto + non-JSON plaintext, or valid JSON failing schema — any uncaught throw becomes exit-2 (blocking!) on PreToolUse via the fail-closed wrapper. SC5 requires: corrupt/missing/chmod'd map ⇒ output identical to one-way mode.
**How to avoid:** single `try { … } catch { return ABSENT }` policy in the read path covering fs errors, envelope validation, decrypt, parse, and schema guard; hash-only stderr warn. Write-path errors inside the transaction degrade to process-local allocation (never block). Chaos-shaped unit tests for each case land THIS phase (Phase 11 only elevates them to CI gates).
**Warning signs:** distinct error handling per failure class in the read path; any `throw` reachable from `readSessionMap`.

### Pitfall 7: Byte-identical v1 gate eroded by "harmless" edits
**What goes wrong:** touching `manager.ts`'s counter/format lines, or importing `src/state/` at module top-level in handlers, changes the one-way path (cold-start weight or behavior) and breaks the Phase 8 SC2-style regression discipline.
**How to avoid:** v2 logic behind `config.reversible.enabled` with lazy `await import()`; existing placeholder/detection/audit suites must pass with ZERO edits; add a cold-path test asserting `src/state` is not in the module graph when disabled (NER cold-path precedent).
**Warning signs:** any diff hunk in the v1 formatter; `import … from '../state/…'` (static) in `src/hook/handlers/*`.

### Pitfall 8: win32 caveats (documented gaps, not blockers)
**What goes wrong:** chmod 0600/0700 is advisory-only on win32 (existing documented gap); the win32 hook wrapper is plain-exec fail-OPEN, so an unhandled state-adapter throw exits nonzero without fail-closed semantics.
**How to avoid:** the Pitfall-6 total-error-handling policy makes hook-path throws unreachable regardless of platform; SC1's permission inspection test asserts modes on POSIX and skips mode assertions on win32 with the documented-gap comment. mkdir/wx/rename atomicity all hold on NTFS (proper-lockfile + wfa handle the win32 edges).

## Code Examples

Verified patterns — every snippet below was executed this session on Node 22.22.0.

### 1. Envelope encrypt/decrypt (authTagLength mandatory)
```typescript
// Source: Context7 /nodejs/node crypto docs + local probe (roundtrip, tamper, AAD, truncation)
const MAGIC = Buffer.from('MRCLNMAP')          // 8 bytes
const V1 = 1
const MIN_ENVELOPE = 8 + 1 + 12 + 16 + 1       // magic|ver|iv|tag|>=1 ct byte

function encryptMap(plaintext: Buffer, key: Buffer, sessionId: string): Buffer {
  const iv = randomBytes(12)                   // fresh per encryption event (D-03)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`mrclean-map-v1:${sessionId}`))
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([MAGIC, Buffer.from([V1]), iv, cipher.getAuthTag(), ct])
}

function decryptMap(envelope: Buffer, key: Buffer, sessionId: string): Buffer {
  if (envelope.length < MIN_ENVELOPE) throw new MapAbsentError('short envelope')
  if (!envelope.subarray(0, 8).equals(MAGIC) || envelope[8] !== V1) throw new MapAbsentError('bad header')
  const iv = envelope.subarray(9, 21)
  const tag = envelope.subarray(21, 37)        // always exactly 16 — length pre-validated
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 }) // DEP0182 guard
  decipher.setAAD(Buffer.from(`mrclean-map-v1:${sessionId}`))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(envelope.subarray(37)), decipher.final()]) // throws on tamper/wrong AAD
}
```

### 2. Key custody (create-once, loser-reads-winner)
```typescript
// Source: local probe — 'wx' EEXIST + mode 600 verified
await mkdir(keysDir, { recursive: true, mode: 0o700 })
try {
  await writeFile(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 })
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
}
const key = await readFile(keyPath)            // winner's bytes either way
```

### 3. Lock recipe (proper-lockfile, probed on the installed 4.1.2)
```typescript
// Source: local probe — defaults throw ENOENT on nonexistent target; this recipe gives up ~46 ms
import lockfile from 'proper-lockfile'         // CJS — default-import interop via tsup

const LOCK_OPTS = {
  realpath: false,                             // REQUIRED: map file may not exist yet (verified)
  stale: 2500,                                 // >= the 2000 ms clamp; crashed-holder recovery bound
  retries: { retries: 12, factor: 1.5, minTimeout: 2, maxTimeout: 10, randomize: true },
} as const

async function withMapLock<T>(mapPath: string, fn: () => Promise<T>): Promise<T | 'degraded'> {
  let release: (() => Promise<void>) | undefined
  try {
    release = await lockfile.lock(mapPath, LOCK_OPTS)   // ELOCKED after ~46 ms of retries
  } catch {
    return 'degraded'                          // caller falls back to process-local v2 allocation + warn
  }
  try { return await fn() } finally { await release().catch(() => {}) }
}
```
Zero-dep fallback (validated by the 16-process stress run): non-recursive `mkdirSync(lockDir)` loop, 0.5–2 ms jittered waits, wall-clock deadline, stale-break at lockdir mtime > 10 s. ~59 µs per acquire/release cycle uncontended.

### 4. SC5 stress harness shape (validated end-to-end this session)
```typescript
// Worker fixture (built as a test-only tsup entry, precedent: dist/detect-layer1 bundle):
//   argv: baseDir, workerId, goFile
//   - poll goFile (start barrier) so all 16 procs contend simultaneously
//   - allocate 20 SHARED + 5 unique originals through the real src/state facade
//   - print { workerId, results: { original -> placeholder }, degradeCount } as JSON
// Test (integration project — fileParallelism:false, 60s timeout, globalSetup builds dist):
const procs = range(16).map(i => spawn(process.execPath, [WORKER, base, String(i), goFile]))
await settleBoot(); writeFileSync(goFile, 'go')
const out = await Promise.all(collect(procs))
const map = decryptFinalMap(base)
expect(Object.keys(map.entries)).toHaveLength(20 + 16 * 5)        // zero lost
expect(distinctNnnPlaceholders(map)).toBe(entryCount(map))        // zero dups (OVF exempt)
expect(map.counter).toBe(entryCount(map))                         // counter integrity
expect(disagreements(out, SHARED)).toBe(0)                        // cross-process identity
expect(out.reduce((s, r) => s + r.degradeCount, 0)).toBe(0)       // nobody fell back
// Measured reference on dev machine: 400 contended txns, 117 ms burst, 0/0/0 failures.
```

### 5. `ttl_hours` validation (follows the shipped fail-closed pattern)
```typescript
// Source: src/config/index.ts:335-343 (validateReversibleConfig) — extend in place
if (raw['ttl_hours'] !== undefined) {
  const v = raw['ttl_hours']
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new ConfigReadError(filePath, '[reversible].ttl_hours must be an integer >= 1')
  }
}
// Layer type: MrcleanReversibleConfigLayer gains ttl_hours?: number
// mergeConfigs: per-field last-wins-when-set (08-07 conditional-spread precedent);
// DEFAULT_CONFIG.reversible gains ttl_hours: 24. NOTE: types.ts JSDoc currently says
// "Phase 9 owns store-schema fields (ttl_hours etc.)" — this is that ownership landing.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| GCM decrypt accepting any tag length | Explicit `authTagLength` required for short tags (DEP0182) | Deprecation active; enforcement pending | Node 22.22 still ACCEPTS short tags without the option — must self-enforce now |
| `write-file-atomic@^8` | Stay on `^7.0.1` | v8 engines `^22.22.2 \|\| ^24.15.0 \|\| >=26` | Floating the major silently breaks the Node 20.18 floor at install |
| ARCHITECTURE's ~2 ms locked-step estimate | ~1–3 ms **without fsync**; ~7–13 ms with | Measured this session | Deadline/budget math must use the fsync-free numbers + `fsync: false` |
| Hand-rolled lock leaning (pre-session) | proper-lockfile primary (STATE.md-pinned versions; research probes validated them transiently, install deferred to the plan's supply-chain-gated task) | 2026-07-17 | Recipe required (realpath/stale/retries); mkdir loop stays as validated fallback |

**Deprecated/outdated:** `crypto.createCipher` (IV-less — never); `keytar` (archived); `fs.watch` for coherence; `lockfile` npm package (deprecated by npm).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Linux (ext4) and win32 (NTFS) transaction latencies are comparable-or-better than the measured macOS numbers; ext4's rename-over-existing implicit flush covers the no-fsync zero-length-file case | Pitfall 2 | CI on Linux shows different lock-hold profile; deadline constants may need +margin. Mitigation: SC5 stress runs in CI on Linux and re-measures |
| A2 | Hook payload session_ids are always UUID-formatted (observed in E3 evidence; not contractually guaranteed upstream) | Pitfall 5 | A future CC sid format change makes reversible mode silently unavailable (fail-one-way, never unsafe); doctor check-8 would surface it |
| A3 | proper-lockfile's mtime-precision probe + signal-exit release behave on win32 as documented (not tested this session — macOS only) | Lock recipe | win32 lock behavior differs → SC5 gate on win32 CI (if added) flags it; mkdir fallback available |
| A4 | `retry`-package timer granularity at 2–10 ms is honored closely enough under Node event-loop load in real hook processes | Pitfall 3 | Contenders give up earlier/later than ~46 ms; stress harness asserts zero degrades, which would catch it |

All other load-bearing claims in this document are `[VERIFIED]` (live probes, installed-copy inspection, npm view, Context7) or `[CITED]` (shipped source lines, HOOK-CONTRACT.md, planning docs).

## Open Questions (RESOLVED)

1. **mrclean_status counters scope (Claude's discretion, D-11 tail)**
   - What we know: CONTEXT says "entry-count-by-class counters (never values) if in scope per plan"; the MCP server can enumerate `~/.mrclean/sessions/` and decrypt with on-disk keys.
   - What's unclear: whether counting across ALL sessions (vs none) is worth the decrypt work this phase.
   - Recommendation: minimal honest counters — session-file count + per-class entry counts for decryptable maps, computed on demand in `status.ts`; or defer entirely to Phase 10 (REVMODE-12 owns status honesty). Planner picks; neither blocks SC1–SC5.
   - **RESOLVED (plan-phase, 2026-07-17):** status counters deferred to Phase 10 (sanctioned option; no plan touches src/mcp/tools/status.ts).
2. **Deadline constants (50/100 ms) as named config-free constants**
   - What we know: measured contention envelope fits comfortably; budgets differ per event class.
   - What's unclear: exact values are judgment calls inside verified-safe ranges.
   - Recommendation: `UPPER_LOCK_DEADLINE_MS = 50` (UserPromptSubmit-class — though UPS doesn't substitute today) and `POST_LOCK_DEADLINE_MS = 100` (PreToolUse/PostToolUse) as exported constants with the benchmark numbers in a comment; tune only on perf-gate evidence.
   - **RESOLVED (plan-phase, 2026-07-17):** constants pinned in 09-05-PLAN (UPS_LOCK_DEADLINE_MS=50 / POST_LOCK_DEADLINE_MS=100, exported).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime + tests | ✓ | v22.22.0 local (floor >=20.18) | — |
| node:crypto GCM / wx / mkdir semantics | store + lock | ✓ | verified live this session | — |
| proper-lockfile | lock | ✓ installed | 4.1.2 | validated mkdir-lockdir loop |
| write-file-atomic | atomic replace | ✓ installed | 7.0.1 | inline tmp+rename (~15 LOC) |
| vitest / tsx / tsup | test harness + test-only worker entry | ✓ | 4.1.6 / 4.20 / 8.5.1 | — |
| `~/.mrclean/` | state dirs | ✓ exists (`models/` from v2) | — | dirs created 0700 on demand |
| claude CLI (live UAT) | NOT needed this phase | n/a | — | SC1–SC5 all provable without live sessions |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.6 (`@vitest/coverage-v8` 4.1.6) |
| Config file | `vitest.config.ts` — projects: `unit` (parallel), `integration` (sequential, tsup globalSetup), `uat` (opt-in, NOT used this phase) |
| Quick run command | `npx vitest run tests/state --project=unit` |
| Full suite command | `npm test` (baseline 642 passed / 14 skipped after 08-12); coverage gate `npm run test:coverage` (80/80/75/70) |
| Typecheck | differential gate vs the 36-error baseline (deferred-items.md); dist rebuild as separate chore commit |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REVMODE-02 | Envelope roundtrip; tag-truncation/tamper/wrong-AAD/short-file ⇒ absent; fresh IV per write; 0600/0700 modes; ciphertext-only incl. `*.tmp` (SC1 dir-inspection) | unit + integration | `npx vitest run tests/state/map-store.test.ts --project=unit` | ❌ Wave 0 |
| REVMODE-04 | Allocate-if-absent idempotence; reconcile-under-lock; 16-proc stress: 0 lost / 0 dups / 0 disagreements / 0 degrades (SC5) | unit + integration (spawns real processes) | `npx vitest run tests/state/stress.test.ts --project=integration` | ❌ Wave 0 |
| REVMODE-05 | v2 token format + per-session nonce; v1 suites pass with ZERO edits; cold-path test: `src/state` absent from module graph when disabled | unit | `npx vitest run tests/state/tokens-v2.test.ts tests/placeholder --project=unit` | ❌ new file Wave 0; v1 suites exist ✅ |
| REVMODE-06 | Decrypt-and-dump: secret-class entries have NO `original` property (SC3, property-absent not null); unknown TYPE ⇒ secret-class | unit | `npx vitest run tests/state/secret-floor.test.ts --project=unit` | ❌ Wave 0 |
| REVMODE-07 | Reason matrix (resume retains; clear/logout/prompt_input_exit/other/UNKNOWN delete key-then-map); TTL sweep rules (map-mtime aging, orphan grace, live-session survives, `*.tmp` cleanup); SessionEnd handler never throws; MCP-boot sweep non-fatal | unit + integration | `npx vitest run tests/state/janitor.test.ts tests/hook/session-end.test.ts --project=unit` | ❌ Wave 0 |
| (config) | `ttl_hours` fail-closed validation + 08-07 merge semantics | unit | `npx vitest run tests/config --project=unit` | ✅ extend existing |
| (doctor) | check-8 copy constants updated byte-for-byte | unit | `npx vitest run tests/doctor/checks.test.ts --project=unit` | ✅ extend existing |

Chaos-shaped cases (corrupt byte, truncate, chmod 000 [POSIX-only assert], delete-mid-session, map-is-a-directory) are UNIT tests this phase asserting one-way-identical output; Phase 11 elevates them to CI gates — build them against Phase 11's named criteria now.

### Sampling Rate
- **Per task commit:** `npx vitest run tests/state --project=unit` (< 30 s)
- **Per wave merge:** `npm test` (both unit + integration projects, includes stress)
- **Phase gate:** full suite + `npm run test:coverage` green; differential typecheck clean vs 36-error baseline; v1 byte-identical proof = zero edits to existing placeholder/detection/audit suites

### Wave 0 Gaps
- [ ] `tests/state/map-store.test.ts` — covers REVMODE-02 (envelope, custody, modes, absent-on-any-failure)
- [ ] `tests/state/allocation.test.ts` + `tests/state/stress.test.ts` + worker fixture (test-only tsup entry, `dist/detect-layer1` precedent; excluded from npm `files[]`) — covers REVMODE-04/SC5
- [ ] `tests/state/tokens-v2.test.ts` + cold-path import-graph test — covers REVMODE-05
- [ ] `tests/state/secret-floor.test.ts` — covers REVMODE-06/SC3
- [ ] `tests/state/janitor.test.ts` + `tests/hook/session-end.test.ts` — covers REVMODE-07
- [ ] Framework install: none (vitest/tsx/tsup present)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no auth surface; key custody is file-permission based per D-04/D-05) |
| V3 Session Management | yes | Session-scoped state keyed by validated sid; lifecycle = reason allowlist + TTL sweep (D-06/D-07) |
| V4 Access Control | yes | 0700 dirs / 0600 files, key and ciphertext in separate dirs, never project tree (win32 advisory-only — documented gap) |
| V5 Input Validation | yes | sid UUID regex at facade boundary; envelope magic/version/length pre-validation; hand-guard map schema; `ttl_hours` fail-closed ConfigReadError |
| V6 Cryptography | yes | `node:crypto` AES-256-GCM only — never hand-roll; fresh 12-byte IV per event; `authTagLength: 16` explicit; AAD binds sid; CSPRNG keys/nonce/salt; no KDF (random IKM, D-05) |

### Known Threat Patterns for this store

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Auth-tag truncation (DEP0182) | Tampering | Explicit `authTagLength: 16` + envelope length check (verified live) |
| Map-file swap between sessions | Spoofing | AAD = `mrclean-map-v1:<sid>` — wrong AAD throws (verified live) |
| sid-driven path traversal (incl. janitor deletes) | Elevation | Strict UUID allowlist regex; reject ⇒ one-way fallback |
| Planted-token enumeration | Information disclosure | Per-session CSPRNG nonce8 in every v2 token (D-10) |
| Hash-based guess confirmation from a leaked decrypted map | Information disclosure | HMAC-SHA256 with per-session random salt inside the envelope |
| Plaintext in temp files / crash artifacts | Information disclosure | Encrypt-before-any-write; wfa receives ciphertext only; sweep removes stale `*.tmp`; SC1 inspection test |
| Restore-error/log value leakage | Information disclosure | Hash-only stderr/audit discipline (existing `sanitizeForOutput` chokepoint precedent); no `original` in any thrown message |
| Nonce reuse across rewrites | Tampering/Crypto break | Fresh `randomBytes(12)` IV per encryption event — never stored/reused (D-03) |
| Key beside ciphertext | Information disclosure | Separate `keys/` vs `sessions/` dirs (D-04); THREAT_MODEL honesty already drafted in Phase 8 |

## Sources

### Primary (HIGH confidence)
- Live probes this session, Node v22.22.0 / macOS (Darwin 24.6.0) / APFS: GCM roundtrip + tamper + AAD rejection; **truncated-tag acceptance without `authTagLength` and rejection with it**; `wx` EEXIST + mode 600; non-recursive mkdir EEXIST vs recursive silent-success; 0700 dir mode under umask 022; `filehandle.sync()`; rename-over-existing + mtime refresh; lock-cycle microbench (59 µs mkdir / 51 µs wx); full-transaction bench (fsync vs not, 50–2000 entries); **16-process stress: 400 contended txns, 117 ms, 0 lost / 0 dups / 0 disagreements / 0 timeouts**; proper-lockfile 4.1.2 installed-copy probes (ENOENT default, `realpath:false`, ~46 ms tight-retry giveup, stale clamp)
- Context7 `/nodejs/node` — `createDecipheriv` authTagLength semantics, DEP0182, setAuthTag/setAAD contracts
- `npm view` (2026-07-17) — proper-lockfile 4.1.2 (deps, no postinstall), write-file-atomic 7.0.1 engines, @types/proper-lockfile 4.1.4; slopcheck [OK] × 3
- Shipped source (read this session): `src/placeholder/manager.ts`, `src/config/index.ts` (validateReversibleConfig + merge), `src/hook/{dispatcher,handlers/{session-end,session-start,pre-tool-use,post-tool-use,user-prompt-submit}}.ts`, `src/install/atomic-json.ts`, `src/mcp/server.ts`, `src/doctor/checks.ts:548-596`, `src/detect/{index,type-map}.ts`, `src/shared/types.ts`, `vitest.config.ts`, `package.json`
- `docs/HOOK-CONTRACT.md` (E1–E5, CC 2.1.209 stamps) — E3 sid continuity (retain-on-resume real), E5 headless SessionEnd absence (TTL sweep mandatory), E4 no 10K cap at ~15K

### Secondary (MEDIUM confidence)
- `.planning/research/{SUMMARY,ARCHITECTURE,STACK,PITFALLS}.md` (2026-07-14) — converged invariants restated here; the ~2 ms txn estimate CORRECTED by this session's fsync measurements
- ext4 rename-over-existing implicit-flush heuristic (auto_da_alloc) — training knowledge, consistent with the fail-safe design either way

### Tertiary (LOW confidence)
- win32 behavior of proper-lockfile mtime probing / signal-exit release — not tested this session (Assumption A3)

## Metadata

**Confidence breakdown:**
- Crypto/store mechanics: HIGH — every claim executed live or Context7-confirmed
- Lock primitive + contention math: HIGH on macOS (measured); MEDIUM on Linux/win32 (A1/A3 — CI stress re-measures)
- Janitor semantics: HIGH — D-06/D-07 pins + shipped handler contracts; the key-mtime trap resolved from D-07's own intent language
- Integration points: HIGH — all read from shipped source this session

**Research date:** 2026-07-17
**Valid until:** ~2026-08-17 (stable stdlib domain; re-check only on Node floor change or a Claude Code hook-contract bump)
