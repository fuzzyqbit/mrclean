---
phase: 09-session-state-adapter
plan: 02
subsystem: state
tags: [session-map, secret-floor, hmac-sha256, v2-tokens, reversible-mode, tdd]

# Dependency graph
requires:
  - phase: 02-detection-layers
    provides: frozen 25-entry TYPE_VOCABULARY in src/detect/type-map.ts (partition source)
  - phase: 08-contract-verification-reversible-plumbing
    provides: reversible config plumbing, 36-error differential typecheck discipline, hand-guard idiom
provides:
  - SessionMapV1 schema (version/sessionId/nonce8/hashSalt/counter/entries) — the plaintext shape inside the 09-03 encrypted envelope
  - Structural secret floor (D-11/REVMODE-06) — frozen 7-type RESTORABLE_TYPES partition; secret-class entries lack `original` at type level, serializer strips at write time, parser drops at read time
  - hmacAddress (HMAC-SHA256, per-session salt) content addressing for 09-04/09-05 allocation
  - formatV2Token + V2_TOKEN_RE (NNN/OVF + nonce8 session tag, D-10)
  - SESSION_ID_RE + isValidSessionId strict UUID allowlist (Pitfall 5) for every downstream path consumer
  - ReversibleHydration / PendingAllocation / PlaceholderRename contracts (type-only imports for 09-04, produced by 09-05)
affects: [09-03, 09-04, 09-05, phase-10-restore]

# Tech tracking
tech-stack:
  added: []  # node:crypto builtins only (createHmac, randomBytes) — zero new deps by design
  patterns:
    - "Structural secret floor: type-level absence + write-time strip + read-time drop (three layers, no config reachable)"
    - "Partition constants derived from frozen TYPE_VOCABULARY import (unknown TYPE => secret-class, fail-toward-privacy)"
    - "Hand guards (isRecord idiom) over schema libs in cold-path modules"

key-files:
  created:
    - src/state/session-map.ts
    - tests/state/secret-floor.test.ts
  modified: []

key-decisions:
  - "Derived NEVER_RESTORABLE_TYPES via static import of TYPE_VOCABULARY (state -> detect direction is fence-legal; no cycle) instead of mirroring a second frozen list"
  - "parseSessionMap drops a poisoned `original` on secret-class entries at read time (availability preserved, secret never re-enters memory) — third floor layer ahead of Phase 10's restore-side gate"
  - "parseSessionMap rejects negative counters (isNonNegativeInteger) — NNN counters grow only"
  - "Skipped REFACTOR commit — module born clean (max function 28 lines, guards pre-extracted, literals named)"

patterns-established:
  - "Secret floor proof shape: `'original' in entry === false` (property ABSENT, never null/empty) — SC3 assertion style for all later decrypt-and-dump tests"
  - "Vocabulary-sync test: any future TYPE_VOCABULARY addition fails tests/state/secret-floor.test.ts until explicitly classified into the partition"

requirements-completed: [REVMODE-06]

# Metrics
duration: 12min
completed: 2026-07-17
---

# Phase 9 Plan 02: Session Map Schema with Structural Secret Floor Summary

**Pure schema+contracts module for the encrypted session map: frozen 7/18+unknown restorable partition where secret-class entries structurally cannot carry `original` (type level + serialize strip + parse drop), HMAC-SHA256 content addressing, v2 nonce-tagged tokens, and strict UUID sid allowlist — all pinned RED-first by a 76-test suite.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-17T02:31:24Z
- **Completed:** 2026-07-17T02:43:05Z
- **Tasks:** 3 (RED, GREEN, REFACTOR-evaluated-and-skipped)
- **Files modified:** 2 created

## Accomplishments

- **REVMODE-06 secret floor is now frozen code:** `RESTORABLE_TYPES` is a frozen 7-entry list (WORD, PII_EMAIL, PII_PHONE, PII_IP, PII_PERSON, PII_ORG, PII_LOC); all 18 named secret-class TYPEs AND any unknown future TYPE produce entries with NO `original` property — verified property-absent (`'original' in entry === false`) per SC3, never null/empty. No function in the module accepts config input, so nothing can widen the partition.
- **Defense in depth at three layers:** `SecretMapEntry` lacks `original` at the type level; `serializeSessionMap` rebuilds every entry field-by-field so a hand-poisoned `original` (injected past TS via cast) never reaches the persisted JSON — proven by a fully-poisoned 18-type dump containing zero `"original"` keys; `parseSessionMap` drops poisoned originals coming back from disk.
- **All downstream contracts shipped for wave 2:** `SessionMapV1`, `hmacAddress` (per-session-salt HMAC-SHA256, collision residual documented as accepted T-09-02-05), `formatV2Token`/`V2_TOKEN_RE` (NNN zero-pad ≤ 999, OVF above, nonce8 tag), `SESSION_ID_RE`/`isValidSessionId` (rejects `mcp-server`, `test-session`, traversal strings, trailing junk), and the `ReversibleHydration`/`PendingAllocation`/`PlaceholderRename` interfaces 09-03/09-04/09-05 import.
- **TDD RED → GREEN executed cleanly:** 76 failing-first tests (module-not-found RED confirmed), implementation passed all 76 unmodified.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing secret-floor schema suite** - `08e62f0` (test) — 544-line suite: 18+1 secret-class absence cases, 7 restorable presence cases, serializer poison strip, round-trip, 22 parse-guard rejections, CSPRNG properties, HMAC determinism/divergence, NNN/OVF/regex, sid accept/reject matrix, vocabulary-sync partition proof
2. **Task 2 (GREEN): implement src/state/session-map.ts** - `f77b15b` (feat) — 359-line pure module, suite green with zero test edits
3. **Task 3 (REFACTOR): evaluated, skipped** — no commit (plan-sanctioned skip: max function 28 lines, guards already extracted, all literals named constants)

**Plan metadata:** docs(09-02) commit containing this SUMMARY.

## Files Created/Modified

- `src/state/session-map.ts` - SessionMapV1 schema, frozen partition constants (RESTORABLE_TYPES + derived NEVER_RESTORABLE_TYPES), makeMapEntry secret floor, serialize/parse with hand guards, hmacAddress, formatV2Token/V2_TOKEN_RE, SESSION_ID_RE/isValidSessionId, hydration/pending contracts. Pure: node:crypto only — no fs, no config, no schema-validation deps, no cipher APIs (envelope crypto is 09-03's).
- `tests/state/secret-floor.test.ts` - SC3 decrypt-and-dump-shaped proof at the schema layer; 76 tests, all property-absent assertions via the `in` operator.

## Decisions Made

- **Import-derive over mirror:** partition complement derived from `TYPE_VOCABULARY` static import (state → detect is fence-legal — the import fence bans hook-reachable modules importing state, not the reverse; type-map.ts imports nothing from state, so no cycle). Vocabulary-sync test still asserts the 7+18=25 cover exactly, so a future vocabulary addition fails loudly until classified.
- **Read-side drop of poisoned secret originals:** `parseSessionMap` preserves availability (map parses; counter/entries survive) while dropping any `original` found on a secret-class entry in stored JSON. Chosen over reject-whole-map (worse availability for zero privacy gain) and over tolerate (would let poisoned disk state re-enter memory). Test-pinned. This is schema-layer hardening consistent with T-09-02-01's mitigate disposition — Phase 10's restore-side gate is unaffected and still required.
- **Negative counters rejected at parse** (`isNonNegativeInteger`) — the NNN counter is documented grow-only; a negative counter is corrupt state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security/defense-in-depth] Read-side strip of poisoned secret-class originals in parseSessionMap**
- **Found during:** Task 1 (RED) suite design
- **Issue:** Plan specified write-time strip only; a poisoned on-disk map (old bug/attacker-shaped state) would carry a secret `original` back into process memory through parse even though serialize would strip it again later.
- **Fix:** `parseMapEntry` only attaches `original` for restorable TYPEs; secret-class originals in raw JSON are dropped (entry and map otherwise parse normally).
- **Files modified:** src/state/session-map.ts, tests/state/secret-floor.test.ts (behavior test-pinned from RED)
- **Verification:** dedicated test "strips original from a secret-class entry found in stored JSON"
- **Committed in:** `08e62f0` (test) / `f77b15b` (impl)

**2. [Rule 3 - Blocking acceptance gate] Reworded module header comment to keep the `grep zod` gate clean**
- **Found during:** Task 2 acceptance checks
- **Issue:** Header JSDoc said "no zod" — the literal string tripped Task 2's `grep`-based acceptance criterion ("`zod` does not appear in session-map.ts").
- **Fix:** Comment now reads "no schema-validation deps"; grep count is 0.
- **Files modified:** src/state/session-map.ts
- **Committed in:** `f77b15b`

No other deviations — all interfaces, behaviors, and acceptance criteria implemented exactly as planned.

## Verification Results

- `npx vitest run tests/state/secret-floor.test.ts --project=unit` — **76/76 passed**
- Full `npm test` — **718 passed | 14 skipped** (642 pre-existing + 76 new; zero regressions)
- `git diff --stat tests/placeholder tests/detect tests/audit` — **empty** (byte-identical suite discipline held)
- Differential typecheck — **38 → 38 errors, zero new** (`comm -13 baseline after` empty; baseline at worktree base b5a16b0 is 38, a pre-existing superset of the documented 36)
- Grep gates — `authTag|createCipheriv|createDecipheriv`: 0; `zod`: 0; `node:fs`: 0
- TDD gates — `test(09-02)` commit `08e62f0` precedes `feat(09-02)` commit `f77b15b`

## TDD Gate Compliance

- RED gate: `08e62f0` `test(09-02): add failing secret-floor schema suite` — confirmed failing (module-not-found) before implementation existed
- GREEN gate: `f77b15b` `feat(09-02): implement session map schema with structural secret floor` — all RED tests pass unmodified
- REFACTOR gate: intentionally skipped per plan Task 3 ("Skip the commit entirely if nothing to clean") — module required no cleanup

## Worktree Notes (for orchestrator)

- `dist/cli.js` / `dist/mcp.js` were rebuilt by the full-suite run (integration globalSetup) and **restored to base state, not committed** — worktree dist rebuilds embed worktree-relative paths.
- STATE.md / ROADMAP.md / REQUIREMENTS.md untouched per wave protocol — orchestrator owns those writes. REVMODE-06 completion is recorded in this SUMMARY's frontmatter for the orchestrator to mark.

## Self-Check: PASSED

- FOUND: src/state/session-map.ts
- FOUND: tests/state/secret-floor.test.ts
- FOUND: .planning/phases/09-session-state-adapter/09-02-SUMMARY.md
- FOUND: commit 08e62f0 (test gate)
- FOUND: commit f77b15b (feat gate)
