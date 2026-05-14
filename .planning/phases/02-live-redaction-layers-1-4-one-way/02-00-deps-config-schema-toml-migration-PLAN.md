---
phase: 02-live-redaction-layers-1-4-one-way
plan: "00"
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - package-lock.json
  - src/shared/types.ts
  - src/config/index.ts
  - src/config/defaults.ts
  - tests/config/reader.test.ts
  - tests/config/merge.test.ts
  - tests/config/phase2-schema.test.ts
autonomous: true
requirements: [CFG-02]
tags: [config, toml, smol-toml, schema, deps, infra]
must_haves:
  truths:
    - "All six Phase 2 runtime deps appear in package.json#dependencies"
    - "src/config/index.ts parses TOML via smol-toml and rejects malformed input with ConfigReadError"
    - "MrcleanConfig type carries entropy, secrets_files, and rules array-of-table fields plus the original Phase 1 fields"
    - "mergeConfigs concatenates allowlist arrays across layers and lets the project layer override entropy scalars and dry_run"
    - "Every Phase 1 config test still passes against the smol-toml-backed reader"
  artifacts:
    - path: "package.json"
      provides: "Phase 2 runtime deps under #dependencies"
      contains: "@secretlint/core"
    - path: "src/config/index.ts"
      provides: "smol-toml-backed readConfigLayer + mergeConfigs covering Phase 2 schema"
      contains: "from 'smol-toml'"
    - path: "src/shared/types.ts"
      provides: "Phase 2 MrcleanConfig surface (entropy, secrets_files, rules)"
      contains: "MrcleanEntropyConfig"
    - path: "tests/config/phase2-schema.test.ts"
      provides: "Tests for entropy/secrets_files/[[rules]] parsing + array-concat merge"
      contains: "[[rules]]"
  key_links:
    - from: "src/config/index.ts"
      to: "smol-toml"
      via: "import { parse } from 'smol-toml'"
      pattern: "from 'smol-toml'"
    - from: "src/shared/types.ts"
      to: "src/config/index.ts"
      via: "MrcleanConfig / MrcleanEntropyConfig / MrcleanRuleOverride exports consumed by mergeConfigs"
      pattern: "MrcleanEntropyConfig|MrcleanRuleOverride"
---

<objective>
Replace Phase 1's hand-rolled minimal TOML parser with `smol-toml`, extend `MrcleanConfig` with the Phase 2 schema (`entropy`, `secrets_files`, `[[rules]]`, full `[allowlist]`), and wire up the array-concat merge behavior required by CFG-02. Add the six Phase 2 runtime dependencies to `package.json` so all downstream Wave 2/3/4 plans can import them.

Purpose: Phase 2 cannot ship without `[[rules]]` array-of-tables (CFG-02 per-rule overrides) and `[entropy]` sub-table fields — Phase 1's parser handles neither. Migrating now also unblocks Plan 02-01's `vendor/gitleaks-rules.toml` loader (also smol-toml).

Output: a config subsystem that parses the full Phase 2 schema, six new runtime deps installed, and every Phase 1 config test still passing.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md
@.planning/phases/01-wired-skeleton/01-SKELETON.md
@.planning/phases/01-wired-skeleton/01-02b-SUMMARY.md
@CLAUDE.md

<interfaces>
Extracted from Phase 1 src — executors should preserve these signatures and only extend.

src/shared/types.ts (Phase 1 surface — MUST stay backward-compatible):
- `interface MrcleanAllowlist { rules: string[]; paths: string[]; stopwords: string[]; regexes: string[]; fingerprints: string[] }`
- `interface MrcleanConfig { dry_run: boolean; allowlist: MrcleanAllowlist }`

src/config/index.ts (Phase 1 surface — public API contract unchanged):
- `class ConfigReadError extends Error { constructor(public readonly path: string, public readonly reason: string) }`
- `function readConfigLayer(filePath: string): Promise<Partial<MrcleanConfig>>`
- `function mergeConfigs(...layers: ReadonlyArray<Partial<MrcleanConfig>>): MrcleanConfig`
- `function loadEffectiveConfig(opts?: LoadConfigOpts): Promise<MrcleanConfig>`
- `interface LoadConfigOpts { homeDir?: string; cwd?: string }`

src/config/defaults.ts:
- `export const DEFAULT_CONFIG: MrcleanConfig = { dry_run: false, allowlist: { rules: [], paths: [], stopwords: [], regexes: [], fingerprints: [] } }` (Object.freeze'd)

Phase 1 tests that MUST keep passing (do not modify their assertions):
- tests/config/reader.test.ts (6 tests)
- tests/config/merge.test.ts (7 tests)
- tests/install/project-dir.test.ts (round-trip of install stub config.toml)

CONTEXT.md §Configuration locked schema (TOML form):
```
dry_run = false

[entropy]
threshold = 4.5
min_length = 20

[secrets_files]
paths = []

[[rules]]
id = "AWSAccessKeyID"
action = "block"
severity = "CRITICAL"

[allowlist]
rules = []
paths = []
stopwords = []
regexes = []
fingerprints = []
```

RESEARCH.md §11.1 locked TS shape:
- `MrcleanEntropyConfig { threshold: number; min_length: number }`
- `MrcleanRuleOverride { id: string; action: 'block'|'substitute'|'audit'|'off'; severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW' }`
- Extended `MrcleanConfig { dry_run; allowlist; entropy: MrcleanEntropyConfig; secrets_files: string[]; rules: MrcleanRuleOverride[] }`

RESEARCH.md §11.4 locked merge semantics: allowlist arrays concat across layers; entropy scalars + dry_run use highest-precedence-layer-wins (same as Phase 1).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install Phase 2 runtime deps + scaffold the failing schema test</name>
  <files>package.json, package-lock.json, tests/config/phase2-schema.test.ts</files>
  <read_first>
    - package.json (current dependency list — 4 runtime deps, 6 dev deps)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §11.1, §11.4 (locked schema + merge semantics)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md §Configuration
    - CLAUDE.md (Technology Stack — pinned versions for the six new deps)
  </read_first>
  <action>
    Run `npm install --save` for the six Phase 2 runtime deps with the exact version ranges locked in RESEARCH.md §Standard Stack and CLAUDE.md:
    - `@secretlint/core` `^13.0.0`
    - `@secretlint/node` `^13.0.0`
    - `@secretlint/secretlint-rule-preset-recommend` `^13.0.0`
    - `smol-toml` `^1.6.0` (RESEARCH-verified parses full 3209-line gitleaks.toml)
    - `dotenv` `^17.4.0` (LATEST per RESEARCH §6.1; parse-only usage; do not call dotenv.config())
    - `fast-glob` `^3.3.3`

    Use the `--save` (production dep) flag for ALL six — these are runtime deps, not dev deps. After install, verify package-lock.json was regenerated and the six entries appear in `package.json#dependencies`.

    Create `tests/config/phase2-schema.test.ts` with FAILING tests (RED) that the Task 2 implementation will satisfy:
    1. Parse a TOML string containing `dry_run = true` plus `[entropy] threshold = 4.5 min_length = 20` and assert the returned partial config has `dry_run: true, entropy: { threshold: 4.5, min_length: 20 }`.
    2. Parse a TOML string with two `[[rules]]` blocks (`AWSAccessKeyID` block + audit + CRITICAL; `JWT` block + warn + HIGH) and assert `rules` is an array of length 2 with the right `id`/`action`/`severity` shape.
    3. Parse a TOML string with `[secrets_files] paths = ["custom.env", "secrets.yml"]` and assert the parsed partial carries `secrets_files: ["custom.env", "secrets.yml"]` (note: schema flattens the `[secrets_files] paths` sub-table to a top-level `secrets_files: string[]` for ergonomics — DOCUMENT this in the test and the implementation matches it in Task 2).
    4. Parse the full `[allowlist]` block with all 5 arrays (rules/paths/stopwords/regexes/fingerprints) populated — assert all 5 round-trip.
    5. Malformed TOML (e.g. `[[rules]] id =` missing value) throws `ConfigReadError` with `.path` matching the input filepath.
    6. `mergeConfigs(DEFAULT_CONFIG, { allowlist: { rules: ['A'], paths: [], stopwords: [], regexes: [], fingerprints: [] } }, { allowlist: { rules: ['B'], paths: [], stopwords: [], regexes: [], fingerprints: [] } })` returns `allowlist.rules: ['A', 'B']` — array concat per RESEARCH §11.4.
    7. `mergeConfigs(DEFAULT_CONFIG, { entropy: { threshold: 3.0, min_length: 16 } }, { entropy: { threshold: 4.5, min_length: 20 } })` returns `entropy: { threshold: 4.5, min_length: 20 }` — project wins for scalars (NOT concat).
    8. `mergeConfigs(DEFAULT_CONFIG, {})` returns `{ ...DEFAULT_CONFIG, entropy: { threshold: 4.5, min_length: 20 }, secrets_files: [], rules: [] }` — defaults are populated for every Phase 2 field.

    Run `npx vitest run tests/config/phase2-schema.test.ts` and confirm all 8 tests FAIL (RED state — symbols not exported yet, or Phase 1 parser cannot handle [[rules]]). Commit as `test(02-00): failing tests for Phase 2 config schema + smol-toml`.

    Do NOT modify src/ in this task — Task 2 owns the implementation.
  </action>
  <verify>
    <automated>
      npm view @secretlint/core version &&
      grep -c '"@secretlint/core"' package.json &&
      grep -c '"smol-toml"' package.json &&
      grep -c '"dotenv"' package.json &&
      grep -c '"fast-glob"' package.json &&
      test -f tests/config/phase2-schema.test.ts &&
      (npx vitest run tests/config/phase2-schema.test.ts 2>&1 | grep -E "(FAIL|failed)") &&
      git log -1 --format=%s | grep -E "^test\(02-00\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - `package.json#dependencies` contains exactly these six new entries: `@secretlint/core`, `@secretlint/node`, `@secretlint/secretlint-rule-preset-recommend`, `smol-toml`, `dotenv`, `fast-glob`.
    - `node -e "require('@secretlint/core'); require('smol-toml'); require('dotenv'); require('fast-glob')"` exits 0 (all importable).
    - `tests/config/phase2-schema.test.ts` exists and contains exactly 8 numbered tests matching the spec above.

    Behavior assertions:
    - `npx vitest run tests/config/phase2-schema.test.ts` exits with non-zero status (tests FAIL — symbols missing).
    - `npx vitest run tests/config/reader.test.ts tests/config/merge.test.ts` exits 0 (Phase 1 tests untouched, still PASS).

    Commit assertion:
    - `git log -1 --format=%s` matches `^test\(02-00\):` (RED commit per TDD).
  </acceptance_criteria>
  <done>Six new runtime deps installed and importable; 8 failing schema tests committed; Phase 1 config tests untouched.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Migrate parser to smol-toml, extend MrcleanConfig, implement array-concat merge</name>
  <files>src/shared/types.ts, src/config/index.ts, src/config/defaults.ts, tests/config/phase2-schema.test.ts</files>
  <read_first>
    - src/shared/types.ts (Phase 1 MrcleanConfig + MrcleanAllowlist — extend, do not replace)
    - src/config/index.ts (full file — public API to preserve: ConfigReadError, readConfigLayer, mergeConfigs, loadEffectiveConfig, LoadConfigOpts)
    - src/config/defaults.ts (current DEFAULT_CONFIG — extend with entropy/secrets_files/rules defaults)
    - tests/config/reader.test.ts + tests/config/merge.test.ts (Phase 1 tests that MUST keep passing)
    - tests/config/phase2-schema.test.ts (Task 1 RED tests — drive this implementation)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §11 + §3 (smol-toml behavior + array-of-tables)
  </read_first>
  <behavior>
    - smol-toml's `parse()` is now the sole TOML parser; the hand-rolled `parseMinimalToml` is deleted.
    - `[[rules]]` array-of-tables produces `result.rules: MrcleanRuleOverride[]` (smol-toml semantics — RESEARCH §3.2 verified).
    - `[entropy]` sub-table maps to `result.entropy: MrcleanEntropyConfig`.
    - `[secrets_files] paths = [...]` sub-table is flattened by `readConfigLayer` to `result.secrets_files: string[]` (project ergonomics — single field instead of nested sub-table consumers).
    - Malformed TOML → smol-toml throws → wrapped in `ConfigReadError(filePath, err.message)`.
    - `mergeConfigs`: allowlist arrays (rules/paths/stopwords/regexes/fingerprints) are concatenated across layers in order; `dry_run`, `entropy.*`, `secrets_files`, and `rules` use highest-layer-wins (later layer replaces earlier).
    - Phase 1 install stub (`[allowlist]`, `[words]`, `[detection]` headers with commented-out keys) still resolves to `{}` — smol-toml handles unknown sections; the reader returns only known top-level keys.
    - DEFAULT_CONFIG gets `entropy: { threshold: 4.5, min_length: 20 }`, `secrets_files: []`, `rules: []` added (Object.freeze'd).
  </behavior>
  <action>
    Extend `src/shared/types.ts`:
    - Add `export interface MrcleanEntropyConfig { threshold: number; min_length: number }`.
    - Add `export interface MrcleanRuleOverride { id: string; action: 'block' | 'substitute' | 'audit' | 'off'; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' }`.
    - Add three fields to `MrcleanConfig`: `entropy: MrcleanEntropyConfig`, `secrets_files: string[]`, `rules: MrcleanRuleOverride[]`. Keep existing `dry_run` + `allowlist` exactly as Phase 1 declared them.
    - Preserve all existing Hook* interfaces (HookInputBase, SessionStartInput, etc.) — do not touch.

    Update `src/config/defaults.ts`:
    - Extend `DEFAULT_CONFIG` with `entropy: Object.freeze({ threshold: 4.5, min_length: 20 })`, `secrets_files: Object.freeze([])`, `rules: Object.freeze([])`. The whole object remains Object.freeze'd.

    Rewrite `src/config/index.ts`:
    - Delete `parseMinimalToml`, `parseBoolToken`, `parseStringArray`, `ALLOWLIST_ARRAY_KEYS`, `SectionContext`, `AllowlistKey` — the hand-rolled parser is gone.
    - Import `parse` from `smol-toml`.
    - `readConfigLayer(filePath)` reads UTF-8 file, returns `{}` on ENOENT or empty content, otherwise calls `smol-toml.parse()` inside try/catch, wrapping any throw in `ConfigReadError(filePath, err.message)`.
    - After smol-toml parse, normalize the shape: pick only the recognized top-level keys (`dry_run`, `allowlist`, `entropy`, `secrets_files`, `rules`). For `secrets_files`, if smol-toml returned a sub-table object `{ paths: string[] }`, flatten to `result.secrets_files = parsed.secrets_files.paths`. Unknown top-level keys are ignored (forward-compat). Document this flatten-on-read in a comment.
    - Validate value types defensively: if `entropy.threshold` is not a number → `ConfigReadError`; if `rules` is not an array → `ConfigReadError`; if any rule object missing required keys → `ConfigReadError`. Use simple type guards (no Zod — keep this layer dep-free of validators).
    - `mergeConfigs` becomes:
      ```
      Per layer, in order:
        - scalars (dry_run): later wins
        - entropy: later object replaces earlier (project wins)
        - secrets_files: later array replaces earlier (project wins)
        - rules: later array replaces earlier (project wins — operator overrides global)
        - allowlist sub-object: each of the 5 string-array fields CONCATENATES across layers
      ```
      Implement `mergeAllowlists(base, override)` helper that concatenates each of the 5 arrays. Apply that helper across all layers iteratively starting from DEFAULT_CONFIG.allowlist.
    - Preserve `loadEffectiveConfig` and `LoadConfigOpts` shapes exactly. Their behavior changes ONLY because `mergeConfigs` semantics now concatenate allowlists.

    Update `tests/config/phase2-schema.test.ts`:
    - Any test that needs the secrets_files flatten convention should match the implementation choice (sub-table → top-level array). If a test specifies a different convention, update the test comment to match the implementation and re-run.

    Run `npx vitest run tests/config/` and confirm ALL config tests pass (Phase 1's 13 + Phase 2's 8 = 21 total in tests/config/). Commit as `feat(02-00): smol-toml-backed config reader + Phase 2 schema (entropy, rules, secrets_files)`.

    Also run `npm run typecheck` to confirm no new TS errors introduced.

    Do NOT modify Phase 1 reader.test.ts and merge.test.ts assertions — if a Phase 1 test breaks under the new merger (allowlist concat instead of wholesale replace), that's an acceptable semantic upgrade BUT the test must be updated minimally to reflect the new behavior. If the Phase 1 test depended on wholesale replacement, surface the conflict explicitly: rewrite the test with a comment `# Updated for Phase 2: allowlist arrays now concat per RESEARCH §11.4` and keep the SAME structural shape; do not delete tests.
  </action>
  <verify>
    <automated>
      grep -c "from 'smol-toml'" src/config/index.ts &&
      grep -cE "parseMinimalToml|parseBoolToken|parseStringArray" src/config/index.ts | grep -E "^0$" &&
      grep -c "MrcleanEntropyConfig" src/shared/types.ts &&
      grep -c "MrcleanRuleOverride" src/shared/types.ts &&
      grep -c "secrets_files" src/shared/types.ts &&
      npx vitest run tests/config/ 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      npm run typecheck &&
      git log -1 --format=%s | grep -E "^feat\(02-00\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - `grep -c "from 'smol-toml'" src/config/index.ts` = 1 (single import site).
    - `grep -cE "parseMinimalToml|parseBoolToken|parseStringArray" src/config/index.ts` = 0 (hand-rolled parser deleted).
    - `src/shared/types.ts` exports `MrcleanEntropyConfig`, `MrcleanRuleOverride`; `MrcleanConfig` declares `entropy`, `secrets_files`, `rules` properties.
    - `src/config/defaults.ts` `DEFAULT_CONFIG.entropy.threshold === 4.5`, `.min_length === 20`.

    Behavior assertions:
    - `npx vitest run tests/config/` passes ALL tests (Phase 1 reader + merge + Phase 2 schema). No skipped tests.
    - `npm run typecheck` exits 0.
    - Round-trip: `loadEffectiveConfig({ homeDir, cwd })` against the Phase 1 install stub config.toml returns a config equal to `DEFAULT_CONFIG` (no overrides — the stub's commented sections produce {}).

    Commit assertion:
    - `git log -1 --format=%s` matches `^feat\(02-00\):` (GREEN commit per TDD).
  </acceptance_criteria>
  <done>smol-toml replaces hand-rolled parser; MrcleanConfig carries Phase 2 schema; mergeConfigs concatenates allowlist arrays and project-wins entropy scalars; all 21 config tests pass; typecheck clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| filesystem→hook process | `~/.mrclean/config.toml` and `<cwd>/.mrclean/config.toml` are user-owned; mrclean reads them at startup. Malicious operator/team-member can craft a config that influences detection behavior, but cannot exfiltrate data through this surface. |
| npm registry→install | `npm install` of 6 new deps is a supply-chain trust crossing. Versions pinned via `^` ranges; npm audit run is OUT OF SCOPE for this plan (no requirement). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-00-01 | Tampering | malicious `.mrclean/config.toml` injects bogus `[[rules]]` overrides that set `action="off"` on all rules | mitigate | Per-rule action override is a documented feature (CFG-02); operator owns the file. Defense: surface effective rule actions in the Phase 2 banner (mode + rule count). Not in scope this plan; Plan 02-05 emits the banner. |
| T-02-00-02 | DoS | A 1 GB `config.toml` exhausts memory on `smol-toml.parse()` | accept | Config files are operator-controlled local files; if the operator writes a 1 GB config they have already won/lost. No size-cap defense in v1. |
| T-02-00-03 | Information disclosure | `ConfigReadError.message` includes raw TOML line content from a `.mrclean/config.toml` that itself contains a secret | accept | The error surfaces a parser error message from smol-toml; the operator's own file content goes to their own stderr. Documented as a "do not paste secrets into config.toml" expectation; audit log discipline (Plan 02-03) is the real defense. |
| T-02-00-04 | Tampering | Supply chain: a malicious smol-toml version mines crypto on `require()` | mitigate | Range-pinned via `^1.6.0`. Lockfile committed (already standard practice for the project). No additional defense in this plan. |
</threat_model>

<verification>
- `npm run typecheck` exits 0.
- `npx vitest run tests/config/` exits 0 with all tests passing (21+ tests).
- `grep -rnE "parseMinimalToml|parseBoolToken|parseStringArray" src/` returns no matches (hand-rolled parser fully removed).
- `node -e "const c = require('./node_modules/@secretlint/core/package.json'); console.log(c.version)"` prints a 13.x version string.
- The Phase 1 install stub config.toml round-trips through `loadEffectiveConfig` to a config equal to DEFAULT_CONFIG when no `~/.mrclean/config.toml` exists.
</verification>

<success_criteria>
- Six Phase 2 runtime deps present in `package.json#dependencies` and importable.
- smol-toml is the only TOML parser in the source tree.
- `MrcleanConfig` carries entropy/secrets_files/rules and Phase 1 + Phase 2 schema tests all pass.
- `mergeConfigs` concatenates allowlist arrays per CFG-02 + RESEARCH §11.4.
- All existing Phase 1 functionality preserved (doctor `config-load` check still passes against an empty install).
</success_criteria>

<output>
After completion, create `.planning/phases/02-live-redaction-layers-1-4-one-way/02-00-SUMMARY.md` describing the new Phase 2 schema, the smol-toml migration, the array-concat merge semantics, and any deviations.
</output>
