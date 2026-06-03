---
phase: 06-ner-inference-l6b-mcp-wiring
verified: 2026-06-03T07:33:00Z
status: passed
score: 4/4 success-criteria verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 3/4
  gaps_closed:
    - "SC-4: piiranha tier loads via SHA-256-verified per-model cache; truthful per-model provenance"
  gaps_remaining: []
  regressions: []
gaps:
deferred:
human_verification:
  - test: "On a clean machine with no ~/.mrclean/models cache, enable NER (default bert tier) and issue an MCP redact on prose with a person name; inspect .mrclean/audit.jsonl."
    expected: "The model is loaded only from a SHA-256-verified local cache (D-06); model_rev in the audit entry equals PINNED_MODEL_SHA256 (the SHA of the bytes actually loaded). If the on-disk bytes were tampered, NER degrades to nerStatus 'unavailable' and secrets still serve."
    why_human: "Real model load + audit-on-disk inspection; the unit suite mocks the pipeline + model-cache and cannot prove the on-disk integrity guarantee end-to-end against a live HuggingFace download."
  - test: "Set pii.ner.model = PIIRANHA_MODEL_ID (license already accepted) with allowDownload=true on a clean cache and issue an MCP redact on a person name; inspect .mrclean/audit.jsonl."
    expected: "piiranha is acquired-and-verified against PIIRANHA_PINNED_SHA256 (not the bert hash); audit model_rev === PIIRANHA_PINNED_SHA256. With allowDownload=false and no cached file, NER fails closed (nerStatus 'unavailable'); no unverified ~317 MB download occurs."
    why_human: "Requires a network model download of the opt-in license-accepted piiranha tier and a running MCP server — not exercisable from mocked unit tests."
---

# Phase 6: NER Inference (L6b) + MCP Wiring — Verification Report

**Phase Goal:** Opt-in PERSON/ORG/LOCATION NER as a warm singleton inside the long-lived MCP server only (never the hook), advisory (substitute-but-never-deny), fail-closed-for-NER, with model revision/quant/backend recorded in every PII audit entry; plus a higher-recall piiranha tier swap via config.

**Verified:** 2026-06-03
**Status:** passed (pending 2 end-of-phase human-UAT items — live model download + on-disk audit inspection)
**Re-verification:** Yes — after gap-closure plan 06-04 (SC-4 / supply-chain integrity)

## Re-Verification Summary

The prior verification (2026-06-03, initial) found **3/4 SCs passing, SC-4 FAILED** on the supply-chain/reproducibility half: `getNerPipeline` loaded the model with `env.allowRemoteModels = ner.allowDownload` (default `true`) and **no integrity gate**, while audit entries hardcoded `model_rev = PINNED_MODEL_SHA256` — provenance asserted, never verified; piiranha's three integrity constants were dead code.

Plan **06-04** was executed to close that single gap. This re-verification confirms against the **actual codebase** (not the SUMMARY) that **SC-4 is now CLOSED** and **SC-1, SC-2, SC-3 are NOT regressed**.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | With `pii.ner.enabled`, MCP returns NER findings on prose; per-event hook never loads a model (no pipeline import reachable from hook path; cold-start unchanged) | ✓ VERIFIED (no regression) | `dist/cli.js` after rebuild contains `@huggingface/transformers` at exactly two sites: a package.json version echo (L3420) and a dynamic `await import("@huggingface/transformers")` (L18751) — **zero static top-level imports** (`grep -c "from '@huggingface/transformers'" dist/cli.js` → 0). Importing the **stdlib-only** model-cache + constants into pipeline-singleton (06-04) added NO ML surface to the cold path: `grep -c "from '@huggingface/transformers'" src/model/pipeline-singleton.ts` → 0; its sole ML reference is the dynamic `import()` at `pipeline-singleton.ts:150`. `tests/detect/ner-unreachable.test.ts` passes. |
| 2 | A NER-only finding defaults to warn/audit and does NOT hard-block; min_score drops low-confidence entities | ✓ VERIFIED (no regression) | `runLayer6bNer` emits explicit `action: 'substitute'`, never block (`layer6b-ner.ts:242`); score gate `if (s.score < ner.confidence) continue` (`layer6b-ner.ts:222`). Full suite green; 06-04 touched none of this wiring (scope-guarded). |
| 3 | On model load/inference failure MCP returns nerStatus 'unavailable', falls back to L1-4 + regex-PII, never crashes the secret gate | ✓ VERIFIED (no regression + strengthened) | Load try/catch still wraps `getNerPipeline` (`layer6b-ner.ts:204-206` → `{ findings: [], status: 'unavailable' }`); inference try/catch at 213-214. The NEW integrity throw from `getNerPipeline` (mismatch / cache-miss-with-download-disabled) is caught by this exact boundary → degrades NER only. Test `pipeline-singleton.test.ts` (L207-224) asserts THROW-on-mismatch and THROW-on-miss-no-download; orchestrator/fail-closed tests confirm secrets still served. |
| 4 | Switching `pii.ner.model` to piiranha loads it VERIFIED against a pinned SHA-256; every PII audit entry records truthful model_rev/quant/backend so same input + PINNED model reproduces identical entries | ✓ VERIFIED (gap CLOSED) | `getNerPipeline` now resolves `MODEL_DESCRIPTORS[ner.model]` (throws on unknown), runs `isModelCached` + `verifyModelIntegrity` (or `downloadModel`, which verifies-before-rename) **before** `pipeline()`, and sets `env.allowRemoteModels = false` UNCONDITIONALLY (`pipeline-singleton.ts:119-156`). Audit provenance now reads `getNerResolvedSha256()` / `getNerResolvedDtype()` — per-model truthful, piiranha stamps the piiranha hash, omits when undefined (`detect/index.ts:453-460`). `MODEL_DESCRIPTORS` wires the formerly-dead `PIIRANHA_*` constants (`constants.ts:133-149`). Config rejects unknown `pii.ner.model` fail-closed (`config/index.ts:250-256`). 87 targeted tests + full 559-test suite green. |

**Score:** 4/4 success criteria verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/model/constants.ts` | `MODEL_DESCRIPTORS` wiring PIIRANHA_* | ✓ VERIFIED | Frozen `MODEL_DESCRIPTORS` keyed by `MODEL_ID` + `PIIRANHA_MODEL_ID` (L133-146); `ModelDescriptor` type (L121-126); `BERT_DESCRIPTOR` back-compat binding (L149). The previously-dead `PIIRANHA_DOWNLOAD_URL/PINNED_SHA256/CACHE_PATH` are now composed into the piiranha descriptor — no longer dead. Stdlib-only (no ML import). |
| `src/model/model-cache.ts` | descriptor-parameterized; piiranha reachable | ✓ VERIFIED | All four functions take optional trailing `descriptor: ModelDescriptor = BERT_DESCRIPTOR` and resolve `descriptor.cachePath/downloadUrl/pinnedSha256` (L73-83, 99-119, 169-230, 256-308). Verify-before-rename + unlink-on-mismatch invariants preserved. Back-compat: no-descriptor calls behave as bert. Stdlib-only. |
| `src/model/pipeline-singleton.ts` | verify-before-load, allowRemoteModels=false, fail-closed throw, resolved accessors | ✓ VERIFIED | Integrity gate L119-140 (resolve descriptor → isModelCached → verifyModelIntegrity → throw or downloadModel) precedes `pipeline()` at L165; `env.allowRemoteModels = false` (L156); `getNerResolvedSha256`/`getNerResolvedDtype` (L73-83) reset by `resetNerSingleton` (L89-93). Static transformers import count = 0; sole ML touch is dynamic import L150. |
| `src/config/index.ts` | unknown model rejected fail-closed | ✓ VERIFIED | `validatePiiNerConfig` rejects any `model` not in `MODEL_DESCRIPTORS` with `ConfigReadError` (L250-256); imports `MODEL_DESCRIPTORS` (L41). bert + piiranha both accepted. |
| `src/detect/index.ts` | truthful per-model provenance, no hardcoded bert hash | ✓ VERIFIED | `nerProvenance` built from `getNerResolvedSha256()`/`getNerResolvedDtype()` (L453-460); `model_rev`/`engine` omitted when sha undefined. `grep PINNED_MODEL_SHA256 src/detect/index.ts` → no matches (hardcoded hash removed). Provenance applied only for `f.source === 'pii-ner'` (L471); findingToAuditRecord destructure-pick unchanged → no raw PII. |
| `tests/model/pipeline-singleton.test.ts` | integrity path TESTED, not mocked-around | ✓ VERIFIED | Asserts verify/acquire BEFORE pipeline() (L181-191), allowRemoteModels===false unconditional (L170-179), THROW-on-miss-no-download never calls pipeline() (L207-215), THROW-on-mismatch never calls pipeline() (L217-224), piiranha descriptor carries PIIRANHA_PINNED_SHA256 (L226-234), unknown-model rejection (L236-240), resolved-sha accessors incl. piiranha (L242-259). Real assertions against the actual module. |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| pipeline-singleton.ts | model-cache.ts (isModelCached/verifyModelIntegrity/downloadModel) | integrity gate before pipeline() | ✓ WIRED (the core gap — now closed) |
| pipeline-singleton.ts | constants.ts MODEL_DESCRIPTORS | per-model descriptor resolution | ✓ WIRED |
| model-cache.ts | constants.ts ModelDescriptor/BERT_DESCRIPTOR | descriptor-parameterized url/hash/path | ✓ WIRED |
| config/index.ts | constants.ts MODEL_DESCRIPTORS | config-load rejection of unknown model | ✓ WIRED |
| detect/index.ts | getNerResolvedSha256/getNerResolvedDtype | truthful model_rev/quant | ✓ WIRED |
| layer6b-ner.ts | pipeline-singleton.ts getNerPipeline | fail-closed try/catch catches integrity throw | ✓ WIRED (SC-3 preserved) |
| pipeline-singleton.ts | @huggingface/transformers | dynamic `await import()` ONLY | ✓ WIRED (no static import — SC-1 preserved) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Targeted integrity + provenance + config suites | `vitest run model-cache pipeline-singleton orchestrator-ner ner-unreachable config` | 8 files / 87 tests passed | ✓ PASS |
| Full regression suite | `vitest run` | 72 files / 559 tests passed | ✓ PASS |
| Hook-path unreachability (dist) | `grep "@huggingface/transformers" dist/cli.js` | only pkg.json echo (L3420) + dynamic `await import()` (L18751); 0 static imports | ✓ PASS |
| allowRemoteModels gated off | `grep allowRemoteModels src/model/pipeline-singleton.ts` | `env.allowRemoteModels = false` (L156) | ✓ PASS |
| Integrity gate on inference path | `grep verifyModelIntegrity\|isModelCached\|downloadModel src/model/pipeline-singleton.ts` | all three imported (L31) + wired before pipeline() (L129-139) | ✓ PASS |
| Provenance not hardcoded | `grep PINNED_MODEL_SHA256 src/detect/index.ts` | no matches (sourced from getNerResolvedSha256) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| ----------- | ----------- | ------ | -------- |
| NER-01 (opt-in warm singleton, hook-unreachable) | 06-01/02/03 | ✓ SATISFIED | Truth #1; dist purity re-proven after 06-04. |
| NER-02 (min_score, advisory not deny) | 06-01 | ✓ SATISFIED | Truth #2; untouched by 06-04. |
| NER-03 (fail-closed for NER only) | 06-01 | ✓ SATISFIED | Truth #3; integrity throw caught by existing fail-closed boundary. |
| NER-04 (piiranha tier selectable AND verified) | 06-03, 06-04 | ✓ SATISFIED | piiranha now integrity-verified against PIIRANHA_PINNED_SHA256 via MODEL_DESCRIPTORS; no unverified ~317 MB download; unknown models rejected at config load. |
| MODEL-04 (audit records truthful model_rev+quant+backend, no raw PII) | 06-02, 06-04 | ✓ SATISFIED | model_rev = resolved per-model pinned sha (piiranha stamps piiranha hash); quant = resolved dtype; no-raw-PII destructure-pick preserved. |

No orphaned requirements — all 5 (NER-01..04, MODEL-04) map to Phase 6 and appear in plan frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | (prior 3 BLOCKERs resolved) | — | `allowRemoteModels=true` no-gate → now `=false` + gated; hardcoded `model_rev` → now resolved; dead `PIIRANHA_*` → now wired via MODEL_DESCRIPTORS. No new anti-patterns. |

No debt markers (TBD/FIXME/XXX) introduced. No raw-PII-leak: audit/MCP DTOs omit value/span (re-confirmed; orchestrator test 6 asserts no raw value). The prior WR-04 warning (quant = requested dtype) is resolved — quant now prefers resolved dtype.

### Independent Assessment of Prior BLOCKERs (now resolved)

- **CR-01 (pinned SHA not enforced on inference path):** RESOLVED. `getNerPipeline` routes through `isModelCached`+`verifyModelIntegrity` (or fail-closed `downloadModel`) before `pipeline()` and sets `allowRemoteModels=false` (`pipeline-singleton.ts:119-156`). Locked by tests asserting verify-before-load + throw-on-mismatch (no pipeline() call) — `pipeline-singleton.test.ts:181-224`.
- **CR-02 (piiranha selectable but unverified):** RESOLVED. `MODEL_DESCRIPTORS[PIIRANHA_MODEL_ID]` composes the formerly-dead piiranha constants; the inference path verifies the piiranha hash/path (`pipeline-singleton.test.ts:226-259`); config rejects unknown models fail-closed.

### Human Verification Required

See `human_verification` in frontmatter — 2 end-of-phase UAT items requiring a live model download + on-disk audit inspection (mocked unit suite cannot prove the on-disk integrity guarantee against a real HuggingFace fetch). These are acceptance checks for the now-closed SC-4, not blockers: the integrity logic, fail-closed behavior, and per-model provenance are fully verified in source and locked by tests.

### Gaps Summary

No gaps. The single SC-4 BLOCKER from the initial verification is closed: the inference engine now loads ONLY a SHA-256-verified local model (per-model bert AND piiranha) with `allowRemoteModels=false`, fails closed on mismatch / missing-with-download-disabled (caught by the existing NER fail-closed boundary), rejects unknown `pii.ner.model` at config load, and stamps truthful per-model provenance (piiranha → piiranha hash, never the bert hash; omitted when unavailable). The three previously-passing SCs are confirmed not regressed — most importantly SC-1's structural hook-path unreachability holds at the dist level (0 static `@huggingface/transformers` imports; importing the stdlib-only model-cache/constants pulled no ML dep onto the cold path). Full 559-test suite passes.

---

_Verified: 2026-06-03 (re-verification after 06-04 gap closure)_
_Verifier: Claude (gsd-verifier)_
