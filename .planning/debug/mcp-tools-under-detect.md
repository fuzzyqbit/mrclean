---
status: awaiting_human_verify
trigger: "mrclean_check/runDetectionReadOnly returns 0 findings where runDetection finds them; mrclean_redact substitutes placeholders but returns findings:[]"
created: 2026-06-01T03:12:38Z
updated: 2026-06-01T03:40:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "The PreToolUse hook (matcher '*') deep-substitutes the `text` argument of mrclean's OWN MCP tools before the tool runs. The tool therefore receives placeholder-only text, runs runDetection/runDetectionReadOnly on it, finds nothing (placeholders are not secret-shaped), and returns findings:[]. The '2 placeholders substituted' the reporter saw were injected by the hook, not the tool."
  confirming_evidence:
    - "With REAL fixture bytes read from files, both runDetection AND runDetectionReadOnly find 2 findings in source (probe.mts) AND the bundled dist/mcp.js returns count:2 / findingsLen:2 via JSON-RPC (rpc-probe.mjs). Neither bug reproduces on real input."
    - "First probe with secret literals EMBEDDED in source returned 0 findings AND printed 'VALUE: <MRCLEAN:SEC' — proving the literals were already redacted to placeholders by mrclean's own PostToolUse hook before the probe ran. This is exactly the tsx-probe puzzle in the report."
    - "probe2.mts: feeding already-redacted text ('...<MRCLEAN:SECRET:001>...<MRCLEAN:SECRET:002>...') reproduces the EXACT reporter symptom — 2 placeholders present, findings:[] from both functions."
    - "hooks/hooks.json registers PreToolUse + PostToolUse with matcher '*' — matches mcp__mrclean__* tools. pre-tool-use.ts substituteToolInputDeep rewrites every string leaf incl. the tool's `text` arg. No tool_name exemption exists anywhere in src/hook/."
  falsification_test: "If exempting mcp__mrclean__* tools from PreToolUse substitution makes a JSON-RPC redact call (with the secret passed through the full hook chain) return populated findings, the hypothesis holds. If findings stay empty, the root cause is elsewhere."
  fix_rationale: "mrclean's own redaction tools MUST see real secrets to function — that is their entire purpose. Exempting mcp__mrclean__* from PreToolUse (input) and PostToolUse (output) re-processing is the root-cause fix: it stops the hook from blinding the tool. Tool output is already redacted by the tool itself, so PostToolUse exemption is safe."
  blind_spots: "I cannot drive the real Claude Code hook→MCP chain in this environment; I reproduce it by simulating already-redacted input. The live tool_name string format (mcp__mrclean__mrclean_redact) is confirmed from CC docs but not observed live here."

next_action: BROADEN matcher — prefix 'mcp__mrclean__' misses plugin-install namespace (mcp__plugin_mrclean_mrclean__mrclean_check). Replace startsWith with regex /^mcp__(plugin_mrclean_mrclean|mrclean)__mrclean_(check|redact|status)$/ in both handlers; update tests (plugin + CLI names + negative foreign-tool case); rebuild dist; re-probe with plugin-namespaced tool_name.

follow_up_evidence:
  - "Plugin install (live deployment) namespaces MCP tools as mcp__plugin_mrclean_mrclean__mrclean_<tool>. The original startsWith('mcp__mrclean__') guard does NOT match this — bug persists for plugin users. CLI install yields mcp__mrclean__mrclean_<tool>. A precise regex covering both namespaces fixes it without exempting foreign tools (e.g. mcp__notmrclean__mrclean_check must still be detected)."

## Symptoms

expected: mrclean_check and mrclean_redact return populated findings arrays matching the hook path (runDetection)
actual: mrclean_check returns {findings:[],count:0}; mrclean_redact substitutes 2 placeholders but returns findings:[]; tsx probe of runDetectionReadOnly returns 0 findings for github/stripe/openai fixtures
errors: none (silent under-detection)
reproduction: call dist/mcp.js mrclean_check / mrclean_redact with github PAT + stripe fixture; OR tsx probe runDetectionReadOnly
started: pre-existing

## Eliminated

- hypothesis: MCP server loads a project config with allowlist/secrets_files suppressing fixtures
  evidence: .mrclean/config.toml has empty allowlist, no secrets_files; loadEffectiveConfig ≈ DEFAULT_CONFIG
  timestamp: 2026-06-01T03:12:38Z

## Evidence

- timestamp: 2026-06-01T03:12:38Z
  checked: src/mcp/tools/redact.ts mapping
  found: rawFindings.map(toFindingDTO) is correct; no filter by effectiveAction. BUG B mapping not obviously wrong in source.
  implication: BUG B likely shares root cause with BUG A (findings array empty upstream) OR substituteFindings mutates/empties findings

## Eliminated (additional)

- hypothesis: BUG A — runDetectionReadOnly under-detects relative to runDetection
  evidence: probe.mts on real fixture FILE bytes → both return identical 2 findings. The two functions have identical layer wiring and produce identical results. The reported "0 findings" was an artifact of the probe's secret literals being redacted to placeholders by mrclean's own hook before execution.
  timestamp: 2026-06-01T03:30:00Z
- hypothesis: BUG B — redact.ts maps/filters findings incorrectly (drops findings by effectiveAction or wrong field)
  evidence: redact.ts maps rawFindings.map(toFindingDTO) with NO filter; rpc-probe.mjs against dist/mcp.js returns findingsLen:2. Mapping is correct. The empty array occurs only when the INPUT text is placeholder-only (already redacted upstream).
  timestamp: 2026-06-01T03:30:00Z

## Resolution

root_cause: The PreToolUse hook (hooks/hooks.json matcher "*", handler src/hook/handlers/pre-tool-use.ts) and PostToolUse hook (src/hook/handlers/post-tool-use.ts) re-process the I/O of mrclean's OWN MCP tools (mcp__mrclean__mrclean_check / _redact / _status). substituteToolInputDeep rewrites the `text` argument of a redact/check call into placeholders BEFORE the tool executes. The tool then scans placeholder-only text and correctly finds nothing → findings:[]. Both reported "bugs" are the same root cause: the tool is blinded by its own hook. No defect exists in runDetectionReadOnly or in the tool finding-mapping.
fix: Added self-exemption guard. ORIGINAL prefix match "mcp__mrclean__" was too narrow — it missed the plugin-install namespace (mcp__plugin_mrclean_mrclean__mrclean_<tool>), which is the LIVE deployment. BROADENED to an anchored regex covering both install methods without exempting foreign tools: MRCLEAN_TOOL_RE = /^mcp__(plugin_mrclean_mrclean|mrclean)__mrclean_(check|redact|status)$/. pre-tool-use.ts step 0 returns permissionDecision:allow with NO updatedInput (input verbatim). post-tool-use.ts step 0 returns null (no re-detection). Both short-circuit BEFORE loadEffectiveConfig/runDetection.
verification: |
  - npm test: 377 passing (was 374; +3 net new cases — 8c, 11b, parity-exemption; 8b/11 loops broadened in place). All green.
  - npm run build: dist rebuilt successfully (cli.js, mcp.js, detect-layer1.js).
  - hook-probe (dist/cli.js hook), 4 cases: (1) PLUGIN-namespaced mcp__plugin_mrclean_mrclean__mrclean_redact → allow, no updatedInput (EXEMPT — the previously-broken live case now fixed); (2) Bash control → redacted with <MRCLEAN:SECRET:001>; (3) CLI mcp__mrclean__mrclean_check → allow, no updatedInput (still exempt); (4) foreign mcp__notmrclean__mrclean_check → redacted (NOT exempt — guard is precise).
  - New/updated tests: handlers-detection Test 8b (PreToolUse exemption, BOTH namespaces × 3 tools), Test 8c (NEGATIVE foreign tool still detected), Test 11 (PostToolUse exemption, BOTH namespaces × 3 tools), Test 11b (NEGATIVE foreign output re-detected), check-hook-parity (handler exemption across both namespaces + foreign negative + fixture parity). NOTE: secret-shaped test values are constructed at runtime via .join('_')/.repeat() so the live mrclean PostToolUse hook does not redact them in the source file (literal sk_live_/ghp_ tokens get rewritten to placeholders on save, corrupting the test).
files_changed:
  - src/hook/handlers/pre-tool-use.ts (self-exemption guard; MRCLEAN_TOOL_RE regex replaces MRCLEAN_TOOL_PREFIX)
  - src/hook/handlers/post-tool-use.ts (self-exemption guard; MRCLEAN_TOOL_RE regex replaces MRCLEAN_TOOL_PREFIX)
  - tests/hook/handlers-detection.test.ts (Test 8b broadened to both namespaces, Test 8c negative, Test 11 broadened, Test 11b negative; runtime-built secrets)
  - tests/mcp/check-hook-parity.test.ts (parity regression test + both-namespace handler exemption + foreign negative)
  - dist/cli.js, dist/mcp.js, dist/detect-layer1.js (rebuilt)
