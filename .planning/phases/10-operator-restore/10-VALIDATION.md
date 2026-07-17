---
phase: 10
slug: operator-restore
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-17
planned: 2026-07-17
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.6 (projects: unit parallel / integration sequential+globalSetup / uat opt-in) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --project=unit <changed test files>` |
| **Full suite command** | `npm test` (baseline entering Phase 10: 861 passed / 16 skipped, 90 files, exit 0) |
| **Typecheck gate** | `npm run typecheck` — differential vs 38-error baseline; zero errors allowed in Phase 10 files |
| **Estimated runtime** | ~90 seconds (integration rebuilds dist via globalSetup) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project=unit <touched suites>` (< 30 s)
- **After every plan wave:** Run `npm test` + `npm run typecheck` (differential vs 38-error baseline)
- **Before `/gsd:verify-work`:** Full suite green + tools-list integration green + zero-diff gate over frozen trees (`src/hook`, `src/detect`, `src/placeholder`) vs phase base `e950d76`
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

> Seeded from 10-RESEARCH.md `## Validation Architecture` requirement→test map.
> Task IDs assigned at plan time (2026-07-17); executor flips Status per commit.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-T1/T2 | 10-01 | 1 | REVMODE-01 | T-10-01-01..03 | Engine table: exact lookup restores; unknown/stale/planted/OVF/v1 tokens pass through; single-pass no-cascade | unit (TDD) | `npx vitest run tests/restore/engine.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| 10-02-T1/T2 | 10-02 | 1 | REVMODE-01 | T-10-02-01..04 | Read-side policy gate: restorable-only index; poisoned-map/OVF/invalid-sid exclusion; total-error skip | unit (TDD) | `npx vitest run tests/restore/session-index.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| 10-03-T1/T2 | 10-03 | 1 | REVMODE-09 | T-10-03-01/03 | Hash-only record builder (no-raw structural), heterogeneous JSONL coexistence, counters aggregation | unit (TDD) | `npx vitest run tests/audit/restore-log.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| 10-04-T1/T2 | 10-04 | 1 | REVMODE-12 | T-10-04-01/04 | Doctor: unknown `[reversible]` key → FAIL exit 1 naming file+key; supported → PASS byte-locked; LOCKED exit map unchanged | unit (TDD) | `npx vitest run tests/config/reversible-raw-keys.test.ts tests/doctor/checks.test.ts --project=unit` | ✅ extend + ❌ W0 | ⬜ pending |
| 10-05-T1 | 10-05 | 2 | REVMODE-01 | T-10-05-01/03 | CLI: stdin/file → restored stdout; `--session` sid gate; summary on stderr only; hash-at-boundary audit write | unit | `npx vitest run tests/cli/restore.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| 10-05-T2 | 10-05 | 2 | REVMODE-08 | T-10-05-02/04/05 | Degrade matrix: map missing/corrupt/truncated/garbage-key/chmod-000/unknown-sid → output==input, constant-shape warning, exit 0, no litter/mtime | unit | `npx vitest run tests/restore/degrade.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| 10-05-T2 (parity) | 10-05 | 2 | REVMODE-08 | T-10-05-04 | Redaction unaffected: chaos one-way parity stays green with restore code present (no shared kill switch) | unit (existing) | `npx vitest run tests/state/chaos.test.ts --project=unit` | ✅ | ⬜ pending |
| 10-06-T1 | 10-06 | 2 | REVMODE-12 | T-10-06-01 | Counts-only reducer in src/state/ (originals confined; numbers-only projection) | unit | `npx vitest run tests/state/counts.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| 10-06-T2 | 10-06 | 2 | REVMODE-12 | T-10-06-01/02 | Status: counters block (entries by class, sessions, restored/unmatched totals); zero-argument schema unchanged; no canaries in structuredContent | unit | `npx vitest run tests/mcp/status-reversible.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| 10-07-T1 | 10-07 | 3 | REVMODE-01/08 | T-10-07-01/02/04 | Fence both directions: only cli.ts dynamic site imports src/restore/; restore imports allowlist-only; cipher/lock tokens still confined to src/state/ | unit (extend) | `npx vitest run tests/state/cold-path.test.ts --project=unit` | ✅ extend | ⬜ pending |
| 10-07-T2 | 10-07 | 3 | REVMODE-01 | T-10-07-01/03 | Mixed-content canary: WORD round-trips, AWS placeholder survives byte-identical (real pipeline); tools/list exactly 3, `restore` absent (T2/T2b) | unit + integration | `npx vitest run tests/restore/mixed-canary.test.ts --project=unit && npm run build && npx vitest run tests/mcp/tools-list.test.ts --project=integration` | ❌ W0 + ✅ | ⬜ pending |
| 10-08-T1 | 10-08 | 3 | REVMODE-09 | T-10-08-01..03 | Leak-grep: invariant matrix over stdout/stderr/audit/artifacts, success AND error paths (garbage key, EACCES, hand-poisoned secret original); non-vacuity guards | unit | `npx vitest run tests/audit/restore-canary-leak.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| 10-08-T2 | 10-08 | 3 | REVMODE-09 | T-10-08-04 | Restore-flow artifact grep: map/key bytes still clean, listings+mtimes unchanged across a restore run | unit (extend) | `npx vitest run tests/state/inspection.test.ts --project=unit` | ✅ extend | ⬜ pending |
| 10-08-T2 (gate) | 10-08 | 3 | all | T-10-08-05 | Phase regression: full suite green; typecheck == 38-error baseline (zero Phase 10 errors); zero-diff over `src/hook src/detect src/placeholder tests/placeholder tests/detect` vs `e950d76` | full suite | `npm test && npm run typecheck` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Created RED-first (TDD plans) or tests-first (tdd="true" tasks) by the owning plan:

- [ ] `tests/restore/engine.test.ts` — 10-01 T1 (TDD RED)
- [ ] `tests/restore/session-index.test.ts` — 10-02 T1 (TDD RED)
- [ ] `tests/audit/restore-log.test.ts` — 10-03 T1 (TDD RED)
- [ ] `tests/config/reversible-raw-keys.test.ts` + `tests/doctor/checks.test.ts` rows — 10-04 T1 (TDD RED)
- [ ] `tests/cli/restore.test.ts` — 10-05 T1 (tests-first)
- [ ] `tests/restore/degrade.test.ts` — 10-05 T2 (tests-first)
- [ ] `tests/state/counts.test.ts` — 10-06 T1 (tests-first)
- [ ] `tests/mcp/status-reversible.test.ts` — 10-06 T2 (tests-first)
- [ ] `tests/state/cold-path.test.ts` extension — 10-07 T1
- [ ] `tests/restore/mixed-canary.test.ts` — 10-07 T2
- [ ] `tests/audit/restore-canary-leak.test.ts` — 10-08 T1
- [ ] `tests/state/inspection.test.ts` extension — 10-08 T2
- Framework install: none — vitest projects already route `tests/restore/**` to unit project by default glob

---

## Leak-Grep Extension Strategy (REVMODE-09 spine)

1. **Canary corpus:** synthetic restorable originals (WORD term `zz-canary-project-path-7g2`, `.invalid` email) + synthetic secret canary (non-EXAMPLE fake AWS key — `AKIAIOSFODNN7EXAMPLE` is gitleaks-allowlisted, produces no findings).
2. **Surfaces swept:** `<cwd>/.mrclean/audit.jsonl`, restore stderr (success AND every degrade/error path), `mrclean_status` structuredContent, raw `sessions/*.map` envelope bytes.
3. **Framing (load-bearing):** secret-class canaries appear on NO surface anywhere (including stdout — placeholder survives); restorable canaries appear ONLY on restore stdout (never audit, stderr, status, map-adjacent litter).
4. **Non-vacuity guards:** assert restored > 0 before asserting cleanliness; assert audit line exists before grepping.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| *(none — all phase behaviors have automated verification; operator UAT of the live CLI happens at `/gsd:verify-work`)* | — | — | — |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (validation audit at execute/verify transition)
