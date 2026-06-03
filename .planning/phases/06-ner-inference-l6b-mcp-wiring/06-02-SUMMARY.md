---
phase: 06-ner-inference-l6b-mcp-wiring
plan: 02
subsystem: detection
tags: [ner, layer6b, orchestrator, mcp-opt-in, structural-unreachability, audit-provenance, perf-gate]

# Dependency graph
requires:
  - phase: 06-ner-inference-l6b-mcp-wiring
    plan: 01
    provides: "runLayer6bNer + NerStatus, dropNerOverlaps (D-11), getNerBackend/resetNerSingleton, PINNED_MODEL_SHA256"
  - phase: 04-pii-contracts-architecture-foundations
    provides: "FindingProvenance + findingToAuditRecord provenance arg (engine/model_rev/quant/backend)"
provides:
  - "DetectionOptions{ner?} — MCP-only opt-in gate threaded into runDetection + runDetectionReadOnly"
  - "nerStatus on DetectionResult — 'disabled' on the cold/hook path; 'ready'/'unavailable' on opt-in (06-03 surfaces it in check/redact structuredContent)"
  - "L6b branch (dynamic import of layer6b-ner.js) entered ONLY when opts.ner && config.pii.ner.enabled"
  - "dropNerOverlaps (D-11) runs immediately before dedupBySpan in BOTH orchestrators"
  - "pii-ner audit provenance: engine=pii-ner@<sha12>, model_rev=PINNED_MODEL_SHA256, quant=dtype, backend=getNerBackend()"
  - "import-graph unreachability test (ner-unreachable.test.ts) — fails if a static engine import is added to the hook path"
  - "tsup build fix: @huggingface/transformers + onnxruntime-node externalized (optional deps stay dynamic-only)"
affects: [06-03-mcp-preload-piiranha]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MCP-only opt-in threading: opts.ner is the sole gate to the L6b dynamic import — hook handlers call runDetection with 4 args, so the engine is structurally unreachable from the cold path"
    - "Per-finding audit provenance: pii-ner findings pass FindingProvenance; all other sources pass undefined (byte-identical v1 records)"
    - "Pure source-reading import-graph test (no model, no spawn) as the structural-unreachability guard"
    - "Optional ML deps externalized in tsup (negative-lookahead noExternal) so the bundle build succeeds without them installed; dynamic import preserved for runtime opt-in"

key-files:
  created:
    - tests/detect/orchestrator-ner.test.ts
    - tests/detect/ner-unreachable.test.ts
  modified:
    - src/detect/index.ts
    - tests/perf/user-prompt-submit.perf.test.ts
    - tests/hook/handlers-detection.test.ts
    - tsup.config.ts

key-decisions:
  - "nerStatus made a REQUIRED field on DetectionResult (not optional). Cold path always returns 'disabled' explicitly, so requiring it keeps the contract honest and forces every construction site to acknowledge the NER outcome. Two pre-existing hook-test mock literals were updated to nerStatus:'disabled'."
  - "tsup build fix scoped to externalizing the two optionalDependencies (@huggingface/transformers, onnxruntime-node) via a noExternal negative lookahead + external list — NOT installing them. The dynamic import stays in the bundle and resolves at runtime only on opt-in. Treated as a Rule 3 blocking fix for a pre-existing 06-01 break."
  - "dist/ bundle artifacts NOT committed — the worktree rebuild only differs by worktree-relative node_modules paths (noise); dist regenerates correctly on the main checkout/CI. Mirrors 06-01's dist-exclusion decision."

patterns-established:
  - "opts.ner gate is the single structural boundary between the cold hook path and the warm NER lane"
  - "Provenance is computed once per runDetection call and applied per-finding only to source==='pii-ner'"

requirements-completed: [NER-01, MODEL-04]

# Metrics
duration: ~22min
completed: 2026-06-03
---

# Phase 6 Plan 02: Orchestrator NER Wiring (opts.ner + D-11 + Provenance + Unreachability) Summary

**Threaded an MCP-only `opts.ner` gate into both detection orchestrators so the Layer 6b NER engine (and its `@huggingface/transformers` dynamic import) runs only on explicit opt-in, ran the D-11 overlap drop before dedup, stamped every pii-ner audit entry with reproducible model provenance (no raw PII), and proved with an import-graph test + cold-start perf gate that the hook path can never reach the NER code.**

## Performance

- **Duration:** ~22 min
- **Completed:** 2026-06-03
- **Tasks:** 2 (Task 1 TDD: orchestrator wiring; Task 2: unreachability test + perf gate)
- **Files:** 2 created, 4 modified

### Hook cold-start perf (the load-bearing number)

| Path | p95 | Gate | Baseline |
|------|-----|------|----------|
| UserPromptSubmit, NER code present, `opts.ner` UNSET (4KB fixture) | **~3.15 ms** | <= 100 ms (PERF-01a) | 17.4 ms (STATE.md 2026-05-14) |

The L6b branch is never entered on the cold path (no 5th arg), so the `await import('@huggingface/transformers')` is unreachable and the 108 MB ML dep never touches hook latency. The standalone measurement and the integration perf test both pass the gate with large headroom. (The dev machine runs faster than the 17.4 ms reference baseline; the gate confirms no regression from adding the NER code.)

## Accomplishments

- **`DetectionOptions { ner?: boolean }` + `nerStatus: NerStatus`** added to `src/detect/index.ts`. `NerStatus` is a **type-only** import of the engine module — the engine's runtime is reached exclusively via `await import('./layer6b-ner.js')`.
- **L6b branch in BOTH orchestrators** (`runDetection`, `runDetectionReadOnly`): `if (opts.ner && config.pii.ner.enabled)` → dynamic-import `runLayer6bNer` → append findings → set `nerStatus`. Initialized to `'disabled'` so the no-opts path returns `'disabled'` and never imports the engine.
- **D-11 pre-dedup filter** (`dropNerOverlaps`) runs immediately before `dedupBySpan` in both functions — a no-op when there are no pii-ner findings (cold path), leaving generic dedup pure.
- **Audit provenance (MODEL-04 / D-12):** a single `FindingProvenance` is computed per call — `engine: pii-ner@<sha12>`, `model_rev: PINNED_MODEL_SHA256`, `quant: config.pii.ner.dtype`, `backend: getNerBackend()` — and passed to `findingToAuditRecord` ONLY for `source === 'pii-ner'` findings. Non-NER findings pass `undefined` (records byte-identical to v1). No raw value can leak: `findingToAuditRecord` destructure-picks only the four model-identity keys.
- **`resetNerSingleton()` wired into `shutdownDetection()`** so the warm pipeline is cleared on MCP shutdown (`supervisor.ts` re-exports `shutdownDetection` as `shutdownMcpSupervisor`).
- **Import-graph unreachability proof** (`tests/detect/ner-unreachable.test.ts`): a fast, pure source-reading test asserting (1) no hook-reachable module — `hook/index.ts` + `dispatcher.ts` + `handlers/*.ts` + `detect/index.ts` — has a runtime static import of `layer6b-ner` (only the single `import type { NerStatus }` line is permitted), (2) `@huggingface/transformers` appears in `src/` only as a dynamic `import()` and only in `pipeline-singleton.ts`, (3) `detect/index.ts` reaches the engine via exactly two dynamic `import('./layer6b-ner.js')` calls, and (4) every hook handler calls `runDetection` with exactly 4 args. Verified to FAIL when a static engine import is injected into a handler.
- **Perf gate extended** with a sibling test that re-runs the 4KB gate with `opts.ner` unset, proving the cold path is unchanged.

## Task Commits

1. **Task 1 RED:** failing orchestrator NER wiring test — `122394e` (test)
2. **Task 1 GREEN:** opts.ner L6b branch + D-11 + nerStatus + audit provenance — `0a331c3` (feat)
3. **Task 2:** import-graph unreachability proof + cold-path perf gate + tsup build fix — `50d8200` (test)

## Files Created/Modified

- `src/detect/index.ts` (MOD) — `DetectionOptions`, `nerStatus` on `DetectionResult`, type-only `NerStatus` import, `opts` param + L6b branch + `dropNerOverlaps` in both orchestrators, per-finding pii-ner provenance in the audit write, `resetNerSingleton()` in shutdown.
- `tests/detect/orchestrator-ner.test.ts` (NEW) — 7 tests: gating (default/opt-in-disabled/opt-in-enabled), unavailable propagation, D-11 integration, provenance assertions (NER carries 4 fields + no raw value; secret carries none), read-only parity. Mocks `layer6b-ner.js` + `pipeline-singleton.js` (no download).
- `tests/detect/ner-unreachable.test.ts` (NEW) — 5 tests, pure source-reading import-graph proof.
- `tests/perf/user-prompt-submit.perf.test.ts` (MOD) — sibling cold-path (opts.ner unset) p95 gate + `shutdownDetection` cleanup.
- `tests/hook/handlers-detection.test.ts` (MOD) — two mock `DetectionResult` literals updated with `nerStatus:'disabled'` (required-field contract).
- `tsup.config.ts` (MOD) — externalize `@huggingface/transformers` + `onnxruntime-node`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] tsup bundle build failed to resolve `@huggingface/transformers`**
- **Found during:** Task 2 (running the integration/perf project, whose globalSetup runs `tsup`).
- **Issue:** `noExternal: [/.*/]` told esbuild to bundle every dependency, so it tried to resolve the dynamic `import('@huggingface/transformers')` in `pipeline-singleton.ts` at bundle time and failed because the package is an `optionalDependency` not installed by default (PII off by default). This break was introduced by Plan 06-01 (which created `pipeline-singleton.ts`) — `pipeline-singleton.ts` is byte-identical to base, confirming the break is pre-existing, not caused by this plan.
- **Fix:** Changed `noExternal` to a negative-lookahead regex excluding the two ML packages and added `external: ['@huggingface/transformers', 'onnxruntime-node']`. The bundle build now succeeds; the dynamic `import("@huggingface/transformers")` is preserved in `dist/mcp.js` as an external import, resolved at runtime only when the user opts in. Matches the PROJECT.md lazy-import / optional-dependency tech-stack rule.
- **Files modified:** tsup.config.ts
- **Verification:** `npm run build` exits 0; `dist/mcp.js` contains exactly one `await import("@huggingface/transformers")`; integration project (18 files / 116 tests) passes.
- **Committed in:** `50d8200`

**2. [Rule 3 - Blocking] Two hook-test mock `DetectionResult` literals missing the new required `nerStatus`**
- **Found during:** Task 1 (typecheck after making `nerStatus` a required field).
- **Issue:** `tests/hook/handlers-detection.test.ts` constructs `NO_FINDINGS_RESULT` and `BUDGET_EXHAUSTED_RESULT` as `DetectionResult` literals; adding the required `nerStatus` field made them not typecheck — a regression caused directly by this plan's contract change.
- **Fix:** Added `nerStatus: 'disabled'` to both literals (the correct value for the hook path).
- **Files modified:** tests/hook/handlers-detection.test.ts
- **Verification:** the two `nerStatus' is missing` top-level tsc errors are gone; total project tsc errors dropped 45 → 35 (net reduction; all 35 remaining are pre-existing, see Deferred Issues).
- **Committed in:** `0a331c3`

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking). Both necessary to complete the plan's own verify steps; no scope creep.

## Issues Encountered

- **Worktree dist rebuild noise:** the integration globalSetup rebuilds `dist/cli.js` / `dist/mcp.js`, but the worktree rebuild differs from the committed artifacts only by worktree-relative `node_modules` paths (`node_modules/...` → `../../../node_modules/...`). These were restored (`git checkout -- dist/...`) and NOT committed — dist regenerates correctly on the main checkout/CI. Mirrors 06-01's decision.
- **Vitest run-mode suppresses passing-test `console.log`,** so the in-test `[perf] p95=...` line is not surfaced by `npm test`. The p95 number in this summary (~3.15 ms) was captured via an equivalent standalone `tsx` measurement; the in-suite gate (`expect(p95).toBeLessThanOrEqual(100)`) passes.

## Deferred Issues

- **`tests/hook/failclosed.test.ts` Test 4 & Test 5 fail (`expected null to be 2`).** Pre-existing and unrelated — already logged in `.planning/phases/06-ner-inference-l6b-mcp-wiring/deferred-items.md` under 06-01. The file (and `src/hook/failclosed.ts`) is byte-identical to base; the failure is a tsx/spawn sandbox interaction (child exit code `null`), not a NER-lane defect.
- **35 pre-existing `tsc --noEmit` errors** across `audit/log.ts` (override modifier), `gitleaks-adapter.ts`/`secretlint-engine.ts` (3rd-party type mismatches), `doctor/*`, and several test mock literals (`envBlocklist.meta`, missing `source`, `?budget=1` query-param import). All present at base commit `cfacb5a` (base had 45; this plan reduced the count to 35). The project gates on `vitest` (esbuild transpile), not on a clean `tsc`, so these do not block the suite. Out of scope (SCOPE BOUNDARY).

## Known Stubs

None. `opts.ner` is fully wired into both orchestrators with real provenance and a real D-11 filter. The MCP tools that flip `{ ner: true }` are the explicit scope of Plan 06-03 (documented build order), not a stub. `nerStatus` is returned by the orchestrator now; 06-03 surfaces it in check/redact `structuredContent`.

## Next Phase Readiness

- **Ready for 06-03 (MCP preload + piiranha tier):** `runDetection(..., { ner: true })` and `runDetectionReadOnly(..., { ner: true })` are the call shape the `check`/`redact` tools use; `nerStatus` is on `DetectionResult` ready to surface in `structuredContent`. `resetNerSingleton()` is wired into the MCP shutdown chain; `getNerPipeline`/`warmOnBoot` remain for boot preload.
- **No blockers.** Hook cold path proven unreachable (import-graph test + perf gate); audit provenance + no-raw-value invariant proven by the orchestrator test.

## Self-Check: PASSED

- Both created files verified present: `tests/detect/orchestrator-ner.test.ts`, `tests/detect/ner-unreachable.test.ts`.
- All three task commits verified in git history: `122394e`, `0a331c3`, `50d8200`.
- Acceptance greps: `await import('./layer6b-ner.js')` count = 2; 0 runtime static engine imports; 1 `import type { NerStatus }`; `dropNerOverlaps` + `resetNerSingleton` present.
- Suites: orchestrator-ner (7), ner-unreachable (5), full unit (405 pass / only the 2 pre-existing failclosed deferrals fail), full integration (116 pass incl. both perf gates). Build exits 0 with the ML deps externalized.

---
*Phase: 06-ner-inference-l6b-mcp-wiring*
*Completed: 2026-06-03*
