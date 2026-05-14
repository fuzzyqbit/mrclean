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
})
