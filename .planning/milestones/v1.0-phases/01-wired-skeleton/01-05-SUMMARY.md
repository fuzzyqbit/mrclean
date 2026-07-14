---
phase: 01-wired-skeleton
plan: "05"
subsystem: doctor
tags: [doctor, canary, version-check, mcp-client, spawnSync, process-exit-invariant]

requires:
  - phase: 01-01
    provides: "project scaffold, dist/cli.js, dist/mcp.js entrypoints"
  - phase: 01-02
    provides: "runInstall/runUninstall, writeHookEntries, writeMcpServerEntry, readJsonOrEmpty, atomic-json helpers"
  - phase: 01-02b
    provides: "loadEffectiveConfig, ConfigReadError, three-layer TOML reader"
  - phase: 01-03
    provides: "hook stdin/stdout handler: UserPromptSubmit → additionalContext with mrclean active banner"
  - phase: 01-04
    provides: "MCP server with sanitize/restore/audit_query stubs; StdioClientTransport integration confirmed"

provides:
  - "src/doctor/checks.ts — 6 check functions returning CheckResult: checkHooksRegistered, checkMcpRegistered, checkBinsExecutable, checkHookCanary, checkMcpCanary, checkConfigLoad; plus extractRegisteredPaths and collectRegisteredBinPaths helpers"
  - "src/doctor/canary.ts — CANARY_STRING constant; runHookCanary (spawnSync hook bin); runMcpCanary (MCP Client + StdioClientTransport)"
  - "src/doctor/version-check.ts — checkClaudeCodeVersion with dep-injection seam (runVersionCommand?); green/yellow/red/not-found classification"
  - "src/doctor/report.ts — renderReport (picocolors PASS/FAIL/SKIP + version line); computeExitCode (first-FAIL priority)"
  - "src/doctor/index.ts — computeDoctorReport (pure async, never exits process); runDoctor (ONLY process.exit site in doctor subsystem)"
  - "tests/doctor/ — 29 tests: 7 unit (checks), 4 unit (canary), 6 unit (version-check), 9 E2E (computeDoctorReport + runDoctor CLI round-trip)"

affects: [phase-2, phase-3]

tech-stack:
  added:
    - "spawnSync from node:child_process — used in runHookCanary (synchronous; simpler than async for one-shot stdin/stdout)"
    - "@modelcontextprotocol/sdk/client/index.js Client — used in runMcpCanary (same pattern proven in tests/mcp/tools-list.test.ts)"
    - "@modelcontextprotocol/sdk/client/stdio.js StdioClientTransport — used in runMcpCanary"
    - "picocolors — renderReport colors PASS (green) / FAIL (red) / SKIP (dim) lines"
    - "MRCLEAN_TEST_FAKE_CLAUDE_VERSION env var — TEST-ONLY escape hatch in computeDoctorReport to inject synthetic Claude version for hermetic CI"
  patterns:
    - "extractRegisteredPaths() reads INSTALLED bin paths from settings.json/claude.json; computeDoctorReport uses these for canary instead of resolveMrcleanBinPath() (which breaks under vitest because process.argv[1] points to the vitest binary)"
    - "computeDoctorReport / runDoctor split: pure core function + thin CLI wrapper with single process.exit site"
    - "Dep-injection seam for version check: checkClaudeCodeVersion({ runVersionCommand? }) defaults to real 'claude --version'; tests inject mock"
    - "Bins-PASS gate: canary checks are SKIP (not FAIL) when checkBinsExecutable fails — avoids misleading FAIL cascade"

key-files:
  created:
    - src/doctor/canary.ts
    - src/doctor/checks.ts
    - src/doctor/report.ts
    - src/doctor/version-check.ts
    - tests/doctor/canary.test.ts
    - tests/doctor/checks.test.ts
    - tests/doctor/end-to-end.test.ts
    - tests/doctor/version-check.test.ts
  modified:
    - src/doctor/index.ts (replaced Plan 01 stub with full implementation)

key-decisions:
  - "extractRegisteredPaths() instead of resolveMrcleanBinPath() for canary — in vitest, process.argv[1] is the vitest binary, so resolveMrcleanBinPath() returned node_modules/vitest/dist/cli.js; the fix reads the INSTALLED paths from settings.json, which are the ground truth"
  - "spawnSync for hook canary — synchronous; avoids async complexity for a one-shot stdin/stdout test. 5000ms timeout is generous but bounded."
  - "MCP canary via SDK Client + StdioClientTransport — same pattern as tests/mcp/tools-list.test.ts; proven in Plan 04. The client closes cleanly in a finally block."
  - "MRCLEAN_TEST_FAKE_CLAUDE_VERSION env var — TEST-ONLY escape hatch allows CLI E2E test (spawnSync doctor) to inject a synthetic Claude version without relying on a real claude binary being available in the test runner"
  - "Bins-PASS gate for canaries — if checkBinsExecutable fails, canary checks are SKIP not FAIL. This prevents a misleading exitCode 4 cascade when the real problem is exitCode 3."

requirements-completed:
  - INST-06

duration: 12min
completed: "2026-05-14"
---

# Phase 1 Plan 05: Doctor Canary Round-Trip Summary

**mrclean doctor: six structured checks (hooks, mcp, bins, hook-canary, mcp-canary, config-load) plus Claude Code version classification, split into a pure `computeDoctorReport` core and a single-exit-site `runDoctor` CLI wrapper, verified by 29 tests including E2E via both direct API call and spawnSync CLI invocation**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-14T00:52:00Z
- **Completed:** 2026-05-14T01:12:00Z
- **Tasks:** 2
- **Files created/modified:** 9

## Exit Code Map (RESEARCH §4.4)

| Code | Meaning | Check that triggers it |
|------|---------|----------------------|
| 0 | All checks PASS | — |
| 1 | Hooks not registered OR config-load error | checkHooksRegistered, checkConfigLoad |
| 2 | MCP server not registered | checkMcpRegistered |
| 3 | Registered binary path not executable | checkBinsExecutable |
| 4 | Canary round-trip failed | checkHookCanary, checkMcpCanary |
| 5 | Claude Code not found or incompatible | version check (only if codes 1-4 all pass) |

## Sample Doctor Output — Passing Run

```
[PASS] hooks — 4 hook events registered (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse)
[PASS] mcp — mrclean MCP server registered (type: stdio) for /path/to/project
[PASS] bins — all 2 registered binary path(s) are executable
[PASS] hook-canary — hook canary round-tripped; wiring banner present
[PASS] mcp-canary — MCP canary round-tripped through sanitize tool
[PASS] config-load — project-local config loaded
[green] claude --version: 2.1.141 — 2.1.141 — fully compatible (args exec form supported, PostToolUse updatedToolOutput available)
```
Exit: 0

## Sample Doctor Output — Failure Modes

**Exit 1 (no install):**
```
[FAIL] hooks — no mrclean hook entries found — run `mrclean install`
[FAIL] mcp — mrclean MCP server not registered...
[FAIL] bins — no registered mrclean binary paths found...
[SKIP] hook-canary — skipped: registered bins are not executable
[SKIP] mcp-canary — skipped: registered bins are not executable
[PASS] config-load — using bundled defaults (no config.toml files found)
[not-found] claude --version: not found — ...
```
Exit: 1 (hooks failure is first, highest-priority)

**Exit 2 (hooks only, no MCP):**
```
[PASS] hooks — 4 hook events registered (...)
[FAIL] mcp — mrclean MCP server not registered...
```
Exit: 2

**Exit 3 (chmod -x):**
```
[PASS] hooks — 4 hook events registered (...)
[PASS] mcp — mrclean MCP server registered...
[FAIL] bins — registered binary is not executable: /path/to/fake-cli.js
[SKIP] hook-canary — skipped: registered bins are not executable
[SKIP] mcp-canary — skipped: registered bins are not executable
```
Exit: 3

**Exit 1 (malformed config.toml, other checks pass):**
```
[PASS] hooks — ...
[PASS] mcp — ...
[PASS] bins — ...
[PASS] hook-canary — ...
[PASS] mcp-canary — ...
[FAIL] config-load — malformed config file: /path/.mrclean/config.toml: malformed line 1: ...
```
Exit: 1

## computeDoctorReport vs runDoctor Split

The architectural invariant enforced throughout:

| Function | Location | process.exit? | Who calls it |
|----------|----------|---------------|-------------|
| `computeDoctorReport(opts)` | src/doctor/index.ts | NEVER | Tests + runDoctor |
| `runDoctor(opts?)` | src/doctor/index.ts | YES (1 call) | CLI action handler |
| All check functions | src/doctor/checks.ts | NEVER | computeDoctorReport |
| canary helpers | src/doctor/canary.ts | NEVER | check functions |
| version check | src/doctor/version-check.ts | NEVER | computeDoctorReport |
| renderReport | src/doctor/report.ts | NEVER | runDoctor |

Grep validation:
- `grep -cE "process\.exit" src/doctor/index.ts` → `1`
- `grep -cE "process\.exit" src/doctor/checks.ts src/doctor/canary.ts src/doctor/version-check.ts src/doctor/report.ts` → `0` each

## Key Implementation Detail: extractRegisteredPaths

The plan called for `computeDoctorReport` to use `resolveMrcleanBinPath()` to get bin paths for the canary. This breaks under vitest because `process.argv[1]` is the vitest binary — `resolveMrcleanBinPath()` returned `node_modules/vitest/dist/cli.js`.

Fix: `computeDoctorReport` calls `extractRegisteredPaths(settingsPath, claudeJsonPath, cwd)` to read the INSTALLED bin paths from `settings.json` and `.claude.json`. These are the ground truth paths that Claude Code actually uses. This also means the canary verifies the INSTALLED paths, not just any mrclean binary on the system.

## Walking Skeleton Demo Script — Execution Result

```bash
TEMP_HOME=$(mktemp -d)
mkdir -p $TEMP_HOME/.claude
MRCLEAN_TEST_FAKE_CLAUDE_VERSION="2.1.141 (Claude Code)" HOME=$TEMP_HOME node dist/cli.js install
# → mrclean v0.1.0 installed (hooks: 4, MCP server: mrclean)

MRCLEAN_TEST_FAKE_CLAUDE_VERSION="2.1.141 (Claude Code)" HOME=$TEMP_HOME node dist/cli.js doctor
# → 6x [PASS] + [green] claude version; exit 0
```

Steps 1 and 2 of the 4-step demo script (01-SKELETON.md) are now executable end-to-end. Steps 3 (start a real claude session) and 4 (uninstall + diff) were verified in prior plans (01-02 and 01-03).

Note: `mkdir -p $TEMP_HOME/.claude` is needed because `~/.claude/` is normally created by Claude Code at installation time. This is a pre-existing Plan 02 behavior — the install command assumes the directory exists, which is always true in production.

## CFG-01/CFG-03 Observability

The `config-load` check calls `loadEffectiveConfig({ homeDir, cwd })` from Plan 01-02b:
- Missing config files → PASS, detail = "using bundled defaults"
- Valid override files → PASS, detail = "loaded ~/.mrclean/config.toml and/or project-local config loaded"
- Malformed TOML → FAIL, exitCode 1, detail names the offending file path

This makes CFG-01 (missing file OK) and CFG-03 (three-layer precedence) operator-visible without requiring any additional tooling.

## Task Commits

1. **Task 1 RED: failing tests for checks, canary, version-check** — `4590a3a` (test)
2. **Task 1 GREEN: implement checks.ts, canary.ts, version-check.ts, report.ts** — `2cd046b` (feat)
3. **Task 2 RED: failing end-to-end tests for computeDoctorReport and runDoctor** — `0c6e5f2` (test)
4. **Task 2 GREEN: implement computeDoctorReport + runDoctor + extractRegisteredPaths fix** — `346bdb8` (feat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used extractRegisteredPaths instead of resolveMrcleanBinPath for canary**
- **Found during:** Task 2 (end-to-end test run — Tests 1 and 5 returned exitCode 4)
- **Issue:** `resolveMrcleanBinPath()` reads `process.argv[1]` when `import.meta.url`-derived path fails. Under vitest, `process.argv[1]` is the vitest CLI binary, so the resolved path was `node_modules/vitest/dist/cli.js` — a 5s `spawnSync` timeout.
- **Fix:** `computeDoctorReport` calls `extractRegisteredPaths(settingsPath, claudeJsonPath, cwd)` which reads the installed paths directly from the JSON config files. This is also architecturally correct — the canary verifies the paths Claude Code actually uses.
- **Files modified:** `src/doctor/checks.ts` (new export `extractRegisteredPaths`), `src/doctor/index.ts` (use `extractRegisteredPaths` instead of `resolveMrcleanBinPath`)
- **Verification:** Tests 1 and 5 in end-to-end.test.ts pass; all 29 doctor tests pass

## Known Stubs

None in this plan's doctor subsystem. The plan's purpose is to verify the stubs from Plans 01-03 and 01-04, not to replace them.

The following stubs from prior plans remain and are intentional Phase 1 behavior:
- Hook handlers (user-prompt, pre-tool-use, post-tool-use): no-op pass-through
- MCP tools (sanitize, restore, audit_query): Phase 1 echo / empty records

## Threat Flags

None. The doctor command reads local config files and spawns local subprocesses (the installed hook and MCP bins). No new network endpoints, external API calls, or trust boundary crossings introduced.

## Self-Check: PASSED

**Files confirmed present:**
- src/doctor/canary.ts: FOUND
- src/doctor/checks.ts: FOUND
- src/doctor/index.ts: FOUND
- src/doctor/report.ts: FOUND
- src/doctor/version-check.ts: FOUND
- tests/doctor/canary.test.ts: FOUND
- tests/doctor/checks.test.ts: FOUND
- tests/doctor/end-to-end.test.ts: FOUND
- tests/doctor/version-check.test.ts: FOUND

**Commits confirmed in git log:**
- 4590a3a (test RED checks/canary/version-check)
- 2cd046b (feat GREEN helpers)
- 0c6e5f2 (test RED end-to-end)
- 346bdb8 (feat GREEN computeDoctorReport/runDoctor)

**Test counts:** 29 new (151 total across all test files)

**Acceptance criteria:**
- process.exit in index.ts = 1 ✓
- process.exit in helper files = 0 each ✓
- computeDoctorReport exported ✓
- CANARY_STRING present ✓
- X_OK usage present ✓
- loadEffectiveConfig + ConfigReadError usage >= 2 ✓
- All 29 doctor tests pass ✓

---
*Phase: 01-wired-skeleton*
*Completed: 2026-05-14*
