/**
 * Model acquisition, caching, and integrity for Xenova/bert-base-NER.
 *
 * Provides four pure-infrastructure functions:
 *   - isModelCached       — check if model file exists at the stable cache path
 *   - verifyModelIntegrity — SHA-256 stream verify against PINNED_MODEL_SHA256
 *   - downloadModel        — fetch → temp file → verify hash → atomic rename
 *   - sideLoadModel        — copy operator-supplied file → verify hash → atomic rename
 *
 * Security invariants (T-05-02-01 through T-05-02-04):
 *   - Cache path is ALWAYS under os.homedir()/.mrclean/models/ (never cwd-relative)
 *   - Hash is verified BEFORE the file is moved into MODEL_CACHE_PATH (fail-closed)
 *   - On any hash mismatch, the temp file is unlinked and an error is thrown
 *   - This module imports ZERO ML deps (@huggingface/transformers, onnxruntime-node)
 *
 * Phase 5-02 (MODEL-02, MODEL-03)
 */

import { createHash } from 'node:crypto'
import {
  access,
  constants as fsConstants,
  mkdir,
  rename,
  unlink,
  stat,
  copyFile,
  open,
} from 'node:fs/promises'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { dirname } from 'node:path'

import { MODEL_CACHE_PATH, MODEL_DOWNLOAD_URL, PINNED_MODEL_SHA256 } from './constants.js'

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Thrown when a downloaded or side-loaded file fails SHA-256 verification. */
export class ModelIntegrityError extends Error {
  constructor(
    public readonly kind: 'download' | 'sideload',
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(
      `Model SHA-256 mismatch (${kind}): expected ${expected.slice(0, 16)}... got ${actual.slice(0, 16)}...`,
    )
    this.name = 'ModelIntegrityError'
  }
}

/** Thrown when the --from path is invalid (missing, not a regular file). */
export class InvalidSideLoadPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSideLoadPathError'
  }
}

// ---------------------------------------------------------------------------
// isModelCached
// ---------------------------------------------------------------------------

/**
 * Returns true if the model file exists at the stable cache path.
 *
 * Does NOT verify the hash — call verifyModelIntegrity for that.
 * Uses fs.access(F_OK) which is non-destructive and atomic.
 */
export async function isModelCached(homeDir: string): Promise<boolean> {
  try {
    await access(MODEL_CACHE_PATH(homeDir), fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// verifyModelIntegrity
// ---------------------------------------------------------------------------

/**
 * Stream the cached model file through SHA-256 and compare to the expected hash.
 *
 * @param homeDir      - Absolute path to the user's home directory.
 * @param expectedHash - Optional override for testing with fixture files.
 *                       Defaults to PINNED_MODEL_SHA256 from constants.ts.
 * @returns true if the digest matches, false otherwise.
 */
export async function verifyModelIntegrity(
  homeDir: string,
  expectedHash: string = PINNED_MODEL_SHA256,
): Promise<boolean> {
  const filePath = MODEL_CACHE_PATH(homeDir)
  const hash = createHash('sha256')

  const fh = await open(filePath, 'r')
  try {
    const stream = fh.createReadStream()
    for await (const chunk of stream) {
      hash.update(chunk)
    }
  } finally {
    await fh.close()
  }

  return hash.digest('hex') === expectedHash
}

// ---------------------------------------------------------------------------
// Internal helper: compute SHA-256 of an arbitrary file path
// ---------------------------------------------------------------------------

async function computeFileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const fh = await open(filePath, 'r')
  try {
    const stream = fh.createReadStream()
    for await (const chunk of stream) {
      hash.update(chunk)
    }
  } finally {
    await fh.close()
  }
  return hash.digest('hex')
}

// ---------------------------------------------------------------------------
// downloadModel
// ---------------------------------------------------------------------------

/** Options for downloadModel — primarily for testing (inject mock fetch + hash). */
export interface DownloadModelOptions {
  /** Injectable fetch implementation — defaults to global fetch (Node 20+). */
  fetchImpl?: typeof fetch
  /** Injectable expected hash — defaults to PINNED_MODEL_SHA256. */
  expectedHash?: string
  /** Called with progress percentage (0-100) as download progresses. */
  onProgress?: (pct: number) => void
}

/**
 * Download the ONNX model from MODEL_DOWNLOAD_URL to the stable cache path.
 *
 * Protocol (T-05-02-01 / MODEL-02):
 *   1. mkdir -p the cache directory.
 *   2. Stream response body to a temp file at <dest>.partial.
 *   3. Compute SHA-256 while writing.
 *   4. On hash match: atomically rename temp → dest.
 *   5. On hash mismatch: unlink temp file and throw ModelIntegrityError.
 *
 * The partial file is NEVER moved into MODEL_CACHE_PATH unless the hash passes.
 * Inject fetchImpl to avoid real network calls in unit tests.
 */
export async function downloadModel(
  homeDir: string,
  opts: DownloadModelOptions = {},
): Promise<void> {
  const {
    fetchImpl = fetch,
    expectedHash = PINNED_MODEL_SHA256,
    onProgress,
  } = opts

  const dest = MODEL_CACHE_PATH(homeDir)
  const destDir = dirname(dest)
  const tempPath = dest + '.partial'

  // Ensure cache directory exists
  await mkdir(destDir, { recursive: true })

  const response = await fetchImpl(MODEL_DOWNLOAD_URL)
  if (!response.ok) {
    throw new Error(`Model download failed: HTTP ${response.status}`)
  }

  const totalBytes = parseInt(response.headers?.get?.('content-length') ?? '0', 10) || 0
  const hash = createHash('sha256')
  let writtenBytes = 0

  // Write to temp file while computing hash
  const fh = await open(tempPath, 'w')
  try {
    if (!response.body) {
      throw new Error('Response body is null — cannot stream model download')
    }

    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      hash.update(buf)
      await fh.write(buf)
      writtenBytes += buf.length
      if (onProgress && totalBytes > 0) {
        onProgress(Math.min(100, Math.round((writtenBytes / totalBytes) * 100)))
      }
    }
  } catch (err) {
    await fh.close()
    // Unlink partial file on write failure
    await unlink(tempPath).catch(() => {/* ignore cleanup errors */})
    throw err
  }

  await fh.close()

  // Verify integrity BEFORE moving into place (fail-closed)
  const actual = hash.digest('hex')
  if (actual !== expectedHash) {
    await unlink(tempPath).catch(() => {/* ignore cleanup errors */})
    throw new ModelIntegrityError('download', expectedHash, actual)
  }

  // Atomic rename: temp → dest
  await rename(tempPath, dest)
}

// ---------------------------------------------------------------------------
// sideLoadModel
// ---------------------------------------------------------------------------

/**
 * Copy an operator-supplied model file into MODEL_CACHE_PATH after verifying integrity.
 *
 * Use this for offline / air-gapped deployments:
 *   mrclean pii fetch-model --from /path/to/model_int8.onnx
 *
 * Security (T-05-02-03):
 *   1. Resolve fromPath to absolute.
 *   2. Assert it exists and is a regular file (reject directories / missing paths).
 *   3. Copy to a temp file at <dest>.partial.
 *   4. Verify SHA-256 against expectedHash (defaults to PINNED_MODEL_SHA256).
 *   5. On match: atomic rename to dest.
 *   6. On mismatch: unlink temp and throw ModelIntegrityError.
 *
 * @param homeDir      - Absolute path to the user's home directory.
 * @param fromPath     - Path to the operator-supplied model file (resolved to absolute).
 * @param expectedHash - Optional override for testing with fixture files.
 */
export async function sideLoadModel(
  homeDir: string,
  fromPath: string,
  expectedHash: string = PINNED_MODEL_SHA256,
): Promise<void> {
  // 1. Resolve to absolute path
  const absFromPath = resolve(fromPath)

  // 2. Validate: must exist and be a regular file
  let fileStat: Awaited<ReturnType<typeof stat>>
  try {
    fileStat = await stat(absFromPath)
  } catch {
    throw new InvalidSideLoadPathError(
      `Side-load path does not exist: ${absFromPath}`,
    )
  }

  if (!fileStat.isFile()) {
    throw new InvalidSideLoadPathError(
      `Side-load path is not a regular file: ${absFromPath}`,
    )
  }

  const dest = MODEL_CACHE_PATH(homeDir)
  const destDir = dirname(dest)
  const tempPath = dest + '.partial'

  // Ensure cache directory exists
  await mkdir(destDir, { recursive: true })

  // 3. Copy to temp file
  await copyFile(absFromPath, tempPath)

  // 4. Verify SHA-256 BEFORE moving into place
  let actual: string
  try {
    actual = await computeFileSha256(tempPath)
  } catch (err) {
    await unlink(tempPath).catch(() => {/* ignore */})
    throw err
  }

  if (actual !== expectedHash) {
    await unlink(tempPath).catch(() => {/* ignore */})
    throw new ModelIntegrityError('sideload', expectedHash, actual)
  }

  // 5. Atomic rename
  await rename(tempPath, dest)
}
