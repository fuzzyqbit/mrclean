/**
 * Warm NER pipeline singleton (Layer 6b model lifecycle).
 *
 * ONE `token-classification` pipeline per process lifetime, created via a cached promise.
 * This module is the SOLE place in the repo that touches `@huggingface/transformers`, and it
 * does so ONLY through a dynamic `import()` — keeping the ~108 MB ML dep + onnxruntime-node
 * native binary entirely off the latency-critical hook cold path (Anti-Pattern 2 / D-06).
 *
 * CRITICAL (D-06 / Phase 5 RESEARCH Pitfall 1/2): `env.cacheDir` is overridden to the stable
 * SHA-256-verified cache root `~/.mrclean/models/` BEFORE the `pipeline()` call. transformers.js
 * v4's default cacheDir is module-relative (`./node_modules/.../.cache`) and is wiped on reinstall;
 * setting it AFTER `pipeline()` has no effect. `TRANSFORMERS_CACHE` is Python-only and does nothing
 * in JS — `env.cacheDir` is the correct knob.
 *
 * Mirrors the cached-singleton + reset shape of src/detect/index.ts (pool/getOrCreatePool +
 * shutdownDetection). `resetNerSingleton()` is called from the MCP shutdown chain and from tests.
 *
 * Wave-0 verification (Plan 06-01 Task 0) against the installed @huggingface/transformers 4.2.0:
 *   - `dtype: 'int8'` resolves to `onnx/model_int8.onnx` (the SHA-pinned file).
 *   - per-token output is `{ entity, score, index, word }` with NO char offsets — span
 *     reconstruction happens in layer6b-ner.ts (Route B manual BIO aggregation).
 *   - `env.backends.onnx` is truthy when the native onnxruntime-node backend is active.
 *
 * Plan 06-01 — implements NER-01 (warm singleton + lazy import) / D-06.
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import type { MrcleanPiiNerConfig } from '../shared/types.js'
import { MODEL_DESCRIPTORS } from './constants.js'
import { isModelCached, verifyModelIntegrity, downloadModel } from './model-cache.js'

/**
 * Opaque NER pipeline type. We deliberately NEVER statically import transformers types — that
 * would pull the type graph (and any side-effecting top-level code) onto the cold path. Callers
 * treat the pipeline as `(text) => Promise<raw token output>` and narrow the output themselves.
 */
export type NerPipeline = (text: string, opts?: Record<string, unknown>) => Promise<unknown>

/** Backend label for the audit `backend` provenance field (D-12). */
type NerBackend = 'onnxruntime-node' | 'wasm' | 'unknown'

/** Cached pipeline build promise — one per process lifetime (the warm singleton). */
let instance: Promise<NerPipeline> | null = null

/** Last-observed backend, captured during the build. */
let backendLabel: NerBackend = 'unknown'

/**
 * Resolved provenance of the ACTUALLY-loaded model, captured during the build (D-12 / MODEL-04).
 * `resolvedModelSha` is the pinned SHA-256 of the descriptor that was verified+loaded (bert OR
 * piiranha). `resolvedDtype` is the dtype passed to `pipeline()`. Both are `undefined` before the
 * first successful build and after `resetNerSingleton()`. The audit layer reads these so every NER
 * provenance entry stamps the bytes that were executed, never a hardcoded constant.
 */
let resolvedModelSha: string | undefined
let resolvedDtype: string | undefined

/**
 * Return the backend the active pipeline is running on, for the audit `backend` field.
 * `'onnxruntime-node'` in supported environments; `'unknown'` before the first build or when
 * backend introspection fails. (No automatic WASM fallback exists in Node — see RESEARCH Pitfall 1.)
 */
export function getNerBackend(): string {
  return backendLabel
}

/**
 * Return the pinned SHA-256 of the model that was actually verified + loaded, for the audit
 * `model_rev` / `engine` provenance fields (D-12 / MODEL-04). `undefined` before the first
 * successful build or after `resetNerSingleton()`. For the piiranha tier this is the piiranha hash.
 */
export function getNerResolvedSha256(): string | undefined {
  return resolvedModelSha
}

/**
 * Return the dtype the active pipeline was built with, for the audit `quant` provenance field
 * (WR-04 — resolved, not merely requested). `undefined` before the first build / after reset.
 */
export function getNerResolvedDtype(): string | undefined {
  return resolvedDtype
}

/**
 * Clear the cached singleton so the next `getNerPipeline()` rebuilds.
 * Called from the MCP shutdown chain (`shutdownMcpSupervisor`) and from tests.
 */
export function resetNerSingleton(): void {
  instance = null
  resolvedModelSha = undefined
  resolvedDtype = undefined
}

/**
 * Get (or lazily build) the warm `token-classification` pipeline.
 *
 * Returns a CACHED promise: concurrent and subsequent calls share the same in-flight/resolved
 * build, so the model loads at most once per process. The dynamic `import()` here is the ONLY
 * `@huggingface/transformers` import in the repo.
 *
 * `env.cacheDir` and `env.allowRemoteModels` are set BEFORE `pipeline()` (D-06). The build does
 * NOT catch errors — fail-closed handling lives in `runLayer6bNer` (NER-03), which wraps this call
 * in a try/catch so a load failure degrades NER only, never the secret gate.
 *
 * @param ner - The `pii.ner` sub-config (model id, dtype, allowDownload).
 * @returns     A promise resolving to the warm NER pipeline.
 */
export function getNerPipeline(ner: MrcleanPiiNerConfig): Promise<NerPipeline> {
  if (instance) return instance

  instance = (async () => {
    // -----------------------------------------------------------------------
    // D-06 / CR-01: integrity gate BEFORE the model is loaded by transformers.js.
    // Resolve the per-model descriptor (defense-in-depth; config load is the primary
    // guard rejecting unknown ids). model-cache + constants are Node-stdlib-only, so
    // these imports add ZERO @huggingface/transformers surface to the cold path.
    // -----------------------------------------------------------------------
    const descriptor = MODEL_DESCRIPTORS[ner.model]
    if (!descriptor) {
      throw new Error(
        `NER model "${ner.model}" is not a pinned/known model — refusing to load (fail-closed).`,
      )
    }

    const home = homedir()
    // Acquire-and-verify: the on-disk bytes MUST hash to the descriptor's pinned SHA-256
    // before we let transformers.js load them. A missing OR mismatched file is NOT trusted.
    const present = await isModelCached(home, descriptor)
    const verified = present && (await verifyModelIntegrity(home, descriptor.pinnedSha256, descriptor))
    if (!verified) {
      if (!ner.allowDownload) {
        throw new Error(
          'NER model absent or failed SHA-256 verification and download is disabled — failing closed.',
        )
      }
      // downloadModel verifies-before-rename and throws ModelIntegrityError on mismatch, so a
      // returning call guarantees the on-disk bytes match the pin (no unverified bytes reach load).
      await downloadModel(home, {}, descriptor)
    }

    // Stash resolved provenance (the bytes we are about to execute) for the audit layer.
    resolvedModelSha = descriptor.pinnedSha256
    resolvedDtype = ner.dtype

    // ↓ The SOLE dynamic-import boundary to the heavy ML dep (cold-path-unreachable).
    // @ts-expect-error — @huggingface/transformers is an optionalDependency NOT installed by
    // default (PII off by default), so its types are absent at typecheck time. The runtime
    // import only executes behind the MCP-only opts.ner gate, never on the cold path.
    const { pipeline, env } = await import('@huggingface/transformers')

    // D-06 / RESEARCH Pitfall 1/2 / CR-01: set cacheDir + remote-model gate BEFORE any model load.
    // allowRemoteModels is ALWAYS false — transformers.js loads ONLY the SHA-verified local file
    // we acquired above; it must NEVER reach out to fetch an unverified model itself.
    env.cacheDir = join(home, '.mrclean', 'models')
    env.allowRemoteModels = false

    // Capture the backend for the audit `backend` field (D-12). Truthy env.backends.onnx ⇒ native.
    try {
      backendLabel = env.backends?.onnx ? 'onnxruntime-node' : 'unknown'
    } catch {
      backendLabel = 'unknown'
    }

    return (await pipeline('token-classification', ner.model, {
      dtype: ner.dtype,
    })) as unknown as NerPipeline
  })()

  return instance
}
