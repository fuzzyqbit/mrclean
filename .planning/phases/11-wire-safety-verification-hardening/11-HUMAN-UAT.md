---
status: diagnosing
phase: 11-wire-safety-verification-hardening
source: [11-VERIFICATION.md]
started: 2026-07-18T00:30:00Z
updated: 2026-07-18T13:15:19.145Z
---

## Current Test

[testing complete — diagnosing]

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
  artifacts: []
  missing: []

- truth: "Restore-then-resume shows no re-entry — zero canary hits in `~/.claude/projects/**/*.jsonl` after local restore + session resume"
  status: failed
  reason: "User-authorized live run reported: WORD_LIVE and SECRET_LIVE both present in resumed session transcript jsonl (run 2, grepProjectsTreeForCanaries at tests/uat/wire-safety.test.ts:397, invoked :837). Run 1 (active-session redaction) passed — failure is confined to the resume path."
  severity: blocker
  test: 1
  artifacts: []  # Filled by diagnosis
  missing: []    # Filled by diagnosis
