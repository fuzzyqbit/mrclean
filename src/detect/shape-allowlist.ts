/**
 * Shape allowlist for mrclean detection layers.
 *
 * Patterns that match well-known non-secret shapes (UUIDs, git SHAs, content hashes,
 * npm/Cargo integrity hashes, base64 image-data headers, MD5/SHA hex digests).
 *
 * These patterns run BEFORE entropy (Layer 2) and dotenv-skip (Layer 3) checks.
 * A value matching any pattern is considered "safe-shaped" and will not be flagged.
 *
 * Patterns locked by RESEARCH §5.2 — do NOT modify without a plan update.
 *
 * OWNED BY PLAN 02-02. Imported by Layer 2 and Layer 3.
 */

// ---------------------------------------------------------------------------
// Shape allowlist patterns (RESEARCH §5.2 — locked literal)
// ---------------------------------------------------------------------------

/**
 * Frozen array of RegExp patterns for known non-secret shapes.
 *
 * Order matters for documentation clarity; all are tested independently.
 *
 * Pattern inventory:
 *   [0] UUID v4/v7 — 8-4-4-4-12 hex groups
 *   [1] git SHA-1 — exactly 40 lowercase hex chars
 *   [2] SHA-256 hex — exactly 64 lowercase hex chars
 *   [3] MD5 hex — exactly 32 lowercase hex chars
 *   [4] npm/Cargo integrity hash — sha<digits>- prefix + base64 body
 *   [5] base64 image-data header — data:image/ prefix
 *   [6] short git SHA — exactly 7 hex chars (used in git log --abbrev)
 */
export const SHAPE_ALLOWLIST_PATTERNS: readonly RegExp[] = Object.freeze([
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID v4/v7
  /^[0-9a-f]{40}$/i, // git SHA-1 (40 hex)
  /^[0-9a-f]{64}$/i, // SHA-256 hex (64 chars)
  /^[0-9a-f]{32}$/i, // MD5 hex (32 chars)
  /^sha\d+-[A-Za-z0-9+/]+=*$/, // npm/Cargo integrity hash
  /^data:image\//, // base64 image-data header
  /^[0-9a-f]{7}$/i, // short git SHA (7 chars)
])

// ---------------------------------------------------------------------------
// isShapeAllowlisted
// ---------------------------------------------------------------------------

/**
 * Check whether `value` matches any of the locked shape-allowlist patterns.
 *
 * Returns `true` if the value should be suppressed by the shape allowlist.
 * This check must run BEFORE entropy or skip-rule evaluation.
 *
 * @param value - The candidate string to test (full token value).
 * @returns     - `true` if value matches a known non-secret shape; `false` otherwise.
 */
export function isShapeAllowlisted(value: string): boolean {
  for (const pattern of SHAPE_ALLOWLIST_PATTERNS) {
    if (pattern.test(value)) return true
  }
  return false
}
