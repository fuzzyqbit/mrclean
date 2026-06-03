# Roadmap: mrclean

> Vertical-slice MVP roadmap. Each phase delivers a capability the operator can verify by running `npx mrclean ...` and observing real Claude Code behavior. No "library only" phases.

**Granularity:** coarse (3-5 phases)
**Project mode:** mvp (vertical slices, end-to-end)
**Coverage:** v1 — 54/54 requirements mapped (100%). v2.0 — 14/14 requirements mapped (100%).

## Phases

> Milestone v1 (Phases 1-3) shipped 2026-05-14. Milestone v2.0 (Phases 4-7) adds the opt-in Native-Node PII/NER layer.

- [x] **Phase 1: Wired Skeleton** - `npx mrclean install` lands a working hook + MCP server in Claude Code; operator sees the "mrclean active" banner and `mrclean doctor` reports green — no real detection yet, but the integration is provably alive
- [x] **Phase 2: Live Redaction (Layers 1-4 + One-Way)** - Real secrets pasted into a Claude Code session are blocked-with-reason on prompts and substituted with stable `<MRCLEAN:TYPE:NNN>` placeholders in tool calls; `.env` values, regex hits, entropy, and project word-list all caught; audit log records hash-only entries
- [x] **Phase 3: MCP Tools, Performance Gate, Public Release** - Operator can invoke `mrclean_check / mrclean_redact / mrclean_status` from inside Claude Code; CI enforces `<100ms / <200ms` budgets; README + THREAT_MODEL ship; `npm install -g mrclean-claude` installs the published 1.0.0 package (completed 2026-05-14)
- [ ] **Phase 4: PII Contracts & Architecture Foundations** - The load-bearing v2.0 decisions are locked in code before any model exists: a `[pii]` config sub-table (off by default), PII finding-shape + audit-schema additions, ML deps as `optionalDependencies`, and a documented+enforced scope fence — the core secret tool is provably unchanged
- [ ] **Phase 5: Regex PII Hot-Path Lane (L6a) + Model Acquisition** - Structured PII (email/SSN/credit-card/phone/IP) is caught in-session within the existing perf budget with no model, flowing through the existing placeholder/audit/allowlist pipeline; the model download/cache/integrity/side-load infra is built and verifiable via `mrclean doctor`
- [ ] **Phase 6: NER Inference (L6b) + MCP Wiring** - Opt-in PERSON/ORG/LOCATION detection runs as a warm singleton inside the long-lived MCP server only (never the hook), advisory-by-default, fail-closed-for-NER, with model revision/quant/backend recorded in every PII audit entry
- [ ] **Phase 7: PII Security Hardening & Honest Framing** - A leak-grep regression test proves no raw PII reaches audit logs or error paths, and all user-facing copy frames the PII/NER layer as a best-effort recall aid — not a guarantee — closing the trust surface a security tool is held to

## Phase Details

### Phase 1: Wired Skeleton
**Goal**: Operator can install mrclean into Claude Code and see, in a real session, that it is wired in correctly — even though detection is still a no-op. Establishes the persistent-MCP architecture, fail-closed exit semantics, and absolute-path resolution from day one so silent-misconfig (Pitfall #7) and silent-MCP-crash (Pitfall #8) cannot regress later.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: INST-01, INST-02, INST-03, INST-04, INST-05, INST-06, INST-07, INST-08, HOOK-01, HOOK-05, HOOK-06, HOOK-07, MCP-01, MCP-04, AUDIT-03, CFG-01, CFG-03
**Success Criteria** (what must be TRUE):
  1. Operator runs `npx mrclean install` on a fresh machine and the next `claude` session prints `mrclean active vN.N.N` to stderr — no editing of `~/.claude/settings.json` required
  2. Operator runs `npx mrclean doctor` and gets a green PASS with a seeded canary string round-trip, plus a Claude Code version compatibility report
  3. Operator runs `npx mrclean install` a second time, then `npx mrclean uninstall`, and `~/.claude/settings.json` ends up byte-identical to the pre-install backup (idempotent + clean removal)
  4. Operator deliberately corrupts the mrclean bin (e.g., `chmod -x`) and observes that Claude Code blocks the next tool call with exit code 2 and a structured stderr message — never silently passes through
  5. `.mrclean/` exists in the project after first run with a `.gitignore` entry for itself, the audit log, and session artifacts; `git status` shows nothing to commit
**Plans**: 5 plans
  - [x] 01-01-PLAN.md — Project scaffold (package.json, tsup, vitest, src/ skeleton with two bin entrypoints)
  - [x] 01-02-PLAN.md — `mrclean install` / `uninstall` with atomic JSON edits, absolute-path resolution, `.mrclean/` setup, gitignore
  - [ ] 01-03-PLAN.md — Hook handler (no-op detection) with fail-closed exit semantics + "mrclean active" wiring banner via additionalContext
  - [ ] 01-04-PLAN.md — Long-lived stdio MCP server with three no-op tool stubs (sanitize, restore, audit_query) and Zod v4 schemas
  - [ ] 01-05-PLAN.md — `mrclean doctor` orchestrator: install-state checks, canary round-trip through hook + MCP, Claude Code version compatibility report

### Phase 2: Live Redaction (Layers 1-4 + One-Way)
**Goal**: Operator pastes a real AWS key, GitHub token, JWT, or `.env`-derived value into a Claude Code prompt or tool argument and observes mrclean catching it in-session. This is the value-delivery slice — the moment mrclean stops being a wired-up shell and starts actually preventing leaks. Layers 1-4 ship together with the placeholder manager and one-way hook integration so an end-to-end proof exists in one phase.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: DET1-01, DET1-02, DET1-03, DET1-04, DET2-01, DET2-02, DET2-03, DET3-01, DET3-02, DET3-03, DET4-01, DET4-02, DET4-03, PH-01, PH-02, PH-03, PH-04, HOOK-02, HOOK-03, HOOK-04, AUDIT-01, AUDIT-02, MODE-01, MODE-02, CFG-02, CFG-04
**Success Criteria** (what must be TRUE):
  1. Operator pastes a real-shape AWS access key into a Claude Code prompt and the prompt is blocked with a structured top-level `reason` field naming the rule and a redacted snippet — the unredacted value never reaches the model
  2. Operator runs a `Bash` tool call containing a `Bearer sk_live_…` token and the executed command sees `<MRCLEAN:STRIPE_KEY:001>` in place of the secret; the same token referenced twice in the session yields the same placeholder both times
  3. Operator drops a value into `.env` and a project-specific term into `.mrclean/words.txt`, restarts the session, then references both in a prompt — both are caught by Layer 3 / Layer 4 with no manual config beyond the two files
  4. Operator points mrclean at the committed fixture corpus (real package-lock.json, git diffs, OpenAPI spec) and observes 100% recall on the positive-secret fixtures and zero false positives on the UUID/git-SHA/hash negative corpus
  5. Operator inspects `.mrclean/audit.jsonl` after a session and finds one JSONL record per detection containing `redactedHash` and `fingerprint` only — `grep` for any seeded fixture secret string returns zero hits
  6. Operator sets `dry_run = true` in `.mrclean/config.toml` and re-runs the same secret-laden prompt — detections appear in the audit log but nothing is blocked or substituted (trust-building first-run mode works)
**Plans**: 7 plans
  - [x] 02-00-deps-config-schema-toml-migration-PLAN.md — Phase 2 runtime deps + smol-toml migration + MrcleanConfig extension (CFG-02 schema)
  - [x] 02-01-layer1-regex-engine-PLAN.md — Secretlint + vendored gitleaks rule pack + ReDoS-safe worker pool (DET1-01..04)
  - [x] 02-02-layers-2-3-4-PLAN.md — Shannon entropy + .env extraction + words.txt + SessionState (DET2/3/4)
  - [x] 02-03-placeholder-manager-audit-log-PLAN.md — `<MRCLEAN:TYPE:NNN>` manager + JSONL audit log + canary-leak helper (PH-01..04, AUDIT-01/02)
  - [x] 02-04-detection-orchestrator-dry-run-PLAN.md — runDetection orchestrator + dry_run coercion (MODE-01/02)
  - [x] 02-05-hook-integration-PLAN.md — UserPromptSubmit block + PreToolUse/PostToolUse substitute + long-form banner + `mrclean ignore` (HOOK-02/03/04, CFG-04)
  - [x] 02-06-fixtures-bench-stub-PLAN.md — Positive + negative fixture corpus + doctor `--bench` stub (proves success criterion #4)

### Phase 3: MCP Tools, Performance Gate, Public Release
**Goal**: Close the loop from "works on the maintainer's machine" to "anyone can `npm install -g mrclean-claude` and get the same result." Ship the explicit on-demand MCP tool surface, a CI-enforced performance budget, the documentation that prevents user confusion (gitleaks layering FAQ, threat model), and the actual npm release. After this phase mrclean is publicly usable and its perf/security guarantees survive future commits.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: MCP-02, MCP-03, PERF-01, PERF-02, PERF-03, DOC-01, DOC-02, DOC-03, QA-01, QA-02, QA-03
**Success Criteria** (what must be TRUE):
  1. Inside a real Claude Code session the operator can invoke `mcp__mrclean__check`, `mcp__mrclean__redact`, and `mcp__mrclean__status` and get back the expected findings/text/version payloads — and `mcp__mrclean__unredact` does not exist (model-facing surface is read/transform only)
  2. Operator runs the CI suite locally and the vitest perf gate fails the build if a `UserPromptSubmit` on a 4 KB prompt exceeds 100 ms p95 or a `PostToolUse` on a 50 KB tool result exceeds 200 ms p95 on the reference machine
  3. Operator opens the published README and finds the explicit "gitleaks for what reaches your repo, mrclean for what reaches the model" layering FAQ plus a `THREAT_MODEL.md` enumerating what mrclean does NOT defend against (multimodal images, model memorization, etc.)
  4. Operator runs `npm install -g mrclean-claude` from the public npm registry, then `npx mrclean install` on a clean machine, and reaches the same Phase 1 + Phase 2 success criteria with no source checkout — the published artifact is the working artifact
  5. Operator runs `npm test` and observes ≥ 80% line coverage on `src/`, integration tests passing for every hook event in HOOK-01, and the CI canary-leak test confirming no fixture secret string appears in any audit log entry
**Plans**: 6 plans
  - [x] 03-00-PLAN.md — package.json publish metadata + vitest projects API (parallel-pollution fix) + coverage thresholds (QA-01 infrastructure)
  - [x] 03-01-PLAN.md — MCP tool rename (mrclean_check / mrclean_redact / mrclean_status) + supervisor + structured output (MCP-02, MCP-03)
  - [x] 03-02-PLAN.md — Performance gate (vitest assertion suite + 4 KB + 50 KB fixtures + perf.yml + compile-once grep gate) (PERF-01, PERF-02, PERF-03)
  - [x] 03-03-PLAN.md — README + THREAT_MODEL + LICENSE + CHANGELOG + .changeset/ bootstrap (DOC-01, DOC-02) — COMPLETE (Task 4 checkpoint resolved: LICENSE='mrclean-claude contributors', repo URL placeholder for 03-05)
  - [x] 03-04-PLAN.md — Quality gates: ≥80% coverage enforcement + integration coverage tagging per hook event + canary-leak CI workflow (QA-01, QA-02, QA-03)
  - [x] 03-05-PLAN.md — Publish pipeline: release.yml (changesets/action) + release-smoke.yml + initial-release changeset + docs/RELEASE.md + first manual publish (DOC-03)

---

## Milestone v2.0 — Native-Node PII/NER Layer (Phases 4-7)

> Opt-in PII/NER tier added on top of the shipped secret sanitizer. No Python, no data egress,
> no break to the < 100 ms hot path or zero-config `npx`. Secrets remain the deterministic hard
> gate; PII is a best-effort recall aid. Build order honors research/SUMMARY.md + ARCHITECTURE-v2-pii.md:
> contracts → regex hot-path lane + model infra → NER inference + MCP wiring → security hardening.

### Phase 4: PII Contracts & Architecture Foundations
**Goal**: Lock the load-bearing v2.0 decisions in code before any model code exists. After this phase, the schema, config surface, audit schema, dependency strategy, and scope fence that the entire PII layer plugs into are in place — and the core secret tool installs and behaves identically (PII off by default, ML deps absent from the core install path). Several of these decisions (audit hash-only schema, advisory-gate semantics, optionalDeps, scope fence) are cheap now and expensive-to-reverse later, so they come first.
**Mode:** mvp
**Depends on**: Phase 3 (v1 finding-shape, audit log, 5-axis allowlist, config-layering are the fixed substrate)
**Requirements**: PII-03, MODEL-01, PIISEC-03
**Success Criteria** (what must be TRUE):
  1. Operator adds a `[pii]` sub-table to `.mrclean/config.toml` and the config loads/validates without error; with no `[pii]` table present, behavior is byte-identical to v1 (PII off by default) — and per-entity action policy is expressible (checksum'd entities can be set to `block`, others default to `warn`/`audit`)
  2. Operator runs `npm install` on a platform with no `onnxruntime-node` prebuild and the core secret tool still installs and runs cleanly — the ML subtree is declared `optionalDependencies` and its absence never fails the install or the hook
  3. Operator inspects an emitted audit record schema and confirms the new PII-capable fields (`engine`, `model_rev`, `quant`, `backend`) exist and that the no-raw-value guarantee is documented as extended to PII (hash/fingerprint only)
  4. Operator reads the milestone scope fence in the repo (acceptance criteria / docs) and finds it explicitly bans cloud PII APIs, any model-facing unredact tool, and a Presidio Python sidecar in the default distribution — and a transition checklist enforces it
**Plans**: 3 plans
  - [x] 04-01-PLAN.md — Finding-shape + audit-schema additions (pii-regex/pii-ner source + precedence, PII_* TYPEs, audit engine/model_rev/quant/backend, no-raw rule extended to PII)
  - [x] 04-02-PLAN.md — `[pii]` config sub-table (MrcleanPiiConfig, off-by-default, per-entity action policy, last-wins entity merge; absent==v1) [PII-03]
  - [x] 04-03-PLAN.md — ML deps as optionalDependencies [MODEL-01] + documented+enforced scope fence with MCP-03 PII-write tool ban [PIISEC-03]

### Phase 5: Regex PII Hot-Path Lane (L6a) + Model Acquisition
**Goal**: Ship a standalone, model-free PII story and build the model-acquisition plumbing the NER lane depends on. The regex lane (email, US SSN, Luhn-validated credit card, phone, IPv4/IPv6) joins the existing hot-path detection chain after Layer 4, stays inside the < 100 / < 200 ms budget, and reuses the existing placeholder manager, audit log, and 5-axis allowlist with zero new sink code. In parallel, the model cache/download/integrity/side-load infra is built and testable without any inference.
**Mode:** mvp
**Depends on**: Phase 4 (finding-shape + config + audit schema contracts)
**Requirements**: PII-01, PII-02, MODEL-02, MODEL-03
**Success Criteria** (what must be TRUE):
  1. With `[pii].enabled = true`, operator pastes an email + a Luhn-valid credit card + a US SSN into a Claude Code prompt and observes them caught and substituted with `<MRCLEAN:PII_*:NNN>` placeholders — flowing through the same audit log and 5-axis allowlist as secrets, with no new redaction code path
  2. Operator runs the perf gate with regex-PII enabled and `UserPromptSubmit` (4 KB) stays < 100 ms p95 and `PostToolUse` (50 KB) stays < 200 ms p95 — the regex lane is genuinely hot-path-safe and adds no model dependency
  3. On first opt-in, the model is lazy-downloaded to a stable `~/.mrclean/models/` cache (never cwd-relative) with a one-time progress indicator, and the default (PII-off) `npx` cold path never loads ML deps or touches the network
  4. The downloaded model is verified against a pinned SHA-256 and refused on mismatch; an offline side-load path (`mrclean pii fetch-model --from <path>`) works air-gapped, and `mrclean doctor` reports model presence/integrity
**Plans**: 2 plans
  - [x] 05-01-PLAN.md — L6a regex-PII lane (email/SSN/Luhn-CC/phone/IPv4) + shared isAllowlisted extraction + orchestrator wiring behind pii.enabled [PII-01, PII-02]
  - [x] 05-02-PLAN.md — Model cache/download/SHA-256-integrity/side-load infra + `mrclean doctor` model check + `mrclean pii fetch-model` (blocking Wave-0 SHA-256 pin) [MODEL-02, MODEL-03]

### Phase 6: NER Inference (L6b) + MCP Wiring
**Goal**: This is where the probabilistic detector meets the deterministic pipeline. Opt-in open-class NER (PERSON, ORG, LOCATION) via `@huggingface/transformers` ONNX runs as a lazy warm singleton inside the long-lived MCP server ONLY — structurally unreachable from the per-event hook hot path. NER is advisory (warn/audit) by default, fails closed for NER only (secret gate never crashes), records model provenance in every PII audit entry, and supports a higher-recall model tier swap. The FP/overlap/reproducibility risks all land and are tested here.
**Mode:** mvp
**Depends on**: Phase 4 (schema) + Phase 5 (model cache + singleton plumbing)
**Requirements**: NER-01, NER-02, NER-03, NER-04, MODEL-04
**Success Criteria** (what must be TRUE):
  1. With `[pii.ner].enabled = true`, operator calls `mcp__mrclean__check` / `mcp__mrclean__redact` on prose containing a person/org/location and gets back NER findings — while the per-event hook never loads a model (verified: no pipeline import reachable from the hook path, hook cold-start unchanged)
  2. A NER-only finding (no deterministic signal) defaults to warn/audit and does NOT hard-block; only the deterministic secret layers (and checksum'd PII) block by default, and a tunable `min_score` threshold drops low-confidence entities
  3. Operator simulates a model load/inference failure (corrupt/missing model, offline) and the MCP tools return a structured `nerStatus: "unavailable"`, fall back to Layers 1-4 + regex-PII, and never crash the secret-detection gate
  4. Operator switches `[pii.ner].model` to the higher-recall piiranha (~317 MB) tier via config and it loads in place of the default ~108 MB model; every PII audit entry records `model_rev` + `quant` + `backend` so the same input + pinned model reproduces identical entries across machines
**Plans**: 4 plans (06-04 = gap closure for SC-4 model integrity/provenance)
  - [x] 06-01-PLAN.md — pipeline singleton + L6b NER engine + label-map + D-11 overlap filter + confidence-default reconcile (NER-01/02/03)
  - [x] 06-02-PLAN.md — orchestrator opts.ner wiring + D-11 pre-dedup + audit provenance + structural-unreachability + perf gate (NER-01, MODEL-04)
  - [x] 06-03-PLAN.md — MCP eager preload + nerStatus in check/redact + piiranha tier behind license checkpoint (NER-01, NER-04)
  - [x] 06-04-PLAN.md — GAP CLOSURE (SC-4): SHA-verified per-model inference load (allowRemoteModels=false, fail-closed) + truthful per-model provenance + piiranha integrity wiring (MODEL-04, NER-04)

### Phase 7: PII Security Hardening & Honest Framing
**Goal**: Close the security and trust surface a security tool is held to, auditing the fully-integrated PII surface end-to-end. A leak-grep regression test proves no raw PII value ever reaches `.mrclean/audit.jsonl` or any error/diagnostic/exception path, and all user-facing copy is ruthlessly framed as a best-effort ML recall aid (NER false negatives can leak) — explicitly NOT a guarantee, with secrets remaining the deterministic guarantee.
**Mode:** mvp
**Depends on**: Phase 6 (fully-integrated PII surface to audit)
**Requirements**: PIISEC-01, PIISEC-02
**Success Criteria** (what must be TRUE):
  1. Operator runs the leak-grep regression test, which feeds known PII (test SSN/email/name) through the full pipeline and asserts none of those raw values appear anywhere in `.mrclean/audit.jsonl` OR in stderr/error output — including deliberately-triggered exception paths
  2. Operator reads the README/PII section and finds it frames the NER layer as "best-effort ML PII hint, not a guarantee," explicitly states that NER false negatives can leak, and points to `words.txt` + deterministic layers as the real must-not-leak mechanism — no language drifting toward "redacts all PII" or compliance claims
  3. Operator confirms the framing is consistent across CLI output, `mrclean doctor`, and docs — the probabilistic asterisk on NER findings is visible wherever PII results surface
**Plans**: 2 plans
  - [ ] 07-01-PLAN.md — Leak-grep regression test + central sanitizeForOutput() error chokepoint + route supervisor/failclosed leak vectors (PIISEC-01) [Wave 1]
  - [ ] 07-02-PLAN.md — Honest best-effort framing (README PII section + doctor note + CLI/banner) + bestEffort flag on MCP check/redact + banned-phrase CI grep test (PIISEC-02) [Wave 1]

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Wired Skeleton | 0/5 | Planned, not started | - |
| 2. Live Redaction (Layers 1-4 + One-Way) | 2/7 | In Progress|  |
| 3. MCP Tools, Performance Gate, Public Release | 6/6 | Complete   | 2026-05-14 |
| 4. PII Contracts & Architecture Foundations | 0/3 | Planned, not started | - |
| 5. Regex PII Hot-Path Lane (L6a) + Model Acquisition | 0/2 | Planned, not started | - |
| 6. NER Inference (L6b) + MCP Wiring | 0/3 | Planned, not started | - |
| 7. PII Security Hardening & Honest Framing | 0/2 | Planned, not started | - |

## Coverage Validation

### v1 (Phases 1-3)

All 54 v1 requirements mapped to exactly one phase. No orphans. No duplicates. v2/REVMODE/LLM5/POLISH items from REQUIREMENTS.md explicitly excluded from v1 phases.

| Category | Total | Phase 1 | Phase 2 | Phase 3 |
|----------|-------|---------|---------|---------|
| INST | 8 | 8 | 0 | 0 |
| DET1 | 4 | 0 | 4 | 0 |
| DET2 | 3 | 0 | 3 | 0 |
| DET3 | 3 | 0 | 3 | 0 |
| DET4 | 3 | 0 | 3 | 0 |
| PH | 4 | 0 | 4 | 0 |
| HOOK | 7 | 4 | 3 | 0 |
| MCP | 4 | 2 | 0 | 2 |
| CFG | 4 | 2 | 2 | 0 |
| AUDIT | 3 | 1 | 2 | 0 |
| PERF | 3 | 0 | 0 | 3 |
| MODE | 2 | 0 | 2 | 0 |
| DOC | 3 | 0 | 0 | 3 |
| QA | 3 | 0 | 0 | 3 |
| **Total** | **54** | **17** | **26** | **11** |

### v2.0 (Phases 4-7)

All 14 v2.0 requirements mapped to exactly one phase. No orphans. No duplicates.

| Category | Total | Phase 4 | Phase 5 | Phase 6 | Phase 7 |
|----------|-------|---------|---------|---------|---------|
| PII | 3 | 1 (PII-03) | 2 (PII-01, PII-02) | 0 | 0 |
| NER | 4 | 0 | 0 | 4 (NER-01..04) | 0 |
| MODEL | 4 | 1 (MODEL-01) | 2 (MODEL-02, MODEL-03) | 1 (MODEL-04) | 0 |
| PIISEC | 3 | 1 (PIISEC-03) | 0 | 0 | 2 (PIISEC-01, PIISEC-02) |
| **Total** | **14** | **3** | **4** | **5** | **2** |

---
*Last updated: 2026-06-03 after Phase 7 planning (07-01, 07-02 created; Wave 1 parallel)*
