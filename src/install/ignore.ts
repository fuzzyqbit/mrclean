/**
 * `mrclean ignore <fingerprint>` — append a fingerprint to the project-local allowlist.
 *
 * CFG-04: Idempotently appends a fingerprint to the [allowlist].fingerprints array
 * in `<cwd>/.mrclean/config.toml`. Creates the file if it does not exist.
 * Preserves all other config fields (dry_run, entropy, rules, other allowlist axes).
 *
 * Security (T-02-05-07): The fingerprint shape regex rejects arbitrary text that
 * could inject TOML. Only `ruleId:16hexchars` format is accepted.
 *
 * smol-toml stringify: Verified available at implementation time (v1.6.1+).
 * Using parse → mutate → stringify for round-trip safety.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'smol-toml'

// ---------------------------------------------------------------------------
// Fingerprint validation
// ---------------------------------------------------------------------------

/**
 * Fingerprint shape: ruleId:16hexchars
 * Allows alphanumerics, underscores, hyphens, and dots in the ruleId portion.
 * The hash portion must be exactly 16 lowercase hexadecimal characters.
 */
const FINGERPRINT_REGEX = /^[a-z0-9:_.-]+:[0-9a-f]{16}$/i

/**
 * Validate that a fingerprint matches the expected shape.
 * Returns true if valid, false if not.
 */
function isValidFingerprint(fingerprint: string): boolean {
  return FINGERPRINT_REGEX.test(fingerprint)
}

// ---------------------------------------------------------------------------
// appendFingerprintToConfig
// ---------------------------------------------------------------------------

/**
 * Append a fingerprint to the [allowlist].fingerprints array in the project
 * config.toml. Creates the file + directory if they do not exist.
 *
 * @param cwd         - Project root directory
 * @param fingerprint - Fingerprint string (ruleId:16hexchars format)
 * @returns           - { added: boolean, path: string }
 *   - added=true: fingerprint was new and was appended
 *   - added=false: fingerprint was already present (idempotent no-op)
 */
export async function appendFingerprintToConfig(
  cwd: string,
  fingerprint: string,
): Promise<{ added: boolean; path: string }> {
  const configPath = join(cwd, '.mrclean', 'config.toml')

  // Read existing config (returns {} if file is missing or empty)
  let rawContent: string
  try {
    rawContent = await readFile(configPath, 'utf8')
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      rawContent = ''
    } else {
      throw err
    }
  }

  // Parse existing TOML (or start with empty object)
  let parsed: Record<string, unknown>
  if (rawContent.trim() === '') {
    parsed = {}
  } else {
    parsed = parse(rawContent) as Record<string, unknown>
  }

  // Extract existing fingerprints
  const allowlist = parsed['allowlist'] as Record<string, unknown> | undefined
  const existingFingerprints: string[] = Array.isArray(allowlist?.['fingerprints'])
    ? (allowlist!['fingerprints'] as string[])
    : []

  // Idempotency check — if already present, no-op
  if (existingFingerprints.includes(fingerprint)) {
    return { added: false, path: configPath }
  }

  // Append new fingerprint (immutable: create new array + new allowlist object)
  const newFingerprints = [...existingFingerprints, fingerprint]
  const newAllowlist = { ...(allowlist ?? {}), fingerprints: newFingerprints }
  const newParsed = { ...parsed, allowlist: newAllowlist }

  // Write the updated config file using smol-toml stringify
  const newContent = stringify(newParsed as Parameters<typeof stringify>[0])

  // Ensure directory exists
  await mkdir(dirname(configPath), { recursive: true })

  // Write atomically via tmp + rename (simplified: direct write for non-critical config)
  // For config.toml we use writeFile directly — the file is operator-owned and the
  // window is tiny. A true atomic write would require a tmp file + fs.rename, but
  // that adds complexity for negligible benefit in a CLI tool.
  await writeFile(configPath, newContent, 'utf8')

  return { added: true, path: configPath }
}

// ---------------------------------------------------------------------------
// runIgnore — CLI action handler
// ---------------------------------------------------------------------------

/**
 * CLI action handler for `mrclean ignore <fingerprint>`.
 *
 * Validates the fingerprint shape, delegates to appendFingerprintToConfig,
 * and prints a one-line success/no-op message to stderr.
 *
 * Exits with code 2 on invalid fingerprint shape (fail-closed CLI behavior).
 */
export async function runIgnore(opts: { fingerprint: string; cwd?: string }): Promise<void> {
  const { fingerprint, cwd = process.cwd() } = opts

  // Validate fingerprint shape (T-02-05-07: TOML injection prevention)
  if (!isValidFingerprint(fingerprint)) {
    process.stderr.write(
      `[mrclean] invalid fingerprint: "${fingerprint}" — expected format: ruleId:16hexchars\n`,
    )
    process.exit(2)
  }

  const result = await appendFingerprintToConfig(cwd, fingerprint)

  if (result.added) {
    process.stderr.write(`[mrclean] added ${fingerprint} to ${result.path}\n`)
  } else {
    process.stderr.write(`[mrclean] already allowlisted: ${fingerprint} (${result.path})\n`)
  }
}
