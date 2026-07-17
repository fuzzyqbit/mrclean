---
phase: 10-operator-restore
plan: 08
subsystem: testing
tags: [leak-grep, canary, restore, audit, inspection, phase-gate, vitest]

# Dependency graph
requires:
  - phase: 10-operator-restore
    provides: "10-05 runRestore CLI seam (RunRestoreOpts baseDir/cwd/stdin injection); 10-03 hash-only restore audit record; 10-02 read-side policy gate; 10-01 restoreText engine"
  - phase: 09-session-state-adapter
    provides: "readSessionMapForHydration/persistAllocations facade flow; encryptMapBuffer/keyPathFor/mapPathFor/readSessionMapFile store primitives; hmacAddress content addressing"
provides:
  - "tests/audit/restore-canary-leak.test.ts — REVMODE-09 four-surface leak-grep over the INTEGRATED restore system: success path + 3 forced-failure paths, all non-vacuity-guarded"
  - "Pinned Phase-11-reusable canary corpus: zz-canary-project-path-7g2 (WORD), kim.canary@zz.invalid (PII_EMAIL), AKIAIOSFODNN7EXAMPLX (secret, non-EXAMPLE-suffixed)"
  - "tests/state/inspection.test.ts extension — restore run proven byte-inert against the store (artifact byte-scan + listings + per-file mtimeMs identity)"
  - "Phase regression gate recorded green: full suite 944 passed, typecheck == 38-error baseline with zero Phase 10 errors, frozen trees zero-diff since e950d76"
affects: [11-wire-safety-verification (elevates these to CI gates), phase-10 verify-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Four-surface invariant matrix as executable spec: restorable canaries REQUIRED on restore stdout (the feature), FORBIDDEN on stderr/audit/artifacts; secret canary FORBIDDEN everywhere including stdout (placeholder survives byte-identical)"
    - "Hand-poison recipe: JSON.stringify (bypassing serializeSessionMap's strip) + encryptMapBuffer under the REAL session key + raw writeFile to mapPathFor — the only way to plant a secret-class original on disk"
    - "prepareArtifactSweep hook: fixture damage that blocks the sweep itself (chmod-000) is undone AFTER the run so the artifact byte-scan stays non-vacuous"

key-files:
  created:
    - tests/audit/restore-canary-leak.test.ts
  modified:
    - tests/state/inspection.test.ts

key-decisions:
  - "Poisoned-store test (c) runs TWICE against the same poisoned map: run 1 (secret token only) proves stdout === input with sessions=1/skippedSecret=1 (drop was surgical, not a whole-map degrade); run 2 (word token) proves the same map still restores its restorable entry — poison-drop is entry-level, non-vacuously"
  - "Row (b) chmod-000 artifact sweep restores mode 0600 AFTER the restore run so the sweep genuinely scans the untouched envelope bytes instead of skipping an unreadable file"
  - "Inspection extension is a purely-appended describe with dynamic imports (runRestore, Readable) — 139 insertions, 0 deletions; existing assertions byte-identical"

patterns-established:
  - "Success-path non-vacuity ordering: restored>=2 parsed from the summary + >=1 action:'restore' audit line proven BEFORE any absence grep (pii-canary line-count precedent extended)"
  - "Poison-fixture non-vacuity: expect(poisonedJson).toContain(SECRET_CANARY) proves the fixture carries the canary before proving the system drops it"

requirements-completed: [REVMODE-09]

# Metrics
duration: 12min
completed: 2026-07-17
---

# Phase 10 Plan 08: Restore Leak-Grep Extension + Phase Regression Gate Summary

**REVMODE-09's second half locked: the integrated restore system swept canary-clean across all four surfaces (stdout/stderr/audit/raw artifacts) on the success path AND three forced-failure paths including a real-key hand-poisoned secret original, the store proven byte-inert across a restore run, and the phase regression gate recorded green (944 tests, 38-error typecheck baseline, frozen trees zero-diff)**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-17T23:27:03Z
- **Completed:** 2026-07-17T23:38:23Z
- **Tasks:** 2
- **Files modified:** 1 created, 1 modified

## Accomplishments

- **Four-surface invariant matrix green over the integrated system** (RESEARCH Leak-Grep Extension Strategy, load-bearing framing): restorable canaries (`zz-canary-project-path-7g2` WORD, `kim.canary@zz.invalid` PII_EMAIL) appear ONLY on restore stdout — proven byte-exact — and are absent from stderr, audit.jsonl (assertNoCanaryLeak), and raw sessions/*.map + keys/* bytes; the secret canary (`AKIAIOSFODNN7EXAMPLX`, deliberately non-EXAMPLE-suffixed to dodge the gitleaks allowlist landmine) appears on NO surface anywhere, with its placeholder surviving byte-identical on stdout
- **Phase 7 lesson honored — error paths swept, not just the happy path**: (a) garbage 17-byte key, (b) chmod-000 EACCES map (POSIX-gated with visible platform-gap placeholder), (c) hand-poisoned ciphertext where the AWS entry carries `original: SECRET_CANARY` encrypted under the REAL session key — every path asserts stdout === input byte-identical, byte-locked constant stderr, canary-free audit, ciphertext-only artifacts
- **The triple gate (GCM auth / parse-drop / read-gate) proven end-to-end against a live poisoned store**: the poisoned map decrypts and indexes (sessions=1 — NOT a degrade), yet the secret token passes through as skippedSecret=1 while the same map's WORD entry still restores in a second run — the drop is surgical and entry-level
- **State seeded through the REAL facade flow** (hydrate → allocate → persist, inspection.test.ts recipe; Pitfall 10 — never hand-written map JSON), with persisted placeholders read back from the encrypted store rather than trusting provisional tokens
- **Store byte-inertness across a restore run** (inspection extension): post-restore, the exact artifact byte-scan still finds no plaintext (WORD/SECRET originals + `"entries"` marker absent from raw map/key bytes) and readdir listings + per-file mtimeMs are identical to pre-restore snapshots — restore's write surface is exactly stdout/stderr/audit.jsonl, the TTL heartbeat never refreshed (Pitfall 7)
- **Phase regression gate green and recorded** (outputs below) — the phase is provably additive outside its sanctioned seams

## Phase Regression Gate (recorded outputs)

**(a) `npm test` — full suite (unit + integration, tools-list included):**
```
Test Files  99 passed | 2 skipped (101)
     Tests  944 passed | 18 skipped (962)
```
Exit 0. (Baseline entering Phase 10 was 861 passed / 16 skipped, 90 files — the delta is Phase 10's additive suites.)

**(b) `npm run typecheck` — differential vs the 38-error baseline:**
```
TOTAL_TS_ERRORS=38   (npm run typecheck 2>&1 | grep -c "error TS")
PHASE10_ERRORS=0     (grep -cE "src/restore|restore-log|src/state/counts|tests/restore|tests/cli/restore|tests/audit/restore-|tests/mcp/status-reversible|tests/state/counts|reversible-raw-keys")
```
Exactly the pre-existing 38; zero errors mention any Phase 10 file.

**(c) Frozen-tree zero-diff since phase base e950d76 (additive-phase proof):**
```
git diff --stat e950d76..HEAD -- src/hook src/detect src/placeholder tests/placeholder tests/detect
(empty — 0 lines of output)
```

**(d) No dist/ artifacts in any plan commit:**
```
git log e950d76..HEAD --name-only -- dist/ | wc -l   →   0
```
(npm test's integration globalSetup rebuilt dist/cli.js + dist/mcp.js in the working tree; both reverted to committed state per worktree repo policy, never staged.)

## Task Commits

1. **Task 1: Restore canary-leak suite — success + every error path** - `c773ee3` (test) — 4 passed, 1 visible platform skip; pii-canary-leak.test.ts byte-untouched (`git diff --stat` empty)
2. **Task 2: Inspection extension + phase regression gate** - `4135a90` (test) — 2 passed, 1 visible win32 skip; 139 insertions, 0 deletions

## Files Created/Modified

- `tests/audit/restore-canary-leak.test.ts` (494 lines, 5 tests) - success-path four-surface matrix (byte-exact stdout/stderr, assertNoCanaryLeak audit sweep, raw artifact byte-scan) + error block (garbage key, chmod-000 with post-run mode restore for the sweep, hand-poisoned real-key ciphertext with a two-run surgical-drop proof) + visible platform-gap placeholder; capture harness and stderr copy duplicated by value from tests/cli/restore.test.ts (never cross-imported)
- `tests/state/inspection.test.ts` (+139 lines appended, 1 new test) - `snapshotStateTree` (sorted listings + per-file mtimeMs) + `captureRestoreRun` harness + the byte-inertness test: real two-event flow → snapshot → real runRestore (non-vacuity: WORD restored, secret placeholder survived) → byte-scan re-run → listings/mtimes identity

## Decisions Made

- **Two-run poisoned-store proof**: the plan asked for stdout === input on path (c); satisfied with a secret-token-only input in run 1, then strengthened with run 2 restoring the WORD entry from the SAME poisoned map — proves the store was live and the poison drop entry-surgical rather than a whole-map failure
- **`prepareArtifactSweep` hook on the shared error-path helper**: chmod-000 blocks the sweep's own readFile; restoring 0600 after the restore run keeps the artifact scan non-vacuous (the envelope bytes were never touched by the run — mtime identity separately proven in the inspection suite)
- **Inspection extension uses dynamic imports** (`await import('../../src/restore/cli.js')`, `await import('node:stream')`) so the diff is purely appended — zero changes to the existing import block or any existing line

## Deviations from Plan

None - plan executed exactly as written. (The `prepareArtifactSweep` chmod-back and the poisoned-map second run are within-task test-design details, not scope deviations.)

## Known Stubs

None — both files are complete executable specs with no placeholders, empty data sources, or TODO markers.

## Self-Check: PASSED

- FOUND: tests/audit/restore-canary-leak.test.ts (494 lines >= 120 min_lines; contains assertNoCanaryLeak x3, runRestore x2 — key_links satisfied)
- FOUND: tests/state/inspection.test.ts (contains "restore" x15 — must_haves `contains` satisfied)
- FOUND: commit c773ee3 (Task 1)
- FOUND: commit 4135a90 (Task 2)
- Verified: `npx vitest run tests/audit/restore-canary-leak.test.ts tests/state/inspection.test.ts --project=unit` → 6 passed | 2 skipped (both skips are visible platform-gap placeholders)
