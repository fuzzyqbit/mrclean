---
phase: 11-wire-safety-verification-hardening
verified: 2026-07-18T04:56:44Z
status: human_needed
score: 12/14 must-haves verified
overrides_applied: 0
human_verification:
  - test: "SC1b live wire leg (operator-run, token spend): from the milestone branch run `MRCLEAN_UAT=1 npm run test:uat -t 'wire safety'` with an authenticated claude CLI"
    expected: "Non-vacuity chain green (v2 tokens on the wire -> sandbox map exists -> restore restored>=1), then zero canary hits in run-1 stream-json, the run-1 transcript, and EVERY ~/.claude/projects/**/*.jsonl; --resume re-entry leg also zero hits; per-tool tool_response shapes recorded into tests/uat/artifacts/contract-findings.json. Afterwards re-stamp the docs/HOOK-CONTRACT.md per-tool matrix cells from the artifact in the same commit (UUID-traceability gate enforces consistency). If the v2 probe fails, a contract-drift verdict (CLI 2.1.212 vs 2.1.209 stamps) is recorded before the red — dist-parity still carries SC1's CI proof."
    why_human: "Live headless Claude session spends real tokens — settled repo policy (11-VALIDATION Manual-Only table): operator-executed at verify-work; the executor never sets MRCLEAN_UAT=1. The 'no restored canary in the next outbound request body / transcript tree' clause of SC1 is only observable in a real session."
  - test: "A4 retirement — first ubuntu CI run: push the milestone branch (`git push origin gsd/v3.0-reversible-redact-mode-foundations-operator-restore`), then `gh run list --workflow=test.yml --branch <branch> --limit 1` and `gh run watch <run-id> --exit-status`; same for canary-leak.yml"
    expected: "Both workflows fire on the push (the gsd/** trigger ships on the very push that fires it) and complete green, including the stress gate (500 ms harness deadline) and the wire-safety count-guarded steps + reversible-corpus grep. On a stress deadline flake: per T-09-08-06 raise ONLY WORKER_DEADLINE_MS (tests/state/stress.test.ts) with a measured-margin comment — the zero-degrade assertion is never the knob."
    why_human: "Branch has no remote tracking ref (verified: not pushed). Executor ran in a worktree (pre-sanctioned outcome (c) in 11-06); pushing and watching CI is an operator/orchestrator action outside the verifier's remit. The steps are proven locally with sabotage checks, but 'gates the build' on ubuntu needs one observed run."
---

# Phase 11: Wire-Safety Verification & Hardening — Verification Report

**Phase Goal:** CI proves the milestone's negative claims — reversible mode never re-exposes originals on any wire path — via adversarial end-to-end gates, and the honest copy is locked against drift
**Verified:** 2026-07-18T04:56:44Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | SC1a: shipped dist/cli.js hook stdout is deep-equal one-way vs reversible after v2 nonce-tail strip, with branch-engagement probe BEFORE parity, zero canary on either stdout, ciphertext-only map, state-free one-way home | ✓ VERIFIED | tests/hook/dist-parity.test.ts (209 lines): all 8 assertions in pinned order (header lines 20-27, bodies 159-196); `stripNonceTails` at 132; ran the exact CI step command — `Test Files 2 passed (2)` |
| 2  | SC1a routing is non-vacuous: dist-parity dual-listed (unit exclude + integration include) | ✓ VERIFIED | Integration run collects 1 file green; unit run: `No test files found` (zero collected — exclude proven live) |
| 3  | SC1b harness: opt-in wire-safety UAT suite self-skips green without MRCLEAN_UAT=1; run-unique canary mint; canaries env-fed only (never in prompts); non-vacuity chain ordered before all absence greps; HOME prefix on hook command only | ✓ VERIFIED | wire-safety.test.ts: `UAT_ENABLED` gate (77), mint (133-135) + mint-integrity test (164-171, AKIA+[A-Z2-7]{16} + Shannon>3), chain test at 680 precedes absence test at 778, whole-tree jsonl walk (368-397); self-skip run: `3 passed \| 8 skipped`, exit 0; prompt grep: zero canary interpolation; MRCLEAN_TOOL_RE non-match guard with positive control (174-180) |
| 4  | SC1b wire outcome: no restored canary value in the next outbound request body or in `~/.claude/projects/**/*.jsonl` on a LIVE session | ? UNCERTAIN → human | Only observable in a real token-spending session. Deferred to verify-work BY DESIGN (settled repo policy, 11-VALIDATION Manual-Only table). Harness + exact operator command shipped (human item 1) |
| 5  | SC2: no plaintext canary in ANY buffer handed to a patched fs write API during a real reversible flow + restore run, including write-file-atomic temp writes; three channels non-vacuously probed | ✓ VERIFIED | tests/state/fs-interception.test.ts (469+ lines): 8 APIs patched, `syncBuiltinESMExports` after install AND restore, MRCLNMAP/32-byte-key/audit.jsonl channel probes, finally+afterEach hygiene with sibling identity-restore test; green in the unit CI gate run |
| 6  | SC3: with a corrupt, missing, or chmod'd map the canary is still redacted and no tool call is blocked — and this gates CI by name | ✓ VERIFIED | chaos.test.ts: six corruption shapes incl. (e) map deleted mid-session ("missing") and (c) chmod 000; deep-equal one-way parity = never-blocked; NAMED in canary-leak.yml count-guarded step (line 143); exact step command ran green: `Test Files 3 passed (3)` |
| 7  | SC4: 16-process concurrency stress — zero lost entries, zero duplicate placeholders for distinct originals, identical placeholders for identical originals — gates the build by name | ✓ VERIFIED | stress.test.ts: WORKER_COUNT=16 real processes (57, 110), asserts 0 lost / 0 NNN dups / cross-process identity (12-16, 143-150); NAMED in the integration count-guard step (canary-leak.yml line 144); ran green locally |
| 8  | SC3/SC4 CI reach: workflows fire from gsd/** pushes + manual dispatch; first ubuntu run observed or deferral documented with commands | ? UNCERTAIN → human | Triggers verified in both workflows (test.yml + canary-leak.yml lines 3-11); branch has NO remote tracking ref — first ubuntu run has never fired. Pre-sanctioned deferral (11-06 outcome (c)) with exact commands (human item 2) |
| 9  | SC5: THREAT_MODEL reversible section states shipped facts with gates cited by test file, zero 'design commitment'; copy-drift anchors swapped in the SAME commit; encrypted-at-rest overclaim shapes banned with positive controls; doctor copy scanned | ✓ VERIFIED | `grep -c "design commitment"` = 0; both anchors at THREAT_MODEL 155/273 + 'transcript ratchet' at 229; 8 gate citations by file (148-237); 3 additive ban regexes (strings.ts 55-63); doctor/checks.ts in SCANNED_SOURCES (copy-drift 48); paired commit 52d7cd1 stat lists BOTH files; copy-drift 25/25 green |
| 10 | Hardening IN-02/AR-10-05: cross-session placeholder collision demotes to unmatched, sticky across the union build; benign duplicates still restore; imports unchanged | ✓ VERIFIED | session-index.ts: function-scoped `demoted` Set (135), skip-if-demoted (160), demote-on-conflict delete+add+continue (163-168); TDD order proven by commit timestamps (a584ae5 test → 17a73b2 feat); 15 session-index + 9 cold-path tests green |
| 11 | Hardening IN-01: outer catch resets counts to ZERO_COUNTS before summary; fallback stdout write guarded (double-throw contained); WR-04 stdin read inside the hard-error domain | ✓ VERIFIED | cli.ts: `counts = ZERO_COUNTS` first-in-catch (233), guarded fallback with documented swallow (235-243), ERR_STDIN_READ + try/catch readAll → exitCode 2 (80, 168-177); TDD order proven (5277436 → 7ae579d); degrade + cli/restore + cold-path 44 tests green |
| 12 | Review fixes WR-01/WR-02 in the CI gate: capture-then-grep kills the SIGPIPE false-red; reversible-corpus grep is non-vacuous (fails on missing/empty export set) | ✓ VERIFIED | canary-leak.yml: `run_and_guard` capture-then-grep with explicit status check (131-144); export-dir scan with fail-on-missing + fail-on-empty (161-184); end-to-end simulation ran: 11 audit files exported by the 3 unit suites, all 3 corpus canaries absent |
| 13 | HOOK-CONTRACT per-tool tool_response shapes section exists, pending-stamp cells naming CLI 2.1.212, ZERO session UUIDs quoted | ✓ VERIFIED | Section at docs/HOOK-CONTRACT.md:172 with record-don't-assert framing; UUID-regex scan of the section: 0 matches; copy-drift UUID gate green (25/25) |
| 14 | Phase regression gate: full suite green, typecheck at baseline, frozen trees held, no dist commits | ✓ VERIFIED | `npm test`: 105 files passed / 2 skipped, 986 tests passed / 29 skipped; typecheck: exactly 38 errors; `git diff --stat 8f370b9` on src/hook, src/detect, src/placeholder, tests/placeholder, tests/detect: EMPTY; tests/hook delta = dist-parity.test.ts only (209+); `git status --porcelain dist/`: clean (rebuild byte-identical) |

**Score:** 12/14 truths verified (2 UNCERTAIN → routed to human verification, both pre-sanctioned deferrals by plan/policy, not execution gaps)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `tests/hook/dist-parity.test.ts` | ≥90 lines, contains stripNonceTails | ✓ VERIFIED | 209 lines; 8 pinned assertions; spawns real dist/cli.js; wired into vitest.config + canary-leak.yml |
| `vitest.config.ts` | dist-parity dual-listing | ✓ VERIFIED | Unit exclude + integration include, both live (negative control ran) |
| `tests/state/fs-interception.test.ts` | ≥120 lines, contains syncBuiltinESMExports | ✓ VERIFIED | 469+ lines; 8-API patch seam; 3 channel probes; WR-02 export wiring invoked at cleanup (348) |
| `src/restore/session-index.ts` | contains demoted | ✓ VERIFIED | Sticky demote Set at fix site; JSDoc overclaim corrected; imports unchanged (cold-path fence green) |
| `tests/restore/session-index.test.ts` | ≥120 lines | ✓ VERIFIED | 561 lines; Cases A/B/C on real-cipher hand-built fixtures; sessions-count non-vacuity first |
| `src/restore/cli.ts` | contains ZERO_COUNTS | ✓ VERIFIED | ZERO_COUNTS reset first-in-catch + guarded fallback + WR-04 stdin domain |
| `tests/restore/degrade.test.ts` | contains byte-exact zero summary | ✓ VERIFIED | `restored=0 unmatched=0 secret-skipped=0 sessions=0` pinned; rows green |
| `tests/uat/wire-safety.test.ts` | ≥150 lines, contains MRCLEAN_UAT | ✓ VERIFIED | 900+ lines; self-skips green; token-free deterministic guards run in every mode |
| `tests/uat/fixtures/echo-mcp-server.mjs` | contains CANARY_TEXT | ✓ VERIFIED | Env-fed only (line 47); zero canary literals; foreign-named (fails MRCLEAN_TOOL_RE) |
| `tests/uat/fixtures/postresp-log-hook.sh` | contains tool_response | ✓ VERIFIED | Executable observer hook; exit 0 always |
| `docs/HOOK-CONTRACT.md` | Per-tool tool_response shapes section | ✓ VERIFIED | Section at line 172; pending-stamp matrix (CLI 2.1.212); zero UUIDs |
| `.github/workflows/canary-leak.yml` | contains dist-parity | ✓ VERIFIED | Named count-guarded steps (WR-01 form) + corpus grep (WR-02 form) |
| `.github/workflows/test.yml` | contains workflow_dispatch | ✓ VERIFIED | dispatch + gsd/** push; pull_request stays main-only |
| `tests/perf/post-tool-use-reversible.perf.test.ts` | contains handlePostToolUse | ✓ VERIFIED | Drives the real handler; p95<200ms gate; ran green (1 passed) |
| `THREAT_MODEL.md` | contains 'verified against the shipped implementation' | ✓ VERIFIED | Line 155; zero 'design commitment'; 8 gate citations |
| `tests/copy-drift.test.ts` | contains same-user-attacker anchor | ✓ VERIFIED | Anchor assertions at 280-285; 25/25 green |
| `src/shared/strings.ts` | contains BANNED_COPY_PHRASES | ✓ VERIFIED | 3 additive encrypted-at-rest overclaim regexes (55-63) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| tests/hook/dist-parity.test.ts | dist/cli.js | spawnSync DIST_CLI | ✓ WIRED | SDK verified + test ran green against the real bundle |
| vitest.config.ts | dist-parity.test.ts | paired exclude/include | ✓ WIRED | Both entries live (routing negative control) |
| tests/state/fs-interception.test.ts | node:module | syncBuiltinESMExports | ✓ WIRED | Install + restore call sites |
| tests/state/fs-interception.test.ts | src/restore/cli.js | captureRestoreRun | ✓ WIRED | Restore leg under the patch |
| tests/restore/session-index.test.ts | src/restore/session-index.ts | buildRestoreIndex | ✓ WIRED | Collision fixtures drive the real builder |
| src/restore/session-index.ts | src/state/map-store.ts | readSessionMapFile | ✓ WIRED | Import surface unchanged |
| tests/restore/degrade.test.ts | src/restore/cli.ts | throwing-stdout harness | ✓ WIRED | Rows exercise the real outer catch |
| tests/uat/wire-safety.test.ts | tests/uat/harness.ts | runClaude import | ✓ WIRED | Imported, never reimplemented |
| tests/uat/wire-safety.test.ts | echo-mcp-server.mjs | --mcp-config + CANARY_TEXT env | ✓ WIRED | Fixture spawn wiring present |
| tests/uat/wire-safety.test.ts | dist/cli.js | buildHookCommand HOME-prefixed | ✓ WIRED | HOME prefix on hook command + restore env only |
| .github/workflows/canary-leak.yml | tests/hook/dist-parity.test.ts | count-guarded vitest step | ✓ WIRED | Exact step command reproduced green locally |
| tests/perf/…reversible.perf.test.ts | src/hook/handlers/post-tool-use.ts | handlePostToolUse import | ✓ WIRED | Real handler driven; ran green |
| tests/copy-drift.test.ts | THREAT_MODEL.md | required-fragment asserts | ✓ WIRED | Anchors asserted; gate green |
| tests/copy-drift.test.ts | src/doctor/checks.ts | SCANNED_SOURCES entry | ✓ WIRED | Doctor copy under the gate; file untouched |

### Behavioral Spot-Checks & Probe Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit CI gate (SC2/SC3) exact step command | `npx vitest run --project=unit tests/audit/restore-canary-leak.test.ts tests/state/chaos.test.ts tests/state/fs-interception.test.ts` | `Test Files 3 passed (3)` — matches count guard | ✓ PASS |
| Integration CI gate (SC1a/SC4) exact step command | `npx vitest run --project=integration tests/hook/dist-parity.test.ts tests/state/stress.test.ts` | `Test Files 2 passed (2)` — matches count guard | ✓ PASS |
| Copy-drift gate (SC5) | `npx vitest run tests/copy-drift.test.ts --project=unit` | 25/25 passed | ✓ PASS |
| Hardening suites + fences | `npx vitest run tests/restore/session-index.test.ts tests/restore/degrade.test.ts tests/cli/restore.test.ts tests/state/cold-path.test.ts --project=unit` | 44 passed / 1 skipped | ✓ PASS |
| Wire-safety self-skip (no tokens) | `npx vitest run tests/uat/wire-safety.test.ts --project=uat` | 3 passed / 8 skipped, exit 0 | ✓ PASS |
| Routing negative control | `npx vitest run tests/hook/dist-parity.test.ts --project=unit` | `No test files found` (zero collected) | ✓ PASS |
| Reversible perf row | `npx vitest run --project=integration tests/perf/post-tool-use-reversible.perf.test.ts` | 1 passed (p95 gate internal) | ✓ PASS |
| WR-02 export chain end-to-end | unit gate run with `MRCLEAN_TEST_AUDIT_EXPORT_DIR` set, then find + corpus grep | 11 exported audit files; all 3 corpus canaries absent | ✓ PASS |
| Full regression | `npm test` | 105 files / 986 tests passed, 29 skipped | ✓ PASS |
| Typecheck baseline | `npm run typecheck` error count | exactly 38 (baseline) | ✓ PASS |
| SC1b live leg | `MRCLEAN_UAT=1 npm run test:uat -t 'wire safety'` | not run — token spend is operator-authorized only | ? SKIP → human |
| First ubuntu CI run (A4) | push + `gh run watch` | not run — branch has no remote tracking ref | ? SKIP → human |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| REVMODE-11 | all 7 (11-01…11-07) | CI proves reversible mode never re-exposes originals on any wire path: hook stdout unchanged (dist-parity), no plaintext canary in any written buffer incl. atomic temp (fs-interception), redaction survives corrupt/missing/chmod'd map (chaos), 8–16-process stress gates the build (stress) | ✓ SATISFIED (implementation) | All four clauses have shipped, locally-proven, CI-named count-guarded gates. REQUIREMENTS.md row still `Pending` — orchestrator flips at phase close (deliberate per 11-01 process note). Two operator observations outstanding (live leg, first ubuntu run) — see human items |

Orphan check: REVMODE-11 is the only requirement REQUIREMENTS.md maps to Phase 11 — no orphaned IDs.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| tests/perf/post-tool-use-reversible.perf.test.ts | 4 | `TBD` | ℹ️ Info | Not a debt marker — quotes the STATE.md metric row name this file CLOSES ("closes the STATE.md '…overhead — TBD (Phase 9/11)' metric") |
| .planning/STATE.md | 47 | metric row still `TBD (Phase 9/11 …)` | ℹ️ Info | Orchestrator-owned bookkeeping: measured values now exist (p95 5.36 ms reversible / 2.60 ms one-way, delta +2.75 ms — 11-06). Not a phase-goal gap |
| docs/HOOK-CONTRACT.md | §Per-tool matrix | 12 `pending first MRCLEAN_UAT=1 …` cells | ℹ️ Info | Intentional BY PLAN (11-05 Task 3) — evidence slots filled by the operator live run; hard-stamping now would fabricate evidence |

No TBD/FIXME/XXX debt markers, no TODO/HACK/PLACEHOLDER, no stub returns in any phase-modified file. Review pass (11-REVIEW): 0 Critical; 4 Warnings all FIXED in code (verified at the fix sites, not from the report: WR-01 canary-leak.yml:131-144, WR-02 canary-leak.yml:161-184 + export fns invoked in all 3 unit suites, WR-03 wire-safety.test.ts:457 hard find with no `?? entries[0]` fallback, WR-04 cli.ts:80/168-177); 7 Info items deferred (Info never gates).

### Human Verification Required

#### 1. SC1b live wire leg (operator-run, BY DESIGN deferral)

**Test:** From the milestone branch with an authenticated `claude` CLI: `MRCLEAN_UAT=1 npm run test:uat -t 'wire safety'`
**Expected:** Non-vacuity chain green (v2 tokens on the wire → sandbox map exists → restore restored≥1), then ZERO canary hits in run-1 stream-json, the run-1 transcript, and every `~/.claude/projects/**/*.jsonl`; `--resume` re-entry leg also zero hits; tool_response shapes recorded to `tests/uat/artifacts/contract-findings.json`. Then re-stamp the HOOK-CONTRACT matrix from the artifact in one commit. Cost ~6 Haiku sessions (cents).
**Why human:** Live headless session spends real tokens — settled repo policy: operator-executed at verify-work; the executor never sets MRCLEAN_UAT=1. This is the only way to observe SC1's "no restored canary value appears in the next outbound request body" clause.

#### 2. A4 retirement — first ubuntu run of the elevated CI gates

**Test:** `git push origin gsd/v3.0-reversible-redact-mode-foundations-operator-restore` (the gsd/** trigger fires on this very push), then `gh run list --workflow=test.yml --branch <branch> --limit 1` + `gh run watch <run-id> --exit-status`; same for canary-leak.yml.
**Expected:** Both workflows green on ubuntu-latest, including the 16-process stress deadline and the count-guarded wire-safety steps + non-vacuous reversible-corpus grep. On stress flake: raise ONLY `WORKER_DEADLINE_MS` with a measured-margin comment (T-09-08-06); the zero-degrade assertion is never the knob.
**Why human:** Branch not pushed (no remote tracking ref — verified). The gates are proven locally with documented sabotage checks, but "gates the build" needs one observed ubuntu execution before the milestone-merge PR.

### Gaps Summary

No gaps. Every deterministic must-have is verified in the codebase with executed evidence: both CI step commands reproduce their exact count-guard output locally, the WR-02 export chain was simulated end-to-end (11 sinks, corpus absent), routing non-vacuity was re-proven with the negative control, the two src hardening fixes sit at the exact claimed sites with TDD commit order confirmed by timestamps, the THREAT_MODEL/copy-drift/strings.ts triple is mutually locked (paired commit 52d7cd1 verified), frozen trees held vs 8f370b9, and the full suite is green at the claimed 986/29 with typecheck at the 38-error baseline.

The two UNCERTAIN items are pre-sanctioned operator legs, not execution shortfalls: the phase note pins "the SC1b live leg is operator-run at verify-work (all plans autonomous)", and 11-06's outcome (c) documents the exact deferred push/watch commands. Status is therefore human_needed, not gaps_found.

---

_Verified: 2026-07-18T04:56:44Z_
_Verifier: Claude (gsd-verifier)_
