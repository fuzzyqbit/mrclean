# Phase 10: Operator Restore - Pattern Map

**Mapped:** 2026-07-17
**Files analyzed:** 19 (10 source new/modified + 6 new test files + 3 test extensions)
**Analogs found:** 19 / 19 (16 exact/strong, 3 role-match with documented gaps)

All excerpts below were read from the working tree this session. Line numbers refer to current `main`-lineage files on branch `gsd/v3.0-reversible-redact-mode-foundations-operator-restore`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/restore/index.ts` (new) | utility — pure engine | transform (token scan → text) | `src/state/index.ts` `applyRenamesToText` + `src/state/session-map.ts` pure-module discipline | exact |
| `src/restore/session-index.ts` (new) | service — read-side index builder | file-I/O (read-only decrypt) | `src/state/janitor.ts` filename candidacy + `src/state/map-store.ts` `readSessionMapFile` | exact |
| `src/restore/cli.ts` (new) | controller — CLI action module | request-response (stdin/file → stdout) | `src/install/ignore.ts` `runIgnore` | role-match |
| `src/cli.ts` (modify) | route — subcommand registration | request-response | itself — `ignore`/`doctor` subcommands | exact |
| `src/state/session-map.ts` (modify) | model — token grammar export | transform | itself — `V2_TOKEN_RE` (line 308) | exact |
| `src/audit/log.ts` or sibling `restore-log.ts` (modify/new) | service — audit writer | file-I/O (JSONL append) | `src/audit/log.ts` `findingToAuditRecord` + `writeAuditRecord` | role-match (first second record type in the JSONL) |
| `src/doctor/checks.ts` (modify) | service — diagnostic check | file-I/O (config read) | itself — `checkReversibleState` (552–597) + `checkConfigLoad` (495–546) | exact |
| `src/mcp/tools/status.ts` (modify) | controller — MCP tool | request-response | itself — `registerStatusTool` | exact |
| `src/state/` counts reducer (new export) | service — counts-only projection | file-I/O (read-only) | `src/state/index.ts` `buildHydration` (131–143) | role-match |
| `src/config/index.ts` raw-keys helper (optional new export) | utility — raw TOML key scan | file-I/O (read) | `readConfigLayer` (485–499) + `src/install/ignore.ts` raw `parse()` precedent (line 76) | role-match |
| `tests/restore/engine.test.ts` (new) | test — table-driven unit | transform | `tests/state/chaos.test.ts` `buildSeedMap` fixture builder (98–108) | role-match |
| `tests/restore/degrade.test.ts` (new) | test — corruption matrix | file-I/O | `tests/state/chaos.test.ts` corruption fixtures (235–312) | exact |
| `tests/restore/mixed-canary.test.ts` (new) | test — real-pipeline round-trip | event/file-I/O | `tests/state/inspection.test.ts` `runReversibleEvent` (65–85) | exact |
| `tests/cli/restore.test.ts` (new) | test — CLI seam | request-response | `tests/cli/ignore.test.ts` | exact |
| `tests/audit/restore-canary-leak.test.ts` (new) | test — leak grep | file-I/O | `tests/audit/pii-canary-leak.test.ts` | exact |
| `tests/mcp/status-reversible.test.ts` (new) | test — MCP tool via InMemoryTransport | request-response | `tests/mcp/status.test.ts` | exact |
| `tests/state/cold-path.test.ts` (extend) | test — source-level fence | source scan | itself — invariants 1 + 4 | exact |
| `tests/doctor/checks.test.ts` (extend) | test — byte-locked check rows | assertions | itself — Tests 15–17 (482–552) | exact |
| `tests/state/inspection.test.ts` (extend) | test — artifact byte grep | file-I/O | itself — byte-scan block (169–177) | exact |

## Pattern Assignments

### `src/restore/index.ts` (utility, transform) — the pure engine

**Analog:** `src/state/session-map.ts` (module discipline) + `src/state/index.ts` (single-pass replace)

**Module-header discipline** — copy the pure-module contract style from `src/state/session-map.ts` lines 1–24. The engine module must declare (and honor): no `node:fs`, no config input, no crypto. The frozen-partition docstring convention ("FROZEN CODE... revise decision D-11 first") is the house style for policy constants.

**Single-pass no-cascade replace** — `src/state/index.ts` lines 307–316 is the in-repo proof pattern (CR-01 lesson). The engine's `text.replace(globalRe, cb)` inherits its guarantee: replacement output is never re-scanned.

```typescript
// src/state/index.ts:307-316 — simultaneity via ONE replace pass
export function applyRenamesToText(text: string, renames: PlaceholderRename[]): string {
  if (renames.length === 0) {
    return text
  }
  const byFrom = new Map<string, string>(renames.map((rename) => [rename.from, rename.to]))
  const pattern = [...byFrom.keys()]
    .map((from) => from.replace(REGEXP_SPECIALS_RE, '\\$&'))
    .join('|')
  return text.replace(new RegExp(pattern, 'g'), (match) => byFrom.get(match) ?? match)
}
```

For restore, the pattern is fixed (the v2 scan regex), so the callback does the index lookup instead of a rename-map lookup — RESEARCH Code Example 2 is the exact target shape (`restoreText(input, index)` returning `{ text, restored, unmatched, restoredOriginals }`). OVF label short-circuit happens inside the callback BEFORE the lookup.

**Policy gate authority** — never re-declare the restorable set. Import from `src/state/session-map.ts` lines 42–71:

```typescript
// src/state/session-map.ts:42-50, 69-71
export const RESTORABLE_TYPES: readonly string[] = Object.freeze([
  'WORD', 'PII_EMAIL', 'PII_PHONE', 'PII_IP', 'PII_PERSON', 'PII_ORG', 'PII_LOC',
] as const)
export function isRestorableType(type: string): boolean {
  return RESTORABLE_SET.has(type)
}
```

---

### `src/restore/session-index.ts` (service, read-only file-I/O) — discovery + inverted index

**Analog:** `src/state/janitor.ts` (filename candidacy) + `src/state/map-store.ts` (total-error read)

**Filename-shape candidacy** — copy the janitor's stem extraction, `src/state/janitor.ts` lines 215–222. Only names our stack provably creates are considered; everything else is invisible:

```typescript
// src/state/janitor.ts:215-222
/** Extract a sid from `<uuid><ext>`; anything else was not created by us. */
function sidFromName(name: string, ext: string): string | null {
  if (!name.endsWith(ext)) {
    return null
  }
  const sid = name.slice(0, -ext.length)
  return SESSION_ID_RE.test(sid) ? sid : null
}
```

**Safe dir listing** — janitor lines 120–129 (`readDirSafe`): ENOENT ⇒ silent empty (absent dir means zero sessions ⇒ degrade upstream); the restore variant returns `[]` instead of aborting a sweep.

**The read primitive** — `src/state/map-store.ts` lines 295–307. This is THE decrypt chokepoint; restore consumes it, never its own crypto (cold-path fence invariant 4 confines `createDecipheriv` to `src/state/`):

```typescript
// src/state/map-store.ts:295-307 — TOTAL-ERROR: null on ANY failure class
export async function readSessionMapFile(
  baseDir: string,
  sid: string,
): Promise<SessionMapV1 | null> {
  try {
    const key = await readFile(keyPathFor(baseDir, sid))
    const envelope = await readFile(mapPathFor(baseDir, sid))
    const plaintext = decryptMapBuffer(envelope, key, sid)
    return parseSessionMap(plaintext.toString('utf8'))
  } catch {
    return null
  }
}
```

**Do NOT use** `readSessionMapForHydration` (`src/state/index.ts` lines 155–172): `buildHydration` (131–143) deliberately builds `{placeholder, type}` projections WITHOUT `original`, and on any failure it fabricates a fresh provisional map — both behaviors are wrong for restore.

**Index-build policy gate** — RESEARCH Code Example 1 is the target: `isRestorableType(entry.type) && 'original' in entry`, plus OVF-placeholder exclusion. The `'original' in entry` narrowing idiom is shipped in `src/state/session-map.ts` lines 167–177 (`toPersistableEntry`) and asserted in `tests/state/inspection.test.ts` lines 205–206.

**Paths** — `statePaths` / `mapPathFor` from `src/state/map-store.ts` lines 76–94. Note the documented precondition on `keyPathFor`/`mapPathFor` (lines 82–89): sid must pass `isValidSessionId` BEFORE these helpers see it. A `--session` CLI arg follows the janitor gate order (`src/state/janitor.ts` lines 171–175: validate first, invalid ⇒ do nothing).

**No writes, no locks** — reads are lock-free (atomic-rename writes make torn reads impossible), and `readFile` never touches mtime (map mtime is the TTL heartbeat, janitor lines 18–22). The index builder's fs surface is exactly `readdir` + `readSessionMapFile`.

---

### `src/restore/cli.ts` (controller, stdin/file → stdout) — `runRestore`

**Analog:** `src/install/ignore.ts` `runIgnore` (the shipped CLI-action-module shape)

```typescript
// src/install/ignore.ts:122-140 — opts object, cwd default, stderr copy, fail-closed exit
export async function runIgnore(opts: { fingerprint: string; cwd?: string }): Promise<void> {
  const { fingerprint, cwd = process.cwd() } = opts

  // Validate fingerprint shape (T-02-05-07: TOML injection prevention)
  if (!isValidFingerprint(fingerprint)) {
    process.stderr.write(
      `[mrclean] invalid fingerprint: "${fingerprint}" — expected format: ruleId:16hexchars\n`,
    )
    process.exit(2)
  }

  const result = await appendFingerprintToConfig(cwd, fingerprint)

  if (result.added) {
    process.stderr.write(`[mrclean] added ${fingerprint} to ${result.path}\n`)
  } else {
    process.stderr.write(`[mrclean] already allowlisted: ${fingerprint} (${result.path})\n`)
  }
}
```

Copy: exported `runRestore(opts)` with an options object (`{ file?, session?, cwd?, baseDir? }` — `baseDir` injection is the test seam, `FacadeOpts` precedent in `src/state/index.ts` lines 77–80), stderr-only human copy prefixed `[mrclean]`, restored text on stdout ONLY. Divergence from analog (per RESEARCH Pattern 5 / Pitfall 9): cosmetic degrade exits 0 with a warning — `process.exit(2)` is reserved for hard input errors (e.g. malformed `--session` sid), mirroring `runIgnore`'s fail-closed validation exit.

**stdin read** — the hook's `readStdinWithTimeout` (`src/hook/index.ts` lines 37–46) is deliberately the WRONG shape here (10 s timeout + exit-0-on-stall is hook-contract behavior). The operator CLI reads to EOF; use RESEARCH Code Example 3's `for await (const chunk of stream)` accumulate. No in-repo analog exists — see "No Analog Found".

**HOOK-06 discipline carries over** (`src/hook/index.ts` lines 13–14): stdout receives ONLY the payload (restored text); diagnostics go to stderr. Warning copy follows the hash-only single-line discipline of `src/state/index.ts` lines 110–124 (`warnInvalidSessionId` carries NO sid echo for hostile-shaped input; `warnPersistDegraded` carries `warn` + sessionId only — never values, never paths).

---

### `src/cli.ts` (route, subcommand registration)

**Analog:** itself — the `ignore` + `doctor` subcommands

```typescript
// src/cli.ts:66-73 — arg-taking subcommand with dynamic import (cold-path discipline)
program
  .command('ignore <fingerprint>')
  .description('Add a fingerprint to the project-local allowlist (.mrclean/config.toml)')
  .action(async (fingerprint: string) => {
    const { runIgnore } = await import('./install/ignore.js')
    await runIgnore({ fingerprint })
  })
```

```typescript
// src/cli.ts:110-118 — option-taking subcommand (for --session)
program
  .command('doctor')
  .description('Verify mrclean installation: hook entries, MCP server, canary round-trip')
  .option('--verbose', 'Print detailed check output', false)
  .action(async (opts: { verbose: boolean; bench: boolean }) => {
    const { runDoctor } = await import('./doctor/index.js')
    await runDoctor({ verbose: opts.verbose, bench: opts.bench })
  })
```

The restore registration is RESEARCH Code Example 3: `.command('restore [file]')` + `.option('--session <uuid>')` + `await import('./restore/cli.js')`. The dynamic import IS the hook cold-start protection — commander pinned `^13` (header comment lines 11–12), entrypoint guard at lines 122–125 must stay untouched.

---

### `src/state/session-map.ts` (model, additive export) — `V2_TOKEN_SCAN_RE`

**Analog:** itself, line 308:

```typescript
// src/state/session-map.ts:308 — anchored matcher (single source of token grammar)
export const V2_TOKEN_RE = /^<MRCLEAN:([A-Z0-9_]+):(\d{3}|OVF):([a-f0-9]{8})>$/
```

Add the unanchored global sibling directly beside it (same capture groups, `g` flag, no anchors) so allocator and restorer can never drift. `tests/state/chaos.test.ts` lines 89–91 already demonstrate the unanchored-variant + non-global-probe-copy discipline (a `/g` regex carries `lastIndex` state — keep a probe copy for `toMatch` in tests):

```typescript
// tests/state/chaos.test.ts:89-91 — the /g-state pitfall, already documented in-repo
const V2_TAIL_RE = /(<MRCLEAN:[A-Z0-9_]+:(?:\d{3}|OVF)):[a-f0-9]{8}>/g
/** Non-global probe copy (toMatch + /g would carry lastIndex state). */
const V2_TAIL_PROBE = /<MRCLEAN:[A-Z0-9_]+:(?:\d{3}|OVF):[a-f0-9]{8}>/
```

This is the ONLY sanctioned edit inside `src/state/session-map.ts`; the frozen partition (lines 42–50) and everything else stays byte-identical.

---

### `src/audit/log.ts` or sibling `src/audit/restore-log.ts` (service, JSONL append) — `RestoreAuditRecord`

**Analog:** `src/audit/log.ts` — builder discipline + append discipline

**Append path** — reuse the shipped shape exactly:

```typescript
// src/audit/log.ts:109-122 — O_APPEND JSONL append with typed error
export async function writeAuditRecord(cwd: string, record: AuditRecord): Promise<void> {
  const logPath = join(cwd, '.mrclean', 'audit.jsonl')
  const line = JSON.stringify(record) + '\n'
  try {
    await appendFile(logPath, line, { flag: 'a', encoding: 'utf8' })
  } catch (err) {
    const message =
      isEnoent(err)
        ? `mrclean audit: .mrclean/ not found — run \`mrclean install\``
        : `mrclean audit: failed to write to ${logPath}`
    throw new AuditWriteError(message, err)
  }
}
```

**Builder discipline** — the LOCKED no-raw builder with the CR-01 destructure-pick lesson is the mandatory template:

```typescript
// src/audit/log.ts:167, 186-193 — LOCKED comment + never-blind-spread defense
  // LOCKED: NEVER add raw value, env-var name, file path, or raw PII here. CI canary test enforces this.
  ...
    // LOCKED no-raw defense: destructure-pick ONLY the four model-identity keys.
    // Never blind-spread `provenance` — TS structural typing lets an over-shaped
    // object (e.g. a Finding carrying `value`) pass the param type, and a blind
    // spread would serialize that raw text into audit.jsonl (CR-01).
```

The restore record is a NEW discriminated type (RESEARCH Assumption A3 — do NOT widen `AuditRecord`'s locked unions at lines 35–76; a restore summary has no ruleId/severity/fingerprint/location). Recommended shape: `{ ts, action: 'restore', sessionScope, restored, unmatched, skippedSecret, hashes }` with its own `buildRestoreAuditRecord` carrying the same LOCKED comment, taking counts + pre-hashed values only (never the raw `restoredOriginals` array — hash at the call boundary in `src/restore/cli.ts`).

**Hashing** — byte-consistent with `redactedHash`:

```typescript
// src/detect/findings.ts:63-76 — reuse, do not re-implement
export function sha256hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
export function redactedHash(value: string): string {
  return sha256hex(value).slice(0, 16)
}
```

`redactedHash` itself is importable — prefer it over open-coding `sha256hex(v).slice(0, 16)`. Precedent for importing findings helpers outside detect: `src/placeholder/manager.ts` already imports from `src/detect/findings.js`.

`assertNoCanaryLeak` (`src/audit/canary-leak.ts` lines 56–97) JSON-parses per line and substring-scans — it works unchanged over heterogeneous JSONL, so no helper edits are needed for the mixed record stream.

---

### `src/doctor/checks.ts` (service, config read) — check 8 FAIL-loud upgrade

**Analog:** itself — `checkReversibleState` (552–597) is the function being upgraded; `checkConfigLoad` (495–546) is the FAIL-detail precedent

**Current PASS/SKIP body to preserve byte-identically** (the three detail constants at lines 557–560 are byte-locked by `tests/doctor/checks.test.ts` Tests 15–17):

```typescript
// src/doctor/checks.ts:557-560 — LOCKED detail strings (tests assert byte-for-byte)
const REVERSIBLE_DETAIL_DISABLED = 'reversible mode: disabled (default one-way)'
const REVERSIBLE_DETAIL_ENABLED =
  'reversible mode: enabled — encrypted session state adapter active'
const REVERSIBLE_DETAIL_CONFIG_ERROR = 'config unreadable — see config check'
```

The header comment at lines 563–576 explicitly reserves `exitCodeOnFail: 1` for this phase. The LOCKED exit map (checks.ts lines 10–15) is untouched — exit 1 is already the config domain.

**FAIL detail naming file + key** — follow `checkConfigLoad`'s precedent (paths ARE allowed in FAIL details; the T-08-08 constant-detail constraint applies to the SKIP path only):

```typescript
// src/doctor/checks.ts:529-536 — FAIL naming the offending file (the shape to copy)
    if (err instanceof ConfigReadError) {
      return {
        name: 'config-load',
        status: 'FAIL',
        detail: `malformed config file: ${err.path}: ${err.reason}`,
        exitCodeOnFail: 1,
      }
    }
```

**Mechanism caution (Pitfall 4)** — the tolerant validator DROPS unknown keys, so the check cannot see them through `loadEffectiveConfig`:

```typescript
// src/config/index.ts:352-355 — why the loader is blind to unknown [reversible] keys
  return {
    ...('enabled' in raw ? { enabled: raw['enabled'] as boolean } : {}),
    ...('ttl_hours' in raw ? { ttl_hours: raw['ttl_hours'] as number } : {}),
  }
```

The check must re-read BOTH raw layers (`join(homeDir, '.mrclean', 'config.toml')` and `join(cwd, '.mrclean', 'config.toml')` — path derivation precedent in `checkConfigLoad` lines 500–501) and inspect raw `[reversible]` table keys against the supported set `{enabled, ttl_hours}`. Two implementation routes, both with precedent:
- **Preferred:** add a small raw-keys helper export in `src/config/index.ts` beside `readConfigLayer` (485–499) reusing its ENOENT⇒`{}` / empty⇒`{}` semantics but returning `Object.keys(parsed['reversible'])` from the raw `parse()` result before validation.
- **Acceptable:** direct `parse` from `smol-toml` inside doctor — precedent: `src/install/ignore.ts` lines 17, 76 already imports `parse` from `smol-toml` outside `src/config/`.

Unreadable/malformed config keeps the SKIP path unchanged (never double-FAIL one root cause — `checkConfigLoad` owns that FAIL, T-08-10).

---

### `src/mcp/tools/status.ts` (controller, MCP request-response) — reversible counters block

**Analog:** itself — the whole registration is the template

```typescript
// src/mcp/tools/status.ts:28-37 — zero-argument input schema (MUST stay z.object({}))
const statusInputSchema = z.object({})

const statusOutputSchema = z.object({
  version: z.string(),
  rule_count: z.number(),
  allowlist_count: z.number(),
  mode: z.enum(['active', 'dry-run']),
  session_id: z.string().nullable(),
  audit_log_path: z.string(),
})
```

```typescript
// src/mcp/tools/status.ts:80-93 — build typed object, return text + structuredContent
      const status: z.infer<typeof statusOutputSchema> = {
        version: VERSION,
        rule_count: ruleCount,
        allowlist_count: allowlistCount,
        mode,
        session_id: null,
        audit_log_path: auditLogPath,
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status) }],
        structuredContent: status,
      }
```

Extend `statusOutputSchema` with a nested counts-only `reversible` object (numbers + booleans only — no string fields that could carry values). The handler's never-throw posture is already modeled at line 72 (`loadEffectiveConfig(...).catch(() => getConfig())`) — every new data source (sessions dir enumeration, audit aggregation) gets the same `.catch(() => zeroCounts)` treatment. `getCwd()` closure (lines 56, 72, 78) is the audit-path scope; sessions counts are machine-global (`~/.mrclean`) — name fields honestly (RESEARCH Open Question 2).

The counts reducer itself lives in `src/state/` (next section) so `original` strings never enter `src/mcp/` stack frames. Keep `annotations: { readOnlyHint: true, idempotentHint: true }` (line 67).

---

### `src/state/` counts reducer (service, read-only projection)

**Analog:** `src/state/index.ts` `buildHydration` — the shipped "derive a safe projection from the decrypted map inside src/state/" pattern

```typescript
// src/state/index.ts:131-143 — projection that deliberately drops `original`
function buildHydration(map: SessionMapV1): ReversibleHydration {
  const entriesByHmac = new Map<string, { placeholder: string; type: string }>()
  for (const [address, entry] of Object.entries(map.entries)) {
    entriesByHmac.set(address, { placeholder: entry.placeholder, type: entry.type })
  }
  return { ... }
}
```

The counts reducer is the same move one step further: enumerate sessions (janitor `sidFromName` + `SESSION_ID_RE` candidacy), `readSessionMapFile` each, and return ONLY `{ sessions, restorable, secret }` tallies (classify per entry via `isRestorableType(entry.type)`). Null map ⇒ skip silently (total-error read). Export it from `src/state/` (either `map-store.ts` or a small sibling) and have `src/mcp/tools/status.ts` import the reducer — never the map reader.

Note: this is the first sanctioned MCP-side state READ. It does not touch the MCP-lane allocation fence (synthetic sids still can't allocate — `src/state/index.ts` lines 10–14 trust story), but the status tool MUST stay zero-argument so no sid can be injected.

---

### `tests/restore/engine.test.ts` (test, table-driven unit — TDD RED first)

**Analog:** `tests/state/chaos.test.ts` fixture builder — how to hand-build a valid `SessionMapV1` with real token/entry shapes

```typescript
// tests/state/chaos.test.ts:98-108 — the map fixture builder to clone for index fixtures
function buildSeedMap(sid: string): SessionMapV1 {
  const base = createEmptySessionMap(sid)
  const address = hmacAddress(base.hashSalt, SEED_ORIGINAL)
  return {
    ...base,
    counter: 1,
    entries: {
      [address]: makeMapEntry('WORD', formatV2Token('WORD', 1, base.nonce8), 1, SEED_ORIGINAL),
    },
  }
}
```

Engine tests are pure: build an index Map directly (or via the fixture map + index builder), then table-drive `restoreText` over the SC1 taxonomy — exact hit, wrong nonce8, unissued NNN, fabricated TYPE, v1 token (no nonce → no match), OVF pass-through, placeholder-shaped original (single-hop, no cascade — Pitfall 2 fixture: map a WORD whose `original` is literally another live token string). AAA structure with descriptive names per the user's testing rules. `formatV2Token` overflow behavior for OVF fixtures: `src/state/session-map.ts` lines 300–305.

---

### `tests/restore/degrade.test.ts` (test, corruption matrix)

**Analog:** `tests/state/chaos.test.ts` — the six corruption shapes, verbatim fixture recipes

```typescript
// tests/state/chaos.test.ts:235-241 — (a) corrupt byte mid-envelope
      await writeSeedState(base, sid)
      const raw = await readFile(mapPathFor(base, sid))
      const tampered = Buffer.from(raw)
      tampered[CT_OFFSET] = tampered[CT_OFFSET]! ^ 0x01
      await writeFile(mapPathFor(base, sid), tampered)
```

```typescript
// tests/state/chaos.test.ts:83-86, 306-311 — offsets duplicated (never re-derived) + garbage key
const ENVELOPE_MAGIC = 'MRCLNMAP'
const CT_OFFSET = 37 // magic(8) + version(1) + IV(12) + tag(16)
...
      // 17 ASCII bytes — not a valid AES-256 key; decrypt AND re-encrypt fail.
      await writeFile(keyPathFor(base, sid), Buffer.from('garbage-not-a-key'), { mode: 0o600 })
```

Also copy: `writeSeedState` (111–114: `ensureSessionKey` + `writeSessionMapFile` builds real ciphertext), the platform skip guards (lines 69–71: `IS_WIN32`, `IS_ROOT` — chmod-000 never EACCESes as root), the stderr spy (line 159: `vi.spyOn(process.stderr, 'write').mockImplementation(() => true)` — for restore, capture instead of silence to assert warning copy), and the `cleanupDirs` splice-and-rm afterEach (163–168). Degrade assertions per RESEARCH: output === input, exit-equivalent 0, ONE stderr warning without values; plus the Pitfall 7 check — sessions/keys dir listings AND mtimes byte-identical across the restore run (readdir + stat before/after; `tests/state/inspection.test.ts` lines 160–165 shows the exact-listing assertion style `expect(sessionFiles).toEqual([`${sid}.map`])`).

---

### `tests/restore/mixed-canary.test.ts` (test, real-pipeline round-trip — Phase 11 gate substrate)

**Analog:** `tests/state/inspection.test.ts` — the real facade flow + artifact byte-scan

```typescript
// tests/state/inspection.test.ts:65-85 — ONE real reversible event (hydrate→allocate→persist)
async function runReversibleEvent(
  baseDir: string,
  sid: string,
  value: string,
  type: string,
): Promise<{ counterFloor: number; knownEntries: number }> {
  const hydration = await readSessionMapForHydration({ sessionId: sid, baseDir })
  expect(hydration).not.toBeNull()
  const manager = new PlaceholderManager({ sessionId: sid })
  manager.hydrateReversible(hydration!)
  manager.allocate(value, type)
  const pending = manager.drainPendingAllocations()
  const persisted = await persistAllocations({
    sessionId: sid, baseDir, pending, deadlineMs: POST_LOCK_DEADLINE_MS,
  })
  expect(persisted.status).toBe('ok')
  return { counterFloor: hydration!.counterFloor, knownEntries: hydration!.entriesByHmac.size }
}
```

Mixed-content shape (Pitfall 10 — never synthetic-only): drive the REAL pipeline to persist a WORD-term canary (the "fake path" — WORD-typed, there is no PATH type) and a secret-class canary (AWS key), then restore the emitted tokens: WORD round-trips, secret placeholder survives byte-identical. Canary constants precedent, `tests/state/inspection.test.ts` lines 52–55 (`WORD_ORIGINAL` / `SECRET_ORIGINAL`). Secret canary must be a NON-allowlisted fake — chaos.test.ts lines 74–78 documents that `AKIAIOSFODNN7EXAMPLE` is gitleaks-allowlisted; use the X-suffixed variant style. If the test drives handlers instead of the facade, the HOME-stub harness is `tests/state/chaos.test.ts` lines 171–187 (`makeHome` writes `[reversible]\nenabled = true\n`; `makeCwd` pre-creates `.mrclean/`) with the `describe.skipIf(IS_WIN32)` + visible-placeholder gap pattern (lines 153, 315–321). If promoted to the integration project, it must be added to the integration `include` allowlist in `vitest.config.ts` (line 109) — a file cannot belong to both projects (pii-canary-leak.test.ts header, lines 13–15).

---

### `tests/cli/restore.test.ts` (test, CLI seam)

**Analog:** `tests/cli/ignore.test.ts` — dynamic import of the action module + process seam capture

```typescript
// tests/cli/ignore.test.ts:127-152 — process.exit + stderr capture harness
    const originalExit = process.exit
    const originalStderr = process.stderr.write.bind(process.stderr)
    let exitCode: number | undefined
    let stderrOutput = ''

    process.exit = ((code?: number) => {
      exitCode = code ?? 0
      throw new Error(`process.exit(${code})`)
    }) as typeof process.exit

    process.stderr.write = ((chunk: unknown) => {
      stderrOutput += String(chunk)
      return true
    }) as typeof process.stderr.write

    try {
      await runIgnore({ fingerprint: 'not-a-fingerprint' })
    } catch (err) {
      // Expected: process.exit throws in our mock
    } finally {
      process.exit = originalExit
      process.stderr.write = originalStderr
    }
```

Also copy `makeTmpProject` (lines 17–21) and the `await import('../../src/install/ignore.js')` in-test dynamic import idiom (line 33) — swap for `../../src/restore/cli.js`. For stdout capture (restored text), mirror the stderr mock on `process.stdout.write`. Testing `--session` gating: invalid sid ⇒ degrade + zero paths touched (assert via a baseDir fixture that stays byte-identical). File-input mode: write a fixture file into the tmp project and pass `{ file }`. Prefer calling `runRestore(opts)` directly with injected `baseDir`/`cwd` over spawning the CLI binary (unit project stays fast; the commander wiring itself is covered by the shipped `program` export + entrypoint guard, `src/cli.ts` lines 120–127).

---

### `tests/audit/restore-canary-leak.test.ts` (test, leak grep)

**Analog:** `tests/audit/pii-canary-leak.test.ts` — canary corpus + non-vacuity guard + assertNoCanaryLeak

```typescript
// tests/audit/pii-canary-leak.test.ts:105-124 — the NON-VACUITY line-count guard (mandatory)
    expect(
      exists,
      `audit.jsonl missing at ${auditPath} — runDetection wrote no records, so the ` +
        'canary-leak assertion below would pass vacuously.',
    ).toBe(true)

    const content = await fs.readFile(auditPath, 'utf8')
    const lines = content.split('\n').filter((l) => l.trim().length > 0)
    expect(
      lines.length,
      `Expected >= 1 audit record from the PII regex lane but found ${lines.length}.`,
    ).toBeGreaterThanOrEqual(1)
```

```typescript
// tests/audit/pii-canary-leak.test.ts:126-137 — the leak assertion shape
    const result = await assertNoCanaryLeak(auditPath, [...PII_CANARIES])
    if (!result.ok) {
      console.error('[pii-canary] LEAKS DETECTED:', result.leaked)
    }
    expect(result.ok, `audit.jsonl contains raw PII canary values: ...`).toBe(true)
```

Canary corpus style (lines 40–52): synthetic, obviously fake, `.invalid` TLD emails. Restore framing (RESEARCH leak-grep strategy, load-bearing): restorable canaries may appear ONLY on restore stdout (that is the feature); secret canaries on NO surface including stdout. Non-vacuity for restore: assert `restored > 0` before asserting audit cleanliness. Error-path describe block: forced failures (garbage key, EACCES, hand-poisoned secret-class `original` — encrypt poisoned JSON with the real key via `encryptMapBuffer`/`writeSessionMapFile`, since ordinary flows can never produce it) leak nothing to stderr (chaos stderr-spy capture) or audit. `assertNoCanaryLeak` handles ENOENT-clean and malformed-line-as-leak already (`src/audit/canary-leak.ts` lines 62–84).

---

### `tests/mcp/status-reversible.test.ts` (test, MCP tool via InMemoryTransport)

**Analog:** `tests/mcp/status.test.ts` — the linked-pair harness

```typescript
// tests/mcp/status.test.ts:57-70 — InMemoryTransport pair + closure injection
function makeConnectedPair(cwd: string) {
  const config = makeConfig()
  const sessionState = makeSessionState('test-session-status')
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerStatusTool(
    server,
    () => config,
    () => sessionState,
    () => cwd,
  )
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  return { server, client, clientTransport, serverTransport }
}
```

Assertions read `structuredContent` (lines 102–110 cast idiom). New coverage: counters block present with zero-state defaults (missing sessions dir / empty audit ⇒ zero counts, no error); populated counts against a seeded baseDir fixture (chaos `writeSeedState`); zero-argument schema unchanged (call with `arguments: {}`); planted restorable canaries absent from the full `JSON.stringify(structuredContent)`. If the reducer takes a baseDir, thread it through the registration closure the same way `getCwd` is threaded (status.ts lines 51–56) so tests can inject a tmp baseDir.

---

### `tests/state/cold-path.test.ts` (extend — restore-import fence)

**Analog:** itself — extend, do not fork

Invariant 1 machinery to reuse (`hasRuntimeStaticImport`, lines 78–92, with `stripComments` 71–75): add `/restore/` to a new fence asserting NO module in `HOOK_REACHABLE` (lines 42–52) — and additionally no `src/mcp/**` or `src/detect/**` module — imports `src/restore/` (runtime OR type-only). Invariant 4's full-tree walk is the confinement template:

```typescript
// tests/state/cold-path.test.ts:204-229 — full-src token confinement with anti-vacuity control
  it('createCipheriv / createDecipheriv / proper-lockfile references exist ONLY under src/state/', () => {
    const files = walkTsFiles(SRC)
    expect(files.length, 'src/ walk must find a realistic module count').toBeGreaterThan(50)

    const offenders: string[] = []
    const stateHits = new Set<string>()
    for (const file of files) {
      const rel = relative(SRC, file)
      const code = stripComments(readFileSync(file, 'utf8'))
      for (const token of CONFINED_TOKENS) {
        if (!code.includes(token)) continue
        if (rel.startsWith(`state${'/'}`) || rel.startsWith(`state${'\\'}`)) {
          stateHits.add(token)
        } else {
          offenders.push(`${rel} references ${token}`)
        }
      }
    }
    expect(offenders, 'crypto/lock primitives leaked outside src/state/').toEqual([])
    // Positive control: ... every confined token really does exist inside src/state/
```

`src/restore/` consuming `src/state/` exports keeps invariant 4 green automatically (no cipher tokens in restore code). The new invariant is the REVERSE direction: `src/restore/` may be imported ONLY from `src/cli.ts` (dynamic) — walk `src/` and assert no `/restore/` import specifier outside the sanctioned site, with a positive control that the `cli.ts` dynamic-import site exists (`countAwaitImports`, lines 105–111).

---

### `tests/doctor/checks.test.ts` (extend — FAIL-loud rows)

**Analog:** itself — Tests 15–17 (482–552) are the exact row shape

```typescript
// tests/doctor/checks.test.ts:505-528 — Test 16: full-object toEqual byte-lock
  it('Test 16: PASS — [reversible] enabled = true → enabled, adapter active', async () => {
    ...
    await writeFile(join(configDir, 'config.toml'), '[reversible]\nenabled = true\n', 'utf8')
    const result = await checkReversibleState(homeDir, cwd)
    expect(result).toEqual({
      name: 'reversible',
      status: 'PASS',
      detail: 'reversible mode: enabled — encrypted session state adapter active',
      exitCodeOnFail: 1,
    })
```

New rows: plant `[reversible]\nrestore_secrets = true\n` (and a typo'd `ttl_hour = 12`) in the user layer, then the project layer ⇒ FAIL with `exitCodeOnFail: 1`, detail naming the offending file + key (`toMatch` on file path + key name — FAIL details may carry paths, per Test 14's `checkConfigLoad` precedent at 459–474). Supported-keys-only config ⇒ existing PASS rows stay byte-identical (Tests 15–16 unchanged). Malformed config ⇒ Test 17's SKIP row unchanged. Tmp-dir per-test setup/teardown pattern is Tests 15–17's `makeTmpDir` + trailing `rm` calls.

---

### `tests/state/inspection.test.ts` (extend — restore-flow artifact grep)

**Analog:** itself — the byte-scan block

```typescript
// tests/state/inspection.test.ts:169-177 — raw artifact bytes grep (ciphertext-only proof)
    for (const path of [
      ...sessionFiles.map((name) => join(sessionsDir, name)),
      ...keyFiles.map((name) => join(keysDir, name)),
    ]) {
      const raw = await readFile(path)
      expect(raw.includes(WORD_ORIGINAL)).toBe(false)
      expect(raw.includes(SECRET_ORIGINAL)).toBe(false)
      expect(raw.includes('"entries"')).toBe(false)
    }
```

Extension: after a restore run against the persisted state, re-run the same byte-scan (no new plaintext litter) AND assert dir listings + mtimes unchanged (Pitfall 7 — restore's write surface is exactly stdout/stderr/audit.jsonl). The exact-listing assertion (`expect(sessionFiles).toEqual([`${sid}.map`])`, lines 160–165) is the no-litter proof shape.

## Shared Patterns

### sid validation before ANY path derivation (Pitfall 5)
**Source:** `src/state/janitor.ts` lines 171–175 (gate order), `src/state/session-map.ts` lines 321–326 (the allowlist)
**Apply to:** `src/restore/session-index.ts` (filename stems), `src/restore/cli.ts` (`--session` arg)
```typescript
// src/state/janitor.ts:171-175 — validate FIRST; invalid ⇒ do nothing, zero paths touched
  if (!isValidSessionId(sid)) {
    return
  }
```

### Single-line JSON stderr warn, hash-only (never values, never fs error text, never paths)
**Source:** `src/state/janitor.ts` lines 89–96
**Apply to:** all restore degrade warnings (`src/restore/cli.ts`)
```typescript
// src/state/janitor.ts:89-96
function warnJanitor(message: string, sessionId?: string): void {
  try {
    const payload = sessionId === undefined ? { warn: message } : { warn: message, sessionId }
    process.stderr.write(JSON.stringify(payload) + '\n')
  } catch {
    // Even a broken stderr must never break the janitor (total-error policy).
  }
}
```
(Operator-facing summary copy may be human-prose `[mrclean] ...` per `runIgnore` — the JSON shape is for machine-parsed degrade warns; either way: no values, no map contents. Hostile-shaped input is never echoed — `src/state/index.ts` lines 106–114.)

### Total-error read + degrade-never-throw
**Source:** `src/state/map-store.ts` lines 295–307 (read), `src/state/index.ts` lines 251–282 (belt-and-braces catch + one warn + degraded status)
**Apply to:** every restore data-path function; `runRestore` top level (exit 0 on cosmetic degrade)

### LOCKED no-raw builder comment + destructure-pick (never blind-spread)
**Source:** `src/audit/log.ts` lines 145–195
**Apply to:** `buildRestoreAuditRecord`; also the status counters object (counts only, built field-by-field)

### Dynamic-import subcommand (hook cold path untouched)
**Source:** `src/cli.ts` lines 66–73, 79–81 (cold-path rationale comment)
**Apply to:** the `restore` subcommand registration

### baseDir/HOME injection test seams
**Source:** `src/state/index.ts` lines 77–80 (`baseDir` override is TEST-ONLY); `tests/state/chaos.test.ts` lines 171–187 (`makeHome`/`makeCwd` + `vi.stubEnv('HOME', ...)`); `tests/state/inspection.test.ts` lines 135–143 (tmpdir baseDir per test)
**Apply to:** all new restore/status tests — never touch the real `~/.mrclean`

### Non-vacuity guards (anti-vacuous-pass)
**Source:** `tests/audit/pii-canary-leak.test.ts` lines 105–124 (line-count guard); `tests/state/cold-path.test.ts` lines 206, 224–228 (walk-count + positive control); `tests/state/chaos.test.ts` lines 224–227 (v2-tail probe proves the reversible branch ran)
**Apply to:** every new leak-grep and fence test — assert the thing happened before asserting it was clean

### win32 documented-gap visible skip
**Source:** `tests/state/inspection.test.ts` lines 209–213; `tests/state/chaos.test.ts` lines 315–321
**Apply to:** any restore test using chmod-000 or HOME stubs (`describe.skipIf(IS_WIN32)` + placeholder test so the skip shows in reporter output)

## No Analog Found

| File / Concern | Role | Data Flow | Reason + fallback |
|----------------|------|-----------|-------------------|
| stdin read-to-EOF in `src/restore/cli.ts` | controller input | streaming read | The only in-repo stdin reader (`src/hook/stdin.ts` `readStdinWithTimeout`, used at `src/hook/index.ts:39`) is timeout-based hook-contract behavior — deliberately wrong for an operator pipe. Use RESEARCH Code Example 3's `for await (const chunk of stream)` accumulate; do not import the hook's reader (would also violate the no-hook-import fence). |
| Union-index across ALL decryptable maps | service | file-I/O | The janitor enumerates sessions but never decrypts; the facade decrypts exactly one sid. The composition (enumerate → decrypt-each → merge) is new; both halves have exact analogs (janitor candidacy + `readSessionMapFile`), only the loop is novel. Cross-session key collisions are structurally absent (nonce8 in every token). |
| Second discriminated record type in `audit.jsonl` | model | append | `AuditRecord` is currently the only line shape. The discriminated-union move (`action: 'restore'` as the discriminant) has no precedent line to copy — follow RESEARCH Pattern 6 + Assumption A3; `assertNoCanaryLeak` needs no changes (per-line JSON parse + substring scan). |

## Landmines (verified this session — planner must respect)

- **Do NOT create `src/mcp/tools/restore.ts`.** `vitest.config.ts` line 42 excludes it from coverage as dead history ("Deleted in plan 03-01"); recreating it resurrects a banned surface (`restore` is on `FORBIDDEN_TOOL_NAMES`, `tests/mcp/tools-list.test.ts` lines 53–69) and breaks T2's exact-three assertion (line 100: `['mrclean_check', 'mrclean_redact', 'mrclean_status']`).
- **Doctor wiring already exists.** `src/doctor/index.ts` line 150 already pushes `checkReversibleState(homeDir, cwd)` and `computeExitCode` already aggregates `exitCodeOnFail` — the upgrade is confined to `src/doctor/checks.ts` + tests; no `index.ts` edits.
- **Byte-locked copy:** the three `REVERSIBLE_DETAIL_*` constants (checks.ts 557–560) and the Tests 15–17 `toEqual` objects must survive the upgrade byte-identically.
- **Zero-diff trees:** `src/hook/**`, `src/detect/**`, `src/placeholder/**` (and their test trees) take no edits — the phase regression gate greps `git diff --stat` empty over them.
- **Test routing:** `tests/restore/**` lands in the unit project by the default glob (`vitest.config.ts` line 71); any test promoted to integration must be added to the integration `include` allowlist (line 109) AND removed from unit via the exclude list — a file cannot belong to both projects.
- **`/g` regex state:** any shared global scan regex needs a non-global probe copy for `toMatch` assertions (chaos.test.ts lines 89–91 precedent).

## Metadata

**Analog search scope:** `src/state/`, `src/audit/`, `src/doctor/`, `src/mcp/tools/`, `src/install/`, `src/hook/`, `src/config/`, `src/detect/` (findings only), `src/cli.ts`; `tests/state/`, `tests/audit/`, `tests/cli/`, `tests/mcp/`, `tests/doctor/`
**Files read in full:** 18 (session-map, map-store, janitor, state/index, cli, audit/log, canary-leak, doctor/checks, status, install/ignore, hook/index, cold-path.test, chaos.test, inspection.test, pii-canary-leak.test, ignore.test, status.test, tools-list.test) — plus targeted reads of config/index.ts (320–519), findings.ts (55–90), doctor checks.test.ts (440–552)
**Pattern extraction date:** 2026-07-17
