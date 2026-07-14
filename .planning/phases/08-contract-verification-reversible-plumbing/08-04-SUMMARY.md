---
phase: 08-contract-verification-reversible-plumbing
plan: 04
subsystem: testing
status: checkpoint — tasks 1-2 of 3 complete; Task 3 (interactive terminal-rendering observation) awaiting operator
tags: [uat, hook-contract, revmode-10, live-experiments, record-dont-assert]
requires:
  - "08-01: differential typecheck gate precedent"
  - "08-02: SessionEnd handler + widened SessionStart matcher (E5/E3 exercised them live)"
provides:
  - "tests/uat/harness.ts: shared runClaude/assertSessionRan/ClaudeRun for all UAT suites"
  - "tests/uat/contract-verification.test.ts: rerunnable E1-E5 opt-in experiment harness"
  - "tests/uat/artifacts/contract-findings.json: version-stamped E1-E5 verdicts (docs-wave input for 08-05/08-06)"
affects:
  - "08-05/08-06: consume the verdict table below (docs/HOOK-CONTRACT.md, THREAT_MODEL, doctor copy, upstream issue)"
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
    - tests/uat/fixtures/e2-updated-input-hook.sh
    - tests/uat/fixtures/e4-large-output-hook.sh
    - tests/uat/fixtures/log-hook.sh
    - tests/uat/artifacts/contract-findings.json
  modified:
    - tests/uat/live-session.test.ts
decisions:
  - "E1/MCP experiments require ENABLE_TOOL_SEARCH=false: deferred MCP schema loading on CC 2.1.209 makes Haiku fail to invoke MCP tools directly"
  - "E4 verdict is the honest fallback: unanswerable for built-in tools, blocked by #68951 (a documented outcome per RESEARCH Open Question 2)"
metrics:
  duration: "~35 min (tasks 1-2; includes 3 live experiment runs + 2 manual probes)"
  completed: 2026-07-14
  tasks-complete: 2/3
  live-api-cost: "~30 Haiku calls (cents) — above the 10-20 estimate due to mandated harness-integrity triage reruns"
---

# Phase 8 Plan 04: Contract Verification Live Experiments Summary

**One-liner:** E1-E5 live headless experiments on CC 2.1.209 prove updatedToolOutput is ignored for Bash AND Read but honored for MCP tools, --resume reuses session_id in hook payloads, updatedInput does not echo into the transcript, and SessionEnd never fires headlessly — all recorded in a rerunnable record-don't-assert harness.

## Verdict Table (consumed by 08-05/08-06)

All verdicts: Claude Code **2.1.209**, **2026-07-14**, method: live headless `-p` sessions via fixture hooks (record-don't-assert). #68951 confirmed still OPEN at run time. Full signals + evidence pointers in `tests/uat/artifacts/contract-findings.json`.

| Experiment | Question | Verdict |
|-----------|----------|---------|
| E1 (Bash) | updatedToolOutput honored for built-in Bash? | **IGNORED** — original output reached the model unchanged (confirms #68951 on 2.1.209) |
| E1 (Read) | updatedToolOutput honored for built-in Read? | **IGNORED** — original output reached the model unchanged (**extends #68951 beyond Bash** — new evidence for the upstream issue) |
| E1 (MCP) | updatedToolOutput honored for MCP tools? | **HONORED** — rewrite marker re-entered model context via mcp__mrclean__mrclean_check (model quoted REWRITTEN marker) |
| E1 (rendering) | What does the interactive terminal render? | **pending-interactive** — Task 3 checkpoint (operator observation) |
| E2 | Does PreToolUse updatedInput echo into transcript/model context? | Rewrite **EXECUTED** (updated command ran); transcript tool_use input **preserves the ORIGINAL command** — no context echo observed |
| E3 | session_id continuity across --resume (hook payloads)? | Plain --resume **REUSES** session_id (T5 rehydration real); --fork-session control minted a **NEW** id; SessionStart fired with **source:resume** through the widened matcher (live proof of 08-02 pattern) |
| E4 | Does the 10K cap bind updatedToolOutput? | **Unanswerable for built-in tools on this version — blocked by #68951** (only MCP honored; not exercised for cap). Control: ~15K additionalContext was **NOT capped** in this observation (documented cap not observed) |
| E5 (headless) | Does SessionEnd fire in headless -p mode? | **Did NOT fire** — Phase 9 janitor must lean on the TTL sweep (A4 confirmed pessimistic) |
| E5 (SC3) | mrclean real hook noise on session start/end? | **Zero hook-error/exit-2 stderr noise** — SessionStart (widened matcher) + SessionEnd no-op via the real fail-closed wrapper (SC3 live observable satisfied) |

### Downstream implications

- **Shipped-behavior gap (THREAT_MODEL/doctor honesty, 08-05/08-06):** mrclean's PostToolUse redaction via updatedToolOutput is silently inert for built-in Bash **and Read** results on 2.1.209 — the doctor's "fully compatible (PostToolUse updatedToolOutput supported)" copy overclaims. It IS effective for MCP tool results.
- **Upstream issue ammo:** the Read finding extends #68951's scope; the MCP-honored finding shows the channel works and the bug is tool-specific.
- **Phase 9 T5:** retain-on-resume rehydration has a real substrate (session_id continuity in hook payloads confirmed).
- **Phase 9 janitor:** SessionEnd absent in headless mode — TTL sweep is mandatory, not a backstop.
- **Phase 10 input-restore fence:** no transcript echo of updatedInput observed — recorded for the v3.x decision (fence stands regardless, T1 locked).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extract shared UAT harness + author E1-E5 experiment suite | 5730b02 | tests/uat/harness.ts, tests/uat/contract-verification.test.ts, tests/uat/live-session.test.ts, 4 fixture scripts |
| 2 | Run the live experiments and commit the findings artifact | 64aa564 | tests/uat/artifacts/contract-findings.json (+harness triage fixes) |
| 3 | Interactive terminal-rendering observation (E1 rendering half) | — | **CHECKPOINT: awaiting operator** |

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

No other deviations — plan executed as written. No authentication gates were hit (nested `claude` CLI authenticated headlessly on all runs).

## Known Stubs

- `experiments.E1.rendering = "pending-interactive"` in tests/uat/artifacts/contract-findings.json — **intentional**: this is the Task 3 checkpoint's slot; the executor fills it with the operator's observation on resume and commits the updated artifact.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. All new surface is opt-in test harness matching the plan's threat model (T-08-12/13/14/15 mitigations verified above).

## Self-Check: PASSED

- tests/uat/harness.ts: FOUND
- tests/uat/contract-verification.test.ts: FOUND
- tests/uat/artifacts/contract-findings.json: FOUND (contains claude_version "2.1.209")
- tests/uat/fixtures/{e1-rewrite-hook,e2-updated-input-hook,e4-large-output-hook,log-hook}.sh: FOUND, executable
- Commit 5730b02: FOUND
- Commit 64aa564: FOUND
