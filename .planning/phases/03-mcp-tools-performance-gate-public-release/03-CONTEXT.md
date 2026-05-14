# Phase 3: MCP Tools, Performance Gate, Public Release — Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Source:** Locked from REQUIREMENTS.md + ROADMAP.md success criteria; gray-area defaults selected by Claude under autonomous mode (user can override before plan-phase).

<domain>
## Phase Boundary

Close the loop from "works on maintainer's machine" to "anyone can `npm install -g mrclean` and get the same result." Five concrete proofs:

1. Explicit on-demand MCP tool surface (`mrclean_check` / `mrclean_redact` / `mrclean_status`) usable inside a real Claude Code session via `mcp__mrclean__*`. NO `unredact` exposed (model-facing surface is read/transform only — Pitfall #10 defense).
2. CI-enforced perf gate: vitest budget fails build if `UserPromptSubmit` p95 > 100ms on 4KB prompt OR `PostToolUse` p95 > 200ms on 50KB output.
3. README with "gitleaks for what reaches your repo, mrclean for what reaches the model" layering FAQ + `THREAT_MODEL.md` enumerating non-defenses (multimodal images, model memorization, prompt-injection of the operator, etc.).
4. Public npm publish under MIT — `npm install -g mrclean` → `npx mrclean install` on a clean machine reproduces every Phase 1+2 success criterion with no source checkout.
5. `npm test` → ≥80% line coverage on `src/`, integration tests for every hook event in HOOK-01, CI canary-leak test gating audit log.

NOT in this phase: reversible mode (v2 REVMODE), Layer 5 LLM classifier (v2 LLM5), cross-session placeholder stability (v2 POLISH-02), team policy server (out of scope), telemetry (banned).

</domain>

<decisions>
## Implementation Decisions

All decisions trace to REQUIREMENTS.md REQ-IDs unless marked **[discretion]**.

### MCP Tool Surface (MCP-02, MCP-03)

- **Three tools registered, exactly:** `sanitize` is renamed to `check` per success criterion #1 wording; `restore` is renamed to `redact`; `audit_query` is renamed to `status`. **[discretion-correction]** Phase 1 shipped placeholder stubs named `sanitize`/`restore`/`audit_query` — but ROADMAP success criterion #1 names the tools `mcp__mrclean__check`, `mcp__mrclean__redact`, `mcp__mrclean__status`. Phase 3 renames + implements. Phase 1's stubs were named pre-spec-finalization; renaming is the right call.

  - **`mrclean_check(text)`:** runs `runDetection` on the provided text, returns the findings list (rule-id, severity, span, redactedHash, fingerprint — NEVER raw value). No mutation. No audit-log write (read-only by design — the operator may be sampling text speculatively).
  - **`mrclean_redact(text)`:** runs `runDetection`, returns `{ redacted: string, findings: Finding[] }` — the placeholder-substituted version of the input plus metadata. Audit log IS written (a real transform of operator-supplied text is happening).
  - **`mrclean_status()`:** returns `{ version, rule_count, allowlist_count, mode, session_id, audit_log_path }`. No side effects.
  - All three use Zod v4 input + output schemas; all inputs validated; bad inputs → SDK error response (the SDK supervisor handles crash isolation).
- **NEVER exposed (Pitfall #10):** `unredact`, `disable`, `add_word`, `config_write`, `ignore`. Phase 1's stubs included `restore` as a placeholder; the v1 `redact` tool emphatically does NOT have a reverse path. `unredact` arrives in v2 REVMODE phase via PostToolUse handler (server-side, deterministic, NOT via MCP). **[locked by REQUIREMENTS.md MCP-03]**
- **Backwards compat:** the old tool names (`sanitize`/`restore`/`audit_query`) are NOT kept as aliases. Phase 1 was internal-only; mrclean has not yet been published. Rename cleanly.
- **Transport:** stdio default (matches Phase 1). `--transport http` opt-in for Streamable HTTP per MCP-01 (already wired in Phase 1; Phase 3 just registers the new tool surface against the existing transport setup).
- **Supervisor:** MCP-04 says "crashes are isolated by a supervisor that restarts a worker process." Phase 1 shipped single-process server; this phase adds the supervisor. **[discretion]** Worker-thread isolation per tool call: each tool invocation runs in a worker; supervisor catches uncaught crashes + restarts. Reuses the worker_threads infrastructure from Phase 2's ReDoS pool — same primitive, different consumer. Simpler than spawning a child node process.

### Performance Gate (PERF-01, PERF-02, PERF-03)

- **Budget:** UserPromptSubmit p95 ≤ 100ms on a 4 KB prompt; PostToolUse p95 ≤ 200ms on a 50 KB tool result. Measured over N=50 iterations per event. **[from REQUIREMENTS.md PERF-01]**
- **Test runner:** vitest with a dedicated `tests/perf/*.bench.test.ts` suite. Use `bench()` blocks (vitest's built-in micro-benchmark API; native ESM). Fail on assertion gates inside the bench callback, NOT via threshold-only output — explicit `expect(p95).toBeLessThanOrEqual(100)`. **[discretion]** Vitest's `bench()` reports percentiles natively; assertion-on-percentile is the cleanest path that doesn't require a side-car library.
- **Reference machine:** GitHub Actions `ubuntu-latest` (2-core Standard runner). Pin in `tests/perf/README.md` so a maintainer running locally knows their numbers won't match the CI gate. **[discretion]** Local machines vary; the CI runner is the only stable baseline. Document the maintainer's local machine numbers in the README for reference but only ubuntu-latest counts.
- **CI integration:** new GitHub Actions workflow `.github/workflows/perf.yml` runs `vitest run tests/perf/` on every push to main + every PR. Failure fails the build. **[discretion]** Separate workflow from the main test suite so flaky perf doesn't block fast unit-test feedback.
- **Compile-once enforcement (PERF-03):** Add a grep gate test asserting every `new RegExp(...)` in `src/detect/` is at module scope or inside a `Once<...>` lazy-init pattern, never inside a hot-path function body. Catch regressions where someone moves compilation into a per-call function.
- **Bench fixtures:** 4 KB prompt = Lorem ipsum + 5 random secret-shape patterns (from Phase 2 fixture corpus, checksum-flipped). 50 KB tool result = real-shape package-lock.json snippet (~50 KB, no real secrets).

### Documentation (DOC-01, DOC-02, DOC-03)

- **README.md (DOC-01):** must include the gitleaks layering FAQ verbatim per success criterion #3: "gitleaks for what reaches your repo, mrclean for what reaches the model." Sections (in order):
  1. **Tagline:** "Stop secrets at the Claude Code wire. Local. Deterministic. No telemetry."
  2. **What it does** — 60-second summary + the gitleaks layering line
  3. **Install** — `npm install -g mrclean` + `npx mrclean install`
  4. **Verify** — `npx mrclean doctor`
  5. **Configure** — `.mrclean/config.toml` minimal example + `[allowlist]` 5-axis cheat sheet
  6. **Dirty word list** — `.mrclean/words.txt` syntax + `word|action` override
  7. **Uninstall** — `npx mrclean uninstall`
  8. **Modes** — `dry_run` trust-building first-run
  9. **MCP tools** — `mcp__mrclean__check` / `mcp__mrclean__redact` / `mcp__mrclean__status`
  10. **Compatibility** — Node ≥20.18, Claude Code ≥2.1.121
  11. **What this does NOT defend against** — link to THREAT_MODEL.md
  12. **License** — MIT
- **THREAT_MODEL.md (DOC-02):** enumerate non-defenses:
  - Multimodal / pasted-image OCR scanning (out of scope; OCR is its own product)
  - Model memorization of training-time leaks
  - Prompt-injection of the *operator* (someone gets the operator to ignore mrclean's warnings)
  - Adversarial obfuscation (homoglyph substitution, base64-encoded variants beyond the obvious shapes)
  - Cross-session placeholder map persistence (not yet — v2)
  - LLM Layer 5 semantic detection (opt-in v2)
  - Verified-secret enrichment via vendor APIs (out of scope)
  - Network-level interception of the Claude API itself (mrclean is in-session, not a proxy)
  - Pre-commit / git-history scanning (gitleaks owns that — Pitfall #12)
- **CHANGELOG (DOC-03):** `changesets` toolchain. Initial 1.0.0 entry summarizes Phase 1 + Phase 2 + Phase 3 deliverables. Subsequent entries authored per-PR via `npx changeset add`.
- **License:** MIT per DOC-03. `LICENSE` file at repo root.

### Quality Gates (QA-01, QA-02, QA-03)

- **Coverage (QA-01):** ≥80% line coverage on `src/` measured by `@vitest/coverage-v8`. Threshold enforced in `vitest.config.ts` via `coverage.thresholds = { lines: 80, statements: 80, functions: 75, branches: 70 }`. **[discretion]** Branch/function thresholds lowered slightly because edge-case branches (worker-pool failure paths, OVF placeholder warnings, fail-closed exits) are hard to cover without nondeterminism injection. Lines+statements stay at 80 per REQUIREMENTS.md.
- **Integration coverage (QA-02):** at least one integration test per hook event in HOOK-01 (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse). These already exist (Phase 2 added them); Phase 3 verifies and tags them so CI can assert their presence.
- **Canary-leak CI gate (QA-03):** Phase 2 shipped `assertNoCanaryLeak`. Phase 3 wires it into a dedicated CI job that runs the full fixture corpus through `runDetection` and asserts `grep` of any fixture-secret value against `.mrclean/audit.jsonl` returns 0. Fails the CI build on regression.
- **Fixture corpus enforcement (QA-03):** the 100% positive recall + 0 false-positive corpus test from Phase 2 (`tests/fixtures-corpus.test.ts`) is tagged as a release-gate test. CI fails if any positive fixture is added that no rule catches OR any negative fixture starts producing findings.
- **Parallel test pollution remediation:** **[discretion]** Phase 2 surfaced a test isolation issue where parallel runs race on HOME/cwd state. Phase 3 fixes this by:
  - Marking `tests/install/*.test.ts`, `tests/doctor/end-to-end.test.ts`, `tests/hook/integration-*.test.ts` with vitest's `concurrent: false` per-file annotation, OR
  - Setting `poolOptions.threads.singleThread: true` for the affected suites via `vitest.config.ts` `test.fileParallelism` overrides.
  - The single-threaded run already passes 359/359 — Phase 3 hardens this into the default test invocation rather than requiring `--no-file-parallelism` from operators.

### npm Publish (DOC-03)

- **Package name:** `mrclean` per REQUIREMENTS.md DOC-03. If the npm name is taken, escalate to operator (this is a publish-time check Phase 3 must make BEFORE finalizing — don't burn cycles on packaging then discover the name is gone). **[discretion]** Run `npm view mrclean` early; if exists + maintained by someone else, halt + ask operator for an alternative.
- **Publish pipeline:** `changesets` + GitHub Actions. PR adds a changeset; merge to main triggers an automated PR that bumps version + writes the CHANGELOG entry; manual approve of that PR triggers `npm publish` with `--provenance` flag (npm sigstore attestation, free, defaults-on as of npm 9.5+).
- **First-publish auth:** the maintainer publishes 1.0.0 manually with `npm login` + `npm publish --provenance` from their local machine. Subsequent versions automate via the changesets PR flow. **[discretion]** First publish is high-stakes; do it locally to feel the friction once.
- **`package.json#files`:** ship only `dist/`, `vendor/gitleaks-rules.toml`, `vendor/SKIPPED_GITLEAKS_RULES.md`, `README.md`, `LICENSE`, `THREAT_MODEL.md`, `CHANGELOG.md`. Explicitly exclude `dist/detect-layer1*` (Phase 2 test-only entry), `tests/`, `.planning/`, `scripts/`. Grep gate already in Phase 2; this phase tightens it.
- **`engines.node`:** `>=20.18.0` per CLAUDE.md.
- **No `engines.claude-code` constraint:** npm doesn't honor non-npm engines, but Phase 2's doctor enforces ≥2.1.121 at runtime — that's the right place for the check.
- **Two-bin entry:** `mrclean` (CLI + hook + ignore + doctor) and `mrclean-mcp` (long-lived MCP server). Already wired in Phase 1; Phase 3 verifies the npm tarball contents.
- **Provenance + attestation:** opt-in via `npm publish --provenance`. Builds run on GitHub Actions; sigstore attestation publishes a verifiable build provenance to the npm registry. **[discretion]** Standard practice for security tools published to npm in 2026.

### Clean-machine reproducibility (Success Criterion #4)

- **CI smoke job:** `.github/workflows/release-smoke.yml` runs after publish, spins up a fresh ubuntu runner, runs `npm install -g mrclean@<published-version>`, then exercises Phase 1 + Phase 2 success criteria headlessly (install / doctor / hook canary / MCP tool list / corpus test on a curl'd fixture pack). Failure rolls back the npm tag via `npm dist-tag rm`. **[discretion]** Belt-and-suspenders for the first release; can simplify later.
- **Node version matrix:** test against `20.18`, `20.x`, `22.x`. Refuses to install on Node 18 (CLAUDE.md floor).

### Claude's Discretion (recap)

The following calls were made by Claude under autonomous mode. Override before plan-phase if any are wrong:

- Rename Phase 1's `sanitize`/`restore`/`audit_query` to `check`/`redact`/`status` (matches ROADMAP success criterion #1; no aliases retained).
- MCP supervisor uses worker_threads (reuses Phase 2 pool primitive).
- Vitest's `bench()` API with `expect(p95).toBeLessThanOrEqual(...)` inside the callback for the PERF gate.
- Reference machine = GitHub Actions ubuntu-latest 2-core.
- Coverage thresholds: lines 80 / statements 80 / functions 75 / branches 70.
- README structure (12-section outline).
- THREAT_MODEL.md content list (9 non-defenses).
- npm publish flow: first release manual + provenance; subsequent automated via changesets.
- `dist/detect-layer1*` excluded from `package.json#files` (already in Phase 2; Phase 3 tightens).
- Fix Phase 2's parallel test pollution by per-file `concurrent: false` annotations or vitest config override.
- Post-publish smoke job on a fresh ubuntu runner exercising Phase 1+2 success criteria headlessly.

### Out of Scope Reminders

- Reversible mode / `unredact` — v2 REVMODE.
- Layer 5 LLM classifier — v2 LLM5-01.
- Cross-session deterministic placeholders — v2 POLISH-02.
- Encrypted at-rest persistence (keychain integration) — v2 POLISH-03.
- Sidecar daemon — v2 PERF-04 if profiling demands it.
- Team policy server — out of scope.
- Telemetry / phone-home — explicit ban.
- Multimodal scanning — out of scope.
- Pre-commit / git-hook integration — gitleaks owns that surface.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before researching or planning.**

### Project / requirements
- `.planning/REQUIREMENTS.md` — MCP-02/03, PERF-01..03, DOC-01..03, QA-01..03 canonical text
- `.planning/ROADMAP.md` — Phase 3 section + 5 success criteria
- `.planning/PROJECT.md` — pitfalls (#10 prompt-injection MCP bypass; #12 gitleaks-vs-mrclean overlap)
- `CLAUDE.md` — locked stack pins: Node>=20.18, TS^5.6, `@modelcontextprotocol/sdk ^1.x`, `commander ^13.x`, `zod/v4`, `tsup`, `vitest ^4`, `@vitest/coverage-v8 ^4.1`, `changesets ^2.x`

### Prior phase context
- `.planning/phases/01-wired-skeleton/01-SKELETON.md` — two-bin layout, banner architecture
- `.planning/phases/01-wired-skeleton/01-RESEARCH.md` — hook contract (§1), MCP registration (§2), pitfalls (§8)
- `.planning/phases/01-wired-skeleton/01-04-SUMMARY.md` — MCP server + lifecycle module (Phase 3 RENAMES the 3 tools + adds supervisor)
- `.planning/phases/01-wired-skeleton/01-05-SUMMARY.md` — doctor: `computeDoctorReport` + `runDoctor` (Phase 3 adds the smoke-job invocation surface)
- `.planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md` — layer architecture, placeholder format, hook field-name corrections
- `.planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md` — gitleaks 39-skipped, worker_threads ReDoS, smol-toml usage
- `.planning/phases/02-live-redaction-layers-1-4-one-way/02-01-SUMMARY.md` — worker pool (reused as MCP supervisor primitive)
- `.planning/phases/02-live-redaction-layers-1-4-one-way/02-04-SUMMARY.md` — `runDetection` orchestrator (the MCP tools wrap this)
- `.planning/phases/02-live-redaction-layers-1-4-one-way/02-05-SUMMARY.md` — hook integration; doctor 2.1.121 floor
- `.planning/phases/02-live-redaction-layers-1-4-one-way/02-06-SUMMARY.md` — bench stub + fixture corpus + canary-leak helper (Phase 3 wires these into CI)
- `.planning/phases/02-live-redaction-layers-1-4-one-way/02-VERIFICATION.md` — Phase 2 verification results

### Upstream specs (for researcher to verify)
- npm `--provenance` docs: https://docs.npmjs.com/generating-provenance-statements
- changesets workflow: https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md
- Vitest `bench()` API: https://vitest.dev/api/#bench
- GitHub Actions `ubuntu-latest` runner specs: https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners/about-github-hosted-runners
- MCP TypeScript SDK tool registration with structured outputs: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md

</canonical_refs>

<specifics>
## Specific Ideas

- **MCP tool implementation layout (researcher should validate):**
  - `src/mcp/tools/check.ts` — REPLACES Phase 1's `sanitize.ts`
  - `src/mcp/tools/redact.ts` — REPLACES Phase 1's `restore.ts`
  - `src/mcp/tools/status.ts` — REPLACES Phase 1's `audit-query.ts`
  - `src/mcp/supervisor.ts` — NEW; worker_threads pool wrapping each tool call
  - `src/mcp/server.ts` — UPDATE registrations
  - Delete `src/mcp/tools/sanitize.ts`, `restore.ts`, `audit-query.ts`

- **PERF gate layout:**
  - `tests/perf/user-prompt-submit.bench.test.ts` — vitest `bench()` over 50 iterations
  - `tests/perf/post-tool-use.bench.test.ts` — same
  - `tests/perf/fixtures/4kb-prompt.txt` — Lorem + 5 secret shapes
  - `tests/perf/fixtures/50kb-tool-output.txt` — package-lock-style JSON
  - `tests/perf/README.md` — reference machine pin
  - `.github/workflows/perf.yml` — Actions workflow

- **Docs:**
  - `README.md` — replace any Phase 1 stub
  - `THREAT_MODEL.md` — new file
  - `CHANGELOG.md` — new file (changesets generates ongoing entries)
  - `LICENSE` — MIT
  - `.changeset/` directory — changesets config

- **Release:**
  - `.github/workflows/release.yml` — changesets PR + npm publish flow
  - `.github/workflows/release-smoke.yml` — post-publish reproduction job
  - `package.json` — `files`, `engines`, `bin`, `repository`, `homepage`, `keywords`, `license` filled out

- **Cleanup of Phase 1 tool stubs:** Phase 1 left tests against `sanitize`/`restore`/`audit_query`. Phase 3 either updates those tests to the new names OR adds a deletion task. **[discretion]** Update in place; the rename is internal — keeping deleted code as backup pollutes the repo.

</specifics>

<deferred>
## Deferred Ideas

- Reversible mode + REVMODE-01..03 (v2)
- Layer 5 LLM classifier + LLM5-01 (v2 opt-in)
- POLISH-01 `mrclean report` session-summary command (v2)
- POLISH-02 HMAC-based cross-session deterministic placeholders (v2)
- POLISH-03 encrypted at-rest map via OS keychain (v2)
- PERF-04 sidecar daemon (v2 if profiling demands it)
- Multi-AI-tool integrations (Cursor / Copilot / ChatGPT-desktop) — validate Claude Code thesis first
- Team policy server with central rule distribution — single-developer workflow first
- npm `--provenance` extending to attestations of supply-chain bom inclusion — investigate post-1.0 if community demands
- Auto-bump tool: dependabot for the vendored gitleaks rules — Phase 3 ships the regenerator script; automatic refresh in CI is a follow-up
- Telemetry / hashed analytics — explicitly banned forever (privacy product)

</deferred>

---

*Phase: 03-mcp-tools-performance-gate-public-release*
*Context gathered: 2026-05-14 under autonomous mode — most decisions locked by REQUIREMENTS.md; Claude-discretion choices marked **[discretion]** in the body.*
