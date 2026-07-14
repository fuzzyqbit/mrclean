---
phase: 04-pii-contracts-architecture-foundations
plan: "01"
subsystem: detect/audit-schema
tags: [pii, contracts, finding-schema, type-vocabulary, audit-schema, tdd]
dependency_graph:
  requires: [02-00-PLAN]
  provides: [Finding.source pii-regex/pii-ner, SOURCE_PRECEDENCE tail entries, TYPE_VOCABULARY 25-entry, pii: rule-id mappings, AuditRecord provenance fields]
  affects: [05-01-PLAN, 06-01-PLAN, 06-02-PLAN]
tech_stack:
  added: []
  patterns: [TDD RED-GREEN, contract-only schema extension, backward-compatible optional parameter]
key_files:
  created: []
  modified:
    - src/detect/findings.ts
    - src/detect/type-map.ts
    - src/audit/log.ts
    - tests/detect/findings.test.ts
    - tests/detect/type-map.test.ts
    - tests/audit/log.test.ts
decisions:
  - "SOURCE_PRECEDENCE extended with pii-regex > pii-ner at tail; all secret-layer indices unchanged"
  - "TYPE_VOCABULARY grows from 17 to 25; 8 PII entries appended at tail (stable placeholder indices)"
  - "AuditRecord provenance fields are optional (absent = undefined, omitted in JSON.stringify) for backward-compat"
  - "FindingProvenance interface documents that fields carry model-identity only, never matched text"
  - "LOCKED comment in findingToAuditRecord extended to explicitly cover raw PII"
metrics:
  duration_seconds: 325
  completed_date: "2026-06-02"
  tasks_completed: 3
  tasks_total: 3
  files_created: 0
  files_modified: 6
---

# Phase 4 Plan 01: PII Contracts & Architecture Foundations - Schema Extensions Summary

**One-liner:** Extended Finding.source union, SOURCE_PRECEDENCE, TYPE_VOCABULARY (17→25), and AuditRecord with PII provenance fields — all contract-only, no detector changes.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests: pii-regex/pii-ner source union | 0a8d36e | tests/detect/findings.test.ts |
| 1 (GREEN) | Extend Finding.source + SOURCE_PRECEDENCE with PII lanes | 84a050c | src/detect/findings.ts |
| 2 (RED) | Failing tests: PII TYPE vocabulary + pii: rule-id mappings | fbadbfd | tests/detect/type-map.test.ts |
| 2 (GREEN) | Add PII TYPE vocabulary + pii: rule-id mappings to type-map | 7876f49 | src/detect/type-map.ts |
| 3 (RED) | Failing tests: AuditRecord PII-provenance fields | 88465d6 | tests/audit/log.test.ts |
| 3 (GREEN) | Add PII-provenance fields to AuditRecord; extend no-raw rule to PII | d435205 | src/audit/log.ts |

## What Was Built

### Task 1: Finding.source union + SOURCE_PRECEDENCE

Extended `Finding.source` union type to include `'pii-regex'` and `'pii-ner'`, and appended both to the end of `SOURCE_PRECEDENCE` (in the same order). The full locked precedence chain is now:

```
secretlint, gitleaks, entropy, env, words, pii-regex, pii-ner
```

`dedupBySpan` logic was not modified — it reads precedence by index, so new tail entries automatically get the lowest priority.

**Acceptance criteria verified:**
- `pii-regex` present in both union type AND SOURCE_PRECEDENCE tuple
- `pii-ner` present in both locations, after pii-regex
- All 13 tests pass including existing secret-layer precedence assertions
- TypeScript type errors for `'pii-regex'`/`'pii-ner'` source values are gone (GREEN phase)

### Task 2: TYPE_VOCABULARY + pii: rule-id mappings

Appended 8 PII TYPE strings to the end of `TYPE_VOCABULARY` (frozen array grows from 17 to 25). Added explicit RULE_ID_TO_TYPE entries for all 8 pii: rule-ids:

- Regex-lane (lowercase snake, matching `[pii.regex].entities` config tokens): `pii:email`, `pii:ssn`, `pii:credit_card`, `pii:phone`, `pii:ip`
- NER-lane (uppercase labels, matching bert-base-NER entity set): `pii:PERSON`, `pii:ORG`, `pii:LOC`

**Acceptance criteria verified:**
- `grep -c "PII_" src/detect/type-map.ts` = 18 (8+ distinct PII TYPE entries in vocabulary and mappings)
- `pii:email` and `pii:PERSON` both present with correct mappings
- All 37 tests pass with updated count assertion (25 entries)
- All 17 original entries intact; unknown `pii:*` ids still fall back to SECRET

### Task 3: AuditRecord PII-provenance + no-raw-rule extension

Added four optional fields to `AuditRecord`: `engine`, `model_rev`, `quant`, `backend`. Extended `findingToAuditRecord` with an optional trailing `provenance?: FindingProvenance` parameter that, when present, is spread into the returned record.

Key design decisions:
- Optional fields are `undefined` when absent (omitted in JSON.stringify) — zero backward compat impact
- `FindingProvenance` interface documents that fields carry model-identity metadata only, never matched text
- LOCKED comment updated: "NEVER add raw value, env-var name, file path, or raw PII"
- T-04-01-01 threat mitigated: provenance fields are fixed-shape with no free-text from the finding

**Acceptance criteria verified:**
- All 4 fields present in AuditRecord interface
- `grep -v '^ *\*' ... | grep -c "finding.value"` = 0 (raw value never read)
- LOCKED comment contains "PII"
- All 16 tests pass (log.test.ts + canary-leak.test.ts)

## Verification Results

```
npx vitest run tests/detect/findings.test.ts tests/detect/type-map.test.ts \
  tests/audit/log.test.ts tests/audit/canary-leak.test.ts

Test Files  4 passed (4)
     Tests  66 passed (66)
```

- No detection layer emits pii-regex/pii-ner source tags (grep of layer*.ts = 0 matches)
- canary-leak invariant still holds for new provenance path
- TypeScript: no new errors introduced by plan changes (pre-existing errors are out-of-scope)

## Deviations from Plan

None - plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what the plan specifies. The `FindingProvenance` interface was added as an extra named type for clarity (not required by the plan) but introduces no new surface.

## Known Stubs

None — this plan is schema/contract-only. No detectors emit PII findings yet; that is by design (Phases 5 and 6 will wire the detectors).

## TDD Gate Compliance

All three tasks followed the mandatory RED-GREEN cycle:
1. RED commit (test): failing tests written and committed
2. GREEN commit (feat): minimal implementation to pass, committed
3. No REFACTOR needed (code clean on first pass)

## Self-Check: PASSED

Files verified present:
- src/detect/findings.ts: pii-regex in union AND SOURCE_PRECEDENCE
- src/detect/type-map.ts: 25 entries in TYPE_VOCABULARY, 8 pii: rule-id mappings
- src/audit/log.ts: engine/model_rev/quant/backend in AuditRecord, backward-compat provenance param

Commits verified:
- 0a8d36e: test(04-01): add failing tests for pii-regex/pii-ner source union (RED)
- 84a050c: feat(04-01): extend Finding.source union + SOURCE_PRECEDENCE with PII lanes (GREEN)
- fbadbfd: test(04-01): add failing tests for PII TYPE vocabulary + pii: rule-id mappings (RED)
- 7876f49: feat(04-01): add PII TYPE vocabulary + pii: rule-id mappings to type-map (GREEN)
- 88465d6: test(04-01): add failing tests for AuditRecord PII-provenance fields (RED)
- d435205: feat(04-01): add PII-provenance fields to AuditRecord; extend no-raw rule to PII (GREEN)
