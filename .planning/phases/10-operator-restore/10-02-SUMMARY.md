---
phase: 10-operator-restore
plan: 02
subsystem: restore
tags: [typescript, aes-gcm, session-map, inverted-index, policy-gate, tdd]

# Dependency graph
requires:
  - phase: 09-session-state-adapter
    provides: encrypted session store (readSessionMapFile total-error chokepoint, statePaths/mapPathFor, ensureSessionKey/encryptMapBuffer), frozen restorable partition (isRestorableType), SESSION_ID_RE/isValidSessionId allowlist, v2 token grammar (formatV2Token/hmacAddress)
provides:
  - buildRestoreIndex(baseDir, sessionFilter?) — policy-filtered inverted index (placeholder -> original) union across all live decryptable maps, with optional validated single-session narrowing
  - RestoreIndex interface { placeholders, secretPlaceholders, sessions } consumed by 10-01's engine and 10-05's CLI
  - secretPlaceholders set (entries failing the restorable gate) for engine short-circuiting
  - the read-side policy gate Phase 9 reserved for Phase 10, proven against a hand-poisoned real-ciphertext map
affects: [10-05 restore CLI, 10-06, 10-07, 11-wire-safety-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-side policy gate as third defense layer: isRestorableType && 'original' in entry, applied at index build over the write-time floor and parse-time drop"
    - "Janitor filename-candidacy duplicated (not shared) across trust tiers — janitor deletes, restore reads; sharing would couple REVMODE-08's separate error domains"
    - "Real-ciphertext fixture recipe: hand-poisoned map built as raw JSON, encrypted via encryptMapBuffer under the session's REAL key, envelope bytes written directly (bypasses serializer strip)"
    - "Zero-write read proof: sorted [name, mtimeMs] dir snapshots before/after, byte-identical assertion (TTL heartbeat untouched)"

key-files:
  created:
    - src/restore/session-index.ts
    - tests/restore/session-index.test.ts
  modified: []

key-decisions:
  - "sessionFilter narrows the discovery listing (readdir then filter) rather than direct-reading the map path — keeps the fs surface uniform (readdir + readSessionMapFile only) and the no-write proof simple"
  - "Restorable-typed entries lacking `original` land in NEITHER structure (fail the pair gate, not secret-class) — matches the must_haves gate expression exactly"
  - "Poisoned-map JSON.stringify assertion materializes Map/Set to arrays first — a raw stringify of the result would serialize Maps as {} and pass vacuously"

patterns-established:
  - "src/restore/ trust-direction module header: opposite direction from src/placeholder/, no hook/detect/mcp importers, CLI-only consumer"
  - "Fence-safe phrasing: banned tokens (cipher primitives, lock lib, hydration facade, write APIs) absent from code AND comments in src/restore/"

requirements-completed: [REVMODE-01]

# Metrics
duration: 8min
completed: 2026-07-17
---

# Phase 10 Plan 02: Policy-Filtered Restore Session Index Summary

**buildRestoreIndex over the encrypted session store — janitor-candidacy discovery, union index across all live decryptable maps (A4 pin), and the read-side policy gate proven against a hand-poisoned real-ciphertext map**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-17T22:52:20Z
- **Completed:** 2026-07-17T23:00:02Z
- **Tasks:** 3 (RED, GREEN, REFACTOR-skipped)
- **Files modified:** 2 created

## Accomplishments

- The read-side policy gate `src/state/session-map.ts` explicitly reserved for Phase 10 now exists: only entries passing `isRestorableType(entry.type) && 'original' in entry` (and not OVF-labelled) contribute placeholder->original pairs
- Hand-poisoned map proof: a valid SessionMapV1 JSON hand-built with an AWS_KEY entry carrying `original: 'zz-poisoned-secret-original'`, encrypted under the session's REAL key via `encryptMapBuffer` and written as envelope bytes, contributes NOTHING restorable — the poisoned value appears in no index structure (parse-time drop + read-side gate, defense in depth); non-vacuity pinned by asserting the map DID decrypt (sessions === 1) and its secret placeholder WAS seen
- Union semantics (planner pin A4): 2-session fixture yields exactly 3 pairs (sid1 WORD + sid1 PII_EMAIL + sid2 WORD); AWS_KEY placeholder lands only in secretPlaceholders; the WORD@1000 OVF token lands in NEITHER structure
- Hostile sessionFilter rows (`../../etc/passwd`, `mcp-server`) return an empty index with zero paths derived — `isValidSessionId` runs before ANY `statePaths` call, even with valid maps on disk
- Total-error read discipline: corrupt map (one ciphertext byte flipped at CT_OFFSET 37) skipped silently while surviving sessions still index; non-conforming filenames (`README.txt`, `evil..map`, `<sid>.map.bak`) invisible; absent sessions dir yields the empty index, never a throw
- Zero-write proof (Pitfall 7 / REVMODE-08 groundwork): sessions/ and keys/ dir listings + per-file mtimeMs byte-identical across a build — restore can neither refresh TTL heartbeats nor leave litter

## Task Commits

Each task was committed atomically (TDD gate sequence):

1. **Task 1 (RED): Failing real-ciphertext index suite incl. poisoned-map proof** - `1341b6a` (test) — 11 tests, confirmed failing on module-not-found
2. **Task 2 (GREEN): Implement buildRestoreIndex** - `e2e3bf3` (feat) — 11/11 green, fence greps clean
3. **Task 3 (REFACTOR): Tidy candidacy helpers** - skipped per task's skip clause (see Decisions)

## Files Created/Modified

- `src/restore/session-index.ts` (144 lines) - Discovery + policy-filtered inverted index build; fs surface exactly readdir + readSessionMapFile; exports `buildRestoreIndex`, `RestoreIndex`
- `tests/restore/session-index.test.ts` (370 lines) - 11-test real-ciphertext suite; all persisted fixtures written via `writeSessionMapFile` or `encryptMapBuffer` (never raw JSON into sessionsDir)

## TDD Gate Compliance

- RED gate: `test(10-02): add failing session-index policy-gate suite` (`1341b6a`) — suite failed on `Cannot find module '../../src/restore/session-index.js'` before implementation
- GREEN gate: `feat(10-02): implement policy-filtered restore session index` (`e2e3bf3`) — all 11 Task-1 tests pass unmodified
- REFACTOR gate: intentionally skipped. The task names two candidate improvements (extract inline candidacy logic to a named function; name the `.map` literal) — both were already present in the GREEN implementation (`sidFromMapName` helper, `MAP_EXT` and `OVF_LABEL` constants). No changes, no commit, suite untouched.

## Verification Results

- `npx vitest run tests/restore/session-index.test.ts --project=unit` — 11/11 passed
- Fence grep (non-comment lines, banned tokens `createDecipheriv|node:crypto|proper-lockfile|readSessionMapForHydration|writeFile`) — 0 matches; banned tokens kept out of comments too for grep robustness
- `grep -c "isValidSessionId" src/restore/session-index.ts` — 3 (validate-before-paths present)
- `npm run typecheck` — 0 errors referencing `src/restore/` or `tests/restore/` (38 pre-existing errors in unrelated files; see Deferred Issues)
- `git diff --stat e950d76..HEAD -- src/state src/hook src/detect src/placeholder` — empty (frozen trees untouched)
- TDD gates: `git log --grep="test(10-02)"` and `--grep="feat(10-02)"` both non-empty, in RED-then-GREEN order

## Decisions Made

- **sessionFilter narrows the readdir listing rather than direct-reading `mapPathFor(filter)`** — keeps the fs surface uniform (readdir + readSessionMapFile only), observationally identical, and the no-write proof trivially covers both paths
- **REFACTOR commit skipped** — the plan's own candidate cleanups were already in the GREEN implementation; committing a no-op would violate the task's "skip the commit if nothing to clean" clause
- **Poisoned-map stringify assertion materializes Map/Set entries to arrays** — `JSON.stringify` of a raw Map serializes as `{}`, which would make the "no poisoned substring" assertion vacuous; materialization makes it substantive

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- A repo PreToolUse hook (`block-no-verify`) false-positived on the first RED commit attempt: the worktree guard's `[ -n "$VAR" ]` shell test in the same compound command as `git commit` matched the hook's `-n` (no-verify short flag) pattern. Resolved by running the guards and the commit in separate Bash invocations and using `[ "x$VAR" != "x" ]` style in guard scripts. No hook was bypassed.

## Deferred Issues

- **Pre-existing typecheck errors (38) in unrelated files** — `tests/hook/handlers-detection.test.ts`, `tests/install/idempotency.test.ts`, `tests/mcp/redact.test.ts`, `tests/mcp/server-ner-preload.test.ts` fail `npm run typecheck` at the plan's base commit (46f0ad8), before any 10-02 change. Out of scope per the deviation scope boundary (not caused by this plan's changes); none reference `src/restore/` or `tests/restore/`. Recorded here rather than in a shared `deferred-items.md` because parallel worktree agents writing one shared phase file would merge-conflict; the orchestrator can consolidate from wave SUMMARYs.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `RestoreIndex` shape (`placeholders`, `secretPlaceholders`, `sessions`) is live for 10-01's engine (secret short-circuit set) and 10-05's CLI (index construction + `--session` narrowing)
- The trust-direction module header and fence-safe discipline are established for the rest of `src/restore/`
- Note for the orchestrator: plans 10-01 and 10-02 both carry REVMODE-01 (engine + index are two halves of the policy-filtered restore); REQUIREMENTS.md traceability should be reconciled centrally after the wave merges

## Self-Check: PASSED

- FOUND: src/restore/session-index.ts
- FOUND: tests/restore/session-index.test.ts
- FOUND: commit 1341b6a (test(10-02))
- FOUND: commit e2e3bf3 (feat(10-02))
- 11/11 tests green on final run; no deletions in any plan commit; no untracked files left

---
*Phase: 10-operator-restore*
*Completed: 2026-07-17*
