# Requirements: mrclean

> v1 = first shippable npm release of mrclean. Validated through real Claude Code sessions on the maintainer's own repos before public publish.

## v1 Requirements

### Installer & Distribution

- [ ] **INST-01**: Operator can run `npx mrclean install` and have a working hook + MCP wiring written into `~/.claude/settings.json` with no further configuration
- [ ] **INST-02**: Installer is idempotent — re-running `install` does not duplicate hook entries or corrupt existing user settings; uses marker comments to identify mrclean-owned blocks
- [ ] **INST-03**: Installer creates an automatic timestamped backup of `~/.claude/settings.json` before any write
- [ ] **INST-04**: Installer resolves the absolute path to the mrclean bin at install time so PATH changes never silently disable the hook (Pitfall #7)
- [ ] **INST-05**: Operator can run `npx mrclean uninstall` to remove every mrclean-tagged entry cleanly and restore the most recent backup on demand
- [ ] **INST-06**: Operator can run `npx mrclean doctor` to verify hook wiring with a seeded canary string and get a green/red report including Claude Code version compatibility
- [ ] **INST-07**: Project-local `.mrclean/` directory is created on first run with a `.gitignore` entry for itself, the audit log, and any session/manifest artifacts
- [ ] **INST-08**: Package ships as a single npm package with both bin entrypoints declared in `package.json#bin` (`mrclean` for hook+CLI, `mrclean-mcp` for the long-lived MCP server) and runs on Node ≥ 20.18.0

### Detection Engine — Layer 1 (Regex Rules)

- [ ] **DET1-01**: Layer 1 ships with the `@secretlint/secretlint-rule-preset-recommend` rule set bundled and runs purely in-process (no shell-out to gitleaks/trufflehog binaries)
- [ ] **DET1-02**: Layer 1 also ships with the upstream `gitleaks/config/gitleaks.toml` rule pack vendored at build time, parsed with `smol-toml`, and executed in-process so the long-tail (~200 patterns) is covered without a Go runtime
- [ ] **DET1-03**: Each Layer 1 detection emits a normalized finding `{ ruleId, severity, span, value, redactedHash, fingerprint }` shared with all other layers
- [ ] **DET1-04**: Regex execution uses an engine resistant to ReDoS (e.g., `re2` Node bindings or per-pattern timeout) so adversarial inputs cannot hang the hook

### Detection Engine — Layer 2 (Entropy)

- [ ] **DET2-01**: Layer 2 implements Shannon entropy detection with tunable threshold (default 4.5 bits/char) and minimum length (default 20 chars) declared in config
- [ ] **DET2-02**: Layer 2 runs a built-in shape allowlist *before* entropy fires, suppressing UUIDs, git SHAs (40-char hex), npm/Cargo integrity hashes, base64 image-data headers, and standard hash digests (MD5/SHA*) so common high-entropy non-secrets never trigger
- [ ] **DET2-03**: Entropy hits never block on their own — they require a co-located context keyword (`secret`, `key`, `token`, `password`, `bearer`, etc.) OR explicit length+charset escalation, to suppress the false-positive avalanche pitfall

### Detection Engine — Layer 3 (.env Value Extraction)

- [ ] **DET3-01**: On `SessionStart`, mrclean parses `.env`, `.env.local`, `.env.*` (excluding `.env.example`/`.env.sample`) using `dotenv.parse` (parser only — never loads values into the running process) and adds those values to a session-scoped exact-match blocklist
- [ ] **DET3-02**: Layer 3 also accepts an explicit `secrets_files` list in `.mrclean/config.toml` for non-`.env` source-of-truth files
- [ ] **DET3-03**: Values shorter than 8 characters or matching the shape allowlist (DET2-02) are skipped to avoid blocking on `true`/`false`/single-digit env values

### Detection Engine — Layer 4 (User Dirty-Word File)

- [ ] **DET4-01**: mrclean reads `.mrclean/words.txt` (one entry per line; `#` comments; blank lines ignored) and adds entries as case-insensitive exact-match patterns to the detector
- [ ] **DET4-02**: Operator can scope a dirty word to a single rule action (block / warn / audit) via `word|action` syntax in `words.txt`
- [ ] **DET4-03**: Loading `words.txt` is hot-reloaded at `SessionStart` so edits take effect on the next session without restart

### Placeholder Substitution

- [ ] **PH-01**: Detected spans are replaced with placeholders matching the format `<MRCLEAN:TYPE:NNN>` where `TYPE` is the rule category (e.g., `AWS_KEY`, `JWT`, `ENV`, `WORD`, `ENTROPY`) and `NNN` is a 3-digit zero-padded session-local index
- [ ] **PH-02**: Same secret value within a single session always maps to the same placeholder, so diffs and code references stay consistent across multiple tool calls
- [ ] **PH-03**: Placeholder allocation is collision-free across rule types within a session — the manager refuses to emit a placeholder that already exists in the active session map
- [ ] **PH-04**: Placeholders are namespace-prefixed (`MRCLEAN:`) and use angle brackets so they survive JSON-string, Markdown, code-fence, and unified-diff contexts without further escaping

### Hook Integration (One-Way Mode)

- [ ] **HOOK-01**: mrclean registers handlers for the four Claude Code hook events it depends on: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`
- [ ] **HOOK-02**: `UserPromptSubmit`: when a CRITICAL/HIGH detection fires the hook returns `permissionDecision: "deny"` with `permissionDecisionReason` naming the rule and a redacted snippet so the operator can rewrite the prompt themselves (Claude Code's hook contract does not yet allow silent prompt rewrite)
- [ ] **HOOK-03**: `PreToolUse`: when a tool argument contains a detection, the hook emits `hookSpecificOutput.updatedInput` with the placeholder-substituted version so the tool runs on sanitized input
- [ ] **HOOK-04**: `PostToolUse`: tool results are scanned and any newly discovered secrets are added to the session map and substituted in the output that re-enters the model context (one-way; reversible-mode restoration is REVMODE phase)
- [ ] **HOOK-05**: Hook fails closed — any uncaught exception or invalid input causes exit code 2 with a structured stderr message rather than passing the unsanitized payload through
- [ ] **HOOK-06**: Hook writes nothing to stdout except the JSON response object; all diagnostics, banners, and errors go to stderr to avoid corrupting the Claude Code response stream
- [ ] **HOOK-07**: A "mrclean active vN.N.N (rules: NNN, allowlist: NN)" banner is emitted to stderr on `SessionStart` so silent-misconfig regressions are visible to the operator

### MCP Server

- [ ] **MCP-01**: `mrclean-mcp` runs as a long-lived stdio MCP server using `@modelcontextprotocol/sdk` v1, with Streamable HTTP transport opt-in via `--transport http`
- [ ] **MCP-02**: MCP server exposes exactly three tools — `mrclean_check` (scan input, return findings, no side effects), `mrclean_redact` (return placeholder-substituted text + metadata), `mrclean_status` (return version, rule counts, active session id)
- [ ] **MCP-03**: MCP server deliberately does NOT expose any `unredact`, `disable`, `add_word`, or `config_write` tool — model-facing surface is read/transform only, to defeat prompt-injection bypass (Pitfall #10)
- [ ] **MCP-04**: MCP server tool inputs and outputs are validated with Zod v4 schemas and crashes are isolated by a supervisor that restarts a worker process rather than killing the session

### Configuration

- [ ] **CFG-01**: mrclean reads `.mrclean/config.toml` for project-local overrides; missing file is fine and means defaults
- [ ] **CFG-02**: Config schema supports per-rule action override (`block` / `warn` / `audit`), severity tier (`CRITICAL` / `HIGH` / `MEDIUM` / `LOW`), and a multi-axis allowlist with five fields: `rules` (rule-id list), `paths` (glob list), `stopwords` (literal-string list), `regexes` (pattern list), `fingerprints` (per-finding hash list)
- [ ] **CFG-03**: Config layering precedence is bundled defaults < user-global (`~/.mrclean/config.toml`) < project-local (`.mrclean/config.toml`) — later layers override earlier ones field-by-field
- [ ] **CFG-04**: Operator can run `mrclean ignore <fingerprint>` to append a fingerprint to the project-local allowlist for false-positive feedback

### Audit Log

- [ ] **AUDIT-01**: Every detection writes one JSONL record to `.mrclean/audit.jsonl` containing `{ ts, sessionId, hookEvent, ruleId, severity, action, redactedHash, fingerprint, location }`
- [ ] **AUDIT-02**: Audit log NEVER contains the raw secret value — only the truncated SHA-256 hash; a CI canary-leak test asserts no test fixture secret string appears in any audit log entry
- [ ] **AUDIT-03**: Audit log is append-only; no rotation in v1, but file is in `.gitignore` from install (INST-07)

### Performance & Hardening

- [ ] **PERF-01**: Hook adds ≤ 100 ms (p95) to a typical `UserPromptSubmit` (4 KB prompt) and ≤ 200 ms (p95) to a typical `PostToolUse` (50 KB tool result) on the maintainer's reference machine
- [ ] **PERF-02**: A vitest perf suite with assertion gates runs in CI and fails the build on regression; benchmarks publish per-commit so latency creep is visible
- [ ] **PERF-03**: Regex patterns are compiled once at startup (or first-use cache), never per-invocation, and Layer 1 detection uses ReDoS-safe execution (DET1-04)

### Modes & Trust-Building

- [ ] **MODE-01**: `--dry-run` (or config `dry_run = true`) flips every rule's action to `audit` so detections are recorded without ever blocking — first-run safety net
- [ ] **MODE-02**: One-way redaction is the default action for all rules in v1; reversible-mode restoration is OUT OF SCOPE for v1 (deferred to v1.x — REVMODE phase)

### Documentation & Release

- [ ] **DOC-01**: README explains the layering relationship to gitleaks ("gitleaks for what reaches your repo, mrclean for what reaches the model") to prevent overlap confusion (Pitfall #12)
- [ ] **DOC-02**: A `THREAT_MODEL.md` documents what mrclean does NOT defend against (multimodal images, model memorization, prompt-injection of the operator, etc.) so users have correct expectations
- [ ] **DOC-03**: CHANGELOG is generated via `changesets` and the package publishes to npm as `mrclean` under MIT license

### Quality Gates

- [ ] **QA-01**: Vitest unit suite covers Layers 1–4 detection, placeholder allocation, allowlist evaluation, config layering, and the gitleaks-TOML→internal-format conversion with ≥ 80 % line coverage on `src/`
- [ ] **QA-02**: Integration tests simulate Claude Code hook invocation (stdin JSON in, stdout JSON out, expected exit code) for every hook event in HOOK-01
- [ ] **QA-03**: A "fixture corpus" — committed under `tests/fixtures/` — contains positive cases (real-shape AWS keys, GH tokens, JWTs, .env values, dirty words, base64-encoded variants) and negative cases (UUIDs, git SHAs, hashes, integrity hashes, Lorem ipsum) and the test suite enforces 100 % positive recall + 0 false positives on the negative corpus

## v2 Requirements (Deferred)

> Validated through v1 use, then prioritized for v2 based on real friction.

- **REVMODE-01**: Reversible mode — PostToolUse handler restores placeholders to original values on inbound tool results so paths/names round-trip cleanly back into the model context (requires Claude Code ≥ v2.1.121)
- **REVMODE-02**: Session State Adapter (`src/state/`) persists the placeholder→original map at `~/.claude/mrclean/sessions/<session_id>.json` under `flock` with atomic rewrite + janitor cleanup on `SessionEnd`
- **REVMODE-03**: Published `THREAT_MODEL.md` covers reversible-mode blast radius and operator opt-in flow
- **LLM5-01**: Layer 5 LLM classifier opt-in via `--deep` flag, lazy-imports `@anthropic-ai/sdk`, calls `claude-haiku-4-5` for semantic PII / proprietary-content detection
- **POLISH-01**: `mrclean report` summarizes session-level detection counts, top rules, false-positive feedback queue
- **POLISH-02**: Cross-session deterministic placeholder naming (HMAC over org-secret → no stored map needed for stability across sessions)
- **POLISH-03**: Encrypted at-rest persistence of reversible map via OS keychain (macOS Keychain / Linux libsecret / Windows Credential Manager) for crash recovery
- **PERF-04**: Sidecar daemon architecture if profiling shows file-backed session state cannot meet the perf budget on slow disks

## Out of Scope

- **Standalone batch CLI that scans a directory and writes sanitized copies** — superseded by in-memory interception per PROJECT.md decision; gitleaks/trufflehog already cover pre-paste batch scanning
- **Pre-commit / git-hook integration** — gitleaks owns this surface; mrclean is the in-session complement, not a replacement (Pitfall #12)
- **Local HTTP/HTTPS proxy intercepting Anthropic API traffic** — too invasive; hook + MCP cover the Claude Code surface deterministically
- **Cross-session placeholder map persistence** — explicit PROJECT.md ban; map is session-scoped to limit blast radius (Pitfall #4)
- **Telemetry, phone-home, hashed-usage analytics** — privacy product brand cannot survive a single regression here; local-only feedback loop only
- **Model-facing `unredact()` MCP tool** — one prompt injection away from total bypass; restoration runs deterministically in PostToolUse instead (MCP-03)
- **Auto-rotate detected secrets via cloud APIs** — out of scope; mrclean detects, operator (or external automation) rotates
- **Verified-secret enrichment (call AWS/GitHub APIs to confirm liveness)** — at odds with local-first principle; defer indefinitely
- **Multimodal / pasted-image OCR scanning** — explicit v1 limitation in `THREAT_MODEL.md`; OCR is its own product
- **Other AI-tool integrations (Cursor, Copilot, ChatGPT desktop)** — validate Claude Code thesis first; integrations are 1-week each but split focus
- **Team policy server with central rule distribution** — single-developer workflow first per PROJECT.md; team mode deferred until v1 demand is real

## Traceability

> Filled by ROADMAP.md after roadmapper run.
