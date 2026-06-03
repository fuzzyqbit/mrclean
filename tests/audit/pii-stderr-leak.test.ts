/**
 * PII stderr leak proof — UNIT project, model-free (Plan 07-01 Task 3, D-02 / T-07-01-04).
 *
 * Three deliberately-triggered failure paths (the D-02 representative forced-failure
 * set) each capture process.stderr.write and assert NO raw PII canary substring is
 * present post-chokepoint:
 *   (1) model LOAD failure  — getNerPipeline() throws → Layer 6b fails closed
 *       (status 'unavailable', findings []) and never echoes the throw text.
 *   (2) inference failure   — pipe(text) throws → same fail-closed return.
 *   (3) supervisor catch    — a throw inside supervisedToolCall carrying a canary →
 *       the returned `error` string is the static chokepoint message, no canary.
 *
 * NER is MOCKED (vi.mock on the pipeline singleton) so there is NO real model load —
 * this stays fast and runs under the parallel unit project. It is the < 30s
 * feedback-latency inner-loop signal (VALIDATION.md).
 *
 * tmpdir + stderr-spy isolation mirrors tests/audit/canary-leak.test.ts. The
 * PII_CANARIES literal is duplicated here (NOT imported from the integration file)
 * to avoid cross-project coupling — a file belongs to exactly one project.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the NER pipeline singleton so Layer 6b's two fail-closed boundaries can be
// driven WITHOUT a real model download. Per-test we reconfigure the mock impl.
// ---------------------------------------------------------------------------
const mockGetNerPipeline = vi.fn()
vi.mock('../../src/model/pipeline-singleton.js', () => ({
  getNerPipeline: (...args: unknown[]) => mockGetNerPipeline(...args),
  getNerBackend: () => 'mock',
  getNerResolvedSha256: () => undefined,
  getNerResolvedDtype: () => undefined,
  resetNerSingleton: () => {},
}))

import { runLayer6bNer } from '../../src/detect/layer6b-ner.js'
import { supervisedToolCall } from '../../src/mcp/supervisor.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'
import type { MrcleanConfig, MrcleanPiiNerConfig } from '../../src/shared/types.js'

// Synthetic, obviously-fake canaries (duplicated from the integration file by design).
const PII_CANARIES = [
  '457-55-5462',
  'zzcanary.person@example.invalid',
  'Zebediah Quux-Canary',
  '4000-0000-0000-0002',
] as const

// A raw error message embedding every canary — the chokepoint must scrub all of them.
const LEAKY_ERROR_TEXT =
  `model parse failed on Zebediah Quux-Canary / 457-55-5462 / ` +
  `zzcanary.person@example.invalid / 4000-0000-0000-0002`

const nerConfig: MrcleanPiiNerConfig = DEFAULT_CONFIG.pii.ner
const fullConfig: MrcleanConfig = DEFAULT_CONFIG

function assertNoCanary(captured: string): void {
  for (const canary of PII_CANARIES) {
    expect(captured, `raw PII canary '${canary}' leaked to stderr`).not.toContain(canary)
  }
}

describe('PII stderr leak proof (forced-failure paths, model-free)', () => {
  let captured: string
  let restore: () => void

  beforeEach(() => {
    captured = ''
    const original = process.stderr.write.bind(process.stderr)
    const spy = (chunk: unknown): boolean => {
      captured += String(chunk)
      return true
    }
    process.stderr.write = spy as typeof process.stderr.write
    restore = () => {
      process.stderr.write = original
    }
    mockGetNerPipeline.mockReset()
  })

  afterEach(() => {
    restore()
  })

  it('(1) model LOAD failure: getNerPipeline throws → fail-closed, no canary on stderr', async () => {
    // Arrange — the load boundary throws with raw PII in the message.
    mockGetNerPipeline.mockRejectedValueOnce(new Error(LEAKY_ERROR_TEXT))

    // Act
    const out = await runLayer6bNer('any text', nerConfig, fullConfig)

    // Assert — fail-closed contract (NER-03 / D-05): never throws, no findings.
    expect(out.status).toBe('unavailable')
    expect(out.findings).toEqual([])
    assertNoCanary(captured)
  })

  it('(2) inference failure: pipe(text) throws → fail-closed, no canary on stderr', async () => {
    // Arrange — load succeeds, but inference throws with raw PII in the message.
    mockGetNerPipeline.mockResolvedValueOnce(async () => {
      throw new Error(LEAKY_ERROR_TEXT)
    })

    // Act
    const out = await runLayer6bNer('any text', nerConfig, fullConfig)

    // Assert — same fail-closed return; the raw throw text never reaches stderr.
    expect(out.status).toBe('unavailable')
    expect(out.findings).toEqual([])
    assertNoCanary(captured)
  })

  it('(3) supervisor catch: a throw carrying a canary returns a scrubbed error string', async () => {
    // Non-vacuity: prove the raw text WOULD carry the canary pre-chokepoint.
    const rawError = new Error(LEAKY_ERROR_TEXT)
    expect(rawError.message).toContain('457-55-5462')

    // Act — supervisedToolCall catches and routes through the context-free chokepoint.
    const result = await supervisedToolCall(async () => {
      throw rawError
    })

    // Assert — the returned error (which flows into MCP tool text) carries no canary.
    expect(result.ok).toBe(false)
    if (!result.ok) {
      for (const canary of PII_CANARIES) {
        expect(result.error, `canary '${canary}' leaked into supervisor error`).not.toContain(canary)
      }
      expect(result.error.length).toBeGreaterThan(0)
    }
    // And nothing leaked to stderr either.
    assertNoCanary(captured)
  })
})
