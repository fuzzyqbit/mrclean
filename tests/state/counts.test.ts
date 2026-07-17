/**
 * Unit tests for the counts-only session entry reducer (src/state/counts.ts).
 *
 * Plan 10-06 Task 1 (REVMODE-12): the reducer is the ONLY sanctioned path for
 * MCP-side state reads — it must return numeric tallies only, never throw, and
 * never write. Fixtures follow the chaos.test.ts seed recipe (buildSeedMap /
 * writeSeedState) and the inspection.test.ts tmpdir baseDir lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { countSessionEntries } from '../../src/state/counts.js'
import {
  ensureSessionKey,
  mapPathFor,
  statePaths,
  writeSessionMapFile,
} from '../../src/state/map-store.js'
import {
  createEmptySessionMap,
  formatV2Token,
  hmacAddress,
  makeMapEntry,
  type SessionMapEntry,
  type SessionMapV1,
} from '../../src/state/session-map.js'

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

/** Envelope ciphertext start: magic(8) + version(1) + IV(12) + tag(16) —
 *  duplicated from chaos.test.ts / map-store.test.ts; do NOT re-derive. */
const CIPHERTEXT_OFFSET = 37

/** Seed entry spec: TYPE + original value handed to makeMapEntry. */
interface SeedSpec {
  type: string
  original: string
}

/** sid1: two restorable WORD entries + one secret-class AWS_KEY entry. */
const SID1_SPECS: readonly SeedSpec[] = [
  { type: 'WORD', original: 'counts-word-alpha' },
  { type: 'WORD', original: 'counts-word-beta' },
  { type: 'AWS_KEY', original: 'AKIACOUNTSFIXTUREKEY' },
]

/** sid2: one restorable PII_EMAIL entry. */
const SID2_SPECS: readonly SeedSpec[] = [{ type: 'PII_EMAIL', original: 'counts@example.com' }]

// ---------------------------------------------------------------------------
// Fixture helpers (chaos.test.ts buildSeedMap / writeSeedState recipe)
// ---------------------------------------------------------------------------

/** Build a valid map with one entry per spec (counter = spec index + 1). */
function buildMapFromSpecs(sid: string, specs: readonly SeedSpec[]): SessionMapV1 {
  const base = createEmptySessionMap(sid)
  const entries: Record<string, SessionMapEntry> = {}
  specs.forEach((spec, index) => {
    const counter = index + 1
    entries[hmacAddress(base.hashSalt, spec.original)] = makeMapEntry(
      spec.type,
      formatV2Token(spec.type, counter, base.nonce8),
      counter,
      spec.original,
    )
  })
  return { ...base, counter: specs.length, entries }
}

/** Write a fully valid key+map state for `sid` under `baseDir`. */
async function writeSeededSession(
  baseDir: string,
  sid: string,
  specs: readonly SeedSpec[],
): Promise<void> {
  const key = await ensureSessionKey(baseDir, sid)
  await writeSessionMapFile(baseDir, sid, buildMapFromSpecs(sid, specs), key)
}

/** Flip one ciphertext byte in a session's map file (GCM auth must fail). */
async function flipCiphertextByte(baseDir: string, sid: string): Promise<void> {
  const path = mapPathFor(baseDir, sid)
  const original = await readFile(path)
  const tampered = Buffer.from(original)
  tampered[CIPHERTEXT_OFFSET] = tampered[CIPHERTEXT_OFFSET]! ^ 0xff
  await writeFile(path, tampered)
}

/** Snapshot dir listing + per-file mtimes for the no-write proof. */
async function snapshotDir(dir: string): Promise<{ names: string[]; mtimes: number[] }> {
  const names = (await readdir(dir)).sort()
  const mtimes: number[] = []
  for (const name of names) {
    mtimes.push((await stat(join(dir, name))).mtimeMs)
  }
  return { names, mtimes }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('countSessionEntries (counts-only reducer)', () => {
  let baseDir: string
  let sid1: string
  let sid2: string

  beforeEach(async () => {
    baseDir = join(tmpdir(), `mrclean-counts-${randomUUID()}`)
    sid1 = randomUUID()
    sid2 = randomUUID()
    await mkdir(baseDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('tallies sessions and entries by class across two seeded maps', async () => {
    // Arrange
    await writeSeededSession(baseDir, sid1, SID1_SPECS)
    await writeSeededSession(baseDir, sid2, SID2_SPECS)

    // Act
    const result = await countSessionEntries(baseDir)

    // Assert — 2 WORD + 1 PII_EMAIL restorable; 1 AWS_KEY secret
    expect(result).toEqual({ sessions: 2, restorable: 3, secret: 1 })
  })

  it('silently skips an undecryptable map (ciphertext byte-flip)', async () => {
    // Arrange
    await writeSeededSession(baseDir, sid1, SID1_SPECS)
    await writeSeededSession(baseDir, sid2, SID2_SPECS)
    await flipCiphertextByte(baseDir, sid2)

    // Act
    const result = await countSessionEntries(baseDir)

    // Assert — sid2 fails GCM auth and vanishes from every tally
    expect(result).toEqual({ sessions: 1, restorable: 2, secret: 1 })
  })

  it('returns all zeros when the sessions dir does not exist', async () => {
    // Arrange — baseDir exists but sessions/ was never created

    // Act
    const result = await countSessionEntries(baseDir)

    // Assert
    expect(result).toEqual({ sessions: 0, restorable: 0, secret: 0 })
  })

  it('returns all zeros when baseDir itself does not exist', async () => {
    // Act
    const result = await countSessionEntries(join(baseDir, 'never-created'))

    // Assert
    expect(result).toEqual({ sessions: 0, restorable: 0, secret: 0 })
  })

  it('ignores non-conforming filenames in the sessions dir', async () => {
    // Arrange — one valid session plus foreign/litter names the reducer must skip
    await writeSeededSession(baseDir, sid1, SID1_SPECS)
    const { sessionsDir } = statePaths(baseDir)
    await writeFile(join(sessionsDir, 'not-a-uuid.map'), 'garbage')
    await writeFile(join(sessionsDir, 'README.txt'), 'not ours')
    await writeFile(join(sessionsDir, `${randomUUID()}.map.12345`), 'wfa litter shape')

    // Act
    const result = await countSessionEntries(baseDir)

    // Assert — only sid1 is visible
    expect(result).toEqual({ sessions: 1, restorable: 2, secret: 1 })
  })

  it('returns ONLY numeric count fields — no original text can escape', async () => {
    // Arrange
    await writeSeededSession(baseDir, sid1, SID1_SPECS)
    await writeSeededSession(baseDir, sid2, SID2_SPECS)

    // Act
    const result = await countSessionEntries(baseDir)

    // Assert — exact three-numbers shape; nothing else serialises
    expect(JSON.stringify(result)).toMatch(/^\{"sessions":\d+,"restorable":\d+,"secret":\d+\}$/)
  })

  it('never writes: listings and mtimes are unchanged across the call', async () => {
    // Arrange
    await writeSeededSession(baseDir, sid1, SID1_SPECS)
    await writeSeededSession(baseDir, sid2, SID2_SPECS)
    const { sessionsDir, keysDir } = statePaths(baseDir)
    const sessionsBefore = await snapshotDir(sessionsDir)
    const keysBefore = await snapshotDir(keysDir)

    // Act
    await countSessionEntries(baseDir)

    // Assert — read-only: no new files, no deletions, no rewrites
    expect(await snapshotDir(sessionsDir)).toEqual(sessionsBefore)
    expect(await snapshotDir(keysDir)).toEqual(keysBefore)
  })
})
