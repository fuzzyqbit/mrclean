/**
 * Tests for canonical type-map in src/detect/type-map.ts.
 *
 * Covers:
 *   - All required explicit mappings (secretlint, gitleaks, L2/L3 synthetics)
 *   - word: prefix shortcut → WORD
 *   - Unknown rule-id fallback → SECRET
 *   - TYPE_VOCABULARY has exactly 17 entries and contains all expected values
 */

import { describe, it, expect } from 'vitest'
import { getTypeForRuleId, TYPE_VOCABULARY } from '../../src/detect/type-map.js'

describe('getTypeForRuleId', () => {
  // Test 1: AWSAccessKeyID → AWS_KEY
  it('maps AWSAccessKeyID to AWS_KEY', () => {
    expect(getTypeForRuleId('AWSAccessKeyID')).toBe('AWS_KEY')
  })

  // Test 2: AWSSecretAccessKey → AWS_SECRET
  it('maps AWSSecretAccessKey to AWS_SECRET', () => {
    expect(getTypeForRuleId('AWSSecretAccessKey')).toBe('AWS_SECRET')
  })

  // Test 3: gitleaks:aws-access-token → AWS_KEY
  it('maps gitleaks:aws-access-token to AWS_KEY', () => {
    expect(getTypeForRuleId('gitleaks:aws-access-token')).toBe('AWS_KEY')
  })

  // Test 4: entropy:high → ENTROPY
  it('maps entropy:high to ENTROPY', () => {
    expect(getTypeForRuleId('entropy:high')).toBe('ENTROPY')
  })

  // Test 5: env:literal → ENV
  it('maps env:literal to ENV', () => {
    expect(getTypeForRuleId('env:literal')).toBe('ENV')
  })

  // Test 6: word: prefix → WORD (any suffix)
  it('maps word:acme to WORD', () => {
    expect(getTypeForRuleId('word:acme')).toBe('WORD')
  })

  it('maps word:ANYTHING-LITERAL-PROJECT-TERM to WORD (word: prefix is case-sensitive prefix match)', () => {
    expect(getTypeForRuleId('word:ANYTHING-LITERAL-PROJECT-TERM')).toBe('WORD')
  })

  it('maps word: with empty suffix to WORD', () => {
    expect(getTypeForRuleId('word:')).toBe('WORD')
  })

  // Test 7: unknown rule-id → SECRET fallback
  it('returns SECRET for an unknown rule-id', () => {
    expect(getTypeForRuleId('UnknownRule_xyz')).toBe('SECRET')
  })

  it('returns SECRET for an unknown gitleaks rule-id not in the map', () => {
    expect(getTypeForRuleId('gitleaks:unknown-new-rule')).toBe('SECRET')
  })

  // Test 8 (spot-checks): additional required mappings
  it('maps GitHubPersonalAccessToken to GH_TOKEN', () => {
    expect(getTypeForRuleId('GitHubPersonalAccessToken')).toBe('GH_TOKEN')
  })

  it('maps gitleaks:openai-api-key to OPENAI_KEY', () => {
    expect(getTypeForRuleId('gitleaks:openai-api-key')).toBe('OPENAI_KEY')
  })

  it('maps PrivateKey to PRIVATE_KEY', () => {
    expect(getTypeForRuleId('PrivateKey')).toBe('PRIVATE_KEY')
  })

  it('maps gitleaks:anthropic-api-key to ANTHROPIC_KEY', () => {
    expect(getTypeForRuleId('gitleaks:anthropic-api-key')).toBe('ANTHROPIC_KEY')
  })

  it('maps JsonWebToken to JWT', () => {
    expect(getTypeForRuleId('JsonWebToken')).toBe('JWT')
  })

  it('maps gitleaks:jwt to JWT', () => {
    expect(getTypeForRuleId('gitleaks:jwt')).toBe('JWT')
  })

  it('maps StripeAccessToken to STRIPE_KEY', () => {
    expect(getTypeForRuleId('StripeAccessToken')).toBe('STRIPE_KEY')
  })

  it('maps gitleaks:stripe-access-token to STRIPE_KEY', () => {
    expect(getTypeForRuleId('gitleaks:stripe-access-token')).toBe('STRIPE_KEY')
  })

  it('maps SlackToken to SLACK_TOKEN', () => {
    expect(getTypeForRuleId('SlackToken')).toBe('SLACK_TOKEN')
  })

  it('maps gitleaks:slack-bot-token to SLACK_TOKEN', () => {
    expect(getTypeForRuleId('gitleaks:slack-bot-token')).toBe('SLACK_TOKEN')
  })

  it('maps gitleaks:private-key to PRIVATE_KEY', () => {
    expect(getTypeForRuleId('gitleaks:private-key')).toBe('PRIVATE_KEY')
  })

  it('maps DatabricksToken to DATABRICKS_KEY', () => {
    expect(getTypeForRuleId('DatabricksToken')).toBe('DATABRICKS_KEY')
  })

  it('maps CloudflareAPIKey to CF_KEY', () => {
    expect(getTypeForRuleId('CloudflareAPIKey')).toBe('CF_KEY')
  })
})

describe('TYPE_VOCABULARY', () => {
  // Test 8: length === 17 and contains all expected entries
  it('has exactly 17 entries', () => {
    expect(TYPE_VOCABULARY.length).toBe(17)
  })

  it('contains all expected TYPE strings', () => {
    const expected = [
      'AWS_KEY', 'AWS_SECRET', 'GH_TOKEN', 'JWT', 'STRIPE_KEY',
      'OPENAI_KEY', 'ANTHROPIC_KEY', 'PRIVATE_KEY', 'SLACK_TOKEN',
      'GCP_KEY', 'DATABRICKS_KEY', 'AZURE_KEY', 'CF_KEY',
      'ENV', 'WORD', 'ENTROPY', 'SECRET',
    ]
    for (const type of expected) {
      expect(TYPE_VOCABULARY).toContain(type)
    }
  })

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(TYPE_VOCABULARY)).toBe(true)
  })
})
