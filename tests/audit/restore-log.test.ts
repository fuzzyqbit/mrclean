/**
 * Tests for the hash-only restore audit record — Plan 10-03 (REVMODE-09)
 *
 * Locks four contracts:
 *   1. Builder shape — buildRestoreAuditRecord emits EXACTLY the 7 declared keys,
 *      copies counts field-by-field, and cannot serialise raw originals even when
 *      handed an over-shaped input object (CR-01 never-blind-spread lesson).
 *   2. Writer discipline — one '\n'-terminated JSONL line per call, O_APPEND,
 *      AuditWriteError with the `mrclean install` hint when .mrclean/ is missing.
 *   3. Aggregator totals — action:'restore' lines summed across a heterogeneous
 *      stream (hook AuditRecord lines coexist in the same audit.jsonl); missing
 *      file yields zeros; malformed or tampered lines are skipped, never thrown.
 *   4. Leak invariant — a written record carries 16-hex hashes only; the raw
 *      original never reaches disk; assertNoCanaryLeak passes unchanged over the
 *      mixed record stream.
 */

import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  aggregateRestoreCounters,
  buildRestoreAuditRecord,
  writeRestoreAuditRecord,
  type RestoreAuditRecord,
} from '../../src/audit/restore-log.js'
import { AuditWriteError, type AuditRecord } from '../../src/audit/log.js'
import { assertNoCanaryLeak } from '../../src/audit/canary-leak.js'
import { redactedHash } from '../../src/detect/findings.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HASH_A = 'a1a1a1a1a1a1a1a1'
const HASH_B = 'b2b2b2b2b2b2b2b2'

function makeInput(
  overrides: Partial<Parameters<typeof buildRestoreAuditRecord>[0]> = {},
): Parameters<typeof buildRestoreAuditRecord>[0] {
  return {
    sessionScope: 'all',
    restored: 2,
    unmatched: 1,
    skippedSecret: 1,
    hashes: [HASH_A, HASH_B],
    ...overrides,
  }
}

/**
 * Minimal valid hook-style AuditRecord (log.ts LOCKED unions) for the
 * heterogeneous fixture. Its `action` is a hook value ('substitute'), never
 * 'restore' — the aggregator must exclude it on the discriminant.
 */
function makeHookRecord(): AuditRecord {
  return {
    ts: '2026-07-17T00:00:00.000Z',
    sessionId: 'sess-hook-fixture',
    hookEvent: 'UserPromptSubmit',
    ruleId: 'AWSAccessKeyID',
    severity: 'CRITICAL',
    action: 'substitute',
    redactedHash: 'ccddeeff00112233',
    fingerprint: 'AWSAccessKeyID:ccddeeff00112233',
    location: { hookEvent: 'UserPromptSubmit', offset: 0, length: 20 },
  }
}

/** Hand-built restore-style JSONL line with controllable (possibly tampered) counters. */
function makeRestoreLine(restored: unknown, unmatched: unknown): string {
  return JSON.stringify({
    ts: '2026-07-17T00:00:01.000Z',
    action: 'restore',
    sessionScope: 'all',
    restored,
    unmatched,
    skippedSecret: 0,
    hashes: [HASH_A],
  })
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('restore-log', () => {
  let cwd: string
  let bareCwd: string
  let auditPath: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'mrclean-restore-log-'))
    await mkdir(join(cwd, '.mrclean'))
    auditPath = join(cwd, '.mrclean', 'audit.jsonl')
    // Second cwd WITHOUT .mrclean/ — for the AuditWriteError + missing-file cases
    bareCwd = await mkdtemp(join(tmpdir(), 'mrclean-restore-log-bare-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
    await rm(bareCwd, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // buildRestoreAuditRecord
  // -------------------------------------------------------------------------

  describe('buildRestoreAuditRecord', () => {
    it('builds a restore-discriminated record with ISO-8601 ts and all counts copied field-by-field', () => {
      const record = buildRestoreAuditRecord(makeInput())

      expect(record.action).toBe('restore')
      expect(record.ts).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
      expect(record.sessionScope).toBe('all')
      expect(record.restored).toBe(2)
      expect(record.unmatched).toBe(1)
      expect(record.skippedSecret).toBe(1)
      expect(record.hashes).toEqual([HASH_A, HASH_B])
    })

    it('emits EXACTLY the 7 declared keys (shape lock)', () => {
      const record = buildRestoreAuditRecord(makeInput())

      expect(Object.keys(record)).toHaveLength(7)
      expect(Object.keys(record).sort()).toEqual([
        'action',
        'hashes',
        'restored',
        'sessionScope',
        'skippedSecret',
        'ts',
        'unmatched',
      ])
    })

    it('does not serialise extra properties from an over-shaped input (raw canary cannot pass through)', () => {
      const overShaped = { ...makeInput(), value: 'raw-canary' } as never
      const record = buildRestoreAuditRecord(overShaped)

      expect((record as Record<string, unknown>)['value']).toBeUndefined()
      expect(JSON.stringify(record)).not.toContain('raw-canary')
    })

    it('normalises hashes to distinct sorted order without mutating the input array', () => {
      const input = makeInput({ hashes: [HASH_B, HASH_A, HASH_B] })
      const record = buildRestoreAuditRecord(input)

      expect(record.hashes).toEqual([HASH_A, HASH_B])
      // Immutability: caller's array is untouched
      expect(input.hashes).toEqual([HASH_B, HASH_A, HASH_B])
    })
  })

  // -------------------------------------------------------------------------
  // writeRestoreAuditRecord
  // -------------------------------------------------------------------------

  describe('writeRestoreAuditRecord', () => {
    it('appends exactly one newline-terminated JSON line that round-trips', async () => {
      const record = buildRestoreAuditRecord(makeInput())
      await writeRestoreAuditRecord(cwd, record)

      const content = await readFile(auditPath, 'utf8')
      expect(content.endsWith('\n')).toBe(true)

      const lines = content.split('\n').filter((line) => line.length > 0)
      expect(lines).toHaveLength(1)
      expect(JSON.parse(lines[0]!)).toEqual(record)
    })

    it('two sequential writes produce two lines', async () => {
      await writeRestoreAuditRecord(cwd, buildRestoreAuditRecord(makeInput()))
      await writeRestoreAuditRecord(cwd, buildRestoreAuditRecord(makeInput({ restored: 5 })))

      const content = await readFile(auditPath, 'utf8')
      const lines = content.split('\n').filter((line) => line.length > 0)
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[1]!).restored).toBe(5)
    })

    it('throws AuditWriteError with the mrclean install hint when .mrclean/ is missing', async () => {
      const record = buildRestoreAuditRecord(makeInput())
      const err = await writeRestoreAuditRecord(bareCwd, record).then(
        () => null,
        (e: unknown) => e,
      )

      expect(err).toBeInstanceOf(AuditWriteError)
      expect((err as AuditWriteError).message).toContain('mrclean install')
    })
  })

  // -------------------------------------------------------------------------
  // aggregateRestoreCounters
  // -------------------------------------------------------------------------

  describe('aggregateRestoreCounters', () => {
    it('sums restored/unmatched over restore lines in a heterogeneous stream (hook lines excluded)', async () => {
      await appendFile(auditPath, JSON.stringify(makeHookRecord()) + '\n', 'utf8')
      await appendFile(auditPath, makeRestoreLine(2, 1) + '\n', 'utf8')
      await appendFile(auditPath, makeRestoreLine(1, 0) + '\n', 'utf8')

      await expect(aggregateRestoreCounters(cwd)).resolves.toEqual({
        restored_total: 3,
        unmatched_total: 1,
      })
    })

    it('returns zeros when audit.jsonl is missing', async () => {
      await expect(aggregateRestoreCounters(bareCwd)).resolves.toEqual({
        restored_total: 0,
        unmatched_total: 0,
      })
    })

    it('skips malformed lines and still sums the valid restore lines', async () => {
      await appendFile(auditPath, makeRestoreLine(2, 1) + '\n', 'utf8')
      await appendFile(auditPath, 'this is {{{ not json\n', 'utf8')
      await appendFile(auditPath, makeRestoreLine(1, 0) + '\n', 'utf8')

      await expect(aggregateRestoreCounters(cwd)).resolves.toEqual({
        restored_total: 3,
        unmatched_total: 1,
      })
    })

    it('treats a non-numeric counter on a tampered restore line as 0 and never throws', async () => {
      await appendFile(auditPath, makeRestoreLine('banana', 1) + '\n', 'utf8')
      await appendFile(auditPath, makeRestoreLine(2, 0) + '\n', 'utf8')

      await expect(aggregateRestoreCounters(cwd)).resolves.toEqual({
        restored_total: 2,
        unmatched_total: 1,
      })
    })
  })

  // -------------------------------------------------------------------------
  // Leak invariants (REVMODE-09)
  // -------------------------------------------------------------------------

  describe('leak invariants (REVMODE-09)', () => {
    it('persists 16-hex hashes only — raw original absent, assertNoCanaryLeak ok over the heterogeneous stream', async () => {
      const rawCanary = 'zz-canary-restorable'
      const canaryHash = redactedHash(rawCanary)

      // Heterogeneous-stream proof: one hook AuditRecord line lands first
      await appendFile(auditPath, JSON.stringify(makeHookRecord()) + '\n', 'utf8')

      const record: RestoreAuditRecord = buildRestoreAuditRecord(
        makeInput({ restored: 1, unmatched: 0, skippedSecret: 0, hashes: [canaryHash] }),
      )
      await writeRestoreAuditRecord(cwd, record)

      const content = await readFile(auditPath, 'utf8')
      const lines = content.split('\n').filter((line) => line.length > 0)
      expect(lines).toHaveLength(2) // hook line + restore line coexist

      // Non-vacuity: the hash is real 16-hex and actually present in the file
      expect(canaryHash).toMatch(/^[a-f0-9]{16}$/)
      expect(content).toContain(canaryHash)
      // The raw original never reaches disk
      expect(content).not.toContain(rawCanary)

      const result = await assertNoCanaryLeak(auditPath, [rawCanary])
      expect(result.ok).toBe(true)
      expect(result.leaked).toEqual([])
    })
  })
})
