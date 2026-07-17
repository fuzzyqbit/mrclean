---
phase: 09-session-state-adapter
plan: 03
subsystem: state
tags: [aes-256-gcm, node-crypto, write-file-atomic, encryption-at-rest, reversible-mode, dep0182]

# Dependency graph
requires:
  - phase: 09-session-state-adapter (plan 09-01)
    provides: pinned write-file-atomic@^7.0.1 dependency (Node 20 floor safe)
  - phase: 09-session-state-adapter (plan 09-02)
    provides: SessionMapV1 schema, serializeSessionMap/parseSessionMap, secret-floor entry constructors
provides:
  - AES-256-GCM envelope encrypt/decrypt with fixed offsets, validate-before-slice, and the explicit authTagLength:16 DEP0182 guard (single decrypt construction in the codebase)
  - Per-session key custody: wx create-once 0600 key in 0700 keys/, loser-reads-winner on EEXIST (D-04)
  - readSessionMapFile total-error policy — every corruption shape (ENOENT/EACCES/EISDIR/short/bad header/tag fail/wrong AAD/bad JSON/bad schema/missing key) returns null, no throw reachable
  - writeSessionMapFile: ciphertext-only atomic writes via write-file-atomic with fsync:false + mode 0600 (SC1 substrate)
  - statePaths/keyPathFor/mapPathFor path helpers (baseDir always injected in tests)
  - 33-case corruption-matrix suite incl. SC1 byte-inspection and source-level authTagLength/fsync pins
affects: [09-05 facade, 09-06 janitor, 09-07 import-fence cold-path test, phase-10 restore, phase-11 chaos gates]

# Tech tracking
tech-stack:
  added: [write-file-atomic@7 runtime usage (first call site), ambient d.ts for its untyped v7 surface]
  patterns:
    - single crypto+I/O chokepoint (no cipher/lock imports outside src/state/)
    - total-error-to-ABSENT read path (one catch, no per-failure-class branching)
    - validate-before-slice envelope parsing (length/magic/version gates precede any subarray)
    - source-level pin tests for load-bearing option literals (ner-unreachable precedent)

key-files:
  created:
    - src/state/map-store.ts
    - src/types/write-file-atomic.d.ts
    - tests/state/map-store.test.ts
  modified: []

key-decisions:
  - "Hand-wrote a minimal ambient d.ts for write-file-atomic@7 instead of installing @types/write-file-atomic (targets stale v4 API; zero new deps for a security tool)"
  - "authTagLength: 16 kept as the one literal (not the TAG_LENGTH constant) so the grep/test gate pins the exact DEP0182-guarding source text"
  - "Encoded the Task-2 grep gates as a durable source-pin unit test so Phase 11 can elevate them to CI without rework"
  - "MapEnvelopeError kept module-private (not in the contract export list); reason strings are static shape descriptions only — no plaintext/key material"

patterns-established:
  - "Envelope contract: MRCLNMAP(8)|0x01(1)|IV(12)|tag(16)|ct(N), AAD=mrclean-map-v1:<sid>, MIN_ENVELOPE=38"
  - "Corruption tests hand-build envelopes against exported offsets and always assert null from the read path"
  - "POSIX-only mode assertions with it.skipIf(win32) + documented-gap comment (Pitfall 8); chmod-000 case additionally skips uid 0"

requirements-completed: [REVMODE-02]

# Metrics
duration: 12min
completed: 2026-07-17
---

# Phase 9 Plan 03: Encrypted Map Store Summary

**AES-256-GCM envelope store with DEP0182-guarded decrypt (authTagLength:16 + validate-before-slice), wx create-once key custody in separate 0700 dirs, a total-error-to-ABSENT read path, and fsync-free atomic ciphertext-only writes via write-file-atomic**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-17T02:48:06Z
- **Completed:** 2026-07-17T03:00:07Z
- **Tasks:** 3 (RED, GREEN, REFACTOR-evaluated-no-change)
- **Files modified:** 3 created

## Accomplishments

- REVMODE-02's mechanical substrate exists: raw `.map` bytes on disk are ciphertext-only (byte-scan test proves no originals, no `"entries"` marker, no `MRCLEAN:` placeholder text — only the `MRCLNMAP` magic), keys live in `keys/` (0600 in 0700) separate from `sessions/` (0600 in 0700)
- The DEP0182 window is closed at both levels: the envelope length gate rejects short-tag total lengths before any slice, and the single `createDecipheriv(..., { authTagLength: 16 })` construction rejects truncation that survives the length gate (spliced 4-byte-tag test)
- Full corruption matrix (13 file-level shapes) lands in `null`/ABSENT — the chaos-shaped foundation SC5 and Phase 11 build on; no throw reachable from `readSessionMapFile`
- Fresh-IV-per-write proven at both the encrypt level and the file level (two writes of the same map share no IV/ciphertext bytes — D-03)
- 33 tests green; full suite 759 passed / 14 skipped; differential typecheck byte-identical to the 38-error worktree baseline

## Task Commits

Each task was committed atomically (TDD gates in order):

1. **Task 1 (RED): failing corruption-matrix suite** - `3fce03a` (test) — suite failed on absent module, RED confirmed before implementation
2. **Task 2 (GREEN): implement src/state/map-store.ts** - `faf719f` (feat) — all 33 tests pass unmodified
3. **Task 3 (REFACTOR): evaluated, no commit** — all offsets already named constants, path joins deduplicated via `statePaths`, largest function ~30 lines, export surface exactly matches the interface contract; plan sanctions "commit only if changed"

## Files Created/Modified

- `src/state/map-store.ts` - Envelope encrypt/decrypt (fixed offsets, validate-before-slice, authTagLength:16), key custody (wx create-once, loser-reads-winner), total-error read, wfa ciphertext write (fsync:false, mode 0600); 263 lines
- `tests/state/map-store.test.ts` - 33-case REVMODE-02 corruption matrix: roundtrip, fresh-IV divergence (2 levels), DEP0182 truncated tag (2 levels), tamper, wrong-AAD sid swap (with control read), wrong key, short/garbage/empty file, non-JSON plaintext, schema-fail plaintext, dir-as-map, chmod-000 (POSIX, non-root), missing key, custody idempotence + loser-reads-winner, SC1 byte scan, POSIX mode asserts, source-level pins; 591 lines
- `src/types/write-file-atomic.d.ts` - Minimal ambient types for the untyped write-file-atomic@7 surface (promise call shape, fsync/mode options), verified against the installed lib/index.js

## Decisions Made

- **Ambient d.ts over @types install:** write-file-atomic v7 ships no types and `@types/write-file-atomic` targets the v4 API. A 40-line local declaration covering exactly the called surface keeps the supply chain flat (CLAUDE.md minimal-surface rule) and avoids an unplanned package install.
- **Literal `authTagLength: 16`:** kept as a literal (with the DEP0182 comment) rather than reusing `TAG_LENGTH`, so the acceptance grep and the source-pin test both pin the exact guarding text — drift-proof.
- **Source-pin test added:** the Task-2 grep gates (`authTagLength: 16` exactly once, `fsync: false` present) are encoded as a unit test using the ner-unreachable source-reading precedent, making the gates durable for Phase 11's CI elevation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added ambient type declaration for untyped write-file-atomic@7**
- **Found during:** Task 2 (GREEN implementation)
- **Issue:** `write-file-atomic@7.0.1` ships no TypeScript types and no `@types/write-file-atomic` is installed (the DT package targets the v4 API anyway). The bare import would raise TS7016 — a NEW typecheck error vs the 38-error baseline, failing the differential gate.
- **Fix:** Created `src/types/write-file-atomic.d.ts` — a minimal `declare module` covering only the called surface (promise signature, `fsync`/`mode`/`chown`/`encoding`/`tmpfileCreated` options), verified against the installed v7 source. No package installed.
- **Files modified:** src/types/write-file-atomic.d.ts (new)
- **Verification:** `npm run typecheck` error set byte-identical to the 38-error baseline (diff clean)
- **Committed in:** faf719f (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required to keep the differential typecheck gate clean without an unplanned dependency install. No scope creep.

## Issues Encountered

- A PreToolUse commit-guard hook false-positived on the first RED commit attempt (compound bash command with inline worktree assertions + multi-line message). Resolved by splitting the safety assertions and the `git commit` into separate invocations — no hook was bypassed, `--no-verify` never used.

## Verification Gates (Task 2 acceptance)

- `npx vitest run tests/state/map-store.test.ts --project=unit` — 33/33 green
- `grep -c "authTagLength: 16" src/state/map-store.ts` — exactly 1
- `grep "fsync: false" src/state/map-store.ts` — present on the wfa call line
- `grep -rl "createDecipheriv\|createCipheriv" src/` — only `src/state/map-store.ts`
- `git diff --stat tests/placeholder tests/detect tests/audit` — empty (zero edits to existing suites)
- `npm run typecheck` — 38 errors, diff-identical to worktree baseline (zero new)
- `npm test` — 759 passed / 14 skipped, 0 failed

## Known Stubs

None — no placeholder values, no TODO/FIXME markers, no unwired data paths in the created files.

## Next Phase Readiness

- 09-05 (facade + lock) can consume the full contract: `statePaths`, `keyPathFor`, `mapPathFor`, `encryptMapBuffer`, `decryptMapBuffer`, `ensureSessionKey`, `readSessionMapFile`, `writeSessionMapFile`, `MIN_ENVELOPE`
- 09-06 (janitor) has stable key/map path derivation and the pairing layout it sweeps
- 09-07's import-fence test will find cipher constructions confined to `src/state/` (verified by grep and by the in-suite source pin)
- Note for orchestrator: `requirements-completed: [REVMODE-02]` recorded here; REQUIREMENTS/STATE/ROADMAP writes deferred to the orchestrator per parallel-wave contract

## Self-Check: PASSED

All 3 created files exist on disk; commits 3fce03a (test) and faf719f (feat) present in order; 33/33 suite green; typecheck diff clean vs baseline.

---
*Phase: 09-session-state-adapter*
*Completed: 2026-07-17*
