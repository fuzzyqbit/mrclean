---
phase: 01-wired-skeleton
plan: "02b"
subsystem: config
tags: [config, toml, layer-merge, defaults, reader, types]

requires:
  - "01-01: src/shared/types.ts (HookInput/HookOutput types — extended, not replaced)"
  - "01-02: src/install/project-dir.ts (stub config.toml writer — reader round-trips it as {})"

provides:
  - "src/shared/types.ts: MrcleanAllowlist + MrcleanConfig interfaces (Phase 1 schema)"
  - "src/config/defaults.ts: DEFAULT_CONFIG (Object.freeze'd) — dry_run=false, empty allowlist"
  - "src/config/index.ts: ConfigReadError, readConfigLayer, mergeConfigs, loadEffectiveConfig, LoadConfigOpts"
  - "tests/config/reader.test.ts: 6 tests (missing file, empty, install stub, dry_run, allowlist.rules, malformed)"
  - "tests/config/merge.test.ts: 7 tests (defaults, user override, project wins, user allowlist, project replaces, loadEffectiveConfig integration)"

affects:
  - "05-doctor: loadEffectiveConfig({ homeDir, cwd }) is the single entry point for the config-load check"
  - "Phase 2: MrcleanConfig extended with detection.*, secrets_files — merge mechanics unchanged"

tech-stack:
  added:
    - "node:fs/promises readFile (config layer I/O)"
    - "node:path join (path construction)"
    - "node:os homedir (user home directory)"
  patterns:
    - "Three-layer config merge: DEFAULT_CONFIG < ~/.mrclean/config.toml < ./.mrclean/config.toml"
    - "ENOENT-graceful reader: missing file returns {} (no throw)"
    - "Phase 1 minimal TOML parser: ~50 lines, boolean keys + [allowlist] + inline string arrays"
    - "Wholesale allowlist replacement at sub-object level (Phase 1 simplification, documented)"
    - "Object.freeze on DEFAULT_CONFIG + nested arrays to catch accidental mutation at runtime"
    - "Dependency injection via LoadConfigOpts (homeDir, cwd) for test isolation"

key-files:
  created:
    - src/config/defaults.ts
    - src/config/index.ts
    - tests/config/reader.test.ts
    - tests/config/merge.test.ts
  modified:
    - src/shared/types.ts (extended with MrcleanAllowlist + MrcleanConfig; HookInput/HookOutput preserved)

key-decisions:
  - "Phase 1 minimal TOML parser: hand-rolled ~50 LOC to avoid pulling smol-toml before Phase 2 forces it (gitleaks TOML rule pack). Upgrade path documented in source comment."
  - "Unknown TOML sections ([words], [detection] in install stub) are tolerated: header accepted, key=value lines under them silently skipped. This keeps the install stub round-tripping as {}."
  - "Allowlist wholesale replacement (Phase 1): the highest-precedence layer that defines allowlist wins entirely. Arrays within are NOT concatenated. Documented in code for Phase 2 to extend if needed."
  - "Pre-existing type errors in src/install/index.ts and tests/install/idempotency.test.ts (from Plan 01-02) are out of scope — not touched."

metrics:
  duration: "~4 min"
  completed: "2026-05-14"
  tasks: 2
  files_created: 4
  files_modified: 1
  tests_added: 13
  tests_total: 73
---

# Phase 1 Plan 02b: Three-Layer Config Reader Summary

**Three-layer config merge (defaults < user-global < project-local) with Phase 1 minimal TOML parser, Object.freeze'd defaults, and 13 passing tests demonstrating CFG-01 and CFG-03**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-14T04:24:43Z
- **Completed:** 2026-05-14T04:29:00Z
- **Tasks:** 2 (TDD RED/GREEN pairs)
- **Files created:** 4 (2 src modules + 2 test files)
- **Files modified:** 1 (src/shared/types.ts extended)
- **Tests:** 13 new (73 total)

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED | `e87efc1` | test(01-02b): failing tests for reader, merger, loadEffectiveConfig |
| GREEN | `887e596` | feat(01-02b): implementation — all 13 tests pass |

## Phase 1 MrcleanConfig Schema

```typescript
// src/shared/types.ts — Phase 1 schema (Phase 2 extends without replacing)
export interface MrcleanAllowlist {
  rules: string[]        // rule IDs to skip (secretlint/gitleaks)
  paths: string[]        // glob patterns to exclude (Phase 2 consumer)
  stopwords: string[]    // literal stopwords (Phase 2 consumer)
  regexes: string[]      // pattern strings (Phase 2 consumer)
  fingerprints: string[] // SHA-256 fingerprints (Phase 2 consumer)
}

export interface MrcleanConfig {
  dry_run: boolean       // MODE-01 stub — Phase 2 wires into rule actions
  allowlist: MrcleanAllowlist
}
```

**DEFAULT_CONFIG:**
```typescript
{ dry_run: false, allowlist: { rules: [], paths: [], stopwords: [], regexes: [], fingerprints: [] } }
```
Object.freeze'd at top level and nested allowlist + all arrays.

## Phase 1 Minimal TOML Grammar

Accepted syntax (sufficient for Phase 1 schema):

| Construct | Example |
|-----------|---------|
| Blank lines | (ignored) |
| Comment lines | `# any comment` |
| Section header — known | `[allowlist]` |
| Section header — unknown | `[words]`, `[detection]` (header accepted; key lines under it silently skipped) |
| Top-level boolean | `dry_run = true` / `dry_run = false` |
| Allowlist inline string array | `rules = ["RULE-A", "RULE-B"]` |

**Upgrade path to smol-toml (Phase 2):** Documented with a comment block at the top of `src/config/index.ts`: "Phase 1 minimal TOML — Phase 2 swaps in `smol-toml` when DET1-02 requires the full TOML 1.1 grammar." The parser is isolated in `parseMinimalToml()` — Phase 2 replaces that function with a `smol-toml` call without changing the public API.

## Test Coverage by CFG Requirement

| Test | File | CFG Requirement |
|------|------|-----------------|
| missing file → {} | reader.test.ts:1 | CFG-01 (missing file is fine) |
| empty file → {} | reader.test.ts:2 | CFG-01 |
| install stub → {} | reader.test.ts:3 | CFG-01 + round-trip with 01-02 |
| dry_run=true parses | reader.test.ts:4 | CFG-01 |
| allowlist.rules parses | reader.test.ts:5 | CFG-01 |
| malformed → ConfigReadError | reader.test.ts:6 | CFG-01 (structured error) |
| defaults-only merge | merge.test.ts:7 | CFG-03 |
| user override wins | merge.test.ts:8 | CFG-03 |
| project override wins | merge.test.ts:9 | CFG-03 |
| user-only allowlist survives | merge.test.ts:10 | CFG-03 |
| project allowlist replaces user | merge.test.ts:11 | CFG-03 |
| loadEffectiveConfig integration | merge.test.ts:12 | CFG-01 + CFG-03 |
| loadEffectiveConfig no files | merge.test.ts:13 | CFG-01 + CFG-03 |

## Install Stub Round-Trip Confirmation

Test 3 in reader.test.ts uses the EXACT stub content that `createProjectDir` writes (copied verbatim from `src/install/project-dir.ts` `CONFIG_TOML_STUB`). The test confirms `readConfigLayer(stubPath)` resolves to `{}`. The stub contains `[allowlist]`, `[words]`, and `[detection]` section headers — all three are handled gracefully:

- `[allowlist]`: recognised section, no live key=value lines → allowlist not populated → omitted from result
- `[words]`, `[detection]`: unknown sections → headers accepted, subsequent commented lines skipped

**Result:** Writer and reader contracts are aligned. Installing mrclean and reading the generated config.toml produces `{}` (no overrides) as intended.

## Plan 01-05 Integration Note

`loadEffectiveConfig({ homeDir, cwd })` is the single entry point to wire into the doctor `config-load` check:

```typescript
import { loadEffectiveConfig } from '../config/index.js'

// In doctor check:
const config = await loadEffectiveConfig({ homeDir, cwd })
// → success: CFG-01 and CFG-03 demonstrated
// → throws ConfigReadError: report to operator via doctor output
```

No throw = both CFG requirements satisfied. ConfigReadError = operator has a malformed config file.

## Deviations from Plan

None — plan executed exactly as written. Pre-existing TypeScript errors in `src/install/index.ts` and `tests/install/idempotency.test.ts` (from Plan 01-02) are out of scope and were not touched.

## Known Stubs

None — all exported functions are fully implemented. The `allowlist` fields other than `rules` (paths, stopwords, regexes, fingerprints) are stored and round-tripped correctly in Phase 1 but not consumed by any detection logic until Phase 2.

## Threat Flags

None — this plan reads local user-owned config files only. No new network endpoints, auth paths, or trust-boundary crossings introduced.

## Self-Check: PASSED

- [x] `src/config/defaults.ts` exists
- [x] `src/config/index.ts` exists
- [x] `tests/config/reader.test.ts` exists
- [x] `tests/config/merge.test.ts` exists
- [x] `src/shared/types.ts` exports `MrcleanConfig` and `MrcleanAllowlist`
- [x] RED commit `e87efc1` exists in git log
- [x] GREEN commit `887e596` exists in git log
- [x] `npx vitest run tests/config/` → 13 passing tests
- [x] Full test suite → 73 passing tests

---
*Phase: 01-wired-skeleton*
*Completed: 2026-05-14*
