/**
 * Single-pass exact-lookup restore engine (plan 10-01, REVMODE-01).
 *
 * TRUST DIRECTION: src/restore/ INTRODUCES sensitive data — decrypted
 * originals cross into operator-visible output here (the opposite direction
 * from src/placeholder/). Operator-only: never reachable from hook or MCP
 * paths. Imports allowed ONLY from node: builtins, ./ siblings, ../state/,
 * ../detect/findings.js, and ../audit/restore-log.js (fence-locked in 10-07).
 *
 * This module is PURE: no node:fs, no node:crypto, no config input. The scan
 * grammar is imported from src/state/session-map.ts (V2_TOKEN_SCAN_RE) — the
 * single source of the token grammar; never re-declare it here.
 *
 * SC1 pass-through contract (executable spec: tests/restore/engine.test.ts):
 * - exact full-token index hit (nonce8 included) → restored;
 * - OVF label → pass through BEFORE any lookup (shared token, ambiguous
 *   inversion — holds even against a poisoned index, Pitfall 1);
 * - secretPlaceholders member → pass through, counted skippedSecret;
 * - anything else (unknown/stale/planted/fabricated) → pass through,
 *   counted unmatched;
 * - v1 tokens (no nonce8) never match the scan grammar at all.
 *
 * ONE String.prototype.replace pass — restored output is never re-scanned,
 * so a placeholder-shaped original cannot cascade (the CR-01
 * applyRenamesToText lesson).
 */

import { V2_TOKEN_SCAN_RE } from '../state/session-map.js'

/** The shared-ambiguity counter label — never restored (Pitfall 1). */
const OVF_LABEL = 'OVF'

/** Outcome of one restoreText pass. */
export interface RestoreResult {
  /** Output text: originals substituted on exact hits, all else untouched. */
  text: string
  /** Exact index hits replaced (per occurrence). */
  restored: number
  /** Unknown/stale/planted/OVF tokens passed through (per occurrence). */
  unmatched: number
  /** Tokens present in secretPlaceholders passed through (per occurrence). */
  skippedSecret: number
  /**
   * One entry PER restored occurrence, in scan order — raw values, memory
   * only; the CLI boundary (10-05) dedupes + hashes before any logging.
   */
  restoredOriginals: string[]
}

/**
 * Restore v2 placeholder tokens to their originals by exact full-token
 * lookup against `index` (placeholder → original, policy-gated at build
 * time by 10-02's read-side gate).
 *
 * Inputs are never mutated; counters are built locally and returned in a
 * fresh RestoreResult.
 */
export function restoreText(
  input: string,
  index: ReadonlyMap<string, string>,
  secretPlaceholders?: ReadonlySet<string>,
): RestoreResult {
  let restored = 0
  let unmatched = 0
  let skippedSecret = 0
  const restoredOriginals: string[] = []

  // ONE replace pass. String.prototype.replace with a /g regex resets
  // lastIndex before matching (Symbol.replace spec), so the shared
  // module-level scan regex is safe here.
  const text = input.replace(V2_TOKEN_SCAN_RE, (token, _type: string, label: string) => {
    // (1) OVF short-circuit BEFORE any lookup: multiple originals share one
    // OVF token, so inversion is ambiguous — belt-and-braces on top of the
    // index builder's own OVF exclusion.
    if (label === OVF_LABEL) {
      unmatched += 1
      return token
    }
    // (2) Secret-class placeholders never restore — defense-in-depth behind
    // the 10-02 index gate (secret originals are never in the index either).
    if (secretPlaceholders?.has(token) === true) {
      skippedSecret += 1
      return token
    }
    // (3) Exact full-token lookup (nonce8 included): planted tokens with a
    // wrong nonce, unissued NNN, or fabricated TYPE structurally miss.
    const original = index.get(token)
    if (original === undefined) {
      unmatched += 1
      return token
    }
    restored += 1
    restoredOriginals.push(original)
    return original
  })

  return { text, restored, unmatched, skippedSecret, restoredOriginals }
}
