---
status: diagnosed
trigger: "Phase 11 SC1b live UAT run 2 (restore-then-resume) failed: run-unique canaries WORD_LIVE and SECRET_LIVE BOTH found in resumed session's transcript at /Users/me/.claude/projects/-private-var-folders-g9--hcbr44x5bbg980rhc--4kl00000gn-T-mrclean-wire-qXOT3Q-project/3dd37348-f138-4c13-90e8-5020b15e9ccb.jsonl (assertion grepProjectsTreeForCanaries at tests/uat/wire-safety.test.ts:397, called from :837). Run 1 (active-session wire redaction) PASSED."
created: 2026-07-18T09:20:00Z
updated: 2026-07-18T13:45:00Z
---

## Current Focus

hypothesis: "CONFIRMED H3, root cause fully characterized: canary carrier is a hook_success ATTACHMENT record (line 15) that Claude Code archives locally for EVERY PostToolUse hook bound to the matching event -- including hooks the test never registered. The record's `command` field identifies the OPERATOR'S globally-installed 'ecc' plugin hook (session-activity-tracker.js, matcher '*', scope:user in installed_plugins.json), NOT a mrclean or test-fixture hook. HOOK-CONTRACT.md itself already documents that 'hooks on one event run in parallel ... the observer records the raw pre-substitution payload even alongside mrclean's real hook' -- this is a KNOWN, DOCUMENTED property of Claude Code's hook fan-out (identical raw tool_response delivered independently to every matching hook, hooks are not chained). The UAT sandbox isolates MCP servers (--strict-mcp-config) and hook COMMANDS (--settings <sandbox file>) but does NOT isolate globally-installed PLUGIN-contributed hooks -- those come from the operator's real ~/.claude/plugins (scope:user) and fire in every session regardless of cwd/--settings. mrclean's OWN wire-facing output (transcript line 14, the canonical user/tool_result record actually sent to the model/API) is clean/redacted in both run 1 and the resumed run. mrclean's own hook_success attachment (line 16) is also clean. Root cause is a harness isolation gap + a local-transcript/wire surface conflation in SC1's own assertion -- NOT a product leak."
test: "n/a -- diagnosis complete, goal: find_root_cause_only"
expecting: "n/a"
next_action: "n/a -- return ROOT CAUSE FOUND to caller"

## Symptoms

expected: "Run 2 (restore-then-resume): after mrclean restore, resumed session transcript should contain NO raw canary values (WORD_LIVE, SECRET_LIVE) per ROADMAP SC1 assertion grepProjectsTreeForCanaries"
actual: "BOTH canaries found raw in resumed session transcript jsonl 3dd37348-f138-4c13-90e8-5020b15e9ccb.jsonl"
errors: "Assertion failure at tests/uat/wire-safety.test.ts:397 (grepProjectsTreeForCanaries), called from :837"
reproduction: "Phase 11 SC1b live UAT run 2 — restore-then-resume scenario"
started: "First observed in this UAT run; run 1 (active session) PASSED so live redaction works on the non-resume path"

## Eliminated

## Evidence

- timestamp: 2026-07-18T09:20:00Z
  checked: "Sandbox project transcript dir listing"
  found: "4 transcript jsonl files exist (1078ac3c, 3dd37348, 52e09783, 940c529e); failing one is 34 lines, 81743 bytes; all mtimes Jul 18 09:08"
  implication: "Multiple sessions in same sandbox project dir — run1 + run2 sessions plus possibly resumed forks. Transcript tree survived test (not cleaned), can be read directly."

- timestamp: 2026-07-18T13:30:00Z
  checked: "grep -no for the exact minted canary patterns zz-wire-canary-[0-9a-f]{8} and AKIA[A-Z2-7]{16} across 3dd37348-....jsonl"
  found: "Exactly one hit each, BOTH on line 15: WORD=zz-wire-canary-b0b30f80, SECRET=AKIALCPJIZUO3S7ZYJE6"
  implication: "Single carrier line, not scattered. Corrects the prior hypothesis's guess of 'line 16' — the leak is line 15, one line before mrclean's own attachment."

- timestamp: 2026-07-18T13:32:00Z
  checked: "sed -n '15p' | json.tool on the carrier line"
  found: "type=attachment, attachment.type=hook_success, hookName='PostToolUse:mcp__wire-canary__echo_project_notes', attachment.command='node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js\" \"post:session-activity-tracker\" \"scripts/hooks/session-activity-tracker.js\" \"standard,strict\"'. attachment.stdout is the hook's JSON stdin echoed back verbatim, embedding tool_response text 'project notes: path zz-wire-canary-b0b30f80 key AKIALCPJIZUO3S7ZYJE6' (RAW, unredacted). timestamp 2026-07-18T13:08:14.213Z."
  implication: "The carrier is NOT mrclean's hook and NOT a test fixture hook (postresp-log-hook.sh is a .sh path, this is a node command referencing ${CLAUDE_PLUGIN_ROOT}). It's a third-party PLUGIN hook. Its own stdout (an echo of its raw stdin, i.e. the raw pre-redaction PostToolUse payload) gets archived by Claude Code into the transcript as a hook_success attachment -- a LOCAL bookkeeping record, not an outbound API request."

- timestamp: 2026-07-18T13:33:00Z
  checked: "Full line-by-line record-type/timestamp map of 3dd37348-....jsonl (python3 json parse of all 34 lines)"
  found: "Single file spans BOTH run 1 (lines 1-22, promptId 6fbd8a3a, SessionStart:startup) AND the resume (lines 23-34, SessionStart:resume at line 25, new promptId 46461e3f at line 27) -- confirms `claude --resume <sid>` appends to the SAME session jsonl, not a new file. Carrier line 15 timestamp (13:08:14.213Z) falls squarely inside run 1's span (13:08:11 - 13:08:18), well BEFORE resume starts (13:08:19.628Z)."
  implication: "The leak's logical event happened during run 1, not during/after resume. Yet the bug report's failing assertion is 'post-restore-resume' (test 4, line 837), not 'post-run-1' (test 3, line 797) or the raw-byte grep inside test 3 (line 791) which reads the identical file. This means the record had not yet been physically flushed to disk on the FIRST two reads (test 2 restore leg read at line 730, test 3 absence read at line 791) and only appeared by the time of test 4's grep -- a disk-flush/ordering artifact of Claude Code's own transcript writer (exact internal mechanism, e.g. buffered append vs a resume-time finalize/flush, not directly observable from outside the CLI; flagged as a blind spot), NOT anything mrclean's restore step wrote or reintroduced."

- timestamp: 2026-07-18T13:35:00Z
  checked: "Transcript line 14 (type=user, tool_result -- the CANONICAL model-facing/wire-bound record for the same tool_use_id) and line 16 (mrclean's OWN hook_success attachment for the same tool call)"
  found: "Line 14 content: '[{\"type\":\"text\",\"text\":\"project notes: path <MRCLEAN:WORD:001:de90a197> key <MRCLEAN:AWS_KEY:002:de90a197>\"}]' -- fully redacted (v2 tokens), zero canary bytes. Line 16 (mrclean's PostToolUse hook_success): stdout.hookSpecificOutput.updatedToolOutput is the same clean redacted string; stderr shows normal gitleaks-adapter startup noise; additionalContext = '[mrclean] substituted 2 secret(s) in tool output'."
  implication: "mrclean's hook ran correctly and the ACTUAL wire-bound content (what reaches the model / what would be sent back to Anthropic in the next turn) is clean in both run 1 and run 2. This directly refutes H1 (no restore-triggered re-entry -- nothing was even restored yet at the time this record's content existed) and refutes 'mrclean's hook failed on resume' (H2) -- mrclean's hook is not implicated at all for this record."

- timestamp: 2026-07-18T13:38:00Z
  checked: "docs/HOOK-CONTRACT.md, 'Per-tool tool_response shapes' section (lines 196-209)"
  found: "Verbatim, already-committed project documentation: 'hooks on one event run in parallel, so the observer records the raw pre-substitution payload even alongside mrclean's real hook.' This describes the SAME mechanism for the project's OWN postresp-log-hook.sh observer fixture (which writes its raw copy to a sandbox-local side file OUTSIDE ~/.claude/projects, so it never trips the grep)."
  implication: "The raw-fan-out-to-parallel-hooks behavior is ALREADY a known, documented, accepted property of the Claude Code hook contract -- mrclean's hook_success attachment (line 16) only redacts ITS OWN return value; it has no mechanism to rewrite what a DIFFERENT, independently-invoked hook received as input or chooses to do with it (echo to stdout, persist elsewhere, etc). The only reason this specific instance became a `~/.claude/projects` hit (instead of landing in a sandbox-local side file like the test's own observer) is that the hook in question was NOT one of the test's registered fixtures."

- timestamp: 2026-07-18T13:40:00Z
  checked: "which hook actually owns the ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/session-activity-tracker.js command: grep repo, then /Users/me/.claude/plugins/installed_plugins.json and marketplaces/ecc/hooks/hooks.json"
  found: "Not present anywhere in the mrclean repo or its fixtures. Found under /Users/me/.claude/plugins/marketplaces/ecc/scripts/hooks/session-activity-tracker.js. installed_plugins.json lists 'ecc@ecc' with scope:'user' (global, all sessions, all cwds). hooks.json registers it under matcher '*' ('Track per-session tool calls and file activity for ECC2 metrics'), timeout 10, not async. Confirmed present (1 occurrence) in ALL FOUR sandbox transcript files (1078ac3c, 3dd37348, 52e09783, 940c529e), i.e. it fires on every tool call in every claude -p invocation the UAT harness makes, regardless of --settings."
  implication: "This is the operator's own globally-installed, mrclean-unrelated plugin (from the 'ecc' marketplace), not a test fixture, not a mrclean component. tests/uat/harness.ts's runClaude() passes --settings <sandbox file> and --mcp-config/--strict-mcp-config, but nothing that disables or excludes user-scope PLUGIN-contributed hooks -- Claude Code merges plugin hooks on top of --settings regardless. This is a genuine UAT harness isolation gap: the sandbox is isolated for MCP servers and for the explicit hook commands the test itself registers, but NOT for ambient globally-installed plugins, which is why an unrelated plugin's raw-echo-to-stdout behavior became visible as a `~/.claude/projects` hit in THIS operator's environment. A user with zero other plugins installed would not reproduce this specific manifestation, though the underlying parallel-hook raw-fan-out mechanism is universal to the Claude Code hook contract."

- timestamp: 2026-07-18T13:42:00Z
  checked: "src/hook/handlers/post-tool-use.ts header contract comment; .planning/ROADMAP.md line 155 (SC1 exact wording)"
  found: "mrclean's PostToolUse handler contract is scoped entirely to its OWN hookSpecificOutput.updatedToolOutput return value (per-handler behavior matrix in the file header) -- no mechanism exists, or could exist via the documented hook API, to intercept or rewrite what a DIFFERENT hook receives as input or does with its own stdout. ROADMAP.md line 155 states SC1 as: 'no restored canary value appears in the next outbound request body OR in ~/.claude/projects/**/*.jsonl' -- phrased as if these are the same surface."
  implication: "ROADMAP SC1's assertion conflates two materially different surfaces: (a) 'next outbound request body' = the actual wire, which mrclean's hook fully controls and which IS clean (proven at transcript line 14/wire-safety stream-json.rawStdout), and (b) '~/.claude/projects/**/*.jsonl' = Claude Code's local transcript file, which interleaves true wire-mirrored content with purely local, never-transmitted CLI bookkeeping (hook_success/hook_additional_context/queue-operation/skill_listing attachments for EVERY hook bound to an event, including hooks mrclean has no relationship to or control over). A single whole-tree grep cannot distinguish a real wire leak from an unrelated hook's local stdout archival."

## Resolution

root_cause: "H3 CONFIRMED (transcript-side artifact, compounded by a UAT harness isolation gap). The canary was never on the wire. Claude Code, per its documented parallel hook-fan-out contract (independently confirmed in this repo's own docs/HOOK-CONTRACT.md), delivers the IDENTICAL raw (pre-redaction) tool_response to EVERY PostToolUse hook bound to the matching event -- hooks are not chained, each is invoked independently with the original payload. mrclean's own hook redacts correctly and its rewrite is what actually reaches the model/wire (verified clean at the canonical user/tool_result transcript record, both pre- and post-resume). In this specific failing run, a SECOND, unrelated hook also received that same raw payload: the operator's globally-installed 'ecc' plugin's session-activity-tracker.js (matcher '*', scope:user -- fires on every tool call in every session on this machine, not something the mrclean repo or its UAT fixtures control). That hook echoes its raw stdin to its own stdout for its own metrics purposes, and Claude Code's CLI -- as a matter of normal, local-only hook-execution bookkeeping -- archives EVERY hook's raw stdout into the session transcript (~/.claude/projects/**/*.jsonl) as a hook_success attachment, regardless of which hook produced it or whether that hook has anything to do with mrclean. tests/uat/harness.ts's runClaude() isolates MCP servers (--strict-mcp-config) and the test's own explicit hook commands (--settings <sandbox file>) but does nothing to exclude the operator's globally user-scoped plugin-contributed hooks, so this ambient, mrclean-unrelated plugin fired inside the nominally-isolated sandbox session and its raw echo landed in the exact tree SC1's absence-grep scans. A secondary, less-certain factor is WHY this specific record surfaced at the 'post-restore-resume' grep rather than 'post-run-1' (both of which read the identical file): the record's logical timestamp is mid-run-1, well before resume began, so it was very likely present in-memory but not yet flushed to disk by Claude Code's own transcript writer at the time of the two earlier reads, and only physically appeared on disk by the time of the later grep -- a CLI-internal write-timing/ordering detail, not something mrclean's restore step reintroduced (restore had not even executed yet at the record's logical timestamp)."
fix: "None applied (goal: find_root_cause_only per objective -- diagnosis and written analysis only, no code or test changes made)."
verification: "n/a -- no fix applied in this session"
files_changed: []
