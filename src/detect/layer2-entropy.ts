/**
 * Layer 2 entropy detection for mrclean.
 *
 * Algorithm:
 *   1. Tokenize text into candidates (alphanumeric + _-./+= sequences ≥ min_length).
 *   2. Skip tokens covered by prior-layer spans.
 *   3. Skip shape-allowlisted tokens (UUIDs, git SHAs, etc.) — runs BEFORE entropy.
 *   4. Compute Shannon bits-per-char entropy.
 *   5. Fire if:
 *      (a) entropy ≥ threshold AND a context keyword appears within ±40 chars, OR
 *      (b) token length ≥ 40 AND entropy ≥ 5.0 (escalation — raw blobs without labels).
 *   6. Emit Finding with source:'entropy', ruleId:'entropy:high', severity:'MEDIUM'.
 *
 * Rule ID: entropy:high (locked by CONTEXT §Layer 2 + type-map.ts)
 * Severity: MEDIUM — entropy is the broad net; Layer 1 owns CRITICAL/HIGH precision.
 *
 * OWNED BY PLAN 02-02. Imports Finding/redactedHash/fingerprint from Plan 02-00.
 */

import type { Finding } from './findings.js'
import { redactedHash, fingerprint } from './findings.js'
import { isShapeAllowlisted } from './shape-allowlist.js'
import type { MrcleanConfig } from '../shared/types.js'

// ---------------------------------------------------------------------------
// Shannon entropy (inline ~10-line implementation — RESEARCH §5.1)
// No external package per CLAUDE.md "What NOT to Use" (shannon-entropy npm pkg).
// ---------------------------------------------------------------------------

/**
 * Compute Shannon bits-per-char entropy of a string.
 *
 * Formula: H = -Σ p(c) * log2(p(c))  for each unique character c in s.
 *
 * Returns 0 for empty or single-char strings.
 * Returns log2(n) for a string of n equally-probable distinct characters.
 *
 * @param s - Input string.
 * @returns   Shannon entropy in bits per character.
 */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0
  const freq = new Map<string, number>()
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1)
  }
  let entropy = 0
  const len = s.length
  for (const count of freq.values()) {
    const p = count / len
    entropy -= p * Math.log2(p)
  }
  return entropy
}

// ---------------------------------------------------------------------------
// Context keyword detection (RESEARCH §5.3)
// ---------------------------------------------------------------------------

/**
 * Keyword pattern for entropy context detection.
 *
 * A finding fires only when one of these keywords appears within ±40 chars
 * of the candidate token (excluding the token itself), OR the length≥40 + entropy≥5
 * escalation path fires.
 *
 * Locked by CONTEXT §Layer 2 + RESEARCH §5.3.
 */
const ENTROPY_KEYWORDS =
  /\b(?:secret|key|token|password|bearer|api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key|auth)\b/i

/** Window size (chars) on each side of the token to search for a keyword. */
const KEYWORD_WINDOW = 40

/**
 * Check if a context keyword appears within ±KEYWORD_WINDOW chars of a token span.
 *
 * The token span itself is excluded from the search window so that a token whose
 * VALUE happens to contain "key" doesn't self-trigger.
 *
 * @param text       - Full source text.
 * @param tokenStart - Start offset (inclusive) of the candidate token.
 * @param tokenEnd   - End offset (exclusive) of the candidate token.
 * @returns          - `true` if a keyword is found in the surrounding window.
 */
function hasEntropyContext(text: string, tokenStart: number, tokenEnd: number): boolean {
  const leftStart = Math.max(0, tokenStart - KEYWORD_WINDOW)
  const rightEnd = Math.min(text.length, tokenEnd + KEYWORD_WINDOW)

  // Left window: text before the token
  const left = text.slice(leftStart, tokenStart)
  if (ENTROPY_KEYWORDS.test(left)) return true

  // Right window: text after the token
  const right = text.slice(tokenEnd, rightEnd)
  if (ENTROPY_KEYWORDS.test(right)) return true

  return false
}

// ---------------------------------------------------------------------------
// Span overlap helper
// ---------------------------------------------------------------------------

/**
 * Check if a candidate span overlaps any of the already-covered spans.
 * Uses half-open intervals [start, end).
 */
function overlapsCovered(
  candidateStart: number,
  candidateEnd: number,
  covered: readonly { start: number; end: number }[],
): boolean {
  for (const span of covered) {
    if (candidateStart < span.end && span.start < candidateEnd) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Escalation constants
// ---------------------------------------------------------------------------

/** Minimum token length for the no-keyword escalation path. */
const ESCALATION_MIN_LENGTH = 40

/** Minimum entropy for the no-keyword escalation path. */
const ESCALATION_MIN_ENTROPY = 5.0

// ---------------------------------------------------------------------------
// runLayer2Entropy
// ---------------------------------------------------------------------------

/**
 * Run Layer 2 (entropy) detection over `text`.
 *
 * @param text         - The full source text to scan (hook payload, tool arg, etc.)
 * @param config       - Effective mrclean configuration (entropy.threshold, entropy.min_length).
 * @param coveredSpans - Spans already claimed by Layer 1. Tokens whose span overlaps
 *                       any entry here are skipped (span-dedup protocol).
 * @returns            - Array of Findings sorted by span.start ascending.
 */
export function runLayer2Entropy(
  text: string,
  config: MrcleanConfig,
  coveredSpans: readonly { start: number; end: number }[] = [],
): Finding[] {
  const { threshold, min_length } = config.entropy
  const findings: Finding[] = []

  // Token regex: alphanumeric + safe punctuation that appears in secrets (_-./+=)
  // Minimum length enforced via the {N,} quantifier.
  const tokenRe = new RegExp(`[A-Za-z0-9_.\\-./+=]{${min_length},}`, 'g') // PERF-03: dynamic min_length from config — cannot be module-scope constant; compiled once per runLayer2Entropy invocation, not per token.

  let match: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((match = tokenRe.exec(text)) !== null) {
    const value = match[0]
    const spanStart = match.index
    const spanEnd = spanStart + value.length

    // 1. Skip if covered by a prior layer's span
    if (overlapsCovered(spanStart, spanEnd, coveredSpans)) continue

    // 2. Shape allowlist runs BEFORE entropy (DET2-02)
    if (isShapeAllowlisted(value)) continue

    // 3. Compute entropy
    const entropy = shannonEntropy(value)

    // 4. Fire conditions (DET2-03)
    const hasKeyword = hasEntropyContext(text, spanStart, spanEnd)
    const keywordFired = entropy >= threshold && hasKeyword
    const escalationFired = value.length >= ESCALATION_MIN_LENGTH && entropy >= ESCALATION_MIN_ENTROPY

    if (!keywordFired && !escalationFired) continue

    // 5. Build Finding
    const hash = redactedHash(value)
    const fp = fingerprint('entropy:high', value)

    findings.push({
      ruleId: 'entropy:high',
      severity: 'MEDIUM',
      span: { start: spanStart, end: spanEnd },
      value,
      redactedHash: hash,
      fingerprint: fp,
      source: 'entropy',
    })
  }

  // Return sorted by span.start ascending
  return findings.sort((a, b) => a.span.start - b.span.start)
}
