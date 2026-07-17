/**
 * REVMODE-02 unit proof: the encrypted map store corruption matrix (09-03).
 *
 * Every byte that reaches disk in reversible mode flows through
 * src/state/map-store.ts — the single crypto+I/O chokepoint. This suite pins:
 *
 *   - the AES-256-GCM envelope contract: MRCLNMAP(8) | 0x01(1) | IV(12) |
 *     tag(16) | ciphertext(N), AAD = `mrclean-map-v1:<sid>`, with magic /
 *     version / total-length validation BEFORE any slice
 *   - the DEP0182 guard: a truncated auth tag is rejected, never silently
 *     accepted (window verified OPEN on Node 22.22.0 — RESEARCH Pitfall 1)
 *   - fresh 12-byte IV per encryption event (D-03) — two writes never share
 *     envelope bytes
 *   - key custody (D-04): wx create-once 0600 key inside a 0700 keys/ dir,
 *     separate from the 0700 sessions/ dir; loser-reads-winner on EEXIST
 *   - the TOTAL-ERROR read policy (Pitfall 6): every corruption shape —
 *     missing / short / garbage / tampered / wrong-AAD / wrong-key /
 *     non-JSON / schema-fail / EISDIR / EACCES — returns null (ABSENT),
 *     never throws
 *   - SC1 at the byte level: raw .map files are ciphertext-only (no original
 *     values, no '"entries"' JSON marker, no 'MRCLEAN:' placeholder text)
 *
 * All fs cases run against a per-test tmpdir baseDir — never the real
 * ~/.mrclean (injection precedent: LoadConfigOpts.homeDir).
 *
 * DOCUMENTED GAP (RESEARCH Pitfall 8): chmod modes are advisory-only on
 * win32, so 0600/0700 assertions and the chmod-000 EACCES case are
 * POSIX-only and skipped on win32. The store still WRITES the modes there;
 * the OS just does not enforce them.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MIN_ENVELOPE,
  decryptMapBuffer,
  encryptMapBuffer,
  ensureSessionKey,
  keyPathFor,
  mapPathFor,
  readSessionMapFile,
  statePaths,
  writeSessionMapFile,
} from '../../src/state/map-store.js'
import {
  createEmptySessionMap,
  formatV2Token,
  hmacAddress,
  makeMapEntry,
  type RestorableMapEntry,
  type SessionMapV1,
} from '../../src/state/session-map.js'

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

/** win32 modes are advisory-only — POSIX-only assertions (Pitfall 8 gap). */
const IS_WIN32 = process.platform === 'win32'
/** root bypasses permission bits — chmod-000 EACCES is meaningless as uid 0. */
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0

/** Restorable (WORD) original — must NEVER appear in raw file bytes (SC1). */
const CANARY_ORIGINAL = 'CANARY-original-xyz'
/** Secret-class original — never persisted at all (D-11 floor, 09-02). */
const SECRET_ORIGINAL = 'AKIAIOSFODNN7CANARY9'

/**
 * Envelope offsets mirrored from the store contract (RESEARCH Pattern 1).
 * Corrupt envelopes below are hand-built against these EXACT offsets.
 */
const ENVELOPE_MAGIC = 'MRCLNMAP' // 8 bytes
const VERSION_OFFSET = 8
const IV_OFFSET = 9
const TAG_OFFSET = 21 // IV_OFFSET + 12
const CT_OFFSET = 37 // TAG_OFFSET + 16
const KEY_BYTES = 32
const TRUNCATED_TAG_BYTES = 4 // the DEP0182 hazard shape

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Fixture map: one restorable WORD entry + one secret-class AWS_KEY entry. */
function buildFixtureMap(sid: string): SessionMapV1 {
  const base = createEmptySessionMap(sid)
  const wordAddress = hmacAddress(base.hashSalt, CANARY_ORIGINAL)
  const secretAddress = hmacAddress(base.hashSalt, SECRET_ORIGINAL)
  return {
    ...base,
    counter: 2,
    entries: {
      [wordAddress]: makeMapEntry(
        'WORD',
        formatV2Token('WORD', 1, base.nonce8),
        1,
        CANARY_ORIGINAL,
      ),
      [secretAddress]: makeMapEntry(
        'AWS_KEY',
        formatV2Token('AWS_KEY', 2, base.nonce8),
        2,
        SECRET_ORIGINAL,
      ),
    },
  }
}

/** Plant raw bytes at the sid's map path (creating sessions/ if needed). */
async function plantMapBytes(baseDir: string, sid: string, bytes: Buffer): Promise<void> {
  await mkdir(statePaths(baseDir).sessionsDir, { recursive: true, mode: 0o700 })
  await writeFile(mapPathFor(baseDir, sid), bytes)
}

/** A written-and-verified valid on-disk state for corruption tests. */
async function writeValidState(
  baseDir: string,
  sid: string,
): Promise<{ key: Buffer; map: SessionMapV1 }> {
  const key = await ensureSessionKey(baseDir, sid)
  const map = buildFixtureMap(sid)
  await writeSessionMapFile(baseDir, sid, map, key)
  return { key, map }
}

/**
 * Hand-build an envelope whose total length implies a SHORT tag:
 * magic(8) | version(1) | IV(12) | tag(4) | ct(1) = 26 bytes < MIN_ENVELOPE.
 * The length pre-validation must reject this before any slice happens.
 */
function buildTruncatedTagEnvelope(): Buffer {
  return Buffer.concat([
    Buffer.from(ENVELOPE_MAGIC),
    Buffer.from([1]),
    randomBytes(12),
    randomBytes(TRUNCATED_TAG_BYTES),
    Buffer.from([0x42]),
  ])
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('map-store', () => {
  let baseDir: string
  let sid: string

  beforeEach(async () => {
    // Arrange (shared): isolated per-test baseDir — never the real ~/.mrclean
    baseDir = join(tmpdir(), `mrclean-state-${randomUUID()}`)
    sid = randomUUID()
    await mkdir(baseDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // Paths (D-04 layout: keys/ and sessions/ are SEPARATE directories)
  // -------------------------------------------------------------------------

  describe('paths', () => {
    it('derives keysDir, sessionsDir, key path and map path from baseDir', () => {
      // Act
      const paths = statePaths(baseDir)

      // Assert — key and ciphertext live in different directories (D-04)
      expect(paths.keysDir).toBe(join(baseDir, 'keys'))
      expect(paths.sessionsDir).toBe(join(baseDir, 'sessions'))
      expect(keyPathFor(baseDir, sid)).toBe(join(baseDir, 'keys', `${sid}.key`))
      expect(mapPathFor(baseDir, sid)).toBe(join(baseDir, 'sessions', `${sid}.map`))
    })
  })

  // -------------------------------------------------------------------------
  // Envelope: encryptMapBuffer / decryptMapBuffer (RESEARCH Pattern 1)
  // -------------------------------------------------------------------------

  describe('envelope encrypt/decrypt', () => {
    it('exposes MIN_ENVELOPE = 38 (magic 8 + version 1 + IV 12 + tag 16 + >=1 ct byte)', () => {
      expect(MIN_ENVELOPE).toBe(8 + 1 + 12 + 16 + 1)
    })

    it('roundtrips plaintext through encrypt then decrypt', () => {
      // Arrange
      const key = randomBytes(KEY_BYTES)
      const plaintext = Buffer.from(`payload-with-${CANARY_ORIGINAL}`)

      // Act
      const envelope = encryptMapBuffer(plaintext, key, sid)
      const decrypted = decryptMapBuffer(envelope, key, sid)

      // Assert
      expect(envelope.subarray(0, 8).toString()).toBe(ENVELOPE_MAGIC)
      expect(envelope[VERSION_OFFSET]).toBe(1)
      expect(decrypted.equals(plaintext)).toBe(true)
    })

    it('uses a fresh IV per encryption event — two envelopes of the same plaintext differ (D-03)', () => {
      // Arrange
      const key = randomBytes(KEY_BYTES)
      const plaintext = Buffer.from('same plaintext both times')

      // Act
      const first = encryptMapBuffer(plaintext, key, sid)
      const second = encryptMapBuffer(plaintext, key, sid)

      // Assert — IV region (bytes 9..21) AND ciphertext region both diverge
      expect(first.subarray(IV_OFFSET, TAG_OFFSET).equals(second.subarray(IV_OFFSET, TAG_OFFSET))).toBe(
        false,
      )
      expect(first.subarray(CT_OFFSET).equals(second.subarray(CT_OFFSET))).toBe(false)
    })

    it('throws on an envelope whose total length implies a truncated tag (length gate before slicing)', () => {
      // Arrange
      const key = randomBytes(KEY_BYTES)
      const truncated = buildTruncatedTagEnvelope()

      // Assert — 26 bytes < MIN_ENVELOPE: rejected by pre-validation, no slice
      expect(truncated.length).toBeLessThan(MIN_ENVELOPE)
      expect(() => decryptMapBuffer(truncated, key, sid)).toThrow()
    })

    it('rejects a 4-byte truncated tag even when the envelope passes the length gate (DEP0182)', () => {
      // Arrange — a syntactically-plausible envelope: real encryption whose tag
      // region keeps only its first 4 bytes, ciphertext shifted up. Total length
      // still >= MIN_ENVELOPE, so only the authenticated decrypt can reject it.
      // Without the fixed-offset slice + authTagLength: 16 discipline this is
      // exactly the shape DEP0182 lets through (verified OPEN on Node 22.22.0).
      const key = randomBytes(KEY_BYTES)
      const plaintext = Buffer.from(JSON.stringify({ pad: 'x'.repeat(64) }))
      const valid = encryptMapBuffer(plaintext, key, sid)
      const spliced = Buffer.concat([
        valid.subarray(0, TAG_OFFSET), // magic | version | IV
        valid.subarray(TAG_OFFSET, TAG_OFFSET + TRUNCATED_TAG_BYTES), // 4 tag bytes only
        valid.subarray(CT_OFFSET), // ciphertext
      ])

      // Act + Assert
      expect(spliced.length).toBeGreaterThanOrEqual(MIN_ENVELOPE)
      expect(() => decryptMapBuffer(spliced, key, sid)).toThrow()
    })

    it('throws on bad magic', () => {
      // Arrange
      const key = randomBytes(KEY_BYTES)
      const envelope = encryptMapBuffer(Buffer.from('data'), key, sid)
      const badMagic = Buffer.from(envelope)
      badMagic.write('XXXXXXXX', 0)

      // Act + Assert
      expect(() => decryptMapBuffer(badMagic, key, sid)).toThrow()
    })

    it('throws on an unknown envelope version', () => {
      // Arrange
      const key = randomBytes(KEY_BYTES)
      const envelope = encryptMapBuffer(Buffer.from('data'), key, sid)
      const badVersion = Buffer.from(envelope)
      badVersion[VERSION_OFFSET] = 2

      // Act + Assert
      expect(() => decryptMapBuffer(badVersion, key, sid)).toThrow()
    })

    it('throws when a single ciphertext byte is flipped (GCM auth)', () => {
      // Arrange
      const key = randomBytes(KEY_BYTES)
      const envelope = encryptMapBuffer(Buffer.from('tamper me'), key, sid)
      const tampered = Buffer.from(envelope)
      tampered[CT_OFFSET] = tampered[CT_OFFSET]! ^ 0x01

      // Act + Assert
      expect(() => decryptMapBuffer(tampered, key, sid)).toThrow()
    })

    it('throws when decrypting under another session id (AAD binds sid)', () => {
      // Arrange
      const key = randomBytes(KEY_BYTES)
      const otherSid = randomUUID()
      const envelope = encryptMapBuffer(Buffer.from('bound to sid'), key, sid)

      // Act + Assert
      expect(() => decryptMapBuffer(envelope, key, otherSid)).toThrow()
    })

    it('throws when decrypting with a different 32-byte key', () => {
      // Arrange
      const envelope = encryptMapBuffer(Buffer.from('keyed'), randomBytes(KEY_BYTES), sid)

      // Act + Assert
      expect(() => decryptMapBuffer(envelope, randomBytes(KEY_BYTES), sid)).toThrow()
    })

    it('never leaks plaintext into thrown error messages (hash-only discipline)', () => {
      // Arrange — plaintext holds the canary; tamper forces the auth failure
      const key = randomBytes(KEY_BYTES)
      const envelope = encryptMapBuffer(Buffer.from(CANARY_ORIGINAL), key, sid)
      const tampered = Buffer.from(envelope)
      tampered[CT_OFFSET] = tampered[CT_OFFSET]! ^ 0xff

      // Act + Assert
      try {
        decryptMapBuffer(tampered, key, sid)
        expect.unreachable('tampered envelope must throw')
      } catch (err) {
        expect(String(err)).not.toContain(CANARY_ORIGINAL)
        expect(String((err as Error).stack ?? '')).not.toContain(CANARY_ORIGINAL)
      }
    })
  })

  // -------------------------------------------------------------------------
  // Key custody: ensureSessionKey (D-04, RESEARCH Code Example 2)
  // -------------------------------------------------------------------------

  describe('ensureSessionKey', () => {
    it('creates a 32-byte key and returns identical bytes on a second call', async () => {
      // Act
      const first = await ensureSessionKey(baseDir, sid)
      const second = await ensureSessionKey(baseDir, sid)

      // Assert — create-once: the winner's bytes are stable across calls
      expect(first.length).toBe(KEY_BYTES)
      expect(first.equals(second)).toBe(true)
    })

    it('returns the pre-existing winner bytes on EEXIST (loser-reads-winner)', async () => {
      // Arrange — a "winner" process already created the key file
      const winnersKey = randomBytes(KEY_BYTES)
      await mkdir(statePaths(baseDir).keysDir, { recursive: true, mode: 0o700 })
      await writeFile(keyPathFor(baseDir, sid), winnersKey, { mode: 0o600 })

      // Act
      const key = await ensureSessionKey(baseDir, sid)

      // Assert — the loser adopted the winner's exact bytes
      expect(key.equals(winnersKey)).toBe(true)
    })

    it.skipIf(IS_WIN32)('creates the key file 0600 inside a 0700 keys dir (POSIX)', async () => {
      // Act
      await ensureSessionKey(baseDir, sid)

      // Assert — win32 skipped: modes advisory-only there (Pitfall 8 gap)
      const keyStat = await stat(keyPathFor(baseDir, sid))
      const dirStat = await stat(statePaths(baseDir).keysDir)
      expect(keyStat.mode & 0o777).toBe(0o600)
      expect(dirStat.mode & 0o777).toBe(0o700)
    })
  })

  // -------------------------------------------------------------------------
  // writeSessionMapFile + readSessionMapFile happy paths
  // -------------------------------------------------------------------------

  describe('write + read roundtrip', () => {
    it('roundtrips a map deep-equal; restorable original survives; secret entry lacks original', async () => {
      // Arrange
      const { map } = await writeValidState(baseDir, sid)

      // Act
      const readBack = await readSessionMapFile(baseDir, sid)

      // Assert
      expect(readBack).not.toBeNull()
      expect(readBack).toEqual(map)
      const wordAddress = hmacAddress(map.hashSalt, CANARY_ORIGINAL)
      const secretAddress = hmacAddress(map.hashSalt, SECRET_ORIGINAL)
      const wordEntry = readBack!.entries[wordAddress] as RestorableMapEntry
      expect(wordEntry.original).toBe(CANARY_ORIGINAL)
      // Secret floor (SC3 shape): the PROPERTY is absent — never null/empty
      expect('original' in readBack!.entries[secretAddress]!).toBe(false)
    })

    it('writes a fresh IV per write — two writes of the same map produce different envelopes (D-03)', async () => {
      // Arrange
      const { key, map } = await writeValidState(baseDir, sid)
      const first = await readFile(mapPathFor(baseDir, sid))

      // Act
      await writeSessionMapFile(baseDir, sid, map, key)
      const second = await readFile(mapPathFor(baseDir, sid))

      // Assert — IV region (bytes 9..21) and ciphertext region both diverge
      expect(first.subarray(IV_OFFSET, TAG_OFFSET).equals(second.subarray(IV_OFFSET, TAG_OFFSET))).toBe(
        false,
      )
      expect(first.subarray(CT_OFFSET).equals(second.subarray(CT_OFFSET))).toBe(false)
    })

    it('leaves only ciphertext on disk — no originals, no JSON markers, no placeholder text (SC1)', async () => {
      // Arrange
      await writeValidState(baseDir, sid)

      // Act
      const raw = await readFile(mapPathFor(baseDir, sid))

      // Assert — the magic header is the ONLY expected plaintext marker
      expect(raw.subarray(0, 8).toString()).toBe(ENVELOPE_MAGIC)
      expect(raw.includes(CANARY_ORIGINAL)).toBe(false)
      expect(raw.includes(SECRET_ORIGINAL)).toBe(false)
      expect(raw.includes('"entries"')).toBe(false)
      expect(raw.includes('MRCLEAN:')).toBe(false)
    })

    it.skipIf(IS_WIN32)('creates the map file 0600 inside a 0700 sessions dir (POSIX)', async () => {
      // Arrange + Act
      await writeValidState(baseDir, sid)

      // Assert — win32 skipped: modes advisory-only there (Pitfall 8 gap)
      const mapStat = await stat(mapPathFor(baseDir, sid))
      const dirStat = await stat(statePaths(baseDir).sessionsDir)
      expect(mapStat.mode & 0o777).toBe(0o600)
      expect(dirStat.mode & 0o777).toBe(0o700)
    })
  })

  // -------------------------------------------------------------------------
  // TOTAL-ERROR read policy (Pitfall 6): every corruption shape => null.
  // NO case below may expect a throw from readSessionMapFile.
  // -------------------------------------------------------------------------

  describe('readSessionMapFile total-error policy', () => {
    it('returns null when nothing was ever written (ENOENT)', async () => {
      // Act
      const result = await readSessionMapFile(baseDir, sid)

      // Assert
      expect(result).toBeNull()
    })

    it('returns null for a file whose length implies a truncated tag', async () => {
      // Arrange — valid key, hand-built 26-byte truncated-tag envelope on disk
      await ensureSessionKey(baseDir, sid)
      await plantMapBytes(baseDir, sid, buildTruncatedTagEnvelope())

      // Act + Assert
      expect(await readSessionMapFile(baseDir, sid)).toBeNull()
    })

    it('returns null when one ciphertext byte of a valid file is flipped', async () => {
      // Arrange
      await writeValidState(baseDir, sid)
      const raw = await readFile(mapPathFor(baseDir, sid))
      const tampered = Buffer.from(raw)
      tampered[CT_OFFSET] = tampered[CT_OFFSET]! ^ 0x01
      await plantMapBytes(baseDir, sid, tampered)

      // Act + Assert
      expect(await readSessionMapFile(baseDir, sid)).toBeNull()
    })

    it('returns null when another session\'s map+key are copied under this sid (AAD binds sid)', async () => {
      // Arrange — sidA's valid state copied byte-for-byte to sidB's names
      const sidA = sid
      const sidB = randomUUID()
      await writeValidState(baseDir, sidA)
      await copyFile(mapPathFor(baseDir, sidA), mapPathFor(baseDir, sidB))
      await copyFile(keyPathFor(baseDir, sidA), keyPathFor(baseDir, sidB))

      // Act + Assert — same key material, wrong AAD => absent
      expect(await readSessionMapFile(baseDir, sidB)).toBeNull()
      // Control: the original sid still reads fine
      expect(await readSessionMapFile(baseDir, sidA)).not.toBeNull()
    })

    it('returns null when the key file holds a different 32-byte key', async () => {
      // Arrange
      await writeValidState(baseDir, sid)
      await writeFile(keyPathFor(baseDir, sid), randomBytes(KEY_BYTES), { mode: 0o600 })

      // Act + Assert
      expect(await readSessionMapFile(baseDir, sid)).toBeNull()
    })

    it('returns null for a short file', async () => {
      // Arrange
      await ensureSessionKey(baseDir, sid)
      await plantMapBytes(baseDir, sid, randomBytes(10))

      // Act + Assert
      expect(await readSessionMapFile(baseDir, sid)).toBeNull()
    })

    it('returns null for a garbage file that passes the length gate', async () => {
      // Arrange — >= MIN_ENVELOPE random bytes, bad magic
      await ensureSessionKey(baseDir, sid)
      await plantMapBytes(baseDir, sid, randomBytes(128))

      // Act + Assert
      expect(await readSessionMapFile(baseDir, sid)).toBeNull()
    })

    it('returns null for an empty file', async () => {
      // Arrange
      await ensureSessionKey(baseDir, sid)
      await plantMapBytes(baseDir, sid, Buffer.alloc(0))

      // Act + Assert
      expect(await readSessionMapFile(baseDir, sid)).toBeNull()
    })

    it('returns null for valid crypto over non-JSON plaintext', async () => {
      // Arrange — a well-formed envelope whose plaintext is not JSON
      const key = await ensureSessionKey(baseDir, sid)
      const envelope = encryptMapBuffer(Buffer.from('definitely not json'), key, sid)
      await plantMapBytes(baseDir, sid, envelope)

      // Act + Assert
      expect(await readSessionMapFile(baseDir, sid)).toBeNull()
    })

    it('returns null for valid crypto over JSON that fails the schema guard', async () => {
      // Arrange — parses as JSON but is not a SessionMapV1 (wrong version)
      const key = await ensureSessionKey(baseDir, sid)
      const bogus = Buffer.from(JSON.stringify({ version: 2, entries: {} }))
      await plantMapBytes(baseDir, sid, encryptMapBuffer(bogus, key, sid))

      // Act + Assert
      expect(await readSessionMapFile(baseDir, sid)).toBeNull()
    })

    it('returns null when the map path is a DIRECTORY', async () => {
      // Arrange
      await ensureSessionKey(baseDir, sid)
      await mkdir(mapPathFor(baseDir, sid), { recursive: true })

      // Act + Assert — EISDIR lands in the same total-error policy
      expect(await readSessionMapFile(baseDir, sid)).toBeNull()
    })

    it.skipIf(IS_WIN32 || IS_ROOT)('returns null when the map file is chmod 000 (POSIX)', async () => {
      // Arrange — win32 skipped (advisory modes, Pitfall 8 gap); root skipped
      // (uid 0 bypasses permission bits, EACCES never fires)
      await writeValidState(baseDir, sid)
      await chmod(mapPathFor(baseDir, sid), 0o000)

      // Act + Assert — EACCES => absent, never a throw
      expect(await readSessionMapFile(baseDir, sid)).toBeNull()
    })

    it('returns null when the key file is missing but the map exists', async () => {
      // Arrange
      await writeValidState(baseDir, sid)
      await unlink(keyPathFor(baseDir, sid))

      // Act + Assert
      expect(await readSessionMapFile(baseDir, sid)).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Source-level pins — mechanical regression gates for the two load-bearing
  // option literals (precedent: tests/detect/ner-unreachable.test.ts reads
  // source text as proof). Phase 11 elevates the chaos matrix to CI gates.
  // -------------------------------------------------------------------------

  describe('source-level pins', () => {
    it('pins exactly one `authTagLength: 16` decrypt construction and the `fsync: false` write override', async () => {
      // Arrange
      const source = await readFile(
        new URL('../../src/state/map-store.ts', import.meta.url),
        'utf8',
      )

      // Assert — DEP0182 guard present exactly once (single decrypt chokepoint)
      const tagLines = source
        .split('\n')
        .filter((line) => line.includes('authTagLength: 16'))
      expect(tagLines).toHaveLength(1)
      // wfa defaults fsync:true — the override is load-bearing (Pitfall 2)
      expect(source).toContain('fsync: false')
    })
  })
})
