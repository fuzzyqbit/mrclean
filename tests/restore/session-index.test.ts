/**
 * Real-ciphertext suite for the policy-filtered restore session index
 * (REVMODE-01, plan 10-02).
 *
 * Every persisted fixture is REAL ciphertext — written through
 * writeSessionMapFile or encryptMapBuffer with the session's real key. No
 * raw session-map JSON ever lands in sessionsDir (the poisoned-map fixture
 * writes ENVELOPE bytes, produced by encrypting hand-crafted JSON with the
 * real key, so the parse-time drop + read-side gate are exercised against
 * the exact bytes a poisoned disk would carry).
 *
 * Proven here (the third policy layer Phase 9 reserved for Phase 10):
 * - union index across ALL live decryptable maps (planner pin A4)
 * - read-side gate: isRestorableType(type) && 'original' in entry
 * - OVF-labelled placeholders in NEITHER structure (ambiguous shared token)
 * - janitor filename-candidacy discipline (non-conforming names invisible)
 * - isValidSessionId BEFORE any path derivation for sessionFilter
 * - total-error read: corrupt maps skipped silently, absent dir => empty
 * - zero write surface: dir listings + mtimes byte-identical across a build
 */

import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { buildRestoreIndex, type RestoreIndex } from '../../src/restore/session-index.js'
import {
  encryptMapBuffer,
  ensureSessionKey,
  mapPathFor,
  statePaths,
  writeSessionMapFile,
} from '../../src/state/map-store.js'
import {
  createEmptySessionMap,
  formatV2Token,
  hmacAddress,
  isValidSessionId,
  makeMapEntry,
  type SessionMapEntry,
  type SessionMapV1,
} from '../../src/state/session-map.js'

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

/** Restorable originals — synthetic, obviously fake values. */
const WORD_ORIGINAL_A = 'union-word-original-alpha'
const EMAIL_ORIGINAL = 'union.canary@example.invalid'
const WORD_ORIGINAL_B = 'union-word-original-beta'
const OVF_ORIGINAL = 'union-ovf-original-past-999'

/** Secret-class original — the X-suffixed AWS style (never allowlisted). */
const SECRET_ORIGINAL = 'AKIAIOSFODNN7EXAMPLX'

/** The hand-poisoned secret original that must appear NOWHERE in any index. */
const POISONED_ORIGINAL = 'zz-poisoned-secret-original'

/** Fixed cross-session nonce8 forcing identical tokens (IN-02 collision rows). */
const SHARED_NONCE8 = 'aabbccdd'

/** The two disputed originals behind one collided placeholder (IN-02). */
const COLLISION_ORIGINAL_ONE = 'collision-original-one'
const COLLISION_ORIGINAL_TWO = 'collision-original-two'

/** Envelope offsets duplicated from map-store.test.ts — do NOT re-derive. */
const CT_OFFSET = 37 // magic(8) + version(1) + IV(12) + tag(16)

// ---------------------------------------------------------------------------
// Fixture helpers (chaos.test.ts buildSeedMap / writeSeedState shape)
// ---------------------------------------------------------------------------

interface FixtureEntrySpec {
  type: string
  counter: number
  original: string
}

/** Build a valid SessionMapV1 whose entries follow real allocator shapes. */
function buildFixtureMap(sid: string, specs: readonly FixtureEntrySpec[]): SessionMapV1 {
  const base = createEmptySessionMap(sid)
  const entries = Object.fromEntries(
    specs.map((spec): [string, SessionMapEntry] => [
      hmacAddress(base.hashSalt, spec.original),
      makeMapEntry(
        spec.type,
        formatV2Token(spec.type, spec.counter, base.nonce8),
        spec.counter,
        spec.original,
      ),
    ]),
  )
  const counter = specs.reduce((max, spec) => Math.max(max, spec.counter), 0)
  return { ...base, counter, entries }
}

/** Persist a fixture map as REAL ciphertext under the session's real key. */
async function persistFixtureMap(baseDir: string, map: SessionMapV1): Promise<void> {
  const key = await ensureSessionKey(baseDir, map.sessionId)
  await writeSessionMapFile(baseDir, map.sessionId, map, key)
}

/** Entry spec carrying an EXPLICIT placeholder string (IN-02 collision rows). */
interface HandBuiltEntrySpec extends FixtureEntrySpec {
  placeholder: string
}

/**
 * Persist a hand-built map whose entries carry EXPLICIT placeholder strings,
 * encrypted under the session's REAL key (the 10-02 poisoned-map recipe).
 *
 * Forced cross-session identical placeholders REQUIRE this path: the
 * serializer-built fixtures embed each map's own nonce8 via formatV2Token,
 * so buildFixtureMap maps can never collide. The JSON is a VALID
 * SessionMapV1 — only the placeholder strings are chosen by the test.
 */
async function persistHandBuiltMap(
  baseDir: string,
  sid: string,
  specs: readonly HandBuiltEntrySpec[],
): Promise<void> {
  const base = createEmptySessionMap(sid)
  const key = await ensureSessionKey(baseDir, sid)
  const json = JSON.stringify({
    version: 1,
    sessionId: sid,
    nonce8: base.nonce8,
    hashSalt: base.hashSalt,
    counter: specs.reduce((max, spec) => Math.max(max, spec.counter), 0),
    entries: Object.fromEntries(
      specs.map((spec) => [
        hmacAddress(base.hashSalt, spec.original),
        {
          placeholder: spec.placeholder,
          type: spec.type,
          counter: spec.counter,
          original: spec.original,
        },
      ]),
    ),
  })
  const envelope = encryptMapBuffer(Buffer.from(json, 'utf8'), key, sid)
  const { sessionsDir } = statePaths(baseDir)
  await mkdir(sessionsDir, { recursive: true, mode: 0o700 })
  await writeFile(mapPathFor(baseDir, sid), envelope, { mode: 0o600 })
}

/**
 * Seed the standard two-session union fixture:
 * sid1 = { WORD, PII_EMAIL, AWS_KEY (secret), WORD@1000 (OVF) }
 * sid2 = { WORD }
 */
async function seedUnionFixture(
  baseDir: string,
): Promise<{ map1: SessionMapV1; map2: SessionMapV1 }> {
  const map1 = buildFixtureMap(randomUUID(), [
    { type: 'WORD', counter: 1, original: WORD_ORIGINAL_A },
    { type: 'PII_EMAIL', counter: 2, original: EMAIL_ORIGINAL },
    { type: 'AWS_KEY', counter: 3, original: SECRET_ORIGINAL },
    { type: 'WORD', counter: 1000, original: OVF_ORIGINAL },
  ])
  const map2 = buildFixtureMap(randomUUID(), [
    { type: 'WORD', counter: 1, original: WORD_ORIGINAL_B },
  ])
  await persistFixtureMap(baseDir, map1)
  await persistFixtureMap(baseDir, map2)
  return { map1, map2 }
}

/** Snapshot a dir as sorted [name, mtimeMs] pairs (no-write proof shape). */
async function snapshotDir(dir: string): Promise<Array<[string, number]>> {
  const names = [...(await readdir(dir))].sort()
  return Promise.all(
    names.map(async (name): Promise<[string, number]> => {
      return [name, (await stat(join(dir, name))).mtimeMs]
    }),
  )
}

/** Assert the structurally-empty RestoreIndex (pins the exported type too). */
function expectEmptyIndex(result: RestoreIndex): void {
  expect(result.placeholders.size).toBe(0)
  expect(result.secretPlaceholders.size).toBe(0)
  expect(result.sessions).toBe(0)
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('buildRestoreIndex (read-side policy gate over the encrypted store)', () => {
  const cleanupDirs: string[] = []

  afterEach(async () => {
    await Promise.all(
      cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    )
  })

  /** Fresh mkdtemp baseDir per test — never the real ~/.mrclean. */
  async function freshBaseDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'mrclean-session-index-'))
    cleanupDirs.push(dir)
    return dir
  }

  it('unions restorable placeholder->original pairs across all live decryptable maps', async () => {
    // Arrange
    const baseDir = await freshBaseDir()
    const { map1, map2 } = await seedUnionFixture(baseDir)

    // Act
    const result = await buildRestoreIndex(baseDir)

    // Assert — exactly 3 pairs: sid1 WORD + sid1 PII_EMAIL + sid2 WORD
    expect(result.sessions).toBe(2)
    expect(result.placeholders.size).toBe(3)
    expect(result.placeholders.get(formatV2Token('WORD', 1, map1.nonce8))).toBe(WORD_ORIGINAL_A)
    expect(result.placeholders.get(formatV2Token('PII_EMAIL', 2, map1.nonce8))).toBe(
      EMAIL_ORIGINAL,
    )
    expect(result.placeholders.get(formatV2Token('WORD', 1, map2.nonce8))).toBe(WORD_ORIGINAL_B)
  })

  it('collects secret-class placeholders into secretPlaceholders and never into placeholders', async () => {
    // Arrange
    const baseDir = await freshBaseDir()
    const { map1 } = await seedUnionFixture(baseDir)
    const secretPlaceholder = formatV2Token('AWS_KEY', 3, map1.nonce8)

    // Act
    const result = await buildRestoreIndex(baseDir)

    // Assert — exactly the AWS_KEY placeholder, and no secret value anywhere
    expect(result.secretPlaceholders.size).toBe(1)
    expect(result.secretPlaceholders.has(secretPlaceholder)).toBe(true)
    expect(result.placeholders.has(secretPlaceholder)).toBe(false)
    expect([...result.placeholders.values()]).not.toContain(SECRET_ORIGINAL)
  })

  it('excludes OVF-labelled placeholders from BOTH structures at build time', async () => {
    // Arrange
    const baseDir = await freshBaseDir()
    const { map1 } = await seedUnionFixture(baseDir)
    const ovfPlaceholder = formatV2Token('WORD', 1000, map1.nonce8)
    expect(ovfPlaceholder).toContain(':OVF:') // fixture sanity: really an OVF token

    // Act
    const result = await buildRestoreIndex(baseDir)

    // Assert — the ambiguous shared token restores nothing and is not flagged secret
    expect(result.placeholders.has(ovfPlaceholder)).toBe(false)
    expect(result.secretPlaceholders.has(ovfPlaceholder)).toBe(false)
    expect([...result.placeholders.values()]).not.toContain(OVF_ORIGINAL)
  })

  it('narrows to a single session when a valid sessionFilter is given', async () => {
    // Arrange
    const baseDir = await freshBaseDir()
    const { map1, map2 } = await seedUnionFixture(baseDir)

    // Act
    const result = await buildRestoreIndex(baseDir, map1.sessionId)

    // Assert — only sid1 pairs; sid2's WORD is absent; sessions === 1
    expect(result.sessions).toBe(1)
    expect(result.placeholders.size).toBe(2)
    expect(result.placeholders.get(formatV2Token('WORD', 1, map1.nonce8))).toBe(WORD_ORIGINAL_A)
    expect(result.placeholders.has(formatV2Token('WORD', 1, map2.nonce8))).toBe(false)
  })

  it('matches an UPPERCASE sessionFilter against the lowercase on-disk session (RFC 4122 case-insensitive hex — WR-02)', async () => {
    // Arrange — fixed lowercase sid with hex letters GUARANTEED (a random
    // UUID could in principle be all digits, making toUpperCase a no-op).
    const baseDir = await freshBaseDir()
    const sid = 'aabbccdd-1122-4344-8daf-fedcba987654'
    const map = buildFixtureMap(sid, [{ type: 'WORD', counter: 1, original: WORD_ORIGINAL_A }])
    await persistFixtureMap(baseDir, map)
    const upper = sid.toUpperCase()
    expect(upper).not.toBe(sid) // non-vacuity: the filter really differs in case
    expect(isValidSessionId(upper)).toBe(true) // the CLI hard gate accepts it too

    // Act
    const result = await buildRestoreIndex(baseDir, upper)

    // Assert — the operator's uppercase paste narrows to the session instead
    // of silently restoring nothing (the pre-fix behavior: sessions === 0).
    expect(result.sessions).toBe(1)
    expect(result.placeholders.size).toBe(1)
    expect(result.placeholders.get(formatV2Token('WORD', 1, map.nonce8))).toBe(WORD_ORIGINAL_A)
  })

  it('returns an empty index for a path-traversal sessionFilter even when valid maps exist', async () => {
    // Arrange — valid decryptable maps ARE on disk; the filter alone is hostile
    const baseDir = await freshBaseDir()
    await seedUnionFixture(baseDir)
    const hostileFilter = '../../etc/passwd'
    expect(isValidSessionId(hostileFilter)).toBe(false) // sanity: exercises the invalid path

    // Act
    const result = await buildRestoreIndex(baseDir, hostileFilter)

    // Assert — empty, no throw, nothing decrypted
    expectEmptyIndex(result)
  })

  it('returns an empty index for the synthetic mcp-server sessionFilter', async () => {
    // Arrange
    const baseDir = await freshBaseDir()
    await seedUnionFixture(baseDir)
    const syntheticSid = 'mcp-server'
    expect(isValidSessionId(syntheticSid)).toBe(false) // MCP-lane fence: structurally invalid

    // Act
    const result = await buildRestoreIndex(baseDir, syntheticSid)

    // Assert
    expectEmptyIndex(result)
  })

  it('skips a corrupt map silently and still indexes the surviving sessions', async () => {
    // Arrange — flip ONE ciphertext byte in sid1's envelope (chaos CT_OFFSET recipe)
    const baseDir = await freshBaseDir()
    const { map1, map2 } = await seedUnionFixture(baseDir)
    const raw = await readFile(mapPathFor(baseDir, map1.sessionId))
    const tampered = Buffer.from(raw)
    tampered[CT_OFFSET] = tampered[CT_OFFSET]! ^ 0x01
    await writeFile(mapPathFor(baseDir, map1.sessionId), tampered)

    // Act
    const result = await buildRestoreIndex(baseDir)

    // Assert — sessions counts ONLY decryptable maps; sid2 still fully indexed
    expect(result.sessions).toBe(1)
    expect(result.placeholders.size).toBe(1)
    expect(result.placeholders.get(formatV2Token('WORD', 1, map2.nonce8))).toBe(WORD_ORIGINAL_B)
    expect(result.placeholders.has(formatV2Token('WORD', 1, map1.nonce8))).toBe(false)
  })

  it('ignores non-conforming filenames planted in the sessions dir', async () => {
    // Arrange — one real map + three planted names the janitor discipline rejects
    const baseDir = await freshBaseDir()
    const map = buildFixtureMap(randomUUID(), [
      { type: 'WORD', counter: 1, original: WORD_ORIGINAL_A },
    ])
    await persistFixtureMap(baseDir, map)
    const { sessionsDir } = statePaths(baseDir)
    await writeFile(join(sessionsDir, 'README.txt'), 'planted foreign file')
    await writeFile(join(sessionsDir, 'evil..map'), 'planted foreign file')
    await writeFile(join(sessionsDir, `${map.sessionId}.map.bak`), 'planted foreign file')

    // Act
    const result = await buildRestoreIndex(baseDir)

    // Assert — planted names invisible; only the real map contributes
    expect(result.sessions).toBe(1)
    expect(result.placeholders.size).toBe(1)
    expect(result.placeholders.get(formatV2Token('WORD', 1, map.nonce8))).toBe(WORD_ORIGINAL_A)
  })

  it('returns an empty index when the sessions dir does not exist', async () => {
    // Arrange — fresh baseDir, nothing ever written
    const baseDir = await freshBaseDir()

    // Act
    const result = await buildRestoreIndex(baseDir)

    // Assert — empty, never a throw
    expectEmptyIndex(result)
  })

  it('contributes nothing restorable from a hand-poisoned secret-class map re-encrypted with the real key', async () => {
    // Arrange — a VALID SessionMapV1 JSON built by hand where the AWS_KEY
    // entry carries `original` (bypassing serializeSessionMap, which would
    // strip it), encrypted under the session's REAL key and written as
    // envelope bytes — the exact on-disk state a poisoned map would have.
    const baseDir = await freshBaseDir()
    const sid = randomUUID()
    const base = createEmptySessionMap(sid)
    const key = await ensureSessionKey(baseDir, sid)
    const poisonedJson = JSON.stringify({
      version: 1,
      sessionId: sid,
      nonce8: base.nonce8,
      hashSalt: base.hashSalt,
      counter: 1,
      entries: {
        [hmacAddress(base.hashSalt, POISONED_ORIGINAL)]: {
          placeholder: formatV2Token('AWS_KEY', 1, base.nonce8),
          type: 'AWS_KEY',
          counter: 1,
          original: POISONED_ORIGINAL,
        },
      },
    })
    const envelope = encryptMapBuffer(Buffer.from(poisonedJson, 'utf8'), key, sid)
    const { sessionsDir } = statePaths(baseDir)
    await mkdir(sessionsDir, { recursive: true, mode: 0o700 })
    await writeFile(mapPathFor(baseDir, sid), envelope, { mode: 0o600 })

    // Act
    const result = await buildRestoreIndex(baseDir)

    // Assert — non-vacuity: the poisoned map DID decrypt and its secret
    // placeholder was seen (the map was read, not skipped) ...
    expect(result.sessions).toBe(1)
    expect(result.secretPlaceholders.has(formatV2Token('AWS_KEY', 1, base.nonce8))).toBe(true)

    // ... yet the poisoned value appears in NO index structure (parse-time
    // drop + read-side gate, defense in depth).
    expect(result.placeholders.size).toBe(0)
    expect([...result.placeholders.values()]).not.toContain(POISONED_ORIGINAL)
    const serialized = JSON.stringify({
      placeholders: [...result.placeholders.entries()],
      secretPlaceholders: [...result.secretPlaceholders],
      sessions: result.sessions,
    })
    expect(serialized.includes(POISONED_ORIGINAL)).toBe(false)
  })

  it('performs zero writes: sessions/keys listings and mtimes are byte-identical across a build', async () => {
    // Arrange
    const baseDir = await freshBaseDir()
    await seedUnionFixture(baseDir)
    const { sessionsDir, keysDir } = statePaths(baseDir)
    const sessionsBefore = await snapshotDir(sessionsDir)
    const keysBefore = await snapshotDir(keysDir)

    // Act
    const result = await buildRestoreIndex(baseDir)

    // Assert — non-vacuity first (the build really decrypted state) ...
    expect(result.sessions).toBe(2)
    expect(result.placeholders.size).toBeGreaterThan(0)

    // ... then the Pitfall 7 proof: no tmp litter, no mtime heartbeat refresh.
    expect(await snapshotDir(sessionsDir)).toEqual(sessionsBefore)
    expect(await snapshotDir(keysDir)).toEqual(keysBefore)
  })

  describe('IN-02: cross-session collision demotes to unmatched (AR-10-05)', () => {
    /** The one collided token every colliding session carries (valid v2 shape). */
    const collidedToken = formatV2Token('WORD', 1, SHARED_NONCE8)

    it('demotes a placeholder claimed with DIFFERENT originals by two sessions — neither candidate restorable', async () => {
      // Arrange — two sessions, SAME placeholder string, DIFFERENT originals
      // (a birthday-bounded nonce8 collision's on-disk state, forced by hand).
      const baseDir = await freshBaseDir()
      await persistHandBuiltMap(baseDir, randomUUID(), [
        {
          type: 'WORD',
          counter: 1,
          placeholder: collidedToken,
          original: COLLISION_ORIGINAL_ONE,
        },
      ])
      await persistHandBuiltMap(baseDir, randomUUID(), [
        {
          type: 'WORD',
          counter: 1,
          placeholder: collidedToken,
          original: COLLISION_ORIGINAL_TWO,
        },
      ])

      // Act
      const result = await buildRestoreIndex(baseDir)

      // Assert — non-vacuity FIRST: both maps really decrypted
      expect(result.sessions).toBe(2)

      // The ambiguous token is in NEITHER structure (mirrors the OVF
      // treatment: an ambiguous token restores NOTHING — never
      // last-write-wins).
      expect(result.placeholders.has(collidedToken)).toBe(false)
      expect(result.secretPlaceholders.has(collidedToken)).toBe(false)

      // A demoted token leaks NO candidate original anywhere in the index.
      const serialized = JSON.stringify({
        placeholders: [...result.placeholders.entries()],
        secretPlaceholders: [...result.secretPlaceholders],
        sessions: result.sessions,
      })
      expect(serialized.includes(COLLISION_ORIGINAL_ONE)).toBe(false)
      expect(serialized.includes(COLLISION_ORIGINAL_TWO)).toBe(false)
    })

    it('keeps a demoted placeholder demoted when a third session re-carries the first original (sticky demotion)', async () => {
      // Arrange — three sessions claim P as O1, O2, O1. A bare delete-only
      // fix would let a later occurrence re-enter the index (existing ===
      // undefined after the delete); the sticky Set must hold in EVERY
      // readdir order, so no map-iteration-order assumption is made here.
      const baseDir = await freshBaseDir()
      await persistHandBuiltMap(baseDir, randomUUID(), [
        {
          type: 'WORD',
          counter: 1,
          placeholder: collidedToken,
          original: COLLISION_ORIGINAL_ONE,
        },
      ])
      await persistHandBuiltMap(baseDir, randomUUID(), [
        {
          type: 'WORD',
          counter: 1,
          placeholder: collidedToken,
          original: COLLISION_ORIGINAL_TWO,
        },
      ])
      await persistHandBuiltMap(baseDir, randomUUID(), [
        {
          type: 'WORD',
          counter: 1,
          placeholder: collidedToken,
          original: COLLISION_ORIGINAL_ONE,
        },
      ])

      // Act
      const result = await buildRestoreIndex(baseDir)

      // Assert — non-vacuity FIRST: all three maps really decrypted
      expect(result.sessions).toBe(3)
      expect(result.placeholders.has(collidedToken)).toBe(false)
      expect(result.secretPlaceholders.has(collidedToken)).toBe(false)
      expect([...result.placeholders.values()]).not.toContain(COLLISION_ORIGINAL_ONE)
      expect([...result.placeholders.values()]).not.toContain(COLLISION_ORIGINAL_TWO)
    })

    it('restores normally when two sessions agree on the SAME original (benign duplicate, not a collision)', async () => {
      // Arrange — idempotent re-set: same placeholder, same original
      const baseDir = await freshBaseDir()
      await persistHandBuiltMap(baseDir, randomUUID(), [
        {
          type: 'WORD',
          counter: 1,
          placeholder: collidedToken,
          original: COLLISION_ORIGINAL_ONE,
        },
      ])
      await persistHandBuiltMap(baseDir, randomUUID(), [
        {
          type: 'WORD',
          counter: 1,
          placeholder: collidedToken,
          original: COLLISION_ORIGINAL_ONE,
        },
      ])

      // Act
      const result = await buildRestoreIndex(baseDir)

      // Assert — non-vacuity first, then the agreed pair restores normally
      expect(result.sessions).toBe(2)
      expect(result.placeholders.get(collidedToken)).toBe(COLLISION_ORIGINAL_ONE)
    })
  })
})
