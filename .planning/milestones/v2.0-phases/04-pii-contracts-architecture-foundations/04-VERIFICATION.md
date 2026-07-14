---
phase: 04-pii-contracts-architecture-foundations
verified: 2026-06-02T19:05:00Z
status: passed
score: 4/4
overrides_applied: 0
re_verification: false
---

# Phase 4: PII Contracts & Architecture Foundations — Verification Report

**Phase Goal:** The load-bearing v2.0 decisions are locked in code before any model exists: a [pii] config sub-table (off by default), PII finding-shape + audit-schema additions, ML deps as optionalDependencies, and a documented+enforced scope fence — the core secret tool is provably unchanged.
**Verified:** 2026-06-02T19:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `[pii]` config sub-table loads/validates without error; absent table == v1 behavior; per-entity action policy expressible | VERIFIED | `validatePiiConfig` in `src/config/index.ts` throws `ConfigReadError` on malformed input; `mergeConfigs(DEFAULT_CONFIG, {}, {})` deep-equals DEFAULT_CONFIG (runtime-confirmed); ssn/credit_card default to `block`, others to `warn`/`audit` |
| 2 | ML deps declared as `optionalDependencies`; core installs and runs with ML deps absent | VERIFIED | `package.json` `optionalDependencies` contains `@huggingface/transformers@^4.2.0` and `onnxruntime-node@^1.24.3`; neither appears in `dependencies` or `devDependencies`; `tests/install/optional-deps.test.ts` (6 assertions) passes |
| 3 | Audit record schema carries `engine`/`model_rev`/`quant`/`backend`; no-raw guarantee explicitly extended to PII | VERIFIED | `AuditRecord` interface in `src/audit/log.ts` lines 69–75 declares all four optional fields; `findingToAuditRecord` LOCKED comment reads "NEVER add raw value, env-var name, file path, or raw PII"; destructure-pick enforces this at runtime |
| 4 | Scope fence documented and enforced — bans cloud PII APIs, model-facing unredact tool, Presidio sidecar; per-phase transition checklist present | VERIFIED | `docs/SCOPE-FENCE.md` contains all three bans plus transition checklist; `THREAT_MODEL.md` §10 cross-links it; `FORBIDDEN_TOOL_NAMES` in `tests/mcp/tools-list.test.ts` extended with `pii_unredact`, `mrclean_pii_unredact`, `disable_pii`, `add_pii_word`, `pii_config_write` |

**Score:** 4/4 truths verified

---

## Phase-Specific Security Invariant Verification

These six invariants were specified as critical verification targets for this phase.

### Invariant 1: Core Secret Tool Provably Unchanged

**Finding:** No detection layer emits PII findings. Zero production behavior change.

Evidence:
- `grep -rn "pii-regex|pii-ner|config.pii" src/detect/layer1-regex/ src/detect/layer2-entropy.ts src/detect/layer3-env.ts src/detect/layer4-words.ts src/detect/index.ts` returns empty.
- `SOURCE_PRECEDENCE` extended at the tail only; `dedupBySpan` logic untouched.
- All existing secret-layer precedence assertions in `tests/detect/findings.test.ts` remain green.

**Status: VERIFIED**

### Invariant 2: Audit No-Raw Rule — Destructure-Pick (CR-01 Fix)

**Finding:** `findingToAuditRecord` in `src/audit/log.ts` lines 186–193 uses destructure-pick (`engine: provenance.engine`, `model_rev: provenance.model_rev`, etc.) — NOT a blind spread. CR-01 (code review fix committed in `68ccc18`) is applied.

Runtime verification: An over-shaped provenance object `{ engine, model_rev, quant, backend, value: 'LEAKED_PII_SSN_123-45-6789' }` passed to `findingToAuditRecord` does NOT produce a record containing the extra `value` field.

**Note (WARNING, non-blocking):** The REVIEW (CR-01) also prescribed adding a test to `tests/audit/canary-leak.test.ts` that passes an over-shaped provenance with an extra `value` field. This specific regression test was NOT added to `canary-leak.test.ts`. The `log.test.ts` contains a test that verifies a correctly-shaped provenance doesn't leak the finding's raw value, but not the over-shaped provenance scenario. The security fix itself is in place and runtime-verified; the missing test is a gap in the regression test surface, not in the security implementation. The 425-test full suite is green.

**Status: VERIFIED** (security fix in place; one regression test coverage gap noted — see WARNING below)

### Invariant 3: optionalDependencies — ML Deps Absent from core

| Check | Result |
|-------|--------|
| `@huggingface/transformers` in `optionalDependencies` | YES (`^4.2.0`) |
| `onnxruntime-node` in `optionalDependencies` | YES (`^1.24.3`) |
| `@huggingface/transformers` in `dependencies` | NO |
| `onnxruntime-node` in `dependencies` | NO |
| `@huggingface/transformers` in `devDependencies` | NO |
| `onnxruntime-node` in `devDependencies` | NO |

**Status: VERIFIED**

### Invariant 4: [pii] Config Off By Default — Frozen — Fails Closed

| Check | Result |
|-------|--------|
| `DEFAULT_CONFIG.pii.enabled` | `false` |
| `DEFAULT_CONFIG.pii.regex.enabled` | `true` (sub-lane default) |
| `DEFAULT_CONFIG.pii.ner.enabled` | `false` |
| `DEFAULT_CONFIG.pii` deeply frozen | YES (mutation throws in strict mode) |
| `validatePiiConfig` on `enabled = "not-a-boolean"` | throws `ConfigReadError` |
| `validatePiiActionsMap` on `ssn = "redact"` | throws `ConfigReadError: must be one of: block, warn, audit` |
| `mergeConfigs(DEFAULT_CONFIG, {}, {})` | deep-equals `DEFAULT_CONFIG` (absent-pii == v1 guarantee) |

**Status: VERIFIED**

### Invariant 5: SOURCE_PRECEDENCE Ranks pii-regex Above pii-ner, Both Below All Secret Layers

`SOURCE_PRECEDENCE = ['secretlint', 'gitleaks', 'entropy', 'env', 'words', 'pii-regex', 'pii-ner']`

- `pii-regex` at index 5, `pii-ner` at index 6 — both at tail.
- All secret-layer indices (0–4) unchanged from v1.
- `Finding.source` union: `'secretlint' | 'gitleaks' | 'entropy' | 'env' | 'words' | 'pii-regex' | 'pii-ner'`

**Status: VERIFIED**

### Invariant 6: Scope Fence Documented and Enforced

| Check | Result |
|-------|--------|
| `docs/SCOPE-FENCE.md` exists | YES |
| Contains "Presidio" | YES |
| Contains "cloud PII" / "no-egress" | YES |
| Contains "unredact" ban | YES |
| Contains "Transition Checklist" | YES (7-item checklist) |
| `THREAT_MODEL.md` §10 cross-links SCOPE-FENCE.md | YES |
| `FORBIDDEN_TOOL_NAMES` includes `pii_unredact` | YES |
| `FORBIDDEN_TOOL_NAMES` includes `mrclean_pii_unredact` | YES |
| `FORBIDDEN_TOOL_NAMES` includes `disable_pii` | YES |
| `FORBIDDEN_TOOL_NAMES` includes `add_pii_word` | YES |
| `FORBIDDEN_TOOL_NAMES` includes `pii_config_write` | YES |
| T2b in tools-list.test.ts still green | YES |

**Status: VERIFIED**

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/detect/findings.ts` | `Finding.source` union + `SOURCE_PRECEDENCE` extended with pii-regex/pii-ner | VERIFIED | Both tokens in union AND precedence tuple; tail-only addition |
| `src/detect/type-map.ts` | PII_* TYPE vocabulary (25 entries) + pii: rule-id mappings | VERIFIED | 25 entries confirmed via `TYPE_VOCABULARY.length`; all 8 pii: rule-ids map to PII_* types |
| `src/audit/log.ts` | AuditRecord PII-provenance optional fields + destructure-pick no-raw enforcement | VERIFIED | `engine?`, `model_rev?`, `quant?`, `backend?` present; LOCKED comment updated; destructure-pick applied (CR-01) |
| `src/shared/types.ts` | `MrcleanPiiConfig` interface + `pii` field on `MrcleanConfig` | VERIFIED | Full interface with `MrcleanPiiRegexConfig`, `MrcleanPiiNerConfig`, `PiiAction`; `MrcleanConfig.pii: MrcleanPiiConfig` |
| `src/config/defaults.ts` | Frozen pii defaults (enabled=false) | VERIFIED | `Object.freeze`'d nested structure; `pii.enabled = false` |
| `src/config/index.ts` | `validatePiiConfig` + `[pii]` parse branch + pii merge semantics | VERIFIED | `validatePiiConfig`, `validatePiiRegexConfig`, `validatePiiNerConfig`, `validatePiiActionsMap` all present; last-wins merge; pii branch in `parseToml` |
| `package.json` | `optionalDependencies` block with both ML deps | VERIFIED | `@huggingface/transformers@^4.2.0`, `onnxruntime-node@^1.24.3`; absent from `dependencies` |
| `docs/SCOPE-FENCE.md` | Four bans + in-scope allowlist + transition checklist | VERIFIED | All four bans documented with rationale; 7-item per-phase checklist |
| `THREAT_MODEL.md` | `###10` non-defense entry cross-linking SCOPE-FENCE.md | VERIFIED | Entry at line 109 with all three ban summaries and cross-links |
| `tests/mcp/tools-list.test.ts` | `FORBIDDEN_TOOL_NAMES` extended with PII-write/unredact names | VERIFIED | 5 PII-write names appended; T2b assertion unchanged |
| `tests/install/optional-deps.test.ts` | MODEL-01 invariant tests (6 assertions) | VERIFIED | All 6 assertions in place; tests pass |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/detect/type-map.ts` | `TYPE_VOCABULARY` | PII_* entries appended (vocabulary grows from 17 to 25) | VERIFIED | Confirmed 25 entries; 8 PII entries at tail positions 17–24 |
| `src/audit/log.ts` | `findingToAuditRecord` | Optional provenance param, destructure-pick of 4 model-identity keys only | VERIFIED | Lines 186–193 use destructure-pick; over-shaped object cannot leak extra fields at runtime |
| `src/config/index.ts` | `mergeConfigs` | pii merged with last-wins on entities, scalar last-wins on enabled/action | VERIFIED | `layer.pii` handled in merge loop; deep-merge preserves other sub-table when only one changes |
| `src/config/defaults.ts` | `DEFAULT_CONFIG.pii` | Off-by-default master switch | VERIFIED | `enabled: false` frozen; absent-pii yields byte-identical v1 config |
| `package.json` | `optionalDependencies` | ML deps declared optional, absent from dependencies | VERIFIED | Runtime check confirms structure |
| `tests/mcp/tools-list.test.ts` | `FORBIDDEN_TOOL_NAMES` | pii_unredact / mrclean_pii_unredact / disable_pii appended | VERIFIED | All 5 PII-write names present in the array |

---

## Data-Flow Trace (Level 4)

Not applicable — Phase 4 is contract-only (schema, config surface, dependency declarations, documentation). No dynamic data rendering occurs in this phase. No detector emits PII findings. All pii-related code paths are latent until Phases 5/6 wire actual detection logic.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `DEFAULT_CONFIG.pii.enabled` is `false` | `npx tsx` runtime check | `false` | PASS |
| `DEFAULT_CONFIG` deeply frozen | `(DEFAULT_CONFIG.pii as any).enabled = true` | throws TypeError | PASS |
| `validatePiiConfig` fails on bad boolean | `enabled = "not-a-boolean"` | throws `ConfigReadError` | PASS |
| `validatePiiActionsMap` rejects unknown action | `ssn = "redact"` | throws `ConfigReadError` with `block, warn, audit` | PASS |
| Absent `[pii]` yields v1 config | `mergeConfigs(DEFAULT_CONFIG, {}, {})` | deep-equals DEFAULT_CONFIG | PASS |
| Over-shaped provenance does not leak | `findingToAuditRecord(finding, ..., { engine, value: 'LEAKED' })` | serialized record does not contain 'LEAKED' | PASS |
| PII raw SSN not in audit record | `findingToAuditRecord(piiFinding, ...)` with value `123-45-6789` | not in `JSON.stringify(record)` | PASS |
| `TYPE_VOCABULARY.length` is 25 | `npx tsx` runtime check | `25` | PASS |
| `getTypeForRuleId('pii:email')` | `npx tsx` runtime check | `PII_EMAIL` | PASS |
| `getTypeForRuleId('pii:unknown-entity')` | `npx tsx` runtime check | `SECRET` | PASS |

---

## Probe Execution

No probe scripts declared for Phase 4 plans. Phase used `npx vitest run` as its verification gate.

Full test suite: **425/425 passing** (confirmed via `npx vitest run`).

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PII-03 | 04-01, 04-02 | PII detection OFF by default; per-entity action policy (checksum-validated entities can block) | VERIFIED | `DEFAULT_CONFIG.pii.enabled = false`; ssn/credit_card default to `block`; off-by-default == v1 test green |
| MODEL-01 | 04-03 | ML deps declared as `optionalDependencies`; failed native build never breaks core | VERIFIED | `optionalDependencies` block confirmed; `dependencies` ML-free; `tests/install/optional-deps.test.ts` passes |
| PIISEC-03 | 04-03 | Scope fence documented and enforced — no cloud PII APIs, no model-facing unredact tool, no Presidio sidecar | VERIFIED | `docs/SCOPE-FENCE.md` with all bans; `FORBIDDEN_TOOL_NAMES` extended; T2b green |

All three Phase 4 requirements are satisfied. No orphaned requirements.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `tests/detect/type-map.test.ts` | 8 | Stale comment: "17 entries" in file-level JSDoc, but test at line 119 correctly asserts 25 | INFO | No code impact; comment is stale documentation only |

No TBD/FIXME/XXX markers. No TODO/HACK/PLACEHOLDER markers. No empty implementations or hardcoded empty stubs in phase-modified files.

### Code Review Resolution Status

| Finding | Severity | Fix Status | Evidence |
|---------|----------|-----------|---------|
| CR-01: Provenance blind-spread → destructure-pick | CRITICAL | FIXED | `src/audit/log.ts` lines 186–193; runtime-verified; committed in `68ccc18` |
| CR-01 test: Add over-shaped provenance test to `canary-leak.test.ts` | CRITICAL (test gap) | NOT DONE | canary-leak.test.ts was NOT modified in `68ccc18`; test absent |
| WR-01: Config error echoes raw value | WARNING | FIXED | `validatePiiActionsMap` error message no longer includes `got ${JSON.stringify(value)}` |
| IN-01: Orphaned TSDoc blank line | INFO | FIXED | Blank line between provenance JSDoc block and `engine?` field removed |

**CR-01 test gap assessment:** The security fix (destructure-pick) is in place and runtime-verified. The missing regression test in `canary-leak.test.ts` means there is no automated guard specifically testing that an over-shaped provenance object cannot leak extra fields. The `log.test.ts` test at line 170 verifies that a correctly-shaped provenance doesn't serialize the finding's `value`, but does not test the over-shaped object scenario that CR-01 specifically flagged. This is a test surface gap, not a security implementation gap.

---

## Human Verification Required

None. All phase 4 deliverables are code-level contracts, dependency declarations, and documentation — fully verifiable by automated checks. No UI behavior, real-time behavior, or external service integration to verify.

---

## Gaps Summary

No blocking gaps. The phase goal is fully achieved:

1. `[pii]` config sub-table is wired, off by default, deeply frozen, and fails closed on malformed input.
2. ML deps are correctly declared as `optionalDependencies` and absent from the core dependency tree.
3. Audit schema extended with PII provenance fields; no-raw rule hardened by destructure-pick (CR-01 fix applied).
4. Scope fence documented in `docs/SCOPE-FENCE.md`, cross-linked in `THREAT_MODEL.md`, and enforced by `FORBIDDEN_TOOL_NAMES` in CI.
5. No detection layer emits PII findings — the core secret tool is demonstrably unchanged.
6. All 425 tests pass.

**One WARNING (non-blocking):** The REVIEW required a specific regression test in `canary-leak.test.ts` for the over-shaped provenance scenario (CR-01). The code fix is in place; only the regression test is absent. This does not affect the phase goal — it is a test coverage gap for a future hardening exercise.

---

_Verified: 2026-06-02T19:05:00Z_
_Verifier: Claude (gsd-verifier)_
