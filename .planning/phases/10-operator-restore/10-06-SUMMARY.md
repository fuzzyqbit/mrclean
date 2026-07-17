---
phase: 10-operator-restore
plan: 06
subsystem: mcp
tags: [mcp, status-tool, counters, zod, tdd, vitest, in-memory-transport]

# Dependency graph
requires:
  - phase: 09-session-state-adapter
    provides: "src/state/map-store.ts readSessionMapFile/statePaths chokepoint; src/state/session-map.ts isRestorableType/SESSION_ID_RE frozen partition"
  - phase: 10-operator-restore
    provides: "10-03 src/audit/restore-log.ts aggregateRestoreCounters (A2 audit-stream aggregation)"
provides:
  - "countSessionEntries + SessionEntryCounts — counts-only reducer over the encrypted session store, confined to src/state/ (first sanctioned MCP-side state read)"
  - "mrclean_status reversible counters block — enabled/sessions/entries_restorable/entries_secret/restored_total/unmatched_total, boolean+number only"
  - "registerStatusTool optional getStateBaseDir 5th param (default ~/.mrclean) — testable baseDir injection, call sites untouched"
affects: [10-08 leak-grep e2e, 11 wire-safety gates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Counts-only projection inside src/state/ (buildHydration analog): originals never cross into src/mcp/ stack frames; MCP tool imports the reducer, never the map reader"
    - "Per-source .catch(() => zeros) in the status handler — each data source degrades independently, tool never throws"
    - "Registration-time closure injection for state baseDir — model-facing input schema stays z.object({}) forever"

key-files:
  created:
    - src/state/counts.ts
    - tests/state/counts.test.ts
    - tests/mcp/status-reversible.test.ts
  modified:
    - src/mcp/tools/status.ts

key-decisions:
  - "Candidacy loop (.map + SESSION_ID_RE stem) deliberately duplicated from janitor.ts#sidFromName — janitor DELETES on that shape (destructive tier), the reducer only COUNTS (read-only tier); sharing one helper would couple trust tiers"
  - "Test fixture pins the project-layer config ([reversible] enabled=false in tmp cwd) — project layer wins the merge, making the enabled:false assertion deterministic regardless of the machine's ~/.mrclean/config.toml (the handler reads the real user layer via homedir())"
  - "tests/mcp/status.test.ts left byte-untouched — the plan's conditional bounded edit was unnecessary: no existing assertion full-object-equals structuredContent (T1-T4 check individual fields)"

patterns-established:
  - "Machine-global vs project-cwd scoping asymmetry is named honestly in field docs + tool description: session/entry counts are ~/.mrclean-wide, restored/unmatched totals are per-project audit aggregates"
  - "Nested counters schema is grep-gated boolean/number only — no z.string can enter the reversible block without failing acceptance gates"

requirements-completed: [REVMODE-12]

# Metrics
duration: 11min
completed: 2026-07-17
---

# Phase 10 Plan 06: Status Reversible Counters Summary

**`mrclean_status` now reports the REVMODE-12 reversible counters block — session + entry counts by frozen class via a counts-only reducer confined to `src/state/`, restored/unmatched totals from the audit stream — numbers and booleans only, zero arguments, never a value**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-07-17T23:07:44Z
- **Completed:** 2026-07-17T23:19:09Z
- **Tasks:** 2 (both TDD: RED + GREEN each; REFACTOR not needed)
- **Files modified:** 3 created, 1 modified

## Accomplishments

- SC5 status half shipped: `mrclean_status` exposes `reversible: { enabled, sessions, entries_restorable, entries_secret, restored_total, unmatched_total }` — operators see honest counts, models see no values and get no arguments to inject
- `src/state/counts.ts` (98 lines) is the first sanctioned MCP-side state READ: enumerates `.map` candidates (SESSION_ID_RE stem), decrypts via the `readSessionMapFile` chokepoint, classifies by TYPE alone via `isRestorableType` — the `original` field is never touched (code-line grep for "original" = 0)
- Read-only never-throw posture proven: absent dirs, baseDir-as-FILE, byte-flipped ciphertext, foreign filenames, and audit-as-directory all yield zeros — no error path reaches the tool response; no-write proof via dir listings + mtimes
- Honest scoping pinned (RESEARCH Open Question 2): field docs + tool description state session/entry counts are machine-global (`~/.mrclean`) while restore totals aggregate this project's `audit.jsonl`
- Planted-canary absence locked: a decryptable map whose WORD original is `zz-canary-status-leak` is counted (sessions:1, entries_restorable:1) yet the canary never appears in `JSON.stringify(structuredContent)`
- Zero server wiring edits: `getStateBaseDir` is an optional 5th param with a `~/.mrclean` default — `git diff --stat e950d76..HEAD -- src/hook src/detect src/placeholder src/mcp/server.ts` is empty
- 12 new tests (7 reducer + 5 InMemoryTransport); full blast radius green: 246 passed across all tests/state + tests/mcp suites, including the cold-path fence and exact-three tools-list

## Task Commits

Each task was committed atomically (TDD gate sequence):

1. **Task 1 (RED): Failing counts reducer suite** - `64479b2` (test)
2. **Task 1 (GREEN): src/state/counts.ts reducer** - `56088c5` (feat)
3. **Task 2 (RED): Failing status-reversible InMemoryTransport suite** - `f241bca` (test)
4. **Task 2 (GREEN): status tool reversible block** - `15f4440` (feat)

## TDD Gate Compliance

- Task 1 RED gate: `64479b2 test(10-06)` — suite failed on module-not-found before implementation
- Task 1 GREEN gate: `56088c5 feat(10-06)` — 7/7 pass, zero assertion edits
- Task 2 RED gate: `f241bca test(10-06)` — 4/5 failed on missing reversible block (the 5th, the zero-argument/six-fields lock, correctly passed against v1 behavior)
- Task 2 GREEN gate: `15f4440 feat(10-06)` — 9/9 across both status suites, zero assertion edits
- REFACTOR gates: skipped both tasks — helpers were extracted in GREEN; nothing to clean

## Acceptance Gates (all verified)

| Gate | Result |
|------|--------|
| `grep -v '^\s*\*\|^\s*//' src/state/counts.ts \| grep -c "original"` | 0 |
| `grep -v ... src/state/counts.ts \| grep -c "writeFile\|proper-lockfile\|createDecipheriv"` | 0 |
| `grep -c "z.object({})" src/mcp/tools/status.ts` | 2 (>= 1, input schema intact) |
| `grep -v ... src/mcp/tools/status.ts \| grep -c "readSessionMapFile\|session-map.js\|map-store.js"` | 0 |
| `grep -A8 "reversible: z.object" src/mcp/tools/status.ts \| grep -c "z.string"` | 0 |
| `npm run typecheck` | exactly the 38-error pre-existing baseline; zero errors referencing counts/status files |
| counts.ts line count | 98 (< 100 required) |

## Deviations from Plan

None - plan executed exactly as written.

Two execution notes (not deviations):
- The plan's conditional edit to `tests/mcp/status.test.ts` was not needed — no existing assertion full-object-equals structuredContent, so the file is byte-untouched.
- The new suite pins `[reversible] enabled = false` in the tmp cwd's project-layer config so the `enabled: false` assertion is deterministic on machines whose real `~/.mrclean/config.toml` enables reversible mode (the handler loads the live user layer by design).

## Threat Model Disposition

- T-10-06-01 (info disclosure): mitigated — reducer confined to src/state/, boolean/number-only schema, planted-canary absence test
- T-10-06-02 (elevation via arguments): mitigated — z.object({}) locked by test; baseDir closure is registration-time only
- T-10-06-03 (false-confidence scoping): mitigated — honest machine-global vs per-project copy in description + field docs
- T-10-06-04 (DoS via corrupt store/audit): mitigated — per-source .catch + total-error reads; never-throw suite row
- T-10-06-05 (audit counter tampering): accepted per plan — counters are informational, gate nothing, carry no values

## Self-Check: PASSED

- src/state/counts.ts — FOUND
- tests/state/counts.test.ts — FOUND
- tests/mcp/status-reversible.test.ts — FOUND
- src/mcp/tools/status.ts reversible block — FOUND (grep "reversible: z.object" = 1)
- Commits 64479b2, 56088c5, f241bca, 15f4440 — FOUND in git log
