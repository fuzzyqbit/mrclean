/**
 * Phase 2 config schema tests — RED state for Task 1.
 *
 * These tests drive the Task 2 implementation:
 *   - smol-toml backed parser (replaces hand-rolled Phase 1 parser)
 *   - Extended MrcleanConfig with entropy, secrets_files, [[rules]]
 *   - Array-concat merge semantics for allowlist arrays (RESEARCH §11.4)
 *
 * Convention: [secrets_files] paths = [...] in TOML is FLATTENED by readConfigLayer
 * to a top-level secrets_files: string[] for ergonomics. Consumers see:
 *   config.secrets_files  (not config.secrets_files.paths)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { readConfigLayer, mergeConfigs, ConfigReadError } from '../../src/config/index.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'
import type { MrcleanAllowlist } from '../../src/shared/types.js'

describe('Phase 2 config schema', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `mrclean-p2-schema-${randomUUID()}`)
    await mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // Test 1: [entropy] sub-table parses into result.entropy
  it('parses dry_run + [entropy] sub-table into MrcleanConfig fields', async () => {
    const configPath = join(tmpDir, 'config.toml')
    await writeFile(configPath, [
      'dry_run = true',
      '',
      '[entropy]',
      'threshold = 4.5',
      'min_length = 20',
    ].join('\n'))

    const result = await readConfigLayer(configPath)
    expect(result.dry_run).toBe(true)
    expect((result as { entropy?: { threshold: number; min_length: number } }).entropy).toEqual({
      threshold: 4.5,
      min_length: 20,
    })
  })

  // Test 2: [[rules]] array-of-tables parses into result.rules array
  it('parses [[rules]] array-of-tables into an array of MrcleanRuleOverride', async () => {
    const configPath = join(tmpDir, 'config.toml')
    await writeFile(configPath, [
      '[[rules]]',
      'id = "AWSAccessKeyID"',
      'action = "block"',
      'severity = "CRITICAL"',
      '',
      '[[rules]]',
      'id = "JWT"',
      'action = "audit"',
      'severity = "HIGH"',
    ].join('\n'))

    const result = await readConfigLayer(configPath)
    const rules = (result as { rules?: Array<{ id: string; action: string; severity: string }> }).rules
    expect(rules).toHaveLength(2)
    expect(rules?.[0]).toEqual({ id: 'AWSAccessKeyID', action: 'block', severity: 'CRITICAL' })
    expect(rules?.[1]).toEqual({ id: 'JWT', action: 'audit', severity: 'HIGH' })
  })

  // Test 3: [secrets_files] paths array is FLATTENED to top-level secrets_files field
  //
  // TOML shape:
  //   [secrets_files]
  //   paths = ["custom.env", "secrets.yml"]
  //
  // readConfigLayer normalises this to: { secrets_files: ["custom.env", "secrets.yml"] }
  // (sub-table paths key is hoisted for ergonomics — no nested object consumers)
  it('flattens [secrets_files] paths sub-table to top-level secrets_files: string[]', async () => {
    const configPath = join(tmpDir, 'config.toml')
    await writeFile(configPath, [
      '[secrets_files]',
      'paths = ["custom.env", "secrets.yml"]',
    ].join('\n'))

    const result = await readConfigLayer(configPath)
    expect((result as { secrets_files?: string[] }).secrets_files).toEqual([
      'custom.env',
      'secrets.yml',
    ])
  })

  // Test 4: full [allowlist] block with all 5 arrays round-trips correctly
  it('parses a full [allowlist] block with all 5 axes populated', async () => {
    const configPath = join(tmpDir, 'config.toml')
    await writeFile(configPath, [
      '[allowlist]',
      'rules = ["RULE-A"]',
      'paths = ["**/dist/**"]',
      'stopwords = ["example-corp"]',
      'regexes = ["\\\\d{4}-\\\\d{4}"]',
      'fingerprints = ["abc123"]',
    ].join('\n'))

    const result = await readConfigLayer(configPath)
    const al = (result as { allowlist?: MrcleanAllowlist }).allowlist
    expect(al?.rules).toEqual(['RULE-A'])
    expect(al?.paths).toEqual(['**/dist/**'])
    expect(al?.stopwords).toEqual(['example-corp'])
    expect(al?.regexes).toEqual(['\\d{4}-\\d{4}'])
    expect(al?.fingerprints).toEqual(['abc123'])
  })

  // Test 5: malformed TOML throws ConfigReadError with .path matching the input filepath
  it('throws ConfigReadError on malformed TOML with .path matching the file path', async () => {
    const configPath = join(tmpDir, 'config.toml')
    // [[rules]] id = is missing a value → invalid TOML
    await writeFile(configPath, '[[rules]]\nid =\n')

    await expect(readConfigLayer(configPath)).rejects.toBeInstanceOf(ConfigReadError)

    try {
      await readConfigLayer(configPath)
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigReadError)
      const configErr = err as ConfigReadError
      expect(configErr.path).toBe(configPath)
      expect(configErr.reason).toBeTruthy()
    }
  })

  // Test 6: mergeConfigs concatenates allowlist.rules across layers (RESEARCH §11.4)
  it('concatenates allowlist array axes across layers', () => {
    const userAllowlist: MrcleanAllowlist = {
      rules: ['A'], paths: [], stopwords: [], regexes: [], fingerprints: [],
    }
    const projAllowlist: MrcleanAllowlist = {
      rules: ['B'], paths: [], stopwords: [], regexes: [], fingerprints: [],
    }

    const result = mergeConfigs(DEFAULT_CONFIG, { allowlist: userAllowlist }, { allowlist: projAllowlist })
    expect(result.allowlist.rules).toEqual(['A', 'B'])
  })

  // Test 7: entropy scalars use highest-precedence-layer-wins (project wins, NOT concat)
  it('lets the last layer win for entropy scalar fields', () => {
    const result = mergeConfigs(
      DEFAULT_CONFIG,
      { entropy: { threshold: 3.0, min_length: 16 } },
      { entropy: { threshold: 4.5, min_length: 20 } },
    )
    expect((result as { entropy?: { threshold: number; min_length: number } }).entropy).toEqual({
      threshold: 4.5,
      min_length: 20,
    })
  })

  // Test 8: mergeConfigs(DEFAULT_CONFIG, {}) populates Phase 2 defaults for every field
  it('populates all Phase 2 defaults when merged with an empty layer', () => {
    const result = mergeConfigs(DEFAULT_CONFIG, {})
    expect((result as { entropy?: { threshold: number; min_length: number } }).entropy).toEqual({
      threshold: 4.5,
      min_length: 20,
    })
    expect((result as { secrets_files?: string[] }).secrets_files).toEqual([])
    expect((result as { rules?: unknown[] }).rules).toEqual([])
  })
})
