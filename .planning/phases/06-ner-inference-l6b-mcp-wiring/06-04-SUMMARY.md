---
phase: 06-ner-inference-l6b-mcp-wiring
plan: 04
subsystem: model-integrity
tags: [supply-chain, integrity, provenance, ner, fail-closed]
gap_closure: true
requires:
  - "src/model/model-cache.ts (Phase 5 SHA-256 verify/download/sideload infra)"
  - "src/model/pipeline-singleton.ts (warm NER singleton + lazy import)"
  - "src/detect/index.ts (NER audit provenance block)"
provides:
  - "MODEL_DESCRIPTORS: per-model integrity descriptor map (bert + piiranha)"
  - "descriptor-parameterized model-cache (isModelCached/verifyModelIntegrity/downloadModel/sideLoadModel)"
  - "SHA-verified, fail-closed inference load path (allowRemoteModels=false)"
  - "getNerResolvedSha256/getNerResolvedDtype resolved-provenance accessors"
  - "config-load fail-closed rejection of unknown/unpinned pii.ner.model"
  - "truthful per-model audit provenance (model_rev/quant from the loaded descriptor)"
affects:
  - "src/config/index.ts (validatePiiNerConfig)"
  - "src/model/constants.ts"
tech-stack:
  added: []
  patterns:
    - "per-model descriptor record (id/downloadUrl/pinnedSha256/cachePath) keyed by model id"
    - "acquire-and-verify before load; throw → fail-closed (nerStatus 'unavailable')"
    - "resolved-provenance module state stashed during build, omitted when unavailable"
key-files:
  created: []
  modified:
    - src/model/constants.ts
    - src/model/model-cache.ts
    - src/model/pipeline-singleton.ts
    - src/config/index.ts
    - src/detect/index.ts
    - tests/model/model-cache.test.ts
    - tests/model/pipeline-singleton.test.ts
    - tests/config/pii-schema.test.ts
    - tests/detect/orchestrator-ner.test.ts
decisions:
  - "allowRemoteModels is ALWAYS false on the inference path — transformers.js loads ONLY the SHA-verified local file we acquired; it never fetches an unverified model itself."
  - "Unknown pii.ner.model is rejected at config load (primary guard) AND defensively re-checked in getNerPipeline (defense-in-depth)."
  - "When the resolved sha is unavailable, OMIT model_rev/engine rather than stamping a wrong/empty hash."
  - "model-cache + constants are Node-stdlib-only, so static-importing them into pipeline-singleton adds ZERO ML surface to the cold path."
metrics:
  duration_min: 10
  tasks: 3
  files_changed: 10
  completed: 2026-06-03
requirements: [MODEL-04, NER-04]
---

# Phase 6 Plan 4: NER Model Integrity + Truthful Provenance Summary

Closes SC-4: the NER inference path now loads ONLY a SHA-256-verified local model (per-model
bert AND piiranha), fails closed on integrity mismatch or missing-with-download-disabled, and
stamps audit provenance from the actually-loaded model's resolved descriptor instead of a
hardcoded bert constant.

## What was built

Three TDD tasks (RED → GREEN each):

1. **Per-model descriptor infrastructure (CR-02).** Added `ModelDescriptor` type +
   frozen `MODEL_DESCRIPTORS` map (keyed by `MODEL_ID` and `PIIRANHA_MODEL_ID`) to
   `src/model/constants.ts`, wiring the previously-dead `PIIRANHA_DOWNLOAD_URL /
   PIIRANHA_PINNED_SHA256 / PIIRANHA_CACHE_PATH` constants into a real descriptor.
   Parameterized all four `model-cache.ts` functions by an optional trailing
   `descriptor` argument (defaults to the bert descriptor → fully back-compatible with
   the existing `cli.ts` and `doctor/checks.ts` call sites, which pass no descriptor).
   Every security invariant preserved: verify-before-rename, unlink-on-mismatch,
   home-rooted cache path. Module stays Node-stdlib-only.

2. **SHA-verified, fail-closed inference load path (CR-01 / D-06).** `getNerPipeline`
   now resolves the per-model descriptor, runs `isModelCached` + `verifyModelIntegrity`
   (or `downloadModel`, which verifies-before-rename) BEFORE calling `pipeline()`, and sets
   `env.allowRemoteModels = false` so transformers.js loads ONLY the verified local file.
   On integrity mismatch, or on a cache miss when `allowDownload=false`, it THROWS — caught
   by `runLayer6bNer`'s existing try/catch → `nerStatus 'unavailable'` (fail-closed). Added
   `getNerResolvedSha256()` / `getNerResolvedDtype()` accessors (reset by `resetNerSingleton`).
   `config/index.ts` now rejects any `pii.ner.model` not present in `MODEL_DESCRIPTORS`
   (fail-closed, T-06-04-03); both bert and piiranha still resolve.

3. **Truthful per-model provenance (D-12 / MODEL-04).** `src/detect/index.ts` builds NER
   audit provenance from the resolved accessors: `model_rev`/`engine` from
   `getNerResolvedSha256()` (piiranha stamps the piiranha hash, not bert), `quant` from
   `getNerResolvedDtype() ?? config.pii.ner.dtype` (resolved wins — WR-04). When the resolved
   sha is unavailable, `model_rev`/`engine` are omitted rather than stamped wrong. The
   destructure-pick in `findingToAuditRecord` is untouched, so no raw PII can enter provenance.

## How to verify

- `npx vitest run tests/model/model-cache.test.ts tests/model/pipeline-singleton.test.ts tests/detect/orchestrator-ner.test.ts tests/detect/ner-unreachable.test.ts tests/config` → 87 passed.
- `grep -n "allowRemoteModels = false" src/model/pipeline-singleton.ts` → present (line 156).
- `grep -nE "verifyModelIntegrity|isModelCached|downloadModel" src/model/pipeline-singleton.ts` → all three on the load path, before `pipeline()`.
- `grep -n "model_rev" src/detect/index.ts` → sourced from `getNerResolvedSha256()`, not a hardcoded constant.
- `grep -rln "MODEL_DESCRIPTORS" src/` → constants.ts (def), model/pipeline-singleton.ts, config/index.ts (PIIRANHA_* no longer dead).
- `npm run build && grep -c "from '@huggingface/transformers'" dist/cli.js` → 0 (dynamic `import(...)` only; structural-unreachability invariant intact).

## Deviations from Plan

None — plan executed exactly as written. The plan offered "static import of model-cache is also
acceptable since it pulls no ML dep"; I chose the static import for `MODEL_DESCRIPTORS` and the
model-cache functions (both Node-stdlib-only), which keeps the build clean and is confirmed
cold-path-safe by the re-run `ner-unreachable` proof and the `dist/cli.js` static-import count of 0.

## Authentication Gates

None.

## Known Stubs

None — all paths are wired (descriptor map composes real constants; provenance reads real
resolved state; no placeholder/empty data sources introduced).

## Deferred Issues

`tests/hook/failclosed.test.ts` Tests 4 & 5 fail in this parallel worktree because the spawned
child process resolves `node_modules/.bin/tsx`, which is not present in the worktree (its
`node_modules/.bin` is effectively empty; `spawnSync` returns `status: null`). `src/hook/failclosed.ts`
imports NONE of the files changed by this plan (grep count 0) — this is a pre-existing environment
artifact already documented for 06-01, not a regression. Logged to `deferred-items.md`; re-run after
the worktree merges into the main checkout where `tsx` resolves.

## TDD Gate Compliance

Each task followed RED → GREEN. Commits:
- `test(06-04)` 8e346ea — RED (model-cache/descriptor failing tests)
- `feat(06-04)` 982bc97 — GREEN (descriptor + model-cache parameterization)
- (Task 2 RED tests + GREEN combined in) `feat(06-04)` e9d9f51 — verified load path + config guard
- `feat(06-04)` 6673229 — GREEN (truthful provenance) + purity re-proof

Tasks 2 and 3 had their RED tests written and observed failing before implementation (recorded in
the execution log); their GREEN commits include the now-passing tests. No test passed unexpectedly
during any RED phase.

## Self-Check: PASSED

All 5 modified source files exist on disk; all 4 task commit hashes (8e346ea, 982bc97, e9d9f51,
6673229) are present in git history.
