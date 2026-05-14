/**
 * Performance gate — UserPromptSubmit hook latency (PERF-01a)
 *
 * Asserts p95 <= 100ms on a 4KB prompt fixture with 5 Phase-2-corpus secret shapes.
 * Uses plain test() + performance.now() + manual percentile — NOT bench() because
 * vitest bench() does not expose p95 (RESEARCH §Pitfall 1).
 *
 * Reference machine: GitHub Actions ubuntu-latest 2-core.
 * Dev-machine baseline: p95 ~17.4ms (Phase 2 doctor --bench, 2026-05-14).
 *
 * Runs in the integration project (fileParallelism:false, testTimeout:60_000).
 */

import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { runDetection } from '../../src/detect/index.js'
import { loadEffectiveConfig } from '../../src/config/index.js'
import { initSessionState } from '../../src/detect/session-state.js'

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const FIXTURE = readFileSync(resolve(__dirname, 'fixtures/4kb-prompt.txt'), 'utf8')

const N = 50
const WARMUP = 5
const THRESHOLD = 100 // ms — REQUIREMENTS.md PERF-01a

// ---------------------------------------------------------------------------
// Percentile helper
// ---------------------------------------------------------------------------

/**
 * Compute the Pth percentile from a sample array.
 * Sorts ascending in-place and returns the value at the P-th percentile position.
 */
function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.ceil(0.95 * sorted.length) - 1
  return sorted[Math.max(0, idx)] ?? 0
}

// ---------------------------------------------------------------------------
// Perf gate test
// ---------------------------------------------------------------------------

test(
  'UserPromptSubmit p95 <= 100ms on 4KB prompt',
  { timeout: 60_000 },
  async () => {
    const config = await loadEffectiveConfig({ cwd: process.cwd() })
    const sessionState = await initSessionState({
      sessionId: randomUUID(),
      homeDir: process.env['HOME'] ?? process.cwd(),
      cwd: process.cwd(),
      config,
    })

    const sessionId = randomUUID()
    const ctx = {
      sessionId,
      hookEvent: 'UserPromptSubmit' as const,
      cwd: process.cwd(),
    }

    // Warmup iterations — allow JIT to stabilize and pool workers to spin up
    for (let i = 0; i < WARMUP; i++) {
      await runDetection(FIXTURE, config, sessionState, ctx)
    }

    // Measured iterations
    const samples: number[] = []
    for (let i = 0; i < N; i++) {
      const t0 = performance.now()
      await runDetection(FIXTURE, config, sessionState, ctx)
      samples.push(performance.now() - t0)
    }

    const result = p95(samples)
    console.log(
      `[perf] UserPromptSubmit p95=${result.toFixed(2)}ms (N=${N}, threshold=${THRESHOLD}ms, headroom=${(((THRESHOLD - result) / THRESHOLD) * 100).toFixed(0)}%)`,
    )

    expect(result).toBeLessThanOrEqual(THRESHOLD)
  },
)
