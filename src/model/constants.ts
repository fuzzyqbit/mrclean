/**
 * Model acquisition constants for Xenova/bert-base-NER (onnx/model_int8.onnx).
 *
 * PINNED_MODEL_SHA256 is the real SHA-256 content hash of the int8 ONNX export,
 * computed from the live HuggingFace Hub file during Phase 5-02 Task 0.
 *
 * This module uses ONLY Node stdlib — zero ML deps — so it is safe to import
 * on the cold path without loading @huggingface/transformers or onnxruntime-node.
 *
 * Phase 5-02 (MODEL-02, MODEL-03)
 */

import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Model identity
// ---------------------------------------------------------------------------

/** HuggingFace Hub model identifier (user/repo). */
export const MODEL_ID = 'Xenova/bert-base-NER'

/** Direct download URL for the int8 ONNX file (pinned to main branch). */
export const MODEL_DOWNLOAD_URL =
  'https://huggingface.co/Xenova/bert-base-NER/resolve/main/onnx/model_int8.onnx'

// ---------------------------------------------------------------------------
// Content integrity
// ---------------------------------------------------------------------------

/**
 * SHA-256 of the downloaded model file (108,486,236 bytes).
 * Computed from the live HuggingFace Hub file on 2026-06-03 (Phase 5-02 Task 0).
 * All download + side-load paths verify against this constant (fail-closed on mismatch).
 */
export const PINNED_MODEL_SHA256 =
  '7de0a4606c65b60da275a72f37b76a102c41e2b79c6463096a9d0cb800bf3f2c'

// ---------------------------------------------------------------------------
// Cache path
// ---------------------------------------------------------------------------

/**
 * Absolute path to the cached model file under the user's home directory.
 *
 * Always resolves to `<homeDir>/.mrclean/models/Xenova/bert-base-NER/onnx/model_int8.onnx`.
 * NEVER cwd-relative — a malicious cwd cannot plant a poisoned ./.cache.
 * (MODEL-02 requirement; mirrors RESEARCH Pitfall 1 / T-05-02-02.)
 *
 * @param homeDir - Absolute path to the user's home directory (os.homedir() in production).
 */
export const MODEL_CACHE_PATH = (homeDir: string): string =>
  join(homeDir, '.mrclean', 'models', 'Xenova', 'bert-base-NER', 'onnx', 'model_int8.onnx')
