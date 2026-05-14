/**
 * Tests for gitleaks-adapter.ts — RESEARCH §2.2 adaptation logic.
 *
 * Covers:
 *   - adaptGitleaksPattern: all 4 branches of the adaptation logic
 *   - loadGitleaksRules: sanity count check
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  adaptGitleaksPattern,
  loadGitleaksRules,
  _resetGitleaksRulesCache,
} from '../../../src/detect/layer1-regex/gitleaks-adapter.js'

describe('adaptGitleaksPattern', () => {
  it('adapts leading (?i) prefix to /i flag', () => {
    const result = adaptGitleaksPattern('(?i)foo')
    expect(result).toEqual({ pattern: 'foo', flags: 'i' })
  })

  it('returns null for (?-i:) sub-pattern case toggle', () => {
    expect(adaptGitleaksPattern('(?-i:abc)foo')).toBeNull()
  })

  it('returns null for (?P<name>) named capture groups', () => {
    expect(adaptGitleaksPattern('(?P<name>foo)')).toBeNull()
  })

  it('returns null for mid-pattern (?i:) group', () => {
    expect(adaptGitleaksPattern('(?i:foo)bar')).toBeNull()
  })

  it('passes through patterns with no inline flags as-is', () => {
    const pattern = '\\b(AKIA[A-Z2-7]{16})\\b'
    const result = adaptGitleaksPattern(pattern)
    expect(result).toEqual({ pattern, flags: '' })
  })

  it('returns null for undefined/empty input', () => {
    expect(adaptGitleaksPattern('')).toBeNull()
    expect(adaptGitleaksPattern(undefined as unknown as string)).toBeNull()
  })
})

describe('loadGitleaksRules', () => {
  beforeEach(() => {
    _resetGitleaksRulesCache()
  })

  it('returns at least 150 compiled rules (loose floor — RESEARCH estimates 183)', () => {
    const rules = loadGitleaksRules()
    expect(rules.length).toBeGreaterThanOrEqual(150)
  })

  it('returns the same array on repeated calls (singleton cached)', () => {
    const first = loadGitleaksRules()
    const second = loadGitleaksRules()
    expect(first).toBe(second) // Same reference
  })

  it('all compiled rules have valid pattern, flags, keywords, and id fields', () => {
    const rules = loadGitleaksRules()
    for (const rule of rules) {
      expect(typeof rule.id).toBe('string')
      expect(rule.id.length).toBeGreaterThan(0)
      expect(typeof rule.pattern).toBe('string')
      expect(typeof rule.flags).toBe('string')
      expect(Array.isArray(rule.keywords)).toBe(true)
      // All keywords must be lowercase (pre-filter normalisation)
      for (const kw of rule.keywords) {
        expect(kw).toBe(kw.toLowerCase())
      }
      // Pattern + flags must compile to a valid RegExp
      expect(() => new RegExp(rule.pattern, rule.flags + 'g')).not.toThrow()
    }
  })

  it('includes the AWS access token rule (high-value pattern sanity check)', () => {
    const rules = loadGitleaksRules()
    const awsRule = rules.find((r) => r.id === 'aws-access-token')
    expect(awsRule).toBeDefined()
    expect(awsRule?.pattern).toContain('AKIA')
  })
})
