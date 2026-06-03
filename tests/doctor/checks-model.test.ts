/**
 * Unit tests for checkModelCache (src/doctor/checks.ts) and
 * computeDoctorReport model integration (src/doctor/index.ts).
 *
 * All tests use a temp homeDir + fixture model file. No real model downloaded.
 *
 * Phase 5-02 Task 2 (TDD RED)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'

import { checkModelCache } from '../../src/doctor/checks.js'
import { MODEL_CACHE_PATH } from '../../src/model/constants.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpHomeDir(): Promise<string> {
  const d = join(tmpdir(), `mrclean-doctor-model-test-${randomUUID()}`)
  await mkdir(d, { recursive: true })
  return d
}

/** Write a fixture file at path, creating parent dirs. */
async function writeAt(filePath: string, content: Buffer | string): Promise<void> {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  await mkdir(dir, { recursive: true })
  await writeFile(filePath, content)
}

/** Build a buffer and return its SHA-256 hex. */
function makeBuffer(): [Buffer, string] {
  const content = 'fixture-' + randomUUID()
  const buf = Buffer.from(content)
  const hash = createHash('sha256').update(buf).digest('hex')
  return [buf, hash]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkModelCache', () => {
  let tmpHome: string

  beforeEach(async () => {
    tmpHome = await makeTmpHomeDir()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tmpHome, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // Test 1: SKIP when model is not cached
  // -------------------------------------------------------------------------

  it('Test 1: returns SKIP (exitCodeOnFail 0) when model is not cached', async () => {
    // Arrange — no model file at tmpHome

    // Act
    const result = await checkModelCache(tmpHome)

    // Assert
    expect(result.name).toBe('model-cache')
    expect(result.status).toBe('SKIP')
    expect(result.exitCodeOnFail).toBe(0)
    // Detail must mention model not downloaded / PII opt-in
    expect(result.detail.toLowerCase()).toMatch(/not downloaded|pii|opt.in/i)
  })

  // -------------------------------------------------------------------------
  // Test 2: PASS when model is present and hash matches
  // -------------------------------------------------------------------------

  it('Test 2: returns PASS when model is present and verifyModelIntegrity passes', async () => {
    // Arrange — write a fixture file + mock verifyModelIntegrity to return true
    const cachePath = MODEL_CACHE_PATH(tmpHome)
    const [buf] = makeBuffer()
    await writeAt(cachePath, buf)

    // We mock verifyModelIntegrity since the file won't match PINNED_MODEL_SHA256
    vi.doMock('../../src/model/model-cache.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/model/model-cache.js')>()
      return {
        ...actual,
        verifyModelIntegrity: vi.fn().mockResolvedValue(true),
      }
    })

    // Re-import checkModelCache after mock
    const { checkModelCache: checkWithMock } = await import('../../src/doctor/checks.js')
    const result = await checkWithMock(tmpHome)

    // Assert
    expect(result.name).toBe('model-cache')
    expect(result.status).toBe('PASS')
    expect(result.exitCodeOnFail).toBe(6)
  })

  // -------------------------------------------------------------------------
  // Test 3: FAIL with exitCodeOnFail 6 when model present but hash mismatches
  // -------------------------------------------------------------------------

  it('Test 3: returns FAIL with exitCodeOnFail 6 when model present but hash mismatches', async () => {
    // Arrange — write a fixture file + mock verifyModelIntegrity to return false
    const cachePath = MODEL_CACHE_PATH(tmpHome)
    const [buf] = makeBuffer()
    await writeAt(cachePath, buf)

    vi.doMock('../../src/model/model-cache.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/model/model-cache.js')>()
      return {
        ...actual,
        verifyModelIntegrity: vi.fn().mockResolvedValue(false),
      }
    })

    const { checkModelCache: checkWithMock } = await import('../../src/doctor/checks.js')
    const result = await checkWithMock(tmpHome)

    // Assert
    expect(result.name).toBe('model-cache')
    expect(result.status).toBe('FAIL')
    expect(result.exitCodeOnFail).toBe(6)
    expect(result.detail.toLowerCase()).toMatch(/mismatch|sha.256|re.fetch/i)
  })

  // -------------------------------------------------------------------------
  // Test 4: computeDoctorReport includes model-cache result + SKIP stays green
  // -------------------------------------------------------------------------

  it('Test 4: computeDoctorReport includes model-cache result; SKIP does not raise exit code', async () => {
    // Arrange — no model file, no Claude settings (all other checks will FAIL)
    // We only care that a 'model-cache' result appears in the report
    const { computeDoctorReport } = await import('../../src/doctor/index.js')
    const report = await computeDoctorReport({ homeDir: tmpHome, cwd: tmpHome })

    // Assert — model-cache result exists in the report
    const modelResult = report.results.find((r) => r.name === 'model-cache')
    expect(modelResult).toBeDefined()
    expect(modelResult?.status).toBe('SKIP') // no model downloaded

    // Assert — SKIP does not contribute to exit code (exit code is from other FAIL checks)
    // (SKIP is non-failing per computeExitCode — only FAILs raise the code)
    // We just verify the SKIP result itself has exitCodeOnFail 0
    expect(modelResult?.exitCodeOnFail).toBe(0)
  })

  // -------------------------------------------------------------------------
  // Test 5: SKIP detail mentions model not downloaded / PII opt-in
  // -------------------------------------------------------------------------

  it('Test 5: SKIP detail string mentions model is not downloaded (operator-facing)', async () => {
    // Arrange — no model
    const result = await checkModelCache(tmpHome)

    // Assert
    expect(result.status).toBe('SKIP')
    expect(result.detail).toMatch(/NER model not downloaded|PII NER opt.in/i)
  })
})
