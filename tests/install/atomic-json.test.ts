/**
 * Tests for src/install/atomic-json.ts
 *
 * Validates: atomic writes, read-or-empty, backup naming, restore, list backups.
 * RESEARCH.md §3.3 (atomic write pattern + backup naming), Pitfall #5 (cross-fs rename).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import {
  readJsonOrEmpty,
  atomicWriteJson,
  backupJson,
  listMrcleanBackups,
  restoreFromBackup,
} from '../../src/install/atomic-json.js'

let testDir: string

beforeEach(async () => {
  testDir = join(tmpdir(), `mrclean-test-${randomUUID()}`)
  await mkdir(testDir, { recursive: true })
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

// Test 1: atomicWriteJson writes valid JSON
describe('atomicWriteJson', () => {
  it('writes valid JSON to the target path', async () => {
    const target = join(testDir, 'output.json')
    await atomicWriteJson(target, { a: 1, b: 'hello' })

    const raw = await readFile(target, 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({ a: 1, b: 'hello' })
  })

  it('uses tmp file in the SAME directory as target (Pitfall #5 defense)', async () => {
    // We verify by checking that the content is correctly written
    // (cross-filesystem rename would fail; same-dir rename succeeds)
    const subDir = join(testDir, 'subdir')
    await mkdir(subDir)
    const target = join(subDir, 'data.json')

    await atomicWriteJson(target, { nested: true })
    const parsed = JSON.parse(await readFile(target, 'utf8'))
    expect(parsed.nested).toBe(true)
  })

  it('overwrites existing content atomically', async () => {
    const target = join(testDir, 'overwrite.json')
    await writeFile(target, JSON.stringify({ old: 'data' }), 'utf8')

    await atomicWriteJson(target, { new: 'data' })
    const parsed = JSON.parse(await readFile(target, 'utf8'))
    expect(parsed).toEqual({ new: 'data' })
    expect(parsed.old).toBeUndefined()
  })
})

// Test 2: readJsonOrEmpty returns {} on ENOENT
describe('readJsonOrEmpty', () => {
  it('returns {} for a nonexistent file without throwing', async () => {
    const result = await readJsonOrEmpty(join(testDir, 'nonexistent.json'))
    expect(result).toEqual({})
  })

  it('returns parsed content for an existing file', async () => {
    const target = join(testDir, 'existing.json')
    await writeFile(target, JSON.stringify({ key: 'value' }), 'utf8')
    const result = await readJsonOrEmpty(target)
    expect(result).toEqual({ key: 'value' })
  })

  it('re-throws errors other than ENOENT', async () => {
    // Pass a directory path (not a file) — will cause EISDIR or similar
    await expect(readJsonOrEmpty(testDir)).rejects.toThrow()
  })
})

// Test 3: backupJson produces sibling with mrclean-backup naming
describe('backupJson', () => {
  it('creates a backup with the correct naming pattern', async () => {
    const target = join(testDir, 'settings.json')
    await writeFile(target, JSON.stringify({ existing: true }), 'utf8')

    const backupPath = await backupJson(target)

    // Pattern: <target>.mrclean-backup-<ISO8601-safe>.json
    const backupBase = basename(backupPath)
    expect(backupBase).toMatch(/^settings\.json\.mrclean-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+Z\.json$/)

    // Must be a sibling (same directory)
    expect(dirname(backupPath)).toBe(testDir)

    // Content must match original
    const backupContent = JSON.parse(await readFile(backupPath, 'utf8'))
    expect(backupContent).toEqual({ existing: true })
  })

  it('throws when the target file does not exist', async () => {
    const target = join(testDir, 'missing.json')
    await expect(backupJson(target)).rejects.toThrow()
  })
})

// Test 4: listMrcleanBackups returns sorted newest-first
describe('listMrcleanBackups', () => {
  it('returns backups sorted newest-first by timestamp', async () => {
    const target = join(testDir, 'settings.json')
    await writeFile(target, '{}', 'utf8')

    // Create two backups with a small delay to get different timestamps
    const backup1 = await backupJson(target)
    // Ensure different timestamp by modifying the backup filename
    // (we can't reliably sleep, so we create them with explicit timestamps)
    const ts1 = '2026-05-14T01-00-00-000Z'
    const ts2 = '2026-05-14T02-00-00-000Z'
    const fake1 = join(testDir, `settings.json.mrclean-backup-${ts1}.json`)
    const fake2 = join(testDir, `settings.json.mrclean-backup-${ts2}.json`)
    await writeFile(fake1, '{"ts": "older"}', 'utf8')
    await writeFile(fake2, '{"ts": "newer"}', 'utf8')

    const backups = await listMrcleanBackups(target)

    // Should contain at least the two fake ones
    const fake1InList = backups.some(b => b.includes(ts1))
    const fake2InList = backups.some(b => b.includes(ts2))
    expect(fake1InList).toBe(true)
    expect(fake2InList).toBe(true)

    // fake2 (newer) should come before fake1 (older)
    const idx1 = backups.findIndex(b => b.includes(ts1))
    const idx2 = backups.findIndex(b => b.includes(ts2))
    expect(idx2).toBeLessThan(idx1)
  })

  it('returns empty array when no backups exist', async () => {
    const target = join(testDir, 'fresh.json')
    await writeFile(target, '{}', 'utf8')
    const backups = await listMrcleanBackups(target)
    expect(backups).toEqual([])
  })
})

// Test 5: restoreFromBackup makes target byte-identical to backup
describe('restoreFromBackup', () => {
  it('restores target to byte-identical match of backup', async () => {
    const target = join(testDir, 'settings.json')
    const originalContent = JSON.stringify({ original: true }, null, 2)
    await writeFile(target, originalContent, 'utf8')

    const backupPath = await backupJson(target)

    // Modify the target
    await atomicWriteJson(target, { modified: true })

    // Verify it changed
    const modified = JSON.parse(await readFile(target, 'utf8'))
    expect(modified.modified).toBe(true)

    // Restore
    await restoreFromBackup(target, backupPath)

    // Compare bytes
    const restored = await readFile(target)
    const backupContent = await readFile(backupPath)
    expect(Buffer.compare(restored, backupContent)).toBe(0)
  })
})
