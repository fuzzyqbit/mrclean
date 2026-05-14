---
phase: 01-wired-skeleton
plan: 02b
type: execute
wave: 2
depends_on: ["01-01"]
files_modified:
  - src/config/defaults.ts
  - src/config/index.ts
  - src/shared/types.ts
  - tests/config/reader.test.ts
  - tests/config/merge.test.ts
autonomous: true
requirements_addressed:
  - CFG-01
  - CFG-03
user_setup: []
must_haves:
  truths:
    - "`readConfigLayer('/nonexistent/path/config.toml')` resolves to `{}` (empty object), does NOT throw — missing files are normal and mean 'no overrides'."
    - "`readConfigLayer(malformedTomlPath)` throws a structured error whose message identifies the file path AND the parse failure reason (so doctor can surface it cleanly)."
    - "`mergeConfigs(defaults, userGlobal, projectLocal)` produces a fully populated `MrcleanConfig` where later layers override earlier ones field-by-field (NOT a shallow blanket replace)."
    - "When only `userGlobal` provides a value for a field, the merge result picks up that user value over the bundled default."
    - "When both `userGlobal` and `projectLocal` provide a value for the same field, the project-local value wins (precedence: defaults < user < project)."
    - "`MrcleanConfig` type is exported from `src/shared/types.ts` and used as the return type of `mergeConfigs`."
    - "The Phase 1 `MrcleanConfig` schema includes the minimum fields needed for Phase 1 no-op behavior — Phase 2 will extend it without breaking the reader contract."
  artifacts:
    - path: "src/config/defaults.ts"
      provides: "DEFAULT_CONFIG: MrcleanConfig — bundled defaults (Phase 1: empty rule list, empty allowlist, dry_run=false). Exported so doctor/CLI consumers can show 'what would happen with no config files'."
      exports: ["DEFAULT_CONFIG"]
    - path: "src/config/index.ts"
      provides: "readConfigLayer(path): returns parsed Partial<MrcleanConfig> or {} if missing; throws ConfigReadError on malformed TOML. mergeConfigs(...layers): performs field-by-field precedence merge over an ordered list of Partial<MrcleanConfig> layers."
      exports: ["readConfigLayer", "mergeConfigs", "loadEffectiveConfig", "ConfigReadError"]
    - path: "src/shared/types.ts"
      provides: "EXTENDS the existing types file from Plan 01 by appending the MrcleanConfig type (Phase 1 fields only — dry_run, allowlist stubs). Plan 01's HookInput/HookOutput types are preserved unchanged."
      exports: ["MrcleanConfig", "MrcleanAllowlist"]
  key_links:
    - from: "src/config/index.ts:readConfigLayer"
      to: "smol-toml (deferred — Phase 1 uses node:fs + JSON.parse fallback OR an inline minimal TOML parser)"
      via: "TOML parse — see action notes for Phase 1 strategy"
      pattern: "readConfigLayer"
    - from: "src/config/index.ts:mergeConfigs"
      to: "DEFAULT_CONFIG"
      via: "DEFAULT_CONFIG is the first layer in any merge call"
      pattern: "DEFAULT_CONFIG"
    - from: "src/doctor/canary.ts (Plan 01-05)"
      to: "loadEffectiveConfig"
      via: "doctor's config-load check exercises the full three-layer merge"
      pattern: "loadEffectiveConfig"
---

<objective>
Implement the three-layer configuration reader: bundled defaults < user-global (`~/.mrclean/config.toml`) < project-local (`.mrclean/config.toml`). Provide `readConfigLayer(path)` for parsing one layer (graceful on missing files, structured error on malformed files), `mergeConfigs(...layers)` for field-by-field precedence merging, and `loadEffectiveConfig(opts)` as the high-level entry point that resolves all three paths and returns the final `MrcleanConfig`. This closes CFG-01 (project-local override file) and CFG-03 (three-layer precedence) requirement IDs that Plan 01-02 only partially addressed (stub config.toml write).

Purpose: Plan 01-02 creates the `.mrclean/config.toml` stub at install time, but nothing reads it. Without a reader, CFG-01 and CFG-03 are "claimed but unimplemented" — the checker correctly blocked this. This plan delivers the reader-side contract so doctor (Plan 01-05) can validate the round trip, and Phase 2 can extend the schema without re-writing the layer-merge logic.

Output: A `src/config/` subtree with reader, merger, defaults, and unit tests covering missing-file fallback, three-layer precedence, and malformed-file error handling. `MrcleanConfig` type added to `src/shared/types.ts`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/01-wired-skeleton/01-RESEARCH.md
@.planning/phases/01-wired-skeleton/01-SKELETON.md
@.planning/phases/01-wired-skeleton/01-01-PLAN.md
@.planning/phases/01-wired-skeleton/01-02-PLAN.md
@.planning/REQUIREMENTS.md
@CLAUDE.md
@src/shared/types.ts
</context>

<interfaces>
<!-- These contracts are what Plan 01-05 (doctor) and Phase 2 will import. -->
<!-- The Phase 1 MrcleanConfig shape is deliberately minimal — Phase 2 extends fields, not the merge mechanics. -->

```typescript
// src/shared/types.ts (this plan EXTENDS — does not replace — the file Plan 01 created)
export interface MrcleanAllowlist {
  rules: string[];          // rule IDs to skip
  paths: string[];          // glob list (Phase 2 will consume)
  stopwords: string[];      // literal strings (Phase 2)
  regexes: string[];        // pattern strings (Phase 2)
  fingerprints: string[];   // SHA-256 fingerprints (Phase 2)
}

export interface MrcleanConfig {
  dry_run: boolean;                       // MODE-01 stub — Phase 2 wires it into rule actions
  allowlist: MrcleanAllowlist;
  // Phase 2 will add: detection.entropy_threshold, detection.entropy_min_length, secrets_files, etc.
  // Phase 1 keeps the surface tiny so the merge logic is testable end-to-end without speculation.
}

// src/config/defaults.ts
export const DEFAULT_CONFIG: MrcleanConfig;
// = { dry_run: false, allowlist: { rules: [], paths: [], stopwords: [], regexes: [], fingerprints: [] } }

// src/config/index.ts
export class ConfigReadError extends Error {
  constructor(public readonly path: string, public readonly reason: string);
}
export async function readConfigLayer(path: string): Promise<Partial<MrcleanConfig>>;
// - Missing file (ENOENT) → resolves to {}.
// - Malformed file → throws ConfigReadError with { path, reason }.
// - Empty file → resolves to {} (zero-byte file is equivalent to "no overrides").

export function mergeConfigs(
  ...layers: ReadonlyArray<Partial<MrcleanConfig>>
): MrcleanConfig;
// Field-by-field precedence: later layers override earlier ones.
// Caller passes layers in precedence order, lowest first:
//   mergeConfigs(DEFAULT_CONFIG, userLayer, projectLayer)
// Arrays (allowlist.rules, etc.) are REPLACED wholesale by the highest-precedence layer that
// defines them (Phase 1 simplification — Phase 2 may add explicit `_merge: 'append'` markers).

export interface LoadConfigOpts {
  homeDir?: string;   // defaults to os.homedir()
  cwd?: string;       // defaults to process.cwd()
}
export async function loadEffectiveConfig(opts?: LoadConfigOpts): Promise<MrcleanConfig>;
// Reads ~/.mrclean/config.toml and ./.mrclean/config.toml, merges with DEFAULT_CONFIG,
// returns the final shape. Both layers are optional — missing layers fall through to defaults.
```

Layer precedence (LOCKED — matches REQUIREMENTS.md CFG-03):

```
DEFAULT_CONFIG  <  ~/.mrclean/config.toml  <  ./<cwd>/.mrclean/config.toml
(lowest)                                                            (highest)
```
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement defaults, reader, merger, and MrcleanConfig type</name>
  <files>src/config/defaults.ts, src/config/index.ts, src/shared/types.ts</files>
  <read_first>
    - .planning/REQUIREMENTS.md — CFG-01 (project-local overrides; missing file is fine), CFG-02 (full v1 schema — Phase 1 only implements the dry_run + allowlist subset; rest is Phase 2), CFG-03 (three-layer precedence: defaults < user < project).
    - CLAUDE.md — "Recommended Stack" row for `smol-toml` (deferred to Phase 2 detection work; Phase 1 may use a minimal inline TOML reader OR fall back to JSON if simpler — see action notes).
    - src/shared/types.ts (from Plan 01-01) — the file already exists with hook input/output types; this plan EXTENDS it, do not rewrite it.
    - src/install/project-dir.ts (from Plan 01-02) — the stub `config.toml` written at install time. The reader must accept files in that shape (commented-out sections, no values) as a valid empty layer.
  </read_first>
  <behavior>
    - Test 1: `readConfigLayer('/path/that/does/not/exist')` resolves to `{}`. No throw. (Verified in Task 2 — declared here so the implementation supports it.)
    - Test 2: `readConfigLayer(emptyFile)` resolves to `{}`. (Zero bytes counts as "no overrides".)
    - Test 3: `readConfigLayer(validTomlWithDryRun)` returns `{ dry_run: true }` (only the field that was set; not the full schema).
    - Test 4: `readConfigLayer(malformedToml)` throws `ConfigReadError` whose `.path` and `.reason` are populated; the message includes the file path.
    - Test 5: `mergeConfigs(DEFAULT_CONFIG)` returns DEFAULT_CONFIG verbatim.
    - Test 6: `mergeConfigs(DEFAULT_CONFIG, { dry_run: true })` returns `{ ...DEFAULT_CONFIG, dry_run: true }`.
    - Test 7: `mergeConfigs(DEFAULT_CONFIG, { dry_run: true }, { dry_run: false })` returns `{ ...DEFAULT_CONFIG, dry_run: false }` (project-local wins).
    - Test 8: `mergeConfigs(DEFAULT_CONFIG, { allowlist: { rules: ['R1'] } as MrcleanAllowlist }, {})` produces `allowlist.rules === ['R1']` (user layer survives when project does not override).
    - Test 9: `mergeConfigs(DEFAULT_CONFIG, { allowlist: { rules: ['USR'] } as MrcleanAllowlist }, { allowlist: { rules: ['PRJ'] } as MrcleanAllowlist })` produces `allowlist.rules === ['PRJ']` (project layer replaces user layer wholesale at the allowlist level — Phase 1 simplification).
  </behavior>
  <action>
    EXTEND `src/shared/types.ts`. Do NOT replace its existing content (the HookInput/HookOutput etc from Plan 01-01 must stay). Append the new exports:
      - `export interface MrcleanAllowlist { rules: string[]; paths: string[]; stopwords: string[]; regexes: string[]; fingerprints: string[] }`
      - `export interface MrcleanConfig { dry_run: boolean; allowlist: MrcleanAllowlist }`
      Add JSDoc references to REQUIREMENTS.md CFG-02 (Phase 2 will fill in the rest of the schema; Phase 1 stays minimal).

    Create `src/config/defaults.ts`:
      ```typescript
      import type { MrcleanConfig } from '../shared/types.js';
      export const DEFAULT_CONFIG: MrcleanConfig = {
        dry_run: false,
        allowlist: { rules: [], paths: [], stopwords: [], regexes: [], fingerprints: [] },
      };
      ```
      Freeze the object (`Object.freeze`) at the top level so accidental mutation in callers is caught at runtime (immutability rule from coding-style).

    Create `src/config/index.ts`:
      - Define `class ConfigReadError extends Error` with `path: string` and `reason: string` fields; constructor builds a message of the form `mrclean config: failed to read ${path}: ${reason}`.
      - `readConfigLayer(path)`: `fs.readFile(path, 'utf8')` inside a try. On `code === 'ENOENT'` return `{}`. On other read errors throw `ConfigReadError(path, err.message)`.
        - On empty/whitespace-only content, return `{}`.
        - TOML parsing strategy for Phase 1 (CLAUDE.md defers `smol-toml` to Phase 2 detection work, where the gitleaks TOML rule pack lives):
          - Phase 1 implements a **minimal hand-rolled TOML subset** sufficient for the Phase 1 schema (boolean keys at top level, string array keys under `[allowlist]`, comment lines starting with `#`). This is ~30 lines of code and avoids pulling `smol-toml` in before the gitleaks-rule path forces it.
          - Document this in a comment block at the top of the parser: "Phase 1 minimal TOML — Phase 2 swaps in `smol-toml` when DET1-02 requires the full TOML 1.1 grammar."
          - Specifically support: `key = true | false`, `key = "string"`, `key = [ "a", "b" ]` (inline string arrays), `[section]` headers (only `[allowlist]` in Phase 1), `# comment` lines, blank lines.
          - On any token the parser cannot recognize, throw `ConfigReadError(path, 'malformed line N: ...')` — fail loudly so the operator fixes their config rather than getting silent defaults.
      - `mergeConfigs(...layers)`: start from an empty result; for each layer in order, copy known top-level keys (`dry_run`, `allowlist`) when present. For `allowlist`, replace the entire sub-object (Phase 1 simplification — documented in code comment). Return as `MrcleanConfig`. If `dry_run` ends up undefined (no layer set it), fall back to `DEFAULT_CONFIG.dry_run`. Same fallback for `allowlist`.
      - `loadEffectiveConfig(opts)`:
        - Resolve `homeDir = opts?.homeDir ?? os.homedir()` and `cwd = opts?.cwd ?? process.cwd()`.
        - `userPath = join(homeDir, '.mrclean', 'config.toml')`.
        - `projectPath = join(cwd, '.mrclean', 'config.toml')`.
        - `const userLayer = await readConfigLayer(userPath)`.
        - `const projectLayer = await readConfigLayer(projectPath)`.
        - `return mergeConfigs(DEFAULT_CONFIG, userLayer, projectLayer)`.
        - Propagate `ConfigReadError` from either layer — doctor will catch and report it.

    Do NOT add new runtime dependencies in this plan. Phase 1's minimal TOML reader is intentionally hand-rolled to keep the dep surface (and the Phase 1 startup cost) minimal; Phase 2 owns the `smol-toml` upgrade.
  </action>
  <verify>
    <automated>npm run typecheck</automated>
  </verify>
  <acceptance_criteria>
    - `npm run typecheck` exits 0 — `MrcleanConfig` and `MrcleanAllowlist` are exported from `src/shared/types.ts` with no type errors.
    - `node -e "import('./src/config/defaults.ts').then(m=>console.log(typeof m.DEFAULT_CONFIG))"` (via `tsx`) reports `object`.
    - `grep -E "export class ConfigReadError" src/config/index.ts` returns ≥1 hit.
    - `grep -E "export (async )?function (readConfigLayer|mergeConfigs|loadEffectiveConfig)" src/config/index.ts | grep -v '^#' | wc -l` is exactly `3`.
    - The Phase 1 minimal-TOML parser has a comment block referencing "Phase 2 swaps in smol-toml" so the upgrade path is documented in source.
    - `src/shared/types.ts` STILL exports the Plan 01-01 hook types (`grep -c "export interface HookInputBase" src/shared/types.ts` is exactly 1).
  </acceptance_criteria>
  <done>
    Defaults, reader, merger, and types implemented. Type-checks pass. The reader gracefully handles missing files (returns `{}`), correctly parses the minimal TOML subset, and throws structured errors on malformed input.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Unit tests for missing file, malformed file, single-layer override, and three-layer precedence</name>
  <files>tests/config/reader.test.ts, tests/config/merge.test.ts</files>
  <read_first>
    - This plan's `<interfaces>` block — the test assertions must match the exact return types declared there.
    - The behaviors enumerated in Task 1 — Task 2 implements one test per behavior, plus extra coverage for the read-error path.
    - `src/install/project-dir.ts` from Plan 01-02 — the test fixture for "empty stub config.toml" should match the shape `createProjectDir` writes (commented sections, no live values) so reader and writer agree.
  </read_first>
  <behavior>
    - Test 1 (reader: missing file returns empty): `readConfigLayer('/definitely/not/a/real/path-xyz/config.toml')` resolves to `{}`.
    - Test 2 (reader: zero-byte file returns empty): write an empty file to a tmpdir, `readConfigLayer(emptyPath)` resolves to `{}`.
    - Test 3 (reader: install-time stub returns empty): write the exact stub `config.toml` content that `createProjectDir` from Plan 01-02 produces (all sections commented out). `readConfigLayer(stubPath)` resolves to `{}` — the install-time stub MUST be a valid empty layer.
    - Test 4 (reader: dry_run override parses): write `dry_run = true\n` to a tmpfile, `readConfigLayer` returns `{ dry_run: true }`.
    - Test 5 (reader: allowlist.rules parses): write `[allowlist]\nrules = ["RULE-A", "RULE-B"]\n`, reader returns an object whose `allowlist.rules` equals `['RULE-A', 'RULE-B']`.
    - Test 6 (reader: malformed throws ConfigReadError): write `this is not toml = = =` to a tmpfile, expect `readConfigLayer` to reject with a `ConfigReadError` whose `.path` matches the tmpfile and whose `.reason` is non-empty.
    - Test 7 (merge: defaults only): `mergeConfigs(DEFAULT_CONFIG)` is structurally equal to `DEFAULT_CONFIG`.
    - Test 8 (merge: user override wins over defaults): `mergeConfigs(DEFAULT_CONFIG, { dry_run: true })` → `dry_run === true`.
    - Test 9 (merge: project override wins over user): `mergeConfigs(DEFAULT_CONFIG, { dry_run: true }, { dry_run: false })` → `dry_run === false`.
    - Test 10 (merge: user-only allowlist): `mergeConfigs(DEFAULT_CONFIG, { allowlist: { rules: ['USR'], paths: [], stopwords: [], regexes: [], fingerprints: [] } }, {})` → `result.allowlist.rules === ['USR']`.
    - Test 11 (merge: project allowlist replaces user allowlist): `mergeConfigs(DEFAULT_CONFIG, { allowlist: { rules: ['USR'], paths: [], stopwords: [], regexes: [], fingerprints: [] } }, { allowlist: { rules: ['PRJ'], paths: [], stopwords: [], regexes: [], fingerprints: [] } })` → `result.allowlist.rules === ['PRJ']`. (Phase 1 wholesale-replace at the allowlist sub-object level — documented in code.)
    - Test 12 (loadEffectiveConfig integration): create a tmp HOME with `.mrclean/config.toml` containing `dry_run = true`, a tmp cwd with `.mrclean/config.toml` containing `dry_run = false`, call `loadEffectiveConfig({ homeDir: tmpHome, cwd: tmpCwd })` → result has `dry_run === false` (project wins).
    - Test 13 (loadEffectiveConfig: no files at all): tmp HOME + tmp cwd with no `.mrclean/` directories at all → `loadEffectiveConfig` returns a structural clone of `DEFAULT_CONFIG`.
  </behavior>
  <action>
    Create `tests/config/reader.test.ts` covering behaviors 1–6.
    Create `tests/config/merge.test.ts` covering behaviors 7–13 (the merge tests + the `loadEffectiveConfig` integration tests live here because they exercise the merge logic end-to-end).

    For tests requiring filesystem fixtures:
      - Use `os.tmpdir() + '/mrclean-config-test-' + randomUUID()` per test (created in `beforeEach`, removed via `fs.rm(_, { recursive: true, force: true })` in `afterEach`).
      - For Test 3 (install-time stub round trip), import the actual stub content from a small shared helper if Plan 01-02 exposes one, OR replicate the exact comment block here and add a code comment cross-referencing `src/install/project-dir.ts` so Plan 01-02 changes can be kept in sync.

    For the malformed-TOML test (Test 6), assert both that the rejection is a `ConfigReadError` instance AND that the message contains a substring naming the offending input (e.g., `malformed line 1`).

    No build step required — vitest can import `src/config/*.ts` directly via the existing vitest.config.ts test runner.
  </action>
  <verify>
    <automated>npx vitest run tests/config/</automated>
  </verify>
  <acceptance_criteria>
    - `npx vitest run tests/config/` exits 0 with ≥13 passing tests.
    - `grep -c 'ConfigReadError' tests/config/reader.test.ts` returns ≥1.
    - `grep -E "loadEffectiveConfig|mergeConfigs|readConfigLayer" tests/config/*.test.ts | wc -l` returns ≥10 (each of the three exports is exercised in tests).
    - At least one test verifies that the EXACT stub content `createProjectDir` writes (Plan 01-02) parses to `{}` — keeps writer and reader contracts aligned.
  </acceptance_criteria>
  <done>
    The three-layer config reader is fully tested. CFG-01 (project-local overrides; missing file is fine) and CFG-03 (three-layer precedence) are now observable in the test suite. Plan 01-05 (doctor) can add a `config-load` check that calls `loadEffectiveConfig` and asserts no throw.
  </done>
</task>

</tasks>

<verification>
  - `npx vitest run tests/config/` passes (≥13 tests).
  - `npm run typecheck` passes.
  - `MrcleanConfig`, `MrcleanAllowlist`, `DEFAULT_CONFIG`, `readConfigLayer`, `mergeConfigs`, `loadEffectiveConfig`, `ConfigReadError` are all exported and importable from the documented paths.
  - The stub config.toml that `createProjectDir` writes at install time round-trips through the reader as `{}` (no override).
  - Malformed TOML produces a structured error suitable for surfacing via doctor.
</verification>

<success_criteria>
- CFG-01: `.mrclean/config.toml` project-local overrides supported; missing file is fine and means defaults — DEMONSTRATED via Test 1 / Test 13.
- CFG-03: defaults < user-global < project-local precedence — DEMONSTRATED via Tests 7–12.
- Plan 01-05 can add a one-line `config-load` doctor check that exercises `loadEffectiveConfig` without throwing — this makes CFG-01/CFG-03 observable in the doctor output as a bonus.
- The Phase 1 dep surface stays unchanged (no new runtime deps; `smol-toml` upgrade deferred to Phase 2 where the gitleaks rule path forces it).
</success_criteria>

<output>
After completion, create `.planning/phases/01-wired-skeleton/01-02b-SUMMARY.md` capturing:
- The exact `MrcleanConfig` Phase 1 schema (so Phase 2 knows what to extend, not replace).
- The minimal TOML grammar accepted in Phase 1 + the documented upgrade path to `smol-toml`.
- Test counts and which CFG requirement IDs each test addresses.
- Confirmation that `createProjectDir`'s stub round-trips as an empty layer.
- A note for Plan 01-05: `loadEffectiveConfig({ homeDir, cwd })` is the single entry point to wire into the doctor `config-load` check.
</output>
