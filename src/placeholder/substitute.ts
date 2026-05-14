/**
 * substituteFindings — Plan 02-03
 *
 * Replaces detected secret spans in text with their pre-allocated placeholders.
 *
 * Algorithm:
 *   1. Sort findings by span.start DESCENDING (right-to-left processing).
 *   2. For each finding, replace text.slice(span.start, span.end) with placeholder.
 *
 * Right-to-left substitution prevents index drift: replacing a span at position N
 * does not affect the indices of spans at positions < N.
 *
 * Context survival (PH-04):
 *   - JSON: angle brackets are valid inside JSON string values.
 *   - Markdown: angle brackets are legal HTML/template characters in Markdown.
 *   - Code fences: the fence delimiter (```) is not disturbed.
 *   - Unified diff: only the span content is replaced; +/- prefix lines are intact.
 *
 * Assumptions:
 *   - Findings have been deduplicated by Plan 02-04's orchestrator (dedupBySpan).
 *   - Zero-length spans (span.start === span.end) are skipped defensively.
 */

import type { Finding } from '../detect/findings.js'

// ---------------------------------------------------------------------------
// ResolvedFinding
// ---------------------------------------------------------------------------

/**
 * A Finding that has been paired with its allocated placeholder string.
 *
 * The `placeholder` field is set by the orchestrator after calling
 * `PlaceholderManager.allocate(finding.value, type)`.
 */
export type ResolvedFinding = Finding & { placeholder: string }

// ---------------------------------------------------------------------------
// substituteFindings
// ---------------------------------------------------------------------------

/**
 * Replace all finding spans in `text` with their placeholder strings.
 *
 * Processes findings right-to-left (descending span.start) to avoid index drift.
 * Zero-length spans are skipped (defense in depth against Layer 2/3/4 edge cases).
 *
 * @param text     - The original text containing secrets.
 * @param findings - Findings with pre-allocated placeholder strings.
 * @returns        - Text with all secret spans replaced by placeholders.
 */
export function substituteFindings(text: string, findings: ResolvedFinding[]): string {
  if (findings.length === 0) return text

  // Sort by span.start DESCENDING to process right-to-left (no index drift)
  const sorted = findings.slice().sort((a, b) => b.span.start - a.span.start)

  let result = text

  for (const finding of sorted) {
    const { start, end } = finding.span

    // Defensive: skip zero-length spans
    if (start === end) continue

    result = result.slice(0, start) + finding.placeholder + result.slice(end)
  }

  return result
}
