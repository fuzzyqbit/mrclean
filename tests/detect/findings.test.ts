/**
 * Tests for canonical Finding helpers in src/detect/findings.ts.
 *
 * Covers:
 *   - sha256hex determinism and format
 *   - redactedHash length and relationship to sha256hex
 *   - fingerprint format
 *   - dedupBySpan: non-overlapping, identical spans, overlapping spans, action preservation
 */

import { describe, it, expect } from 'vitest'
import {
  sha256hex,
  redactedHash,
  fingerprint,
  dedupBySpan,
} from '../../src/detect/findings.js'
import type { Finding } from '../../src/detect/findings.js'

// ---------------------------------------------------------------------------
// Helpers to build minimal test Finding objects
// ---------------------------------------------------------------------------

function makeFinding(
  overrides: Partial<Finding> & Pick<Finding, 'ruleId' | 'span' | 'source' | 'value'>,
): Finding {
  const { value } = overrides
  return {
    severity: 'HIGH',
    redactedHash: redactedHash(value),
    fingerprint: fingerprint(overrides.ruleId, value),
    action: undefined,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// sha256hex
// ---------------------------------------------------------------------------

describe('sha256hex', () => {
  // Test 1: returns 64-char lowercase hex and is deterministic
  it('returns a 64-char lowercase hex string and is deterministic across 5 invocations', () => {
    const value = 'AKIAIOSFODNN7EXAMPLE'
    const first = sha256hex(value)

    expect(first).toHaveLength(64)
    expect(first).toMatch(/^[0-9a-f]{64}$/)

    // 5× determinism check
    for (let i = 0; i < 5; i++) {
      expect(sha256hex(value)).toBe(first)
    }
  })
})

// ---------------------------------------------------------------------------
// redactedHash
// ---------------------------------------------------------------------------

describe('redactedHash', () => {
  // Test 2: is exactly 16 chars and equals sha256hex(value).slice(0, 16)
  it('returns exactly 16 chars equal to sha256hex(value).slice(0, 16)', () => {
    const value = 'my-secret-token'
    const result = redactedHash(value)

    expect(result).toHaveLength(16)
    expect(result).toBe(sha256hex(value).slice(0, 16))
  })
})

// ---------------------------------------------------------------------------
// fingerprint
// ---------------------------------------------------------------------------

describe('fingerprint', () => {
  // Test 3: returns `${ruleId}:${redactedHash(value)}`
  it('returns `${ruleId}:${redactedHash(value)}`', () => {
    const ruleId = 'AWSAccessKeyID'
    const value = 'AKIAIOSFODNN7EXAMPLE'

    const result = fingerprint(ruleId, value)

    expect(result).toBe(`${ruleId}:${redactedHash(value)}`)
    expect(result).toMatch(/^AWSAccessKeyID:[0-9a-f]{16}$/)
  })
})

// ---------------------------------------------------------------------------
// dedupBySpan
// ---------------------------------------------------------------------------

describe('dedupBySpan', () => {
  // Test 4: empty input returns empty array
  it('returns [] for empty input', () => {
    expect(dedupBySpan([])).toEqual([])
  })

  // Test 5: non-overlapping spans pass through unchanged, sorted by span.start
  it('passes non-overlapping findings through, sorted by span.start', () => {
    const a = makeFinding({ ruleId: 'AWSAccessKeyID', span: { start: 0, end: 5 }, source: 'secretlint', value: 'hello' })
    const b = makeFinding({ ruleId: 'JWT', span: { start: 10, end: 15 }, source: 'gitleaks', value: 'world' })

    // Pass in reverse order to test sorting
    const result = dedupBySpan([b, a])
    expect(result).toHaveLength(2)
    expect(result[0]!.span.start).toBe(0)
    expect(result[1]!.span.start).toBe(10)
  })

  // Test 6: identical spans — secretlint beats gitleaks (lower source precedence index)
  it('prefers secretlint over gitleaks for identical spans', () => {
    const gitleaksMatch = makeFinding({
      ruleId: 'gitleaks:aws-access-token',
      span: { start: 0, end: 10 },
      source: 'gitleaks',
      value: 'AKIAIOSFODNN7EXAMPLE',
    })
    const secretlintMatch = makeFinding({
      ruleId: 'AWSAccessKeyID',
      span: { start: 0, end: 10 },
      source: 'secretlint',
      value: 'AKIAIOSFODNN7EXAMPLE',
    })

    const result = dedupBySpan([gitleaksMatch, secretlintMatch])
    expect(result).toHaveLength(1)
    expect(result[0]!.source).toBe('secretlint')
  })

  // Test 7: overlapping unequal spans — the LONGER span wins regardless of source precedence
  it('selects the longer span over a shorter one regardless of source', () => {
    const shorter = makeFinding({
      ruleId: 'gitleaks:aws-access-token',
      span: { start: 0, end: 10 },
      source: 'gitleaks',
      value: 'short-match',
    })
    const longer = makeFinding({
      ruleId: 'entropy:high',
      span: { start: 5, end: 20 },
      source: 'entropy',
      value: 'a-longer-match-that-overlaps',
    })

    // gitleaks has higher priority than entropy, but entropy's span is longer
    const result = dedupBySpan([shorter, longer])
    expect(result).toHaveLength(1)
    expect(result[0]!.source).toBe('entropy')
    expect(result[0]!.span).toEqual({ start: 5, end: 20 })
  })

  // Test 8: action field is preserved on the surviving finding
  it('preserves the action field on the surviving finding', () => {
    const f = makeFinding({
      ruleId: 'word:acme',
      span: { start: 0, end: 4 },
      source: 'words',
      value: 'acme',
      action: 'warn',
    })

    const result = dedupBySpan([f])
    expect(result).toHaveLength(1)
    expect(result[0]!.action).toBe('warn')
  })

  // Test 9: pii-regex source type-checks and is accepted by dedupBySpan
  it('accepts a Finding with source pii-regex and returns it from dedupBySpan', () => {
    const f = makeFinding({
      ruleId: 'pii:email',
      span: { start: 0, end: 20 },
      source: 'pii-regex',
      value: 'test@example.com',
    })

    const result = dedupBySpan([f])
    expect(result).toHaveLength(1)
    expect(result[0]!.source).toBe('pii-regex')
  })

  // Test 10: pii-ner source type-checks and is accepted by dedupBySpan
  it('accepts a Finding with source pii-ner and returns it from dedupBySpan', () => {
    const f = makeFinding({
      ruleId: 'pii:PERSON',
      span: { start: 5, end: 15 },
      source: 'pii-ner',
      value: 'John Smith',
    })

    const result = dedupBySpan([f])
    expect(result).toHaveLength(1)
    expect(result[0]!.source).toBe('pii-ner')
  })

  // Test 11: words outranks pii-regex for equal-length overlapping spans
  it('keeps words finding over pii-regex for equal-length overlapping span', () => {
    const wordsFind = makeFinding({
      ruleId: 'word:acme',
      span: { start: 0, end: 10 },
      source: 'words',
      value: 'acme-corp',
    })
    const piiRegexFind = makeFinding({
      ruleId: 'pii:email',
      span: { start: 0, end: 10 },
      source: 'pii-regex',
      value: 'acme-corp@',
    })

    const result = dedupBySpan([wordsFind, piiRegexFind])
    expect(result).toHaveLength(1)
    expect(result[0]!.source).toBe('words')
  })

  // Test 12: pii-regex outranks pii-ner for equal-length overlapping spans
  it('keeps pii-regex finding over pii-ner for equal-length overlapping span', () => {
    const piiRegexFind = makeFinding({
      ruleId: 'pii:email',
      span: { start: 0, end: 10 },
      source: 'pii-regex',
      value: 'test@test.',
    })
    const piiNerFind = makeFinding({
      ruleId: 'pii:PERSON',
      span: { start: 0, end: 10 },
      source: 'pii-ner',
      value: 'John Smith',
    })

    const result = dedupBySpan([piiRegexFind, piiNerFind])
    expect(result).toHaveLength(1)
    expect(result[0]!.source).toBe('pii-regex')
  })

  // Test 13: existing secret-layer precedence secretlint > gitleaks > entropy > env > words still passes
  it('maintains secret-layer precedence: secretlint > gitleaks > entropy > env > words', () => {
    const secretlintFind = makeFinding({ ruleId: 'AWSAccessKeyID', span: { start: 0, end: 20 }, source: 'secretlint', value: 'AWS_KEY' })
    const gitleaksFind = makeFinding({ ruleId: 'gitleaks:aws', span: { start: 0, end: 20 }, source: 'gitleaks', value: 'AWS_KEY' })
    const entropyFind = makeFinding({ ruleId: 'entropy:high', span: { start: 0, end: 20 }, source: 'entropy', value: 'AWS_KEY' })
    const envFind = makeFinding({ ruleId: 'env:literal', span: { start: 0, end: 20 }, source: 'env', value: 'AWS_KEY' })
    const wordsFind = makeFinding({ ruleId: 'word:key', span: { start: 0, end: 20 }, source: 'words', value: 'AWS_KEY' })

    // secretlint wins over all
    expect(dedupBySpan([gitleaksFind, secretlintFind])[0]!.source).toBe('secretlint')
    expect(dedupBySpan([entropyFind, secretlintFind])[0]!.source).toBe('secretlint')

    // gitleaks wins over entropy, env, words
    expect(dedupBySpan([entropyFind, gitleaksFind])[0]!.source).toBe('gitleaks')

    // entropy wins over env, words
    expect(dedupBySpan([envFind, entropyFind])[0]!.source).toBe('entropy')

    // env wins over words
    expect(dedupBySpan([wordsFind, envFind])[0]!.source).toBe('env')
  })
})
