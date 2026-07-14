---
phase: 8
slug: contract-verification-reversible-plumbing
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-14
planned: 2026-07-14
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit + integration projects; `uat` project opt-in via MRCLEAN_UAT=1) |
| **Config file** | `vitest.config.ts` (unit parallel; integration owns globalSetup tsup --clean) |
| **Quick run command** | `npx vitest run --project=unit` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~60 seconds (full, incl. integration rebuild) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project=unit` + `npm run typecheck`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite green + `npm run test:coverage` green + one operator-consented UAT run recorded
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-T1 | 08-01 | 1 | REVMODE-02 (groundwork) | T-08-03 | Open `reason: string` absorbs any upstream SessionEnd reason (no type failure in fail-closed wrapper) | unit + typecheck | `npm run typecheck && npx vitest run --project=unit tests/config/` | ✅ extend | ⬜ pending |
| 08-01-T2 | 08-01 | 1 | REVMODE-02 (groundwork) | T-08-01 | Wrong-typed `[reversible].enabled` throws ConfigReadError (fail-closed, never coerces) | unit (RED) | `npx vitest run --project=unit tests/config/reader.test.ts tests/config/merge.test.ts` | ✅ extend | ⬜ pending |
| 08-01-T3 | 08-01 | 1 | REVMODE-02 (groundwork) | T-08-02 | Absent `[reversible]` ⇒ frozen `enabled:false` default ⇒ byte-identical shipped behavior | unit + full suite (GREEN) | `npm test && npm run typecheck` | ✅ existing suites ARE the proof | ⬜ pending |
| 08-02-T1 | 08-02 | 2 | REVMODE-07 (groundwork) | T-08-05, T-08-06 | Pure no-op SessionEnd handler (no config load/I/O — grep gate); unknown events still throw | unit | `npx vitest run --project=unit tests/hook/dispatcher.test.ts && ! grep -qE "loadEffectiveConfig\|node:fs" src/hook/handlers/session-end.ts` | ✅ extend | ⬜ pending |
| 08-02-T2 | 08-02 | 2 | REVMODE-07 (groundwork) | T-08-04 | Migration preserves foreign hooks byte-identical; exactly one _mrclean entry per event | unit/integration | `npx vitest run tests/install/settings.test.ts tests/install/idempotency.test.ts tests/install/uninstall-roundtrip.test.ts && npm test` | ✅ extend (v2.0-shaped fixture is new) | ⬜ pending |
| 08-03-T1 | 08-03 | 2 | REVMODE-12 (groundwork) | — | Doctor FAILs when SessionEnd registration is missing (5-event surface enforced) | unit | `npx vitest run --project=unit tests/doctor/checks.test.ts` | ✅ extend | ⬜ pending |
| 08-03-T2 | 08-03 | 2 | REVMODE-12 (groundwork) | T-08-08, T-08-10, T-08-11 | Reporting-only check: state-only details (no values), LOCKED exit map untouched, malformed config → SKIP not crash | unit + full suite | `npx vitest run --project=unit tests/doctor/checks.test.ts && npm test` | ✅ extend | ⬜ pending |
| 08-04-T1 | 08-04 | 3 | REVMODE-10 | T-08-12, T-08-13 | Sandbox isolation (never writes ~/.claude/settings.json); marker-only fixtures (secret-shape grep gate) | unit + typecheck + source grep | `npm run typecheck && npx vitest run --project=unit && ! grep -rqE "AKIA\|ghp_\|sk-ant" tests/uat/fixtures/` | ❌ Wave 0 — created by this task | ⬜ pending |
| 08-04-T2 | 08-04 | 3 | REVMODE-10 | T-08-14 | Record-don't-assert: contract verdicts recorded, only harness integrity hard-asserted | live UAT (opt-in, spends tokens) | `npm run build && MRCLEAN_UAT=1 npx vitest run --project=uat tests/uat/contract-verification.test.ts` + findings-schema node check | ❌ created by 08-04-T1 | ⬜ pending |
| 08-04-T3 | 08-04 | 3 | REVMODE-10 | T-08-15 | Interactive rendering observed against a /tmp isolated settings file, never the real config | checkpoint:human-verify + post-resume artifact check | `node -e "…experiments.E1.rendering…"` (see plan) | — (manual half) | ⬜ pending |
| 08-05-T1 | 08-05 | 4 | REVMODE-10 | T-08-18 | Every shipped claim version-stamped and traceable to contract-findings.json | unit + source assertions | `grep -q "verified on Claude Code" docs/HOOK-CONTRACT.md && npx vitest run --project=unit tests/doctor/version-check.test.ts && npm run typecheck` | ✅ extend (HOOK-CONTRACT.md new) | ⬜ pending |
| 08-05-T2 | 08-05 | 4 | REVMODE-10 | T-08-16 | Draft contains only public refs + marker strings | source assertions | `grep -q "18653" … && grep -q "68951" docs/upstream/display-only-channel-request.md` | ❌ new doc | ⬜ pending |
| 08-05-T3 | 08-05 | 4 | REVMODE-10 | T-08-17 | Operator files publicly (agent never runs `gh issue create`); URL greppable | checkpoint:human-action + grep | `grep -qE "github.com/anthropics/claude-code/issues/[0-9]+" docs/HOOK-CONTRACT.md` | — (manual half) | ⬜ pending |
| 08-06-T1 | 08-06 | 4 | REVMODE-03 | T-08-19, T-08-20, T-08-21 | Design-commitment framing; key-custody adversary classes named; drift-gated | unit (RED→GREEN, copy-drift precedent) | `npx vitest run --project=unit tests/copy-drift.test.ts` | ✅ extend | ⬜ pending |
| 08-06-T2 | 08-06 | 4 | REVMODE-03 | — | Stale return-path-restore wording amended in PROJECT.md + CLAUDE.md | source assertions | `! grep -q "round-trip cleanly back into the user's view" .planning/PROJECT.md CLAUDE.md` | ✅ files exist | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Existing suites are the byte-identical gate (SC2): full suite must pass unchanged with `[reversible]` absent — enforced per-plan (`npm test` in 08-01-T3, 08-02-T2, 08-03-T2)
- [x] Live contract experiments live in `tests/uat/` (UAT-2b precedent, opt-in, not CI-gating) — `tests/uat/contract-verification.test.ts` created by 08-04-T1 BEFORE the run task 08-04-T2
- [x] v2.0-shaped settings migration fixture — created by 08-02-T2 inside tests/install/settings.test.ts

*Existing infrastructure covers all phase requirements — no new framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Interactive terminal rendering of `updatedToolOutput` (E1 rendering half) | REVMODE-10 | TUI observation; PTY automation rejected (RESEARCH Don't Hand-Roll) | 08-04 Task 3 checkpoint — /tmp isolated settings + one interactive session; verdict recorded into contract-findings.json on resume |
| Upstream feature request filed | REVMODE-10 | Public post on the operator's GitHub account — never agent-filed | 08-05 Task 3 checkpoint — operator reviews draft, files via gh/web, URL recorded in docs/HOOK-CONTRACT.md |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (harness + migration fixture created before their consumers)
- [x] No watch-mode flags (all commands use `vitest run`)
- [x] Feedback latency < 120s (unit slices per task; full suite per wave)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner sign-off 2026-07-14 (6 plans, waves 1-4)
