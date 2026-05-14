/**
 * Gitleaks TOML rule adapter for JavaScript regex compatibility.
 *
 * Gitleaks rules use Go/Python regex syntax that is partially incompatible with
 * JavaScript's RegExp engine. This module:
 *   1. Loads the vendored gitleaks-rules.toml (lazy singleton)
 *   2. Adapts each rule to JS-compatible regex syntax where possible
 *   3. Skips rules that cannot be adapted (logs count + audit file path on startup)
 *
 * Empirical (RESEARCH §2.2):
 *   ~78 direct + ~105 adapted = ~183 usable; ~39 skipped.
 *   Actual count printed to stderr at startup.
 *
 * The `CompiledGitleaksRule` stores pattern + flags as strings (not a `RegExp` object)
 * because RegExp objects cannot be transferred to worker_threads via workerData
 * serialization. The worker reconstructs the RegExp from pattern + flags.
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'smol-toml'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitleaksAllowlist {
  regexes?: string[]
  paths?: string[]
  stopwords?: string[]
}

export interface CompiledGitleaksRule {
  id: string
  /** JS-compatible regex source string (after adaptation). */
  pattern: string
  /** Regex flags string ('' or 'i'). */
  flags: string
  /** Keywords for pre-filter (all lowercase). Empty array means always run. */
  keywords: string[]
  /** Minimum Shannon entropy of the capture group (optional). */
  entropy?: number
  /** Per-rule allowlists from the gitleaks TOML. */
  allowlists: GitleaksAllowlist[]
  /** Global allowlist from the gitleaks TOML [allowlist] section. */
  globalAllowlist: GitleaksAllowlist
  /** Pre-compiled allowlist regexes (built on first use). Internal. */
  _compiledAllowlistRegexes?: RegExp[]
}

interface GitleaksRule {
  id: string
  description?: string
  regex?: string
  entropy?: number
  keywords?: string[]
  allowlists?: GitleaksAllowlist[]
}

interface GitleaksToml {
  title?: string
  allowlist?: GitleaksAllowlist
  rules: GitleaksRule[]
}

// ---------------------------------------------------------------------------
// adaptGitleaksPattern (RESEARCH §2.2 — locked implementation)
// ---------------------------------------------------------------------------

/**
 * Adapt a gitleaks regex string to a JS-compatible pattern + flags object.
 *
 * Returns `null` if the pattern cannot be adapted (caller must skip/log the rule).
 *
 * Adaptation rules:
 *   - `(?-i:...)` — incompatible: sub-pattern case toggle, not supported in JS → null
 *   - `(?P<name>...)` — incompatible: Python/Go named groups, not supported in JS → null
 *   - `(?i:...)` mid-pattern — incompatible: inline case-group, not supported in JS → null
 *   - `(?i)` prefix only — strip the prefix, add 'i' flag → { pattern: rest, flags: 'i' }
 *   - otherwise — use as-is → { pattern, flags: '' }
 */
export function adaptGitleaksPattern(
  rawRegex: string,
): { pattern: string; flags: string } | null {
  if (!rawRegex) return null
  if (rawRegex.includes('(?-i:') || rawRegex.includes('(?P<')) return null
  if (rawRegex.includes('(?i:')) return null // mid-pattern (?i:) — skip
  if (rawRegex.startsWith('(?i)')) return { pattern: rawRegex.slice(4), flags: 'i' }
  return { pattern: rawRegex, flags: '' }
}

// ---------------------------------------------------------------------------
// loadGitleaksRules — lazy singleton
// ---------------------------------------------------------------------------

let _cachedRules: CompiledGitleaksRule[] | null = null

import { existsSync as _existsSync } from 'node:fs'

/**
 * Resolve the vendor directory relative to this module's location.
 * Works both under tsx (src/) and in the tsup ESM bundle (dist/).
 *
 * Under tsx: src/detect/layer1-regex/ → ../../../vendor/gitleaks-rules.toml
 * Under tsup bundle: dist/ → ../vendor/gitleaks-rules.toml (if vendor is at project root)
 */
function resolveVendorPathSync(): string {
  const thisFile = fileURLToPath(import.meta.url)
  const thisDir = dirname(thisFile)

  const candidates = [
    join(thisDir, '..', '..', '..', 'vendor', 'gitleaks-rules.toml'), // tsx: src/detect/layer1-regex/
    join(thisDir, '..', 'vendor', 'gitleaks-rules.toml'),              // bundle: dist/
    join(thisDir, 'vendor', 'gitleaks-rules.toml'),                    // bundle: if dist/ is at root
  ]

  for (const candidate of candidates) {
    if (_existsSync(candidate)) return candidate
  }
  // Fallback: first candidate (will throw on read if wrong — that's intentional)
  return candidates[0]!
}

/**
 * Load and compile all usable gitleaks rules from the vendored TOML.
 *
 * Lazy singleton: loaded once per process, cached in module scope.
 * Rules that cannot be adapted to JS regex syntax are logged to stderr and skipped.
 *
 * @returns Array of compiled rules (pattern+flags as strings; not RegExp objects).
 */
export function loadGitleaksRules(): CompiledGitleaksRule[] {
  if (_cachedRules !== null) return _cachedRules

  const vendorPath = resolveVendorPathSync()
  const tomlContent = readFileSync(vendorPath, 'utf8')
  const parsed = parse(tomlContent) as GitleaksToml

  const globalAllowlist: GitleaksAllowlist = parsed.allowlist ?? {}
  const skipped: { id: string; reason: string }[] = []
  const compiled: CompiledGitleaksRule[] = []

  for (const rule of parsed.rules ?? []) {
    // Skip rules with no regex field
    if (!rule.regex) {
      skipped.push({ id: rule.id, reason: 'No regex field defined' })
      continue
    }

    const adapted = adaptGitleaksPattern(rule.regex)
    if (adapted === null) {
      // Determine reason for logging
      let reason = 'Adaptation returned null'
      if (rule.regex.includes('(?-i:')) reason = 'Contains (?-i:) sub-pattern case toggle'
      else if (rule.regex.includes('(?P<')) reason = 'Contains (?P<name>) named capture group'
      else if (rule.regex.includes('(?i:')) reason = 'Contains (?i:) mid-pattern inline flag group'
      skipped.push({ id: rule.id, reason })
      continue
    }

    // Validate: try constructing the RegExp to catch POSIX classes [[:alnum:]] etc.
    try {
      new RegExp(adapted.pattern, adapted.flags + 'g') // PERF-03: validation-only compile inside loadGitleaksRules() which is memoized via _cachedRules; never executed after first load.
    } catch (err) {
      skipped.push({
        id: rule.id,
        reason: `RegExp construction failed: ${(err as Error).message.split('\n')[0]}`,
      })
      continue
    }

    compiled.push({
      id: rule.id,
      pattern: adapted.pattern,
      flags: adapted.flags,
      keywords: (rule.keywords ?? []).map((k) => k.toLowerCase()),
      entropy: rule.entropy,
      allowlists: rule.allowlists ?? [],
      globalAllowlist,
    })
  }

  // Log skipped rules count to stderr once on startup
  if (skipped.length > 0) {
    process.stderr.write(
      `[mrclean] gitleaks adapter: ${compiled.length} rules compiled, ` +
        `${skipped.length} skipped (JS-incompatible). ` +
        `See vendor/SKIPPED_GITLEAKS_RULES.md for details.\n`,
    )
  }

  _cachedRules = compiled
  return _cachedRules
}

/**
 * Reset the singleton cache (for testing only).
 * @internal
 */
export function _resetGitleaksRulesCache(): void {
  _cachedRules = null
}
