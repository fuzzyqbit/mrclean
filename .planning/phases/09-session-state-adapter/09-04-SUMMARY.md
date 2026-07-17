---
phase: 09-session-state-adapter
plan: 04
subsystem: placeholder
tags: [v2-tokens, hydration-seam, hmac-content-addressing, reversible-mode, cold-path-fence, tdd]

# Dependency graph
requires:
  - phase: 09-session-state-adapter
    plan: 02
    provides: ReversibleHydration/PendingAllocation contracts, hmacAddress, formatV2Token, V2_TOKEN_RE (fixture closures + type-only imports)
  - phase: 02-detection-layers
    provides: PlaceholderManager v1 (allocate/getByPlaceholder/size), detect/index cached-manager seam (getOrCreateManager)
provides:
  - PlaceholderManager.hydrateReversible(h) — installs per-session nonce/counter-floor/HMAC lookup as injected data+closures; manager never imports state runtime
  - PlaceholderManager.drainPendingAllocations() — exactly-once handoff of NEW allocations for the 09-05 reconcile+persist step
  - v2 allocation branch — hydration-gated early return; `<MRCLEAN:TYPE:NNN:nonce8>` via formatToken closure; HMAC content addressing (same original, any TYPE → identical placeholder, D-10)
  - detect/index hydrateSessionManager + drainSessionAllocations pass-through exports (the seam 09-07 handler wiring consumes)
  - v1 one-way default proven byte-identical — tests/placeholder/manager.test.ts green with zero edits (Phase 8 SC2 discipline)
affects: [09-05, 09-07, phase-10-restore]

# Tech tracking
tech-stack:
  added: []  # zero new deps — v2 state is injected closures over 09-02 primitives
  patterns:
    - "Hydration-gated early return: opt-in branch above a frozen v1 block (zero diff hunks on shipped formatter lines)"
    - "Closure injection over runtime import: state facade hands hmacOf/formatToken as functions; type-only imports keep src/state out of the hook cold-path module graph"
    - "Drain-exactly-once buffer handoff (returns internal array, reassigns fresh [])"

key-files:
  created:
    - tests/state/tokens-v2.test.ts
  modified:
    - src/placeholder/manager.ts
    - src/detect/index.ts

key-decisions:
  - "getByPlaceholder gained a `?? this.v2ByHmac.get(hash)` fallback (outside the frozen zone): v2 entries key byPlaceholder→HMAC, and the HMAC is never in byHash, so v1 lookups short-circuit identically while v2 reverse lookups resolve"
  - "Hydration-seeded entries are also registered in byPlaceholder so store-fed placeholders reverse-resolve without ever being allocated locally"
  - "Seeded-entry index parsed from placeholder NNN via local regex helper (OVF→0) — V2_TOKEN_RE is a runtime value in session-map.ts and therefore unimportable under the type-only fence"
  - "Overflow warn block duplicated in allocateReversible by necessity: extracting a shared helper would edit the frozen v1 lines (Pitfall 7); same this.overflowed flag keeps warn-once across both paths"
  - "Skipped REFACTOR commit — v2 members born consolidated (both new methods < 50 lines, fields documented, no shared-builder extraction warranted for two semantically different entry constructions)"

patterns-established:
  - "v2 byte-identity proof shape: frozen-zone diff assertion (no +/- on v1 formatter literals) + zero-edit pass of the shipped v1 suite"
  - "Hydration fixture style: real session-map closures (hmacAddress over fixed 64-hex salt, formatV2Token over fixed nonce8) — the exact shapes the 09-05 facade injects"

requirements-completed: [REVMODE-05]

# Metrics
duration: 10min
completed: 2026-07-17
---

# Phase 9 Plan 04: v2 Token Layer with Hydration Seam Summary

**Hydration-gated v2 branch on PlaceholderManager: reversible sessions allocate `<MRCLEAN:TYPE:NNN:nonce8>` tokens content-addressed by HMAC with drainable pending allocations, while the default-constructed manager keeps the shipped v1 path byte-identical (zero diff hunks on the frozen formatter block, v1 suite green with zero edits) — seam exposed to handlers via two type-only-import pass-throughs on detect/index.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-17T02:48:19Z
- **Completed:** 2026-07-17T02:58:30Z
- **Tasks:** 3 (RED, GREEN, REFACTOR-evaluated-and-skipped)
- **Files modified:** 1 created, 2 modified

## Accomplishments

- **REVMODE-05 both halves proven:** a hydrated manager emits v2 session-tagged tokens (`<MRCLEAN:AWS_KEY:001:aabbccdd>` matching `V2_TOKEN_RE`); a default-constructed manager emits v1 `<MRCLEAN:WORD:001>` — and the shipped 110-line v1 suite (`tests/placeholder/manager.test.ts`) passes with **zero edits**.
- **Frozen-zone discipline held by construction:** the v2 path is an early return at the top of `allocate()` plus private members below the v1 body; `git diff` shows only 2 removed lines in the whole file (header doc + `getByPlaceholder` return), neither inside the lines 77-97 counter/format/overflow block, and no +/- on either v1 formatter literal.
- **Hydrated store entries win:** allocating a value whose HMAC is pre-seeded in `entriesByHmac` returns the store placeholder without advancing the counter or creating a pending entry — the cross-process convergence primitive 09-05's reconcile relies on.
- **Drain-exactly-once semantics:** `drainPendingAllocations()` returns the accumulated buffer and clears it (second drain → `[]`); safe no-throw `[]` on never-hydrated v1 managers.
- **Re-hydration refresh:** a fresh hydration (higher floor + seeded entries) replaces the v2 cache wholesale (new Map — input never mutated), lifts the counter monotonically (`Math.max`), clears stale pending, and resolves previously-provisional values to the seeded final placeholders.
- **Cold-path fence intact:** every `../state/` reference in both touched src files is `import type` (erased at compile) — src/state never enters the hook module graph when reversible is off (T-09-04-04; 09-07's import-graph test will pin this).

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing tokens-v2 suite** - `8fb67b8` (test) — 261-line, 13-case suite: v2 format + single pending, PH-02 via HMAC (one pending despite double allocate), cross-TYPE content addressing (D-10), store-hit no-burn (index parsed from NNN), counterFloor 5→006, counterFloor 999→OVF with warn-once (v1 JSON warn shape via stderr spy), drain-twice, re-hydration refresh, v1 default path + no-throw drain, v2 reverse lookup (allocated + seeded), detect/index seam pass-throughs. RED confirmed: 13/13 fail `not a function`.
2. **Task 2 (GREEN): implement v2 branch + detect pass-throughs** - `f654e3b` (feat) — `hydrateReversible`/`drainPendingAllocations`/private `allocateReversible` on the manager; `hydrateSessionManager`/`drainSessionAllocations` on detect/index delegating to `getOrCreateManager(sessionId)`; 27/27 green (13 new + 14 placeholder), zero test edits.
3. **Task 3 (REFACTOR): evaluated, skipped** — no commit (plan-sanctioned skip: both new methods < 50 lines, v2 fields cohesive and documented, entry construction differs semantically between seed and live paths so a shared builder would be speculative DRY).

**Plan metadata:** docs(09-04) commit containing this SUMMARY.

## Files Created/Modified

- `src/placeholder/manager.ts` - v2 layer: `reversible`/`v2ByHmac`/`pending` private state, `hydrateReversible` (monotonic counter, wholesale cache rebuild, seeded reverse-lookup registration, defensive pending clear), `drainPendingAllocations`, private `allocateReversible` (HMAC keying — v1 `byHash` neither consulted nor populated; `PlaceholderEntry.hash` carries HMAC hex on v2 entries), `getByPlaceholder` v2 fallback, module-level `parseV2TokenIndex`. v1 counter/format/overflow block untouched.
- `src/detect/index.ts` - two additive exports next to `getOrCreateManager` with JSDoc marking them the Phase 9 reversible seam consumed only under `config.reversible.enabled`; type-only state import block. No change to runDetection steps.
- `tests/state/tokens-v2.test.ts` - REVMODE-05 proof suite; hydration fixtures built from real session-map exports (`hmacAddress` over fixed salt, `formatV2Token` over 'aabbccdd').

## Decisions Made

- **`getByPlaceholder` v2 fallback:** plan behavior case 10 requires v2 reverse lookup, but v2 entries are keyed by HMAC which never lands in `byHash` — so the method's final lookup gained `?? this.v2ByHmac.get(hash)`. The edit sits outside the frozen zone; v1 behavior is bit-identical because the fallback only evaluates for keys absent from `byHash` (impossible for v1 allocations).
- **Seeded entries registered for reverse lookup at hydrate time:** store-fed placeholders resolve via `getByPlaceholder` without a local allocation (test-pinned) — keeps the reverse map complete for 09-05's rename/reconcile flows.
- **Local NNN parse helper over importing `V2_TOKEN_RE`:** the regex is a runtime export of session-map.ts; importing it would violate the type-only fence. A 5-line anchored regex (`/:(\d{3}):[a-f0-9]{8}>$/`, OVF→0) covers the hydration-seeding need.
- **Warn-once flag shared across paths:** `allocateReversible` reuses `this.overflowed`, so a session degrades with exactly one stderr warn regardless of which path (v1/v2) crosses 999 — same JSON message text as v1, no raw values (T-09-04-02).

## Deviations from Plan

None - plan executed exactly as written. (The `getByPlaceholder` fallback and seeded reverse-lookup registration are implementation mechanics required by the plan's own behavior cases, documented above as decisions.)

## Verification Results

- `npx vitest run tests/state/tokens-v2.test.ts tests/placeholder --project=unit` — **27/27 passed** (3 files)
- Full `npm test` — **739 passed | 14 skipped** (zero regressions vs wave-1 base)
- `git diff --stat tests/placeholder tests/detect tests/audit` (HEAD~2..HEAD) — **empty** (zero test edits; byte-identical suite discipline held)
- Frozen-zone proof — whole-file diff contains exactly 2 removed lines (header doc, `getByPlaceholder` return); **no +/- on** `placeholder = `<MRCLEAN:${type}:OVF>`` **or** `placeholder = `<MRCLEAN:${type}:${String(this.counter).padStart(3, '0')}>``
- Type-only fence — `grep "from '../state/"` in both src files: **only `import type` lines** (manager.ts:27, detect/index.ts:70)
- Differential typecheck — **38 → 38 errors, zero new** (`comm -13 baseline after` empty; worktree baseline is the documented 36 + 2 pre-existing transformers type-drift per deferred-items.md)
- TDD gates — `test(09-04)` commit `8fb67b8` precedes `feat(09-04)` commit `f654e3b`
- must_haves — manager.ts contains `hydrateReversible` (3 refs); detect/index.ts exports both seam functions (lines 189/199); tokens-v2 suite 261 lines (≥ 80); key_link patterns `import type .* from '../state/session-map.js'` and `hydrateSessionManager` both present

## TDD Gate Compliance

- RED gate: `8fb67b8` `test(09-04): add failing v2 token layer suite` — confirmed failing (13/13 `not a function`) before any implementation
- GREEN gate: `f654e3b` `feat(09-04): implement v2 token layer with hydration seam` — all RED tests pass unmodified
- REFACTOR gate: intentionally skipped per plan Task 3 ("Only if warranted... Commit only if changed") — v2 members born consolidated

## Threat Model Dispositions (from plan)

- T-09-04-01 (v2 token enumeration) — mitigated: nonce8 enters every token via the injected `formatToken` closure; suite asserts the tag on NNN and OVF shapes
- T-09-04-02 (pending buffer / warns disclosure) — mitigated: `PendingAllocation` values are memory-only; sole stderr emission is the existing hash-free overflow warn (counter + sessionId), test-pinned
- T-09-04-03 (v1 path regression) — mitigated: early-return branch + frozen-zone diff proof + zero-edit v1 suite pass
- T-09-04-04 (cold-path DoS) — mitigated: type-only imports erased at compile; no runtime `../state/` reference in either file
- T-09-04-05 (OVF collisions) — accepted per plan: shared OVF token semantics identical to v1 degradation; OVF never restored (Phase 10 rule)

No new threat surface beyond the plan's register — no network endpoints, no file access, no schema changes introduced by this plan.

## Known Stubs

None — the seam is fully wired at this layer; consumption under `config.reversible.enabled` is 09-05/09-07 scope by design (documented in plan objective).

## Worktree Notes (for orchestrator)

- `dist/cli.js` / `dist/mcp.js` were rebuilt by the full-suite run (integration globalSetup) and **restored to base state, not committed** — worktree dist rebuilds embed worktree-relative paths.
- STATE.md / ROADMAP.md / REQUIREMENTS.md untouched per wave protocol — orchestrator owns those writes. REVMODE-05 completion is recorded in this SUMMARY's frontmatter for the orchestrator to mark.
- Sibling fence respected: `src/state/map-store.ts` / `tests/state/map-store.test.ts` (09-03's files) untouched.

## Self-Check: PASSED

- FOUND: src/placeholder/manager.ts (hydrateReversible present)
- FOUND: src/detect/index.ts (both seam exports present)
- FOUND: tests/state/tokens-v2.test.ts (261 lines)
- FOUND: .planning/phases/09-session-state-adapter/09-04-SUMMARY.md
- FOUND: commit 8fb67b8 (test gate)
- FOUND: commit f654e3b (feat gate)
