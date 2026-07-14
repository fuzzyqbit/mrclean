---
phase: 05-regex-pii-hot-path-lane-l6a-model-acquisition
plan: "02"
subsystem: model-acquisition
tags: [model-cache, ner, sha256, doctor, cli, tdd]
dependency_graph:
  requires:
    - 05-01 (L6a regex lane — same phase, wave 1 parallel)
    - 04-03 (Phase 4 optionalDependencies for @huggingface/transformers + onnxruntime-node)
  provides:
    - src/model/constants.ts — PINNED_MODEL_SHA256, MODEL_ID, MODEL_DOWNLOAD_URL, MODEL_CACHE_PATH
    - src/model/model-cache.ts — isModelCached, verifyModelIntegrity, downloadModel, sideLoadModel
    - src/doctor/checks.ts — checkModelCache (SKIP/PASS/FAIL, exitCodeOnFail 6)
    - src/doctor/index.ts — 7-check doctor report including model-cache
    - src/cli.ts — mrclean pii fetch-model [--from <path>]
  affects:
    - 06 (Phase 6 NER inference wires against verified model cache from this plan)
tech_stack:
  added: []
  patterns:
    - SHA-256 stream verification via node:crypto createHash (stdlib only, no ML deps)
    - Atomic rename after hash verification (temp.partial → dest, fail-closed on mismatch)
    - Dynamic CLI import pattern keeps model code off the npx cold path
    - verifyModelIntegrity with injectable expectedHash for test isolation (no 108 MB model in tests)
key_files:
  created:
    - src/model/constants.ts
    - src/model/model-cache.ts
    - tests/model/model-cache.test.ts
    - tests/doctor/checks-model.test.ts
  modified:
    - src/doctor/checks.ts (added checkModelCache)
    - src/doctor/index.ts (wired checkModelCache, extended exit-code JSDoc)
    - src/cli.ts (added pii fetch-model subcommand)
decisions:
  - "PINNED_MODEL_SHA256 = 7de0a4606c65b60da275a72f37b76a102c41e2b79c6463096a9d0cb800bf3f2c (108,486,236 bytes, computed 2026-06-03)"
  - "verifyModelIntegrity accepts injectable expectedHash for test isolation — unit tests use small fixture files, never the 108 MB model"
  - "checkModelCache returns SKIP (exitCodeOnFail 0) when model absent — doctor stays green for non-NER users"
  - "sideLoadModel and downloadModel are both fail-closed: unlink temp + throw on SHA-256 mismatch, NEVER move partial file to dest"
  - "Dynamic import of ./model/model-cache.js in CLI action keeps model code off cold path (MODEL-02)"
metrics:
  duration: "10 minutes"
  completed: "2026-06-03T00:51:00Z"
  tasks_completed: 3
  files_created: 4
  files_modified: 3
requirements: [MODEL-02, MODEL-03]
---

# Phase 5 Plan 02: Model Acquisition Infrastructure Summary

**One-liner:** SHA-256-pinned NER model download/cache/integrity infrastructure with SKIP-by-default doctor check and `mrclean pii fetch-model` CLI, zero ML deps on the cold path.

## What Was Built

Model acquisition infrastructure for Phase 6 NER inference — fully testable without running any inference:

1. **`src/model/constants.ts`** — real 64-char `PINNED_MODEL_SHA256` (`7de0a46...`), `MODEL_ID`, `MODEL_DOWNLOAD_URL`, and `MODEL_CACHE_PATH(homeDir)` helper. Stdlib-only (no ML deps). Hash computed from live download of 108,486,236-byte `Xenova/bert-base-NER` `onnx/model_int8.onnx`.

2. **`src/model/model-cache.ts`** — four exported functions:
   - `isModelCached(homeDir)` — `fs.access(F_OK)` check at `~/.mrclean/models/…` (never cwd-relative)
   - `verifyModelIntegrity(homeDir, expectedHash?)` — streams file through `createHash('sha256')`, injectable hash for test isolation
   - `downloadModel(homeDir, opts?)` — fetch → `.partial` temp → SHA-256 while writing → atomic rename; fail-closed on mismatch (unlinks temp, throws `ModelIntegrityError`)
   - `sideLoadModel(homeDir, fromPath, expectedHash?)` — resolves to absolute, validates regular file, copy → verify → atomic rename

3. **`src/doctor/checks.ts`** — `checkModelCache(homeDir)`: SKIP (exitCodeOnFail 0) when model absent (green for non-NER users); PASS when present + hash matches; FAIL (exitCodeOnFail 6) on SHA-256 mismatch.

4. **`src/doctor/index.ts`** — push `checkModelCache` into results as check #7 after config-load; extend exit-code JSDoc with code 6.

5. **`src/cli.ts`** — `mrclean pii fetch-model [--from <path>]` subcommand with dynamic import of `model/model-cache.js` (model code stays off cold path per MODEL-02).

## Tests

51 tests pass across 7 test files (11 model-cache + 5 checks-model + 35 existing doctor tests).

Key test patterns:
- `downloadModel` mocked with injected `fetchImpl` returning small fixture buffers — no network in unit tests
- `verifyModelIntegrity` and `sideLoadModel` use injected `expectedHash` with small fixture files — no 108 MB model needed
- `checkModelCache` SKIP path verified: returns exitCodeOnFail 0 so doctor stays green for non-NER users

## Deviations from Plan

None - plan executed exactly as written.

## Threat Surface Scan

All threats in the plan's STRIDE register were mitigated:

| Threat ID | Mitigation Status |
|-----------|-------------------|
| T-05-02-01 | Implemented — SHA-256 verified BEFORE rename into MODEL_CACHE_PATH; fail-closed |
| T-05-02-02 | Implemented — MODEL_CACHE_PATH uses `os.homedir()` + `join`, never cwd-relative |
| T-05-02-03 | Implemented — sideLoadModel validates absolute path + regular file + hash before acceptance |
| T-05-02-04 | Implemented — model-cache.ts uses zero ML deps; CLI dynamic import keeps model off cold path |
| T-05-02-05 | Accepted — checkModelCache returns only model name + status string; no raw bytes or secrets |
| T-05-02-SC | Pass-through — no new packages; model-cache.ts uses only Node stdlib + fetch |

No new trust boundary surfaces beyond those in the plan's threat register.

## Key Decisions

- **PINNED_MODEL_SHA256:** `7de0a4606c65b60da275a72f37b76a102c41e2b79c6463096a9d0cb800bf3f2c` — real content hash of 108,486,236-byte `model_int8.onnx`, computed 2026-06-03 from live HuggingFace Hub file. File size confirmed ~103 MiB (not an LFS pointer stub).
- **Injectable `expectedHash`:** `verifyModelIntegrity` and `sideLoadModel` accept an optional `expectedHash` parameter (defaults to `PINNED_MODEL_SHA256`). Tests use small fixture files with their real SHA-256 — no 108 MB model download needed for CI.
- **`checkModelCache` SKIP design:** exitCodeOnFail is 0 (not 6) on SKIP so that `mrclean doctor` stays exit 0 for the vast majority of users who have not opted into NER. Only a FAIL (model present but hash mismatch) triggers exit 6.
- **Fail-closed on mismatch:** Both `downloadModel` and `sideLoadModel` unlink the temp `.partial` file and throw `ModelIntegrityError` on SHA-256 mismatch. The dest path (`MODEL_CACHE_PATH`) is never written unless verification passes.

## Self-Check: PASSED

All files found, all commits verified, PINNED_MODEL_SHA256 is real 64-char hex (7de0a46...), 51/51 tests pass.
