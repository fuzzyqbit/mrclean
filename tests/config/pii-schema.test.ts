/**
 * PII config schema tests — drives Task 1 (types + defaults) and Task 2 (parser + merge).
 *
 * TDD flow:
 *   RED:   write these tests against the existing code → they fail (PII surface absent)
 *   GREEN: add MrcleanPiiConfig, pii defaults, validatePiiConfig, parseToml [pii] branch,
 *          mergeConfigs pii merge → tests pass
 *
 * Plan: 04-02
 * Requirements: PII-03 (OFF by default, per-entity action policy, expressible entity toggles)
 * Threat: T-04-02-01 (absent-[pii] == byte-identical v1), T-04-02-02 (actions validate to set)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'
import { readConfigLayer, mergeConfigs, ConfigReadError } from '../../src/config/index.js'
import type { MrcleanConfig } from '../../src/shared/types.js'

// ---------------------------------------------------------------------------
// Task 1 tests: DEFAULT_CONFIG.pii shape + deep-frozen invariant
// ---------------------------------------------------------------------------

describe('DEFAULT_CONFIG.pii — Task 1: shape and frozen invariant', () => {
  it('master switch is off by default (pii.enabled === false)', () => {
    expect(DEFAULT_CONFIG.pii.enabled).toBe(false)
  })

  it('regex sub-table: enabled=true, entities matches the locked 5-element list', () => {
    expect(DEFAULT_CONFIG.pii.regex.enabled).toBe(true)
    expect(DEFAULT_CONFIG.pii.regex.entities).toEqual([
      'email',
      'ssn',
      'credit_card',
      'phone',
      'ip',
    ])
  })

  it('ner sub-table: enabled=false, model=Xenova/bert-base-NER, dtype=int8, confidence=0.9, allowDownload=true, warmOnBoot=false', () => {
    expect(DEFAULT_CONFIG.pii.ner.enabled).toBe(false)
    expect(DEFAULT_CONFIG.pii.ner.model).toBe('Xenova/bert-base-NER')
    expect(DEFAULT_CONFIG.pii.ner.dtype).toBe('int8')
    expect(DEFAULT_CONFIG.pii.ner.confidence).toBe(0.9)
    expect(DEFAULT_CONFIG.pii.ner.allowDownload).toBe(true)
    expect(DEFAULT_CONFIG.pii.ner.warmOnBoot).toBe(false)
    expect(DEFAULT_CONFIG.pii.ner.entities).toEqual(['PERSON', 'ORG', 'LOC'])
  })

  it('per-entity actions: checksum entities (ssn, credit_card) default to block', () => {
    expect(DEFAULT_CONFIG.pii.regex.actions['ssn']).toBe('block')
    expect(DEFAULT_CONFIG.pii.regex.actions['credit_card']).toBe('block')
  })

  it('per-entity actions: non-checksum regex entities default to warn or audit', () => {
    expect(['warn', 'audit']).toContain(DEFAULT_CONFIG.pii.regex.actions['email'])
    expect(['warn', 'audit']).toContain(DEFAULT_CONFIG.pii.regex.actions['phone'])
    expect(['warn', 'audit']).toContain(DEFAULT_CONFIG.pii.regex.actions['ip'])
  })

  it('NER actions: PERSON and ORG default to warn, LOC defaults to audit', () => {
    expect(DEFAULT_CONFIG.pii.ner.actions['PERSON']).toBe('warn')
    expect(DEFAULT_CONFIG.pii.ner.actions['ORG']).toBe('warn')
    expect(DEFAULT_CONFIG.pii.ner.actions['LOC']).toBe('audit')
  })

  it('DEFAULT_CONFIG.pii is deeply Object.frozen — mutation throws in strict mode', () => {
    expect(() => {
      ;(DEFAULT_CONFIG as unknown as Record<string, unknown>)['pii'] = {}
    }).toThrow()

    expect(() => {
      ;(DEFAULT_CONFIG.pii as unknown as Record<string, unknown>)['enabled'] = true
    }).toThrow()

    expect(() => {
      ;(DEFAULT_CONFIG.pii.regex as unknown as Record<string, unknown>)['enabled'] = false
    }).toThrow()

    expect(() => {
      DEFAULT_CONFIG.pii.regex.entities.push('extra')
    }).toThrow()

    expect(() => {
      DEFAULT_CONFIG.pii.ner.entities.push('MISC')
    }).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Task 2 tests: readConfigLayer [pii] branch + mergeConfigs pii merge
// ---------------------------------------------------------------------------

describe('readConfigLayer [pii] sub-table — Task 2: parse + validate', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `mrclean-pii-schema-${randomUUID()}`)
    await mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('parses a full [pii]/[pii.regex]/[pii.ner] table and returns it in the Partial', async () => {
    const configPath = join(tmpDir, 'config.toml')
    await writeFile(
      configPath,
      [
        '[pii]',
        'enabled = true',
        '',
        '[pii.regex]',
        'enabled = true',
        'entities = ["email", "ssn"]',
        '',
        '[pii.ner]',
        'enabled = false',
        'model = "Xenova/bert-base-NER"',
        'dtype = "int8"',
        'entities = ["PERSON"]',
        'confidence = 0.8',
        'allowDownload = true',
        'warmOnBoot = false',
      ].join('\n'),
    )

    const result = await readConfigLayer(configPath)
    const pii = (result as Partial<MrcleanConfig>).pii
    expect(pii).toBeDefined()
    expect(pii!.enabled).toBe(true)
    expect(pii!.regex.enabled).toBe(true)
    expect(pii!.regex.entities).toEqual(['email', 'ssn'])
    expect(pii!.ner.enabled).toBe(false)
    expect(pii!.ner.confidence).toBe(0.8)
    expect(pii!.ner.entities).toEqual(['PERSON'])
  })

  it('a config file with NO [pii] table produces a Partial with pii undefined', async () => {
    const configPath = join(tmpDir, 'config.toml')
    await writeFile(configPath, 'dry_run = false\n')

    const result = await readConfigLayer(configPath)
    expect((result as Partial<MrcleanConfig>).pii).toBeUndefined()
  })

  it('absent [pii] == v1 guarantee: mergeConfigs(DEFAULT_CONFIG, {}, {}) deep-equals DEFAULT_CONFIG', () => {
    const merged = mergeConfigs(DEFAULT_CONFIG, {}, {})

    // The whole merged config (including pii) must equal DEFAULT_CONFIG
    expect(merged.dry_run).toBe(DEFAULT_CONFIG.dry_run)
    expect(merged.entropy).toEqual(DEFAULT_CONFIG.entropy)
    expect(merged.secrets_files).toEqual(DEFAULT_CONFIG.secrets_files)
    expect(merged.rules).toEqual(DEFAULT_CONFIG.rules)
    expect(merged.allowlist).toEqual(DEFAULT_CONFIG.allowlist)
    expect(merged.pii.enabled).toBe(DEFAULT_CONFIG.pii.enabled)
    expect(merged.pii.regex.enabled).toBe(DEFAULT_CONFIG.pii.regex.enabled)
    expect(merged.pii.regex.entities).toEqual(DEFAULT_CONFIG.pii.regex.entities)
    expect(merged.pii.ner.enabled).toBe(DEFAULT_CONFIG.pii.ner.enabled)
    expect(merged.pii.ner.model).toBe(DEFAULT_CONFIG.pii.ner.model)
    expect(merged.pii.ner.confidence).toBe(DEFAULT_CONFIG.pii.ner.confidence)
  })

  it('malformed [pii]: pii.ner.confidence as string throws ConfigReadError naming the key', async () => {
    const configPath = join(tmpDir, 'config.toml')
    await writeFile(
      configPath,
      [
        '[pii]',
        'enabled = true',
        '[pii.ner]',
        'enabled = false',
        'model = "Xenova/bert-base-NER"',
        'dtype = "int8"',
        'entities = ["PERSON"]',
        'confidence = "high"',
        'allowDownload = true',
        'warmOnBoot = false',
      ].join('\n'),
    )

    await expect(readConfigLayer(configPath)).rejects.toBeInstanceOf(ConfigReadError)

    try {
      await readConfigLayer(configPath)
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigReadError)
      const e = err as ConfigReadError
      expect(e.reason).toMatch(/confidence/)
    }
  })

  it('invalid per-entity action value throws ConfigReadError listing valid set', async () => {
    const configPath = join(tmpDir, 'config.toml')
    await writeFile(
      configPath,
      [
        '[pii]',
        'enabled = true',
        '[pii.regex]',
        'enabled = true',
        'entities = ["ssn"]',
        '[pii.regex.actions]',
        'ssn = "redact"',
      ].join('\n'),
    )

    await expect(readConfigLayer(configPath)).rejects.toBeInstanceOf(ConfigReadError)

    try {
      await readConfigLayer(configPath)
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigReadError)
      const e = err as ConfigReadError
      // Error must mention the valid set {block, warn, audit}
      expect(e.reason).toMatch(/block|warn|audit/)
    }
  })
})

describe('mergeConfigs pii merge — Task 2: last-wins semantics', () => {
  it('last-wins entity narrowing: project ["email"] beats default 5-entity list', () => {
    const result = mergeConfigs(DEFAULT_CONFIG, {
      pii: {
        ...DEFAULT_CONFIG.pii,
        enabled: true,
        regex: {
          ...DEFAULT_CONFIG.pii.regex,
          entities: ['email'],
        },
      },
    })
    expect(result.pii.regex.entities).toEqual(['email'])
  })

  it('last-wins for pii.enabled: project true wins over default false', () => {
    const result = mergeConfigs(
      DEFAULT_CONFIG,
      {},
      {
        pii: {
          ...DEFAULT_CONFIG.pii,
          enabled: true,
        },
      },
    )
    expect(result.pii.enabled).toBe(true)
  })

  it('deep-merge: a layer setting only pii.regex.entities does NOT wipe pii.ner', () => {
    const result = mergeConfigs(DEFAULT_CONFIG, {
      pii: {
        ...DEFAULT_CONFIG.pii,
        regex: {
          ...DEFAULT_CONFIG.pii.regex,
          entities: ['email'],
        },
      },
    })
    // NER settings must survive unchanged
    expect(result.pii.ner.model).toBe(DEFAULT_CONFIG.pii.ner.model)
    expect(result.pii.ner.confidence).toBe(DEFAULT_CONFIG.pii.ner.confidence)
    expect(result.pii.ner.entities).toEqual(DEFAULT_CONFIG.pii.ner.entities)
  })

  it('pii entities arrays use last-wins (NOT concat) unlike allowlist', () => {
    const layerA = {
      pii: {
        ...DEFAULT_CONFIG.pii,
        regex: {
          ...DEFAULT_CONFIG.pii.regex,
          entities: ['email', 'ssn'],
        },
      },
    }
    const layerB = {
      pii: {
        ...DEFAULT_CONFIG.pii,
        regex: {
          ...DEFAULT_CONFIG.pii.regex,
          entities: ['phone'],
        },
      },
    }

    const result = mergeConfigs(DEFAULT_CONFIG, layerA, layerB)
    // last-wins → only ['phone'], NOT ['email', 'ssn', 'phone']
    expect(result.pii.regex.entities).toEqual(['phone'])
  })
})
