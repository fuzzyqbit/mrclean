/**
 * Unit tests for sanitizeForOutput — Plan 07-01 (PIISEC-01 / D-03, D-04)
 *
 * The single error/diagnostic chokepoint: scrubs detected raw values from a
 * message (with-context mode) and emits a static structured message when no
 * detection context is available (context-free mode, D-04).
 *
 * `sanitizeForOutput` is pure, so no tmpdir/filesystem isolation is needed —
 * mirrors the AAA structure of tests/audit/canary-leak.test.ts.
 */

import { describe, expect, it } from 'vitest'
import { sanitizeForOutput } from '../../src/shared/sanitize-output.js'
import { redactedHash } from '../../src/detect/findings.js'

const SSN = '457-55-5462'
const EMAIL = 'zzcanary.person@example.invalid'

describe('sanitizeForOutput', () => {
  // (a) with-context: a message containing one known value → value replaced by its redactedHash
  it('replaces a detected value with its redactedHash in with-context mode', () => {
    // Arrange
    const message = `parse failed near ${SSN} while scanning`
    const spans = [{ value: SSN, redactedHash: redactedHash(SSN) }]

    // Act
    const out = sanitizeForOutput(message, spans)

    // Assert
    expect(out).not.toContain(SSN)
    expect(out).toContain(redactedHash(SSN))
  })

  // (b) context-free: empty spans → static message; original input echoed nowhere (D-04)
  it('returns a static message and never echoes input in context-free mode', () => {
    // Arrange
    const rawErrorText = `model load failed: ${SSN} ${EMAIL}`

    // Act — no spans available (pre-detection failure)
    const out = sanitizeForOutput(rawErrorText, [])

    // Assert
    expect(out).not.toContain(SSN)
    expect(out).not.toContain(EMAIL)
    expect(out).not.toBe(rawErrorText)
    expect(out.length).toBeGreaterThan(0)
  })

  it('returns the same static message for any context-free input (does not vary with payload)', () => {
    // Arrange / Act
    const a = sanitizeForOutput('secret one 457-55-5462', [])
    const b = sanitizeForOutput('completely different payload here', [])

    // Assert — static, payload-independent
    expect(a).toBe(b)
  })

  // (c) multiple spans all scrubbed
  it('scrubs every distinct detected value when multiple spans are passed', () => {
    // Arrange
    const message = `errors: ${SSN} and ${EMAIL} both seen`
    const spans = [
      { value: SSN, redactedHash: redactedHash(SSN) },
      { value: EMAIL, redactedHash: redactedHash(EMAIL) },
    ]

    // Act
    const out = sanitizeForOutput(message, spans)

    // Assert
    expect(out).not.toContain(SSN)
    expect(out).not.toContain(EMAIL)
    expect(out).toContain(redactedHash(SSN))
    expect(out).toContain(redactedHash(EMAIL))
  })

  // (d) safe message (no value substring present) passes through unchanged in with-context mode
  it('passes a safe message through unchanged when no value substring is present', () => {
    // Arrange
    const message = 'a benign diagnostic with no secrets'
    const spans = [{ value: SSN, redactedHash: redactedHash(SSN) }]

    // Act
    const out = sanitizeForOutput(message, spans)

    // Assert
    expect(out).toBe(message)
  })

  it('is idempotent: scrubbing an already-scrubbed message yields no raw values', () => {
    // Arrange
    const message = `first ${SSN}`
    const spans = [{ value: SSN, redactedHash: redactedHash(SSN) }]

    // Act
    const once = sanitizeForOutput(message, spans)
    const twice = sanitizeForOutput(once, spans)

    // Assert
    expect(twice).not.toContain(SSN)
    expect(twice).toBe(once)
  })
})
