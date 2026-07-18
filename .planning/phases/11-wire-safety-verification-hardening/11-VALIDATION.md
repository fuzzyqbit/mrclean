---
phase: 11
slug: wire-safety-verification-hardening
status: draft
nyquist_compliant: false
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
| **Config file** | `vitest.config.ts` (edited this phase: dist-parity dual-listing) |
| **Quick run command** | `npx vitest run --project=unit <changed test files>` |
| **Full suite command** | `npm test` (baseline entering Phase 11: 962 passed / 18 skipped after review fixes) |
| **Typecheck gate** | `npm run typecheck` — 38-error differential baseline; zero errors in Phase 11 files |
| **Estimated runtime** | ~90 seconds (integration rebuilds dist via globalSetup) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run --project=unit <touched files>` + `npm run typecheck` (differential)
- **After every plan wave:** `npm test`
- **Phase gate:** full suite green + one operator `MRCLEAN_UAT=1 npm run test:uat` run (SC1b live leg + survey re-stamps) + frozen-tree zero-diff (EXCEPT sanctioned new test file under tests/hook/ for dist-parity — plans must name the exact allowed file)
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

> Seeded from 11-RESEARCH.md `## Validation Architecture`. Planner assigns Task IDs; executor flips Status.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | REVMODE-11 / SC1a | TBD | Dist-spawn hook stdout parity one-way vs reversible (nonce-normalized deep-equal, placeholders present, zero canary) | integration | `npx vitest run tests/hook/dist-parity.test.ts --project=integration` | ❌ W0 + vitest.config dual-list | ⬜ pending |
| TBD | TBD | TBD | REVMODE-11 / SC1b | TBD | Live canary never on wire; restore-then-resume no re-entry; `~/.claude/projects/**/*.jsonl` grep = 0 | live UAT (opt-in, operator-run) | `MRCLEAN_UAT=1 npm run test:uat` (`-t 'wire-safety'`) | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVMODE-11 / SC1b survey | TBD | Per-tool `tool_response` shapes recorded (re-homed todo) — record-don't-assert → findings artifact + HOOK-CONTRACT section | live UAT | same run | ❌ W0 (same file) | ⬜ pending |
| TBD | TBD | TBD | REVMODE-11 / SC2 | TBD | No plaintext canary in ANY written buffer incl. atomic-write temp files (fs monkey-patch + syncBuiltinESMExports seam); channel-coverage probes | unit | `npx vitest run tests/state/fs-interception.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVMODE-11 / SC3 | TBD | Corrupt/missing/chmod'd map → canary still redacted, never a block (six shapes, parity) | unit (existing) + explicit non-vacuous CI step | `npx vitest run tests/state/chaos.test.ts --project=unit` | ✅ extend CI wiring | ⬜ pending |
| TBD | TBD | TBD | REVMODE-11 / SC4 | TBD | 16-proc stress: zero lost/corrupted, no dup placeholders distinct originals, identical placeholders identical originals, zero degrades | integration (existing) + explicit CI step | `npx vitest run tests/state/stress.test.ts --project=integration` | ✅ extend CI wiring | ⬜ pending |
| TBD | TBD | TBD | REVMODE-11 / SC5 | TBD | THREAT_MODEL finalized to shipped facts; copy-drift covers encrypted-at-rest + honest framing; doctor copy in SCANNED_SOURCES; paired doc+gate commit (`'design commitment'` phrase removal trap) | unit (extend) | `npx vitest run tests/copy-drift.test.ts --project=unit` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | REVMODE-11 / hardening | TBD | IN-02/AR-10-05 collision demote-to-unmatched; IN-01 zero-counts + guarded fallback on catch | unit (extend) | `npx vitest run tests/restore/session-index.test.ts tests/restore/degrade.test.ts tests/cli/restore.test.ts --project=unit` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | REVMODE-11 / leak-grep CI | TBD | restore-canary suite + reversible corpus greps named in canary-leak.yml (non-vacuous: assert matched-file count > 0) | CI workflow | CI step + `npx vitest run --project=unit tests/audit/restore-canary-leak.test.ts` | ✅ suite / ❌ workflow step | ⬜ pending |
| TBD | TBD | TBD | (optional) perf | TBD | Reversible PostToolUse overhead p95 < 200 ms (STATE.md TBD metric) — last, cut-first | integration perf | `npx vitest run --project=integration tests/perf/` | ❌ optional W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/hook/dist-parity.test.ts` + vitest.config dual-listing — SC1a
- [ ] `tests/state/fs-interception.test.ts` — SC2 (fs monkey-patch + `module.syncBuiltinESMExports()`; `vi.mock('node:fs')` does NOT reach externalized CJS write-file-atomic)
- [ ] `tests/uat/wire-safety.test.ts` + `tests/uat/fixtures/echo-mcp-server.mjs` + `tests/uat/fixtures/postresp-log-hook.sh` — SC1b + survey (MCP echo carries canaries; string `updatedToolOutput` rejected for Bash, honored for MCP; HOME-prefix hook command only so claude keeps real auth)
- [ ] copy-drift.test.ts SC5 extension rows (paired with THREAT_MODEL.md + strings.ts edits in ONE commit)
- [ ] canary-leak.yml / test.yml explicit wire-safety steps (+ optional workflow_dispatch pre-run for ubuntu-first-run stress deadline risk)
- [ ] IN-01/IN-02 test rows in existing restore suites
- Framework install: none

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SC1b live wire gate + tool_response survey | REVMODE-11 | Live headless Claude session spends real tokens — settled repo policy: operator-executed at verify-work | `MRCLEAN_UAT=1 npm run test:uat` with reversible HOME fixture; grep `~/.claude/projects/**/*.jsonl` for canaries; expect 0 |

---

## Known Risks

- **Vacuous-pass hazard:** `vitest run <file> --project=X` exits 0 with ZERO matched files when mis-routed (demonstrated in-repo by 10-07). Every CI step this phase adds must assert matched-file count > 0.
- **Ubuntu-first-run stress deadline:** 500 ms deadline measured on macOS; CI workflows never fired from milestone branch. Mitigation options in RESEARCH open question 1.
- **Copy-drift phrase trap:** gate hard-requires `'design commitment'`; THREAT_MODEL finalization removes it — doc + gate must change in one paired commit or CI breaks between commits.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
