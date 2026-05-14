/**
 * Tests for PlaceholderManager — Plan 02-03
 *
 * Covers PH-01 (format), PH-02 (stability), PH-03 (global counter/collision-free),
 * overflow behaviour, and getByPlaceholder round-trip.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaceholderManager } from '../../src/placeholder/manager.js'

describe('PlaceholderManager', () => {
  let manager: PlaceholderManager

  beforeEach(() => {
    manager = new PlaceholderManager({ sessionId: 'test-session' })
  })

  it('allocates a placeholder with the correct NNN-padded format', () => {
    const entry = manager.allocate('akia123', 'AWS_KEY')
    expect(entry.placeholder).toBe('<MRCLEAN:AWS_KEY:001>')
    expect(entry.index).toBe(1)
    expect(entry.type).toBe('AWS_KEY')
    expect(entry.hash).toHaveLength(64)
    expect(entry.firstSeenTs).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('returns the SAME placeholder for the same value (PH-02 stability)', () => {
    const first = manager.allocate('akia123', 'AWS_KEY')
    const second = manager.allocate('akia123', 'AWS_KEY')
    expect(first).toBe(second)
    expect(manager.size()).toBe(1)
  })

  it('assigns different (monotonically increasing) placeholders to different values', () => {
    const a = manager.allocate('akia123', 'AWS_KEY')
    const b = manager.allocate('different-secret', 'JWT')
    expect(a.placeholder).toBe('<MRCLEAN:AWS_KEY:001>')
    expect(b.placeholder).toBe('<MRCLEAN:JWT:002>')
    expect(manager.size()).toBe(2)
  })

  it('uses a GLOBAL counter across TYPEs (PH-03 collision-free)', () => {
    const awsKey = manager.allocate('secret-aws-key', 'AWS_KEY')
    const jwt = manager.allocate('secret-jwt-value', 'JWT')
    const ghToken = manager.allocate('secret-github-token', 'GH_TOKEN')
    expect(awsKey.index).toBe(1)
    expect(jwt.index).toBe(2)
    expect(ghToken.index).toBe(3)
    expect(awsKey.placeholder).toBe('<MRCLEAN:AWS_KEY:001>')
    expect(jwt.placeholder).toBe('<MRCLEAN:JWT:002>')
    expect(ghToken.placeholder).toBe('<MRCLEAN:GH_TOKEN:003>')
  })

  it('round-trips via getByPlaceholder', () => {
    const entry = manager.allocate('akia123', 'AWS_KEY')
    const retrieved = manager.getByPlaceholder('<MRCLEAN:AWS_KEY:001>')
    expect(retrieved).toBe(entry)
  })

  it('returns undefined for unknown placeholder', () => {
    expect(manager.getByPlaceholder('<MRCLEAN:UNKNOWN:999>')).toBeUndefined()
  })

  it('emits a JSON warning to stderr and returns OVF placeholder on 1000th allocation', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    // Allocate 999 unique values — no overflow yet
    for (let i = 0; i < 999; i++) {
      manager.allocate(`unique-value-${i}`, 'SECRET')
    }
    expect(stderrSpy).not.toHaveBeenCalled()
    expect(manager.size()).toBe(999)

    // 1000th allocation triggers overflow
    const overflowEntry = manager.allocate('unique-value-999', 'SECRET')
    expect(overflowEntry.placeholder).toBe('<MRCLEAN:SECRET:OVF>')
    expect(stderrSpy).toHaveBeenCalledOnce()

    // Verify the stderr warning is valid JSON and contains expected fields
    const warningJson = (stderrSpy.mock.calls[0]![0] as string).trimEnd()
    const warning = JSON.parse(warningJson)
    expect(warning.warn).toBe('mrclean placeholder overflow')
    expect(warning.counter).toBe(1000)
    expect(warning.sessionId).toBe('test-session')

    stderrSpy.mockRestore()
  })

  it('keeps returning OVF for post-overflow allocations; same-value lookups still cached', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    // Fill to overflow
    for (let i = 0; i < 1000; i++) {
      manager.allocate(`unique-value-${i}`, 'SECRET')
    }

    // Further allocations after overflow use OVF
    const extra = manager.allocate('brand-new-unique-value', 'ENV')
    expect(extra.placeholder).toBe('<MRCLEAN:ENV:OVF>')

    // Same value (already allocated in the last loop iteration index=999) uses cache
    const cachedLast = manager.allocate('unique-value-999', 'SECRET')
    expect(cachedLast.placeholder).toBe('<MRCLEAN:SECRET:OVF>')

    // stderr should have been called exactly once (only first overflow)
    expect(stderrSpy).toHaveBeenCalledOnce()

    stderrSpy.mockRestore()
  })
})
