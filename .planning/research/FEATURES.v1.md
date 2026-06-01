# Feature Research

**Domain:** In-session redactor / DLP for AI coding agents (Claude Code)
**Researched:** 2026-05-13
**Confidence:** MEDIUM-HIGH (HIGH on detection-engine prior art via gitleaks/Presidio/TruffleHog; MEDIUM on Claude-Code-specific hook UX since the integration surface is < 12 months old; LOW only on competitive details for closed-source commercial tools like Lakera and Nightfall where docs are marketing-grade)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or untrustworthy. These are the price of admission for the in-session-redactor category.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Regex secret detection (Layer 1) | Every comparable tool ships this — gitleaks, ggshield, TruffleHog, detect-secrets all use regex as the primary engine. Users will assume "you cover the gitleaks rule pack" without asking. | LOW (adopt, don't author) | Gitleaks rule pack in TOML is the de-facto baseline; ~150 community-maintained patterns covering AWS/GitHub/Stripe/Slack/JWT/PEM. Ship it embedded; don't depend on `gitleaks` binary. |
| Shannon-entropy heuristic (Layer 2) | TruffleHog and gitleaks both score entropy on base64/hex blobs > 20 chars; users expect entropy as the safety net for novel/custom token formats regex cannot anticipate. | LOW | Threshold tunable per rule (gitleaks pattern). Built-in suppression for hashes / UUIDs / git SHAs / common base64-image data is also expected — without it the false-positive rate makes the tool unusable. |
| `.env*` value extraction (Layer 3) | This is the highest-leverage layer for repo-specific protection and the one that differentiates an "in-session" tool from a generic regex scanner. Users keep secrets in `.env`; failing to read them is a glaring gap. | LOW | Extract values (not keys), add to in-memory blocklist on session start. Watch all `.env*` variants (`.env`, `.env.local`, `.env.production`, etc.). |
| User dirty-word file (Layer 4) | Project-specific terms (codenames, customer names, internal hostnames) regex/entropy will never catch. Every AI-coding-DLP product offers a custom-terms list. | LOW | `.mrclean/words.txt` per PROJECT.md. Case-insensitive matching with word-boundary anchoring; whole-word default to limit collisions. |
| Block-on-detect default action | Hard default is the only safe one. ggshield, Lakera, Nightfall all default to block + structured reason. "Warn but pass through" as default would invalidate the whole product premise. | LOW | Returns structured reason payload to Claude Code so the agent can self-correct ("I tried to send X, mrclean blocked it, here's why"). Per Claude Code v2.0.10 PreToolUse hooks can also modify input — use this for inline redact-and-pass. |
| Stable, collision-free placeholder tokens | Standard convention is `[TYPE_N]` or `<TYPE:N>` with deterministic numbering. Inconsistent placeholders break the LLM's context (it loses anaphoric references) and break reversible mode. | LOW | Same value → same token across the session. Token must be regex-distinct from any plausible code identifier so it round-trips through diff/edit operations. See "placeholder format" decision below. |
| Per-rule action override (block / warn / audit) | Standard config feature in gitleaks, GitLab secret detection, and every commercial DLP tool. Users need to triage noisy rules without disabling them entirely. | LOW | Three-tier action: `block` (deny tool call), `warn` (log + redact + continue), `audit` (log + pass through unchanged). Must be expressible per-rule and per-severity. |
| Allowlist mechanism (rule + path + value patterns) | gitleaks, detect-secrets, ggshield all ship multi-axis allowlists. Without one, every false positive becomes a config rebuild or a disabled rule, which is worse. | LOW-MEDIUM | Three axes minimum: per-rule `regexes` (specific token shapes to ignore), `paths` (globs for files like `tests/fixtures/`), `stopwords` (substring suppressors like `EXAMPLE`, `DUMMY`). Plus per-finding fingerprint allowlist (gitleaks `.gitleaksignore` model) so a user can say "yes I know about this one specific match, never flag it again". |
| Audit log of every match (no plaintext) | Without an audit trail users have no way to investigate "why did Claude Code stop responding?" or to validate that the tool is doing useful work. JSONL is the genre standard. | LOW | One JSON object per line at `.mrclean/audit.jsonl`. Schema: `{timestamp, sessionId, ruleId, severity, action, hookEvent, hashOfMatch, lengthOfMatch, contextPath}`. **Never log raw secret values** — log `sha256(value)[:16]` so the same secret correlates across events without being recoverable. |
| Severity tiers | Industry-standard 4-tier (CRITICAL / HIGH / MEDIUM / LOW or equivalent) used by gitleaks, GitLab, ggshield. Drives default actions and helps users tune. | LOW | Suggested mapping: CRITICAL = verified credential format with high entropy (AWS key, real JWT); HIGH = credential format without entropy verification; MEDIUM = generic high-entropy strings; LOW = dirty-word matches. Default action ladder: CRITICAL+HIGH=block, MEDIUM=warn, LOW=audit. |
| Zero-config installer | `npx mrclean install` per PROJECT.md. ggshield's AI-hook installer and most npm-distributed Claude Code tools (e.g., codacy guardrails) set this expectation. Anything that requires hand-editing `~/.claude/settings.json` will lose users in the first 5 minutes. | MEDIUM | Idempotent edit of `~/.claude/settings.json` (parse → merge → write atomically). Must handle: existing hooks present, partial prior install, uninstall path (`npx mrclean uninstall`), upgrade path (`npx mrclean install --force`). |
| Config file with sensible defaults | Everyone ships one; tradition is TOML for security tooling (gitleaks, GitLab) but JSON is more native to the Node ecosystem. Users expect to override rules without forking the package. | LOW | `.mrclean/config.toml` (recommended) — TOML aligns with gitleaks rule format so users who already maintain a gitleaks config can copy patterns over. Schema: `[rules.<id>]`, `[allowlists]`, `[mode]`. Zero-config first run must work with **no config file present**. |
| MCP server entry point | PROJECT.md requirement. Standard pattern for new Claude Code integrations in 2025-2026; users wire mrclean into projects that don't have hooks set, or call it explicitly mid-session ("mrclean check this paste"). | MEDIUM | Per existing prior art (mcp-redact, redact-mcp), expose 2-3 tools; see "MCP tool surface" below. |

### Differentiators (Competitive Advantage)

Features that set mrclean apart from gitleaks-style scanners and from generic DLP tools that aren't AI-coding-aware. These align with the Core Value: "real secrets and proprietary terms never reach the wire — without trading away productivity."

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Reversible mode (round-trip restoration) | The killer feature. Sanitize outbound, restore on inbound, so file paths, identifiers, and names round-trip through the model and code edits land on the right files. mcp-redact and redact-mcp do this; gitleaks/ggshield/TruffleHog do not. This is what makes mrclean an "in-session" tool rather than a "scanner that occasionally fires." | HIGH | Session-scoped, in-memory placeholder→original map per PROJECT.md. Bidirectional mapping table; same real value always maps to same fake value. Inbound restoration runs on PostToolUse / tool-result paths. **Encryption-at-rest required if persisted** (PROJECT.md constraint). |
| Hook + MCP dual integration | Most prior-art tools are either a hook (ggshield) or an MCP (mcp-redact) — not both. Hook = automatic, opaque, can't be disabled by the model. MCP = explicit, callable, useful for ad-hoc checks. Together they cover both "I forgot to think about this" and "I want to check this specific thing." | MEDIUM | Hook is the safety floor; MCP is the user-driven escape hatch. Same detection engine under both; share the rule pack and config. |
| Layer 5 optional LLM classifier (deep mode) | PROJECT.md requirement, opt-in. Lakera Guard's whole pitch is LLM-based detection of disguised intent and semantic PII; offering this opt-in as a fifth layer (rather than the only layer) gives users a clear "if regex+entropy aren't enough, here's deeper coverage" path without forcing the cost on everyone. | HIGH | Off by default for cost. Use a small local model (Llama 3.1 8B-class is the literature default for local-LLM PII redaction) OR a remote API gated by allowlist of providers. Performance budget per PROJECT.md (200 ms PostToolUse) is incompatible with remote LLM by default — make this clear. |
| Structured reason payload back to the agent | When mrclean blocks or rewrites a tool call, the agent sees a structured "this was blocked because rule `aws-access-key` matched at offset 142" message instead of an opaque error. Lets Claude self-correct ("let me try without that env var dumped"). PROJECT.md calls this out specifically. | LOW-MEDIUM | Per Claude Code hook contract, return JSON in the hook stdout with `decision`, `reason`, `redactedSpans[]`. Wire into PreToolUse modification (v2.0.10+) where possible to redact-and-pass instead of block-and-retry. |
| Dry-run / report-only mode | Before users trust mrclean to block their workflow, they want to run it for a session and see what *would* have been redacted. Standard in DLP rollouts (Microsoft Purview, Palo Alto Enterprise DLP). Trial period feature. | LOW | Single config flag (`mode = "dry-run"`) that forces every rule's action to `audit` regardless of severity. Audit log captures `wouldHaveBlocked: true`. CLI command (`npx mrclean report`) summarizes the last N sessions. |
| False-positive feedback loop | DLP-industry pattern (Microsoft Purview, Skyhigh, Palo Alto). When a user discovers something was wrongly redacted, one command (`npx mrclean ignore <fingerprint>`) appends to the local allowlist. Closes the loop without forcing config-file editing. | LOW | Each finding gets a deterministic fingerprint (`sha256(ruleId + valueHash + filePath)`) shown in the structured reason. `mrclean ignore <fp>` adds it to `.mrclean/ignore.txt`. No remote feedback / "ML-augmented" fanciness in v1 — that's the commercial-DLP feature set, out of scope here. |
| Per-project + per-machine config layering | gitleaks/detect-secrets do this; users want personal allowlists (`~/.mrclean/global.toml`) on top of project rules (`.mrclean/config.toml`) on top of bundled defaults. | LOW-MEDIUM | Three-layer cascade: bundled defaults → user-global → project-local. Project-local can extend OR override; global cannot weaken project. |
| Deterministic placeholder format that survives diffs | Choose `<MRCLEAN:TYPE:NNN>` (PROJECT.md draft format). Critical that the format does not match any plausible code identifier so it survives Markdown rendering, diff/patch operations, JSON serialization, and shell command interpretation. Lakera/Presidio use `[PERSON_1]` / `{{PERSON_1}}`; mrclean's longer prefix is more uniqueness-friendly for code contexts where `[PERSON_1]` could collide with array syntax or Python type hints. | LOW | Format proposal: `<MRCLEAN:SECRET:001>`, `<MRCLEAN:ENV:042>`, `<MRCLEAN:WORD:007>`. Uppercase tag, zero-padded counter, angle-bracket delimited. Survives JSON (escaped if needed but recognizable), Markdown (renders as literal), diff (single-line), code (no language treats `<X:Y:Z>` as a literal). Counter is per-type, monotonic per session, never reused within session. |
| Manifest of placeholders alongside audit log | When debugging why a tool call was rewritten, users want to see "here's the full mapping for this session." Separate `.mrclean/manifest.jsonl` distinct from audit (audit = events; manifest = mappings). Optional in v1, but high-value diff vs. competitor products that hide the mapping. | LOW | One JSONL line per unique placeholder: `{placeholder, type, ruleId, hashOfOriginal, firstSeenAt, occurrences}`. Never includes the original value. Reversible mode keeps the original-value→placeholder map in memory only; manifest is its hashed shadow. |
| Performance budget enforcement | PROJECT.md sets <100ms (UserPromptSubmit) / <200ms (PostToolUse). Most DLP tools don't measure themselves; users will. Built-in self-timing + self-warning ("mrclean took 312ms on this prompt — consider tightening allowlists") is a trust feature. | LOW-MEDIUM | Wrap the detection pipeline with a timer; if it exceeds budget, log a warning event (rule = `__perf__`) and ship anyway. Layer 5 is exempt because opt-in. |
| Hook installer with surgical `settings.json` merge | Don't overwrite the file. Parse JSON, locate `hooks` block, merge mrclean-tagged entries (use a marker comment or distinct key), write atomically. Detect prior installation; idempotent. ggshield's installer is the model — it survived several Claude Code hook-contract changes without losing user config. | MEDIUM | Implementation: read → JSON.parse → mutate in-place using deep-clone (immutability) → write to `settings.json.tmp` → rename atomically. Tag mrclean-managed entries with `"_managedBy": "mrclean"` so uninstall finds them. Refuse to install if existing hook with same matcher exists from a different tool — print conflict resolution. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create real problems for an in-session redactor for AI coding. Document them so they don't sneak back in via "user requests."

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Cross-session persistence of placeholder→original map | "I want my placeholders to be the same yesterday and today so my code edits stay consistent." | PROJECT.md explicitly bans this. Cross-session map = persistent inventory of every secret the user has ever pasted into Claude Code, sitting on disk with the user's other dev files. If it leaks (synced to cloud backup, accidentally `git add`'d, exfiltrated by a different malware) the blast radius is the user's career, not just one session. | Session-scoped map only. For consistent placeholder names across sessions, use a deterministic hash-derived name (`<MRCLEAN:SECRET:hash6>`) instead of a counter — same input → same placeholder without needing a stored map. Defer this until v1.1+ once core is validated. |
| Real-time team policy server / centralized rule sync | "We want to push our org's secret rules to every developer's mrclean install." | PROJECT.md "Out of Scope": single-developer workflow first. Building this properly requires auth, transport security, audit centralization, role-based config — turns mrclean into an enterprise DLP product with all of that scope. Defer until v1 ships and demand is validated. | Document the path: "to share rules across a team in v1, commit `.mrclean/config.toml` to your repo." That's enough leverage for 90% of teams without building a server. |
| Standalone batch CLI that scans a directory and writes sanitized copies | "Like gitleaks but with redaction baked in — let me sanitize a folder before shipping it." | PROJECT.md "Out of Scope": the leak path mrclean prevents is runtime, not file-on-disk. A batch CLI competes with gitleaks/trufflehog at their strength (file scanning) and abandons the differentiator (in-memory hook). Doubles surface area for the same protection. | Document the position: "mrclean is the runtime complement to gitleaks. Use both — gitleaks for pre-commit, mrclean for in-session." |
| Pre-commit / git-hook integration | "Why have two tools when one could do both?" | PROJECT.md "Out of Scope": gitleaks and ggshield already own this niche with mature implementations. mrclean re-implementing pre-commit detection is duplicate code and divides attention from the in-session work where prior art is thin. | Recommend gitleaks/ggshield in the README. Optionally publish a TOML compat layer so mrclean's rule format reads gitleaks rules directly (low cost, high goodwill). |
| Local HTTP proxy that intercepts arbitrary AI-tool traffic | "What about Cursor? What about ChatGPT in the browser?" | PROJECT.md "Out of Scope". Browser proxies have certificate-trust issues; system-wide proxies break unrelated traffic; shadow-AI coverage (à la Nightfall browser plugin) is a different product category with its own threat model. mrclean's leverage is the deterministic Claude Code hook contract — generalizing dilutes that. | If demand emerges, ship per-tool integrations (a Cursor-rules plugin, a Copilot policy file) with the same detection engine. Don't ship a proxy. |
| "ML-driven false-positive reduction" with telemetry phone-home | DLP industry standard (Skyhigh, Palo Alto Purview). Vendors love it because it locks customers in via ML training data. | Privacy product cannot phone home about which secrets it almost-leaked. Even hashed telemetry leaks usage patterns and correlates with the user's projects. Existential brand risk. | Local-only feedback loop (the `mrclean ignore <fp>` flow above). No telemetry. State this explicitly in the README — it's a marketing differentiator. |
| LLM-based classifier as the primary or default detector | Lakera Guard's positioning makes this look mandatory. | Cost (per-call API charge for every prompt and tool result), latency (>200ms typical), reliability (LLM hallucinated detections create noise, missed detections create false negatives), and the local-first / no-network-by-default principle rules it out as the default. | Layer 5 opt-in only. Document clearly: "LLM detection is the optional last line, not the front line." |
| Auto-rotate / auto-revoke detected secrets | Some commercial DLPs offer this. | Out of scope for an in-session tool; rotation requires platform-specific integrations (AWS, GitHub, Stripe APIs) and credentials with rotation rights — exactly the kind of high-privilege state mrclean is supposed to *avoid* having. | Surface the detection clearly with provider context ("looks like an AWS access key — rotate via AWS console"). Provide a link, not a button. |
| "Restore" button for already-blocked content (one-click bypass) | UX-driven; users get frustrated when blocked. | Defeats the entire safety model. If the user can one-click bypass, attackers / accidental leaks can too (especially via a prompt-injection chain that asks the model to "use the bypass tool"). | Per-rule allowlist + fingerprint ignore is the right abstraction. Bypass requires editing config (intentional, auditable, slows down both legitimate and malicious paths). |
| Tracking / displaying exact original values in the audit log | "When debugging, I want to see what the actual secret was." | The audit log is on disk; logging plaintext secrets means the audit log itself becomes the leak path. | Log `sha256(value)[:16]` (lets correlation work), `len(value)`, `first2chars + "..." + last2chars` (helps human ID without recovering full value). Never the full value. |
| Real-time UI / dashboard | Looks impressive in demos. | Single-developer workflow per PROJECT.md. A dashboard requires either a long-running server process (resource cost, surface area) or a browser extension (separate trust boundary). The audit log + a `mrclean status` CLI covers 95% of the UX value at 5% of the cost. | `npx mrclean status` (current session summary), `npx mrclean report` (last N sessions), tail-friendly JSONL output that users can pipe into their own tooling (`tail -f .mrclean/audit.jsonl | jq`). |

## MCP Tool Surface (Specific Decision)

Prior art (mcp-redact, redact-mcp) suggests 2-3 tools. Recommend the following tool surface for mrclean's MCP server:

| Tool | Purpose | When Claude Calls It |
|------|---------|----------------------|
| `mrclean_check` | Scan an arbitrary text payload, return findings without redacting. Returns `{findings: [{ruleId, severity, span, fingerprint}]}`. | "Before I send this paste to another tool, is it safe?" Read-only, no side effects. |
| `mrclean_redact` | Scan + redact in one call. Returns `{redactedText, mappings: [{placeholder, type}]}` (no original values returned to Claude). | "Sanitize this before I include it in my response." The active redaction primitive. |
| `mrclean_status` | Return session summary: detection counts by severity, current mode, current rules loaded, current allowlists. | Diagnostic / introspection — Claude can answer "is mrclean running?" and "what would it block?" |

**Deliberately NOT exposed as MCP tools:**

- `mrclean_unredact` / restore — exposing a "give me the original value back" tool would let a prompt-injection attack drain the placeholder map. Restoration happens automatically in the PostToolUse hook on the trusted return path; the model never gets a tool that does it.
- `mrclean_disable` / `mrclean_pause` — same reason; one prompt injection away from a full bypass. Disable requires CLI invocation by the human.
- `mrclean_config_write` — writing config from inside a session lets the agent (or an injection chain) weaken its own guardrails. Read-only via `mrclean_status`, write via CLI only.

This matches the security principle in the prompt-injection literature: tools the agent can call should never be able to weaken the boundary that *contains* the agent.

## Placeholder Format (Specific Decision)

| Option | Pro | Con | Decision |
|--------|-----|-----|----------|
| `[PERSON_1]` (Presidio default) | Short, readable | Conflicts with array literal syntax in Python/JS, with TOML key syntax, with Markdown link syntax | REJECT |
| `{{PERSON_1}}` (Presidio alt) | Familiar (Mustache/Jinja) | Conflicts with template literal syntax in many code contexts | REJECT |
| `<PERSON:1>` | Distinctive | Conflicts with HTML/JSX/generics | REJECT |
| `<MRCLEAN:SECRET:001>` (PROJECT.md draft) | Namespace-prefixed (no realistic collisions); type-tagged; zero-padded counter sortable; survives JSON/Markdown/diff round-trips | Verbose | **ADOPT** — verbosity is acceptable cost for collision safety in a code context |

**Token type taxonomy** (drives the `:TYPE:` segment):
- `SECRET` — Layer 1/2 detections (regex or entropy).
- `ENV` — Layer 3 detections (`.env` value match).
- `WORD` — Layer 4 detections (user dirty-word file).
- `PII` — Layer 5 detections (LLM classifier).

Numbering is monotonic per type per session. Same value within a session always maps to same placeholder (Presidio model). Across sessions, the counter resets (no cross-session map per PROJECT.md).

## Collision Handling (Specific Decision)

Three collision risks:

1. **Two different secrets map to the same placeholder.** Solved by per-session counter + per-value deduplication: scan all matches, dedupe by hash, assign next counter, build mapping table once per session.
2. **A placeholder appears in user content unrelated to mrclean.** The `MRCLEAN:` namespace prefix makes this functionally impossible. If it ever happens (collision check in tests), reject the input with a clear error.
3. **A redacted placeholder gets edited by the model into a malformed token (`<MRCLEAN:SECRET:1>` → `<MRCLEAN:SECRET:1>X`).** Reversible mode's restorer uses regex `<MRCLEAN:[A-Z]+:\d{3,}>` and only restores exact matches; broken tokens are left as-is and surface in the next-iteration audit log.

## Manifest / Audit Shape (Specific Decision)

**Two separate files**, both JSONL, both at `.mrclean/`:

### `.mrclean/audit.jsonl` — Event log (every detection event)

```json
{"ts":"2026-05-13T12:34:56.789Z","sessionId":"a1b2c3","event":"detect","hookEvent":"PreToolUse","ruleId":"aws-access-key","severity":"CRITICAL","action":"block","fingerprint":"f0e1d2","matchHash":"sha256:abcd1234","matchLen":40,"matchPreview":"AK..XY","contextPath":"tool=Bash arg=command","perfMs":12}
```

### `.mrclean/manifest.jsonl` — Placeholder map shadow (one entry per unique placeholder per session)

```json
{"ts":"2026-05-13T12:34:56.789Z","sessionId":"a1b2c3","placeholder":"<MRCLEAN:SECRET:001>","type":"SECRET","ruleId":"aws-access-key","matchHash":"sha256:abcd1234","occurrences":3,"reversible":true}
```

Splitting them serves different consumers: audit.jsonl is for security review and triage; manifest.jsonl is for debugging "why did this code edit land on `<MRCLEAN:SECRET:001>` instead of my real value." Neither contains plaintext.

## Reversible Mode UX (Specific Decision)

- **Default OFF** per PROJECT.md (one-way is the safer default).
- **Activation:** `[mode]\nreversible = true` in `.mrclean/config.toml`, OR `MRCLEAN_REVERSIBLE=1` env var (override for one session).
- **Indicator:** When reversible mode is on, every audit event includes `"reversible":true` and the structured reason payload to the agent includes a banner line so Claude knows path/name round-trip is enabled.
- **Map storage:** In-memory only by default (PROJECT.md). Optional crash-recovery persistence behind `[mode.recovery]\nencrypted = true` flag — uses a session-derived key written to OS keychain, file deleted on session end. Map file path: `${TMPDIR}/mrclean-${sessionId}.enc`.
- **Restoration boundary:** Inbound only (PostToolUse hook on tool-result path). Never expose restore via MCP tool (see MCP Tool Surface above).
- **Visibility:** `npx mrclean show-mappings --session current` lists active placeholders (no plaintext, just `placeholder → type → length → first2chars`). `npx mrclean show-mappings --reveal` requires explicit `--reveal` flag and prompts for confirmation; only available to the local user, not via MCP.

## Hook Installer UX (Specific Decision)

```
$ npx mrclean install
✓ Detected Claude Code at ~/.claude/settings.json
✓ Backed up to ~/.claude/settings.json.bak.20260513-123456
✓ Installed UserPromptSubmit hook (mrclean-managed)
✓ Installed PreToolUse hook (mrclean-managed)
✓ Installed PostToolUse hook (mrclean-managed)
✓ Registered MCP server: mrclean (stdio)
✓ Created .mrclean/ directory in current project
✓ Wrote default config to .mrclean/config.toml

mrclean is active. Try: claude code "what does mrclean status say?"
```

Required behaviors:
- **Backup before edit**, always, with timestamp suffix.
- **Atomic write** (write to `.tmp` + rename).
- **Idempotent**: running `install` twice is a no-op (detect via `_managedBy: "mrclean"` marker).
- **Conflict detection**: if a hook with the same matcher exists from a different tool, print the conflict and require `--force` or `--merge`.
- **Uninstall**: `npx mrclean uninstall` removes only mrclean-tagged entries, leaves user's own hooks untouched.
- **Upgrade**: `npx mrclean install --force` re-applies the latest hook config (for when the hook contract changes).
- **Project init separate**: `npx mrclean init` (no global args) just creates `.mrclean/` in cwd; useful for projects that want config without re-installing the global hook.

## Config File Shape (Specific Decision)

`.mrclean/config.toml` — TOML, aligns with gitleaks rule format for paste-compatibility.

```toml
# Global settings
[mode]
default = "block"          # block | warn | dry-run
reversible = false
deepLLM = false

[performance]
maxHookMs = 100            # warn threshold
maxToolMs = 200

# Layer toggles
[layers]
regex = true
entropy = true
envExtract = true
dirtyWords = true
llm = false                # Layer 5 opt-in

[entropy]
threshold = 4.5
minLength = 20

# Per-rule overrides
[rules.aws-access-key]
severity = "CRITICAL"
action = "block"

[rules.generic-high-entropy]
severity = "MEDIUM"
action = "warn"

# Allowlists
[allowlists]
# Per-rule
[[allowlists]]
description = "Test fixtures"
targetRules = ["aws-access-key"]
paths = ["**/tests/fixtures/**", "**/__mocks__/**"]

[[allowlists]]
description = "Common false-positive substrings"
stopwords = ["EXAMPLE", "DUMMY", "PLACEHOLDER", "XXXXXXXX"]

# Custom user rules
[[customRules]]
id = "internal-hostname"
description = "Internal hostnames"
regex = '''[a-z0-9-]+\.internal\.example\.com'''
severity = "HIGH"
```

Plus a separate per-fingerprint ignore file (gitleaks model):

`.mrclean/ignore.txt` — one fingerprint per line, `#` comments allowed.

## Severity Tiers (Specific Decision)

| Tier | Definition | Default Action | Examples |
|------|------------|----------------|----------|
| CRITICAL | Verified credential format with high confidence (regex match + entropy check passes) | block | AWS access key, GitHub PAT, Stripe live key, PEM private key block |
| HIGH | Credential format match without entropy verification, OR `.env` value match | block | JWT-shape (no signature verification), `.env` value seen in prompt |
| MEDIUM | Generic high-entropy string (Layer 2 only, no regex match) | warn | Random 32-char base64 that no regex caught |
| LOW | User dirty-word match, OR LLM-classifier suggestion | audit | Codename, internal hostname, "looks like a customer name" |

Defaults are user-overridable per rule.

## Allowlist Mechanism (Specific Decision)

Adopt the gitleaks model (proven, well-understood by the secret-scanning community) with adjustments for the in-session context:

1. **Per-rule allowlist** — TOML block scoped via `targetRules = ["aws-access-key"]`. Multiple allowlists can target the same rule; ANY match suppresses.
2. **Path glob allowlist** — `paths = ["**/tests/**"]`. Matched against the contextual file path when one is available (Edit/Write tool inputs).
3. **Stopword allowlist** — `stopwords = ["EXAMPLE", "DUMMY"]`. Substring suppression for known-false-positive markers.
4. **Regex allowlist** — `regexes = ['''^AKIA0{16}$''']`. Whole-match exclusions for specific token shapes.
5. **Per-finding fingerprint allowlist** — `.mrclean/ignore.txt` with deterministic fingerprints. The "I know about this one specific secret, never bother me again" exit hatch. The CLI command `mrclean ignore <fingerprint>` appends here.

Hierarchical scoping: bundled defaults < user-global (`~/.mrclean/global.toml`) < project-local (`./.mrclean/config.toml`). Project-local cannot weaken (= cannot remove) bundled severity assignments without explicit `[rules.X] inherited = false` opt-out — small friction to prevent silent disabling of safety rules.

## Dry-Run / Report Mode (Specific Decision)

Two modes, distinct purposes:

- **`mode.default = "dry-run"`** — Every detection becomes `audit` regardless of severity. Audit log captures `wouldHaveBlocked: true`. **Production session continues unmodified** — used to evaluate impact before turning on enforcement.
- **`npx mrclean report [--last N]`** — Post-hoc CLI that summarizes the last N sessions: detection counts per rule, per severity, per action, top false-positive fingerprints (most-frequently-seen), avg perf overhead. Intended for "is mrclean tuned right?" review.

Default for first-run users: dry-run for the first session (with prominent warning at session start "mrclean is in dry-run — nothing is being blocked yet"), then `mrclean enforce` flips to block. Lowers the trust barrier for adoption.

## False-Positive Feedback Loop (Specific Decision)

Local-only, no telemetry. Three primitives:

1. **`mrclean ignore <fingerprint>`** — Append to `.mrclean/ignore.txt`. Fingerprint shown in every audit event and structured-reason payload, so the user can copy-paste it.
2. **`mrclean ignore --rule <ruleId> --here`** — Add a path-allowlist entry for the cwd to `.mrclean/config.toml` (interactive, asks confirmation).
3. **`mrclean unignore <fingerprint>`** — Removes from `.mrclean/ignore.txt`. Symmetry matters; users will misclick.

Out of scope (anti-feature): "mrclean learn from my ignores" with model retraining or pattern induction. That's commercial-DLP territory and the privacy-product brand cannot survive a bug there. Manual-only feedback loop.

## Feature Dependencies

```
Hook installer (npx mrclean install)
    └──requires──> Hook contract knowledge (Claude Code v2.0.10+)
    └──requires──> MCP SDK integration

Detection engine
    ├── Layer 1 (regex)        ──independent, ship first──
    ├── Layer 2 (entropy)      ──requires──> Layer 1 (entropy is post-regex filter for unmatched candidates)
    ├── Layer 3 (env extract)  ──independent, requires session-start hook
    ├── Layer 4 (dirty words)  ──independent
    └── Layer 5 (LLM)          ──independent, opt-in only

Placeholder substitution
    └──requires──> Detection engine (any layer)
    └──requires──> Stable placeholder format

One-way redact mode
    └──requires──> Placeholder substitution

Reversible mode
    └──requires──> Placeholder substitution
    └──requires──> Session-scoped in-memory map
    └──requires──> PostToolUse hook integration (restoration path)
    └──enhances──> Differentiation vs. one-way scanners

MCP tool surface (mrclean_check, mrclean_redact, mrclean_status)
    └──requires──> Detection engine
    └──requires──> MCP server scaffolding

Audit log
    └──requires──> Detection engine (events to log)
    └──requires──> Match-hashing utility (never log plaintext)

Manifest log
    └──requires──> Placeholder substitution
    └──requires──> Match-hashing utility

Allowlist (per-rule + path + stopword + regex)
    └──requires──> Config file parser
    └──requires──> Detection engine (to apply against)
    └──enhances──> All detection layers (suppresses false positives)

Per-fingerprint ignore (.mrclean/ignore.txt)
    └──requires──> Stable fingerprint generation
    └──requires──> CLI command (mrclean ignore)
    └──enhances──> False-positive feedback loop

Dry-run mode
    └──requires──> Mode switch in config
    └──requires──> Audit log (to capture wouldHaveBlocked events)

Report CLI (mrclean report)
    └──requires──> Audit log (to summarize)

Severity tiers
    └──requires──> Action mapping
    └──enhances──> Per-rule overrides (default action = severity-derived)

Performance budget enforcement
    └──requires──> Self-timing wrappers in detection pipeline
    └──conflicts──> Layer 5 LLM (opt-out from budget; document clearly)

Hook installer ←──conflicts──> User has hand-edited settings.json
    (resolution: backup + merge with marker, surface conflicts on collision)
```

### Dependency Notes

- **Hook installer is a v1 prerequisite, not a v1 feature**: nothing else in the product is reachable until the installer works. It's also the single most likely place to break across Claude Code releases. Budget extra resilience and version-detection here.
- **Reversible mode requires both detection AND PostToolUse integration**: the inbound restoration is the harder half. Without it, "reversible" is just "we kept a map."
- **Allowlist work is cheap individually but compounds**: each layer (rule / path / stopword / regex / fingerprint) is a separate code path with separate test surface. Plan for a single allowlist evaluator module that all five feed into.
- **MCP tools and hooks share the detection engine**: build the engine as a pure function (input → findings + redacted text), then wrap with hook glue and MCP glue. Don't duplicate detection logic in two places.
- **Layer 5 LLM is independent and opt-in**: ship v1 without it. Adding it later requires no breaking changes to layers 1-4.
- **Performance budget conflicts with Layer 5**: document the exemption explicitly; users opting into deep mode have implicitly accepted higher latency.
- **Per-machine + per-project config layering** depends on having a stable resolution order; design this before writing the parser, not after.

## MVP Definition

### Launch With (v1)

The minimum viable mrclean — sufficient to validate that an in-session redactor for Claude Code provides real value.

- [ ] **Hook installer (`npx mrclean install` / `uninstall` / `--force`)** — without this, nothing else is reachable. Atomic, idempotent, backup-before-write.
- [ ] **MCP server with `mrclean_check`, `mrclean_redact`, `mrclean_status`** — explicit tool surface for users to call mid-session.
- [ ] **Layer 1 (regex / gitleaks pack)** — primary detector; everyone expects it.
- [ ] **Layer 2 (entropy heuristic)** — necessary safety net; without it Layer 1 alone misses too much.
- [ ] **Layer 3 (`.env` value extraction)** — highest-leverage layer for repo-specific protection; the differentiator vs. generic regex scanners.
- [ ] **Layer 4 (user dirty-word file)** — the only practical mechanism for project-specific terms.
- [ ] **Stable placeholder substitution (`<MRCLEAN:TYPE:NNN>`)** — the format itself must ship correct in v1; changing later breaks every reversible-mode session in flight.
- [ ] **One-way redact mode (default)** — the safe default; everything else is built around this baseline.
- [ ] **Block-on-detect with structured reason payload** — the safety floor; tells Claude *why* a tool call was rewritten so the agent can self-correct.
- [ ] **Per-rule action override (block / warn / audit)** — without this, every false positive becomes a disabled rule.
- [ ] **Severity tiers (CRITICAL / HIGH / MEDIUM / LOW)** — drives default actions; users expect this granularity.
- [ ] **Allowlist mechanism (per-rule + path + stopword + fingerprint)** — without an allowlist, false positives become rage-quit triggers in week one.
- [ ] **Audit log (`.mrclean/audit.jsonl`)** — the trust artifact; users won't deploy a tool that silently blocks things.
- [ ] **Config file (`.mrclean/config.toml`) with bundled defaults** — zero-config first run + override path.
- [ ] **Dry-run mode** — the on-ramp for trust; users will run it before turning enforcement on.
- [ ] **Performance self-monitoring (audit warning if budget exceeded)** — keeps the product honest under the <100ms / <200ms PROJECT.md constraints.

### Add After Validation (v1.x)

Add once core is stable and the in-session-redactor concept is validated by real users.

- [ ] **Reversible mode (round-trip restoration)** — high value but high risk; ship after one-way mode has burned in. Trigger: at least one user explicitly asks for it AND core detection is stable.
- [ ] **Manifest log (`.mrclean/manifest.jsonl`)** — useful debugging aid; depends on reversible mode shipping first to be maximally useful.
- [ ] **Report CLI (`npx mrclean report`)** — power-user feature; depends on having enough audit data to be worth summarizing.
- [ ] **False-positive feedback CLI (`mrclean ignore <fp>`)** — depends on user-reported friction with raw config-file editing. May be needed sooner if early users complain.
- [ ] **Per-machine + per-project config layering** — useful when the same user runs mrclean across multiple repos. Ship when first user asks.
- [ ] **TOML compat layer for gitleaks rules** — goodwill feature; ship if the security community gives positive signal on adopting mrclean.

### Future Consideration (v2+)

Defer until product-market fit is established.

- [ ] **Layer 5 LLM classifier** — high implementation cost, high ongoing cost (model hosting / API billing / latency tuning), uncertain incremental value beyond layers 1-4. Ship only if real-world false-negative rate justifies it. PROJECT.md already lists this as opt-in; v2 is the right time to actually build it.
- [ ] **Cross-session deterministic placeholder naming (hash-derived)** — solves the "my placeholders change every session" complaint without needing a stored cross-session map. Defer until user demand is concrete.
- [ ] **Encrypted disk persistence of reversible map (crash recovery)** — opt-in per PROJECT.md; only build if real users hit "lost my session map to a crash" problem.
- [ ] **Team policy server / rule sync** — explicitly out of scope per PROJECT.md until single-developer workflow is validated.
- [ ] **Other AI-tool integrations (Cursor, Copilot policy file, ChatGPT browser)** — each is its own product. Validate the Claude Code thesis first.
- [ ] **Verified-secret enrichment** (à la TruffleHog: actually call the AWS API to confirm the key is live) — adds dependency surface and network calls that are at odds with the local-first principle. Defer.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Hook installer | HIGH | MEDIUM | P1 |
| MCP server with `_check`, `_redact`, `_status` | HIGH | MEDIUM | P1 |
| Layer 1 (regex) | HIGH | LOW (adopt gitleaks) | P1 |
| Layer 2 (entropy) | HIGH | LOW | P1 |
| Layer 3 (.env extract) | HIGH | LOW | P1 |
| Layer 4 (dirty words) | MEDIUM | LOW | P1 |
| Placeholder substitution + format | HIGH | LOW | P1 |
| One-way redact mode | HIGH | LOW | P1 |
| Block + structured reason payload | HIGH | LOW | P1 |
| Per-rule action override | HIGH | LOW | P1 |
| Severity tiers | MEDIUM | LOW | P1 |
| Allowlist (per-rule + path + stopword + fingerprint) | HIGH | MEDIUM | P1 |
| Audit log | HIGH | LOW | P1 |
| Config file with defaults | MEDIUM | LOW | P1 |
| Dry-run mode | HIGH | LOW | P1 |
| Performance self-monitoring | MEDIUM | LOW | P1 |
| Reversible mode | HIGH | HIGH | P2 |
| Manifest log | MEDIUM | LOW | P2 |
| Report CLI | MEDIUM | MEDIUM | P2 |
| False-positive feedback CLI | MEDIUM | LOW | P2 |
| Per-machine config layering | MEDIUM | LOW | P2 |
| Gitleaks rule compat layer | LOW | LOW | P2 |
| Layer 5 (LLM classifier) | MEDIUM | HIGH | P3 |
| Cross-session deterministic placeholders | LOW | LOW | P3 |
| Encrypted disk persistence (crash recovery) | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for v1 launch
- P2: Should have, add in v1.x once v1 validates
- P3: Future consideration, defer until product-market fit

## Competitor Feature Analysis

| Feature | gitleaks (CLI scanner) | Lakera Guard (commercial) | Microsoft Presidio (lib) | Nightfall (browser/SaaS) | mcp-redact / redact-mcp (prior art) | mrclean (planned) |
|---------|------------------------|---------------------------|--------------------------|--------------------------|-------------------------------------|-------------------|
| Regex secret detection | Yes — primary | Yes (PII focus) | Yes | Yes | Yes | Yes (gitleaks pack) |
| Entropy heuristic | Yes | Unclear | No (NLP-driven) | Yes | Yes (mcp-redact) | Yes |
| `.env` value auto-extract | No | No | No | No | No | **Yes — differentiator** |
| User custom term list | Custom regex | Custom rules | Custom recognizers | Custom detectors | `customRules` array | Yes (`words.txt`) |
| LLM classifier | No | Yes — primary | Optional (Azure) | Yes (95% accuracy claim) | Optional NER | Yes (Layer 5, opt-in) |
| Reversible placeholder map | No | Implied | Yes (operator) | Unclear | Yes — primary feature | **Yes — differentiator** |
| Stable placeholder format | N/A | Unclear | `<TYPE_N>` per-request | Unclear | Bidirectional map | `<MRCLEAN:TYPE:NNN>` |
| Block / warn / audit actions | No (report only) | Yes | Operator-based | Yes | Yes (mode flag) | Yes (per-rule) |
| Audit log | Report file | Cloud-side | Pluggable | Cloud-side | JSONL local | JSONL local |
| Allowlist (multi-axis) | Yes (gold standard) | Unclear | Pluggable | Unclear | `disabledDetectors` | Yes (gitleaks model) |
| Dry-run / report mode | Default mode | Unclear | N/A (lib) | Yes (browser preview) | No | Yes |
| Hook integration (Claude Code / Cursor / Copilot) | No (pre-commit) | API-only | No (lib) | Browser plugin | Yes (Claude Code only) | **Yes — Claude Code hook + MCP** |
| MCP server | No | No | No | No | Yes | Yes |
| Telemetry / phone-home | No (open source) | Yes (cloud) | No (lib) | Yes (cloud) | No | **No — explicit non-goal** |
| Distribution model | Single binary / CLI | SaaS API | Python lib | Browser ext + agent | npm package / MCP | npm package + MCP |

## Sources

### High-confidence (Context7-equivalent / official docs)
- [Gitleaks rule system & allowlist docs](https://github.com/gitleaks/gitleaks)
- [Microsoft Presidio docs (anonymizer operators, reversibility)](https://github.com/microsoft/presidio)
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
- [TruffleHog detector & entropy methodology](https://github.com/trufflesecurity/trufflehog)
- [GitLab pipeline secret detection (TOML rule format / severity / report shape)](https://docs.gitlab.com/user/application_security/secret_detection/pipeline/configure/)

### Medium-confidence (vendor docs / community write-ups)
- [Lakera Guard product page (Cisco AI Defense)](https://www.lakera.ai/lakera-guard)
- [Lakera AI data leakage page](https://www.lakera.ai/risk/ai-data-leakage)
- [Nightfall AI ChatGPT/Copilot DLP](https://www.nightfall.ai/integrations/chatgpt-dlp-genai-dlp)
- [GitGuardian ggshield AI hook (the closest direct competitor pattern)](https://docs.gitguardian.com/ggshield-docs/integrations/ai-coding-tools/secret-scanning-for-ai-coding-tools)
- [GitGuardian product showcase: 3-stage hook integration](https://www.helpnetsecurity.com/2026/04/15/product-showcase-gitguardian-ggshield-ai-hook/)
- [redact-mcp (r3352) — Claude Code MCP redaction prior art](https://github.com/r3352/redact-mcp)
- [mcp-redact (nine710) — config-driven MCP redactor](https://glama.ai/mcp/servers/nine710/mcp-redact)
- [Microsoft PII Shield privacy-proxy pattern](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/introducing-pii-shield-a-privacy-proxy-for-every-llm-call/4514726)
- [PII Redaction for MCP Servers](https://mcpmanager.ai/blog/pii-redaction-for-mcp-servers/)
- [Claude Code hooks lifecycle guide (claudefa.st)](https://claudefa.st/blog/tools/hooks/hooks-guide)
- [Claude Code hooks mastery (disler)](https://github.com/disler/claude-code-hooks-mastery)

### Lower-confidence (general analysis pieces)
- [PRvL paper — quantifying LLM PII redaction capabilities](https://arxiv.org/html/2508.05545v1)
- [Reversible anonymization Python package](https://medium.com/@ainaomotayo/reversible-anonymizer-a-python-package-for-text-anonymization-1fa62fd586b1)
- [DLP false-positive feedback loops (Strac, Cyberhaven, Microsoft Purview)](https://www.strac.io/blog/reducing-dlp-false-positives)
- [Local-LLM-as-anonymizer (Llama 3.1 8B)](https://medium.com/@scmstorz/using-a-small-local-llm-llama-3-1-1d13223b2bbe)
- [Anonymizer SLM series (HuggingFace)](https://huggingface.co/blog/pratyushrt/anonymizerslm)
- [LLM gateway PII redaction (Gravitee)](https://www.gravitee.io/blog/how-to-prevent-pii-leaks-in-ai-systems-automated-data-redaction-for-llm-prompt)

---
*Feature research for: in-session redactor / DLP for Claude Code (mrclean)*
*Researched: 2026-05-13*
