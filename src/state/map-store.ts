/**
 * Encrypted session-map store: envelope crypto + key custody + atomic
 * ciphertext writes (REVMODE-02, plan 09-03).
 *
 * SINGLE CRYPTO+I/O CHOKEPOINT — no cipher (createCipheriv/createDecipheriv)
 * or lock imports may exist outside src/state/ (import-graph fence enforced
 * by 09-07's cold-path test). Every byte of session-map state that touches
 * disk flows through this module.
 *
 * Envelope layout (RESEARCH Pattern 1, verified live on Node 22.22.0):
 *
 *   MRCLNMAP(8) | version 0x01(1) | IV(12) | authTag(16) | ciphertext(N)
 *
 * AAD = `mrclean-map-v1:<sessionId>` — a map file renamed to another
 * session's name fails authentication (spoof fence, T-09-03-02).
 *
 * Key custody (D-04): per-session random 256-bit key at
 * <baseDir>/keys/<sid>.key (0600 inside 0700 keys/), ciphertext at
 * <baseDir>/sessions/<sid>.map (0600 inside 0700 sessions/) — key and
 * ciphertext live in DIFFERENT directories. Key content is pure
 * randomBytes(32), never derived from sid/hostname/env.
 *
 * NOT here by design: locking (09-05's lock.ts owns proper-lockfile) and
 * sid validation (the 09-05 facade gates raw hook input via
 * isValidSessionId — Pitfall 5; path helpers below document that
 * precondition instead of re-validating).
 *
 * win32 documented gap (Pitfall 8): 0600/0700 modes are advisory-only on
 * win32 — the store still writes them; NTFS simply does not enforce POSIX
 * permission bits. POSIX tests assert modes; win32 skips with this note.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import writeFileAtomic from 'write-file-atomic'

import { parseSessionMap, serializeSessionMap, type SessionMapV1 } from './session-map.js'

// ---------------------------------------------------------------------------
// Envelope layout constants (fixed offsets — validate BEFORE slicing)
// ---------------------------------------------------------------------------

const ENVELOPE_MAGIC = Buffer.from('MRCLNMAP') // 8 bytes
const ENVELOPE_VERSION = 1
const VERSION_OFFSET = 8
const IV_LENGTH = 12
const IV_OFFSET = VERSION_OFFSET + 1 // 9
const TAG_LENGTH = 16
const TAG_OFFSET = IV_OFFSET + IV_LENGTH // 21
const CIPHERTEXT_OFFSET = TAG_OFFSET + TAG_LENGTH // 37

/** Minimum valid envelope: magic | version | IV | tag | >= 1 ciphertext byte. */
export const MIN_ENVELOPE = ENVELOPE_MAGIC.length + 1 + IV_LENGTH + TAG_LENGTH + 1

const AAD_PREFIX = 'mrclean-map-v1:'
const KEY_BYTES = 32
const DIR_MODE = 0o700
const FILE_MODE = 0o600

// ---------------------------------------------------------------------------
// Paths (D-04 layout)
// ---------------------------------------------------------------------------

export interface StatePaths {
  keysDir: string
  sessionsDir: string
}

/**
 * Derive the two state directories from a base dir.
 *
 * baseDir contract: `join(homedir(), '.mrclean')` in production; ALWAYS
 * injected in tests — nothing in this module may touch the real home.
 */
export function statePaths(baseDir: string): StatePaths {
  return { keysDir: join(baseDir, 'keys'), sessionsDir: join(baseDir, 'sessions') }
}

/**
 * Key file path for a session.
 *
 * PRECONDITION (documented, not re-validated here): sid already passed
 * isValidSessionId at the facade boundary (Pitfall 5) — these helpers never
 * see raw hook input directly.
 */
export function keyPathFor(baseDir: string, sid: string): string {
  return join(statePaths(baseDir).keysDir, `${sid}.key`)
}

/** Map (ciphertext) file path for a session. Same sid precondition as keyPathFor. */
export function mapPathFor(baseDir: string, sid: string): string {
  return join(statePaths(baseDir).sessionsDir, `${sid}.map`)
}

// ---------------------------------------------------------------------------
// Envelope encrypt/decrypt (RESEARCH Code Example 1 — verified live)
// ---------------------------------------------------------------------------

/**
 * Internally-typed envelope failure. Reason strings are static shape
 * descriptions ONLY — never plaintext, key bytes, or file contents
 * (hash-only discipline). The 09-05 facade wraps every throw from this
 * module into map-ABSENT; readSessionMapFile below already does.
 */
class MapEnvelopeError extends Error {
  constructor(reason: string) {
    super(`mrclean map envelope invalid: ${reason}`)
    this.name = 'MapEnvelopeError'
  }
}

function aadFor(sessionId: string): Buffer {
  return Buffer.from(`${AAD_PREFIX}${sessionId}`)
}

/**
 * Encrypt a plaintext map buffer into a self-framing envelope.
 *
 * IV is fresh CSPRNG per encryption event — never stored, never reused
 * (D-03 / T-09-03-05); two encryptions of identical plaintext produce
 * entirely different envelopes.
 */
export function encryptMapBuffer(plaintext: Buffer, key: Buffer, sessionId: string): Buffer {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aadFor(sessionId))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([
    ENVELOPE_MAGIC,
    Buffer.from([ENVELOPE_VERSION]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ])
}

/**
 * Decrypt an envelope. Throws (internally-typed or OpenSSL auth error) on
 * ANY invalidity — short/garbage input, bad magic/version, truncated tag,
 * tamper, wrong AAD (other sid), wrong key. Callers wrap to ABSENT.
 *
 * Validation order is load-bearing (Pitfall 1): total length, magic and
 * version are checked BEFORE any slice, so a short file fails the length
 * gate and can never produce a short tag slice.
 */
export function decryptMapBuffer(envelope: Buffer, key: Buffer, sessionId: string): Buffer {
  if (envelope.length < MIN_ENVELOPE) {
    throw new MapEnvelopeError('short envelope')
  }
  if (!envelope.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC)) {
    throw new MapEnvelopeError('bad magic')
  }
  if (envelope[VERSION_OFFSET] !== ENVELOPE_VERSION) {
    throw new MapEnvelopeError('bad version')
  }
  const iv = envelope.subarray(IV_OFFSET, TAG_OFFSET)
  const tag = envelope.subarray(TAG_OFFSET, CIPHERTEXT_OFFSET) // exactly 16 — length pre-validated
  // DEP0182 guard (Pitfall 1, window verified OPEN on Node 22.22.0): without
  // an explicit tag length, createDecipheriv silently ACCEPTS truncated auth
  // tags, dropping forgery resistance to 2^-32 at 4 bytes. This is the single
  // decrypt construction in the codebase.
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  decipher.setAAD(aadFor(sessionId))
  decipher.setAuthTag(tag)
  // update + final throw on tamper / wrong key / wrong AAD (GCM auth).
  return Buffer.concat([decipher.update(envelope.subarray(CIPHERTEXT_OFFSET)), decipher.final()])
}

// ---------------------------------------------------------------------------
// Key custody (RESEARCH Code Example 2 — verified live)
// ---------------------------------------------------------------------------

/**
 * Internally-typed key-custody failure. Reason strings are static shape
 * descriptions ONLY — never key bytes or paths (hash-only discipline). The
 * 09-05 facade's write path catches this and degrades.
 */
class SessionKeyError extends Error {
  constructor(reason: string) {
    super(`mrclean session key invalid: ${reason}`)
    this.name = 'SessionKeyError'
  }
}

/** Read the key file, or null when it does not exist. Other fs failures
 *  (EACCES, EISDIR, …) propagate — the facade owns degrade semantics. */
async function readKeyIfPresent(keyPath: string): Promise<Buffer | null> {
  try {
    return await readFile(keyPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw err
  }
}

/**
 * Publish a fully-written key file atomically with create-once semantics
 * (WR-03): the 32 bytes land in a private `<keyPath>.<uint32>` tmp first
 * (0600, wx), then link(2) makes them visible at keyPath in ONE step — link
 * fails with EEXIST when another process already published, preserving the
 * wx winner/loser contract WITHOUT the open-then-write torn window. The tmp
 * name matches the janitor's `<uuid>.key.<digits>` litter shape, so a crash
 * between write and link is swept after the orphan grace.
 */
async function publishKeyOnce(keyPath: string, key: Buffer): Promise<boolean> {
  const tmpPath = `${keyPath}.${randomBytes(4).readUInt32BE(0)}`
  await writeFile(tmpPath, key, { flag: 'wx', mode: FILE_MODE })
  try {
    await link(tmpPath, keyPath)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return false
    }
    throw err
  } finally {
    await unlink(tmpPath).catch(() => {})
  }
}

/** Bounded read → (self-heal) → publish → re-read attempts. */
const KEY_ENSURE_ATTEMPTS = 2

/**
 * Ensure the per-session key exists and return its 32 bytes.
 *
 * Create-once is ATOMIC (WR-03): key bytes are fully written to a private
 * tmp file and published with link(2) — there is NO window in which keyPath
 * exists with partial content, and losers (link EEXIST) read the winner's
 * complete bytes, so every process ends up with identical key material
 * (D-04). Key content is pure CSPRNG — never derived from sid/hostname/env
 * (T-09-03-04).
 *
 * The read-back validates length (WR-03): a wrong-length key file (torn
 * write from a pre-fix version, local corruption) is treated as ABSENT and
 * healed by unlink-and-recreate — without this, a torn key silently
 * degrades EVERY event until the TTL sweep. Production callers run inside
 * the map lock, which serializes the heal; the retry is bounded.
 *
 * May throw on unexpected fs failures (e.g. EACCES) — the 09-05 facade owns
 * degrade semantics for the write path; only readSessionMapFile is total.
 */
export async function ensureSessionKey(baseDir: string, sid: string): Promise<Buffer> {
  const { keysDir } = statePaths(baseDir)
  await mkdir(keysDir, { recursive: true, mode: DIR_MODE })
  const keyPath = keyPathFor(baseDir, sid)

  for (let attempt = 0; attempt < KEY_ENSURE_ATTEMPTS; attempt += 1) {
    const existing = await readKeyIfPresent(keyPath)
    if (existing !== null && existing.length === KEY_BYTES) {
      return existing
    }
    if (existing !== null) {
      // Wrong-length key: treated as ABSENT (fail-safe — nothing encrypted
      // under a broken key was ever readable) and removed so the publish
      // below can recreate it. ENOENT here means a concurrent healer won.
      try {
        await unlink(keyPath)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err
        }
      }
    }
    const fresh = randomBytes(KEY_BYTES)
    if (await publishKeyOnce(keyPath, fresh)) {
      return fresh
    }
    // EEXIST loser: another process published a complete key first — the
    // next iteration reads the winner's bytes (whole-file visibility is
    // guaranteed by link atomicity).
  }
  throw new SessionKeyError('unreadable after publish attempts')
}

// ---------------------------------------------------------------------------
// Map file read/write
// ---------------------------------------------------------------------------

/**
 * Read and decrypt a session map, or null when anything at all is wrong.
 *
 * TOTAL-ERROR POLICY (Pitfall 6): ONE try/catch covers the entire chain —
 * key read, envelope read, length/magic/version checks, decrypt, utf8
 * decode, schema guard. Every failure class (ENOENT / EACCES / EISDIR /
 * short envelope / GCM tag fail / wrong AAD / bad JSON / bad schema /
 * missing key) lands in the SAME null return: map ABSENT. No throw is
 * reachable from this function and there is deliberately no per-failure
 * branching — an uncaught throw would become a blocking exit-2 on
 * PreToolUse via the fail-closed crash guards.
 */
export async function readSessionMapFile(
  baseDir: string,
  sid: string,
): Promise<SessionMapV1 | null> {
  try {
    const key = await readFile(keyPathFor(baseDir, sid))
    const envelope = await readFile(mapPathFor(baseDir, sid))
    const plaintext = decryptMapBuffer(envelope, key, sid)
    return parseSessionMap(plaintext.toString('utf8'))
  } catch {
    return null
  }
}

/**
 * Serialize, encrypt and atomically persist a session map.
 *
 * Plaintext exists ONLY in memory: serialize (which applies the D-11
 * secret-floor strip) -> encrypt under a fresh IV -> hand write-file-atomic
 * ciphertext bytes. No write API ever receives plaintext — temp files
 * included (SC1 / T-09-03-03).
 *
 * fsync: false is load-bearing (Pitfall 2 / T-09-03-06). wfa defaults
 * fsync:true, which costs a flat ~6-8 ms on macOS APFS inside the future
 * 09-05 lock hold — under 16-way contention that breaches the <100 ms hook
 * budget. Safety argument: a crash without an OS crash loses nothing (the
 * rename is ordered through the page cache); an OS crash/power loss can
 * lose recent writes or leave a torn file, and EVERY such state fails GCM
 * auth or the length gate => map ABSENT => cosmetic re-redaction, which
 * D-03 already accepts.
 *
 * NOTE: src/install/atomic-json.ts#atomicWriteJson is deliberately NOT
 * reused here — it writes plaintext JSON with no mode and no fsync control.
 * Only its tmp-in-same-dir + rename PATTERN carries over; write-file-atomic
 * implements it plus win32 EPERM rename retry and signal-exit tmp cleanup.
 */
export async function writeSessionMapFile(
  baseDir: string,
  sid: string,
  map: SessionMapV1,
  key: Buffer,
): Promise<void> {
  const plaintext = Buffer.from(serializeSessionMap(map), 'utf8')
  const envelope = encryptMapBuffer(plaintext, key, sid)
  const { sessionsDir } = statePaths(baseDir)
  await mkdir(sessionsDir, { recursive: true, mode: DIR_MODE })
  await writeFileAtomic(mapPathFor(baseDir, sid), envelope, { fsync: false, mode: FILE_MODE })
}
