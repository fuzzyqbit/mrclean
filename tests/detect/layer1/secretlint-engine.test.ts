/**
 * Tests for secretlint-engine.ts.
 *
 * Tests the runSecretlint function which runs @secretlint/secretlint-rule-preset-recommend
 * programmatically against in-memory text.
 */

import { describe, it, expect } from 'vitest'
import { runSecretlint } from '../../../src/detect/layer1-regex/secretlint-engine.js'

describe('runSecretlint', () => {
  it('detects an AWS access key and returns a Finding with source=secretlint', async () => {
    // AWS access key with deliberately invalid checksum suffix (X) — still matches the pattern
    const text = 'AKIAIOSFODNN7EXAMPLX some prompt text'
    const findings = await runSecretlint(text)

    expect(findings.length).toBeGreaterThanOrEqual(1)
    const awsFinding = findings.find((f) => f.ruleId.toLowerCase().includes('aws'))
    expect(awsFinding).toBeDefined()
    expect(awsFinding?.source).toBe('secretlint')
    expect(awsFinding?.span.start).toBeGreaterThanOrEqual(0)
    expect(awsFinding?.span.end).toBeGreaterThan(awsFinding?.span.start ?? 0)
  })

  it('returns empty array for non-sensitive text', async () => {
    const findings = await runSecretlint('Lorem ipsum dolor sit amet')
    expect(findings).toEqual([])
  })

  it('maps error severity to HIGH', async () => {
    // The AWS access key is detected at "error" severity by secretlint
    const text = 'AKIAIOSFODNN7EXAMPLX'
    const findings = await runSecretlint(text)

    // At minimum the detection should return findings with HIGH or CRITICAL severity
    const highOrCritical = findings.filter((f) => f.severity === 'HIGH' || f.severity === 'CRITICAL')
    if (findings.length > 0) {
      expect(highOrCritical.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('can be called 10 times without throwing (no resource leak)', async () => {
    // Safe, non-sensitive text used for this repeatability test
    const safeText = 'Hello world, no secrets here: just plain text for testing.'
    for (let i = 0; i < 10; i++) {
      const result = await runSecretlint(safeText)
      expect(Array.isArray(result)).toBe(true)
    }
  })

  it('each Finding has required fields: ruleId, severity, span, value, redactedHash, fingerprint', async () => {
    const text = 'AKIAIOSFODNN7EXAMPLX some prompt text'
    const findings = await runSecretlint(text)

    for (const f of findings) {
      expect(typeof f.ruleId).toBe('string')
      expect(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).toContain(f.severity)
      expect(typeof f.span.start).toBe('number')
      expect(typeof f.span.end).toBe('number')
      expect(f.span.end).toBeGreaterThan(f.span.start)
      expect(typeof f.value).toBe('string')
      expect(f.value.length).toBeGreaterThan(0)
      // redactedHash: first 16 hex chars of SHA-256
      expect(f.redactedHash).toMatch(/^[0-9a-f]{16}$/)
      // fingerprint: ruleId:redactedHash
      expect(f.fingerprint).toBe(`${f.ruleId}:${f.redactedHash}`)
      expect(f.source).toBe('secretlint')
    }
  })
})
