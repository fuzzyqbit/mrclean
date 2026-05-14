/**
 * Single-fixture bundle smoke test.
 *
 * Imports `runLayer1` from `dist/detect-layer1.js` (Plan 02-01's test-only bundle entry)
 * and runs ONE positive fixture (AWS access key) through it, asserting >= 1 finding.
 *
 * Purpose: Guards against tsup-bundle regressions of the Layer 1 detection engine.
 * The full orchestrator (runDetection) is exhaustively tested via the tsx path in
 * tests/fixtures-corpus.test.ts. This single-fixture bundle pass plus Plan 02-01's
 * bundle-worker.test.ts together cover the bundle path adequately.
 *
 * Option selected: Option B (use runLayer1 from dist/detect-layer1.js directly).
 * Rationale: dist/detect-layer1.js exports only runLayer1 — not the full runDetection
 * orchestrator. Importing WorkerPool from src/ (same pattern as bundle-worker.test.ts)
 * keeps the test minimal and avoids adding a new tsup entry point.
 *
 * Plan 02-05's vitest globalSetup runs `npm run build` before the integration suite,
 * so dist/detect-layer1.js exists by the time this test executes.
 *
 * Plan 02-06.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { join, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

// import.meta.dirname = tests/ → one level up = project root
const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const DIST_ENTRY = join(PROJECT_ROOT, 'dist', 'detect-layer1.js')

describe('fixture corpus — single-fixture bundle pass (Option B: runLayer1)', () => {
  beforeAll(() => {
    if (!existsSync(DIST_ENTRY)) {
      throw new Error(
        `dist/detect-layer1.js missing. Run \`npm run build\` first OR rely on the integration suite's globalSetup. Path: ${DIST_ENTRY}`,
      )
    }
  })

  it('runLayer1 in the bundled artifact catches the AWS positive fixture', async () => {
    // Dynamic import of the compiled bundle
    const bundledModule = (await import(DIST_ENTRY)) as {
      runLayer1: (
        text: string,
        config: Record<string, unknown>,
        pool: unknown,
      ) => Promise<{ findings: Array<{ ruleId: string; value: string }>; timeoutCount: number }>
    }

    expect(typeof bundledModule.runLayer1).toBe('function')

    // WorkerPool imported from source (same pattern as tests/detect/layer1/bundle-worker.test.ts)
    const { WorkerPool } = (await import(
      join(PROJECT_ROOT, 'src', 'detect', 'layer1-regex', 'worker-pool.js')
    )) as { WorkerPool: new (size: number) => { terminate: () => Promise<void> } }

    const pool = new WorkerPool(2)

    try {
      // Read AWS access key positive fixture and strip comment header
      const fixturePath = join(PROJECT_ROOT, 'tests', 'fixtures', 'positive', 'aws-access-key.txt')
      const raw = readFileSync(fixturePath, 'utf8')
      const text = raw
        .split('\n')
        .filter((line) => !line.startsWith('#'))
        .join('\n')
        .trim()

      // Minimal config mirror for Layer 1
      const config = {
        dry_run: false,
        allowlist: {
          rules: [] as string[],
          paths: [] as string[],
          stopwords: [] as string[],
          regexes: [] as string[],
          fingerprints: [] as string[],
        },
        entropy: { threshold: 4.5, min_length: 20 },
        secrets_files: [] as string[],
        rules: [] as unknown[],
      }

      const result = await bundledModule.runLayer1(text, config, pool)

      expect(
        result.findings.length,
        `Expected >= 1 finding from bundled runLayer1 for AWS access key fixture.\nText:\n${text}\nTimeoutCount: ${result.timeoutCount}`,
      ).toBeGreaterThanOrEqual(1)
    } finally {
      await pool.terminate()
    }
  }, 60_000)
})
