# Phase 8: Contract Verification & Reversible Plumbing - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 16 new/modified files
**Analogs found:** 14 / 16 (2 new-artifact-class docs use style references only)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/hook/handlers/session-end.ts` (NEW) | hook handler | event-driven (no-op) | `src/hook/handlers/session-start.ts` | role-exact (copy shape, NOT body) |
| `src/hook/dispatcher.ts` (MOD) | dispatcher | request-response | itself (switch cases, lines 32–50) | exact (self) |
| `src/shared/types.ts` (MOD) | types/contract | — | itself (`SessionStartInput` lines 28–32, union lines 71–75) | exact (self) |
| `src/config/defaults.ts` (MOD) | config | — | `pii` frozen default (lines 33–66) | exact |
| `src/config/index.ts` (MOD) | config validator/merge | transform | `validatePiiConfig` (lines 306–341) + `parseToml` pii branch (419–421) + `mergeConfigs` pii block (499–556) | exact |
| `src/install/settings.ts` (MOD) | installer config | file-I/O | itself (`HOOK_EVENTS` line 18, `HOOK_MATCHERS` 22–27, filter-and-replace 131–151) | exact (self) |
| `src/doctor/checks.ts` (MOD) | doctor check | request-response | `checkModelCache` (lines 452–484) + `checkConfigLoad` (490–541) | exact |
| `src/doctor/report.ts` | doctor renderer | request-response | — (likely ZERO changes — see assignment) | n/a |
| `src/doctor/version-check.ts` (MOD, E1-gated) | doctor check | request-response | itself (green-detail copy, lines 111–117) | exact (self) |
| `tests/uat/contract-verification.test.ts` (NEW) | test (live UAT) | event-driven E2E | `tests/uat/live-session.test.ts` | exact |
| `tests/install/settings.test.ts` (MOD) | test | file-I/O | itself (migration test lines 149–179; matcher assertion line 75) | exact (self) |
| `tests/hook/dispatcher.test.ts` (MOD) | test | request-response | itself (Test 11a lines 68–74, Test 11e lines 115–120) | exact (self) |
| `tests/config/reader.test.ts` (MOD) | test | transform | itself (Test 4 lines 97–102, Test 6 lines 114–129) | exact (self) |
| `tests/doctor/checks.test.ts` (MOD) | test | request-response | itself (`buildSettings` lines 37–52, `allEvents` line 81, `/4/` detail match line 88) | exact (self) |
| `THREAT_MODEL.md` (MOD) | docs | — | its own H3-numbered Non-Defense sections (§3 lines 34–44, §10 lines 109–137) | exact (self) |
| `docs/HOOK-CONTRACT.md` (NEW) | docs (findings) | — | none — new artifact class (style ref: THREAT_MODEL.md prose + types.ts version-stamp discipline) | no-analog |
| `docs/upstream/display-only-channel-request.md` (NEW, optional home) | docs (issue draft) | — | none — upstream `feature_request.yml` template drives structure | no-analog |
| `.planning/PROJECT.md` + `CLAUDE.md` (MOD) | docs | — | one-sentence amendment (no pattern needed) | n/a |
| `tests/copy-drift.test.ts` (MOD) | test | transform | itself (disclaimer-presence gate lines 106–117, `SCANNED_SOURCES` lines 36–43) | exact (self) |

## Pattern Assignments

### `src/hook/handlers/session-end.ts` (hook handler, event-driven no-op) — NEW

**Analog:** `src/hook/handlers/session-start.ts`

**CRITICAL:** Copy the *signature shape and file conventions* only. Do **NOT** copy the body — session-start loads config and initializes state; the SessionEnd handler must be a pure `return null` (RESEARCH Pattern 4: config load in this handler → `ConfigReadError` → exit-2 noise at every session end).

**File-header + import pattern** (`src/hook/handlers/session-start.ts` lines 1–26 — phase-stamped JSDoc header, relative `.js`-suffixed ESM imports, `type` imports from shared/types):
```typescript
/**
 * SessionStart hook handler — Phase 2 wired (Plan 02-05).
 * ...
 */
import type { SessionStartInput, SessionStartOutput } from '../../shared/types.js'
```

**Handler signature pattern** (lines 28, 54–59 — exported async function, typed input, typed Promise return):
```typescript
export async function handleSessionStart(input: SessionStartInput): Promise<SessionStartOutput> {
  ...
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ... } }
}
```

**Target shape** (RESEARCH.md lines 399–414 gives the full ready-to-use body — use it verbatim):
```typescript
export async function handleSessionEnd(_input: SessionEndInput): Promise<null> {
  return null
}
```
Note `Promise<null>` — `null` is already a member of `HookOutput` (`src/shared/types.ts` lines 140–145: "`null` means pass-through").

---

### `src/hook/dispatcher.ts` (dispatcher, request-response) — MOD

**Analog:** itself — the existing switch.

**Import pattern** (lines 10–14):
```typescript
import type { HookInput, HookOutput } from '../shared/types.js'
import { handleSessionStart } from './handlers/session-start.js'
```

**Case pattern to replicate** (lines 32–35 — add `case 'SessionEnd': return await handleSessionEnd(input)` alongside):
```typescript
  switch (input.hook_event_name) {
    case 'SessionStart':
      return await handleSessionStart(input)
```

**Default-throw MUST be preserved unchanged** (lines 45–49 — Pitfall 1: this throw is why the handler must land with/before installer registration):
```typescript
    default: {
      const eventName = (input as { hook_event_name: string }).hook_event_name
      throw new Error(`unknown hook event: ${eventName}`)
    }
```

---

### `src/shared/types.ts` (types/contract) — MOD

**Analog:** itself. Three edits, each with an in-file precedent.

**1. `hook_event_name` union widening** (`HookInputBase`, lines 17–22):
```typescript
export interface HookInputBase {
  session_id: string
  transcript_path: string
  cwd: string
  hook_event_name: 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse'  // += 'SessionEnd'
}
```

**2. `SessionEndInput` interface** — model on `SessionStartInput` (lines 28–32) but keep `reason` an OPEN string (RESEARCH Pattern 4; `SessionStartInput.source` is a closed union — do NOT copy that closedness):
```typescript
export interface SessionStartInput extends HookInputBase {
  hook_event_name: 'SessionStart'
  source: 'startup' | 'resume' | 'clear' | 'compact'   // closed — SessionEnd `reason` must be `string`
  model?: string
}
```
RESEARCH lines 219–228 gives the exact `SessionEndInput` with the `[CITED: code.claude.com/docs/en/hooks, fetched 2026-07-14]` JSDoc — the file's LOCKED header (lines 1–10) requires this citation discipline ("verified from code.claude.com/docs/en/hooks (2026-05-13)" — Phase 8 refreshes the date).

**3. `HookInput` union widening** (lines 71–75) — add `| SessionEndInput`.

**4. `MrcleanReversibleConfig`** — model on `MrcleanPiiConfig` (lines 264–274; keep ONLY `enabled` per YAGNI fence):
```typescript
export interface MrcleanPiiConfig {
  /**
   * Master switch. Default: false.
   * When false, behavior is byte-identical to v1 — absent-[pii] == v1 guarantee.
   */
  enabled: boolean
  ...
}
```
Add `reversible: MrcleanReversibleConfig` to `MrcleanConfig` (lines 289–311, after `pii` at line 310).

**5. E1-consuming JSDoc update** — `PostToolUseOutput.updatedToolOutput` (lines 127–134) currently says "When present, it replaces the tool output that re-enters the model context." E1's verdict (per-tool honored-ness, #68951) must be reflected here with version + date stamp.

---

### `src/config/defaults.ts` (config) — MOD

**Analog:** the `pii` frozen sub-table, lines 33–66 (its `enabled: false` master-switch comment at lines 10–13 is the exact framing to mirror).

**Pattern** (lines 18–20 + 33–34 — `Object.freeze` + `as unknown as` type assertion):
```typescript
export const DEFAULT_CONFIG: MrcleanConfig = Object.freeze({
  dry_run: false,
  ...
  pii: Object.freeze({
    enabled: false,
    ...
  }) as unknown as import('../shared/types.js').MrcleanPiiConfig,
})
```

**Target** (RESEARCH lines 205–210, ready to use — add after `pii`):
```typescript
  reversible: Object.freeze({
    enabled: false,   // master switch OFF; absent-[reversible] == shipped one-way guarantee
  }) as unknown as MrcleanReversibleConfig,
```

---

### `src/config/index.ts` (config validator + merge) — MOD

**Analog:** the `[pii]` plumbing — three insertion points, each 1:1.

**1. Validator** — mirror `validatePiiConfig` (lines 306–315) using the shared `isRecord` guard (lines 62–64) and `ConfigReadError` (lines 48–56):
```typescript
function validatePiiConfig(raw: unknown, filePath: string): MrcleanPiiConfig {
  if (!isRecord(raw)) {
    throw new ConfigReadError(filePath, '[pii] must be a TOML sub-table')
  }
  if ('enabled' in raw && typeof raw['enabled'] !== 'boolean') {
    throw new ConfigReadError(filePath, '[pii].enabled must be a boolean')
  }
  const enabled = 'enabled' in raw ? (raw['enabled'] as boolean) : DEFAULT_CONFIG.pii.enabled
  ...
}
```
RESEARCH lines 419–429 gives the finished `validateReversibleConfig`. Unknown keys inside `[reversible]` are ignored (matches parseToml tolerance, line 356: "Unknown top-level keys are silently ignored"); FAIL-loud is Phase 10.

**2. `parseToml` branch** — mirror the `pii` branch (lines 415–421):
```typescript
  // [pii] sub-table (Phase 4-02)
  // Absent [pii] → pii is undefined in the Partial; mergeConfigs fills in the default.
  if ('pii' in parsed) {
    result.pii = validatePiiConfig(parsed['pii'], filePath)
  }
```

**3. `mergeConfigs` LAST-WINS** — `reversible` is a flat single-boolean table, so the SIMPLE scalar pattern applies (lines 518–522), not the pii deep-merge (lines 529–553):
```typescript
  for (const layer of layers) {
    if (layer.dry_run !== undefined) dryRun = layer.dry_run
    if (layer.entropy !== undefined) entropy = layer.entropy
```
Seed from defaults like line 492 (`let entropy: MrcleanEntropyConfig = DEFAULT_CONFIG.entropy` — but copy into a new object for immutability, e.g. `let reversible = { enabled: DEFAULT_CONFIG.reversible.enabled }`), then add `reversible` to the return literal (line 556).

---

### `src/install/settings.ts` (installer config) — MOD

**Analog:** itself — two constant edits; `writeHookEntries` body needs ZERO changes (the filter-and-replace loop IS the migration, RESEARCH Pattern 5).

**Constants to widen** (lines 18–27, current shape):
```typescript
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'] as const
type HookEvent = (typeof HOOK_EVENTS)[number]

/** Matcher per event. `undefined` means no matcher field (UserPromptSubmit). */
const HOOK_MATCHERS: Record<HookEvent, string | undefined> = {
  SessionStart: 'startup',
  UserPromptSubmit: undefined,    // No matcher support per RESEARCH §1.1
  PreToolUse: '*',
  PostToolUse: '*',
}
```
Target shape at RESEARCH lines 384–394: `HOOK_EVENTS` += `'SessionEnd'`, `SessionStart: 'startup|resume|clear|compact'`, `SessionEnd: undefined` (no matcher — matcher filters on `reason`; handler must see ALL reasons).

**Why migration is free — the idempotent replace loop** (lines 131–151):
```typescript
  for (const event of HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) {
      hooks[event] = []
    }
    // Remove any existing mrclean entries (idempotency)
    hooks[event] = hooks[event].filter((entry) => !isMrcleanEntry(entry))
    ...
    hooks[event] = [...hooks[event], entry]
  }
```
`removeHookEntries` iterates `Object.keys(hooks)` (line 183) — uninstall handles SessionEnd with zero change. The `undefined`-matcher branch already exists (lines 146–148: UserPromptSubmit omits the `matcher` field entirely) — SessionEnd rides it.

---

### `src/doctor/checks.ts` (doctor check) — MOD

**Analog A — `REQUIRED_EVENTS` widening** (lines 45–50) plus the `4`-hardcoded PASS detail (lines 160–165):
```typescript
const REQUIRED_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
] as const
```
```typescript
  return {
    name: 'hooks',
    status: 'PASS',
    detail: `4 hook events registered (${REQUIRED_EVENTS.join(', ')})`,   // hardcoded "4" → derive from REQUIRED_EVENTS.length
    exitCodeOnFail: 1,
  }
```
`REQUIRED_EVENTS` is also iterated in `collectRegisteredBinPaths` (line 230) and `extractRegisteredPaths` (line 289) — widening the constant flows through both automatically.

**Analog B — new `checkReversibleState`: copy `checkModelCache`** (lines 452–484) — it is the shipped "reporting check that stays green for opted-out users" (SKIP/PASS with `exitCodeOnFail` reserved):
```typescript
export async function checkModelCache(homeDir: string): Promise<CheckResult> {
  const { isModelCached, verifyModelIntegrity } = await import('../model/model-cache.js')
  const cached = await isModelCached(homeDir)
  if (!cached) {
    return {
      name: 'model-cache',
      status: 'SKIP',
      detail: 'NER model not downloaded (PII NER opt-in required — run `mrclean pii fetch-model`)',
      exitCodeOnFail: 0,
    }
  }
  ...
}
```
For config loading + `ConfigReadError` handling inside the check, copy `checkConfigLoad` (lines 490–541 — `loadEffectiveConfig({ homeDir, cwd })` in try/catch, `err instanceof ConfigReadError` → FAIL with `exitCodeOnFail: 1`). RESEARCH Open Question 3 recommendation: reuse exit 1 (config domain) for the only FAIL case (enabled + CC version floor unmet) — do NOT extend the LOCKED exit-code map (file header, lines 10–16). Whichever the planner picks must be documented in that header.

**CheckResult shape** (lines 33–39):
```typescript
export interface CheckResult {
  name: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  detail: string
  exitCodeOnFail: number
}
```

---

### `src/doctor/report.ts` — likely NO changes

`renderReport` (lines 29–43) iterates `CheckResult[]` generically — a new check appended to the results array in `computeDoctorReport` (src/doctor/index.ts) renders with zero renderer changes. `computeExitCode` (lines 73–80) likewise. Only touch this file if a reversible-specific line is explicitly required; the pattern is "new check = new entry in the results array, renderer untouched."

---

### `src/doctor/version-check.ts` (doctor copy honesty) — MOD, E1-gated

**Analog:** itself. The overclaiming green detail (lines 111–117):
```typescript
  if (isFullyCompatible) {
    return {
      status: 'green',
      version,
      detail: `${version} — fully compatible (PostToolUse updatedToolOutput supported, full Phase 2 functionality)`,
    }
  }
```
If E1 confirms #68951 on 2.1.209, this copy must stop claiming `updatedToolOutput` is "supported" unqualified — reference the verified-on version per RESEARCH Pitfall 6. The yellow-path copy (lines 119–128) is the wording style to follow (capability-specific, versioned).

---

### `tests/uat/contract-verification.test.ts` (live UAT harness) — NEW

**Analog:** `tests/uat/live-session.test.ts` — copy the harness skeleton wholesale.

**Opt-in gate + skipIf** (lines 41, 172):
```typescript
const UAT_ENABLED = process.env.MRCLEAN_UAT === '1'
...
describe.skipIf(!UAT_ENABLED)('@uat live claude session (phase 01 human items)', () => {
```

**Vacuous-pass guard — reuse or lift `assertSessionRan`** (lines 81–94):
```typescript
function assertSessionRan(run: ClaudeRun): void {
  if (run.resultText.includes('Failed to authenticate')) {
    throw new Error(
      'BLOCKER: nested claude CLI could not authenticate ...')
  }
  if (run.resultEvent === undefined) {
    throw new Error(
      `BLOCKER: claude produced no result event — session never ran.\nstderr:\n${run.rawStderr}\nstdout tail:\n${run.rawStdout.slice(-1000)}`)
  }
}
```

**`runClaude` spawn + stream-json parse** (lines 120–170 — model/turn caps at lines 48–50: `claude-haiku-4-5`, `MAX_TURNS = 4`, `CLAUDE_TIMEOUT_MS = 150_000`):
```typescript
  const proc = spawnSync(
    'claude',
    ['-p', prompt, '--model', CLAUDE_MODEL, '--max-turns', String(MAX_TURNS),
     '--settings', settingsPath, '--mcp-config', mcpConfigPath, '--strict-mcp-config',
     '--output-format', 'stream-json', '--verbose', ...extraArgs],
    { cwd: projectDir, encoding: 'utf8', timeout: CLAUDE_TIMEOUT_MS, env: { ...process.env } },
  )
```

**Sandbox `beforeAll`** (lines 173–223): preflight `claude --version` fail-loud (176–182), `npm run build` unless `SKIP_BUILD=1` (184–193), `mkdtempSync` sandbox + sandbox-local settings JSON files (195–208), `afterAll` rmSync (225–227).

**Marker-string discipline** (line 53): `const CANARY_FILE = 'UAT_CANARY_7Q3X.txt'` — E1–E5 marker strings (`ORIGINAL_E1_MARKER_q7v4` etc., RESEARCH E1–E4) follow this style: unique suffix, never a real secret shape.

**Divergence from analog (Pattern 2 — record-don't-assert):** UAT-1/2a/2b hard-assert outcomes; the contract experiments must NOT. Hard-assert only harness integrity (`assertSessionRan`, hook fired, side file written); record contract verdicts to a findings artifact + console table. Fixture hooks (RESEARCH Pattern 1, settings-e1.json example at RESEARCH lines 164–178; jq-free node one-liner side-file hook at RESEARCH lines 433–444) replace mrclean's real hook as the instrument — `buildHookSettings` (lines 103–117) shows the settings-JSON shape to emit, but with minimal fixture commands instead of `buildHookCommand`.

**Transcript evidence source:** `~/.claude/projects/<cwd-slug>/<session_id>.jsonl` (E1/E2/E4 signals) — new to this harness; stream-json events are the shipped fallback.

---

### `tests/install/settings.test.ts` — MOD

**Analog:** itself.

**Assertions that change on purpose (Pitfall 3 inventory):**
- Line 46 + 127 + 170 + 369: `['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']` loops → 5 events.
- Line 75: `expect(entry.matcher).toBe('startup')` → `'startup|resume|clear|compact'`.
- New: SessionEnd entry has NO matcher property — copy the UserPromptSubmit assertion (lines 90–98):
```typescript
  it('UserPromptSubmit entry has no matcher property (no matcher support per RESEARCH §1.5)', async () => {
    ...
    const entry = data.hooks.UserPromptSubmit.find((e: Record<string, unknown>) => e._mrclean)
    expect(entry.matcher).toBeUndefined()
  })
```

**v2.0→v3.0 migration test — copy the shipped OLD-shape migration test verbatim as scaffold** (lines 149–179): seed a v2.0-shaped settings.json (4 events, `matcher: 'startup'`, plus a foreign user hook entry), run `writeHookEntries`, assert 5 events / widened matcher / exactly one `_mrclean` entry per event / foreign entry untouched:
```typescript
  it('migrates OLD-shape _mrclean entries to the new wrapper shape (no duplicate)', async () => {
    const seed = {
      hooks: {
        SessionStart: [{ _mrclean: true, matcher: 'startup', hooks: [oldHookCmd] }],
        ...
      },
    }
    await writeFile(settingsPath, JSON.stringify(seed, null, 2), 'utf8')
    await writeHookEntries(settingsPath, '/usr/bin/node', '/new/install/dist/cli.js', '0.1.0')
    const data = JSON.parse(await readFile(settingsPath, 'utf8'))
    for (const event of [...]) {
      const mrcleanEntries = data.hooks[event].filter((e) => e._mrclean === true)
      expect(mrcleanEntries).toHaveLength(1)
      ...
    }
  })
```
Foreign-hook preservation assertion pattern: lines 101–116 (`FIXTURE_WITH_HOOKS`, find `!e._mrclean`, `expect(userEntry.matcher).toBe('Bash')`).

---

### `tests/hook/dispatcher.test.ts` — MOD

**Analog:** itself.

**Mock preamble** (lines 13–51) — SessionEnd's no-op needs no new mocks (no config load, no I/O).

**Routing test — copy Test 11d's null-return shape** (lines 102–113, PostToolUse → null) rather than 11a (SessionStart asserts hookSpecificOutput):
```typescript
  it('Test 11d: routes PostToolUse to handlePostToolUse → returns null (no findings)', async () => {
    const input: PostToolUseInput = { ...base, hook_event_name: 'PostToolUse', ... }
    const output = await dispatch(input)
    expect(output).toBeNull()
  })
```

**Unknown-event guard must stay green unchanged** (lines 115–120):
```typescript
  it('Test 11e: throws for unknown hook_event_name', async () => {
    const input = { ...base, hook_event_name: 'NotAnEvent' } as unknown as Parameters<typeof dispatch>[0]
    await expect(dispatch(input)).rejects.toThrow('unknown hook event: NotAnEvent')
  })
```
Add a SessionEnd case with an arbitrary/unknown `reason` string (e.g. `'bypass_permissions_disabled'` and `'some_future_reason'`) to prove the open-reason tolerance.

---

### `tests/config/reader.test.ts` — MOD

**Analog:** itself.

**Parse-positive pattern** (Test 4, lines 97–102):
```typescript
  it('returns { dry_run: true } when file contains `dry_run = true`', async () => {
    const configPath = join(tmpDir, 'config.toml')
    await writeFile(configPath, 'dry_run = true\n')
    const result = await readConfigLayer(configPath)
    expect(result).toEqual({ dry_run: true })
  })
```
For `[reversible]`: write `'[reversible]\nenabled = true\n'`, expect `result.reversible?.enabled === true`; absent table → `reversible` undefined in the Partial (default fills at merge — assert via `mergeConfigs`).

**Validation-error pattern** (Test 6, lines 114–129 — `rejects.toBeInstanceOf(ConfigReadError)` then re-catch to assert `.path`/`.reason`/`.message`). Wrong-type case: `'[reversible]\nenabled = "yes"\n'` → ConfigReadError with reason `'[reversible].enabled must be a boolean'`.

---

### `tests/doctor/checks.test.ts` — MOD

**Analog:** itself.

**Fixture helper to widen** (`buildSettings`, lines 37–52 — SessionStart branch hardcodes `matcher: 'startup'` at line 46; needs SessionEnd no-matcher branch + widened SessionStart matcher):
```typescript
function buildSettings(events: string[]): Record<string, unknown> {
  const hooks: Record<string, unknown[]> = {}
  const hookCmd = buildHookCommand(process.execPath, DIST_CLI)
  for (const event of events) {
    if (event === 'UserPromptSubmit') {
      hooks[event] = [{ _mrclean: true, hooks: [hookCmd] }]
    } else if (event === 'SessionStart') {
      hooks[event] = [{ _mrclean: true, matcher: 'startup', hooks: [hookCmd] }]
    } else {
      hooks[event] = [{ _mrclean: true, matcher: '*', hooks: [hookCmd] }]
    }
  }
  return { hooks }
}
```
Also: `allEvents` array (line 81) → 5 events; `expect(result.detail).toMatch(/4/)` (line 88) → `/5/`; inline 4-event `hooks:` fixtures at lines 201–205 and 247–251 get a SessionEnd entry.

**New-check test pattern:** the checkModelCache-style SKIP/PASS/FAIL trio — tmp dir + synthetic config.toml + call check + assert `{ name, status, detail, exitCodeOnFail }` (see `checkConfigLoad` describe at line 391 for the config-backed variant).

---

### `THREAT_MODEL.md` — MOD

**Analog:** its own numbered-H3 style.

**Section skeleton** (§3, lines 34–44 — statement of the non-defense, mechanism, then `**Recommended mitigation:**` paragraph):
```markdown
### 3. Prompt-injection of the operator

A malicious context (a tool result, a webpage paste, a document) instructs the operator:
...

**Recommended mitigation:** Operator awareness. The README (section 8) documents that
mrclean deliberately does not expose any disable/config-write tool for exactly this
reason ...
```

**Numbered-sub-item + cross-reference style** (§10, lines 109–137 — numbered bans each ending "Not a defense. See docs/SCOPE-FENCE.md §…", closing with a "What mrclean DOES provide" paragraph and a bold pointer to the canonical doc).

**Placement:** new top-level `## Reversible Mode (v3.0)` between `### 10.` (ends line 137) and `## What mrclean DOES defend against` (line 141). Five H3 subsections per RESEARCH §THREAT_MODEL.md Section Design (map blast radius / structural secret floor / wire re-entry / key-custody honesty / accepted residual risks). Frame unbuilt-code claims as design commitments, not shipped facts.

---

### `docs/HOOK-CONTRACT.md` — NEW (no analog)

New artifact class (RESEARCH "Key insight"). Structure comes from RESEARCH §Where answers land: one section per question — verdict, CC version + date, method, evidence excerpt, downstream implication. Version-stamp discipline to copy: `src/shared/types.ts` header (lines 3–5):
```typescript
 * Input shapes: RESEARCH.md §1.1 — verified from code.claude.com/docs/en/hooks (2026-05-13)
```
Every verdict line carries `[verified on Claude Code vX.Y.Z, YYYY-MM-DD, method]`. The upstream issue URL is recorded here (SC1 "filed and linked" — greppable).

---

### `tests/copy-drift.test.ts` — MOD

**Analog:** itself — the content-presence gate for the THREAT_MODEL section (RESEARCH Validation map: "unit (content grep, copy-drift precedent)").

**Presence-gate pattern** (lines 106–117):
```typescript
describe('disclaimer-presence gate (D-05)', () => {
  it('the README PII section contains the disclaimer key phrase ("not a guarantee")', () => {
    const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8')
    expect(readme).toContain('not a guarantee')
  })
```
Extend with a THREAT_MODEL.md read asserting the reversible-mode section + required subsection headings exist. If THREAT_MODEL.md gains guarantee-adjacent copy, consider adding it to `SCANNED_SOURCES` (lines 36–43, `isSource: false` — prose) so the banned-CLAIM scan covers it; the Pitfall-5 self-check (lines 100–103) shows how to keep honest phrasing unflagged.

---

## Shared Patterns

### Fail-closed error propagation (hook side)
**Source:** `src/hook/handlers/session-start.ts` lines 29–31
**Apply to:** understanding WHY session-end must not load config
```typescript
  // Step 1: Load effective config (3 layers merged)
  // ConfigReadError propagates — fail-closed via installCrashGuards → exit 2
  const config = await loadEffectiveConfig({ homeDir: homedir(), cwd: input.cwd })
```
Any throw in any handler → crash guard exit 2 → `/bin/sh` wrapper exit 2 → BLOCK. Desirable for detection paths; catastrophic noise for SessionEnd (fires at every session close, output ignored upstream).

### `_mrclean: true` marker idempotency
**Source:** `src/install/settings.ts` lines 137–150 (filter on `isMrcleanEntry`, re-add fresh) + `src/install/markers.ts` (`isMrcleanEntry`)
**Apply to:** installer change, migration test, doctor fixtures. The marker lives on the OUTER entry, so matcher/shape changes never affect replace/remove.

### `ConfigReadError` typed validation
**Source:** `src/config/index.ts` lines 48–56 (class), 62–64 (`isRecord`), 306–315 (validator shape)
**Apply to:** `validateReversibleConfig`, reader tests. Every wrong-type path throws with `(filePath, reason)` — never silently coerces.

### Frozen immutable defaults
**Source:** `src/config/defaults.ts` lines 18–26 (`Object.freeze` nested + `as unknown as` casts)
**Apply to:** `reversible` default. Absent-table == shipped-guarantee comment convention (defaults.ts lines 10–11: "master switch OFF; absent-[pii] == v1 guarantee").

### CheckResult + LOCKED exit-code map
**Source:** `src/doctor/checks.ts` lines 33–39 (shape), 10–16 (LOCKED map header)
**Apply to:** `checkReversibleState`. Reuse exit 1 (config domain) per RESEARCH Open Question 3; update the LOCKED header comment with whatever the planner picks.

### UAT sandbox isolation
**Source:** `tests/uat/live-session.test.ts` lines 28–31 (doc), 130–137 (`--settings`/`--mcp-config`/`--strict-mcp-config` flags), 195–222 (mkdtemp sandbox)
**Apply to:** contract-verification harness. The operator's `~/.claude/settings.json` is NEVER touched by tests; every experiment settings file lives in the mkdtemp sandbox.

### Version-stamped contract citations
**Source:** `src/shared/types.ts` lines 1–10 (LOCKED header with docs URL + date); RESEARCH `[CITED: code.claude.com/docs/en/hooks, fetched 2026-07-14]` convention
**Apply to:** types.ts JSDoc updates, docs/HOOK-CONTRACT.md verdicts, doctor copy ("verified on vX.Y.Z").

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `docs/HOOK-CONTRACT.md` | docs (empirical findings) | — | Genuinely new artifact class (RESEARCH "Key insight"); structure prescribed by RESEARCH §Where answers land; version-stamp style from types.ts header |
| `docs/upstream/display-only-channel-request.md` | docs (issue draft) | — | Structure driven by upstream `anthropics/claude-code` `feature_request.yml` template (preflight checklist requires duplicate-search evidence — already gathered in RESEARCH §Upstream Feature Request); filed only via `checkpoint:human-action` |

## Metadata

**Analog search scope:** `src/hook/`, `src/config/`, `src/install/`, `src/doctor/`, `src/shared/`, `tests/uat/`, `tests/install/`, `tests/hook/`, `tests/config/`, `tests/doctor/`, `tests/copy-drift.test.ts`, `THREAT_MODEL.md`
**Files scanned:** 15 read in full or targeted (all touchpoints named in 08-RESEARCH.md verified against source this session)
**Pattern extraction date:** 2026-07-14
**Line numbers valid as of:** git HEAD 54deea0 (clean tree)
