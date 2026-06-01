# mrclean v1.0.0-rc.3 — Verification Report

**Date:** 2026-05-31
**Build:** 1.0.0-rc.3 (installed Claude Code plugin + bundled `dist/cli.js`)
**Method:** end-to-end live checks against the running plugin, in addition to the
377-test Vitest suite (`npm test`, all green).

> Note on examples: secret **values** are intentionally not reproduced in this
> document — mrclean's own hooks would redact them, and committing real-shaped
> secrets is bad practice. Findings are shown by `ruleId`, severity, and
> placeholder only (which is exactly what the tools return).

## Scope

- **MCP tools** (via the installed plugin): `mrclean_check`, `mrclean_redact`, `mrclean_status`.
- **Hook handlers** (via bundled `dist/cli.js hook`): `UserPromptSubmit`, `PreToolUse`, `PostToolUse`.

---

## Table A — MCP tools (live plugin)

| # | Tool | Input summary | Expected | Result |
|---|------|---------------|----------|--------|
| 1 | `check` | github + stripe + slack + jwt secrets | 4 findings | **PASS** — `GITHUB_TOKEN`, `gitleaks:stripe-access-token`, `SLACK_TOKEN`, `gitleaks:jwt` (all HIGH) |
| 2 | `check` | clean sentence (`…number 4821 … 14:30`) | 0 findings | **PASS** — `count: 0`, no false positive on numbers/time |
| 3 | `check` | same github token twice | 2 findings, identical placeholder | **PASS** — both `<MRCLEAN:SECRET:001>`, identical `redactedHash` (stable per value/session) |
| 4 | `check` | text already containing `<MRCLEAN:…>` placeholders | 0 findings | **PASS** — idempotent, no double-redaction |
| 5 | `redact` | aws id + github token | redacted text + populated findings | **PASS** — `aws <MRCLEAN:AWS_KEY:001> github <MRCLEAN:SECRET:002>`; 2 findings (`AWSAccessKeyID`, `GITHUB_TOKEN`) |
| 6 | `status` | — | runtime metadata | **PASS** — `version 1.0.0-rc.3`, `rule_count 184`, `mode active`, `audit_log_path` set |

## Table B — Hook handlers (bundled `dist/cli.js hook`)

| # | Event | Input | Expected | Result |
|---|-------|-------|----------|--------|
| 7 | `UserPromptSubmit` | prompt w/ github token | block | **PASS** — `decision: block`, `GITHUB_TOKEN (HIGH)` |
| 8 | `UserPromptSubmit` | clean prompt | allow (banner only) | **PASS** — no block |
| 9 | `PreToolUse` | `Bash` command w/ token | allow + `updatedInput` redacted | **PASS** — command rewritten to `curl -H token:<MRCLEAN:SECRET:001>`; reason `substituted 1 secret(s)` |
| 10 | `PreToolUse` | `mcp__plugin_mrclean_mrclean__mrclean_redact` | allow, **no** `updatedInput` (self-exempt) | **PASS** |
| 11 | `PreToolUse` | `mcp__notmrclean__mrclean_check` (foreign lookalike) | redacted (NOT exempt) | **PASS** — input redacted |
| 12 | `PostToolUse` | `mcp__plugin_mrclean_mrclean__mrclean_check` | null / no-op (self-exempt) | **PASS** |

**Result: 12/12 end-to-end cases PASS + 377/377 unit/integration tests PASS.**

---

## Findings & notes

- **Detection layers confirmed live.** Layer 1 = secretlint (`GITHUB_TOKEN`,
  `SLACK_TOKEN`, `AWSAccessKeyID`) + gitleaks (`gitleaks:stripe-access-token`,
  `gitleaks:jwt`). Rule count = 183 gitleaks + 1 secretlint preset = **184**.
- **Stable placeholders.** The same secret value maps to the same placeholder and
  `redactedHash` within a session (test 3) — the basis for reversible round-trip.
- **No raw-secret leakage in tool output.** `check`/`redact` return only
  `placeholder`, `redactedHash`, and `fingerprint` — never the raw value (verified
  across all calls).
- **Idempotency.** Already-redacted text yields 0 findings (test 4) — safe to re-scan.
- **Self-exemption (the rc.3 fix).** mrclean's own MCP tools are exempt from the
  redaction hooks across **both** install namespaces — plugin
  (`mcp__plugin_mrclean_mrclean__*`) and CLI (`mcp__mrclean__*`). Foreign
  lookalikes are still scanned (tests 10–12). Matcher:
  `^mcp__(plugin_mrclean_mrclean|mrclean)__mrclean_(check|redact|status)$`.
- **Known-good gotcha (works as designed).** `PreToolUse` redacts secrets inside the
  agent's *own* Bash tool calls, so a real secret literal placed directly in a shell
  command is replaced with a placeholder *before the command runs*. Correct protective
  behavior — but it means CLI/hook testing must keep the literal out of the command
  (see [HOWTO-TEST.md](./HOWTO-TEST.md)).

## History

rc.1 → rc.2 → rc.3 fixed, in order: `hooks.json` wrapper shape; version-keyed plugin
cache refresh; and the self-cannibalization bug where the redaction hooks rewrote the
input of mrclean's own MCP tools (making `mrclean_check` appear to find nothing).
