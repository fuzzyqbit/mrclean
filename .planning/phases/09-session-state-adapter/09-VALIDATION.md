---
phase: 9
slug: session-state-adapter
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-17
validated: 2026-07-17
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.x (unit + integration + uat projects) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --project=unit <changed test files>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~90 seconds (full; integration project sequential, rebuilds dist via globalSetup) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project=unit <touched suites>`
- **After every plan wave:** Run `npm test` (baseline after 08-12: 642 passed / 14 skipped, exit 0)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01.T1 | 09-01 | 1 | REVMODE-02 | T-09-SC | Pinned slopcheck-clean deps; wfa major PINNED ^7 (Node 20 floor); types in devDeps | CLI assertion | `node -e "<package.json pin assertions>" && npm ls proper-lockfile write-file-atomic` | ✅ n/a (asserts package.json) | ✅ green |
| 09-01.T2 | 09-01 | 1 | REVMODE-07 | T-09-01-01, T-09-01-02 | Fail-closed ttl_hours ConfigReadError; partial project layer never clears user opt-in | unit (task TDD) | `npx vitest run tests/config --project=unit` | ✅ extend existing | ✅ green |
| 09-02.T1 | 09-02 | 1 | REVMODE-06 | T-09-02-01 | RED gate: property-absent `original` contract pinned before implementation | unit (RED) | `npx vitest run tests/state/secret-floor.test.ts --project=unit` (expect FAIL — RED gate) | ✅ created (Wave 0) | ✅ green |
| 09-02.T2 | 09-02 | 1 | REVMODE-06 | T-09-02-01..-04 | Structural secret floor + serializer strip; salted HMAC addressing; CSPRNG nonce8; SID allowlist regex | unit (GREEN) | `npx vitest run tests/state/secret-floor.test.ts --project=unit` | ✅ from 09-02.T1 | ✅ green |
| 09-02.T3 | 09-02 | 1 | REVMODE-06 | — | Refactor keeps floor contract green with zero test edits | unit | `npx vitest run tests/state/secret-floor.test.ts --project=unit` | ✅ from 09-02.T1 | ✅ green |
| 09-03.T1 | 09-03 | 2 | REVMODE-02 | T-09-03-01 | RED gate: full corruption matrix => ABSENT pinned (incl. DEP0182 truncated-tag case) | unit (RED) | `npx vitest run tests/state/map-store.test.ts --project=unit` (expect FAIL — RED gate) | ✅ created (Wave 0) | ✅ green |
| 09-03.T2 | 09-03 | 2 | REVMODE-02 | T-09-03-01..-07 | authTagLength:16 + validate-before-slice; AAD binds sid; ciphertext-only bytes incl. temp; 0600/0700; fsync:false | unit (GREEN) | `npx vitest run tests/state/map-store.test.ts --project=unit` | ✅ from 09-03.T1 | ✅ green |
| 09-03.T3 | 09-03 | 2 | REVMODE-02 | — | Refactor, export surface unchanged | unit | `npx vitest run tests/state/map-store.test.ts --project=unit` | ✅ from 09-03.T1 | ✅ green |
| 09-04.T1 | 09-04 | 2 | REVMODE-05 | T-09-04-01 | RED gate: v2 nonce token format + hydrate/drain contract pinned | unit (RED) | `npx vitest run tests/state/tokens-v2.test.ts --project=unit` (expect FAIL — RED gate) | ✅ created (Wave 0) | ✅ green |
| 09-04.T2 | 09-04 | 2 | REVMODE-05 | T-09-04-01..-04 | v1 path byte-identical (zero-edit placeholder suite); type-only state imports (cold-path safe) | unit (GREEN) | `npx vitest run tests/state/tokens-v2.test.ts tests/placeholder --project=unit` | ✅ from 09-04.T1 + existing v1 suite | ✅ green |
| 09-04.T3 | 09-04 | 2 | REVMODE-05 | — | Refactor, v1 zone still untouched | unit | `npx vitest run tests/state/tokens-v2.test.ts tests/placeholder --project=unit` | ✅ from 09-04.T1 | ✅ green |
| 09-05.T1 | 09-05 | 3 | REVMODE-04 | T-09-05-01, T-09-05-03 | RED gate: reconcile/renumber/degrade/sid-fence contracts pinned | unit (RED) | `npx vitest run tests/state/lock.test.ts tests/state/allocation.test.ts --project=unit` (expect FAIL — RED gate) | ✅ created (Wave 0) | ✅ green |
| 09-05.T2 | 09-05 | 3 | REVMODE-04 | T-09-05-01..-07 | Locked allocate-if-absent; foreign-win renames; deadline degrade never blocks; hash-only warns; first txn writes key AND map | unit (GREEN) | `npx vitest run tests/state --project=unit` | ✅ from 09-05.T1 | ✅ green |
| 09-05.T3 | 09-05 | 3 | REVMODE-04 | — | Refactor (pure reconcile helper), export surface unchanged | unit | `npx vitest run tests/state --project=unit` | ✅ from 09-05.T1 | ✅ green |
| 09-06.T1 | 09-06 | 3 | REVMODE-07 | T-09-06-01, T-09-06-02, T-09-06-04 | RED gate: 7-reason matrix (retain 'resume' only; delete side incl. 'bypass_permissions_disabled' + unknown-future), key-first ordering, map-mtime-only aging pinned | unit (RED) | `npx vitest run tests/state/janitor.test.ts tests/hook/session-end.test.ts --project=unit` (expect FAIL — RED gate) | ✅ created (Wave 0) | ✅ green |
| 09-06.T2 | 09-06 | 3 | REVMODE-07 | T-09-06-01..-06 | Delete key-then-map; allowlist retention; TTL sweep at SessionStart + MCP boot non-fatal; handler never throws (no exit-2) | unit (GREEN) | `npx vitest run tests/state/janitor.test.ts tests/hook/session-end.test.ts tests/hook tests/mcp --project=unit` | ✅ from 09-06.T1 | ✅ green |
| 09-06.T3 | 09-06 | 3 | REVMODE-07 | — | Refactor (sweep classification helper), rules unchanged | unit | `npx vitest run tests/state/janitor.test.ts tests/hook/session-end.test.ts --project=unit` | ✅ from 09-06.T1 | ✅ green |
| 09-07.T1 | 09-07 | 4 | REVMODE-04, REVMODE-05 | T-09-07-01, T-09-07-02, T-09-07-04 | ONE locked txn per hook event (batched leaves); renames applied to wire output; drain-discard on dry_run/deny; facade errors never reach exit-2 | unit (task TDD) | `npx vitest run tests/hook/reversible-handlers.test.ts --project=unit` | ✅ created (Wave 0) | ✅ green |
| 09-07.T2 | 09-07 | 4 | REVMODE-02, REVMODE-05 | T-09-07-03 | Cold-path import-graph fence (state/proper-lockfile/wfa statically unreachable from hook graph); PostToolUse string shape unchanged (E1) | unit | `npx vitest run tests/hook/reversible-handlers.test.ts tests/state/cold-path.test.ts tests/hook --project=unit` | ✅ created (Wave 0) | ✅ green |
| 09-08.T1 | 09-08 | 5 | REVMODE-04 | T-09-08-01, T-09-08-05 | SC5 stress: 16 real procs, 0 lost / 0 NNN dups / 0 disagreements / 0 degrades (degrade-count assertion load-bearing) | integration | `npm run build && npx vitest run tests/state/stress.test.ts --project=integration` | ✅ created (Wave 0) | ✅ green |
| 09-08.T2 | 09-08 | 5 | REVMODE-02 | T-09-08-02, T-09-08-03 | Chaos one-way parity (6 corruption shapes, no throw/no deny); SC1 literal dir inspection (ciphertext-only, separate 0700 key dir, nothing in project tree) | unit | `npx vitest run tests/state/chaos.test.ts tests/state/inspection.test.ts --project=unit` | ✅ created (Wave 0) | ✅ green |
| 09-08.T3 | 09-08 | 5 | REVMODE-02 | T-09-08-04 | State-only doctor copy byte-locked; phase regression: zero-edit detection/placeholder/audit suites, coverage 80/80/75/70, 36-error typecheck baseline, dist as separate chore commit | unit + full suite | `npx vitest run tests/doctor/checks.test.ts --project=unit && npm test && npm run typecheck` | ✅ extend existing | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

All five phase requirements appear: REVMODE-02 (09-01.T1, 09-03.T1–T3, 09-07.T2, 09-08.T2/T3), REVMODE-04 (09-05.T1–T3, 09-07.T1, 09-08.T1), REVMODE-05 (09-04.T1–T3, 09-07.T1/T2), REVMODE-06 (09-02.T1–T3), REVMODE-07 (09-01.T2, 09-06.T1–T3).

---

## Wave 0 Requirements

- [x] `tests/state/` (new suite directory) — created RED-first inside owning plans: `secret-floor.test.ts` (09-02), `map-store.test.ts` (09-03), `tokens-v2.test.ts` (09-04), `lock.test.ts` + `allocation.test.ts` (09-05), `janitor.test.ts` (09-06), `cold-path.test.ts` (09-07), `chaos.test.ts` + `inspection.test.ts` (09-08)
- [x] `tests/hook/session-end.test.ts` (09-06) + `tests/hook/reversible-handlers.test.ts` (09-07) — new hook suites (vi.mock seam per `tests/hook/handlers.test.ts` precedent)
- [x] Multi-process stress harness fixture (SC5): `tests/state/fixtures/stress-worker.ts` + `tests/state/stress.test.ts` (09-08) — tsup TEST-ONLY entry `state-stress-worker` (detect-layer1 precedent); RESEARCH §Validation Architecture / Code Example 4 has the validated shape
- [x] No framework install needed — vitest projects already configured; `tests/state/**` routes to the unit project by default, with `tests/state/stress.test.ts` dual-listed (unit `exclude` / integration `include`) per 09-08 Task 1

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator inspection of `~/.mrclean/sessions/` shows ciphertext only | REVMODE-02 (SC1) | Human-eye acceptance framing in SC1; automated equivalent exists (`tests/state/inspection.test.ts`, 09-08.T2) so manual pass is a spot-check | `ls -la ~/.mrclean/sessions/ ~/.mrclean/keys/` during an enabled session; open a .map file — must be binary/ciphertext |

*All other phase behaviors have automated verification (incl. chmod/corrupt/absent-map chaos cases as unit tests per RESEARCH).*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-17

---

## Validation Audit 2026-07-17

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

Post-execution audit (State A). All 22 task rows re-verified against the live codebase:

- **Full suite:** `npm test` → **861 passed / 16 skipped (90 files), exit 0** — matches the post-phase baseline recorded in 09-VERIFICATION.md exactly (up from 642/14 pre-phase).
- **Wave 0 files:** all 13 planned test files exist on disk (`tests/state/` ×9 + `fixtures/stress-worker.ts`, `tests/hook/session-end.test.ts`, `tests/hook/reversible-handlers.test.ts`); RED gates were transient execution-time states recorded in plan SUMMARYs.
- **SC5 stress (09-08.T1):** `npx vitest run tests/state/stress.test.ts --project=integration` → 1/1 green, 2.84s.
- **Dep pins (09-01.T1):** `npm ls` resolves `proper-lockfile@4.1.2` + `write-file-atomic@7.0.1`; `@types/proper-lockfile@^4.1.4` in devDeps. wfa v7 types come from the deliberate local ambient decl `src/types/write-file-atomic.d.ts` (`@types/write-file-atomic` targets the v4 API — installing it would be wrong); map cell "types in devDeps" satisfied in spirit, no gap.
- **Typecheck (09-08.T3):** 38 errors — matches the *documented* baseline (36 cited in 09-08 plan + 2 pre-existing in `src/model/pipeline-singleton.ts` from an optionalDependency minor resolve, present at phase base commit, tracked in `deferred-items.md`). Zero errors in any phase 9 file, consistent with 09-VERIFICATION.md's independent reproduction.
- **Manual-only row (SC1 operator inspection):** unchanged — automated equivalent (`tests/state/inspection.test.ts`) green in suite; manual pass remains an optional spot-check.

Verdict: **Nyquist-compliant.** No test generation required; no auditor spawn needed.
