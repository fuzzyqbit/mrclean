/**
 * Canonical Finding interface and cryptographic helpers for mrclean detection layers.
 *
 * THIS MODULE IS OWNED BY PLAN 02-00 (Wave 1).
 * Wave 2 plans (02-01, 02-02, 02-03) IMPORT from here — do NOT re-create or modify
 * without revising plan 02-00 first.
 *
 * Exports:
 *   Finding           — canonical finding shape shared by all 4 detection layers
 *   sha256hex         — full 64-char SHA-256 hex digest (deterministic)
 *   redactedHash      — first 16 chars of sha256hex (audit-log surface)
 *   fingerprint       — `${ruleId}:${redactedHash(value)}` composite
 *   dedupBySpan       — resolve overlapping findings by source precedence + span length
 */

import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// Finding interface
// ---------------------------------------------------------------------------

/**
 * A single detection finding from any of the 4 detection layers.
 *
 * The `value` field carries the raw matched substring — it must NEVER be logged
 * or persisted. Use `redactedHash` for all audit surfaces.
 *
 * The optional `action` field is set by:
 *   - Layer 1: per-rule config.rules override (`block | substitute | audit | off`)
 *   - Layer 4: per-word action directive (`block | warn | audit`)
 * The orchestrator (plan 02-04) normalises `'warn'` to `'audit'` on output.
 */
export interface Finding {
  /** Rule ID — secretlint messageId, gitleaks:rule-id, entropy:high, env:literal, word:<term> */
  ruleId: string
  /** Severity assigned by the rule or per-rule config override. */
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  /** Half-open byte span [start, end) into the source text. */
  span: { start: number; end: number }
  /** Raw matched substring — NEVER log or persist this field. */
  value: string
  /** First 16 hex chars of SHA-256(value) — safe for audit logs. */
  redactedHash: string
  /** `${ruleId}:${redactedHash}` — stable composite for per-finding suppression (CFG-04). */
  fingerprint: string
  /** Which detection layer produced this finding. */
  source: 'secretlint' | 'gitleaks' | 'entropy' | 'env' | 'words' | 'pii-regex' | 'pii-ner'
  /**
   * Optional effective action. Set when a config.rules override or Layer 4 directive applies.
   * `'warn'` is a Layer 4 alias that the orchestrator normalises to `'audit'` before output.
   */
  action?: 'block' | 'substitute' | 'audit' | 'off' | 'warn'
}

// ---------------------------------------------------------------------------
// Cryptographic helpers
// ---------------------------------------------------------------------------

/**
 * Compute the full SHA-256 hex digest of `value` (UTF-8 encoded).
 * Deterministic: same input always produces the same 64-char lowercase hex string.
 */
export function sha256hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Return the first 16 hex characters of sha256hex(value).
 *
 * This truncation is the audit-log surface for mrclean: 64 bits of the digest
 * is sufficient for collision resistance in a per-session context while revealing
 * less than the full digest. See T-02-00-05 in the threat model for trade-offs.
 */
export function redactedHash(value: string): string {
  return sha256hex(value).slice(0, 16)
}

/**
 * Compute the fingerprint for a finding: `${ruleId}:${redactedHash(value)}`.
 * Used for CFG-04 per-finding suppression (`mrclean ignore <fingerprint>`).
 */
export function fingerprint(ruleId: string, value: string): string {
  return `${ruleId}:${redactedHash(value)}`
}

// ---------------------------------------------------------------------------
// dedupBySpan
// ---------------------------------------------------------------------------

/**
 * Source precedence order (lower index = higher priority).
 * When two findings cover the same span, the one with a lower SOURCE_PRECEDENCE
 * index survives. This matches the detection-layer ordering decision in CONTEXT.md
 * §Detection-Layer Ordering: Layer 1 (secretlint, gitleaks) > Layer 2 (entropy) >
 * Layer 3 (env) > Layer 4 (words) > Layer 6a (pii-regex) > Layer 6b (pii-ner).
 *
 * The two PII entries are appended at the tail so all secret layers retain higher
 * priority. Order: secretlint, gitleaks, entropy, env, words, pii-regex, pii-ner.
 * Source: ARCHITECTURE-v2-pii.md §Data Flow (locked precedence chain).
 *
 * Internal — not exported.
 */
const SOURCE_PRECEDENCE = ['secretlint', 'gitleaks', 'entropy', 'env', 'words', 'pii-regex', 'pii-ner'] as const

type Source = (typeof SOURCE_PRECEDENCE)[number]

function sourcePriority(source: string): number {
  const idx = SOURCE_PRECEDENCE.indexOf(source as Source)
  return idx === -1 ? SOURCE_PRECEDENCE.length : idx
}

function spanLength(f: Finding): number {
  return f.span.end - f.span.start
}

function spansOverlap(a: Finding, b: Finding): boolean {
  return a.span.start < b.span.end && b.span.start < a.span.end
}

/**
 * Deduplicate findings by resolving overlapping spans.
 *
 * Algorithm (RESEARCH §Detection-Layer Ordering locked precedence):
 *   1. Sort findings by span.start ascending (stable).
 *   2. For each candidate finding, check if it overlaps any existing survivor.
 *      - No overlap → push candidate into survivors.
 *      - Overlap with survivor(s):
 *        a. If candidate has a STRICTLY longer span than the overlapping survivor → replace.
 *        b. If equal span length AND candidate has HIGHER source priority → replace.
 *        c. Otherwise → drop the candidate.
 *   3. Return survivors sorted by span.start ascending.
 *
 * The `action` field on the survivor is preserved (set by config.rules or Layer 4 directive).
 *
 * @param findings - Possibly-overlapping findings from one or more detection layers.
 * @returns       - Deduplicated findings sorted by span.start.
 */
export function dedupBySpan(findings: Finding[]): Finding[] {
  if (findings.length === 0) return []

  // Sort by start position ascending; stable sort preserves insertion order for ties
  const sorted = findings.slice().sort((a, b) => a.span.start - b.span.start)

  const survivors: Finding[] = []

  for (const candidate of sorted) {
    // Find all survivors that overlap with the candidate
    let replaced = false

    for (let i = 0; i < survivors.length; i++) {
      const existing = survivors[i]!
      if (!spansOverlap(existing, candidate)) continue

      const existingLen = spanLength(existing)
      const candidateLen = spanLength(candidate)

      if (candidateLen > existingLen) {
        // Candidate is longer — it wins regardless of source
        survivors[i] = candidate
        replaced = true
        break
      } else if (candidateLen === existingLen && sourcePriority(candidate.source) < sourcePriority(existing.source)) {
        // Equal length but candidate has higher source priority
        survivors[i] = candidate
        replaced = true
        break
      } else {
        // Existing wins — drop candidate
        replaced = true
        break
      }
    }

    if (!replaced) {
      survivors.push(candidate)
    }
  }

  // Return sorted by span.start ascending
  return survivors.sort((a, b) => a.span.start - b.span.start)
}
