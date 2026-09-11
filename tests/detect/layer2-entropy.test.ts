import { describe, it, expect } from 'vitest'
import {
  shannonEntropy,
  runLayer2Entropy,
  MAX_TOKEN_LENGTH,
} from '../../src/detect/layer2-entropy.js'
import type { MrcleanConfig } from '../../src/shared/types.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'

// Use canonical DEFAULT_CONFIG (includes pii field added in Phase 4-02)
const defaultConfig: MrcleanConfig = DEFAULT_CONFIG

// ---------------------------------------------------------------------------
// Deterministic high-entropy fixture generator
// ---------------------------------------------------------------------------

/** Seed used for every generated run so boundary assertions cannot flake. */
const FIXTURE_SEED = 1

/**
 * Alphanumeric charset assembled from code points instead of written as a
 * literal.
 *
 * A 62-char alphabet literal is itself a high-entropy token (length >= 40,
 * entropy ~5.95), so editing this file from inside a session running mrclean's
 * own hook replaces the literal with a placeholder — silently degrading every
 * fixture built from it to ~16 distinct chars and ~3.9 bits/char, well under the
 * escalation floor. Do NOT "simplify" this back into a string literal.
 */
function buildTokenCharset(): string {
  const codes: number[] = []
  for (let code = 0x30; code <= 0x39; code++) codes.push(code) // '0'-'9'
  for (let code = 0x41; code <= 0x5a; code++) codes.push(code) // 'A'-'Z'
  for (let code = 0x61; code <= 0x7a; code++) codes.push(code) // 'a'-'z'
  return String.fromCharCode(...codes)
}

const TOKEN_CHARSET = buildTokenCharset()

/**
 * Build a deterministic pseudo-random alphanumeric run of `length` chars.
 *
 * Uses xorshift32 so the fixture is reproducible across runs and platforms.
 * Output entropy lands near log2(62) = 5.95 bits/char, above the
 * length >= 40 && entropy >= 5.0 escalation path — so any run built here WOULD
 * be reported if the length cap were not skipping it. That is what makes the
 * zero-findings assertions below non-vacuous.
 */
function highEntropyRun(length: number, seed: number = FIXTURE_SEED): string {
  const chars: string[] = []
  let state = seed >>> 0
  for (let i = 0; i < length; i++) {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    chars.push(TOKEN_CHARSET[state % TOKEN_CHARSET.length]!)
  }
  return chars.join('')
}

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
    const findings = runLayer2Entropy(text, defaultConfig).findings
    expect(findings).toHaveLength(0)
  })

  it('returns 1 finding for high-entropy token WITH a co-located keyword', () => {
    // "secret" keyword followed by high-entropy token within ±40 chars (space-separated)
    const token = 'xT5f9bQa2kWvE3mN7rPcYuSdJ'
    const text = `secret: ${token}`
    const findings = runLayer2Entropy(text, defaultConfig).findings
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
    const findings = runLayer2Entropy(text, defaultConfig).findings
    expect(findings).toHaveLength(1)
    expect(findings[0]!.source).toBe('entropy')
  })

  it('returns 0 findings for UUID v4 even with a keyword and high context entropy', () => {
    // UUID should be shape-allowlisted and never trigger entropy
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const text = `secret: ${uuid}`
    const findings = runLayer2Entropy(text, defaultConfig).findings
    expect(findings).toHaveLength(0)
  })

  it('returns 0 findings for spans already covered by coveredSpans', () => {
    const token = 'xT5f9bQa2kWvE3mN7rPcYuSdJ'
    const text = `secret: ${token}`
    // Cover the entire token span
    const tokenStart = text.indexOf(token)
    const coveredSpans = [{ start: tokenStart, end: tokenStart + token.length }]
    const findings = runLayer2Entropy(text, defaultConfig, coveredSpans).findings
    expect(findings).toHaveLength(0)
  })

  it('returns 0 findings when threshold is raised to impossibly high value', () => {
    const token = 'xT5f9bQa2kWvE3mN7rPcYuSdJ'
    const text = `secret: ${token}`
    const highThresholdConfig: MrcleanConfig = {
      ...defaultConfig,
      entropy: { threshold: 7.0, min_length: 20 },
    }
    const findings = runLayer2Entropy(text, highThresholdConfig).findings
    expect(findings).toHaveLength(0)
  })

  it('returns findings sorted by span.start ascending', () => {
    // Two tokens with keywords in different positions
    const token1 = 'xT5f9bQa2kWvE3mN7rPcYuSdJ'
    const token2 = 'aB3cD7eF1gH5iJ9kL2mN6oP4qR'
    const text = `key=${token2} auth=${token1}`
    const findings = runLayer2Entropy(text, defaultConfig).findings
    if (findings.length >= 2) {
      expect(findings[0]!.span.start).toBeLessThan(findings[1]!.span.start)
    }
  })

  it('findings have correct redactedHash and fingerprint', () => {
    const token = 'xT5f9bQa2kWvE3mN7rPcYuSdJ'
    const text = `secret: ${token}`
    const findings = runLayer2Entropy(text, defaultConfig).findings
    expect(findings).toHaveLength(1)
    const f = findings[0]!
    // redactedHash should be a 16-char hex string
    expect(f.redactedHash).toMatch(/^[0-9a-f]{16}$/)
    // fingerprint should be `entropy:high:<redactedHash>`
    expect(f.fingerprint).toBe(`entropy:high:${f.redactedHash}`)
  })
})

describe('runLayer2Entropy — MAX_TOKEN_LENGTH bound', () => {
  it('exposes MAX_TOKEN_LENGTH as 4096', () => {
    expect(MAX_TOKEN_LENGTH).toBe(4096)
  })

  it('still scans a token exactly at MAX_TOKEN_LENGTH', () => {
    // Arrange — at the cap, so in range
    const token = highEntropyRun(MAX_TOKEN_LENGTH)
    expect(token).toHaveLength(MAX_TOKEN_LENGTH)
    expect(shannonEntropy(token)).toBeGreaterThanOrEqual(5.0)

    // Act
    const result = runLayer2Entropy(token, defaultConfig)

    // Assert
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.value).toHaveLength(MAX_TOKEN_LENGTH)
    expect(result.findings[0]!.span).toEqual({ start: 0, end: MAX_TOKEN_LENGTH })
    expect(result.skippedOversizedTokens).toBe(0)
  })

  it('skips a token one char over MAX_TOKEN_LENGTH and emits no fragment findings', () => {
    // Arrange — one char past the cap
    const token = highEntropyRun(MAX_TOKEN_LENGTH + 1)
    expect(token).toHaveLength(MAX_TOKEN_LENGTH + 1)

    // Act
    const result = runLayer2Entropy(token, defaultConfig)

    // Assert — the whole run is skipped, NOT shredded into adjacent fragments
    expect(result.findings).toEqual([])
    expect(result.skippedOversizedTokens).toBe(1)
  })

  it('reports zero findings for a 300 KB high-entropy run instead of one whole-blob finding', () => {
    // Arrange — the real-world shape: a minified bundle is one token.
    // Before the cap this produced exactly ONE finding spanning all 307,200 chars,
    // which in substitute mode replaces the entire file with a single placeholder.
    const huge = highEntropyRun(300 * 1024)
    expect(huge).toHaveLength(307_200)

    // Act
    const result = runLayer2Entropy(huge, defaultConfig)

    // Assert
    expect(result.findings).toHaveLength(0)
    expect(result.skippedOversizedTokens).toBe(1)
  })

  it('skips only the over-length run — a neighbouring in-range token is still reported', () => {
    // Arrange
    const huge = highEntropyRun(300 * 1024)
    const inRange = highEntropyRun(64, 99)
    expect(shannonEntropy(inRange)).toBeGreaterThanOrEqual(5.0)
    const text = `${huge} ${inRange}`

    // Act
    const result = runLayer2Entropy(text, defaultConfig)

    // Assert — the cap is local to the offending token
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.value).toBe(inRange)
    expect(result.skippedOversizedTokens).toBe(1)
  })

  it('counts each over-length run separately', () => {
    // Arrange — two independent over-length runs separated by a space
    const text = `${highEntropyRun(MAX_TOKEN_LENGTH + 1)} ${highEntropyRun(MAX_TOKEN_LENGTH + 1, 42)}`

    // Act
    const result = runLayer2Entropy(text, defaultConfig)

    // Assert
    expect(result.findings).toHaveLength(0)
    expect(result.skippedOversizedTokens).toBe(2)
  })
})
