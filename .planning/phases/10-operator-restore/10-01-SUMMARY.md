---
phase: 10-operator-restore
plan: 01
subsystem: restore
tags: [restore-engine, single-pass, sc1-taxonomy, v2-tokens, pass-through, tdd]

# Dependency graph
requires:
  - phase: 09-session-state-adapter
    provides: formatV2Token + V2_TOKEN_RE token grammar (session-map.ts), applyRenamesToText single-pass no-cascade precedent (CR-01 lesson)
provides:
  - restoreText() pure single-pass restore engine in src/restore/index.ts — exact full-token lookup, OVF/secret/unknown pass-through, per-occurrence counters
  - RestoreResult interface { text, restored, unmatched, skippedSecret, restoredOriginals } — the contract 10-05 (CLI) and 10-07 (canary) import
  - V2_TOKEN_SCAN_RE — unanchored global twin of V2_TOKEN_RE exported from src/state/session-map.ts (single source of token grammar, sync-locked by test)
  - SC1 pass-through taxonomy as executable spec (15-test table-driven suite)
affects: [10-02, 10-05, 10-07, phase-11-verification]

# Tech tracking
tech-stack:
  added: []  # zero new deps — pure TS module importing only the state grammar export
  patterns:
    - "Single-pass String.replace(globalRe, cb) — replacement output never re-scanned (no cascade, CR-01)"
    - "Callback gate order: OVF-label short-circuit BEFORE secretPlaceholders BEFORE index lookup (belt-and-braces vs poisoned index)"
    - "Grammar sync-lock test: V2_TOKEN_RE.source === '^' + V2_TOKEN_SCAN_RE.source + '$' && flags === 'g' — allocator/restorer drift fails loudly"
    - "All v2 test fixtures built via formatV2Token; the only hand-typed token literal is the v1 fixture the formatter cannot produce"

key-files:
  created:
    - src/restore/index.ts
    - tests/restore/engine.test.ts
  modified:
    - src/state/session-map.ts  # additive only: +13/-0, V2_TOKEN_SCAN_RE beside V2_TOKEN_RE

key-decisions:
  - "OVF label compared via capture group 2 (label === 'OVF') inside the callback — no string .includes() on the token, and the constant OVF_LABEL is named from birth"
  - "secretPlaceholders is an optional parameter (ReadonlySet) — engine stays pure and callable without the secret set; membership check precedes index lookup so even a poisoned index entry for a secret placeholder could never restore"
  - "Skipped REFACTOR commit — engine born clean (callback ~24 lines, zero magic literals, no duplicated counter logic); sanctioned by plan Task 3"
  - "REQUIREMENTS.md untouched: REVMODE-01 spans 10-01/10-02/10-05/10-07 — marking after the engine alone would be premature; orchestrator owns cross-plan requirement completion after the wave"

patterns-established:
  - "src/restore/ trust-direction module header: INTRODUCES sensitive data, operator-only, import allowlist (node: builtins, ./ siblings, ../state/, ../detect/findings.js, ../audit/restore-log.js) — the 10-07 fence locks it"
  - "SC1 taxonomy rows as it.each table — the pass-through contract is spec-first, implementation-second"

requirements-completed: []  # REVMODE-01 advanced (engine core), completed by 10-05/10-07

# Metrics
duration: 8min
completed: 2026-07-17
---

# Phase 10 Plan 01: Single-Pass Restore Engine Summary

**Pure single-pass `restoreText()` engine restoring v2 tokens ONLY on exact full-token index hits (nonce8 included) — wrong-nonce/unissued/fabricated/v1/OVF tokens all pass through byte-identical, secrets are skipped-not-restored, restored output is never re-scanned, and the scan grammar is sync-locked to the allocator's `V2_TOKEN_RE` — all pinned RED-first by a 15-test SC1 taxonomy suite.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-17T22:52:22Z
- **Completed:** 2026-07-17T23:00:30Z
- **Tasks:** 3 (RED + GREEN; REFACTOR skipped — nothing to clean)
- **Files:** 3 (2 created, 1 modified additively)

## TDD Narrative

**RED (e88edb8):** Wrote `tests/restore/engine.test.ts` — 15 tests pinning the full SC1 contract before any implementation existed. Confirmed failure on `Cannot find module '../../src/restore/index.js'` (and the then-missing `V2_TOKEN_SCAN_RE` export). Coverage: exact hit, duplicate-token per-occurrence counting, wrong-nonce8, unissued-NNN, fabricated-TYPE (taxonomy `it.each`), v1-token invisibility (ALL counters zero), OVF pass-through, poisoned-OVF-index no-restore, secret-class skip, no-cascade single-hop, mixed-document counter summation, empty input, token-free input, input immutability, grammar sync-lock. Every v2 fixture built via `formatV2Token` (counter 1000 → the OVF fixture); the single hand-typed `<MRCLEAN:` literal is the v1 token, which the formatter cannot produce.

**GREEN (f41a710):** Added `V2_TOKEN_SCAN_RE` directly beside `V2_TOKEN_RE` in `src/state/session-map.ts` (the ONLY sanctioned edit this phase: +13/-0, frozen partition byte-identical) with a JSDoc documenting the `/g` lastIndex statefulness caveat. Created `src/restore/index.ts`: one `input.replace(V2_TOKEN_SCAN_RE, cb)` pass with callback gate order (1) OVF-label short-circuit before any lookup, (2) `secretPlaceholders` membership → `skippedSecret`, (3) exact `index.get(token)` → restore or `unmatched`. Suite green 15/15; `tests/state/secret-floor.test.ts` untouched-green 76/76 (91 total).

**REFACTOR:** Skipped per plan Task 3 sanction — `OVF_LABEL` was a named constant from birth, callback body ~24 lines, no duplicated logic.

## Task Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | RED: failing SC1 taxonomy suite | e88edb8 | tests/restore/engine.test.ts (328 lines, 15 tests) |
| 2 | GREEN: V2_TOKEN_SCAN_RE export + restoreText | f41a710 | src/restore/index.ts (100 lines), src/state/session-map.ts (+13/-0) |
| 3 | REFACTOR | skipped | — (nothing to clean; suite re-verified green) |

## TDD Gate Compliance

- `test(10-01)` commit e88edb8 present (RED gate) — verified failing before implementation
- `feat(10-01)` commit f41a710 present after it (GREEN gate) — RED → GREEN order intact
- REFACTOR commit intentionally absent (plan Task 3: "Skip the commit entirely if nothing to clean")

## Verification Results

- `npx vitest run tests/restore/engine.test.ts --project=unit` — 15/15 green
- `tests/state/secret-floor.test.ts` — 76/76 green, unmodified (session-map.ts edit provably additive)
- Purity grep (`node:fs|node:crypto|createDecipheriv` in non-comment lines of src/restore/index.ts) — 0
- `git diff --numstat -- src/state/session-map.ts` — 13 added / 0 removed (< 15 additive gate)
- `npm run typecheck` — 0 errors referencing src/restore/ or tests/restore/; 38-error baseline unchanged
- `git diff --stat e950d76..HEAD -- src/hook src/detect src/placeholder` — empty (frozen trees untouched)
- No dist/ artifacts in any commit (worktree policy)

## Threat Register Outcomes

| Threat ID | Disposition | Evidence |
|-----------|-------------|----------|
| T-10-01-01 (planted/enumerated tokens) | mitigated | exact full-token Map.get; wrong-nonce/unissued-NNN/fabricated-TYPE taxonomy rows green |
| T-10-01-02 (cascade corruption) | mitigated | single replace pass; no-cascade test with placeholder-shaped original green |
| T-10-01-03 (OVF wrong-value restore) | mitigated | OVF label short-circuit before lookup; poisoned-OVF-index test green |
| T-10-01-04 (secret-class disclosure) | mitigated | secretPlaceholders pass-through counted skippedSecret, never in restoredOriginals |
| T-10-01-05 (ReDoS) | accepted per plan | linear grammar with bounded classes; sync-lock test prevents drift |

## Deviations from Plan

None — plan executed exactly as written. (Environment note, not a deviation: the repo's `block-no-verify` pre-commit guard false-positives on `[ -n ... ]` shell tests co-located with `git commit` in one compound command; worktree guards and commits were run as separate Bash invocations, with guards always preceding each commit.)

## Known Stubs

None — the engine is fully implemented with no placeholder values, TODO markers, or unwired data paths.

## Threat Flags

None — no new network endpoints, auth paths, file access, or trust-boundary schema changes beyond the plan's threat model (the module is pure by construction).

## Self-Check: PASSED

All claimed files exist (src/restore/index.ts, tests/restore/engine.test.ts, src/state/session-map.ts, this SUMMARY) and all claimed commits are in history (e88edb8, f41a710).

## For the Orchestrator

- STATE.md / ROADMAP.md / REQUIREMENTS.md intentionally untouched (worktree mode; REVMODE-01 completion belongs to the wave owner — see key-decisions).
- Wave 2 consumers: 10-05 imports `restoreText`/`RestoreResult` from `src/restore/index.js`; 10-02 builds the index this engine consumes; 10-07's fence test should lock the import allowlist declared in the module header.
