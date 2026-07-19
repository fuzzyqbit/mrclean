---
phase: 10-operator-restore
plan: 05
subsystem: cli
tags: [restore, commander, stdin, degrade, proper-lockfile, tdd, vitest]

# Dependency graph
requires:
  - phase: 10-operator-restore
    provides: "10-01 restoreText engine; 10-02 buildRestoreIndex policy-gated inverted index; 10-03 buildRestoreAuditRecord/writeRestoreAuditRecord hash-only audit"
  - phase: 09-session-state-adapter
    provides: "ensureSessionKey/writeSessionMapFile real-ciphertext store; isValidSessionId sid gate; LOCK_OPTS acquire recipe; atomic-rename lock-free reads"
provides:
  - "runRestore(opts) — the operator round-trip: stdin/file read -> index build -> engine -> stdout/stderr emission -> hash-only audit"
  - "RunRestoreOpts — { file?, session?, cwd?, baseDir?, stdin? } with test seams (baseDir/cwd/stdin injection)"
  - "`mrclean restore [file] [--session <uuid>]` commander subcommand — dynamic import, hook cold path untouched"
  - "REVMODE-08 degrade matrix: 6 corruption shapes fail one-way + lock-held liveness row (SC3 'locked' clause direct)"
affects: [10-07 fence-lock, 10-08 mixed-canary + leak-grep, 10-06 status counters read what this writes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CLI action module (runIgnore analog) with exit-2 reserved for hard input errors, exit-0 constant-shape degrade for everything cosmetic"
    - "Hash-at-the-CLI-boundary: distinct+sorted redactedHash computed in runRestore before the audit builder ever sees data"
    - "Belt-and-braces total posture with stdoutWritten/warnedNoMaps flags — an unexpected throw degrades to passthrough without double emission"
    - "Byte-locked stderr copy constants shared test<->impl by literal duplication (never cross-imported)"

key-files:
  created:
    - src/restore/cli.ts
    - tests/cli/restore.test.ts
    - tests/restore/degrade.test.ts
  modified:
    - src/cli.ts

key-decisions:
  - "stdin readAll uses Buffer-concat accumulate (not string +=) — multi-byte UTF-8 sequences split across chunk boundaries stay intact; still the RESEARCH Code Example 3 for-await-to-EOF shape, never the hook's timeout reader"
  - "Degrade summary counts on the belt-and-braces catch path report zeros (counts snapshot assigned only after the engine pass) — accurate for a passthrough, never fabricated"
  - "Row (g) holds the lock via the REAL lockfile.lock(mapPath, LOCK_OPTS) primary recipe (not the planted-artifact fallback); release() in-test with an afterEach pendingRelease safety net"

patterns-established:
  - "Degrade shape contract: stdout === input byte-identical, exactly-2-line constant stderr (WARN + summary), exit 0, listings+mtimes snapshots unchanged"
  - "The dynamic import in src/cli.ts .action() is the ONLY sanctioned import site of src/restore/ (10-07 fence-locks it)"

requirements-completed: [REVMODE-01, REVMODE-08]

# Metrics
duration: 15min
completed: 2026-07-17
---

# Phase 10 Plan 05: Operator Restore CLI + Degrade Matrix Summary

**`mrclean restore` operator round-trip shipped: stdin/file → policy-gated index → single-pass engine → restored stdout with hash-only audit, and a 7-row REVMODE-08 matrix proving every corruption shape fails one-way at exit 0 while a held hook-side lock never blocks a lock-free read**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-17T23:07:23Z
- **Completed:** 2026-07-17T23:22:17Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 3 created, 1 modified

## Accomplishments

- REVMODE-01 CLI half complete: `mrclean restore [file] [--session <uuid>]` pipes redacted text (stdin to EOF, or a file) to restored stdout; diagnostics and the counts summary (`restored= unmatched= secret-skipped= sessions=`) go ONLY to stderr — HOOK-06 stream discipline proven by byte-equality assertions
- REVMODE-08 degrade semantics complete at unit level: absent baseDir, byte-flipped ciphertext (CT_OFFSET 37), truncated envelope (20 bytes), garbage key, chmod-000 map, and unknown-but-valid `--session` all degrade one-way — stdout === input byte-identical (token PRESENT, non-vacuous), exactly 2 constant stderr lines with no values/paths/fs-error text, exit-equivalent 0, and sessions/+keys/ listings + per-file mtimes untouched (TTL heartbeat preserved)
- SC3 'locked' clause proven DIRECT (row g): with a proper-lockfile lock held on a seeded map via the hook's exact LOCK_OPTS recipe, runRestore completes lock-free with the token correctly restored (restored=1), summary-only stderr, `lockfile.check` still true after the run, clean release, and holder-owned lock-artifact mtime excluded from the zero-litter comparison — zero hardening was needed, confirming reads add no lock coupling
- Hard input errors exit 2 exactly as pinned: malformed `--session` validated BEFORE any path derivation with the sid never echoed (hostile-shaped non-echo discipline); unreadable input file echoes only the operator's own path
- Hash boundary lives at this seam: `[...new Set(result.restoredOriginals)].map(redactedHash).sort()` feeds the 10-03 builder; the seam suite greps raw originals ABSENT from audit.jsonl; audit write failure degrades to a constant WARN with restored output unaffected (T-10-05-06 accepted residual)
- No shared kill switch (Pitfall 6): src/restore/cli.ts imports zero config/hook/detect-engine/state-write modules (grep gate 0); tests/state/chaos.test.ts re-run green — redaction provably indifferent to restore's existence

## Task Commits

Each task was committed atomically (TDD discipline):

1. **Task 1 (RED): CLI seam suite** - `f361eff` (test) — 9/9 failed on missing src/restore/cli.js (RED observed)
2. **Task 1 (GREEN): runRestore + subcommand registration** - `dca3bcb` (feat) — 9/9 green, zero assertion edits
3. **Task 2: REVMODE-08 degrade matrix** - `daa76b2` (test) — all 7 rows green against Task 1's implementation as built; no fix commit required (plan anticipated: "Expect ZERO hardening for row (g)")

## Files Created/Modified

- `src/restore/cli.ts` (215 lines) - runRestore: sid gate → input read (file or for-await stdin accumulate) → buildRestoreIndex → restoreText → single stdout write → hash-only audit → always-last summary line; belt-and-braces catch degrades to passthrough
- `src/cli.ts` - restore subcommand registered between doctor and the entrypoint guard (guard byte-untouched); dynamic `await import('./restore/cli.js')` is the only restore reference
- `tests/cli/restore.test.ts` (369 lines, 9 tests) - stdin/file modes, --session narrowing + audit sessionScope, malformed-sid exit 2 (x2 via it.each) with listings-untouched proof, unreadable-file exit 2, hash-only audit line + raw-absence grep, audit degrade, full counts row
- `tests/restore/degrade.test.ts` (397 lines, 8 tests) - rows (a)-(f) via shared assertDegradeShape (byte-identical stdout, exactly-2-line stderr, no exit, snapshot equality), visible platform-gap placeholder for row (e), row (g) lock-held liveness with real lockfile.lock/check/release

## Decisions Made

- **Buffer-concat readAll**: the RESEARCH example's `out += chunk` string accumulate would corrupt multi-byte UTF-8 sequences split across stdin chunk boundaries; kept the same for-await-to-EOF shape with `Buffer.concat` — behavior-identical for ASCII, correct for all input
- **Counts snapshot semantics**: `counts` is reassigned as a fresh object only after the engine pass; the belt-and-braces catch path therefore reports zeros — honest for a passthrough (nothing was restored)
- **Row (g) primary recipe**: used `lockfile.lock(mapPath, LOCK_OPTS)` (LOCK_OPTS imported from src/state/lock.js — a src import, fence-safe) rather than the planted `.lock`-directory fallback; added a `pendingRelease` afterEach net so a failing row cannot poison siblings
- **Deferred-items placement**: recorded pre-existing typecheck errors in this SUMMARY (10-03's merge-safe precedent) instead of creating a shared deferred-items.md that parallel wave-2 agents would conflict on

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] UTF-8-safe stdin accumulation**
- **Found during:** Task 1 (GREEN) implementation of readAll
- **Issue:** The literal RESEARCH Code Example 3 (`out += chunk`) implicitly stringifies each Buffer chunk independently; a multi-byte UTF-8 sequence split across two chunks decodes to U+FFFD replacement characters — silent input corruption for non-ASCII redacted text
- **Fix:** Accumulate `Buffer[]` and decode once via `Buffer.concat(chunks).toString('utf8')`; same for-await read-to-EOF shape, no new imports
- **Files modified:** src/restore/cli.ts
- **Verification:** all 9 seam tests green; stdin mode byte-equality assertions pass
- **Committed in:** `dca3bcb` (part of GREEN commit)

### Environment setup (not a deviation)

- Fresh worktree had no node_modules; ran lockfile-pinned `npm ci` (no dependency changes). The prepare script rebuilt `dist/cli.js`/`dist/mcp.js` in the working tree — reverted via targeted `git checkout -- dist/cli.js dist/mcp.js` per the repo worktree policy; **no dist/ artifact appears in any commit** (verified: all 3 commits touch only src/ + tests/)

## Deferred Issues

- Pre-existing `npm run typecheck` errors in files untouched by this plan (src/audit/log.ts TS4115, src/detect/layer1-regex/{gitleaks-adapter,secretlint-engine}.ts, src/doctor/{bench,version-check}.ts, src/model/pipeline-singleton.ts, and 6 legacy test files) — present at base `0899139`, out of scope per the executor scope boundary; not fixed, no re-runs chasing them. The plan's typecheck gate is scoped ("no errors referencing src/restore/ or src/cli.ts") and passes clean.

## Known Stubs

None — runRestore is fully wired end-to-end (real index, real engine, real audit writes); no hardcoded-empty values flow to output, no placeholder copy, no TODO/FIXME markers.

## Verification Results

- `npx vitest run tests/cli/restore.test.ts tests/restore/degrade.test.ts tests/restore/engine.test.ts tests/restore/session-index.test.ts --project=unit` — 4 files, 42 passed / 1 skipped (the visible platform-gap placeholder)
- `npx vitest run tests/restore/degrade.test.ts tests/state/chaos.test.ts --project=unit` — 13 passed / 2 skipped (chaos win32 placeholder + degrade platform placeholder); chaos.test.ts byte-unmodified (separate error domains hold)
- Full unit project regression: 74 files, 781 passed / 3 skipped
- `git diff --stat e950d76..HEAD -- src/hook src/detect src/placeholder tests/placeholder tests/detect` — empty (frozen zones untouched)
- Grep gates: `await import('./restore/cli.js')` count 1; static restore imports in src/cli.ts count 0; banned-import grep in src/restore/cli.ts count 0 (no config/hook/detect-engine coupling); `redactedHash` present (4); `formatV2Token` in degrade suite (4); `lockfile.lock(` in degrade suite (1)
- `npm run typecheck` — 0 errors referencing src/restore/, src/cli.ts, tests/cli/restore, tests/restore
- min_lines: src/restore/cli.ts 215 (>= 80); tests/cli/restore.test.ts 369 (>= 120); tests/restore/degrade.test.ts 397 (>= 120); src/cli.ts contains `restore [file]`

## Threat Model Outcomes

- T-10-05-01 (tampering/elevation via --session) — mitigated: isValidSessionId before ANY path derivation; exit 2 with the sid never echoed; it.each proves `not-a-uuid` and `../../etc` both non-echoed with baseDir listings untouched
- T-10-05-02 (info disclosure via stderr) — mitigated: byte-locked constant copy; degrade rows assert stderr byte-equality (impossible for values/paths/fs-error text to leak past that)
- T-10-05-03 (info disclosure via audit) — mitigated: distinct+sorted redactedHash at this boundary; raw-absence substring grep in the seam suite; 10-08 owns the end-to-end leak-grep
- T-10-05-04 (DoS via shared kill switch) — mitigated: zero-coupling grep gate 0; row (g) holds a live lock through a run proving lock-freedom directly; chaos suite green proves redaction indifferent
- T-10-05-05 (tampering sessions/) — mitigated: write surface is exactly stdout+stderr+audit.jsonl; every row snapshots listings+mtimes before/after; row (g) proves the hook's lock artifact is never stolen/removed
- T-10-05-06 (repudiation on audit failure) — accepted (warned): best-effort audit posture matches the shipped hook; WARN-audit-failed + continue, restored output unaffected — residual documented here

No new threat surface beyond the plan's register — the operator argv/stdin boundary, the stdout exit point, and the audit sink were all modeled; the commander registration adds no reachable surface to hook/MCP paths (dynamic-import-only, fence-locked by 10-07).

## Self-Check: PASSED

- src/restore/cli.ts — FOUND (215 lines)
- src/cli.ts — FOUND (restore [file] registered, entrypoint guard untouched)
- tests/cli/restore.test.ts — FOUND (369 lines)
- tests/restore/degrade.test.ts — FOUND (397 lines)
- Commit f361eff (test, RED) — FOUND
- Commit dca3bcb (feat, GREEN) — FOUND
- Commit daa76b2 (test, degrade matrix) — FOUND
