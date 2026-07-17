/**
 * SC1 taxonomy suite for restoreText — the Phase 10 single-pass restore
 * engine (plan 10-01, REVMODE-01). TDD RED-first: this suite IS the spec.
 *
 * Contract pinned here:
 * - A v2 token is replaced ONLY on an exact full-token index hit (nonce8
 *   included). Wrong nonce8, unissued NNN, fabricated TYPE, v1 tokens, and
 *   OVF tokens all pass through byte-identical (SC1).
 * - OVF is short-circuited BEFORE any lookup — a hand-poisoned index entry
 *   keyed by an OVF token still never restores (Pitfall 1, T-10-01-03).
 * - Secret-class placeholders pass through counted skippedSecret and never
 *   enter restoredOriginals (T-10-01-04 defense-in-depth).
 * - Restored output is never re-scanned — single pass, no cascade (the
 *   CR-01 applyRenamesToText lesson, T-10-01-02).
 * - The scan grammar is the unanchored global twin of the allocator's
 *   V2_TOKEN_RE — sync-locked so allocator and restorer cannot drift.
 *
 * Every v2 fixture token is built via formatV2Token (grammar authority) —
 * never hand-typed. The single hand-typed token literal below is the v1
 * fixture, which formatV2Token structurally cannot produce.
 */

import { describe, expect, it } from 'vitest'
import { restoreText, type RestoreResult } from '../../src/restore/index.js'
import {
  V2_TOKEN_RE,
  V2_TOKEN_SCAN_RE,
  formatV2Token,
} from '../../src/state/session-map.js'

// ---------------------------------------------------------------------------
// Fixtures — all v2 tokens built with the real formatter (never hand-typed).
// ---------------------------------------------------------------------------

/** The issuing session's nonce8 (8 lowercase hex chars). */
const NONCE = 'aabbccdd'
/** A nonce8 the issuing session never used (planted-token defense). */
const FOREIGN_NONCE = 'ffffffff'

/** Issued, in the index — TYPE WORD, counter 1. */
const WORD_TOKEN = formatV2Token('WORD', 1, NONCE)
/** Issued, in the index — TYPE PII_EMAIL, counter 3. */
const EMAIL_TOKEN = formatV2Token('PII_EMAIL', 3, NONCE)
/** Secret-class placeholder — present in secretPlaceholders, never the index. */
const SECRET_TOKEN = formatV2Token('AWS_KEY', 2, NONCE)
/** counter > 999 yields the shared-ambiguity OVF label. */
const OVF_TOKEN = formatV2Token('WORD', 1000, NONCE)
/** Well-formed, but tagged with a nonce this session never issued. */
const WRONG_NONCE_TOKEN = formatV2Token('WORD', 1, FOREIGN_NONCE)
/** Right nonce, but an NNN the session never allocated (enumeration probe). */
const UNISSUED_TOKEN = formatV2Token('WORD', 999, NONCE)
/** Grammar-valid TYPE string the detector never emits. */
const FABRICATED_TYPE_TOKEN = formatV2Token('BOGUS_T', 1, NONCE)

/** v1 token (no nonce8) — the ONE hand-typed literal; formatV2Token cannot produce it. */
const V1_TOKEN = '<MRCLEAN:WORD:001>'

const WORD_ORIGINAL = 'proj-zeus'
const EMAIL_ORIGINAL = 'kim@zz.invalid'

/** Fresh two-entry index per test — never shared, so mutation would be visible. */
function buildIndex(): Map<string, string> {
  return new Map([
    [WORD_TOKEN, WORD_ORIGINAL],
    [EMAIL_TOKEN, EMAIL_ORIGINAL],
  ])
}

/** Fresh secret-placeholder set per test. */
function buildSecretSet(): Set<string> {
  return new Set([SECRET_TOKEN])
}

// ---------------------------------------------------------------------------
// Exact-hit restore
// ---------------------------------------------------------------------------

describe('restoreText — exact-hit restore', () => {
  it('replaces a v2 token with its original on exact full-token index hit', () => {
    // Arrange
    const input = `path is ${WORD_TOKEN} end`

    // Act
    const result: RestoreResult = restoreText(input, buildIndex(), buildSecretSet())

    // Assert
    expect(result.text).toBe(`path is ${WORD_ORIGINAL} end`)
    expect(result.restored).toBe(1)
    expect(result.unmatched).toBe(0)
    expect(result.skippedSecret).toBe(0)
    expect(result.restoredOriginals).toEqual([WORD_ORIGINAL])
  })

  it('counts every occurrence when the same token appears twice', () => {
    // Arrange
    const input = `${WORD_TOKEN} middle ${WORD_TOKEN}`

    // Act
    const result = restoreText(input, buildIndex(), buildSecretSet())

    // Assert — per-occurrence semantics: two hits, two restoredOriginals entries
    expect(result.text).toBe(`${WORD_ORIGINAL} middle ${WORD_ORIGINAL}`)
    expect(result.restored).toBe(2)
    expect(result.restoredOriginals).toEqual([WORD_ORIGINAL, WORD_ORIGINAL])
  })
})

// ---------------------------------------------------------------------------
// SC1 pass-through taxonomy
// ---------------------------------------------------------------------------

describe('restoreText — SC1 pass-through taxonomy', () => {
  it.each([
    ['a wrong-nonce8 planted token', WRONG_NONCE_TOKEN],
    ['an unissued-NNN enumeration probe', UNISSUED_TOKEN],
    ['a fabricated-TYPE token', FABRICATED_TYPE_TOKEN],
  ])('passes %s through byte-identical, counted unmatched', (_label, token) => {
    // Arrange
    const input = `before ${token} after`

    // Act
    const result = restoreText(input, buildIndex(), buildSecretSet())

    // Assert
    expect(result.text).toBe(input)
    expect(result.restored).toBe(0)
    expect(result.unmatched).toBe(1)
    expect(result.skippedSecret).toBe(0)
    expect(result.restoredOriginals).toEqual([])
  })

  it('never matches a v1 token — text byte-identical, ALL counters zero', () => {
    // Arrange — v1 grammar (no nonce8) is invisible to the v2 scan regex
    const input = `legacy ${V1_TOKEN} text`

    // Act
    const result = restoreText(input, buildIndex(), buildSecretSet())

    // Assert
    expect(result.text).toBe(input)
    expect(result.restored).toBe(0)
    expect(result.unmatched).toBe(0)
    expect(result.skippedSecret).toBe(0)
    expect(result.restoredOriginals).toEqual([])
  })

  it('passes an OVF token through unchanged, counted unmatched', () => {
    // Arrange
    const input = `overflow ${OVF_TOKEN} here`

    // Act
    const result = restoreText(input, buildIndex(), buildSecretSet())

    // Assert
    expect(result.text).toBe(input)
    expect(result.restored).toBe(0)
    expect(result.unmatched).toBe(1)
  })

  it('never restores an OVF token even when the index is poisoned with the OVF key', () => {
    // Arrange — Pitfall 1 belt-and-braces: the label short-circuit must
    // precede the lookup, so a poisoned index entry cannot restore.
    const index = buildIndex()
    index.set(OVF_TOKEN, 'wrong-value')
    const input = `poisoned ${OVF_TOKEN} case`

    // Act
    const result = restoreText(input, index, buildSecretSet())

    // Assert
    expect(result.text).toBe(input)
    expect(result.restored).toBe(0)
    expect(result.unmatched).toBe(1)
    expect(result.restoredOriginals).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Secret-class skip
// ---------------------------------------------------------------------------

describe('restoreText — secret-class skip', () => {
  it('passes a secret placeholder through, counted skippedSecret, never in restoredOriginals', () => {
    // Arrange
    const input = `key ${SECRET_TOKEN} redacted`

    // Act
    const result = restoreText(input, buildIndex(), buildSecretSet())

    // Assert
    expect(result.text).toBe(input)
    expect(result.restored).toBe(0)
    expect(result.unmatched).toBe(0)
    expect(result.skippedSecret).toBe(1)
    expect(result.restoredOriginals).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Single-pass no-cascade (CR-01 lesson)
// ---------------------------------------------------------------------------

describe('restoreText — single-pass no-cascade', () => {
  it('does not re-scan restored output when an original is literally another live token', () => {
    // Arrange — tokenA's original IS the literal text of tokenB, and tokenB
    // is itself a live index key. A cascading replacer would turn tokenA's
    // occurrence into tokenB's original (two hops); single-pass stops at one.
    const tokenA = formatV2Token('WORD', 4, NONCE)
    const tokenB = formatV2Token('WORD', 5, NONCE)
    const index = new Map([
      [tokenA, tokenB],
      [tokenB, 'zeus-plain'],
    ])
    const input = `${tokenA} | ${tokenB}`

    // Act
    const result = restoreText(input, index)

    // Assert — tokenA's occurrence becomes tokenB-text and STAYS tokenB-text;
    // the separate literal tokenB occurrence becomes B's original.
    expect(result.text).toBe(`${tokenB} | zeus-plain`)
    expect(result.restored).toBe(2)
    expect(result.restoredOriginals).toEqual([tokenB, 'zeus-plain'])
  })
})

// ---------------------------------------------------------------------------
// Counters + edges
// ---------------------------------------------------------------------------

describe('restoreText — counters and edge inputs', () => {
  it('sums counters correctly across a mixed document of all classes', () => {
    // Arrange — two hits, two unmatched (wrong nonce + OVF), one secret,
    // one v1 token (invisible: contributes to NO counter).
    const input = [
      `a ${WORD_TOKEN}`,
      `b ${EMAIL_TOKEN}`,
      `c ${WRONG_NONCE_TOKEN}`,
      `d ${OVF_TOKEN}`,
      `e ${SECRET_TOKEN}`,
      `f ${V1_TOKEN}`,
    ].join('\n')

    // Act
    const result = restoreText(input, buildIndex(), buildSecretSet())

    // Assert
    expect(result.restored).toBe(2)
    expect(result.unmatched).toBe(2)
    expect(result.skippedSecret).toBe(1)
    expect(result.restoredOriginals).toEqual([WORD_ORIGINAL, EMAIL_ORIGINAL])
    expect(result.text).toBe(
      [
        `a ${WORD_ORIGINAL}`,
        `b ${EMAIL_ORIGINAL}`,
        `c ${WRONG_NONCE_TOKEN}`,
        `d ${OVF_TOKEN}`,
        `e ${SECRET_TOKEN}`,
        `f ${V1_TOKEN}`,
      ].join('\n'),
    )
  })

  it('returns the empty result shape for empty input', () => {
    // Arrange / Act
    const result = restoreText('', buildIndex(), buildSecretSet())

    // Assert
    expect(result).toEqual({
      text: '',
      restored: 0,
      unmatched: 0,
      skippedSecret: 0,
      restoredOriginals: [],
    })
  })

  it('returns byte-identical text and zero counters for token-free input', () => {
    // Arrange
    const input = 'no tokens live in this text at all'

    // Act
    const result = restoreText(input, buildIndex(), buildSecretSet())

    // Assert
    expect(result.text).toBe(input)
    expect(result.restored).toBe(0)
    expect(result.unmatched).toBe(0)
    expect(result.skippedSecret).toBe(0)
    expect(result.restoredOriginals).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Purity — inputs never mutated
// ---------------------------------------------------------------------------

describe('restoreText — purity', () => {
  it('does not mutate the passed index or secretPlaceholders', () => {
    // Arrange
    const index = buildIndex()
    const secrets = buildSecretSet()
    const entriesBefore = [...index.entries()]
    const secretsBefore = [...secrets]
    const input = `${WORD_TOKEN} ${SECRET_TOKEN} ${WRONG_NONCE_TOKEN}`

    // Act
    restoreText(input, index, secrets)

    // Assert — size AND entries identical after the call
    expect(index.size).toBe(entriesBefore.length)
    expect([...index.entries()]).toEqual(entriesBefore)
    expect(secrets.size).toBe(secretsBefore.length)
    expect([...secrets]).toEqual(secretsBefore)
  })
})

// ---------------------------------------------------------------------------
// Scan grammar sync-lock (allocator/restorer drift fails loudly)
// ---------------------------------------------------------------------------

describe('scan grammar sync-lock', () => {
  it('V2_TOKEN_SCAN_RE is the unanchored global twin of V2_TOKEN_RE', () => {
    // Assert — same body, anchors added on the allocator side, /g on the scan side
    expect(V2_TOKEN_RE.source).toBe(`^${V2_TOKEN_SCAN_RE.source}$`)
    expect(V2_TOKEN_SCAN_RE.flags).toBe('g')
  })
})
