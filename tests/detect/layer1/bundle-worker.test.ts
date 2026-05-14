/**
 * Bundle-worker integration test (RESEARCH OQ-A3 verification).
 *
 * Verifies that:
 *   1. worker_threads with `eval: true` works correctly in the tsup ESM bundle
 *   2. runLayer1 from the BUNDLED dist/detect-layer1.js detects secrets
 *   3. Worker termination (ReDoS protection) works in the bundled artifact
 *
 * This test runs AFTER `npm run build` produces dist/detect-layer1.js.
 * The beforeAll hook triggers a build if the file is missing (60s ceiling).
 *
 * The detect-layer1 bundle entry is a TEST-ONLY artifact — it is NOT published
 * to npm consumers (excluded via package.json#files enumeration).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT_ROOT = join(import.meta.dirname, '..', '..', '..')
const DIST_ENTRY = join(PROJECT_ROOT, 'dist', 'detect-layer1.js')

beforeAll(async () => {
  if (!existsSync(DIST_ENTRY)) {
    console.log('[bundle-worker] dist/detect-layer1.js missing, running npm run build...')
    execSync('npm run build', { cwd: PROJECT_ROOT, timeout: 60000, stdio: 'pipe' })
  }
  expect(existsSync(DIST_ENTRY)).toBe(true)
}, 70000)

describe('bundle-worker — dist/detect-layer1.js', () => {
  it('runLayer1 from the bundled artifact detects an AWS access key', async () => {
    // Dynamic import of the compiled bundle
    const bundledModule = await import(DIST_ENTRY)

    expect(typeof bundledModule.runLayer1).toBe('function')

    const { WorkerPool } = await import(
      join(PROJECT_ROOT, 'src', 'detect', 'layer1-regex', 'worker-pool.js')
    )

    const pool = new WorkerPool(2)

    try {
      const text = 'AKIA1234567890123456 is embedded in the prompt'
      const config = {
        dry_run: false,
        allowlist: { rules: [], paths: [], stopwords: [], regexes: [], fingerprints: [] },
        entropy: { threshold: 4.5, min_length: 20 },
        secrets_files: [],
        rules: [],
      }

      const result = await bundledModule.runLayer1(text, config, pool)

      expect(result).toHaveProperty('findings')
      expect(result).toHaveProperty('timeoutCount')
      expect(result.findings.length).toBeGreaterThanOrEqual(1)
    } finally {
      await pool.terminate()
    }
  }, 60000)

  it('__test__runWorker from the bundled artifact terminates catastrophic patterns', async () => {
    const bundledModule = await import(DIST_ENTRY)

    expect(typeof bundledModule.__test__runWorker).toBe('function')

    // Classic catastrophic backtracking: ^(a+)+$ against long input
    const catastrophicText = 'a'.repeat(28) + 'b'
    const start = Date.now()

    const result = await bundledModule.__test__runWorker(
      '^(a+)+$',
      '',
      catastrophicText,
      50, // 50ms timeout
    )

    const elapsed = Date.now() - start

    // Worker should be terminated within 50ms + overhead
    expect(result.ok).toBe(false)
    if (!result.ok && 'timedOut' in result) {
      expect(result.timedOut).toBe(true)
    }
    // Wall-clock check: should complete well under 500ms
    expect(elapsed).toBeLessThan(500)
  }, 10000)
})
