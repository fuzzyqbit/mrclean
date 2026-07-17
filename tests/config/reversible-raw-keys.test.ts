/**
 * Unit tests for readRawReversibleKeys + SUPPORTED_REVERSIBLE_KEYS
 * (src/config/index.ts — plan 10-04, REVMODE-12 FAIL-loud groundwork).
 *
 * The tolerant validator (validateReversibleConfig) silently DROPS unknown
 * [reversible] keys, so loadEffectiveConfig is structurally blind to them
 * (10-RESEARCH Pitfall 4). readRawReversibleKeys must surface the RAW key
 * list BEFORE validation drops anything, with semantics mirroring
 * readConfigLayer: ENOENT => [], empty => [], malformed => ConfigReadError.
 *
 * Plan 10-04 TDD RED: these tests must fail before implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  readRawReversibleKeys,
  SUPPORTED_REVERSIBLE_KEYS,
  ConfigReadError,
} from '../../src/config/index.js'

describe('readRawReversibleKeys', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `mrclean-raw-keys-test-${randomUUID()}`)
    await mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns both supported keys when [reversible] carries enabled + ttl_hours', async () => {
    // Arrange
    const configPath = join(tmpDir, 'config.toml')
    await writeFile(configPath, '[reversible]\nenabled = true\nttl_hours = 12\n', 'utf8')

    // Act
    const keys = await readRawReversibleKeys(configPath)

    // Assert
    expect(keys).toEqual(['enabled', 'ttl_hours'])
  })

  it('returns an unknown key the tolerant validator would silently drop', async () => {
    // Arrange — the exact silent no-op REVMODE-12 bans: restore_secrets is
    // NOT a supported key, and loadEffectiveConfig would never surface it.
    const configPath = join(tmpDir, 'config.toml')
    await writeFile(configPath, '[reversible]\nrestore_secrets = true\n', 'utf8')

    // Act
    const keys = await readRawReversibleKeys(configPath)

    // Assert
    expect(keys).toEqual(['restore_secrets'])
  })

  it('returns empty array when the file is absent (ENOENT)', async () => {
    const keys = await readRawReversibleKeys(join(tmpDir, 'does-not-exist.toml'))

    expect(keys).toEqual([])
  })

  it('returns empty array when the file is empty', async () => {
    const configPath = join(tmpDir, 'config.toml')
    await writeFile(configPath, '', 'utf8')

    const keys = await readRawReversibleKeys(configPath)

    expect(keys).toEqual([])
  })

  it('returns empty array when other tables exist but no [reversible] table', async () => {
    const configPath = join(tmpDir, 'config.toml')
    await writeFile(
      configPath,
      'dry_run = false\n\n[entropy]\nthreshold = 4.5\nmin_length = 20\n',
      'utf8',
    )

    const keys = await readRawReversibleKeys(configPath)

    expect(keys).toEqual([])
  })

  it('returns empty array when reversible is a non-record scalar value', async () => {
    const configPath = join(tmpDir, 'config.toml')
    await writeFile(configPath, 'reversible = "yes"\n', 'utf8')

    const keys = await readRawReversibleKeys(configPath)

    expect(keys).toEqual([])
  })

  it('throws ConfigReadError on malformed TOML (checkConfigLoad owns that FAIL)', async () => {
    const configPath = join(tmpDir, 'config.toml')
    await writeFile(configPath, '[reversible\n', 'utf8')

    await expect(readRawReversibleKeys(configPath)).rejects.toThrow(ConfigReadError)
  })
})

describe('SUPPORTED_REVERSIBLE_KEYS', () => {
  it('is exactly the frozen two-key supported set {enabled, ttl_hours}', () => {
    expect(SUPPORTED_REVERSIBLE_KEYS).toEqual(['enabled', 'ttl_hours'])
    expect(Object.isFrozen(SUPPORTED_REVERSIBLE_KEYS)).toBe(true)
  })
})
