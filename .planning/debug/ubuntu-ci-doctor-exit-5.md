---
status: diagnosed
trigger: "First ubuntu CI run of test.yml (run 29645706305) fails in tests/doctor/end-to-end.test.ts on node 20.x and 22.x: Tests 1 & 5 AssertionError expected 5 to be +0; plus spawned-process SyntaxError: Invalid or unexpected token at wrapSafe (node:internal/modules/cjs/loader). Green on macOS locally."
created: 2026-07-18T00:00:00Z
updated: 2026-07-18T00:00:00Z
---

## Current Focus

hypothesis: "CONFIRMED (two independent causes): (1) exit 5 = Claude Code version check hermeticity leak — Tests 1 & 5 call computeDoctorReport in-process without MRCLEAN_TEST_FAKE_CLAUDE_VERSION, so the real `claude --version` runs; ubuntu runners have no claude → not-found → exit 5. (2) SyntaxError = Test 3's mcp-canary fallback `mcpBinPath || process.execPath` spawning `node <node-binary>` — cross-platform noise, fails nothing."
test: "Differential: ran Tests 1 & 5 on macOS with claude stripped from PATH → both fail `expected 5 to be +0` (byte-identical to CI). Control with claude on PATH → pass. Ran Test 3 on macOS → identical SyntaxError noise, test passes."
expecting: "n/a — diagnosis complete"
next_action: "Return DIAGNOSIS COMPLETE to caller (find_root_cause_only mode — no fix applied)"

reasoning_checkpoint:
  hypothesis: "Tests 1 & 5 fail on ubuntu because computeDoctorReport's version check spawns the real `claude --version`; the runner has no claude binary → versionResult 'not-found' → exitCode escalated 0→5 at src/doctor/index.ts:165-167"
  confirming_evidence:
    - "Exit map (index.ts:12-19): 5 is exclusively the version-check code, only reachable when ALL 8 checks PASS"
    - "test.yml installs no claude and sets no MRCLEAN_TEST_FAKE_CLAUDE_VERSION; only Test 8 sets it (and Test 8 passed on CI)"
    - "macOS repro: PATH without ~/.local/bin (claude's dir) → Tests 1 & 5 fail 'expected 5 to be +0' at the same lines (127, 228); PATH with claude → pass"
  falsification_test: "If Test 1 still failed on macOS with claude ON PATH, or passed with claude stripped, the hypothesis would be wrong — observed the opposite in both directions"
  fix_rationale: "n/a — diagnose-only mode; fix direction handed to gap-closure planner"
  blind_spots: "Did not verify node 20.18 slot logs (assumed identical — same env, same code path); did not trace why 39 gitleaks rules skip on CI (out of scope)"

## Symptoms

expected: "Test 1: install → computeDoctorReport → exitCode 0, all PASS. Test 5: install → uninstall → computeDoctorReport → exitCode 1 (hooks gone). Whole suite green (as on macOS: 962-986 green runs)."
actual: "On ubuntu CI (node 20.x AND 22.x): Tests 1 & 5 fail with AssertionError `expected 5 to be +0`. Also a spawned-process SyntaxError: Invalid or unexpected token at wrapSafe (node:internal/modules/cjs/loader) — a child node process tried to execute a file with an invalid token."
errors: "AssertionError: expected 5 to be +0 (tests 1 & 5); SyntaxError: Invalid or unexpected token at wrapSafe (node:internal/modules/cjs/loader) in spawned process"
reproduction: "GitHub Actions run 29645706305, branch gsd/v3.0-reversible-redact-mode-foundations-operator-restore, first ubuntu run of test.yml. Passes on macOS."
started: "First-ever ubuntu CI run — never worked on linux; always worked on darwin."

## Eliminated

- hypothesis: "Exit 5 comes from a canary/bin check failing on linux (sh wrapper spawned by node)"
  evidence: "src/doctor/index.ts exit map: 5 = 'Claude Code not found or incompatible version'. Lines 164-167: exit 5 is ONLY set when computeExitCode(results)===0 (all checks PASS) AND versionResult is red/not-found. A failing canary would give exit 4, not 5. So all 8 checks PASSED on ubuntu."
  timestamp: 2026-07-18

## Evidence

- timestamp: 2026-07-18
  checked: "src/doctor/index.ts exit code map + escalation logic (lines 12-19, 156-167)"
  found: "Exit 5 = version check: requires all checks PASS and versionResult.status red|not-found. Version check uses real `claude --version` unless MRCLEAN_TEST_FAKE_CLAUDE_VERSION env is set."
  implication: "Failing check = Claude Code version check. Ubuntu CI runner has no `claude` binary → not-found → exit 5. macOS dev machine has Claude Code installed → green → exit 0."

- timestamp: 2026-07-18
  checked: "tests/doctor/end-to-end.test.ts Tests 1, 5, 8"
  found: "Test 1 (line 119-138) and Test 5 (line 220-239) call computeDoctorReport() in-process WITHOUT setting MRCLEAN_TEST_FAKE_CLAUDE_VERSION. Only Test 8 (spawnSync CLI round-trip) sets the fake version env var. Test 1 even tolerates versionResult.status 'not-found' at line 134 but still asserts exitCode 0 at line 127 — internally inconsistent on machines without claude. Test 5 fails at line 228 (reportBefore.exitCode === 0) before uninstall even runs."
  implication: "Tests 1 & 5 are hermetic everywhere EXCEPT the version check, which leaks the host machine's claude installation state."

- timestamp: 2026-07-18
  checked: "src/doctor/version-check.ts defaultRunVersionCommand (lines 47-58)"
  found: "spawnSync('claude', ['--version']) — throws on result.error (ENOENT) → caught → status 'not-found'. No workflow step installs claude; test.yml runs plain `npm test` with no MRCLEAN_TEST_FAKE_CLAUDE_VERSION."
  implication: "On ubuntu-latest runners `claude` does not exist → versionResult = not-found → computeDoctorReport escalates 0 → 5. On the dev macOS, Claude Code is installed → green → 0."

- timestamp: 2026-07-18
  checked: "CI log run 29645706305 (gh run view --log-failed), lines around 13:12:42.47"
  found: "Crash dump reads: '/opt/hostedtoolcache/node/22.23.1/x64/bin/node:1' + 'ELF^B^A^A^C' + SyntaxError at wrapSafe → node was given ITS OWN ELF BINARY as the script. Occurs ~880ms after Test 2 finished = during Test 3 (hooks-only, no MCP, 880ms). Tests 1,5 failed; 2,3,4,6,7,8 passed. Test 8 (with fake version env) got 6 PASS lines and exit 0."
  implication: "SyntaxError source = src/doctor/index.ts:124 fallback `mcpBinPath || process.execPath`: in Test 3 mcp is unregistered → mcpBinPath='' → runMcpCanary(node, process.execPath) spawns `node <node-binary>` → CJS loader parses ELF → SyntaxError. mcp-canary FAILs but exit priority picks mcp-registration (exit 2) first, so Test 3 still passes. Pure stderr noise, platform-independent (would print Mach-O garbage on macOS too)."

- timestamp: 2026-07-18
  checked: "src/doctor/canary.ts runMcpCanary (line 119)"
  found: "StdioClientTransport({ command: nodePath, args: [mcpBin] }) — SDK default inherits child stderr, so the crash dump prints straight into the CI log."
  implication: "Explains why the SyntaxError appears as loose output not attached to an assertion."

## Evidence (continued)

- timestamp: 2026-07-18
  checked: "Local differential reproduction on macOS (darwin 24.6.0, node 22.22.0)"
  found: "PATH stripped of /Users/me/.local/bin (claude's location): Test 1 fails `AssertionError: expected 5 to be +0` at end-to-end.test.ts:127; Test 5 fails identically at :228. Control (full PATH, claude 2.1.212 = green): Test 1 passes. `node $(command -v node)` reproduces the exact wrapSafe SyntaxError signature. Test 3 on macOS emits the identical SyntaxError noise (Mach-O bytes) and still passes."
  implication: "Ubuntu failure fully reproduced on darwin by removing claude from PATH → OS is irrelevant; the variable is claude-on-PATH. SyntaxError confirmed cross-platform noise, not a failure cause."

## Resolution

root_cause: "TWO independent causes. (A) FAILURES: tests/doctor/end-to-end.test.ts Tests 1 & 5 call computeDoctorReport() in-process without setting MRCLEAN_TEST_FAKE_CLAUDE_VERSION (only Test 8 sets it), so src/doctor/version-check.ts:47-58 spawnSync('claude',['--version']) runs for real. Ubuntu CI runners have no claude binary → ENOENT → status 'not-found' → src/doctor/index.ts:165-167 escalates exit 0→5 (exit 5 = 'Claude Code not found', the only code reachable when all 8 checks PASS). Green on macOS solely because the dev machine has claude 2.1.212 installed. (B) NOISE: the spawned-process SyntaxError at wrapSafe is Test 3's mcp-canary — mcp unregistered → extractRegisteredPaths returns mcpBinPath='' → index.ts:124 fallback `mcpBinPath || process.execPath` spawns `node <node-binary-itself>` → CJS loader parses ELF/Mach-O → SyntaxError. Cross-platform (reproduced on macOS), fails no test (mcp-registration exit 2 outranks canary exit 4), surfaces in CI logs via StdioClientTransport's inherited stderr (canary.ts:119)."
fix: "not applied — find_root_cause_only mode; handed to gap-closure planner"
verification: "Differential repro both directions on macOS (strip claude → fail identically; restore claude → pass); CI log crash dump first line is the node binary path + ELF magic bytes; Test 3 local run reproduces the SyntaxError noise on a passing test"
files_changed: []
