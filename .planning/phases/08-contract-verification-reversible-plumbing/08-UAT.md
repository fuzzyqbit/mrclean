---
status: diagnosed
phase: 08-contract-verification-reversible-plumbing
source: [08-01-SUMMARY.md, 08-02-SUMMARY.md, 08-03-SUMMARY.md, 08-04-SUMMARY.md, 08-05-SUMMARY.md, 08-06-SUMMARY.md, 08-07-SUMMARY.md, 08-08-SUMMARY.md, 08-09-SUMMARY.md, 08-10-SUMMARY.md, 08-11-SUMMARY.md]
started: 2026-07-16T19:48:55Z
updated: 2026-07-16T19:58:30Z
method: delegated-cli-observation (operator said "you run it" at test 1 — all tests executed by orchestrator via sandboxed CLI/file observation; sandbox HOME + cwd under $CLAUDE_JOB_DIR/tmp)
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: From a fresh terminal at repo root, `node dist/cli.js doctor` boots without errors, renders the full 8-check report (reversible-mode line included), exits with a documented exit code — no stack trace or crash.
result: pass
evidence: Rendered all 8 checks (hooks/mcp/bins FAIL — mrclean not installed on this machine, correct diagnosis; canaries SKIP; config-load/model-cache/reversible PASS) + version line. Exit 1 = documented (hooks domain, first-FAIL priority per LOCKED map in src/doctor/index.ts:78). No stack trace.

### 2. Fresh install registers 5 hook events
expected: `mrclean install` (real or sandbox HOME) writes 5 mrclean hook entries to ~/.claude/settings.json — SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse. SessionStart matcher is `startup|resume|clear|compact`; SessionEnd entry has NO matcher field.
result: issue
reported: "Registration itself correct once ~/.claude exists: 5 events, SessionStart matcher startup|resume|clear|compact, SessionEnd matcherless, all _mrclean-tagged. TWO defects observed: (1) with fresh HOME lacking ~/.claude, install crashes with raw Node ENOENT stack (tmp write into missing dir) — violates zero-config first-run constraint and error-handling rule; (2) success banner prints '(hooks: 4, MCP server: mrclean)' while 5 events were registered — hardcoded stale count."
severity: major

### 3. v2.0 4-event install migrates to 5 events
expected: A settings.json with old 4-event mrclean entries plus one foreign (non-mrclean) hook, after re-running `mrclean install`: converges to exactly 5 mrclean events with no duplicates, foreign hook byte-identical. `mrclean uninstall` afterwards removes all 5 mrclean entries and preserves the foreign hook.
result: pass
evidence: Downgraded sandbox to 4 events + narrowed matcher + foreign PostToolUse hook; re-install converged to 1 mrclean entry per 5 events, matcher re-widened, SessionEnd matcherless, foreign byte-identical (JSON compare true). Uninstall: 0 mrclean entries, foreign kept.

### 4. Doctor flags missing SessionEnd
expected: Against a legacy 4-event registration, `mrclean doctor` hooks check FAILs naming SessionEnd. Against a healthy 5-event install, hooks check PASSes with detail "5 hook events registered".
result: pass
evidence: 5-event: "[PASS] hooks — 5 hook events registered (SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse)". 4-event legacy: "[FAIL] hooks — missing mrclean hook entries for: SessionEnd — run `mrclean install`".

### 5. Doctor reversible line — default off
expected: With no [reversible] table in any config, every `mrclean doctor` run renders check 8 as PASS with detail exactly "reversible mode: disabled (default one-way)".
result: pass
evidence: Live repo run: "[PASS] reversible — reversible mode: disabled (default one-way)".

### 6. Doctor reversible line — enabled
expected: With `[reversible]` + `enabled = true` in ~/.mrclean/config.toml (or project ./.mrclean/config.toml), `mrclean doctor` renders PASS with detail exactly "reversible mode: enabled — plumbing only (session state adapter lands in Phase 9)".
result: pass
evidence: Sandbox user config → "[PASS] reversible — reversible mode: enabled — plumbing only (session state adapter lands in Phase 9)". Exact copy match.

### 7. Wrong-typed reversible value fails closed
expected: With `enabled = "yes"` (string, not boolean) under [reversible], the config check FAILs with a ConfigReadError naming the file path and reason "[reversible].enabled must be a boolean". The reversible check itself SKIPs with constant detail "config unreadable — see config check" (no file path leaked in check-8 detail).
result: pass
evidence: "[FAIL] config-load — malformed config file: <sandbox path>/.mrclean/config.toml: [reversible].enabled must be a boolean" + "[SKIP] reversible — config unreadable — see config check". Path named only in config check; check-8 detail constant.

### 8. CR-01 — user opt-in survives project partial table
expected: User layer ~/.mrclean/config.toml sets `[reversible] enabled = true`; project ./.mrclean/config.toml has a [reversible] table with ONLY an unknown key (e.g. `future_key = 1`). `mrclean doctor` from the project dir still shows "reversible mode: enabled — plumbing only ..." — the project partial table does not silently wipe the user opt-in.
result: pass
evidence: Doctor from project dir with partial project table: reversible check still renders enabled copy — user opt-in survived. Unknown key tolerated (config-load PASS).

### 9. Doctor version-check copy is honest
expected: On a compatible Claude Code version, the doctor version/compat check green detail no longer claims unqualified "fully compatible (PostToolUse updatedToolOutput supported...)". It names the shape-validation caveat (string payloads honored for MCP tools, rejected for built-ins — current string-form rewrite inert for built-ins) with a verified-on stamp and docs/HOOK-CONTRACT.md pointer.
result: pass
evidence: Live run on claude 2.1.210: green detail = "hook contract compatible. Note: PostToolUse updatedToolOutput is shape-validated per tool (verified on Claude Code 2.1.209, 2026-07-14): string payloads are honored for MCP tools but rejected for built-in tools (Bash/Read), so mrclean's current string-form tool-output rewrite is inert for built-in tools. See docs/HOOK-CONTRACT.md."

### 10. HOOK-CONTRACT.md durable and upstream issue filed
expected: docs/HOOK-CONTRACT.md has one section per E1–E5 with "[verified on Claude Code 2.1.209, 2026-07-14, ...]" stamps; §E4 carries the settled verdict "cap does NOT bind updatedToolOutput (~15K survived intact for Bash)"; the per-tool matrix Read object-payload cell says REJECTED (no UNTESTED left); the upstream section links the filed issue anthropics/claude-code#77587.
result: pass
evidence: 6 verified-on stamps; all five E-sections present; §E4 settled verdict at line 133; Read object cell REJECTED citing probe 8ba19558; 0 UNTESTED; issues/77587 linked in HOOK-CONTRACT.md:193 and mirrored in draft header.

### 11. THREAT_MODEL reversible section + operator-only framing
expected: THREAT_MODEL.md contains "## Reversible Mode (v3.0)" with five subsections (map blast radius / structural secret floor / wire re-entry / key-custody honesty / accepted residual risks). PROJECT.md and CLAUDE.md describe restore as operator-only via `mrclean restore` — the stale return-path-restore sentence is gone.
result: pass
evidence: Section at THREAT_MODEL.md:141 with exactly the 5 H3 subsections; "transcript ratchet" present. PROJECT.md + CLAUDE.md carry operator-only `mrclean restore` framing ("never on the model-facing return path" — the corrected negation, not stale wording). Copy-drift gate 15/15 green.

### 12. UAT harness opt-in gate + findings durability
expected: `npx vitest run --project=uat tests/uat/contract-verification.test.ts` WITHOUT MRCLEAN_UAT reports 11 skipped / 0 failed and spends zero tokens; afterwards `git status --porcelain tests/uat/artifacts/` is empty — the committed contract-findings.json is untouched (guarded writer refuses to clobber on a skipped run).
result: pass
evidence: 11 skipped / 0 failed in 140ms, exit 0; artifacts dir porcelain-clean.

## Summary

total: 12
passed: 11
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "mrclean install completes with a friendly result on a machine where ~/.claude does not exist yet (zero-config first run)"
  status: failed
  reason: "User reported (delegated observation): install crashes with raw Node ENOENT stack when $HOME/.claude is absent — tmp file write into missing directory; works once the directory exists"
  severity: major
  test: 2
  root_cause: "writeJsonAtomic (src/install/atomic-json.ts:42) creates its temp file inside the target file's directory without ensuring the directory exists; the settings-write path never mkdirs ~/.claude (unlike src/install/ignore.ts:99 and src/install/project-dir.ts:78 which use mkdir recursive). Pre-existing defect (predates Phase 8), surfaced by fresh-HOME UAT."
  artifacts:
    - path: "src/install/atomic-json.ts"
      issue: "no mkdir of dirname(targetPath) before tmp-file write at line 42"
  missing:
    - "Recursive mkdir of dirname(target) before the tmp write in writeJsonAtomic (or at the settings-write call site), plus a test for fresh-HOME install"
  debug_session: ""
- truth: "Install success banner reports the real registered hook-event count"
  status: failed
  reason: "User reported (delegated observation): banner prints '(hooks: 4, MCP server: mrclean)' while 5 events are registered"
  severity: cosmetic
  test: 2
  root_cause: "Hardcoded string literal ' (hooks: 4, MCP server: mrclean)' at src/install/index.ts:81 — 08-02 widened HOOK_EVENTS to 5 but the banner count is not derived from HOOK_EVENTS.length"
  artifacts:
    - path: "src/install/index.ts"
      issue: "stale hardcoded hook count in success banner (line 81)"
  missing:
    - "Derive banner count from HOOK_EVENTS.length; test locks banner to the constant"
  debug_session: ""
