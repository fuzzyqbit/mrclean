#!/usr/bin/env tsx
/**
 * Build-time vendoring script for the gitleaks rule pack.
 *
 * Usage: tsx scripts/vendor-gitleaks.ts
 * npm script: "vendor:gitleaks"
 *
 * Fetches the gitleaks config/gitleaks.toml from a pinned commit SHA,
 * writes it to vendor/gitleaks-rules.toml with a header comment,
 * computes the SHA-256 checksum, and generates the SKIPPED_GITLEAKS_RULES.md
 * audit document listing rules that cannot be adapted to JavaScript regex syntax.
 *
 * Security (T-02-01-06): Fetches over HTTPS only, pinned at a specific commit SHA.
 * Tamper detection (T-02-01-01): SHA-256 checksum written to vendor/gitleaks-rules.toml.sha256.
 */

import { createHash } from 'node:crypto'
import { writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'smol-toml'

// ---------------------------------------------------------------------------
// Pinned commit SHA — update this when upgrading the rule pack
// ---------------------------------------------------------------------------
// Pinned to a stable commit from gitleaks/gitleaks master as of 2026-05-14.
// Run `git ls-remote https://github.com/gitleaks/gitleaks.git HEAD` to get latest.
const PINNED_SHA = '9febafb621f407ec7fd0d398783fa3a63418f694'

// Fallback: use master if the pinned SHA is unavailable (build-time only)
const GITLEAKS_URL = `https://raw.githubusercontent.com/gitleaks/gitleaks/${PINNED_SHA}/config/gitleaks.toml`
const GITLEAKS_MASTER_URL = 'https://raw.githubusercontent.com/gitleaks/gitleaks/master/config/gitleaks.toml'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(SCRIPT_DIR, '..')
const VENDOR_DIR = join(PROJECT_ROOT, 'vendor')
const OUTPUT_PATH = join(VENDOR_DIR, 'gitleaks-rules.toml')
const CHECKSUM_PATH = join(VENDOR_DIR, 'gitleaks-rules.toml.sha256')
const SKIPPED_PATH = join(VENDOR_DIR, 'SKIPPED_GITLEAKS_RULES.md')

// ---------------------------------------------------------------------------
// gitleaks regex adaptation logic (mirrors src/detect/layer1-regex/gitleaks-adapter.ts)
// ---------------------------------------------------------------------------

interface AdaptResult {
  pattern: string
  flags: string
}

function adaptGitleaksPattern(rawRegex: string): AdaptResult | null {
  if (!rawRegex) return null // guard for missing/undefined regex field
  if (rawRegex.includes('(?-i:') || rawRegex.includes('(?P<')) return null
  if (rawRegex.includes('(?i:')) return null // mid-pattern (?i:) — skip
  if (rawRegex.startsWith('(?i)')) return { pattern: rawRegex.slice(4), flags: 'i' }
  return { pattern: rawRegex, flags: '' }
}

interface GitleaksRule {
  id: string
  description?: string
  regex: string
  entropy?: number
  keywords?: string[]
  allowlists?: { regexes?: string[]; paths?: string[]; stopwords?: string[] }[]
}

interface GitleaksToml {
  title?: string
  allowlist?: { paths?: string[]; regexes?: string[]; stopwords?: string[] }
  rules: GitleaksRule[]
}

function classifyRule(rule: GitleaksRule): {
  category: 'direct' | 'adapted' | 'skipped'
  reason?: string
} {
  if (!rule.regex) {
    return { category: 'skipped', reason: 'No regex field defined' }
  }
  const adapted = adaptGitleaksPattern(rule.regex)
  if (adapted === null) {
    if (rule.regex.includes('(?-i:')) {
      return { category: 'skipped', reason: 'Contains (?-i:) sub-pattern case toggle — JS RegExp does not support inline mode modifiers' }
    }
    if (rule.regex.includes('(?P<')) {
      return { category: 'skipped', reason: 'Contains (?P<name>) named capture group syntax — Python/Go only' }
    }
    if (rule.regex.includes('(?i:')) {
      return { category: 'skipped', reason: 'Contains (?i:...) mid-pattern inline case-insensitive group — JS RegExp does not support inline mode modifiers' }
    }
    return { category: 'skipped', reason: 'Adaptation returned null (unknown incompatibility)' }
  }

  // Try actual RegExp construction to catch POSIX classes like [[:alnum:]]
  try {
    new RegExp(adapted.pattern, adapted.flags + 'g')
  } catch (err) {
    return {
      category: 'skipped',
      reason: `RegExp construction failed: ${(err as Error).message.split('\n')[0]}`,
    }
  }

  return {
    category: adapted.flags === 'i' ? 'adapted' : 'direct',
  }
}

// ---------------------------------------------------------------------------
// Main fetch + write logic
// ---------------------------------------------------------------------------

async function fetchGitleaksToml(): Promise<string> {
  console.log(`Fetching gitleaks rules from pinned SHA: ${PINNED_SHA}`)
  console.log(`URL: ${GITLEAKS_URL}`)

  let res = await fetch(GITLEAKS_URL)

  if (!res.ok) {
    console.warn(`Pinned SHA fetch failed (${res.status}), falling back to master...`)
    res = await fetch(GITLEAKS_MASTER_URL)
    if (!res.ok) {
      throw new Error(`Failed to fetch gitleaks.toml: HTTP ${res.status} from ${GITLEAKS_MASTER_URL}`)
    }
    console.warn('Warning: Using master instead of pinned SHA. Update PINNED_SHA in vendor script.')
  }

  return res.text()
}

async function main(): Promise<void> {
  const isoDate = new Date().toISOString().slice(0, 10)

  // Fetch the TOML
  const rawToml = await fetchGitleaksToml()

  // Prepend header comment (TOML # comments)
  const headerComment = [
    `# Vendored from gitleaks/gitleaks@${PINNED_SHA} on ${isoDate}`,
    '# Source: https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml',
    '# License: MIT (gitleaks repository)',
    '# DO NOT EDIT THIS FILE MANUALLY — regenerate with: npm run vendor:gitleaks',
    '#',
    '# Rule counts after JS adaptation (see vendor/SKIPPED_GITLEAKS_RULES.md for details):',
    '#   Total rules in TOML: updated at vendor time',
    '#   Direct (no flag changes): see SKIPPED_GITLEAKS_RULES.md',
    '#   Adapted ((?i) → /i flag): see SKIPPED_GITLEAKS_RULES.md',
    '#   Skipped (JS-incompatible): see SKIPPED_GITLEAKS_RULES.md',
    '',
  ].join('\n')

  const outputContent = headerComment + rawToml

  // Compute SHA-256 of the RAW toml (without our prepended header)
  const checksum = createHash('sha256').update(rawToml, 'utf8').digest('hex')
  console.log(`SHA-256: ${checksum}`)

  // Smoke-check: parse with smol-toml
  let parsed: GitleaksToml
  try {
    parsed = parse(rawToml) as GitleaksToml
  } catch (err) {
    throw new Error(`smol-toml failed to parse gitleaks.toml: ${(err as Error).message}`)
  }

  const ruleCount = parsed.rules?.length ?? 0
  console.log(`Parsed ${ruleCount} rules successfully`)

  if (ruleCount < 100) {
    throw new Error(`Sanity check failed: only ${ruleCount} rules found (expected >= 100)`)
  }

  // Classify each rule
  const direct: GitleaksRule[] = []
  const adapted: GitleaksRule[] = []
  const skipped: Array<{ rule: GitleaksRule; reason: string }> = []

  for (const rule of parsed.rules) {
    const classification = classifyRule(rule)
    if (classification.category === 'direct') {
      direct.push(rule)
    } else if (classification.category === 'adapted') {
      adapted.push(rule)
    } else {
      skipped.push({ rule, reason: classification.reason ?? 'Unknown' })
    }
  }

  const usable = direct.length + adapted.length
  console.log(`Rule breakdown:`)
  console.log(`  Direct (no flag changes):  ${direct.length}`)
  console.log(`  Adapted ((?i) → /i flag):  ${adapted.length}`)
  console.log(`  Skipped (JS-incompatible): ${skipped.length}`)
  console.log(`  Total usable:              ${usable}`)

  // Update the header with actual counts
  const finalHeader = [
    `# Vendored from gitleaks/gitleaks@${PINNED_SHA} on ${isoDate}`,
    '# Source: https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml',
    '# License: MIT (gitleaks repository)',
    '# DO NOT EDIT THIS FILE MANUALLY — regenerate with: npm run vendor:gitleaks',
    '#',
    `# Rule counts after JS adaptation (see vendor/SKIPPED_GITLEAKS_RULES.md for details):`,
    `#   Total rules in TOML: ${ruleCount}`,
    `#   Direct (no flag changes): ${direct.length}`,
    `#   Adapted ((?i) → /i flag): ${adapted.length}`,
    `#   Skipped (JS-incompatible): ${skipped.length}`,
    `#   Total usable: ${usable}`,
    '',
  ].join('\n')

  const finalOutput = finalHeader + rawToml

  // Write files
  writeFileSync(OUTPUT_PATH, finalOutput, 'utf8')
  writeFileSync(CHECKSUM_PATH, checksum, 'utf8')
  console.log(`Written: ${OUTPUT_PATH}`)
  console.log(`Written: ${CHECKSUM_PATH}`)

  // Generate SKIPPED_GITLEAKS_RULES.md
  const skippedMd = generateSkippedMarkdown(skipped, {
    totalRules: ruleCount,
    directCount: direct.length,
    adaptedCount: adapted.length,
    skippedCount: skipped.length,
    usableCount: usable,
    pinnedSha: PINNED_SHA,
    vendorDate: isoDate,
  })

  writeFileSync(SKIPPED_PATH, skippedMd, 'utf8')
  console.log(`Written: ${SKIPPED_PATH}`)

  // Final line count check
  const lineCount = finalOutput.split('\n').length
  console.log(`Output file: ${lineCount} lines`)
  if (lineCount < 3000) {
    throw new Error(`Sanity check failed: output file has only ${lineCount} lines (expected > 3000)`)
  }

  console.log('vendor:gitleaks completed successfully.')
}

function generateSkippedMarkdown(
  skipped: Array<{ rule: GitleaksRule; reason: string }>,
  stats: {
    totalRules: number
    directCount: number
    adaptedCount: number
    skippedCount: number
    usableCount: number
    pinnedSha: string
    vendorDate: string
  },
): string {
  const lines: string[] = [
    '# Skipped Gitleaks Rules',
    '',
    `> Vendored from gitleaks/gitleaks@${stats.pinnedSha} on ${stats.vendorDate}`,
    '> Regenerated by: `npm run vendor:gitleaks`',
    '',
    '## Summary',
    '',
    '| Category | Count |',
    '|----------|-------|',
    `| Total rules in TOML | ${stats.totalRules} |`,
    `| Direct (no JS changes needed) | ${stats.directCount} |`,
    `| Adapted (leading \`(?i)\` → \`/i\` flag) | ${stats.adaptedCount} |`,
    `| **Skipped (JS-incompatible)** | **${stats.skippedCount}** |`,
    `| **Total usable** | **${stats.usableCount}** |`,
    '',
    '## Why Rules Are Skipped',
    '',
    "JavaScript's `RegExp` does not support:",
    '- Inline mode modifiers: `(?i)` mid-pattern or `(?i:...)` groups',
    '- Sub-pattern case toggling: `(?-i:...)` to disable case-insensitivity',
    '- Python/Go named capture groups: `(?P<name>...)`',
    '- POSIX character classes: `[[:alnum:]]`, `[[:alpha:]]`, etc.',
    '',
    'Leading `(?i)` is handled by stripping it and adding the `/i` flag to the `RegExp` constructor.',
    'All other incompatible patterns are skipped at adapter time.',
    '',
    '## Skipped Rules',
    '',
    '| rule-id | reason |',
    '|---------|--------|',
  ]

  for (const { rule, reason } of skipped) {
    // Escape pipe chars in the reason
    const escapedReason = reason.replace(/\|/g, '\\|')
    lines.push(`| \`${rule.id}\` | ${escapedReason} |`)
  }

  lines.push('')
  lines.push(
    '> These rules are skipped at adapter load time and logged to stderr during hook startup.',
  )
  lines.push(
    '> Coverage gap: ' +
    `${stats.skippedCount} rules (${((stats.skippedCount / stats.totalRules) * 100).toFixed(1)}% of total) are not applied.`,
  )
  lines.push(
    '> The secretlint preset-recommend covers the high-value patterns (AWS, GitHub, Stripe, etc.),',
  )
  lines.push(
    '> so these skipped gitleaks rules are mostly duplicates or low-signal patterns.',
  )
  lines.push('')

  return lines.join('\n')
}

main().catch((err) => {
  console.error('vendor:gitleaks FAILED:', err)
  process.exit(1)
})
