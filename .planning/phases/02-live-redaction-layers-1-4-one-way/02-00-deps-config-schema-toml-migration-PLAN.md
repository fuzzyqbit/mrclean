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
  - src/detect/findings.ts
  - src/detect/type-map.ts
  - tests/config/reader.test.ts
  - tests/config/merge.test.ts
  - tests/config/phase2-schema.test.ts
  - tests/detect/findings.test.ts
  - tests/detect/type-map.test.ts
autonomous: true
requirements: [CFG-02]
tags: [config, toml, smol-toml, schema, deps, infra, findings, type-map, shared-types]
must_haves:
  truths:
    - "All six Phase 2 runtime deps appear in package.json#dependencies"
    - "src/config/index.ts parses TOML via smol-toml and rejects malformed input with ConfigReadError"
    - "MrcleanConfig type carries entropy, secrets_files, and rules array-of-table fields plus the original Phase 1 fields"
    - "mergeConfigs concatenates allowlist arrays across layers and lets the project layer override entropy scalars and dry_run"
    - "Every Phase 1 config test still passes against the smol-toml-backed reader"
    - "src/detect/findings.ts is the single canonical home for the Finding interface + sha256hex + redactedHash + fingerprint + dedupBySpan helpers — Wave 2 plans IMPORT, never re-create"
    - "src/detect/type-map.ts is the single canonical home for getTypeForRuleId + the locked TYPE vocabulary — Wave 2 plans IMPORT, never re-create"
    - "Type-map covers the locked vocabulary AND the Layer-2/3/4 synthetic rule-ids (entropy:high → ENTROPY, env:literal → ENV, word:* → WORD) AND a representative sample of secretlint + gitleaks rule-ids from RESEARCH §1.4 + §2"
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
    - path: "src/detect/findings.ts"
      provides: "Canonical Finding interface + sha256hex + redactedHash + fingerprint + dedupBySpan"
      exports: ["Finding", "sha256hex", "redactedHash", "fingerprint", "dedupBySpan"]
    - path: "src/detect/type-map.ts"
      provides: "Canonical getTypeForRuleId + TYPE_VOCABULARY"
      exports: ["getTypeForRuleId", "TYPE_VOCABULARY"]
    - path: "tests/config/phase2-schema.test.ts"
      provides: "Tests for entropy/secrets_files/[[rules]] parsing + array-concat merge"
      contains: "[[rules]]"
    - path: "tests/detect/findings.test.ts"
      provides: "Tests for Finding shape stability, sha256hex determinism, dedupBySpan correctness"
      contains: "dedupBySpan"
    - path: "tests/detect/type-map.test.ts"
      provides: "Tests for getTypeForRuleId — all required mappings + SECRET fallback"
      contains: "getTypeForRuleId"
  key_links:
    - from: "src/config/index.ts"
      to: "smol-toml"
      via: "import { parse } from 'smol-toml'"
      pattern: "from 'smol-toml'"
    - from: "src/shared/types.ts"
      to: "src/config/index.ts"
      via: "MrcleanConfig / MrcleanEntropyConfig / MrcleanRuleOverride exports consumed by mergeConfigs"
      pattern: "MrcleanEntropyConfig|MrcleanRuleOverride"
    - from: "src/detect/findings.ts"
      to: "Wave 2 plans (02-01, 02-02, 02-03)"
      via: "Single canonical Finding interface + helpers imported across all detection layers"
      pattern: "export interface Finding"
    - from: "src/detect/type-map.ts"
      to: "Wave 2 plans (02-01, 02-03)"
      via: "Single canonical getTypeForRuleId imported by Layer 1 + placeholder manager"
      pattern: "export function getTypeForRuleId"
---

<objective>
This plan owns Wave 1 — three responsibilities:

1. **Config subsystem migration** — Replace Phase 1's hand-rolled minimal TOML parser with `smol-toml`, extend `MrcleanConfig` with the Phase 2 schema (`entropy`, `secrets_files`, `[[rules]]`, full `[allowlist]`), and wire up the array-concat merge behavior required by CFG-02.

2. **Phase 2 dependency installation** — Add the six Phase 2 runtime deps to `package.json` so all downstream Wave 2/3/4 plans can import them.

3. **Shared detection types** — Create the canonical `src/detect/findings.ts` and `src/detect/type-map.ts` modules. These are imported (NEVER re-created) by Wave 2 plans (02-01, 02-02, 02-03). Centralizing here in Wave 1 eliminates the defensive-creation race that prior planning had baked in across three parallel plans.

Purpose:
- Phase 2 cannot ship without `[[rules]]` array-of-tables (CFG-02 per-rule overrides) and `[entropy]` sub-table fields — Phase 1's parser handles neither.
- Migrating to smol-toml now also unblocks Plan 02-01's `vendor/gitleaks-rules.toml` loader (also smol-toml).
- Owning `findings.ts` + `type-map.ts` here gives Wave 2 plans (02-01, 02-02, 02-03) a stable, single-source-of-truth import target. No race-condition, no defensive stubs, no overwrite risk.

Output: a config subsystem that parses the full Phase 2 schema, six new runtime deps installed, the canonical Finding + type-map modules with full test coverage, and every Phase 1 config test still passing.
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

### Canonical Finding shape (locked — RESEARCH §1.3 + CONTEXT §Layer 1)
```typescript
export interface Finding {
  ruleId: string                                                  // e.g. "AWSSecretAccessKey" or "gitleaks:aws-access-token"
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  span: { start: number; end: number }                            // half-open [start, end) into source text
  value: string                                                   // raw matched substring — never logged, hashed immediately
  redactedHash: string                                            // first 16 hex chars of SHA-256(value)
  fingerprint: string                                             // `${ruleId}:${redactedHash}`
  source: 'secretlint' | 'gitleaks' | 'entropy' | 'env' | 'words' // for downstream dedup + audit
  action?: 'block' | 'substitute' | 'audit' | 'off' | 'warn'      // set by Layer 1 (config.rules override) or Layer 4 (word|action). 'warn' normalizes to 'audit' at orchestrator (02-04).
}
```

### Canonical TYPE vocabulary (CONTEXT §Placeholder Manager — locked)
`AWS_KEY, AWS_SECRET, GH_TOKEN, JWT, STRIPE_KEY, OPENAI_KEY, ANTHROPIC_KEY, PRIVATE_KEY, SLACK_TOKEN, GCP_KEY, DATABRICKS_KEY, AZURE_KEY, CF_KEY, ENV, WORD, ENTROPY, SECRET`

### Required type-map vocabulary (this plan must include ALL of these mappings)

**Layer 1 secretlint messageIds (from RESEARCH §1.4 preset modules):**
- `AWSAccessKeyID` → `AWS_KEY`
- `AWSSecretAccessKey` → `AWS_SECRET`
- `GitHubPersonalAccessToken` → `GH_TOKEN`
- `GitHubFineGrainedPersonalAccessToken` → `GH_TOKEN`
- `GitHubOAuth` → `GH_TOKEN`
- `GitHubAppToken` → `GH_TOKEN`
- `GitHubRefreshToken` → `GH_TOKEN`
- `StripeAccessToken` → `STRIPE_KEY`
- `StripeRestrictedAPIKey` → `STRIPE_KEY`
- `OpenAIAPIKey` → `OPENAI_KEY`
- `AnthropicAPIKey` → `ANTHROPIC_KEY`
- `SlackToken` → `SLACK_TOKEN`
- `SlackWebhookURL` → `SLACK_TOKEN`
- `GCPServiceAccountKey` → `GCP_KEY`
- `GCPAPIKey` → `GCP_KEY`
- `DatabricksToken` → `DATABRICKS_KEY`
- `AzureSubscriptionKey` → `AZURE_KEY`
- `CloudflareAPIKey` → `CF_KEY`
- `PrivateKey` → `PRIVATE_KEY` (PEM private key — also CRITICAL severity promotion in Layer 1)
- `JsonWebToken` → `JWT`
- `JWT` → `JWT`

**Layer 1 gitleaks namespaced rule-ids (sampled from RESEARCH-vendored gitleaks.toml; the planner enumerates the high-traffic ones; unknown gitleaks rule-ids fall back to SECRET):**
- `gitleaks:aws-access-token` → `AWS_KEY`
- `gitleaks:aws-secret-key` → `AWS_SECRET`
- `gitleaks:github-pat` → `GH_TOKEN`
- `gitleaks:github-fine-grained-pat` → `GH_TOKEN`
- `gitleaks:github-oauth` → `GH_TOKEN`
- `gitleaks:github-app-token` → `GH_TOKEN`
- `gitleaks:stripe-access-token` → `STRIPE_KEY`
- `gitleaks:openai-api-key` → `OPENAI_KEY`
- `gitleaks:anthropic-api-key` → `ANTHROPIC_KEY`
- `gitleaks:slack-bot-token` → `SLACK_TOKEN`
- `gitleaks:slack-user-token` → `SLACK_TOKEN`
- `gitleaks:slack-webhook-url` → `SLACK_TOKEN`
- `gitleaks:gcp-api-key` → `GCP_KEY`
- `gitleaks:gcp-service-account` → `GCP_KEY`
- `gitleaks:databricks-api-token` → `DATABRICKS_KEY`
- `gitleaks:azure-ad-client-secret` → `AZURE_KEY`
- `gitleaks:cloudflare-api-key` → `CF_KEY`
- `gitleaks:private-key` → `PRIVATE_KEY`
- `gitleaks:jwt` → `JWT`

**Layer 2/3/4 synthetic rule-ids (LOCKED — these are the only rule-ids those layers emit):**
- `entropy:high` → `ENTROPY` (emitted by Layer 2)
- `env:literal` → `ENV` (emitted by Layer 3)
- `word:*` prefix (lowercased word) → `WORD` (emitted by Layer 4 — match by prefix, NOT exact-match)

**Fallback:**
- Unknown rule-id (not in the explicit map, not matching the `word:` prefix) → `SECRET`

### Helper signatures

```typescript
export function sha256hex(value: string): string;       // full 64-char hex digest
export function redactedHash(value: string): string;    // first 16 chars of sha256hex
export function fingerprint(ruleId: string, value: string): string;  // `${ruleId}:${redactedHash(value)}`
export function dedupBySpan(findings: Finding[]): Finding[];          // RESEARCH-locked precedence: source order secretlint > gitleaks > entropy > env > words; longest match wins on overlap
export function getTypeForRuleId(ruleId: string): string;             // returns from TYPE_VOCABULARY or 'SECRET' fallback
export const TYPE_VOCABULARY: readonly string[];                      // 17 entries: locked vocabulary above
```
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
      grep -v '^//' src/config/index.ts | grep -cE "parseMinimalToml|parseBoolToken|parseStringArray" | grep -E "^0$" &&
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
    - `grep -v '^//' src/config/index.ts | grep -cE "parseMinimalToml|parseBoolToken|parseStringArray"` = 0 (hand-rolled parser deleted; ignore any reference inside `//` comments).
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

<task type="auto" tdd="true">
  <name>Task 3: Canonical findings.ts + type-map.ts + tests (shared Wave 1 detection types)</name>
  <files>src/detect/findings.ts, src/detect/type-map.ts, tests/detect/findings.test.ts, tests/detect/type-map.test.ts</files>
  <read_first>
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §1.3 (Finding shape conversion from secretlint), §1.4 (preset module list — type-map source data), §2 (gitleaks rule-id namespacing)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md §Detection-Layer Ordering + §Placeholder Manager (locked TYPE vocabulary)
    - vendor/gitleaks-rules.toml — NOT YET present in Wave 1 (Plan 02-01 vendors it). The type-map's gitleaks entries are sourced from the documented `gitleaks/config/gitleaks.toml` rule IDs (see interfaces block above) — the vendored TOML is NOT consulted here.
    - src/shared/types.ts (read for MrcleanConfig consistency — this task doesn't modify it)
    - Node `node:crypto` API for `createHash('sha256')`
  </read_first>
  <behavior>
    `src/detect/findings.ts`:
    - Exports the canonical `Finding` interface exactly as documented in the interfaces block. The optional `action` field is part of the shape from day one (the type accepts `'warn'` because Layer 4 emits it; the orchestrator in 02-04 normalizes `'warn'` to `'audit'`).
    - `sha256hex(value)`: deterministic — same input → same 64-char hex.
    - `redactedHash(value)`: returns the first 16 characters of `sha256hex(value)`. Documented in JSDoc that this truncation is the audit-log surface.
    - `fingerprint(ruleId, value)`: returns `${ruleId}:${redactedHash(value)}`.
    - `dedupBySpan(findings)`:
      - Input: `Finding[]` (possibly from multiple layers, possibly overlapping spans).
      - Output: `Finding[]` with overlapping spans resolved by RESEARCH-locked precedence:
        1. If two findings have IDENTICAL spans, the survivor is chosen by source order: `secretlint` > `gitleaks` > `entropy` > `env` > `words`.
        2. If two findings have OVERLAPPING but non-identical spans, the LONGER span wins. Ties broken by source order above.
      - Preserves the `action` field on the survivor (if set).
      - Stable: the returned array is sorted by `span.start` ascending.

    `src/detect/type-map.ts`:
    - Exports `TYPE_VOCABULARY: readonly string[]` with all 17 entries from the locked vocabulary (16 specific TYPEs + `SECRET` fallback).
    - Exports `getTypeForRuleId(ruleId)`:
      - If `ruleId` starts with `'word:'` (lowercase prefix) → returns `'WORD'` (covers all Layer 4 outputs without enumerating every word).
      - Else if `ruleId` is in the explicit secretlint + gitleaks + L2/L3 map → returns the mapped TYPE.
      - Else → returns `'SECRET'` (fallback for unknown rule-ids).
    - Map is a module-scope frozen `Record<string, string>` constant. NO mutation at runtime.

    Test surface:
    - `tests/detect/findings.test.ts` proves: Finding shape stable (no over-shape — extra fields are tolerated at runtime but the interface is the public contract); sha256hex deterministic across 100 invocations on the same value; redactedHash is exactly 16 chars; fingerprint format `${ruleId}:${redactedHash}`; dedupBySpan with overlapping spans returns the longer match; dedupBySpan with identical spans returns the higher-precedence source.
    - `tests/detect/type-map.test.ts` proves: every required mapping (entropy:high → ENTROPY, env:literal → ENV, word:foo → WORD, word:ANY → WORD, AWSSecretAccessKey → AWS_SECRET, gitleaks:aws-access-token → AWS_KEY, etc.); unknown rule-id → SECRET; TYPE_VOCABULARY has the locked 17 entries.
  </behavior>
  <action>
    Step 1 — `src/detect/findings.ts`:
    - Import `createHash` from `node:crypto`.
    - Define and export the canonical `Finding` interface per the interfaces block (including the optional `action` field with literal-union including `'warn'`).
    - Implement `sha256hex(value: string): string`:
      ```
      return createHash('sha256').update(value, 'utf8').digest('hex');
      ```
    - Implement `redactedHash(value: string): string` → `sha256hex(value).slice(0, 16)`.
    - Implement `fingerprint(ruleId: string, value: string): string` → `\`${ruleId}:${redactedHash(value)}\``.
    - Implement `dedupBySpan(findings: Finding[]): Finding[]`:
      - Source precedence: define a const `SOURCE_PRECEDENCE = ['secretlint', 'gitleaks', 'entropy', 'env', 'words'] as const`.
      - Helper `precedence(source)`: returns index in `SOURCE_PRECEDENCE` (lower index = higher precedence).
      - Helper `spanLen(f)`: `f.span.end - f.span.start`.
      - Helper `spansOverlap(a, b)`: `a.span.start < b.span.end && b.span.start < a.span.end`.
      - Algorithm: sort findings by `span.start` ascending (stable). Iterate. Maintain a `survivors: Finding[]` array. For each candidate:
        - If no existing survivor overlaps → push candidate.
        - If an existing survivor overlaps:
          - If candidate has STRICTLY larger span length → replace the overlapping survivor with the candidate.
          - Else if equal length AND candidate has lower precedence index → replace.
          - Else → drop the candidate.
      - Return survivors sorted by `span.start` ascending.
      - Document the algorithm in JSDoc; reference RESEARCH §Detection-Layer Ordering.
    - DO NOT export `SOURCE_PRECEDENCE` — internal detail.
    - File length target: ~80 LOC including JSDoc.

    Step 2 — `src/detect/type-map.ts`:
    - Export `TYPE_VOCABULARY: readonly string[]`:
      ```
      export const TYPE_VOCABULARY = Object.freeze([
        'AWS_KEY', 'AWS_SECRET', 'GH_TOKEN', 'JWT', 'STRIPE_KEY',
        'OPENAI_KEY', 'ANTHROPIC_KEY', 'PRIVATE_KEY', 'SLACK_TOKEN',
        'GCP_KEY', 'DATABRICKS_KEY', 'AZURE_KEY', 'CF_KEY',
        'ENV', 'WORD', 'ENTROPY', 'SECRET',
      ] as const);
      ```
    - Define a frozen map covering EVERY mapping listed in the interfaces block (secretlint messageIds + gitleaks namespaced rule-ids + L2/L3 synthetics). Use a module-scope `const RULE_ID_TO_TYPE: Readonly<Record<string, string>> = Object.freeze({ ... })`.
    - Export `getTypeForRuleId(ruleId: string): string`:
      ```
      if (ruleId.startsWith('word:')) return 'WORD';
      return RULE_ID_TO_TYPE[ruleId] ?? 'SECRET';
      ```
    - JSDoc explains the `word:` prefix-match convention.

    Step 3 — `tests/detect/findings.test.ts` (~8 tests):
    1. `sha256hex('hello')` returns a 64-char lowercase hex string AND is deterministic (call 5 times → same output).
    2. `redactedHash('hello')` is exactly 16 chars AND equals `sha256hex('hello').slice(0, 16)`.
    3. `fingerprint('AWSAccessKeyID', 'AKIA...')` returns `'AWSAccessKeyID:' + redactedHash('AKIA...')`.
    4. `dedupBySpan([])` returns `[]`.
    5. Non-overlapping spans pass through unchanged (input `[{span:[0,5]}, {span:[10,15]}]` returns both, sorted).
    6. Identical spans: input two findings both at `[0,10]`, sources `secretlint` and `gitleaks` → returns only the secretlint one.
    7. Overlapping unequal spans: finding A at `[0,10]` source `gitleaks`, finding B at `[5,20]` source `entropy` → returns B (longer wins, regardless of source precedence).
    8. Action field preserved: a finding with `action: 'warn'` survives dedup with the field intact.

    Step 4 — `tests/detect/type-map.test.ts` (~7 tests):
    1. `getTypeForRuleId('AWSAccessKeyID')` returns `'AWS_KEY'`.
    2. `getTypeForRuleId('AWSSecretAccessKey')` returns `'AWS_SECRET'`.
    3. `getTypeForRuleId('gitleaks:aws-access-token')` returns `'AWS_KEY'`.
    4. `getTypeForRuleId('entropy:high')` returns `'ENTROPY'`.
    5. `getTypeForRuleId('env:literal')` returns `'ENV'`.
    6. `getTypeForRuleId('word:acme')` returns `'WORD'`; `getTypeForRuleId('word:ANYTHING-LITERAL-PROJECT-TERM')` returns `'WORD'`.
    7. `getTypeForRuleId('UnknownRule_xyz')` returns `'SECRET'`.
    8. `TYPE_VOCABULARY.length === 17` and contains all 17 expected entries.
    9. (Spot-check sample): `getTypeForRuleId('GitHubPersonalAccessToken')` → `'GH_TOKEN'`; `getTypeForRuleId('gitleaks:openai-api-key')` → `'OPENAI_KEY'`; `getTypeForRuleId('PrivateKey')` → `'PRIVATE_KEY'`.

    Step 5 — Run `npx vitest run tests/detect/findings.test.ts tests/detect/type-map.test.ts` and confirm all tests pass.

    Step 6 — Run `npm run typecheck` to confirm no TS errors.

    Commit as `feat(02-00): canonical findings.ts + type-map.ts (shared Wave 1 detection types)`.
  </action>
  <verify>
    <automated>
      grep -cE "^export interface Finding" src/detect/findings.ts &&
      grep -cE "^export function sha256hex|^export function redactedHash|^export function fingerprint|^export function dedupBySpan" src/detect/findings.ts &&
      grep -cE "^export function getTypeForRuleId|^export const TYPE_VOCABULARY" src/detect/type-map.ts &&
      grep -c "entropy:high" src/detect/type-map.ts &&
      grep -c "env:literal" src/detect/type-map.ts &&
      grep -c "'word:'" src/detect/type-map.ts &&
      grep -c "AWSSecretAccessKey" src/detect/type-map.ts &&
      grep -c "gitleaks:aws-access-token" src/detect/type-map.ts &&
      grep -c "createHash" src/detect/findings.ts &&
      npx vitest run tests/detect/findings.test.ts tests/detect/type-map.test.ts 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      npm run typecheck &&
      git log -1 --format=%s | grep -E "^feat\(02-00\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - `src/detect/findings.ts` exports `Finding`, `sha256hex`, `redactedHash`, `fingerprint`, `dedupBySpan` (5 named exports, grep-verified).
    - `Finding` interface includes the `source` union AND the optional `action` field allowing `'warn'` (Layer 4 emits it).
    - `dedupBySpan` algorithm referenced in JSDoc with RESEARCH source-order precedence list.
    - `src/detect/type-map.ts` exports `getTypeForRuleId` and `TYPE_VOCABULARY`.
    - Type-map covers ALL required mappings:
      - L2/L3/L4 synthetics: `entropy:high`, `env:literal`, `'word:'` prefix (3 grep checks).
      - secretlint sample: at minimum `AWSAccessKeyID`, `AWSSecretAccessKey`, `GitHubPersonalAccessToken`, `OpenAIAPIKey`, `AnthropicAPIKey`, `PrivateKey`, `JsonWebToken`.
      - gitleaks sample: at minimum `gitleaks:aws-access-token`, `gitleaks:github-pat`, `gitleaks:stripe-access-token`, `gitleaks:openai-api-key`, `gitleaks:anthropic-api-key`, `gitleaks:private-key`, `gitleaks:jwt`.
    - `TYPE_VOCABULARY.length === 17` (test assertion).

    Behavior assertions:
    - All ~16 tests across findings.test.ts + type-map.test.ts pass.
    - `dedupBySpan` correctness proven for identical, overlapping, and disjoint inputs.
    - `sha256hex` determinism proven across multiple invocations.
    - `getTypeForRuleId` returns `SECRET` for unknown rule-ids and respects the `word:` prefix shortcut.
    - `npm run typecheck` exits 0.

    Commit assertion:
    - `git log -1 --format=%s` matches `^feat\(02-00\):` (GREEN commit per TDD; this task's commit replaces Task 2's commit as HEAD).
  </acceptance_criteria>
  <done>Canonical Finding type + crypto helpers + dedupBySpan implemented and tested; canonical type-map with full vocabulary implemented and tested. Wave 2 plans (02-01, 02-02, 02-03) IMPORT from these modules — never re-create.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| filesystem→hook process | `~/.mrclean/config.toml` and `<cwd>/.mrclean/config.toml` are user-owned; mrclean reads them at startup. Malicious operator/team-member can craft a config that influences detection behavior, but cannot exfiltrate data through this surface. |
| npm registry→install | `npm install` of 6 new deps is a supply-chain trust crossing. Versions pinned via `^` ranges; npm audit run is OUT OF SCOPE for this plan (no requirement). |
| in-process value → sha256hex | Raw secret values pass through `createHash('sha256').update(value)`. The crypto module is Node-builtin; no external surface. Output (the hex digest) is the only persistence-safe representation of the value. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-00-01 | Tampering | malicious `.mrclean/config.toml` injects bogus `[[rules]]` overrides that set `action="off"` on all rules | mitigate | Per-rule action override is a documented feature (CFG-02); operator owns the file. Defense: surface effective rule actions in the Phase 2 banner (mode + rule count). Not in scope this plan; Plan 02-05 emits the banner. |
| T-02-00-02 | DoS | A 1 GB `config.toml` exhausts memory on `smol-toml.parse()` | accept | Config files are operator-controlled local files; if the operator writes a 1 GB config they have already won/lost. No size-cap defense in v1. |
| T-02-00-03 | Information disclosure | `ConfigReadError.message` includes raw TOML line content from a `.mrclean/config.toml` that itself contains a secret | accept | The error surfaces a parser error message from smol-toml; the operator's own file content goes to their own stderr. Documented as a "do not paste secrets into config.toml" expectation; audit log discipline (Plan 02-03) is the real defense. |
| T-02-00-04 | Tampering | Supply chain: a malicious smol-toml version mines crypto on `require()` | mitigate | Range-pinned via `^1.6.0`. Lockfile committed (already standard practice for the project). No additional defense in this plan. |
| T-02-00-05 | Information disclosure | `sha256hex(value)` is reversible by an attacker who guesses the value space (e.g., known short tokens) | accept | SHA-256 is a one-way hash but not key-stretched; for very low-entropy inputs (e.g. `password`), the digest is brute-forceable. Mitigation lives in `redactedHash` truncation (16 hex chars = 64 bits) — collisions are still rare but the digest reveals less than full SHA-256. v1 trade-off documented. REVMODE (v2) may add HMAC keying for cross-session canonical naming. |
| T-02-00-06 | Tampering | A future plan adds a rule-id that maps to a TYPE not in TYPE_VOCABULARY → `getTypeForRuleId` returns it but the placeholder pool has no slot for it | mitigate | The fallback is `'SECRET'` — unknown rule-ids degrade gracefully. New TYPEs should be added to `TYPE_VOCABULARY` in this file when introduced. JSDoc on the constant notes this. |
</threat_model>

<verification>
- `npm run typecheck` exits 0.
- `npx vitest run tests/config/ tests/detect/findings.test.ts tests/detect/type-map.test.ts` exits 0 with all tests passing (~37 tests total).
- `grep -rnE "parseMinimalToml|parseBoolToken|parseStringArray" src/` returns no matches (hand-rolled parser fully removed).
- `node -e "const c = require('./node_modules/@secretlint/core/package.json'); console.log(c.version)"` prints a 13.x version string.
- The Phase 1 install stub config.toml round-trips through `loadEffectiveConfig` to a config equal to DEFAULT_CONFIG when no `~/.mrclean/config.toml` exists.
- `src/detect/findings.ts` and `src/detect/type-map.ts` exist with the required exports — Wave 2 plans can import them without race conditions.
</verification>

<success_criteria>
- Six Phase 2 runtime deps present in `package.json#dependencies` and importable.
- smol-toml is the only TOML parser in the source tree.
- `MrcleanConfig` carries entropy/secrets_files/rules and Phase 1 + Phase 2 schema tests all pass.
- `mergeConfigs` concatenates allowlist arrays per CFG-02 + RESEARCH §11.4.
- All existing Phase 1 functionality preserved (doctor `config-load` check still passes against an empty install).
- Canonical `src/detect/findings.ts` and `src/detect/type-map.ts` modules exist with full test coverage and the locked vocabulary — Wave 2 plans (02-01, 02-02, 02-03) consume these as single-source-of-truth imports.
</success_criteria>

<output>
After completion, create `.planning/phases/02-live-redaction-layers-1-4-one-way/02-00-SUMMARY.md` describing:
- The new Phase 2 schema, the smol-toml migration, the array-concat merge semantics.
- The Finding canonical shape + sha256hex/redactedHash/fingerprint/dedupBySpan helpers.
- The TYPE vocabulary list + getTypeForRuleId resolution semantics (explicit map + `word:` prefix + SECRET fallback).
- Any deviations from this plan's spec (especially around smol-toml secrets_files flatten convention).
- Note for Wave 2 executors: "src/detect/findings.ts and src/detect/type-map.ts are owned by 02-00. Wave 2 plans (02-01, 02-02, 02-03) IMPORT these — do NOT create or modify them. If you need new TYPE entries or new helpers, revise this plan first."
</output>
