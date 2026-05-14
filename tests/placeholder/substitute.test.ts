/**
 * Tests for substituteFindings — Plan 02-03
 *
 * Covers PH-04 (angle brackets survive JSON/Markdown/diff contexts) and
 * correct index-drift-free substitution behaviour.
 */

import { describe, expect, it } from 'vitest'
import { substituteFindings } from '../../src/placeholder/substitute.js'
import type { ResolvedFinding } from '../../src/placeholder/substitute.js'

// Helper to build a minimal ResolvedFinding for tests
function rf(
  value: string,
  start: number,
  end: number,
  placeholder: string,
): ResolvedFinding {
  return {
    ruleId: 'test:rule',
    severity: 'HIGH',
    span: { start, end },
    value,
    redactedHash: 'aaaaaaaaaaaaaaaa',
    fingerprint: 'test:rule:aaaaaaaaaaaaaaaa',
    source: 'secretlint',
    placeholder,
  }
}

describe('substituteFindings', () => {
  it('substitutes a single finding in the middle of text', () => {
    const text = 'abcSECRETxyz'
    const findings: ResolvedFinding[] = [rf('SECRET', 3, 9, '<MRCLEAN:SECRET:001>')]
    const result = substituteFindings(text, findings)
    expect(result).toBe('abc<MRCLEAN:SECRET:001>xyz')
  })

  it('substitutes multiple non-overlapping findings preserving correct positions', () => {
    // "abc XXX def YYY ghi" — findings at positions [4,7] and [12,15]
    const text = 'abc XXX def YYY ghi'
    const findings: ResolvedFinding[] = [
      rf('XXX', 4, 7, '<MRCLEAN:SECRET:001>'),
      rf('YYY', 12, 15, '<MRCLEAN:SECRET:002>'),
    ]
    const result = substituteFindings(text, findings)
    expect(result).toBe('abc <MRCLEAN:SECRET:001> def <MRCLEAN:SECRET:002> ghi')
  })

  it('substitutes at the start of text (span.start === 0)', () => {
    const text = 'SECRETrest'
    const findings: ResolvedFinding[] = [rf('SECRET', 0, 6, '<MRCLEAN:SECRET:001>')]
    const result = substituteFindings(text, findings)
    expect(result).toBe('<MRCLEAN:SECRET:001>rest')
  })

  it('substitutes at the end of text (span.end === text.length)', () => {
    const text = 'prefixSECRET'
    const findings: ResolvedFinding[] = [rf('SECRET', 6, 12, '<MRCLEAN:SECRET:001>')]
    const result = substituteFindings(text, findings)
    expect(result).toBe('prefix<MRCLEAN:SECRET:001>')
  })

  it('produces parseable JSON when substituting inside a JSON string value (PH-04)', () => {
    const text = '{"command":"echo AKIAIOSFODNN7EXAMPLE"}'
    // The secret "AKIAIOSFODNN7EXAMPLE" starts at index 18
    const secretStart = text.indexOf('AKIAIOSFODNN7EXAMPLE')
    const secretEnd = secretStart + 'AKIAIOSFODNN7EXAMPLE'.length
    const findings: ResolvedFinding[] = [
      rf('AKIAIOSFODNN7EXAMPLE', secretStart, secretEnd, '<MRCLEAN:AWS_KEY:001>'),
    ]
    const result = substituteFindings(text, findings)
    // Result should still be parseable JSON
    const parsed = JSON.parse(result)
    expect(parsed.command).toBe('echo <MRCLEAN:AWS_KEY:001>')
  })

  it('skips zero-length findings defensively', () => {
    const text = 'hello world'
    const findings: ResolvedFinding[] = [rf('', 5, 5, '<MRCLEAN:SECRET:001>')]
    const result = substituteFindings(text, findings)
    expect(result).toBe('hello world')
  })
})
