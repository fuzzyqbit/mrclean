<!-- GSD:project-start source:PROJECT.md -->
## Project

**mrclean**

mrclean is an in-session sanitizer that prevents sensitive data from leaking out of Claude Code sessions to remote services (Anthropic API, cloud agents, MCP endpoints). It hooks into Claude Code via a settings.json hook and an MCP server, intercepting prompts and tool payloads in memory, swapping detected secrets and project-specific terms with stable placeholders before they leave the machine, and optionally restoring placeholders on the return path so file paths, names, and identifiers round-trip cleanly back into the user's view.

**Core Value:** Real secrets and proprietary terms never reach the wire — the user keeps Claude Code productivity without trading away repo-level confidentiality.

### Constraints

- **Tech stack**: Node.js + TypeScript — required for clean integration with the official MCP TypeScript SDK and for shipping a single `npx`-runnable bin alongside Claude Code's existing Node ecosystem.
- **Performance**: Hook execution must add < 100 ms to a typical UserPromptSubmit and < 200 ms to a typical PostToolUse — slower than that and users will disable it. Layer 5 LLM pass is exempt because it is opt-in.
- **Security**: The placeholder→original map in reversible mode lives in memory only by default; if persisted to disk for crash recovery, it must be encrypted at rest and removed on session exit. Audit log must never contain raw secret values.
- **Compatibility**: Must work against current Claude Code hook contract (UserPromptSubmit, PreToolUse, PostToolUse) and MCP spec (stdio + Streamable HTTP transports). Track Claude Code release notes for hook contract changes.
- **Distribution**: Zero-config first run — `npx mrclean install` must wire everything with sensible defaults; users should not have to author a config file to get protection on day one.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Node.js** | `>=20.18.0` (LTS) | Runtime | Required floor for the official MCP TypeScript SDK and Vitest 4.x (`^20 || ^22 || >=24`). Claude Code itself ships on Node 20+, so users already have it. Node 18 is EOL'd as of April 2025; 20 is the conservative minimum. |
| **TypeScript** | `^5.6.0` | Language | Hard requirement from the constraints doc. 5.6 lines up cleanly with Zod v4 type instantiations and the MCP SDK's typed tool registration. Avoid 5.0–5.3: known issues with deep generic inference that hurt SDK ergonomics. |
| **`@modelcontextprotocol/sdk`** | `^1.x` (currently `1.29.x`, March 2026) | MCP server + client | Official Anthropic-maintained SDK. Exposes `McpServer`, `StdioServerTransport`, and Streamable HTTP transport — the two transports the constraints doc explicitly requires. v2 is pre-alpha — pin to `^1` for production. |
| **`@anthropic-ai/sdk`** | `^0.95.x` (Layer 5 only, opt-in) | Optional LLM classifier (`--deep`) | Official Anthropic TS SDK. Use the **Messages API** with `model: "claude-haiku-4-5"` (current alias) or `"claude-haiku-4-5-20251001"` (pinned) for cheap semantic PII classification at $1/$5 per 1M tokens. Don't pull in `ai` (Vercel AI SDK) for this — you don't need streaming UI primitives, and shipping the Vercel SDK as a dep balloons install size for a feature that's off by default. |
| **Zod** | `^4.4.x` (import via `zod/v4`) | Tool schema validation, hook payload validation | The MCP TypeScript SDK uses Zod schemas for `inputSchema` / `outputSchema` on tool registration (Standard Schema compatible). v4 is stable, ~14× faster string parsing than v3, and the SDK examples target `zod/v4`. Import explicitly from `zod/v4` to opt into the new core during the transitional period. |
| **`commander`** | `^13.x` | CLI argument parsing for the `mrclean` bin | ~35M weekly downloads, the de-facto Node CLI parser. v13 added first-class TypeScript inference. Subcommand model fits `mrclean install`, `mrclean check`, `mrclean serve`, `mrclean audit` cleanly. Lighter than yargs, more mature than citty. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **`@secretlint/core`** + **`@secretlint/node`** + **`@secretlint/secretlint-rule-preset-recommend`** | `^13.x` (May 2026) | Layer-1 secret detection (programmatic) | Pure-JS, programmatic API, MIT-licensed. Preset-recommend covers AWS, GCP, GitHub, GitLab, npm, private keys, Slack, Stripe, OpenAI, Anthropic, Databricks, Azure, Cloudflare. Use as the first detection layer instead of hand-rolling the regex pack. Programmatic invocation via `@secretlint/node` accepts in-memory text + a filename hint, which is exactly the shape we have at the hook. |
| **gitleaks `gitleaks.toml`** rule pack | track upstream `master` (regenerate from latest) | Layer-1 supplemental rules | The `Key Decisions` row in PROJECT.md commits to gitleaks rules. There is **no maintained JS port** of the gitleaks engine; the `betterleaks` and `gitleaks-rs` projects are not Node packages. Strategy: vendor the upstream `config/gitleaks.toml` (~200 rules, auto-generated, MIT) and run the regexes ourselves with a small TS engine. This is ~150 LOC and avoids a Go shell-out. |
| **`smol-toml`** | `^1.4.x` | Parse the vendored gitleaks TOML at startup | 2× faster than `@iarna/toml`, 4× faster than `@ltd/j-toml`, full TOML 1.1 spec compliance, actively maintained (`@iarna/toml`'s last release was 2019). |
| **`shannon-entropy`** | inline ~10-line implementation | Layer-2 entropy heuristic | The npm packages `shannon-entropy` (v0.0.3, abandoned) and `binary-shannon-entropy` are too thin to take a dep on. Inline a ~10-line bits-per-char Shannon function (matches the formula gitleaks itself uses). Constraint: < 100 ms hook latency means we cannot afford a hot-path require chain. |
| **`dotenv`** | `^16.x` | Layer-3 `.env*` value extraction | We are **not loading** env vars into the running process — we are reading the *values* and adding them to the in-memory blocklist. `dotenv.parse()` returns `{ key: value }` from a Buffer/string without side effects, which is exactly what we need. We do **not** need `@dotenvx/dotenvx` here — that adds AES-256 encryption + key management for *storing* secrets in-repo, which is orthogonal to mrclean's job and a 10× heavier dep. |
| **`fast-glob`** | `^3.3.x` | Discover `.env*` and `.mrclean/*` files at session start | Standard pick for fast cross-platform globbing in Node. Used by Vite, Vitest, ESLint. |
| **`picocolors`** | `^1.1.x` | Terminal coloring for CLI output and audit log review | 14× smaller than `chalk`, no deps, supports same API surface we need. |
| **`@anthropic-ai/sdk`** (already listed in core) | `^0.95.x` | Layer 5 only | Lazy-import inside the `--deep` code path so users not opted in never pay the install/startup cost. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| **`tsup`** | Bundler for the published npm package | esbuild under the hood, zero-config dual ESM+CJS+`.d.ts` output, ~6M weekly downloads, the standard for TS library publishing in 2026. Configure `bin: 'src/cli.ts'`, `format: ['esm']` (we can ship pure ESM since Node 20 mandate is set), `dts: true`, `clean: true`, `target: 'node20'`. Avoid `unbuild` (UnJS-coupled, mainly useful inside Nuxt) and avoid raw `esbuild` (no `.d.ts` generation). |
| **Vitest** | `^4.1.x` | Test runner (unit + integration). Native TS, ESM-first, 40% faster than v1.x in the 2026 release. Use `vitest --coverage` for the 80% gate. Avoid Jest: ESM story still painful, slower, and the TS toolchain is more involved. |
| **`@vitest/coverage-v8`** | `^4.1.x` | V8 coverage reporter | Fastest coverage backend, no Babel involvement. |
| **`tsx`** | `^4.x` | Direct `.ts` execution during dev (`tsx src/cli.ts install`) | Replaces `ts-node` for the dev loop. No transpile step needed. |
| **`@types/node`** | `^20.x` | Node typings | Pin to the Node version floor (20), not "latest" — avoids accidentally using APIs not present at the target. |
| **`prettier`** | `^3.x` | Formatter | Standard. Use `--single-quote --no-semi` or whatever the user prefers; not load-bearing. |
| **`eslint`** + **`@typescript-eslint`** | `^9.x` / `^8.x` | Linter | ESLint 9 flat config. Keep ruleset minimal: no-unused, no-shadow, prefer-const, the immutability lint set from the user's coding-style rules. |
| **`changesets`** | `^2.x` | Version + changelog management for npm publish | Simpler than `semantic-release` for a single-package repo. |
| **`tsx --watch`** for the MCP server | dev only | Hot-reload while iterating on the MCP server | |
## Installation
# Runtime / core
# Optional Layer 5 (lazy-imported in --deep code path; still declared as a regular dep)
# Layer 1 (Secretlint engine + recommended preset)
# Dev
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@modelcontextprotocol/sdk` v1 | MCP SDK v2 (pre-alpha) | Only after v2 hits stable in Q1–Q2 2026. v1 is the only safe choice today. |
| `tsup` | `tsdown` (Rolldown-based, 3–5× faster) | Once Rolldown stabilizes and the migration path matures. tsdown's API is tsup-compatible, so future migration is cheap. Don't adopt now — too young for a security tool's supply chain. |
| `commander` | `citty` (UnJS, modern API) | If we ever absorb a UnJS dep tree for other reasons. Today commander wins on stability + community. |
| `dotenv` | `@dotenvx/dotenvx` | If we ever add a feature that needs to *read encrypted* .env files in user projects. Today's job is just `parse()`, which dotenv does in 50 LOC. |
| Inline Shannon entropy | `shannon-entropy` npm pkg | Never — abandoned, 0.0.3, no maintenance signal. Inline. |
| `smol-toml` | `@iarna/toml` | If we hit a TOML 1.1 incompatibility (extremely unlikely with gitleaks' generated config). |
| Vitest | `node --test` (built-in) | If we want to drop *all* dev deps. The built-in runner has no watch UI, weak coverage story, and no snapshot testing — not worth it for a security tool we want to iterate on quickly. |
| `@anthropic-ai/sdk` direct | Vercel `ai` SDK + `@ai-sdk/anthropic` | If mrclean ever grows multi-provider classification. For Layer 5 (single-shot Haiku call), the official SDK is one fewer abstraction layer and one fewer transitive dep. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **gitleaks via Go binary shell-out** | Adds a Go binary install requirement, breaks the "single `npx` command" UX, and the binary scans files on disk — not in-memory text. | Vendor the gitleaks `config/gitleaks.toml` rule pack and run regexes in TS. |
| **trufflehog / detect-secrets shell-out** | Same problem: external binary install. trufflehog is Go, detect-secrets is Python (an `npm install -g detect-secrets` exists but it's a wrapper around `pip install`, which is a runtime dep landmine). | Secretlint preset-recommend covers the high-value patterns; gitleaks TOML covers the long tail. |
| **Jest** | Slow, Babel/CJS by default, painful ESM story, slower test runs hurt the TDD loop. | Vitest 4. |
| **`ts-node`** | Replaced by `tsx` for direct `.ts` execution — `tsx` is faster and ESM-correct out of the box. | `tsx`. |
| **`@iarna/toml`** | Last release 2019, 4× slower than `smol-toml`. | `smol-toml`. |
| **`shannon-entropy` npm pkg** | Abandoned at v0.0.3, no test coverage signal, would add a transitive dep for a 10-line function. | Inline Shannon function. |
| **`chalk`** | Heavier than needed; for a security tool we want minimal supply-chain surface. | `picocolors` (14× smaller, no deps). |
| **`@dotenvx/dotenvx` for value extraction** | Brings AES-256/Secp256k1 + key-management code we never use. Adds attack surface. | `dotenv.parse()` (5 KB). |
| **Vercel `ai` / `@ai-sdk/anthropic`** for Layer 5 | Designed for streaming UI; brings React-flavored types and a plugin ecosystem we don't need. | `@anthropic-ai/sdk` direct, lazy-imported. |
| **`zx` / `execa`** for hook installation | The `mrclean install` command edits a JSON file (`~/.claude/settings.json`) and writes a binary path. No subprocess orchestration needed. | Native `node:fs/promises` + `JSON.parse`/`stringify`. |
| **`yaml` / YAML config** | The Claude Code hook contract is JSON. Mixing config formats hurts UX. | JSON for `~/.claude/settings.json`, TOML only because gitleaks ships TOML. |
| **MCP SDK SSE-only transport** | SSE is being deprecated in the November 2025 MCP spec in favor of Streamable HTTP. | `StreamableHTTPServerTransport` from the SDK; keep stdio for the local hook case. |
| **Hand-rolling the regex pack from scratch** | PROJECT.md "Key Decisions" explicitly says don't. The gitleaks/secretlint communities maintain this surface; we add value at the hook integration layer, not the regex layer. | Adopt secretlint preset + gitleaks TOML. |
## Stack Patterns by Variant
- Bin entrypoint reads JSON from stdin (the hook payload), runs detection in-process, writes JSON to stdout.
- No transport — just `process.stdin` / `process.stdout`.
- Exit code `0` for normal pass-through (with `permissionDecision: "allow"` and possibly a rewritten `updatedInput`), exit code `2` for hard block, anything else for non-blocking warning.
- Cold-start matters: keep top-level imports thin, lazy-load `@anthropic-ai/sdk` and `@secretlint/*` only inside the `runDetection` path. Aim for < 100 ms cold start to meet the perf constraint.
- Use `McpServer` from `@modelcontextprotocol/sdk` with `StdioServerTransport` for the local case (Claude Code spawns it).
- Use `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/node` (sub-export under the same package family) for remote / cloud Claude Code surfaces.
- Register tools `sanitize`, `restore` (reversible mode only), `audit_query`, all with Zod `inputSchema`/`outputSchema` and `structuredContent` returns.
- Session ID generator should be `() => randomUUID()` (stateful) by default to support reversible-mode placeholder maps; expose a `--stateless` flag that sets `sessionIdGenerator: undefined` for ephemeral CI usage.
- Lazy-import `@anthropic-ai/sdk` inside the deep classifier module. Never at top level.
- Default model: `claude-haiku-4-5` (alias). For reproducibility in audit logs, log the resolved snapshot ID (`claude-haiku-4-5-20251001`).
- Input cap: < 4K tokens of suspect spans — never send the whole prompt. Cost stays around fractions of a cent per call at $1/$5 per 1M.
- Always set `max_tokens: 256` and a strict JSON-schema-shaped system prompt; we want a classification verdict, not prose.
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@modelcontextprotocol/sdk@^1.29` | `zod@^4` (via `zod/v4` import) | The SDK's tool-registration schemas now expect Standard-Schema-compatible validators; `zod/v4` is the canonical example in the docs. `zod@^3` still works but you lose the perf/type-instantiation wins. |
| `vitest@^4.1` | `vite@^8` (peer) | Vitest 4.1 reuses the host project's installed Vite instead of bundling its own. If we never install Vite directly, vitest will install one transitively — fine. |
| `tsup@^8` | `typescript@^5.0` | tsup uses esbuild for transpile and `tsc` (when present) for `.d.ts`. Pin `typescript` so the consumer's TS version doesn't leak into our `.d.ts`. |
| `@anthropic-ai/sdk@^0.95` | Node `>=20` | Uses `fetch`, `AbortSignal.timeout`, and other Node 18+ APIs. Stay on the Node 20 floor. |
| `@secretlint/*@^13` | Node `>=20` | v13 raised the Node floor and now respects `.gitignore` by default. |
| Node `20.x` | All above | Single floor across runtime + dev. Don't matrix-test against 18 (EOL) or 22+ (works, but spending CI minutes here is low-value until users complain). |
## Sources
### Primary / Official (HIGH confidence)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — verified hook event names, JSON in/out shapes, exit code semantics, settings.json registration locations, matcher syntax, `${CLAUDE_PROJECT_DIR}` placeholders.
- [`@modelcontextprotocol/sdk` repo (typescript-sdk)](https://github.com/modelcontextprotocol/typescript-sdk) — package name, `McpServer` class, transport classes, `registerTool()` API.
- [MCP SDK server.md docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) — verified Streamable HTTP transport setup, Zod v4 import path (`zod/v4`), `structuredContent` return shape.
- [`@anthropic-ai/sdk` on npm](https://www.npmjs.com/package/@anthropic-ai/sdk) — version 0.95.2 (current).
- [Anthropic Claude Haiku 4.5 announcement](https://www.anthropic.com/news/claude-haiku-4-5) — model name `claude-haiku-4-5`, snapshot `claude-haiku-4-5-20251001`, pricing $1/$5 per 1M.
- [Secretlint repo](https://github.com/secretlint/secretlint) and [`@secretlint/secretlint-rule-preset-recommend` on npm](https://www.npmjs.com/package/@secretlint/secretlint-rule-preset-recommend) — v13.0.0 (May 2026), preset rule list, programmatic API via `@secretlint/node`.
- [gitleaks `config/gitleaks.toml`](https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml) — rule format (`id`, `regex`, `keywords`, `entropy`, `allowlists`), ~200+ rules, MIT-licensed via the parent repo.
- [Vitest releases](https://github.com/vitest-dev/vitest/releases) — v4.1.6 current, Node `^20 || ^22 || >=24` floor.
- [Zod v4 release notes](https://zod.dev/v4) — stable, exported under `zod/v4` subpath, 14× faster string parsing.
- [`smol-toml` on npm](https://www.npmjs.com/package/smol-toml) — current performance benchmark vs `@iarna/toml` and `@ltd/j-toml`.
- [`@dotenvx/dotenvx` docs](https://dotenvx.com/) — confirmed scope (encryption + key management) is orthogonal to value-only parsing.
### Secondary / Comparative (MEDIUM confidence)
- [PkgPulse: tsup vs esbuild vs unbuild 2026](https://www.pkgpulse.com/guides/tsup-vs-tsdown-vs-unbuild-typescript-library-bundling-2026) — tsup as the 2026 default for TS libraries; tsdown noted as future migration target.
- [Commander vs yargs vs citty 2026 comparison](https://www.pkgpulse.com/blog/how-to-build-cli-nodejs-commander-yargs-oclif) — commander as the production-stable choice.
- [DEV Community: MCP in 2026](https://dev.to/x4nent/complete-guide-to-mcp-model-context-protocol-in-2026-architecture-implementation-and-4a11) — Streamable HTTP replacing SSE in the November 2025 spec.
### Open Questions / LOW confidence
- **`@modelcontextprotocol/server` vs `@modelcontextprotocol/sdk` package naming.** The SDK repo doc page mentioned `@modelcontextprotocol/server` and `@modelcontextprotocol/client` as imports; the npm package most projects depend on is published as `@modelcontextprotocol/sdk` and re-exports server/client. **Action:** during Phase 1, install both and confirm against the actual package's `exports` field — the surface may have shifted in v1.29. This does not change the recommendation, only the import paths.
- **No first-class JS/Wasm port of the gitleaks engine** as of May 2026. We adopt the rules (TOML), not the engine. If a maintained Wasm build appears later (`gitleaks-wasm` or similar), revisit.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
