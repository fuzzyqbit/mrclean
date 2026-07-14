---
phase: 01-wired-skeleton
plan: "01"
subsystem: infra
tags: [node, typescript, commander, tsup, vitest, mcp-sdk, zod]

requires: []

provides:
  - "package.json with two bin entries (mrclean, mrclean-mcp), Node>=20.18.0 engine floor, ESM module type"
  - "TypeScript ^5.6 + tsup ^8.5 build pipeline producing dist/cli.js and dist/mcp.js with shebangs + executable bits"
  - "Vitest ^4.1 test harness with @vitest/coverage-v8 (5 smoke tests passing)"
  - "src/shared/types.ts — HookInput/HookOutput union types locked to Claude Code hook contract"
  - "src/shared/version.ts — VERSION string from package.json via JSON import assertion"
  - "src/cli.ts — Commander root with install/uninstall/hook/doctor subcommands (entrypoint guard)"
  - "src/mcp.ts — Thin shebang wrapper for MCP server (entrypoint guard prevents startup on import)"
  - "Stub modules: src/install/index.ts, src/hook/index.ts, src/doctor/index.ts, src/mcp/server.ts"

affects: [02-install, 03-hook, 04-mcp, 05-doctor]

tech-stack:
  added:
    - "@modelcontextprotocol/sdk ^1.29.0 (runtime)"
    - "commander ^13.1.0 (runtime — LOCKED by CLAUDE.md, NOT ^14)"
    - "zod ^4.4.3 (runtime)"
    - "picocolors ^1.1.1 (runtime)"
    - "typescript ^5.6.0 (dev)"
    - "tsup ^8.5.1 (dev)"
    - "vitest ^4.1.6 (dev)"
    - "@vitest/coverage-v8 ^4.1.6 (dev)"
    - "tsx ^4.20.0 (dev)"
    - "@types/node ^20.18.0 (dev)"
  patterns:
    - "Entrypoint guard: `import.meta.url === file://${process.argv[1]}` prevents Commander.parseAsync / runMcpServer on import"
    - "Lazy subcommand imports: `await import('./install/index.js')` inside .action() keeps CLI cold-start cheap"
    - "JSON import assertion: `import pkg from '../../package.json' with { type: 'json' }` for NodeNext ESM"
    - "TDD RED/GREEN commit pair per task"

key-files:
  created:
    - package.json
    - package-lock.json
    - tsconfig.json
    - tsup.config.ts
    - vitest.config.ts
    - .gitignore
    - .npmignore
    - src/cli.ts
    - src/mcp.ts
    - src/shared/types.ts
    - src/shared/version.ts
    - src/install/index.ts
    - src/hook/index.ts
    - src/doctor/index.ts
    - src/mcp/server.ts
    - tests/smoke.test.ts
  modified: []

key-decisions:
  - "commander pinned to ^13.1.0 per CLAUDE.md LOCK — RESEARCH.md §OQ-5 suggested ^14 was acceptable; CLAUDE.md LOCK supersedes; resolved version 13.1.0 confirmed at install time"
  - "Entrypoint guard pattern: import.meta.url check prevents argv parsing on test import — no separate loader module needed"
  - "Lazy subcommand imports in .action() callbacks rather than top-level imports — preserves sub-100ms hook cold-start budget (RESEARCH §6.2)"
  - "JSON import assertion (with { type: 'json' }) required for NodeNext ESM module resolution — not 'assert { type: json }' (deprecated syntax)"
  - "dist/ is gitignored — build artifacts not committed to VCS; only src/ is tracked"
  - "Stub modules block in runMcpServer forever (Promise that never resolves) to mimic real server; safe because entrypoint guard prevents call on import"

patterns-established:
  - "Two-bin layout: src/cli.ts → dist/cli.js (mrclean), src/mcp.ts → dist/mcp.js (mrclean-mcp)"
  - "All subcommand bodies lazily imported inside .action() to avoid top-level SDK imports on CLI cold-path"
  - "Shared types in src/shared/ are the single source of truth for hook contract shapes"
  - "Smoke tests import from .js extension (NodeNext ESM), not .ts"

requirements-completed:
  - INST-01
  - INST-08

duration: 5min
completed: "2026-05-14"
---

# Phase 1 Plan 01: Wired Skeleton Scaffold Summary

**Two-bin TypeScript scaffold (mrclean + mrclean-mcp) with ESM-only tsup build, Vitest 4 harness, and Hook contract types — commander pinned to ^13.1.0 per CLAUDE.md LOCK**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-14T04:01:07Z
- **Completed:** 2026-05-14T04:05:50Z
- **Tasks:** 2 (Task 1: config files; Task 2: src/ skeleton + smoke tests, TDD)
- **Files created:** 16

## Accomplishments

- All tech stack versions pinned per CLAUDE.md LOCK: Node>=20.18.0, TS ^5.6, MCP SDK ^1.29, commander **^13.1.0** (NOT ^14), zod ^4.4.3, tsup ^8.5.1, vitest ^4.1.6
- `npm run build` produces `dist/cli.js` and `dist/mcp.js` with `#!/usr/bin/env node` shebangs and executable bits (tsup auto-chmod on shebang detection confirmed on macOS)
- `node dist/cli.js --version` → `0.1.0`, `--help` shows all 4 subcommands
- 5 smoke tests passing (RED→GREEN TDD cycle with separate commits)
- `npm run typecheck` exits 0 with zero TypeScript errors
- `npm install` exits 0 with zero peer-dep warnings

## Task Commits

1. **Task 1: package.json + toolchain config** - `09a2285` (chore)
2. **Task 2 RED: failing smoke tests** - `aa5a736` (test)
3. **Task 2 GREEN: src/ skeleton implementation** - `6b505d6` (feat)

## Files Created/Modified

- `package.json` — name=mrclean, version=0.1.0, type=module, two bin entries, commander ^13.1.0
- `tsconfig.json` — target ES2022, module NodeNext, strict, noUncheckedIndexedAccess
- `tsup.config.ts` — dual-entry ESM, target node20, dts=true, clean=true
- `vitest.config.ts` — node environment, v8 coverage, no threshold
- `.gitignore` — node_modules, dist, coverage, .env*, .DS_Store
- `.npmignore` — excludes tests/, .planning/, config files
- `src/cli.ts` — Commander root with 4 subcommands, entrypoint guard, lazy imports
- `src/mcp.ts` — Thin MCP wrapper with entrypoint guard
- `src/shared/types.ts` — HookInput/HookOutput locked to RESEARCH.md §1.1–§1.2
- `src/shared/version.ts` — VERSION from package.json via JSON import assertion
- `src/install/index.ts` — runInstall/runUninstall stubs (Plan 02 replaces)
- `src/hook/index.ts` — runHook/handleHookEvent stubs (Plan 03 replaces)
- `src/doctor/index.ts` — runDoctor stub (Plan 05 replaces)
- `src/mcp/server.ts` — runMcpServer stub blocking forever (Plan 04 replaces)
- `tests/smoke.test.ts` — 5 module-load smoke tests

## Decisions Made

- **commander ^13.1.0 (NOT ^14)**: RESEARCH.md §OQ-5 noted ^14 was safe, but CLAUDE.md LOCK supersedes. Confirmed 13.1.0 resolves via npm. Documented as deliberate divergence from research recommendation.
- **Entrypoint guard via import.meta.url**: Guards against parseAsync / runMcpServer executing on test import. Clean pattern requiring no extra loader file.
- **Lazy subcommand imports**: `.action()` callbacks use `await import('./module.js')` so MCP SDK never loads on the CLI cold path.
- **JSON import assertion syntax**: `with { type: 'json' }` (NodeNext spec) not the deprecated `assert { type: 'json' }`. Required for `resolveJsonModule: true` in NodeNext mode.

## Deviations from Plan

None — plan executed exactly as written. The one research-vs-plan divergence (commander ^13 vs research suggestion of ^14) was a pre-documented CLAUDE.md LOCK; not an execution-time deviation.

## Known Stubs

The following stubs are **intentional Plan 01 placeholders** documented in the plan with explicit replacement assignments:

| File | Stub | Replaced by |
|------|------|-------------|
| `src/install/index.ts` | `runInstall`, `runUninstall` write stderr "not implemented in Plan 01" | Plan 02 |
| `src/hook/index.ts` | `runHook` writes stderr "not implemented in Plan 01"; `handleHookEvent` returns null | Plan 03 |
| `src/doctor/index.ts` | `runDoctor` writes stderr "not implemented in Plan 01" | Plan 05 |
| `src/mcp/server.ts` | `runMcpServer` writes stderr + blocks forever | Plan 04 |

These stubs do NOT prevent the plan's goal (proving the toolchain and module graph work end-to-end). The smoke tests assert exports exist with correct types, not that stub bodies do useful work.

## Issues Encountered

None. `npm install` was clean on first run. Build succeeded immediately. TypeScript had zero errors.

## Next Phase Readiness

Plans 02, 03, 04 can now run in parallel — they touch disjoint subdirectories:
- Plan 02 → `src/install/`
- Plan 03 → `src/hook/`
- Plan 04 → `src/mcp/`
- Plan 05 (doctor) → `src/doctor/` (depends on 02/03/04 completing)

No blockers. Commander ^13.x LOCK honored — no later plan needs to migrate APIs.

## Verified Facts (for downstream plans)

- **commander installed:** 13.1.0 (confirmed via `node -e "require('./node_modules/commander/package.json').version"`)
- **Shebang chmod:** tsup auto-chmods `dist/cli.js` and `dist/mcp.js` when it detects `#!/usr/bin/env node` — confirmed on macOS (darwin 24.6.0)
- **JSON import assertion:** `with { type: 'json' }` works under NodeNext + TypeScript 5.6
- **Entrypoint guard:** `import.meta.url === \`file://${process.argv[1]}\`` correctly prevents double-execution on import in Vitest

---
*Phase: 01-wired-skeleton*
*Completed: 2026-05-14*
