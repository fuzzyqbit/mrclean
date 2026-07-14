---
phase: 08-contract-verification-reversible-plumbing
plan: 06
subsystem: docs
status: complete
tags: [threat-model, revmode-03, copy-drift, honest-framing, reversible-mode]
requires:
  - "08-04: corrected E1 verdict table (shape-validation discovery) + contract-findings.json"
provides:
  - "THREAT_MODEL.md '## Reversible Mode (v3.0)' section: five H3 subsections (map blast radius / structural secret floor / wire re-entry / key-custody honesty / accepted residual risks)"
  - "tests/copy-drift.test.ts presence gate: section heading + 5 subsection fragments + honest-framing phrases, drift-gated on every unit run"
  - "THREAT_MODEL.md added to SCANNED_SOURCES (banned-CLAIM scan now covers it)"
  - "PROJECT.md + CLAUDE.md 'What This Is' amended to operator-only-restore framing"
affects:
  - "Phase 11: finalizes the reversible section against the shipped implementation and extends the presence gate; key-custody subsection feeds the 'encrypted at rest' copy-drift lock"
  - "Phase 9/10: section preamble commits to design-commitment framing until store + CLI ship"
tech-stack:
  added: []
  patterns:
    - "presence-gate + banned-CLAIM scan over security prose (copy-drift precedent extended to THREAT_MODEL.md)"
    - "design-commitment framing discipline for unbuilt-code claims in security docs"
key-files:
  created: []
  modified:
    - THREAT_MODEL.md
    - tests/copy-drift.test.ts
    - .planning/PROJECT.md
    - CLAUDE.md
    - .planning/REQUIREMENTS.md
decisions:
  - "Wire re-entry subsection written to the CORRECTED 08-04 picture: updatedToolOutput is shape-validated per tool on CC 2.1.209 (string rejected for Bash with warning-only zod invalid_type; object shape honored) — redaction of built-in Bash IS achievable; the modeled failure mode is silent-ish shape rejection leaving original output on the wire, not a dead channel"
  - "T1 deferral rationale unchanged and strengthened: the channel works and is model-facing, so in-session restore through it ratchets originals into the re-shipping transcript permanently"
  - "THREAT_MODEL.md added to SCANNED_SOURCES (isSource: false) in the RED commit — the section carries guarantee-adjacent prose, so the banned-CLAIM scan covers it from day one (feeds Phase 11 lock)"
  - "Reversible subsections numbered 1-5 within their own H2 (not 11-15 continuing Non-Defenses) — they are not non-defenses; presence gate asserts lowercase heading fragments so renumbering never breaks it"
metrics:
  duration: "~10 min"
  completed: 2026-07-14
  tasks-complete: 2/2
---

# Phase 8 Plan 06: THREAT_MODEL Reversible Section + Stale-Wording Amendment Summary

**One-liner:** THREAT_MODEL.md gains a drift-gated '## Reversible Mode (v3.0)' section (blast radius / secret floor / wire re-entry per the corrected shape-validation findings / key-custody honesty / residual risks) with design-commitment framing, and PROJECT.md + CLAUDE.md drop the stale return-path-restore sentence for operator-only `mrclean restore` framing — REVMODE-03 / SC4 complete.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Copy-drift presence gate | 555fc9d | tests/copy-drift.test.ts (+SCANNED_SOURCES entry for THREAT_MODEL.md) |
| 1 (GREEN) | THREAT_MODEL reversible-mode section | 01bbaea | THREAT_MODEL.md (+129 lines, five H3 subsections) |
| 2 | Amend stale return-path restore wording | 6b7555e | .planning/PROJECT.md, CLAUDE.md (1 line each) |

TDD gate compliance: `test(08-06)` commit (555fc9d) precedes `feat(08-06)` commit (01bbaea); RED run showed exactly the 8 new assertions failing, GREEN run 13/13.

## What the section claims (traceability)

Every empirical claim traces to `tests/uat/artifacts/contract-findings.json` (CC 2.1.209, 2026-07-14):

- **Wire re-entry (§3):** string `updatedToolOutput` rejected for Bash with zod `invalid_type` warning (`experiments.E1_shape_validation.verbatim_hook_error`); object shape `{stdout, stderr, interrupted, isImage}` honored (probe e244a7f9); terminal renders the model-facing value in both cases (`experiments.E1.rendering`); user view == model view. #68951 cited by number as "most likely reproduces the string form" — evidence and the filed upstream request cited by document reference (`docs/HOOK-CONTRACT.md`), no inlined issue URL per plan.
- **Residual risks (§5):** T5 session_id continuity across `--resume` (E3); SessionEnd does NOT fire headless so the TTL sweep is primary there (E5); enumeration residual = within-session sequential NNN under v2 tokens; win32 fail-open known-gap inherited, not widened.
- **Blast radius / secret floor / key-custody (§1/§2/§4):** written from locked T2/T3 decisions as design commitments; key-custody names both adversary classes (casual single-artifact exfiltration stopped; same-user local attacker not stopped).

## Stale-wording audit (Task 2)

Grepped `return path`, `round-trip`, `restoring placeholders` in both files: **audited, 1 instance amended per file** (matches RESEARCH expectation N=1). Remaining hits — PROJECT.md:29 (T1 reshape note) and PROJECT.md:39 (v3.x fast-follow) — correctly describe the deferral and were left untouched per plan. Git diff for the commit shows only the two single-line amendments.

## Verification

- `npx vitest run --project=unit tests/copy-drift.test.ts`: 13/13 green (presence gate + banned-CLAIM scan including THREAT_MODEL.md).
- `npm test` full suite: 621 passed, 12 skipped (opt-in UAT), 0 failed.
- Verify greps: `## Reversible Mode (v3.0)` present, `transcript ratchet` present, `docs/HOOK-CONTRACT.md` referenced in wire re-entry, stale sentence absent from both amended files, `mrclean restore` present in both.
- REQUIREMENTS.md: REVMODE-03 marked complete (traceability row updated).

## Deviations from Plan

### Orchestrator-corrected findings applied (directed, not a discovered deviation)

**1. Wire re-entry subsection written to the corrected E1 picture, not the plan's pre-checkpoint wording**
- **Found during:** Task 1 (plan authored before 08-04 Task 3 surfaced the shape-validation discovery)
- **Change:** the plan's conditional "#68951 confirmed ⇒ mrclean's PostToolUse redaction of Bash results is inert" caveat was replaced by the corrected framing: redaction IS achievable via tool-shaped object payloads; string-form emission silently no-ops (warning only); the failure mode modeled is silent-ish shape rejection. T1's deferral rationale is unchanged (channel is model-facing either way).
- **Files modified:** THREAT_MODEL.md
- **Commit:** 01bbaea

### Auto-fixed Issues

**2. [Rule 3 - Blocking] Test-run dist/ rebuild churn reverted**
- **Found during:** overall verification (`npm test` integration globalSetup runs tsup)
- **Issue:** the worktree resolves node_modules from the main repo root, so the rebuild rewrote embedded module-path comments in tracked `dist/cli.js`/`dist/mcp.js` to `../../../node_modules/...` — worktree-relative paths that would be wrong post-merge. No source file in this plan touches dist inputs.
- **Fix:** `git checkout -- dist/cli.js dist/mcp.js` (scoped file revert; orchestrator regenerates dist post-wave per phase precedent).
- **Files modified:** none committed
- **Commit:** n/a

No other deviations. No authentication gates.

## Known Stubs

None. One intentional cross-plan reference: THREAT_MODEL.md cites `docs/HOOK-CONTRACT.md`, which is authored in parallel by plan 08-05 in its own worktree and becomes real at post-wave merge (per orchestrator instruction: cite by path, do not block or create).

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes. Plan threat register applied: T-08-19 (design-commitment framing asserted by the gate), T-08-20 (key-custody subsection names the adversary classes file custody does not stop), T-08-21 (presence gate on every unit run). T-08-SC accepted: no package installs occurred.

## Self-Check: PASSED

- THREAT_MODEL.md: FOUND (contains `## Reversible Mode (v3.0)`, 5 new H3 subsections, `transcript ratchet`, `design commitment`, `docs/HOOK-CONTRACT.md`)
- tests/copy-drift.test.ts: FOUND (presence gate + SCANNED_SOURCES entry)
- .planning/PROJECT.md / CLAUDE.md: FOUND (stale sentence absent, `mrclean restore` present)
- Commits 555fc9d, 01bbaea, 6b7555e: FOUND (test before feat)
- No untracked files left behind; working tree clean except REQUIREMENTS.md + this SUMMARY (committed together below)
