/**
 * Long-form banner builder — Plan 02-05 HOOK-07 delivery.
 *
 * Format: `mrclean active vN.N.N (rules: NNN, allowlist: NN, mode: M)`
 *
 * Mode token:
 *   - 'dry-run' if config.dry_run === true
 *   - 'active'  otherwise (default)
 *   - 'off'     reserved for future opt-out flag (not triggered by any v1 input)
 *
 * ruleCount:  getRuleCount().total from Layer 1 (secretlint + gitleaks compiled rules)
 * allowlistCount: sum of all 5 allowlist axes (rules + paths + stopwords + regexes + fingerprints)
 */

import { VERSION } from '../shared/version.js'
import type { MrcleanConfig } from '../shared/types.js'

/**
 * Compute the total number of allowlist entries across all 5 axes.
 *
 * Axes: rules, paths, stopwords, regexes, fingerprints.
 */
export function computeAllowlistCount(config: MrcleanConfig): number {
  const al = config.allowlist
  return (
    al.rules.length +
    al.paths.length +
    al.stopwords.length +
    al.regexes.length +
    al.fingerprints.length
  )
}

/**
 * Build the long-form HOOK-07 banner string.
 *
 * @param config       - Effective MrcleanConfig (used for mode + allowlist count)
 * @param ruleCount    - Total number of active detection rules (getRuleCount().total)
 * @param allowlistCount - Total allowlist entries (computeAllowlistCount(config))
 * @returns            - Banner string for additionalContext
 */
export function buildBanner(
  config: MrcleanConfig,
  ruleCount: number,
  allowlistCount: number,
): string {
  const mode = config.dry_run ? 'dry-run' : 'active'
  return `mrclean active v${VERSION} (rules: ${ruleCount}, allowlist: ${allowlistCount}, mode: ${mode})`
}
