/**
 * D-11 cross-source NER overlap drop (Layer 6b post-processing).
 *
 * A `pii-ner` finding that overlaps ANY non-`pii-ner` (higher-precedence) finding is DROPPED
 * ENTIRELY — regardless of span length. NER does NOT win a region via longest-span-wins against
 * a deterministic source; there is no partial substitution or fragmented placeholder.
 *
 * This is a DELIBERATE exception to pure longest-span-wins, scoped to the `pii-ner` source ONLY.
 * It is implemented as a SEPARATE pre-`dedupBySpan` pass so the generic `dedupBySpan` stays pure
 * (its longest-span-wins + source-order logic is shared by L1–L6a and must not be special-cased).
 *
 * Two `pii-ner` findings overlapping ONLY each other are BOTH kept here — resolving them is left
 * to the downstream generic `dedupBySpan` (longest-span-wins, then source order).
 *
 * Wiring into src/detect/index.ts (immediately before dedupBySpan) happens in Plan 06-02; this
 * module only delivers + unit-tests the function.
 *
 * Half-open span convention `[start, end)` — identical to findings.ts `spansOverlap`.
 *
 * Plan 06-01 — implements NER-01 / D-11.
 */

import type { Finding } from './findings.js'

/**
 * Half-open overlap predicate for two spans: true iff `[aStart,aEnd)` and `[bStart,bEnd)` intersect.
 * Mirrors the internal `spansOverlap` in findings.ts (copied so this pass is self-contained).
 */
function spansOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * Drop every `pii-ner` finding that overlaps any non-`pii-ner` finding (D-11).
 *
 * Non-`pii-ner` findings are always retained. `pii-ner` findings are retained only when they do
 * not overlap any higher-precedence (non-`pii-ner`) span — length is irrelevant.
 *
 * @param findings - The accumulated findings from all layers (L1–L6b), pre-dedup.
 * @returns          A new array with cross-source-overlapping NER findings removed.
 */
export function dropNerOverlaps(findings: Finding[]): Finding[] {
  const higher = findings.filter((f) => f.source !== 'pii-ner')

  return findings.filter((f) => {
    if (f.source !== 'pii-ner') return true // never drop non-NER findings
    // Drop this NER finding if it overlaps ANY higher-precedence span.
    return !higher.some((h) => spansOverlap(f.span, h.span))
  })
}
