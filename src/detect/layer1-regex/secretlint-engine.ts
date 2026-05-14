/**
 * Secretlint engine for mrclean Layer 1 detection.
 *
 * Runs `@secretlint/secretlint-rule-preset-recommend` programmatically against
 * in-memory text strings (NEVER shells out to the secretlint CLI).
 *
 * API (RESEARCH §1.2 — locked):
 *   Uses individual rule creators from the preset's `rules` export so we can pass
 *   per-rule options (e.g. enableIDScanRule for the AWS rule).
 *
 * Severity mapping (RESEARCH §1.3):
 *   - secretlint 'error'   → HIGH
 *   - secretlint 'warning' → MEDIUM
 *   - secretlint 'info'    → LOW
 *   - CRITICAL promoted only for types with CRITICAL tier in getTypeForRuleId (AWS_SECRET, PRIVATE_KEY)
 *
 * Imports from Plan 02-00 canonical modules (DO NOT re-create):
 *   - Finding, redactedHash, fingerprint from '../findings.js'
 *   - getTypeForRuleId from '../type-map.js'
 */

import type { Finding } from '../findings.js'
import { redactedHash, fingerprint } from '../findings.js'
import { getTypeForRuleId } from '../type-map.js'

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

/**
 * Map secretlint message severity to mrclean Finding severity.
 * CRITICAL is a post-processing promotion based on rule type, not secretlint's own severity.
 */
function mapSeverity(
  secretlintSeverity: string,
  ruleId: string,
): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
  // Base mapping
  let severity: 'HIGH' | 'MEDIUM' | 'LOW'
  switch (secretlintSeverity) {
    case 'error':
      severity = 'HIGH'
      break
    case 'warning':
      severity = 'MEDIUM'
      break
    default:
      severity = 'LOW'
  }

  // CRITICAL promotion: AWS secrets and private keys are CRITICAL-tier (CONTEXT §CRITICAL tier)
  // getTypeForRuleId serves dual duty: TYPE for placeholder format AND CRITICAL gate
  const type = getTypeForRuleId(ruleId)
  if (type === 'AWS_SECRET' || type === 'PRIVATE_KEY') {
    return 'CRITICAL'
  }

  return severity
}

// ---------------------------------------------------------------------------
// runSecretlint
// ---------------------------------------------------------------------------

/**
 * Run secretlint preset-recommend against `text` in-process.
 *
 * Uses individual rule creators from `@secretlint/secretlint-rule-preset-recommend`'s
 * `rules` export so per-rule options can be passed (e.g. `enableIDScanRule: true` for
 * the AWS rule — disabled by default in the preset to avoid false positives in generic
 * code scanning, but appropriate for mrclean which scans Claude Code hook payloads that
 * may contain real credentials).
 *
 * Lazy-imports `@secretlint/core` and `@secretlint/secretlint-rule-preset-recommend`
 * on first call (cold-start budget).
 *
 * @param text - The raw input string to scan (prompt text, tool payload, etc.).
 * @returns    - Array of normalized Finding objects. Empty array if no secrets detected.
 */
export async function runSecretlint(text: string): Promise<Finding[]> {
  // Lazy imports (cold-start optimization per CLAUDE.md §Stack Patterns)
  const [{ lintSource }, { rules }] = await Promise.all([
    import('@secretlint/core'),
    import('@secretlint/secretlint-rule-preset-recommend'),
  ])

  // Build per-rule config with options for individual rules
  const ruleConfigs = rules.map((rule: { meta: { id: string }; [k: string]: unknown }) => {
    const baseConfig = {
      id: rule.meta.id,
      rule,
      options: {} as Record<string, unknown>,
      severity: 'error' as const,
      disabled: false,
    }

    // Enable AWS Access Key ID scanning (off by default — safe for mrclean's use case)
    if (rule.meta.id === '@secretlint/secretlint-rule-aws') {
      baseConfig.options = { enableIDScanRule: true }
    }

    return baseConfig
  })

  const result = await lintSource({
    source: {
      content: text,
      filePath: 'hook-input.txt',
      ext: '.txt',
      contentType: 'text',
    },
    options: {
      config: { rules: ruleConfigs },
      locale: 'en',
      maskSecrets: false, // keep raw values for hashing — NEVER log them
    },
  })

  const findings: Finding[] = []

  for (const msg of result.messages) {
    const [start, end] = msg.range
    const value = text.slice(start, end)

    if (!value) continue // skip zero-length matches

    const ruleId: string = msg.messageId

    findings.push({
      ruleId,
      severity: mapSeverity(msg.severity, ruleId),
      span: { start, end },
      value,
      redactedHash: redactedHash(value),
      fingerprint: fingerprint(ruleId, value),
      source: 'secretlint',
    })
  }

  return findings
}
