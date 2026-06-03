/**
 * Unit tests for src/detect/ner-entities.ts — model-label → canonical entity map.
 *
 * Plan 06-01, Task 1 — TDD RED gate.
 *
 * Covers the full bert-base-NER label table plus defensive fallbacks:
 *   - B-PER / I-PER  → 'PERSON'
 *   - B-ORG / I-ORG  → 'ORG'
 *   - B-LOC / I-LOC  → 'LOC'
 *   - B-MISC / I-MISC / O → null (MISC is noisy; O is the outside label)
 *   - unknown model id → null for every label (defensive; piiranha added in 06-03)
 *   - unknown label on a known model → null
 *
 * Map is keyed by model id so 06-03 can add the piiranha branch without touching bert.
 */

import { describe, it, expect } from 'vitest'
import { mapModelLabel } from '../../src/detect/ner-entities.js'

const BERT = 'Xenova/bert-base-NER'

describe('mapModelLabel — Xenova/bert-base-NER', () => {
  it('maps B-PER and I-PER to PERSON', () => {
    expect(mapModelLabel(BERT, 'B-PER')).toBe('PERSON')
    expect(mapModelLabel(BERT, 'I-PER')).toBe('PERSON')
  })

  it('maps B-ORG and I-ORG to ORG', () => {
    expect(mapModelLabel(BERT, 'B-ORG')).toBe('ORG')
    expect(mapModelLabel(BERT, 'I-ORG')).toBe('ORG')
  })

  it('maps B-LOC and I-LOC to LOC', () => {
    expect(mapModelLabel(BERT, 'B-LOC')).toBe('LOC')
    expect(mapModelLabel(BERT, 'I-LOC')).toBe('LOC')
  })

  it('maps MISC labels to null (noisy class excluded)', () => {
    expect(mapModelLabel(BERT, 'B-MISC')).toBeNull()
    expect(mapModelLabel(BERT, 'I-MISC')).toBeNull()
  })

  it('maps the outside label O to null', () => {
    expect(mapModelLabel(BERT, 'O')).toBeNull()
  })

  it('maps an unknown label on a known model to null', () => {
    expect(mapModelLabel(BERT, 'B-FOO')).toBeNull()
    expect(mapModelLabel(BERT, 'PERSON')).toBeNull() // already-canonical is not a model label
    expect(mapModelLabel(BERT, '')).toBeNull()
  })
})

describe('mapModelLabel — unknown model id', () => {
  it('returns null for every label when the model is unknown', () => {
    expect(mapModelLabel('some/unknown-model', 'B-PER')).toBeNull()
    expect(mapModelLabel('some/unknown-model', 'I-ORG')).toBeNull()
    expect(mapModelLabel('some/unknown-model', 'B-LOC')).toBeNull()
    expect(mapModelLabel('', 'B-PER')).toBeNull()
  })
})
