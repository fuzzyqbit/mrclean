/**
 * Unit tests for src/detect/allowlist.ts — shared isAllowlisted helper.
 *
 * Plan 05-01, Task 1 — TDD RED gate.
 *
 * Covers the 6 behaviors specified in the plan:
 *   1. Returns true when finding.ruleId is in config.allowlist.rules
 *   2. Returns true when finding.fingerprint is in config.allowlist.fingerprints
 *   3. Returns true when finding.value matches a config.allowlist.regexes pattern
 *   4. Returns true when finding.value contains a config.allowlist.stopwords literal
 *   5. Returns false when no axis matches (empty default allowlist)
 *   6. A malformed regex in allowlist.regexes is swallowed (returns false, no throw)
 */

import { describe, it, expect } from 'vitest'
import { isAllowlisted } from '../../src/detect/allowlist.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'
import type { Finding } from '../../src/detect/findings.js'
import type { MrcleanConfig } from '../../src/shared/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Finding with sensible defaults for allowlist testing. */
function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'test-rule',
    severity: 'MEDIUM',
    span: { start: 0, end: 10 },
    value: 'test-value',
    redactedHash: 'abcdef0123456789',
    fingerprint: 'test-rule:abcdef0123456789',
    source: 'secretlint',
    ...overrides,
  }
}

/** Build a config with given allowlist values spread over DEFAULT_CONFIG. */
function makeConfig(allowlist: Partial<MrcleanConfig['allowlist']> = {}): MrcleanConfig {
  return {
    ...DEFAULT_CONFIG,
    allowlist: {
      ...DEFAULT_CONFIG.allowlist,
      ...allowlist,
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isAllowlisted', () => {
  it('Test 1: returns true when finding.ruleId is in config.allowlist.rules', () => {
    const finding = makeFinding({ ruleId: 'github-fine-grained-pat' })
    const config = makeConfig({ rules: ['github-fine-grained-pat', 'some-other-rule'] })

    expect(isAllowlisted(finding, config)).toBe(true)
  })

  it('Test 2: returns true when finding.fingerprint is in config.allowlist.fingerprints', () => {
    const finding = makeFinding({
      ruleId: 'some-rule',
      fingerprint: 'some-rule:deadbeef01234567',
    })
    const config = makeConfig({
      fingerprints: ['some-rule:deadbeef01234567', 'another-rule:1234567890abcdef'],
    })

    expect(isAllowlisted(finding, config)).toBe(true)
  })

  it('Test 3: returns true when finding.value matches a config.allowlist.regexes pattern', () => {
    const finding = makeFinding({ value: 'test@example.com' })
    const config = makeConfig({ regexes: ['^test@.*\\.com$'] })

    expect(isAllowlisted(finding, config)).toBe(true)
  })

  it('Test 4: returns true when finding.value contains a config.allowlist.stopwords literal', () => {
    const finding = makeFinding({ value: 'my-internal-api-key-placeholder' })
    const config = makeConfig({ stopwords: ['placeholder'] })

    expect(isAllowlisted(finding, config)).toBe(true)
  })

  it('Test 5: returns false when no axis matches (empty default allowlist)', () => {
    const finding = makeFinding({
      ruleId: 'real-secret-rule',
      fingerprint: 'real-secret-rule:cafebabe01234567',
      value: 'AKIAIOSFODNN7EXAMPLX',
    })
    const config = makeConfig()

    expect(isAllowlisted(finding, config)).toBe(false)
  })

  it('Test 6: a malformed regex in allowlist.regexes is swallowed (returns false, no throw)', () => {
    const finding = makeFinding({ value: 'some-secret-value' })
    // '[invalid' is an invalid regex pattern — missing closing bracket
    const config = makeConfig({ regexes: ['[invalid', '^valid-pattern$'] })

    // Should not throw; malformed pattern silently skips
    expect(() => isAllowlisted(finding, config)).not.toThrow()
    expect(isAllowlisted(finding, config)).toBe(false)
  })
})
