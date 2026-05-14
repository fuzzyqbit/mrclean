/**
 * Unit tests for mergeConfigs and loadEffectiveConfig.
 *
 * Covers: defaults-only, user override, project override wins over user,
 * user-only allowlist, project allowlist replaces user, integration end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { MrcleanAllowlist } from '../../src/shared/types.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'
import { mergeConfigs, loadEffectiveConfig } from '../../src/config/index.js'

const EMPTY_ALLOWLIST: MrcleanAllowlist = {
  rules: [],
  paths: [],
  stopwords: [],
  regexes: [],
  fingerprints: [],
}

describe('mergeConfigs', () => {
  // Test 7: defaults only returns DEFAULT_CONFIG
  it('returns DEFAULT_CONFIG unchanged when given only the defaults layer', () => {
    const result = mergeConfigs(DEFAULT_CONFIG)
    expect(result.dry_run).toBe(DEFAULT_CONFIG.dry_run)
    expect(result.allowlist).toEqual(DEFAULT_CONFIG.allowlist)
  })

  // Test 8: user override wins over defaults
  it('applies user-layer dry_run override', () => {
    const result = mergeConfigs(DEFAULT_CONFIG, { dry_run: true })
    expect(result.dry_run).toBe(true)
    expect(result.allowlist).toEqual(DEFAULT_CONFIG.allowlist)
  })

  // Test 9: project override wins over user
  it('lets project layer dry_run=false beat user layer dry_run=true', () => {
    const result = mergeConfigs(DEFAULT_CONFIG, { dry_run: true }, { dry_run: false })
    expect(result.dry_run).toBe(false)
  })

  // Test 10: user-only allowlist survives when project layer is empty
  it('preserves user-layer allowlist when project layer does not override', () => {
    const userAllowlist: MrcleanAllowlist = { ...EMPTY_ALLOWLIST, rules: ['USR'] }
    const result = mergeConfigs(DEFAULT_CONFIG, { allowlist: userAllowlist }, {})
    expect(result.allowlist.rules).toEqual(['USR'])
  })

  // Test 11: project allowlist replaces user allowlist wholesale (Phase 1 simplification)
  it('replaces user allowlist wholesale when project layer provides its own allowlist', () => {
    const userAllowlist: MrcleanAllowlist = { ...EMPTY_ALLOWLIST, rules: ['USR'] }
    const projAllowlist: MrcleanAllowlist = { ...EMPTY_ALLOWLIST, rules: ['PRJ'] }
    const result = mergeConfigs(
      DEFAULT_CONFIG,
      { allowlist: userAllowlist },
      { allowlist: projAllowlist },
    )
    expect(result.allowlist.rules).toEqual(['PRJ'])
  })
})

describe('loadEffectiveConfig', () => {
  let tmpHome: string
  let tmpCwd: string

  beforeEach(async () => {
    const id = randomUUID()
    tmpHome = join(tmpdir(), `mrclean-home-${id}`)
    tmpCwd = join(tmpdir(), `mrclean-cwd-${id}`)
    await mkdir(tmpHome, { recursive: true })
    await mkdir(tmpCwd, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true })
    await rm(tmpCwd, { recursive: true, force: true })
  })

  // Test 12: project-local dry_run beats user-global dry_run
  it('returns project-local dry_run=false when user-global sets dry_run=true', async () => {
    await mkdir(join(tmpHome, '.mrclean'), { recursive: true })
    await writeFile(join(tmpHome, '.mrclean', 'config.toml'), 'dry_run = true\n')
    await mkdir(join(tmpCwd, '.mrclean'), { recursive: true })
    await writeFile(join(tmpCwd, '.mrclean', 'config.toml'), 'dry_run = false\n')

    const result = await loadEffectiveConfig({ homeDir: tmpHome, cwd: tmpCwd })
    expect(result.dry_run).toBe(false)
  })

  // Test 13: no config files at all → returns DEFAULT_CONFIG shape
  it('returns DEFAULT_CONFIG structure when neither home nor cwd has .mrclean/', async () => {
    const result = await loadEffectiveConfig({ homeDir: tmpHome, cwd: tmpCwd })
    expect(result.dry_run).toBe(DEFAULT_CONFIG.dry_run)
    expect(result.allowlist).toEqual(DEFAULT_CONFIG.allowlist)
  })
})
