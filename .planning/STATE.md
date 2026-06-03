---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Native-Node PII/NER Layer
status: milestone_complete
stopped_at: Phase 7 context gathered
last_updated: "2026-06-03T20:00:42.417Z"
last_activity: 2026-06-03 -- Phase 07 planning complete
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 12
  completed_plans: 9
  percent: 100
---

# State: mrclean

> Working memory for the project. Updated by every gsd command at phase/plan transitions.

## Project Reference

**Project:** mrclean
**Core Value:** Real secrets and proprietary terms never reach the wire — the user keeps Claude Code productivity without trading away repo-level confidentiality.
**Current Focus:** Phase 06 — ner-inference-l6b-mcp-wiring
**Project Mode:** mvp (vertical slices)
**Granularity:** coarse (3-5 phases)

## Current Position

Phase: 07
Plan: Not started
Status: Milestone complete
Last activity: 2026-06-03

> v1 milestone (Phases 1-3) shipped 2026-05-14. v2.0 adds the opt-in Native-Node PII/NER layer
> as Phases 4-7. Phase numbering CONTINUES from v1 — it does not reset to 1.

## Performance Metrics

| Metric | Target | Current |
|--------|--------|---------|
| UserPromptSubmit hook latency (p95, 4 KB prompt) | < 100 ms | 17.4 ms (bench run 2026-05-14, pre-PII) |
| PostToolUse hook latency (p95, 50 KB tool result) | < 200 ms | 4.82 ms (perf gate 03-02, executor machine, 50 iterations, pre-PII) |
| Detection recall on positive fixture corpus | 100% | 100% (12/12 — 02-06 fixture corpus) |
| False-positive rate on negative fixture corpus | 0% | 0% (0/10 — 02-06 fixture corpus) |
| Line coverage on `src/` | ≥ 80% | 84.01% lines / 82.89% stmts / 82.12% funcs / 73.22% branches (03-00 baseline) |
| Regex-PII hot-path latency (p95) | < 100 / < 200 ms | TBD (Phase 5 — must stay within v1 budget with L6a enabled) |

## Accumulated Context

### Decisions Made

#### Milestone v2.0 (Native-Node PII/NER Layer)

- **Phase numbering CONTINUES from v1 (Phases 4-7), not reset to 1** — v1 ended at Phase 3 (shipped 2026-05-14); v2.0 PII/NER is Phases 4-7 of the same roadmap.
- **4-phase v2.0 structure** derived from research/SUMMARY.md + ARCHITECTURE-v2-pii.md build order, within `coarse` granularity (3-5): contracts → regex hot-path lane + model infra → NER + MCP wiring → security hardening. Each phase is operator-verifiable.
- **THE cardinal decision (locked in Phase 4-6 design): NER NEVER runs in the per-event hook.** Claude Code spawns a fresh process per hook event; a 108 MB model would cold-load every prompt (10-100x over budget). NER runs ONLY in the long-lived MCP server as a warm singleton (perf-exempt, Layer-5 style). The hook gets the cheap regex-PII lane (L6a) only.
- **Two-lane Layer 6**: L6a (regex PII — email/SSN/CC+Luhn/phone/IP) is pure-JS, hot-path-safe, joins the chain after L4 (Phase 5). L6b (NER — PERSON/ORG/LOC) is MCP-only, gated by `opts.ner` which only the MCP server passes (Phase 6).
- **NER is advisory by default (warn/audit), NEVER a hard gate** — deterministic secret layers (+ checksum'd PII like SSN/CC) remain the only default block. NER false negatives can leak; copy must say "best-effort hint, not a guarantee" (Phase 7).
- **ML deps (`@huggingface/transformers`, `onnxruntime-node`) as `optionalDependencies`** — a failed native build (musl/Alpine/exotic arch — onnxruntime-node is glibc-linked, no WASM auto-fallback in Node) NEVER breaks the core secret tool (Phase 4 decision).
- **Model lazy-downloaded to stable `~/.mrclean/models/` (NEVER cwd-relative `./.cache`), SHA-256-pinned + verified on load, offline side-load path supported** — the default PII-off `npx` cold path never loads ML deps or touches the network (Phase 5).
- **PII findings reuse existing PlaceholderManager + audit log + 5-axis allowlist with ZERO new sink code** — only schema additions are new `PII_*` TYPEs and `pii-regex`/`pii-ner` finding sources (Phase 4 contract).
- **Audit schema extended with `engine`/`model_rev`/`quant`/`backend`; no-raw-value rule extended to PII** — pins reproducibility (NER is non-deterministic across model rev/quant/backend) and prevents `audit.jsonl` becoming a plaintext PII DB (Phase 4 schema + Phase 7 leak-grep).
- **Hard scope fence (Phase 4, enforced every transition)**: one default model (`Xenova/bert-base-NER` int8) + optional piiranha tier; PER/ORG/LOC + listed regex-PII only. NO cloud PII APIs, NO model-facing unredact tool, NO Presidio Python sidecar in default distribution. Don't drift into "a worse Presidio in Node."
- **PII placeholder reversibility deferred** — one-way PII redaction only this milestone; ties to the REVMODE backlog.

### Phase → Requirement Mapping (v2.0)

| Phase | Requirements | Count |
|-------|--------------|-------|
| Phase 4 — PII Contracts & Architecture Foundations | PII-03, MODEL-01, PIISEC-03 | 3 |
| Phase 5 — Regex PII Hot-Path Lane (L6a) + Model Acquisition | PII-01, PII-02, MODEL-02, MODEL-03 | 4 |
| Phase 6 — NER Inference (L6b) + MCP Wiring | NER-01, NER-02, NER-03, NER-04, MODEL-04 | 5 |
| Phase 7 — PII Security Hardening & Honest Framing | PIISEC-01, PIISEC-02 | 2 |
| **Total v2.0** | | **14** |

### Open Todos

- [ ] Run `/gsd-plan-phase 4` to break Phase 4 (PII contracts) into executable plans
- [ ] Phase 5/6 flagged for `--research-phase` / spike 002: benchmark `Xenova/bert-base-NER` int8 cold-load + warm-infer on macOS arm64 + Linux glibc; WASM-backend latency (decides musl NER posture); int8-vs-fp32 recall on code-style content; confirm `@huggingface/transformers` v4 import paths against live package
- [ ] Phase 4 config plan: pin `pii.*.entities` array merge semantics (recommend last-wins for entity toggles per ARCHITECTURE-v2-pii.md)

#### v1 milestone todos (Phases 1-3) — historical

- [x] All Phase 1 plans (01-01..01-05) — COMPLETE
- [x] All Phase 2 plans (02-00..02-06) — COMPLETE
- [x] All Phase 3 plans (03-00..03-05) — Tasks complete; 03-05 Task 3 = checkpoint:human-action (first manual publish)

### Blockers

- v1 carryover: Task 3 (checkpoint:human-action): Maintainer must run first-publish manually (npm login + npm publish --access public). See docs/RELEASE.md. After publish, tag v1.0.0-rc.1 and push. (Does not block v2.0 planning.)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260601-0e1 | Fix misleading install stub (dead [words]/[detection] keys) | 2026-06-01 | 1afefec | [260601-0e1-fix-install-stub-dead-keys](./quick/260601-0e1-fix-install-stub-dead-keys/) |
| 260601-1sw | `mrclean init` CLI subcommand + /mrclean:mrclean-init slash command | 2026-06-01 | 0d12c88 | [260601-1sw-mrclean-init-command](./quick/260601-1sw-mrclean-init-command/) |
| 260601-2fj | uninstall surgically removes only mrclean entries (no wholesale restore) | 2026-06-01 | ca2891a | [260601-2fj-uninstall-surgical](./quick/260601-2fj-uninstall-surgical/) |

### Cross-Phase Notes (v2.0)

- Phase 4's finding-shape + audit-schema + config additions are the contract every later v2.0 phase imports — touches Plan-02-00-owned files (`findings.ts`, `type-map.ts`) which carry "revise plan first" warnings; sequence the schema work first.
- Phase 5's `model-cache.ts` + `pipeline-singleton.ts` plumbing is pure infra (testable without inference) and is the dependency gate for Phase 6's NER inference.
- Phase 6 must verify the MCP-03 read/transform-only invariant still holds — NER enriches existing read-only tools; no new write/unredact tool is added.
- Phase 7's leak-grep test audits the fully-integrated surface from Phase 6; must cover exception paths, not just the happy path.
- The existing v1 PlaceholderManager / audit log / 5-axis allowlist are reused unchanged — single ordered substitution pass with one allocator; NER excluded from `<MRCLEAN:*>` ranges (Phase 6 overlap handling).

### Cross-Phase Notes (v1 — historical)

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
- **AWS key test fixture: <MRCLEAN:AWS_KEY:001>** — AKIAIOSFODNN7EXAMPLE (the AWS docs placeholder) is in gitleaks per-rule allowlist `.+EXAMPLE$`; non-EXAMPLE key required for test to produce findings.
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
- **src/detect/findings.ts and src/detect/type-map.ts owned by 02-00** — canonical single-source-of-truth modules; Wave 2 plans import, never re-create. (v2.0 NOTE: PII source/TYPE additions go HERE — revise the owning plan first.)
- **dedupBySpan precedence: longer-span-wins, then source-order** — secretlint > gitleaks > entropy > env > words for equal-length overlap resolution. (v2.0: append pii-regex > pii-ner at the tail of SOURCE_PRECEDENCE.)
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
- **assertNoCanaryLeak checks JSON.stringify(record) substring** — normalises field order, catches partial leaks where value appears inside nested objects; ENOENT returns ok:true; malformed JSON returns ok:false with <malformed> canary. (v2.0: Phase 7 leak-grep extends this to raw PII values + error paths.)
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

**Last command:** `/gsd-new-project` → roadmapper (v2.0 milestone roadmap)
**Last action:** Created v2.0 roadmap — appended Phases 4-7 (Native-Node PII/NER Layer) to ROADMAP.md after v1 Phases 1-3; updated REQUIREMENTS.md Traceability with 14 v2.0 REQ→phase mappings; updated STATE.md totals/position.
**Stopped at:** Phase 7 context gathered
**Next action:** `/gsd-plan-phase 4` to decompose Phase 4 (PII Contracts & Architecture Foundations) into executable plans.

---
*Last updated: 2026-06-02 - v2.0 roadmap created (Phases 4-7 appended; phase numbering continued from v1)*
