---
phase: 06-ner-inference-l6b-mcp-wiring
plan: 01
subsystem: detection
tags: [ner, transformers.js, onnx, bert-base-NER, pii, layer6b, warm-singleton, tdd]

# Dependency graph
requires:
  - phase: 05-regex-pii-hot-path-lane-l6a-model-acquisition
    provides: "model-cache.ts SHA-256-verified ~/.mrclean/models cache + constants.ts (MODEL_ID, PINNED_MODEL_SHA256, MODEL_CACHE_PATH); layer6a-pii.ts sibling engine shape; shared allowlist.ts"
  - phase: 04-pii-contracts-architecture-foundations
    provides: "Finding 'pii-ner' source + SOURCE_PRECEDENCE tail; type-map pii:PERSON|ORG|LOC; MrcleanPiiNerConfig; audit engine/model_rev/quant/backend fields"
provides:
  - "getNerPipeline / getNerBackend / resetNerSingleton — warm NER pipeline singleton (sole @huggingface/transformers dynamic-import boundary)"
  - "runLayer6bNer — L6b NER engine: BIO aggregation + min_score floor + label map + dual fail-closed; emits substitute-only pii-ner Finding[]"
  - "mapModelLabel — per-model BIO-label → canonical PERSON/ORG/LOC map (keyed by model id for piiranha extension in 06-03)"
  - "dropNerOverlaps — D-11 cross-source NER overlap-drop pre-dedup filter (leaves dedupBySpan pure)"
  - "pii.ner.confidence default reconciled 0.9 → 0.7 (D-07)"
affects: [06-02-orchestrator-ner-wiring, 06-03-mcp-preload-piiranha]

# Tech tracking
tech-stack:
  added: []  # no new packages — @huggingface/transformers + onnxruntime-node already optionalDependencies (Phase 4)
  patterns:
    - "Sole dynamic-import boundary: import('@huggingface/transformers') exists ONLY in pipeline-singleton.ts; zero static imports in src/ (grep-gated cold-path safety)"
    - "Fail-closed-for-NER: two try/catch boundaries (load + inference) inside runLayer6bNer return {findings:[],status:'unavailable'} and never re-throw"
    - "env.cacheDir set BEFORE pipeline() — D-06 / Pitfall 2"
    - "D-11 implemented as a separate pre-dedup filter pass, not a dedupBySpan special-case"
    - "Route B manual BIO aggregation with self-computed char offsets (pipeline emits no offsets)"

key-files:
  created:
    - src/model/pipeline-singleton.ts
    - src/detect/layer6b-ner.ts
    - src/detect/ner-entities.ts
    - src/detect/ner-overlap.ts
    - tests/model/pipeline-singleton.test.ts
    - tests/detect/ner-entities.test.ts
    - tests/detect/layer6b-ner.test.ts
    - tests/detect/ner-overlap.test.ts
  modified:
    - src/config/defaults.ts
    - src/shared/types.ts
    - tests/config/pii-schema.test.ts

key-decisions:
  - "Aggregation Route B (manual BIO): the installed @huggingface/transformers 4.2.0 token-classification pipeline emits per-token {entity,score,index,word} with NO char offsets — and aggregation_strategy:'simple' (grouped) is available but ALSO offset-less. Char spans are reconstructed from the word surface form via a forward-only cursor (## subword marker stripped)."
  - "Per-entity score = MIN of subword scores (conservative) — a single low-confidence subword drops the whole run."
  - "Config field name kept as `confidence` (NOT renamed to min_score); only the DEFAULT VALUE changed 0.9 → 0.7 (D-07 / RESEARCH Pitfall 3 / A4)."
  - "@ts-expect-error on the dynamic import: the optionalDependency types are absent at typecheck time (PII off by default); the import only runs behind the MCP-only opts.ner gate."

patterns-established:
  - "Warm-singleton-via-cached-promise mirroring src/detect/index.ts pool/reset shape, with resetNerSingleton() for shutdown + tests"
  - "Mocked-pipeline unit testing: vi.mock the singleton module so CI NEVER downloads the 108 MB model"

requirements-completed: [NER-01, NER-02, NER-03]

# Metrics
duration: ~12min
completed: 2026-06-03
---

# Phase 6 Plan 01: NER Building Blocks (Pipeline Singleton + L6b Engine + D-11 Filter) Summary

**Four pure, download-free NER building blocks — warm-singleton pipeline (sole ML-dep import boundary), L6b BIO-aggregation engine with min_score floor + dual fail-closed, per-model label map, and the D-11 cross-source overlap-drop filter — plus the D-07 confidence default reconcile, all unit-tested with a mocked pipeline.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-03T02:24Z
- **Completed:** 2026-06-03T02:36Z
- **Tasks:** 3 (Task 0 Wave-0 reconcile + 2 TDD tasks)
- **Files modified:** 11 (4 new src modules, 4 new test files, 3 modified)

## Accomplishments

- **Wave-0 transformers.js v4 shape verification** (ephemeral scratch install, deleted; package.json untouched): confirmed `dtype:'int8'` → `onnx/model_int8.onnx`, per-token output has NO char offsets, backend `onnxruntime-node` — locking **Route B (manual BIO aggregation)** before implementation.
- **`pipeline-singleton.ts`** — warm singleton via cached promise; the SOLE `import('@huggingface/transformers')` in the repo (grep-gated: 0 static imports in src/); `env.cacheDir = ~/.mrclean/models` set BEFORE `pipeline()` (D-06); `getNerBackend()` captures the audit backend.
- **`layer6b-ner.ts`** — `runLayer6bNer` aggregates subwords (self-computed char offsets), gates on `confidence` floor (D-07/D-08), maps labels + filters by `entities` (D-09), emits `source:'pii-ner'` / `action:'substitute'` (D-02), and fails closed on BOTH model-load and inference throws (NER-03) with no PII leak in the result.
- **`ner-entities.ts`** — `mapModelLabel` per-model frozen map (bert B-/I- PER→PERSON, ORG→ORG, LOC→LOC; MISC/O/unknown→null; unknown model→null); keyed by model id so 06-03 adds piiranha without touching bert.
- **`ner-overlap.ts`** — `dropNerOverlaps` removes every pii-ner finding overlapping any non-pii-ner span (D-11), length-agnostic, as a separate pass leaving `dedupBySpan` byte-unchanged.
- **D-07 reconcile** — `pii.ner.confidence` default 0.9 → 0.7 (field name preserved).
- **CI never downloads the model:** all 29 NER-suite tests pass against a mocked pipeline.

## Task Commits

1. **Task 0: confidence default 0.9→0.7 + transformers.js shape verification** - `3c83a6c` (fix)
2. **Task 1 RED: pipeline-singleton + ner-entities tests** - `e56ae50` (test)
3. **Task 1 GREEN: pipeline-singleton + ner-entities impl** - `d58b8a1` (feat)
4. **Task 2 RED: layer6b-ner + ner-overlap tests** - `f3dfb27` (test)
5. **Task 2 GREEN: layer6b-ner + ner-overlap impl** - `e14b9fb` (feat)

_TDD tasks 1 & 2 each have a RED (failing test) → GREEN (implementation) pair. No refactor commits were needed._

## Files Created/Modified

- `src/model/pipeline-singleton.ts` (NEW) - Warm NER singleton; sole `@huggingface/transformers` dynamic import; cacheDir-before-load.
- `src/detect/layer6b-ner.ts` (NEW) - L6b engine: BIO aggregation + min_score + label map + dual fail-closed.
- `src/detect/ner-entities.ts` (NEW) - `mapModelLabel` per-model BIO → canonical entity map.
- `src/detect/ner-overlap.ts` (NEW) - `dropNerOverlaps` D-11 cross-source filter.
- `tests/model/pipeline-singleton.test.ts`, `tests/detect/{ner-entities,layer6b-ner,ner-overlap}.test.ts` (NEW) - mocked-pipeline unit tests (no download).
- `src/config/defaults.ts` (MOD) - `confidence: 0.9 → 0.7` (D-07).
- `src/shared/types.ts` (MOD) - JSDoc note on `confidence` documenting D-07 / CONTEXT min_score.
- `tests/config/pii-schema.test.ts` (MOD) - updated ner confidence default assertion to 0.7.

## Wave-0 Findings (transformers.js v4 — required by plan output)

| Question | Observed |
|----------|----------|
| Char offsets on per-token output? | **NO** — keys are `{entity, score, index, word}` only |
| Grouped aggregation available? | `aggregation_strategy:'simple'` works (`{entity_group, score, word}`) but is **also offset-less** |
| Chosen aggregation route | **Route B (manual BIO + self-computed offsets)** |
| `dtype:'int8'` → file | `onnx/model_int8.onnx` (landed at the SHA-pinned cache path) |
| WordPiece subword convention | `##`-prefixed (e.g. `##sch`); `B-`/`I-` BIO labels |
| Backend | `env.backends.onnx` truthy → `onnxruntime-node` |

**Exported signatures (06-02 consumes these):**
- `getNerPipeline(ner: MrcleanPiiNerConfig): Promise<NerPipeline>` · `getNerBackend(): string` · `resetNerSingleton(): void`
- `runLayer6bNer(text, ner, config, coveredSpans?): Promise<{ findings: Finding[]; status: NerStatus }>` · `type NerStatus = 'ready'|'unavailable'|'loading'|'disabled'`
- `mapModelLabel(model: string, label: string): 'PERSON'|'ORG'|'LOC'|null`
- `dropNerOverlaps(findings: Finding[]): Finding[]`

## Decisions Made

See `key-decisions` frontmatter. Headlines: Route B manual aggregation (no offsets from the pipeline); MIN-of-subwords score; field name `confidence` preserved; `@ts-expect-error` on the optional-dep dynamic import.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated `tests/config/pii-schema.test.ts` confidence assertion 0.9 → 0.7**
- **Found during:** Task 2 (full-suite regression check)
- **Issue:** An existing test asserted `DEFAULT_CONFIG.pii.ner.confidence === 0.9`, which the intended D-07 change (Task 0) makes false — a regression caused directly by this plan's own config change.
- **Fix:** Updated the test name + assertion to `0.7` with a D-07 comment.
- **Files modified:** tests/config/pii-schema.test.ts
- **Verification:** unit suite went from 1 config failure → 0 config failures.
- **Committed in:** `e14b9fb` (Task 2 commit)

**2. [Rule 3 - Blocking] Restored regenerated `dist/cli.js` + `dist/mcp.js` build artifacts**
- **Found during:** Task 2 (pre-commit `git status`)
- **Issue:** A `tsup` rebuild (triggered during test runs) re-emitted the two tracked `dist/` bundles, leaving them dirty. These are build outputs, not part of plan 06-01's `files_modified`.
- **Fix:** `git checkout -- dist/cli.js dist/mcp.js` to restore the committed state; excluded from the task commit.
- **Verification:** `git diff --quiet dist/cli.js dist/mcp.js` clean before committing.
- **Committed in:** n/a (deliberately excluded)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking). **Impact:** Both necessary to keep the commit scoped to intended changes; no scope creep.

## Issues Encountered

- **Worktree path isolation:** initial Edits targeted the shared-checkout path and were rejected; switched to the worktree copies (absolute worktree-root paths). Resolved.
- **`timeout` unavailable on macOS** during the scratch install — re-ran without it. Resolved.

## Deferred Issues

- **`tests/hook/failclosed.test.ts` Test 4 & Test 5 fail (`expected null to be 2`).** Pre-existing and unrelated: the file is byte-identical to base commit `d7e58d2`, imports only `src/hook/failclosed.js` (also unchanged) + `node:child_process`, and asserts a `tsx`-spawned child's exit code — which is `null` in this sandbox (a tsx/spawn-environment issue). Logged to `deferred-items.md`; NOT fixed (SCOPE BOUNDARY — outside this plan's changes).

## Known Stubs

None. All four modules are fully implemented and wired into existing seams; the orchestrator/MCP wiring that consumes them is the explicit scope of Plans 06-02 and 06-03 (documented build order), not a stub.

## User Setup Required

None - no external service configuration required. (ML deps remain optionalDependencies, installed only on opt-in; CI uses a mocked pipeline.)

## Next Phase Readiness

- **Ready for 06-02 (orchestrator wiring + audit provenance):** `runLayer6bNer`, `dropNerOverlaps`, `getNerBackend` exported with locked signatures; wire `opts.ner` branch after L6a, then `dropNerOverlaps` before `dedupBySpan`.
- **Ready for 06-03 (MCP preload + piiranha tier):** `mapModelLabel` is keyed by model id; add the piiranha branch + second pinned SHA there without touching the bert branch. `getNerPipeline`/`resetNerSingleton` ready for boot preload + shutdown reset.
- **No blockers.** SOURCE_PRECEDENCE D-10 verified present (not re-added); findings.ts/dedupBySpan untouched.

## Self-Check: PASSED

- All 9 created files verified present on disk.
- All 5 task commits verified in git history (`3c83a6c`, `e56ae50`, `d58b8a1`, `f3dfb27`, `e14b9fb`).
- Verification gates: 0 static `@huggingface` imports in src/; 1 dynamic-import boundary; findings.ts byte-unchanged; SOURCE_PRECEDENCE ends `pii-regex, pii-ner` (D-10 present, not re-added); confidence default 0.7; all 4 NER suites pass (29 tests, mocked pipeline — no model download).

---
*Phase: 06-ner-inference-l6b-mcp-wiring*
*Completed: 2026-06-03*
