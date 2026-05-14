# Walking Skeleton — mrclean

**Phase:** 1 — Wired Skeleton
**Generated:** 2026-05-13
**Mode:** mvp (vertical slice, walking skeleton)

## Capability Proven End-to-End

> One sentence: the smallest user-visible capability that exercises the full stack.

A developer can run `npx mrclean install`, observe the "mrclean active vN.N.N" wiring trace inside the next `claude` session, run `npx mrclean doctor` to round-trip a canary string through the hook and the MCP server AND verify the three-layer config reader, and run `npx mrclean uninstall` to leave their Claude Code config byte-identical to the pre-install backup — all while every detection layer is a deliberate no-op.

## Demo Script (4-step proof)

1. `npx mrclean install` — writes hook entries to `~/.claude/settings.json` and the MCP server entry to `~/.claude.json` with absolute paths; creates `.mrclean/` in the project root with a stub `config.toml`; appends mrclean entries to project-root `.gitignore` (the entire `.mrclean/` directory is ignored in Phase 1).
2. `npx mrclean doctor` — exits 0 with PASS for: (a) hook entries present, (b) MCP entry present, (c) absolute paths still executable, (d) seeded canary round-trips through `mrclean hook` stdin/stdout, (e) seeded canary round-trips through the MCP `sanitize` tool, (f) the three-layer config reader (`loadEffectiveConfig`) resolves the bundled defaults + user-global + project-local layers without throwing, (g) `claude --version` is in the supported range.
3. Start a `claude` session — the first user prompt's response context includes the `mrclean active v0.1.0` trace injected via `UserPromptSubmit.hookSpecificOutput.additionalContext`. `/mcp` lists `mrclean` as connected.
4. `npx mrclean uninstall` — `diff` between the pre-install backup and `~/.claude/settings.json` exits 0; same for `~/.claude.json`.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Node.js >=20.18.0 | LOCKED in CLAUDE.md; required by MCP SDK ^1.x and Vitest ^4.x. Node 20 is the LTS floor that ships with current Claude Code installs. |
| Language | TypeScript ^5.6.0 | LOCKED in CLAUDE.md; required for Zod v4 deep generic inference and MCP SDK typed tool registration. |
| CLI parser | `commander` ^13.1.0 | LOCKED in CLAUDE.md. The CLAUDE.md row supersedes any RESEARCH.md mention of ^14 — Phase 1 stays on ^13.x; the subcommand-registration surface this plan uses is identical across 13 and 14. |
| MCP transport | `@modelcontextprotocol/sdk` ^1.29.x stdio | LOCKED. Streamable HTTP is a Phase 3 opt-in flag. v2 SDK is pre-alpha — do not adopt. |
| MCP scope | User-scope (`~/.claude.json`) by default | RESEARCH §2.1: hooks go in `~/.claude/settings.json`, MCP servers in `~/.claude.json` — writing mcpServers to settings.json silently fails. `--scope project` is a stub that errors "not implemented in Phase 1". |
| Path resolution | Absolute paths resolved at install time via `process.execPath` (node) + `require.resolve`/`realpath` (mrclean bin) | RESEARCH §3.4: defends Pitfall #7 (silent misconfig). Bare command names break under Claude Code's restricted PATH. |
| Wiring signal | `UserPromptSubmit.hookSpecificOutput.additionalContext` (exit 0) | RESEARCH §1.4: stderr on exit 0 reaches only the debug log. `additionalContext` injects user-visible session context. Phase 1 banner format (SHORT — long form deferred to Phase 2 with detection counts): `mrclean active v{version} (no-op mode — detection not yet enabled)`. |
| HOOK-07 banner format (Phase 1 scope) | SHORT form only; long form `(rules: NNN, allowlist: NN)` deferred to Phase 2 | The long form requires rule + allowlist counts that don't exist until detection (Layers 1–4) ships in Phase 2. Phase 1 satisfies the wiring-signal intent of HOOK-07 with the short form; verify-phase consults Plan 01-03's scope note before flagging the missing counts. |
| Hook exec form | `args: string[]` array (no shell) | RESEARCH §1.5: Claude Code v2.1.119+ supports exec form. Avoids shell quoting on absolute paths with spaces. |
| Atomic JSON edits | Read → backup → write tmp → rename, with tmp in **same directory** as target | RESEARCH §3.3 + Pitfall #5: `rename()` across filesystems is not atomic. Backup filename: `{target}.mrclean-backup-{ISO8601-safe}.json`. |
| Idempotency strategy | Hooks marker key `_mrclean: true` per registered block; MCP server keyed by `mcpServers.mrclean` | RESEARCH §3.2: scan-and-replace pattern enables safe re-install and self-upgrade. |
| `.gitignore` location | Project-root `.gitignore` (append mrclean block with delimited comment markers) | Resolves RESEARCH open question A1 (OQ-1). Safer than `.mrclean/.gitignore` self-reference. Verified at install time via `git check-ignore`. |
| `.gitignore` content (Phase 1) | Single entry: `.mrclean/` — the whole project-local directory is ignored | Phase 1 default. `audit.jsonl`, `session-*.json`, and `manifest-*.jsonl` (Phase 2 artifacts) all live under `.mrclean/` so they're already covered. Operators who want to commit `config.toml` or `words.txt` deliberately edit `.gitignore` themselves (a one-line change). Surfacing that workflow as an explicit flag is a Phase 2/3 concern. |
| Two-bin layout | `package.json#bin: { mrclean, mrclean-mcp }`, both built by tsup from `src/cli.ts` and `src/mcp.ts` | RESEARCH §6.1: one source tree, two entrypoints. Hook subcommand runs in `mrclean`, MCP server runs in `mrclean-mcp`. |
| Three-layer config reader (Phase 1) | `src/config/{defaults,index}.ts` reads `~/.mrclean/config.toml` (user-global) and `<cwd>/.mrclean/config.toml` (project-local), merges field-by-field over bundled defaults, with `loadEffectiveConfig(opts)` as the single entry point | Plan 01-02 writes the stub `.mrclean/config.toml` at install time but Plan 01-02 alone has no reader-side counterpart — CFG-01 (project-local overrides) and CFG-03 (three-layer precedence) require both writer and reader. Plan 01-02b delivers the reader (a small `src/config/` subtree, no new runtime deps; a minimal hand-rolled TOML subset for Phase 1, `smol-toml` upgrade deferred to Phase 2 where the gitleaks rule pack forces it). Doctor (Plan 01-05) wires `loadEffectiveConfig` into the `config-load` check so CFG-01/CFG-03 are operator-observable end-to-end. |
| Doctor orchestration split | `computeDoctorReport(opts) → { exitCode, results, versionResult }` is the pure testable core; `runDoctor(opts)` is the thin CLI wrapper that calls `process.exit(report.exitCode)` | Vitest E2E tests call `computeDoctorReport` directly without `process.exit` killing the runner. The only `process.exit` site in the doctor subsystem lives in `runDoctor`. |
| MCP signal handling | All SIGINT/SIGTERM listeners registered exactly once via `installShutdownHandlers` in `src/mcp/lifecycle.ts`; `src/mcp/server.ts` does NOT register additional listeners | Avoids `MaxListenersExceededWarning` and the SIGINT exit race from duplicate signal registration. The stdio transport's read loop keeps the event loop alive; no Promise-based signal listener block is added. |
| MCP protocolVersion | Negotiated automatically by the SDK Client via `LATEST_PROTOCOL_VERSION` from `@modelcontextprotocol/sdk/types.js` | Never hardcode the version string. The `2024-11-05` value pre-dates the November 2025 spec change and would be rejected by SDK v1.29.x. Letting `Client.connect()` handle negotiation keeps the integration test correct as the SDK bumps the constant. |
| Test runner | Vitest ^4.1.x with `@vitest/coverage-v8` | LOCKED in CLAUDE.md. ESM-first, fast TDD loop. |
| Bundler | tsup ^8.5.x with `format: ['esm']`, `target: 'node20'`, auto-shebang | LOCKED in CLAUDE.md. Handles `#!/usr/bin/env node` chmod automatically. |
| Directory layout | `src/{cli.ts, mcp.ts, hook/, install/, config/, doctor/, shared/}` with thin top-level imports | RESEARCH §6.5 + cold-start budget (§6.2). `src/config/` is the Phase 1 home of the three-layer reader (Plan 01-02b). Lazy-import MCP SDK only inside `serve`/`mcp.ts`. |

## Stack Touched in Phase 1

- [x] Project scaffold (package.json, tsconfig.json, tsup.config.ts, vitest config, src/ skeleton)
- [x] Two real bin entrypoints (`mrclean` CLI + `mrclean-mcp` stdio server)
- [x] Real filesystem interaction (atomic JSON read/write to `~/.claude/settings.json`, `~/.claude.json`, project-root `.gitignore`, `.mrclean/`)
- [x] Real hook event handling (UserPromptSubmit, SessionStart, PreToolUse, PostToolUse — all no-op pass-through with the wiring banner)
- [x] Real MCP server lifecycle (stdio transport, three tool stubs registered, clean shutdown on SIGINT via single registration site, no duplicate signal listeners)
- [x] Real three-layer config reader (bundled defaults < `~/.mrclean/config.toml` < `<cwd>/.mrclean/config.toml`, with `loadEffectiveConfig` as the single entry point; CFG-01 and CFG-03 satisfied end-to-end)
- [x] Real round-trip self-test (`doctor` spawns the hook and the MCP server, exercises the config reader, asserts they all respond correctly)
- [x] Vitest harness with passing smoke tests
- [x] Local-run command exercising the full stack: `npm run build && npx mrclean install && npx mrclean doctor && npx mrclean uninstall`

## Out of Scope (Deferred to Later Slices)

> Anything that is *not* in the skeleton. Be explicit — this list prevents future phases from re-litigating Phase 1's minimalism.

- All detection layers (Layer 1 secretlint, Layer 2 entropy, Layer 3 .env extraction, Layer 4 dirty-word file) — deferred to Phase 2.
- Placeholder substitution and the placeholder manager (PH-01..PH-04) — Phase 2.
- Audit log JSONL writes (AUDIT-01, AUDIT-02 record schema) — Phase 2. Phase 1 only `.gitignore`s the whole `.mrclean/` directory (which transitively covers `audit.jsonl`, AUDIT-03).
- Block-on-detection behavior on `UserPromptSubmit` and `updatedInput` substitution on `PreToolUse` (HOOK-02, HOOK-03, HOOK-04) — Phase 2.
- Long-form HOOK-07 banner with live `(rules: NNN, allowlist: NN)` counts — Phase 2 (requires detection engine counts). Phase 1 ships the short form `mrclean active v{VERSION} (no-op mode — detection not yet enabled)` instead; the wiring-signal intent of HOOK-07 IS satisfied in Phase 1.
- Full v1 `MrcleanConfig` schema (CFG-02: per-rule action override, severity tiers, multi-axis allowlist with paths/stopwords/regexes/fingerprints) — Phase 2. Phase 1's `MrcleanConfig` carries only the minimum fields needed for Phase 1 no-op behavior (`dry_run`, `allowlist` skeleton). The three-layer merge mechanics are stable; Phase 2 extends fields, not the algorithm.
- `smol-toml` adoption for the config reader — deferred to Phase 2 (where the gitleaks rule pack mandates a full TOML 1.1 parser). Phase 1 uses a ~30-LOC hand-rolled TOML subset that handles top-level booleans, string arrays under `[allowlist]`, comments, and blanks. Documented upgrade path lives in `src/config/index.ts` source comments.
- The full three MCP tools `mrclean_check / mrclean_redact / mrclean_status` with real behavior (MCP-02, MCP-03) — Phase 3. Phase 1 ships **stubs only** under the names `sanitize`, `restore`, `audit_query` to prove tool registration works end-to-end.
- Performance gate (`<100ms / <200ms`) — Phase 3 (PERF-01..03).
- README, THREAT_MODEL.md, npm publish, CI canary-leak test, ≥80% coverage gate — Phase 3.
- `--scope project` MCP registration (writes to `.mcp.json`) — Phase 1 ships only `--scope user` (default). The flag exists but errors "not implemented in Phase 1".
- Operator workflow for committing `.mrclean/config.toml` or `.mrclean/words.txt` deliberately — Phase 1 default ignores the whole `.mrclean/` directory; operators who want to commit their project-local config edit `.gitignore` manually. Surfacing this as a flag is a Phase 2/3 concern.
- Reversible mode (REVMODE), Layer 5 LLM classifier (LLM5), and v2 polish items — explicitly out of v1 per REQUIREMENTS.md.

## Delivered in Phase 1 (post-revision additions)

The following items, originally drafted as Phase 2 work, are now part of Phase 1 after the planner-checker iteration:

- **Three-layer config reader** (`src/config/{defaults,index}.ts`): bundled defaults < user-global (`~/.mrclean/config.toml`) < project-local (`<cwd>/.mrclean/config.toml`). Single entry point `loadEffectiveConfig(opts)`. Missing files are normal (resolve to `{}`); malformed files throw a structured `ConfigReadError` for doctor to report. Plan 01-02b owns the implementation and tests; Plan 01-05 wires it into the doctor `config-load` check. This closes CFG-01 and CFG-03 within Phase 1 instead of deferring to Phase 2.

## Subsequent Slice Plan

Each later phase adds vertical slices on top of this skeleton without altering its architectural decisions:

- **Phase 2 — Live Redaction (Layers 1-4 + One-Way):** detection engine wires into the existing hook handlers; placeholder manager + audit log fill in the stubs; one-way `UserPromptSubmit` block + `PreToolUse.updatedInput` substitution replace the Phase 1 no-ops. The HOOK-07 banner is upgraded to the long-form `(rules: NNN, allowlist: NN)` once live counts exist. The `MrcleanConfig` schema is extended with CFG-02 fields without changing the `loadEffectiveConfig` contract. The TOML reader upgrades from the Phase 1 hand-rolled subset to `smol-toml` so the gitleaks rule pack can be parsed. Reuses Phase 1's install/uninstall, doctor canary harness, config reader, and MCP server lifecycle.
- **Phase 3 — MCP Tools, Performance Gate, Public Release:** the three Phase 1 MCP tool **stubs** (`sanitize`, `restore`, `audit_query`) get rewritten as the production `mrclean_check`, `mrclean_redact`, `mrclean_status` (MCP-02, MCP-03). Vitest perf-gate suite asserts the `<100ms / <200ms` budgets on the Phase 1+2 system. README + THREAT_MODEL ship. `npm publish` cuts the 1.0.0 release.

## Anti-Pattern Audit (Self-Check)

- [x] Not a layer cake — every Plan in Wave 2 produces an operator-visible verification step in Plan 05 (doctor).
- [x] Not skeleton bloat — 6 plans (01, 02, 02b, 03, 04, 05), ~13 tasks total, every task is end-to-end-relevant.
- [x] No premature SPIDR splitting — Phase 1 stays as the operator-defined unit; 02b is a focused split inside Wave 2 to honor CFG-01/CFG-03 within Phase 1 budget rather than deferring.
- [x] After Plan N, the operator can do something they could not after Plan N-1 (scaffold → installable → hook responds → MCP responds → config reader works → doctor round-trips and reports config-load).
