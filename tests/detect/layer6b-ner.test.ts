/**
 * Unit tests for src/detect/layer6b-ner.ts — L6b NER engine.
 *
 * Plan 06-01, Task 2 — TDD RED gate.
 *
 * The pipeline-singleton module is MOCKED so CI NEVER downloads the 108 MB model.
 * Each test installs its own getNerPipeline mock via vi.hoisted + a mutable holder.
 *
 * Covers:
 *   - aggregates consecutive B-/I- subwords into one span; drops sub-floor ORG → one PERSON finding
 *   - emitted finding has source 'pii-ner' and explicit action 'substitute' (D-02)
 *   - per-entity score = MIN of subword scores (conservative); a run dipping below floor is dropped
 *   - entities filter (D-09): a canonical entity not in ner.entities is dropped
 *   - char offsets reconstructed from the `word` field when tokens carry no start/end (real bert case)
 *   - explicit token start/end honored when present
 *   - coveredSpans overlap-skip
 *   - allowlist suppression
 *   - fail-closed: getNerPipeline throws → {findings:[],status:'unavailable'}, no throw
 *   - fail-closed: pipe(text) throws → {findings:[],status:'unavailable'}, no throw
 *   - success path → status 'ready'; findings sorted by span.start
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'
import type { MrcleanConfig, MrcleanPiiNerConfig } from '../../src/shared/types.js'

// ---------------------------------------------------------------------------
// Mock pipeline-singleton. `pipeImpl` is a mutable holder each test sets.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  // pipeImpl: (text) => raw token array, OR a thrower
  pipeImpl: null as null | ((text: string) => Promise<unknown> | unknown),
  // loadThrows: when true, getNerPipeline itself throws (load failure)
  loadThrows: false,
}))

vi.mock('../../src/model/pipeline-singleton.js', () => ({
  getNerPipeline: vi.fn(async () => {
    if (state.loadThrows) throw new Error('Cannot find module onnxruntime_binding.node')
    return async (text: string) => {
      if (!state.pipeImpl) return []
      return state.pipeImpl(text)
    }
  }),
  getNerBackend: () => 'onnxruntime-node',
  resetNerSingleton: vi.fn(),
}))

// Import AFTER the mock is registered.
const { runLayer6bNer } = await import('../../src/detect/layer6b-ner.js')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(nerOverrides: Partial<MrcleanPiiNerConfig> = {}, configOverrides: Partial<MrcleanConfig> = {}): MrcleanConfig {
  return {
    ...DEFAULT_CONFIG,
    pii: {
      ...DEFAULT_CONFIG.pii,
      enabled: true,
      ner: { ...DEFAULT_CONFIG.pii.ner, enabled: true, ...nerOverrides },
    },
    ...configOverrides,
  } as MrcleanConfig
}

function ner(config: MrcleanConfig): MrcleanPiiNerConfig {
  return config.pii.ner
}

beforeEach(() => {
  state.pipeImpl = null
  state.loadThrows = false
})

describe('runLayer6bNer — aggregation + min_score gate', () => {
  it('aggregates PER subwords, drops sub-floor ORG, emits one PERSON finding (offsets from word field)', async () => {
    // Real bert-base-NER shape: NO start/end. "Ada Love at Acme"
    const text = 'Ada Love at Acme'
    state.pipeImpl = () => [
      { entity: 'B-PER', score: 0.99, index: 1, word: 'Ada' },
      { entity: 'I-PER', score: 0.98, index: 2, word: 'Love' },
      { entity: 'B-ORG', score: 0.55, index: 4, word: 'Acme' }, // < 0.7 → dropped
    ]
    const cfg = makeConfig()
    const { findings, status } = await runLayer6bNer(text, ner(cfg), cfg)
    expect(status).toBe('ready')
    expect(findings.map((f) => f.ruleId)).toEqual(['pii:PERSON'])
    const found = findings[0]!
    expect(text.slice(found.span.start, found.span.end)).toBe('Ada Love')
    expect(found.source).toBe('pii-ner')
    expect(found.action).toBe('substitute')
    expect(found.severity).toBe('MEDIUM')
  })

  it('uses MIN subword score: a PER run dipping below floor is dropped entirely', async () => {
    const text = 'Wolfeschlegel works'
    state.pipeImpl = () => [
      { entity: 'B-PER', score: 0.95, index: 1, word: 'Wolfe' },
      { entity: 'I-PER', score: 0.40, index: 2, word: '##sch' }, // MIN 0.40 < 0.7 → run dropped
      { entity: 'I-PER', score: 0.88, index: 3, word: '##legel' },
    ]
    const cfg = makeConfig()
    const { findings } = await runLayer6bNer(text, ner(cfg), cfg)
    expect(findings).toHaveLength(0)
  })

  it('honors explicit token start/end when present', async () => {
    const text = 'Barack Obama visited Microsoft in Paris'
    state.pipeImpl = () => [
      { entity: 'B-PER', score: 0.99, index: 1, word: 'Barack', start: 0, end: 6 },
      { entity: 'I-PER', score: 0.99, index: 2, word: 'Obama', start: 7, end: 12 },
      { entity: 'B-LOC', score: 0.99, index: 6, word: 'Paris', start: 34, end: 39 },
    ]
    const cfg = makeConfig()
    const { findings } = await runLayer6bNer(text, ner(cfg), cfg)
    const byRule = Object.fromEntries(findings.map((f) => [f.ruleId, text.slice(f.span.start, f.span.end)]))
    expect(byRule['pii:PERSON']).toBe('Barack Obama')
    expect(byRule['pii:LOC']).toBe('Paris')
  })

  it('filters out canonical entities not in ner.entities (D-09)', async () => {
    const text = 'Ada at Acme'
    state.pipeImpl = () => [
      { entity: 'B-PER', score: 0.99, index: 1, word: 'Ada' },
      { entity: 'B-ORG', score: 0.99, index: 3, word: 'Acme' },
    ]
    const cfg = makeConfig({ entities: ['PERSON'] }) // ORG disabled
    const { findings } = await runLayer6bNer(text, ner(cfg), cfg)
    expect(findings.map((f) => f.ruleId)).toEqual(['pii:PERSON'])
  })

  it('skips spans overlapping coveredSpans', async () => {
    const text = 'Ada Love at Acme'
    state.pipeImpl = () => [
      { entity: 'B-PER', score: 0.99, index: 1, word: 'Ada' },
      { entity: 'I-PER', score: 0.98, index: 2, word: 'Love' },
    ]
    const cfg = makeConfig()
    // Cover [0,8) "Ada Love"
    const { findings } = await runLayer6bNer(text, ner(cfg), cfg, [{ start: 0, end: 8 }])
    expect(findings).toHaveLength(0)
  })

  it('returns findings sorted by span.start', async () => {
    const text = 'Paris and Ada'
    state.pipeImpl = () => [
      { entity: 'B-LOC', score: 0.99, index: 1, word: 'Paris' },
      { entity: 'B-PER', score: 0.99, index: 3, word: 'Ada' },
    ]
    const cfg = makeConfig()
    const { findings } = await runLayer6bNer(text, ner(cfg), cfg)
    const starts = findings.map((f) => f.span.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(findings.map((f) => f.ruleId)).toEqual(['pii:LOC', 'pii:PERSON'])
  })
})

describe('runLayer6bNer — allowlist', () => {
  it('suppresses a finding whose value matches an allowlist stopword', async () => {
    const text = 'Ada works here'
    state.pipeImpl = () => [{ entity: 'B-PER', score: 0.99, index: 1, word: 'Ada' }]
    const cfg = makeConfig({}, {
      allowlist: { ...DEFAULT_CONFIG.allowlist, stopwords: ['Ada'] },
    } as Partial<MrcleanConfig>)
    const { findings } = await runLayer6bNer(text, ner(cfg), cfg)
    expect(findings).toHaveLength(0)
  })
})

describe('runLayer6bNer — fail-closed for NER (NER-03)', () => {
  it('model load failure → {findings:[],status:"unavailable"} with no throw', async () => {
    state.loadThrows = true
    const cfg = makeConfig()
    const result = await runLayer6bNer('Ada', ner(cfg), cfg)
    expect(result).toEqual({ findings: [], status: 'unavailable' })
  })

  it('inference failure → {findings:[],status:"unavailable"} with no throw', async () => {
    state.pipeImpl = () => {
      throw new Error('onnx inference failed')
    }
    const cfg = makeConfig()
    const result = await runLayer6bNer('Ada', ner(cfg), cfg)
    expect(result).toEqual({ findings: [], status: 'unavailable' })
  })

  it('never interpolates matched text into the unavailable result (no PII leak)', async () => {
    state.pipeImpl = () => {
      throw new Error('boom')
    }
    const cfg = makeConfig()
    const result = await runLayer6bNer('SecretPersonName', ner(cfg), cfg)
    expect(JSON.stringify(result)).not.toContain('SecretPersonName')
  })
})
