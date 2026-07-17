---
phase: 09-session-state-adapter
plan: 05
subsystem: state
tags: [proper-lockfile, deadline-degrade, hmac-reconcile, reversible-mode, vitest]

# Dependency graph
requires:
  - phase: 09-02
    provides: session-map schema, isValidSessionId gate, hmacAddress, formatV2Token, ReversibleHydration/PendingAllocation/PlaceholderRename contracts
  - phase: 09-03
    provides: map-store I/O (ensureSessionKey, readSessionMapFile, writeSessionMapFile, mapPathFor, statePaths)
  - phase: 09-04
    provides: PlaceholderManager hydrateReversible/drainPendingAllocations v2 seam
provides:
  - src/state/lock.ts — pinned proper-lockfile recipe (realpath:false, stale:2500, ms-scale retries) + hand-built deadline-degrade wrapper (withMapLock)
  - src/state/index.ts — facade: sid gate, readSessionMapForHydration (total read path), persistAllocations (5-step locked reconcile transaction), applyRenamesToText/applyRenamesDeep
  - REVMODE-04 unit proof: cross-process identical placeholders, foreign-win adoption, counter renumber, degrade safety
affects: [09-07 hook handlers, 09-08 stress harness, phase-10 restore]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "deadline race over lock acquire: Promise.race(lockPromise, timer) with late-acquire immediate-release and swallowed late rejection"
    - "reconcile-under-lock: recompute every pending hmac with the AUTHORITATIVE store salt; hit adopts, miss renumbers, diff emits rename"
    - "facade pre-creates sessions/ (0700) before locking — proper-lockfile mkdir primitive needs the parent dir"

key-files:
  created:
    - src/state/lock.ts
    - src/state/index.ts
    - tests/state/lock.test.ts
    - tests/state/allocation.test.ts
  modified: []

key-decisions:
  - "Facade pre-creates sessionsDir (mode 0700, mirroring map-store DIR_MODE) before withMapLock — live probe showed proper-lockfile ENOENTs on a missing parent even with realpath:false; without this the first-ever persist would always degrade"
  - "Invalid-sid warn carries NO sessionId field — a rejected sid is hostile-shaped (possibly path-traversal) and is never echoed to stderr; the degrade warn (valid UUID) carries warn + sessionId only"
  - "applyRenamesDeep depth cap 32: subtrees beyond the cap pass through untouched (fail-safe against pathological nesting)"

patterns-established:
  - "withMapLock<T> returns T | 'degraded' — acquire failures of ANY class degrade, fn errors propagate after release (facade owns txn degrade)"
  - "reconcilePending is a pure function over (map, pending) → {nextMap, renames}; disk map never mutated"

requirements-completed: [REVMODE-04]

# Metrics
duration: 16min
completed: 2026-07-17
---

# Phase 9 Plan 05: Locked Allocate-and-Persist Transaction Summary

**Cross-process placeholder identity via proper-lockfile + hand-built deadline-degrade wrapper: two processes redacting the same original converge on ONE map entry and identical final placeholders, with renames correcting the loser's substituted text**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-07-17T03:04:54Z
- **Completed:** 2026-07-17T03:21:00Z
- **Tasks:** 3 (RED, GREEN, REFACTOR-assessed-unnecessary)
- **Files modified:** 4 created

## Accomplishments

- **REVMODE-04 proven at unit level:** allocate-if-absent idempotence (second hydration cycle resolves `val-A` to the identical stored placeholder with a noop persist), foreign-win adoption (provisional loser adopts the store's token via rename, no counter burned), counter renumber (provisional `:001:` colliding with a foreign entry lands at `:002:` — zero loss, zero NNN duplicates)
- **Deadline degrade path proven:** externally-held lock + 60 ms deadline resolves `{ status: 'degraded' }` with the map byte-identical on disk, exactly ONE single-line JSON stderr warn carrying `sessionId` and no raw values, and no throw anywhere
- **First-allocation window closed (T-09-05-06):** the fresh-session test asserts key file AND map file both exist after the first locked transaction; `ensureSessionKey` runs INSIDE the lock
- **sid fence structural (T-09-05-01):** `'mcp-server'`, `'../../../etc/foo'`, `'test-session'` all yield null hydration + noop persist with a completely untouched baseDir (readdir → []), and warns never echo the hostile sid
- **Lock never held across detection (D-02):** hydration is lock-free by construction; the only `withMapLock` call wraps the ~1-3 ms read→reconcile→encrypt→write window

## Task Commits

Each task was committed atomically (TDD gate sequence):

1. **Task 1 (RED): failing lock + reconcile-allocation suites** - `ceae297` (test) — 16 cases: 6 lock (recipe constants, nonexistent-target acquire, passthrough+release, held-lock degrade, throw-still-releases, missing-parent degrade) + 10 allocation (fresh-session dual-entry persist with secret floor, cross-cycle identity, foreign-win, renumber, degrade single-warn, noop, invalid-sid matrix, corrupt-map recovery, rename helpers text + deep)
2. **Task 2 (GREEN): lock.ts + index.ts facade** - `6092e46` (feat) — all 16 pass unmodified; whole tests/state set 138/138 green
3. **Task 3 (REFACTOR):** assessed, not needed — `reconcilePending` was already extracted as a pure named function in GREEN, all literals named, every function < 50 lines. No commit per plan ("Commit only if changed").

## Files Created/Modified

- `src/state/lock.ts` - Pinned proper-lockfile recipe (`realpath: false`, `stale: 2500`, ms-scale retries giving up ~46-190 ms randomized) + `withMapLock<T>` deadline-degrade wrapper; exports `UPS_LOCK_DEADLINE_MS=50`, `POST_LOCK_DEADLINE_MS=100` with benchmark comments
- `src/state/index.ts` - Facade: `isValidSessionId` re-export, `readSessionMapForHydration` (total read path, fresh-provisional on absent/corrupt), `persistAllocations` (pinned 5-step transaction: key create-once inside lock → authoritative re-read → salt-recomputed reconcile → fresh-IV atomic write → renames), `applyRenamesToText`/`applyRenamesDeep`
- `tests/state/lock.test.ts` - 6 lock-wrapper cases against a per-test tmpdir
- `tests/state/allocation.test.ts` - 10 facade cases driving the REAL PlaceholderManager through full hydrate→allocate→drain→persist cycles

## Decisions Made

- **Invalid-sid warn omits the sid value** — a rejected sid is hostile-shaped input (traversal strings); echoing it to stderr would put path-like attacker input in logs. The persist-degrade warn (which only fires for valid UUIDs) carries `warn` + `sessionId` exactly, per post-tool-use.ts precedent.
- **Foreign-win rename assertion made fully deterministic** — `applyRenamesToText(provisional, renames) === storeToken` plus a conditional-shape check handles the 2^-32 nonce-collision case without flake potential.
- **Rename helpers use split/join literal replacement** — no regex escaping surface; tokens are unique bracketed strings so renames are overlap-free.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Facade pre-creates sessionsDir before taking the lock**
- **Found during:** Task 1 (RED design — live probe before writing tests)
- **Issue:** The plan states "lock target is mapPath with realpath:false so no pre-create needed." Live probe on the installed proper-lockfile 4.1.2 disproved this for the PARENT directory: `lockfile.lock('<missing-dir>/x.map', { realpath: false, ... })` fails ENOENT after retry exhaustion (~119 ms). Since `sessions/` is created only by `writeSessionMapFile` INSIDE the transaction, the first-ever persist on a fresh install would have always degraded — nothing would ever persist.
- **Fix:** `persistAllocations` runs `mkdir(sessionsDir, { recursive: true, mode: 0o700 })` before `withMapLock` (idempotent, outside the lock hold, mode mirrors map-store's DIR_MODE per D-04). A dedicated lock test ("missing parent directory ⇒ 'degraded'") documents the underlying proper-lockfile behavior.
- **Files modified:** src/state/index.ts (fix), tests/state/lock.test.ts (documenting case)
- **Verification:** fresh-session test persists successfully on a completely empty baseDir; lock suite pins the ENOENT-degrade shape
- **Committed in:** `ceae297` (test) / `6092e46` (fix)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in plan assumption)
**Impact on plan:** Essential for correctness — without it reversible mode would silently never persist on first use. No scope creep; the pinned 5-step in-lock algorithm is unchanged.

## Issues Encountered

- Measured proper-lockfile retry giveup at ~119 ms (RESEARCH claimed ~46 ms; `randomize: true` doubles the envelope). No code impact — the deadline race is the effective bound, exactly as designed; noted here so 09-08's stress harness doesn't treat ~46 ms as a hard ceiling.

## Verification Results

- `npx vitest run tests/state --project=unit` — 138/138 green (5 files)
- Full `npm test` — 788 passed, 14 skipped (uat), 0 failed; zero edits to tests/placeholder, tests/detect, tests/audit
- Differential typecheck — 38 errors, byte-identical to the 38-error baseline set (`comm -13` empty)
- `grep 'realpath: false'` / `grep 'stale: 2500'` match src/state/lock.ts; `grep -r proper-lockfile src/` matches only under src/state/ (sole import in lock.ts; comment mentions in index.ts/map-store.ts)
- `hmacAddress(` recomputed with the STORE's `map.hashSalt` inside `reconcilePending` (src/state/index.ts:201)

## TDD Gate Compliance

- RED gate: `ceae297` `test(09-05): add failing lock + reconcile-allocation suites` (both suites failed on missing modules — confirmed before implementation)
- GREEN gate: `6092e46` `feat(09-05): implement locked allocate-and-persist transaction with reconcile` (all RED tests pass unmodified)
- REFACTOR gate: intentionally no commit — refactor targets already satisfied in GREEN (pure `reconcilePending` helper, named constants)

## Next Phase Readiness

- 09-07 handlers can lazy-import the facade: `readSessionMapForHydration` before detection, `persistAllocations` + `applyRenamesToText`/`applyRenamesDeep` after; deadline constants exported from src/state/lock.ts
- 09-08 stress worker has its exact surface: the SC5 harness spawns real processes against `persistAllocations` — degrade-count-zero assertion is meaningful because the degrade path warns observably (one JSON line per degrade)
- Known measurement note for 09-08: retry giveup is ~46-190 ms randomized, deadline race is the bound

## Self-Check: PASSED

- All 4 created source/test files exist on disk
- SUMMARY.md exists
- Commits `ceae297` (RED) and `6092e46` (GREEN) present in git log

---
*Phase: 09-session-state-adapter*
*Completed: 2026-07-17*
