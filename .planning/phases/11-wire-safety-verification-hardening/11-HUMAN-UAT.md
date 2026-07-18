---
status: complete
phase: 11-wire-safety-verification-hardening
source: [11-VERIFICATION.md]
started: 2026-07-18T00:30:00Z
updated: 2026-07-18T13:43:18.681Z
---

## Current Test

[testing complete]

## Tests

### 1. SC1b live wire-safety leg (operator token spend)
expected: `MRCLEAN_UAT=1 npm run test:uat -- -t 'wire safety'` — non-vacuity chain green (canary echoed through MCP fixture, redaction observed), zero canary hits in outbound stream, transcript, and whole `~/.claude/projects/**/*.jsonl` tree; restore-then-resume shows no re-entry; per-tool `tool_response` shapes recorded to contract-findings artifact; then re-stamp docs/HOOK-CONTRACT.md per-tool matrix from the findings artifact (paired with copy-drift UUID gate green).
result: issue
reported: "Run executed 2026-07-18 09:08 (34.3s, 2 failed / 6 passed / 27 skipped). Run 1 (live canary never on wire) legs PASSED — redaction works on the active session. Run 2 (restore-then-resume) FAILED: grepProjectsTreeForCanaries found BOTH canaries in the resumed session's transcript — `~/.claude/projects/-private-var-folders-...-mrclean-wire-qXOT3Q-project/3dd37348-f138-4c13-90e8-5020b15e9ccb.jsonl [WORD_LIVE]` and same file `[SECRET_LIVE]`. Restored originals re-entered the wire path on resume."
severity: blocker

### 2. A4 first ubuntu CI run (needs branch push)
expected: push `gsd/v3.0-reversible-redact-mode-foundations-operator-restore` to origin (no remote tracking ref yet), then `gh run watch` for test.yml + canary-leak.yml — both green on ubuntu including the 16-process stress deadline and the count-guarded wire-safety steps ("passed over N exported audit file(s)", N ≥ 1). On stress flake, `WORKER_DEADLINE_MS` is the ONLY permitted knob (T-09-08-06).
result: issue
reported: "Push OK; gsd/** triggers fired (self-verifying). BOTH runs failed. (a) canary-leak run 29645706296: all 3 unit suites GREEN ('Test Files 3 passed' in log) but run_and_guard grep missed it — vitest colorizes under GITHUB_ACTIONS, ANSI codes sit between 'Test Files' and '3 passed'; regex Test Files[[:space:]]+3 passed cannot match; integration pair never ran. CI false-red, tests healthy. (b) test.yml run 29645706305: tests/doctor/end-to-end.test.ts Tests 1 & 5 fail on BOTH node 20.x and 22.x — 'expected 5 to be +0' (computeDoctorReport exit 5 on fresh ubuntu where macOS gives 0) plus a spawned-process 'SyntaxError: Invalid or unexpected token' at cjs/loader wrapSafe. Stress deadline never reached (suite failed earlier). Real ubuntu divergence."
severity: major

## Summary

total: 2
passed: 0
issues: 2
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "First ubuntu CI run green for test.yml and canary-leak.yml"
  status: failed
  reason: "canary-leak: ANSI color codes under GITHUB_ACTIONS break run_and_guard count grep (unit suites actually green, false-red; integration pair never ran). test.yml: doctor end-to-end Tests 1 & 5 exit 5 vs expected 0 on ubuntu both node versions + spawned SyntaxError at cjs wrapSafe."
  severity: major
  test: 2
  root_cause: |
    TWO independent causes, both test-environment-only — product linux behavior verified correct by this run.
    (a) canary-leak ANSI false-red: vitest colorizes under GITHUB_ACTIONS; ANSI escape codes sit between
    "Test Files" and "3 passed" so the run_and_guard grep `Test Files[[:space:]]+3 passed` cannot match even
    though all 3 unit suites are green in the raw log. Integration pair (dist-parity + stress) never ran because
    the script exits before reaching it.
    (b) test.yml doctor exit-5: computeDoctorReport escalates to exit 5 ("Claude Code not found/incompatible")
    ONLY when all 8 real checks already PASS (src/doctor/index.ts:156-167). Tests 1 & 5 in
    tests/doctor/end-to-end.test.ts call computeDoctorReport in-process without stubbing
    MRCLEAN_TEST_FAKE_CLAUDE_VERSION (only Test 8 does) — ubuntu runners have no `claude` binary on PATH so the
    real spawnSync('claude','--version') → ENOENT → not-found → exit 5. Differential repro on macOS (strip
    claude from PATH) reproduces byte-identically; all 8 real linux checks passed on this very ubuntu run.
    Separately: SyntaxError in the log is UNRELATED noise — Test 3 (hooks-only state) leaves mcpBinPath='' so
    src/doctor/index.ts:123-124's canary fallback spawns `node <node binary itself>`; CJS loader parses the ELF
    header as source → SyntaxError at wrapSafe. Cross-platform (reproduces on macOS too, Mach-O instead of ELF),
    pre-existing, fails nothing (mcp-registration check at exit 2 outranks the canary check), inherited stderr
    just makes it visible in the log.
  artifacts:
    - .github/workflows/canary-leak.yml:118-146 (run_and_guard function, ANSI-unsafe grep)
    - tests/doctor/end-to-end.test.ts:119-138 (Test 1), :220-239 (Test 5) — missing fake-version stub
    - src/doctor/index.ts:123-124 (nonsensical process.execPath canary fallback), :156-167 (0→5 escalation, correct)
    - src/doctor/canary.ts:119 (inherits child stderr, surfaces the crash dump)
  missing:
    - "run_and_guard: strip ANSI (or force --reporter=basic/CI=true) before the count grep"
    - "end-to-end.test.ts Tests 1, 5 (defensively 2-7): stub MRCLEAN_TEST_FAKE_CLAUDE_VERSION like Test 8 does"
    - "(optional polish) index.ts:123-124: explicit SKIP/FAIL when bin path is empty instead of process.execPath fallback"

- truth: "Restore-then-resume shows no re-entry — zero canary hits in `~/.claude/projects/**/*.jsonl` after local restore + session resume"
  status: failed
  reason: "User-authorized live run reported: WORD_LIVE and SECRET_LIVE both present in resumed session transcript jsonl (run 2, grepProjectsTreeForCanaries at tests/uat/wire-safety.test.ts:397, invoked :837). Run 1 (active-session redaction) passed — failure is confined to the resume path."
  severity: blocker
  test: 1
  root_cause: |
    NOT A PRODUCT LEAK (H3 confirmed, refutes H1/H2/H4). Both canaries appear exactly once, on ONE transcript
    line (line 15), inside a "hook_success" attachment whose "command" belongs to the OPERATOR'S globally
    user-scoped ecc plugin (session-activity-tracker.js, installed_plugins.json scope:"user", hooks.json
    matcher "*") — not mrclean's hook, not a test fixture. That third-party hook echoes its own raw stdin
    (necessarily pre-redaction) to its own stdout; Claude Code CLI archives EVERY hook's raw stdout as a
    hook_success attachment into the local transcript regardless of which hook produced it (parallel fan-out,
    documented in docs/HOOK-CONTRACT.md:196-209 for the test's own observer fixture — same mechanism, different
    hook). mrclean's OWN hook_success attachment on the adjacent line 16 confirms
    "[mrclean] substituted 2 secret(s) in tool output" with clean updatedToolOutput. The canonical wire-mirrored
    record (line 14, type:user/tool_result — what actually transmits) shows the SUBSTITUTED placeholders, not
    raw values, in both run 1 and the resumed run. Timestamp of the leaking attachment (13:08:14.213Z) falls
    ~5s BEFORE resume even started (13:08:19.628Z) — restore hadn't run yet, ruling out H1 entirely; it
    surfaced at the later grep point only because Claude Code's transcript writer flush timing, not because
    anything changed between the two read points.
    Root defect: grepProjectsTreeForCanaries (tests/uat/wire-safety.test.ts:372-398) does a raw whole-file byte
    grep across ALL jsonl record/attachment types instead of scoping to the actual wire-mirrored surface
    (type:"user"/"assistant" message records and their tool_result/tool_use blocks). It cannot distinguish
    genuine outbound-traffic mirrors from purely-local hook bookkeeping for hooks mrclean has no contract with.
    Compounding gap: tests/uat/harness.ts's runClaude() isolates MCP servers (--strict-mcp-config) and the
    test's own hook (--settings <sandbox>) but has no mechanism to exclude ambient globally-installed
    user-scoped plugin hooks, which merge in regardless of --settings.
    ROADMAP.md:155 SC1 wording also conflates two different surfaces: "no restored canary value appears in the
    next outbound request body OR in ~/.claude/projects/**/*.jsonl" treats the wire and the whole local
    transcript tree as equivalent absence targets — they are not; the jsonl tree is a strict superset.
  artifacts:
    - tests/uat/wire-safety.test.ts:372-398 (grepProjectsTreeForCanaries — overbroad scope)
    - tests/uat/harness.ts:85-138 (runClaude — no ambient-plugin isolation)
    - .planning/ROADMAP.md:155 (SC1 wording conflates wire vs. whole transcript tree)
    - docs/HOOK-CONTRACT.md:196-209 (documents the parallel-hook-raw-payload mechanism; doesn't yet call out third-party non-fixture hooks as a source)
    - NOT implicated: src/hook/handlers/post-tool-use.ts (mrclean's hook behaved correctly in both runs — frozen tree, untouched)
  missing:
    - "grepProjectsTreeForCanaries: scope to type:user/assistant message records + their tool_result/tool_use blocks only, not raw whole-file byte grep across every attachment type"
    - "harness.ts runClaude(): exclude ambient global-plugin hooks from the sandbox session (isolated CLAUDE_CONFIG_DIR or plugin-disable mechanism, if CLI exposes one)"
    - "ROADMAP.md SC1 + HOOK-CONTRACT.md: split wording into two explicit surfaces — outbound request body vs. local transcript tree (which includes non-wire hook-bookkeeping from every hook bound to an event, not just mrclean's)"
