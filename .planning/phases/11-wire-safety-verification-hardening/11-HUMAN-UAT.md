---
status: partial
phase: 11-wire-safety-verification-hardening
source: [11-VERIFICATION.md]
started: 2026-07-18T00:30:00Z
updated: 2026-07-18T00:30:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. SC1b live wire-safety leg (operator token spend)
expected: `MRCLEAN_UAT=1 npm run test:uat -- -t 'wire safety'` — non-vacuity chain green (canary echoed through MCP fixture, redaction observed), zero canary hits in outbound stream, transcript, and whole `~/.claude/projects/**/*.jsonl` tree; restore-then-resume shows no re-entry; per-tool `tool_response` shapes recorded to contract-findings artifact; then re-stamp docs/HOOK-CONTRACT.md per-tool matrix from the findings artifact (paired with copy-drift UUID gate green).
result: [pending]

### 2. A4 first ubuntu CI run (needs branch push)
expected: push `gsd/v3.0-reversible-redact-mode-foundations-operator-restore` to origin (no remote tracking ref yet), then `gh run watch` for test.yml + canary-leak.yml — both green on ubuntu including the 16-process stress deadline and the count-guarded wire-safety steps ("passed over N exported audit file(s)", N ≥ 1). On stress flake, `WORKER_DEADLINE_MS` is the ONLY permitted knob (T-09-08-06).
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
