# How to verify mrclean is working

Practical checks that mrclean is installed, active, and detecting secrets.
For the recorded results of a full pass, see [VERIFICATION.md](./VERIFICATION.md).

---

## 1. Quick check (live — recommended)

In a Claude Code session with the plugin installed, ask the assistant to call the
MCP tools:

**Status** — confirm it's active:

```
call mrclean_status
```

Expect `mode: "active"`, a non-zero `rule_count` (184 today), and a populated
`audit_log_path`.

**Check** — scan a synthetic secret. Use a github-shaped token: `ghp_` followed by
36 alphanumeric characters.

```
call mrclean_check with text "token ghp_<36 alphanumerics>"
```

Expect a populated `findings` array, e.g.:

```json
{
  "findings": [
    {
      "ruleId": "GITHUB_TOKEN",
      "severity": "HIGH",
      "placeholder": "<MRCLEAN:SECRET:001>",
      "redactedHash": "….",
      "fingerprint": "GITHUB_TOKEN:…."
    }
  ],
  "count": 1
}
```

The output contains the `placeholder`/`redactedHash`/`fingerprint` — **never the raw
secret**. If you get `{"findings":[],"count":0}`, see [Troubleshooting](#5-troubleshooting).

---

## 2. The self-redaction gotcha (and the split-literal trick)

mrclean redacts secrets inside the agent's **own** Bash tool calls. So if you put a
real secret literal directly into a shell command, mrclean rewrites it to a
placeholder *before the command runs* — your test then scans a placeholder and finds
nothing. This is correct protection, not a bug.

To test the hook from the CLI, keep the literal **out of the command text**. Build the
token from parts so the detector's regex never matches the command itself, then
assemble it at runtime:

```bash
# The embedded "" breaks the github regex in THIS command's text,
# but bash concatenates it to the full token at runtime.
GH="ghp_""AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"   # ghp_ + 36 chars (use a real 36-char body)
```

Then pass the assembled value into the hook via JSON built by `node -e` (so the literal
never appears in the bash command string):

```bash
node -e 'process.stdout.write(JSON.stringify({
  hook_event_name:"UserPromptSubmit", session_id:"s", transcript_path:"/dev/null",
  cwd:process.cwd(), prompt:"deploy with "+process.argv[1]
}))' "$GH" | node dist/cli.js hook
```

> Tip: a low-entropy body (e.g. all `A`s) keeps the example itself from being flagged
> when you paste it into a session. For a real detection test, use a 36-char
> alphanumeric body so it matches `GITHUB_TOKEN`.

---

## 3. Hook-path probes

All use the split-literal `"$GH"` from §2. Run from the repo root (so `dist/cli.js`
resolves). Expected outputs are recorded in [VERIFICATION.md](./VERIFICATION.md).

**UserPromptSubmit → block:**

```bash
node -e 'process.stdout.write(JSON.stringify({hook_event_name:"UserPromptSubmit",session_id:"s",transcript_path:"/dev/null",cwd:process.cwd(),prompt:"deploy with "+process.argv[1]}))' "$GH" \
  | node dist/cli.js hook
# → {"decision":"block","reason":"[mrclean] GITHUB_TOKEN (HIGH)…"}
```

**PreToolUse Bash → updatedInput redacted:**

```bash
node -e 'process.stdout.write(JSON.stringify({hook_event_name:"PreToolUse",session_id:"s",transcript_path:"/dev/null",cwd:process.cwd(),tool_name:"Bash",tool_input:{command:"curl -H token:"+process.argv[1]}}))' "$GH" \
  | node dist/cli.js hook
# → permissionDecision:"allow", updatedInput.command:"curl -H token:<MRCLEAN:SECRET:001>"
```

**Self-exemption (mrclean's own tool passes through untouched):**

```bash
node -e 'process.stdout.write(JSON.stringify({hook_event_name:"PreToolUse",session_id:"s",transcript_path:"/dev/null",cwd:process.cwd(),tool_name:"mcp__plugin_mrclean_mrclean__mrclean_redact",tool_input:{text:process.argv[1]}}))' "$GH" \
  | node dist/cli.js hook
# → permissionDecision:"allow", NO updatedInput  (exempt)
```

A foreign lookalike (`mcp__notmrclean__…`) is **not** exempt and still gets redacted.

---

## 4. Unit / integration suite

```bash
npm test                      # 377 tests (Vitest) — unit + integration + bundle path
npm run build                 # rebuild dist/ then re-run bundled-artifact probes above
node dist/cli.js doctor --verbose   # install wiring checks
```

> `doctor` check 1 inspects `~/.claude/settings.json`, which the **plugin** install
> never writes — so it reports "not wired" for plugin installs even when everything is
> fine. Confirm a plugin install with `/plugin list` and the SessionStart banner
> (`mrclean active vX …`) instead. Checks 2–4 still apply.

---

## 5. Troubleshooting

**`mrclean_check` returns `findings:[]` for an obvious secret.**
Ensure the plugin is **≥ rc.3** — earlier builds let the redaction hooks rewrite the
input of mrclean's own MCP tools (the self-cannibalization bug). Refresh:

```
/plugin marketplace update fuzzyqbit
/plugin install mrclean@fuzzyqbit
/reload-plugins
```

**Reinstall didn't pick up a fix.**
The plugin cache is keyed by version. A same-version reinstall can reuse the stale
cache — bump the version (or `marketplace update`, which refetches the new commit) to
force a clean copy. Stale dirs live under
`~/.claude/plugins/cache/fuzzyqbit/mrclean/<version>/`.

**No banner / no redaction at all.**
Run `/doctor`. A lone `terraform … TFE_TOKEN` error is a different plugin, not mrclean.
