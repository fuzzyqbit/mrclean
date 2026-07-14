---
phase: 03-mcp-tools-performance-gate-public-release
plan: "00"
subsystem: infra
tags: [vitest, coverage, package-metadata, npm-publish, parallel-test-fix, projects-api]

requires:
  - phase: 02-live-redaction-layers-1-4-one-way
    provides: Full detection pipeline (Layers 1-4) with fixture corpus and globalSetup build step

provides:
  - package.json with mrclean-claude npm name, 1.0.0-rc.1 version, MIT license, full publish metadata
  - package.json#files tightened to 13-entry explicit allow-list (no test files, no dist/detect-layer1*)
  - vitest.config.ts split into unit (parallel) + integration (fileParallelism:false) projects
  - Coverage thresholds infrastructure: lines:80, statements:80, functions:75, branches:70
  - Parallel-test-pollution fix: globalSetup (tsup --clean) scoped to integration project only

affects:
  - 03-01 (MCP tools — tests run in unit project via InMemoryTransport)
  - 03-02 (perf tests — tests/perf/** wired into integration project already)
  - 03-04 (coverage threshold enforcement — baseline numbers captured here)
  - 03-05 (npm publish — uses mrclean-claude name and files[] allow-list from this plan)

tech-stack:
  added: []
  patterns:
    - "vitest projects API for unit/integration split with fileParallelism scoping"
    - "Coverage thresholds at workspace level, shared by both projects"
    - "npm pack --dry-run for publish tarball verification"

key-files:
  created: []
  modified:
    - package.json
    - vitest.config.ts
    - tests/hook/handlers.test.ts
    - tests/hook/handlers-detection.test.ts
    - tests/hook/integration-detection.test.ts

key-decisions:
  - "npm package name is mrclean-claude (mrclean is taken on npm since 2012 by jackhq/beautifulnode)"
  - "Version 1.0.0-rc.1 for release-candidate; plan 03-05 bumps to 1.0.0 at publish time"
  - "repository/homepage/bugs URLs use github.com/anthropics/mrclean-claude as placeholder — operator must confirm before publish"
  - "author field left as empty string — operator must fill before publish"
  - "Coverage thresholds locked at lines:80/statements:80/functions:75/branches:70 per CONTEXT.md QA-01"
  - "src/mcp/tools/sanitize.ts, restore.ts, audit-query.ts excluded from coverage (deleted in 03-01)"
  - "tests/perf/** pre-wired into integration project include globs (created in 03-02)"
  - "Banner regex in 3 test files updated to allow semver pre-release suffix (v\\d+.\\d+.\\d+[^ ]*)"

requirements-completed:
  - QA-01

duration: 25min
completed: "2026-05-14"
---

# Phase 3 Plan 00: Package Metadata + Vitest Projects Split Summary

**npm publish metadata locked to mrclean-claude@1.0.0-rc.1, vitest restructured into parallel unit + sequential integration projects with coverage-v8 threshold enforcement, fixing Phase 2's tsup-delete race condition.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-14T14:45:00Z
- **Completed:** 2026-05-14T14:55:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Renamed package to `mrclean-claude` with full publish metadata (repository, homepage, bugs, keywords, description, author placeholder)
- Tightened `package.json#files` from 11 to 13 entries using explicit allow-list — excludes `dist/detect-layer1*` (Phase 2 test-only bundle) and adds THREAT_MODEL.md/CHANGELOG.md (created in 03-03)
- Split vitest config into `unit` (parallel) + `integration` (fileParallelism:false) projects; `tsup --clean` (globalSetup) now scoped to integration project — eliminates the Phase 2 parallel-pollution race
- All 359 tests pass in the restructured config; formerly-flaky `tests/doctor/end-to-end.test.ts` and `tests/install/idempotency.test.ts` both pass
- Coverage thresholds configured and already passing: lines 84.01% / statements 82.89% / functions 82.12% / branches 73.22% (all above their respective thresholds)

## Task Commits

1. **Task 1: Update package.json publish metadata + tighten files allow-list** - `ff0190f` (chore)
2. **Task 2: Restructure vitest.config.ts into unit + integration projects with coverage thresholds** - `8e4296e` (feat)

**Plan metadata:** (follows in final commit)

## Files Created/Modified

- `package.json` - Renamed to mrclean-claude, version 1.0.0-rc.1, full publish metadata, 13-entry files[], release script
- `vitest.config.ts` - Rewritten with projects API (unit + integration), coverage thresholds, JSDoc explaining the split
- `tests/hook/handlers.test.ts` - Rule 1 fix: BANNER_PATTERN updated for semver pre-release suffix
- `tests/hook/handlers-detection.test.ts` - Rule 1 fix: banner regex updated for semver pre-release suffix
- `tests/hook/integration-detection.test.ts` - Rule 1 fix: banner regex updated for semver pre-release suffix

## Decisions Made

- **mrclean-claude is the locked npm package name.** `mrclean` claimed since 2012. `mrclean-claude` verified available via RESEARCH §Pitfall 2.
- **Version 1.0.0-rc.1** chosen as release-candidate identifier; plan 03-05 owns the bump to `1.0.0`.
- **files[] uses explicit entries, not globs.** Prevents accidental inclusion of test artifacts. `npm pack --dry-run` confirms 10 files in tarball (the 13 in files[] minus 3 not-yet-created docs: README.md, LICENSE, THREAT_MODEL.md, CHANGELOG.md).
- **tests/mcp/server-lifecycle.test.ts and tests/mcp/tools-list.test.ts stay in unit project.** These spawn dist/mcp.js but tolerate parallel dist/ access (Phase 1 01-04 SUMMARY confirmed; post-restructure all tests pass).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Banner regex patterns don't match 1.0.0-rc.1 version string**
- **Found during:** Task 2 (npm test after restructure)
- **Issue:** Three test files used `/v\d+\.\d+\.\d+/` which matches `0.1.0` but not `1.0.0-rc.1` — the Task 1 version bump broke these assertions
- **Fix:** Updated regex to `v\d+\.\d+\.\d+[^ ]*` (allows optional pre-release suffix) in all three files
- **Files modified:** tests/hook/handlers.test.ts, tests/hook/handlers-detection.test.ts, tests/hook/integration-detection.test.ts
- **Verification:** All 359 tests pass after fix
- **Committed in:** 8e4296e (Task 2 commit, included with vitest restructure)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug caused by Task 1 version bump)
**Impact on plan:** Necessary correctness fix. No scope creep.

## Issues Encountered

None beyond the auto-fixed regex issue above.

## npm pack --dry-run Output (for plan 03-04 smoke test reference)

```
npm notice Tarball Contents
npm notice 770B    dist/cli.d.ts
npm notice 96.9kB  dist/cli.js
npm notice 294.2kB dist/cli.js.map
npm notice 20B     dist/mcp.d.ts
npm notice 7.3kB   dist/mcp.js
npm notice 13.8kB  dist/mcp.js.map
npm notice 2.1kB   package.json         (always included by npm)
npm notice 98.3kB  vendor/gitleaks-rules.toml
npm notice 64B     vendor/gitleaks-rules.toml.sha256
npm notice 7.5kB   vendor/SKIPPED_GITLEAKS_RULES.md

Total: 10 files (128.9 kB packed, 520.9 kB unpacked)
```

Missing from tarball (expected — created in plan 03-03): README.md, LICENSE, THREAT_MODEL.md, CHANGELOG.md.
These are intentionally listed in `files[]` now so plan 03-05's publish job fails loudly if 03-03 doesn't create them.

## Coverage Baseline (for plan 03-04 threshold-passing work)

Measured via `npm run test:coverage` after Task 2 commit:

| Metric | Actual | Threshold | Status |
|--------|--------|-----------|--------|
| Lines | 84.01% (1072/1276) | 80% | PASS |
| Statements | 82.89% (1158/1397) | 80% | PASS |
| Functions | 82.12% (170/207) | 75% | PASS |
| Branches | 73.22% (495/676) | 70% | PASS |

All thresholds pass on this plan's baseline. Plan 03-04 may need to add coverage if new code added in 03-01..03-03 drops numbers below threshold.

## Operator Confirmation Required Before Publish

The following fields in `package.json` are placeholders that the operator must confirm or update before running `npm publish` in plan 03-05:

| Field | Placeholder Value | Action Required |
|-------|------------------|-----------------|
| `repository.url` | `git+https://github.com/anthropics/mrclean-claude.git` | Confirm or replace with actual repo URL |
| `homepage` | `https://github.com/anthropics/mrclean-claude#readme` | Confirm or replace |
| `bugs.url` | `https://github.com/anthropics/mrclean-claude/issues` | Confirm or replace |
| `author` | `""` (empty string) | Fill with author name/email |

## Integration Project Test Classification

Tests/doctor/end-to-end.test.ts: PASS in integration project (sequential)
Tests/install/idempotency.test.ts: PASS in integration project (sequential)
Tests/mcp/server-lifecycle.test.ts: stays in unit project (passes in parallel)
Tests/mcp/tools-list.test.ts: stays in unit project (passes in parallel)

## Next Phase Readiness

- Plan 03-01 (MCP tools check/redact/status): vitest unit project ready to run new tests/mcp/*.test.ts in parallel
- Plan 03-02 (perf tests): tests/perf/** glob pre-wired in integration project include list
- Plan 03-03 (docs/changesets): README.md, LICENSE, THREAT_MODEL.md, CHANGELOG.md in files[] already — plan 03-03 just needs to create them
- Plan 03-04 (coverage threshold enforcement): baseline numbers above establish starting point; all thresholds currently passing

---
*Phase: 03-mcp-tools-performance-gate-public-release*
*Completed: 2026-05-14*
