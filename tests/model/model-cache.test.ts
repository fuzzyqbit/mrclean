/**
 * Unit tests for src/model/model-cache.ts
 *
 * All 7 behaviors tested with temp homeDir + mocked fetch.
 * Never touches the real network or the real ~/.mrclean/models/ directory.
 *
 * Phase 5-02 Task 1 (TDD RED)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpHomeDir(): Promise<string> {
  const d = join(tmpdir(), `mrclean-model-test-${randomUUID()}`)
  await mkdir(d, { recursive: true })
  return d
}

/** Build a small deterministic fixture buffer and return [buffer, sha256]. */
function makeFixtureFile(): [Buffer, string] {
  const content = 'fixture-model-content-for-test-' + randomUUID()
  const buf = Buffer.from(content, 'utf8')
  const hash = createHash('sha256').update(buf).digest('hex')
  return [buf, hash]
}

/** Write a file at path, creating parent dirs. */
async function writeAt(filePath: string, content: Buffer | string): Promise<void> {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  await mkdir(dir, { recursive: true })
  await writeFile(filePath, content)
}

// ---------------------------------------------------------------------------
// Import model-cache (will fail in RED phase — module does not exist yet)
// ---------------------------------------------------------------------------

import {
  isModelCached,
  verifyModelIntegrity,
  downloadModel,
  sideLoadModel,
} from '../../src/model/model-cache.js'

import { MODEL_CACHE_PATH } from '../../src/model/constants.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('model-cache', () => {
  let tmpHome: string

  beforeEach(async () => {
    tmpHome = await makeTmpHomeDir()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tmpHome, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // Test 1: MODEL_CACHE_PATH resolves under homeDir/.mrclean/models/
  // -------------------------------------------------------------------------

  it('Test 1: MODEL_CACHE_PATH returns absolute path under <homeDir>/.mrclean/models/', () => {
    // Arrange
    const homeDir = '/home/testuser'

    // Act
    const cachePath = MODEL_CACHE_PATH(homeDir)

    // Assert
    expect(cachePath).toMatch(/^\/home\/testuser\/\.mrclean\/models\//)
    expect(cachePath).toContain('Xenova')
    expect(cachePath).toContain('bert-base-NER')
    expect(cachePath).toContain('model_int8.onnx')
    // NEVER cwd-relative
    expect(cachePath).not.toContain('./.cache')
    expect(cachePath).not.toContain('\\.cache')
  })

  // -------------------------------------------------------------------------
  // Test 2: isModelCached — false when absent, true when present
  // -------------------------------------------------------------------------

  it('Test 2: isModelCached returns false when model file is absent', async () => {
    // Arrange — tmpHome has no model file
    // Act
    const result = await isModelCached(tmpHome)
    // Assert
    expect(result).toBe(false)
  })

  it('Test 2b: isModelCached returns true when model file is present', async () => {
    // Arrange — write a dummy file at the cache path
    const cachePath = MODEL_CACHE_PATH(tmpHome)
    await writeAt(cachePath, Buffer.from('dummy'))

    // Act
    const result = await isModelCached(tmpHome)

    // Assert
    expect(result).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Test 3: verifyModelIntegrity — true on hash match, false on mismatch
  //
  // We use a small fixture file + its real sha256. The test stubs the expected
  // hash via verifyModelIntegrity's injectable parameter (expectedHash option).
  // This avoids needing the 108 MB real model for unit tests.
  // -------------------------------------------------------------------------

  it('Test 3: verifyModelIntegrity returns true for file matching its expected sha256', async () => {
    // Arrange
    const [buf, sha256] = makeFixtureFile()
    const cachePath = MODEL_CACHE_PATH(tmpHome)
    await writeAt(cachePath, buf)

    // Act — pass the known hash for this fixture
    const result = await verifyModelIntegrity(tmpHome, sha256)

    // Assert
    expect(result).toBe(true)
  })

  it('Test 3b: verifyModelIntegrity returns false when sha256 does not match', async () => {
    // Arrange
    const [buf] = makeFixtureFile()
    const cachePath = MODEL_CACHE_PATH(tmpHome)
    await writeAt(cachePath, buf)
    const wrongHash = 'a'.repeat(64)

    // Act
    const result = await verifyModelIntegrity(tmpHome, wrongHash)

    // Assert
    expect(result).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Test 4: downloadModel — writes, verifies hash, atomic rename (mocked fetch)
  // -------------------------------------------------------------------------

  it('Test 4: downloadModel writes to temp, verifies hash, and renames into MODEL_CACHE_PATH', async () => {
    // Arrange
    const [buf, sha256] = makeFixtureFile()

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield buf
        },
      },
      headers: { get: () => String(buf.length) },
    } as unknown as Response)

    // Act — inject fetchImpl + expectedHash to use fixture hash
    await downloadModel(tmpHome, { fetchImpl: mockFetch, expectedHash: sha256 })

    // Assert — file should be at the cache path
    const cachePath = MODEL_CACHE_PATH(tmpHome)
    const fileStat = await stat(cachePath)
    expect(fileStat.isFile()).toBe(true)
    expect(fileStat.size).toBe(buf.length)

    // Temp file should be gone (renamed)
    const tempPath = cachePath + '.partial'
    await expect(stat(tempPath)).rejects.toThrow()
  })

  // -------------------------------------------------------------------------
  // Test 5: downloadModel — hash mismatch → unlinks temp, does NOT move into place
  // -------------------------------------------------------------------------

  it('Test 5: downloadModel rejects on hash mismatch and leaves no file at MODEL_CACHE_PATH', async () => {
    // Arrange — content that does NOT match the expected hash
    const [buf] = makeFixtureFile()
    const wrongHash = 'b'.repeat(64)

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield buf
        },
      },
      headers: { get: () => String(buf.length) },
    } as unknown as Response)

    // Act + Assert
    await expect(
      downloadModel(tmpHome, { fetchImpl: mockFetch, expectedHash: wrongHash }),
    ).rejects.toThrow()

    // Verify: no file at MODEL_CACHE_PATH (fail-closed)
    const cachePath = MODEL_CACHE_PATH(tmpHome)
    const result = await isModelCached(tmpHome)
    expect(result).toBe(false)

    // Verify: partial temp file is also unlinked
    const tempPath = cachePath + '.partial'
    await expect(stat(tempPath)).rejects.toThrow()
  })

  // -------------------------------------------------------------------------
  // Test 6: sideLoadModel — rejects non-existent / non-regular-file --from path
  // -------------------------------------------------------------------------

  it('Test 6: sideLoadModel rejects a --from path that does not exist', async () => {
    // Arrange
    const nonExistentPath = join(tmpHome, 'no-such-file.onnx')

    // Act + Assert
    await expect(sideLoadModel(tmpHome, nonExistentPath)).rejects.toThrow()
  })

  it('Test 6b: sideLoadModel rejects a --from path that is a directory', async () => {
    // Arrange — pass a directory instead of a regular file
    const dirPath = join(tmpHome, 'a-directory')
    await mkdir(dirPath, { recursive: true })

    // Act + Assert
    await expect(sideLoadModel(tmpHome, dirPath)).rejects.toThrow()
  })

  // -------------------------------------------------------------------------
  // Test 7: sideLoadModel — copies valid file into MODEL_CACHE_PATH after hash match
  // -------------------------------------------------------------------------

  it('Test 7: sideLoadModel copies valid file into MODEL_CACHE_PATH when sha256 matches', async () => {
    // Arrange
    const [buf, sha256] = makeFixtureFile()
    const fromPath = join(tmpHome, 'side-load-source.onnx')
    await writeFile(fromPath, buf)

    // Act — inject expectedHash to use fixture hash (not the 108 MB pinned hash)
    await sideLoadModel(tmpHome, fromPath, sha256)

    // Assert — file should be at the cache path
    const cachePath = MODEL_CACHE_PATH(tmpHome)
    const fileStat = await stat(cachePath)
    expect(fileStat.isFile()).toBe(true)
    expect(fileStat.size).toBe(buf.length)
  })

  it('Test 7b: sideLoadModel rejects and does not place file when sha256 mismatches', async () => {
    // Arrange
    const [buf] = makeFixtureFile()
    const fromPath = join(tmpHome, 'bad-source.onnx')
    await writeFile(fromPath, buf)
    const wrongHash = 'c'.repeat(64)

    // Act + Assert
    await expect(sideLoadModel(tmpHome, fromPath, wrongHash)).rejects.toThrow()

    // File should not be at cache path
    const result = await isModelCached(tmpHome)
    expect(result).toBe(false)
  })
})
