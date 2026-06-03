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
  ModelIntegrityError,
} from '../../src/model/model-cache.js'

import {
  MODEL_CACHE_PATH,
  MODEL_DOWNLOAD_URL,
  PINNED_MODEL_SHA256,
  MODEL_ID,
  MODEL_DESCRIPTORS,
  BERT_DESCRIPTOR,
  PIIRANHA_MODEL_ID,
  PIIRANHA_DOWNLOAD_URL,
  PIIRANHA_PINNED_SHA256,
  PIIRANHA_CACHE_PATH,
} from '../../src/model/constants.js'

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

  // -------------------------------------------------------------------------
  // Task 1 (gap 06-04): per-model descriptor wiring + piiranha integrity
  // -------------------------------------------------------------------------

  describe('MODEL_DESCRIPTORS (per-model descriptor map)', () => {
    it('exposes a frozen map keyed by MODEL_ID and PIIRANHA_MODEL_ID', () => {
      expect(Object.isFrozen(MODEL_DESCRIPTORS)).toBe(true)
      expect(Object.keys(MODEL_DESCRIPTORS).sort()).toEqual(
        [MODEL_ID, PIIRANHA_MODEL_ID].sort(),
      )
    })

    it('bert descriptor resolves to the bert url/hash/path', () => {
      const d = MODEL_DESCRIPTORS[MODEL_ID]!
      expect(d.id).toBe(MODEL_ID)
      expect(d.downloadUrl).toBe(MODEL_DOWNLOAD_URL)
      expect(d.pinnedSha256).toBe(PINNED_MODEL_SHA256)
      expect(d.cachePath('/home/u')).toBe(MODEL_CACHE_PATH('/home/u'))
      expect(BERT_DESCRIPTOR).toBe(d)
    })

    it('piiranha descriptor wires the previously-dead PIIRANHA_* constants', () => {
      const d = MODEL_DESCRIPTORS[PIIRANHA_MODEL_ID]!
      expect(d.id).toBe(PIIRANHA_MODEL_ID)
      expect(d.downloadUrl).toBe(PIIRANHA_DOWNLOAD_URL)
      expect(d.pinnedSha256).toBe(PIIRANHA_PINNED_SHA256)
      expect(d.cachePath('/home/u')).toBe(PIIRANHA_CACHE_PATH('/home/u'))
    })
  })

  describe('descriptor-parameterized model-cache (piiranha tier)', () => {
    it('isModelCached(home, piiranhaDescriptor) checks the piiranha path, not the bert path', async () => {
      const piiranha = MODEL_DESCRIPTORS[PIIRANHA_MODEL_ID]!
      // Write only at the BERT path — piiranha lookup must still be false.
      await writeAt(MODEL_CACHE_PATH(tmpHome), Buffer.from('bert'))
      expect(await isModelCached(tmpHome, piiranha)).toBe(false)

      // Now write at the piiranha path — lookup becomes true.
      await writeAt(PIIRANHA_CACHE_PATH(tmpHome), Buffer.from('piiranha'))
      expect(await isModelCached(tmpHome, piiranha)).toBe(true)
    })

    it('verifyModelIntegrity streams the piiranha path and compares to the piiranha hash', async () => {
      const piiranha = MODEL_DESCRIPTORS[PIIRANHA_MODEL_ID]!
      const [buf, sha256] = makeFixtureFile()
      await writeAt(PIIRANHA_CACHE_PATH(tmpHome), buf)

      // expectedHash override (fixture hash) + descriptor selects the piiranha PATH.
      expect(await verifyModelIntegrity(tmpHome, sha256, piiranha)).toBe(true)
      expect(await verifyModelIntegrity(tmpHome, 'a'.repeat(64), piiranha)).toBe(false)
    })

    it('verifyModelIntegrity defaults expectedHash to the descriptor pinnedSha256', async () => {
      // A fixture file whose bytes are arbitrary will not match the real piiranha pin,
      // so the default-hash path must return false (proves it used the piiranha pin, not bert).
      const piiranha = MODEL_DESCRIPTORS[PIIRANHA_MODEL_ID]!
      await writeAt(PIIRANHA_CACHE_PATH(tmpHome), Buffer.from('not-the-real-piiranha-bytes'))
      expect(await verifyModelIntegrity(tmpHome, undefined, piiranha)).toBe(false)
    })

    it('downloadModel(home, { ...descriptor }) fetches the piiranha URL and verifies the piiranha hash', async () => {
      const piiranha = MODEL_DESCRIPTORS[PIIRANHA_MODEL_ID]!
      const [buf, sha256] = makeFixtureFile()
      let fetchedUrl = ''
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        fetchedUrl = url
        return Promise.resolve({
          ok: true,
          body: {
            [Symbol.asyncIterator]: async function* () {
              yield buf
            },
          },
          headers: { get: () => String(buf.length) },
        } as unknown as Response)
      })

      await downloadModel(tmpHome, { fetchImpl: mockFetch, expectedHash: sha256 }, piiranha)

      expect(fetchedUrl).toBe(PIIRANHA_DOWNLOAD_URL)
      const fileStat = await stat(PIIRANHA_CACHE_PATH(tmpHome))
      expect(fileStat.isFile()).toBe(true)
      // bert path untouched
      expect(await isModelCached(tmpHome)).toBe(false)
    })

    it('downloadModel throws ModelIntegrityError and unlinks the temp file on piiranha hash mismatch', async () => {
      const piiranha = MODEL_DESCRIPTORS[PIIRANHA_MODEL_ID]!
      const [buf] = makeFixtureFile()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield buf
          },
        },
        headers: { get: () => String(buf.length) },
      } as unknown as Response)

      await expect(
        downloadModel(tmpHome, { fetchImpl: mockFetch, expectedHash: 'd'.repeat(64) }, piiranha),
      ).rejects.toBeInstanceOf(ModelIntegrityError)

      // No file at piiranha cache path, no leftover .partial temp.
      expect(await isModelCached(tmpHome, piiranha)).toBe(false)
      const tempPath = PIIRANHA_CACHE_PATH(tmpHome) + '.partial'
      await expect(stat(tempPath)).rejects.toThrow()
    })

    it('back-compat: no-descriptor calls default to the bert descriptor (byte-identical)', async () => {
      const [buf, sha256] = makeFixtureFile()
      await writeAt(MODEL_CACHE_PATH(tmpHome), buf)
      expect(await isModelCached(tmpHome)).toBe(true)
      expect(await verifyModelIntegrity(tmpHome, sha256)).toBe(true)
    })
  })
})
