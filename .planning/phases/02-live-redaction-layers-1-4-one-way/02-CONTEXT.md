# Phase 2: Live Redaction (Layers 1-4 + One-Way) — Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Source:** Locked from REQUIREMENTS.md + ROADMAP.md success criteria; gray-area defaults selected by Claude under autonomous mode (user can override).

<domain>
## Phase Boundary

Deliver the value slice: an operator pastes a real secret (AWS key, GitHub token, JWT, Stripe key) or a `.env`-derived value into a Claude Code prompt or tool argument and mrclean catches it in-session.

Ships together in one phase:
- Layer 1 — Secretlint preset + vendored gitleaks rule pack (in-process, no shell-out)
- Layer 2 — Shannon entropy with shape allowlist + context-keyword requirement
- Layer 3 — `.env*` value extraction at `SessionStart` (parser-only; never loads into process env)
- Layer 4 — `.mrclean/words.txt` user dirty-word list with per-line action override
- Placeholder manager — `<MRCLEAN:TYPE:NNN>`, session-scoped, stable-per-value, collision-free
- Hook integration (one-way): `UserPromptSubmit` deny + reason, `PreToolUse` `updatedInput`, `PostToolUse` output rewrite
- Audit log — append-only JSONL with `redactedHash` + `fingerprint` only (never raw secret)
- `dry_run` mode — config-flipped audit-only safety net for trust-building

NOT in this phase: MCP tool surface (`mrclean_check` / `mrclean_redact` / `mrclean_status` — Phase 3 per traceability), reversible mode (deferred to v2 REVMODE), Layer 5 LLM classifier (deferred LLM5), perf gate vitest harness (Phase 3).

</domain>

<decisions>
## Implementation Decisions

All decisions trace to REQUIREMENTS.md REQ-IDs unless marked **[discretion]**.

### Layer 1 — Regex Rules (DET1-01..04)

- **Engine:** `@secretlint/core` + `@secretlint/node` + `@secretlint/secretlint-rule-preset-recommend` as the in-process driver. Programmatic API only — never `npx secretlint` shell-out.
- **gitleaks pack:** Vendor `gitleaks/config/gitleaks.toml` at build time into `vendor/gitleaks-rules.toml`. Parse with `smol-toml` at startup. Run regexes through a TS adapter that re-uses the same normalized finding shape as secretlint.
- **Finding shape (shared with Layers 2-4):** `{ ruleId: string, severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW', span: { start: number, end: number }, value: string, redactedHash: string, fingerprint: string }`.
- **ReDoS protection:** Per-pattern execution timeout (default 50ms) — abort and skip the rule on overrun, log the offending rule-id once per session. **[discretion]** Per-pattern timeout chosen over `re2` because the vendored gitleaks pack uses lookarounds that `re2` does not support; pattern-timeout works across the full rule set.
- **Compilation:** Compile every regex once at startup into a frozen module-scope cache (PERF-03 prep, even though PERF gate lands Phase 3).
- **Dedup secretlint/gitleaks overlap:** **[discretion]** Run secretlint first; if a span is covered, suppress overlapping gitleaks matches by `(span.start, span.end)` interval intersection. Same-span same-type duplicates are collapsed to a single finding.

### Layer 2 — Entropy (DET2-01..03)

- **Algorithm:** Inline ~10-line Shannon bits-per-char (no external pkg per CLAUDE.md).
- **Defaults:** threshold = `4.5` bits/char, min length = `20` chars. Both tunable via `[entropy]` config block (CFG-02 surface).
- **Shape allowlist (runs BEFORE entropy fires):** UUID v4, 40-char git SHA, 64-char content hashes (sha256), npm/Cargo integrity hashes (`sha512-…`), base64 image-data headers (`data:image/`), standard MD5/SHA1/SHA256 digests.
- **Co-located context-keyword requirement:** Entropy match only fires if a keyword (`secret|key|token|password|bearer|api_key|access_token|client_secret|private_key|auth`) appears within ±40 chars OR length≥40 with charset entropy ≥5.0 (escalation path for raw blobs).

### Layer 3 — .env Value Extraction (DET3-01..03)

- **Trigger:** `SessionStart` event scans the project root for `.env`, `.env.local`, `.env.*`. Exclusions: `.env.example`, `.env.sample`, `.env.template` (regardless of extra suffix).
- **Parser:** `dotenv.parse(buffer)` — value extraction only, never `dotenv.config()`. Values land in an in-memory session-scoped blocklist (exact-match string).
- **Skip rules:** value length <8 chars OR value matches the Layer-2 shape allowlist OR value is one of `true|false|1|0|yes|no|on|off` (case-insensitive).
- **Additional sources:** `[secrets_files]` config array accepts non-`.env` files (any KV-shaped format the dotenv parser accepts).
- **No file watching during session:** scan runs once at `SessionStart`. Re-source by restarting the session — explicit choice for predictability (matches DET4-03 pattern).

### Layer 4 — User Dirty-Word File (DET4-01..03)

- **File:** `.mrclean/words.txt` at project root (cwd at install time). User-global `~/.mrclean/words.txt` is supported with the same precedence rule as config: user-global merged BEFORE project-local. **[discretion]** Mirrors config layering for predictability.
- **Syntax:** one entry per line. `#` starts a comment (full line or trailing). Blank lines ignored.
- **Action override:** `word|action` where `action ∈ {block, warn, audit}`. Default action when omitted is `block`. **[discretion]** "Block" matches the operator's intent when they add something to a dirty-word list ("I want this hidden, not just logged").
- **Match semantics:** case-insensitive exact-match (whole-word boundary, not substring). **[discretion]** Whole-word reduces false positives on common substrings; substring opt-in can land later via `regex:` prefix if real-world friction demands it.
- **Hot-reload:** re-read on `SessionStart` only — same predictability rule as Layer 3.

### Placeholder Manager (PH-01..04)

- **Format:** `<MRCLEAN:TYPE:NNN>` exactly as specified.
- **TYPE values:** `AWS_KEY`, `AWS_SECRET`, `GH_TOKEN`, `JWT`, `STRIPE_KEY`, `OPENAI_KEY`, `ANTHROPIC_KEY`, `PRIVATE_KEY`, `SLACK_TOKEN`, `GCP_KEY`, `DATABRICKS_KEY`, `AZURE_KEY`, `CF_KEY`, `ENV`, `WORD`, `ENTROPY`. **[discretion]** Initial TYPE vocabulary is the union of the secretlint preset categories + the three internal layers (`ENV`, `WORD`, `ENTROPY`). New TYPEs may be added as the gitleaks rules expose them; the rule-id→TYPE map lives in `src/detect/type-map.ts`.
- **Counter (`NNN`):** **GLOBAL per session**, not per-TYPE. Reasons: PH-01 says "session-local index" (singular); PH-03 enforces collision-free across TYPEs trivially when the counter is global; the operator's mental model is "the 3rd thing redacted this session", not "the 3rd AWS key". Starts at `001`, max `999` per session (panic if exceeded — log and fall back to `<MRCLEAN:TYPE:OVF>` with a structured stderr warning).
- **Stability within session:** SHA-256 of the raw value → placeholder lookup. Same value → same placeholder always. Across sessions: no stability (REVMODE-deferred).
- **Storage:** `Map<sha256hex, { type, index, firstSeenTs }>` plus reverse `Map<placeholder, sha256hex>` for collision detection. In-memory only. Never persisted in Phase 2 (REVMODE owns persistence).
- **Bracket choice:** angle brackets `< >` survive JSON, Markdown, code-fence, unified-diff contexts. NEVER use `{ }` or `[ ]` — collides with JSON/Markdown.

### Hook Integration — One-Way (HOOK-02..04)

> **NOTE (corrected per RESEARCH §9.1):** Field names below were corrected after RESEARCH verified the live Claude Code hook contract. UserPromptSubmit uses **top-level** `decision: "block"` + `reason`, NOT `permissionDecision`/`permissionDecisionReason`. The `permissionDecision` / `permissionDecisionReason` shape is correct ONLY for PreToolUse (under `hookSpecificOutput`). Earlier wording of this section used the PreToolUse field names by mistake — fixed here so this CONTEXT file matches RESEARCH §9 and ROADMAP success criterion #1. The original incorrect wording was: `permissionDecision: "deny"` / `permissionDecisionReason: "[mrclean] ..."`.

- **UserPromptSubmit:** if any finding has severity `CRITICAL` or `HIGH`, return top-level `decision: "block"` with `reason: "[mrclean] <ruleId> (<severity>): <redacted snippet>"`. Operator rewrites the prompt themselves — Claude Code's `UserPromptSubmit` hook does not yet support silent prompt rewrite. `MEDIUM`/`LOW` findings on UserPromptSubmit fall through to substitute via `additionalContext` only.
- **PreToolUse:** any detection severity → emit `hookSpecificOutput.updatedInput` with the placeholder-substituted version (`permissionDecision: "allow"` + `permissionDecisionReason` carries the substitution note). Tool runs against sanitized input. No deny path for tool calls; redaction is enough.
- **PostToolUse:** scan tool result; newly-discovered secrets get added to the session placeholder map AND substituted in the output that re-enters the model context. One-way — no restoration on the way back. Reversible mode is REVMODE-deferred.
- **Cold-path bail-out:** if any single rule's pattern-timeout fires more than 5× in a single hook invocation, abort detection for that call. On UserPromptSubmit, emit top-level `decision: "block"` with `reason: "[mrclean] detection budget exhausted — investigate"`. On PreToolUse, emit `hookSpecificOutput.permissionDecision: "deny"` with `permissionDecisionReason: "[mrclean] detection budget exhausted — tool call blocked for safety"`. **[discretion]** Fail-closed under regex pathology rather than risk leaking by skipping detection.

### Audit Log (AUDIT-01..02)

- **File:** `.mrclean/audit.jsonl` (single file, append-only, gitignored per INST-07 from Phase 1).
- **Record schema:** `{ ts: ISO8601, sessionId: uuid, hookEvent: 'SessionStart'|'UserPromptSubmit'|'PreToolUse'|'PostToolUse', ruleId: string, severity, action: 'block'|'substitute'|'audit', redactedHash: string (first 16 hex chars of SHA-256), fingerprint: string (rule-id + redactedHash composite), location: { hookEvent, offset, length } }`.
- **NEVER in the log:** raw secret value, env-var name (for Layer 3 — env-var NAMES can be informative for an attacker), full file paths from PostToolUse outside the project root.
- **Append semantics:** `fs.appendFile` with `flag: 'a'`. No rotation in v1. Filesystem-level lock is unnecessary because there's at most one mrclean hook process per Claude Code session at a time.
- **CI canary-leak test:** Every fixture secret string from the test corpus is grep'd against every audit record — must return zero hits. Wires into QA-03 in Phase 3 but the assertion already lives in Phase 2 tests.

### Modes — `dry_run` (MODE-01, MODE-02)

- **Default:** `dry_run = false` (active redaction enabled out of the box). Rationale: "trust-building first-run mode" per ROADMAP success criterion #6 is opt-in — the operator FLIPS dry_run to `true` if they want audit-only, then flips it back. If we shipped dry_run = true by default, success criterion #1 ("paste AWS key → blocked") would fail on first install.
- **Activation:** `[mode] dry_run = true` in `.mrclean/config.toml` OR `--dry-run` CLI flag on `mrclean serve` (MCP path). Hook path inherits dry_run from config (no CLI flag — Claude Code spawns the hook bin with no extra args).
- **dry_run effect:** every rule's effective action becomes `audit`. Findings still flow into the audit log; placeholders are still computed (for log accuracy) but NOT substituted into hook outputs; UserPromptSubmit returns no `decision` field (allow path) regardless of severity.
- **No reversible mode:** one-way only for v1 per MODE-02.

### Configuration (CFG-02, CFG-04)

- **Schema extension to Phase 1's `MrcleanConfig`:**
  ```toml
  dry_run = false
  [entropy]
  threshold = 4.5
  min_length = 20
  [secrets_files]
  paths = []   # additional non-.env files for Layer 3
  [[rules]]
  id = "AWSAccessKeyID"
  action = "block"      # block | substitute | audit | off
  severity = "CRITICAL" # CRITICAL | HIGH | MEDIUM | LOW
  [allowlist]
  rules = []        # rule-id strings: skip these rules entirely
  paths = []        # glob list: skip detection on tool args / outputs matching these
  stopwords = []    # literal-string list: never flag these as findings
  regexes = []      # pattern list: regex match → suppress finding
  fingerprints = [] # per-finding hash list: precise FP suppression (CFG-04 target)
  ```
- **Precedence:** bundled defaults < `~/.mrclean/config.toml` < `<cwd>/.mrclean/config.toml`. Already wired by Phase 1's `loadEffectiveConfig`. Phase 2 extends the merger to handle arrays (concat for allowlist arrays; project wins for `[entropy]` scalar fields).
- **`mrclean ignore <fingerprint>` (CFG-04):** appends the given fingerprint hash to `[allowlist].fingerprints` in `<cwd>/.mrclean/config.toml`. Creates the file with the right shape if missing. Idempotent (no-op if fingerprint already present). Prints the modified file path + the appended line for transparency.

### Banner Upgrade (HOOK-07 — full format)

Phase 1 shipped the short form `mrclean active v0.1.0 (no-op mode — detection not yet enabled)`. Phase 2 upgrades to the REQUIREMENTS.md-specified format:

```
mrclean active v0.2.0 (rules: 187, allowlist: 12, mode: active)
```

Rule count is computed at startup (secretlint preset + parsed gitleaks TOML). Allowlist count is sum of all `[allowlist]` array lengths. Mode is `active`, `dry-run`, or `off`. Emitted via `additionalContext` on both `SessionStart` and the first `UserPromptSubmit` of a session (RESEARCH-locked channel — banner via JSON, not stderr).

### Detection-Layer Ordering and Span Coverage **[discretion]**

Layers run in fixed order per input: **1 (regex) → 2 (entropy) → 3 (env) → 4 (words)**. Each layer is told the spans already covered by prior layers; it does NOT re-detect over those spans (saves work; deduplicates findings).

Reasons:
- Layer 1 is the most precise — known-shape secrets get the most specific TYPE.
- Layer 2 entropy is the broad net — runs last among auto-rules so the precise TYPEs land first.
- Layer 3 + 4 are user-specific — they own their input strings exactly, and operator surprise here is bad, so they have first call on substring matches they own (in practice they run on remaining uncovered spans after L1+L2).

### Performance Posture **[discretion]**

PERF-01..03 are formally Phase 3, but Phase 2 must not paint into a corner. So:
- Compile every regex once at startup (PERF-03 prep — already locked in DET1-04 + this CONTEXT).
- Keep top-level imports thin in the hook bin — lazy-load secretlint, smol-toml, dotenv inside the detection module so Phase-3 cold-start optimization stays achievable.
- Add a `--bench` flag stub on `mrclean doctor` that runs Layer 1+2 against a 4 KB fixture prompt — used by Phase 3's PERF gate. Phase 2 doesn't ASSERT a budget; just provides the harness.

### Out of Scope Reminders

- No new MCP tools — Phase 3 owns MCP-02 (the read/transform tool surface) and MCP-03 (the model-facing surface bans).
- No reversible mode / placeholder restoration — REVMODE phase, v2.
- No persistence of the session placeholder map — explicit PROJECT.md ban.
- No telemetry, no phone-home, no cross-session canonical placeholder naming.
- No file-watcher during session — Layer 3 and Layer 4 hot-reload at `SessionStart` only.

### Claude's Discretion

The following calls were made by Claude based on REQUIREMENTS.md context. Operator can override before execute-phase:

- Per-pattern regex timeout (50ms) instead of `re2` (gitleaks lookarounds incompatible).
- Placeholder counter is global per session (not per-TYPE).
- words.txt default action when no `|action` is `block`.
- words.txt match semantics: case-insensitive whole-word boundary (not substring).
- words.txt user-global file (`~/.mrclean/words.txt`) supported with same layering as config.
- Detection-budget bail-out: 5 pattern-timeouts in a single hook invocation → deny + structured reason.
- Detection-layer ordering: 1→2→3→4, spans-already-covered are skipped.
- Banner mode token: `active`/`dry-run`/`off`.
- `--bench` stub on doctor command — Phase 3 PERF harness prep.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before researching or planning.**

### Project / requirements
- `.planning/REQUIREMENTS.md` — REQ-IDs DET1-01..04, DET2-01..03, DET3-01..03, DET4-01..03, PH-01..04, HOOK-02/03/04, AUDIT-01/02, MODE-01/02, CFG-02/04 (canonical text of every requirement above)
- `.planning/ROADMAP.md` — Phase 2 success criteria (the 6 observable proofs the phase must demonstrate)
- `.planning/PROJECT.md` — pitfall list (#1 mixed config files; #4 placeholder map blast radius; #7 silent misconfig; #10 prompt-injection bypass of MCP tools; #12 gitleaks-vs-mrclean overlap)
- `CLAUDE.md` — locked tech stack pins: Node>=20.18, TS^5.6, `commander ^13.x`, `@modelcontextprotocol/sdk ^1.x`, `zod/v4`, `tsup`, `vitest ^4`. Also locks the secretlint/smol-toml/dotenv selections.

### Prior phase context (already-locked decisions to maintain consistency with)
- `.planning/phases/01-wired-skeleton/01-SKELETON.md` — Walking Skeleton architectural decisions (gitignore = full `.mrclean/`, banner via `additionalContext` not stderr, two-bin layout, SDK auto-negotiation)
- `.planning/phases/01-wired-skeleton/01-RESEARCH.md` — Hook JSON shape (§1), MCP config separation (§2), fail-closed exit semantics (§5), pitfall guards (§8)
- `.planning/phases/01-wired-skeleton/01-01-SUMMARY.md` — package + types interfaces (`HookInputBase`, etc.)
- `.planning/phases/01-wired-skeleton/01-02-SUMMARY.md` — settings.json / claude.json atomic edit module surface
- `.planning/phases/01-wired-skeleton/01-02b-SUMMARY.md` — `loadEffectiveConfig`, `MrcleanConfig` type (Phase 2 extends, never replaces)
- `.planning/phases/01-wired-skeleton/01-03-SUMMARY.md` — `runHook` orchestrator, dispatcher, per-event handler seams (Phase 2 fills the no-op detection bodies)
- `.planning/phases/01-wired-skeleton/01-04-SUMMARY.md` — MCP server + lifecycle module (Phase 2 leaves untouched — no new tools this phase)
- `.planning/phases/01-wired-skeleton/01-05-SUMMARY.md` — `computeDoctorReport`/`runDoctor` split (Phase 2 extends doctor with `--bench` stub)

### Upstream specs (for researcher to verify)
- Claude Code hooks reference: `https://code.claude.com/docs/en/hooks` — verify top-level `decision: "block"` + `reason` shape for UserPromptSubmit, `hookSpecificOutput.permissionDecision` + `permissionDecisionReason` shape for PreToolUse.
- Secretlint v13: `https://github.com/secretlint/secretlint` — `@secretlint/core` + `@secretlint/node` programmatic API.
- Gitleaks rule pack: `https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml` — TOML rule shape (`id`, `regex`, `keywords`, `entropy`, `allowlists`).
- MCP TypeScript SDK: not touched in Phase 2; canonical ref kept for continuity.

</canonical_refs>

<specifics>
## Specific Ideas

- **Detection module layout (researcher should validate):**
  - `src/detect/index.ts` — orchestrator, runs layers in order, accumulates findings with span dedup
  - `src/detect/layer1-regex/` — secretlint adapter + vendored gitleaks rules + TS engine + type-map
  - `src/detect/layer2-entropy.ts` — Shannon + shape allowlist + keyword requirement
  - `src/detect/layer3-env.ts` — dotenv parser invocation + skip rules
  - `src/detect/layer4-words.ts` — words.txt parser + match
  - `src/detect/findings.ts` — finding shape + hash + fingerprint helpers
  - `src/placeholder/manager.ts` — session map + counter + collision-detect
  - `src/audit/log.ts` — JSONL appender + redaction discipline
  - `src/hook/handlers/*.ts` — fill in the four event bodies with the detect+substitute pipeline
  - `vendor/gitleaks-rules.toml` — vendored pack, regenerated by a build script
  - `tests/fixtures/positive/` — real-shape AWS, GH, JWT, Stripe, OpenAI, Anthropic, .env values, words
  - `tests/fixtures/negative/` — UUIDs, git SHAs, content hashes, integrity hashes, Lorem ipsum

- **Test corpus:** Success criterion #4 requires 100% positive recall + 0 false positives on the negative corpus. Even though QA-03 is formally Phase 3, the fixtures land in Phase 2 — there's no way to prove success criterion #4 without them.

- **dry_run discoverability:** the stub `.mrclean/config.toml` Phase 1 ships should be amended in Phase 2 to include a clearly-commented `# dry_run = true` line so operators know the toggle exists.

</specifics>

<deferred>
## Deferred Ideas

- File-watcher during session for `.env*` / `words.txt` — deferred. SessionStart-only reload chosen for predictability.
- Substring (non-word-boundary) matching for words.txt — deferred. Whole-word default; revisit if real-world friction demands.
- Cross-session deterministic placeholder naming via HMAC — explicit POLISH-02 v2 item.
- Persistence of the session placeholder map — explicit PROJECT.md ban for v1.
- MCP tool surface (`mrclean_check`, `mrclean_redact`, `mrclean_status`) — Phase 3.
- PERF assertion gate (vitest harness with per-commit benchmarks) — Phase 3 (Phase 2 only ships the `--bench` stub).
- Verified-secret enrichment (call AWS/GitHub APIs to confirm liveness) — out of scope per REQUIREMENTS.md.
- LLM Layer 5 (Haiku semantic classifier) — opt-in deferred via LLM5-01.
- Telemetry / phone-home / hashed analytics — explicit privacy product ban.

</deferred>

---

*Phase: 02-live-redaction-layers-1-4-one-way*
*Context gathered: 2026-05-14 under autonomous mode — most decisions are locked by REQUIREMENTS.md; Claude-discretion choices marked **[discretion]** in the body.*
*Revised: 2026-05-14 — HOOK-02 field names corrected per RESEARCH §9.1 (top-level `decision`/`reason` for UserPromptSubmit, not `permissionDecision`/`permissionDecisionReason`).*
