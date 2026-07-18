---
phase: 11-wire-safety-verification-hardening
plan: 08
subsystem: testing
tags: [vitest, uat, wire-safety, hook-contract, claude-code-cli, gap-closure]

# Dependency graph
requires:
  - phase: 11 (plan 05)
    provides: the live wire-safety UAT harness (tests/uat/wire-safety.test.ts) and its grepProjectsTreeForCanaries absence assertion, which this plan fixes a false-positive in
provides:
  - grepProjectsTreeForCanaries scoped to wire-mirrored type:user/assistant tool_result/tool_use content instead of raw whole-file bytes, with regression + non-vacuity fixture proof
  - bareModeArgs() in tests/uat/harness.ts — opt-in, OAuth-safe --bare plugin isolation for the SC1b live chain
  - Corrected ROADMAP.md SC1 wording and docs/HOOK-CONTRACT.md Evidence section separating the outbound-wire surface from the local ~/.claude/projects transcript-tree surface
affects: [future MRCLEAN_UAT=1 live wire-safety re-runs, any future phase touching tests/uat/harness.ts or tests/uat/wire-safety.test.ts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scoped-record grep: absence assertions over a transcript tree extract the wire-mirrored surface (tool_result/tool_use content) via a shared helper instead of raw whole-file byte matching, so non-wire hook bookkeeping (hook_success attachments) can't false-positive the check"
    - "Opt-in environment-gated isolation: bareModeArgs() only activates --bare when ANTHROPIC_API_KEY is already present, keeping OAuth-authenticated runs unaffected — isolation is best-effort, never a hard requirement"

key-files:
  created: []
  modified:
    - tests/uat/wire-safety.test.ts
    - tests/uat/harness.ts
    - .planning/ROADMAP.md
    - docs/HOOK-CONTRACT.md

key-decisions:
  - "Split Task 1 into a true RED (test) commit followed by a GREEN (feat) commit rather than one combined commit, honoring the task's tdd=true frontmatter even though the plan's single <action> block described both the hoist and the scoping fix together"
  - "grepProjectsTreeForCanaries reuses extractTranscriptToolData per-file inside its own try/catch, preserving the original tolerant-read-failure behavior while switching the check surface from raw bytes to wire-mirrored tool_result/tool_use content"
  - "HOOK-CONTRACT.md's new Evidence paragraph was reflowed onto single lines around the required literal phrases (\"ambient, globally-installed user-scope plugin hooks\") after a first pass wrapped the phrase across a markdown line break and silently failed the grep -F acceptance check"

requirements-completed: [REVMODE-11]

# Metrics
duration: 12min
completed: 2026-07-18
---

# Phase 11 Plan 08: SC1b False-Positive Fix + Wire-vs-Transcript-Tree Documentation Summary

**Scoped `grepProjectsTreeForCanaries` to wire-mirrored `tool_result`/`tool_use` records (killing a false-positive on third-party `hook_success` transcript attachments) and added opt-in `--bare` plugin isolation plus corrected wire-vs-transcript-tree wording in ROADMAP.md and HOOK-CONTRACT.md.**

## Performance

- **Duration:** ~12 min (base commit 10:07:18 → final task commit 10:18:40)
- **Started:** 2026-07-18T10:07:18-04:00
- **Completed:** 2026-07-18T10:18:40-04:00
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `grepProjectsTreeForCanaries` (hoisted to module scope in `tests/uat/wire-safety.test.ts`) now checks canary strings only inside the `tool_result`/`tool_use` content of `type:"user"`/`"assistant"` transcript records, via the existing `extractTranscriptToolData` helper — not raw whole-file bytes. It takes an optional `projectsDirOverride` for fixture testing while defaulting to the real `~/.claude/projects` when omitted.
- Two new token-free fixture tests prove the fix is neither too loose nor too strict: a fixture reproducing the exact sc1b false-positive shape (a `type:"attachment"`/`hook_success` record with a raw canary in `attachment.stdout`) no longer throws, and a fixture reproducing a genuine wire-mirrored `tool_result` leak still throws.
- `tests/uat/harness.ts` gained `bareModeArgs()` and `RunClaudeOptions.isolatePlugins` — an opt-in, OAuth-safe mechanism to pass `--bare` to the sandboxed `claude` CLI, isolating ambient globally-installed user-scope plugin hooks from the SC1b live chain without ever breaking OAuth-authenticated runs (gated strictly on `ANTHROPIC_API_KEY` presence).
- `.planning/ROADMAP.md`'s Phase 11 SC1 line and `docs/HOOK-CONTRACT.md`'s Evidence section now explicitly separate the outbound-wire surface (fully controlled by mrclean's hook) from the local `~/.claude/projects` transcript tree (a broader surface that also archives non-wire hook-bookkeeping attachments from any hook bound to an event).

## Task Commits

Each task was committed atomically. Task 1 (`tdd="true"`) produced a true RED→GREEN pair rather than a single combined commit:

1. **Task 1a (RED): failing regression/non-vacuity fixtures** - `2c8eee9` (test) — hoisted the helpers and new fixture tests while temporarily keeping the old raw whole-file-byte grep body; `regression-fixture` failed as expected (proving the bug), `positive-control` already passed.
2. **Task 1b (GREEN): scope the scan to wire-mirrored content** - `1d8155d` (feat) — rewrote the internal scan to use `extractTranscriptToolData`; both fixture tests pass, `wire-safety deterministic guards` suite green.
3. **Task 2: `--bare` plugin isolation + ROADMAP.md/HOOK-CONTRACT.md wording** - `782bc64` (feat) — `bareModeArgs()`, `isolatePlugins` wiring into 3 `runClaude` calls, `bareModeArgs` unit test, ROADMAP.md SC1 line, HOOK-CONTRACT.md Evidence paragraph.

**Plan metadata:** this SUMMARY.md commit (below).

## Files Created/Modified

- `tests/uat/wire-safety.test.ts` - Hoisted `ContentBlock`/`blocksOf`/`TranscriptToolData`/`extractTranscriptToolData`/`grepProjectsTreeForCanaries` to module scope; rescoped the canary check; added `regression-fixture`, `positive-control`, and `bareModeArgs` tests; wired `isolatePlugins: true` into the 3 SC1b chain `runClaude` calls; updated header comment wording (removed all "whole-tree grep" phrasing).
- `tests/uat/harness.ts` - Added exported `bareModeArgs()` and `RunClaudeOptions.isolatePlugins`; `runClaude` splices `bareModeArgs()` output into the spawned CLI args when requested, with a `console.warn` fallback when no API key is present.
- `.planning/ROADMAP.md` - Corrected the Phase 11 SC1 success-criterion line (line 155 only) to name the wire-vs-transcript-tree distinction.
- `docs/HOOK-CONTRACT.md` - Added one paragraph to the "Per-tool tool_response shapes" Evidence subsection naming ambient third-party plugin hooks as a jsonl-tree contamination source, citing `sc1b-resume-canary-leak` by name; introduces zero new session UUIDs (copy-drift gate verified green).

## Decisions Made

- Split Task 1 into RED (`2c8eee9`) and GREEN (`1d8155d`) commits per the task's `tdd="true"` frontmatter, even though the plan's `<action>` text described the hoist and the scoping rewrite as one combined step. This preserves the TDD gate-sequence discipline (a `test(...)` commit demonstrably failing for the right reason, followed by a `feat(...)` commit that turns it green) rather than a single commit that asserts both without ever observing red.
- `grepProjectsTreeForCanaries` wraps its call to `extractTranscriptToolData` in the same per-file `try`/`catch` the original raw-byte version used, preserving tolerance for transient read failures across the rewrite (per the plan's explicit instruction to keep this behavior unchanged).
- The new HOOK-CONTRACT.md paragraph was reflowed after a first pass line-wrapped the required literal phrase ("ambient, globally-installed user-scope plugin hooks") across a markdown line break, which silently failed the `grep -F` acceptance check (markdown line-wrapping is invisible in rendered output but load-bearing for line-based grep assertions).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TDD-gate split: separated Task 1's combined test+implementation into RED then GREEN commits**
- **Found during:** Task 1 (post-implementation self-review against the `tdd_execution` workflow rules)
- **Issue:** My first pass committed the hoist, the rescoped implementation, and the two new fixture tests together in a single `test(11-08): ...` commit. This satisfies the plan's literal `<action>` text (one unified block) but violates the general tdd="true" execution contract, which requires a RED commit (tests exist and fail for the right reason) before a GREEN commit (implementation makes them pass).
- **Fix:** Used `git reset --soft HEAD~1` (safe — tip of my own agent branch, nothing else depended on it) to uncommit without losing changes, temporarily reverted `grepProjectsTreeForCanaries`'s body to the old raw whole-file-byte grep (keeping the new `projectsDirOverride` signature), confirmed `regression-fixture` failed and `positive-control` passed, committed that as RED (`2c8eee9`), then reapplied the scoped-extraction body, confirmed both fixture tests passed, and committed GREEN (`1d8155d`).
- **Files modified:** tests/uat/wire-safety.test.ts
- **Verification:** `npx vitest run --project=uat tests/uat/wire-safety.test.ts -t "wire-safety deterministic guards"` green after GREEN commit; RED commit's failure output captured and reviewed before committing.
- **Committed in:** `2c8eee9` (RED), `1d8155d` (GREEN)

**2. [Rule 1 - Bug] Reflowed HOOK-CONTRACT.md paragraph to keep required phrase on one line**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** The new Evidence paragraph's first draft wrapped "ambient, globally-installed user-scope plugin hooks" across a markdown line break (prose-wrapped at ~80 chars, matching the file's existing style). `grep -F "ambient, globally-installed user-scope plugin hooks" docs/HOOK-CONTRACT.md` (a required acceptance check) matches per-line, not across newlines, so it silently returned no match.
- **Fix:** Reflowed the paragraph so the full required phrase sits on a single line, keeping the rest of the paragraph within normal prose-wrap width.
- **Files modified:** docs/HOOK-CONTRACT.md
- **Verification:** `grep -F "ambient, globally-installed user-scope plugin hooks" docs/HOOK-CONTRACT.md` now returns a match; `npx vitest run tests/copy-drift.test.ts` stays green (25/25).
- **Committed in:** `782bc64` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — process/verification bugs caught before final commit, not scope creep).
**Impact on plan:** Neither deviation changed the plan's intended behavior; both were self-corrections during verification that improved process fidelity (true TDD gates) and acceptance-criteria compliance (grep-matchable wording) before anything was committed to the shared history.

## Issues Encountered

- **Referenced debug file missing from this worktree:** the plan's `<context>` section references `.planning/debug/sc1b-resume-canary-leak.md` as required reading for "the exact record shape that must NOT trip the assertion... versus the record shape that MUST trip it." This file does not exist anywhere in git history (checked `git log --all` and `main`). It was not blocking: the plan's own `<objective>` section (lines 50–70) and Task 1's `<action>` text fully specify the two record shapes needed for the regression and positive-control fixtures, so both tests were written directly from the plan's inline root-cause narrative without needing the missing file. The file is still cited by name in code comments (both hoisted-function JSDoc and the new HOOK-CONTRACT.md paragraph) per the plan's instructions, but that citation currently points to a non-existent path — a future plan or the operator should either create the debug file (to match its citations) or update the citations to point at wherever the root-cause narrative actually lives.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both gap-closure tasks land cleanly on top of the sibling 11-09 plan's worktree (zero file overlap, per the orchestrator's wave-1 parallel-execution setup).
- `npm test` (full default suite, no `MRCLEAN_UAT`): 989 passed / 29 skipped (was 986/29 before this plan — +3 new deterministic tests: `regression-fixture`, `positive-control`, `bareModeArgs`).
- `npx tsc --noEmit`: zero new errors introduced in either modified file.
- Manual follow-up (explicitly out of this plan's automated scope, per the plan's `<verification>` section): the operator should re-run the SC1b live leg once with `MRCLEAN_UAT=1 npm run test:uat -- -t 'wire safety'` to confirm the corrected `grepProjectsTreeForCanaries` scoping passes non-vacuously against a real Claude Code session — this was NOT auto-run by this executor (token-spend gate, human-run only).
- Not touched: STATE.md, ROADMAP.md's Progress table/Status line, REQUIREMENTS.md — these remain the orchestrator's responsibility after the wave completes, per this plan's explicit scope boundary. The single sanctioned ROADMAP.md SC1 content-line edit (Task 2) is already committed in `782bc64`.

---
*Phase: 11-wire-safety-verification-hardening*
*Completed: 2026-07-18*

## Self-Check: PASSED

All created/modified files verified present on disk; all 3 task commits (`2c8eee9`, `1d8155d`, `782bc64`) verified present in `git log --all`.
