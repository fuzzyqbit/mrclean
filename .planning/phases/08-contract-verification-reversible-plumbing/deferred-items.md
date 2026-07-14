# Deferred Items — Phase 8

Out-of-scope discoveries logged during execution. Per executor scope boundary,
these are NOT fixed inline — they pre-date Phase 8 work and live in files
unrelated to the executing plans.

## Pre-existing `npm run typecheck` failures (discovered during 08-01, 2026-07-14)

`npm run typecheck` (`tsc --noEmit`) fails with **36 pre-existing errors** at
the Phase 8 base commit (6f8706b). Empirically confirmed baseline: the same 36
errors occur on a pristine checkout of HEAD with all 08-01 changes reverted,
and in the main repo checkout at the same commit. Plan 08-01 used a
**differential typecheck gate** instead (error set diffed against baseline at
every commit boundary — zero new errors introduced by any 08-01 commit).

Baseline error distribution (file: count):

| File | Errors | Flavor |
|------|--------|--------|
| tests/hook/handlers-detection.test.ts | 22 | Test fixtures stale vs types: `EnvBlocklist.meta`, `DetectionResult.nerStatus`, `ResolvedFinding.source` missing from literals |
| tests/install/idempotency.test.ts | 3 | `noUncheckedIndexedAccess` possibly-undefined |
| src/doctor/version-check.ts | 3 | `string \| undefined` not assignable to `string` |
| tests/mcp/server-ner-preload.test.ts | 1 | implicit any |
| tests/mcp/redact.test.ts | 1 | `DetectionResult.nerStatus` missing |
| tests/detect/orchestrator.test.ts | 1 | query-string module specifier (`?budget=1`) unresolvable |
| tests/audit/log.test.ts | 1 | TS2352 unsafe cast |
| src/audit/log.ts | 1 | TS4115 missing `override` modifier |
| src/detect/layer1-regex/secretlint-engine.ts | 1 | secretlint rule-config type mismatch |
| src/detect/layer1-regex/gitleaks-adapter.ts | 1 | TS2352 TomlTable → GitleaksToml |
| src/doctor/bench.ts | 1 | Map value-type mismatch |

**Why tests still pass:** Vitest transpiles without type-checking, so `npm test`
is green (603 passed / 3 skipped) despite the tsc failures. The errors look like
drift accumulated across v2.0 type additions (`nerStatus`, `EnvBlocklist.meta`,
`ResolvedFinding.source`) that never got back-ported into older test fixtures,
plus a possible tsc-strictness/version bump.

**Suggested disposition:** a dedicated quick-task or Phase 8 gap-closure plan to
restore `tsc --noEmit` to exit 0 repo-wide. Until then, executors on later
Phase 8 plans should use the same differential gate (baseline error list:
36 errors at 6f8706b).

Full baseline list preserved in the 08-01 execution scratchpad and reproducible
via `git checkout 6f8706b && npx tsc --noEmit`.
