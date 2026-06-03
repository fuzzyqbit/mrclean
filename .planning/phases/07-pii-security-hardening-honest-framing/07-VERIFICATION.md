---
phase: 07-pii-security-hardening-honest-framing
verified: 2026-06-03T19:00:00Z
status: passed
score: 3/3 success criteria verified (8/8 plan truths verified)
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
---

# Phase 7: PII Security Hardening & Honest Framing Verification Report

**Phase Goal:** Close the security and trust surface a security tool is held to, auditing the fully-integrated PII surface end-to-end. A leak-grep regression test proves no raw PII value ever reaches `.mrclean/audit.jsonl` or any error/diagnostic/exception path, and all user-facing copy is ruthlessly framed as a best-effort ML recall aid — explicitly NOT a guarantee, with secrets remaining the deterministic guarantee.
**Verified:** 2026-06-03T19:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (SC) | Status | Evidence |
|---|-----------|--------|----------|
| SC-1 | Leak-grep test feeds known PII through full pipeline; asserts none appear in `audit.jsonl` OR stderr/error output incl. exception paths; both probes pass non-vacuously | ✓ VERIFIED | Ran `npx vitest run --project=integration tests/audit/pii-canary-leak.test.ts --reporter=verbose` → **1 file, 2 passed** (non-empty line-count guard + assertNoCanaryLeak over 4 raw canaries through full NER-on pipeline). Ran `npx vitest run --project=unit tests/audit/pii-stderr-leak.test.ts` → **3 passed** (3 forced-failure paths: model-load throw, inference throw, supervisor catch; test (3) first asserts the canary IS present pre-chokepoint then absent post — load-bearing/non-vacuous) |
| SC-2 | README PII section frames NER as best-effort ML hint, not a guarantee; states false negatives can leak; points to words.txt + deterministic layers; no "redacts all PII"/compliance language | ✓ VERIFIED | README §9 "PII and NER detection — best-effort, not a guarantee" (line 225). States "**false negatives can leak**" (238), names `words.txt` + deterministic layers as the real lever (242-245), "makes no regulatory-compliance claims" (247). `grep -niE "redacts? all pii\|gdpr\|hipaa\|compliant" README.md` → no overclaim hit (exit 1) |
| SC-3 | Framing consistent across CLI output, `mrclean doctor`, and docs — probabilistic asterisk visible wherever PII surfaces (incl. MCP structuredContent bestEffort flag + copy-drift CI gate) | ✓ VERIFIED | Disclaimer fanned out from single source `src/shared/strings.ts` to: doctor/CLI `renderReport` trailing line (report.ts:62, **unconditional** — after loop+version line, not behind a SKIP), SessionStart `additionalContext` (session-start.ts:57), MCP tool descriptions (check.ts:115, redact.ts:111). `bestEffort: f.source === 'pii-ner'` on both MCP DTOs (check.ts:82, redact.ts:77). Copy-drift gate `tests/copy-drift.test.ts` → **5 passed** (incl. positive control + Pitfall-5 self-check). CI job in canary-leak.yml (lines 69, 87-88) |

**Score:** 3/3 success criteria verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/shared/sanitize-output.ts` | Single two-mode no-raw chokepoint, reuses redactedHash, LOCKED comment, no engine imports | ✓ VERIFIED | 82 lines; with-context literal split/join scrub + context-free STATIC message (D-04); LOCKED comment at :58/:68; imports only `Finding` type from findings (cold-path fence intact) |
| `src/shared/strings.ts` | Centralized disclaimer + banned-phrase list | ✓ VERIFIED | `PII_BEST_EFFORT_DISCLAIMER` (claim-safe, says "not a guarantee") + `BANNED_COPY_PHRASES` (4 claim-shape regexes, no bare `/guarantee/`) |
| `tests/audit/pii-canary-leak.test.ts` | Integration audit.jsonl leak proof, NER-on, line-count guard | ✓ VERIFIED | Ran green (2 passed); wired into integration include (vitest.config.ts:82) |
| `tests/audit/pii-stderr-leak.test.ts` | Unit stderr proof, 3 forced-failure paths | ✓ VERIFIED | Ran green (3 passed); rides unit glob, not in integration include |
| `src/mcp/tools/check.ts` / `redact.ts` | bestEffort flag + isError routing + description disclaimer | ✓ VERIFIED | `bestEffort: z.boolean()` schema + `=== 'pii-ner'` derivation; isError routed through sanitizeForOutput (check:142, redact:136); disclaimer in description (check:115, redact:111) |
| `src/doctor/report.ts` | Guaranteed trailing disclaimer line | ✓ VERIFIED | report.ts:62 unconditional stdout.write after version line |
| `README.md` | PII/NER framing section | ✓ VERIFIED | §9, lines 225-250 |
| `tests/copy-drift.test.ts` | Banned-phrase gate + disclaimer presence, non-vacuous | ✓ VERIFIED | Ran green (5 passed) |
| `.github/workflows/canary-leak.yml` | PII leak CI job + belt-and-suspenders grep | ✓ VERIFIED | vitest integration step (:69) + `grep -F` PII loop with `::error::` (:87-88) |
| `vitest.config.ts` | integration include extended (non-vacuity) | ✓ VERIFIED | pii-canary-leak in include (:82) AND unit exclude (:112); integration run matched exactly 1 file (proven by `--reporter=verbose` run) |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| supervisor.ts | sanitize-output.ts | `sanitizeForOutput(err.message)` (supervisor.ts:62) | ✓ WIRED |
| failclosed.ts | sanitize-output.ts | `sanitizeForOutput(rawMessage)` context-free; raw stack dropped (`stack: 'redacted'`), reason redacted (failclosed.ts:37,48,50) | ✓ WIRED |
| check.ts / redact.ts isError | sanitize-output.ts | `sanitizeForOutput(\`...error: ${outcome.error}\`, [])` (check:142, redact:136) | ✓ WIRED |
| check.ts / redact.ts toFindingDTO | ResolvedFinding.source | `bestEffort: f.source === 'pii-ner'` (source read, never serialized) | ✓ WIRED |
| README / report.ts / session-start.ts / MCP tools | strings.ts | all import `PII_BEST_EFFORT_DISCLAIMER` (single source) | ✓ WIRED (5 consumers confirmed) |
| canary-leak.yml | pii-canary-leak.test.ts | integration vitest step + grep -F over audit*.jsonl | ✓ WIRED |

### Behavioral Spot-Checks / Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| Integration audit.jsonl leak proof | `npx vitest run --project=integration tests/audit/pii-canary-leak.test.ts --reporter=verbose` | 1 file, 2 passed (line-count guard + assertNoCanaryLeak) | PASS |
| Unit stderr leak proof | `npx vitest run --project=unit tests/audit/pii-stderr-leak.test.ts` | 3 passed (3 forced-failure paths) | PASS |
| Copy-drift gate | `npx vitest run tests/copy-drift.test.ts` | 5 passed (incl. positive control) | PASS |
| MCP bestEffort DTO | `npx vitest run tests/mcp/check.test.ts tests/mcp/redact.test.ts` | 14 passed | PASS |
| No regression (chokepoint wiring) | `npx vitest run tests/mcp tests/hook tests/doctor tests/shared/sanitize-output.test.ts` | 23 files, 139 passed | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PIISEC-01 | 07-01, 07-03 | Leak-grep test asserts no raw PII in audit logs or error/diagnostic paths | ✓ SATISFIED | Both leak probes pass non-vacuously; sanitizeForOutput chokepoint on all error sinks; CI job wired |
| PIISEC-02 | 07-02, 07-03 | User-facing copy frames PII/NER as best-effort, not a guarantee | ✓ SATISFIED | README §9 + 4 runtime surfaces + bestEffort flag + copy-drift gate |

No orphaned requirements. PIISEC-03 is mapped to Phase 4 in REQUIREMENTS.md (line 235), not Phase 7 — correctly out of scope per CONTEXT.

### Locked Decisions (D-01..D-08) Coverage

D-01 dedicated corpus ✓ · D-02 3 forced-failure paths ✓ · D-03 single chokepoint on all error sinks ✓ · D-04 context-free static message + stack/reason dropped ✓ · D-05 once-per-output on all surfaces ✓ · D-06 bestEffort machine flag ✓ · D-07 framing stance (human-approved 2026-06-03) ✓ · D-08 banned-phrase CI gate ✓

### Anti-Patterns Found

None. No TBD/FIXME/XXX/PLACEHOLDER debt markers in any phase-modified file. The context-free static message is an intentional D-04 security design, not a stub. No new dependencies added.

### Human Verification Required

None outstanding. The only human gate in the phase (07-03 Task 5, D-07 copy-wording sign-off, `checkpoint:human-verify`) was completed and recorded as approved 2026-06-03. All other criteria are programmatically verified by the probes run above.

### Gaps Summary

No gaps. All 3 ROADMAP success criteria are observably true in the codebase, all 8 plan truths verified, both requirement IDs satisfied, all 8 locked decisions honored, all key links wired, and every probe runs green and non-vacuously. The two advisory WARNINGs from 07-REVIEW.md (WR-01 partial-value scrub gap, WR-02 MCP error-context discard) are advisory and do not affect the phase goal — the leak-no-raw-PII guarantee (proven by the canary probes) and honest framing (proven by README + copy-drift gate) are both sound.

---

_Verified: 2026-06-03T19:00:00Z_
_Verifier: Claude (gsd-verifier)_
