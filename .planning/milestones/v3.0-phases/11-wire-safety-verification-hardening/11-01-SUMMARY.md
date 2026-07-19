---
phase: 11-wire-safety-verification-hardening
plan: 01
subsystem: testing
tags: [dist-parity, spawn, reversible, wire-safety, vitest, revmode-11]
requires: [09-07, 09-08]
provides:
  - "SC1a shipped-bundle stdout parity gate: dist/cli.js spawned one-way vs reversible, deep-equal parsed stdout after v2 nonce-tail strip (the tier that caught the two 09-08 dist-only bugs)"
  - "vitest.config.ts dual-listing (unit exclude + integration include) with routing proven non-vacuous — unit run collects ZERO files"
affects: [11-06, phase-11-CI-elevation]
tech-stack:
  added: []
  patterns:
    - "dist-spawn parity: spawnSync(process.execPath, [DIST_CLI, 'hook']) twice with per-mode sandbox HOMEs (HOME + USERPROFILE both overridden), fresh randomUUID() sid per run"
    - "duplicate-don't-import constants (SECRET / V2_TAIL_RE / V2_TAIL_PROBE copied from chaos.test.ts with the 'duplicated, not re-derived' comment)"
    - "non-vacuity BEFORE absence assertion order: exit-0 → non-empty → no-canary → v2-probe-positive → v2-probe-negative → parity → map ciphertext → one-way state-free"
key-files:
  created:
    - tests/hook/dist-parity.test.ts
  modified:
    - vitest.config.ts
key-decisions:
  - "Single it-block carries all 8 assertions in the plan-pinned order (numbered comments (1)-(8)) — splitting into multiple its would either re-spawn per assertion or couple test order; the pinned ORDER is the contract"
  - "Payload cwd mirrors integration.test.ts's static '/tmp' exactly (per plan), not chaos's per-run tmp cwd — parity compares two runs under identical cwd, and audit output is not under test here"
  - "REQUIREMENTS.md deliberately untouched: all 7 phase-11 plans carry REVMODE-11; marking it complete after plan 01 alone would be premature and would race sibling wave agents on a shared orchestrator artifact"
metrics:
  duration: 10m
  tasks: 1
  files: 2
  completed: "2026-07-18"
---

# Phase 11 Plan 01: Dist-Spawn Parity Gate (SC1a) Summary

Deterministic CI leg for REVMODE-11's "hook stdout is unchanged by reversible mode": the SHIPPED dist/cli.js is spawned twice with the same canary-bearing PostToolUse payload (one-way HOME vs reversible HOME) and the parsed stdouts must be deep-equal after v2 nonce-tail normalization — with branch engagement proven by the v2 token probe BEFORE parity is asserted, zero canary on either stdout, ciphertext-only map bytes, and a state-free one-way home.

## What Was Built

### Task 1 — dist-parity gate + vitest.config dual-listing, one commit (528181a)

**`tests/hook/dist-parity.test.ts`** (209 lines, integration project only):

- **Spawn recipe** (integration.test.ts precedent): `spawnSync(process.execPath, [DIST_CLI, 'hook'], { input, encoding: 'utf8', timeout: 30_000, env: { ...process.env, HOME: home, USERPROFILE: home } })` — two `mkdtempSync` sandbox homes, the reversible one seeded with `.mrclean/config.toml` containing `[reversible]` / `enabled = true` (chaos `makeHome` recipe), the one-way one empty (shipped default needs no config).
- **Pinned constants duplicated, not re-derived** (chaos.test.ts discipline, comment in file): `SECRET = 'AKIAIOSFODNN7EXAMPLX'` (X suffix load-bearing — the AWS-docs EXAMPLE key is gitleaks-allowlisted), global `V2_TAIL_RE` for stripping, non-global `V2_TAIL_PROBE` for matching (`/g` carries lastIndex across toMatch calls).
- **Payload** = chaos `makeInput` shape (PostToolUse, Bash, `tool_response` embedding SECRET), fresh `randomUUID()` sid per run, `cwd: '/tmp'` mirroring integration.test.ts exactly.
- **All 8 assertions in the plan-pinned order** with numbered comments: (1) exit 0 both; (2) stdout non-empty both; (3) parse + raw-stdout canary absence both; (4) reversible matches `V2_TAIL_PROBE` (branch REALLY engaged); (5) one-way does NOT; (6) `stripNonceTails(parsedReversible)` toEqual `parsedOneway`; (7) `<homeRev>/.mrclean/sessions/<sidRev>.map` exists (path derived the way `map-store.ts` `mapPathFor` composes it) and `readFileSync` raw bytes lack SECRET; (8) one-way home has NO `sessions/` directory (REVMODE-05 byte-identical default).
- **No beforeAll build step** — the integration project's globalSetup owns the tsup build (stress.test.ts precedent); `beforeAll` appears only in the header comment explaining exactly this.
- **win32 visible skip**: `describe.skipIf(IS_WIN32)` main suite + `describe.skipIf(!IS_WIN32)` placeholder so the gap shows in reporter output (chaos WR-04 precedent — `os.homedir()` reads USERPROFILE and ignores $HOME on win32).

**`vitest.config.ts`** — exactly two new entries (11 inserted lines, nothing else): unit-project exclude + integration-project include for `tests/hook/dist-parity.test.ts`, each with a Plan 11-01 comment stating the non-vacuity reason (without the include, `--project=integration` reports zero files and exits 0; without the exclude, the unit glob `tests/**/*.test.ts` collects it against a possibly-stale dist).

## Routing Proofs (required by plan output spec)

**Integration leg — 1 file, green:**

```
 Test Files  1 passed (1)
      Tests  1 passed | 1 skipped (2)
   Duration  2.63s
```

(1 skipped = the win32 placeholder describe, visibly reported on darwin. globalSetup ran `npm run build` first — tsup rebuilt dist, ESM+DTS success.)

**Unit leg — ZERO files collected (exclude proven; this expected-vacuous outcome IS the routing proof):**

```
No test files found, exiting with code 0
filter: tests/hook/dist-parity.test.ts
projects: unit
exclude:  ..., 'tests/state/stress.test.ts', tests/hook/dist-parity.test.ts, 'tests/perf/**', ...
```

## Sabotage Spot-Check (10-07 discipline — required by acceptance criteria)

Temporarily removed the integration include entry from vitest.config.ts, re-ran the gate invocation:

```
$ npx vitest run tests/hook/dist-parity.test.ts --project=integration
No test files found, exiting with code 0
include: tests/install/**/*.test.ts, ..., tests/state/stress.test.ts, tests/perf/**/*.test.ts   ← dist-parity ABSENT
EXIT_CODE=0
```

The invocation reports zero files and **exits 0** — a silent vacuous pass of exactly the 10-07 kind. Restored the entry; re-run green (1 file, 1 passed / 1 skipped). The include entry is load-bearing; the hazard is real (T-11-01-01 mitigated).

## Verification Results

| Check | Result |
|-------|--------|
| `npx vitest run tests/hook/dist-parity.test.ts --project=integration` | 1 file passed (1 test passed, 1 win32 placeholder skipped) |
| `npx vitest run tests/hook/dist-parity.test.ts --project=unit` | "No test files found" — zero collected (exclude proven) |
| Full `npm test` | 102 files passed / 2 skipped; 963 tests passed / 19 skipped — green |
| `npm run typecheck` | 38 errors — identical to pre-change baseline; 0 mention dist-parity.test.ts |
| `git diff --stat 8f370b9 -- tests/hook` | ONLY `tests/hook/dist-parity.test.ts` (209 insertions) |
| `git diff --stat 8f370b9 -- src/hook src/detect src/placeholder tests/placeholder tests/detect` | empty (frozen-tree fence held) |
| `git status --porcelain dist/` at commit time | empty — worktree rebuild was byte-identical to committed dist; no dist path in the commit |
| Canary grep | `AKIAIOSFODNN7EXAMPLX` present; no EXAMPLE-suffixed string used as a detection positive |
| vitest.config.ts diff | exactly two new entries (one exclude, one include), 11 insertions, no other changes |

## Deviations from Plan

None — plan executed exactly as written.

Process note (not a deviation): REQUIREMENTS.md was left untouched. REVMODE-11 is carried by all 7 phase-11 plans; completing it belongs to the orchestrator at phase close, and per worktree policy shared orchestrator artifacts (STATE.md, ROADMAP.md) were not modified either.

## Known Stubs

None — test-only plan; no production code touched.

## Threat Flags

None — no new network/auth/file surface. All three threat-register mitigations implemented as specified: T-11-01-01 (dual-listing same-commit + unit zero-file negative control + sabotage check above), T-11-01-02 (assertion order pins the v2 probe BEFORE absence; raw-byte map read asserts ciphertext-only; canary is the pinned non-EXAMPLE marker), T-11-01-03 (mkdtempSync per-run HOMEs with HOME+USERPROFILE both overridden; cwd mirrors integration.test.ts; win32 visibly skipped).

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| 528181a | test | dist-spawn parity gate — reversible stdout deep-equals one-way after nonce strip (SC1a) |

## Self-Check: PASSED

- tests/hook/dist-parity.test.ts — FOUND
- vitest.config.ts (2 dist-parity entries) — FOUND
- .planning/phases/11-wire-safety-verification-hardening/11-01-SUMMARY.md — FOUND
- Commit 528181a — FOUND
