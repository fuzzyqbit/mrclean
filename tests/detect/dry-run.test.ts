/**
 * Tests for applyDryRun (src/detect/dry-run.ts)
 *
 * MODE-01 semantics: detections still flow into the audit log; placeholders are
 * still computed for log accuracy; substitution is NOT applied to hook output.
 *
 * Plan 02-04 — TDD test file (RED gate).
 */

import { describe, it, expect } from 'vitest'
import { applyDryRun } from '../../src/detect/dry-run.js'
import type { ResolvedFinding } from '../../src/detect/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResolvedFinding(
  overrides: Partial<ResolvedFinding> = {},
): ResolvedFinding {
  return {
    ruleId: 'AWSAccessKeyID',
    severity: 'HIGH',
    span: { start: 0, end: 20 },
    value: 'AKIAIOSFODNN7EXAMPLX',
    redactedHash: 'abc123def456abc1',
    fingerprint: 'AWSAccessKeyID:abc123def456abc1',
    source: 'secretlint',
    placeholder: '<MRCLEAN:AWS_KEY:001>',
    effectiveAction: 'block',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyDryRun', () => {
  it('returns array with every effectiveAction coerced to audit', () => {
    const input: ResolvedFinding[] = [
      makeResolvedFinding({ effectiveAction: 'block' }),
      makeResolvedFinding({ effectiveAction: 'substitute', placeholder: '<MRCLEAN:AWS_KEY:002>' }),
      makeResolvedFinding({ effectiveAction: 'audit', placeholder: '<MRCLEAN:AWS_KEY:003>' }),
    ]

    const result = applyDryRun(input)

    expect(result).toHaveLength(3)
    for (const finding of result) {
      expect(finding.effectiveAction).toBe('audit')
    }
  })

  it('does NOT mutate the input array or its elements', () => {
    const input: ResolvedFinding[] = [
      makeResolvedFinding({ effectiveAction: 'block' }),
      makeResolvedFinding({ effectiveAction: 'substitute', placeholder: '<MRCLEAN:AWS_KEY:002>' }),
    ]

    // Deep copy the original values for comparison
    const originalActions = input.map((f) => f.effectiveAction)

    applyDryRun(input)

    // Input elements must NOT have been mutated
    expect(input[0]!.effectiveAction).toBe(originalActions[0])
    expect(input[1]!.effectiveAction).toBe(originalActions[1])
  })

  it('returns an empty array when given an empty array', () => {
    const result = applyDryRun([])
    expect(result).toHaveLength(0)
    expect(Array.isArray(result)).toBe(true)
  })
})
