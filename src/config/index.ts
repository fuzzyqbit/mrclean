/**
 * Three-layer configuration reader for mrclean.
 *
 * Layer precedence (LOCKED — REQUIREMENTS.md CFG-03):
 *   DEFAULT_CONFIG  <  ~/.mrclean/config.toml  <  ./<cwd>/.mrclean/config.toml
 *
 * Exports:
 *   ConfigReadError     — structured error with path + reason
 *   readConfigLayer     — parse one TOML layer; {} on missing/empty file; throws on malformed
 *   mergeConfigs        — field-by-field precedence merge over ordered layers
 *   loadEffectiveConfig — high-level entry point: resolves all three paths, returns MrcleanConfig
 *   LoadConfigOpts      — options interface for loadEffectiveConfig
 *
 * Phase 1 minimal TOML — Phase 2 swaps in `smol-toml` when DET1-02 requires the
 * full TOML 1.1 grammar (gitleaks rule pack uses multiline strings, dotted keys,
 * inline tables). The Phase 1 grammar accepted here is intentionally restricted to
 * the Phase 1 MrcleanConfig schema surface:
 *
 *   - Blank lines and `# comment` lines are skipped.
 *   - Section headers: `[allowlist]` switches context; other sections tolerated but keys skipped.
 *   - Top-level boolean assignments: `dry_run = true | false`
 *   - Allowlist inline string arrays: `rules = ["a", "b"]`
 *
 * Any unrecognised token in a recognised section causes a ConfigReadError so the
 * operator fixes the file rather than silently inheriting wrong defaults.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { MrcleanConfig, MrcleanAllowlist } from '../shared/types.js'
import { DEFAULT_CONFIG } from './defaults.js'

// ---------------------------------------------------------------------------
// ConfigReadError
// ---------------------------------------------------------------------------

/** Structured error surfaced by readConfigLayer on malformed TOML. */
export class ConfigReadError extends Error {
  constructor(
    public readonly path: string,
    public readonly reason: string,
  ) {
    super(`mrclean config: failed to read ${path}: ${reason}`)
    this.name = 'ConfigReadError'
  }
}

// ---------------------------------------------------------------------------
// Minimal Phase 1 TOML parser internals
// ---------------------------------------------------------------------------

type SectionContext = 'root' | 'allowlist' | 'unknown'

type AllowlistKey = keyof MrcleanAllowlist

const ALLOWLIST_ARRAY_KEYS = new Set<AllowlistKey>([
  'rules', 'paths', 'stopwords', 'regexes', 'fingerprints',
])

/**
 * Parse a boolean literal (`true` or `false`).
 * Returns the boolean value, or `undefined` if the token is not a known boolean.
 */
function parseBoolToken(token: string): boolean | undefined {
  if (token === 'true') return true
  if (token === 'false') return false
  return undefined
}

/**
 * Parse a TOML inline string array: `["value1", "value2"]`.
 * Supports double-quoted or single-quoted strings, comma-separated.
 * Returns string[] on success, undefined if the token is not a valid inline array.
 *
 * Does NOT handle escaped quotes or nested structures — sufficient for Phase 1 schema.
 */
function parseStringArray(token: string): string[] | undefined {
  const trimmed = token.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return undefined

  const inner = trimmed.slice(1, -1).trim()
  if (inner === '') return []

  const items: string[] = []
  for (const part of inner.split(',')) {
    const value = part.trim()
    const isDoubleQuoted = value.startsWith('"') && value.endsWith('"')
    const isSingleQuoted = value.startsWith("'") && value.endsWith("'")
    if (isDoubleQuoted || isSingleQuoted) {
      items.push(value.slice(1, -1))
    } else {
      return undefined  // unrecognised item — not a quoted string
    }
  }
  return items
}

/**
 * Minimal TOML parser scoped to the Phase 1 MrcleanConfig schema.
 *
 * Returns a Partial<MrcleanConfig> containing only the keys present in the file.
 * Missing keys are omitted — mergeConfigs fills gaps from lower-precedence layers.
 *
 * Throws ConfigReadError on any line that cannot be parsed within a recognised section.
 */
function parseMinimalToml(content: string, filePath: string): Partial<MrcleanConfig> {
  const lines = content.split('\n')
  let section: SectionContext = 'root'

  let dryRun: boolean | undefined = undefined
  const allowlistFields: Partial<Record<AllowlistKey, string[]>> = {}

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const raw = lines[i] ?? ''
    const line = raw.trim()

    // Skip blank lines and comment lines in any section.
    if (line === '' || line.startsWith('#')) continue

    // Section header — switch context.
    if (line.startsWith('[')) {
      if (line === '[allowlist]') {
        section = 'allowlist'
      } else {
        // Unknown section (e.g. [words], [detection] from the install stub).
        // Tolerate the header; subsequent key lines will be silently skipped.
        section = 'unknown'
      }
      continue
    }

    // Unknown section: tolerate key=value lines without parsing them.
    // (The install stub has commented-out lines under [words] and [detection],
    //  so we never actually reach here for stub files — but guard for future use.)
    if (section === 'unknown') continue

    // Key = value assignment.
    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) {
      throw new ConfigReadError(filePath, `malformed line ${lineNum}: missing '=' in "${raw}"`)
    }

    const key = line.slice(0, eqIdx).trim()
    const rawValue = line.slice(eqIdx + 1).trim()

    if (section === 'root') {
      if (key === 'dry_run') {
        const boolVal = parseBoolToken(rawValue)
        if (boolVal === undefined) {
          throw new ConfigReadError(
            filePath,
            `malformed line ${lineNum}: dry_run must be true or false, got "${rawValue}"`,
          )
        }
        dryRun = boolVal
      } else {
        throw new ConfigReadError(
          filePath,
          `malformed line ${lineNum}: unknown top-level key "${key}"`,
        )
      }
    } else if (section === 'allowlist') {
      if (!ALLOWLIST_ARRAY_KEYS.has(key as AllowlistKey)) {
        throw new ConfigReadError(
          filePath,
          `malformed line ${lineNum}: unknown allowlist key "${key}"`,
        )
      }
      const arrVal = parseStringArray(rawValue)
      if (arrVal === undefined) {
        throw new ConfigReadError(
          filePath,
          `malformed line ${lineNum}: expected inline string array, got "${rawValue}"`,
        )
      }
      allowlistFields[key as AllowlistKey] = arrVal
    }
  }

  const result: Partial<MrcleanConfig> = {}
  if (dryRun !== undefined) result.dry_run = dryRun

  if (Object.keys(allowlistFields).length > 0) {
    result.allowlist = {
      rules: allowlistFields.rules ?? [],
      paths: allowlistFields.paths ?? [],
      stopwords: allowlistFields.stopwords ?? [],
      regexes: allowlistFields.regexes ?? [],
      fingerprints: allowlistFields.fingerprints ?? [],
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read and parse one configuration layer from `filePath`.
 *
 * - Missing file (ENOENT) → resolves to {} (no overrides — this is normal).
 * - Empty / whitespace-only file → resolves to {} (zero bytes ≡ no overrides).
 * - Valid TOML → returns Partial<MrcleanConfig> with only the keys present in the file.
 * - Malformed TOML → throws ConfigReadError with { path, reason }.
 */
export async function readConfigLayer(filePath: string): Promise<Partial<MrcleanConfig>> {
  let content: string

  try {
    content = await readFile(filePath, 'utf8')
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') return {}
    throw new ConfigReadError(filePath, (err as Error).message)
  }

  if (content.trim() === '') return {}

  return parseMinimalToml(content, filePath)
}

/**
 * Field-by-field precedence merge over an ordered list of config layers.
 *
 * Layers are applied left-to-right; later layers override earlier ones.
 * Canonical call: `mergeConfigs(DEFAULT_CONFIG, userLayer, projectLayer)`
 *
 * `allowlist` sub-object: Phase 1 uses wholesale replacement — the highest-precedence
 * layer that defines `allowlist` wins entirely. Arrays within allowlist are NOT
 * concatenated. Phase 2 may add explicit `_merge` markers to change this behaviour.
 */
export function mergeConfigs(...layers: ReadonlyArray<Partial<MrcleanConfig>>): MrcleanConfig {
  let dryRun: boolean = DEFAULT_CONFIG.dry_run
  let allowlist: MrcleanAllowlist = DEFAULT_CONFIG.allowlist

  for (const layer of layers) {
    if (layer.dry_run !== undefined) dryRun = layer.dry_run
    if (layer.allowlist !== undefined) allowlist = layer.allowlist
  }

  return { dry_run: dryRun, allowlist }
}

/**
 * Options for loadEffectiveConfig — primarily for test injection.
 */
export interface LoadConfigOpts {
  /** Defaults to os.homedir(). Override in tests to avoid touching the real home directory. */
  homeDir?: string
  /** Defaults to process.cwd(). Override in tests for isolated project roots. */
  cwd?: string
}

/**
 * High-level entry point: resolves all three config layers and returns the final MrcleanConfig.
 *
 * Layer paths:
 *   1. DEFAULT_CONFIG (bundled, always present)
 *   2. {homeDir}/.mrclean/config.toml (user-global, optional — missing file is fine)
 *   3. {cwd}/.mrclean/config.toml (project-local, optional — missing file is fine)
 *
 * ConfigReadError from either file layer propagates — Plan 01-05 doctor catches and reports it.
 *
 * Plan 01-05 integration note: call `loadEffectiveConfig({ homeDir, cwd })` inside the
 * doctor `config-load` check. A successful call demonstrates CFG-01 and CFG-03 are satisfied.
 */
export async function loadEffectiveConfig(opts?: LoadConfigOpts): Promise<MrcleanConfig> {
  const resolvedHome = opts?.homeDir ?? homedir()
  const resolvedCwd = opts?.cwd ?? process.cwd()

  const userPath = join(resolvedHome, '.mrclean', 'config.toml')
  const projectPath = join(resolvedCwd, '.mrclean', 'config.toml')

  const userLayer = await readConfigLayer(userPath)
  const projectLayer = await readConfigLayer(projectPath)

  return mergeConfigs(DEFAULT_CONFIG, userLayer, projectLayer)
}
