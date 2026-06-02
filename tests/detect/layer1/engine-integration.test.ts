/**
 * Integration tests for the full Layer 1 detection engine (runLayer1).
 *
 * TDD RED phase: these tests describe end-to-end behavior and will fail until
 * secretlint-engine.ts, gitleaks-engine.ts, and index.ts are implemented.
 */

import { describe, it, expect } from 'vitest'
import { WorkerPool } from '../../../src/detect/layer1-regex/worker-pool.js'
import { fingerprint } from '../../../src/detect/findings.js'
import type { MrcleanConfig } from '../../../src/shared/types.js'
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js'

// Lazy import index.ts after it exists
async function getRunLayer1() {
  const mod = await import('../../../src/detect/layer1-regex/index.js')
  return mod.runLayer1
}

describe('runLayer1 — integration', () => {
  it('detects AWS fixture and returns at least 1 Finding', async () => {
    const runLayer1 = await getRunLayer1()
    const pool = new WorkerPool(2)
    try {
      const text = 'AKIAIOSFODNN7EXAMPLX is embedded in the prompt'
      const result = await runLayer1(text, DEFAULT_CONFIG, pool)

      expect(result.findings.length).toBeGreaterThanOrEqual(1)
      expect(typeof result.timeoutCount).toBe('number')
    } finally {
      await pool.terminate()
    }
  }, 30000)

  it('drops findings whose ruleId is in config.allowlist.rules', async () => {
    const runLayer1 = await getRunLayer1()
    const pool = new WorkerPool(2)
    try {
      const text = 'AKIAIOSFODNN7EXAMPLX is in the text'
      const config: MrcleanConfig = {
        ...DEFAULT_CONFIG,
        allowlist: {
          ...DEFAULT_CONFIG.allowlist,
          rules: ['AWSAccessKeyID', 'aws-access-token', 'gitleaks:aws-access-token'],
        },
      }
      const result = await runLayer1(text, config, pool)

      // All AWS-key findings should be dropped; any others that don't match should remain
      const awsFindings = result.findings.filter(
        (f) =>
          f.ruleId.toLowerCase().includes('aws') ||
          f.ruleId.toLowerCase().includes('access'),
      )
      expect(awsFindings).toHaveLength(0)
    } finally {
      await pool.terminate()
    }
  }, 30000)

  it('drops findings whose fingerprint is in config.allowlist.fingerprints', async () => {
    const runLayer1 = await getRunLayer1()
    const pool = new WorkerPool(2)
    try {
      const text = 'AKIAIOSFODNN7EXAMPLX is in the text'
      // First run without allowlist to get the fingerprint
      const firstResult = await runLayer1(text, DEFAULT_CONFIG, pool)
      expect(firstResult.findings.length).toBeGreaterThanOrEqual(1)

      const allFingerprints = firstResult.findings.map((f) => f.fingerprint)

      // Second run with all fingerprints allowlisted
      const config: MrcleanConfig = {
        ...DEFAULT_CONFIG,
        allowlist: { ...DEFAULT_CONFIG.allowlist, fingerprints: allFingerprints },
      }
      const secondResult = await runLayer1(text, config, pool)
      expect(secondResult.findings).toHaveLength(0)
    } finally {
      await pool.terminate()
    }
  }, 30000)

  it('applies per-rule action override (audit + severity)', async () => {
    const runLayer1 = await getRunLayer1()
    const pool = new WorkerPool(2)
    try {
      const text = 'AKIAIOSFODNN7EXAMPLX in prompt'
      const config: MrcleanConfig = {
        ...DEFAULT_CONFIG,
        rules: [{ id: 'AWSAccessKeyID', action: 'audit', severity: 'LOW' }],
      }
      const result = await runLayer1(text, config, pool)

      const awsFinding = result.findings.find((f) => f.ruleId === 'AWSAccessKeyID')
      if (awsFinding) {
        expect(awsFinding.severity).toBe('LOW')
        expect(awsFinding.action).toBe('audit')
      }
    } finally {
      await pool.terminate()
    }
  }, 30000)

  it('drops all findings for a rule with action=off', async () => {
    const runLayer1 = await getRunLayer1()
    const pool = new WorkerPool(2)
    try {
      const text = 'AKIAIOSFODNN7EXAMPLX in prompt'
      const config: MrcleanConfig = {
        ...DEFAULT_CONFIG,
        rules: [{ id: 'AWSAccessKeyID', action: 'off', severity: 'LOW' }],
      }
      const result = await runLayer1(text, config, pool)

      const awsFinding = result.findings.find((f) => f.ruleId === 'AWSAccessKeyID')
      expect(awsFinding).toBeUndefined()
    } finally {
      await pool.terminate()
    }
  }, 30000)
})
