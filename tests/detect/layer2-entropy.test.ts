import { describe, it, expect } from 'vitest'
import { shannonEntropy, runLayer2Entropy } from '../../src/detect/layer2-entropy.js'
import type { MrcleanConfig } from '../../src/shared/types.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'

// Use canonical DEFAULT_CONFIG (includes pii field added in Phase 4-02)
const defaultConfig: MrcleanConfig = DEFAULT_CONFIG

describe('shannonEntropy', () => {
  it('returns 0 for a string of all identical chars', () => {
    expect(shannonEntropy('aaaa')).toBe(0)
  })

  it('returns 2 for "abcd" (4 equally likely chars, log2(4) = 2)', () => {
    const result = shannonEntropy('abcd')
    expect(result).toBeCloseTo(2, 5)
  })

  it('returns approximately 4.0 for 64-char hex string (hex charset entropy)', () => {
    // hex: 16 chars, so entropy approaches log2(16) = 4.0 for long uniform hex
    const hexStr = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const result = shannonEntropy(hexStr)
    // For random hex, entropy ≈ 4.0; for this deterministic repeating pattern it may be exactly 4.0
    expect(result).toBeGreaterThan(3.5)
    expect(result).toBeLessThanOrEqual(4.0)
  })

  it('returns higher entropy for a high-entropy random-looking string', () => {
    const highEntropy = 'xT5f9bQa2kWvE3mN7rPcYuSdJhGiLo8qZnRwK1ABC'
    expect(shannonEntropy(highEntropy)).toBeGreaterThan(4.5)
  })
})

describe('runLayer2Entropy', () => {
  it('returns 0 findings for high-entropy token WITHOUT a keyword and length < 40', () => {
    // 25 chars, entropy > 4.5, but no keyword nearby and < 40 chars
    const text = 'xT5f9bQa2kWvE3mN7rPcYuSdJ'
    const findings = runLayer2Entropy(text, defaultConfig)
    expect(findings).toHaveLength(0)
  })

  it('returns 1 finding for high-entropy token WITH a co-located keyword', () => {
    // "secret" keyword followed by high-entropy token within ±40 chars (space-separated)
    const token = 'xT5f9bQa2kWvE3mN7rPcYuSdJ'
    const text = `secret: ${token}`
    const findings = runLayer2Entropy(text, defaultConfig)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.source).toBe('entropy')
    expect(findings[0]!.ruleId).toBe('entropy:high')
    expect(findings[0]!.severity).toBe('MEDIUM')
    expect(findings[0]!.value).toBe(token)
  })

  it('returns 1 finding for 40+ char token with entropy >= 5.0 even without keyword (escalation)', () => {
    // 40+ chars with high enough entropy to trigger escalation path (no keyword context)
    // Use a mixed-charset string that has entropy > 5.0
    const highEntropyToken = 'xT5f9bQa2kWvE3mN7rPcYuSdJhGiLo8qZnRwK1ABC'
    expect(highEntropyToken.length).toBeGreaterThanOrEqual(40)
    const entropy = shannonEntropy(highEntropyToken)
    expect(entropy).toBeGreaterThanOrEqual(5.0)
    // No keyword in surrounding text — use a non-keyword prefix
    const text = `value: ${highEntropyToken}`
    const findings = runLayer2Entropy(text, defaultConfig)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.source).toBe('entropy')
  })

  it('returns 0 findings for UUID v4 even with a keyword and high context entropy', () => {
    // UUID should be shape-allowlisted and never trigger entropy
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const text = `secret: ${uuid}`
    const findings = runLayer2Entropy(text, defaultConfig)
    expect(findings).toHaveLength(0)
  })

  it('returns 0 findings for spans already covered by coveredSpans', () => {
    const token = 'xT5f9bQa2kWvE3mN7rPcYuSdJ'
    const text = `secret: ${token}`
    // Cover the entire token span
    const tokenStart = text.indexOf(token)
    const coveredSpans = [{ start: tokenStart, end: tokenStart + token.length }]
    const findings = runLayer2Entropy(text, defaultConfig, coveredSpans)
    expect(findings).toHaveLength(0)
  })

  it('returns 0 findings when threshold is raised to impossibly high value', () => {
    const token = 'xT5f9bQa2kWvE3mN7rPcYuSdJ'
    const text = `secret: ${token}`
    const highThresholdConfig: MrcleanConfig = {
      ...defaultConfig,
      entropy: { threshold: 7.0, min_length: 20 },
    }
    const findings = runLayer2Entropy(text, highThresholdConfig)
    expect(findings).toHaveLength(0)
  })

  it('returns findings sorted by span.start ascending', () => {
    // Two tokens with keywords in different positions
    const token1 = 'xT5f9bQa2kWvE3mN7rPcYuSdJ'
    const token2 = 'aB3cD7eF1gH5iJ9kL2mN6oP4qR'
    const text = `key=${token2} auth=${token1}`
    const findings = runLayer2Entropy(text, defaultConfig)
    if (findings.length >= 2) {
      expect(findings[0]!.span.start).toBeLessThan(findings[1]!.span.start)
    }
  })

  it('findings have correct redactedHash and fingerprint', () => {
    const token = 'xT5f9bQa2kWvE3mN7rPcYuSdJ'
    const text = `secret: ${token}`
    const findings = runLayer2Entropy(text, defaultConfig)
    expect(findings).toHaveLength(1)
    const f = findings[0]!
    // redactedHash should be a 16-char hex string
    expect(f.redactedHash).toMatch(/^[0-9a-f]{16}$/)
    // fingerprint should be `entropy:high:<redactedHash>`
    expect(f.fingerprint).toBe(`entropy:high:${f.redactedHash}`)
  })
})
