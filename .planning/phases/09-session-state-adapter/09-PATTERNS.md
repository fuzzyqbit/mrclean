# Phase 9: Session State Adapter - Pattern Map

**Mapped:** 2026-07-16
**Files analyzed:** 14 source files to create/modify + 9 test surfaces
**Analogs found:** 19 / 23 (4 surfaces have no codebase analog — use RESEARCH.md verified code examples)

**Module home:** `src/state/` (per 09-RESEARCH §Recommended Project Structure — NOT `src/session/`; note `src/detect/session-state.ts` already exists for a different concern: per-event env/words caching. Do not collide names.)

**Verified repo facts that override stale doc claims:**
- `package.json` does NOT contain `proper-lockfile`, `write-file-atomic`, or `@types/proper-lockfile` (research installs were reverted). The plan MUST carry an explicit install task: `proper-lockfile@^4.1.2` + `write-file-atomic@^7.0.1` (PIN — never float to ^8, breaks Node 20 floor) in `dependencies`, `@types/proper-lockfile@^4.1.4` in `devDependencies`, each with a supply-chain threat (T-SC) disposition row.
- No 0600/0700 file-mode precedent exists in `src/` (only `mode: 0o644` writeFile in `src/install/{project-dir,init-project}.ts`). Key/map permission handling is NEW — copy RESEARCH Code Example 2, not codebase code.
- No `node:crypto` cipher usage exists in `src/` (only `createHash` in `src/detect/findings.ts` and `randomUUID` in `src/install/atomic-json.ts`). The GCM envelope is NEW — copy RESEARCH Code Example 1.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/state/index.ts` (new) | service facade | request-response | `src/detect/session-state.ts` | role-match |
| `src/state/session-map.ts` (new) | model (types + guards + constructors) | transform | `src/shared/types.ts` + `src/config/index.ts` hand guards | role-match |
| `src/state/map-store.ts` (new) | service | file-I/O | `src/install/atomic-json.ts` (rename pattern ONLY) | partial |
| `src/state/lock.ts` (new) | utility | file-I/O | none — RESEARCH Code Example 3 | none |
| `src/state/janitor.ts` (new) | service | batch / file-I/O | `src/install/atomic-json.ts` (readdir scan) + stderr-warn discipline | partial |
| `src/placeholder/manager.ts` (modify) | service | transform | itself — v1 path lines 79–112 stay byte-identical | exact |
| `src/hook/handlers/session-end.ts` (replace body) | controller | event-driven | `src/hook/handlers/post-tool-use.ts` (swallow + stderr JSON warn) | role-match |
| `src/hook/handlers/session-start.ts` (add sweep call) | controller | event-driven | itself | exact |
| `src/hook/handlers/pre-tool-use.ts` (reversible branch) | controller | request-response | itself + lazy-import fence from `src/mcp/server.ts` | exact |
| `src/hook/handlers/post-tool-use.ts` (reversible branch) | controller | request-response | itself | exact |
| `src/config/index.ts` (widen `[reversible]`) | config | transform | `validatePiiNerConfig` + `validateReversibleConfig` in same file | exact |
| `src/config/defaults.ts` (add `ttl_hours: 24`) | config | — | itself lines 70–72 | exact |
| `src/shared/types.ts` (widen reversible types) | model | — | itself lines 354–372 | exact |
| `src/mcp/server.ts` (boot sweep) | service | event-driven | itself (lazy import + non-fatal degrade) | exact |
| `src/doctor/checks.ts` (check-8 copy) | service | request-response | itself lines 548–597 | exact |
| `src/mcp/tools/status.ts` (optional counters) | service | request-response | itself | exact |
| `package.json` (dep install) | config | — | n/a — explicit install task | n/a |
| `tsup.config.ts` (stress worker entry) | config | — | `detect-layer1` test-only entry | exact |
| `vitest.config.ts` (stress → integration project) | config | — | `tests/audit/pii-canary-leak.test.ts` dual exclude/include dance | exact |
| `tests/state/*.test.ts` (new suites) | test | — | `tests/config/{reader,merge}.test.ts` AAA + tmpdir fixtures | role-match |
| `tests/state/` cold-path import-graph test (new) | test | — | `tests/detect/ner-unreachable.test.ts` | exact |
| `tests/hook/session-end.test.ts` (new) | test | — | `tests/hook/handlers.test.ts` vi.mock seam | exact |
| `tests/state/stress.test.ts` + worker fixture (new) | test | — | `tests/hook/integration-detection.globalSetup.ts` + tsup entry | partial |

## Pattern Assignments

### `src/state/index.ts` — facade (service, request-response)

**Analog:** `src/detect/session-state.ts` — the existing "session-scoped state with module facade" module.

**Facade + cache shape** (`src/detect/session-state.ts:62-87`):
```typescript
let cachedSessionState: SessionState | null = null

export function getCachedSessionState(sessionId: string): SessionState | null {
  if (cachedSessionState !== null && cachedSessionState.sessionId === sessionId) {
    return cachedSessionState
  }
  return null
}

export function setCachedSessionState(state: SessionState): void {
  cachedSessionState = state
}
```
Copy the shape: narrow exported surface (`withSessionMap(sid, fn)` / `readSessionMap(sid)`), options-object params, JSDoc stating ownership and who consumes it (`session-state.ts:1-20` header style).

**sid validation at the boundary** (Pitfall 5): strict UUID regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` at the single entry point; non-matching sid ⇒ reversible unavailable (one-way fallback + single stderr warn). Note `src/mcp/server.ts:87` passes `sessionId: 'mcp-server'` — it fails the regex, structurally enforcing the MCP-lane fence (do NOT wire `src/mcp/tools/redact.ts` to the store).

**Total read-path error policy** (Pitfall 6) — copy the absent-on-error semantics from `src/install/atomic-json.ts:20-31` but widen the catch to ALL errors, not just ENOENT:
```typescript
// atomic-json.ts readJsonOrEmpty: ENOENT → {} ... state read path must instead be:
// try { ...fs + envelope validation + decrypt + parse + schema guard... } catch { return ABSENT }
// ANY failure class (EACCES/EISDIR/short envelope/GCM tag fail/bad JSON/bad schema) ⇒ map ABSENT
```
No `throw` may be reachable from `readSessionMap` — an uncaught throw becomes exit-2 (blocking) on PreToolUse via `installCrashGuards` (`src/hook/failclosed.ts:65-78`).

---

### `src/state/session-map.ts` — schema + secret floor (model, transform)

**Analogs:** `src/shared/types.ts` (interface conventions), `src/config/index.ts:66-72` (hand guards — NO zod in `src/state/`, matching the cold-path discipline), `src/detect/type-map.ts` (the partition source).

**Hand-guard pattern to copy** (`src/config/index.ts:66-72`):
```typescript
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string')
}
```

**Secret-floor partition source** (`src/detect/type-map.ts:37-66`) — the frozen 25-entry `TYPE_VOCABULARY`:
- NEVER_RESTORABLE (18): `AWS_KEY, AWS_SECRET, GH_TOKEN, JWT, STRIPE_KEY, OPENAI_KEY, ANTHROPIC_KEY, PRIVATE_KEY, SLACK_TOKEN, GCP_KEY, DATABRICKS_KEY, AZURE_KEY, CF_KEY` + `SECRET` + `ENV` + `ENTROPY` + `PII_SSN` + `PII_CREDIT_CARD` — PLUS any TYPE not in the vocabulary (unknown ⇒ secret-class, mirrors `getTypeForRuleId`'s `?? 'SECRET'` fallback at `type-map.ts:230-235`).
- RESTORABLE (7): `WORD, PII_EMAIL, PII_PHONE, PII_IP, PII_PERSON, PII_ORG, PII_LOC`.

Follow the `Object.freeze([...] as const)` idiom from `type-map.ts:37` for the partition constants and the "add TYPE here first" JSDoc discipline (`type-map.ts:8-16`).

**Discriminated union with structurally-absent field** — precedent for entry shape is `PlaceholderEntry` (`src/placeholder/manager.ts:30-36`: `{type, index, firstSeenTs, placeholder, hash}`). `SecretMapEntry` must have NO `original` property at the type level; serializer additionally deletes `original` for non-restorable types (defense in depth). SC3 test asserts `'original' in entry === false` (property absent, never null/empty).

---

### `src/state/map-store.ts` — envelope crypto + key custody + atomic write (service, file-I/O)

**Analog (partial):** `src/install/atomic-json.ts:44-62` — copy the tmp-in-same-dir + rename + cleanup-on-failure PATTERN, never the function (it writes plaintext, no mode, no fsync control):
```typescript
// atomic-json.ts:44-62 — the shape to mirror (with write-file-atomic doing the heavy lifting):
const tmpPath = join(dir, `.mrclean-tmp-${randomUUID()}.json`)
await mkdir(dir, { recursive: true })
try {
  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmpPath, path)
} catch (err) {
  try { await unlink(tmpPath) } catch { /* ignore cleanup errors */ }
  throw err
}
```
Phase 9 replaces the inner write with `write-file-atomic` called with **ciphertext-only input**, `{ fsync: false, mode: 0o600 }` (Pitfall 2: fsync = +6–8 ms inside the lock; wfa defaults `fsync: true` — must override).

**No codebase analog for the crypto** — copy RESEARCH Code Example 1 verbatim (verified live on Node 22.22.0): `MRCLNMAP`(8) | `0x01`(1) | IV(12) | tag(16) | ct(N); `createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })` MANDATORY (DEP0182: short tags silently accepted without it); AAD = `mrclean-map-v1:<session_id>`; validate magic/version/length ≥ 37 BEFORE slicing.

**No codebase analog for key custody** — copy RESEARCH Code Example 2 (`wx` create-once, loser-reads-winner, `mode: 0o600` file / `0o700` dirs). Document win32 advisory-only modes per Pitfall 8 (existing documented gap).

**Hash import seam:** `src/detect/findings.ts:63` exports `sha256hex` — the in-memory v1 manager keeps using it UNCHANGED. Store-side content addressing is HMAC-SHA256 with a per-session random salt stored inside the envelope (RESEARCH Pattern 3) — implement in map-store/session-map, do NOT modify `findings.ts`.

**Import fence:** `node:crypto` cipher APIs and `proper-lockfile` imports confined to `src/state/` (enforced by the new import-graph test, see test section).

---

### `src/state/lock.ts` — deadline-degrade lock wrapper (utility, file-I/O)

**Analog:** none in codebase. Copy RESEARCH Code Example 3 (probed on installed 4.1.2):
```typescript
import lockfile from 'proper-lockfile'         // CJS — default-import interop via tsup

const LOCK_OPTS = {
  realpath: false,   // REQUIRED: map file may not exist yet (default throws ENOENT — verified)
  stale: 2500,
  retries: { retries: 12, factor: 1.5, minTimeout: 2, maxTimeout: 10, randomize: true },
} as const
```
Named constants per user coding style: `UPS_LOCK_DEADLINE_MS = 50`, `POST_LOCK_DEADLINE_MS = 100` — exported, with the benchmark numbers in a comment (RESEARCH Open Question 2 recommendation).

**Degrade semantics analog** — the "fail to a lesser mode, warn once, never block" shape is `startNerPreload` (`src/mcp/server.ts:56-69`):
```typescript
void (async () => {
  try { /* ... */ nerStatus = 'ready' }
  catch {
    nerStatus = 'unavailable'
    process.stderr.write('mrclean-mcp: NER unavailable; serving secrets only\n')
  }
})()
```
Lock deadline hit ⇒ return `'degraded'` ⇒ caller falls back to process-local v2 allocation + single hash-only stderr warn. Never throw out of the wrapper; `release().catch(() => {})` in finally.

---

### `src/state/janitor.ts` — reason-aware delete + TTL sweep (service, batch)

**Analog (partial):** `src/install/atomic-json.ts:89-107` (`listMrcleanBackups`) for the readdir + prefix-filter + mtime-ordering scan shape:
```typescript
const entries = await readdir(dir)
const backups = entries.filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
```

**Janitor rules (from D-06/D-07 + RESEARCH Pattern 6 — restated as build contract):**
- SessionEnd: `reason === 'resume'` ⇒ retain; ANY other string (open set) ⇒ delete **key first, then map** (ordering is load-bearing — dead ciphertext needs no lock).
- TTL sweep: unpaired files (map w/o key, key w/o map) older than 60 s grace ⇒ delete; paired sessions aged by **map mtime ONLY** (key mtime never refreshes — aging by it would kill every live session at 24 h); stale `*.tmp` older than grace ⇒ delete.
- Every janitor function is total: try/catch per unlink/readdir, never throw.

**Structured stderr warn pattern to copy** (`src/hook/handlers/post-tool-use.ts:84-89` — also `src/placeholder/manager.ts:83-91`):
```typescript
process.stderr.write(
  JSON.stringify({
    warn: 'mrclean detection budget exhausted on PostToolUse',
    sessionId: input.session_id,
  }) + '\n',
)
```
Single-line JSON, hash-only fields, never raw values or paths-with-originals.

---

### `src/placeholder/manager.ts` — v2 token layer (modify; v1 byte-identical)

**Analog:** itself. The v1 formatter + counter (`manager.ts:77-97`) is the DO-NOT-TOUCH zone:
```typescript
this.counter++
// ...overflow warn at 82-92...
placeholder = `<MRCLEAN:${type}:OVF>`                                  // line 94
} else {
placeholder = `<MRCLEAN:${type}:${String(this.counter).padStart(3, '0')}>`  // line 96
```
Zero diff hunks in these lines (Pitfall 7). Existing suite `tests/placeholder/manager.test.ts` (110 lines) must pass with ZERO edits — that is the byte-identical proof.

**Load-bearing design constraint discovered reading the analog:** `allocate()` is SYNCHRONOUS and called from inside `runDetection`'s substitution path. The async store I/O therefore CANNOT live inside `allocate()`. The v2 layer must follow RESEARCH's two-phase shape: hydrate the manager from the decrypted map BEFORE detection (lock-free), allocate synchronously against hydrated state during detection, then reconcile+persist ONCE under the lock after detection (foreign allocations win by HMAC key; adopt theirs instead of burning a counter). The hydrate/serialize seam is the additive branch — e.g. a constructor option or hydrate method gated on reversible mode, leaving default construction byte-identical.

**v2 format:** `<MRCLEAN:TYPE:NNN:nonce8>`, `nonce8 = randomBytes(4).toString('hex')` per session, stored in the envelope; v2 regex `/^<MRCLEAN:([A-Z0-9_]+):(\d{3}|OVF):([a-f0-9]{8})>$/`; OVF keeps shared-token semantics (stress assertions must exempt OVF entries — see `manager.ts:93-94,108` OVF comments).

---

### `src/hook/handlers/session-end.ts` — no-op → janitor (replace body)

**Current state** (`session-end.ts:16-18`) — the whole body today:
```typescript
export async function handleSessionEnd(_input: SessionEndInput): Promise<null> {
  return null
}
```
The JSDoc (lines 1-12) already documents this phase's replacement AND the constraint: any throw here becomes exit-2 noise via the fail-closed wrapper. Keep the signature (`Promise<null>`, dispatcher routes at `src/hook/dispatcher.ts:37-38` — no dispatcher edit needed).

**Replacement shape** — lazy import + total try/catch (janitor call is config-free; the reason allowlist is code, not config):
```typescript
export async function handleSessionEnd(input: SessionEndInput): Promise<null> {
  try {
    const { runSessionEndJanitor } = await import('../../state/janitor.js')
    await runSessionEndJanitor(input.session_id, input.reason)
  } catch {
    // swallow-and-audit (D-08): janitor errors must never produce exit-2 at session end
  }
  return null
}
```
`SessionEndInput.reason` is an OPEN string (`src/shared/types.ts:74-80`) — retention is the allowlist `reason === 'resume'` only.

---

### `src/hook/handlers/session-start.ts` — TTL sweep call site (modify)

**Analog:** itself (`session-start.ts:28-60`). Config is already loaded at Step 1 (line 31) — `config.reversible.enabled` and the new `config.reversible.ttl_hours` are available. Insert the sweep AFTER config load, wrapped so a sweep bug can never break SessionStart:
```typescript
// After Step 1 (line 31): non-fatal TTL sweep — never disturb the banner path.
// ConfigReadError rethrow contract (line 30 comment) stays UNTOUCHED — the sweep
// try/catch wraps ONLY the janitor call, not loadEffectiveConfig.
if (config.reversible.enabled) {
  try {
    const { runTtlSweep } = await import('../../state/janitor.js')
    await runTtlSweep({ ttlHours: config.reversible.ttl_hours })
  } catch { /* non-fatal (D-07) */ }
}
```
Lazy `await import()` keeps `src/state/` off the one-way cold path (Pitfall 7).

---

### `src/hook/handlers/pre-tool-use.ts` + `post-tool-use.ts` — reversible transaction sites (modify)

**Analog:** themselves. These are the ONLY substitution sites today (UPS only blocks/warns — verified: `src/hook/handlers/user-prompt-submit.ts` has `decision: 'block'` paths only, no substitution).

**Where the v2 branch hooks in** (`pre-tool-use.ts:141-174`): after Step 1 config load (line 142) and Step 2 state bootstrap (lines 145-154), gate on `config.reversible.enabled` + valid UUID sid → lazy-import `src/state/`, hydrate before `substituteToolInputDeep` (line 166), persist ONCE after (collect allocations across all string leaves — `substituteToolInputDeep` recurses per leaf at lines 84-97, so the transaction must batch, exactly one locked persist per hook event).

**Static-import ban:** handlers must reference `src/state/` ONLY via `await import(...)`. Precedent for the lazy seam: `src/mcp/server.ts:77-110` (every SDK/tool import inside the function body) and the dynamic `import('./layer6b-ner.js')` discipline in `src/detect/index.ts`.

**PostToolUse output shape is UNCHANGED** (string-form `updatedToolOutput`, `post-tool-use.ts:99-107`) — Phase 9 does not alter the emitted contract (E1 verdict stands).

---

### `src/config/index.ts` — `ttl_hours` widening (modify)

**Analog:** `validateReversibleConfig` in the same file — extend in place (`config/index.ts:335-343`):
```typescript
function validateReversibleConfig(raw: unknown, filePath: string): MrcleanReversibleConfigLayer {
  if (!isRecord(raw)) {
    throw new ConfigReadError(filePath, '[reversible] must be a TOML sub-table')
  }
  if (raw['enabled'] !== undefined && typeof raw['enabled'] !== 'boolean') {
    throw new ConfigReadError(filePath, '[reversible].enabled must be a boolean')
  }
  return 'enabled' in raw ? { enabled: raw['enabled'] as boolean } : {}
}
```
Add the `ttl_hours` clause (integer ≥ 1; wrong type ⇒ `ConfigReadError(filePath, '[reversible].ttl_hours must be an integer >= 1')`) and switch the return to the multi-key conditional-spread idiom from `validatePiiNerConfig` (`config/index.ts:278-290`):
```typescript
return {
  ...('enabled' in raw ? { enabled: raw['enabled'] as boolean } : {}),
  ...('ttl_hours' in raw ? { ttl_hours: raw['ttl_hours'] as number } : {}),
}
```
Conditional spreads keep absent keys ABSENT (true partial, CR-01 discipline) — a `[reversible]` table with only unknown/future keys still parses to `{}`.

**Merge branch** (`config/index.ts:546-551`) — extend per-field last-wins-when-set (08-07 precedent):
```typescript
// Current (enabled-only — replace with per-field accumulation):
if (layer.reversible?.enabled !== undefined) {
  reversible = { enabled: layer.reversible.enabled }
}
// Phase 9 shape: each field independently last-wins; new object, never a layer alias:
// reversible = {
//   enabled: layer.reversible.enabled ?? reversible.enabled,
//   ttl_hours: layer.reversible.ttl_hours ?? reversible.ttl_hours,
// }  — guarded by `if (layer.reversible !== undefined)`
```
Seed line 539 (`let reversible: MrcleanReversibleConfig = { enabled: DEFAULT_CONFIG.reversible.enabled }`) gains `ttl_hours: DEFAULT_CONFIG.reversible.ttl_hours`. The `??` idiom is safe here (boolean `false` and integers ≥ 1 are never nullish-collapsed wrongly — but note the pii precedent at lines 564-596 uses `??` for exactly this reason: it triggers on undefined only, so explicit `false` wins).

**Types** (`src/shared/types.ts:354-372`): `MrcleanReversibleConfig` gains `ttl_hours: number` (required on the effective config); `MrcleanReversibleConfigLayer` gains `ttl_hours?: number`. Update the JSDoc that currently says "Phase 9 owns store-schema fields (ttl_hours etc.)" — this is that ownership landing.

**Defaults** (`src/config/defaults.ts:70-72`): frozen sub-object gains `ttl_hours: 24`:
```typescript
reversible: Object.freeze({
  enabled: false, // master switch OFF; absent-[reversible] == shipped one-way guarantee
}) as unknown as import('../shared/types.js').MrcleanReversibleConfig,
```

---

### `src/mcp/server.ts` — boot TTL sweep (modify)

**Analog:** itself. Insert after config load (`server.ts:85`), before tool registration — same lazy-import + non-fatal shape as everything else in `runMcpServer`:
```typescript
const config = await loadEffectiveConfig({ cwd })          // line 85 — existing
// Boot-time TTL sweep (D-07 second site — headless sessions never fire SessionEnd, E5).
// sid-agnostic; non-fatal: a sweep bug must never stop the MCP server from serving.
if (config.reversible.enabled) {
  try {
    const { runTtlSweep } = await import('../state/janitor.js')
    await runTtlSweep({ ttlHours: config.reversible.ttl_hours })
  } catch { /* non-fatal */ }
}
```
Do NOT touch `src/mcp/tools/redact.ts` (MCP lane has no CC session_id — per-call sids would spray orphan maps).

---

### `src/doctor/checks.ts` — check-8 copy update (modify)

**Analog:** itself (`checks.ts:557-560` constants + `checkReversibleState` 577-597):
```typescript
const REVERSIBLE_DETAIL_DISABLED = 'reversible mode: disabled (default one-way)'
const REVERSIBLE_DETAIL_ENABLED =
  'reversible mode: enabled — plumbing only (session state adapter lands in Phase 9)'
const REVERSIBLE_DETAIL_CONFIG_ERROR = 'config unreadable — see config check'
```
Only `REVERSIBLE_DETAIL_ENABLED` changes (drop "plumbing only" — exact new copy is Claude's discretion; state-only, never config values/paths/map contents, T-08-08). The check stays REPORTING-ONLY (never FAIL) until Phase 10.

**Paired test update — byte-for-byte** (`tests/doctor/checks.test.ts:505-517`, Test 16):
```typescript
detail: 'reversible mode: enabled — plumbing only (session state adapter lands in Phase 9)',
```
Update constant and test assertion in the SAME task/commit. Tests 15 (disabled copy, lines 482-497) and the SKIP case (~line 537) are untouched. If THREAT_MODEL copy changes, extend `tests/copy-drift.test.ts` per CONTEXT canonical refs.

---

### `src/mcp/tools/status.ts` — optional entry-count counters (modify, discretionary)

**Analog:** itself (`status.ts:51-95`) — `registerTool` with zod `inputSchema`/`outputSchema`, `annotations: { readOnlyHint: true, idempotentHint: true }`, `structuredContent` + stringified `text` return. If counters land: counts ONLY (never values, never paths beyond the audit-log-path precedent), extend `statusOutputSchema` (lines 30-37). RESEARCH Open Question 1 permits deferring entirely to Phase 10 — neither choice blocks SC1–SC5.

---

### `package.json` — pinned dependency install (explicit task)

No analog — this is an install action, not a pattern. Verified current state: `dependencies` has 10 entries (none of the three), `devDependencies` has 7. Task must run:
```
npm install proper-lockfile@^4.1.2 write-file-atomic@^7.0.1
npm install -D @types/proper-lockfile@^4.1.4
```
- PIN `write-file-atomic` at `^7` — v8 engines (`^22.22.2 || ^24.15.0 || >=26`) break the Node `>=20.18.0` floor (`package.json` engines field).
- All three audited slopcheck-clean, no postinstall scripts (RESEARCH §Package Legitimacy Audit) — cite in the plan's T-SC row.
- Known noise: `npm audit` shows 5 pre-existing vite-transitive dev findings + deprecated `boolean@3.2.0` transitive warning — pre-existing, not Phase 9 blockers.

---

### `tsup.config.ts` — test-only stress worker entry (modify)

**Analog:** the `detect-layer1` entry (`tsup.config.ts:6-13`):
```typescript
entry: {
  cli: 'src/cli.ts',
  mcp: 'src/mcp.ts',
  // TEST-ONLY entry: detect-layer1 is compiled for bundle-worker integration tests
  // It is NOT shipped to npm consumers — excluded via package.json#files enumeration.
  'detect-layer1': 'src/detect/layer1-regex/index.ts',
},
```
Add the stress worker fixture as a fourth entry with the same TEST-ONLY comment discipline. `package.json#files` is an explicit enumeration (dist/cli.js, dist/mcp.js + maps/d.ts only) — new dist artifacts are automatically NOT shipped; state this in the task so nobody "fixes" files[].

---

### `vitest.config.ts` — stress test project placement (modify)

**Analog:** the `tests/audit/pii-canary-leak.test.ts` dual-listing dance (comments in both project blocks). `tests/state/*.test.ts` lands in the `unit` project by default (include `tests/**/*.test.ts`). The stress test spawns 16 real processes against the tsup-built worker, so it needs the `integration` project (sequential, `globalSetup` builds dist):
1. Add `'tests/state/stress.test.ts'` to unit's `exclude` array.
2. Add `'tests/state/stress.test.ts'` to integration's `include` array (explicit allow-list entry — without it `--project=integration` matches zero files; non-vacuity comment precedent is in the config).

**globalSetup precedent** (`tests/hook/integration-detection.globalSetup.ts` — whole file):
```typescript
export default async function globalSetup() {
  execSync('npm run build', { stdio: 'inherit', timeout: 90_000, cwd: process.cwd() })
}
```
Integration project already runs this — the stress test rides the existing build, no new setup file needed unless a state-specific one is preferred.

## Test Suite Patterns

### New unit suites (`tests/state/{map-store,allocation,tokens-v2,secret-floor,janitor}.test.ts`)

**Fail-closed validation tests — copy the Test B shape** (`tests/config/reader.test.ts:144-162`) for `ttl_hours`:
```typescript
it('throws ConfigReadError when [reversible].enabled is not a boolean', async () => {
  // Arrange
  const configPath = join(tmpDir, 'config.toml')
  await writeFile(configPath, '[reversible]\nenabled = "yes"\n')
  // Act + Assert
  await expect(readConfigLayer(configPath)).rejects.toBeInstanceOf(ConfigReadError)
  try {
    await readConfigLayer(configPath)
    expect.unreachable('readConfigLayer must reject on non-boolean [reversible].enabled')
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigReadError)
    const configErr = err as ConfigReadError
    expect(configErr.reason).toBe('[reversible].enabled must be a boolean')
    expect(configErr.path).toBe(configPath)
  }
})
```
Also mirror Test C (unknown keys tolerated, `reader.test.ts:164-176`) and Test I (true-partial, `reader.test.ts:178-188`) for the widened table, plus a merge-side test following Test G (`tests/config/merge.test.ts:147-159`) proving `ttl_hours` survives a partial project `[reversible]` table.

**Isolated tmpdir fixture — copy** (`tests/config/merge.test.ts:112-123`):
```typescript
beforeEach(async () => {
  const id = randomUUID()
  tmpHome = join(tmpdir(), `mrclean-home-${id}`)
  tmpCwd = join(tmpdir(), `mrclean-cwd-${id}`)
  await mkdir(tmpHome, { recursive: true })
  await mkdir(tmpCwd, { recursive: true })
})
afterEach(async () => {
  await rm(tmpHome, { recursive: true, force: true })
  await rm(tmpCwd, { recursive: true, force: true })
})
```
State tests must inject a base dir (never touch the real `~/.mrclean/`) — the store facade should accept a `baseDir` override like `LoadConfigOpts.homeDir` (`src/config/index.ts:606-611` "primarily for test injection" precedent).

**stderr-spy assertions — copy** (`tests/placeholder/manager.test.ts:64-87`):
```typescript
const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
// ...
const warningJson = (stderrSpy.mock.calls[0]![0] as string).trimEnd()
const warning = JSON.parse(warningJson)
expect(warning.warn).toBe('mrclean placeholder overflow')
stderrSpy.mockRestore()
```
Use for degrade-warn and janitor-warn assertions (hash-only field checks).

**AAA + descriptive names** throughout (`// Arrange` / `// Act` / `// Assert` comments as in merge.test.ts Test D, lines 70-86).

### Cold-path import-graph test (REVMODE-05 gate)

**Analog (exact):** `tests/detect/ner-unreachable.test.ts` — pure source-reading proof, loads nothing heavy. Copy the helpers verbatim (`stripComments` 59-63, `hasRuntimeStaticImport` 66-80, `hasTypeOnlyImport` 83-91) and the module-set pattern (34-42):
```typescript
const HOOK_REACHABLE = [
  'hook/index.ts',
  'hook/dispatcher.ts',
  'hook/handlers/session-start.ts',
  'hook/handlers/user-prompt-submit.ts',
  'hook/handlers/pre-tool-use.ts',
  'hook/handlers/post-tool-use.ts',
  'detect/index.ts',
] as const
```
Phase 9 version asserts: no hook-reachable module (add `hook/handlers/session-end.ts` and `placeholder/manager.ts` to the set) has a RUNTIME static import matching `/state/` or `proper-lockfile` or `write-file-atomic`; the only reachable references are dynamic `import(...)` expressions; `node:crypto` cipher/lock imports confined to `src/state/`.

### `tests/hook/session-end.test.ts` (new)

**Analog (exact):** `tests/hook/handlers.test.ts` — `vi.mock` seam (lines 15-53) + minimal typed fixtures (lines 70-105):
```typescript
const sessionStartInput: SessionStartInput = {
  hook_event_name: 'SessionStart',
  session_id: 'test-session',
  transcript_path: '/tmp/transcript',
  cwd: '/tmp',
  source: 'startup',
}
```
For SessionEnd: mock `../../src/state/janitor.js`, drive the reason matrix (resume retains; clear/logout/prompt_input_exit/other/UNKNOWN-future-string delete), and assert handler NEVER throws even when the mocked janitor rejects (returns `null` regardless). Use a real UUID-shaped `session_id` in fixtures where sid validation is in play — `'test-session'` fails the facade regex by design.

### `tests/state/stress.test.ts` + worker fixture (SC5)

**Analog (partial):** integration project + globalSetup build; worker entry via tsup (detect-layer1 precedent). Harness shape from RESEARCH Code Example 4 (validated end-to-end: 16 procs × 25 txns, 400 contended cycles, 117 ms, 0/0/0):
```typescript
const procs = range(16).map(i => spawn(process.execPath, [WORKER, base, String(i), goFile]))
await settleBoot(); writeFileSync(goFile, 'go')
// asserts: zero lost entries, zero NNN dups (OVF exempt), counter integrity,
// zero cross-process disagreements on shared originals, zero degrade fallbacks
```
The degrade-count assertion is load-bearing (Pitfall 3): count stderr warns/worker-reported degrades — a stress pass that "loses" entries to process-local fallback must fail.

### Chaos-shaped unit cases (Pitfall 6 / SC5 second half)

Corrupt byte, truncated tag, chmod 000 (POSIX-only assert, skip on win32 with documented-gap comment per Pitfall 8), map-is-a-directory, delete-mid-session — each asserts output identical to one-way mode. Unit tests THIS phase; Phase 11 elevates to CI gates.

## Shared Patterns

### Fail-closed vs swallow-and-audit split
**Source:** `src/hook/failclosed.ts:65-78` (`installCrashGuards` — any uncaught throw ⇒ exit 2)
**Apply to:** every state-adapter call site in handlers. The read path returns ABSENT on any error; the write path degrades to process-local allocation; SessionEnd/SessionStart/MCP-boot janitor calls are individually try/catch-wrapped. The ONE fail-closed contract that stays untouched: SessionStart's ConfigReadError rethrow (`session-start.ts:14,30`).

### Hash-only output discipline
**Source:** `src/shared/sanitize-output.ts:98-125` (chokepoint; context-free static message) + `src/audit/log.ts:147,167` ("LOCKED: NEVER add raw value, env-var name, file path, or raw PII here")
**Apply to:** all state-module stderr warns, thrown-error messages (a `MapAbsentError` reason string must never embed plaintext), janitor warns. No `original` in any diagnostic. Leak-grep suites (`tests/audit/pii-stderr-leak.test.ts`, `pii-canary-leak.test.ts`) are the enforcement precedent.

### Lazy-import cold-path fence
**Source:** `src/mcp/server.ts:75-110` (function-body imports), `src/detect/index.ts` dynamic `import('./layer6b-ner.js')`, tsup banner note for CJS interop (`tsup.config.ts` banner: `createRequire` shim — relevant because `proper-lockfile` is CJS and gets bundled via `noExternal`)
**Apply to:** every `src/state/` reference from handlers/MCP server: `await import('../../state/...')` behind `config.reversible.enabled`. Enforced by the new import-graph test.

### True-partial config layers + immutable merge
**Source:** `src/config/index.ts:278-290` (conditional spread), `:546-551` (last-wins-when-set, "New object, never a layer alias"), `src/shared/types.ts:364-372` (Layer type JSDoc)
**Apply to:** `ttl_hours` validator, layer type, merge branch, defaults.

### Options-object APIs + test injection
**Source:** `src/config/index.ts:606-611` (`LoadConfigOpts` homeDir/cwd override), `src/detect/session-state.ts:108-118` (destructured options param)
**Apply to:** state facade functions (`baseDir` override for tests), janitor (`ttlHours`, `now` clock injection for TTL tests).

## No Analog Found

Files/surfaces with no close match in the codebase (use RESEARCH.md verified examples — every snippet there was executed live on Node 22.22.0 this research cycle):

| Surface | Role | Data Flow | Reason | Use Instead |
|---------|------|-----------|--------|-------------|
| AES-256-GCM envelope encrypt/decrypt | service | file-I/O | No cipher usage anywhere in `src/` (only `createHash`/`randomUUID`) | RESEARCH Code Example 1 (authTagLength:16 mandatory, validate-before-slice) |
| Key custody (`wx` create-once, 0600/0700) | service | file-I/O | No 0600/0700 mode usage in `src/` (only 0o644 writeFile) | RESEARCH Code Example 2 |
| Cross-process lock + deadline-degrade wrapper | utility | file-I/O | No locking anywhere; `atomicWriteJson` is atomic-replace, NOT mutual exclusion (D-02 invariant) | RESEARCH Code Example 3 + ~40-line hand-built deadline wrapper (the one thing that MUST be hand-built) |
| Multi-process spawn barrier stress harness | test | — | No spawn-based concurrency tests exist (integration tests spawn single CLI procs) | RESEARCH Code Example 4 harness shape |

## Metadata

**Analog search scope:** `src/**` (all 60 TS files surveyed by size), `tests/**` (top 60 by size), `tsup.config.ts`, `vitest.config.ts`, `package.json`
**Files read in full or targeted:** 24 (manager, session-end, session-start, pre-tool-use, post-tool-use, user-prompt-submit [grep], dispatcher, failclosed, sanitize-output, session-state, config/index, defaults [grep], types, mcp/server, tools/status, doctor/checks [548-597], atomic-json, type-map, findings [grep], audit/log [grep], + 5 test files + 2 build configs + package.json)
**Pattern extraction date:** 2026-07-16
