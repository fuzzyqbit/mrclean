/**
 * Unit tests for src/detect/ner-overlap.ts — D-11 cross-source NER overlap drop.
 *
 * Plan 06-01, Task 2 — TDD RED gate.
 *
 * D-11: a `pii-ner` finding that overlaps ANY non-`pii-ner` (higher-precedence) finding is
 * DROPPED ENTIRELY, regardless of span length. NER never wins a region via longest-span-wins.
 * This is a SEPARATE pre-dedup pass — it must NOT modify dedupBySpan.
 *
 * Covers:
 *   - a pii-ner span overlapping a secretlint span → dropped
 *   - a pii-ner span overlapping a pii-regex span → dropped
 *   - a non-overlapping pii-ner span → kept
 *   - non-pii-ner findings are NEVER dropped (even if overlapping each other)
 *   - a longer pii-ner span overlapping a shorter higher-precedence span → still dropped (length-agnostic)
 *   - two pii-ner findings overlapping EACH OTHER (no cross-source overlap) → BOTH kept (left to dedupBySpan)
 *   - empty input → empty output
 */

import { describe, it, expect } from 'vitest'
import { dropNerOverlaps } from '../../src/detect/ner-overlap.js'
import type { Finding } from '../../src/detect/findings.js'

/** Minimal Finding builder for span-algebra tests (hashes are not exercised here). */
function f(
  source: Finding['source'],
  start: number,
  end: number,
  ruleId = `${source}:r`,
): Finding {
  return {
    ruleId,
    severity: 'MEDIUM',
    span: { start, end },
    value: 'x',
    redactedHash: '0'.repeat(16),
    fingerprint: `${ruleId}:${'0'.repeat(16)}`,
    source,
  }
}

describe('dropNerOverlaps (D-11)', () => {
  it('drops a pii-ner finding overlapping a secretlint finding', () => {
    const findings = [f('secretlint', 0, 20), f('pii-ner', 5, 10)]
    const out = dropNerOverlaps(findings)
    expect(out.map((x) => x.source)).toEqual(['secretlint'])
  })

  it('drops a pii-ner finding overlapping a pii-regex finding', () => {
    const findings = [f('pii-regex', 0, 12), f('pii-ner', 8, 25)]
    const out = dropNerOverlaps(findings)
    expect(out.map((x) => x.source)).toEqual(['pii-regex'])
  })

  it('keeps a non-overlapping pii-ner finding', () => {
    const findings = [f('secretlint', 0, 5), f('pii-ner', 10, 18)]
    const out = dropNerOverlaps(findings)
    expect(out.map((x) => x.source).sort()).toEqual(['pii-ner', 'secretlint'])
  })

  it('never drops non-pii-ner findings, even when they overlap each other', () => {
    const findings = [f('secretlint', 0, 10), f('gitleaks', 5, 15), f('entropy', 12, 20)]
    const out = dropNerOverlaps(findings)
    expect(out).toHaveLength(3)
    expect(out.every((x) => x.source !== 'pii-ner')).toBe(true)
  })

  it('drops a LONGER pii-ner span overlapping a shorter higher-precedence span (length-agnostic)', () => {
    const findings = [f('pii-regex', 10, 14), f('pii-ner', 0, 40)]
    const out = dropNerOverlaps(findings)
    expect(out.map((x) => x.source)).toEqual(['pii-regex'])
  })

  it('keeps BOTH pii-ner findings when they overlap only each other (cross-source-only drop)', () => {
    const findings = [f('pii-ner', 0, 10, 'pii:PERSON'), f('pii-ner', 5, 15, 'pii:ORG')]
    const out = dropNerOverlaps(findings)
    expect(out).toHaveLength(2)
    expect(out.every((x) => x.source === 'pii-ner')).toBe(true)
  })

  it('returns an empty array for empty input', () => {
    expect(dropNerOverlaps([])).toEqual([])
  })
})
