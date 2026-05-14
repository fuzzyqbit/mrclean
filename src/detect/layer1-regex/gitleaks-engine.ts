/**
 * Gitleaks engine for mrclean Layer 1 detection.
 *
 * Runs the adapted gitleaks rule pack against in-memory text strings via
 * the worker_threads pool (ReDoS-safe 50ms per-pattern timeout).
 *
 * Contract (Plan 02-01):
 *   runGitleaks(text, pool, timeoutMs) → Promise<{ findings: Finding[]; timeoutCount: number }>
 *
 * Key behaviors:
 *   - Keyword pre-filter: only run regex if text contains at least one rule keyword
 *   - Per-rule allowlist (stopwords + regexes; path allowlists skipped for text payloads)
 *   - Global gitleaks allowlist applied same way
 *   - Shannon entropy minimum applied per-finding when rule.entropy is set
 *   - Budget bail-out: 5 timeouts in one call → return early with current findings
 *   - ruleId namespacing: 'gitleaks:<original-rule-id>' (matches type-map convention)
 *
 * Imports from Plan 02-00 canonical modules (DO NOT re-create):
 *   - Finding, redactedHash, fingerprint from '../findings.js'
 *
 * Shannon entropy:
 *   Inlined 10-line function here (not imported from Layer 2) per CONTEXT §Layer 2:
 *   "Shannon dup: gitleaks layer mirrors Layer 2's algorithm per CONTEXT §Layer 2".
 *   The duplication is acceptable — saves cross-plan coupling.
 */

import type { Finding } from '../findings.js'
import { redactedHash, fingerprint } from '../findings.js'
import { loadGitleaksRules, type CompiledGitleaksRule } from './gitleaks-adapter.js'
import type { WorkerPool } from './worker-pool.js'

// ---------------------------------------------------------------------------
// Shannon entropy (inline — mirrors Layer 2's algorithm; CONTEXT §Layer 2)
// Shannon dup: gitleaks layer mirrors Layer 2's algorithm per CONTEXT §Layer 2
// ---------------------------------------------------------------------------

function shannonEntropy(s: string): number {
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
// Per-rule allowlist regex compilation (cached on rule object)
// ---------------------------------------------------------------------------

/**
 * Compile per-rule allowlist regexes on first use.
 * Cache on the rule's `_compiledAllowlistRegexes` field — compiled ONCE, never per-call.
 */
function getCompiledAllowlistRegexes(rule: CompiledGitleaksRule): RegExp[] {
  if (rule._compiledAllowlistRegexes) return rule._compiledAllowlistRegexes

  const patterns: string[] = []
  for (const al of rule.allowlists) {
    patterns.push(...(al.regexes ?? []))
  }
  if (rule.globalAllowlist.regexes) {
    patterns.push(...rule.globalAllowlist.regexes)
  }

  rule._compiledAllowlistRegexes = patterns.map((p) => {
    try {
      return new RegExp(p)
    } catch {
      return null
    }
  }).filter((r): r is RegExp => r !== null)

  return rule._compiledAllowlistRegexes
}

// ---------------------------------------------------------------------------
// Per-rule allowlist evaluation
// ---------------------------------------------------------------------------

function isAllowlisted(value: string, rule: CompiledGitleaksRule): boolean {
  // Stopword check (global + per-rule)
  const allStopwords = [
    ...(rule.globalAllowlist.stopwords ?? []),
    ...rule.allowlists.flatMap((al) => al.stopwords ?? []),
  ]
  if (allStopwords.some((sw) => value.includes(sw))) return true

  // Regex check (pre-compiled)
  const compiledRegexes = getCompiledAllowlistRegexes(rule)
  if (compiledRegexes.some((re) => re.test(value))) return true

  // Path allowlists: skipped for hook text payloads (RESEARCH §2.4)
  return false
}

// ---------------------------------------------------------------------------
// runGitleaks
// ---------------------------------------------------------------------------

const BUDGET_TIMEOUT_LIMIT = 5

/**
 * Run the compiled gitleaks rule pack against `text` using `pool` for regex execution.
 *
 * @param text      - Raw text to scan.
 * @param pool      - WorkerPool instance for ReDoS-safe regex execution.
 * @param timeoutMs - Per-pattern timeout in ms (default 50ms per CONTEXT-lock).
 *
 * @returns `{ findings, timeoutCount }` where:
 *   - `findings` are normalized Finding objects with `source: 'gitleaks'`
 *   - `timeoutCount` is the number of patterns that timed out (for budget bail-out in Plan 02-04)
 *
 * Early return: if `timeoutCount >= 5`, returns immediately with findings-so-far.
 * This is the CONTEXT-locked detection-budget bail-out.
 */
export async function runGitleaks(
  text: string,
  pool: WorkerPool,
  timeoutMs = 50,
): Promise<{ findings: Finding[]; timeoutCount: number }> {
  const rules = loadGitleaksRules()
  const textLowered = text.toLowerCase() // computed ONCE outside the loop
  const findings: Finding[] = []
  let timeoutCount = 0

  for (const rule of rules) {
    // Budget bail-out: 5 timeouts in one call → return early
    if (timeoutCount >= BUDGET_TIMEOUT_LIMIT) break

    // Keyword pre-filter (RESEARCH §2.3): if rule has keywords and none appear in text, skip
    if (rule.keywords.length > 0 && !rule.keywords.some((kw) => textLowered.includes(kw))) {
      continue
    }

    const result = await pool.runRegex(rule.pattern, rule.flags, text, timeoutMs)

    if (!result.ok) {
      if ('timedOut' in result && result.timedOut) {
        timeoutCount++
      }
      // On error or timeout, skip this rule's findings
      continue
    }

    for (const match of result.matches) {
      const value = match.value

      if (!value) continue // skip empty matches

      // Allowlist check (per-rule + global)
      if (isAllowlisted(value, rule)) continue

      // Shannon entropy minimum (if rule.entropy is set)
      if (rule.entropy !== undefined && shannonEntropy(value) < rule.entropy) continue

      const ruleId = `gitleaks:${rule.id}`

      findings.push({
        ruleId,
        severity: 'HIGH', // gitleaks does not encode severity; default to HIGH
        span: { start: match.start, end: match.end },
        value,
        redactedHash: redactedHash(value),
        fingerprint: fingerprint(ruleId, value),
        source: 'gitleaks',
      })
    }
  }

  return { findings, timeoutCount }
}
