/**
 * Layer 3 (.env value extraction) for mrclean.
 *
 * At SessionStart, discovers .env* files in the project root (excluding example/sample/template
 * variants), parses them with dotenv.parse() (NEVER dotenv.config()), and adds values to an
 * in-memory blocklist. runLayer3Env() scans source text for exact (case-sensitive) matches.
 *
 * Rule ID: env:literal (locked by CONTEXT §Layer 3 + type-map.ts)
 * Severity: HIGH — env values are typically real secrets opted-in by the operator.
 *
 * Security constraint (T-02-02-01): NEVER call dotenv.config() — that would mutate process.env.
 * The grep gate in acceptance criteria asserts zero occurrences of dotenv.config (non-comment lines).
 *
 * Security constraint (T-02-02-02): NEVER include env-var NAMES or sourceFile paths in findings.
 * The blocklist.meta Map is a private side-channel for audit-log (plan 02-03 consumer) only.
 *
 * OWNED BY PLAN 02-02. Imports Finding/redactedHash/fingerprint from Plan 02-00.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Finding } from './findings.js'
import { redactedHash, fingerprint } from './findings.js'
import { isShapeAllowlisted } from './shape-allowlist.js'
import fastGlob from 'fast-glob'
import { parse as dotenvParse } from 'dotenv'

// ---------------------------------------------------------------------------
// EnvBlocklist type
// ---------------------------------------------------------------------------

/**
 * In-memory session-scoped blocklist loaded from .env* files.
 *
 * `values` — Set of plaintext values for fast O(1) lookup during text scanning.
 * `meta`   — Map from value → source file path (NEVER exposed in Findings;
 *            used by the Plan 02-03 audit log consumer to populate hookEvent location).
 */
export interface EnvBlocklist {
  values: Set<string>
  meta: Map<string, { sourceFile: string }>
}

// ---------------------------------------------------------------------------
// Exclusion glob patterns (RESEARCH §6.3 — locked literal)
// ---------------------------------------------------------------------------

/**
 * Glob patterns for .env files that should NOT contribute to the blocklist.
 * These are example/template/sample files that intentionally contain placeholder values.
 *
 * Pattern notes:
 *   **\/.env.example       - .env.example at any depth
 *   **\/.env.sample        - .env.sample at any depth
 *   **\/.env.template      - .env.template at any depth
 *   **\/.env.*.example     - .env.foo.example at any depth
 *   **\/.env.*.sample      - .env.foo.sample at any depth
 *   **\/.env.*.template    - .env.foo.template at any depth
 */
const ENV_EXCLUDE_GLOBS = [
  '**/.env.example',
  '**/.env.sample',
  '**/.env.template',
  '**/.env.*.example',
  '**/.env.*.sample',
  '**/.env.*.template',
]

/**
 * Boolean literal values that should never be added to the blocklist.
 * These are common non-secret configuration values.
 */
const BOOLEAN_LITERALS = new Set(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])

/**
 * Minimum value length to include in the blocklist.
 * Values shorter than this are too common and would cause too many false positives.
 */
const MIN_VALUE_LENGTH = 8

// ---------------------------------------------------------------------------
// discoverEnvFiles (internal)
// ---------------------------------------------------------------------------

/**
 * Discover .env* files in `cwd` using fast-glob.
 *
 * Pattern `.env{,.local,.*}` matches:
 *   - .env
 *   - .env.local
 *   - .env.foo (any extension)
 *
 * Exclusion globs filter out .env.example/.sample/.template variants.
 *
 * @param cwd - Project root directory to scan.
 * @returns   - Array of absolute file paths (discovered env files).
 */
async function discoverEnvFiles(cwd: string): Promise<string[]> {
  return fastGlob('.env{,.local,.*}', {
    cwd,
    absolute: true,
    dot: true,
    ignore: ENV_EXCLUDE_GLOBS,
  })
}

// ---------------------------------------------------------------------------
// loadEnvBlocklist
// ---------------------------------------------------------------------------

/**
 * Load the env blocklist from .env* files in `cwd` and any additional `secretsFiles`.
 *
 * Algorithm:
 *   1. Discover .env* files (excluding example/sample/template).
 *   2. Add explicitly-specified secretsFiles (no exclusion filter — operator opted in).
 *   3. For each file: parse with dotenv.parse() (NEVER dotenv.config()).
 *   4. Apply skip rules: length < 8, shape-allowlisted, boolean literal.
 *   5. Add surviving values to the blocklist Set and track sourceFile in meta Map.
 *
 * Missing files (ENOENT) are skipped silently.
 *
 * @param opts.cwd          - Project root for .env* discovery.
 * @param opts.secretsFiles - Additional KV-format file paths relative to cwd (DET3-02).
 * @returns                 - EnvBlocklist { values: Set, meta: Map }.
 */
export async function loadEnvBlocklist({
  cwd,
  secretsFiles = [],
}: {
  cwd: string
  secretsFiles?: string[]
}): Promise<EnvBlocklist> {
  const values = new Set<string>()
  const meta = new Map<string, { sourceFile: string }>()

  // Step 1: Discover standard .env* files
  const discovered = await discoverEnvFiles(cwd)

  // Step 2: Add explicit secretsFiles (operator opted in — no exclusion filter)
  const additionalFiles = secretsFiles.map((f) => resolve(cwd, f))

  const allFiles = [...discovered, ...additionalFiles]

  // Step 3: Parse each file and apply skip rules
  for (const filePath of allFiles) {
    let content: string
    try {
      content = await readFile(filePath, 'utf8')
    } catch (err: unknown) {
      // ENOENT or other read errors → skip silently
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw err
    }

    // dotenv.parse() returns { KEY: value } without side effects on process.env
    // NEVER use dotenv.config() — that would mutate process.env (T-02-02-01)
    const parsed = dotenvParse(content)

    for (const value of Object.values(parsed)) {
      if (typeof value !== 'string') continue

      // Skip rule: length < 8 (too short to be a meaningful secret)
      if (value.length < MIN_VALUE_LENGTH) continue

      // Skip rule: shape-allowlisted (UUID, git SHA, MD5/SHA-256, etc.)
      if (isShapeAllowlisted(value)) continue

      // Skip rule: boolean literal (case-insensitive)
      if (BOOLEAN_LITERALS.has(value.toLowerCase())) continue

      // Add to blocklist — first sourceFile wins for the meta Map
      values.add(value)
      if (!meta.has(value)) {
        meta.set(value, { sourceFile: filePath })
      }
    }
  }

  return { values, meta }
}

// ---------------------------------------------------------------------------
// runLayer3Env
// ---------------------------------------------------------------------------

/**
 * Scan `text` for occurrences of any value in the env blocklist.
 *
 * Uses case-sensitive literal substring matching (env values are case-sensitive).
 * Spans already covered by prior layers are skipped.
 *
 * Security note: The finding.value carries the raw match — it must NEVER be logged.
 * The blocklist.meta Map is NOT consulted here; Plan 02-03's audit log writer is
 * the only consumer allowed to access meta (and it must NOT log env-var names — T-02-02-02).
 *
 * @param text         - Source text to scan.
 * @param blocklist    - Env blocklist from loadEnvBlocklist().
 * @param coveredSpans - Spans claimed by prior layers (Layer 1, Layer 2). Skipped.
 * @returns            - Findings sorted by span.start ascending.
 */
export function runLayer3Env(
  text: string,
  blocklist: EnvBlocklist,
  coveredSpans: readonly { start: number; end: number }[] = [],
): Finding[] {
  const findings: Finding[] = []

  for (const value of blocklist.values) {
    let position = 0
    while (position < text.length) {
      const idx = text.indexOf(value, position)
      if (idx === -1) break

      const spanStart = idx
      const spanEnd = idx + value.length

      // Skip if overlaps any covered span
      let covered = false
      for (const span of coveredSpans) {
        if (spanStart < span.end && span.start < spanEnd) {
          covered = true
          break
        }
      }

      if (!covered) {
        const hash = redactedHash(value)
        const fp = fingerprint('env:literal', value)
        findings.push({
          ruleId: 'env:literal',
          severity: 'HIGH',
          span: { start: spanStart, end: spanEnd },
          value,
          redactedHash: hash,
          fingerprint: fp,
          source: 'env',
        })
      }

      position = spanEnd
    }
  }

  // Return sorted by span.start ascending
  return findings.sort((a, b) => a.span.start - b.span.start)
}
