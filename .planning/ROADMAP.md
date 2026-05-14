# Roadmap: mrclean

> Vertical-slice MVP roadmap. Each phase delivers a capability the operator can verify by running `npx mrclean ...` and observing real Claude Code behavior. No "library only" phases.

**Granularity:** coarse (3-5 phases)
**Project mode:** mvp (vertical slices, end-to-end)
**Coverage:** 54/54 v1 requirements mapped (100%)

## Phases

- [ ] **Phase 1: Wired Skeleton** - `npx mrclean install` lands a working hook + MCP server in Claude Code; operator sees the "mrclean active" banner and `mrclean doctor` reports green — no real detection yet, but the integration is provably alive
- [ ] **Phase 2: Live Redaction (Layers 1-4 + One-Way)** - Real secrets pasted into a Claude Code session are blocked-with-reason on prompts and substituted with stable `<MRCLEAN:TYPE:NNN>` placeholders in tool calls; `.env` values, regex hits, entropy, and project word-list all caught; audit log records hash-only entries
- [ ] **Phase 3: MCP Tools, Performance Gate, Public Release** - Operator can invoke `mrclean_check / mrclean_redact / mrclean_status` from inside Claude Code; CI enforces `<100ms / <200ms` budgets; README + THREAT_MODEL ship; `npm install -g mrclean` installs the published 1.0.0 package

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
  1. Operator pastes a real-shape AWS access key into a Claude Code prompt and the prompt is blocked with a structured `permissionDecisionReason` naming the rule and a redacted snippet — the unredacted value never reaches the model
  2. Operator runs a `Bash` tool call containing a `Bearer sk_live_…` token and the executed command sees `<MRCLEAN:STRIPE_KEY:001>` in place of the secret; the same token referenced twice in the session yields the same placeholder both times
  3. Operator drops a value into `.env` and a project-specific term into `.mrclean/words.txt`, restarts the session, then references both in a prompt — both are caught by Layer 3 / Layer 4 with no manual config beyond the two files
  4. Operator points mrclean at the committed fixture corpus (real package-lock.json, git diffs, OpenAPI spec) and observes 100% recall on the positive-secret fixtures and zero false positives on the UUID/git-SHA/hash negative corpus
  5. Operator inspects `.mrclean/audit.jsonl` after a session and finds one JSONL record per detection containing `redactedHash` and `fingerprint` only — `grep` for any seeded fixture secret string returns zero hits
  6. Operator sets `dry_run = true` in `.mrclean/config.toml` and re-runs the same secret-laden prompt — detections appear in the audit log but nothing is blocked or substituted (trust-building first-run mode works)
**Plans**: TBD

### Phase 3: MCP Tools, Performance Gate, Public Release
**Goal**: Close the loop from "works on the maintainer's machine" to "anyone can `npm install -g mrclean` and get the same result." Ship the explicit on-demand MCP tool surface, a CI-enforced performance budget, the documentation that prevents user confusion (gitleaks layering FAQ, threat model), and the actual npm release. After this phase mrclean is publicly usable and its perf/security guarantees survive future commits.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: MCP-02, MCP-03, PERF-01, PERF-02, PERF-03, DOC-01, DOC-02, DOC-03, QA-01, QA-02, QA-03
**Success Criteria** (what must be TRUE):
  1. Inside a real Claude Code session the operator can invoke `mcp__mrclean__check`, `mcp__mrclean__redact`, and `mcp__mrclean__status` and get back the expected findings/text/version payloads — and `mcp__mrclean__unredact` does not exist (model-facing surface is read/transform only)
  2. Operator runs the CI suite locally and the vitest perf gate fails the build if a `UserPromptSubmit` on a 4 KB prompt exceeds 100 ms p95 or a `PostToolUse` on a 50 KB tool result exceeds 200 ms p95 on the reference machine
  3. Operator opens the published README and finds the explicit "gitleaks for what reaches your repo, mrclean for what reaches the model" layering FAQ plus a `THREAT_MODEL.md` enumerating what mrclean does NOT defend against (multimodal images, model memorization, etc.)
  4. Operator runs `npm install -g mrclean` from the public npm registry, then `npx mrclean install` on a clean machine, and reaches the same Phase 1 + Phase 2 success criteria with no source checkout — the published artifact is the working artifact
  5. Operator runs `npm test` and observes ≥ 80% line coverage on `src/`, integration tests passing for every hook event in HOOK-01, and the CI canary-leak test confirming no fixture secret string appears in any audit log entry
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Wired Skeleton | 0/5 | Planned, not started | - |
| 2. Live Redaction (Layers 1-4 + One-Way) | 0/0 | Not started | - |
| 3. MCP Tools, Performance Gate, Public Release | 0/0 | Not started | - |

## Coverage Validation

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

---
*Last updated: 2026-05-13 after Phase 1 plan-phase*
