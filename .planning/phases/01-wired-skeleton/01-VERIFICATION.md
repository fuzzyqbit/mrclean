---
phase: 01-wired-skeleton
verified: 2026-07-13T23:40:15Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 5/5
  gaps_closed:
    - "SC4/HOOK-05 fail-open at the spawn layer — deleting/renaming the mrclean hook bin silently disabled all protection (canary leaked). Closed by plan 01-06 (fail-closed POSIX /bin/sh wrapper via buildHookCommand) and live-confirmed by plan 01-07 (headless claude UAT-2b, user-approved)."
    - "Two prior human_verification items (live banner+MCP; live SC4 missing-bin block) automated via tests/uat/live-session.test.ts (UAT-1, UAT-2b) and executed live (2026-07-13, user-approved, 3/3 passed). 01-UAT.md status: resolved."
  gaps_remaining: []
  regressions: []
---

# Phase 1: Wired Skeleton Verification Report

**Phase Goal:** `npx mrclean install` lands a working hook + MCP server; "mrclean active" banner + green `mrclean doctor`. Establishes the persistent-MCP architecture, fail-closed exit semantics, and absolute-path resolution from day one so silent-misconfig and silent-MCP-crash cannot regress later.
**Verified:** 2026-07-13T23:40:15Z
**Status:** passed
**Re-verification:** Yes — after SC4/HOOK-05 gap closure (plans 01-06 + 01-07)

---

## Re-verification Context

The initial verification (2026-05-14) marked the phase `human_needed` — the live-Claude-session portions of SC1 (banner) and SC4 (missing-bin block) could not be automated at that time. A subsequent live UAT run (`tests/uat/live-session.test.ts`) then surfaced a real defect: on a **spawn failure** (missing/renamed mrclean bin), the installed hook `node <missing> hook` exited 1, which Claude Code treats as non-blocking — so the tool call silently passed through and the canary leaked. This broke SC4/HOOK-05 (fail-closed).

Two gap-closure plans followed:
- **01-06** — installer now writes a fail-closed POSIX `/bin/sh` wrapper via `buildHookCommand()` (`"$1" "$2" hook || exit 2`), remapping ANY inner failure to exit 2; doctor path-extraction realigned to the wrapper shape; UAT harness + tests synced to the shared wrapper.
- **01-07** — paid, user-gated live confirmation: `npm run test:uat` green (UAT-2b flipped), gap marked resolved.

This report re-verifies the closed gap with full 3-level + behavioral checks, and regression-checks the previously-passing criteria.

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | `npx mrclean install` → next `claude` session shows "mrclean active" via additionalContext + `mrclean` MCP connected | ✓ VERIFIED | Live install writes 4 hook events; SessionStart/UserPromptSubmit emit the banner via `hookSpecificOutput.additionalContext`. Doctor `hook-canary` PASS ("wiring banner present"). Live UAT-1 (2026-07-13, user-approved) confirmed the model quotes the long-form banner back and `mcp_servers[mrclean].status === "connected"`. |
| SC2 | `npx mrclean doctor` returns green PASS (canary round-trip + version compat) | ✓ VERIFIED | Independently reproduced: fresh install (with `~/.claude` present) → `doctor` exits **0** with 6× [PASS] (hooks, mcp, bins, hook-canary, mcp-canary, config-load) + [green] version line. (7th check `model-cache` is a v2.0 PII opt-in SKIP, not a Phase-1 check.) |
| SC3 | `install` ×2 + `uninstall` → settings.json + .claude.json byte-identical to pre-install backup | ✓ VERIFIED | Regression-confirmed via full suite (idempotency + uninstall-roundtrip suites green). Surgical marker-based removal; oldest-backup restoration. |
| SC4 | Missing/broken hook bin → next tool call blocked (exit 2), no silent pass-through | ✓ VERIFIED | **Gap closed.** Independently reproduced the `/bin/sh` wrapper: missing bin → exit 2 (BLOCK); pass → exit 0 (stdout JSON survives); inner exit 2 → exit 2 (crash-guard preserved); injection path (`x; touch PWNED #.js`) → no command executed, exit 2. Installed `settings.json` carries the exact wrapper. Live UAT-2b (user-approved) confirmed canary `UAT_CANARY_7Q3X.txt` never reaches the model reply or raw stdout. |
| SC5 | `.mrclean/` exists after install with project-root `.gitignore` entry; `git status` clean | ✓ VERIFIED | Regression-confirmed via full suite (install/gitignore + doctor end-to-end suites green). |

**Score:** 5/5 truths verified. The previously-pending live-session portions of SC1 and SC4 are now automated (UAT-1/UAT-2b) and executed live with recorded passing evidence.

---

### Required Artifacts (gap-closure focus + regression)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/install/settings.ts` | `buildHookCommand()` fail-closed wrapper; `writeHookEntries` uses & exports it | ✓ VERIFIED | POSIX branch returns `command:/bin/sh, args:['-c','"$1" "$2" hook \|\| exit 2','mrclean-hook',node,bin], timeout:10`. win32 branch = plain exec form (documented known-gap). `writeHookEntries` calls `buildHookCommand(nodePath, mrcleanBinPath)` at line 143; `_mrclean` marker stays on the outer entry (idempotency intact). Not in typecheck error list — type-clean. |
| `src/doctor/checks.ts` | Path extraction realigned to wrapper arg tail + fail-closed bins messaging | ✓ VERIFIED | `extractHookNodeAndBin()` reads `node=args[len-2]`, `bin=args[len-1]` for the wrapper shape, with `.js`-at-args[0] legacy/win32 fallback. bins-FAIL detail states the fail-closed block-until-reinstall consequence. |
| `dist/cli.js` / `dist/mcp.js` | Shipped artifacts carry the wrapper | ✓ VERIFIED | `dist/cli.js` contains `buildHookCommand` (×2) and the exact string `"$1" "$2" hook \|\| exit 2`. Confirmed the installed `settings.json` emits the wrapper shape from the shipped bin. No uncommitted dist drift (git clean except unrelated `.planning/config.json`). |
| `tests/install/settings.test.ts` | Deterministic exit-code remap proof (spawnSync) + migration test | ✓ VERIFIED | `spawnSync` remap suite present; 61 tests pass across settings/doctor/idempotency run. |
| `tests/uat/live-session.test.ts` | UAT harness reads the shared wrapper (single source of truth) | ✓ VERIFIED | Imports `buildHookCommand` from `src/install/settings.js` (line 39); `buildHookSettings(missingBin)` for the broken variant; asserts `CANARY_FILE` in NEITHER `resultText` NOR `rawStdout`. Genuine end-to-end `claude -p` harness — not a stub. |
| `.planning/phases/01-wired-skeleton/01-UAT.md` | Gap marked resolved after live confirmation | ✓ VERIFIED | Frontmatter `status: resolved`; all 3 tests `result: pass`; Gaps entry flipped `failed → resolved` with 01-06/01-07 traceability; Summary `passed: 3 / issues: 0`. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/install/settings.ts:writeHookEntries` | settings.json hook command | `buildHookCommand(nodePath, mrcleanBinPath)` | ✓ WIRED | Called at line 143; installed settings.json confirmed to carry the wrapper. |
| `src/doctor/checks.ts:extractHookNodeAndBin` | the wrapper shape buildHookCommand writes | reads node+bin from arg tail | ✓ WIRED | Doctor `bins` PASS on the wrapper-shaped install ("all 2 registered binary path(s) are executable"). |
| `tests/uat/live-session.test.ts:buildHookSettings` | `src/install/settings.ts:buildHookCommand` | import (single source of truth) | ✓ WIRED | UAT-2b exercises the exact shipped wrapper, not a hand-built copy. |
| installed `/bin/sh` wrapper | Claude Code hook runtime | `"$1" "$2" hook \|\| exit 2` (exit-2 → BLOCK) | ✓ WIRED | Independently reproduced exit-2-on-failure; live UAT-2b confirmed Claude Code blocks. |

---

### Behavioral Spot-Checks (independently executed by verifier)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Fail-closed: missing bin → BLOCK | `/bin/sh -c '"$1" "$2" hook \|\| exit 2' mrclean-hook <node> /nonexistent.js` | exit **2** | ✓ PASS |
| Pass-through: bin exits 0, stdout survives | wrapper over stub emitting `{permissionDecision:"allow"}` then exit 0 | exit **0**, stdout = JSON intact | ✓ PASS |
| Crash-guard preserved: bin exits 2 | wrapper over stub `process.exit(2)` | exit **2** | ✓ PASS |
| Injection-safe path | wrapper over bin path `x; touch PWNED #.js` | exit 2, **PWNED not created** | ✓ PASS |
| Fresh install lands wrapper | `mrclean install` (with `~/.claude` present) | exit 0; PreToolUse hook = `/bin/sh -c '"$1" "$2" hook \|\| exit 2' … <node> <cli.js>` | ✓ PASS |
| Doctor green | `mrclean doctor` (fake version) | 6×[PASS] + [green] version, exit **0** | ✓ PASS |
| Full non-UAT suite | `npm test` | **76 files / 588 tests passed, 1 file / 3 tests skipped** | ✓ PASS |

---

### Probe / Live-UAT Execution

The phase-declared "probe" is the opt-in live UAT (`npm run test:uat`, `MRCLEAN_UAT=1`), which spawns real headless `claude -p` sessions and spends Haiku tokens. It is a **blocking human-verify checkpoint** (security gate, not auto-runnable) and was executed once, user-approved, on 2026-07-13.

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Deterministic wrapper proof | `npx vitest run tests/install/settings.test.ts tests/doctor/ tests/install/idempotency.test.ts` | 61 passed | ✓ PASS (verifier-run) |
| Live UAT-1/2a/2b | `npm run test:uat` (opt-in, gated) | 3/3 passed, 7.47s (2026-07-13, user-approved) | ✓ PASS (recorded evidence, not re-run) |

Note: the verifier did **not** re-run the paid/gated live UAT (requires an authenticated `claude` CLI and token spend; per project memory it must not be auto-run). Instead the underlying deterministic mechanism was independently reproduced (rows above) and the installed artifact confirmed to carry the wrapper; the live-platform behavior (Claude Code blocks on exit 2) rests on the user-approved 01-07 run recorded in 01-UAT.md.

---

### Requirements Coverage (gap-closure IDs)

| Requirement | Plan | Description | Status | Evidence |
|-------------|------|-------------|--------|----------|
| HOOK-05 | 01-06, 01-07 | Hook fails closed — exit 2 on any failure rather than passing the payload through | ✓ SATISFIED | Fail-closed `/bin/sh` wrapper independently reproduced (missing bin → 2); live UAT-2b confirmed. Marked `[x] Complete` in v2.0-REQUIREMENTS.md (line 65, 212). |
| INST-01 | 01-06 | `npx mrclean install` writes working hook + MCP wiring, no further config | ✓ SATISFIED | Live install → 4 hooks + MCP registered; doctor 6×PASS. **Doc-sync note:** v2.0-REQUIREMENTS.md line 183 still lists INST-01 as "Pending" though the phase is Complete — informational only, code satisfies it. |

(Full Phase-1 requirement set INST-01..08, HOOK-01/05/06/07, MCP-01/04, AUDIT-03, CFG-01/03 was verified SATISFIED in the initial report and regression-confirmed by the green 588-test suite.)

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| gap-closure files | — | TBD/FIXME/XXX debt markers | ✓ none | `src/install/settings.ts`, `src/doctor/checks.ts`, and all touched test files scanned clean. |
| `src/doctor/checks.ts` | ~333 | Bins-FAIL message hardcodes POSIX fail-closed wording on all platforms (review WR-01) | ⚠️ WARNING | A win32 operator with a deleted bin is told tool calls are BLOCKED when win32 is fail-OPEN — a message that over-reassures on the deprioritized platform. Does not affect POSIX (primary) protection. |
| `src/doctor/checks.ts` | 74-95 | `.js` filename discriminator, not command shape (review WR-02) | ⚠️ WARNING | Latent trap if bin ever ships non-`.js`; correct today (always `dist/cli.js`). |
| `tests/install/settings.test.ts` | — | Injection/space/stdin guarantees asserted in prose, not deterministic tests (review WR-03) | ⚠️ WARNING | A refactor to string-interpolation could reintroduce injection and pass the current suite. Verifier independently confirmed injection-safety holds today. |
| `src/audit`, `src/detect/*`, `src/doctor/{bench,version-check}.ts`, several test files | — | `npm run typecheck` fails (~24 errors) | ⚠️ WARNING | **Not in gap-closure files.** Mostly v2.0/Phase-2+ code + pre-noted `noUncheckedIndexedAccess` false positives. Build (esbuild) succeeds; all 588 tests pass. Pre-existing, broader code-quality issue. |
| `src/install/index.ts` | — | Installer does not `mkdir ~/.claude` — ENOENT if it doesn't exist | ℹ️ INFO | On a truly-fresh HOME lacking `~/.claude/`, `mrclean install` crashes with ENOENT. In practice Claude Code owns/creates `~/.claude/`, so the assumption holds when mrclean is installed alongside it. Not introduced by the gap closure; present at initial verification (tests pre-create `.claude`). Worth revisiting against the "zero-config first run" constraint. |
| `src/install/settings.ts` | 84-93 | win32 fail-OPEN on spawn failure | ℹ️ INFO | Documented, accepted known-gap (untested cmd.exe wrapper deprioritized). POSIX is the fail-closed path. |

---

### Human Verification Required

None outstanding. The two live-session items from the initial verification (banner+MCP; missing-bin block) have been **automated** (`tests/uat/live-session.test.ts` UAT-1/UAT-2b) and **executed live with user approval** (2026-07-13, 3/3 passed), recorded as `resolved` in 01-UAT.md. Re-opening them would loop an already-satisfied, user-approved gate.

---

### Gaps Summary

**No blocking gaps.** The SC4/HOOK-05 fail-open hole that triggered this re-verification is genuinely closed — verified three ways beyond the SUMMARY claims:

1. **Source + shipped artifact:** `buildHookCommand()` fail-closed wrapper exists in `src/install/settings.ts`, is called by `writeHookEntries`, and is present in the shipped `dist/cli.js`.
2. **Installed reality:** a live `mrclean install` writes the exact `/bin/sh -c '"$1" "$2" hook || exit 2'` wrapper into `settings.json`; `doctor` reads it back green (exit 0).
3. **Independent behavioral reproduction:** the verifier ran the wrapper argv directly — missing bin → exit 2, pass → exit 0 (stdout intact), crash → exit 2, injection → no execution.

All 5 ROADMAP success criteria are observably achieved on the primary (POSIX) platform; the full non-UAT suite is green (588 passed) with no regressions; the live UAT is user-approved and resolved.

**Non-blocking follow-ups (WARNING/INFO — not required for phase goal):**
- WR-01: branch the doctor bins-FAIL message by platform so win32 stops falsely reporting fail-closed.
- WR-02: discriminate the doctor path-extraction on command shape (`/bin/sh` + `-c`) rather than the `.js` extension.
- WR-03: add deterministic injection/space/stdin tests to guard the security properties against future refactors.
- `npm run typecheck` (~24 errors, mostly v2.0 code) should be brought green; the build/tests are unaffected.
- Consider `mkdir -p ~/.claude` in the installer (or a clearer error) for a truly-fresh HOME.
- Doc-sync: flip INST-01 to Complete in v2.0-REQUIREMENTS.md (line 183).
- win32 fail-open remains an accepted known-gap.

---

_Verified: 2026-07-13T23:40:15Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification after gap closure (plans 01-06 + 01-07)_
