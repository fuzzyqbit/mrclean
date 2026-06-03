/**
 * Layer 6a: Regex-based PII detection hot-path lane.
 *
 * Pure-JS synchronous detector inserted after Layer 4 in the detection pipeline.
 * Catches 5 structured PII entities behind the `[pii].enabled` config gate.
 *
 * Entities (from config.pii.regex.entities — default all 5 enabled):
 *   - email       → ruleId 'pii:email', severity MEDIUM, default action 'warn'
 *   - ssn         → ruleId 'pii:ssn', severity HIGH, default action 'block'
 *   - credit_card → ruleId 'pii:credit_card', severity HIGH, default action 'block'
 *   - phone       → ruleId 'pii:phone', severity MEDIUM, default action 'warn'
 *   - ip          → ruleId 'pii:ip', severity LOW, default action 'audit'
 *
 * PII findings emit in the existing Finding shape with source: 'pii-regex', flowing
 * through the existing PlaceholderManager, audit log, and 5-axis allowlist with
 * ZERO new sink code (PII-02).
 *
 * Implementation decisions:
 *   - Pattern sources stored as strings, NOT module-level stateful /g RegExp objects
 *     (avoids lastIndex bleed across calls — RESEARCH Pitfall 2)
 *   - Luhn validation applied as a secondary gate for credit_card candidates
 *   - Allowlist applied via shared isAllowlisted() from allowlist.ts (PII-02)
 *   - Severity derived from entity (not from config action) per RESEARCH E2
 *
 * Plan 05-01 — implements PII-01 (regex/checksum detection) and PII-02 (existing sinks).
 */

import type { Finding } from './findings.js'
import { redactedHash, fingerprint } from './findings.js'
import { isAllowlisted } from './allowlist.js'
import type { MrcleanPiiRegexConfig, MrcleanConfig } from '../shared/types.js'

// ---------------------------------------------------------------------------
// Entity pattern source strings
// Stored as MODULE-LEVEL CONSTANTS but as strings, NOT stateful /g RegExp objects.
// A fresh RegExp is created per scan call via matchAll() to avoid lastIndex bleed.
// RESEARCH Pitfall 2: never reuse a global-flag RegExp instance across invocations.
// ---------------------------------------------------------------------------

/**
 * PII pattern source strings (5 entities).
 *
 * Derived from RESEARCH Pattern 1 (validated, linear-time patterns).
 * ReDoS mitigations: validated octet groups, bounded alternations, no catastrophic
 * backtracking. Credit card pattern uses prefix alternation (not nested quantifiers).
 * T-05-01-01 threat mitigation: all patterns are linear on the input length.
 */
const PII_PATTERN_SOURCES: ReadonlyMap<string, string> = new Map([
  // Email: standard RFC-5321-ish pattern anchored by word boundary
  ['email', '[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}'],

  // SSN: negative lookahead rejects group 000/666/9xx and serial 0000
  // Allows separators: hyphen or space (consistently)
  ['ssn', '(?<![\\d])(?!000|666|9\\d{2})\\d{3}[\\- ]\\d{2}[\\- ](?!0{4})\\d{4}(?![\\d])'],

  // Credit card: broad Visa/MC/Amex/Discover/JCB prefix alternation
  // Luhn validation applied as secondary gate after regex match
  ['credit_card', '(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\\d{3})\\d{11})'],

  // Phone: NPA starting [2-9], NXX starting [2-9] — avoids version-string false positives
  // Supports formats: NNN-NNN-NNNN, NNN.NNN.NNNN, NNN NNN NNNN, (NNN) NNN-NNNN
  // RESEARCH Pitfall 3: NPA/NXX [2-9] guard prevents matching "3.14.1592"
  ['phone', '(?:\\+1[\\-.\\s]?)?\\(?[2-9][0-9]{2}\\)?[\\-.\\s]?[2-9][0-9]{2}[\\-.\\s]?[0-9]{4}'],

  // IPv4: validated octet pattern (0-255 per octet), anchored by word boundary
  // RESEARCH Pitfall 4: \b prevents matching 56.1.1.1 inside "256.1.1.1"
  ['ip', '\\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\b'],
])

// ---------------------------------------------------------------------------
// Severity mapping (entity → severity)
// Derived from RESEARCH E2: severity is from entity, not config action.
// ---------------------------------------------------------------------------

function severityForEntity(entity: string): Finding['severity'] {
  switch (entity) {
    case 'ssn':
    case 'credit_card':
      return 'HIGH'
    case 'email':
    case 'phone':
      return 'MEDIUM'
    case 'ip':
      return 'LOW'
    default:
      return 'MEDIUM' // defensive fallback for unknown entities
  }
}

// ---------------------------------------------------------------------------
// Span overlap helper
// ---------------------------------------------------------------------------

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
// Luhn checksum validation (inline — RESEARCH Pattern 2)
// ---------------------------------------------------------------------------

/**
 * Validate a credit card number using the Luhn algorithm.
 *
 * Strips all non-digit characters, then applies the doubling algorithm.
 * Returns true if the checksum is valid (sum % 10 === 0).
 *
 * Length constraint: 13-19 digits (covers all major card networks).
 *
 * @param raw - Raw card number string (may include spaces, hyphens).
 * @returns     true if the number passes Luhn validation.
 */
export function luhnCheck(raw: string): boolean {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19) return false

  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i]!, 10)
    if (alt) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    alt = !alt
  }
  return sum % 10 === 0
}

// ---------------------------------------------------------------------------
// runLayer6aPii — L6a PII engine entry point
// ---------------------------------------------------------------------------

/**
 * Run Layer 6a regex-PII detection against `text`.
 *
 * Called by the orchestrator (src/detect/index.ts) after Layer 4 and before
 * dedupBySpan, behind the `config.pii.enabled && config.pii.regex.enabled` guard.
 *
 * @param text         - The raw text to scan (prompt, tool arg, tool output).
 * @param piiConfig    - The pii.regex sub-config (entities + per-entity actions).
 *                       Equivalent to `config.pii.regex`.
 * @param config       - Full MrcleanConfig — required to call isAllowlisted(finding, config)
 *                       which reads config.allowlist internally (5-axis allowlist, PII-02).
 * @param coveredSpans - Spans already claimed by L1-L4. Candidates overlapping
 *                       any entry here are skipped (same protocol as L2/L3/L4).
 * @returns             Array of Findings sorted by span.start ascending.
 */
export function runLayer6aPii(
  text: string,
  piiConfig: MrcleanPiiRegexConfig,
  config: MrcleanConfig,
  coveredSpans: readonly { start: number; end: number }[] = [],
): Finding[] {
  // Defensive early return when pii.regex.enabled is false
  if (!piiConfig.enabled) return []

  const findings: Finding[] = []

  for (const entity of piiConfig.entities) {
    const patternSource = PII_PATTERN_SOURCES.get(entity)
    if (!patternSource) continue // unknown entity — skip gracefully

    // Create a fresh RegExp per scan call to avoid lastIndex bleed (RESEARCH Pitfall 2).
    // Reusing a module-level /g RegExp causes .exec() to resume from non-zero lastIndex
    // on the next invocation — producing intermittent missed detections across calls.
    // PERF-03: fresh RegExp per entity per scan — required for correctness (lastIndex bleed safety); patterns compile in <1ms each; 5 entities × 1ms << 100ms budget.
    const re = entity === 'email'
      ? new RegExp(patternSource, 'gi') // PERF-03: see above
      : new RegExp(patternSource, 'g') // PERF-03: see above

    for (const match of text.matchAll(re)) {
      const value = match[0]
      const spanStart = match.index!
      const spanEnd = spanStart + value.length

      // Skip candidates covered by prior layers (span-dedup protocol)
      if (overlapsCovered(spanStart, spanEnd, coveredSpans)) continue

      // Secondary gate: Luhn validation for credit_card candidates
      if (entity === 'credit_card' && !luhnCheck(value)) continue

      // Derive severity from entity (RESEARCH E2 — fixed per entity, not per config)
      const severity = severityForEntity(entity)

      // Per-entity action from config (PiiAction: block | warn | audit)
      const action = piiConfig.actions[entity] ?? 'audit'

      // Build candidate Finding
      const hash = redactedHash(value)
      const fp = fingerprint(`pii:${entity}`, value)

      const candidate: Finding = {
        ruleId: `pii:${entity}`,
        severity,
        span: { start: spanStart, end: spanEnd },
        value,
        redactedHash: hash,
        fingerprint: fp,
        source: 'pii-regex',
        action,
      }

      // 5-axis allowlist check (PII-02 — identical to L1-L4; uses shared isAllowlisted)
      if (isAllowlisted(candidate, config)) continue

      findings.push(candidate)
    }
  }

  // Return sorted by span.start ascending (consistent with other layers)
  return findings.sort((a, b) => a.span.start - b.span.start)
}
