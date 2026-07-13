---
status: diagnosed
phase: 01-wired-skeleton
source: 01-VERIFICATION.md (human_verification items — automated via tests/uat/live-session.test.ts)
started: 2026-07-13T22:05:00Z
updated: 2026-07-13T22:10:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Live banner via additionalContext + mrclean MCP connected
expected: Headless claude session quotes back "mrclean active vN.N.N (rules: N, allowlist: N, mode: active)" injected via UserPromptSubmit additionalContext; init event lists mrclean MCP server status "connected". (VERIFICATION.md's v0.1.0 no-op string is stale — replaced by long form in Phase 2 HOOK-07.)
result: pass
evidence: npm run test:uat UAT-1 green 2026-07-13 — banner regex matched in model reply; mcp_servers[mrclean].status === "connected"

### 2. Internal mrclean crash blocks tool call (fail-closed, exit 2)
expected: Malformed .mrclean/config.toml → hook dispatch throws → crash guard exits 2 → Claude Code blocks the tool call; canary filename never reaches model-visible output.
result: pass
evidence: npm run test:uat UAT-2a green 2026-07-13 — canary absent from result + full stream; hook failure visible

### 3. Missing/corrupted hook bin blocks tool call (SC4 no-silent-pass-through)
expected: Hook bin unspawnable (missing bin — modern equivalent of VERIFICATION's chmod -x, which is a no-op since hooks run as `node <bin> hook`) → tool call blocked, no silent pass-through.
result: issue
reported: "Automated run: hook_response shows exit_code 1 / outcome error (ENOENT spawn failure), Claude Code proceeds with tool call, canary UAT_CANARY_7Q3X.txt delivered to model. Silent pass-through of protection."
severity: major

## Summary

total: 3
passed: 2
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "When the mrclean hook bin cannot be spawned, tool calls are blocked — protection never silently disappears (SC4/HOOK-05)"
  status: failed
  reason: "User reported: automated UAT-2b — spawn failure (ENOENT) yields non-blocking hook error; ls executed and canary filename reached the model"
  severity: major
  test: 3
  root_cause: "Claude Code only blocks on hook exit code 2; spawn failures (missing bin, bad node path) surface as exit 1 / outcome:error which is non-blocking by platform design. mrclean's installer writes a direct `node <cli.js> hook` command, so mrclean never gets a chance to exit 2 when the bin (or node path) is gone — fail-closed guarantee has a hole at the spawn layer."
  artifacts:
    - path: "src/install/settings.ts"
      issue: "Hook entry spawns `node <bin> hook` directly; any spawn-layer failure is non-blocking (exit 1), bypassing HOOK-05 fail-closed"
  missing:
    - "Wrap hook invocation so spawn-layer failure converts to exit 2, e.g. `sh -c 'exec <node> <bin> hook' || exit 2` style wrapper (or equivalent cross-platform shim) written by installer"
    - "Doctor check already detects non-executable bin — extend messaging to warn that a missing bin degrades to fail-open at the platform layer"
    - "Update 01-VERIFICATION.md human_verification: chmod -x scenario is untestable as worded (node ignores exec bit); expected banner string stale (v0.1.0 no-op form)"
  debug_session: "diagnosed inline 2026-07-13 — live repro: hook_response event {exit_code:1, outcome:'error', posix_spawn ENOENT} followed by successful tool_result containing canary; Claude Code docs confirm only exit 2 blocks"
