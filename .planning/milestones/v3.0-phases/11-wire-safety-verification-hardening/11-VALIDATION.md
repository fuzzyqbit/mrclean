---
phase: 11
slug: wire-safety-verification-hardening
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-17
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> This phase IS validation — the map below is the phase's deliverable inventory.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.6 (projects: unit parallel / integration sequential + tsup globalSetup / uat opt-in) |
| **Config file** | `vitest.config.ts` (edited this phase: dist-parity dual-listing, Plan 11-01) |
| **Quick run command** | `npx vitest run --project=unit <changed test files>` |
| **Full suite command** | `npm test` (baseline entering Phase 11: 962 passed / 18 skipped after review fixes) |
| **Typecheck gate** | `npm run typecheck` — 38-error differential baseline; zero errors in Phase 11 files |
| **Estimated runtime** | ~90 seconds (integration rebuilds dist via globalSetup) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run --project=unit <touched files>` + `npm run typecheck` (differential)
- **After every plan wave:** `npm test`
- **Phase gate:** full suite green + one operator `MRCLEAN_UAT=1 npm run test:uat` run (SC1b live leg + survey re-stamps) + frozen-tree zero-diff vs `8f370b9` (`src/hook src/detect src/placeholder tests/placeholder tests/detect` empty; `tests/hook` diff shows ONLY the sanctioned new file `tests/hook/dist-parity.test.ts`)
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

> Seeded from 11-RESEARCH.md `## Validation Architecture`. Task IDs assigned at plan time (2026-07-17); executor flips Status per commit.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-T1 | 11-01 | 1 | REVMODE-11 / SC1a | T-11-01-01..03 | Dist-spawn hook stdout parity one-way vs reversible (nonce-normalized deep-equal, v2 probe non-vacuity, zero canary stdout+map, one-way home state-free) + dual-listing routing proof | integration | `npx vitest run tests/hook/dist-parity.test.ts --project=integration` | ❌ W0 + vitest.config dual-list | ⬜ pending |
| 11-02-T1 | 11-02 | 1 | REVMODE-11 / SC2 | T-11-02-01..03 | fs monkey-patch + syncBuiltinESMExports seam over the real two-event reversible flow; absence sweep + MRCLNMAP/32-byte-key channel probes | unit | `npx vitest run tests/state/fs-interception.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| 11-02-T2 | 11-02 | 1 | REVMODE-11 / SC2 | T-11-02-01..03 | Restore leg under the same patch: appendFile audit.jsonl probe, full-flow absence sweep, patch-hygiene proof (finally + afterEach) | unit | `npx vitest run tests/state/fs-interception.test.ts --project=unit && npm test` | ❌ W0 (same file) | ⬜ pending |
| 11-03-T1/T2 | 11-03 | 1 | REVMODE-11 / hardening (IN-02, AR-10-05) | T-11-03-01..03 | Cross-session collision demote-to-unmatched with sticky Set (RED rows first: collision, third-occurrence, benign-duplicate control; real-key encrypted fixtures; sessions-count non-vacuity) | unit (TDD) | `npx vitest run tests/restore/session-index.test.ts tests/state/cold-path.test.ts --project=unit` | ✅ extend + fix | ⬜ pending |
| 11-04-T1/T2 | 11-04 | 1 | REVMODE-11 / hardening (IN-01) | T-11-04-01..03 | Outer-catch honesty: counts=ZERO_COUNTS first-in-catch + guarded fallback write (RED rows: stale-counts summary, double-throw containment; summary pin byte-identical) | unit (TDD) | `npx vitest run tests/restore/degrade.test.ts tests/cli/restore.test.ts tests/state/cold-path.test.ts --project=unit` | ✅ extend + fix | ⬜ pending |
| 11-05-T1 | 11-05 | 1 | REVMODE-11 / SC1b | T-11-05-01 | Foreign-named env-fed MCP echo fixture + tool_response observer hook (zero canaries in fixture source; exit-0 pure observer) | fixture syntax/deterministic | `node --check tests/uat/fixtures/echo-mcp-server.mjs && sh -n tests/uat/fixtures/postresp-log-hook.sh` | ❌ W0 | ⬜ pending |
| 11-05-T2 | 11-05 | 1 | REVMODE-11 / SC1b | T-11-05-02..04 | Live canary never on wire; restore-then-resume no re-entry; whole `~/.claude/projects/**/*.jsonl` grep = 0 (run-unique minted canaries); non-vacuity chain before absence; HOME prefix on hook command only | live UAT (opt-in, operator-run at verify-work); deterministic self-skip check in-plan | `MRCLEAN_UAT=1 npm run test:uat` (`-t 'wire safety'`); in-plan: `npx vitest run tests/uat/wire-safety.test.ts --project=uat` self-skips | ❌ W0 | ⬜ pending |
| 11-05-T2 (survey) | 11-05 | 1 | REVMODE-11 / SC1b survey | T-11-05-04 | Per-tool `tool_response` shapes recorded (re-homed todo) — record-don't-assert → findings artifact via guarded builder | live UAT (same run) | same run | ❌ W0 (same file) | ⬜ pending |
| 11-05-T3 | 11-05 | 1 | REVMODE-11 / SC1b survey | T-11-05-04 | HOOK-CONTRACT per-tool shapes section, zero new UUIDs (copy-drift UUID gate green pre-live-run) | unit (docs gate) | `npx vitest run tests/copy-drift.test.ts --project=unit` | ✅ extend doc | ⬜ pending |
| 11-06-T1 | 11-06 | 2 | REVMODE-11 / SC3 + SC4 + leak-grep CI | T-11-06-01 | Explicit named CI steps with exact "Test Files N passed" count guards (chaos/fs-interception/restore-leak unit; dist-parity/stress integration) + reversible corpus in defense-in-depth grep | CI workflow + local step-command proof | `npx vitest run --project=unit tests/audit/restore-canary-leak.test.ts tests/state/chaos.test.ts tests/state/fs-interception.test.ts` + integration pair, each piped through the count guard | ✅ suites exist / ❌ workflow steps W0 | ⬜ pending |
| 11-06-T2 | 11-06 | 2 | REVMODE-11 / SC4 (ubuntu-first-run risk, A4) | T-11-06-02 | workflow_dispatch + gsd/** push triggers on test.yml + canary-leak.yml; observed ubuntu run (or documented deferral); WORKER_DEADLINE_MS is the ONLY permissible knob (T-09-08-06) | CI observation | `gh run list --workflow=test.yml --branch <milestone-branch>` shows green run | ❌ W0 (trigger lines) | ⬜ pending |
| 11-06-T3 | 11-06 | 2 | REVMODE-11 / (optional) perf | T-11-06-01 | Reversible PostToolUse overhead p95 < 200 ms driving the real handler (STATE.md TBD metric); V2 probe non-vacuity; cut-first if phase runs long | integration perf | `npx vitest run --project=integration tests/perf/post-tool-use-reversible.perf.test.ts` | ❌ optional W0 | ⬜ pending |
| 11-07-T1 | 11-07 | 3 | REVMODE-11 / SC5 | T-11-07-01/02 | THREAT_MODEL finalized to shipped facts (gates cited by file, residuals per adopted hardening) + copy-drift anchor swap in ONE paired commit ('design commitment' removal trap) | unit (extend) | `npx vitest run tests/copy-drift.test.ts --project=unit` | ✅ extend | ⬜ pending |
| 11-07-T2 | 11-07 | 3 | REVMODE-11 / SC5 | T-11-07-01/03 | Encrypted-at-rest overclaim shapes banned (3 additive regexes × scan/positive-control/self-check) + src/doctor/checks.ts in SCANNED_SOURCES; phase regression gate | unit (extend) + full suite | `npx vitest run tests/copy-drift.test.ts --project=unit && npm test && npm run typecheck` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/hook/dist-parity.test.ts` + vitest.config dual-listing — SC1a → **11-01-T1**
- [ ] `tests/state/fs-interception.test.ts` — SC2 (fs monkey-patch + `module.syncBuiltinESMExports()`; `vi.mock('node:fs')` does NOT reach externalized CJS write-file-atomic) → **11-02-T1/T2**
- [ ] `tests/uat/wire-safety.test.ts` + `tests/uat/fixtures/echo-mcp-server.mjs` + `tests/uat/fixtures/postresp-log-hook.sh` — SC1b + survey (MCP echo carries run-unique minted canaries; string `updatedToolOutput` rejected for Bash, honored for MCP; HOME-prefix hook command only so claude keeps real auth) → **11-05-T1/T2**
- [ ] copy-drift.test.ts SC5 extension rows (paired with THREAT_MODEL.md + strings.ts edits in ONE commit) → **11-07-T1/T2**
- [ ] canary-leak.yml / test.yml explicit wire-safety steps (+ workflow_dispatch + gsd/** pre-run for ubuntu-first-run stress deadline risk) → **11-06-T1/T2**
- [ ] IN-01/IN-02 test rows in existing restore suites (RED-first, tdd_mode) → **11-03-T1**, **11-04-T1**
- Framework install: none

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SC1b live wire gate + tool_response survey | REVMODE-11 | Live headless Claude session spends real tokens — settled repo policy: operator-executed at verify-work; executor NEVER sets MRCLEAN_UAT=1 itself | `MRCLEAN_UAT=1 npm run test:uat` (optionally `-t 'wire safety'`); suite self-verifies the non-vacuity chain then greps `~/.claude/projects/**/*.jsonl` for the run-unique canaries; expect 0 hits + green |

---

## Known Risks

- **Vacuous-pass hazard:** `vitest run <file> --project=X` exits 0 with ZERO matched files when mis-routed (demonstrated in-repo by 10-07). Every CI step this phase adds carries an exact "Test Files N passed" count guard; 11-01 proves routing with a unit-project zero-file negative control; sabotage spot-checks documented in SUMMARYs.
- **Ubuntu-first-run stress deadline:** 500 ms deadline measured on macOS; CI workflows never fired from milestone branch. 11-06-T2 retires this via gsd/** push trigger + observed run; WORKER_DEADLINE_MS is the only knob (T-09-08-06), zero-degrade assertion untouched.
- **Copy-drift phrase trap:** gate hard-requires `'design commitment'`; THREAT_MODEL finalization removes it — 11-07-T1 pairs doc + gate in one commit or CI breaks between commits.
- **Live-leg canary contamination (planner-identified):** the pinned unit corpus appears in this repo's planning docs, which prior GSD sessions read into `~/.claude/projects` transcripts — a whole-dir grep for pinned values would false-fail. 11-05 mints run-unique canaries for the live leg; pinned corpus stays authoritative for deterministic gates and CI greps.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (plan-checker)
