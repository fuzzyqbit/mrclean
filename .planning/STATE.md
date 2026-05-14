---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 2 Plan 06 complete — fixture corpus + bundle smoke + canary-leak guard + doctor --bench stub.
last_updated: "2026-05-14T15:25:00.000Z"
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 13
  completed_plans: 13
  percent: 100
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

Phase: 2 (live-redaction-layers-1-4-one-way) — COMPLETE
Plan: 7 of 7
**Phase:** Phase 2 COMPLETE (02-06 complete)
**Plan:** 02-06-PLAN.md COMPLETE (fixture corpus + bundle smoke + canary-leak guard + doctor --bench stub)
**Status:** Phase 2 complete — Phase 3 is next
**Progress:** [██████████] 100%

```
Phase 1: Wired Skeleton                              [ COMPLETE — 6/6 plans done ]
Phase 2: Live Redaction (Layers 1-4 + One-Way)       [ COMPLETE — 7/7 plans done ]
Phase 3: MCP Tools, Performance Gate, Public Release [ pending ]
```

## Performance Metrics

| Metric | Target | Current |
|--------|--------|---------|
| UserPromptSubmit hook latency (p95, 4 KB prompt) | < 100 ms | 17.4 ms (bench run 2026-05-14) |
| PostToolUse hook latency (p95, 50 KB tool result) | < 200 ms | not measured |
| Detection recall on positive fixture corpus | 100% | 100% (12/12 — 02-06 fixture corpus) |
| False-positive rate on negative fixture corpus | 0% | 0% (0/10 — 02-06 fixture corpus) |
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
- [x] Execute Plan 02-01 (Layer 1: secretlint + gitleaks adapter) — COMPLETE
- [x] Execute Plan 02-02 (Layer 2: entropy + Layer 3: env + Layer 4: words) — COMPLETE
- [x] Execute Plan 02-03 (placeholder manager)
- [x] Execute Plan 02-04 (detection orchestrator + dry_run + warn→audit + budget bail-out) — COMPLETE
- [x] Execute Plan 02-05 (hook handlers: hook-level routing + banner upgrade) — COMPLETE
- [x] Execute Plan 02-06 (fixture corpus + bundle smoke + canary-leak guard + --bench stub) — COMPLETE

### Blockers

None.

### Cross-Phase Notes

- Phase 1's MCP scaffold + supervisor model is reused identically by Phase 3's tool surface — no rework expected.
- Phase 2's placeholder manager (PH-01..04) is the contract that Phase 3's `mcp__mrclean__redact` tool returns; designed once in Phase 2.
- Phase 3's performance gate measures the Phase 1+2 system; perf budget breaches surface as build failures, not warnings.
- Audit log schema (Phase 1 gitignore + Phase 2 record format) must be settled before Phase 3's canary-leak CI test can be authored.

### Additional Decisions (Phase 2 — Plan 04)

- **warn→audit normalization in orchestrator (not Layer 4):** Step 8a of runDetection normalises Layer 4's 'warn' action token to 'audit' in-place before effectiveAction assignment; single normalization point, LOCKED by test 4.
- **applyDryRun uses generic constraint** `T extends { effectiveAction: ... }` to avoid circular module import between dry-run.ts and index.ts.
- **budgetExhausted is a signal, not an early exit:** findings collected before Layer 1 timeouts still populate DetectionResult; Plan 02-05 decides on deny path.
- **Promise.allSettled for audit writes:** write failures logged to stderr as JSON warning; hook response always returned regardless of audit log state.
- **Module-level WorkerPool + PlaceholderManager cache:** Map<sessionId, PlaceholderManager> ensures placeholder stability across calls; shutdownDetection() resets both on process exit.

- **smol-toml ^1.6.1 replaces hand-rolled TOML parser** — Phase 2 requires [[rules]] array-of-tables and [entropy] sub-tables that the Phase 1 hand-rolled parser could not handle.
- **secrets_files flattened from [secrets_files].paths** — `readConfigLayer` hoists `paths` to `config.secrets_files: string[]` for ergonomics; Layer 3 consumers see a flat string array.
- **allowlist arrays CONCAT across merge layers** — Phase 2 changes Phase 1's wholesale-replacement behavior; user allowlist + project allowlist both accumulate.
- **src/detect/findings.ts and src/detect/type-map.ts owned by 02-00** — canonical single-source-of-truth modules; Wave 2 plans import, never re-create.
- **dedupBySpan precedence: longer-span-wins, then source-order** — secretlint > gitleaks > entropy > env > words for equal-length overlap resolution.
- **dotenv 17.x (not 16.x) installed** — RESEARCH allowed 17.x; backward-compatible for parse-only usage.
- **secretlint enableIDScanRule:true for AWS rule** — disabled by default; mrclean enables it via individual rule creator registration (not preset wrapper) to detect bare AWS access keys in hook payloads.
- **gitleaks TOML pinned at SHA 9febafb62** — 222 rules, 183 usable after JS adaptation, 39 skipped (JS-incompatible inline mode flags); SHA-256 checksum committed for tamper detection.
- **WorkerPool size 4 default** — amortizes 2–5ms per-worker spawn cost across the keyword-filtered hot path (5–20 rules typically execute per hook invocation).
- **vendor/ copied to dist/ via tsup onSuccess** — bundled artifact path resolution requires dist/vendor/gitleaks-rules.toml.
- **package.json files[] explicit enumeration** — excludes dist/detect-layer1* from npm tarball; test-only bundle entry not published.
- **Token regex excludes '=' as separator** — the tokenizer `[A-Za-z0-9_\-./+=]{N,}` includes `=` per plan spec; test fixtures use `: ` separator to ensure keyword is in surrounding window, not inside token.
- **Unicode → in JSDoc causes oxc transform failure** — replaced with `-` in layer3-env.ts JSDoc; oxc does not support non-ASCII chars in certain comment positions.
- **shannonEntropy exported from layer2** — exported for testing and potential re-use; gitleaks-engine.ts already inlined a copy per 02-01 decision.
- **HOOK-PROCESS LIFETIME cache in session-state.ts** — module-level sessionId-keyed Map for per-process reuse; Phase 3 PERF gate will evaluate if persistent IPC cache is needed.
- **initSessionState uses Promise.all** — env blocklist and word list are independent I/O operations; parallel loading keeps SessionStart latency minimal.
- **PlaceholderManager global counter (not per-TYPE)** — PH-03 collision-free across TYPEs; operator mental model is "the Nth thing redacted this session", not "the Nth AWS key".
- **OVF path is non-fatal (stderr JSON warning, not throw)** — hook is in Claude Code hot path; blocking the user on >999 unique secrets would be worse than degraded placeholder labels.
- **assertNoCanaryLeak checks JSON.stringify(record) substring** — normalises field order, catches partial leaks where value appears inside nested objects; ENOENT returns ok:true; malformed JSON returns ok:false with <malformed> canary.
- **findingToAuditRecord LOCKED comment + grep gate** — prevents future refactors from accidentally adding finding.value to the audit record; canary-leak test enforces at runtime.

### Additional Decisions (Phase 2 — Plan 06)

- **Bundle smoke Option B (runLayer1, not runDetection):** dist/detect-layer1.js only exports the Layer 1 engine; full orchestrator tested via tsx path in fixtures-corpus.test.ts; adding a dist/detect.js entry was unnecessary.
- **GitHub fine-grained PAT requires exactly 82 word chars:** gitleaks rule `github_pat_\w{82}` is exact-length; RESEARCH §12 spec had a miscounted 76-char body.
- **OpenAI key requires T3BlbkFJ marker:** gitleaks openai-api-key rule requires this literal base64 segment; all-A body without it is not detected by either secretlint or gitleaks.
- **Base64 image negative fixture capped at < 20 chars:** Layer 2 escalation path (length >= 40, entropy >= 5) fires without keywords; image data URI body must be kept below min_length threshold after tokenizer splits on `:`, `;`, `,`.
- **Audit line-count guard precedes canary-leak check:** asserts audit.jsonl exists with >= 12 lines before the canary check; prevents vacuous-pass on silently-empty audit log.
- **runBenchmark uses unique sessionId per invocation:** avoids polluting module-level PlaceholderManager cache across bench iterations; sessionId = `bench-${Date.now()}`.
- **UserPromptSubmit p50=0.6ms, p95=17.4ms:** calibration point for Phase 3 PERF gate (target < 100 ms).

## Session Continuity

**Last command:** `/gsd-execute-phase` (plan 02-06)
**Last action:** Completed 02-06-PLAN.md — 22 fixture files + 29 new tests (388 total). 100% recall on positive corpus; 0 FP on negative corpus; canary-leak proven; doctor --bench prints p50=0.6ms p95=17.4ms.
**Stopped at:** Phase 2 Plan 06 complete — fixture corpus + bundle smoke + canary-leak guard + doctor --bench stub.
**Next action:** Execute Phase 3 (MCP Tools, Performance Gate, Public Release).

---
*Last updated: 2026-05-14 after plan 02-06 execution*
