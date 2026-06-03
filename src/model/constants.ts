/**
 * Model acquisition constants for Xenova/bert-base-NER (onnx/model_int8.onnx).
 *
 * PINNED_MODEL_SHA256 is the real SHA-256 content hash of the int8 ONNX export,
 * computed from the live HuggingFace Hub file during Phase 5-02 Task 0.
 *
 * This module uses ONLY Node stdlib — zero ML deps — so it is safe to import
 * on the cold path without loading the heavy ML inference / native runtime stack.
 *
 * Phase 5-02 (MODEL-02, MODEL-03); Phase 6-03 adds the opt-in piiranha tier (NER-04).
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

// ---------------------------------------------------------------------------
// piiranha higher-recall NER tier (NER-04 — OPT-IN, NEVER DEFAULT)
// ---------------------------------------------------------------------------
//
// The piiranha tier is a SECOND, selectable NER model (via `pii.ner.model`) with higher
// recall on personal-information entities. It is NEVER the default — the default tier remains
// Xenova/bert-base-NER (above). It is lazy-downloaded only when an operator explicitly selects it.
//
// LICENSE (RESEARCH Pitfall 7 / T-06-03-SC): the BASE model
// (iiiorg/piiranha-v1-detect-personal-information) is licensed cc-by-nc-nd-4.0 —
// NonCommercial-NoDerivatives. mrclean ships under MIT and does NOT redistribute the weights;
// this tier is OPT-IN ONLY and the model is fetched from HuggingFace by the operator's own
// installation. Acceptance of the NonCommercial-ND license was gated behind a blocking human
// checkpoint (Plan 06-03 Task 2) before this constant landed. Do NOT make piiranha the default
// and do NOT bundle the weights.

/** HuggingFace Hub model identifier for the opt-in piiranha tier (NER-04). */
export const PIIRANHA_MODEL_ID = 'onnx-community/piiranha-v1-detect-personal-information-ONNX'

/** Direct download URL for the piiranha int8 ONNX file (pinned to main branch). */
export const PIIRANHA_DOWNLOAD_URL =
  'https://huggingface.co/onnx-community/piiranha-v1-detect-personal-information-ONNX/resolve/main/onnx/model_int8.onnx'

/**
 * SHA-256 of the piiranha int8 ONNX file (317,144,829 bytes ≈ 317.1 MB).
 * Computed from the live HuggingFace Hub file on 2026-06-03 (Plan 06-03 Task 2 checkpoint —
 * operator accepted the cc-by-nc-nd-4.0 base license and approved the one-time download).
 * Any download / side-load of the piiranha tier verifies against this constant (fail-closed).
 */
export const PIIRANHA_PINNED_SHA256 = 'd5f4d139371b9eeab687d705604e928c46a28a8169654323888bb3160e839076'

/**
 * Absolute path to the cached piiranha model file under the user's home directory.
 *
 * Resolves to
 *   `<homeDir>/.mrclean/models/onnx-community/piiranha-v1-detect-personal-information-ONNX/onnx/model_int8.onnx`.
 * NEVER cwd-relative (mirrors MODEL_CACHE_PATH / T-05-02-02).
 *
 * @param homeDir - Absolute path to the user's home directory (os.homedir() in production).
 */
export const PIIRANHA_CACHE_PATH = (homeDir: string): string =>
  join(
    homeDir,
    '.mrclean',
    'models',
    'onnx-community',
    'piiranha-v1-detect-personal-information-ONNX',
    'onnx',
    'model_int8.onnx',
  )
