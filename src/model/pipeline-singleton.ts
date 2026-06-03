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
 * Return the backend the active pipeline is running on, for the audit `backend` field.
 * `'onnxruntime-node'` in supported environments; `'unknown'` before the first build or when
 * backend introspection fails. (No automatic WASM fallback exists in Node — see RESEARCH Pitfall 1.)
 */
export function getNerBackend(): string {
  return backendLabel
}

/**
 * Clear the cached singleton so the next `getNerPipeline()` rebuilds.
 * Called from the MCP shutdown chain (`shutdownMcpSupervisor`) and from tests.
 */
export function resetNerSingleton(): void {
  instance = null
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
    // ↓ The SOLE dynamic-import boundary to the heavy ML dep (cold-path-unreachable).
    // @ts-expect-error — @huggingface/transformers is an optionalDependency NOT installed by
    // default (PII off by default), so its types are absent at typecheck time. The runtime
    // import only executes behind the MCP-only opts.ner gate, never on the cold path.
    const { pipeline, env } = await import('@huggingface/transformers')

    // D-06 / RESEARCH Pitfall 1/2: set cacheDir + remote-model gate BEFORE any model load.
    env.cacheDir = join(homedir(), '.mrclean', 'models')
    env.allowRemoteModels = ner.allowDownload

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
