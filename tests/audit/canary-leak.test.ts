/**
 * Tests for assertNoCanaryLeak — Plan 02-03
 *
 * Proves AUDIT-02: the canary-leak helper correctly detects when a raw secret
 * value appears in the audit log JSONL.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertNoCanaryLeak } from '../../src/audit/canary-leak.js'

const AWS_FIXTURE = 'AKIAIOSFODNN7EXAMPLX'

// Helper to build a valid AuditRecord JSON line (without the raw secret)
function safeRecord(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ts: '2026-05-14T10:00:00.000Z',
    sessionId: 'sess-test',
    hookEvent: 'UserPromptSubmit',
    ruleId: 'AWSAccessKeyID',
    severity: 'CRITICAL',
    action: 'substitute',
    redactedHash: 'dead123456abcdef',
    fingerprint: 'AWSAccessKeyID:dead123456abcdef',
    location: { hookEvent: 'UserPromptSubmit', offset: 5, length: 20 },
    ...extra,
  })
}

describe('assertNoCanaryLeak', () => {
  let tmpDir: string
  let logPath: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mrclean-canary-test-'))
    logPath = join(tmpDir, 'audit.jsonl')
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns ok:true when log file does not exist (ENOENT)', async () => {
    const result = await assertNoCanaryLeak('/nonexistent/path/audit.jsonl', [AWS_FIXTURE])
    expect(result.ok).toBe(true)
    expect(result.leaked).toHaveLength(0)
  })

  it('returns ok:true when log exists but contains no canary strings', async () => {
    await writeFile(logPath, safeRecord() + '\n' + safeRecord({ action: 'audit' }) + '\n')
    const result = await assertNoCanaryLeak(logPath, [AWS_FIXTURE])
    expect(result.ok).toBe(true)
    expect(result.leaked).toHaveLength(0)
  })

  it('returns ok:false with leak details when the AWS fixture string is present', async () => {
    // Deliberately inject the canary into a record (simulating a bad implementation)
    const leakyRecord = JSON.stringify({
      ts: '2026-05-14T10:00:00.000Z',
      sessionId: 'sess-test',
      hookEvent: 'UserPromptSubmit',
      ruleId: 'AWSAccessKeyID',
      severity: 'CRITICAL',
      action: 'substitute',
      // BAD: raw value accidentally included
      value: AWS_FIXTURE,
      redactedHash: 'dead123456abcdef',
      fingerprint: 'AWSAccessKeyID:dead123456abcdef',
      location: { hookEvent: 'UserPromptSubmit', offset: 5, length: 20 },
    })

    await writeFile(logPath, leakyRecord + '\n')

    const result = await assertNoCanaryLeak(logPath, [AWS_FIXTURE])
    expect(result.ok).toBe(false)
    expect(result.leaked).toHaveLength(1)
    expect(result.leaked[0]!.canary).toBe(AWS_FIXTURE)
    expect(result.leaked[0]!.line).toBe(1)
  })

  it('returns ok:false with <malformed> entry when a line cannot be parsed as JSON', async () => {
    await writeFile(logPath, 'not-valid-json\n')
    const result = await assertNoCanaryLeak(logPath, [AWS_FIXTURE])
    expect(result.ok).toBe(false)
    expect(result.leaked[0]!.canary).toBe('<malformed>')
  })

  it('detects only actual leaks when multiple canaries are checked against mixed records', async () => {
    const SAFE_CANARY = 'safe-canary-string-that-never-appears'
    const safeRecord1 = safeRecord()
    const leakyRecord = JSON.stringify({
      ts: '2026-05-14T10:00:00.000Z',
      sessionId: 'sess-test',
      hookEvent: 'PreToolUse',
      ruleId: 'AWSAccessKeyID',
      severity: 'CRITICAL',
      action: 'block',
      value: AWS_FIXTURE, // BAD: leaked
      redactedHash: 'dead123456abcdef',
      fingerprint: 'AWSAccessKeyID:dead123456abcdef',
      location: { hookEvent: 'PreToolUse', offset: 0, length: 20 },
    })

    await writeFile(logPath, safeRecord1 + '\n' + leakyRecord + '\n')

    const result = await assertNoCanaryLeak(logPath, [AWS_FIXTURE, SAFE_CANARY])
    expect(result.ok).toBe(false)
    // Only the AWS canary leaked — SAFE_CANARY did not appear
    const leakedCanaries = result.leaked.map((l) => l.canary)
    expect(leakedCanaries).toContain(AWS_FIXTURE)
    expect(leakedCanaries).not.toContain(SAFE_CANARY)
  })
})
