/**
 * Orchestrator integration tests for Layer 6b NER wiring (Plan 06-02, Task 1).
 *
 * Tests the opts.ner gating + L6b branch + D-11 pre-dedup overlap drop + nerStatus
 * propagation + pii-ner audit provenance.
 *
 * The NER engine (layer6b-ner.js) and the warm pipeline singleton (pipeline-singleton.js)
 * are MOCKED so CI NEVER downloads the 108 MB model.
 *
 * Covers:
 *   1. Default runDetection (no opts) → nerStatus 'disabled', engine NEVER imported.
 *   2. opts.ner=true but config.pii.ner.enabled=false → nerStatus 'disabled', no L6b.
 *   3. opts.ner=true and config.pii.ner.enabled=true → runLayer6bNer called, findings
 *      appended, nerStatus from its status.
 *   4. D-11: a pii-ner span overlapping a secret/L1 span is dropped pre-dedup.
 *   5. pii-ner audit record carries engine/model_rev/quant/backend; a non-NER record
 *      carries none of these and neither carries a raw `value`.
 *   6. runDetectionReadOnly gates identically and propagates nerStatus.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MrcleanConfig } from '../../src/shared/types.js'
import type { SessionState } from '../../src/detect/session-state.js'
import type { EnvBlocklist } from '../../src/detect/layer3-env.js'
import type { Finding } from '../../src/detect/findings.js'
import { redactedHash, fingerprint } from '../../src/detect/findings.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'
import { PINNED_MODEL_SHA256 } from '../../src/model/constants.js'

// ---------------------------------------------------------------------------
// Module mocks — keep the heavy ML dep + model download entirely out of CI.
// ---------------------------------------------------------------------------

// runLayer6bNer is the only function index.ts calls from layer6b-ner.js (via dynamic import).
// We replace it with a controllable spy so tests drive the findings + status it returns.
const mockRunLayer6bNer = vi.fn()

vi.mock('../../src/detect/layer6b-ner.js', () => ({
  runLayer6bNer: mockRunLayer6bNer,
}))

// pipeline-singleton.js is statically imported by index.ts only for getNerBackend()/resetNerSingleton().
// Mock it so getNerBackend() returns a deterministic backend label and no transformers import occurs.
vi.mock('../../src/model/pipeline-singleton.js', () => ({
  getNerBackend: () => 'onnxruntime-node',
  resetNerSingleton: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<MrcleanConfig> = {}): MrcleanConfig {
  return { ...DEFAULT_CONFIG, ...overrides }
}

function makeNerEnabledConfig(overrides: Partial<MrcleanConfig> = {}): MrcleanConfig {
  return {
    ...DEFAULT_CONFIG,
    pii: {
      ...DEFAULT_CONFIG.pii,
      enabled: true,
      ner: {
        ...DEFAULT_CONFIG.pii.ner,
        enabled: true,
        dtype: 'int8',
      },
    },
    ...overrides,
  }
}

function emptyBlocklist(): EnvBlocklist {
  return { values: new Set(), meta: new Map() }
}

function makeSessionState(sessionId: string, overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId,
    envBlocklist: emptyBlocklist(),
    wordEntries: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mrclean-ner-test-'))
  await mkdir(join(dir, '.mrclean'), { recursive: true })
  return dir
}

/** Build a synthetic pii-ner Finding covering [start,end) of `text`. */
function nerFinding(text: string, start: number, end: number, canonical: string): Finding {
  const value = text.slice(start, end)
  return {
    ruleId: `pii:${canonical}`,
    severity: 'MEDIUM',
    span: { start, end },
    value,
    redactedHash: redactedHash(value),
    fingerprint: fingerprint(`pii:${canonical}`, value),
    source: 'pii-ner',
    action: 'substitute',
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runDetection — Layer 6b NER wiring (orchestrator-ner)', () => {
  afterEach(async () => {
    mockRunLayer6bNer.mockReset()
    const { shutdownDetection } = await import('../../src/detect/index.js')
    await shutdownDetection()
  })

  // -------------------------------------------------------------------------
  // Test 1: default (no opts) → nerStatus 'disabled', engine NEVER loaded.
  // -------------------------------------------------------------------------
  it('Test 1: default runDetection (no opts) yields nerStatus "disabled" and never calls the NER engine', async () => {
    const { runDetection } = await import('../../src/detect/index.js')

    const cwd = await makeTmpDir()
    const sessionId = 'ner-test-1'
    const text = 'Alice Johnson met Bob at Acme Corp in Berlin.'
    const config = makeNerEnabledConfig() // ner.enabled=true, but no opts passed
    const sessionState = makeSessionState(sessionId)
    const ctx = { sessionId, hookEvent: 'UserPromptSubmit' as const, cwd }

    const result = await runDetection(text, config, sessionState, ctx)

    expect(result.nerStatus).toBe('disabled')
    expect(mockRunLayer6bNer).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Test 2: opts.ner=true but config.pii.ner.enabled=false → 'disabled', no L6b.
  // -------------------------------------------------------------------------
  it('Test 2: opts.ner=true with config.pii.ner.enabled=false yields nerStatus "disabled" and no L6b call', async () => {
    const { runDetection } = await import('../../src/detect/index.js')

    const cwd = await makeTmpDir()
    const sessionId = 'ner-test-2'
    const text = 'Alice Johnson works here.'
    const config = makeConfig({
      pii: { ...DEFAULT_CONFIG.pii, enabled: true, ner: { ...DEFAULT_CONFIG.pii.ner, enabled: false } },
    })
    const sessionState = makeSessionState(sessionId)
    const ctx = { sessionId, hookEvent: 'UserPromptSubmit' as const, cwd }

    const result = await runDetection(text, config, sessionState, ctx, { ner: true })

    expect(result.nerStatus).toBe('disabled')
    expect(mockRunLayer6bNer).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Test 3: opts.ner=true and config.pii.ner.enabled=true → engine called, findings appended, nerStatus set.
  // -------------------------------------------------------------------------
  it('Test 3: opts.ner=true and config.pii.ner.enabled=true calls runLayer6bNer and propagates findings + status', async () => {
    const { runDetection } = await import('../../src/detect/index.js')

    const cwd = await makeTmpDir()
    const sessionId = 'ner-test-3'
    const text = 'Alice Johnson lives somewhere quiet.'
    const config = makeNerEnabledConfig()
    const sessionState = makeSessionState(sessionId)
    const ctx = { sessionId, hookEvent: 'UserPromptSubmit' as const, cwd }

    // 'Alice Johnson' spans [0,13)
    mockRunLayer6bNer.mockResolvedValue({
      findings: [nerFinding(text, 0, 13, 'PERSON')],
      status: 'ready',
    })

    const result = await runDetection(text, config, sessionState, ctx, { ner: true })

    expect(mockRunLayer6bNer).toHaveBeenCalledOnce()
    expect(result.nerStatus).toBe('ready')

    const nerFindings = result.findings.filter((f) => f.source === 'pii-ner')
    expect(nerFindings.length).toBe(1)
    expect(nerFindings[0]!.ruleId).toBe('pii:PERSON')
    // The detected name should be substituted (placeholder in output, raw name absent).
    expect(result.substitutedText).not.toContain('Alice Johnson')
    expect(result.substitutedText).toContain(nerFindings[0]!.placeholder)
  })

  // -------------------------------------------------------------------------
  // Test 4: 'unavailable' status is propagated when the engine fails closed.
  // -------------------------------------------------------------------------
  it('Test 4: nerStatus "unavailable" from the engine is propagated', async () => {
    const { runDetection } = await import('../../src/detect/index.js')

    const cwd = await makeTmpDir()
    const sessionId = 'ner-test-4'
    const text = 'Some plain text with no detectable secrets.'
    const config = makeNerEnabledConfig()
    const sessionState = makeSessionState(sessionId)
    const ctx = { sessionId, hookEvent: 'UserPromptSubmit' as const, cwd }

    mockRunLayer6bNer.mockResolvedValue({ findings: [], status: 'unavailable' })

    const result = await runDetection(text, config, sessionState, ctx, { ner: true })

    expect(result.nerStatus).toBe('unavailable')
  })

  // -------------------------------------------------------------------------
  // Test 5: D-11 — a pii-ner span overlapping an L1 secret is dropped pre-dedup.
  // -------------------------------------------------------------------------
  it('Test 5: a pii-ner finding overlapping an L1 secret span is dropped (D-11)', async () => {
    const { runDetection } = await import('../../src/detect/index.js')

    const cwd = await makeTmpDir()
    const sessionId = 'ner-test-5'
    // The AWS key is detected by L1. We make the NER engine emit a pii-ner span that
    // overlaps the same region — D-11 must drop it before dedup.
    const text = 'AWS key AKIAIOSFODNN7EXAMPLX in config'
    const config = makeNerEnabledConfig()
    const sessionState = makeSessionState(sessionId)
    const ctx = { sessionId, hookEvent: 'UserPromptSubmit' as const, cwd }

    const keyStart = text.indexOf('AKIA')
    const keyEnd = keyStart + 'AKIAIOSFODNN7EXAMPLX'.length
    // ORG span deliberately overlapping the AWS key region.
    mockRunLayer6bNer.mockResolvedValue({
      findings: [nerFinding(text, keyStart, keyEnd, 'ORG')],
      status: 'ready',
    })

    const result = await runDetection(text, config, sessionState, ctx, { ner: true })

    // L1 AWS finding survives.
    const awsFinding = result.findings.find((f) => f.ruleId.toLowerCase().includes('aws'))
    expect(awsFinding).toBeDefined()
    // The overlapping pii-ner finding is gone (D-11 drop).
    const nerFindings = result.findings.filter((f) => f.source === 'pii-ner')
    expect(nerFindings.length).toBe(0)
  })

  // -------------------------------------------------------------------------
  // Test 6: pii-ner audit record carries full provenance; non-NER record carries none; no raw value.
  // -------------------------------------------------------------------------
  it('Test 6: pii-ner audit entry carries engine/model_rev/quant/backend; a secret record carries none, neither carries raw value', async () => {
    const { runDetection } = await import('../../src/detect/index.js')

    const cwd = await makeTmpDir()
    const sessionId = 'ner-test-6'
    const name = 'Carol Danvers'
    const text = `AWS key AKIAIOSFODNN7EXAMPLX and ${name} attended.`
    const config = makeNerEnabledConfig()
    const sessionState = makeSessionState(sessionId)
    const ctx = { sessionId, hookEvent: 'UserPromptSubmit' as const, cwd }

    const nameStart = text.indexOf(name)
    const nameEnd = nameStart + name.length
    mockRunLayer6bNer.mockResolvedValue({
      findings: [nerFinding(text, nameStart, nameEnd, 'PERSON')],
      status: 'ready',
    })

    await runDetection(text, config, sessionState, ctx, { ner: true })

    await new Promise((resolve) => setTimeout(resolve, 50))

    const auditContent = await readFile(join(cwd, '.mrclean', 'audit.jsonl'), 'utf8')
    const records = auditContent
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)

    const nerRecord = records.find((r) => r['ruleId'] === 'pii:PERSON')
    expect(nerRecord).toBeDefined()
    expect(typeof nerRecord!['engine']).toBe('string')
    expect((nerRecord!['engine'] as string).startsWith('pii-ner@')).toBe(true)
    expect(nerRecord!['model_rev']).toBe(PINNED_MODEL_SHA256)
    expect(nerRecord!['quant']).toBe('int8')
    expect(typeof nerRecord!['backend']).toBe('string')
    expect((nerRecord!['backend'] as string).length).toBeGreaterThan(0)
    // No raw PII value anywhere in the NER record.
    expect(JSON.stringify(nerRecord)).not.toContain(name)

    // The L1 secret record must NOT carry provenance fields and no raw value.
    const secretRecord = records.find(
      (r) => typeof r['ruleId'] === 'string' && (r['ruleId'] as string).toLowerCase().includes('aws'),
    )
    expect(secretRecord).toBeDefined()
    expect(secretRecord!['engine']).toBeUndefined()
    expect(secretRecord!['model_rev']).toBeUndefined()
    expect(secretRecord!['quant']).toBeUndefined()
    expect(secretRecord!['backend']).toBeUndefined()
    expect('value' in secretRecord!).toBe(false)
    expect(JSON.stringify(secretRecord)).not.toContain('AKIAIOSFODNN7EXAMPLX')
  })

  // -------------------------------------------------------------------------
  // Test 7: runDetectionReadOnly gates identically and propagates nerStatus.
  // -------------------------------------------------------------------------
  it('Test 7: runDetectionReadOnly honors opts.ner gating and propagates nerStatus', async () => {
    const { runDetectionReadOnly } = await import('../../src/detect/index.js')

    const cwd = await makeTmpDir()
    const sessionId = 'ner-test-7'
    const text = 'Dave Smith was here.'
    const config = makeNerEnabledConfig()
    const sessionState = makeSessionState(sessionId)
    const ctx = { sessionId, hookEvent: 'UserPromptSubmit' as const, cwd }

    // Default (no opts) → disabled, no engine call.
    const disabledResult = await runDetectionReadOnly(text, config, sessionState, ctx)
    expect(disabledResult.nerStatus).toBe('disabled')
    expect(mockRunLayer6bNer).not.toHaveBeenCalled()

    // opts.ner=true → engine called, status propagated.
    mockRunLayer6bNer.mockResolvedValue({
      findings: [nerFinding(text, 0, 10, 'PERSON')],
      status: 'ready',
    })
    const enabledResult = await runDetectionReadOnly(text, config, sessionState, ctx, { ner: true })
    expect(enabledResult.nerStatus).toBe('ready')
    expect(mockRunLayer6bNer).toHaveBeenCalledOnce()
    expect(enabledResult.findings.some((f) => f.source === 'pii-ner')).toBe(true)
  })
})
