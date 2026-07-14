---
phase: 08-contract-verification-reversible-plumbing
plan: 05
subsystem: docs
status: checkpoint-pending
checkpoint: "Task 3 (checkpoint:human-action, gate=blocking) — operator must file the upstream issue and provide the URL"
tags: [revmode-10, hook-contract, docs, upstream-issue, copy-honesty]
requires:
  - "08-01: differential typecheck gate precedent (36-error baseline)"
  - "08-04: contract-findings.json verdicts + E1 shape-validation discovery (corrected picture)"
provides:
  - "docs/HOOK-CONTRACT.md: durable version-stamped E1-E5 verdict doc (upstream URL pending Task 3)"
  - "docs/upstream/display-only-channel-request.md: review-ready reframed feature-request draft"
  - "Honest shipped copy: types.ts updatedToolOutput JSDoc + doctor green detail carry the E1 verdict with verified-on stamps"
affects:
  - "08-06: THREAT_MODEL wire re-entry section consumes docs/HOOK-CONTRACT.md §E1"
  - "Task 3 continuation: record filed issue URL in HOOK-CONTRACT.md + draft header, finalize this SUMMARY"
tech-stack:
  added: []
  patterns:
    - "version-stamped contract citations: every verdict carries [verified on Claude Code 2.1.209, 2026-07-14, method]"
    - "differential typecheck gate (36-error baseline, zero new errors)"
key-files:
  created:
    - docs/HOOK-CONTRACT.md
    - docs/upstream/display-only-channel-request.md
  modified:
    - src/shared/types.ts
    - src/doctor/version-check.ts
    - tests/doctor/version-check.test.ts
decisions:
  - "Upstream request reframed (orchestrator-directed, 08-04 correction): primary ask = document per-tool updatedToolOutput shapes + surface shape-rejection loudly (or accept string coercion); display-only channel retained as distinguished related context, not the primary ask (single-feature template constraint)"
  - "Doctor green detail: neither plan branch matched the corrected verdict — wrote capability-specific wording naming the shape-validation caveat (string form inert for built-ins; MCP honored) with verified-on stamp"
  - "types.ts updatedToolOutput stays `string`-typed: emission-shape change (object payloads for built-ins) is future work, out of this docs-honesty plan's scope"
  - "dist/ NOT rebuilt from the worktree: build embeds ../../../node_modules worktree-relative paths — orchestrator regenerates post-merge (ecc358b precedent); version-check.ts copy change needs that rebuild to reach the shipped bin"
metrics:
  duration: "~12 min (tasks 1-2; Task 3 checkpoint pending)"
  completed: 2026-07-14
  tasks-complete: 2/3
---

# Phase 8 Plan 05: Hook-Contract Doc + Shipped-Copy Honesty + Upstream Draft Summary

**One-liner:** E1-E5 verdicts turned into the durable version-stamped docs/HOOK-CONTRACT.md, shipped copy de-overclaimed (types JSDoc + doctor green detail now name the per-tool shape-validation caveat), and a reframed upstream feature request drafted — filing awaits the operator (Task 3 checkpoint).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | docs/HOOK-CONTRACT.md + shipped-copy honesty | ff25c72 | docs/HOOK-CONTRACT.md, src/shared/types.ts, src/doctor/version-check.ts, tests/doctor/version-check.test.ts |
| 2 | Draft the (reframed) upstream feature request | 5119abc | docs/upstream/display-only-channel-request.md |
| 3 | Operator files the upstream issue; link recorded | **PENDING — checkpoint:human-action** | docs/HOOK-CONTRACT.md, docs/upstream/display-only-channel-request.md |

## What was built

- **docs/HOOK-CONTRACT.md** (208 lines): one section per contract question (E1 per-tool
  honored-ness + terminal rendering, E2 updatedInput echo, E3 session_id continuity, E4 10K cap,
  E5 SessionEnd headless firing), each with verdict, `[verified on Claude Code 2.1.209,
  2026-07-14, method]` stamp, evidence excerpt (verbatim zod rejection, session ids, findings
  pointers), and downstream implication (Phase 9 T5 gate REAL; Phase 10 input-restore fence;
  THREAT_MODEL wire re-entry + doctor copy; Phase 9 janitor TTL mandatory). Open follow-ups
  (Read object-shape probe, E4 rerun via object payload) and re-verification procedure recorded.
  Upstream section carries status "drafted — link pending" (Task 3 fills the URL).
- **src/shared/types.ts:** `PostToolUseOutput.updatedToolOutput` JSDoc now states the per-tool
  E1 verdict (MCP string honored; Bash string rejected/object honored; Read object untested)
  with the verified-on stamp, #68951 reference, and HOOK-CONTRACT pointer — satisfying the
  LOCKED header's upstream-verification citation discipline.
- **src/doctor/version-check.ts:** green detail replaced — the unqualified "fully compatible
  (PostToolUse updatedToolOutput supported, full Phase 2 functionality)" now names the
  shape-validation caveat: string payloads honored for MCP tools, rejected for built-ins, so
  mrclean's current string-form rewrite is inert for built-in tools; verified-on stamp +
  docs/HOOK-CONTRACT.md pointer. Test 11h locks the new copy.
- **docs/upstream/display-only-channel-request.md** (146 lines): review-ready body matching the
  anthropics/claude-code feature_request.yml sections (Preflight, Problem Statement, Proposed
  Solution, Alternatives, Priority, Category, Use Case, Additional Context), duplicate-search
  evidence re-run 2026-07-14 (5 queries, no existing request), E1 evidence embedded (shape
  matrix, verbatim zod error, rendering observation), #18653/#68951 cited and distinguished,
  marker strings only (leak-grep clean, no local paths).

## Verification gates

- Task 1 automated verify: HOOK-CONTRACT exists + "verified on Claude Code" present +
  "HOOK-CONTRACT" in version-check.ts — PASS; `grep -c HOOK-CONTRACT src/shared/types.ts` = 2.
- `npx vitest run --project=unit tests/doctor/version-check.test.ts`: 9/9 passed (incl. new 11h).
- Full `npm test`: 614 passed / 12 skipped, exit 0.
- Differential typecheck: identical 36-error baseline set (line numbers shifted only; zero new
  errors) — `npm run typecheck` cannot exit 0 repo-wide (pre-existing, deferred-items.md).
- Task 2 automated verify: draft exists, cites 18653 + 68951, contains "display" — PASS;
  leak-grep (`AKIA|ghp_|sk-ant|/Users/`) — 0 hits.

## Deviations from Plan

**1. [Orchestrator-directed reframe] Upstream request is no longer primarily a display-only-channel ask**
- **Found during:** Task 2 (directed by the orchestrator correction note from 08-04 Task 3)
- **Issue:** Plan (and must_haves truth) framed the request as "display-only rewrite channel",
  premised on "updatedToolOutput ignored for built-ins" — corrected by the E1 shape-validation
  discovery (channel NOT dead; string form rejected).
- **Fix:** Draft reframed to the evidence-supported single feature: document per-tool
  updatedToolOutput shapes + surface shape-rejection loudly (or accept string coercion).
  Display-only channel retained as a distinguished "related future ask" in Additional Context
  (the template's preflight requires a single feature per issue), grounded in the E1 rendering
  verdict. docs/HOOK-CONTRACT.md's upstream section documents the reframe.
- **Files:** docs/upstream/display-only-channel-request.md, docs/HOOK-CONTRACT.md
- **Commits:** ff25c72, 5119abc

**2. [Rule 3 - Blocking] Plan's `npm run typecheck` gate substituted with the phase differential gate**
- **Found during:** Task 1 verify
- **Issue:** `tsc --noEmit` fails with 36 pre-existing baseline errors (deferred-items.md,
  discovered 08-01) — exit-0 impossible without out-of-scope fixes.
- **Fix:** Differential gate (error set normalized by line number, diffed against baseline):
  zero new errors introduced. Same discipline as 08-01/08-04.
- **Files modified:** none (verification-procedure substitution only)

**3. [Scope boundary] Worktree dist rebuild not committed**
- **Found during:** Task 1 commit (npm test's integration globalSetup rebuilt dist/)
- **Issue:** dist built inside the worktree embeds `../../../node_modules` relative paths —
  committing would pollute the repo.
- **Fix:** `git checkout -- dist/cli.js dist/mcp.js` (targeted restore).
  **Flag for orchestrator:** regenerate dist after wave merge (ecc358b precedent) — the
  version-check.ts copy change requires a rebuild to reach the shipped bin.

**4. [Plan-branch mismatch] Doctor green-detail branches didn't fit the corrected verdict**
- **Found during:** Task 1
- **Issue:** Plan offered two deterministic branches (ignored-for-Bash vs honored-for-all);
  the recorded verdict is neither (shape-validated per tool).
- **Fix:** Capability-specific wording naming the actual caveat, yellow-path style, with
  verified-on stamp — per the orchestrator correction ("corrected findings govern").
- **Files modified:** src/doctor/version-check.ts, tests/doctor/version-check.test.ts
- **Commit:** ff25c72

No authentication gates were hit. No packages installed.

## Known Stubs

- `docs/HOOK-CONTRACT.md` §Upstream feature request: status "drafted — link pending" —
  **intentional**; Task 3 (pending checkpoint) replaces it with the filed issue URL (SC1
  "filed and linked"). If the operator declines, record `declined: <reason>` instead and flag
  SC1's filed-and-linked criterion as unmet here.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. T-08-16 mitigations applied to
the draft (marker strings + public issue refs only; leak-grep clean); T-08-17 upheld (no
`gh issue create` executed — only read-only `gh api`/`gh search`/`gh issue view`); T-08-18
mitigations shipped (E1-gated version-stamped copy, tests updated in lockstep).

## Self-Check: PASSED

- docs/HOOK-CONTRACT.md: FOUND (208 lines; 5 E-sections; 6 verified-on stamps; contract-findings referenced)
- docs/upstream/display-only-channel-request.md: FOUND (146 lines; 18653+68951 cited)
- src/shared/types.ts: contains "HOOK-CONTRACT" (2 refs)
- src/doctor/version-check.ts: contains "HOOK-CONTRACT"; old unqualified claim removed
- Commit ff25c72 (Task 1): FOUND
- Commit 5119abc (Task 2): FOUND
- Task 3 verify gate (`grep -qE "github.com/anthropics/claude-code/issues/[0-9]+" docs/HOOK-CONTRACT.md`): NOT YET SATISFIED — pending operator checkpoint (expected at this stage)
