/**
 * Tests for redos-worker.ts and worker-pool.ts.
 *
 * Covers:
 *   - runRegexInWorker: match success, timeout on catastrophic pattern
 *   - WorkerPool: sequential jobs, graceful terminate
 */

import { describe, it, expect, vi } from 'vitest'
import { runRegexInWorker } from '../../../src/detect/layer1-regex/redos-worker.js'
import { WorkerPool } from '../../../src/detect/layer1-regex/worker-pool.js'

describe('runRegexInWorker', () => {
  it('matches a literal pattern and returns correct match data', async () => {
    const result = await runRegexInWorker('AKIA[A-Z2-7]{16}', '', 'AKIAIOSFODNN7EXAMPLE some text', 200)
    expect(result.ok).toBe(true)
    if (!result.ok) return // type narrowing
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]!.value).toBe('AKIAIOSFODNN7EXAMPLE')
  })

  it('returns { ok: false, timedOut: true } for catastrophic backtracking within timeout', async () => {
    // Classic ReDoS: ^(a+)+$ against a string that forces exponential backtracking
    const catastrophicText = 'a'.repeat(28) + 'b'
    const start = Date.now()
    const result = await runRegexInWorker('^(a+)+$', '', catastrophicText, 50)
    const elapsed = Date.now() - start

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect('timedOut' in result && result.timedOut).toBe(true)
    // Should complete well under 200ms wall-clock (timeout fires at 50ms + worker overhead)
    expect(elapsed).toBeLessThan(500)
  }, 10000) // generous test timeout for CI
})

describe('WorkerPool', () => {
  it('processes 5 sequential simple regex jobs and returns expected results', async () => {
    const pool = new WorkerPool(2)
    const testCases = [
      { pattern: 'hello', text: 'say hello world', expected: 'hello' },
      { pattern: 'AKIA[A-Z2-7]{16}', text: 'key=AKIAIOSFODNN7EXAMPLE here', expected: 'AKIAIOSFODNN7EXAMPLE' },
      { pattern: '\\d+', text: 'number 42 here', expected: '42' },
      { pattern: 'foo', text: 'foobar', expected: 'foo' },
      { pattern: 'bar', text: 'foobar', expected: 'bar' },
    ]

    for (const tc of testCases) {
      const result = await pool.runRegex(tc.pattern, '', tc.text, 200)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const foundValue = result.matches.some((m) => m.value === tc.expected)
      expect(foundValue).toBe(true)
    }

    await pool.terminate()
  }, 30000)

  it('terminate() resolves cleanly with idle workers', async () => {
    const pool = new WorkerPool(2)
    // Trigger initialization by running one job
    await pool.runRegex('test', '', 'test string', 200)
    // Now terminate while workers are idle
    await expect(pool.terminate()).resolves.toBeUndefined()
  }, 10000)

  it('terminates timed-out worker and replaces with fresh one for subsequent jobs', async () => {
    const pool = new WorkerPool(1)
    // First job: catastrophic pattern → timeout
    const catastrophicText = 'a'.repeat(28) + 'b'
    const timeoutResult = await pool.runRegex('^(a+)+$', '', catastrophicText, 50)
    expect(timeoutResult.ok).toBe(false)

    // Second job: simple pattern should still work (pool replaced the dead worker)
    const okResult = await pool.runRegex('hello', '', 'hello world', 200)
    expect(okResult.ok).toBe(true)

    await pool.terminate()
  }, 20000)
})
