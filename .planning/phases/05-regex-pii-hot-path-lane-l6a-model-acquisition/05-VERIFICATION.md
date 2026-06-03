---
phase: 05-regex-pii-hot-path-lane-l6a-model-acquisition
verified: 2026-06-02T21:10:00Z
status: passed
score: 4/4
overrides_applied: 0
human_verification_resolved:
  - test: "Perf gate with pii.enabled=true (50-run p95, PII-ON config override, all 5 entities)"
    result: "CONFIRMED PASS (orchestrator, 2026-06-02). UserPromptSubmit 4KB p95=3.18ms (<=100ms, 97% headroom); PostToolUse 50KB p95=9.95ms (<=200ms, 95% headroom). The regex-PII lane is genuinely hot-path-safe — no model dependency, negligible added latency."
---

# Phase 5: Regex PII Hot-Path Lane (L6a) + Model Acquisition — Verification Report

**Phase Goal:** Ship a standalone, model-free PII story (regex lane: email, US SSN, Luhn-validated credit card, phone, IPv4 — joins hot-path chain after Layer 4, within < 100/< 200 ms budget, reusing existing placeholder manager + audit log + 5-axis allowlist with zero new sink code) AND build the model cache/download/SHA-256-integrity/side-load infra (testable without inference), reported by `mrclean doctor`.
**Verified:** 2026-06-02T21:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | With pii.enabled=true, email + Luhn-valid credit card + US SSN in a prompt are caught and substituted with `<MRCLEAN:PII_*:NNN>` placeholders, flowing through the same audit log + 5-axis allowlist | VERIFIED | `runLayer6aPii` in `src/detect/layer6a-pii.ts` emits findings with `source: 'pii-regex'`, `ruleId: 'pii:{entity}'`; `getTypeForRuleId` maps them to `PII_EMAIL/PII_SSN/PII_CREDIT_CARD`; orchestrator writes one `AuditRecord` per finding via existing `writeAuditRecord`; Test 2 (orchestrator-pii) asserts substitutedText contains `<MRCLEAN:PII_EMAIL:NNN>` and excludes raw email; Test 4 asserts audit record written; all 39 PII tests pass |
| 2 | Perf gate with regex-PII enabled: UserPromptSubmit (4 KB) < 100 ms p95 and PostToolUse (50 KB) < 200 ms p95 | UNCERTAIN | Perf suite passes (3/3) but tests use `loadEffectiveConfig` which defaults to `pii.enabled=false` — the PII-disabled path is measured, not the enabled path. RESEARCH cited ~82 ms headroom; 5 patterns × < 1 ms compile is well within budget. Needs human spot-check to confirm PII-enabled path empirically. |
| 3 | On opt-in, model lazy-downloads to stable `~/.mrclean/models/` (never cwd-relative) with progress; default PII-off npx cold path never loads ML deps or touches the network | VERIFIED | `MODEL_CACHE_PATH` in `src/model/constants.ts` uses `join(homeDir, '.mrclean', 'models', ...)` — no cwd; `model-cache.ts` imports zero ML deps (`grep -cE "@huggingface/transformers\|onnxruntime" src/model/model-cache.ts` = 0); `cli.ts` uses `await import('./model/model-cache.js')` dynamic import in the `fetch-model` action; `downloadModel` calls `onProgress` callback during streaming; 11 model-cache tests pass |
| 4 | Downloaded model verified against pinned SHA-256, refused on mismatch; offline side-load (`mrclean pii fetch-model --from <path>`) works; mrclean doctor reports model presence/integrity | VERIFIED | `PINNED_MODEL_SHA256 = '7de0a4606c65b60da275a72f37b76a102c41e2b79c6463096a9d0cb800bf3f2c'` (64-char valid hex, grep confirms no `ASSUMED`/`TBD`); `downloadModel` unlinks `.partial` and throws `ModelIntegrityError` on mismatch (Test 5 asserts no file at `MODEL_CACHE_PATH` after mismatch); `sideLoadModel` validates absolute path + regular file + SHA-256 (Test 6/7); `checkModelCache` returns SKIP/PASS/FAIL(exit 6); `computeDoctorReport` pushes it as check #7; `mrclean pii fetch-model --from <path>` registered in `src/cli.ts`; 16 model/doctor tests pass |

**Score:** 4/4 truths verified (SC-2 marked UNCERTAIN pending human perf spot-check)

---

## Code Review CR-01 Fix Confirmation

**CR-01 (BLOCKER — credit-card separator leak):** Confirmed FIXED in commit `f79d580`.

The credit_card pattern in `src/detect/layer6a-pii.ts:64` now reads:
```
(?<![0-9])(?:4[0-9]{3}(?:[ -]?[0-9]{4}){2}(?:[ -]?[0-9]{1,4})?|5[1-5]...|3[47]...|...)(?![0-9])
```
Optional `[ -]?` separators between fixed-length groups — bounded quantifiers, linear-time.

Regression tests added (Tests 2b–2e in `tests/detect/layer6a-pii.test.ts`):
- `4111 1111 1111 1111` (space-separated Visa) → detected
- `4111-1111-1111-1111` (hyphen-separated Visa) → detected
- `3782 822463 10005` (space-separated Amex) → detected
- `4111 1111 1111 1112` (separator-formatted Luhn-invalid) → NOT detected

All 39 PII/orchestrator tests pass with these additions.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/detect/allowlist.ts` | `isAllowlisted` shared module | VERIFIED | 47 lines, exports `isAllowlisted(finding, config): boolean`; imported by `layer1-regex/index.ts` and `layer6a-pii.ts` |
| `src/detect/layer6a-pii.ts` | L6a PII engine, 5 entities, Luhn, allowlist | VERIFIED | 228 lines (> 80 min), exports `runLayer6aPii` + `luhnCheck`; source `'pii-regex'`; all 5 entities; PERF-03 annotations on `new RegExp` calls |
| `src/detect/index.ts` | Orchestrator wired with L6a after L4 | VERIFIED | `runLayer6aPii` called in both `runDetection` (line 316) and `runDetectionReadOnly` (line 226) |
| `src/model/constants.ts` | `PINNED_MODEL_SHA256` real 64-char hex, `MODEL_ID`, `MODEL_DOWNLOAD_URL`, `MODEL_CACHE_PATH` | VERIFIED | Hash `7de0a46...` (64 chars, valid hex, 0 ASSUMED/TBD); `MODEL_CACHE_PATH` builds `~/.mrclean/models/Xenova/bert-base-NER/onnx/model_int8.onnx` from `homeDir` parameter |
| `src/model/model-cache.ts` | `isModelCached`, `verifyModelIntegrity`, `downloadModel`, `sideLoadModel` | VERIFIED | 293 lines (> 80 min); all 4 functions exported; `createHash('sha256')` used 3×; `dirname()` used (WR-01 fix applied); 0 ML dep imports |
| `src/doctor/checks.ts` | `checkModelCache` returning SKIP/PASS/FAIL | VERIFIED | Lines 368–400; returns SKIP (exitCodeOnFail 0) when absent, PASS (exitCodeOnFail 6) when verified, FAIL (exitCodeOnFail 6) on mismatch |
| `src/cli.ts` | `mrclean pii fetch-model [--from <path>]` | VERIFIED | Lines 79–107; `piiCmd.command('fetch-model')` with `--from` option; dynamic `import('./model/model-cache.js')` inside action |
| `tests/detect/allowlist.test.ts` | 6 behaviors | VERIFIED | 6 tests pass |
| `tests/detect/layer6a-pii.test.ts` | 11+ behaviors + CR-01 regression | VERIFIED | 22 tests pass (includes 4 CR-01 regression tests 2b–2e) |
| `tests/detect/orchestrator-pii.test.ts` | 7 orchestrator behaviors | VERIFIED | 7 tests pass |
| `tests/model/model-cache.test.ts` | 7+ behaviors with mocked fetch | VERIFIED | 11 tests pass, no real network |
| `tests/doctor/checks-model.test.ts` | 5 checkModelCache behaviors | VERIFIED | 5 tests pass |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/detect/index.ts` | `src/detect/layer6a-pii.ts` | guarded call after L4, before dedupBySpan | VERIFIED | Lines 225–228 and 315–318; guard `config.pii.enabled && config.pii.regex.enabled` confirmed on both paths |
| `src/detect/index.ts` | L6a call passes full config as 3rd arg | `runLayer6aPii(text, config.pii.regex, config, ...)` | VERIFIED | `grep -c "runLayer6aPii(text, config.pii.regex, config"` = 2 (both functions) |
| `src/detect/layer6a-pii.ts` | `src/detect/allowlist.ts` | `import { isAllowlisted }` | VERIFIED | Line 30: `import { isAllowlisted } from './allowlist.js'`; called at line 219; `grep -c "isAllowlisted" src/detect/layer6a-pii.ts` = 5 (import comment + import + 3 body refs) |
| `src/detect/layer1-regex/index.ts` | `src/detect/allowlist.ts` | private copy removed, shared import | VERIFIED | `grep -c "function isAllowlisted" src/detect/layer1-regex/index.ts` = 0; line 24: `import { isAllowlisted } from '../allowlist.js'` |
| `src/detect/layer6a-pii.ts` | `src/detect/findings.ts` | `source: 'pii-regex'` on Finding | VERIFIED | `grep -c "source: 'pii-regex'"` = 5 (doc comment + literal in candidate building) |
| `src/model/model-cache.ts` | `~/.mrclean/models/` via `homedir()` | `MODEL_CACHE_PATH(homeDir)` uses `join()` | VERIFIED | `dirname(dest)` used for parent dir; `MODEL_CACHE_PATH` builds absolute path from `homeDir` parameter |
| `src/model/model-cache.ts` | `node:crypto createHash('sha256')` | `verifyModelIntegrity` + download/sideload | VERIFIED | `grep -c "createHash('sha256')"` = 3 |
| `src/doctor/index.ts` | `src/doctor/checks.ts checkModelCache` | `results.push(await checkModelCache(homeDir))` | VERIFIED | Line 142; imported at line 34; exit-code JSDoc at lines 18-19 includes code 6 |
| `src/cli.ts` | `src/model/model-cache.js` | dynamic import in fetch-model action | VERIFIED | Line 90: `const { downloadModel, sideLoadModel } = await import('./model/model-cache.js')` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/detect/index.ts` (orchestrator) | `findings[]` with PII source | `runLayer6aPii` → `substituteFindings` | Yes — regex matches from live text, PII placeholders allocated via `PlaceholderManager.allocate()` | FLOWING |
| `src/doctor/checks.ts checkModelCache` | SKIP/PASS/FAIL | `isModelCached(homeDir)` + `verifyModelIntegrity(homeDir)` | Yes — real `fs.access` + SHA-256 stream check | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| PII tests pass (39 tests) | `npx vitest run tests/detect/allowlist.test.ts tests/detect/layer6a-pii.test.ts tests/detect/orchestrator-pii.test.ts` | 3 files, 39 tests passed | PASS |
| Model/doctor tests pass (16 tests) | `npx vitest run tests/model/model-cache.test.ts tests/doctor/checks-model.test.ts` | 2 files, 16 tests passed | PASS |
| Perf gate (PII-disabled path) | `npx vitest run tests/perf/` | 3 files, 3 tests passed | PASS |
| Layer 1 regression (isAllowlisted extraction) | `npx vitest run tests/detect/layer1` | 5 files, 27 tests passed | PASS |
| CR-01 regression (separator card formats) | Tests 2b-2e in layer6a-pii.test.ts | 4 tests pass (space-Visa, hyphen-Visa, space-Amex, separated-invalid) | PASS |
| Perf gate with PII enabled | Requires manual run — see Human Verification | Not verified programmatically | SKIP (human) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PII-01 | 05-01 | Regex/checksum detection of structured PII — email, SSN, credit card (Luhn), phone, IPv4 | SATISFIED | `runLayer6aPii` detects all 5 entities; 22 tests covering each entity, invalid cases, Luhn gate |
| PII-02 | 05-01 | PII findings in existing Finding shape with PII_* TYPEs, source pii-regex, via existing placeholder/audit/allowlist — no new sink code | SATISFIED | `type-map.ts` maps `pii:*` to `PII_*`; orchestrator reuses `PlaceholderManager`, `writeAuditRecord`, `isAllowlisted`; zero new audit/placeholder/allowlist code |
| MODEL-02 | 05-02 | Model lazy-downloads to stable `~/.mrclean/models/` (never cwd-relative); default cold path never loads ML deps | SATISFIED | `MODEL_CACHE_PATH` builds from `homeDir` via `join()`; `model-cache.ts` has 0 ML imports; `cli.ts` dynamic import |
| MODEL-03 | 05-02 | Downloaded model verified against pinned SHA-256; offline side-load; `mrclean doctor` reports model integrity | SATISFIED | `PINNED_MODEL_SHA256` = 64-char real hex; fail-closed on mismatch; `sideLoadModel` implemented; `checkModelCache` in `computeDoctorReport` at position 7 |

All 4 phase requirements are satisfied.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/doctor/index.ts` | 4, 73 | "runs all six checks" / "Run all six doctor checks" — doc drift (7 checks now) | INFO | Doc only; no runtime effect. Code review IN-01 noted this; not fixed in the CR-01 commit. |

No TBD, FIXME, or XXX markers found in any phase 05 files.

No stub patterns (empty returns, hardcoded `[]`/`{}`) found in any phase 05 production files.

---

### Human Verification Required

#### 1. Perf Gate With PII Enabled

**Test:** Run the perf suite with `pii.enabled=true` and `pii.regex.enabled=true` injected into the config used by `user-prompt-submit.perf.test.ts` and `post-tool-use.perf.test.ts`. Either temporarily modify the fixture config loading to override `pii.*` flags, or add a separate perf variant test that passes a PII-enabled config to `runDetection`.

**Expected:** UserPromptSubmit p95 stays <= 100ms and PostToolUse p95 stays <= 200ms with the PII-enabled code path active (5 regex patterns added to hot path). RESEARCH cited ~82ms headroom; measured Phase 3 baseline was p95 ~17.4ms, so up to ~82ms of headroom exists.

**Why human:** The existing perf tests use `loadEffectiveConfig` which reads from the project's real `.mrclean/config.toml` (or defaults), where `pii.enabled=false`. The code path measured by the CI perf gate does NOT include the 5 PII regex patterns. This is the one success criterion (SC-2) that cannot be confirmed from the existing test output alone.

---

## Gaps Summary

No blockers. All four success criteria are satisfied in the codebase. The single UNCERTAIN item (SC-2, perf gate with PII enabled) is a human-confirmable spot-check, not a code gap — the implementation is present and the theoretical headroom is clear. Proceeding to next phase requires one perf confirmation run.

---

_Verified: 2026-06-02T21:10:00Z_
_Verifier: Claude (gsd-verifier)_
