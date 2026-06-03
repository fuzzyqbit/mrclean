/**
 * Unit tests for the MCP server NER eager-preload (fail-closed) — Plan 06-03 Task 1.
 *
 * These tests exercise the preload helper in isolation rather than booting the full
 * stdio server: `runMcpServer()` connects a real StdioServerTransport whose readline
 * loop keeps the event loop alive, which is awkward to drive in a unit test. The
 * load-bearing behavior (D-04/D-05) lives in `startNerPreload`, exported from
 * src/mcp/server.ts for exactly this reason:
 *
 *   - pii.ner.enabled === false → status starts 'disabled', NO transformers import attempted
 *   - pii.ner.enabled === true  → status starts 'loading'; a fire-and-forget async task
 *                                 flips it to 'ready' on success or 'unavailable' on throw
 *   - the returned getNerStatus() never throws and never blocks
 *   - a preload throw writes a single stderr line carrying NO matched text (Pitfall 5)
 *
 * The pipeline-singleton module is mocked so CI never downloads the model.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MrcleanConfig } from '../../src/shared/types.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'

// Mock the singleton so no model download is ever attempted in CI.
const getNerPipeline = vi.fn()
vi.mock('../../src/model/pipeline-singleton.js', () => ({
  getNerPipeline: (...args: unknown[]) => getNerPipeline(...args),
}))

import { startNerPreload } from '../../src/mcp/server.js'

function makeConfig(nerEnabled: boolean): MrcleanConfig {
  return {
    ...DEFAULT_CONFIG,
    pii: {
      ...DEFAULT_CONFIG.pii,
      ner: { ...DEFAULT_CONFIG.pii.ner, enabled: nerEnabled },
    },
  }
}

/** Flush the microtask queue so the fire-and-forget preload task settles. */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

describe('startNerPreload — eager fail-closed preload (D-04/D-05)', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    getNerPipeline.mockReset()
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
  })

  it('ner disabled → status "disabled" and NO pipeline import attempted', async () => {
    const getNerStatus = startNerPreload(makeConfig(false))
    expect(getNerStatus()).toBe('disabled')
    await flush()
    expect(getNerPipeline).not.toHaveBeenCalled()
    expect(getNerStatus()).toBe('disabled')
  })

  it('ner enabled → status starts "loading" then flips to "ready" on success', async () => {
    getNerPipeline.mockResolvedValue(async () => [])
    const getNerStatus = startNerPreload(makeConfig(true))
    // Synchronously after the call, the preload is in-flight — never blocked.
    expect(getNerStatus()).toBe('loading')
    await flush()
    expect(getNerPipeline).toHaveBeenCalledTimes(1)
    expect(getNerStatus()).toBe('ready')
  })

  it('ner enabled but load throws → status flips to "unavailable", server still usable', async () => {
    getNerPipeline.mockRejectedValue(new Error('native onnxruntime load failure'))
    const getNerStatus = startNerPreload(makeConfig(true))
    expect(getNerStatus()).toBe('loading')
    await flush()
    expect(getNerStatus()).toBe('unavailable')
    // getNerStatus itself never throws — the secret gate is unaffected.
    expect(() => getNerStatus()).not.toThrow()
  })

  it('preload throw writes a single stderr line carrying NO matched text (Pitfall 5)', async () => {
    getNerPipeline.mockRejectedValue(new Error('secret-token-AKIA-should-not-appear'))
    startNerPreload(makeConfig(true))
    await flush()
    expect(stderrSpy).toHaveBeenCalled()
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    // The stderr line announces model state only — no error detail, no input text.
    expect(written).toMatch(/NER unavailable/i)
    expect(written).not.toMatch(/AKIA/)
    expect(written).not.toMatch(/secret-token/)
  })

  it('the fire-and-forget preload does not block the caller (returns synchronously)', () => {
    // A never-resolving pipeline build must NOT hang startNerPreload.
    getNerPipeline.mockReturnValue(new Promise(() => {}))
    const before = Date.now()
    const getNerStatus = startNerPreload(makeConfig(true))
    const elapsed = Date.now() - before
    expect(elapsed).toBeLessThan(50) // returned immediately, did not await the build
    expect(getNerStatus()).toBe('loading')
  })
})
