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
 *   - In-memory only — never persisted (REVMODE-deferred).
 *   - Angle brackets survive JSON, Markdown, code-fence, unified-diff (PH-04).
 */

import { sha256hex } from '../detect/findings.js'

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
    return this.byHash.get(hash)
  }

  /**
   * Return the current counter value (number of allocations made).
   * Returns 0 if no allocations have been made.
   */
  size(): number {
    return this.counter
  }
}
