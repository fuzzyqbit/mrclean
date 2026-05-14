# mrclean-claude

> Stop secrets at the Claude Code wire. Local. Deterministic. No telemetry.

[![npm version](https://img.shields.io/npm/v/mrclean-claude)](https://www.npmjs.com/package/mrclean-claude)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node: 20+](https://img.shields.io/badge/node-%3E%3D20.18-brightgreen)](https://nodejs.org)

---

## 1. What it does

Every time you paste an AWS key into a Claude Code prompt, it travels to Anthropic's
API. Every time you use a Bash tool with a `.env` value in its arguments, that value
goes to every MCP server in your session. Most of the time this is fine. Sometimes it is
a career-defining mistake.

mrclean intercepts in-session text before it leaves your machine. It runs four detection
layers — Layer 1 regex rules (secretlint + 183 gitleaks patterns), Layer 2 Shannon
entropy, Layer 3 `.env` value extraction, and Layer 4 dirty-word lists — on every hook
payload. Detected secrets are replaced with stable placeholders like
`<MRCLEAN:AWS_KEY:001>` before the model ever sees them. Prompts containing CRITICAL or
HIGH severity findings are blocked outright with a human-readable explanation so you can
rewrite them.

**"gitleaks for what reaches your repo, mrclean for what reaches the model."**
Use gitleaks or trufflehog for pre-commit hooks and CI scanning. Use mrclean for the
in-session Claude Code surface. They solve different problems and complement each other
perfectly — do not try to replace one with the other.

---

## 2. Install

```bash
npm install -g mrclean-claude
npx mrclean install
```

The npm package name is `mrclean-claude` (the short name `mrclean` was registered in
2012 and is no longer maintained; npm's dispute policy does not transfer names for
abandonment). The in-session binaries installed by the package are `mrclean` (CLI +
hook handler) and `mrclean-mcp` (long-lived MCP server).

After install, start a new Claude Code session. You should see a banner on stderr:

```
mrclean active v1.0.0-rc.1 (rules: 183, allowlist: 0, mode: active)
```

If the banner appears, mrclean is wired correctly. If it does not, run
`npx mrclean doctor` to diagnose.

---

## 3. Verify

```bash
npx mrclean doctor
```

Doctor performs four checks:

1. **Installer wiring** — verifies that `~/.claude/settings.json` has the hook entries,
   that the absolute bin path resolves, and that the bin is executable.
2. **Claude Code version** — verifies Claude Code >= 2.1.121 (required for
   `PostToolUse.updatedToolOutput` field support).
3. **MCP canary round-trip** — calls `mrclean_check` via the MCP server and verifies a
   structured response comes back.
4. **Latency stub** (`--bench`) — optional; runs 50 iterations of the detection engine
   and prints p50/p95 latency for your machine.

Exit code 0 means all checks passed. Non-zero means at least one check failed; the
output explains which one and how to fix it.

---

## 4. Configure

Configuration is optional. mrclean runs with sensible defaults out of the box.

To override defaults, create `.mrclean/config.toml` in your project root:

```toml
# .mrclean/config.toml — all fields are optional

dry_run = false   # set to true on first install to audit-only without blocking

[entropy]
threshold = 4.5   # bits/char; raise to reduce false positives, lower for more recall
min_length = 20   # characters; below this length entropy detection is skipped

[allowlist]
rules       = []  # rule IDs to disable; e.g. ["aws-access-key-id"]
paths       = []  # glob patterns; matching tool input paths are not scanned
stopwords   = []  # literal substrings always allowed through (case-insensitive)
regexes     = []  # regex patterns; matches are allowed through
fingerprints = [] # per-finding SHA-256 fingerprints; use `mrclean ignore <fp>` to append
```

**Config layering precedence:** bundled defaults < `~/.mrclean/config.toml` (user-global) <
`.mrclean/config.toml` (project-local). Array fields (`rules`, `paths`, `stopwords`,
`regexes`, `fingerprints`) concatenate across layers. Scalar fields override.

---

## 5. Dirty word list

Project-specific terms — internal codenames, customer names, hostnames, product names
you never want leaving the machine — go in `.mrclean/words.txt`. One entry per line.
Lines starting with `#` are comments; blank lines are ignored.

Per-entry action override via `word|action` syntax:

```text
# .mrclean/words.txt
project-bluebird            # default action = block (CRITICAL finding)
internal-host-1|warn        # logs to audit, does NOT block the prompt
customer-acme|audit         # logs to audit log only, no block and no banner
```

Words are case-insensitive exact-match substring patterns. They are hot-reloaded at
every `SessionStart` so edits take effect on the next Claude Code session without any
restart.

---

## 6. Uninstall

```bash
npx mrclean uninstall
```

Restores `~/.claude/settings.json` to the byte-identical backup taken before install.
The `.mrclean/` project directory is left in place — delete it manually if you want to
remove audit logs and configuration. The `node_modules/` entry for `mrclean-claude`
can then be removed with `npm uninstall -g mrclean-claude`.

---

## 7. Modes

### dry_run — trust-building first install

On a fresh install, set `dry_run = true` in `.mrclean/config.toml` before starting a
Claude Code session. In dry-run mode, every rule's action is downgraded to `audit`:
detections are written to `.mrclean/audit.jsonl` but nothing is blocked and no prompts
are rewritten.

Run in dry-run mode for a week. Inspect the audit log. Tune your allowlist to silence
false positives. Then flip `dry_run = false` when you are confident in the detection
quality for your project.

### one-way (default)

One-way redaction is the default. Secrets are replaced with placeholders before they
reach the model; they are NOT restored on the return path. The model responds in terms
of the placeholder labels (e.g., "the `<MRCLEAN:AWS_KEY:001>` key you provided…"), and
you can look up the original value in your own environment.

Reversible-mode restoration (replacing placeholders back to originals in the model's
response before displaying it to you) is planned for v2 — see REQUIREMENTS.md REVMODE.

---

## 8. MCP tools (in-session, opt-in)

mrclean ships a long-lived MCP server (`mrclean-mcp`) with three tools that are
invokable from inside Claude Code sessions. The MCP server is wired by `npx mrclean install`
alongside the hook handlers.

| Tool | Purpose | Side effects |
|------|---------|--------------|
| `mcp__mrclean__check` | Scan provided text and return a findings list (rule ID, severity, placeholder, hash, fingerprint). | None. Read-only. |
| `mcp__mrclean__redact` | Scan provided text and return `{ redacted: <text-with-placeholders>, findings: [...] }`. | Writes one audit log entry per finding. |
| `mcp__mrclean__status` | Return version, rule count, allowlist count, mode, session ID, and audit log path. | None. |

**Deliberately NOT exposed:** `unredact`, `disable`, `add_word`, `config_write`, `ignore`.
Pitfall #10: a prompt-injected model cannot ask mrclean to disable itself or write a
permissive allowlist entry. Reverse-direction restoration (placeholder → original) is
planned for v2 REVMODE and will run server-side via a `PostToolUse` handler — it will
NOT be exposed as a model-facing tool.

All three tools use Zod v4 input and output schemas. The output schemas are registered
with the SDK so callers receive typed `structuredContent` alongside the human-readable
`content[]` text. Tool crashes are isolated by a supervisor so a bad input cannot kill
the MCP server process.

---

## 9. Compatibility

| Runtime | Minimum |
|---------|---------|
| Node.js | 20.18.0 (LTS — the `engines.node` floor in `package.json`) |
| Claude Code | 2.1.121 (required for `PostToolUse.updatedToolOutput` field support) |
| npm | 9.5.0 (for `--provenance` flag during automated publishes — not required for users) |

**Platforms tested:** macOS (Apple Silicon + Intel), Linux (Ubuntu 22.04/24.04),
Windows (WSL2 + native PowerShell with Node 20).

**MCP transports:** stdio (default — Claude Code spawns `mrclean-mcp` directly) and
Streamable HTTP (`--transport http` for remote Claude Code surfaces). SSE transport
is deprecated as of the November 2025 MCP spec and not supported.

---

## 10. What this does NOT defend against

See [THREAT_MODEL.md](./THREAT_MODEL.md) for the full enumeration with mitigations.
Short list:

- **Pasted images / multimodal content** — mrclean scans text fields only; images
  embedded in prompts are not OCR'd and are not scanned.
- **Model memorization of training-time leaks** — if a secret was in the training
  corpus, the model may surface it independently of anything you type.
- **Operator prompt-injection** — a malicious document or tool result that tells you to
  run `npx mrclean uninstall` to fix an error. Operator awareness is the only defense.
- **Adversarial obfuscation** — homoglyph substitution, unusual base64 variants, and
  other novel encodings that bypass regex and entropy heuristics.
- **Network-level interception of the Claude API itself** — mrclean is in-session via
  the Claude Code hook contract; bypassing Claude Code entirely puts you outside
  mrclean's protection.
- **Pre-commit / git-history scanning** — use gitleaks or trufflehog for that. See the
  layering FAQ in section 1 above.

---

## 11. License

[MIT](./LICENSE). No telemetry, no phone-home, no analytics — by design and by
architecture (no network calls other than the Anthropic API that Claude Code itself
makes).

---

*mrclean-claude is not affiliated with Anthropic. It is an independent tool that
integrates with Claude Code via the published hook contract.*
