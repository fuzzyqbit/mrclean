import { describe, it, expect } from 'vitest'
import { isShapeAllowlisted, SHAPE_ALLOWLIST_PATTERNS } from '../../src/detect/shape-allowlist.js'

describe('isShapeAllowlisted', () => {
  it('returns true for UUID v4', () => {
    expect(isShapeAllowlisted('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('returns true for UUID v7 (same 8-4-4-4-12 hex pattern)', () => {
    expect(isShapeAllowlisted('01913ab3-4fee-7000-a000-123456789abc')).toBe(true)
  })

  it('returns true for 40-char git SHA-1', () => {
    expect(isShapeAllowlisted('a94a8fe5ccb19ba61c4c0873d391e987982fbbd3')).toBe(true)
  })

  it('returns true for 64-char SHA-256 hex', () => {
    expect(isShapeAllowlisted('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(true)
  })

  it('returns true for 32-char MD5 hex', () => {
    expect(isShapeAllowlisted('d41d8cd98f00b204e9800998ecf8427e')).toBe(true)
  })

  it('returns true for npm/Cargo integrity hash (sha512- prefix)', () => {
    // Valid base64: A-Za-z0-9+/ body with = padding only at end
    expect(isShapeAllowlisted('sha512-abc123XYZabc123XYZabc123XYZabc123XYZ/+abc==')).toBe(true)
  })

  it('returns true for base64 image-data header', () => {
    expect(isShapeAllowlisted('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA')).toBe(true)
  })

  it('returns true for short 7-char git SHA', () => {
    expect(isShapeAllowlisted('a94a8fe')).toBe(true)
  })

  it('returns false for AWS access key shape (not an allowlist pattern)', () => {
    expect(isShapeAllowlisted('AKIAIOSFODNN7EXAMPLE')).toBe(false)
  })

  it('returns false for regular English word', () => {
    expect(isShapeAllowlisted('Lorem')).toBe(false)
  })

  it('returns false for generic high-entropy string (not a known shape)', () => {
    expect(isShapeAllowlisted('sk-proj-xT5f9bQa2kWvE3mN7rPcYuSdJhGiLo8qZnRwK1')).toBe(false)
  })

  it('exports SHAPE_ALLOWLIST_PATTERNS as an array of RegExp', () => {
    expect(Array.isArray(SHAPE_ALLOWLIST_PATTERNS)).toBe(true)
    expect(SHAPE_ALLOWLIST_PATTERNS.length).toBeGreaterThanOrEqual(7)
    expect(SHAPE_ALLOWLIST_PATTERNS[0]).toBeInstanceOf(RegExp)
  })
})
