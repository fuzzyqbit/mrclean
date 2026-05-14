---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 2 Plan 00 complete — smol-toml migration + detection shared types.
last_updated: "2026-05-14T13:48:53Z"
progress:
  total_phases: 3
  completed_phases: 1
  total_plans: 13
  completed_plans: 7
  percent: 54
---

# State: mrclean

> Working memory for the project. Updated by every gsd command at phase/plan transitions.

## Project Reference

**Project:** mrclean
**Core Value:** Real secrets and proprietary terms never reach the wire — the user keeps Claude Code productivity without trading away repo-level confidentiality.
**Current Focus:** Phase 2 — live-redaction-layers-1-4-one-way
**Project Mode:** mvp (vertical slices)
**Granularity:** coarse (3 phases)

## Current Position

Phase: 2 (live-redaction-layers-1-4-one-way) — EXECUTING
Plan: 2 of 7
**Phase:** Phase 2 in progress (02-00 complete)
**Plan:** 02-00-PLAN.md COMPLETE (smol-toml + Phase 2 infra)
**Status:** Executing Phase 2 — Plan 02-01 is next
**Progress:** [███████░░░] 54% (7/13 plans complete)

```
Phase 1: Wired Skeleton                              [ COMPLETE — 6/6 plans done ]
Phase 2: Live Redaction (Layers 1-4 + One-Way)       [ executing — 1/7 plans done ]
Phase 3: MCP Tools, Performance Gate, Public Release [ pending ]
```

## Performance Metrics

| Metric | Target | Current |
|--------|--------|---------|
| UserPromptSubmit hook latency (p95, 4 KB prompt) | < 100 ms | not measured |
| PostToolUse hook latency (p95, 50 KB tool result) | < 200 ms | not measured |
| Detection recall on positive fixture corpus | 100% | not measured |
| False-positive rate on negative fixture corpus | 0% | not measured |
| Line coverage on `src/` | ≥ 80% | not measured |

## Accumulated Context

### Decisions Made

- **Vertical 3-phase MVP** chosen over the research SUMMARY's 6-phase horizontal-layer structure. Each phase delivers an operator-verifiable Claude Code behavior. Compressed per `coarse` granularity + `mvp` project mode.
- **Phase 1 includes a no-op hook + live MCP scaffold** so installer wiring is proven before any detection logic exists (per Pitfall #7 mitigation).
- **Phase 2 ships all four detection layers + one-way mode together** rather than splitting layers across phases — the value-delivery slice has to catch real secrets end-to-end to be operator-verifiable.
- **Phase 3 bundles MCP tools + perf gate + docs + npm publish** because each is independently small but together they constitute the public-release slice.
- **REVMODE / LLM5 / POLISH explicitly deferred** — listed as v2 in REQUIREMENTS.md, not present in any v1 phase.
- **commander pinned to ^13.1.0** — RESEARCH.md §OQ-5 suggested ^14 was acceptable; CLAUDE.md LOCK supersedes; 13.1.0 confirmed at install time.
- **Entrypoint guard via import.meta.url** — prevents Commander.parseAsync / runMcpServer from executing on test import; no separate loader module needed.
- **Lazy subcommand imports in .action() callbacks** — MCP SDK never loads on CLI cold path; preserves sub-100ms hook cold-start budget.
- **JSON import assertion `with { type: 'json' }`** — required for NodeNext ESM; `assert { type: 'json' }` is deprecated syntax.
- **OQ-1 resolved: project-root .gitignore** — gitignore entry goes to project root `.gitignore`, NOT `.mrclean/.gitignore` (self-reference doesn't reliably work for parent directory). Phase 1 ignores all of `.mrclean/` by default.
- **OQ-2 resolved: cwd = process.cwd()** — `.mrclean/` created in `process.cwd()` at install time; operator runs `mrclean install` from project root.
- **OQ-3 resolved: user-scope default** — hooks → `~/.claude/settings.json`, MCP → `~/.claude.json`. `--scope project` errors "not implemented in Phase 1".
- **Uninstall via oldest-backup restoration** — `runUninstall` restores the oldest mrclean backup (pre-install state) for byte-identical round-trip, rather than naive entry removal.
- **Phase 1 minimal TOML parser** — hand-rolled ~50 LOC to avoid pulling `smol-toml` before Phase 2 forces it. Unknown sections ([words], [detection]) tolerated gracefully. Upgrade path documented in source.
- **Allowlist wholesale replacement** — Phase 1 mergeConfigs replaces the entire allowlist sub-object (not field-by-field). Documented for Phase 2 to extend with `_merge` markers if needed.
- **loadEffectiveConfig({ homeDir, cwd })** — single entry point for Plan 01-05 doctor config-load check; demonstrating CFG-01 + CFG-03.
- **Phase 1 short-form HOOK-07 banner** — `mrclean active v{VERSION} (no-op mode — detection not yet enabled)` emitted via additionalContext; long-form with rule/allowlist counts deferred to Phase 2.
- **Stdin timeout exits 0 silently** — 10s timeout guard for Windows/Git Bash pipe stalls (Pitfall #4); StdinTimeoutError triggers exit 0, not exit 2.
- **tsx for failclosed child process tests** — bare `node --input-type=module -e` cannot import .ts files via .js extensions; tsx handles ESM+TS at dev time.
- **SDK v1.29 export paths via ./* wildcard** — `/server/mcp.js` and `/server/stdio.js` resolve via the wildcard pattern, not named subpaths. RESEARCH A2 closed: both paths confirmed working at runtime. `LATEST_PROTOCOL_VERSION = '2025-11-25'` (not hardcoded anywhere in mrclean).
- **InMemoryTransport for MCP unit tests** — `InMemoryTransport.createLinkedPair()` enables in-process tool invocation; integration tests use `StdioClientTransport` for full stdio round-trip.
- **Single shutdown registration site** — `installShutdownHandlers()` in lifecycle.ts is the ONLY place SIGINT/SIGTERM are registered; server.ts adds zero signal listeners. Verified by grep gate and lifecycle tests.
- **extractRegisteredPaths() for canary bin resolution** — `computeDoctorReport` reads installed bin paths from settings.json/claude.json rather than calling `resolveMrcleanBinPath()`. Under vitest, `process.argv[1]` is the vitest binary, which caused `resolveMrcleanBinPath()` to return the wrong path. Reading from the installed JSON is also architecturally correct — it verifies the INSTALLED configuration.
- **MRCLEAN_TEST_FAKE_CLAUDE_VERSION env var** — TEST-ONLY escape hatch in `computeDoctorReport` allows hermetic CI tests to inject a synthetic Claude version without requiring a real `claude` binary.
- **computeDoctorReport / runDoctor split** — `computeDoctorReport` is pure (testable, never exits); `runDoctor` is the ONLY function in the doctor subsystem that exits the process. Grep-verified: `grep -cE "process\.exit" src/doctor/index.ts` = 1, = 0 in all helper files.

### Open Todos

- [x] Run `/gsd-plan-phase 1` to break Phase 1 into executable plans (done — 5 plans created)
- [x] Execute Plan 01-02 (install subcommand + MCP registration) — COMPLETE
- [x] Execute Plan 01-02b (three-layer config reader) — COMPLETE
- [x] Execute Plan 01-03 (hook stdin/stdout handler) — COMPLETE
- [x] Execute Plan 01-04 (MCP server with tool stubs) — COMPLETE
- [x] Execute Plan 01-05 (doctor canary round-trip) — COMPLETE
- [x] Execute Plan 02-00 (deps + smol-toml + shared detection types) — COMPLETE
- [ ] Execute Plan 02-01 (Layer 1: secretlint + gitleaks adapter)
- [ ] Execute Plan 02-02 (Layer 2: entropy + Layer 3: env + Layer 4: words)
- [ ] Execute Plan 02-03 (placeholder manager)
- [ ] Execute Plan 02-04 (hook integration: one-way redaction)
- [ ] Execute Plan 02-05 (audit log + dry_run mode)
- [ ] Execute Plan 02-06 (Phase 2 integration tests + banner upgrade)

### Blockers

None.

### Cross-Phase Notes

- Phase 1's MCP scaffold + supervisor model is reused identically by Phase 3's tool surface — no rework expected.
- Phase 2's placeholder manager (PH-01..04) is the contract that Phase 3's `mcp__mrclean__redact` tool returns; designed once in Phase 2.
- Phase 3's performance gate measures the Phase 1+2 system; perf budget breaches surface as build failures, not warnings.
- Audit log schema (Phase 1 gitignore + Phase 2 record format) must be settled before Phase 3's canary-leak CI test can be authored.

### Additional Decisions (Phase 2)

- **smol-toml ^1.6.1 replaces hand-rolled TOML parser** — Phase 2 requires [[rules]] array-of-tables and [entropy] sub-tables that the Phase 1 hand-rolled parser could not handle.
- **secrets_files flattened from [secrets_files].paths** — `readConfigLayer` hoists `paths` to `config.secrets_files: string[]` for ergonomics; Layer 3 consumers see a flat string array.
- **allowlist arrays CONCAT across merge layers** — Phase 2 changes Phase 1's wholesale-replacement behavior; user allowlist + project allowlist both accumulate.
- **src/detect/findings.ts and src/detect/type-map.ts owned by 02-00** — canonical single-source-of-truth modules; Wave 2 plans import, never re-create.
- **dedupBySpan precedence: longer-span-wins, then source-order** — secretlint > gitleaks > entropy > env > words for equal-length overlap resolution.
- **dotenv 17.x (not 16.x) installed** — RESEARCH allowed 17.x; backward-compatible for parse-only usage.

## Session Continuity

**Last command:** `/gsd-execute-phase` (plan 02-00)
**Last action:** Completed 02-00-PLAN.md — smol-toml migration, Phase 2 schema, canonical findings.ts + type-map.ts, 42 new tests (193 total).
**Stopped at:** Phase 2 Plan 00 complete — smol-toml migration + detection shared types.
**Next action:** Execute Plan 02-01 (Layer 1: secretlint + gitleaks adapter).

---
*Last updated: 2026-05-14 after plan 02-00 execution*
