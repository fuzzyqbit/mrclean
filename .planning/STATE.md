---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Phase 3 COMPLETE — all 6 plans done. Awaiting Task 3 manual first-publish (checkpoint:human-action).
stopped_at: Plan 03-05 Task 2 complete. Task 3 = checkpoint:human-action (manual npm publish by maintainer).
last_updated: "2026-05-14T20:30:00.000Z"
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 19
  completed_plans: 19
  percent: 100
---

# State: mrclean

> Working memory for the project. Updated by every gsd command at phase/plan transitions.

## Project Reference

**Project:** mrclean
**Core Value:** Real secrets and proprietary terms never reach the wire — the user keeps Claude Code productivity without trading away repo-level confidentiality.
**Current Focus:** Phase 3 — mcp-tools-performance-gate-public-release
**Project Mode:** mvp (vertical slices)
**Granularity:** coarse (3 phases)

## Current Position

Phase: 3 (mcp-tools-performance-gate-public-release) — IN PROGRESS
Plan: 4 of 6
**Phase:** Phase 3 IN PROGRESS (03-03 fully complete — Task 4 checkpoint resolved)
**Plan:** 03-03-PLAN.md COMPLETE (docs: README, THREAT_MODEL, LICENSE, CHANGELOG + changesets bootstrap; Task 4 approved)
**Status:** Advancing to 03-04 (quality gates + canary-leak CI)
**Progress:** [██████████] 100%

```
Phase 1: Wired Skeleton                              [ COMPLETE — 6/6 plans done ]
Phase 2: Live Redaction (Layers 1-4 + One-Way)       [ COMPLETE — 7/7 plans done ]
Phase 3: MCP Tools, Performance Gate, Public Release [ in progress — 4/6 plans done ]
```

## Performance Metrics

| Metric | Target | Current |
|--------|--------|---------|
| UserPromptSubmit hook latency (p95, 4 KB prompt) | < 100 ms | 17.4 ms (bench run 2026-05-14) |
| PostToolUse hook latency (p95, 50 KB tool result) | < 200 ms | 4.82 ms (perf gate 03-02, executor machine, 50 iterations) |
| Detection recall on positive fixture corpus | 100% | 100% (12/12 — 02-06 fixture corpus) |
| False-positive rate on negative fixture corpus | 0% | 0% (0/10 — 02-06 fixture corpus) |
| Line coverage on `src/` | ≥ 80% | 84.01% lines / 82.89% stmts / 82.12% funcs / 73.22% branches (03-00 baseline) |

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
- [x] Execute Plan 03-00 (package metadata + vitest projects split + coverage thresholds) — COMPLETE
- [x] Execute Plan 03-01 (mrclean_check/redact/status + supervisor + delete Phase 1 stubs) — COMPLETE
- [x] Execute Plan 03-02 (vitest perf gate + PERF-03 compile-once + CI workflow) — COMPLETE
- [x] Execute Plan 03-03 (docs: README, THREAT_MODEL, LICENSE, CHANGELOG + changesets bootstrap) — COMPLETE (Task 4 checkpoint resolved: LICENSE='mrclean-claude contributors', repo URL placeholder for 03-05, package name approved)
- [x] Execute Plan 03-04 (quality gates: >=80% coverage + @hook-integration tags + test.yml + canary-leak.yml) — COMPLETE (QA-01/02/03 satisfied; 2 tasks committed b92f4d3, 82a1dcd)
- [x] Execute Plan 03-05 (changesets release pipeline + release-smoke + initial changeset + docs/RELEASE.md) — Tasks 1+2 COMPLETE (4f46507, e0d735b). Task 3 = checkpoint:human-action awaiting maintainer manual first publish.

### Blockers

- Task 3 (checkpoint:human-action): Maintainer must run first-publish manually (npm login + npm publish --access public). See docs/RELEASE.md. After publish, tag v1.0.0-rc.1 and push. Next Release workflow run will open 1.0.0 version-PR.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260601-0e1 | Fix misleading install stub (dead [words]/[detection] keys) | 2026-06-01 | 1afefec | [260601-0e1-fix-install-stub-dead-keys](./quick/260601-0e1-fix-install-stub-dead-keys/) |
| 260601-1sw | `mrclean init` CLI subcommand + /mrclean:mrclean-init slash command | 2026-06-01 | 0d12c88 | [260601-1sw-mrclean-init-command](./quick/260601-1sw-mrclean-init-command/) |

### Cross-Phase Notes

- Phase 1's MCP scaffold + supervisor model is reused identically by Phase 3's tool surface — no rework expected.
- Phase 2's placeholder manager (PH-01..04) is the contract that Phase 3's `mcp__mrclean__redact` tool returns; designed once in Phase 2.
- Phase 3's performance gate measures the Phase 1+2 system; perf budget breaches surface as build failures, not warnings.
- Audit log schema (Phase 1 gitignore + Phase 2 record format) must be settled before Phase 3's canary-leak CI test can be authored.

### Additional Decisions (Phase 3 — Plan 04)

- **@hook-integration prefix pattern in describe names** — `describe('@hook-integration UserPromptSubmit', ...)` puts the tag before the event name so CI grep `@hook-integration.*$ev` matches. Suffix pattern (`EventName @hook-integration`) would require reverse regex.
- **Coverage gap-fill tests not created** — All four thresholds (lines 84.32%, stmts 83.07%, funcs 82.37%, branches 73.43%) already passing at plan start. tests/coverage-gap-fill.test.ts deliberately omitted.
- **canary-leak.yml uses --project=integration** — fixture corpus tests import dist/ artefacts; integration project globalSetup runs tsup --clean to rebuild. Unit project context would cause import failures.
- **Coverage only on 20.x matrix slot** — V8 adds ~30% runtime overhead. Three slots with coverage = 3x redundant signal. Primary slot 20.x sufficient.

### Additional Decisions (Phase 3 — Plan 02)

- **Vitest 4 test signature is test(name, opts, fn) not test(name, fn, opts)** — three-argument form with options as last arg was deprecated in Vitest 3 and removed in Vitest 4. Perf tests updated to use `{ timeout: 60_000 }` as second argument.
- **PERF-03 compile-once gate uses file-level + line-level exemptions** — template literal worker source files use PERF-03-FILE-EXEMPT; per-call compilations that are correct by design use `// PERF-03: <reason>` inline annotation.
- **Perf gate uses test() + performance.now() + manual p95** — vitest bench() does not expose p95 field (only p50/p75/p99/p995/p999). Plain test() with N=50 iterations and manual percentile computation matches src/doctor/bench.ts pattern.
- **Measured p95 values: UserPromptSubmit 2.91ms, PostToolUse 4.82ms** (executor machine, 50 iterations, 2026-05-14). 97-98% headroom vs 100ms/200ms thresholds.

### Additional Decisions (Phase 3 — Plan 01)

- **Supervisor uses in-process Promise isolation (not per-call worker_threads)** — RESEARCH §Pattern 2 / §Pitfall 3: new Worker per call requires a pre-compiled worker entry + tsup entry. MCP-04 guarantee preserved via try/catch Promise isolation + Phase 2 WorkerPool for ReDoS safety.
- **runDetectionReadOnly is additive to detect/index.ts** — mirrors runDetection Steps 1-11; Step 12 (audit writes) intentionally omitted. mrclean_check uses this; mrclean_redact uses full runDetection.
- **findingDTO schema excludes `value` and `span`** — T-03-01-02 information leak guard; check.ts/redact.ts output schemas validated by SDK via Zod v4 outputSchema.
- **AWS key test fixture: AKIAABCDE3FGHIJ2345K** — AKIAIOSFODNN7EXAMPLE (the AWS docs placeholder) is in gitleaks per-rule allowlist `.+EXAMPLE$`; non-EXAMPLE key required for test to produce findings.
- **doctor/canary.ts: runMcpCanary updated from sanitize to mrclean_check** — Phase 1 `sanitize` tool deleted; canary now calls mrclean_check and asserts structuredContent.count is numeric (no echo-check).

### Additional Decisions (Phase 3 — Plan 00)

- **npm package name is mrclean-claude** — `mrclean` taken on npm since 2012 by jackhq/beautifulnode; `mrclean-claude` verified available; locked per RESEARCH §Pitfall 2.
- **Version 1.0.0-rc.1 for release candidate** — plan 03-05 bumps to 1.0.0 at publish time.
- **repository/homepage/bugs URLs are placeholders** — `github.com/anthropics/mrclean-claude`; operator must confirm before publish.
- **vitest projects API: unit + integration split** — unit project runs in parallel; integration project has fileParallelism:false and owns globalSetup (tsup --clean). Fixes Phase 2 parallel-pollution race on dist/ mid-run-delete.
- **Coverage thresholds all passing at baseline** — lines 84.01%, statements 82.89%, functions 82.12%, branches 73.22%; all above their respective thresholds (80/80/75/70).
- **Banner regex updated for semver pre-release** — `v\d+\.\d+\.\d+[^ ]*` pattern in 3 test files; required for 1.0.0-rc.1 compatibility.
- **tests/perf/** pre-wired in integration include globs** — plan 03-02 creates the files; config doesn't need touching.

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

### Additional Decisions (Phase 3 — Plan 03)

- **README section numbering adjusted for flow** — Uninstall (section 6) and Modes (section 7) precede MCP Tools (section 8) for natural operator reading order. Plan spec had 12 sections; all 12 are present, numbering shifted by one for two sections.
- **THREAT_MODEL.md uses H3 numbered sections (not bullet list)** — nine `### 1. Title` headings provide better anchoring and scanability than a flat bullet list, matching trufflehog/semgrep tone target from RESEARCH §OQ-5.
- **COPYRIGHT HOLDER PLACEHOLDER: 'anthropics'** — Task 4 checkpoint requires operator confirmation before publish; SUMMARY documents this explicitly.
- **REPOSITORY URL PLACEHOLDER: github.com/anthropics/mrclean-claude** — set in Plan 03-00; Task 4 checkpoint for operator to confirm/replace.
- **@changesets/cli resolved to 2.31.0** — RESEARCH expected 2.29.x; 2.31.0 installed (later minor, compatible); ^2.31.0 range written to package.json.
- **CHANGELOG uses ASCII >= instead of Unicode >=** — avoids character encoding edge cases in terminal environments and diff views.

## Session Continuity

**Last command:** `/gsd-execute-phase` (plan 03-04 — quality gates + CI workflows)
**Last action:** Task 1 (b92f4d3): @hook-integration tags in integration-detection.test.ts. Task 2 (82a1dcd): test.yml matrix workflow + canary-leak.yml security gate. 03-04-SUMMARY.md committed. QA-01/02/03 requirements marked complete.
**Stopped at:** Plan 03-04 FULLY COMPLETE (all 2 tasks done).
**Next action:** Execute Plan 03-05 (npm publish + release smoke + repo URL finalization).

---
*Last updated: 2026-06-01 - Completed quick task 260601-1sw: mrclean init command + slash command*
