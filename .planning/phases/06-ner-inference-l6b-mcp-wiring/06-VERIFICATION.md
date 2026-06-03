---
phase: 06-ner-inference-l6b-mcp-wiring
verified: 2026-06-03T00:00:00Z
status: gaps_found
score: 3/4 success-criteria verified (SC-4 failed on provenance/integrity)
overrides_applied: 0
re_verification:
gaps:
  - truth: "SC-4: piiranha tier loads in place of the default, AND every PII audit entry records model_rev/quant/backend so the same input + PINNED model reproduces identical entries across machines (D-06: singleton loads via the SHA-256-verified model-cache.ts path; MODEL-04 provenance must be truthful)"
    status: failed
    reason: >
      The runtime inference path (getNerPipeline) loads the model directly via
      transformers.js with env.allowRemoteModels = ner.allowDownload (default true) and
      NEVER calls verifyModelIntegrity / isModelCached / downloadModel. The pinned
      SHA-256 (Phase 5) is enforced ONLY on the manual `mrclean pii fetch-model` and
      `doctor` paths — not on the bytes the engine actually executes. Yet every NER
      audit entry hardcodes model_rev = PINNED_MODEL_SHA256. The provenance is asserted,
      not verified: on a zero-config first run the model is downloaded unverified from HF
      Hub while the audit log claims a hash that was never checked against the loaded
      bytes. This breaks D-06 and the MODEL-04/SC-4 reproducibility contract (a poisoned
      or quant-substituted model would still stamp the pinned hash, so "same input +
      PINNED model reproduces identical entries" is not actually guaranteed). Separately,
      the piiranha tier is selectable via pii.ner.model and label-mapped, but
      PIIRANHA_DOWNLOAD_URL / PIIRANHA_PINNED_SHA256 / PIIRANHA_CACHE_PATH are referenced
      by ZERO code (model-cache.ts is hardwired to bert). Selecting piiranha triggers an
      unverified ~317 MB download with no SHA pinning, and doctor checks the wrong (bert)
      hash. The "loads in place of the default" clause is partially met (config swaps the
      model id + label map) but the "verified / reproducible" half of SC-4 is not.
    artifacts:
      - path: "src/model/pipeline-singleton.ts"
        issue: >
          getNerPipeline sets env.allowRemoteModels = ner.allowDownload and calls
          pipeline('token-classification', ner.model, { dtype }) with no
          isModelCached/verifyModelIntegrity gate. No integrity check on the inference
          load path. (lines 78-105)
      - path: "src/detect/index.ts"
        issue: >
          Audit provenance hardcodes model_rev = PINNED_MODEL_SHA256 (line 445) and
          engine = `pii-ner@${PINNED_MODEL_SHA256.slice(0,12)}` (line 444) regardless of
          whether the loaded bytes match that hash. quant = config.pii.ner.dtype (line
          446) is the requested, not resolved, dtype. For piiranha the stamped hash is
          flat-out wrong (still the bert hash).
      - path: "src/model/constants.ts"
        issue: >
          PIIRANHA_DOWNLOAD_URL (74), PIIRANHA_PINNED_SHA256 (83), PIIRANHA_CACHE_PATH
          (94) are dead constants — grep confirms zero references outside this file.
          model-cache.ts imports only the bert MODEL_CACHE_PATH/MODEL_DOWNLOAD_URL/
          PINNED_MODEL_SHA256, so no integrity path exists for piiranha.
      - path: "src/model/model-cache.ts"
        issue: >
          Hardwired to bert: every function resolves MODEL_CACHE_PATH/MODEL_DOWNLOAD_URL/
          PINNED_MODEL_SHA256. Not parameterized by model id, so it cannot verify the
          piiranha tier even if the inference path were routed through it.
      - path: "tests/model/pipeline-singleton.test.ts"
        issue: >
          Test (lines 125-132) asserts env.allowRemoteModels is set from
          ner.allowDownload — i.e. the suite codifies the unverified-download behavior. No
          test anywhere asserts an integrity gate on the inference path (grep:
          verifyModelIntegrity/isModelCached appear only in doctor + model-cache tests).
    missing:
      - "Route getNerPipeline through the SHA-256-verified cache (D-06): ensure the model is present at the per-model cache path and passes verifyModelIntegrity before pipeline(); set env.allowRemoteModels = false so transformers loads only from the verified local cache; acquire-and-verify on a cache miss via downloadModel (which already fails closed on mismatch)."
      - "Parameterize model-cache.ts by model id so download/verify/cache-path resolve the correct URL + pinned hash + path per pii.ner.model — wiring PIIRANHA_* into a real integrity path (or, until then, reject pii.ner.model === PIIRANHA_MODEL_ID at config load, fail-closed)."
      - "Reject any pii.ner.model other than a known, pinned id at config-load time instead of silently downloading an unverified model."
      - "Make audit provenance truthful: emit the resolved on-disk SHA-256 of the loaded model as model_rev (or omit the field) rather than unconditionally asserting PINNED_MODEL_SHA256; capture the resolved dtype/backend rather than the requested config dtype (WR-04)."
      - "Add a test that fails when the inference path loads a model without an integrity check (lock the D-06 invariant)."
deferred:
human_verification:
  - test: "With pii.ner.enabled and pii.ner.model = PIIRANHA_MODEL_ID set in config, observe what mrclean does on first MCP check/redact (confirm whether an unverified ~317 MB download occurs and whether the audit entry stamps the bert hash)."
    expected: "After the gap fix: piiranha either loads from a SHA-verified cache OR config-load rejects it fail-closed; audit model_rev reflects the actually-loaded piiranha hash, never the bert hash."
    why_human: "Requires a network model download and a running MCP server with the opt-in license-accepted piiranha tier — not exercisable from mocked unit tests."
  - test: "On a clean machine with no ~/.mrclean/models cache, enable NER and issue an MCP redact on prose with a person name; inspect .mrclean/audit.jsonl."
    expected: "The model is loaded only from a SHA-256-verified local cache (D-06), and model_rev in the audit entry matches the SHA of the bytes actually loaded."
    why_human: "Real model load + audit-on-disk inspection; the unit suite mocks the pipeline and cannot prove the on-disk integrity guarantee."
---

# Phase 6: NER Inference (L6b) + MCP Wiring — Verification Report

**Phase Goal:** Opt-in PERSON/ORG/LOCATION NER as a warm singleton inside the long-lived MCP server only (never the hook), advisory (substitute-but-never-deny), fail-closed-for-NER, with model revision/quant/backend recorded in every PII audit entry; plus a higher-recall piiranha tier swap via config.

**Verified:** 2026-06-03
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | With `pii.ner.enabled`, MCP check/redact return NER findings on prose; per-event hook never loads a model (no pipeline import reachable from hook path; cold-start unchanged) | ✓ VERIFIED | Orchestrator gates L6b on `opts.ner && config.pii.ner.enabled` (`src/detect/index.ts:268,376`); layer6b reached only via `await import('./layer6b-ner.js')`; `@huggingface/transformers` reached only via dynamic `import()` (`pipeline-singleton.ts:86`). Hook handlers call `runDetection` without opts. Dist bundle confirms: only 2 `@huggingface/transformers` refs in `dist/cli.js` — a package.json echo + a dynamic `await import(...)`, no static top-level import. `tests/detect/ner-unreachable.test.ts` (import-graph proof) passes. |
| 2 | A NER-only finding defaults to warn/audit and does NOT hard-block; only deterministic secret layers (+checksum'd PII) block; min_score drops low-confidence entities | ✓ VERIFIED | `runLayer6bNer` emits `action: 'substitute'` explicitly, never block (`layer6b-ner.ts:242`); D-11 `dropNerOverlaps` drops any pii-ner span overlapping a higher-precedence span before dedup (`index.ts:277,385`); score gate `if (s.score < ner.confidence) continue` drops low-confidence; default `confidence: 0.7` (`defaults.ts:57`). 55 NER unit tests pass. |
| 3 | On model load/inference failure MCP tools return nerStatus 'unavailable', fall back to L1-4 + regex-PII, never crash the secret gate | ✓ VERIFIED | Double try/catch (load + inference) each returns `{ findings: [], status: 'unavailable' }` and never re-throws (`layer6b-ner.ts:204-214`); MCP server eager preload is fire-and-forget `void (async () => …)()` that never blocks `server.connect()` (`server.ts:53-61`); tools surface nerStatus (`check.ts:137`, `redact.ts:142`). `tests/mcp/server-ner-preload.test.ts` passes. |
| 4 | Switching `pii.ner.model` to piiranha loads it in place of the default; every PII audit entry records model_rev + quant + backend so same input + PINNED model reproduces identical entries across machines | ✗ FAILED | Inference path loads via transformers.js with `env.allowRemoteModels = ner.allowDownload` (default `true`) and NO `verifyModelIntegrity`/`isModelCached` gate (`pipeline-singleton.ts:90,99`). Audit hardcodes `model_rev = PINNED_MODEL_SHA256` without verifying loaded bytes (`index.ts:445`). piiranha integrity constants referenced by zero code — selecting piiranha downloads an unverified ~317 MB model and stamps the wrong (bert) hash. D-06 ("singleton loads via the SHA-256-verified model-cache.ts path") violated; reproducibility/provenance contract not honestly enforced. |

**Score:** 3/4 success criteria verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/model/pipeline-singleton.ts` | warm-singleton lazy-import | ✓ VERIFIED (exists/substantive/wired) but feeds the FAILED truth #4 | Dynamic import boundary correct; missing the integrity gate. |
| `src/detect/layer6b-ner.ts` | L6b engine + NerStatus | ✓ VERIFIED | fail-closed, substitute-only, score gate. |
| `src/detect/ner-entities.ts` | per-model label map incl. piiranha | ✓ VERIFIED | bert `{PER→PERSON,ORG→ORG,LOC→LOC}`; piiranha `{GIVENNAME,SURNAME}→PERSON, {CITY,STREET,ZIPCODE,BUILDINGNUM}→LOC`, no ORG — correct remap. |
| `src/detect/ner-overlap.ts` | D-11 pre-dedup filter | ✓ VERIFIED | drops pii-ner spans overlapping higher-precedence findings. |
| `src/detect/index.ts` | opts.ner wiring + provenance | ⚠️ wired but provenance untruthful (truth #4) | Gating + dropNerOverlaps correct; `model_rev` hardcoded. |
| `src/mcp/server.ts` | fire-and-forget preload + getNerStatus | ✓ VERIFIED | |
| `src/model/constants.ts` | piiranha quartet | ⚠️ exists but 3 of 4 piiranha constants are dead code | `PIIRANHA_DOWNLOAD_URL/PINNED_SHA256/CACHE_PATH` referenced nowhere. |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| pipeline-singleton.ts | @huggingface/transformers | dynamic `await import()` | ✓ WIRED |
| layer6b-ner.ts | pipeline-singleton.ts | `getNerPipeline` in fail-closed try/catch | ✓ WIRED |
| detect/index.ts | layer6b-ner.js | `await import('./layer6b-ner.js')` behind opts.ner gate | ✓ WIRED |
| detect/index.ts | ner-overlap dropNerOverlaps | pre-dedup filter | ✓ WIRED |
| detect/index.ts | audit findingToAuditRecord provenance | model_rev/quant/backend | ⚠️ WIRED but provenance values not verified against loaded model |
| check.ts / redact.ts | runDetection(ReadOnly) | `{ ner: true }` + reads nerStatus | ✓ WIRED |
| **pipeline-singleton.ts** | **model-cache.ts verifyModelIntegrity** | **integrity gate on inference load (D-06)** | **✗ NOT_WIRED — the core gap** |
| **constants.ts PIIRANHA_*** | **model-cache.ts** | **per-model integrity path** | **✗ NOT_WIRED — dead constants** |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| ----------- | ----------- | ------ | -------- |
| NER-01 (opt-in warm singleton, hook-unreachable) | 06-01, 06-02, 06-03 | ✓ SATISFIED | Truth #1. |
| NER-02 (min_score, advisory not deny) | 06-01 | ✓ SATISFIED | Truth #2. |
| NER-03 (fail-closed for NER only) | 06-01 | ✓ SATISFIED | Truth #3. |
| NER-04 (piiranha tier selectable, swappable) | 06-03 | ✗ BLOCKED | Selectable + label-mapped, but no integrity/cache path → unverified ~317 MB download; doctor checks wrong hash. Partial: swap mechanics work, supply-chain verification does not. |
| MODEL-04 (audit records model_rev+quant+backend, no raw PII, for reproducibility) | 06-02 | ✗ BLOCKED | Fields populated and no-raw-value guarantee upheld, BUT model_rev asserts an unverified hash (and the wrong hash for piiranha), and quant is the requested not resolved dtype — provenance is not truthful, defeating reproducibility. No orphaned requirements (all 5 map to Phase 6 and appear in plan frontmatter). |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| pipeline-singleton.ts | 90,99 | inference load with `allowRemoteModels=true`, no integrity gate | 🛑 Blocker | Unverified model executed; D-06 violated. |
| detect/index.ts | 445 | hardcoded `model_rev = PINNED_MODEL_SHA256` | 🛑 Blocker | Provenance asserts an unverified/incorrect hash (MODEL-04). |
| constants.ts | 74,83,94 | `PIIRANHA_*` dead constants (zero refs) | 🛑 Blocker | piiranha selectable but unpinned. |
| detect/index.ts | 446 | `quant = config.pii.ner.dtype` (requested, not resolved) | ⚠️ Warning | Audit may assert wrong quant (WR-04). |
| check.ts/redact.ts | 137,142 | `nerStatus ?? getNerStatus()` unreachable dead branch | ⚠️ Warning | Dead plumbing; does not break the goal (WR-01). |

No debt markers (TBD/FIXME/XXX) found in modified files. No raw-PII-leak anti-patterns — audit and MCP DTOs correctly omit value/span (verified clean).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| NER unit + integration suite | `vitest run` (9 NER files) | 9 files / 55 tests passed | ✓ PASS |
| Hook-path unreachability (dist) | `grep @huggingface/transformers dist/cli.js` | only dynamic `await import(...)` + package.json echo; no static import | ✓ PASS |
| Integrity-on-inference assertion | grep tests for verifyModelIntegrity on inference path | none — only doctor/model-cache paths; pipeline-singleton test asserts `allowRemoteModels` from `allowDownload` | ✗ FAIL (confirms the gap is uncovered) |

### Independent Assessment of Code-Review BLOCKERs

- **CR-01 (pinned SHA not enforced on inference path):** CONFIRMED against the codebase and material to the goal. `getNerPipeline` (`pipeline-singleton.ts:78-105`) sets `env.allowRemoteModels = ner.allowDownload` (default `true` per `defaults.ts:58`) and calls `pipeline()` with no `isModelCached`/`verifyModelIntegrity`. Those functions are called ONLY from `cli.ts` (fetch-model) and `doctor/checks.ts`. Audit stamps `model_rev = PINNED_MODEL_SHA256` (`index.ts:445`) regardless. This directly violates D-06 and breaks the MODEL-04/SC-4 "same input + PINNED model reproduces identical entries" guarantee because the provenance is asserted, never verified — a poisoned/MITM'd or quant-substituted model would still be stamped with the pinned hash. **Real gap.**
- **CR-02 (piiranha selectable but unverified):** CONFIRMED. `PIIRANHA_DOWNLOAD_URL/PIIRANHA_PINNED_SHA256/PIIRANHA_CACHE_PATH` have zero references outside `constants.ts` (grep-confirmed); `model-cache.ts` imports only the bert trio. Selecting `pii.ner.model = PIIRANHA_MODEL_ID` routes through the same unverified inference load → unverified ~317 MB download, and `doctor` verifies the wrong (bert) hash. SC-4's "loads in place of the default" is mechanically partially met but the verified/reproducible requirement is not. **Real gap.**

### Verified-Clean Items (independently confirmed)

- Structural unreachability of the NER engine + transformers dep from the hook path — confirmed in source (dynamic import only) AND in `dist/cli.js` (esbuild lazy `__esm` / `external`, no static import).
- Fail-closed-for-NER: load + inference double try/catch → `unavailable`, server still boots and serves secret detection.
- No-raw-PII: audit `findingToAuditRecord` and MCP finding DTOs omit `value`/`span` (documented + enforced).
- Immutable orchestrator wiring; D-11 cross-source overlap drop; piiranha label remap correct (no ORG).

### Human Verification Required

See `human_verification` in frontmatter — 2 items requiring a real model download + on-disk audit inspection (not exercisable from the mocked unit suite). These are secondary to the BLOCKER gap; they become the acceptance checks AFTER gap closure.

### Gaps Summary

Three of four success criteria are fully achieved: the NER lane is opt-in, MCP-only, structurally unreachable from the hook (verified in source and dist), advisory/substitute-not-deny, and fail-closed for NER only. **SC-4 fails on its security/reproducibility half.** The model the engine actually executes is loaded straight from HuggingFace Hub with `allowRemoteModels` defaulting to `true` and NO call to the Phase 5 SHA-256 verification — contradicting D-06's explicit "singleton loads via the SHA-256-verified model-cache.ts path." Every NER audit entry nonetheless hardcodes `model_rev = PINNED_MODEL_SHA256`, so the provenance is a claim rather than a verified fact; this defeats the MODEL-04/SC-4 reproducibility guarantee. The piiranha tier compounds this: it is selectable and label-mapped, but its three integrity constants are dead code and `model-cache.ts` is hardwired to bert, so selecting piiranha silently downloads an unverified ~317 MB model and stamps the wrong hash. The root cause is a single missing wire — `getNerPipeline` must route through a per-model SHA-verified cache (set `allowRemoteModels = false`, acquire-and-verify on miss) and the audit provenance must reflect the bytes actually loaded. This is a Phase 6 concern (NER-04 / MODEL-04 / D-06); Phase 7 covers leak-grep + honest framing only and does NOT address model integrity, so the gap is not deferrable.

---

_Verified: 2026-06-03_
_Verifier: Claude (gsd-verifier)_
