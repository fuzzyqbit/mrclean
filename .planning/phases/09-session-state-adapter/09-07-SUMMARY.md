---
phase: 09-session-state-adapter
plan: 07
subsystem: hook
tags: [reversible-mode, hook-handlers, lazy-import-fence, locked-transaction, rename-reconcile, cold-path]

# Dependency graph
requires:
  - phase: 09-04
    provides: hydrateSessionManager / drainSessionAllocations detect seam (statically importable — closure-injected, no state runtime)
  - phase: 09-05
    provides: state facade (isValidSessionId, readSessionMapForHydration, persistAllocations, applyRenamesToText/Deep) + POST_LOCK_DEADLINE_MS
provides:
  - PreToolUse reversible branch — Step 2b gate→lazy-import→hydrate before detection; Step 6b drain→ONE locked persist→applyRenamesDeep on updatedInput
  - PostToolUse reversible branch — Step 2b hydrate before the single runDetection; Step 7b drain→ONE locked persist→applyRenamesToText on the STRING updatedToolOutput (E1 shape unchanged)
  - drain-and-DISCARD on budget-deny and dry_run paths in both handlers (store only learns allocations that actually shipped)
  - tests/state/cold-path.test.ts — permanent import-graph fence banning static state/proper-lockfile/write-file-atomic from the 9-module hook-reachable set
affects: [09-08 stress harness, phase-10 restore CLI (reads the store these handlers populate), phase-11 canary/chaos gates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      ReversibleHandle capability handle (nullable facade+deadline pair — reversible-active flag and namespace carrier in one, single dynamic-import site),
      drain-discard on non-emitting return paths (T-09-07-04),
      per-segment try/catch walls around every reversible interaction (Pitfall 6 — facade errors degrade to one-way, never exit-2),
      typeof import() type-position facade typing (erased at compile — no runtime import),
    ]

key-files:
  created:
    - tests/hook/reversible-handlers.test.ts
    - tests/state/cold-path.test.ts
  modified:
    - src/hook/handlers/pre-tool-use.ts
    - src/hook/handlers/post-tool-use.ts
    - dist/cli.js (globalSetup tsup rebuild — separate chore commit per repo convention)

key-decisions:
  - "ReversibleHandle stores the lazily-imported facade namespace from Step 2b for reuse at persist time — satisfies the exactly-one await import('../../state/index.js') grep gate without a second import site"
  - "POST_LOCK_DEADLINE_MS via direct lazy import of state/lock.js in the handlers (interfaces offered facade re-export OR direct import) — keeps the 09-05 facade file untouched, honoring files_modified discipline"
  - "Test seam: vi.mock state facade with importOriginal spread (REAL isValidSessionId + REAL applyRenamesToText/Deep under test), detect seam via vi.spyOn (handlers-detection idiom) — the sid gate and rename application exercised are the shipped implementations"
  - "state/lock.js left unmocked in tests — asserting deadlineMs === the real POST_LOCK_DEADLINE_MS (100) proves the actual constant flows through the wiring"
  - "hydration-only activation: reversible marked active only after readSessionMapForHydration returns non-null AND hydrateSessionManager succeeds — a failed hydrate can never reach the persist path"

patterns-established:
  - "Gate order pinned: config.reversible.enabled OUTERMOST (disabled sessions allocate zero promises), then facade.isValidSessionId (facade re-checks internally — defense in depth)"
  - "ONE locked transaction per hook event: drain batches allocations across ALL string leaves (substituteToolInputDeep recurses per leaf) before a single persistAllocations call"
  - "Renames applied BEFORE building the response object — the wire never carries a provisional token that lost its store race; degraded/noop emit as-is"
  - "Cold-path fence is now regression-locked: hasRuntimeStaticImport/hasTypeOnlyImport helpers (ner-unreachable verbatim) + exact await-import site counts + full-src cipher/lock token confinement walk with positive control"

requirements-completed: [REVMODE-02, REVMODE-04, REVMODE-05]

# Metrics
duration: 18min
completed: 2026-07-17
---

# Phase 9 Plan 07: Reversible handler wiring (PreToolUse + PostToolUse) Summary

**Both substitution sites now round-trip the encrypted session store — hydrate before detection, ONE locked persist per event batched across all string leaves, reconcile renames applied to the emitted payload, with the lazy-import cold-path fence regression-locked**

## Performance

- **Duration:** 18 min
- **Started:** 2026-07-17T03:23:37Z
- **Completed:** 2026-07-17T03:41:40Z
- **Tasks:** 2 (both task-level TDD: RED commit before GREEN commit)
- **Files modified:** 5 (2 created, 2 source modified, 1 dist rebuild)

## Accomplishments

- **PreToolUse (Step 2b + Step 6b):** after config load + session-state bootstrap and before detection, the handler gates on `config.reversible.enabled` → lazy-imports the state facade (single `await import('../../state/index.js')` site) → validates the sid against the UUID allowlist → hydrates the cached PlaceholderManager from the store. After `substituteToolInputDeep` collects findings across every string leaf, Step 6b drains the batched allocations and runs EXACTLY ONE `persistAllocations` transaction, then applies reconcile renames via `applyRenamesDeep` to the complete `updatedInput` tree before the response object is built. REVMODE-02's "placeholders allocated in one hook event resolve in a later hook process" is now end-to-end real.
- **PostToolUse (Step 2b + Step 7b):** mirrored branch on the single-string path — hydrate between bootstrap and string coercion, drain→persist→`applyRenamesToText` inside the findings>0 branch. The emitted shape is byte-unchanged: string-form `updatedToolOutput` with the exact one-way key set (`hookEventName`, `updatedToolOutput`, `additionalContext`) — E1 verdict stands, locked by a `typeof`+`Object.keys` assertion.
- **Drain-and-DISCARD (T-09-07-04):** budget-deny (PreToolUse Step 4), budget pass-through (PostToolUse Step 5), and dry_run (both) drain the manager's pending set and persist NOTHING — the store only ever learns allocations that actually shipped on the wire.
- **22 new tests (16 reversible-handlers + 6 cold-path):** batching proof (2 leaves → 2 runDetection calls → 1 drain → 1 persist with both allocations + the real 100 ms deadline), rename application with zero provisional tokens anywhere in the response JSON, degraded parity, invalid-sid gate (real `isValidSessionId` rejecting `'test-session'`), disabled byte-identity (`JSON.stringify` equality), Step 0 self-exemption ordering (before config load), and Pitfall 6 walls on both handlers (facade reject → exact one-way emission, resolved not thrown).
- **Cold-path import-graph fence (`tests/state/cold-path.test.ts`, 217 lines):** bans runtime static imports of `/state/`, `proper-lockfile`, and `write-file-atomic` from the 9-module hook-reachable set (base set + `session-end.ts` + `placeholder/manager.ts`); permits type-only `/state/` imports ONLY in `detect/index.ts` + `placeholder/manager.ts`; pins exactly-one `await import()` fence sites per handler; confines `createCipheriv`/`createDecipheriv`/`proper-lockfile` to `src/state/` via a full-`src/` comment-stripped walk with a non-vacuity positive control. Fence-trip verified live: a planted static import failed the suite; plant reverted before commit.

## Task Commits

| Task | Phase | Commit | Message |
| ---- | ----- | ------ | ------- |
| 1 | RED | a5a68c4 | test(09-07): add failing reversible-branch suite for PreToolUse |
| 1 | GREEN | da34225 | feat(09-07): wire reversible session round-trip into PreToolUse |
| 2 | RED | c8dba7d | test(09-07): add failing PostToolUse reversible suite + cold-path import-graph fence |
| 2 | GREEN | 1b10c1e | feat(09-07): wire reversible session round-trip into PostToolUse |
| 2 | chore | 4ba417a | chore(09-07): rebuild dist after reversible handler wiring |

No REFACTOR commits — both GREEN implementations landed clean against the pinned flow; nothing to restructure.

## Verification Evidence

- `npx vitest run tests/hook/reversible-handlers.test.ts tests/state/cold-path.test.ts tests/hook --project=unit` — 64/64 green
- Full `npm test` — **843 passed / 14 skipped** (baseline entering the plan: 821 / 14 — the +22 delta is exactly the new tests; zero regressions)
- `git diff --stat tests/placeholder tests/detect tests/audit` — **empty** (byte-identical discipline: the only hook-test additions this phase are the new reversible-handlers/session-end/cold-path files)
- `npm run typecheck` — **38 errors = the 38-error baseline** (deferred-items.md, 09-01 note); zero errors in any file this plan touched
- Grep gates: exactly 1 `persistAllocations` call site + exactly 1 `await import('../../state/index.js')` per handler; zero static `from '../../state/` imports; `applyRenamesToText` present in post-tool-use.ts
- Fence trip test: planted `import { isValidSessionId } from '../../state/index.js'` in pre-tool-use.ts → cold-path invariant 1 FAILED → reverted (not committed), suite green again

## Deviations from Plan

### Auto-fixed / Judgment Calls

**1. [Test-seam choice within plan latitude] state/lock.js left unmocked in the behavior suite**
- **Found during:** Task 1 RED design
- **Issue:** Plan's action text suggested `vi.mock` of both `state/index.js` and `state/lock.js`; the lock module only contributes the `POST_LOCK_DEADLINE_MS` constant
- **Resolution:** Kept the real constant so the batching test asserts `deadlineMs: POST_LOCK_DEADLINE_MS` (100) flows through the wiring — a stronger claim than round-tripping a mocked value
- **Files:** tests/hook/reversible-handlers.test.ts

**2. [Rule 2 - threat-model coverage] Added facade-rejection chaos tests to both handlers (beyond the pinned behavior lists)**
- **Found during:** Task 1/2 test design
- **Issue:** T-09-07-02's mitigation plan requires "chaos parity tests assert one-way-identical output on store failure"; the pinned eight PreToolUse behaviors covered degraded status but not a THROWING facade
- **Fix:** `readSessionMapForHydration` reject (PreToolUse) and `persistAllocations` reject (PostToolUse) both assert exact one-way emission and promise resolution (never a throw → never exit-2)
- **Commits:** a5a68c4, c8dba7d

Otherwise executed exactly as written — the pinned handler flow (gate order, drain-discard sites, rename-before-response) matched the implementation 1:1.

## Known Stubs

None. Both branches are fully wired to the real 09-05 facade; no placeholder values, no TODO/FIXME markers, no dead config keys introduced.

## Self-Check: PASSED

- All 5 key files exist on disk (2 created tests, 2 modified handlers, SUMMARY)
- All 5 commits present in git log (a5a68c4, da34225, c8dba7d, 1b10c1e, 4ba417a)
- cold-path.test.ts is 230 lines (min_lines 60 satisfied)
