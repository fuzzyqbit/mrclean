/**
 * Shared allowlist filtering for mrclean detection layers.
 *
 * Extracted from src/detect/layer1-regex/index.ts (Plan 05-01) to be shared
 * by both Layer 1 (secretlint + gitleaks) and Layer 6a (regex-PII). Layer 6b
 * (NER) in Phase 6 will also import this module.
 *
 * The 5-axis allowlist check (rules → fingerprints → regexes → stopwords) is
 * behavior-preserving — identical logic to the former private function in L1.
 *
 * Exported:
 *   isAllowlisted — returns true if a Finding should be dropped based on config.allowlist
 */

import type { Finding } from './findings.js'
import type { MrcleanConfig } from '../shared/types.js'

/**
 * Check if a Finding should be dropped based on config.allowlist.
 *
 * Checks (any match → drop):
 *   1. ruleId in allowlist.rules
 *   2. fingerprint in allowlist.fingerprints
 *   3. value matches any regex in allowlist.regexes (try/catch swallows malformed patterns)
 *   4. value contains any literal in allowlist.stopwords
 *
 * @param finding - The candidate Finding to test.
 * @param config  - Effective MrcleanConfig (reads config.allowlist internally).
 * @returns         true if the finding should be suppressed; false to keep it.
 */
export function isAllowlisted(finding: Finding, config: MrcleanConfig): boolean {
  const al = config.allowlist

  if (al.rules.includes(finding.ruleId)) return true
  if (al.fingerprints.includes(finding.fingerprint)) return true
  if (al.regexes.some((pattern) => {
    try {
      return new RegExp(pattern).test(finding.value) // PERF-03: user-supplied allowlist patterns from config — per-finding; config.allowlist.regexes is typically empty or very short (0-5 entries); caching is a plan 03-04+ optimization.
    } catch {
      return false
    }
  })) return true
  if (al.stopwords.some((sw) => finding.value.includes(sw))) return true

  return false
}
