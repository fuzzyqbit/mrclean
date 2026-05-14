/**
 * Tests for the doctor --bench stub.
 *
 * Plan 02-06 Task 2 (TDD: GREEN phase).
 *
 * Tests:
 *   1. Unit: runBenchmark({ runsCount: 3 }) returns a BenchmarkResult with positive numbers
 *   2. Unit: p95 >= p50
 *   3. Unit: bench completes in reasonable wall-clock time (< 30s for runsCount=3)
 *   4. Integration: `node dist/cli.js doctor --bench` exits 0 and prints [bench] markers to stderr
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { runBenchmark } from '../../src/doctor/bench.js'
import type { BenchmarkResult } from '../../src/doctor/bench.js'

const PROJECT_ROOT = join(import.meta.dirname, '..', '..')
const DIST_CLI = join(PROJECT_ROOT, 'dist', 'cli.js')

describe('runBenchmark unit tests', () => {
  it('returns a BenchmarkResult with positive numbers and correct runsCount', async () => {
    const result: BenchmarkResult = await runBenchmark({ runsCount: 3 })

    expect(result.runsCount).toBe(3)
    expect(typeof result.p50).toBe('number')
    expect(typeof result.p95).toBe('number')
    expect(result.p50).toBeGreaterThan(0)
    expect(result.p95).toBeGreaterThan(0)
  }, 30_000)

  it('p95 is >= p50', async () => {
    const result: BenchmarkResult = await runBenchmark({ runsCount: 3 })
    expect(result.p95).toBeGreaterThanOrEqual(result.p50)
  }, 30_000)

  it('completes in < 30s for runsCount=3 (defensive wall-clock bound)', async () => {
    const t0 = Date.now()
    await runBenchmark({ runsCount: 3 })
    const elapsed = Date.now() - t0
    expect(elapsed).toBeLessThan(30_000)
  }, 35_000)
})

describe('doctor --bench CLI integration', () => {
  it('`node dist/cli.js doctor --bench` exits 0 and prints [bench] markers to stderr', () => {
    const result = spawnSync(process.execPath, [DIST_CLI, 'doctor', '--bench'], {
      encoding: 'utf8',
      timeout: 60_000,
    })

    expect(result.status, `Process exited with code ${result.status}. stderr: ${result.stderr}`).toBe(0)

    const output = result.stderr + result.stdout
    expect(output, 'Expected [bench] marker in output').toContain('[bench]')
    expect(output, 'Expected p50 in output').toContain('p50=')
    expect(output, 'Expected p95 in output').toContain('p95=')
  }, 60_000)
})
