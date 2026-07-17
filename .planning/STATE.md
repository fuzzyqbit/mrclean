---
gsd_state_version: 1.0
milestone: v3.0
milestone_name: Reversible Redact Mode — Foundations + Operator Restore
status: executing
stopped_at: Completed 08-12-PLAN.md (phase 08 gap-closure round 3)
last_updated: "2026-07-17T00:46:12.978Z"
last_activity: 2026-07-17
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 12
  completed_plans: 12
  percent: 100
---

# State: mrclean

> Working memory for the project. Updated by every gsd command at phase/plan transitions.

## Project Reference

**Project:** mrclean
**Core Value:** Real secrets and proprietary terms never reach the wire — the user keeps Claude Code productivity without trading away repo-level confidentiality.
**Current Focus:** Phase 08 — contract-verification-reversible-plumbing
**Project Mode:** mvp (vertical slices)
**Granularity:** coarse (3-5 phases)

## Current Position

Phase: 08 (contract-verification-reversible-plumbing) — EXECUTING
Plan: 2 of 12
Status: Ready to execute
Progress: [██████████] 100%
Last activity: 2026-07-17

## Performance Metrics

| Metric | Target | Current |
|--------|--------|---------|
| UserPromptSubmit hook latency (p95, 4 KB prompt) | < 100 ms | 17.4 ms (bench run 2026-05-14, pre-PII) |
| PostToolUse hook latency (p95, 50 KB tool result) | < 200 ms | 4.82 ms (perf gate 03-02, executor machine, 50 iterations, pre-PII) |
| Detection recall on positive fixture corpus | 100% | 100% (12/12 — 02-06 fixture corpus) |
| False-positive rate on negative fixture corpus | 0% | 0% (0/10 — 02-06 fixture corpus) |
| Line coverage on `src/` | ≥ 80% | 84.01% lines / 82.89% stmts / 82.12% funcs / 73.22% branches (03-00 baseline) |
| Regex-PII hot-path latency (p95) | < 100 / < 200 ms | TBD (Phase 5 — must stay within v1 budget with L6a enabled) |
| Reversible-mode PostToolUse overhead | ~4–8 ms typical / <60 ms contended worst-case | TBD (Phase 9/11 — research estimate; detection stays dominant cost) |
| Phase 01 P06 | 10min | 3 tasks | 9 files |
| Phase 01 P07 | 4min | 2 tasks | 1 files |
| Phase 08 P12 | 8min | 2 tasks | 7 files |

## Accumulated Context

### Decisions Made

#### Milestone v3.0 (Reversible Redact Mode — Foundations + Operator Restore)

- **Phase numbering continues from v2.0 (Phases 8–11)** — v1.0 ended at Phase 3, v2.0 at Phase 7; same-roadmap continuation per established pattern.
- **4-phase v3.0 structure** derived from research/SUMMARY.md "Implications for Roadmap", adapted for the T1 reshape (in-session hook-path restore CUT from scope): contract verification + plumbing → session state adapter → operator restore → wire-safety verification. Coarse granularity (3-5) respected.
- **T1/T2/T4/T6 decisions are MADE (2026-07-14, recorded in PROJECT.md Key Decisions)** — Phase 8 is contract *verification* + plumbing, not decision-making: no display-only hook channel exists, so no in-session restore; map = encrypted per-session file under `~/.mrclean/sessions/`; session-tagged v2 tokens in reversible mode only; `restore` MCP tool stays banned, operator-only CLI instead.
- **REVMODE-07 maps to Phase 9** (janitor runtime is the requirement's core); Phase 8 lays its installer/dispatcher groundwork (SessionEnd routing, SessionStart matcher widening `startup|resume|clear|compact`, migration) with zero behavior change.
- **REVMODE-03 maps to Phase 8** (THREAT_MODEL.md reversible section drafted from made decisions + in-phase empirical answers); Phase 11 finalizes it against the shipped implementation and locks it with the copy-drift gate (REVMODE-11 scope).
- **Verification gates named early**: Phase 11's canary round-trip / chaos / concurrency-stress gates are named in Phases 8–10 success criteria so implementations build against them, not retrofit them (research phase-ordering rule).
- **Storage-mechanics reconciliation deferred to Phase 9 planning** — append-only JSONL + lock-free hot path vs whole-file encrypt + short locked transaction, plus key layout; invariants already converged (SUMMARY.md T2), so it's a plan-phase design pin, not new research.
- [Phase 08-12]: atomicWriteJson owns parent-dir creation (recursive mkdir before tmp write) — every JSON writer fresh-HOME safe, matching ignore.ts/project-dir.ts precedent
- [Phase 08-12]: install banner count derives from exported HOOK_EVENTS.length, test-locked to the on-disk _mrclean ground truth (survives future HOOK_EVENTS changes)

### Phase → Requirement Mapping (v3.0)

| Phase | Requirements | Count |
|-------|--------------|-------|
| Phase 8 — Contract Verification & Reversible Plumbing | REVMODE-10, REVMODE-03 | 2 |
| Phase 9 — Session State Adapter | REVMODE-02, REVMODE-04, REVMODE-05, REVMODE-06, REVMODE-07 | 5 |
| Phase 10 — Operator Restore | REVMODE-01, REVMODE-08, REVMODE-09, REVMODE-12 | 4 |
| Phase 11 — Wire-Safety Verification & Hardening | REVMODE-11 | 1 |
| **Total v3.0** | | **12** |

#### Milestone v2.0 (Native-Node PII/NER Layer) — shipped 2026-06-03

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
- **PII placeholder reversibility deferred** — one-way PII redaction only this milestone; ties to the REVMODE backlog. (Now active: v3.0.)
- [Phase ?]: Phase 01 gap-closure (01-06): the installer writes a fail-closed POSIX /bin/sh hook wrapper so ANY inner failure of node<bin>hook (missing bin, ENOENT, exit 1, module-not-found, signal) remaps to exit 2 — closes the SC4/HOOK-05 fail-open hole where a deleted bin silently disabled protection. Proven deterministically via spawnSync (no live Claude needed).
- [Phase ?]: win32 hook stays plain-exec form (documented known-gap, fail-OPEN on spawn failure) — the cmd.exe nested-quote wrapper is fragile/untested; a mis-quote would false-BLOCK every tool call, so no wrapper ships for win32 this plan.
- [Phase ?]: Doctor extracts node+bin from the wrapper arg tail (args[len-2]/args[len-1]) with a legacy/win32 fallback keyed on args[0] ending in '.js'; bins-missing FAIL now reports the fail-closed block-until-reinstall consequence (exit 2).

### Phase → Requirement Mapping (v2.0) — historical

| Phase | Requirements | Count |
|-------|--------------|-------|
| Phase 4 — PII Contracts & Architecture Foundations | PII-03, MODEL-01, PIISEC-03 | 3 |
| Phase 5 — Regex PII Hot-Path Lane (L6a) + Model Acquisition | PII-01, PII-02, MODEL-02, MODEL-03 | 4 |
| Phase 6 — NER Inference (L6b) + MCP Wiring | NER-01, NER-02, NER-03, NER-04, MODEL-04 | 5 |
| Phase 7 — PII Security Hardening & Honest Framing | PIISEC-01, PIISEC-02 | 2 |
| **Total v2.0** | | **14** |

### Open Todos

- [ ] Run `/gsd-plan-phase 8` — `--research-phase` recommended (live headless contract experiments: `updatedToolOutput` terminal rendering, `updatedInput` context echo, `session_id` continuity across `--resume`, 10K-char cap; UAT-2b harness precedent)
- [ ] Phase 9 planning: pin storage mechanics (append-only JSONL + lock-free hot path vs whole-file encrypt + short locked transaction) and key layout (separate `~/.mrclean/keys/` dir favored) — invariants converged, design pin only
- [ ] Phase 9/10 deps: `proper-lockfile@^4.1.2`, `write-file-atomic@^7.0.1` (PIN — do NOT float to ^8, breaks Node 20 floor); guard the major in dependabot/renovate
- [ ] Phase 10 early: per-tool empirical verification of structured `tool_response` shapes (docs only show Bash string example)

#### v2.0 milestone todos — historical (shipped 2026-06-03)

- [x] All Phase 4–7 plans — COMPLETE (12 plans, 19 tasks)
- [x] Phase 5/6 research spike (NER benchmarks, transformers v4 import paths) — resolved during v2.0

#### v1 milestone todos (Phases 1-3) — historical

- [x] All Phase 1 plans (01-01..01-05) — COMPLETE (+ 01-06/01-07 gap-closure 2026-07-13)
- [x] All Phase 2 plans (02-00..02-06) — COMPLETE
- [x] All Phase 3 plans (03-00..03-05) — Tasks complete; 03-05 Task 3 = checkpoint:human-action (first manual publish)

### Blockers

- v1 carryover: Task 3 (checkpoint:human-action): Maintainer must run first-publish manually (npm login + npm publish --access public). See docs/RELEASE.md. After publish, tag v1.0.0-rc.1 and push. (Does not block v3.0 planning.)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260601-0e1 | Fix misleading install stub (dead [words]/[detection] keys) | 2026-06-01 | 1afefec | [260601-0e1-fix-install-stub-dead-keys](./quick/260601-0e1-fix-install-stub-dead-keys/) |
| 260601-1sw | `mrclean init` CLI subcommand + /mrclean:mrclean-init slash command | 2026-06-01 | 0d12c88 | [260601-1sw-mrclean-init-command](./quick/260601-1sw-mrclean-init-command/) |
| 260601-2fj | uninstall surgically removes only mrclean entries (no wholesale restore) | 2026-06-01 | ca2891a | [260601-2fj-uninstall-surgical](./quick/260601-2fj-uninstall-surgical/) |

### Cross-Phase Notes (v3.0)

- Phase 8's `[reversible]` config table + SessionEnd/SessionStart plumbing is the contract Phases 9–10 build on; it must land with zero behavior change (byte-identical one-way default, proven by existing suites).
- Phase 8's empirical contract answers gate design freezes downstream: `session_id` continuity across `--resume` decides whether Phase 9's retain-on-resume rehydration is real or dead code; `updatedInput` echo decides whether input-side restore stays deferred (currently scoped out).
- Phase 9's secret floor is enforced at map-WRITE time — it must ship with (not after) the store, or a window exists where secret originals sit in shared state.
- Phase 9's content-addressed allocation fixes the latent v1/v2 cross-process counter-collision gap — standalone value even if restore slips.
- Phase 10's `restoreText()` lives in `src/restore/` (opposite trust direction from `src/placeholder/` — it *introduces* sensitive data); never reuse `substituteFindings`. Restore = map lookup only, never re-detection, never position-based, never fuzzy.
- Phase 11's gates are named in Phases 8–10 criteria (canary round-trip, fs-write interception, chaos, 8–16-process stress) — build against them from the start; all extend shipped harnesses (UAT-2b, leak-grep, copy-drift).
- Error-domain split is load-bearing everywhere: redact stays fail-closed, restore fails one-way (safe); no shared kill switch — chaos test proves a canary is still redacted after restore breaks.

### Cross-Phase Notes (v2.0 — historical)

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
- **Module-level WorkerPool + PlaceholderManager cache:** Map<sessionId, PlaceholderManager> ensures placeholder stability across calls; shutdownDetection() resets both on process exit. (v3.0 NOTE: reversible mode replaces per-process counter allocation with content-addressed allocation under shared session state — Phase 9.)

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
- **PlaceholderManager global counter (not per-TYPE)** — PH-03 collision-free across TYPEs; operator mental model is "the Nth thing redacted this session", not "the Nth AWS key". (v3.0 NOTE: reversible mode's counter must survive process restarts via the shared session store — Phase 9.)
- **OVF path is non-fatal (stderr JSON warning, not throw)** — hook is in Claude Code hot path; blocking the user on >999 unique secrets would be worse than degraded placeholder labels. (v3.0 NOTE: OVF tokens are never restored — pass through unchanged, Phase 10.)
- **assertNoCanaryLeak checks JSON.stringify(record) substring** — normalises field order, catches partial leaks where value appears inside nested objects; ENOENT returns ok:true; malformed JSON returns ok:false with <malformed> canary. (v2.0: Phase 7 leak-grep extends this to raw PII values + error paths. v3.0: Phase 10 extends over map artifacts + restore code/error paths.)
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

**Last command:** `/gsd:new-project` (roadmap step for v3.0)
**Last action:** v3.0 roadmap created — Phases 8–11 appended to ROADMAP.md (numbering continued from v2.0), 12/12 REVMODE requirements mapped, REQUIREMENTS.md traceability filled, STATE.md updated.
**Stopped at:** Completed 08-12-PLAN.md (phase 08 gap-closure round 3)
**Next action:** `/gsd-plan-phase 8` — `--research-phase` recommended (live headless contract experiments; UAT-2b harness precedent)

---
*Last updated: 2026-07-14 — v3.0 roadmap created (Phases 8–11 appended; phase numbering continued from v2.0)*

## Operator Next Steps

- Run `/gsd-plan-phase 8` (research-phase recommended: live headless contract verification)

## Deferred Items

Items acknowledged and deferred at v2.0 milestone close on 2026-06-03 (pre-close artifact audit found 5 open). **Re-audited 2026-07-14 — 4 of 5 resolved:**

| Category | Item | Status |
|----------|------|--------|
| debug | stub-dead-keys-issue | resolved (fix shipped in 1afefec) |
| quick_task | 260601-0e1-fix-install-stub-dead-keys | shipped 2026-06-01 (1afefec; dir + SUMMARY present) |
| quick_task | 260601-1sw-mrclean-init-command | shipped 2026-06-01 (0d12c88; later fixed in rc.9 a76d0ed) |
| quick_task | 260601-2fj-uninstall-surgical | shipped 2026-06-01 (ca2891a; roundtrip test asserts surgical removal) |
| verification_gap | Phase 01 SC4/HOOK-05 UAT item | resolved 2026-07-13 (fail-closed wrapper 01-06 + live UAT 01-07) |

The 2026-06-03 audit's "missing" statuses were stale — the quick-task directories exist at `.planning/quick/` with PLAN + SUMMARY, and all three commits are in history.

### v3.0 deferred (from requirements, 2026-07-14)

- In-session restore on the return path — v3.x fast-follow if/when Claude Code ships a display-only rewrite channel (upstream request filed under REVMODE-10, Phase 8)
- PreToolUse input-side restore for local tools — only if Phase 8's `updatedInput` echo verification proves it safe
- Delimiter/case-tolerant token matching + near-miss audit — only on field evidence of model-mangled tokens (never Levenshtein)
- Keychain-backed key custody (POLISH-03) — `getMachineKey()` is the single swap point
- Layer 5 `--deep` LLM classifier — planned v4.0
