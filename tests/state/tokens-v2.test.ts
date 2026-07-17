/**
 * Tests for the v2 token layer — Plan 09-04 (REVMODE-05).
 *
 * Proves both halves of D-10:
 *   - a HYDRATED (reversible) manager allocates v2 session-tagged tokens
 *     `<MRCLEAN:TYPE:NNN:nonce8>` using the injected session nonce;
 *   - a DEFAULT-constructed manager still emits v1 `<MRCLEAN:TYPE:NNN>`.
 *     (The byte-identical v1 proof is tests/placeholder/manager.test.ts
 *      passing with ZERO edits — Phase 8 SC2 discipline.)
 *
 * Hydration fixtures use REAL session-map closures (hmacAddress over a fixed
 * 64-hex salt, formatV2Token over nonce8 'aabbccdd') — the exact shapes the
 * 09-05 facade will inject. The manager itself never imports state runtime
 * (type-only imports — cold-path fence, Pitfall 7).
 */

import { describe, expect, it, vi } from 'vitest'
import { PlaceholderManager } from '../../src/placeholder/manager.js'
import { hmacAddress, formatV2Token, V2_TOKEN_RE } from '../../src/state/session-map.js'
import type { ReversibleHydration } from '../../src/state/session-map.js'
import { hydrateSessionManager, drainSessionAllocations } from '../../src/detect/index.js'

// ---------------------------------------------------------------------------
// Fixtures — real session-map closures over fixed salt + nonce
// ---------------------------------------------------------------------------

/** Fixed 64-lowercase-hex HMAC salt (32 bytes) for deterministic addressing. */
const FIXED_SALT = 'ab'.repeat(32)

/** Fixed per-session v2 token tag (8 lowercase hex chars). */
const NONCE8 = 'aabbccdd'

function makeHydration(overrides: Partial<ReversibleHydration> = {}): ReversibleHydration {
  return {
    nonce8: NONCE8,
    counterFloor: 0,
    entriesByHmac: new Map<string, { placeholder: string; type: string }>(),
    hmacOf: (value: string) => hmacAddress(FIXED_SALT, value),
    formatToken: (type: string, counter: number) => formatV2Token(type, counter, NONCE8),
    ...overrides,
  }
}

function makeHydratedManager(
  overrides: Partial<ReversibleHydration> = {},
  sessionId = 'v2-test-session',
): PlaceholderManager {
  const manager = new PlaceholderManager({ sessionId })
  manager.hydrateReversible(makeHydration(overrides))
  return manager
}

// ---------------------------------------------------------------------------
// v2 allocation path (hydrated manager)
// ---------------------------------------------------------------------------

describe('PlaceholderManager v2 token layer (hydrated)', () => {
  it('allocates a v2 session-tagged token and records exactly one pending allocation', () => {
    const manager = makeHydratedManager()

    const entry = manager.allocate('secret-x', 'AWS_KEY')

    expect(entry.placeholder).toBe('<MRCLEAN:AWS_KEY:001:aabbccdd>')
    expect(entry.placeholder).toMatch(V2_TOKEN_RE)
    expect(manager.drainPendingAllocations()).toEqual([
      {
        value: 'secret-x',
        type: 'AWS_KEY',
        provisionalPlaceholder: '<MRCLEAN:AWS_KEY:001:aabbccdd>',
      },
    ])
  })

  it('returns the same placeholder for the same value without burning a counter (PH-02 via HMAC)', () => {
    const manager = makeHydratedManager()

    const first = manager.allocate('secret-x', 'AWS_KEY')
    const second = manager.allocate('secret-x', 'AWS_KEY')

    expect(second).toBe(first)
    expect(manager.size()).toBe(1)
    // Exactly ONE pending entry despite two allocate calls
    expect(manager.drainPendingAllocations()).toHaveLength(1)
  })

  it('content-addresses across TYPEs: same original under a different TYPE returns the first placeholder (D-10)', () => {
    const manager = makeHydratedManager()

    const first = manager.allocate('secret-x', 'AWS_KEY')
    const second = manager.allocate('secret-x', 'JWT')

    // D-10: same original (any TYPE) → identical placeholder
    expect(second.placeholder).toBe(first.placeholder)
    expect(manager.size()).toBe(1)
    expect(manager.drainPendingAllocations()).toHaveLength(1)
  })

  it('resolves store-seeded values to the store placeholder without burning a counter or creating a pending entry', () => {
    const hmac = hmacAddress(FIXED_SALT, 'known')
    const entriesByHmac = new Map([
      [hmac, { placeholder: '<MRCLEAN:WORD:007:aabbccdd>', type: 'WORD' }],
    ])
    const manager = makeHydratedManager({ entriesByHmac })

    const entry = manager.allocate('known', 'WORD')

    expect(entry.placeholder).toBe('<MRCLEAN:WORD:007:aabbccdd>')
    expect(entry.type).toBe('WORD')
    // Seeded entry index parsed from the placeholder NNN
    expect(entry.index).toBe(7)
    // Counter NOT advanced (floor 0, store hit burns nothing)
    expect(manager.size()).toBe(0)
    // NO pending entry for store hits
    expect(manager.drainPendingAllocations()).toEqual([])
  })

  it('allocates strictly above the counter floor: floor 5 → first new NNN is 006', () => {
    const manager = makeHydratedManager({ counterFloor: 5 })

    const entry = manager.allocate('fresh-value', 'SECRET')

    expect(entry.placeholder).toBe('<MRCLEAN:SECRET:006:aabbccdd>')
    expect(manager.size()).toBe(6)
  })

  it('emits a v2 OVF token past 999 and fires the overflow stderr warn exactly once', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const manager = makeHydratedManager({ counterFloor: 999 })

    // 1000th counter position triggers overflow
    const overflowEntry = manager.allocate('overflow-value', 'SECRET')
    expect(overflowEntry.placeholder).toBe('<MRCLEAN:SECRET:OVF:aabbccdd>')
    expect(overflowEntry.placeholder).toMatch(V2_TOKEN_RE)
    expect(stderrSpy).toHaveBeenCalledOnce()

    // Same JSON warn shape as v1 (structured stderr, no raw values)
    const warningJson = (stderrSpy.mock.calls[0]![0] as string).trimEnd()
    const warning = JSON.parse(warningJson)
    expect(warning.warn).toBe('mrclean placeholder overflow')
    expect(warning.counter).toBe(1000)
    expect(warning.sessionId).toBe('v2-test-session')

    // Further overflow allocations: OVF token, but NO second warn
    const extra = manager.allocate('another-overflow-value', 'ENV')
    expect(extra.placeholder).toBe('<MRCLEAN:ENV:OVF:aabbccdd>')
    expect(stderrSpy).toHaveBeenCalledOnce()

    stderrSpy.mockRestore()
  })

  it('drainPendingAllocations returns the accumulated buffer once and clears it', () => {
    const manager = makeHydratedManager()

    manager.allocate('value-a', 'WORD')
    manager.allocate('value-b', 'PII_EMAIL')

    const first = manager.drainPendingAllocations()
    expect(first.map((p) => p.value)).toEqual(['value-a', 'value-b'])
    expect(first.map((p) => p.type)).toEqual(['WORD', 'PII_EMAIL'])

    // Second drain: buffer already cleared
    expect(manager.drainPendingAllocations()).toEqual([])
  })

  it('re-hydration refreshes state: previously-pending values resolve to the seeded final placeholders', () => {
    const manager = makeHydratedManager()

    // First event: provisional allocation
    const provisional = manager.allocate('contested', 'WORD')
    expect(provisional.placeholder).toBe('<MRCLEAN:WORD:001:aabbccdd>')

    // Simulate the 09-05 reconcile outcome: another hook process won the HMAC
    // key for 'contested' with NNN 004; fresh hydration carries the store truth.
    const hmac = hmacAddress(FIXED_SALT, 'contested')
    manager.hydrateReversible(
      makeHydration({
        counterFloor: 4,
        entriesByHmac: new Map([
          [hmac, { placeholder: '<MRCLEAN:WORD:004:aabbccdd>', type: 'WORD' }],
        ]),
      }),
    )

    // Stale pending cleared by re-hydration (defensive)
    expect(manager.drainPendingAllocations()).toEqual([])

    // The value now resolves to the seeded (final) placeholder
    const final = manager.allocate('contested', 'WORD')
    expect(final.placeholder).toBe('<MRCLEAN:WORD:004:aabbccdd>')

    // Store hit: counter stays at the floor, no new pending
    expect(manager.size()).toBe(4)
    expect(manager.drainPendingAllocations()).toEqual([])
  })

  it('getByPlaceholder resolves v2 placeholders (reverse lookup registered)', () => {
    const manager = makeHydratedManager()

    const entry = manager.allocate('secret-x', 'AWS_KEY')

    expect(manager.getByPlaceholder('<MRCLEAN:AWS_KEY:001:aabbccdd>')).toBe(entry)
  })

  it('getByPlaceholder resolves hydration-seeded v2 placeholders too', () => {
    const hmac = hmacAddress(FIXED_SALT, 'known')
    const manager = makeHydratedManager({
      entriesByHmac: new Map([
        [hmac, { placeholder: '<MRCLEAN:WORD:007:aabbccdd>', type: 'WORD' }],
      ]),
    })

    const retrieved = manager.getByPlaceholder('<MRCLEAN:WORD:007:aabbccdd>')

    expect(retrieved).toBeDefined()
    expect(retrieved!.type).toBe('WORD')
    expect(retrieved!.placeholder).toBe('<MRCLEAN:WORD:007:aabbccdd>')
    expect(retrieved!.hash).toBe(hmac)
  })
})

// ---------------------------------------------------------------------------
// v1 default path (no hydration) — byte-identical one-way default
// ---------------------------------------------------------------------------

describe('PlaceholderManager default path (no hydration)', () => {
  it('default-constructed manager emits v1 tokens and drains empty without throwing', () => {
    const manager = new PlaceholderManager({ sessionId: 'v1-default-session' })

    const entry = manager.allocate('v', 'WORD')

    expect(entry.placeholder).toBe('<MRCLEAN:WORD:001>')
    expect(entry.placeholder).not.toMatch(V2_TOKEN_RE)
    expect(() => manager.drainPendingAllocations()).not.toThrow()
    expect(manager.drainPendingAllocations()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// detect/index pass-through seam (additive exports on the cached-manager map)
// ---------------------------------------------------------------------------

describe('detect/index reversible seam pass-throughs', () => {
  it('hydrateSessionManager and drainSessionAllocations delegate to the cached session manager', () => {
    const sessionId = 'tokens-v2-seam-session'

    // Hydration reaches a real PlaceholderManager (would throw otherwise)
    expect(() => hydrateSessionManager(sessionId, makeHydration())).not.toThrow()

    // Drain on the hydrated manager: empty buffer, not an error
    expect(drainSessionAllocations(sessionId)).toEqual([])

    // Re-hydration through the seam is idempotent-safe
    expect(() => hydrateSessionManager(sessionId, makeHydration({ counterFloor: 3 }))).not.toThrow()
    expect(drainSessionAllocations(sessionId)).toEqual([])
  })

  it('drainSessionAllocations on a never-hydrated session returns [] (v1 default manager)', () => {
    expect(drainSessionAllocations('tokens-v2-never-hydrated-session')).toEqual([])
  })
})
