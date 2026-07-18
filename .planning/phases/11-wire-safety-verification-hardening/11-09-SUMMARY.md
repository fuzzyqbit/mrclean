---
phase: 11-wire-safety-verification-hardening
plan: 09
subsystem: testing
tags: [vitest, github-actions, ci, doctor, ansi-color, hermetic-tests]

# Dependency graph
requires:
  - phase: 11-wire-safety-verification-hardening
    provides: "the REVMODE-11 wire-safety CI gates (canary-leak.yml run_and_guard, named unit/integration wire-safety suites) this plan hardens"
provides:
  - "ANSI-safe canary-leak.yml count-guard (--no-color forced on the captured vitest invocation, immune to GITHUB_ACTIONS-forced colorization)"
  - "hermetic tests/doctor/end-to-end.test.ts Tests 1 & 5 (MRCLEAN_TEST_FAKE_CLAUDE_VERSION stub, pass without a real claude binary on PATH)"
  - "src/doctor/index.ts no longer spawns a canary probe against its own Node binary when a bin path is unregistered (explicit SKIP CheckResult instead)"
affects: [ci, doctor, wire-safety-gates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vitest --no-color as the CLI-level override for CI-forced ANSI colorization (tinyrainbow/std-env isCI detection), independent of environment auto-detection"
    - "explicit SKIP CheckResult (not a silent fallback substitution) when an optional/unregistered resource path is genuinely absent"

key-files:
  created: []
  modified:
    - .github/workflows/canary-leak.yml
    - tests/doctor/end-to-end.test.ts
    - src/doctor/index.ts

key-decisions:
  - "Verified the ANSI-color bug and its fix using a simulated real-CI shell (Claude Code agent env vars — CLAUDECODE, AI_AGENT, etc. — unset) rather than trusting CI=true/GITHUB_ACTIONS=true alone, because vitest's own std-env isAgent detection unconditionally disables colors when it detects an AI-agent shell (like this executor's), which would have made the repro silently pass without proving anything"
  - "Removed the hookBinPath/mcpBinPath || process.execPath fallback entirely rather than special-casing it — a genuinely unregistered bin path should never be handed to a canary spawn as if it were a valid binary"

requirements-completed: [REVMODE-11]

# Metrics
duration: ~15min
completed: 2026-07-18
---

# Phase 11 Plan 09: Ubuntu CI Gap-Closure (ANSI Count-Guard + Hermetic Doctor Tests) Summary

**Forced `--no-color` on the canary-leak.yml vitest count-guard and stubbed `MRCLEAN_TEST_FAKE_CLAUDE_VERSION` in doctor Tests 1 & 5, closing two environment-only defects that only manifest on ubuntu CI runners (no real `claude` binary, GITHUB_ACTIONS-forced ANSI colorization) — plus an SKIP-not-spawn polish for unregistered canary bin paths.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-18T14:07:18Z (approx, first plan read)
- **Completed:** 2026-07-18T14:15:33Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `canary-leak.yml`'s `run_and_guard` shell function now runs `npx vitest run --no-color --project=...`, so the captured output the count-guard greps is never colorized regardless of the runner's CI-flavored environment variables.
- `tests/doctor/end-to-end.test.ts` Tests 1 and 5 now stub `MRCLEAN_TEST_FAKE_CLAUDE_VERSION` (mirroring Test 8's existing pattern) and assert the exact stub-derived version (`'2.1.141'` / `'green'`) instead of a loose, PATH-dependent set — hermetic on any runner, including ubuntu CI with no `claude` binary installed.
- `src/doctor/index.ts` no longer falls back to `process.execPath` when a hook/MCP bin path is unregistered; it pushes an explicit `SKIP` `CheckResult` instead, eliminating a noisy raw ELF/Mach-O `SyntaxError` crash dump on child stderr. Test 3 now locks this in with two new assertions.

## Task Commits

Each task was committed atomically:

1. **Task 1: ANSI-safe CI count-guard in canary-leak.yml** - `feea179` (fix)
2. **Task 2: Hermetic doctor Tests 1 & 5 + optional explicit-SKIP canary polish** - `45a46b6` (fix)

_TDD note: Task 2 was marked `tdd="true"` and combined a test-only hermeticity fix (Tests 1 & 5 stubs — not new behavior, just environment independence) with a genuine RED/GREEN pair (Test 3's new `mcp-canary` SKIP assertions against the `src/doctor/index.ts` fallback-removal fix). Both landed in a single commit rather than separate `test(...)` → `feat(...)` commits (this plan's frontmatter `type: execute`, not `type: tdd`, so the strict plan-level gate sequence does not apply). To rule out a vacuous pass, the RED half was verified retroactively and non-destructively after committing: `src/doctor/index.ts` was temporarily reverted to its pre-fix content (via `git show <prior-commit>:path`, never `git stash`) and Test 3's new assertions were re-run — they failed exactly as expected (`AssertionError: expected 'FAIL' to be 'SKIP'`), then the fix was restored via `git checkout -- src/doctor/index.ts` and verified byte-identical to the committed version. See "Issues Encountered" for the full ANSI-color verification methodology too._

## Files Created/Modified
- `.github/workflows/canary-leak.yml` - `run_and_guard`'s captured vitest invocation now passes `--no-color`
- `tests/doctor/end-to-end.test.ts` - Tests 1 & 5 stub/restore `MRCLEAN_TEST_FAKE_CLAUDE_VERSION` with exact assertions; Test 3 asserts the new `mcp-canary` SKIP behavior
- `src/doctor/index.ts` - bins-executable branch replaces the `|| process.execPath` fallback with per-path explicit SKIP `CheckResult`s

## Decisions Made
- Verified the ANSI-color bug and its `--no-color` fix under a **simulated genuine ubuntu-CI shell** (Claude Code agent-detection env vars — `CLAUDECODE`, `AI_AGENT`, `CLAUDE_CODE_*` — explicitly unset via `env -u`) rather than relying on `CI=true GITHUB_ACTIONS=true` alone in this executor's own shell. Reason: vitest's `std-env`-based `isAgent` detection unconditionally calls `disableDefaultColors()` when it detects an AI-agent shell (this executor's own environment qualifies), which would silently suppress ANSI codes and make any local repro pass whether or not the fix was present — a vacuous-pass risk the plan's success criteria explicitly called out. With the agent markers stripped, the bug was reproduced byte-for-byte (`\x1b[1m\x1b[32m` sitting between "Test Files" and "3 passed", `grep -Eq` NO MATCH without the fix) and the fix confirmed (`grep -Eq` MATCH with `--no-color`).
- Removed the `hookBinPath/mcpBinPath || process.execPath` fallback entirely in `src/doctor/index.ts` rather than adding a conditional around it — a genuinely empty/unregistered bin path should never be silently substituted with an unrelated executable and spawned as if it were a valid canary target (locked in the plan's threat model as T-11-09-03).

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<action>` blocks were followed verbatim; all `<acceptance_criteria>` and `<verify>` commands passed as specified.

## Issues Encountered

**Local ANSI repro required stripping this executor's own agent-detection env vars.** Running the plan's literal repro command (`CI=true GITHUB_ACTIONS=true npx vitest run --no-color --project=unit ...`) inside this Claude Code worktree shell initially produced zero ANSI escape codes even *without* `--no-color`, because vitest's `std-env` dependency detects `CLAUDECODE=1`/`AI_AGENT=claude-code_*` in this shell's environment and calls `disableDefaultColors()` regardless of `CI`/`GITHUB_ACTIONS`/`FORCE_COLOR`. This would have made the verification vacuous (matching "in theory" but never proving the bug/fix pair against real ANSI bytes). Resolved by re-running the repro with `env -u CLAUDECODE -u AI_AGENT -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_JOB_DIR -u CLAUDE_CODE_EXECPATH -u CLAUDE_CODE_SESSION_ID -u CLAUDE_EFFORT`, which faithfully simulates an ubuntu GitHub Actions runner's environment (no agent markers) and produced the real ANSI-colorized `Test Files` line, non-matching `grep -Eq` without the fix, and matching `grep -Eq` with `--no-color`. This does not affect the fix itself (the `.github/workflows/canary-leak.yml` diff is identical to what the plan specified) — it only affects how the verification evidence was gathered, and is documented here per the plan's success-criteria requirement to verify "under a colorized vitest run, not just theoretically."

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both ubuntu-CI-only defects from `.planning/debug/ubuntu-ci-doctor-exit-5.md`'s first-run diagnosis are closed: the wire-safety count-guard is now colorization-proof, and the doctor hermeticity suite no longer depends on a real `claude` binary on the runner's PATH.
- Full `npm test` suite remains green (986 passed / 29 skipped — unchanged from the documented Phase 11 baseline); `npm run typecheck` stays at the pre-existing 38-error baseline with zero new errors and none touching the files this plan modified.
- No blockers. The next `gsd/**` push to `gsd/v3.0-reversible-redact-mode-foundations-operator-restore` will re-fire both `test.yml` and `canary-leak.yml` on ubuntu automatically (standing repo behavior) and should now observe both fixes live — this is the manual/automated follow-up the plan's `<verification>` section calls out, owned by the orchestrator post-wave, not this executor.

---
*Phase: 11-wire-safety-verification-hardening*
*Completed: 2026-07-18*

## Self-Check: PASSED

- FOUND: `.github/workflows/canary-leak.yml`
- FOUND: `tests/doctor/end-to-end.test.ts`
- FOUND: `src/doctor/index.ts`
- FOUND: commit `feea179` (Task 1)
- FOUND: commit `45a46b6` (Task 2)
- FOUND: commit `12f8429` (this SUMMARY)
- `grep -c -- "--no-color" .github/workflows/canary-leak.yml` → `1`
- `grep -c "MRCLEAN_TEST_FAKE_CLAUDE_VERSION" tests/doctor/end-to-end.test.ts` → `11` (≥ required 4)
- `grep -n "process.execPath" src/doctor/index.ts | grep -c "hookBinPath\|mcpBinPath"` → `0`
- Working tree clean, no dist/ artifacts committed.
