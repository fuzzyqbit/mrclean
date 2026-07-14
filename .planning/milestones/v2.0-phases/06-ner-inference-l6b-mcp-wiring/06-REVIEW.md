---
phase: 06-ner-inference-l6b-mcp-wiring
reviewed: 2026-06-03T00:00:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - src/config/defaults.ts
  - src/detect/index.ts
  - src/detect/layer6b-ner.ts
  - src/detect/ner-entities.ts
  - src/detect/ner-overlap.ts
  - src/mcp/server.ts
  - src/mcp/tools/check.ts
  - src/mcp/tools/redact.ts
  - src/model/constants.ts
  - src/model/pipeline-singleton.ts
  - src/shared/types.ts
  - tests/detect/layer6b-ner.test.ts
  - tests/detect/ner-entities.test.ts
  - tests/detect/ner-entities-piiranha.test.ts
  - tests/detect/ner-overlap.test.ts
  - tests/detect/orchestrator-ner.test.ts
  - tests/detect/ner-unreachable.test.ts
  - tests/model/pipeline-singleton.test.ts
  - tests/mcp/server-ner-preload.test.ts
  - tests/mcp/check-redact-ner.test.ts
findings:
  critical: 2
  warning: 5
  info: 4
  total: 11
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-06-03
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Phase 6 wires an opt-in NER lane (Layer 6b) into mrclean as an MCP-only detection layer.
The structural-unreachability invariant is **upheld** — verified both in source (the engine and
`@huggingface/transformers` are reached only via dynamic `import()`) and in the built `dist/cli.js`
bundle (the modules are wrapped in esbuild `__esm` lazy-init closures and the transformers package
is kept `external`, so the cold hook path never initializes them). The fail-closed-for-NER design,
no-raw-PII-leak DTOs, audit provenance destructure-pick, immutable orchestrator wiring, and the
D-11 cross-source overlap drop are all correct and well-tested.

Two BLOCKER-level issues stand out. First, the **pinned model SHA-256 is not enforced on the
runtime inference path** — `getNerPipeline` hands `env.allowRemoteModels = true` (the default) to
transformers.js, which downloads and loads the model directly from HuggingFace Hub, completely
bypassing `model-cache.ts`'s `verifyModelIntegrity`. The "model integrity" guarantee the constants
file advertises is real only for the manual `mrclean pii fetch-model` and `doctor` paths, not for
the model the engine actually executes. Second, the piiranha tier is selectable via
`pii.ner.model` and label-mapped, yet there is **no integrity/cache path for it at all** — selecting
it silently downloads an unverified ~317 MB model with zero SHA pinning, defeating the supply-chain
protection for a security tool. The remaining warnings concern dead fallbacks, a magic threshold,
and a latent score-gate boundary ambiguity.

## Critical Issues

### CR-01: Pinned model SHA-256 is never enforced on the runtime inference load path

**File:** `src/model/pipeline-singleton.ts:81-102`, `src/model/constants.ts:30-36`

**Issue:** The constants file states "All download + side-load paths verify against this constant
(fail-closed on mismatch)" and the audit provenance stamps every NER finding with
`model_rev: PINNED_MODEL_SHA256`, implying the loaded model matches that hash. But the actual
inference path does **not** verify it. `getNerPipeline` sets `env.allowRemoteModels = ner.allowDownload`
(default `true`, see `defaults.ts:58`) and calls `pipeline('token-classification', ner.model, …)`.
transformers.js then resolves the model from `env.cacheDir` or downloads it from HF Hub on a cache
miss — with **no** call to `verifyModelIntegrity` or `isModelCached`. `verifyModelIntegrity` is only
invoked from `doctor/checks.ts` and the explicit `mrclean pii fetch-model` CLI flow. A user who never
runs `fetch-model` (the zero-config default) gets an unverified model loaded straight from the network,
yet every audit record asserts `model_rev = <pinned sha>`. This is both a supply-chain integrity gap
(a poisoned/MITM'd HF response is loaded and executed) and a provenance-integrity lie (the audit log
claims a hash that was never checked against the bytes actually run).

**Fix:** Gate the pipeline build on a verified cache. Before calling `pipeline()`, ensure the model
is present at `MODEL_CACHE_PATH` and passes `verifyModelIntegrity`; set `env.allowRemoteModels = false`
so transformers can only load from the verified local cache. Acquire-and-verify on miss via
`model-cache.ts`:
```ts
// inside the async build, before pipeline():
const { isModelCached, verifyModelIntegrity, downloadModel } = await import('./model-cache.js')
const home = homedir()
if (!(await isModelCached(home)) || !(await verifyModelIntegrity(home))) {
  if (!ner.allowDownload) throw new Error('NER model absent/unverified and download disabled')
  await downloadModel(home) // downloadModel already fails closed on SHA mismatch
}
env.cacheDir = join(home, '.mrclean', 'models')
env.allowRemoteModels = false // force load from the SHA-verified cache only
```
If wiring the cache into the hot build is deferred, the audit `model_rev` must NOT assert a hash that
was never verified — emit the resolved-on-disk hash or omit the field.

### CR-02: piiranha tier is selectable and label-mapped but has no integrity/cache enforcement

**File:** `src/model/constants.ts:70-104`, `src/model/pipeline-singleton.ts:99-101`, `src/detect/ner-entities.ts:50-57`

**Issue:** `MrcleanPiiNerConfig.model` is a free-form string and `getNerPipeline` passes it verbatim
to `pipeline(…, ner.model, …)`. The piiranha branch in `ner-entities.ts` plus `PIIRANHA_MODEL_ID`
make piiranha a first-class selectable tier. But `model-cache.ts` is hardwired to bert: every
function uses `MODEL_CACHE_PATH` / `MODEL_DOWNLOAD_URL` / `PINNED_MODEL_SHA256`, and the
`PIIRANHA_DOWNLOAD_URL` / `PIIRANHA_PINNED_SHA256` / `PIIRANHA_CACHE_PATH` constants are **never
referenced by any code** (confirmed via grep — they appear only in `constants.ts`). Consequently, an
operator who sets `pii.ner.model = 'onnx-community/piiranha-…'` triggers an **unverified ~317 MB
download** with zero SHA pinning, and `doctor` will check the wrong (bert) hash. For a tool whose
entire premise is supply-chain confidentiality, shipping a selectable-but-unpinned model path is a
material security regression, not merely a "documented gap." It also imports the cc-by-nc-nd-4.0
license-acceptance concern into a code path that no longer gates on the operator's verified copy.

**Fix:** Parameterize `model-cache.ts` by model id so download/verify resolve the correct
URL+hash+path per `ner.model`, and route `getNerPipeline` through that verified-cache gate (see CR-01).
Until per-model integrity exists, reject any `ner.model` other than the pinned bert id at config-load
time (fail-closed) rather than silently downloading an unverified model:
```ts
// config validation:
if (config.pii.ner.enabled && config.pii.ner.model !== MODEL_ID && config.pii.ner.model !== PIIRANHA_MODEL_ID)
  throw new ConfigError(`Unsupported pii.ner.model: ${config.pii.ner.model}`)
// and refuse piiranha until PIIRANHA_* integrity is wired:
if (config.pii.ner.model === PIIRANHA_MODEL_ID)
  throw new ConfigError('piiranha tier has no integrity path yet; not selectable')
```

## Warnings

### WR-01: `nerStatus ?? getNerStatus()` fallback in the MCP tools is unreachable dead logic

**File:** `src/mcp/tools/check.ts:137`, `src/mcp/tools/redact.ts:142`

**Issue:** Both tools compute `nerStatus: outcome.result.nerStatus ?? getNerStatus()`. But
`runDetection`/`runDetectionReadOnly` always initialize `nerStatus` to a non-nullish string
(`'disabled'`) and only ever reassign it to other non-nullish enum values. `DetectionResult.nerStatus`
is typed `NerStatus` (non-optional, never `undefined`/`null`), so the `?? getNerStatus()` branch can
never execute. The comments claim it "falls back … when the run did not enter the L6b branch," but the
disabled path already yields `'disabled'`, not nullish. This means the boot-preload `getNerStatus`
closure is plumbed through both tools but never actually consulted — the per-run status always wins,
even when NER config is off and the preload would report `'loading'`/`'unavailable'`. If the intent is
to surface the boot-preload state on the no-NER-per-call path, the condition is wrong; if not, the
closure plumbing is dead weight.

**Fix:** Decide the intended semantics. If the per-run status is authoritative (current behavior), drop
the `?? getNerStatus()` and the `getNerStatus` parameter entirely. If the boot state should surface when
the L6b branch was not entered, change the result type to make that explicit (e.g. return `'disabled'`
only when NER is config-off and otherwise let the closure provide `loading`/`ready`/`unavailable`), and
test that path — no current test exercises a non-nullish-vs-closure divergence.

### WR-02: Inference path ignores `min_length`/empty-text guard, allowing degenerate spans through aggregation

**File:** `src/detect/layer6b-ner.ts:211-217`

**Issue:** `runLayer6bNer` calls `pipe(text)` and `aggregateBio(raw, text)` with no guard on `text`.
For empty or whitespace-only input the pipeline still runs (a needless model invocation), and more
importantly `aggregateBio`'s forward-scan `locateToken` uses `text.indexOf(surface, cursor)`. If two
identical surface forms appear and a token cannot be placed (e.g. a subword that does not match due to
casing/normalization differences between the tokenizer's `word` field and the source text), the run is
silently flushed and the entity is dropped — there is no telemetry or fallback. While the explicit
`start`/`end` branch covers models that emit offsets, the bert "Route B" reconstruction is brittle for
any normalization mismatch (accent folding, lowercasing, `[UNK]` tokens), and a dropped span is a
**silent recall miss** in a security-detection layer with no signal to the operator.

**Fix:** Add an early `if (text.length === 0) return { findings: [], status: 'ready' }` to skip the
model call, and treat an unplaceable token in a model that emits no offsets as a degraded condition
worth surfacing (e.g. count unplaceable tokens; if a non-trivial fraction fail to locate, return
`status: 'unavailable'` so the operator knows NER under-detected rather than silently passing).

### WR-03: Score gate `s.score < ner.confidence` semantics undocumented at the boundary; default 0.7 is a magic number

**File:** `src/detect/layer6b-ner.ts:221`, `src/config/defaults.ts:59`

**Issue:** The confidence floor is applied as `if (s.score < ner.confidence) continue`, so a span
exactly at `0.7` is kept. The config field is documented as "below which entity spans are dropped,"
which is consistent, but the `0.7` literal is a bare magic number in `defaults.ts` with no named
constant, and the MIN-subword aggregation in `aggregateBio` makes the effective threshold sensitive to
the weakest subword — a subtlety that should be pinned by a named constant and an explicit boundary
test. There is no test asserting the exact-boundary behavior (score === confidence), so a future flip
to `<=` would pass silently.

**Fix:** Extract a named constant (e.g. `DEFAULT_NER_CONFIDENCE = 0.7`) and add a boundary unit test
asserting a span with `score === ner.confidence` is retained. Document the half-open `[confidence, 1]`
keep-interval in the engine JSDoc.

### WR-04: `quant` audit field trusts `config.pii.ner.dtype` rather than the dtype actually loaded

**File:** `src/detect/index.ts:446`, `src/model/pipeline-singleton.ts:99-101`

**Issue:** The audit provenance sets `quant: config.pii.ner.dtype`. This is the *requested* dtype, not
necessarily the *resolved* one. `dtype` is typed as a free-form `string` (`types.ts:232`), and
transformers.js may fall back to a different quantization (or reject an unknown dtype). The audit
record therefore can assert `quant: 'int8'` for a model that loaded as `fp32` (or vice versa) — the
same provenance-integrity concern as CR-01, scaled down. Pitfall 6 (cited in the audit JSDoc)
explicitly notes quant affects recall, so a wrong `quant` undermines the reproducibility the field
exists to provide.

**Fix:** Capture the resolved dtype from the pipeline build (alongside `backendLabel`) and expose it via
a `getNerQuant()` accessor, mirroring `getNerBackend()`. Have the orchestrator read the resolved value
rather than the config request. At minimum, constrain `dtype` to a `'int8' | 'fp32'` union in `types.ts`.

### WR-05: `pii.ner.actions` config is defined and merged but never consulted by the NER engine

**File:** `src/config/defaults.ts:60-64`, `src/detect/layer6b-ner.ts:242`, `src/shared/types.ts:245-249`

**Issue:** `MrcleanPiiNerConfig.actions` (PERSON/ORG → warn, LOC → audit) is a full config surface with
defaults and last-wins merge semantics, and the defaults header comment promises "pii.ner.actions:
PERSON/ORG → warn; LOC → audit." But `runLayer6bNer` hardcodes `action: 'substitute'` for every NER
finding and never reads `ner.actions`. An operator who sets `pii.ner.actions.LOC = 'audit'` expecting
LOC entities to be logged-only (not substituted) gets silent substitution instead — a behavior/config
mismatch. Contrast L6a (`layer6a-pii.ts:201`) which correctly reads `piiConfig.actions[entity]`.

**Fix:** Either consult `ner.actions[canonical]` when building the finding (mapping warn→audit per the
orchestrator's step 8a), or, if D-02 ("NER never blocks, always substitute") deliberately overrides the
action map, remove `actions` from `MrcleanPiiNerConfig` and the defaults so the config surface does not
advertise a knob that does nothing.

## Info

### IN-01: Duplicated span/BIO helpers across L6a, L6b, and ner-overlap

**File:** `src/detect/layer6b-ner.ts:66-90`, `src/detect/ner-overlap.ts:29-34`, `src/detect/layer6a-pii.ts:100-109`, `src/detect/findings.ts:116-118`

**Issue:** `overlapsCovered` is copy-pasted verbatim in `layer6a-pii.ts` and `layer6b-ner.ts`;
`spansOverlap` is re-implemented in `ner-overlap.ts` and `findings.ts`; `bioTag` (layer6b) and
`stripBio` (ner-entities) are the same function under two names. The comments acknowledge the copies
("copied so this pass is self-contained"), but this is exactly the DRY drift the coding-style rule warns
against — a fix to the half-open overlap convention now has four edit sites.

**Fix:** Extract a shared `spans.ts` (`overlapsCovered`, `spansOverlap`) and a shared BIO helper, and
import them across layers.

### IN-02: `aggregateBio` ignores `cursor` monotonicity when honoring explicit token offsets

**File:** `src/detect/layer6b-ner.ts:104-105, 151-157`

**Issue:** When `locateToken` returns explicit `tok.start`/`tok.end`, `cursor` is then set to
`loc.end` (line 157) but the explicit branch never *checks* that `loc.start >= cursor`. A model that
emits non-monotonic offsets (or mixes offset-bearing and offset-less tokens) could produce overlapping
or backward spans. Not exploitable today (bert emits no offsets, so only Route B runs), but it is a
latent correctness hazard for the future piiranha/offset-bearing models the code explicitly anticipates.

**Fix:** Clamp/validate explicit offsets against `cursor` (skip or flush when `loc.start < cursor`).

### IN-03: Magic truncation lengths in provenance engine string

**File:** `src/detect/index.ts:444`

**Issue:** `engine: \`pii-ner@${PINNED_MODEL_SHA256.slice(0, 12)}\`` uses a bare `12`. The
`redactedHash` truncation elsewhere uses `16` (findings.ts:75). The inconsistent, unnamed slice length
is a minor maintainability smell.

**Fix:** Name the constant (e.g. `ENGINE_SHA_PREFIX_LEN = 12`) or reuse an existing one.

### IN-04: `defaults.ts` over-uses `as unknown as T` casts that defeat the frozen-config type safety

**File:** `src/config/defaults.ts:18-67`

**Issue:** Nearly every nested value is double-cast `Object.freeze({…}) as unknown as SomeType`. The
`as unknown as` pattern erases type checking on the literal, so a typo in a default (wrong key, wrong
enum) would not be caught at compile time — for a security tool's default policy this is the riskiest
place to lose type safety. The freezing is good; the casts are not.

**Fix:** Type the literals directly (`const DEFAULT_CONFIG: MrcleanConfig = { … }`) and freeze without
the `as unknown as` escape hatch; `Object.freeze` preserves the inferred type, so the casts are
unnecessary and actively harmful.

---

_Reviewed: 2026-06-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
