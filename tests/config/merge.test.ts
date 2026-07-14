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

  // Test 11: Updated for Phase 2: allowlist arrays now CONCAT across layers per RESEARCH §11.4.
  // Phase 1 used wholesale replacement; Phase 2 concatenates so allowlist entries accumulate.
  it('concatenates user and project allowlist arrays across layers', () => {
    const userAllowlist: MrcleanAllowlist = { ...EMPTY_ALLOWLIST, rules: ['USR'] }
    const projAllowlist: MrcleanAllowlist = { ...EMPTY_ALLOWLIST, rules: ['PRJ'] }
    const result = mergeConfigs(
      DEFAULT_CONFIG,
      { allowlist: userAllowlist },
      { allowlist: projAllowlist },
    )
    expect(result.allowlist.rules).toEqual(['USR', 'PRJ'])
  })

  // Test D (Phase 8-01): reversible.enabled merges LAST-WINS across layers.
  // Both directions asserted: false→true discriminates last-wins from "layers ignored"
  // (fails at RED where the seed default false would vacuously satisfy true→false alone);
  // true→false discriminates last-wins from "any-layer-true-wins" at GREEN.
  it('applies LAST-WINS for reversible.enabled across layers', () => {
    // Arrange + Act
    const trueThenFalse = mergeConfigs(
      DEFAULT_CONFIG,
      { reversible: { enabled: true } },
      { reversible: { enabled: false } },
    )
    const falseThenTrue = mergeConfigs(
      DEFAULT_CONFIG,
      { reversible: { enabled: false } },
      { reversible: { enabled: true } },
    )

    // Assert
    expect(trueThenFalse.reversible.enabled).toBe(false)
    expect(falseThenTrue.reversible.enabled).toBe(true)
  })

  // Test E (Phase 8-01): a single layer opting in carries through the merge
  it('carries reversible.enabled=true through the merge from a single layer', () => {
    // Arrange + Act
    const result = mergeConfigs(DEFAULT_CONFIG, { reversible: { enabled: true } })

    // Assert
    expect(result.reversible.enabled).toBe(true)
  })

  // Test F (Phase 8-01, regression guard): absent [reversible] in every layer means the
  // merged config carries the frozen default — absent table == shipped one-way guarantee.
  it('defaults reversible to { enabled: false } when no layer sets it', () => {
    // Arrange + Act
    const result = mergeConfigs(DEFAULT_CONFIG, {}, {})

    // Assert
    expect(result.reversible).toEqual({ enabled: false })
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

  // Test G (Phase 8-07, CR-01 repro): a project-layer [reversible] table carrying only
  // unknown/future keys (the documented Phase-9 forward-compat scenario) must NOT clear
  // the user-layer opt-in. Real TOML files are load-bearing here — the defect lives in
  // the validators, so programmatic mergeConfigs layers cannot reproduce it.
  it('preserves user-layer reversible opt-in when project layer has a partial [reversible] table (CR-01)', async () => {
    // Arrange
    await mkdir(join(tmpHome, '.mrclean'), { recursive: true })
    await writeFile(join(tmpHome, '.mrclean', 'config.toml'), '[reversible]\nenabled = true\n')
    await mkdir(join(tmpCwd, '.mrclean'), { recursive: true })
    await writeFile(join(tmpCwd, '.mrclean', 'config.toml'), '[reversible]\nfuture_key = 1\n')

    // Act
    const result = await loadEffectiveConfig({ homeDir: tmpHome, cwd: tmpCwd })

    // Assert
    expect(result.reversible.enabled).toBe(true)
  })

  // Test H (Phase 8-07, CR-01 repro): a project file that ONLY narrows [pii.regex].entities
  // must not silently disable the user's global PII opt-in (including the SSN/credit-card
  // block actions) nor reset the NER confidence floor.
  it('preserves user-layer PII opt-ins when project layer sets only [pii.regex] (CR-01)', async () => {
    // Arrange
    await mkdir(join(tmpHome, '.mrclean'), { recursive: true })
    await writeFile(
      join(tmpHome, '.mrclean', 'config.toml'),
      '[pii]\nenabled = true\n\n[pii.ner]\nenabled = true\nconfidence = 0.9\n',
    )
    await mkdir(join(tmpCwd, '.mrclean'), { recursive: true })
    await writeFile(join(tmpCwd, '.mrclean', 'config.toml'), '[pii.regex]\nentities = ["email"]\n')

    // Act
    const result = await loadEffectiveConfig({ homeDir: tmpHome, cwd: tmpCwd })

    // Assert — user opt-ins survive the partial project table...
    expect(result.pii.enabled).toBe(true)
    expect(result.pii.ner.enabled).toBe(true)
    expect(result.pii.ner.confidence).toBe(0.9)
    // ...while the project narrowing still applies.
    expect(result.pii.regex.entities).toEqual(['email'])
  })

  // Test K (Phase 8-07, regression guard): default-filling survives its relocation into
  // mergeConfigs — a single layer setting only [pii].enabled still gets every unset
  // field from the bundled defaults, exactly once.
  it('fills defaults exactly once when a single layer sets only [pii].enabled', async () => {
    // Arrange
    await mkdir(join(tmpCwd, '.mrclean'), { recursive: true })
    await writeFile(join(tmpCwd, '.mrclean', 'config.toml'), '[pii]\nenabled = true\n')

    // Act
    const result = await loadEffectiveConfig({ homeDir: tmpHome, cwd: tmpCwd })

    // Assert — the opt-in applies and every unset field carries the bundled default.
    expect(result.pii.enabled).toBe(true)
    expect(result.pii.regex).toEqual(DEFAULT_CONFIG.pii.regex)
    expect(result.pii.ner.model).toBe(DEFAULT_CONFIG.pii.ner.model)
    expect(result.pii.ner.confidence).toBe(DEFAULT_CONFIG.pii.ner.confidence)
  })
})
