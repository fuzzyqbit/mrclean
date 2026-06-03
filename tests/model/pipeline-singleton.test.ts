/**
 * Unit tests for src/model/pipeline-singleton.ts — warm NER pipeline singleton.
 *
 * Plan 06-01, Task 1 — TDD RED gate.
 * Plan 06-04, Task 2 — SHA-verified inference load path (CR-01 / D-06).
 *
 * The ONLY dynamic import of '@huggingface/transformers' lives in pipeline-singleton.ts.
 * These tests mock that module so CI NEVER downloads the 108 MB model. They ALSO mock
 * src/model/model-cache.js so the integrity gate runs without any real file/download.
 *
 * Covers:
 *   - getNerPipeline returns a CACHED promise — two calls resolve to the same pipeline instance,
 *     and pipeline() is invoked exactly once.
 *   - resetNerSingleton() clears the cache so the next call rebuilds (pipeline() called again).
 *   - env.cacheDir is set to a path ending '.mrclean/models' BEFORE pipeline() is invoked.
 *   - env.allowRemoteModels is set to FALSE unconditionally (transformers loads ONLY the
 *     SHA-verified local file) — repoint of the old allowRemoteModels=allowDownload assertion.
 *   - integrity gate (isModelCached / verifyModelIntegrity / downloadModel) runs BEFORE pipeline().
 *   - fail-closed: throws on integrity mismatch OR (cache miss AND allowDownload=false).
 *   - per-model descriptor: piiranha selection verifies the piiranha hash, not bert.
 *   - getNerResolvedSha256 / getNerResolvedDtype expose resolved provenance, reset by reset.
 *   - getNerBackend() reflects env.backends.onnx truthiness ('onnxruntime-node' | 'unknown').
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  MODEL_ID,
  PINNED_MODEL_SHA256,
  PIIRANHA_MODEL_ID,
  PIIRANHA_PINNED_SHA256,
} from '../../src/model/constants.js'

// ---------------------------------------------------------------------------
// Mock the heavy ML dep. We record the order of mutations vs the pipeline() call
// via a shared `events` array so we can assert env.cacheDir-before-pipeline().
// ---------------------------------------------------------------------------

const events: string[] = []

// A fake pipeline function (the thing pipeline() resolves to). Each build is a
// distinct function identity so we can assert caching (same identity) vs rebuild.
let buildCount = 0

const env: Record<string, unknown> = {
  cacheDir: undefined,
  allowRemoteModels: undefined,
  backends: { onnx: {} }, // truthy → 'onnxruntime-node'
}

const pipeline = vi.fn(async (_task: string, _model: string, _opts: unknown) => {
  events.push('pipeline')
  buildCount += 1
  const id = buildCount
  const fn = async (_text: string) => [{ entity: 'O', score: 1, index: 0, word: 'x', __build: id }]
  ;(fn as unknown as { __build: number }).__build = id
  return fn
})

vi.mock('@huggingface/transformers', () => {
  // Wrap env in a proxy so writes to cacheDir / allowRemoteModels are recorded in order.
  const recordingEnv = new Proxy(env, {
    set(target, prop, value) {
      events.push(`env.${String(prop)}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(target as any)[prop] = value
      return true
    },
  })
  return { pipeline, env: recordingEnv }
})

// ---------------------------------------------------------------------------
// Mock the integrity layer. Controllable per-test so we can drive cache-hit,
// cache-miss, mismatch, and download paths without any real file or network.
// ---------------------------------------------------------------------------

const mockIsModelCached = vi.fn<(home: string, descriptor?: unknown) => Promise<boolean>>()
const mockVerifyModelIntegrity =
  vi.fn<(home: string, expected?: string, descriptor?: unknown) => Promise<boolean>>()
const mockDownloadModel =
  vi.fn<(home: string, opts?: unknown, descriptor?: unknown) => Promise<void>>()

vi.mock('../../src/model/model-cache.js', () => ({
  isModelCached: (home: string, descriptor?: unknown) => {
    events.push('isModelCached')
    return mockIsModelCached(home, descriptor)
  },
  verifyModelIntegrity: (home: string, expected?: string, descriptor?: unknown) => {
    events.push('verifyModelIntegrity')
    return mockVerifyModelIntegrity(home, expected, descriptor)
  },
  downloadModel: (home: string, opts?: unknown, descriptor?: unknown) => {
    events.push('downloadModel')
    return mockDownloadModel(home, opts, descriptor)
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNerConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    model: MODEL_ID,
    dtype: 'int8',
    entities: ['PERSON', 'ORG', 'LOC'],
    confidence: 0.7,
    allowDownload: false,
    warmOnBoot: false,
    actions: { PERSON: 'warn', ORG: 'warn', LOC: 'audit' },
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('pipeline-singleton', () => {
  beforeEach(async () => {
    events.length = 0
    buildCount = 0
    pipeline.mockClear()
    env.cacheDir = undefined
    env.allowRemoteModels = undefined
    env.backends = { onnx: {} }
    // Default integrity state: model is cached and verified (the happy path).
    mockIsModelCached.mockReset().mockResolvedValue(true)
    mockVerifyModelIntegrity.mockReset().mockResolvedValue(true)
    mockDownloadModel.mockReset().mockResolvedValue(undefined)
    const mod = await import('../../src/model/pipeline-singleton.js')
    mod.resetNerSingleton()
  })

  it('caches the pipeline: two calls return the same instance, pipeline() invoked once', async () => {
    const { getNerPipeline } = await import('../../src/model/pipeline-singleton.js')
    const a = await getNerPipeline(makeNerConfig())
    const b = await getNerPipeline(makeNerConfig())
    expect(a).toBe(b)
    expect(pipeline).toHaveBeenCalledTimes(1)
  })

  it('resetNerSingleton() forces a rebuild on the next call', async () => {
    const { getNerPipeline, resetNerSingleton } = await import('../../src/model/pipeline-singleton.js')
    const a = await getNerPipeline(makeNerConfig())
    resetNerSingleton()
    const b = await getNerPipeline(makeNerConfig())
    expect(a).not.toBe(b)
    expect(pipeline).toHaveBeenCalledTimes(2)
  })

  it('sets env.cacheDir to <home>/.mrclean/models BEFORE pipeline() is invoked', async () => {
    const { getNerPipeline } = await import('../../src/model/pipeline-singleton.js')
    await getNerPipeline(makeNerConfig())

    const expected = join(homedir(), '.mrclean', 'models')
    expect(env.cacheDir).toBe(expected)
    expect(String(env.cacheDir).endsWith(join('.mrclean', 'models'))).toBe(true)

    const cacheIdx = events.indexOf('env.cacheDir')
    const pipeIdx = events.indexOf('pipeline')
    expect(cacheIdx).toBeGreaterThanOrEqual(0)
    expect(pipeIdx).toBeGreaterThanOrEqual(0)
    expect(cacheIdx).toBeLessThan(pipeIdx) // cacheDir set BEFORE pipeline()
  })

  // -------------------------------------------------------------------------
  // Plan 06-04 / CR-01: env.allowRemoteModels is ALWAYS false (repoint).
  // -------------------------------------------------------------------------
  it('sets env.allowRemoteModels = false unconditionally (loads only the SHA-verified local file)', async () => {
    const { getNerPipeline, resetNerSingleton } = await import('../../src/model/pipeline-singleton.js')

    await getNerPipeline(makeNerConfig({ allowDownload: true }))
    expect(env.allowRemoteModels).toBe(false)

    resetNerSingleton()
    await getNerPipeline(makeNerConfig({ allowDownload: false }))
    expect(env.allowRemoteModels).toBe(false)
  })

  it('runs the integrity gate (isModelCached + verifyModelIntegrity) BEFORE pipeline()', async () => {
    const { getNerPipeline } = await import('../../src/model/pipeline-singleton.js')
    await getNerPipeline(makeNerConfig())

    const verifyIdx = events.indexOf('verifyModelIntegrity')
    const cachedIdx = events.indexOf('isModelCached')
    const pipeIdx = events.indexOf('pipeline')
    expect(cachedIdx).toBeGreaterThanOrEqual(0)
    expect(verifyIdx).toBeGreaterThanOrEqual(0)
    expect(Math.max(cachedIdx, verifyIdx)).toBeLessThan(pipeIdx)
  })

  it('on cache miss with allowDownload=true: downloads (verify-before-rename) then loads', async () => {
    mockIsModelCached.mockResolvedValue(false)
    mockVerifyModelIntegrity.mockResolvedValue(false) // not yet on disk
    const { getNerPipeline } = await import('../../src/model/pipeline-singleton.js')

    await getNerPipeline(makeNerConfig({ allowDownload: true }))

    expect(mockDownloadModel).toHaveBeenCalledTimes(1)
    const dlIdx = events.indexOf('downloadModel')
    const pipeIdx = events.indexOf('pipeline')
    expect(dlIdx).toBeGreaterThanOrEqual(0)
    expect(dlIdx).toBeLessThan(pipeIdx) // acquire before load
  })

  it('on cache miss with allowDownload=false: THROWS and never calls pipeline()', async () => {
    mockIsModelCached.mockResolvedValue(false)
    mockVerifyModelIntegrity.mockResolvedValue(false)
    const { getNerPipeline } = await import('../../src/model/pipeline-singleton.js')

    await expect(getNerPipeline(makeNerConfig({ allowDownload: false }))).rejects.toThrow()
    expect(pipeline).not.toHaveBeenCalled()
    expect(mockDownloadModel).not.toHaveBeenCalled()
  })

  it('on integrity mismatch (verify=false, cached=true, no download): THROWS, never calls pipeline()', async () => {
    mockIsModelCached.mockResolvedValue(true)
    mockVerifyModelIntegrity.mockResolvedValue(false)
    const { getNerPipeline } = await import('../../src/model/pipeline-singleton.js')

    await expect(getNerPipeline(makeNerConfig({ allowDownload: false }))).rejects.toThrow()
    expect(pipeline).not.toHaveBeenCalled()
  })

  it('verifies the PIIRANHA descriptor (piiranha hash) when ner.model is the piiranha tier', async () => {
    const { getNerPipeline } = await import('../../src/model/pipeline-singleton.js')
    await getNerPipeline(makeNerConfig({ model: PIIRANHA_MODEL_ID }))

    // The descriptor passed to verifyModelIntegrity must carry the piiranha pinned hash.
    expect(mockVerifyModelIntegrity).toHaveBeenCalled()
    const descArg = mockVerifyModelIntegrity.mock.calls[0]![2] as { pinnedSha256: string }
    expect(descArg.pinnedSha256).toBe(PIIRANHA_PINNED_SHA256)
  })

  it('throws for an unknown (non-pinned) model id (defense-in-depth)', async () => {
    const { getNerPipeline } = await import('../../src/model/pipeline-singleton.js')
    await expect(getNerPipeline(makeNerConfig({ model: 'evil/unpinned-model' }))).rejects.toThrow()
    expect(pipeline).not.toHaveBeenCalled()
  })

  it('exposes getNerResolvedSha256 / getNerResolvedDtype after a build; reset clears them', async () => {
    const { getNerPipeline, getNerResolvedSha256, getNerResolvedDtype, resetNerSingleton } =
      await import('../../src/model/pipeline-singleton.js')

    await getNerPipeline(makeNerConfig({ dtype: 'int8' }))
    expect(getNerResolvedSha256()).toBe(PINNED_MODEL_SHA256)
    expect(getNerResolvedDtype()).toBe('int8')

    resetNerSingleton()
    expect(getNerResolvedSha256()).toBeUndefined()
    expect(getNerResolvedDtype()).toBeUndefined()
  })

  it('resolved sha reflects the piiranha hash when piiranha is loaded', async () => {
    const { getNerPipeline, getNerResolvedSha256 } = await import('../../src/model/pipeline-singleton.js')
    await getNerPipeline(makeNerConfig({ model: PIIRANHA_MODEL_ID }))
    expect(getNerResolvedSha256()).toBe(PIIRANHA_PINNED_SHA256)
  })

  it('getNerBackend() returns onnxruntime-node when env.backends.onnx is truthy', async () => {
    const { getNerPipeline, getNerBackend } = await import('../../src/model/pipeline-singleton.js')
    await getNerPipeline(makeNerConfig())
    expect(getNerBackend()).toBe('onnxruntime-node')
  })
})
