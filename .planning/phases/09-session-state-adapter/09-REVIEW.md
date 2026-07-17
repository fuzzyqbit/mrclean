---
phase: 09-session-state-adapter
reviewed: 2026-07-17T04:29:50Z
depth: standard
files_reviewed: 35
files_reviewed_list:
  - src/config/defaults.ts
  - src/config/index.ts
  - src/detect/index.ts
  - src/doctor/checks.ts
  - src/hook/handlers/post-tool-use.ts
  - src/hook/handlers/pre-tool-use.ts
  - src/hook/handlers/session-end.ts
  - src/hook/handlers/session-start.ts
  - src/mcp/server.ts
  - src/placeholder/manager.ts
  - src/shared/types.ts
  - src/state/index.ts
  - src/state/janitor.ts
  - src/state/lock.ts
  - src/state/map-store.ts
  - src/state/session-map.ts
  - src/types/write-file-atomic.d.ts
  - tests/config/merge.test.ts
  - tests/config/reader.test.ts
  - tests/doctor/checks.test.ts
  - tests/hook/dispatcher.test.ts
  - tests/hook/handlers.test.ts
  - tests/hook/reversible-handlers.test.ts
  - tests/hook/session-end.test.ts
  - tests/state/allocation.test.ts
  - tests/state/chaos.test.ts
  - tests/state/cold-path.test.ts
  - tests/state/fixtures/stress-worker.ts
  - tests/state/inspection.test.ts
  - tests/state/janitor.test.ts
  - tests/state/lock.test.ts
  - tests/state/map-store.test.ts
  - tests/state/secret-floor.test.ts
  - tests/state/stress.test.ts
  - tests/state/tokens-v2.test.ts
findings:
  critical: 1
  warning: 4
  info: 5
  total: 10
status: issues_found
---

# Phase 9: Code Review Report — Session State Adapter

**Reviewed:** 2026-07-17T04:29:50Z
**Depth:** standard
**Files Reviewed:** 35
**Status:** issues_found

## Summary

Reviewed the Phase 9 reversible-mode session state adapter: AES-256-GCM envelope store, per-session key custody, proper-lockfile mutual exclusion with deadline degrade, content-addressed allocation with reconcile renames, v2 tokens, structural secret floor, and the reason-aware janitor, plus the hook-handler wiring and the full new test surface.

**Verified sound (focus areas from the review brief):**

- **Crypto envelope** — fresh CSPRNG 12-byte IV per encryption event (per-session keys, well under GCM random-IV bounds); total-length/magic/version validated before any slice; explicit `authTagLength: 16` closes the DEP0182 truncated-tag window; AAD binds the session id (spoof/copy fence proven by tests). No IV reuse, no tag-handling gap found.
- **sid path-traversal fence** — every fs path interpolation site was traced: `keyPathFor`/`mapPathFor` are only reached via the facade (validates sid twice: handler gate + facade re-check), the SessionEnd janitor (validates before path derivation), or the TTL sweep (derives sids exclusively from `SESSION_ID_RE`-matched directory-listing names, which cannot contain separators). Fence is complete.
- **Secret floor** — `makeMapEntry` construction floor, `toPersistableEntry` write-time strip, and `parseMapEntry` read-side drop form three independent layers; no path was found where a secret-class original reaches a serializer, disk, stderr, or the hydration payload. Stress test exercises the floor under contention.
- **Lock correctness** — deadline math is bounded (single deadline promise armed once, timer cleared in `finally`, late-acquire released, ELOCKED re-arm capped by wall clock, non-transient codes degrade immediately, `fn` errors release then propagate to the facade's catch). Stale-holder recovery via `stale: 2500` is sound for 1-3 ms holds.
- **Fail-one-way discipline** — all state access sits behind `config.reversible.enabled` gates plus per-block try/catch walls; the read path is total; the write path degrades with one hash-only warn; no new exit-2 surface found. The one-way default is protected by the cold-path import fence test, the chaos parity suite, and the v1 token-format tests.

**One critical defect was found and confirmed with a live repro:** sequential rename application corrupts placeholder identity whenever reconcile produces a rename chain (routine under the concurrent multi-allocation conditions reversible mode is built for). Details below, plus four warnings and five informational items.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Sequential rename application corrupts placeholder identity on reconcile rename chains (wrong-value restore + duplicate on-wire tokens)

**File:** `src/state/index.ts:294-300` (`applyRenamesToText`; `applyRenamesDeep` delegates to it via `renameDeep`), produced by `reconcilePending` at `src/state/index.ts:200-214`; consumed at `src/hook/handlers/post-tool-use.ts:184` and `src/hook/handlers/pre-tool-use.ts:288`.

**Issue:** `applyRenamesToText` applies renames **sequentially** (`result.split(from).join(to)` per rename). `reconcilePending` emits renames in pending order with strictly increasing counters, so whenever the store counter advanced between hydrate and persist (a concurrent process persisted first) and the event allocated **two or more** new values, rename *i*'s `to` token equals rename *i+1*'s `from` token (both carry the same store nonce). The earlier rename rewrites token A into token B, and the later rename then rewrites **both** the legitimate B occurrences and the just-renamed A occurrences into C.

Confirmed with a live repro against the real modules (tmp baseDir):

```
B provisionals: ['<MRCLEAN:WORD:006:939ff7d7>', '<MRCLEAN:WORD:007:939ff7d7>']
renames: [{from: :006:, to: :007:}, {from: :007:, to: :008:}]
B text before: y=<MRCLEAN:WORD:006:939ff7d7> z=<MRCLEAN:WORD:007:939ff7d7>
B text after : y=<MRCLEAN:WORD:008:939ff7d7> z=<MRCLEAN:WORD:008:939ff7d7>   <-- both :008:
store says Y = <MRCLEAN:WORD:007:939ff7d7>
store says Z = <MRCLEAN:WORD:008:939ff7d7>
```

Consequences:

1. Two distinct originals share one on-wire token for the event — the collision-free placeholder guarantee (PH-03) is broken on the emitted payload.
2. The store maps `:007:` to Y, but `:007:` never appears in the emitted text; every position where Y's value was redacted now carries Z's token. A Phase 10 `mrclean restore` would substitute **Z's original where Y's was** — a wrong-value restore, which is exactly the integrity failure the reconcile/rename machinery exists to prevent.
3. No raw secret is exposed (both tokens are placeholder-shaped), so confidentiality holds — this is a correctness/integrity blocker, not a leak.

Reachability: requires only (a) hydration from a real map (shared nonce), (b) a concurrent persist advancing the counter between the lock-free hydrate and the locked persist, and (c) ≥ 2 new allocations in one event. Claude Code issues parallel tool calls in a single session as normal behavior, so two PreToolUse/PostToolUse hooks for the same session routinely race. Neither the stress suite (one allocation per transaction — at most one rename per persist, chains impossible) nor `allocation.test.ts` (single-pending renumber case) exercises multi-pending renames, which is why every gate passed.

**Fix:** Apply all renames in a **single simultaneous pass** so a rename output can never be re-matched by a later rename:

```ts
export function applyRenamesToText(text: string, renames: PlaceholderRename[]): string {
  if (renames.length === 0) return text
  const byFrom = new Map(renames.map((r) => [r.from, r.to]))
  const pattern = [...byFrom.keys()]
    .map((from) => from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  return text.replace(new RegExp(pattern, 'g'), (match) => byFrom.get(match) ?? match)
}
```

(`applyRenamesDeep` is fixed for free since `renameDeep` delegates per string leaf.) Add a regression test: two pending allocations + one foreign insertion between hydrate and persist, asserting each emitted token equals the store's authoritative placeholder for its original — the exact repro above.

## Warnings

### WR-01: TTL sweep's `*.tmp` cleanup targets a filename shape write-file-atomic never produces; real crashed-write litter and stale lock dirs are never swept, while foreign `.tmp` files ARE deleted

**File:** `src/state/janitor.ts:213-217` (classification), `src/state/janitor.ts:296-303` (deletion loop); claims at `janitor.ts:29-31` and `tests/state/inspection.test.ts:15-16`.

**Issue:** write-file-atomic v7 names its temp files `<target>.<uint32>` (verified in `node_modules/write-file-atomic/lib/index.js` `getTmpname`: `filename + '.' + sha1(...).readUInt32BE(0)`), e.g. `e58035fe-….map.2895626606` — never `*.tmp`. Consequences:

1. The "crashed atomic writes" cleanup path is dead code: after SIGKILL/OOM/power loss (signal-exit only covers catchable exits), `<sid>.map.<digits>` files accumulate in `sessions/` forever. They fail both the `.tmp` filter and `sidFromName(name, '.map')`, so T-09-06-06 protects them indefinitely. (Content is ciphertext — the plaintext-never-touches-disk property holds — so this is hygiene/claimed-behavior drift, not a leak.)
2. proper-lockfile's artifact is a `<sid>.map.lock` **directory**; a SIGKILL'd holder that never persists again leaves it forever (stale-takeover only fires when someone re-contends that map).
3. Inverted invariant: the `name.endsWith('.tmp')` rule deletes **any** `.tmp` file in `sessions/`, including foreign files mrclean provably did NOT create — contradicting the "only filenames we provably created" contract the same function documents (the foreign-files test uses `README.md`/`notauuid.map` but never a bare `foo.tmp`, so this went unnoticed).

**Fix:** Replace the `.tmp` rule with the shapes the stack actually produces: sweep `^<uuid>\.map\.\d+$` files (wfa litter) and optionally `^<uuid>\.map\.lock$` directories older than the grace; drop the generic `*.tmp` match entirely. Update the janitor header comment and the inspection-test comment to the real naming.

### WR-02: Residual encrypted state is never swept once the operator disables reversible mode

**File:** `src/hook/handlers/session-start.ts:37-44`, `src/mcp/server.ts:91-98`.

**Issue:** Both TTL-sweep call sites are gated on `config.reversible.enabled`. The SessionEnd janitor only deletes the **ending** session's pair. So the crash-recovery story has a hole: run reversible for a while, a session crashes (no SessionEnd), then the operator turns `[reversible]` off — the crashed session's key+map (locally decryptable originals for restorable types) rest on disk **indefinitely**, with no code path left that will ever remove them. This runs against the project constraint that persisted state "must be … removed on session exit" and the phase's own fail-toward-privacy posture (D-06/D-07).

**Fix:** Run `runTtlSweep` unconditionally at SessionStart/MCP boot (it is already total-error and a silent no-op when `keys/`/`sessions/` don't exist — the disabled-default cost is two ENOENT readdirs), or gate it on "state dirs exist" instead of the config flag. Note the config gate is also what keeps the sweep's lazy `import('../../state/janitor.js')` off the one-way path — if preserving that matters, probe for the dirs' existence before importing.

### WR-03: `ensureSessionKey` never validates key length; a torn key write permanently degrades the session until the 24 h TTL sweep

**File:** `src/state/map-store.ts:185-198`.

**Issue:** Key creation is `writeFile(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 })` — create-then-write, **not atomic** (unlike the map, which goes through write-file-atomic). Two windows produce a short/empty key file: (a) crash between open and write completion leaves 0..31 bytes forever; (b) an EEXIST loser can `readFile` between the winner's open and write and observe partial bytes (transient). The read-back at line 197 returns whatever bytes exist, unvalidated. AES-256-GCM then throws `ERR_CRYPTO_INVALID_KEYLEN` on every encrypt/decrypt, so behavior is safe (hydration → fresh provisional; persist → `degraded`; chaos case (f) proves one-way parity holds) — but a **permanently** torn key means: one `persist degraded` stderr warn per event, zero persistence, per-event re-redaction, and no self-heal until the paired TTL sweep deletes the pair ~`ttl_hours` (default 24 h) later. There is also no 32-byte check on the winner-read path, so any locally corrupted key silently produces the same long-lived degraded state.

**Fix:** Validate `key.length === KEY_BYTES` after read; on mismatch throw a typed error (write path already degrades) and/or self-heal: for a provably invalid key file, unlink-and-retry the `wx` create exactly once inside the locked transaction (the lock serializes contenders, so the recreate race is closed there). Writing the key via temp+rename would eliminate the torn-write window entirely.

### WR-04: chaos parity suite stubs `HOME`, which `os.homedir()` ignores on win32 — the enabled run would hit the REAL user home on Windows

**File:** `tests/state/chaos.test.ts:162-203` (`makeHome` + `vi.stubEnv('HOME', …)`); only case (c) at line 244 is win32-skipped.

**Issue:** On Windows, `os.homedir()` resolves `USERPROFILE`, not `HOME`, so cases (a), (b), (d), (e), (f) would run `handlePostToolUse` against the developer's real home: `loadEffectiveConfig` reads the real `~/.mrclean/config.toml`. If that config leaves reversible off, the non-vacuity assertion (`V2_TAIL_PROBE`) fails the suite; if the real config enables reversible, the test **writes key/map state for throwaway sids into the real `~/.mrclean`** (cleaned only by that machine's own TTL sweep). Either way the suite is unreliable/unsafe on win32, unlike the rest of the state tests, which consistently `skipIf(IS_WIN32)` where platform behavior diverges.

**Fix:** Gate the whole suite (or `assertParity`) with `skipIf(IS_WIN32)` and a documented-gap note, or stub `USERPROFILE` alongside `HOME`.

## Info

### IN-01: Parsed-entry record is vulnerable to `__proto__` key shenanigans (defense-in-depth only)

**File:** `src/state/session-map.ts:252-257` (`parseSessionMap` entry loop).

**Issue:** `entries[key] = entry` on a plain object: a stored key named `__proto__` (only plantable by someone already holding the session key, i.e. the local user) would invoke the inherited setter — silently re-parenting the record and dropping the entry instead of storing it. All downstream iteration is `Object.entries` (own props), so impact is entry-loss, not pollution of `Object.prototype`. Still, the writer can never produce non-hex keys, so a stricter parser is cheap hardening.

**Fix:** Build entries with `Object.create(null)`, or reject keys failing `/^[a-f0-9]{64}$/` (the only shape `hmacAddress` emits).

### IN-02: "EXACTLY ONE dynamic import site" comment is inaccurate — handlers use two; the deadline constant belongs on the facade

**File:** `src/hook/handlers/pre-tool-use.ts:46-48,187-193`; `src/hook/handlers/post-tool-use.ts:39-43,101-108`.

**Issue:** Both substitution handlers document "the whole event uses EXACTLY ONE dynamic import site" but perform two (`../../state/index.js` and `../../state/lock.js` for `POST_LOCK_DEADLINE_MS`); the cold-path fence test consequently has to pin two counts per handler.

**Fix:** Re-export `POST_LOCK_DEADLINE_MS` (and `UPS_LOCK_DEADLINE_MS`) from `src/state/index.ts` — one facade import per handler, comment becomes true, fence shrinks.

### IN-03: `withMapLock`'s `T | 'degraded'` string sentinel is collision-prone as a generic API

**File:** `src/state/lock.ts:168-183`.

**Issue:** If any future transaction legitimately resolves the string `'degraded'`, it is indistinguishable from lock-acquisition degrade. The sole current caller returns `PlaceholderRename[]`, so behavior today is correct.

**Fix:** Return a discriminated object (`{ ok: true, value } | { ok: false }`) or a module-private `Symbol` sentinel.

### IN-04: MCP server resolves home inconsistently (`process.env['HOME'] ?? cwd` vs `os.homedir()`) — pre-existing

**File:** `src/mcp/server.ts:100-105`.

**Issue:** `initSessionState` uses `process.env['HOME'] ?? cwd` while `loadEffectiveConfig` (line 85) and the new boot-time TTL sweep default to `os.homedir()`. On Windows (`HOME` typically unset) the session state roots at `cwd`, diverging from the config/janitor home. Pre-existing line, but the Phase 9 sweep added a third home-resolution path to the same function, making the inconsistency load-bearing to notice.

**Fix:** Use `homedir()` for all three.

### IN-05: SessionEnd janitor statically pulls `map-store.ts` (write-file-atomic + cipher code) into every session end, including one-way sessions

**File:** `src/state/janitor.ts:44`.

**Issue:** The janitor runs config-free (by design), and it statically imports `keyPathFor`/`mapPathFor`/`statePaths` from `map-store.ts`, whose module load also initializes `write-file-atomic` (and the cipher-bearing module scope). One-way-default sessions therefore load the storage stack at every SessionEnd just to attempt two ENOENT unlinks. Not a correctness issue (SessionEnd is not latency-sensitive and output is ignored upstream), but it dilutes the "state runtime stays off the one-way path" story.

**Fix:** Extract the three path helpers into a leaf module (e.g. `src/state/paths.ts`) imported by both `map-store.ts` and `janitor.ts`.

---

_Reviewed: 2026-07-17T04:29:50Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
