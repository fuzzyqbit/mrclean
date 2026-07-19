---
phase: 08-contract-verification-reversible-plumbing
plan: 01
subsystem: config
tags: [reversible, config, toml, types, tdd, session-end]
requires: []
provides:
  - "SessionEndInput + hook_event_name/HookInput unions widened with SessionEnd (src/shared/types.ts)"
  - "MrcleanReversibleConfig + MrcleanConfig.reversible contract"
  - "[reversible] TOML table: parse + fail-closed validate + LAST-WINS merge, frozen default { enabled: false }"
affects:
  - "08-02 (dispatcher/handler imports SessionEndInput)"
  - "08-03 (doctor reads config.reversible)"
  - "Phase 9 (session state adapter consumes reversible.enabled)"
tech-stack:
  added: []
  patterns:
    - "[pii] config-table precedent reused 1:1 for [reversible] (validator + parseToml branch + merge seed)"
    - "Differential typecheck gate (error-set diff vs baseline) when repo baseline is not green"
key-files:
  created:
    - tests (extended, not created): tests/config/reader.test.ts, tests/config/merge.test.ts
  modified:
    - src/shared/types.ts
    - src/config/defaults.ts
    - src/config/index.ts
    - tests/config/reader.test.ts
    - tests/config/merge.test.ts
    - dist/cli.js (rebuild)
    - dist/mcp.js (rebuild)
decisions:
  - "SessionEndInput.reason is an OPEN string (not a closed union) — upstream added a sixth reason after milestone research; closed union would break on future additions"
  - "Test D strengthened to bidirectional last-wins assertion — plan's literal spec could not fail at RED (seed default false made true→false vacuous)"
  - "Pre-existing 36-error typecheck baseline handled via differential gate, not fixed (scope boundary); logged to deferred-items.md"
  - "REFACTOR phase skipped — shared boolean-validator extraction would touch Phase-4-owned validatePii* code with differing default-fallback semantics; not trivial"
  - "dist/ rebuild committed as separate chore per repo convention (cf. 5e15b13, b1b5acc)"
metrics:
  duration: "~12 min"
  completed: "2026-07-14"
  tasks: 3
  commits: 4
requirements-progress: "REVMODE-02 groundwork only — config table clause done; requirement completes in Phase 9 (session state adapter). NOT marked complete."
---

# Phase 8 Plan 01: [reversible] Config Table + Phase 8 Type Contracts Summary

**One-liner:** `[reversible]` TOML table parses, validates fail-closed (ConfigReadError with file+reason), merges LAST-WINS, and defaults to frozen `{ enabled: false }` when absent — plus SessionEndInput and MrcleanReversibleConfig contracts that plans 08-02/08-03 build against.

## TDD Narrative (plan type: tdd)

**Scaffolding (Task 1, chore):** All Phase 8 type contracts landed in one pass —
`hook_event_name` union + `HookInput` union widened with `SessionEnd`,
`SessionEndInput` added with an OPEN `reason: string` (cited
code.claude.com/docs/en/hooks, fetched 2026-07-14), `MrcleanReversibleConfig`
(`enabled` only — YAGNI fence), `MrcleanConfig.reversible`, the frozen
`{ enabled: false }` default in defaults.ts, and the compile-forced
mergeConfigs seed (copy of the frozen default, never an alias). No parseToml
branch, no validator — those had to fail RED first. LOCKED header contract
date refreshed to 2026-07-14.

**RED (Task 2):** Six tests written against the [pii] precedents.
Run confirmed 5 assertion-level failures (A: parse-positive, B: wrong-type
rejects, C: unknown-key tolerance, D: last-wins merge, E: single-layer
carry-through) and 1 expected pass (F: absent-table default — provided by
Task 1 scaffolding, noted in the commit body). No import/syntax errors.

**GREEN (Task 3):** Three insertion points in src/config/index.ts, each 1:1
with the [pii] precedent: `validateReversibleConfig` (isRecord guard +
boolean type-check, returns `{ enabled: raw['enabled'] === true }` with
unknown keys dropped), the parseToml `'reversible' in parsed` branch, and the
mergeConfigs LAST-WINS replacement with a NEW object. All 6 tests green; full
suite green.

**REFACTOR:** Skipped deliberately. The only DRY candidate (shared
boolean-field validation helper across pii/reversible validators) would
modify Phase-4-owned `validatePii*` functions whose default-fallback
semantics differ per field — not the trivial extraction the plan gated on.

## TDD Gate Compliance

| Gate | Commit | Order |
|------|--------|-------|
| RED  | 13a7800 `test(08-01): add failing tests for [reversible] config parse/validate/merge` | 2nd |
| GREEN | 1c92ca9 `feat(08-01): implement [reversible] config table (parse/validate/merge, default OFF)` | 3rd |
| REFACTOR | — (skipped, no changes) | — |

`test(08-01)` precedes `feat(08-01)` in history. Gate sequence valid.

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| cc66a3e | chore | SessionEnd + reversible type contracts (types.ts, defaults.ts, mergeConfigs seed) |
| 13a7800 | test | RED — 5 failing tests + 1 passing regression guard (Test F) |
| 1c92ca9 | feat | GREEN — validateReversibleConfig + parseToml branch + last-wins merge |
| 684ab65 | chore | dist rebuild (tracked artifacts, repo convention) |

## Must-Haves Verification

- **Truth 1** — `[reversible]` with `enabled = true` → merged config carries `reversible.enabled === true`: proven by Tests A + E (and D's false→true direction).
- **Truth 2** — absent `[reversible]` → merged `reversible.enabled === false`, shipped behavior byte-identical: proven by Test F + full suite green (603 passed / 3 skipped) with ZERO edits to tests/detect/, tests/placeholder/, or audit suites.
- **Truth 3** — wrong-typed `enabled` fails closed with ConfigReadError naming file and reason: proven by Test B (`.reason === '[reversible].enabled must be a boolean'`, `.path === configPath`).
- **Artifacts** — `SessionEndInput` in types.ts (grep: 2), `reversible` in defaults.ts (grep: 3), `validateReversibleConfig` in config/index.ts (grep: 3). All key_links present (`DEFAULT_CONFIG.reversible` seed; validator returns `MrcleanReversibleConfig`).

## Threat Model Dispositions Applied

- **T-08-01 (Tampering, mitigate):** validator throws ConfigReadError on any non-boolean `enabled`; never coerces. Test B proves it.
- **T-08-02 (EoP, mitigate):** `Object.freeze({ enabled: false })` default; Test F + full-suite gate prove absent-table == shipped guarantee.
- **T-08-03 (DoS, mitigate):** `reason` typed as open `string` — no future upstream reason value can become a type failure in the fail-closed wrapper.
- **T-08-SC (accept):** zero package installs this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test D as literally specified could not fail at RED**
- **Found during:** Task 2 (writing RED tests)
- **Issue:** Plan's Test D (layers true→false, expect false) passes vacuously at RED because the Task 1 mergeConfigs seed already defaults to `{ enabled: false }` — violating the plan's own "MUST FAIL at RED" requirement and the TDD fail-fast rule.
- **Fix:** Test D asserts BOTH directions: false→true (fails at RED — the discriminator) and true→false (proves LAST-WINS over any-wins at GREEN). Semantics of the plan's spec fully preserved.
- **Files modified:** tests/config/merge.test.ts
- **Commit:** 13a7800

**2. [Rule 3 - Blocking] `npm run typecheck` fails with 36 PRE-EXISTING errors at baseline**
- **Found during:** Task 1 verification
- **Issue:** Plan acceptance criteria require `npm run typecheck` exits 0, but a pristine checkout of the base commit (6f8706b) — worktree AND main repo — fails with the same 36 errors in files untouched by this plan (stale v2.0-era test fixtures, doctor/audit/detect strictness errors). Vitest doesn't type-check, so `npm test` stays green.
- **Fix:** Differential typecheck gate: baseline error set captured at pristine HEAD, error-set diff run at every commit boundary — all three code commits introduce ZERO new errors. Pre-existing errors NOT fixed (scope boundary: unrelated files) — logged to deferred-items.md with per-file breakdown and suggested disposition.
- **Files modified:** none (process adaptation); .planning/.../deferred-items.md created
- **Commit:** documented in cc66a3e/1c92ca9 bodies

**3. [Rule 2 - Missing critical] dist/ tracked artifacts rebuilt and committed**
- **Found during:** Task 3 (full-suite run; integration globalSetup runs `tsup --clean`)
- **Issue:** dist/cli.js and dist/mcp.js are tracked files; the rebuild embeds the reversible plumbing. Leaving them uncommitted would strand a dirty tree and a stale-dist mismatch (integration tests import dist/).
- **Fix:** Committed as separate `chore(08-01): rebuild dist` per repo convention (cf. 5e15b13, b1b5acc).
- **Files modified:** dist/cli.js, dist/mcp.js
- **Commit:** 684ab65

## Known Stubs

None. No placeholder text, hardcoded-empty-flowing-to-UI values, or unwired
components. `config.reversible` is intentionally unconsumed until Phase 9's
session state adapter — that is the plan's declared scope (REVMODE-02
groundwork), not a stub.

## Requirements Note

REVMODE-02 is **NOT marked complete**: this plan delivers only its first
clause (the config table). The requirement completes in Phase 9 with the
session state adapter (per plan objective and STATE.md phase mapping).

## Verification Results

- `npx vitest run --project=unit tests/config/reader.test.ts tests/config/merge.test.ts` → 19/19 pass
- `npm test` → 603 passed / 3 skipped, 0 failed (SC2 byte-identical gate)
- Typecheck differential → identical 36-error set at every commit boundary (0 new)
- TDD gate greps → test(08-01) 13a7800 before feat(08-01) 1c92ca9
- No file deletions across 6f8706b..HEAD; no untracked files left

## Self-Check: PASSED

All 5 code files + SUMMARY + deferred-items exist; all 4 commit hashes
(cc66a3e, 13a7800, 1c92ca9, 684ab65) present in history.
