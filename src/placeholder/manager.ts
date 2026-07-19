/**
 * PlaceholderManager — Plan 02-03
 *
 * Session-scoped, stable-per-value, collision-free placeholder allocator.
 *
 * Placeholder format: <MRCLEAN:TYPE:NNN> where:
 *   - TYPE  is from the locked vocabulary (src/detect/type-map.ts)
 *   - NNN   is a 3-digit zero-padded GLOBAL session counter (001..999)
 *   - OVF   replaces NNN when counter > 999 (panic path)
 *
 * Key design decisions (from 02-CONTEXT.md §Placeholder Manager):
 *   - Counter is GLOBAL per session (not per-TYPE) to prevent cross-TYPE collisions (PH-03).
 *   - Stability: SHA-256 keyed lookup ensures same value → same placeholder (PH-02).
 *   - In-memory only — the manager itself never persists (reversible-mode store
 *     I/O lives in the Phase 9 state facade, never here: allocate() is
 *     SYNCHRONOUS inside runDetection's substitution path).
 *   - Angle brackets survive JSON, Markdown, code-fence, unified-diff (PH-04).
 *   - Phase 9 (09-04): opt-in reversible seam — hydrateReversible() switches
 *     allocation to v2 session-tagged tokens `<MRCLEAN:TYPE:NNN:nonce8>`;
 *     default construction keeps the v1 path byte-identical (D-10).
 */

import { sha256hex } from '../detect/findings.js'
// TYPE-ONLY imports from state (erased at compile) — the manager never imports
// state RUNTIME code, keeping src/state out of the hook cold path (Pitfall 7;
// enforced by the 09-07 import-graph test).
import type { ReversibleHydration, PendingAllocation } from '../state/session-map.js'

// ---------------------------------------------------------------------------
// PlaceholderEntry
// ---------------------------------------------------------------------------

/**
 * A single placeholder allocation entry.
 *
 * `hash` is the full 64-char SHA-256 hex of the original value.
 * `placeholder` is the formatted <MRCLEAN:TYPE:NNN> string (or OVF variant).
 */
export interface PlaceholderEntry {
  type: string
  index: number
  firstSeenTs: string
  placeholder: string
  hash: string
}

// ---------------------------------------------------------------------------
// PlaceholderManager
// ---------------------------------------------------------------------------

interface PlaceholderManagerOptions {
  sessionId?: string
}

export class PlaceholderManager {
  private readonly sessionId: string
  private readonly byHash = new Map<string, PlaceholderEntry>()
  private readonly byPlaceholder = new Map<string, string>() // placeholder → hash
  private counter = 0
  private overflowed = false

  /**
   * Phase 9 (09-04) reversible-mode state. `reversible` stays null until
   * hydrateReversible() is called — a DEFAULT-constructed manager never takes
   * the v2 branch, keeping the v1 allocation path byte-identical (D-10).
   */
  private reversible: ReversibleHydration | null = null
  /** v2 lookup cache keyed by HMAC content address (NOT sha256 — see allocateReversible). */
  private v2ByHmac = new Map<string, PlaceholderEntry>()
  /** NEW allocations since hydrate/last drain — awaiting the 09-05 persist step. */
  private pending: PendingAllocation[] = []

  constructor(opts?: PlaceholderManagerOptions) {
    this.sessionId = opts?.sessionId ?? 'unset'
  }

  /**
   * Allocate a placeholder for `value` with the given `type`.
   *
   * If the same `value` was already allocated in this session, returns the cached
   * entry without incrementing the counter (PH-02 stability).
   *
   * @param value - The raw secret string. SHA-256 is computed for keying; the value
   *                itself is never stored beyond the Map key computation.
   * @param type  - A TYPE string from the locked vocabulary (e.g. 'AWS_KEY', 'JWT').
   * @returns     - The PlaceholderEntry for this value.
   */
  allocate(value: string, type: string): PlaceholderEntry {
    // Phase 9 (09-04): hydrated (reversible) sessions take the v2 branch.
    // Early return keeps the v1 block below byte-identical (D-10 / Pitfall 7).
    if (this.reversible !== null) {
      return this.allocateReversible(value, type, this.reversible)
    }

    const hash = sha256hex(value)

    // PH-02: same value → same placeholder
    const cached = this.byHash.get(hash)
    if (cached !== undefined) {
      return cached
    }

    this.counter++

    let placeholder: string

    if (this.counter > 999) {
      // Overflow path: emit structured warning to stderr on first overflow only
      if (!this.overflowed) {
        process.stderr.write(
          JSON.stringify({
            warn: 'mrclean placeholder overflow',
            counter: this.counter,
            sessionId: this.sessionId,
          }) + '\n',
        )
        this.overflowed = true
      }
      // OVF placeholder — NOTE: collisions for same TYPE are expected overflow degradation
      placeholder = `<MRCLEAN:${type}:OVF>`
    } else {
      placeholder = `<MRCLEAN:${type}:${String(this.counter).padStart(3, '0')}>`
    }

    const entry: PlaceholderEntry = {
      type,
      index: this.counter,
      firstSeenTs: new Date().toISOString(),
      placeholder,
      hash,
    }

    this.byHash.set(hash, entry)
    // For OVF, last writer wins for same-TYPE lookups — documented as expected degradation
    this.byPlaceholder.set(placeholder, hash)

    return entry
  }

  /**
   * Retrieve a PlaceholderEntry by its formatted placeholder string.
   *
   * Useful for reversing the lookup during output processing.
   *
   * @param placeholder - e.g. '<MRCLEAN:AWS_KEY:001>'
   * @returns           - The PlaceholderEntry, or undefined if not found.
   */
  getByPlaceholder(placeholder: string): PlaceholderEntry | undefined {
    const hash = this.byPlaceholder.get(placeholder)
    if (hash === undefined) return undefined
    // v1 entries live in byHash (sha256 keys); v2 entries live in v2ByHmac
    // (HMAC keys). The fallback only fires for keys absent from byHash — i.e.
    // v2-only allocations — so v1 lookups are byte-identical in behaviour.
    return this.byHash.get(hash) ?? this.v2ByHmac.get(hash)
  }

  /**
   * Return the current counter value (number of allocations made).
   * Returns 0 if no allocations have been made.
   */
  size(): number {
    return this.counter
  }

  // ---------------------------------------------------------------------------
  // Phase 9 (09-04) — reversible v2 token layer (hydration-gated)
  // ---------------------------------------------------------------------------

  /**
   * Install (or refresh) reversible-mode v2 state from the decrypted session
   * map. Called by the state facade (09-05) BEFORE detection — never on the
   * one-way default path, so default construction stays v1 (D-10).
   *
   * Semantics:
   * - counter jumps to at least `counterFloor` (monotonic under in-process
   *   degrade: an already-higher local counter is never rewound);
   * - the v2 HMAC lookup cache is REPLACED wholesale, built as a NEW Map from
   *   `h.entriesByHmac` (the hydration input is never mutated);
   * - seeded placeholders are registered for getByPlaceholder reverse lookup;
   * - any stale pending allocations are cleared (defensive — the facade drains
   *   after every event, so leftovers mean a crashed reconcile).
   */
  hydrateReversible(h: ReversibleHydration): void {
    this.reversible = h
    this.counter = Math.max(this.counter, h.counterFloor)

    const seeded = new Map<string, PlaceholderEntry>()
    const now = new Date().toISOString()
    for (const [hmac, known] of h.entriesByHmac) {
      const entry: PlaceholderEntry = {
        type: known.type,
        index: parseV2TokenIndex(known.placeholder),
        firstSeenTs: now,
        placeholder: known.placeholder,
        hash: hmac,
      }
      seeded.set(hmac, entry)
      this.byPlaceholder.set(known.placeholder, hmac)
    }
    this.v2ByHmac = seeded
    this.pending = []
  }

  /**
   * Return all NEW allocations made since hydrate/last drain and clear the
   * buffer. The 09-05 facade drains exactly once per event to reconcile and
   * persist under the store lock. Safe on a default (v1) manager: always [].
   */
  drainPendingAllocations(): PendingAllocation[] {
    const drained = this.pending
    this.pending = []
    return drained
  }

  /**
   * v2 allocation branch — reachable ONLY when hydrated (reversible mode).
   *
   * Content addressing: entries are keyed by h.hmacOf(value) (HMAC-SHA256 with
   * the per-session map salt) — the v1 byHash map is neither consulted nor
   * populated on this path, and `PlaceholderEntry.hash` carries the HMAC hex
   * (not sha256) on v2 entries. Same original under ANY TYPE resolves to the
   * identical placeholder (D-10 content addressing).
   */
  private allocateReversible(
    value: string,
    type: string,
    h: ReversibleHydration,
  ): PlaceholderEntry {
    const hmac = h.hmacOf(value)

    // Hydrated store entries win: return the known placeholder without
    // burning a counter or creating a pending entry.
    const cached = this.v2ByHmac.get(hmac)
    if (cached !== undefined) {
      return cached
    }

    this.counter++

    // Same warn-once overflow shape as the v1 block. Duplicated by necessity:
    // extracting a shared helper would edit the frozen v1 lines (Pitfall 7).
    if (this.counter > 999 && !this.overflowed) {
      process.stderr.write(
        JSON.stringify({
          warn: 'mrclean placeholder overflow',
          counter: this.counter,
          sessionId: this.sessionId,
        }) + '\n',
      )
      this.overflowed = true
    }

    // formatToken owns the OVF branch (`<MRCLEAN:TYPE:OVF:nonce8>` past 999).
    const placeholder = h.formatToken(type, this.counter)

    const entry: PlaceholderEntry = {
      type,
      index: this.counter,
      firstSeenTs: new Date().toISOString(),
      placeholder,
      hash: hmac,
    }

    this.v2ByHmac.set(hmac, entry)
    // For OVF, last writer wins for same-TYPE lookups — same degradation as v1.
    this.byPlaceholder.set(placeholder, hmac)
    this.pending.push({ value, type, provisionalPlaceholder: placeholder })

    return entry
  }
}

// ---------------------------------------------------------------------------
// v2 token index parsing (hydration seeding only)
// ---------------------------------------------------------------------------

/**
 * Parse the NNN index out of a v2 placeholder (`<MRCLEAN:TYPE:NNN:nonce8>`).
 * OVF — or any non-NNN shape — parses to 0. Used only when seeding entries
 * from hydration; live allocations carry the real counter directly.
 */
function parseV2TokenIndex(placeholder: string): number {
  const match = /:(\d{3}):[a-f0-9]{8}>$/.exec(placeholder)
  const nnn = match?.[1]
  return nnn === undefined ? 0 : Number.parseInt(nnn, 10)
}
