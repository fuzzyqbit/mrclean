/**
 * Centralized user-facing PII/NER framing copy (Plan 07-03, PIISEC-02 D-05/D-07/D-08).
 *
 * Single source of truth for:
 *   1. PII_BEST_EFFORT_DISCLAIMER — the one short honest-framing sentence surfaced
 *      ONCE per output on every runtime surface (README PII section, the `mrclean
 *      doctor` / CLI report trailing line, the SessionStart banner additionalContext,
 *      and the MCP tool descriptions). Importing this constant everywhere prevents
 *      copy drift: change the wording here and all surfaces re-derive (D-05/D-07).
 *   2. BANNED_COPY_PHRASES — the claim-form regexes consumed by tests/copy-drift.test.ts
 *      to fail the build if compliance/guarantee CLAIM language enters user-facing copy
 *      (D-08). These ban claim SHAPES ("redacts all PII", "GDPR compliant"), NOT the
 *      bare word "guarantee" — the disclaimer below legitimately says "not a guarantee".
 *
 * D-07 stance (LOCKED): secrets (+ checksum'd PII like SSN/credit-card) are the
 * deterministic guarantee; NER is a best-effort recall aid whose false negatives CAN
 * leak. Copy must never blur the two into "mrclean redacts your PII". The disclaimer
 * points users to words.txt + the deterministic layers as the real must-not-leak lever.
 *
 * No I/O, no engine imports — mirrors the single-purpose const-export shape of
 * src/shared/version.ts.
 */

/**
 * The honest-framing best-effort PII disclaimer (D-07 stance). One short sentence,
 * surfaced once-per-output on all runtime surfaces. Uses the allowed negation
 * "not a guarantee" — banned by no regex in BANNED_COPY_PHRASES by design.
 */
export const PII_BEST_EFFORT_DISCLAIMER =
  'PII/NER detection is a best-effort ML hint, not a guarantee — NER false negatives can leak; ' +
  'for data that must not leak, rely on words.txt and the deterministic layers (secrets + checksummed PII).'

/**
 * Banned CLAIM-form regexes (D-08). These match OVERCLAIM shapes only — never a bare
 * negated word. Pitfall 5: the honest disclaimer itself contains "not a guarantee" and
 * MUST pass the scan, so we never ban a bare `/guarantee/`; we ban the positive claim
 * shape `guarantees (all|every) ...`.
 *
 * Consumed by tests/copy-drift.test.ts, which scans the user-facing string SOURCES.
 */
export const BANNED_COPY_PHRASES: readonly RegExp[] = [
  // "redacts all PII" / "redact all PII" — the classic overclaim.
  /redacts? all PII/i,
  // Compliance self-claims: "GDPR compliant", "HIPAA-compliant", "CCPA compliant".
  /\b(GDPR|HIPAA|CCPA)\b[^.]*compliant/i,
  // "fully compliant" — blanket compliance overclaim.
  /\bfully compliant\b/i,
  // "guarantees all" / "guarantees that every" — the positive claim shape ONLY.
  // NOT a bare /guarantee/ (the disclaimer's "not a guarantee" must pass).
  /\bguarantees? (that )?(all|every) /i,
]
