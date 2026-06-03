/**
 * Layer 1 detection engine orchestrator.
 *
 * `runLayer1` coordinates secretlint + gitleaks engines:
 *   1. Runs both engines in parallel via Promise.all
 *   2. Unions all findings
 *   3. Applies `dedupBySpan` (Plan 02-00) — secretlint preferred over gitleaks for identical spans
 *   4. Applies global config.allowlist filtering (rules, fingerprints, regexes, stopwords)
 *   5. Applies per-rule config.rules overrides (action + severity)
 *
 * Exports:
 *   runLayer1     — main entry point → { findings: Finding[]; timeoutCount: number }
 *   getRuleCount  — used by Plan 02-05 banner to show active rule counts
 *
 * @internal
 *   __test__runWorker — test-only export for bundle-worker integration test (OQ-A3)
 *
 * Imports from Plan 02-00 canonical modules (DO NOT re-create):
 *   - Finding, dedupBySpan from '../findings.js'
 */

import type { Finding } from '../findings.js'
import { dedupBySpan } from '../findings.js'
import { isAllowlisted } from '../allowlist.js'
import { runSecretlint } from './secretlint-engine.js'
import { runGitleaks } from './gitleaks-engine.js'
import { loadGitleaksRules } from './gitleaks-adapter.js'
import { runRegexInWorker } from './redos-worker.js'
import type { WorkerPool } from './worker-pool.js'
import type { MrcleanConfig, MrcleanRuleOverride } from '../../shared/types.js'

// ---------------------------------------------------------------------------
// Per-rule override application
// ---------------------------------------------------------------------------

/**
 * Apply per-rule config.rules overrides to a Finding.
 *
 * If override.action === 'off' → signal to drop (caller drops).
 * Otherwise → attach action + override severity.
 *
 * Returns the modified finding (new object, immutable pattern) or null if dropped.
 */
function applyRuleOverride(
  finding: Finding,
  overrideMap: Map<string, MrcleanRuleOverride>,
): Finding | null {
  const override = overrideMap.get(finding.ruleId)
  if (!override) return finding

  if (override.action === 'off') return null

  // Return new finding with overridden action and severity (immutable)
  return {
    ...finding,
    action: override.action,
    severity: override.severity,
  }
}

// ---------------------------------------------------------------------------
// getRuleCount
// ---------------------------------------------------------------------------

let _secretlintRuleCount: number | null = null

/**
 * Return the count of active detection rules for Plan 02-05 banner.
 *
 * Secretlint: 1 preset rule (28 sub-rules bundled inside the preset).
 * Gitleaks: dynamic count from loadGitleaksRules() (183 after JS adaptation).
 *
 * Note: secretlint count is reported as 1 (the preset entry) because we register
 * one preset rule in lintSource config. The 28 sub-modules are internal to the preset.
 */
export function getRuleCount(): { secretlint: number; gitleaks: number; total: number } {
  const secretlint = 1 // one preset rule (28 sub-modules internal)
  const gitleaks = loadGitleaksRules().length
  return { secretlint, gitleaks, total: secretlint + gitleaks }
}

// ---------------------------------------------------------------------------
// runLayer1
// ---------------------------------------------------------------------------

/**
 * Run Layer 1 detection (secretlint + gitleaks) against `text`.
 *
 * @param text   - Raw text to scan.
 * @param config - Effective MrcleanConfig (allowlist + per-rule overrides applied here).
 * @param pool   - WorkerPool for ReDoS-safe gitleaks regex execution.
 *
 * @returns `{ findings, timeoutCount }`:
 *   - `findings` deduplicated + allowlisted + override-applied Finding[]
 *   - `timeoutCount` propagated from gitleaks engine (for Plan 02-04 budget bail-out)
 */
export async function runLayer1(
  text: string,
  config: MrcleanConfig,
  pool: WorkerPool,
): Promise<{ findings: Finding[]; timeoutCount: number }> {
  // Run both engines in parallel
  const [secretlintFindings, gitleaksResult] = await Promise.all([
    runSecretlint(text),
    runGitleaks(text, pool),
  ])

  // Union findings
  const allFindings = [...secretlintFindings, ...gitleaksResult.findings]

  // Deduplicate overlapping spans (source precedence: secretlint > gitleaks)
  const deduped = dedupBySpan(allFindings)

  // Build override map for O(1) lookup per finding
  const overrideMap = new Map<string, MrcleanRuleOverride>()
  for (const override of config.rules) {
    overrideMap.set(override.id, override)
  }

  // Apply allowlist + per-rule overrides
  const filtered: Finding[] = []
  for (const finding of deduped) {
    if (isAllowlisted(finding, config)) continue

    const afterOverride = applyRuleOverride(finding, overrideMap)
    if (afterOverride === null) continue // action === 'off'

    filtered.push(afterOverride)
  }

  return { findings: filtered, timeoutCount: gitleaksResult.timeoutCount }
}

// ---------------------------------------------------------------------------
// @internal test-only export (bundle-worker.test.ts — OQ-A3 verification)
// ---------------------------------------------------------------------------

/**
 * Test-only helper: run a single regex in a worker from the bundled artifact.
 * Used by tests/detect/layer1/bundle-worker.test.ts to verify worker_threads
 * with eval:true works correctly in the tsup ESM bundle (RESEARCH OQ-A3).
 *
 * @internal NOT part of the public API. Prefix `__test__` marks it as internal.
 * @returns RegexWorkerResult discriminated union.
 */
export async function __test__runWorker(
  pattern: string,
  flags: string,
  text: string,
  timeoutMs: number,
) {
  return runRegexInWorker(pattern, flags, text, timeoutMs)
}
