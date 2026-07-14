---
phase: "04"
plan: "02"
subsystem: config
tags: [pii, config-schema, types, defaults, merge-semantics, tdd]
dependency_graph:
  requires:
    - "src/shared/types.ts (v1)"
    - "src/config/defaults.ts (v1)"
    - "src/config/index.ts (v1)"
  provides:
    - "MrcleanPiiConfig interface (src/shared/types.ts)"
    - "PiiAction type (src/shared/types.ts)"
    - "DEFAULT_CONFIG.pii frozen block (src/config/defaults.ts)"
    - "validatePiiConfig + [pii] parse branch + pii merge (src/config/index.ts)"
  affects:
    - "All consumers of MrcleanConfig (must use DEFAULT_CONFIG spread or add pii field)"
tech_stack:
  added: []
  patterns:
    - "Object.freeze'd nested defaults with as-unknown-as cast (mirrors entropy/allowlist pattern)"
    - "validatePiiConfig mirrors validateEntropyConfig pattern (typed ConfigReadError on bad shapes)"
    - "Last-wins deep-merge for pii (distinct from allowlist concat)"
    - "TDD RED/GREEN with pii-schema.test.ts as the gate file"
key_files:
  created:
    - tests/config/pii-schema.test.ts
  modified:
    - src/shared/types.ts
    - src/config/defaults.ts
    - src/config/index.ts
    - tests/detect/layer2-entropy.test.ts
    - tests/detect/layer1/engine-integration.test.ts
    - tests/detect/orchestrator.test.ts
    - tests/hook/handlers-detection.test.ts
    - tests/mcp/check.test.ts
    - tests/mcp/redact.test.ts
    - tests/mcp/status.test.ts
decisions:
  - "pii.*.entities arrays use last-wins (NOT concat) — project layer can narrow entity set (per ARCHITECTURE-v2-pii.md)"
  - "deep-merge at sub-table level: a layer that only touches [pii.regex] does NOT wipe [pii.ner]"
  - "validatePiiActionsMap validates against {block,warn,audit} set at parse time (T-04-02-02)"
  - "Test-helper files updated to spread DEFAULT_CONFIG rather than inline the v1 shape (forward-compatible)"
metrics:
  duration_seconds: 485
  completed_date: "2026-06-02T22:33:13Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 10
  files_created: 1
---

# Phase 4 Plan 02: PII Config Schema Summary

Adds the operator-facing `[pii]` configuration sub-table — OFF by default — to the existing three-layer config reader. With no `[pii]` table present, behavior is byte-identical to v1.

## What Was Built

**MrcleanPiiConfig interface (src/shared/types.ts):**
- `PiiAction = 'block' | 'warn' | 'audit'` union type
- `MrcleanPiiRegexConfig` — hot-path lane: enabled flag, entities string[], actions map
- `MrcleanPiiNerConfig` — MCP-only lane: enabled, model, dtype, entities, confidence, allowDownload, warmOnBoot, actions map
- `MrcleanPiiConfig` — master switch + regex + ner sub-tables; JSDoc documents last-wins merge semantics
- `pii: MrcleanPiiConfig` field added to `MrcleanConfig` with merge-semantics note

**Frozen defaults (src/config/defaults.ts):**
- `DEFAULT_CONFIG.pii.enabled = false` (master switch OFF — absent-[pii] == v1 guarantee)
- `DEFAULT_CONFIG.pii.regex.entities = ["email","ssn","credit_card","phone","ip"]`
- `DEFAULT_CONFIG.pii.regex.actions = { ssn:"block", credit_card:"block", email:"warn", phone:"warn", ip:"audit" }`
- `DEFAULT_CONFIG.pii.ner.entities = ["PERSON","ORG","LOC"]`
- `DEFAULT_CONFIG.pii.ner.actions = { PERSON:"warn", ORG:"warn", LOC:"audit" }`
- All nested objects and arrays are `Object.freeze`'d using the `as unknown as` cast pattern

**Config parser + validator (src/config/index.ts):**
- `validatePiiActionsMap` — validates each action value against `{block, warn, audit}` (T-04-02-02)
- `validatePiiRegexConfig` / `validatePiiNerConfig` — typed validators mirroring `validateEntropyConfig`
- `validatePiiConfig` — top-level [pii] validator; throws `ConfigReadError` naming the offending key on type mismatch
- `[pii]` branch added to `parseToml` — absent [pii] yields `pii: undefined` in Partial
- `mergeConfigs` — pii deep-merged with last-wins semantics; entities arrays REPLACE (not concat); sub-table changes don't wipe the other sub-table

**Test coverage (tests/config/pii-schema.test.ts, 16 tests):**
- Task 1 (7 tests): shape, frozen invariant, per-entity action defaults
- Task 2 (9 tests): parse round-trip, absent-[pii]==v1 guarantee, ConfigReadError on bad shapes/invalid actions, last-wins narrowing, deep-merge

## TDD Gate Compliance

- RED commit: `ff3e423` — 14 failing tests (`test(04-02): add failing tests for MrcleanPiiConfig shape, defaults, parse, merge`)
- GREEN commit: `5d2f2b8` — all 16 tests passing (`feat(04-02): add MrcleanPiiConfig interface, frozen defaults, parser + merge`)
- REFACTOR: not required — implementation is clean

## Verification

- `npx vitest run tests/config/` — 37 tests pass (4 files: pii-schema, merge, reader, phase2-schema)
- `npm run typecheck` — zero new errors in src/config/* and src/shared/types.ts
- `grep -rn "config\.pii" src/detect` — empty (no detector reads config.pii in Phase 4)
- T-04-02-01: `mergeConfigs(DEFAULT_CONFIG, {}, {})` deep-equals DEFAULT_CONFIG (absent-[pii] == v1 test passes)
- T-04-02-02: invalid actions map values throw ConfigReadError with valid-set mention

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated 6 test helper files to include pii field**
- **Found during:** Task 2 (typecheck after adding pii to MrcleanConfig)
- **Issue:** 6 test files constructed `MrcleanConfig` objects inline without the new `pii` field — TypeScript TS2741 "Property 'pii' is missing"
- **Fix:** Import `DEFAULT_CONFIG` and spread it in `makeConfig()` helpers and local config constants across: `tests/detect/layer2-entropy.test.ts`, `tests/detect/layer1/engine-integration.test.ts`, `tests/detect/orchestrator.test.ts`, `tests/hook/handlers-detection.test.ts`, `tests/mcp/check.test.ts`, `tests/mcp/redact.test.ts`, `tests/mcp/status.test.ts`
- **Commit:** `5d2f2b8`

## Known Stubs

None — all pii config surface is fully defined with real defaults. No detectors wire against `config.pii` in Phase 4 (by design — config surface only).

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries introduced. The [pii] config sub-table is read-only operator input, validated at parse time (T-04-02-01, T-04-02-02 mitigations applied).

## Self-Check: PASSED
