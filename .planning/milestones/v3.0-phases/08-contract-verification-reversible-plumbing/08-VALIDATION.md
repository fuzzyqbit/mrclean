---
phase: 8
slug: contract-verification-reversible-plumbing
status: audited
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-14
planned: 2026-07-14
audited: 2026-07-17
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
| **Estimated runtime** | ~24 seconds (full, incl. integration rebuild; measured 2026-07-17) |

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
| 08-01-T1 | 08-01 | 1 | REVMODE-02 (groundwork) | T-08-03 | Open `reason: string` absorbs any upstream SessionEnd reason (no type failure in fail-closed wrapper) | unit + typecheck | `npm run typecheck && npx vitest run --project=unit tests/config/` | ✅ | ✅ green |
| 08-01-T2 | 08-01 | 1 | REVMODE-02 (groundwork) | T-08-01 | Wrong-typed `[reversible].enabled` throws ConfigReadError (fail-closed, never coerces) | unit (RED) | `npx vitest run --project=unit tests/config/reader.test.ts tests/config/merge.test.ts` | ✅ | ✅ green |
| 08-01-T3 | 08-01 | 1 | REVMODE-02 (groundwork) | T-08-02 | Absent `[reversible]` ⇒ frozen `enabled:false` default ⇒ byte-identical shipped behavior | unit + full suite (GREEN) | `npm test && npm run typecheck` | ✅ | ✅ green |
| 08-02-T1 | 08-02 | 2 | REVMODE-07 (groundwork) | T-08-05, T-08-06 | Pure no-op SessionEnd handler (no config load/I/O — grep gate); unknown events still throw | unit | `npx vitest run --project=unit tests/hook/dispatcher.test.ts && ! grep -qE "loadEffectiveConfig\|node:fs" src/hook/handlers/session-end.ts` | ✅ | ✅ green |
| 08-02-T2 | 08-02 | 2 | REVMODE-07 (groundwork) | T-08-04 | Migration preserves foreign hooks byte-identical; exactly one _mrclean entry per event | unit/integration | `npx vitest run tests/install/settings.test.ts tests/install/idempotency.test.ts tests/install/uninstall-roundtrip.test.ts && npm test` | ✅ | ✅ green |
| 08-03-T1 | 08-03 | 2 | REVMODE-12 (groundwork) | — | Doctor FAILs when SessionEnd registration is missing (5-event surface enforced) | unit | `npx vitest run --project=unit tests/doctor/checks.test.ts` | ✅ | ✅ green |
| 08-03-T2 | 08-03 | 2 | REVMODE-12 (groundwork) | T-08-08, T-08-10, T-08-11 | Reporting-only check: state-only details (no values), LOCKED exit map untouched, malformed config → SKIP not crash | unit + full suite | `npx vitest run --project=unit tests/doctor/checks.test.ts && npm test` | ✅ | ✅ green |
| 08-04-T1 | 08-04 | 3 | REVMODE-10 | T-08-12, T-08-13 | Sandbox isolation (never writes ~/.claude/settings.json); marker-only fixtures (secret-shape grep gate) | unit + typecheck + source grep | `npm run typecheck && npx vitest run --project=unit && ! grep -rqE "AKIA\|ghp_\|sk-ant" tests/uat/fixtures/` | ✅ | ✅ green |
| 08-04-T2 | 08-04 | 3 | REVMODE-10 | T-08-14 | Record-don't-assert: contract verdicts recorded, only harness integrity hard-asserted | live UAT (opt-in, spends tokens) | `npm run build && MRCLEAN_UAT=1 npx vitest run --project=uat tests/uat/contract-verification.test.ts` + findings-schema node check | ✅ | ✅ green (live 2026-07-14, rerun via 08-09: 11/11) |
| 08-04-T3 | 08-04 | 3 | REVMODE-10 | T-08-15 | Interactive rendering observed against a /tmp isolated settings file, never the real config | checkpoint:human-verify + post-resume artifact check | `node -e "…experiments.E1.rendering…"` (see plan) | ✅ | ✅ green (resolved 2026-07-14, verdict in contract-findings.json) |
| 08-05-T1 | 08-05 | 4 | REVMODE-10 | T-08-18 | Every shipped claim version-stamped and traceable to contract-findings.json | unit + source assertions | `grep -q "verified on Claude Code" docs/HOOK-CONTRACT.md && npx vitest run --project=unit tests/doctor/version-check.test.ts && npm run typecheck` | ✅ | ✅ green |
| 08-05-T2 | 08-05 | 4 | REVMODE-10 | T-08-16 | Draft contains only public refs + marker strings | source assertions | `grep -q "18653" … && grep -q "68951" docs/upstream/display-only-channel-request.md` | ✅ | ✅ green |
| 08-05-T3 | 08-05 | 4 | REVMODE-10 | T-08-17 | Operator authorizes public filing (executor agent never runs `gh issue create`); URL greppable | checkpoint:human-action + grep | `grep -qE "github.com/anthropics/claude-code/issues/[0-9]+" docs/HOOK-CONTRACT.md` | ✅ | ✅ green (filed as anthropics/claude-code#77587, 2026-07-14) |
| 08-06-T1 | 08-06 | 4 | REVMODE-03 | T-08-19, T-08-20, T-08-21 | Design-commitment framing; key-custody adversary classes named; drift-gated | unit (RED→GREEN, copy-drift precedent) | `npx vitest run --project=unit tests/copy-drift.test.ts` | ✅ | ✅ green |
| 08-06-T2 | 08-06 | 4 | REVMODE-03 | — | Stale return-path-restore wording amended in PROJECT.md + CLAUDE.md | source assertions | `! grep -q "round-trip cleanly back into the user's view" .planning/PROJECT.md CLAUDE.md` | ✅ | ✅ green |

### Gap-Closure Plans (08-07 … 08-12, added post-review/UAT — audited 2026-07-17)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-07-T1 | 08-07 | 5 | REVMODE-02 (CR-01 fix) | T-08-07-01/-02/-03 | User-layer `[reversible]`/`[pii.*]` opt-ins survive partial project tables; parsed layers are true Partials | unit (RED: G/H/I/J + guard K) | `npx vitest run --project=unit tests/config/` | ✅ | ✅ green |
| 08-07-T2 | 08-07 | 5 | REVMODE-02 (CR-01 fix) | T-08-07-01 | mergeConfigs fills defaults from accumulated value only; validator bodies DEFAULT_CONFIG-free | unit (GREEN) + sed/grep gate | `npx vitest run --project=unit tests/config/ && sed -n '/^function validate/,/^}/p' src/config/index.ts \| grep -c DEFAULT_CONFIG` (expect 0) | ✅ | ✅ green |
| 08-08-T1 | 08-08 | 6 | REVMODE-10 | T-08-08-01 | Guarded findings builder: null on zero verdicts, verbatim carry-forward — a broken run cannot clobber contract-findings.json | unit offline (TDD, no tokens) | `npx vitest run --project=uat tests/uat/findings-builder.test.ts` | ✅ | ✅ green |
| 08-08-T2 | 08-08 | 6 | REVMODE-10 | T-08-08-02/-03 | Object-shape legs (E1/Bash-object, E1/Read-object, object-gated E4) committed + fixtures marker-only; skipped run leaves artifact byte-identical | opt-in harness + artifact gate | `npx vitest run --project=uat tests/uat/contract-verification.test.ts` (no MRCLEAN_UAT → all skipped) `&& git diff --stat tests/uat/artifacts/` (empty) | ✅ | ✅ green |
| 08-09-T1 | 08-09 | 7 | REVMODE-10 | T-08-09-01/-02/-04 | Live E4 settle (cap does NOT bind ~15K object payload) + curated E1 evidence survives regeneration (guarded-writer live proof) | live UAT (opt-in, spends tokens) | `MRCLEAN_UAT=1 npx vitest run --project=uat tests/uat/contract-verification.test.ts` + node artifact-integrity gate | ✅ | ✅ green (live 2026-07-14, 11/11, integrity gate exit 0) |
| 08-09-T2 | 08-09 | 7 | REVMODE-10 | T-08-09-01 | HOOK-CONTRACT verdicts byte-match artifact; stale "unanswerable"/"rerun deferred"/"UNTESTED" gone | source greps | `! grep -q "unanswerable" docs/HOOK-CONTRACT.md && ! grep -q "rerun deferred" docs/HOOK-CONTRACT.md && grep -q "e4-object-large-output-hook" docs/HOOK-CONTRACT.md` | ✅ | ✅ green |
| 08-10-T1 | 08-10 | 8 | REVMODE-10 | T-08-10-02 | Partial-rerun tests carry POPULATED previous E1.tools fixture (closes vacuous-pass hole) | unit offline (RED) | `npx vitest run --project=uat tests/uat/findings-builder.test.ts` | ✅ | ✅ green |
| 08-10-T2 | 08-10 | 8 | REVMODE-10 | T-08-10-01 | buildE1 per-tool carry-forward (fresh → previous → stub); verdict derived from MERGED map — partial rerun cannot destroy committed evidence | unit offline (GREEN) | `npx vitest run --project=uat tests/uat/findings-builder.test.ts` (9/9) | ✅ | ✅ green |
| 08-11-T1 | 08-11 | 8 | REVMODE-10 | T-08-08-01 (WR-01) | Record-nothing gates: filtered reruns leave e4Record/shapeValidationRecord undefined (no fabricated verdicts) | opt-in harness + comment-filtered greps | `npx vitest run --project=uat tests/uat/contract-verification.test.ts` (no MRCLEAN_UAT) + `git status --porcelain tests/uat/artifacts/` (empty) | ✅ | ✅ green |
| 08-11-T2 | 08-11 | 8 | REVMODE-03, REVMODE-10 | T-08-09-01 (WR-03) | Every session UUID quoted in HOOK-CONTRACT.md exists in the committed artifact | node trace scan | UUID regex extract → subset-of-artifact assertion (0 untraced) | ✅ | ✅ green |
| 08-11-T3 | 08-11 | 8 | REVMODE-03, REVMODE-10 | — | Permanent offline UUID-traceability gate with non-vacuity floor + fabricated-UUID positive control | unit | `npx vitest run --project=unit tests/copy-drift.test.ts` (15) | ✅ | ✅ green |
| 08-12-T1 | 08-12 | 9 | REVMODE-07 (groundwork) | — (08-UAT gaps 1+2) | Fresh-HOME ENOENT + stale `hooks: 4` banner reproduced offline (RED) | unit/integration (RED) | `npx vitest run tests/install/atomic-json.test.ts tests/install/fresh-home.test.ts tests/install/idempotency.test.ts` | ✅ | ✅ green |
| 08-12-T2 | 08-12 | 9 | REVMODE-07 (groundwork) | — | atomicWriteJson mkdirs parent chain (every JSON writer fresh-HOME safe); banner count derives from HOOK_EVENTS.length, locked to on-disk ground truth | integration (GREEN) + greps | same suite + `grep -c "HOOK_EVENTS.length" src/install/index.ts` (1) `&& ! grep -q "hooks: 4" src/install/index.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Existing suites are the byte-identical gate (SC2): full suite must pass unchanged with `[reversible]` absent — enforced per-plan (`npm test` in 08-01-T3, 08-02-T2, 08-03-T2)
- [x] Live contract experiments live in `tests/uat/` (UAT-2b precedent, opt-in, not CI-gating) — `tests/uat/contract-verification.test.ts` created by 08-04-T1 BEFORE the run task 08-04-T2
- [x] v2.0-shaped settings migration fixture — created by 08-02-T2 inside tests/install/settings.test.ts

*Existing infrastructure covers all phase requirements — no new framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions | Resolution |
|----------|-------------|------------|-------------------|------------|
| Interactive terminal rendering of `updatedToolOutput` (E1 rendering half) | REVMODE-10 | TUI observation; PTY automation rejected (RESEARCH Don't Hand-Roll) | 08-04 Task 3 checkpoint — /tmp isolated settings + one interactive session; verdict recorded into contract-findings.json on resume | ✅ RESOLVED 2026-07-14 — operator-delegated one-off PTY observation; verdict + shape-validation discovery recorded in `experiments.E1.rendering` / `experiments.E1_shape_validation`; survived 08-09 regeneration (guarded-writer carry-forward, integrity gate exit 0) |
| Upstream feature request filed | REVMODE-10 | Public post on the operator's GitHub account — never agent-filed | 08-05 Task 3 checkpoint — operator reviews draft, files via gh/web, URL recorded in docs/HOOK-CONTRACT.md | ✅ RESOLVED 2026-07-14 — operator authorized gh CLI filing; filed as anthropics/claude-code#77587; URL grep gate green |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (harness + migration fixture created before their consumers)
- [x] No watch-mode flags (all commands use `vitest run`)
- [x] Feedback latency < 120s (unit slices per task; full suite per wave)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner sign-off 2026-07-14 (6 plans, waves 1-4)

---

## Validation Audit 2026-07-17

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

**Scope:** retroactive Nyquist audit after phase completion (12 plans executed — 6 original + 6 gap-closure from 08-REVIEW/08-UAT/08-VERIFICATION findings).

**Findings:**

- All 16 original map rows verified ✅ green: every claimed test file exists on disk (17 files + 6 fixtures), 12/12 acceptance grep gates PASS, full suite **861 passed / 16 skipped / 0 failed, exit 0** (2026-07-17; skips = opt-in UAT gate + pre-existing).
- Plans 08-07 … 08-12 were absent from the plan-time map (added mid-phase as gap-closure). 13 rows added above — every one covered by committed TDD tests, currently green. No test generation needed.
- Both manual-only items resolved with durable recorded evidence (see Resolution column).
- Requirement coverage: REVMODE-03 complete (08-06, 08-11); REVMODE-10 complete (08-04/05/08/09/10/11); REVMODE-02/-07/-12 groundwork clauses all test-locked, completion correctly deferred to Phases 9/10 per traceability.
- Typecheck: 38 errors vs the documented 36-error baseline (deferred-items.md). The +2 delta is `src/model/pipeline-singleton.ts` (TS2578 unused `@ts-expect-error` + widened quantization union) — file untouched since Phase 6 (e9d9f51); flavor is dependency type-def drift, **not** attributable to any Phase 8 commit (all Phase 8 differential gates held at zero new errors). Disposition: belongs to the existing repo-wide typecheck-restoration deferred item, not a Phase 8 gap.

**Verdict:** Phase 8 is Nyquist-compliant — every requirement clause has automated verification; the two operator-gated verifications are resolved and evidence-locked by offline gates (UUID traceability, artifact-integrity checks, copy-drift suite).
