/**
 * Unit tests for src/model/pipeline-singleton.ts — warm NER pipeline singleton.
 *
 * Plan 06-01, Task 1 — TDD RED gate.
 *
 * The ONLY dynamic import of '@huggingface/transformers' lives in pipeline-singleton.ts.
 * These tests mock that module so CI NEVER downloads the 108 MB model.
 *
 * Covers:
 *   - getNerPipeline returns a CACHED promise — two calls resolve to the same pipeline instance,
 *     and pipeline() is invoked exactly once.
 *   - resetNerSingleton() clears the cache so the next call rebuilds (pipeline() called again).
 *   - env.cacheDir is set to a path ending '.mrclean/models' BEFORE pipeline() is invoked
 *     (asserted via recorded call order on the mocked module).
 *   - env.allowRemoteModels is set from ner.allowDownload.
 *   - getNerBackend() reflects env.backends.onnx truthiness ('onnxruntime-node' | 'unknown').
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'

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
// Helpers
// ---------------------------------------------------------------------------

function makeNerConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    model: 'Xenova/bert-base-NER',
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

  it('sets env.allowRemoteModels from ner.allowDownload', async () => {
    const { getNerPipeline, resetNerSingleton } = await import('../../src/model/pipeline-singleton.js')
    await getNerPipeline(makeNerConfig({ allowDownload: true }))
    expect(env.allowRemoteModels).toBe(true)

    resetNerSingleton()
    await getNerPipeline(makeNerConfig({ allowDownload: false }))
    expect(env.allowRemoteModels).toBe(false)
  })

  it('getNerBackend() returns onnxruntime-node when env.backends.onnx is truthy', async () => {
    const { getNerPipeline, getNerBackend } = await import('../../src/model/pipeline-singleton.js')
    await getNerPipeline(makeNerConfig())
    expect(getNerBackend()).toBe('onnxruntime-node')
  })
})
