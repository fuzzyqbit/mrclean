/**
 * Secret-floor schema suite for src/state/session-map.ts (plan 09-02, REVMODE-06).
 *
 * SC3 proof shape at the schema layer: secret-class entries — all 13 named
 * secret TYPEs, SECRET, ENV, ENTROPY, PII_SSN, PII_CREDIT_CARD, and ANY
 * unknown TYPE — must structurally LACK an `original` property in both
 * constructed and serialized form. Assertions use the `in` operator
 * (property ABSENT, never null/undefined-valued) per D-11 / RESEARCH §Pattern 5.
 *
 * Also pins: HMAC content addressing (Pattern 3), the v2 session-tagged token
 * format (Pattern 4), the strict session-id allowlist (Pitfall 5), and the
 * parse-guard total-rejection contract that plans 09-03/09-04/09-05 build on.
 */

import { describe, expect, it } from 'vitest'
import { TYPE_VOCABULARY } from '../../src/detect/type-map.js'
import {
  RESTORABLE_TYPES,
  SESSION_ID_RE,
  V2_TOKEN_RE,
  createEmptySessionMap,
  formatV2Token,
  hmacAddress,
  isRestorableType,
  isValidSessionId,
  makeMapEntry,
  parseSessionMap,
  serializeSessionMap,
  type SessionMapEntry,
  type SessionMapV1,
} from '../../src/state/session-map.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// The 18 named never-restorable TYPEs: 13 named secret TYPEs + SECRET, ENV,
// ENTROPY, PII_SSN, PII_CREDIT_CARD (D-11 partition, RESEARCH §Pattern 5).
const NEVER_RESTORABLE_NAMED = [
  'AWS_KEY',
  'AWS_SECRET',
  'GH_TOKEN',
  'JWT',
  'STRIPE_KEY',
  'OPENAI_KEY',
  'ANTHROPIC_KEY',
  'PRIVATE_KEY',
  'SLACK_TOKEN',
  'GCP_KEY',
  'DATABRICKS_KEY',
  'AZURE_KEY',
  'CF_KEY',
  'SECRET',
  'ENV',
  'ENTROPY',
  'PII_SSN',
  'PII_CREDIT_CARD',
] as const

// The 7 restorable TYPEs (frozen partition — D-11).
const RESTORABLE_SEVEN = [
  'WORD',
  'PII_EMAIL',
  'PII_PHONE',
  'PII_IP',
  'PII_PERSON',
  'PII_ORG',
  'PII_LOC',
] as const

const VALID_SID = 'e58035fe-a3f5-4ac6-9f39-0a63d8dd905f'
const NONCE8 = 'aabbccdd'
const SALT_A = 'ab'.repeat(32) // 64 lowercase hex chars
const SALT_B = 'cd'.repeat(32)
const KEY_A = 'a'.repeat(64) // opaque hmac-shaped entry keys for raw fixtures
const KEY_B = 'b'.repeat(64)

/** Build a fresh, valid raw map object (new object per call — never shared). */
function validRawMap(): Record<string, unknown> {
  return {
    version: 1,
    sessionId: VALID_SID,
    nonce8: NONCE8,
    hashSalt: SALT_A,
    counter: 2,
    entries: {
      [KEY_A]: {
        placeholder: '<MRCLEAN:AWS_KEY:001:aabbccdd>',
        type: 'AWS_KEY',
        counter: 1,
      },
      [KEY_B]: {
        placeholder: '<MRCLEAN:WORD:002:aabbccdd>',
        type: 'WORD',
        counter: 2,
        original: 'projectcodename',
      },
    },
  }
}

/** Immutable single-key omit (builds a new object — no mutation). */
function omitKey(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => k !== key),
  )
}

/** A valid raw map whose entries record is replaced with a single raw entry. */
function entryCase(entry: unknown): Record<string, unknown> {
  return { ...validRawMap(), entries: { [KEY_A]: entry } }
}

// ---------------------------------------------------------------------------
// Secret floor — makeMapEntry (D-11 write-time partition)
// ---------------------------------------------------------------------------

describe('secret floor — makeMapEntry never attaches original to secret-class TYPEs (D-11)', () => {
  it.each([...NEVER_RESTORABLE_NAMED])(
    "returns an entry with NO original property for TYPE '%s'",
    (type) => {
      // Arrange + Act
      const placeholder = `<MRCLEAN:${type}:001:${NONCE8}>`
      const entry = makeMapEntry(type, placeholder, 1, 'raw-sensitive-value')

      // Assert — property ABSENT (the `in` operator), never null/empty (SC3)
      expect('original' in entry).toBe(false)
      expect(entry.placeholder).toBe(placeholder)
      expect(entry.type).toBe(type)
      expect(entry.counter).toBe(1)
    },
  )

  it("treats an unknown TYPE ('FUTURE_TYPE') as secret-class — fail-toward-privacy", () => {
    // Arrange + Act
    const entry = makeMapEntry('FUTURE_TYPE', `<MRCLEAN:FUTURE_TYPE:001:${NONCE8}>`, 1, 'x')

    // Assert — anything outside the frozen restorable 7 is secret-class
    expect('original' in entry).toBe(false)
  })

  it.each([...RESTORABLE_SEVEN])(
    "carries original for restorable TYPE '%s'",
    (type) => {
      // Arrange + Act
      const entry = makeMapEntry(type, `<MRCLEAN:${type}:001:${NONCE8}>`, 1, 'some-original')

      // Assert
      expect('original' in entry).toBe(true)
      if ('original' in entry) {
        expect(entry.original).toBe('some-original')
      }
    },
  )

  it('carries the exact original string for a WORD entry', () => {
    // Arrange + Act
    const entry = makeMapEntry('WORD', `<MRCLEAN:WORD:001:${NONCE8}>`, 1, 'projectcodename')

    // Assert
    expect('original' in entry && entry.original).toBe('projectcodename')
  })
})

// ---------------------------------------------------------------------------
// Vocabulary sync — partition covers TYPE_VOCABULARY exactly
// ---------------------------------------------------------------------------

describe('vocabulary sync — partition covers the frozen 25-entry TYPE_VOCABULARY (D-11)', () => {
  it('classifies all 25 vocabulary entries into exactly 7 restorable + 18 secret-class', () => {
    // Arrange + Act
    const restorable = TYPE_VOCABULARY.filter((type) => isRestorableType(type))
    const secretClass = TYPE_VOCABULARY.filter((type) => !isRestorableType(type))

    // Assert — a future vocabulary addition fails loudly here until classified
    expect(TYPE_VOCABULARY).toHaveLength(25)
    expect(restorable).toHaveLength(7)
    expect(secretClass).toHaveLength(18)
    expect(new Set(restorable)).toEqual(new Set(RESTORABLE_SEVEN))
    expect(new Set(secretClass)).toEqual(new Set(NEVER_RESTORABLE_NAMED))
  })

  it('exports RESTORABLE_TYPES as a frozen 7-entry subset of the vocabulary', () => {
    // Assert
    expect(Object.isFrozen(RESTORABLE_TYPES)).toBe(true)
    expect(RESTORABLE_TYPES).toHaveLength(7)
    for (const type of RESTORABLE_TYPES) {
      expect(TYPE_VOCABULARY).toContain(type)
    }
    expect(new Set(RESTORABLE_TYPES)).toEqual(new Set(RESTORABLE_SEVEN))
  })
})

// ---------------------------------------------------------------------------
// serializeSessionMap — write-time strip (defense in depth)
// ---------------------------------------------------------------------------

describe('serializeSessionMap — write-time strip is defense in depth (D-11)', () => {
  it('strips a hand-poisoned original from a secret-class entry at serialize time', () => {
    // Arrange — bypass the type-level floor with an explicit unsafe cast
    const secretEntry = makeMapEntry('AWS_KEY', `<MRCLEAN:AWS_KEY:001:${NONCE8}>`, 1, 'AKIA-fake')
    const poisoned = {
      ...secretEntry,
      original: 'leaked-raw-secret',
    } as unknown as SessionMapEntry
    const map: SessionMapV1 = {
      version: 1,
      sessionId: VALID_SID,
      nonce8: NONCE8,
      hashSalt: SALT_A,
      counter: 1,
      entries: { [KEY_A]: poisoned },
    }

    // Act
    const json = serializeSessionMap(map)
    const dumped = JSON.parse(json) as {
      entries: Record<string, Record<string, unknown>>
    }

    // Assert — decrypt-and-dump shape: property ABSENT in the persisted form
    expect('original' in dumped.entries[KEY_A]!).toBe(false)
    expect(json).not.toContain('leaked-raw-secret')
  })

  it('serializes a fully poisoned secret-class map with zero original keys in the dump', () => {
    // Arrange — every named never-restorable TYPE poisoned via unsafe cast
    const entries = Object.fromEntries(
      NEVER_RESTORABLE_NAMED.map((type, i) => {
        const base = makeMapEntry(type, formatV2Token(type, i + 1, NONCE8), i + 1, `raw-${type}`)
        const poisoned = {
          ...base,
          original: `leaked-${type}`,
        } as unknown as SessionMapEntry
        return [hmacAddress(SALT_A, `raw-${type}`), poisoned] as const
      }),
    )
    const map: SessionMapV1 = {
      version: 1,
      sessionId: VALID_SID,
      nonce8: NONCE8,
      hashSalt: SALT_A,
      counter: NEVER_RESTORABLE_NAMED.length,
      entries,
    }

    // Act
    const json = serializeSessionMap(map)

    // Assert — no `original` key anywhere in a secret-only dump
    expect(json).not.toContain('"original"')
    expect(json).not.toContain('leaked-')
  })

  it('preserves original for restorable entries in the serialized output', () => {
    // Arrange
    const entry = makeMapEntry('WORD', `<MRCLEAN:WORD:001:${NONCE8}>`, 1, 'projectcodename')
    const map: SessionMapV1 = {
      version: 1,
      sessionId: VALID_SID,
      nonce8: NONCE8,
      hashSalt: SALT_A,
      counter: 1,
      entries: { [KEY_B]: entry },
    }

    // Act
    const dumped = JSON.parse(serializeSessionMap(map)) as {
      entries: Record<string, Record<string, unknown>>
    }

    // Assert
    expect(dumped.entries[KEY_B]!['original']).toBe('projectcodename')
  })

  it('does not mutate the input map when stripping (immutability)', () => {
    // Arrange
    const poisoned = {
      ...makeMapEntry('ENV', `<MRCLEAN:ENV:001:${NONCE8}>`, 1, 'DB_PASSWORD=hunter2'),
      original: 'still-here',
    } as unknown as SessionMapEntry
    const map: SessionMapV1 = {
      version: 1,
      sessionId: VALID_SID,
      nonce8: NONCE8,
      hashSalt: SALT_A,
      counter: 1,
      entries: { [KEY_A]: poisoned },
    }

    // Act
    serializeSessionMap(map)

    // Assert — serializer built new objects; the input entry is untouched
    expect('original' in map.entries[KEY_A]!).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('round-trip', () => {
  it('parseSessionMap(serializeSessionMap(map)) deep-equals a clean map', () => {
    // Arrange
    const base = createEmptySessionMap(VALID_SID)
    const keyAws = hmacAddress(base.hashSalt, 'AKIA-fake-key-material')
    const keyWord = hmacAddress(base.hashSalt, 'projectcodename')
    const map: SessionMapV1 = {
      ...base,
      counter: 2,
      entries: {
        [keyAws]: makeMapEntry(
          'AWS_KEY',
          formatV2Token('AWS_KEY', 1, base.nonce8),
          1,
          'AKIA-fake-key-material',
        ),
        [keyWord]: makeMapEntry(
          'WORD',
          formatV2Token('WORD', 2, base.nonce8),
          2,
          'projectcodename',
        ),
      },
    }

    // Act + Assert
    expect(parseSessionMap(serializeSessionMap(map))).toStrictEqual(map)
  })
})

// ---------------------------------------------------------------------------
// parseSessionMap — hand guards
// ---------------------------------------------------------------------------

const GUARD_CASES: Array<[string, () => unknown]> = [
  ['the top level is a JSON array', () => [validRawMap()]],
  ['version is 2', () => ({ ...validRawMap(), version: 2 })],
  ['version is missing', () => omitKey(validRawMap(), 'version')],
  ['sessionId is missing', () => omitKey(validRawMap(), 'sessionId')],
  ['sessionId is a number', () => ({ ...validRawMap(), sessionId: 42 })],
  ['nonce8 is missing', () => omitKey(validRawMap(), 'nonce8')],
  ['nonce8 is a number', () => ({ ...validRawMap(), nonce8: 7 })],
  ['hashSalt is missing', () => omitKey(validRawMap(), 'hashSalt')],
  ['hashSalt is null', () => ({ ...validRawMap(), hashSalt: null })],
  ['counter is missing', () => omitKey(validRawMap(), 'counter')],
  ['counter is a float', () => ({ ...validRawMap(), counter: 1.5 })],
  ['counter is a string', () => ({ ...validRawMap(), counter: '3' })],
  ['counter is negative', () => ({ ...validRawMap(), counter: -1 })],
  ['entries is an array', () => ({ ...validRawMap(), entries: [] })],
  ['entries is a string', () => ({ ...validRawMap(), entries: 'nope' })],
  [
    'an entry is missing placeholder',
    () => entryCase({ type: 'AWS_KEY', counter: 1 }),
  ],
  [
    'an entry is missing type',
    () => entryCase({ placeholder: '<MRCLEAN:AWS_KEY:001:aabbccdd>', counter: 1 }),
  ],
  [
    'an entry is missing counter',
    () => entryCase({ placeholder: '<MRCLEAN:AWS_KEY:001:aabbccdd>', type: 'AWS_KEY' }),
  ],
  [
    'an entry counter is a float',
    () =>
      entryCase({
        placeholder: '<MRCLEAN:AWS_KEY:001:aabbccdd>',
        type: 'AWS_KEY',
        counter: 0.5,
      }),
  ],
  ['an entry is a bare string', () => entryCase('bogus')],
  [
    'a restorable entry original is a number',
    () =>
      entryCase({
        placeholder: '<MRCLEAN:WORD:001:aabbccdd>',
        type: 'WORD',
        counter: 1,
        original: 9,
      }),
  ],
]

describe('parseSessionMap — hand guards return null on any shape failure', () => {
  it('returns null for non-JSON input', () => {
    // Act + Assert
    expect(parseSessionMap('{not-json')).toBeNull()
  })

  it.each(GUARD_CASES)('returns null when %s', (_label, makeRaw) => {
    // Act + Assert
    expect(parseSessionMap(JSON.stringify(makeRaw()))).toBeNull()
  })

  it('parses a valid raw map (positive control — guards are non-vacuous)', () => {
    // Act
    const parsed = parseSessionMap(JSON.stringify(validRawMap()))

    // Assert
    expect(parsed).not.toBeNull()
    expect(parsed!.sessionId).toBe(VALID_SID)
    expect(parsed!.counter).toBe(2)
    expect(Object.keys(parsed!.entries)).toHaveLength(2)
  })

  it('strips original from a secret-class entry found in stored JSON (read-side hardening)', () => {
    // Arrange — a poisoned on-disk shape: secret-class entry carrying original
    const raw = entryCase({
      placeholder: '<MRCLEAN:AWS_KEY:001:aabbccdd>',
      type: 'AWS_KEY',
      counter: 1,
      original: 'leaked-raw-secret',
    })

    // Act
    const parsed = parseSessionMap(JSON.stringify(raw))

    // Assert — parse succeeds (availability) but the secret original never enters memory
    expect(parsed).not.toBeNull()
    expect('original' in parsed!.entries[KEY_A]!).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createEmptySessionMap — CSPRNG properties
// ---------------------------------------------------------------------------

describe('createEmptySessionMap', () => {
  it('creates a version-1 empty map with an 8-hex nonce8 and a 64-hex hashSalt', () => {
    // Act
    const map = createEmptySessionMap(VALID_SID)

    // Assert
    expect(map.version).toBe(1)
    expect(map.sessionId).toBe(VALID_SID)
    expect(map.counter).toBe(0)
    expect(map.entries).toEqual({})
    expect(map.nonce8).toMatch(/^[a-f0-9]{8}$/)
    expect(map.hashSalt).toMatch(/^[a-f0-9]{64}$/)
  })

  it('generates distinct nonce8 and hashSalt across calls (CSPRNG)', () => {
    // Act
    const first = createEmptySessionMap(VALID_SID)
    const second = createEmptySessionMap(VALID_SID)

    // Assert
    expect(first.nonce8).not.toBe(second.nonce8)
    expect(first.hashSalt).not.toBe(second.hashSalt)
  })
})

// ---------------------------------------------------------------------------
// hmacAddress — content addressing (Pattern 3)
// ---------------------------------------------------------------------------

describe('hmacAddress — HMAC-SHA256 content addressing (Pattern 3)', () => {
  it('is deterministic for the same salt and value and yields 64 hex chars', () => {
    // Act
    const first = hmacAddress(SALT_A, 'some-original-value')
    const second = hmacAddress(SALT_A, 'some-original-value')

    // Assert
    expect(first).toBe(second)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })

  it('differs across salts for the same value (kills cross-session correlation)', () => {
    // Act + Assert
    expect(hmacAddress(SALT_A, 'same-value')).not.toBe(hmacAddress(SALT_B, 'same-value'))
  })

  it('differs across values for the same salt', () => {
    // Act + Assert
    expect(hmacAddress(SALT_A, 'value-one')).not.toBe(hmacAddress(SALT_A, 'value-two'))
  })
})

// ---------------------------------------------------------------------------
// formatV2Token — v2 session-tagged tokens (D-10 / Pattern 4)
// ---------------------------------------------------------------------------

describe('formatV2Token — v2 session-tagged tokens (D-10 / Pattern 4)', () => {
  it('zero-pads the counter to three digits with the session nonce tag', () => {
    // Act + Assert
    expect(formatV2Token('AWS_KEY', 7, 'aabbccdd')).toBe('<MRCLEAN:AWS_KEY:007:aabbccdd>')
  })

  it('keeps counter 999 in NNN form (boundary)', () => {
    // Act + Assert
    expect(formatV2Token('WORD', 999, 'aabbccdd')).toBe('<MRCLEAN:WORD:999:aabbccdd>')
  })

  it('emits the OVF variant when the counter exceeds 999', () => {
    // Act + Assert
    expect(formatV2Token('AWS_KEY', 1000, 'aabbccdd')).toBe('<MRCLEAN:AWS_KEY:OVF:aabbccdd>')
  })

  it('produces tokens matching V2_TOKEN_RE in both NNN and OVF forms', () => {
    // Act + Assert
    expect(formatV2Token('PII_EMAIL', 42, 'deadbeef')).toMatch(V2_TOKEN_RE)
    expect(formatV2Token('PII_EMAIL', 5000, 'deadbeef')).toMatch(V2_TOKEN_RE)
  })
})

// ---------------------------------------------------------------------------
// isValidSessionId — strict UUID allowlist (Pitfall 5)
// ---------------------------------------------------------------------------

describe('isValidSessionId — strict UUID allowlist (Pitfall 5)', () => {
  it('accepts a lowercase UUID', () => {
    // Act + Assert
    expect(isValidSessionId('e58035fe-a3f5-4ac6-9f39-0a63d8dd905f')).toBe(true)
  })

  it('accepts an uppercase UUID', () => {
    // Act + Assert
    expect(isValidSessionId('E58035FE-A3F5-4AC6-9F39-0A63D8DD905F')).toBe(true)
  })

  it.each([
    'mcp-server',
    'test-session',
    '../../../etc/foo',
    '',
    `${VALID_SID}-extra`,
    `${VALID_SID}\n`,
  ])('rejects %j', (sid) => {
    // Act + Assert
    expect(isValidSessionId(sid)).toBe(false)
  })

  it('exports SESSION_ID_RE consistent with isValidSessionId', () => {
    // Act + Assert
    expect(SESSION_ID_RE.test(VALID_SID)).toBe(true)
    expect(SESSION_ID_RE.test('mcp-server')).toBe(false)
  })
})
