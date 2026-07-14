---
phase: 02-live-redaction-layers-1-4-one-way
plan: "00"
subsystem: config, detection-shared
tags: [config, toml, smol-toml, schema, deps, infra, findings, type-map, shared-types]

requires:
  - "01-02b: src/config/index.ts (Phase 1 hand-rolled TOML parser — replaced)"
  - "01-01: src/shared/types.ts (MrcleanAllowlist, HookInput/Output types — extended)"

provides:
  - "package.json: 6 Phase 2 runtime deps installed (@secretlint/core, @secretlint/node, @secretlint/secretlint-rule-preset-recommend, smol-toml, dotenv, fast-glob)"
  - "src/shared/types.ts: MrcleanEntropyConfig, MrcleanRuleOverride, extended MrcleanConfig (entropy, secrets_files, rules)"
  - "src/config/defaults.ts: DEFAULT_CONFIG extended with entropy {4.5, 20}, secrets_files:[], rules:[]"
  - "src/config/index.ts: smol-toml-backed readConfigLayer + mergeConfigs with array-concat allowlist semantics"
  - "src/detect/findings.ts: canonical Finding interface + sha256hex + redactedHash + fingerprint + dedupBySpan"
  - "src/detect/type-map.ts: canonical getTypeForRuleId + TYPE_VOCABULARY (17 entries)"
  - "tests/config/phase2-schema.test.ts: 8 tests for Phase 2 schema parsing + merge semantics"
  - "tests/detect/findings.test.ts: 8 tests for Finding helpers + dedupBySpan"
  - "tests/detect/type-map.test.ts: 26 tests for type-map vocabulary + mappings"

affects:
  - "02-01: imports src/detect/findings.ts + src/detect/type-map.ts (canonical, never re-create)"
  - "02-02: imports src/detect/findings.ts (canonical, never re-create)"
  - "02-03: imports src/detect/findings.ts + src/detect/type-map.ts (canonical, never re-create)"
  - "doctor config-load check: loadEffectiveConfig now returns extended MrcleanConfig"

tech-stack:
  added:
    - "smol-toml ^1.6.1 (full TOML 1.1 parser — replaces hand-rolled Phase 1 parser)"
    - "@secretlint/core ^13.0.0"
    - "@secretlint/node ^13.0.0"
    - "@secretlint/secretlint-rule-preset-recommend ^13.0.0"
    - "dotenv ^17.4.2"
    - "fast-glob ^3.3.3"
    - "node:crypto createHash('sha256') for fingerprinting"
  patterns:
    - "smol-toml parse() for full TOML 1.1 grammar (replaces hand-rolled parser)"
    - "secrets_files flattened: [secrets_files].paths sub-table → top-level secrets_files: string[]"
    - "allowlist array-concat across merge layers (not wholesale replacement)"
    - "dedupBySpan: source precedence + longer-span-wins for overlap resolution"
    - "TYPE_VOCABULARY: frozen 17-entry array; getTypeForRuleId with word: prefix shortcut"

key-files:
  created:
    - src/detect/findings.ts
    - src/detect/type-map.ts
    - tests/config/phase2-schema.test.ts
    - tests/detect/findings.test.ts
    - tests/detect/type-map.test.ts
  modified:
    - package.json (6 new deps)
    - src/shared/types.ts (3 new interfaces, 3 new MrcleanConfig fields)
    - src/config/index.ts (full rewrite: smol-toml + array-concat merge)
    - src/config/defaults.ts (extended with Phase 2 defaults)
    - tests/config/reader.test.ts (2 assertions updated for smol-toml behavior)
    - tests/config/merge.test.ts (1 test updated for concat semantics)

decisions:
  - "smol-toml ^1.6.1 used (RESEARCH verified parses full 3209-line gitleaks.toml)"
  - "secrets_files flattened from [secrets_files].paths to top-level array — ergonomics"
  - "mergeConfigs: allowlist arrays CONCAT; entropy/secrets_files/rules last-layer-wins"
  - "Phase 1 tests updated minimally: smol-toml error message format, empty [allowlist] section produces empty-axes object, concat replaces wholesale"
  - "dotenv ^17.4.2 installed (RESEARCH allowed 17.x; CLAUDE.md said 16 but 17 is backward-compatible for parse-only use)"

metrics:
  duration: "~7 min"
  completed: "2026-05-14"
  tasks: 3
  files_created: 5
  files_modified: 6
  tests_added: 42
  tests_total: 193
---

# Phase 2 Plan 00: Phase 2 Infra — Deps + smol-toml + Shared Detection Types Summary

**Phase 2 runtime deps installed, smol-toml replaces hand-rolled parser, MrcleanConfig extended with Phase 2 schema, canonical Finding + type-map modules created for Wave 2 import**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-14T13:41:15Z
- **Completed:** 2026-05-14T13:48:53Z
- **Tasks:** 3 (RED → GREEN TDD cycle)
- **Files created:** 5
- **Files modified:** 6
- **Tests added:** 42 (193 total, up from 151)

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED | `1162e8c` | test(02-00): failing tests for Phase 2 config schema + smol-toml |
| GREEN (config) | `0c5fc7d` | feat(02-00): smol-toml-backed config reader + Phase 2 schema |
| GREEN (detect) | `8be8bd2` | feat(02-00): canonical findings.ts + type-map.ts |

## Phase 2 Config Schema

### Extended MrcleanConfig

```typescript
// src/shared/types.ts — Phase 2 additions
export interface MrcleanEntropyConfig {
  threshold: number    // Shannon bits/char threshold. Default: 4.5
  min_length: number   // Min string length for entropy check. Default: 20
}

export interface MrcleanRuleOverride {
  id: string
  action: 'block' | 'substitute' | 'audit' | 'off'
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
}

export interface MrcleanConfig {
  dry_run: boolean
  allowlist: MrcleanAllowlist
  entropy: MrcleanEntropyConfig      // NEW
  secrets_files: string[]            // NEW (flattened from [secrets_files].paths)
  rules: MrcleanRuleOverride[]       // NEW ([[rules]] array-of-tables)
}
```

### Full TOML schema (CONTEXT §Configuration)

```toml
dry_run = false

[entropy]
threshold = 4.5
min_length = 20

[secrets_files]
paths = []  # readConfigLayer flattens this to secrets_files: string[]

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

## smol-toml Migration

- **Replaced:** hand-rolled `parseMinimalToml` (~150 LOC)
- **Using:** `import { parse } from 'smol-toml'` in `readConfigLayer`
- **Handles:** `[[rules]]` array-of-tables, `[entropy]` sub-table, `[secrets_files].paths` flattening
- **Type guards:** defensive validation for all new fields with `ConfigReadError` on shape violations

### secrets_files Flatten Convention

The TOML form `[secrets_files] paths = [...]` is a sub-table. `readConfigLayer` flattens it:

```toml
# TOML on disk:
[secrets_files]
paths = ["custom.env", "secrets.yml"]

# Returned from readConfigLayer as:
{ secrets_files: ["custom.env", "secrets.yml"] }
```

Consumers see `config.secrets_files`, not `config.secrets_files.paths`. Documented in `parseToml` source.

## Merge Semantics (RESEARCH §11.4 — CFG-02)

| Field | Behavior |
|-------|----------|
| `dry_run` | Last layer wins |
| `entropy` | Last object wins (project scalar beats user scalar) |
| `secrets_files` | Last array wins (project wins) |
| `rules` | Last array wins (operator override beats global) |
| `allowlist.*` (5 axes) | **CONCATENATED** across all layers in order |

Example: user sets `allowlist.rules = ['A']`, project sets `allowlist.rules = ['B']` → effective `allowlist.rules = ['A', 'B']`.

## Phase 1 Test Updates

Three Phase 1 tests were minimally updated to reflect smol-toml behavior changes:

1. **reader.test.ts test 3** (install stub): smol-toml parses `[allowlist]` header as empty table → result may include `allowlist: { all-empty-axes }`. Test updated to accept either `{}` or empty-allowlist shape.

2. **reader.test.ts test 6** (malformed error): smol-toml error messages differ from Phase 1's "malformed line N" text. Test updated to not assert a specific error message prefix.

3. **merge.test.ts test 11** (wholesale replacement): Phase 2 concats instead of replaces. Test updated with comment "Updated for Phase 2: allowlist arrays now concat per RESEARCH §11.4".

All 21 config tests pass.

## Canonical Finding Shape

```typescript
// src/detect/findings.ts — canonical, imported by 02-01, 02-02, 02-03
export interface Finding {
  ruleId: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  span: { start: number; end: number }
  value: string          // NEVER log — raw secret
  redactedHash: string   // first 16 hex chars of SHA-256(value)
  fingerprint: string    // `${ruleId}:${redactedHash}`
  source: 'secretlint' | 'gitleaks' | 'entropy' | 'env' | 'words'
  action?: 'block' | 'substitute' | 'audit' | 'off' | 'warn'
}
```

### Helper Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `sha256hex` | `(value: string) => string` | Full 64-char SHA-256 hex |
| `redactedHash` | `(value: string) => string` | First 16 chars of sha256hex |
| `fingerprint` | `(ruleId: string, value: string) => string` | `${ruleId}:${redactedHash(value)}` |
| `dedupBySpan` | `(findings: Finding[]) => Finding[]` | Resolve overlaps by source + length |

### dedupBySpan Algorithm

Source precedence: `secretlint > gitleaks > entropy > env > words` (lower index = higher priority).

Overlap resolution rules:
1. Identical spans: higher-precedence source wins
2. Overlapping spans (non-identical): LONGER span wins (regardless of source)
3. Equal length + overlap: higher-precedence source wins

## TYPE Vocabulary and getTypeForRuleId

```typescript
// src/detect/type-map.ts — canonical, imported by 02-01, 02-03
export const TYPE_VOCABULARY = Object.freeze([
  'AWS_KEY', 'AWS_SECRET', 'GH_TOKEN', 'JWT', 'STRIPE_KEY',
  'OPENAI_KEY', 'ANTHROPIC_KEY', 'PRIVATE_KEY', 'SLACK_TOKEN',
  'GCP_KEY', 'DATABRICKS_KEY', 'AZURE_KEY', 'CF_KEY',
  'ENV', 'WORD', 'ENTROPY', 'SECRET',  // 17 total
])
```

`getTypeForRuleId(ruleId)` resolution:
1. `word:` prefix → `'WORD'` (all Layer 4 outputs without enumeration)
2. Explicit map lookup (secretlint messageIds + gitleaks namespaced IDs + L2/L3 synthetics)
3. Fallback → `'SECRET'`

## Wave 2 Executor Note

**`src/detect/findings.ts` and `src/detect/type-map.ts` are owned by plan 02-00.**
Wave 2 plans (02-01, 02-02, 02-03) IMPORT these modules — do NOT create or modify them.
If you need new TYPE entries or new helpers, revise plan 02-00 first and add to this SUMMARY.

Import pattern for Wave 2 plans:
```typescript
import { Finding, sha256hex, redactedHash, fingerprint, dedupBySpan } from '../detect/findings.js'
import { getTypeForRuleId, TYPE_VOCABULARY } from '../detect/type-map.js'
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Enhancement] Phase 1 tests updated for smol-toml semantic differences**
- **Found during:** Task 2 implementation
- **Issue:** Three Phase 1 tests failed due to new behavior: empty [allowlist] section produces non-empty object, smol-toml error message format differs, allowlist concat replaces wholesale replacement
- **Fix:** Minimally updated 3 test assertions per the plan's explicit instruction: "update the test with a comment... keep the SAME structural shape; do not delete tests"
- **Files modified:** tests/config/reader.test.ts, tests/config/merge.test.ts

**2. [Rule 2 - Deviation] dotenv version 17.4.2 instead of 16.x**
- **Found during:** Task 1 npm install
- **Issue:** CLAUDE.md says `dotenv ^16` but RESEARCH.md §6.1 says `^17.4.0 (LATEST)`. npm resolved 17.4.2.
- **Fix:** Accepted 17.x — it is backward-compatible for `dotenv.parse()` usage and RESEARCH explicitly allows it
- **Impact:** No functional change — only parse-only API used

## Known Stubs

None — all modules are fully implemented.

## Threat Flags

None — no new network endpoints, auth paths, file access outside project tree, or trust boundary crossings introduced. The `sha256hex` helper is Node-builtin crypto only.

## Self-Check: PASSED

- [x] `src/detect/findings.ts` exists with all 5 exports
- [x] `src/detect/type-map.ts` exists with TYPE_VOCABULARY (17) + getTypeForRuleId
- [x] `src/config/index.ts` imports from 'smol-toml' (grep confirms 1 import site)
- [x] `parseMinimalToml` not present as code in src/ (only in comment)
- [x] `src/shared/types.ts` exports MrcleanEntropyConfig, MrcleanRuleOverride, extended MrcleanConfig
- [x] `src/config/defaults.ts` has entropy {threshold:4.5, min_length:20}, secrets_files:[], rules:[]
- [x] All 6 deps in package.json#dependencies and importable
- [x] RED commit `1162e8c` exists in git log
- [x] GREEN (config) commit `0c5fc7d` exists in git log
- [x] GREEN (detect) commit `8be8bd2` exists in git log
- [x] `npx vitest run` → 193 passing tests
- [x] `npm run build` → succeeds

---
*Phase: 02-live-redaction-layers-1-4-one-way*
*Completed: 2026-05-14*
