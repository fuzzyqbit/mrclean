/**
 * Unit tests for the piiranha branch of mapModelLabel — Plan 06-03 Task 3 (NER-04).
 *
 * piiranha (onnx-community/piiranha-v1-detect-personal-information-ONNX) is a DIFFERENT label
 * space from bert-base-NER: 17 PII labels, NO PERSON/ORG/LOC tokens and NO ORG concept at all.
 * The per-model remap (RESEARCH Pitfall 6) collapses its labels into mrclean's canonical set:
 *   - GIVENNAME, SURNAME            → PERSON
 *   - CITY, STREET, ZIPCODE, BUILDINGNUM → LOC
 *   - everything else (EMAIL, TELEPHONENUM, …) → null  (NOT substituted by the NER lane)
 *   - piiranha NEVER yields 'ORG'
 *
 * The bert branch (06-01) must remain byte-unchanged — re-asserted here as a regression guard.
 */

import { describe, it, expect } from 'vitest'
import { mapModelLabel } from '../../src/detect/ner-entities.js'
import { PIIRANHA_MODEL_ID } from '../../src/model/constants.js'

const BERT = 'Xenova/bert-base-NER'

describe('mapModelLabel — piiranha (NER-04)', () => {
  it('maps GIVENNAME and SURNAME to PERSON (with and without BIO prefix)', () => {
    expect(mapModelLabel(PIIRANHA_MODEL_ID, 'GIVENNAME')).toBe('PERSON')
    expect(mapModelLabel(PIIRANHA_MODEL_ID, 'SURNAME')).toBe('PERSON')
    expect(mapModelLabel(PIIRANHA_MODEL_ID, 'B-GIVENNAME')).toBe('PERSON')
    expect(mapModelLabel(PIIRANHA_MODEL_ID, 'I-SURNAME')).toBe('PERSON')
  })

  it('maps CITY, STREET, ZIPCODE, BUILDINGNUM to LOC', () => {
    expect(mapModelLabel(PIIRANHA_MODEL_ID, 'CITY')).toBe('LOC')
    expect(mapModelLabel(PIIRANHA_MODEL_ID, 'STREET')).toBe('LOC')
    expect(mapModelLabel(PIIRANHA_MODEL_ID, 'ZIPCODE')).toBe('LOC')
    expect(mapModelLabel(PIIRANHA_MODEL_ID, 'BUILDINGNUM')).toBe('LOC')
    expect(mapModelLabel(PIIRANHA_MODEL_ID, 'B-CITY')).toBe('LOC')
    expect(mapModelLabel(PIIRANHA_MODEL_ID, 'I-BUILDINGNUM')).toBe('LOC')
  })

  it('maps non-mapped PII labels (EMAIL, TELEPHONENUM, …) to null', () => {
    expect(mapModelLabel(PIIRANHA_MODEL_ID, 'EMAIL')).toBeNull()
    expect(mapModelLabel(PIIRANHA_MODEL_ID, 'TELEPHONENUM')).toBeNull()
    expect(mapModelLabel(PIIRANHA_MODEL_ID, 'SOCIALNUM')).toBeNull()
    expect(mapModelLabel(PIIRANHA_MODEL_ID, 'CREDITCARDNUMBER')).toBeNull()
    expect(mapModelLabel(PIIRANHA_MODEL_ID, 'O')).toBeNull()
    expect(mapModelLabel(PIIRANHA_MODEL_ID, '')).toBeNull()
  })

  it('NEVER yields ORG — piiranha has no ORG concept', () => {
    // Exhaustively sweep every piiranha label that could exist and assert none → 'ORG'.
    const piiranhaLabels = [
      'GIVENNAME', 'SURNAME', 'CITY', 'STREET', 'ZIPCODE', 'BUILDINGNUM',
      'EMAIL', 'TELEPHONENUM', 'SOCIALNUM', 'CREDITCARDNUMBER', 'ACCOUNTNUM',
      'DATEOFBIRTH', 'IDCARDNUM', 'PASSWORD', 'TAXNUM', 'USERNAME', 'DRIVERLICENSENUM',
      'ORG', 'B-ORG', 'I-ORG', // even if the model emitted an ORG-shaped token, we must not map it
    ]
    for (const label of piiranhaLabels) {
      expect(mapModelLabel(PIIRANHA_MODEL_ID, label)).not.toBe('ORG')
    }
  })
})

describe('mapModelLabel — bert branch unchanged by the piiranha addition', () => {
  it('still maps bert PER/ORG/LOC and rejects MISC/O', () => {
    expect(mapModelLabel(BERT, 'B-PER')).toBe('PERSON')
    expect(mapModelLabel(BERT, 'I-ORG')).toBe('ORG')
    expect(mapModelLabel(BERT, 'B-LOC')).toBe('LOC')
    expect(mapModelLabel(BERT, 'B-MISC')).toBeNull()
    expect(mapModelLabel(BERT, 'O')).toBeNull()
    // piiranha-only labels are not bert labels — bert must not recognize them.
    expect(mapModelLabel(BERT, 'GIVENNAME')).toBeNull()
  })
})
