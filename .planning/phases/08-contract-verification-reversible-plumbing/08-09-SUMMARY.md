---
phase: 08-contract-verification-reversible-plumbing
plan: 09
subsystem: testing
tags: [uat, hook-contract, live-run, e4-cap, gap-closure]
requires: [08-08, 08-05]
provides:
  - "Settled E4 verdict: cap does NOT bind updatedToolOutput (~15K survived intact for Bash, object shape)"
  - "Read-object probe answer: Bash-style object REJECTED for Read (zod invalid_union names Read's expected shape)"
  - "Regenerated contract-findings.json with fresh 2.1.209/2026-07-14 stamps and preserved curated E1 evidence (WR-01 live proof)"
  - "docs/HOOK-CONTRACT.md: §E4 settled, Read matrix cell filled, follow-ups closed, guarded-writer procedure documented"
affects: [09, 10, 11]
tech-stack:
  added: []
  patterns:
    - "Live rerun through the guarded findings writer: run-fresh verdicts merge over (never destroy) committed interactive-only evidence"
key-files:
  created: []
  modified:
    - tests/uat/artifacts/contract-findings.json
    - docs/HOOK-CONTRACT.md
key-decisions:
  - "THREAT_MODEL.md left unedited: reversible section has zero statements premised on the old E4 verdict (no 10K/cap/E4/map-size references anywhere in the file) — no amendment needed, checked 2026-07-14"
  - "E4 verdict quoted on its own line in HOOK-CONTRACT §E4 so the quote byte-matches experiments.E4.verdict (line-wrap would break the traceability claim)"
  - "Read object follow-up closed (rejection IS the empirical answer) with the honest bound stated: Read's exact accepted shape remains undocumented upstream; what is settled is the Bash shape is refused, verbatim error on record"
  - "REVMODE-10 marked complete: the 10K-cap applicability clause was its last unverified item"
metrics:
  duration-minutes: 11
  tasks: 2
  files-changed: 2
completed: 2026-07-14
---

# Phase 8 Plan 09: Live E4 Rerun + Contract Doc Refresh Summary

**One-liner:** Live 11/11-green rerun through the hardened 08-08 harness settled E4 empirically — the 10K hook-output cap does NOT bind `updatedToolOutput` (~15K object-shaped rewrite survived intact for Bash) — and answered the Read-object probe (rejected, zod `invalid_union`), while live-proving the guarded writer preserved the curated E1 evidence; HOOK-CONTRACT.md now carries the settled verdicts with zero unowned follow-ups.

## Recorded Verdicts (verbatim from the regenerated artifact)

- **E4** (`experiments.E4.verdict`):
  "cap does NOT bind updatedToolOutput (~15K survived intact for Bash)"
  — object-shaped payload (`{stdout, stderr, interrupted, isImage}`) via `tests/uat/fixtures/e4-object-large-output-hook.sh`; both HEAD and TAIL markers reached the model-facing `tool_result`; observed `stream_tool_result_char_length: 15032`.
- **Read-object** (`experiments.E1_shape_validation.signals.read_object_verdict`):
  "rejected — zod error names Read's expected output shape (see verbatim excerpt)"
  — verbatim excerpt captured in `read_object_hook_error`: zod `invalid_union`, "No matching discriminator", path `["type"]` (probe session `df4534f2-190a-4060-8d50-0dbf94cfba94`).
- **Contingency: did NOT fire.** The Bash-object leg was honored on 2.1.209 exactly as the 08-08 gating expected — no contract drift since the E1_shape_validation discovery.

## What Was Done

### Task 1 — Live E4 rerun + artifact integrity (`1dd8d68`)

- Preflight: `claude --version` → `2.1.209 (Claude Code)` (same version as the prior stamps); fresh `npm run build` byte-identical to committed `dist/`.
- `MRCLEAN_UAT=1 npx vitest run --project=uat tests/uat/contract-verification.test.ts` — targeted file only; **11/11 harness-integrity tests green in 76s**.
- Post-run `node -e` integrity gate exit 0, proving all four assertions:
  1. `E1_shape_validation` present with non-empty `verbatim_hook_error` (the interactive string-rejection excerpt survived regeneration — field-level carry-forward worked).
  2. `E1.rendering` is an object with a non-empty verdict (NOT `pending-interactive`) — the operator-sourced PTY evidence survived (WR-01 live proof).
  3. `E4.verdict` no longer matches `/blocked by #68951/` and the method names the object leg.
  4. `claude_version` stamped, `date` = run date (2026-07-14).
- Isolation held: `git status` clean apart from the artifact; sandbox `--settings` isolation structural (operator `~/.claude/settings.json` never registered).

### Task 2 — HOOK-CONTRACT refresh + THREAT_MODEL consistency (`c2771e9`)

- **§E4:** stale "Unanswerable…" verdict and "Reinterpretation" paragraphs replaced with the recorded verdict (byte-matching quote) and a fresh stamp naming `e4-object-large-output-hook.sh`; `additionalContext` control finding kept (still accurate, carried forward by the writer).
- **§E4 downstream implications:** Phase 10 restore-in-large-outputs — no truncation carve-out needed at ~15K (with the honest bound: tested to ~15K, re-run before relying on far-larger sizes); Phase 9 map-size — growth bounded by actual tool-output size, not a hook cap.
- **Per-tool matrix:** Read "Object payload" cell filled — REJECTED, quoting `read_object_verdict` byte-for-byte, citing the `invalid_union` signals.
- **§Open follow-ups → §Closed follow-ups:** both items settled by the 08-08/08-09 harness legs, pointing at `experiments.E1_shape_validation` and `experiments.E4`; Read leg noted as rerunnable via the committed E1/Read-object test.
- **§Re-verification procedure:** two sentences appended documenting the guarded writer (zero-verdict refusal + interactive-evidence carry-forward; WR-01 closed).
- **THREAT_MODEL.md:** no amendment needed — checked 2026-07-14. The reversible section's wire re-entry analysis is premised on the shape-validation finding (string rejected / object honored), which this run re-confirmed (`object_probe_honored: true`, `string_shape_rejected: true`); the file contains no cap/E4/map-size statements to amend. Copy-drift gate green (13/13), unchanged file not committed.

## Verification Results

| Gate | Result |
|------|--------|
| `MRCLEAN_UAT=1 npx vitest run --project=uat tests/uat/contract-verification.test.ts` | 11 passed, exit 0, 76.42s |
| Task 1 `node -e` artifact integrity gate | exit 0 |
| `npx vitest run --project=unit tests/copy-drift.test.ts` | 13 passed, exit 0 |
| `grep -c "unanswerable" docs/HOOK-CONTRACT.md` | 0 |
| `grep -c "rerun deferred" docs/HOOK-CONTRACT.md` | 0 |
| `grep -c "e4-object-large-output-hook" docs/HOOK-CONTRACT.md` | 1 |
| `grep -c "UNTESTED" docs/HOOK-CONTRACT.md` | 0 (Read matrix cell filled) |
| E4 verdict + read_object_verdict byte-match doc↔artifact | both true |
| `git status` after live run | artifact only (isolation held) |

## Token Spend

11 live headless sessions on `claude-haiku-4-5` (max 4–6 turns each, 76s wall time) — approximately 10–25 Haiku calls, estimated well under $0.10 (cents), consistent with the harness docstring estimate.

## Deviations from Plan

None — plan executed as written; the Task-1 contingency (object leg not honored / upstream drift) did NOT fire. (Environment note, not a deviation: the PreToolUse commit-guard hook false-positived on a compound guard+commit command — same behavior 08-08 recorded; resolved by splitting guards and `git commit` into separate invocations. Hooks ran normally; nothing was bypassed.)

## Known Stubs

None.

## Threat Model Compliance

- T-08-09-01 (Repudiation): mitigated — both quoted verdicts byte-match the regenerated artifact (spot-checked programmatically).
- T-08-09-02 (Tampering): mitigated — the node integrity gate proved E1_shape_validation + E1.rendering survived regeneration (live proof of the 08-08 writer).
- T-08-09-03 (Info disclosure): mitigated — marker strings only; `git status` confirmed no repo files touched beyond the artifact; sandbox `--settings` isolation held.
- T-08-09-04 (Spoofing): mitigated — preflight `claude --version` succeeded (2.1.209); no auth gate hit.
- T-08-SC (supply chain): accepted as planned — zero package installs.

## Notes for Downstream Phases

- **Phase 10 (restore-in-large-outputs):** design against "no cap at ~15K on 2.1.209" — re-run E4 with a larger payload before assuming unbounded.
- **Phase 9 (map-size):** placeholder-map growth from tool-output rewrites is bounded by tool-output size, not a hook cap.
- **Phase 11 (THREAT_MODEL finalization):** reversible section verified consistent with all live verdicts as of 2026-07-14; no pending amendments from Phase 8.

## Self-Check: PASSED

- FOUND: tests/uat/artifacts/contract-findings.json (regenerated, integrity gate exit 0)
- FOUND: docs/HOOK-CONTRACT.md (all grep gates green)
- FOUND: commit 1dd8d68 (test — E4 rerun artifact)
- FOUND: commit c2771e9 (docs — HOOK-CONTRACT refresh)
