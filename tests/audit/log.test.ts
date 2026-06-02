/**
 * Tests for writeAuditRecord + findingToAuditRecord — Plan 02-03
 *
 * Covers AUDIT-01 (JSONL record with all locked fields) and
 * AUDIT-02 (no raw secret value in the log).
 */

import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AuditWriteError,
  findingToAuditRecord,
  writeAuditRecord,
  type AuditRecord,
} from '../../src/audit/log.js'
import type { Finding } from '../../src/detect/findings.js'

// Helper to build a minimal Finding for tests
function makeFinding(value: string, overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'AWSAccessKeyID',
    severity: 'CRITICAL',
    span: { start: 10, end: 30 },
    value,
    redactedHash: 'aaaaaaaaaaaaaaaa',
    fingerprint: `AWSAccessKeyID:aaaaaaaaaaaaaaaa`,
    source: 'secretlint',
    ...overrides,
  }
}

// Helper to build a complete AuditRecord for tests
function makeRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    ts: new Date().toISOString(),
    sessionId: 'test-session-id',
    hookEvent: 'UserPromptSubmit',
    ruleId: 'AWSAccessKeyID',
    severity: 'CRITICAL',
    action: 'substitute',
    redactedHash: 'aaaaaaaaaaaaaaaa',
    fingerprint: 'AWSAccessKeyID:aaaaaaaaaaaaaaaa',
    location: { hookEvent: 'UserPromptSubmit', offset: 10, length: 20 },
    ...overrides,
  }
}

describe('writeAuditRecord', () => {
  let tmpDir: string
  let mrcleanDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mrclean-audit-test-'))
    mrcleanDir = join(tmpDir, '.mrclean')
    await mkdir(mrcleanDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('round-trips: write then read a record and it equals the input', async () => {
    const record = makeRecord()
    await writeAuditRecord(tmpDir, record)

    const content = await readFile(join(mrcleanDir, 'audit.jsonl'), 'utf8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(1)

    const parsed = JSON.parse(lines[0]!)
    expect(parsed).toEqual(record)
  })

  it('appends sequentially: N writes produce N lines', async () => {
    const records = [
      makeRecord({ ruleId: 'AWSAccessKeyID', redactedHash: 'aabbccddaabbccdd', fingerprint: 'AWSAccessKeyID:aabbccddaabbccdd' }),
      makeRecord({ ruleId: 'GitHubPersonalAccessToken', severity: 'HIGH', redactedHash: 'bbccddeebbccddee', fingerprint: 'GitHubPersonalAccessToken:bbccddeebbccddee' }),
      makeRecord({ ruleId: 'entropy:high', severity: 'MEDIUM', action: 'audit', redactedHash: 'ccddeeffccddeeff', fingerprint: 'entropy:high:ccddeeffccddeeff' }),
    ]

    for (const record of records) {
      await writeAuditRecord(tmpDir, record)
    }

    const content = await readFile(join(mrcleanDir, 'audit.jsonl'), 'utf8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(3)
  })

  it('each line ends with \\n and is valid JSON', async () => {
    await writeAuditRecord(tmpDir, makeRecord())
    await writeAuditRecord(tmpDir, makeRecord({ action: 'audit' }))

    const content = await readFile(join(mrcleanDir, 'audit.jsonl'), 'utf8')
    expect(content.endsWith('\n')).toBe(true)

    const lines = content.split('\n').filter(Boolean)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it('throws AuditWriteError when .mrclean/ directory does not exist', async () => {
    const nonExistentCwd = join(tmpdir(), 'mrclean-nonexistent-' + Date.now())
    await expect(writeAuditRecord(nonExistentCwd, makeRecord())).rejects.toThrow(AuditWriteError)
  })

  it('findingToAuditRecord excludes raw secret value (AUDIT-02 enforcement)', () => {
    const secretValue = 'AKIAIOSFODNN7EXAMPLX'
    const finding = makeFinding(secretValue, {
      ruleId: 'AWSAccessKeyID',
      severity: 'CRITICAL',
      span: { start: 5, end: 25 },
      redactedHash: 'dead123456abcdef',
      fingerprint: 'AWSAccessKeyID:dead123456abcdef',
    })

    const record = findingToAuditRecord(finding, 'sess-001', 'UserPromptSubmit', 'substitute')
    const serialised = JSON.stringify(record)

    // The raw secret must NOT appear in the serialised record
    expect(serialised).not.toContain(secretValue)
  })

  it('findingToAuditRecord produces correct location offset and length', () => {
    const finding = makeFinding('somesecret', {
      span: { start: 7, end: 17 },
    })

    const record = findingToAuditRecord(finding, 'sess-001', 'PreToolUse', 'block')

    expect(record.location.offset).toBe(7)
    expect(record.location.length).toBe(10)
    expect(record.location.hookEvent).toBe('PreToolUse')
  })

  // Test: AuditRecord accepts optional engine/model_rev/quant/backend fields
  it('AuditRecord type accepts optional provenance fields engine/model_rev/quant/backend', () => {
    const record: AuditRecord = makeRecord({
      engine: 'pii-ner@abc1234',
      model_rev: 'abc1234def5678',
      quant: 'int8',
      backend: 'onnxruntime-node',
    })

    expect(record.engine).toBe('pii-ner@abc1234')
    expect(record.model_rev).toBe('abc1234def5678')
    expect(record.quant).toBe('int8')
    expect(record.backend).toBe('onnxruntime-node')
  })

  // Test: findingToAuditRecord without provenance — backward-compatible (no provenance fields)
  it('findingToAuditRecord without provenance produces record byte-identical to v1 (no engine/model_rev/quant/backend)', () => {
    const finding = makeFinding('secret-value')
    const record = findingToAuditRecord(finding, 'sess-001', 'UserPromptSubmit', 'substitute')

    expect(record.engine).toBeUndefined()
    expect(record.model_rev).toBeUndefined()
    expect(record.quant).toBeUndefined()
    expect(record.backend).toBeUndefined()
    // Core fields present
    expect(record.ruleId).toBe('AWSAccessKeyID')
    expect(record.sessionId).toBe('sess-001')
    expect(record.action).toBe('substitute')
  })

  // Test: findingToAuditRecord WITH provenance includes engine/model_rev/quant/backend
  it('findingToAuditRecord with provenance includes provenance fields and still omits raw value', () => {
    const finding = makeFinding('super-secret', {
      ruleId: 'pii:PERSON',
      source: 'pii-ner',
    })
    const provenance = { engine: 'pii-ner@sha1234', model_rev: 'sha1234', quant: 'int8', backend: 'onnxruntime-node' }
    const record = findingToAuditRecord(finding, 'sess-002', 'UserPromptSubmit', 'audit', provenance)

    expect(record.engine).toBe('pii-ner@sha1234')
    expect(record.model_rev).toBe('sha1234')
    expect(record.quant).toBe('int8')
    expect(record.backend).toBe('onnxruntime-node')
    // Must not contain raw value
    const serialised = JSON.stringify(record)
    expect(serialised).not.toContain('super-secret')
  })

  // Regression (CR-01): an over-shaped provenance object must NOT leak extra keys.
  // TS structural typing lets a caller pass an object carrying `value` (raw PII)
  // through the FindingProvenance param. findingToAuditRecord destructure-picks the
  // four model-identity keys, so a blind spread can never serialise the extra field.
  it('findingToAuditRecord does not serialise extra keys from an over-shaped provenance object (CR-01)', () => {
    const finding = makeFinding('unused', { ruleId: 'pii:PERSON', source: 'pii-ner' })
    const overShaped = {
      engine: 'pii-ner@sha1234',
      model_rev: 'sha1234',
      quant: 'int8',
      backend: 'onnxruntime-node',
      value: 'LEAKED_PII_VALUE',
    } as unknown as Parameters<typeof findingToAuditRecord>[4]
    const record = findingToAuditRecord(finding, 'sess-cr01', 'UserPromptSubmit', 'audit', overShaped)

    expect((record as Record<string, unknown>).value).toBeUndefined()
    expect(JSON.stringify(record)).not.toContain('LEAKED_PII_VALUE')
    // Allowed provenance keys still pass through
    expect(record.engine).toBe('pii-ner@sha1234')
    expect(record.backend).toBe('onnxruntime-node')
  })

  // Test: no-raw rule holds for PII — a finding with SSN/email value produces no raw text in record
  it('findingToAuditRecord never serialises raw PII value (SSN test)', () => {
    const ssnValue = '123-45-6789'
    const finding = makeFinding(ssnValue, {
      ruleId: 'pii:ssn',
      source: 'pii-regex',
    })

    const record = findingToAuditRecord(finding, 'sess-003', 'PreToolUse', 'block')
    const serialised = JSON.stringify(record)

    expect(serialised).not.toContain(ssnValue)
  })

  it('findingToAuditRecord never serialises raw PII value (email test)', () => {
    const emailValue = 'john.doe@example.com'
    const finding = makeFinding(emailValue, {
      ruleId: 'pii:email',
      source: 'pii-regex',
    })

    const record = findingToAuditRecord(finding, 'sess-004', 'UserPromptSubmit', 'substitute')
    const serialised = JSON.stringify(record)

    expect(serialised).not.toContain(emailValue)
  })
})
