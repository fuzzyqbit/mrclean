/**
 * Unit tests for src/detect/layer6a-pii.ts — L6a regex-PII engine.
 *
 * Plan 05-01, Task 2 — TDD RED gate.
 *
 * Covers 11 behaviors:
 *   1. Detects valid email; emits ruleId 'pii:email', source 'pii-regex', severity 'MEDIUM', action 'warn'
 *   2. Detects Luhn-valid credit card; ruleId 'pii:credit_card', severity 'HIGH', action 'block'
 *   3. Luhn-invalid card-shaped number is NOT emitted
 *   4. Detects valid US SSN; rejects invalid ranges (000/666/9xx group, 0000 serial)
 *   5. Detects US phone NNN-NNN-NNNN; does NOT match version string "3.14.1592"
 *   6. Detects valid IPv4; each octet 0-255 enforced; ruleId 'pii:ip', severity 'LOW', action 'audit'
 *   7. Entity not in piiConfig.entities is skipped
 *   8. Candidate whose span is in coveredSpans is skipped
 *   9. Findings carry correct redactedHash + fingerprint
 *  10. Running engine twice yields correct results (no global-regex lastIndex bleed)
 *  11. Allowlist suppression — email matching config.allowlist.stopwords returns zero findings
 */

import { describe, it, expect } from 'vitest'
import { runLayer6aPii, luhnCheck } from '../../src/detect/layer6a-pii.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'
import { redactedHash, fingerprint } from '../../src/detect/findings.js'
import type { MrcleanConfig, MrcleanPiiRegexConfig } from '../../src/shared/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a full config with pii.regex enabled. */
function makeConfig(overrides: Partial<MrcleanConfig> = {}): MrcleanConfig {
  return {
    ...DEFAULT_CONFIG,
    pii: {
      ...DEFAULT_CONFIG.pii,
      enabled: true,
      regex: {
        ...DEFAULT_CONFIG.pii.regex,
        enabled: true,
      },
    },
    ...overrides,
  }
}

/** Extract piiConfig from a full config. */
function getPiiConfig(config: MrcleanConfig): MrcleanPiiRegexConfig {
  return config.pii.regex
}

// ---------------------------------------------------------------------------
// luhnCheck tests (exported utility)
// ---------------------------------------------------------------------------

describe('luhnCheck', () => {
  it('returns true for a well-known Luhn-valid Visa test card (4111111111111111)', () => {
    expect(luhnCheck('4111111111111111')).toBe(true)
  })

  it('returns true for Visa with spaces (4111 1111 1111 1111)', () => {
    expect(luhnCheck('4111 1111 1111 1111')).toBe(true)
  })

  it('returns false for a Luhn-invalid card number (4111111111111112)', () => {
    expect(luhnCheck('4111111111111112')).toBe(false)
  })

  it('returns false for strings shorter than 13 digits', () => {
    expect(luhnCheck('411111111111')).toBe(false)
  })

  it('returns false for strings longer than 19 digits', () => {
    expect(luhnCheck('41111111111111111111')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// runLayer6aPii tests
// ---------------------------------------------------------------------------

describe('runLayer6aPii', () => {
  it('Test 1: detects a valid email; emits ruleId pii:email, source pii-regex, severity MEDIUM, action warn', () => {
    const config = makeConfig()
    const text = 'Please contact admin@example.com for support'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)

    expect(findings.length).toBeGreaterThanOrEqual(1)
    const emailFinding = findings.find((f) => f.ruleId === 'pii:email')
    expect(emailFinding).toBeDefined()
    expect(emailFinding!.source).toBe('pii-regex')
    expect(emailFinding!.severity).toBe('MEDIUM')
    expect(emailFinding!.action).toBe('warn')
    expect(emailFinding!.value).toBe('admin@example.com')
  })

  it('Test 2: detects a Luhn-valid credit card; ruleId pii:credit_card, severity HIGH, action block', () => {
    const config = makeConfig()
    // Visa test card number: 4111111111111111
    const text = 'Card number: 4111111111111111'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)

    expect(findings.length).toBeGreaterThanOrEqual(1)
    const ccFinding = findings.find((f) => f.ruleId === 'pii:credit_card')
    expect(ccFinding).toBeDefined()
    expect(ccFinding!.source).toBe('pii-regex')
    expect(ccFinding!.severity).toBe('HIGH')
    expect(ccFinding!.action).toBe('block')
  })

  it('Test 3: a structurally card-shaped but Luhn-INVALID number is NOT emitted', () => {
    const config = makeConfig()
    // 4111111111111112 — Luhn invalid (last digit wrong)
    const text = 'Bad card: 4111111111111112'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)

    const ccFinding = findings.find((f) => f.ruleId === 'pii:credit_card')
    expect(ccFinding).toBeUndefined()
  })

  // CR-01 regression: separator-formatted cards are the most common real-world
  // format. The prior contiguous-only regex never matched them, so they leaked.
  it('Test 2b (CR-01): detects a space-separated Visa card (4111 1111 1111 1111)', () => {
    const config = makeConfig()
    const text = 'Card number: 4111 1111 1111 1111'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)

    const ccFinding = findings.find((f) => f.ruleId === 'pii:credit_card')
    expect(ccFinding).toBeDefined()
    // The full separated string must be the matched span (so substitution redacts it all)
    expect(ccFinding!.value).toBe('4111 1111 1111 1111')
    expect(ccFinding!.severity).toBe('HIGH')
    expect(ccFinding!.action).toBe('block')
  })

  it('Test 2c (CR-01): detects a hyphen-separated Visa card (4111-1111-1111-1111)', () => {
    const config = makeConfig()
    const text = 'Card: 4111-1111-1111-1111 on file'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)

    const ccFinding = findings.find((f) => f.ruleId === 'pii:credit_card')
    expect(ccFinding).toBeDefined()
    expect(ccFinding!.value).toBe('4111-1111-1111-1111')
  })

  it('Test 2d (CR-01): detects a space-separated Amex card (3782 822463 10005)', () => {
    const config = makeConfig()
    // 378282246310005 — well-known Amex Luhn-valid test card, 4-6-5 grouping
    const text = 'Amex: 3782 822463 10005'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)

    const ccFinding = findings.find((f) => f.ruleId === 'pii:credit_card')
    expect(ccFinding).toBeDefined()
    expect(ccFinding!.value).toBe('3782 822463 10005')
  })

  it('Test 2e (CR-01): a separator-formatted Luhn-INVALID number is NOT emitted', () => {
    const config = makeConfig()
    // 4111 1111 1111 1112 — Luhn invalid
    const text = 'Bad: 4111 1111 1111 1112'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)

    const ccFinding = findings.find((f) => f.ruleId === 'pii:credit_card')
    expect(ccFinding).toBeUndefined()
  })

  it('Test 4a: detects a valid US SSN with separators', () => {
    const config = makeConfig()
    // Valid SSN: 123-45-6789 (not 000/666/9xx group, not 0000 serial)
    const text = 'SSN: 123-45-6789'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)

    const ssnFinding = findings.find((f) => f.ruleId === 'pii:ssn')
    expect(ssnFinding).toBeDefined()
    expect(ssnFinding!.source).toBe('pii-regex')
    expect(ssnFinding!.severity).toBe('HIGH')
    expect(ssnFinding!.action).toBe('block')
  })

  it('Test 4b: rejects SSN with group 000 (negative lookahead)', () => {
    const config = makeConfig()
    const text = 'Invalid SSN: 000-45-6789'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)
    const ssnFinding = findings.find((f) => f.ruleId === 'pii:ssn')
    expect(ssnFinding).toBeUndefined()
  })

  it('Test 4c: rejects SSN with group 666', () => {
    const config = makeConfig()
    const text = 'Invalid SSN: 666-45-6789'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)
    const ssnFinding = findings.find((f) => f.ruleId === 'pii:ssn')
    expect(ssnFinding).toBeUndefined()
  })

  it('Test 4d: rejects SSN with group 9xx (ITIN range)', () => {
    const config = makeConfig()
    const text = 'Invalid SSN: 900-45-6789'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)
    const ssnFinding = findings.find((f) => f.ruleId === 'pii:ssn')
    expect(ssnFinding).toBeUndefined()
  })

  it('Test 4e: rejects SSN with serial 0000', () => {
    const config = makeConfig()
    const text = 'Invalid SSN: 123-45-0000'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)
    const ssnFinding = findings.find((f) => f.ruleId === 'pii:ssn')
    expect(ssnFinding).toBeUndefined()
  })

  it('Test 5a: detects a US phone NNN-NNN-NNNN with NPA/NXX starting 2-9', () => {
    const config = makeConfig()
    const text = 'Call us at 212-555-1234'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)

    const phoneFinding = findings.find((f) => f.ruleId === 'pii:phone')
    expect(phoneFinding).toBeDefined()
    expect(phoneFinding!.source).toBe('pii-regex')
    expect(phoneFinding!.severity).toBe('MEDIUM')
    expect(phoneFinding!.action).toBe('warn')
  })

  it('Test 5b: does NOT match version string "3.14.1592" as a phone number', () => {
    const config = makeConfig()
    const text = 'Version 3.14.1592 released'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)

    const phoneFinding = findings.find((f) => f.ruleId === 'pii:phone')
    expect(phoneFinding).toBeUndefined()
  })

  it('Test 6: detects a valid IPv4; each octet 0-255 enforced; ruleId pii:ip, severity LOW, action audit', () => {
    const config = makeConfig()
    const text = 'Server IP: 192.168.1.100'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)

    const ipFinding = findings.find((f) => f.ruleId === 'pii:ip')
    expect(ipFinding).toBeDefined()
    expect(ipFinding!.source).toBe('pii-regex')
    expect(ipFinding!.severity).toBe('LOW')
    expect(ipFinding!.action).toBe('audit')
    expect(ipFinding!.value).toBe('192.168.1.100')
  })

  it('Test 6b: does not emit finding for invalid octet 256 in IPv4', () => {
    const config = makeConfig()
    const text = 'Address: 256.1.1.1'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)
    const ipFinding = findings.find((f) => f.ruleId === 'pii:ip')
    expect(ipFinding).toBeUndefined()
  })

  it('Test 7: entity NOT in piiConfig.entities is skipped', () => {
    const config = makeConfig({
      pii: {
        ...DEFAULT_CONFIG.pii,
        enabled: true,
        regex: {
          ...DEFAULT_CONFIG.pii.regex,
          enabled: true,
          entities: ['email'], // Only email — SSN should be skipped
        },
      },
    })
    const text = 'SSN: 123-45-6789 email: user@test.com'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)

    // SSN should NOT be detected (not in entities)
    const ssnFinding = findings.find((f) => f.ruleId === 'pii:ssn')
    expect(ssnFinding).toBeUndefined()

    // Email SHOULD be detected (in entities)
    const emailFinding = findings.find((f) => f.ruleId === 'pii:email')
    expect(emailFinding).toBeDefined()
  })

  it('Test 8: candidate whose span is in coveredSpans is skipped', () => {
    const config = makeConfig()
    const text = 'admin@example.com'
    // Provide the span of the email as already covered
    const emailStart = 0
    const emailEnd = text.length
    const coveredSpans = [{ start: emailStart, end: emailEnd }]

    const findings = runLayer6aPii(text, getPiiConfig(config), config, coveredSpans)
    const emailFinding = findings.find((f) => f.ruleId === 'pii:email')
    expect(emailFinding).toBeUndefined()
  })

  it('Test 9: findings carry correct redactedHash + fingerprint computed from matched value', () => {
    const config = makeConfig()
    const emailValue = 'admin@example.com'
    const text = `Contact: ${emailValue}`
    const findings = runLayer6aPii(text, getPiiConfig(config), config)

    const emailFinding = findings.find((f) => f.ruleId === 'pii:email')
    expect(emailFinding).toBeDefined()
    expect(emailFinding!.redactedHash).toBe(redactedHash(emailValue))
    expect(emailFinding!.fingerprint).toBe(fingerprint('pii:email', emailValue))
  })

  it('Test 10: running the engine twice on different inputs yields correct results (no lastIndex bleed)', () => {
    const config = makeConfig()

    // First run — has an email
    const text1 = 'user1@test.com is here'
    const findings1 = runLayer6aPii(text1, getPiiConfig(config), config)
    const email1 = findings1.find((f) => f.ruleId === 'pii:email')
    expect(email1).toBeDefined()
    expect(email1!.value).toBe('user1@test.com')

    // Second run — different email (no stateful lastIndex should bleed from first call)
    const text2 = 'another@domain.org is here'
    const findings2 = runLayer6aPii(text2, getPiiConfig(config), config)
    const email2 = findings2.find((f) => f.ruleId === 'pii:email')
    expect(email2).toBeDefined()
    expect(email2!.value).toBe('another@domain.org')

    // Third run — no email at all (if lastIndex were wrong, it might miss the start)
    const text3 = 'no email here at all plain text only'
    const findings3 = runLayer6aPii(text3, getPiiConfig(config), config)
    const email3 = findings3.find((f) => f.ruleId === 'pii:email')
    expect(email3).toBeUndefined()
  })

  it('Test 11: email matching config.allowlist.stopwords entry is suppressed (allowlist end-to-end)', () => {
    // The email domain "noreply" is in stopwords — so noreply@example.com should be suppressed
    const config = makeConfig({
      allowlist: {
        ...DEFAULT_CONFIG.allowlist,
        stopwords: ['noreply@example.com'],
      },
    })
    const text = 'Reply to: noreply@example.com please'
    const findings = runLayer6aPii(text, getPiiConfig(config), config)

    // The allowlisted email should produce zero findings
    const emailFinding = findings.find((f) => f.ruleId === 'pii:email')
    expect(emailFinding).toBeUndefined()
    expect(findings.length).toBe(0)
  })
})
