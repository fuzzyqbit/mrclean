---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-05-14T04:36:00Z"
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 6
  completed_plans: 4
  percent: 67
---

# State: mrclean

> Working memory for the project. Updated by every gsd command at phase/plan transitions.

## Project Reference

**Project:** mrclean
**Core Value:** Real secrets and proprietary terms never reach the wire — the user keeps Claude Code productivity without trading away repo-level confidentiality.
**Current Focus:** Phase 1 — wired-skeleton
**Project Mode:** mvp (vertical slices)
**Granularity:** coarse (3 phases)

## Current Position

Phase: 1 (wired-skeleton) — EXECUTING
Plan: 5 of 6
**Phase:** In progress (Phase 1 — Wired Skeleton — plans 01-01, 01-02, 01-02b, 01-03 complete)
**Plan:** 01-03-PLAN.md COMPLETE → advancing to 01-04-PLAN.md
**Status:** Executing Phase 1
**Progress:** [███████░░░] 67% (4/6 plans complete)

```
Phase 1: Wired Skeleton                              [ executing — 4/5 plans done ]
Phase 2: Live Redaction (Layers 1-4 + One-Way)       [ pending ]
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

### Open Todos

- [x] Run `/gsd-plan-phase 1` to break Phase 1 into executable plans (done — 5 plans created)
- [x] Execute Plan 01-02 (install subcommand + MCP registration) — COMPLETE
- [x] Execute Plan 01-02b (three-layer config reader) — COMPLETE
- [x] Execute Plan 01-03 (hook stdin/stdout handler) — COMPLETE
- [ ] Execute Plan 01-04 (MCP server with tool stubs)
- [ ] Execute Plan 01-05 (doctor canary round-trip)

### Blockers

None.

### Cross-Phase Notes

- Phase 1's MCP scaffold + supervisor model is reused identically by Phase 3's tool surface — no rework expected.
- Phase 2's placeholder manager (PH-01..04) is the contract that Phase 3's `mcp__mrclean__redact` tool returns; designed once in Phase 2.
- Phase 3's performance gate measures the Phase 1+2 system; perf budget breaches surface as build failures, not warnings.
- Audit log schema (Phase 1 gitignore + Phase 2 record format) must be settled before Phase 3's canary-leak CI test can be authored.

## Session Continuity

**Last command:** `/gsd-execute-phase` (plan 01-03)
**Last action:** Completed 01-03-PLAN.md — hook handler with fail-closed, stdin timeout, dispatcher, 4 handlers; 23 new tests (96 total); created 01-03-SUMMARY.md.
**Stopped at:** Completed Plan 01-03; advancing to Plan 01-04 (MCP server with tool stubs).
**Next action:** Execute Plan 01-04 (MCP server: mrclean_status tool stub, StdioServerTransport, graceful shutdown).

---
*Last updated: 2026-05-14 after plan 01-03 execution*
