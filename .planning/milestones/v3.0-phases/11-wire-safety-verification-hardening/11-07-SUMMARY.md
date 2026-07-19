---
phase: 11-wire-safety-verification-hardening
plan: "07"
subsystem: docs
tags: [threat-model, copy-drift, banned-phrases, encrypted-at-rest, honest-framing, reversible-mode, paired-commit]

# Dependency graph
requires:
  - phase: 11-wire-safety-verification-hardening
    provides: "11-01 dist-parity gate, 11-02 fs-interception gate, 11-03 IN-02 collision demote (sticky Set), 11-04 zero-counts honesty, 11-05 wire-safety live leg, 11-06 count-guarded CI + perf row — the shipped facts the finalized section cites"
  - phase: 10-operator-restore
    provides: "10-SECURITY.md AR-10-02/AR-10-05 accepted-risk wording the residuals subsection mirrors; restore CLI + doctor reversible-state check cited as shipped"
  - phase: 09-reversible-state-store
    provides: "encrypted per-session store, chaos/stress harnesses, cold-path fence cited as shipped"
provides:
  - "THREAT_MODEL.md `## Reversible Mode (v3.0)` finalized to shipped-fact framing: zero 'design commitment' occurrences, all eight Phase 11 gates cited by test file, five H3 headings byte-identical"
  - "copy-drift required anchors swapped in the SAME commit as the doc (52d7cd1): 'verified against the shipped implementation' + 'not a defense against a same-user local attacker' required, 'transcript ratchet' kept — no red window between commits"
  - "Three ADDITIVE encrypted-at-rest overclaim bans in BANNED_COPY_PHRASES, each with scan row + positive control + honest-copy self-check (9 new rows, 25 total in the suite)"
  - "src/doctor/checks.ts is now a SCANNED_SOURCES copy surface (its 'encrypted session state adapter active' detail is under the gate; the file itself untouched)"
affects: [milestone audit, verify-work, README/docs future copy edits (now gated for encryption overclaims)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-regex scan helper (scanSourcesForSinglePhrase) beside the all-phrases gate — per-ban scan rows stay individually attributable without weakening the main scan"
    - "findBannedPhrase(sourceFragment) throws on miss — the new rows are non-vacuous even if a future refactor renames or drops an entry"

key-files:
  created: []
  modified:
    - THREAT_MODEL.md
    - tests/copy-drift.test.ts
    - src/shared/strings.ts

key-decisions:
  - "Gate citations placed inline where each claim lives (parity/cold-path in the intro, chaos/stress under blast radius, floor gates under secret floor, live leg under wire re-entry) rather than a detached gate table — the doc reads as an audit, claim-by-claim"
  - "THREAT_MODEL §4 does NOT mention the new copy-drift bans — Task 1's commit precedes Task 2, and citing a not-yet-shipped gate would be the exact overclaim class this phase bans; the gate self-documents"
  - "Stamp fragment kept contiguous on one line ('verified against the shipped implementation') — toContain/grep are line-oblivious/line-based respectively; a wrap-split of the fragment red-flagged in pre-commit verification and was rewrapped before committing"
  - "Honest-copy self-checks assert against BOTH the §4 qualification sentence shape and the doctor's LOCKED detail verbatim — the two real copy surfaces nearest the encrypted-at-rest claim"

patterns-established:
  - "Paired doc+gate evolution proven by a single commit's stat (52d7cd1 lists both files) — checkout-and-run at that commit shows the suite green, no intermediate red window"

requirements-completed: [REVMODE-11]

# Metrics
duration: 17min
completed: 2026-07-18
---

# Phase 11 Plan 07: THREAT_MODEL Shipped-Fact Finalization + Encrypted-at-Rest Honesty Lock Summary

**SC5 complete — the reversible section is now an audit of shipped code (store, restore CLI, doctor check, and all eight Phase 11 gates cited by test file) with the copy-drift anchors swapped in the same commit so CI never passed with drifted claims, and encrypted-at-rest overclaim shapes are banned with positive controls across every scanned copy surface including doctor output**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-07-18T03:46:33Z
- **Completed:** 2026-07-18T04:03:30Z
- **Tasks:** 2
- **Files changed:** 3 (THREAT_MODEL.md, tests/copy-drift.test.ts, src/shared/strings.ts)

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | 52d7cd1 | docs(11-07): finalize THREAT_MODEL reversible section to shipped facts + paired copy-drift anchors (SC5) — **the paired commit: both files in one stat** |
| 2 | 6fedc05 | test(11-07): ban encrypted-at-rest overclaim shapes + scan doctor copy (SC5 complete) |

## Anchor List As Shipped

Required (copy-drift `toContain`, THREAT_MODEL.md):

| Anchor | Where it lives |
|--------|----------------|
| `verified against the shipped implementation` | dated stamp paragraph in the section intro ("This section was finalized on 2026-07-17, with every claim below verified against the shipped implementation…") |
| `not a defense against a same-user local attacker` | §4 Key-custody honesty **Consequence** line, adjacent to the "encrypted at rest" claim |
| `transcript ratchet` | kept in §3 (unchanged claim) |
| Five H3 heading fragments (blast radius / secret floor / wire re-entry / key-custody / residual risks) | headings byte-identical to pre-rewrite (no `### ` lines in the diff) |

Banned (additive `BANNED_COPY_PHRASES` entries, each with positive control + honest-copy self-check):

| Shape | Regex |
|-------|-------|
| Absolute-safety claim | `/\bencrypt\w*[^.]*\bcannot be (?:read\|recovered\|decrypted)\b/i` |
| Exclusive-access claim | `/\bonly (?:you\|the operator) can (?:read\|decrypt)\b/i` |
| Unconditional-safety claim | `/\bsafe even (?:if\|when\|from)\b/i` |

Gate citations added to THREAT_MODEL (all verified in-tree before citing): tests/hook/dist-parity.test.ts + tests/state/cold-path.test.ts (intro, one-way untouched), tests/state/chaos.test.ts + tests/state/stress.test.ts (§1, redaction never depends on the map), tests/audit/restore-canary-leak.test.ts + tests/restore/mixed-canary.test.ts + tests/state/fs-interception.test.ts (§2, floor locks), tests/uat/wire-safety.test.ts (§3, operator-run opt-in live leg).

Residuals subsection now states: AR-10-05 shrunk to a documented note (IN-02 demote-to-unmatched shipped in 11-03 — ambiguous tokens restore nothing), AR-10-02/IN-03 stays accepted (salting breaks operator cross-record correlation), #68951/#77587 filed-and-open as of 2026-07-17 with the object-shape emission fix explicitly fenced out of v3.0 (identical in one-way mode — not a reversible delta).

## Phase Regression Gate Outputs (this plan closes the phase)

| Check | Result |
|-------|--------|
| `npm test` | **green** — Test Files 105 passed \| 2 skipped (107); Tests 985 passed \| 29 skipped (1014) |
| `npm run typecheck` | **38 errors exactly** (the differential baseline); zero errors in any Phase 11 file |
| Frozen trees `git diff --stat 8f370b9 -- src/hook src/detect src/placeholder tests/placeholder tests/detect` | **EMPTY** |
| `git diff --stat 8f370b9 -- tests/hook` | ONLY `tests/hook/dist-parity.test.ts \| 209 +` (the 11-01 addition) |
| `dist/` in phase commits | none — both 11-07 commits touch only the three plan files; test-run dist rebuilds reverted via single-file checkout before staging (worktree repo policy) |
| copy-drift suite | 25/25 green (16 after anchor swap + 9 new encrypted-at-rest rows) |
| `grep -c "design commitment" THREAT_MODEL.md` | **0** |
| Task 1 paired-commit proof | `git show --stat 52d7cd1` lists BOTH THREAT_MODEL.md and tests/copy-drift.test.ts; H3 heading lines absent from the diff (content-only changes under them) |

Verify-work reminder (11-VALIDATION manual table): operator runs `MRCLEAN_UAT=1 npm run test:uat` for the SC1b live leg + survey re-stamps.

## Deviations from Plan

None — plan executed as written. Execution notes:

- **dist/cli.js test-run rebuilds reverted (worktree policy, not a plan file):** the full unit run and `npm test` (integration globalSetup runs tsup) both dirtied `dist/cli.js`; reverted via `git checkout -- dist/` before each staging so no dist artifact entered any commit.
- **Stamp wrap fix pre-commit:** the first draft of the intro wrapped 'verified against the shipped implementation' across a line break, which the new `toContain` anchor (and line-based grep) cannot match; caught by running the suite before committing, rewrapped onto one line. Never committed red.

## Known Stubs

None — changes are documentation, test gates, and regex constants; no data paths or UI surfaces involved.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes. The plan's threat register mitigations shipped as specified: T-11-07-01 (required anchors + three bans with positive controls), T-11-07-02 (single paired commit 52d7cd1, headings verbatim), T-11-07-03 (honest-copy self-checks per regex; src/doctor/checks.ts scanned but untouched — narrowing rule documented in the test JSDoc).

## Self-Check: PASSED

All three modified files present; commits 52d7cd1 + 6fedc05 in history; copy-drift 25/25 green at HEAD; dist/ clean.
