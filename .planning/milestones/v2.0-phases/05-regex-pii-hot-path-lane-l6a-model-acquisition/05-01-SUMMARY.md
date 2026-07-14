---
phase: 05-regex-pii-hot-path-lane-l6a-model-acquisition
plan: "01"
subsystem: detection/pii
tags: [pii, regex, layer6a, allowlist, tdd]
dependency_graph:
  requires: [04-01 (type-map pii:* ruleIds), 04-02 (MrcleanPiiConfig types), 04-03 (DEFAULT_CONFIG pii defaults)]
  provides: [isAllowlisted (shared allowlist module), runLayer6aPii (L6a engine), PII findings in existing pipeline]
  affects: [src/detect/index.ts (orchestrator), src/detect/layer1-regex/index.ts (now imports shared allowlist)]
tech_stack:
  added: []
  patterns: [TDD RED/GREEN/REFACTOR, PERF-03 annotation for justified hot-path RegExp, shared module extraction]
key_files:
  created:
    - src/detect/allowlist.ts
    - src/detect/layer6a-pii.ts
    - tests/detect/allowlist.test.ts
    - tests/detect/layer6a-pii.test.ts
    - tests/detect/orchestrator-pii.test.ts
  modified:
    - src/detect/layer1-regex/index.ts (replaced private isAllowlisted with shared import)
    - src/detect/index.ts (L6a wiring in both runDetection and runDetectionReadOnly)
decisions:
  - "IPv4 pattern anchored with \\b to prevent partial-octet matches (e.g. 56.1.1.1 inside 256.1.1.1)"
  - "PERF-03 annotations added for justified fresh RegExp per scan call (lastIndex bleed safety)"
  - "Audit Test 4 checks ruleId.startsWith('pii:') not source field — AuditRecord has no source field"
metrics:
  duration_seconds: 588
  completed: "2026-06-03T00:38:42Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 5
  files_modified: 2
---

# Phase 05 Plan 01: L6a Regex-PII Hot-Path Lane Summary

**One-liner:** Pure-JS synchronous L6a PII engine (email/SSN/credit-card+Luhn/phone/IPv4) wired into the detection orchestrator behind `pii.enabled` guard with shared 5-axis allowlist module extracted from Layer 1.

## What Was Built

### Task 1: isAllowlisted extracted to src/detect/allowlist.ts

The private `isAllowlisted` function in `src/detect/layer1-regex/index.ts` was extracted into a new shared module `src/detect/allowlist.ts`. This enables both Layer 1 and the new Layer 6a (and future Layer 6b NER) to share a single implementation of the 5-axis allowlist check (rules, fingerprints, regexes with try/catch, stopwords).

Layer 1's import was updated from a private function definition to `import { isAllowlisted } from '../allowlist.js'`. All 27 existing L1 tests still pass (behavior-preserving extraction).

### Task 2: L6a regex-PII engine (src/detect/layer6a-pii.ts)

New module exporting:
- `runLayer6aPii(text, piiConfig, config, coveredSpans?)` — 5-entity synchronous detector
- `luhnCheck(raw)` — inline Luhn algorithm (13-19 digits)

Five PII patterns stored as module-level source strings; fresh `RegExp` created per scan call via `matchAll()` to avoid `lastIndex` bleed across calls (RESEARCH Pitfall 2). PERF-03 annotations document the design intent.

Detection per entity:
- `email` — `[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}` with `gi` flags
- `ssn` — negative lookahead rejects groups 000/666/9xx and serial 0000
- `credit_card` — Visa/MC/Amex/Discover/JCB prefix alternation + Luhn secondary gate
- `phone` — NPA/NXX [2-9] guard prevents version-string false positives (e.g. `3.14.1592`)
- `ip` — validated 0-255 octets anchored by `\b` (prevents partial-octet matches like `56.1.1.1` inside `256.1.1.1`)

Severity from entity (HIGH: ssn/cc; MEDIUM: email/phone; LOW: ip). Action from `piiConfig.actions[entity]`. 5-axis allowlist applied via shared `isAllowlisted(finding, config)`.

### Task 3: Orchestrator wiring (src/detect/index.ts)

Added `runLayer6aPii` import and guarded calls in BOTH `runDetection` and `runDetectionReadOnly`, after Layer 4 push and before `dedupBySpan`:

```typescript
if (config.pii.enabled && config.pii.regex.enabled) {
  const l6a = runLayer6aPii(text, config.pii.regex, config, findings.map((f) => f.span))
  findings.push(...l6a)
}
```

The 3rd argument `config` threads the full 5-axis allowlist into L6a (PII-02 requirement). With `pii.enabled=false` (default), the code path is never entered and detection output is byte-identical to v1.

## Test Results

| Test File | Tests | Result |
|-----------|-------|--------|
| tests/detect/allowlist.test.ts | 6 | PASS |
| tests/detect/layer6a-pii.test.ts | 22 | PASS |
| tests/detect/orchestrator-pii.test.ts | 7 | PASS |
| tests/detect/orchestrator.test.ts | 8 | PASS |
| tests/detect/layer1/* (5 files) | 27 | PASS |
| tests/perf/* (3 files) | 3 | PASS |
| **Total** | **73** | **PASS** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] IPv4 pattern partial-octet false match**
- **Found during:** Task 2 GREEN phase — Test 6b failing
- **Issue:** Pattern without `\b` word boundary matched `56.1.1.1` inside `256.1.1.1` — the regex engine found a valid IP by skipping the leading `2` digit
- **Fix:** Added `\b` anchors to the IPv4 pattern source string: `'\\b(?:...){3}(...)\\b'`
- **Files modified:** src/detect/layer6a-pii.ts (PII_PATTERN_SOURCES map)
- **Commit:** cd2490b (included in Task 2 commit)

**2. [Rule 1 - Bug] PERF-03 compile-once gate violation**
- **Found during:** Task 3 verification — perf gate test failing
- **Issue:** `new RegExp()` calls inside `runLayer6aPii` (which is a non-lazy function) triggered the PERF-03 lint gate without annotation
- **Fix:** Added `// PERF-03: fresh RegExp per entity per scan — required for correctness (lastIndex bleed safety)...` annotation comments to both `new RegExp()` calls
- **Files modified:** src/detect/layer6a-pii.ts
- **Commit:** 556c453 (included in Task 3 commit)

**3. [Rule 2 - Auto-fix] Audit record source field lookup corrected**
- **Found during:** Task 3 — Test 4 checking `r['source'] === 'pii-regex'` but AuditRecord has no `source` field
- **Fix:** Updated test to check `r['ruleId'].startsWith('pii:')` which is the correct field in AuditRecord
- **Files modified:** tests/detect/orchestrator-pii.test.ts
- **Commit:** 556c453

## Success Criteria Check

- [x] L6a regex lane detects email, SSN, Luhn-valid credit card, phone, IPv4 (PII-01)
- [x] PII findings emit in the existing Finding shape with PII_* TYPEs and source 'pii-regex', flowing through existing PlaceholderManager, audit log, and 5-axis allowlist — no new sink code (PII-02)
- [x] 5-axis allowlist suppresses PII end-to-end (config passed through to isAllowlisted inside L6a)
- [x] pii.enabled=false default leaves v1 behavior unchanged (Test 1 in orchestrator-pii)
- [x] Phase 3 perf gate (UserPromptSubmit < 100ms p95, PostToolUse < 200ms p95) still passes (3/3 perf tests green)
- [x] isAllowlisted lives in one shared module (src/detect/allowlist.ts) consumed by L1 and L6a

## Self-Check: PASSED

Checking created files exist:

- src/detect/allowlist.ts: FOUND
- src/detect/layer6a-pii.ts: FOUND
- tests/detect/allowlist.test.ts: FOUND
- tests/detect/layer6a-pii.test.ts: FOUND
- tests/detect/orchestrator-pii.test.ts: FOUND

Checking commits exist:

- 12b8e72 (Task 1 — refactor isAllowlisted extraction): FOUND
- cd2490b (Task 2 — L6a engine): FOUND
- 556c453 (Task 3 — orchestrator wiring): FOUND
