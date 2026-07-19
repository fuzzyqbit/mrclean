# Phase 11: Wire-Safety Verification & Hardening - Pattern Map

**Mapped:** 2026-07-17
**Files analyzed:** 16 new/modified files
**Analogs found:** 15 / 16 (the fs monkey-patch SEAM inside fs-interception has no in-repo analog — covered by the RESEARCH Pattern 3 verified probe)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tests/hook/dist-parity.test.ts` (NEW) | test (integration, spawn) | request-response (stdin→stdout) | `tests/hook/integration.test.ts` + `tests/state/chaos.test.ts` | exact |
| `tests/state/fs-interception.test.ts` (NEW) | test (unit, in-process) | file-I/O (write interception) | `tests/state/inspection.test.ts` (flow + byte-scan) + RESEARCH Pattern 3 probe (seam) | role-match |
| `tests/uat/wire-safety.test.ts` (NEW) | test (uat, opt-in live) | event-driven (live CC session) | `tests/uat/contract-verification.test.ts` (E1/MCP + E3 legs) + `tests/uat/live-session.test.ts` (sandbox) | exact |
| `tests/uat/fixtures/echo-mcp-server.mjs` (NEW) | fixture (MCP stdio server) | request-response | `src/mcp/tools/status.ts` registerTool + RESEARCH skeleton | role-match |
| `tests/uat/fixtures/postresp-log-hook.sh` (NEW) | fixture (observer hook) | event-driven (append side-file) | `tests/uat/fixtures/log-hook.sh` | exact |
| `tests/perf/post-tool-use-reversible.perf.test.ts` (NEW, optional) | test (perf) | request-response | `tests/perf/post-tool-use.perf.test.ts` + chaos `makeHome` seam | exact |
| `tests/copy-drift.test.ts` (EXTEND) | test (docs gate) | batch (file scan) | self — existing mechanics | self |
| `tests/restore/session-index.test.ts` (EXTEND, IN-02 row) | test (unit) | CRUD (encrypted store read) | self — `buildFixtureMap`/poisoned-map recipe | self |
| `tests/cli/restore.test.ts` / `tests/restore/degrade.test.ts` (EXTEND, IN-01 row) | test (unit) | request-response (CLI capture) | self — capture harness + `summaryLine` pin | self |
| `src/restore/session-index.ts` (MODIFY, IN-02) | service (read-only index) | CRUD (read) | self — OVF-exclusion treatment 3 lines above the fix site | self |
| `src/restore/cli.ts` (MODIFY, IN-01) | controller (CLI action) | request-response (stdin→stdout) | self — catch block + `ZERO_COUNTS` already in file | self |
| `src/shared/strings.ts` (MODIFY, additive) | config (copy constants) | — | self — existing claim-shape regex pattern | self |
| `.github/workflows/canary-leak.yml` / `test.yml` (EXTEND) | config (CI) | batch | self — canary-leak.yml step + grep pattern | self |
| `vitest.config.ts` (MODIFY, dual-listing) | config | — | self — stress.test.ts dual-listing entries | self |
| `THREAT_MODEL.md` (MODIFY, SC5) | docs | — | self — existing `## Reversible Mode (v3.0)` section | self |
| `docs/HOOK-CONTRACT.md` (EXTEND) | docs | — | self — E-section shape (matrix + evidence + implications) | self |

## Pattern Assignments

### `tests/hook/dist-parity.test.ts` (test/integration, request-response) — SC1a

**Analogs:** `tests/hook/integration.test.ts` (spawn recipe), `tests/state/chaos.test.ts` (constants + normalization + parity assertion), `vitest.config.ts` (dual-listing)

**Spawn recipe** (`tests/hook/integration.test.ts` lines 19-42) — sandbox HOME per run, USERPROFILE mirrored:
```typescript
const DIST_CLI = path.resolve(process.cwd(), 'dist/cli.js')
const SANDBOX_HOME = mkdtempSync(path.join(tmpdir(), 'mrclean-hook-int-home-'))

function runHook(payload: string, extraEnv: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [DIST_CLI, 'hook'], {
    input: payload,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, HOME: SANDBOX_HOME, USERPROFILE: SANDBOX_HOME, ...extraEnv },
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}
```
Dist-parity needs TWO homes (one-way vs reversible) — mint each with `mkdtempSync`, write `<homeRev>/.mrclean/config.toml` containing `[reversible]\nenabled = true\n` (chaos `makeHome`, lines 171-179).

**PostToolUse payload shape** (`tests/hook/integration.test.ts` lines 71-80; secret-bearing variant `tests/state/chaos.test.ts` lines 128-139):
```typescript
// chaos.test.ts makeInput — the canary-bearing payload to reuse; fresh randomUUID() sid PER run
{
  hook_event_name: 'PostToolUse', session_id: sid, transcript_path: '/tmp/transcript',
  cwd, tool_name: 'Bash', tool_input: { command: 'deploy' },
  tool_response: `deploy log: credential ${SECRET} accepted`, tool_use_id: 'tool-chaos',
}
```

**Pinned constants — DUPLICATE, never re-derive or import across suites** (`tests/state/chaos.test.ts` lines 78, 89-91):
```typescript
const SECRET = 'AKIAIOSFODNN7EXAMPLX'  // the AWS-docs EXAMPLE key is gitleaks-allowlisted — X-suffix required
const V2_TAIL_RE = /(<MRCLEAN:[A-Z0-9_]+:(?:\d{3}|OVF)):[a-f0-9]{8}>/g
const V2_TAIL_PROBE = /<MRCLEAN:[A-Z0-9_]+:(?:\d{3}|OVF):[a-f0-9]{8}>/  // non-global copy (toMatch + /g carries lastIndex)
```

**Normalization + parity assertion** (`tests/state/chaos.test.ts` lines 141-144, 216-232):
```typescript
function stripNonceTails(output: PostToolUseOutput | null): unknown {
  return JSON.parse(JSON.stringify(output).replace(V2_TAIL_RE, '$1>'))
}
// Assertion ORDER (non-vacuity BEFORE parity — a silent config miss makes parity trivially true):
expect(JSON.stringify(baseline)).not.toContain(SECRET)
expect(JSON.stringify(enabled)).not.toContain(SECRET)
expect(JSON.stringify(enabled)).toMatch(V2_TAIL_PROBE)      // reversible branch REALLY engaged
expect(JSON.stringify(baseline)).not.toMatch(V2_TAIL_PROBE)
expect(stripNonceTails(enabled)).toEqual(baseline)          // deep-equal after nonce-tail strip
```
At dist level the assertions run over parsed stdout: exit 0 both runs, stdout non-empty both (substitution occurred), plus the map-file spot-check (`<homeRev>/.mrclean/sessions/<sid>.map` exists, raw bytes lack SECRET — read with `readFile`, assert `raw.includes(SECRET) === false`, inspection.test.ts lines 169-177 shape).

**win32 skip** (`tests/state/chaos.test.ts` lines 69, 153, 315-321): `const IS_WIN32 = process.platform === 'win32'`; `describe.skipIf(IS_WIN32)(...)` + a visible placeholder describe for the skip (HOME env is ignored by `os.homedir()` on win32).

**Build ownership:** do NOT copy integration.test.ts's `beforeAll` npm-build (lines 82-94) — the integration project's `globalSetup` (`vitest.config.ts` line 108) owns the tsup build; stress.test.ts relies on it with no own build step. Rely on globalSetup + dual-listing.

---

### `vitest.config.ts` dual-listing edit (config) — pairs with dist-parity

**Analog:** self — the stress.test.ts entries, copied verbatim with the non-vacuity comments.

**Unit exclude** (lines 83-87):
```typescript
// Plan 09-08: the SC5 stress gate spawns 16 real processes against
// the tsup-built dist/state-stress-worker.js — integration project
// only (needs the globalSetup build + sequential run). A file cannot
// belong to both projects, so exclude it from the unit glob.
'tests/state/stress.test.ts',
```

**Integration include** (lines 121-124):
```typescript
// Plan 09-08: explicit allow-list entry so --project=integration matches
// the SC5 16-process stress gate (non-vacuity — without this entry the
// run reports zero files). Spawns dist/state-stress-worker.js x16.
'tests/state/stress.test.ts',
```
Add the same paired entries for `tests/hook/dist-parity.test.ts` (unit exclude + integration include, each with a Plan-11 non-vacuity comment). NOTE: `tests/hook/integration.test.ts` is already unit-excluded at line 75, but a NEW file under `tests/hook/` matches the unit glob `tests/**/*.test.ts` — without the exclude it runs in unit against a possibly-stale dist (Pitfall 2, demonstrated 10-07).

---

### `tests/state/fs-interception.test.ts` (test/unit, file-I/O interception) — SC2

**Analogs:** `tests/state/inspection.test.ts` (the REAL flow to drive + byte-scan discipline + restore capture harness); RESEARCH.md Pattern 3 (the verified patch seam — no in-repo analog).

**The real two-event facade flow to run under the patch** (`tests/state/inspection.test.ts` lines 65-85) — copy this helper verbatim (Pitfall 10: hand-built state bypasses the serializer strip and invalidates the proof):
```typescript
async function runReversibleEvent(baseDir: string, sid: string, value: string, type: string) {
  const hydration = await readSessionMapForHydration({ sessionId: sid, baseDir })
  expect(hydration).not.toBeNull()
  const manager = new PlaceholderManager({ sessionId: sid })
  manager.hydrateReversible(hydration!)
  manager.allocate(value, type)
  const pending = manager.drainPendingAllocations()
  const persisted = await persistAllocations({ sessionId: sid, baseDir, pending, deadlineMs: POST_LOCK_DEADLINE_MS })
  expect(persisted.status).toBe('ok')
  return { counterFloor: hydration!.counterFloor, knownEntries: hydration!.entriesByHmac.size }
}
```
Canary constants (inspection lines 53-55): `WORD_ORIGINAL = 'inspect-word-original-alpha'`-style WORD + an X/INSPECT-suffixed AWS key (never `EXAMPLE`).

**The patch seam** (RESEARCH.md Pattern 3 — probe VERIFIED live 2026-07-17, Node v22.22.0; reaches BOTH map-store's ESM `import { writeFile } from 'node:fs/promises'` AND write-file-atomic's `promisify(fs.write)` fd temp-file writes):
```typescript
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'

const captured: Array<{ api: string; target: string; bytes: Buffer }> = []
const originals = { write: fs.write, pWriteFile: fsPromises.writeFile, pAppendFile: fsPromises.appendFile /* +sync & callback variants */ }
fsPromises.writeFile = function (p, data, o) { captured.push({ api: 'p.writeFile', target: String(p), bytes: toBuf(data) }); return originals.pWriteFile.call(this, p, data, o) } as typeof fsPromises.writeFile
fs.write = function (fd, data, ...rest) { captured.push({ api: 'fs.write', target: `fd:${fd}`, bytes: toBuf(data) }); return (originals.write as any).call(this, fd, data, ...rest) } as typeof fs.write
syncBuiltinESMExports()
try { /* runReversibleEvent x2 (WORD then AWS_KEY) + a real restore run */ }
finally { fs.write = originals.write; fsPromises.writeFile = originals.pWriteFile; /* restore ALL */ syncBuiltinESMExports() }
```
Patch install BEFORE the flow, restore in `finally` + re-sync (Pitfall 7). `vi.mock('node:fs')` does NOT reach write-file-atomic's `require('fs')` — do not substitute it.

**Restore-run leg** (`tests/state/inspection.test.ts` lines 245-285): copy `captureRestoreRun` **by value** (the file's own comment: "tests/cli/restore.test.ts capture harness, duplicated by value — never cross-imported") — dynamic `import('../../src/restore/cli.js')`, mirror-mock `process.exit`/`stdout.write`/`stderr.write`, repropagate non-exit throws. Feed stdin via `Readable.from([input])` where input carries the persisted placeholders read back through `readSessionMapFile` + `hmacAddress` (inspection lines 310-325).

**Assertions** (RESEARCH Pattern 3 — the three non-vacuity channel probes are load-bearing, not decoration):
```typescript
// ABSENCE: no captured.bytes contains WORD_ORIGINAL / SECRET_ORIGINAL / '"entries"'
// NON-VACUITY (all three write channels intercepted):
//   - some fs.write capture starts with 'MRCLNMAP'    → wfa TEMP-file envelope (map-store via write-file-atomic)
//   - some p.writeFile capture is 32 bytes to *.key.*  → key tmp (map-store.ts:210 publishKeyOnce)
//   - some appendFile capture targets audit.jsonl      → audit line, hash-only (audit log.ts:114 / restore-log.ts:116)
```
Routing: plain unit project (default `tests/**` glob — no config edit). Per-file worker isolation makes process-global patching safe.

---

### `tests/uat/wire-safety.test.ts` (test/uat, event-driven live) — SC1b + tool_response survey

**Analogs:** `tests/uat/contract-verification.test.ts` (primary — helpers, MCP leg, resume leg, findings writer), `tests/uat/live-session.test.ts` (sandbox setup + real-hook registration), `tests/uat/harness.ts` (import, never reimplement).

**Harness imports** (`tests/uat/harness.ts` lines 19-21, 69-82, 85-138) — `runClaude(prompt, settingsPath, options)` handles `--mcp-config <path> --strict-mcp-config`, `--settings`, stream-json parsing; `assertSessionRan(run)` is the auth-failure vacuous-pass guard. Options: `cwd`, `mcpConfigPath`, `extraArgs`, `env`, `maxTurns`, `timeoutMs`.

**Suite skeleton** (`tests/uat/live-session.test.ts` lines 42, 77-132 and `contract-verification.test.ts` lines 304-354):
```typescript
const UAT_ENABLED = process.env.MRCLEAN_UAT === '1'
describe.skipIf(!UAT_ENABLED)('@uat wire safety (REVMODE-11 SC1b)', () => {
  beforeAll(() => {
    // preflight: claude --version must succeed — fail LOUD, never skip (c-v lines 307-313)
    // fresh build unless SKIP_BUILD=1 (c-v lines 325-330)
    // sandbox = mkdtempSync(path.join(tmpdir(), 'mrclean-wire-')); projectDir inside it
  }, 240_000)
  afterAll(() => { /* findings writer (below) + rmSync(sandbox, { recursive: true, force: true }) */ })
})
```

**Sandbox settings + hook registration** (`tests/uat/contract-verification.test.ts` lines 122-138 + `live-session.test.ts` lines 39, 61-75):
```typescript
// c-v writeSettings/hookEntry/fixtureCmd — sandbox --settings JSON, never ~/.claude/settings.json
function writeSettings(name: string, hooks: Record<string, unknown>): string {
  const p = path.join(sandbox, name); writeFileSync(p, JSON.stringify({ hooks }, null, 2)); return p
}
function hookEntry(command: string, matcher?: string): Record<string, unknown> {
  const entry: Record<string, unknown> = { hooks: [{ type: 'command', command, timeout: 30 }] }
  if (matcher !== undefined) entry['matcher'] = matcher
  return entry
}
function fixtureCmd(scriptPath: string, envVar: string, envValue: string): string {
  return `${envVar}="${envValue}" "${scriptPath}"`   // env baked into the COMMAND STRING — the HOME-prefix seam
}
// live-session: the REAL fail-closed wrapper — single source of truth for the hook command shape
import { buildHookCommand } from '../../src/install/settings.js'
const hookCommand = buildHookCommand(process.execPath, DIST_CLI)
```
For the HOME prefix (A1): prefix mrclean's hook command string only — `HOME="<sandboxMrcleanHome>" <wrapped command>` (fixtureCmd precedent) — `claude` itself keeps real HOME for auth/transcripts. Same `env: { ...process.env, HOME: sandboxMrcleanHome }` override on the spawned `dist/cli.js restore` leg.

**MCP fixture wiring + eager tool discovery** (`tests/uat/contract-verification.test.ts` lines 345-353, 597-632):
```typescript
// mcp.json (fixture server registration — canary env-fed, NEVER in the prompt):
{ mcpServers: { 'wire-canary': { type: 'stdio', command: process.execPath, args: [FIXTURE_MJS] /* + env: CANARY_TEXT */ } } }
// run recipe (E1/MCP leg — every knob is a harness-integrity fix observed on 2.1.209):
const run = runClaude('Call the MCP tool named mcp__wire-canary__echo_project_notes ... quote back verbatim ...', settings, {
  cwd: projectDir, mcpConfigPath,
  extraArgs: ['--allowedTools', 'mcp__wire-canary__echo_project_notes', '--disallowedTools', 'Task'],
  env: { ENABLE_TOOL_SEARCH: 'false' },   // deferred tool discovery burns turns otherwise
  maxTurns: 6, timeoutMs: 220_000,
})
assertSessionRan(run)
const mcpSrv = (run.init?.mcp_servers ?? []).find((s) => s.name === 'wire-canary')
expect(mcpSrv?.status, 'harness integrity: fixture MCP server not connected').toBe('connected')
```

**Transcript + stream scans** (`tests/uat/contract-verification.test.ts` lines 154-163, 181-223) — import-or-duplicate these three helpers:
- `extractToolResultText(run)` — serialized `tool_result` blocks from stream-json `user` events (lines 154-163)
- `findTranscript(sessionId)` — scans `~/.claude/projects/<any>/<sid>.jsonl` (slug format undocumented — UUID scan is the proven approach, lines 181-195)
- `extractTranscriptToolData(path)` — `tool_result` + `tool_use` from the persisted transcript (lines 204-223)
Plus SC1b's whole-dir grep: canaries are globally unique strings, so grepping ALL of `~/.claude/projects/**/*.jsonl` is safe and strictly stronger.

**Resume leg** (`tests/uat/contract-verification.test.ts` lines 707-728):
```typescript
const sid1 = run1.init?.session_id ?? /* side-file fallback */
let run2 = runClaude('...', settings, { cwd: projectDir, extraArgs: ['--resume', sid1] })
if (run2.resultEvent === undefined) {   // A3 fallback, coded in E3
  run2 = runClaude('...', settings, { cwd: projectDir, extraArgs: ['--continue'] })
}
assertSessionRan(run2)
```

**Non-vacuity chain BEFORE any absence assertion** (Pitfall 9, 10-08 ordering discipline): v2-tail probe on transcript tool_result → sandbox `sessions/<sid>.map` exists → restore stdout CONTAINS the WORD original with `restored=1`+ in the summary stderr line → only then grep for canary absence.

**Findings writer** (`tests/uat/contract-verification.test.ts` lines 356-383 + `tests/uat/findings-builder.ts` lines 27-44, 227): record-don't-assert survey verdicts go through `buildFindingsArtifact(previous, run)` — guard returns null on zero verdicts; a present-but-unparseable artifact fails LOUD (refuse to overwrite). Types: `ToolVerdict` (line 27), `ExperimentRecord` (line 33), `RunRecords` (line 44).

**Survey legs:** register `postresp-log-hook.sh` as an ADDITIONAL PostToolUse hookEntry (hooks on the same event run in parallel — A5) across Bash/Read/Grep/MCP legs; entries land in a side file via `fixtureCmd(POSTRESP_HOOK, 'E_LOG', logPath)`; parse with the `readLogEntries` shape (c-v lines 231-243).

---

### `tests/uat/fixtures/echo-mcp-server.mjs` (fixture MCP server, request-response)

**Analogs:** RESEARCH.md Code Examples skeleton + `src/mcp/tools/status.ts` lines 82-96 (in-repo `registerTool` ground truth — verify signature against the installed SDK at implementation time, assumption A6).

**registerTool signature as shipped** (`src/mcp/tools/status.ts` lines 82-96):
```typescript
server.registerTool(
  'mrclean_status',
  {
    title: '...', description: '...',
    inputSchema: statusInputSchema, outputSchema: statusOutputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (_args) => { /* ... returns { content: [...], structuredContent: {...} } */ },
)
```

**Fixture skeleton** (RESEARCH.md lines 419-430 — ~40 lines, canary via env, NEVER in prompt):
```javascript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
const server = new McpServer({ name: 'wire-canary', version: '0.0.0' })
server.registerTool('echo_project_notes',
  { description: 'returns project notes', inputSchema: {} },
  async () => ({ content: [{ type: 'text', text: process.env.CANARY_TEXT ?? '' }] }))
await server.connect(new StdioServerTransport())
```
Constraint: tool name must NOT match `MRCLEAN_TOOL_RE` (`src/hook/handlers/post-tool-use.ts` line 64: `/^mcp__(plugin_mrclean_mrclean|mrclean)__mrclean_(check|redact|status)$/`) — mrclean self-exempts its own tools; the fixture must be foreign-named.

---

### `tests/uat/fixtures/postresp-log-hook.sh` (fixture observer hook, event-driven)

**Analog:** `tests/uat/fixtures/log-hook.sh` (exact — sibling file, lines 12-18):
```sh
#!/bin/sh
# jq-free node one-liner — zero fixture deps. Emits NOTHING on stdout (pure observer).
node -e '
  let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
    const p=JSON.parse(d);
    require("fs").appendFileSync(process.env.E_LOG,
      JSON.stringify({e:p.hook_event_name,sid:p.session_id,src:p.source??p.reason??null})+"\n");
  })'
exit 0
```
The new sibling appends `{tool_name, typeof tool_response, raw tool_response JSON (truncated)}` instead. Keep: `exit 0` always, empty stdout, `E_LOG` env var via fixtureCmd, `chmod +x` on the file (match existing fixtures).

---

### `tests/copy-drift.test.ts` extension (test/docs gate) — SC5 paired edit

**Analog:** self. Extension mechanics all exist in the file:

**Add doctor copy source** — `SCANNED_SOURCES` (lines 36-46): append `{ rel: 'src/doctor/checks.ts', isSource: true }` (its `encrypted session state adapter active` detail is user-facing encryption copy).

**Replace the 'design commitment' required phrase** (lines 166-168 — the assertion SC5's rewrite breaks; MUST change in the same commit as THREAT_MODEL.md):
```typescript
it("carries the honest-framing key phrase 'design commitment'", () => {
  expect(readThreatModel()).toContain('design commitment')
})
```
Keep `'transcript ratchet'` (lines 162-164). Replacement anchors per RESEARCH Open Question 3: a "verified against the shipped implementation" stamp line + the §4 same-user-attacker fragment.

**New banned-phrase rows follow the existing three-test pattern** (lines 80-106): scan test + positive control ("a synthetic overclaim IS flagged") + honest-copy self-check ("the honest qualification is NOT flagged"). H3-fragment additions ride `REQUIRED_REVERSIBLE_SUBSECTION_FRAGMENTS` (lines 131-137, `it.each` over stable heading fragments).

**UUID traceability constraint** (lines 188-215): every session UUID quoted in HOOK-CONTRACT.md must exist in `tests/uat/artifacts/contract-findings.json` — when the live leg re-stamps evidence, update doc and artifact TOGETHER.

---

### `src/shared/strings.ts` extension (config/copy constants) — SC5

**Analog:** self — `BANNED_COPY_PHRASES` (lines 41-51). New encryption-overclaim entries copy the claim-SHAPE discipline (ban the positive claim form, never the words honest copy needs — the same-user-attacker qualification must pass):
```typescript
export const BANNED_COPY_PHRASES: readonly RegExp[] = [
  /redacts? all PII/i,
  /\b(GDPR|HIPAA|CCPA)\b[^.]*compliant/i,
  /\bfully compliant\b/i,
  // "guarantees all" — the positive claim shape ONLY. NOT a bare /guarantee/.
  /\bguarantees? (that )?(all|every) /i,
]
```
Additions are ADDITIVE (append entries; each new regex gets the copy-drift positive-control + self-check rows).

---

### `src/restore/session-index.ts` IN-02 fix (service, CRUD-read)

**Analog:** self — the fix mirrors the OVF-exclusion treatment 3 lines above the fix site. Current loop (`src/restore/session-index.ts` lines 138-151; fix site = line 150's bare `set`):
```typescript
for (const entry of Object.values(map.entries)) {
  if (!isRestorableType(entry.type)) { secretPlaceholders.add(entry.placeholder); continue }
  if (!('original' in entry)) { continue }
  if (entry.placeholder.includes(OVF_LABEL)) { continue }  // ambiguous shared token — in NEITHER structure
  placeholders.set(entry.placeholder, entry.original)      // ← IN-02: silent last-write-wins on cross-session collision
}
```
**Fix shape** (RESEARCH lines 435-445 — ambiguous token restores NOTHING; track demotions so a third occurrence cannot re-set):
```typescript
const existing = placeholders.get(entry.placeholder)
if (demoted.has(entry.placeholder)) { continue }                    // local Set<string>, per-build
if (existing !== undefined && existing !== entry.original) {
  placeholders.delete(entry.placeholder)                            // demote to unmatched
  demoted.add(entry.placeholder)
  continue
}
placeholders.set(entry.placeholder, entry.original)
```
Constraint: file stays read-only, imports unchanged (`readdir` + map-store + session-map only) — the cold-path outbound allowlist fence (`tests/state/cold-path.test.ts`) fails on any new import.

---

### `src/restore/cli.ts` IN-01 fix (controller/CLI, request-response)

**Analog:** self. Fix site = the catch block (lines 211-221); `ZERO_COUNTS` already defined at line 111, `counts` declared `let counts = ZERO_COUNTS` at line 166. Current:
```typescript
} catch {
  // Belt-and-braces: an UNEXPECTED throw ... degrades one-way — output equals input,
  // constant warning, exit 0. Flags prevent double stdout/warn emission.
  if (!stdoutWritten) {
    process.stdout.write(input)          // ← IN-01b: unguarded — a rethrow here breaks the exit-0 contract
  }
  if (!warnedNoMaps) {
    process.stderr.write(WARN_NO_MAPS)
  }
}                                        // ← IN-01a: `counts` may hold pre-throw non-zero values → stale summary
```
**Fix shape** (~5 lines): first statement in the catch sets `counts = ZERO_COUNTS`; wrap the fallback `process.stdout.write(input)` in its own try/catch. Preserve: exitCode-and-return discipline (never `process.exit()` — WR-03, lines 142-159), summary line ALWAYS last on stderr (lines 223-224), constant-shape warnings (lines 75-77).

---

### `tests/restore/session-index.test.ts` IN-02 test row (test/unit)

**Analog:** self — two shipped recipes compose the row:

**Real-cipher fixture builders** (lines 76-97) — `buildFixtureMap(sid, specs)` + `persistFixtureMap(baseDir, map)` (real key via `ensureSessionKey`, real envelope via `writeSessionMapFile`). Two-session seeding shape: `seedUnionFixture` (lines 104-119).

**Forced-identical-placeholder seeding** — the 10-02 poisoned-map recipe (lines 323-350): hand-build the map JSON (bypasses the serializer), encrypt with `encryptMapBuffer(Buffer.from(json), key, sid)`, `mkdir(sessionsDir, { recursive: true, mode: 0o700 })`, `writeFile(mapPathFor(baseDir, sid), envelope, { mode: 0o600 })`. For IN-02: seed TWO sessions whose hand-built entries carry the SAME `placeholder` string with DIFFERENT `original` values; assert the collided placeholder is in NEITHER `placeholders` nor restored output (demoted to unmatched), with the poisoned-map non-vacuity discipline (lines 355-369: prove both maps decrypted — `sessions === 2` — before the absence assertions).

---

### `tests/cli/restore.test.ts` / `tests/restore/degrade.test.ts` IN-01 test row (test/unit)

**Analog:** self. The capture harness (`tests/cli/restore.test.ts` lines 166-216; duplicated-by-value convention) stubs `process.exit` to THROW as a regression guard and reads `process.exitCode`. The byte-locked summary pin (lines 55-61):
```typescript
return `[mrclean] restore: restored=${restored} unmatched=${unmatched} secret-skipped=${secretSkipped} sessions=${sessions}\n`
```
Degrade rows a-f live at `tests/restore/degrade.test.ts` lines 281-335 (each corruption shape ⇒ pass-through + warning + exit 0). The IN-01 row forces the outer catch to fire AFTER counts were computed (e.g., stub a late step to throw) and asserts the summary line is the ZERO_COUNTS form — `restored=0 unmatched=0 secret-skipped=0 sessions=0` — plus exit 0 with output === input.

---

### `.github/workflows/canary-leak.yml` / `test.yml` extension (CI config) — SC3/SC4 elevation

**Analog:** self — `canary-leak.yml` step pattern (lines 33-39 vitest step, 41-62 defense-in-depth grep, 77-93 array-driven grep):
```yaml
- name: Wire-safety — restore leak-grep + chaos + dist parity (REVMODE-11)
  run: |
    npx vitest run --project=unit tests/audit/restore-canary-leak.test.ts tests/state/chaos.test.ts
    npx vitest run --project=integration tests/hook/dist-parity.test.ts tests/state/stress.test.ts
- name: Defense-in-depth grep — reversible canary corpus absent from audit logs
  run: |          # extend the existing PII_CANARIES array loop pattern (canary-leak.yml lines 77-93)
    CANARIES=( "zz-canary-project-path-7g2" "kim.canary@zz.invalid" "AKIAIOSFODNN7EXAMPLX" )
    ...grep -F "$val" .mrclean/audit*.jsonl → ::error + exit 1 on hit
```
Anti-vacuity (Pitfall 2 — demonstrated in 10-07): `npx vitest run <file> --project=X` exits 0 with ZERO files when the file is not in X's include list. Options: pipe through `tee /dev/stderr | grep -q "Test Files.*[1-9]"`, or a unit meta-test asserting the vitest.config include/exclude entries, plus a one-time deliberate mis-rooting sabotage check.

`test.yml` facts: triggers push/PR → main ONLY (lines 3-7); 3-Node matrix runs `npm test` (line 38); the QA-02 grep step (lines 40-49) is the in-workflow shell-assertion precedent. Optional `workflow_dispatch` addition (RESEARCH Open Question 1) retires the ubuntu-first-run stress risk — the 500 ms `WORKER_DEADLINE_MS` knob (`tests/state/stress.test.ts` line 59, header lines 26-35) is the ONLY tunable; the zero-degrade assertion is NEVER the knob (T-09-08-06).

---

### `tests/perf/post-tool-use-reversible.perf.test.ts` (test/perf, optional — cut first)

**Analog:** `tests/perf/post-tool-use.perf.test.ts` (exact — copy whole structure): plain `test()` + `performance.now()`, `N = 50`, `WARMUP = 5`, `THRESHOLD = 200`, manual `p95()` (lines 44-48), console log with headroom % (lines 87-89), integration project via the existing `tests/perf/**` glob (no config edit — perf.yml picks it up, `.github/workflows/perf.yml`). Delta vs analog: drive `handlePostToolUse` (NOT `runDetection` — the analog's gap is exactly that the reversible persist path is unmeasured) with the chaos HOME-stub seam (`tests/state/chaos.test.ts` lines 171-179 `makeHome(true)` + `vi.stubEnv('HOME', home)`).

---

### `THREAT_MODEL.md` + `docs/HOOK-CONTRACT.md` (docs) — SC5 + survey output

**THREAT_MODEL.md:** `## Reversible Mode (v3.0)` at line 141; H3s at 151 (Map blast radius), 171 (structural secret floor), 189 (Wire re-entry), 226 (Key-custody honesty), 244 (Accepted residual risks). The phrase `design commitment` occurs at lines 147, 154, 210 — the rewrite removes all three ⇒ paired copy-drift edit in the same commit (Pitfall 8). Rewrite direction: commitments → shipped facts with gates cited; IN-02 fix shrinks the AR-10-05 residual to a documented note; AR-10-02/IN-03 stay accepted; cite #77587 as filed-and-open.

**docs/HOOK-CONTRACT.md:** new section "Per-tool tool_response shapes (PostToolUse input)" follows the existing E-section shape (heading + `### Per-tool matrix` + `### Evidence excerpt` + `### Downstream implications` — lines 19-76 for the E1 template; `## Re-verification procedure` at line 211). Version stamps: record 2.1.212 alongside re-stamped verdicts; every quoted session UUID must trace to contract-findings.json (copy-drift gate lines 188-215).

## Shared Patterns

### Pinned canary corpus (reuse verbatim — 10-08 pinned)
**Source:** `tests/audit/restore-canary-leak.test.ts` lines 67-81
```typescript
const WORD_CANARY = 'zz-canary-project-path-7g2'
const EMAIL_CANARY = 'kim.canary@zz.invalid'
const SECRET_CANARY = 'AKIAIOSFODNN7EXAMPLX'  // deliberately non-EXAMPLE-suffixed (allowlist trap)
```
**Apply to:** dist-parity, fs-interception, wire-safety, CI grep steps. Words-file entry for the live leg uses `zz-canary-project-path-7g2|warn` (`word|action` grammar; `|warn` so UserPromptSubmit never blocks — Pitfall 3).

### Duplicate-don't-import constants discipline
**Source:** `tests/state/chaos.test.ts` lines 83-91 ("duplicated, not re-derived"), `tests/state/inspection.test.ts` capture-harness comment (lines 240-244, "duplicated by value — never cross-imported")
**Apply to:** every new test file. `V2_TAIL_RE`, `V2_TAIL_PROBE`, `CT_OFFSET = 37`, envelope magic `'MRCLNMAP'`, `captureRestoreRun` — copy the pinned values/helpers into the new file with a "duplicate, do not re-derive" comment. The grammar sync-lock test catches drift.

### Non-vacuity probes before absence assertions
**Source:** `tests/state/chaos.test.ts` lines 223-227 (V2_TAIL_PROBE), `tests/state/inspection.test.ts` lines 329-330 (restored output proven before byte-scan), `tests/copy-drift.test.ts` lines 96-101 (positive control), stress family 5 (zero degrades is load-bearing)
**Apply to:** every gate in this phase (RESEARCH threat table row 1: "vacuous gate" is the phase's #1 threat). Order: prove-the-mechanism-engaged → then assert absence.

### win32 visible skip
**Source:** `tests/state/chaos.test.ts` lines 69-71, 153, 315-321
**Apply to:** dist-parity and fs-interception (both use HOME redirection). `describe.skipIf(IS_WIN32)` + a `describe.skipIf(!IS_WIN32)` placeholder suite so the skip is visible in reporter output; chmod-style rows also guard `IS_ROOT`.

### Sandbox isolation (three tiers)
**Source:** `tests/hook/integration.test.ts` lines 24, 35 (spawn env HOME); `tests/state/chaos.test.ts` lines 171-186 + 209-211 (`vi.stubEnv('HOME')` per run + cleanupDirs + `afterEach` rm); `tests/uat/contract-verification.test.ts` lines 122-138 (`--settings`/`--mcp-config --strict-mcp-config`, fixtureCmd env-prefix)
**Apply to:** all new tests. Never write `~/.claude/settings.json`; never let a spawned hook see the developer's real `~/.mrclean`; for the live leg, HOME-prefix the hook command ONLY (whole-process HOME override kills claude auth — Pitfall 4).

### Frozen-tree fence
**Source:** RESEARCH Locked Decisions + `tests/state/cold-path.test.ts` (both-direction import fences)
**Apply to:** all plans. No task may modify `src/hook/**`, `src/detect/**`, `src/placeholder/**` — parity is asserted THROUGH them. The one sanctioned new file under `tests/hook/` is `dist-parity.test.ts` (name it explicitly in the phase-gate zero-diff command). IN-01/IN-02 touch ONLY `src/restore/**` with unchanged imports.

## No Analog Found

| File / Mechanism | Role | Data Flow | Resolution |
|------------------|------|-----------|------------|
| fs builtin monkey-patch seam (inside `tests/state/fs-interception.test.ts`) | test seam | file-I/O interception | No in-repo precedent — use RESEARCH.md Pattern 3 + Code Examples verbatim (probe executed and VERIFIED 2026-07-17 on Node v22.22.0 against the repo's write-file-atomic). Everything AROUND the seam (flow, canaries, byte assertions, restore capture) copies inspection.test.ts. |

## Metadata

**Analog search scope:** tests/hook, tests/state, tests/uat (+fixtures), tests/restore, tests/cli, tests/audit, tests/perf, tests/copy-drift.test.ts, src/restore, src/shared, src/mcp/tools, src/hook/handlers (read-only reference), .github/workflows, vitest.config.ts, THREAT_MODEL.md, docs/HOOK-CONTRACT.md
**Files scanned:** 24 read (full or targeted non-overlapping ranges) + 6 grep-located
**Pattern extraction date:** 2026-07-17
**Commands:** `npm test` / `npx vitest run --project=<unit|integration> <file>` / `MRCLEAN_UAT=1 npm run test:uat` / `npm run typecheck` (package.json lines 52-60)
