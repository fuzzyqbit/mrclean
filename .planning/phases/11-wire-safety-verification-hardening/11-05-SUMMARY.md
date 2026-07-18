---
phase: 11-wire-safety-verification-hardening
plan: "05"
subsystem: testing
tags: [uat, wire-safety, mcp, canary, reversible, restore, claude-code-hooks]

# Dependency graph
requires:
  - phase: 08-contract-verification-reversible-plumbing
    provides: UAT harness (runClaude/assertSessionRan), contract-verification analogs (writeSettings/hookEntry/fixtureCmd, transcript scanners, findings artifact + builder guard discipline), E1/MCP honored verdict (the live substitution carrier)
  - phase: 09-session-state-adapter
    provides: reversible store (total read path, persistAllocations, v2 session-tagged tokens), sandbox map layout <HOME>/.mrclean/sessions/<sid>.map
  - phase: 10-operator-restore
    provides: dist/cli.js restore (stdin->stdout, byte-locked summary line, secret floor), store-byte-inert restore (10-08), non-vacuity ordering discipline
provides:
  - Opt-in live wire-safety UAT suite (SC1b) — self-skips green without MRCLEAN_UAT=1, never CI
  - Foreign-named fixture MCP stdio echo server carrying env-fed run-unique canaries (the E1-verified live substitution-on-the-wire path)
  - postresp-log-hook.sh parallel observer recording per-tool PostToolUse tool_response shapes
  - docs/HOOK-CONTRACT.md "Per-tool tool_response shapes" section (pending-stamp matrix, zero UUIDs, copy-drift gate green)
affects: [11-verification, verify-work, HOOK-CONTRACT re-stamps, THREAT_MODEL finalization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Run-unique canary minting (randomUUID token) restores the global-uniqueness premise whole-tree transcript greps need — pinned corpus stays authoritative for deterministic gates"
    - "HOME prefix injected INSIDE the buildHookCommand sh -c script (env-assignment prefix) — hook-process-only state isolation while claude keeps real-HOME auth"
    - "Contract-drift verdict written to the findings artifact BEFORE the hard red (honest failure for upstream-owned claims; canary absence stays mrclean-owned hard assert)"

key-files:
  created:
    - tests/uat/fixtures/echo-mcp-server.mjs
    - tests/uat/fixtures/postresp-log-hook.sh
    - tests/uat/wire-safety.test.ts
  modified:
    - docs/HOOK-CONTRACT.md

key-decisions:
  - "SECRET_LIVE mint uses a +2i position spread over the base32 alphabet so even degenerate hex slices yield 16 distinct chars — the vendored gitleaks entropy>=3 gate can never silently drop; an inline-Shannon mint-integrity test guards the astronomical residue loudly"
  - "Deterministic guards (mint integrity, MRCLEAN_TOOL_RE non-match with positive controls) live OUTSIDE the skipIf describe — they run token-free in every mode, so the fixture-name vacuous-pass hazard is caught by plain `npm run test:uat` collection, not only live runs"
  - "Findings writer spread-merges over the previous artifact instead of calling buildFindingsArtifact (no slot for new experiment keys — see Deviations); guard semantics preserved verbatim (zero-verdict no-write, unparseable artifact fails loud)"
  - "Survey excerpt fields are sanitized (<CANARY_WORD>/<CANARY_SECRET>) before landing in the COMMITTED findings artifact — run-unique canaries never enter version control (T-11-05-01)"

patterns-established:
  - "Dual-engine secret bait: AKIA + [A-Z2-7]{16} is a strict subset of secretlint's [A-Z0-9] body AND an exact match for the vendored gitleaks rule — one minted value proves both engines live"
  - "Record-don't-assert drift seam: module-level record set before the failing expect; afterAll persists it even on red (vitest runs afterAll after failures)"

requirements-completed: [REVMODE-11]

# Metrics
duration: 24min
completed: 2026-07-18
---

# Phase 11 Plan 05: Live Wire-Safety Leg Summary

**SC1b live harness shipped zero-token: run-unique canaries ride a foreign-named fixture MCP tool through mrclean's real HOME-prefixed hook, with the ordered non-vacuity chain (v2 probe -> sandbox map -> restore restored>=1) gating whole-tree absence greps and a restore-then-resume re-entry proof; per-tool tool_response shape survey re-homed with a pending-stamp HOOK-CONTRACT matrix (zero UUIDs, copy-drift 15/15 green).**

## Performance

- **Duration:** ~24 min
- **Started:** 2026-07-18T03:02:40Z
- **Completed:** 2026-07-18T03:26:07Z
- **Tasks:** 3/3
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- **Fixture pair, deterministically runtime-verified without tokens:** `echo-mcp-server.mjs` (~50 lines, `@modelcontextprotocol/sdk` stdio, registerTool shape copied from `src/mcp/tools/status.ts`) smoke-tested via a raw JSON-RPC handshake — server name `wire-canary`, tool listed, CANARY_TEXT env echoed verbatim. `postresp-log-hook.sh` smoke-tested against string/object/undefined `tool_response` payloads — exit 0 always, empty stdout, total on undefined.
- **The wire-safety suite (909 lines, matching the 983-line contract-verification analog convention):** run-1 MCP canary leg -> ordered non-vacuity chain -> hard absence asserts (stream-json, transcript raw + tool surfaces, EVERY `~/.claude/projects/**/*.jsonl`) -> `--resume` re-entry proof with the E3 `--continue` fallback -> Bash/Read/Grep observer-only survey legs (MCP shape rides run-1's log).
- **Honest drift posture for CLI 2.1.212 vs the 2.1.209 stamps:** if the v2-token probe fails (A2 drift — MCP string-form `updatedToolOutput` no longer honored), a contract-drift verdict is recorded to `contract-findings.json` before the hard red fires.
- **HOOK-CONTRACT.md section** with the four-row pending-stamp matrix naming CLI 2.1.212, evidence wiring to the `tool_response_shapes` artifact record, the E1-asymmetry interpretation lens (#68951/#77587 both OPEN as of 2026-07-17), and zero session UUIDs — UUID-traceability gate green before the first live run.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fixture MCP echo server + tool_response observer hook** - `d136900` (test)
2. **Task 2: wire-safety UAT suite — live canary gate, restore re-entry proof, shape survey** - `22c8a6b` (test)
3. **Task 3: HOOK-CONTRACT.md per-tool tool_response shapes section** - `f867d8f` (docs)

## Files Created/Modified

- `tests/uat/fixtures/echo-mcp-server.mjs` - Foreign-named (`wire-canary`) stdio MCP echo server; canary text ONLY from `CANARY_TEXT` env (zero canary literals in source); name fails `MRCLEAN_TOOL_RE` so detection runs on its output
- `tests/uat/fixtures/postresp-log-hook.sh` - log-hook.sh sibling appending `{tool_name, t: typeof tool_response, raw: truncated 2000}` per PostToolUse event to `$E_LOG`; executable, sh -n clean
- `tests/uat/wire-safety.test.ts` - The SC1b suite: `describe.skipIf(!UAT_ENABLED)` live legs + visible skip placeholder + token-free deterministic guards (mint integrity with inline Shannon check, `MRCLEAN_TOOL_RE` non-match with positive controls)
- `docs/HOOK-CONTRACT.md` - New `## Per-tool tool_response shapes (PostToolUse input)` section between E5 and Closed follow-ups

## Decisions Made

- **Mint construction hardened beyond the plan's example:** the plan's illustrative mapping (first 8 = value, second 8 = value+16) admits a degenerate-entropy edge (constant hex slice -> 2 distinct chars -> gitleaks entropy<3 silently drops one engine). The shipped mint adds a `+2i` position spread (still deterministic from runToken, still pure `[A-Z2-7]`) making 16-distinct the degenerate-case FLOOR, plus an inline-Shannon `> 3` mint-integrity test so any residue fails loud, never vacuous.
- **`test(name, { timeout }, fn)` options-as-second-arg form** per the repo's recorded Vitest 4 decision (Phase 3 Plan 02), diverging stylistically from c-v's trailing-number form — both valid; the recorded decision wins.
- **Survey verdict evidence lives in sanitized excerpts, not paths:** observer side files live in the mkdtemp sandbox (removed in afterAll), so `evidence_paths` for survey legs is empty by design — the durable evidence is the sanitized `raw_excerpt_sanitized` signal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan-specified findings routing (`via buildFindingsArtifact`) is impossible for new experiment keys — replaced with an evidence-preserving spread-merge writer**
- **Found during:** Task 2 (wire-safety UAT suite)
- **Issue:** `buildFindingsArtifact(previous, run)` has NO RunRecords slot for survey/wire records — it rebuilds exactly the E1–E5 keys and DROPS unknown experiment keys. Routing survey verdicts through the only open-shaped slot (`e1Tools`) would corrupt the committed E1 verdict string (updatedToolOutput semantics, not tool_response-input semantics). Modifying `findings-builder.ts` is outside this plan's `files_modified` scope.
- **Fix:** the suite's `writeWireFindings()` mirrors the c-v afterAll discipline exactly (zero-verdict runs leave the artifact untouched; present-but-unparseable artifact fails LOUD and refuses the write — WR-04 lineage) and spread-merges `{ ...previous, experiments: { ...previousExperiments, tool_response_shapes, wire_safety } }` — every committed key (E1–E5 and anything else) is preserved VERBATIM, strictly safer than a rebuild. `ToolVerdict` is imported from `findings-builder.js` so the record shape stays type-linked.
- **Known limitation (documented in the suite comment + doc procedure):** a later FULL contract-verification rerun rebuilds via `buildFindingsArtifact` and drops the two wire keys — the operator re-runs the wire-safety suite afterwards to re-stamp (doc + artifact updated together per the HOOK-CONTRACT re-verification procedure). Extending the builder with carry-forward slots for these keys is a candidate for a later plan touching `findings-builder.ts` + its unit tests.
- **Files modified:** tests/uat/wire-safety.test.ts (writer local to the suite)
- **Verification:** self-skip run green; findings writer is only reachable under MRCLEAN_UAT=1
- **Committed in:** `22c8a6b`

**2. [Verification adaptation] Full `npm test` not run inside the worktree — unit project run in full instead**
- **Found during:** overall verification
- **Issue:** `npm test` triggers the integration project's globalSetup (`tsup --clean`), rebuilding `dist/` inside the worktree. Repo policy (memory-enforced, phase 9 lesson): dist built in a worktree embeds worktree-relative shim paths and must never be committed from here.
- **Fix:** ran the FULL unit project (`npx vitest run --project=unit`: 79 files, 816 passed, 4 skipped — includes the copy-drift gate) plus the targeted uat self-skip run. The integration project's include list is untouched by this diff (all new files live under `tests/uat/**`, which only the uat project matches), so integration coverage is unaffected; the phase-level `npm test` green check re-runs on the orchestrator branch post-merge.
- **Files modified:** none
- **Verification:** `git diff --name-only HEAD~3 HEAD | grep ^dist/` → empty (no dist in any commit)
- **Committed in:** n/a (process-level)

---

**Total deviations:** 2 (1 auto-fixed plan/API mismatch, 1 verification adaptation for worktree policy)
**Impact on plan:** No scope creep; both preserve the plan's intent with higher fidelity to shipped code and repo policy.

## Issues Encountered

None beyond the deviations above. Both fixtures passed first-shot runtime smokes (JSON-RPC handshake; string/object/undefined payload matrix), and typecheck stayed exactly at the 38-error baseline with zero new-file errors.

## Known Stubs

| Stub | File | Reason | Resolved by |
|------|------|--------|-------------|
| Matrix cells `pending first MRCLEAN_UAT=1 wire-safety run (CLI 2.1.212)` (12 cells) | docs/HOOK-CONTRACT.md §Per-tool tool_response shapes | Intentional BY PLAN — the section is the durable documentation home whose evidence slots are filled by the operator's live run; hard-stamping now would fabricate evidence | Operator verify-work run (command below) re-stamps matrix + artifact together |

## Live Leg — Deferred to verify-work (BY DESIGN)

**No live session was run and MRCLEAN_UAT was never set during execution** (settled repo policy: token spend is operator-authorized only; enforced here by the parallel-executor policy as well). The in-plan proof is deterministic: the suite self-skips green (`3 passed | 8 skipped`, exit 0) and the fixtures are runtime-verified without tokens.

**Exact operator command for the live leg (verify-work):**

```sh
MRCLEAN_UAT=1 npm run test:uat -t 'wire safety'
```

One run delivers: the SC1b canary/absence/re-entry proof chain, the sandbox A1 HOME-isolation probe, and the per-tool `tool_response` shape re-stamps (CLI 2.1.212) into `tests/uat/artifacts/contract-findings.json` — then update the HOOK-CONTRACT matrix cells from the artifact in the same commit (UUID-traceability gate enforces doc/artifact consistency). Cost: ~6 Haiku sessions (cents). Requires an authenticated `claude` CLI; the preflight fails loud (never skips) if absent.

## Verification Evidence

- `node --check tests/uat/fixtures/echo-mcp-server.mjs` — clean
- `sh -n tests/uat/fixtures/postresp-log-hook.sh && test -x` — clean, executable
- Fixture runtime smokes (zero tokens): MCP JSON-RPC handshake echoes env canary verbatim; observer hook total on string/object/undefined
- `npx vitest run tests/uat/wire-safety.test.ts --project=uat` — `3 passed | 8 skipped`, exit 0 (self-skip green; deterministic guards pass)
- `npx vitest run tests/copy-drift.test.ts --project=unit` — 15/15 green (UUID gate + all doc gates)
- `npx vitest run --project=unit` — 79 files, 816 passed, 4 skipped
- `npm run typecheck` — exactly 38 errors (the recorded baseline; zero from new files)
- Acceptance greps: zero pinned-corpus literals in the suite; zero canary literals in fixture source; prompts carry no canary values; HOME appears functionally ONLY in the hook command string + spawned restore env; non-vacuity tests precede absence tests in source order

## Next Phase Readiness

- The operator's verify-work run is the ONLY outstanding leg for this plan's scope — everything else is deterministic and green.
- 11-VALIDATION.md should list `MRCLEAN_UAT=1 npm run test:uat` as the phase gate's manual leg (per the plan's verification note).
- After the live run: re-stamp the HOOK-CONTRACT matrix + E-section stamps from the refreshed artifact in one commit; if the A2 drift verdict fires instead, the dist-parity leg still carries SC1's CI proof and the drift record feeds the THREAT_MODEL finalization.

## Self-Check: PASSED

- FOUND: tests/uat/fixtures/echo-mcp-server.mjs
- FOUND: tests/uat/fixtures/postresp-log-hook.sh
- FOUND: tests/uat/wire-safety.test.ts
- FOUND: docs/HOOK-CONTRACT.md §Per-tool tool_response shapes
- FOUND: commit d136900
- FOUND: commit 22c8a6b
- FOUND: commit f867d8f

---
*Phase: 11-wire-safety-verification-hardening*
*Completed: 2026-07-18*
