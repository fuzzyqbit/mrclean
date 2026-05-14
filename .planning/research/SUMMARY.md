# Project Research Summary

**Project:** mrclean
**Domain:** In-session sanitizer / DLP for Claude Code (npm-distributed Node/TypeScript hook + MCP server)
**Researched:** 2026-05-13
**Confidence:** HIGH on stack/architecture/pitfalls; MEDIUM-HIGH on features (prior art on the exact "in-session redactor for AI coding agents" niche is < 12 months old).

## Executive Summary

mrclean is a **two-surface, single-core** product: a Claude Code hook adapter (spawned per event over stdin/stdout) and a long-lived MCP server, both wrapping the same in-process detection engine. Experts in this space (gitleaks, secretlint, Microsoft Presidio, ggshield, mcp-redact) consistently converge on the same architecture: a **layered detection pipeline** (regex → entropy → env-extract → user-words → optional LLM) feeding a **stable, collision-free placeholder substitution** layer, with hard separation between the always-on enforcement surface (hook) and the on-demand convenience surface (MCP). The differentiator vs. existing scanners (gitleaks, trufflehog) is **runtime in-memory interception** plus **reversible round-trip restoration** — gitleaks-style tools are pre-commit/CI scanners and never had to solve the placeholder-stability or restore problem.

The recommended approach is a **boring, file-backed, fail-closed** Node 20 + TypeScript 5.6 stack: `@modelcontextprotocol/sdk` v1, Zod v4, commander, secretlint preset-recommend (engine + rules) plus the vendored gitleaks TOML rule pack (rules only, no engine), `smol-toml`, `dotenv.parse`, picocolors, tsup, vitest 4. Reversible-mode session state lives in `~/.claude/mrclean/sessions/<session_id>.json` under `flock` — **not** an in-process daemon (defer that until profiling demands it). Layer 5 LLM classifier uses `@anthropic-ai/sdk` lazy-imported, claude-haiku-4-5, opt-in only.

Key risks cluster around five themes: **(1) false-positive avalanche** from naive entropy on UUIDs/git-SHAs (kills adoption in week one); **(2) false-negative bypass** from base64/URL/JSON-encoded payloads and chunk-boundary splits; **(3) silent misconfiguration** (Claude Code only treats exit code 2 as blocking; everything else passes through); **(4) the reversible map IS the secret** — any disk leak is catastrophic; and **(5) prompt-injection bypass** via reversible mode. Mitigations are well-understood: built-in shape allowlist before entropy ever fires, decode-then-scan recursive pipeline, fail-closed exit semantics + `npx mrclean doctor` canary, in-memory-only map by default with OS-keychain encryption as opt-in, and the architectural invariant that **no model-facing MCP tool returns map values**.

## Key Findings

### Recommended Stack

Single Node 20+ runtime, pure ESM, single npm package with two bins (or one bin sub-dispatched). Bundler: tsup. Tests: vitest 4 + V8 coverage. Detection engine reuses the secretlint engine and preset-recommend (programmatic via `@secretlint/node`) plus the vendored gitleaks TOML rule pack (parsed with `smol-toml`, regexes run by ~150 LOC of in-house TS). MCP via the official `@modelcontextprotocol/sdk` v1 with stdio (default) and Streamable HTTP transports. Layer 5 LLM is lazy-imported `@anthropic-ai/sdk` with `claude-haiku-4-5` (alias) for cost/perf.

**Core technologies:**
- **Node.js >=20.18.0** (LTS): runtime — required floor for MCP SDK and Vitest 4; Node 18 is EOL.
- **TypeScript ^5.6**: language — Zod v4 type instantiations and MCP SDK ergonomics work cleanly.
- **`@modelcontextprotocol/sdk` ^1**: MCP server + transports — official Anthropic SDK; pin to `^1` (v2 is pre-alpha).
- **Zod ^4 (via `zod/v4`)**: tool schema + hook payload validation — Standard-Schema-compatible.
- **`commander` ^13**: CLI for `mrclean install | uninstall | doctor | check | serve | audit`.
- **`@secretlint/core` + `@secretlint/node` + preset-recommend ^13**: Layer 1 engine + curated rules (AWS, GCP, GitHub, Slack, Stripe, OpenAI, Anthropic).
- **Vendored `gitleaks/config/gitleaks.toml`**: Layer 1 long-tail rules (~200 patterns); parsed with `smol-toml`, ran in-process — no Go binary shell-out.
- **`dotenv.parse` ^16**: Layer 3 `.env*` value extraction (parser only — never load into the running process).
- **`@anthropic-ai/sdk` ^0.95** (lazy-imported, opt-in): Layer 5 LLM classifier via `claude-haiku-4-5`.
- **tsup + vitest 4 + tsx + picocolors + fast-glob + changesets**: dev/build/test/distro toolchain.

**Avoid:** Jest (slow, painful ESM); `ts-node` (replaced by tsx); `@iarna/toml` (last release 2019); `chalk` (heavier than picocolors); Vercel `ai` SDK (overkill for one-shot Haiku call); shelling out to gitleaks/trufflehog/detect-secrets binaries (breaks single-`npx` UX); hand-rolling regexes (PROJECT.md decision).

### Expected Features

**Must have (table stakes):**
- Layer 1 regex (gitleaks rule pack, embedded — not binary shell-out)
- Layer 2 Shannon entropy with built-in allowlist (UUIDs, git SHAs, hashes, base64 image headers, npm/Cargo integrity hashes)
- Layer 3 `.env*` value extraction at session start (the differentiator vs. generic scanners)
- Layer 4 user dirty-word file (`.mrclean/words.txt`)
- Block-on-detect default with structured reason payload returned to the agent
- Stable, collision-free placeholder format `<MRCLEAN:TYPE:NNN>` (zero-padded, type-tagged, namespace-prefixed to survive JSON/Markdown/diff/code contexts)
- Per-rule action override (block / warn / audit) and severity tiers (CRITICAL / HIGH / MEDIUM / LOW)
- Multi-axis allowlist (per-rule + path glob + stopword + regex + per-finding fingerprint)
- Audit log at `.mrclean/audit.jsonl` (truncated SHA-256 hash only, never raw values)
- `npx mrclean install` zero-config installer (atomic, idempotent, backup-before-write, marker-tagged)
- Config file `.mrclean/config.toml` (TOML for paste-compatibility with gitleaks)
- MCP server with `mrclean_check`, `mrclean_redact`, `mrclean_status` (no `unredact`, no `disable`, no `config_write`)
- Performance self-monitoring against the <100ms / <200ms PROJECT.md budgets

**Should have (competitive):**
- Reversible mode (round-trip restoration on inbound PostToolUse) — the killer feature; requires Claude Code ≥ v2.1.121
- Hook + MCP dual integration (hook = always-on guard rail; MCP = explicit on-demand)
- Dry-run mode (every detection becomes `audit`, nothing is blocked) for trust-building first run
- Manifest log (`.mrclean/manifest.jsonl`) shadowing the placeholder map for debugging
- False-positive feedback CLI (`mrclean ignore <fingerprint>`) — local-only, no telemetry
- `npx mrclean doctor` health check with seeded canary (catches Pitfall #7 silent misconfig)
- Per-machine + per-project config layering (bundled defaults < user-global < project-local)
- TOML compat layer for gitleaks rules (goodwill / ecosystem)

**Defer (v2+):**
- Layer 5 LLM classifier (high cost, opt-in)
- Cross-session deterministic placeholder naming (hash-derived, no stored map)
- Encrypted disk persistence of reversible map (crash recovery only)
- Team policy server / rule sync — explicitly out of scope per PROJECT.md
- Other AI-tool integrations (Cursor, Copilot, ChatGPT) — validate Claude Code thesis first
- Verified-secret enrichment (call AWS/GitHub APIs to confirm liveness) — at odds with local-first principle

**Anti-features to refuse:** cross-session placeholder map persistence (PROJECT.md ban), telemetry/phone-home, model-facing `unredact()` MCP tool, one-click bypass UI, auto-rotate detected secrets, local HTTP proxy.

### Architecture Approach

mrclean is **two parallel surfaces sharing one pure core**: (a) a hook adapter (`bin/mrclean`) Claude Code spawns fresh per event over stdin/stdout, and (b) a long-lived MCP server (`bin/mrclean-mcp`) Claude calls as an explicit tool. The single hardest design question — *where does the placeholder map live across hook invocations?* — has a clean v1 answer: **per-session JSON file at `~/.claude/mrclean/sessions/<session_id>.json` under `flock`**, keyed off the `session_id` Claude Code injects into every hook payload. A sidecar daemon is **not** on the critical path.

**Major components:**
1. **Installer CLI (`mrclean install`)** — idempotent, marker-tagged JSON merge into `~/.claude/settings.json`; backup-before-write; resolves absolute path to the bin (avoids Pitfall #7 PATH issues); creates `.mrclean/` with `.gitignore` entry; registers MCP server.
2. **Hook Adapter (the bin)** — single Node entrypoint, reads JSON from stdin, routes by `hook_event_name`, writes JSON to stdout (only). All diagnostics to stderr. Top-level catch-all: fail-closed on crash (exit 2).
3. **Detection Engine (`core/detection/`)** — pure function `(text, config) → DetectedSpan[]`. Layers 1-4 always; layer 5 only when `--deep`. Decode-then-scan pipeline (recursive base64/URL/JSON-escape) before regex/entropy.
4. **Placeholder Manager (`core/placeholder/`)** — owns token format and stable allocation: same value within a session → same placeholder, derived from HMAC-SHA256 of value (not a sequence counter).
5. **Session State Adapter (`state/`)** — the **only** module that touches files for session state. Atomic write under `flock`; SessionStart janitor sweep; SessionEnd cleanup. Plaintext default; opt-in AES-GCM via OS keychain.
6. **Audit Logger (`core/audit/`)** — append-only JSONL at `.mrclean/audit.jsonl`. Schema records hash + metadata only — **never** raw value. Canary-leak test in CI.
7. **MCP Server (`mcp/`)** — long-lived, stdio default, Streamable HTTP opt-in. Three read/transform tools with Zod schemas; supervisor + worker-process isolation.
8. **Doctor CLI (`mrclean doctor`)** — verifies hook wiring with seeded canary, checks Claude Code version, enumerates configured hook events.

### Critical Pitfalls

1. **False-positive avalanche** (entropy fires on UUIDs/git-SHAs/hashes/base64-image-data) → user uninstalls within hours. **Avoid:** built-in shape allowlist *before* entropy runs; entropy never primary signal — always combined with context keyword OR length+charset constraint; fixture corpus gate.

2. **False-negative bypass via encoding/chunk boundaries** (base64, URL-encode, JSON-escape, chunk-split, multimodal images). **Avoid:** decode-then-scan recursive pipeline (cap depth 3); per-session sliding-window buffer; scan disk-spilled preview file; document image limitation; fixture corpus includes encoded variants.

3. **Performance death spiral** (cold Node start + re-compile regex per call → 400ms hook latency). **Avoid:** persistent MCP does heavy work; hook is thin client; compile regexes once; `re2` for adversarial-input safety; CI benchmark gate (p95 < 80ms / 4KB prompt, < 150ms / 50KB tool result); Layer 5 strictly opt-in/out-of-band.

4. **Reversible-mode map leak** (the map IS every secret in one file). **Avoid:** in-memory only by default; opt-in encrypted persistence uses OS keychain (mode 0600, never in `.mrclean/`, never in `/tmp`); atomic cleanup on `exit`/`SIGINT`/`SIGTERM`; `.gitignore` entry from installer; threat-model document required.

5. **Hook silent misconfiguration** (only exit 2 blocks; everything else passes through). **Avoid:** absolute path resolved at install time; fail-closed exit 2 on any error; SessionStart canary visible in stderr; `npx mrclean doctor`; install at user-scope `~/.claude/settings.json` (avoids subdirectory bypass).

Honorable mentions (full detail in PITFALLS.md): placeholder collision/instability (#4), audit log leaking secret values (#6), MCP server crash silently disabling (#8), gitleaks rule-pack drift (#9), prompt-injection bypass (#10), bypass via non-hooked surfaces / subagents (#11), pre-commit overlap with gitleaks (#12).

## Implications for Roadmap

### Phase 1: Foundation — Installer, MCP scaffold, project skeleton
**Rationale:** Validates Claude Code actually invokes the bin with expected exit-code semantics before any detection logic exists. Establishes persistent MCP-server architecture from day one (avoids "spawn child per hook" anti-pattern). Makes silent misconfiguration detectable.
**Delivers:** `npx mrclean install / uninstall / doctor` (idempotent, atomic, backup, marker-tagged); absolute-path resolution; `.gitignore`/`.gitleaksignore` snippets; MCP server scaffolding with `mrclean_status`; supervisor model + stderr-only logging; SessionStart "mrclean active" banner; project skeleton (tsup + vitest + ESM-only, two-bin package.json).
**Avoids:** Pitfalls #3, #7, #8, #11, #12.

### Phase 2: Detection Engine (Layers 1-4)
**Rationale:** Pure logic with no I/O — fully testable in isolation. Riskiest layer (Layer 1 regex coverage) built and reviewed first. Decode-then-scan + shape allowlist must ship with first entropy implementation, not retrofitted.
**Delivers:** `core/detection/` with all four non-LLM layers; `core/placeholder/` with HMAC-derived stable token allocation; severity tiers; multi-axis allowlist evaluator; decode-then-scan recursive pipeline; fixture corpus as test gate; `re2` regex engine with per-pattern timeout.
**Avoids:** Pitfalls #1, #2, #4, #9.

### Phase 3: Hook Integration (One-Way Mode)
**Rationale:** Connects the engine to Claude Code. Ships v0.1: catches secrets in prompts (block-with-reason, since `replaceUserMessage` doesn't exist) and tool calls (`updatedInput` for PreToolUse). PostToolUse observational only at this stage.
**Delivers:** All four event handlers; audit log with hash-only entries; sliding-window buffer for chunk seams; spill-file scanning; PreToolUse argument scanning; fail-closed exit semantics; structured reason payload to agent.
**Avoids:** Pitfalls #2, #6, #7, #11.

### Phase 4: MCP Tool Surface
**Rationale:** Independent surface; can ship in parallel after Phase 3. Reuses Core entirely. Tool surface deliberately minimal — invariant that **no model-facing tool returns map values**.
**Delivers:** `src/mcp/` with `mrclean_check`, `mrclean_redact`, `mrclean_status`; stdio (default) + Streamable HTTP (opt-in); session-bridge to share state with hook; supervisor + worker-process isolation.
**Avoids:** Pitfalls #10, #8.

### Phase 5: Reversible Mode + Session State
**Rationale:** Highest-value differentiator but highest risk. Deferred until one-way is burned in. Requires Claude Code ≥ v2.1.121 for `hookSpecificOutput.updatedToolOutput` on non-MCP tools. Threat-model document is the milestone exit gate.
**Delivers:** `src/state/` Session State Adapter (atomic write under `flock`); reversible-mode toggle; PostToolUse handler emits `updatedToolOutput`; `.mrclean/manifest.jsonl` shadow log; opt-in OS-keychain encryption (defer if v1 in-memory-only suffices); `mrclean show <session_id>`; published `THREAT_MODEL.md`.
**Avoids:** Pitfalls #5, #10.

### Phase 6: Hardening, CI, and Launch
**Rationale:** Cross-cutting quality gates. Benchmark gate prevents silent latency bloat. Auto-sync workflow institutionalizes Pitfall #9 prevention. Red-team / fuzz tests catch the long tail. Docs codify scope honesty.
**Delivers:** CI benchmark gate (vitest perf suite); canary-leak test in CI; weekly GitHub Action pulling latest gitleaks rule pack; fault-injection tests; red-team fixture suite; `THREAT_MODEL.md`, README with layering FAQ ("gitleaks for what reaches your repo, mrclean for what reaches the model"); CHANGELOG via changesets; npm publish.
**Avoids:** Pitfalls #1, #3, #6, #8, #9, #10, #12.

### Phase 7 (deferred — v1.x or v2): Layer 5 LLM Classifier + Polish
**Rationale:** Highest cost, lowest urgency, opt-in. Don't let it block earlier phases.
**Delivers:** Layer 5 with lazy-imported `@anthropic-ai/sdk` (`claude-haiku-4-5`); `mrclean report`; `mrclean ignore <fingerprint>`; per-machine + per-project config cascade; cross-session deterministic placeholder naming.

### Phase Ordering Rationale

- **Installer-first** (Phase 1 not Phase 2) is non-negotiable: a no-op echo hook validates wiring before any detection logic exists.
- **Detection before integration** (Phase 2 before Phase 3) lets the riskiest, most testable code live in pure-function isolation.
- **One-way before reversible** (Phase 3 before Phase 5) ships value early without paying map-leak risk; reversible requires CC ≥ v2.1.121 anyway.
- **MCP can ship in parallel** (Phase 4 alongside or after Phase 3) — independent surface.
- **Hardening last** (Phase 6) — CI benchmark gates most valuable once there's surface area to regress.
- **Layer 5 deferred** because Layers 1-4 cover ~95% of leak surface and cost/latency story is fundamentally different.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Detection):** `re2` Node bindings story; decode-then-scan recursion strategy; gitleaks-TOML→internal-format conversion; canonical 2026 shape-allowlist coverage.
- **Phase 5 (Reversible Mode):** confirm `updatedToolOutput` behavior on every Claude Code surface; OS-keychain integration story (macOS/Linux/Windows); explicit threat-model boundary under prompt injection.
- **Phase 7 (LLM Classifier):** Research at point of building, not now — model lineup will have shifted.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Installer + MCP scaffold):** Well-documented patterns; `disler/claude-code-hooks-mastery` is a working reference.
- **Phase 3 (Hook integration, one-way):** Pure composition of Phase 1 + Phase 2.
- **Phase 4 (MCP tools):** Three small read/transform tools.
- **Phase 6 (CI/hardening):** Standard tooling.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against official docs (Anthropic MCP SDK, Vitest 4, Anthropic SDK npm); MEDIUM only on the gitleaks-rule-reuse path (no first-class JS port — we vendor TOML and parse ourselves, ~150 LOC, well-scoped). |
| Features | MEDIUM-HIGH | HIGH on detection-engine prior art (gitleaks/Presidio/secretlint converge); MEDIUM on Claude-Code-specific hook UX because integration surface < 12 months old (open issues #34390, #46761, #53330). LOW only on closed-source competitors (Lakera, Nightfall). |
| Architecture | HIGH | Hook contract verified against Anthropic CHANGELOG (v2.1.121 for `updatedToolOutput`); MCP transports verified against current spec; file-backed state pattern validated against `disler/claude-code-hooks-mastery`. |
| Pitfalls | HIGH | Cross-verified against Claude Code hook reference, MCP debugging docs, gitleaks issue tracker (#1830, #575, #97), OWASP LLM Prompt Injection cheat sheet, multiple DLP-for-LLM analyses. |

**Overall confidence:** HIGH for v1 scope.

### Gaps to Address

- **MCP SDK package surface naming** (LOW): Confirm `@modelcontextprotocol/sdk` exports during Phase 1 install.
- **Claude Code prompt-rewrite contract** (MEDIUM): UserPromptSubmit cannot rewrite prompts as of v2.1.123. Action: Phase 3 ships block-with-reason; subscribe to feature requests; switch to silent rewrite if `replaceUserMessage` lands.
- **Reversible-mode encryption-at-rest cost** (MEDIUM): OS-keychain access varies across platforms. Action: Phase 5 ships in-memory-only; defer encrypted persistence to v1.x.
- **No first-class JS/Wasm port of gitleaks engine** (LOW): Monitor; if `gitleaks-wasm` appears, revisit.
- **Performance budget on slow disks** (LOW): Phase 6 benchmark gate measures real wall-clock; if a real user hits this, trigger to revisit sidecar daemon.
- **Subagent / multi-agent hook coverage** (MEDIUM): Phase 1 doctor enumerates configured events; Phase 6 adds subagent canary test.
