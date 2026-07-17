---
phase: 10
slug: operator-restore
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-17
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
- **Before `/gsd:verify-work`:** Full suite green + tools-list integration green + zero-diff gate over frozen trees (`src/hook`, `src/detect`, `src/placeholder`)
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

> Seeded from 10-RESEARCH.md `## Validation Architecture` requirement→test map.
> Planner assigns Task IDs; executor flips Status per commit.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | REVMODE-01 | TBD | Engine table: exact lookup restores; unknown/stale/planted/OVF/v1 tokens pass through; single-pass no-cascade | unit (TDD) | `npx vitest run tests/restore/engine.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVMODE-01 | TBD | CLI: stdin/file → restored stdout; `--session` sid gate; summary on stderr only | unit | `npx vitest run tests/cli/restore.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVMODE-01 | TBD | No model-facing surface: tools/list exactly 3 tools, `restore` absent (T2/T2b) | integration | `npm run build && npx vitest run tests/mcp/tools-list.test.ts --project=integration` | ✅ | ⬜ pending |
| TBD | TBD | TBD | REVMODE-01/08 | TBD | Fence: no hook-reachable or `src/mcp/`/`src/detect/` module imports `src/restore/`; cipher/lock tokens confined to `src/state/` | unit | `npx vitest run tests/state/cold-path.test.ts --project=unit` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | REVMODE-01 | TBD | Mixed-content canary: WORD-term round-trips, AWS placeholder survives byte-identical | unit/integration | `npx vitest run tests/restore/mixed-canary.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVMODE-08 | TBD | Degrade matrix: map missing/corrupt/truncated/garbage-key/chmod-000/locked → output==input, one stderr warning, exit 0, no litter | unit | `npx vitest run tests/restore/degrade.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVMODE-08 | TBD | Redaction unaffected: chaos one-way parity + stress gates stay green | unit + integration | `npx vitest run tests/state/chaos.test.ts --project=unit && npm run build && npx vitest run tests/state/stress.test.ts --project=integration` | ✅ | ⬜ pending |
| TBD | TBD | TBD | REVMODE-09 | TBD | Hash-only audit: counts+16-hex hashes only; assertNoCanaryLeak over audit.jsonl; non-vacuity guard | unit | `npx vitest run tests/audit/restore-canary-leak.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVMODE-09 | TBD | Error-path leak-grep: forced failures leak nothing to stderr or audit; raw map bytes grep clean | unit | same file (error-path block) + `npx vitest run tests/state/inspection.test.ts --project=unit` | ❌/✅ W0+extend | ⬜ pending |
| TBD | TBD | TBD | REVMODE-12 | TBD | Doctor: unknown `[reversible]` key → FAIL exit 1 naming file+key; supported → PASS; LOCKED exit map unchanged | unit | `npx vitest run tests/doctor/checks.test.ts --project=unit` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | REVMODE-12 | TBD | Status: counters by class + restored/unmatched totals; schema unchanged; no canaries in structuredContent | unit | `npx vitest run tests/mcp/status-reversible.test.ts --project=unit` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | all | TBD | Phase regression: full suite green; typecheck == 38-error baseline; zero-diff over `src/hook src/detect src/placeholder tests/placeholder tests/detect` | full suite | `npm test && npm run typecheck` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/restore/engine.test.ts` — REVMODE-01 table-driven engine (TDD RED first)
- [ ] `tests/restore/degrade.test.ts` — REVMODE-08 corruption/degrade matrix
- [ ] `tests/restore/mixed-canary.test.ts` — SC2 mixed-content canary (Phase 11 gate substrate)
- [ ] `tests/cli/restore.test.ts` — CLI seam (stdin/file/--session)
- [ ] `tests/audit/restore-canary-leak.test.ts` — REVMODE-09 audit + stderr + error-path grep
- [ ] `tests/mcp/status-reversible.test.ts` — REVMODE-12 counters
- [ ] Extensions: `tests/state/cold-path.test.ts`, `tests/doctor/checks.test.ts`, `tests/state/inspection.test.ts`
- Framework install: none — vitest projects already route `tests/restore/**` to unit project by default glob

---

## Leak-Grep Extension Strategy (REVMODE-09 spine)

1. **Canary corpus:** synthetic restorable originals (WORD term `zz-canary-project-path`, `.invalid` email) + synthetic secret canary (non-EXAMPLE fake AWS key — `AKIAIOSFODNN7EXAMPLE` is gitleaks-allowlisted, produces no findings).
2. **Surfaces swept:** `<cwd>/.mrclean/audit.jsonl`, restore stderr (success AND every degrade/error path), `mrclean_status` structuredContent, raw `sessions/*.map` envelope bytes.
3. **Framing (load-bearing):** secret-class canaries appear on NO surface anywhere (including stdout — placeholder survives); restorable canaries appear ONLY on restore stdout (never audit, stderr, status, map-adjacent litter).
4. **Non-vacuity guards:** assert restored > 0 before asserting cleanliness; assert audit line exists before grepping.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| *(none expected — all phase behaviors have automated verification per research map; planner may add rows)* | — | — | — |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
