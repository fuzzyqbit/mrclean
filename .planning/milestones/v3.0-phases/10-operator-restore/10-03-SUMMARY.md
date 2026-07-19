---
phase: 10-operator-restore
plan: 03
subsystem: audit
tags: [jsonl, audit-log, sha256, discriminated-union, tdd, vitest]

# Dependency graph
requires:
  - phase: 02-detection-engine
    provides: "src/audit/log.ts AuditWriteError + O_APPEND discipline; src/audit/canary-leak.ts assertNoCanaryLeak; src/detect/findings.ts 16-hex hash discipline"
provides:
  - "RestoreAuditRecord — discriminated action:'restore' sibling line type in <cwd>/.mrclean/audit.jsonl"
  - "buildRestoreAuditRecord — LOCKED no-raw builder (counts + pre-hashed values only, destructure-pick per field)"
  - "writeRestoreAuditRecord — O_APPEND JSONL writer throwing AuditWriteError with the install-hint ENOENT copy"
  - "aggregateRestoreCounters — total-error reader summing restored/unmatched over restore lines for the status surface"
affects: [10-05 restore CLI, 10-06 status tool, 10-08 leak-grep e2e]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Discriminated sibling audit record (action:'restore') instead of widening a LOCKED schema"
    - "Hash-at-the-boundary: audit module input types structurally cannot accept raw originals"
    - "Total-error reader: ENOENT zeros, per-line try/catch, Number coercion guard — untrusted file can never crash the reader"

key-files:
  created:
    - src/audit/restore-log.ts
    - tests/audit/restore-log.test.ts
  modified: []

key-decisions:
  - "Builder normalises hashes to distinct+sorted (new array, input never mutated) — the record type documents 'DISTINCT, sorted (deterministic)' and the builder is the sole producer, so it owns the invariant rather than trusting caller iteration order"
  - "ENOENT/generic AuditWriteError message copy duplicated verbatim from writeAuditRecord rather than exporting log.ts's internal message builder — log.ts is LOCKED, zero edits allowed"
  - "Hetero-fixture hook line uses a fully valid AuditRecord (action:'substitute') per the task's read_first text — stronger discriminant proof than the behavior note's 'no action key' phrasing, since real hook lines DO carry a non-restore action"

patterns-established:
  - "Restore audit lines and hook AuditRecord lines coexist in one audit.jsonl; consumers discriminate on parsed.action === 'restore'"
  - "Counters derive from the audit stream alone (A2 pin) — no sidecar state files"

requirements-completed: [REVMODE-09]

# Metrics
duration: 9min
completed: 2026-07-17
---

# Phase 10 Plan 03: Hash-Only Restore Audit Record Summary

**Discriminated `action:'restore'` hash-only audit line + total-error counters aggregator shipped beside the LOCKED hook AuditRecord stream, with a builder whose input type structurally cannot carry raw originals**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-07-17T22:53:08Z
- **Completed:** 2026-07-17T23:02:07Z
- **Tasks:** 3 (RED, GREEN, REFACTOR-skipped)
- **Files modified:** 2 created

## Accomplishments

- REVMODE-09 audit surface: every restore invocation can now be recorded as a hash-only JSONL line (`ts, action:'restore', sessionScope, restored, unmatched, skippedSecret, hashes[16-hex]`) in the existing `<cwd>/.mrclean/audit.jsonl` — raw originals never reach the builder, let alone disk
- A3 pin honored: `src/audit/log.ts` and `src/audit/canary-leak.ts` are byte-untouched (`git diff --stat e950d76..HEAD` empty); the restore record is a sibling type, not a widening of the LOCKED unions
- A2 pin honored: `aggregateRestoreCounters` derives `restored_total`/`unmatched_total` from the audit stream alone — ENOENT yields zeros, malformed lines are skipped, tampered non-numeric counters coerce to 0, and the reader never throws
- Heterogeneous-stream proof: suite writes a valid hook AuditRecord line and a restore line into one file; the aggregator excludes the hook line on the discriminant and `assertNoCanaryLeak` passes unchanged over the mixed stream
- 12 new tests, 32/32 green across all unit audit suites; module is 196 lines with exactly the 4 planned exports

## Task Commits

Each task was committed atomically (TDD gate sequence):

1. **Task 1 (RED): Failing restore-audit record suite** - `59fcaf5` (test)
2. **Task 2 (GREEN): Implement src/audit/restore-log.ts** - `632db78` (feat)
3. **Task 3 (REFACTOR): Tidy line-reader helpers** - skipped per plan ("skip the commit if nothing to clean"): `auditLogPath`/`isRestoreLine`/`finiteOrZero` helpers were already extracted in GREEN and the parse loop is ~20 lines

## TDD Gate Compliance

- RED gate: `59fcaf5 test(10-03)` — suite failed on module-not-found before implementation (RED-CONFIRMED via the plan's verify grep)
- GREEN gate: `632db78 feat(10-03)` — all 12 tests pass with zero assertion edits; existing audit suites green alongside
- REFACTOR gate: intentionally skipped (no commit) — allowed by Task 3's own acceptance text; export surface verified at 4

## Files Created/Modified

- `src/audit/restore-log.ts` - RestoreAuditRecord type, LOCKED no-raw builder, O_APPEND writer (imports AuditWriteError from log.js), total-error counters aggregator
- `tests/audit/restore-log.test.ts` - 12 tests: builder 7-key shape lock + ISO ts, over-shaped-input no-serialize (CR-01), distinct+sorted normalisation without input mutation, newline-terminated append round-trip, two-line sequence, ENOENT AuditWriteError with `mrclean install` hint, heterogeneous aggregation sum, missing-file zeros, malformed-line skip, tampered-counter guard, 16-hex-present/raw-absent + assertNoCanaryLeak ok over the mixed stream

## Decisions Made

- Builder owns the `hashes` determinism invariant (`[...new Set(input.hashes)].sort()`) — implements the type's documented "DISTINCT ... sorted (deterministic)" contract at the single production point; immutable (fresh array, caller's array untouched)
- The module contains zero hashing code and zero mentions of the hash-helper identifiers even in comments — guarantees the "module never hashes" grep gate passes under both GNU and BSD grep regex dialects
- Error message copy for both AuditWriteError branches mirrors `writeAuditRecord` byte-for-byte (same failure mode, same file, same hint) instead of exporting a shared builder from the LOCKED log.ts

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TS2352 cast error in the CR-01 over-shaped-input test**
- **Found during:** Task 2 (GREEN) — the `npm run typecheck` acceptance gate
- **Issue:** `record as Record<string, unknown>` fails TS2352 (insufficient type overlap with `RestoreAuditRecord`'s literal-typed `action`)
- **Fix:** Convert through `unknown` first: `record as unknown as Record<string, unknown>` — one-line, runtime assertions byte-identical
- **Files modified:** tests/audit/restore-log.test.ts
- **Verification:** typecheck reports 0 errors referencing restore-log; all 12 tests still pass unmodified in behavior
- **Committed in:** `632db78` (part of GREEN commit)

### Clarifications (no code impact)

- The plan's behavior note described hook-style fixture lines as having "no `action` key", but the LOCKED `AuditRecord` interface requires `action: 'block' | 'substitute' | 'audit'`. Followed the task's read_first text ("minimal valid shape from log.ts unions"): the fixture carries `action: 'substitute'`, which is the stronger discriminant proof — the aggregator must exclude hook lines that DO carry a non-`'restore'` action, which is what real streams contain.

### Environment setup (not a deviation)

- The fresh worktree had no `node_modules`; ran `npm ci --prefer-offline` from the committed lockfile (3s, cache hit) before the RED run. No dependency changes — lockfile untouched.

## Deferred Issues

- 38 pre-existing `npm run typecheck` errors in files untouched by this plan (tests/hook/handlers-detection.test.ts, tests/install/idempotency.test.ts, tests/mcp/redact.test.ts, tests/mcp/server-ner-preload.test.ts, and others) — present at base `46f0ad8`, out of scope per the executor scope boundary; not fixed, no re-runs chasing them. Recorded here (merge-safe) instead of a shared deferred-items.md that eight parallel wave-1 agents would conflict on.

## Known Stubs

None — all four exports are fully implemented and tested. Downstream wiring (10-05 CLI writes, 10-06 status reads, 10-08 e2e leak-grep) is declared future-plan scope in the plan's key_links, not a stub in this module.

## Verification Results

- `npx vitest run tests/audit/ --project=unit` — 4 files, 32/32 passed (12 new + 20 existing coexist)
- TDD gates: `test(10-03)` → `feat(10-03)` present in order
- `git diff --stat e950d76..HEAD -- src/audit/log.ts src/audit/canary-leak.ts` — empty (LOCKED modules byte-untouched)
- `grep -c "LOCKED" src/audit/restore-log.ts` — 3 (>= 1)
- Non-comment hash-identifier grep — 0 (module never hashes; whole-file count is also 0)
- `npm run typecheck` — 0 errors referencing src/audit/restore-log or tests/audit/restore-log
- Module 196 lines (< 200); exactly 4 exports

## Threat Model Outcomes

- T-10-03-01 (info disclosure via builder) — mitigated: pre-hashed-only input type + destructure-pick + LOCKED comment + over-shaped-input serialization test
- T-10-03-02 (truncated-hash brute force) — accepted residual, matches shipped audit posture
- T-10-03-03 (tampered file DoS) — mitigated: total-error reader proven by malformed/tampered/missing-file tests
- T-10-03-04 (repudiation) — mitigated in-scope: writer throws AuditWriteError so the 10-05 caller must handle visibly
- T-10-03-05 (LOCKED schema widening) — mitigated: sibling module; diff gate empty; existing canary suites green

No new threat surface beyond the plan's register — the only file access added is the modeled audit.jsonl boundary.

## Self-Check: PASSED

- src/audit/restore-log.ts — FOUND
- tests/audit/restore-log.test.ts — FOUND
- Commit 59fcaf5 (test) — FOUND
- Commit 632db78 (feat) — FOUND
