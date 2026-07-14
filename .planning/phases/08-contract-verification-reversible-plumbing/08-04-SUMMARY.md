---
phase: 08-contract-verification-reversible-plumbing
plan: 04
subsystem: testing
status: complete
tags: [uat, hook-contract, revmode-10, live-experiments, record-dont-assert]
requires:
  - "08-01: differential typecheck gate precedent"
  - "08-02: SessionEnd handler + widened SessionStart matcher (E5/E3 exercised them live)"
provides:
  - "tests/uat/harness.ts: shared runClaude/assertSessionRan/ClaudeRun for all UAT suites"
  - "tests/uat/contract-verification.test.ts: rerunnable E1-E5 opt-in experiment harness"
  - "tests/uat/artifacts/contract-findings.json: version-stamped E1-E5 verdicts (docs-wave input for 08-05/08-06)"
affects:
  - "08-05/08-06: consume the verdict table below (docs/HOOK-CONTRACT.md, THREAT_MODEL, doctor copy, upstream issue); open follow-ups for 08-05: Read object-shape probe + E4 rerun via object-shaped Bash payload"
  - "Phase 9: T5 rehydration confirmed real (resume reuses session_id); SessionEnd does NOT fire headlessly (TTL sweep is the backstop)"
  - "Phase 10: input-restore scope fence (E2: no transcript echo observed)"
tech-stack:
  added: []
  patterns:
    - "record-don't-assert: contract verdicts recorded to findings artifact; only harness integrity hard-asserted"
    - "fixture-hook isolation: minimal marker-emitting scripts instead of mrclean's full stack"
key-files:
  created:
    - tests/uat/harness.ts
    - tests/uat/contract-verification.test.ts
    - tests/uat/fixtures/e1-rewrite-hook.sh
    - tests/uat/fixtures/e1-object-rewrite-hook.sh
    - tests/uat/fixtures/e2-updated-input-hook.sh
    - tests/uat/fixtures/e4-large-output-hook.sh
    - tests/uat/fixtures/log-hook.sh
    - tests/uat/artifacts/contract-findings.json
  modified:
    - tests/uat/live-session.test.ts
decisions:
  - "E1/MCP experiments require ENABLE_TOOL_SEARCH=false: deferred MCP schema loading on CC 2.1.209 makes Haiku fail to invoke MCP tools directly"
  - "E4 verdict is the honest fallback: unanswerable for built-in tools, blocked by #68951 (a documented outcome per RESEARCH Open Question 2) — reinterpreted at Task 3: potentially answerable via object-shaped Bash payload, rerun deferred to 08-05"
  - "E1 'ignored' verdicts reinterpreted (Task 3 discovery): CC 2.1.209 SHAPE-VALIDATES updatedToolOutput per tool — string rejected for Bash (zod invalid_type), object shape {stdout,stderr,interrupted,isImage} HONORED; the channel is NOT dead for built-ins"
  - "Task 3 observation was operator-delegated ('you run it') to a one-off automated tmux PTY capture; the committed harness intentionally gains NO PTY automation (RESEARCH Don't Hand-Roll stands)"
metrics:
  duration: "~45 min (tasks 1-2 ~35 min incl. 3 live experiment runs + 2 manual probes; Task 3 checkpoint resolution + finalization ~10 min)"
  completed: 2026-07-14
  tasks-complete: 3/3
  live-api-cost: "~30 Haiku calls (cents) for tasks 1-2 + 2 operator-directed probe sessions at Task 3 resolution"
---

# Phase 8 Plan 04: Contract Verification Live Experiments Summary

**One-liner:** E1-E5 live experiments on CC 2.1.209 prove updatedToolOutput is SHAPE-VALIDATED per tool (string form rejected for Bash with a zod warning; object shape `{stdout,stderr,interrupted,isImage}` HONORED and rendered — the channel is NOT dead for built-ins), --resume reuses session_id in hook payloads, updatedInput does not echo into the transcript, and SessionEnd never fires headlessly — all recorded in a rerunnable record-don't-assert harness.

## Verdict Table (consumed by 08-05/08-06)

All verdicts: Claude Code **2.1.209**, **2026-07-14**, method: live headless `-p` sessions via fixture hooks (record-don't-assert), except E1 (rendering) and the string-shape half of E1 (shape-validation), which used operator-directed automated PTY observation (tmux capture-pane; one-off, not the committed harness). #68951 confirmed still OPEN at run time. Full signals + evidence pointers (including the verbatim zod error) in `tests/uat/artifacts/contract-findings.json` (`experiments.E1.rendering`, `experiments.E1_shape_validation`).

| Experiment | Question | Verdict |
|-----------|----------|---------|
| E1 (Bash) | updatedToolOutput honored for built-in Bash? | **IGNORED** — original output reached the model unchanged (confirms #68951 on 2.1.209) *(reinterpreted — see E1 shape-validation row: string form rejected; OBJECT shape honored)* |
| E1 (Read) | updatedToolOutput honored for built-in Read? | **IGNORED** — original output reached the model unchanged (**extends #68951 beyond Bash** — new evidence for the upstream issue) *(reinterpreted: string form rejected; object shape for Read UNTESTED — open follow-up for 08-05)* |
| E1 (MCP) | updatedToolOutput honored for MCP tools? | **HONORED** — rewrite marker re-entered model context via mcp__mrclean__mrclean_check (model quoted REWRITTEN marker) *(consistent with shape validation: MCP accepts string content)* |
| E1 (rendering) | What does the interactive terminal render? | **Display follows the model-facing value** — honored rewrite (object shape) → terminal renders REWRITTEN output; rejected rewrite (string shape) → terminal renders "PostToolUse:Bash hook warning" and NO output line; no case renders the original alongside a successful rewrite. Method: operator-directed automated PTY observation (tmux capture-pane, one-off — NOT the committed harness). Sessions 79b56324-4cc2-4817-8ea9-c8e604bb18c5 (string) / e244a7f9-6296-4413-a636-efea169636e2 (object) |
| E1 (shape-validation) | Why "ignored"? Is the channel dead for built-ins? | **DISCOVERY: CC 2.1.209 SHAPE-VALIDATES updatedToolOutput per tool.** String payloads are REJECTED for Bash (zod `invalid_type`: "expected object, received string") with a hook warning and the original output is used; OBJECT-shaped payloads (`{stdout, stderr, interrupted, isImage}`) are **HONORED** for Bash (probe session e244a7f9-6296-4413-a636-efea169636e2; fixture `tests/uat/fixtures/e1-object-rewrite-hook.sh`). The channel is NOT dead — #68951 likely reports the string form |
| E2 | Does PreToolUse updatedInput echo into transcript/model context? | Rewrite **EXECUTED** (updated command ran); transcript tool_use input **preserves the ORIGINAL command** — no context echo observed |
| E3 | session_id continuity across --resume (hook payloads)? | Plain --resume **REUSES** session_id (T5 rehydration real); --fork-session control minted a **NEW** id; SessionStart fired with **source:resume** through the widened matcher (live proof of 08-02 pattern) |
| E4 | Does the 10K cap bind updatedToolOutput? | **Unanswerable for built-in tools on this version — blocked by #68951** (only MCP honored; not exercised for cap). Control: ~15K additionalContext was **NOT capped** in this observation (documented cap not observed) *(reinterpreted: potentially answerable via object-shaped Bash payload — rerun deferred to 08-05)* |
| E5 (headless) | Does SessionEnd fire in headless -p mode? | **Did NOT fire** — Phase 9 janitor must lean on the TTL sweep (A4 confirmed pessimistic) |
| E5 (SC3) | mrclean real hook noise on session start/end? | **Zero hook-error/exit-2 stderr noise** — SessionStart (widened matcher) + SessionEnd no-op via the real fail-closed wrapper (SC3 live observable satisfied) |

### Downstream implications

- **PostToolUse redaction for built-in Bash IS achievable (THREAT_MODEL/doctor, 08-05/08-06):** the Task 3 shape-validation discovery corrects the tasks-1-2 picture. mrclean's PostToolUse redaction via updatedToolOutput works for built-in Bash when the hook emits the tool-specific OBJECT shape (`{stdout, stderr, interrupted, isImage}`) — the "silently inert for built-ins" framing was an artifact of emitting the string form, which CC 2.1.209 rejects with a per-tool zod shape validation. MCP tool results accept string content and were honored all along.
- **Doctor copy (08-06):** the "overclaims" framing softens to "must emit tool-specific object shapes" — the doctor's compatibility claim is true IF (and only if) mrclean's PostToolUse hook emits the correct per-tool output shape. String-form emission on 2.1.209 silently no-ops (warning only visible in the transcript/TUI hook-warning line).
- **Upstream issue framing (08-05):** changes from "channel broken for built-ins" to "string form rejected by shape validation + the warning is easy to miss". Request: document per-tool updatedToolOutput shapes and/or accept string coercion. #68951 likely reports the string form; the Read "ignored" verdict from Task 2 is likewise reinterpreted as "string-form rejected", not "channel dead".
- **Rendering (Phase 10 restore-path UX):** the terminal displays the model-facing value — an honored rewrite renders the REWRITTEN output; a rejected rewrite renders the hook warning with no output line. No case leaks the original alongside a successful rewrite.
- **Open follow-ups for 08-05:** (1) Read with OBJECT-shaped payload untested — the expected object shape for Read is unknown; (2) E4 (10K cap) rerun via object-shaped Bash payload — now potentially answerable, deliberately not re-run at Task 3.
- **Phase 9 T5:** retain-on-resume rehydration has a real substrate (session_id continuity in hook payloads confirmed).
- **Phase 9 janitor:** SessionEnd absent in headless mode — TTL sweep is mandatory, not a backstop.
- **Phase 10 input-restore fence:** no transcript echo of updatedInput observed — recorded for the v3.x decision (fence stands regardless, T1 locked).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extract shared UAT harness + author E1-E5 experiment suite | 5730b02 | tests/uat/harness.ts, tests/uat/contract-verification.test.ts, tests/uat/live-session.test.ts, 4 fixture scripts |
| 2 | Run the live experiments and commit the findings artifact | 64aa564 | tests/uat/artifacts/contract-findings.json (+harness triage fixes) |
| 3 | Interactive terminal-rendering observation (E1 rendering half) | (this commit — `test(08-04): record E1 rendering verdict + shape-validation discovery`) | tests/uat/artifacts/contract-findings.json, tests/uat/fixtures/e1-object-rewrite-hook.sh |

## Verification gates (tasks 1-2)

- Differential typecheck: zero new errors at both commit boundaries (36 pre-existing baseline errors untouched — deferred-items.md discipline).
- `npx vitest run --project=unit`: 481 passed.
- Final live run: 9/9 experiments passed (harness integrity), all verdicts recorded.
- Fixtures executable, marker-strings-only (`! grep -rqE "AKIA|ghp_|sk-ant" tests/uat/fixtures/` clean).
- Opt-in gate: suite reports 9 skipped without MRCLEAN_UAT=1 (no tokens in CI).
- Isolation: all settings via mkdtemp sandbox `--settings`/`--mcp-config --strict-mcp-config`; no homedir settings writes (T-08-12/T-08-15 mitigations applied).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] E1/MCP harness-integrity failure: Task-subagent delegation burned the spawn timeout**
- **Found during:** Task 2 (first live run)
- **Issue:** The nested Haiku session delegated the MCP tool call to a Task subagent that looped on ToolSearch for 150s+; no result event before spawnSync timeout.
- **Fix:** Direct-call prompt naming the full tool (`mcp__mrclean__mrclean_check`), `--disallowedTools Task`, and a per-run `timeoutMs` override added to `RunClaudeOptions` in harness.ts.
- **Files modified:** tests/uat/harness.ts, tests/uat/contract-verification.test.ts
- **Commit:** 64aa564

**2. [Rule 3 - Blocking] E1/MCP fixture hook never fired: deferred MCP tool schemas (ToolSearch) on 2.1.209**
- **Found during:** Task 2 (second live run + manual probe)
- **Issue:** With default deferred tool loading, Haiku retrieved the mrclean_check schema via ToolSearch but then declared it could not invoke MCP tools — the tool call never happened, so the PostToolUse fixture never fired. Manual probe confirmed `ENABLE_TOOL_SEARCH=false` makes the direct call land first-turn.
- **Fix:** E1/MCP run sets `env: { ENABLE_TOOL_SEARCH: 'false' }` (eager MCP schema loading); documented in-test.
- **Files modified:** tests/uat/contract-verification.test.ts
- **Commit:** 64aa564

### Checkpoint-resolution deviations (Task 3)

**3. [Checkpoint resolution — operator-directed] Interactive observation delegated to automated PTY capture; major discovery surfaced**
- **Found during:** Task 3 (checkpoint:human-verify resolution)
- **Deviation:** The plan specified a manual operator observation and explicitly forbade PTY/tmux automation in the harness. The operator responded "you run it", explicitly delegating the observation to the orchestrator, which performed it via automated tmux PTY capture (capture-pane) — a **one-off, operator-directed** substitution. The committed harness gained NO PTY automation; the RESEARCH "Don't Hand-Roll" prohibition stands for all rerunnable tooling.
- **Discovery:** The string-shape fixture session's transcript contained a `hook_error_during_execution` attachment revealing that CC 2.1.209 **shape-validates updatedToolOutput per tool** (zod `invalid_type`: expected object, received string, for Bash). A follow-up headless probe with an OBJECT-shaped payload (`{stdout, stderr, interrupted, isImage}`) was **HONORED** for Bash — correcting the E1 interpretation from "channel dead for built-ins" to "string form rejected by shape validation". Recorded as `experiments.E1_shape_validation` (append-and-annotate; no recorded verdict was rewritten); probe fixture committed as `tests/uat/fixtures/e1-object-rewrite-hook.sh` for provenance/rerunnability.
- **Files modified:** tests/uat/artifacts/contract-findings.json, tests/uat/fixtures/e1-object-rewrite-hook.sh
- **Commit:** this commit
- **Not committed:** raw PTY capture files (they contain the operator's account email) — the excerpts embedded in the findings JSON are the evidence.

No other deviations — plan executed as written. No authentication gates were hit (nested `claude` CLI authenticated headlessly on all runs).

## Known Stubs

None — the `experiments.E1.rendering = "pending-interactive"` stub from the Task 2 interim summary was resolved at Task 3 (rendering verdict recorded; see verdict table).

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. All new surface is opt-in test harness matching the plan's threat model (T-08-12/13/14/15 mitigations verified above).

## Self-Check: PASSED

- tests/uat/harness.ts: FOUND
- tests/uat/contract-verification.test.ts: FOUND
- tests/uat/artifacts/contract-findings.json: FOUND (contains claude_version "2.1.209")
- tests/uat/fixtures/{e1-rewrite-hook,e2-updated-input-hook,e4-large-output-hook,log-hook}.sh: FOUND, executable
- tests/uat/fixtures/e1-object-rewrite-hook.sh: FOUND, executable, leak-grep clean (`! grep -rqE "AKIA|ghp_|sk-ant" tests/uat/fixtures/`)
- Task 3 verify gate: PASSED — `node -e "const f=require('./tests/uat/artifacts/contract-findings.json'); const r=f.experiments.E1.rendering; if(!r||r==='pending-interactive'||!r.verdict) process.exit(1)"`
- experiments.E1_shape_validation: FOUND (verbatim zod error + probe session id e244a7f9-6296-4413-a636-efea169636e2)
- Commit 5730b02 (Task 1): FOUND
- Commit 64aa564 (Task 2): FOUND
- Task 3 commit: this commit (contains findings JSON, object-shape fixture, finalized SUMMARY)
