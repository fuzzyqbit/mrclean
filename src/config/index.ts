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
 * Phase 2 migration: Uses `smol-toml` for full TOML 1.1 grammar support.
 * This replaces the Phase 1 hand-rolled minimal parser (parseMinimalToml) which
 * could not handle [[rules]] array-of-tables or [entropy] sub-tables.
 *
 * Merge semantics (RESEARCH §11.4 — CFG-02):
 *   - scalar fields (dry_run): last layer wins
 *   - entropy object: last layer that defines it wins (project-wins for scalars)
 *   - secrets_files array: last layer wins (project wins)
 *   - rules array: last layer wins (operator override vs global)
 *   - allowlist sub-object: each of the 5 string-array axes CONCATENATES across layers
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parse } from 'smol-toml'
import type {
  MrcleanConfig,
  MrcleanAllowlist,
  MrcleanEntropyConfig,
  MrcleanRuleOverride,
} from '../shared/types.js'
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
// Type guards for parsed TOML values
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string')
}

/**
 * Validate and narrow a parsed TOML value to MrcleanEntropyConfig.
 * Throws ConfigReadError if shape is wrong.
 */
function validateEntropyConfig(
  raw: unknown,
  filePath: string,
): MrcleanEntropyConfig {
  if (!isRecord(raw)) {
    throw new ConfigReadError(filePath, '[entropy] must be a TOML sub-table')
  }
  if (typeof raw['threshold'] !== 'number') {
    throw new ConfigReadError(filePath, '[entropy].threshold must be a number')
  }
  if (typeof raw['min_length'] !== 'number') {
    throw new ConfigReadError(filePath, '[entropy].min_length must be a number')
  }
  return { threshold: raw['threshold'], min_length: raw['min_length'] }
}

/**
 * Validate and narrow a parsed TOML array-of-tables to MrcleanRuleOverride[].
 * Throws ConfigReadError if shape is wrong.
 */
function validateRulesArray(
  raw: unknown,
  filePath: string,
): MrcleanRuleOverride[] {
  if (!Array.isArray(raw)) {
    throw new ConfigReadError(filePath, '[[rules]] must be a TOML array-of-tables')
  }

  const VALID_ACTIONS = new Set(['block', 'substitute', 'audit', 'off'])
  const VALID_SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])

  return raw.map((item: unknown, idx: number) => {
    if (!isRecord(item)) {
      throw new ConfigReadError(filePath, `[[rules]][${idx}] must be a table`)
    }
    if (typeof item['id'] !== 'string') {
      throw new ConfigReadError(filePath, `[[rules]][${idx}].id must be a string`)
    }
    if (typeof item['action'] !== 'string' || !VALID_ACTIONS.has(item['action'])) {
      throw new ConfigReadError(
        filePath,
        `[[rules]][${idx}].action must be one of: block, substitute, audit, off`,
      )
    }
    if (typeof item['severity'] !== 'string' || !VALID_SEVERITIES.has(item['severity'])) {
      throw new ConfigReadError(
        filePath,
        `[[rules]][${idx}].severity must be one of: CRITICAL, HIGH, MEDIUM, LOW`,
      )
    }
    return {
      id: item['id'],
      action: item['action'] as MrcleanRuleOverride['action'],
      severity: item['severity'] as MrcleanRuleOverride['severity'],
    }
  })
}

/**
 * Validate and narrow a parsed TOML value to MrcleanAllowlist.
 * All 5 axes are optional; missing axes default to [].
 */
function validateAllowlist(raw: unknown, filePath: string): MrcleanAllowlist {
  if (!isRecord(raw)) {
    throw new ConfigReadError(filePath, '[allowlist] must be a TOML sub-table')
  }

  // Capture the narrowed type for use in the nested helper
  const table: Record<string, unknown> = raw

  function extractStringArray(key: string): string[] {
    const val = table[key]
    if (val === undefined) return []
    if (!isStringArray(val)) {
      throw new ConfigReadError(filePath, `[allowlist].${key} must be a string array`)
    }
    return val
  }

  return {
    rules: extractStringArray('rules'),
    paths: extractStringArray('paths'),
    stopwords: extractStringArray('stopwords'),
    regexes: extractStringArray('regexes'),
    fingerprints: extractStringArray('fingerprints'),
  }
}

// ---------------------------------------------------------------------------
// smol-toml backed parser
// ---------------------------------------------------------------------------

/**
 * Parse a TOML config file using smol-toml.
 *
 * Returns a Partial<MrcleanConfig> containing only the keys present in the file.
 * Missing keys are omitted — mergeConfigs fills gaps from lower-precedence layers.
 *
 * Schema notes:
 *   - `[secrets_files] paths = [...]` is FLATTENED to `secrets_files: string[]`
 *     for ergonomics — consumers see config.secrets_files, not config.secrets_files.paths.
 *   - Unknown top-level keys are silently ignored (forward-compatibility).
 *   - [[rules]] array-of-tables is validated for id/action/severity shape.
 *   - [entropy] sub-table is validated for threshold/min_length types.
 */
function parseToml(content: string, filePath: string): Partial<MrcleanConfig> {
  let parsed: Record<string, unknown>

  try {
    parsed = parse(content) as Record<string, unknown>
  } catch (err) {
    throw new ConfigReadError(filePath, (err as Error).message)
  }

  const result: Partial<MrcleanConfig> = {}

  // dry_run (top-level boolean)
  if ('dry_run' in parsed) {
    if (typeof parsed['dry_run'] !== 'boolean') {
      throw new ConfigReadError(filePath, 'dry_run must be a boolean (true or false)')
    }
    result.dry_run = parsed['dry_run']
  }

  // [entropy] sub-table
  if ('entropy' in parsed) {
    result.entropy = validateEntropyConfig(parsed['entropy'], filePath)
  }

  // [secrets_files] sub-table — FLATTEN: secrets_files.paths → secrets_files
  if ('secrets_files' in parsed) {
    const sf = parsed['secrets_files']
    if (isRecord(sf)) {
      // TOML sub-table: [secrets_files] paths = [...]
      const paths = sf['paths']
      if (paths === undefined) {
        result.secrets_files = []
      } else if (!isStringArray(paths)) {
        throw new ConfigReadError(filePath, '[secrets_files].paths must be a string array')
      } else {
        result.secrets_files = paths
      }
    } else if (isStringArray(sf)) {
      // Bare array form (future-proof): secrets_files = [...]
      result.secrets_files = sf
    } else {
      throw new ConfigReadError(filePath, '[secrets_files] must be a table with paths = [...]')
    }
  }

  // [[rules]] array-of-tables
  if ('rules' in parsed) {
    result.rules = validateRulesArray(parsed['rules'], filePath)
  }

  // [allowlist] sub-table
  if ('allowlist' in parsed) {
    result.allowlist = validateAllowlist(parsed['allowlist'], filePath)
  }

  return result
}

// ---------------------------------------------------------------------------
// Allowlist merge helper
// ---------------------------------------------------------------------------

/**
 * Concatenate each of the 5 allowlist axes from `override` into `base`.
 * Returns a new object (immutable pattern).
 */
function mergeAllowlists(
  base: MrcleanAllowlist,
  override: MrcleanAllowlist,
): MrcleanAllowlist {
  return {
    rules: [...base.rules, ...override.rules],
    paths: [...base.paths, ...override.paths],
    stopwords: [...base.stopwords, ...override.stopwords],
    regexes: [...base.regexes, ...override.regexes],
    fingerprints: [...base.fingerprints, ...override.fingerprints],
  }
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

  return parseToml(content, filePath)
}

/**
 * Field-by-field precedence merge over an ordered list of config layers.
 *
 * Layers are applied left-to-right; later layers override earlier ones.
 * Canonical call: `mergeConfigs(DEFAULT_CONFIG, userLayer, projectLayer)`
 *
 * Merge semantics (RESEARCH §11.4 — CFG-02):
 *   - dry_run, entropy, secrets_files, rules: last layer that defines them wins
 *   - allowlist: each of the 5 string-array axes is CONCATENATED across all layers
 *     (base → user → project → accumulated in order)
 */
export function mergeConfigs(...layers: ReadonlyArray<Partial<MrcleanConfig>>): MrcleanConfig {
  let dryRun: boolean = DEFAULT_CONFIG.dry_run
  let entropy: MrcleanEntropyConfig = DEFAULT_CONFIG.entropy
  let secretsFiles: string[] = Array.from(DEFAULT_CONFIG.secrets_files)
  let rules: MrcleanRuleOverride[] = Array.from(DEFAULT_CONFIG.rules)
  let allowlist: MrcleanAllowlist = { ...DEFAULT_CONFIG.allowlist }

  for (const layer of layers) {
    if (layer.dry_run !== undefined) dryRun = layer.dry_run
    if (layer.entropy !== undefined) entropy = layer.entropy
    if (layer.secrets_files !== undefined) secretsFiles = layer.secrets_files
    if (layer.rules !== undefined) rules = layer.rules
    if (layer.allowlist !== undefined) {
      allowlist = mergeAllowlists(allowlist, layer.allowlist)
    }
  }

  return { dry_run: dryRun, allowlist, entropy, secrets_files: secretsFiles, rules }
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
