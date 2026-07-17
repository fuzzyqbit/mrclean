/**
 * REVMODE-08 degrade matrix for `mrclean restore` — plan 10-05 Task 2.
 *
 * Every cosmetic failure degrades ONE-WAY: stdout === input byte-identical,
 * exactly one constant-shape warning + the counts summary on stderr (no
 * values, no fs-error text, no paths), exit-equivalent 0, and ZERO litter —
 * sessions/ + keys/ listings and per-file mtimes are byte-identical across
 * the run (the TTL heartbeat is never refreshed — Pitfall 7).
 *
 * Rows (a)-(f) are corruption/degrade shapes over REAL ciphertext fixtures
 * (chaos.test.ts recipes, duplicated by value — never imported across test
 * files). Row (g) is ROADMAP SC3's 'locked' clause made DIRECT: a held
 * hook-side proper-lockfile lock never blocks, contends with, or degrades a
 * restore — reads are lock-free by the store's atomic-rename design — and
 * the hook's lock survives the run intact.
 *
 * Non-vacuity: every degrade row's input carries a well-formed v2 token
 * (formatV2Token) asserted PRESENT in stdout — pass-through is never proven
 * against token-free input.
 */

import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import lockfile from 'proper-lockfile'

import { LOCK_OPTS } from '../../src/state/lock.js'
import {
  ensureSessionKey,
  keyPathFor,
  mapPathFor,
  statePaths,
  writeSessionMapFile,
} from '../../src/state/map-store.js'
import {
  createEmptySessionMap,
  formatV2Token,
  hmacAddress,
  makeMapEntry,
  type SessionMapV1,
} from '../../src/state/session-map.js'

// ---------------------------------------------------------------------------
// Platform guards (chaos.test.ts:69-71, duplicated by value)
// ---------------------------------------------------------------------------

/** win32 modes are advisory-only — chmod-000 case is POSIX-only (Pitfall 8). */
const IS_WIN32 = process.platform === 'win32'
/** root bypasses permission bits — chmod-000 EACCES never fires as uid 0. */
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0

// ---------------------------------------------------------------------------
// Fixture constants (chaos.test.ts values, duplicated — never re-derived)
// ---------------------------------------------------------------------------

/** Envelope ciphertext offset: magic(8) + version(1) + IV(12) + tag(16). */
const CT_OFFSET = 37

/** Truncation length safely below MIN_ENVELOPE (38). */
const TRUNCATED_LENGTH = 20

/** Restorable original seeded into every corruptible map. */
const WORD_ORIGINAL = 'degrade-word-original'

// ---------------------------------------------------------------------------
// Pinned stderr copy (byte-locked — must match src/restore/cli.ts exactly)
// ---------------------------------------------------------------------------

const WARN_NO_MAPS = '[mrclean] restore: no readable session map — placeholders left unchanged\n'

function summaryLine(
  restored: number,
  unmatched: number,
  secretSkipped: number,
  sessions: number,
): string {
  return `[mrclean] restore: restored=${restored} unmatched=${unmatched} secret-skipped=${secretSkipped} sessions=${sessions}\n`
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const cleanupDirs: string[] = []

/** Row (g) safety net: a failing row must never poison siblings. */
let pendingRelease: (() => Promise<void>) | null = null

afterEach(async () => {
  if (pendingRelease !== null) {
    try {
      await pendingRelease()
    } catch {
      // already released or compromised — cleanup only
    }
    pendingRelease = null
  }
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTmpDir(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `mrclean-restore-degrade-${prefix}-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  cleanupDirs.push(dir)
  return dir
}

/**
 * Isolated cwd WITH .mrclean/ so the best-effort audit write succeeds
 * silently — the exact-line-count stderr assertions depend on it.
 */
async function makeCwd(): Promise<string> {
  const cwd = await makeTmpDir('cwd')
  await mkdir(join(cwd, '.mrclean'), { recursive: true })
  return cwd
}

/** Seed one REAL encrypted session map with a single WORD entry. */
async function seedSession(baseDir: string): Promise<{ sid: string; token: string }> {
  const sid = randomUUID()
  const base = createEmptySessionMap(sid)
  const token = formatV2Token('WORD', 1, base.nonce8)
  const map: SessionMapV1 = {
    ...base,
    counter: 1,
    entries: {
      [hmacAddress(base.hashSalt, WORD_ORIGINAL)]: makeMapEntry('WORD', token, 1, WORD_ORIGINAL),
    },
  }
  const key = await ensureSessionKey(baseDir, sid)
  await writeSessionMapFile(baseDir, sid, map, key)
  return { sid, token }
}

// ---------------------------------------------------------------------------
// State snapshots (listings + per-file mtimes — Pitfall 7 zero-litter proof;
// inspection.test.ts exact-listing assertion style)
// ---------------------------------------------------------------------------

interface DirSnapshot {
  absent: boolean
  names: string[]
  mtimes: Record<string, number>
}

async function snapshotDir(dir: string): Promise<DirSnapshot> {
  let names: string[]
  try {
    names = (await readdir(dir)).sort()
  } catch {
    return { absent: true, names: [], mtimes: {} }
  }
  const mtimes: Record<string, number> = {}
  for (const name of names) {
    mtimes[name] = (await stat(join(dir, name))).mtimeMs
  }
  return { absent: false, names, mtimes }
}

interface StateSnapshot {
  sessions: DirSnapshot
  keys: DirSnapshot
}

async function snapshotState(baseDir: string): Promise<StateSnapshot> {
  const { sessionsDir, keysDir } = statePaths(baseDir)
  return { sessions: await snapshotDir(sessionsDir), keys: await snapshotDir(keysDir) }
}

/** Drop lock artifacts from an mtime record (holder-owned mtimes, row g). */
function withoutLockEntries(mtimes: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(mtimes).filter(([name]) => !name.endsWith('.lock')))
}

// ---------------------------------------------------------------------------
// Process seam harness (ignore.test.ts:127-152 clone + stdout mirror mock —
// duplicated by value from tests/cli/restore.test.ts, never cross-imported)
// ---------------------------------------------------------------------------

interface CapturedRun {
  stdout: string
  stderr: string
  exitCode: number | undefined
}

async function captureRun(opts: {
  baseDir: string
  cwd: string
  session?: string
  stdin: NodeJS.ReadableStream
}): Promise<CapturedRun> {
  const { runRestore } = await import('../../src/restore/cli.js')

  const originalExit = process.exit
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)
  let exitCode: number | undefined
  let stdout = ''
  let stderr = ''

  process.exit = ((code?: number) => {
    exitCode = code ?? 0
    throw new Error(`process.exit(${code})`)
  }) as typeof process.exit
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk)
    return true
  }) as typeof process.stderr.write

  try {
    await runRestore(opts)
  } catch (err) {
    if (exitCode === undefined) {
      throw err // a real escape — degrade paths must NEVER throw
    }
  } finally {
    process.exit = originalExit
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  }

  return { stdout, stderr, exitCode }
}

// ---------------------------------------------------------------------------
// The shared degrade-shape assertion (rows a-f)
// ---------------------------------------------------------------------------

/**
 * Run restore against a degraded store and assert the FULL one-way shape:
 * byte-identical stdout (token present — non-vacuous), exactly-2-line
 * constant stderr, no exit, and listings + mtimes untouched.
 */
async function assertDegradeShape(opts: {
  baseDir: string
  token: string
  session?: string
}): Promise<void> {
  const cwd = await makeCwd()
  const input = `degrade-head ${opts.token} degrade-tail`
  const before = await snapshotState(opts.baseDir)

  const run = await captureRun({
    baseDir: opts.baseDir,
    cwd,
    session: opts.session,
    stdin: Readable.from([input]),
  })

  // One-way: stdout === input byte-identical; the token is PRESENT.
  expect(run.exitCode).toBeUndefined()
  expect(run.stdout).toBe(input)
  expect(run.stdout).toContain(opts.token)

  // Exactly 2 stderr lines, byte-locked: constant warning + summary.
  // Byte-equality proves: no values, no fs-error text, no paths.
  expect(run.stderr).toBe(WARN_NO_MAPS + summaryLine(0, 1, 0, 0))

  // Zero litter: listings AND per-file mtimes identical (TTL heartbeat
  // preserved — reading never refreshes map mtime).
  expect(await snapshotState(opts.baseDir)).toEqual(before)
}

// ---------------------------------------------------------------------------
// Suite — degrade rows (a)-(f)
// ---------------------------------------------------------------------------

describe('REVMODE-08 degrade matrix — every corruption shape fails one-way', () => {
  it('(a) absent baseDir entirely ⇒ pass-through + warning + exit 0 + zero litter', async () => {
    const baseDir = join(tmpdir(), `mrclean-restore-degrade-never-created-${randomUUID()}`)
    // Deliberately NOT created and NOT cleaned — nothing must ever write it.
    const token = formatV2Token('WORD', 1, 'aabbccdd')

    await assertDegradeShape({ baseDir, token })

    // Belt-and-braces: the run created nothing at the absent path.
    const after = await snapshotState(baseDir)
    expect(after.sessions.absent).toBe(true)
    expect(after.keys.absent).toBe(true)
  })

  it('(b) ciphertext byte at CT_OFFSET flipped ⇒ degrade shape', async () => {
    const baseDir = await makeTmpDir('base')
    const { sid, token } = await seedSession(baseDir)
    const raw = await readFile(mapPathFor(baseDir, sid))
    const tampered = Buffer.from(raw)
    tampered[CT_OFFSET] = (tampered[CT_OFFSET] as number) ^ 0x01
    await writeFile(mapPathFor(baseDir, sid), tampered)

    await assertDegradeShape({ baseDir, token })
  })

  it('(c) truncated envelope (first 20 bytes, below MIN_ENVELOPE) ⇒ degrade shape', async () => {
    const baseDir = await makeTmpDir('base')
    const { sid, token } = await seedSession(baseDir)
    const raw = await readFile(mapPathFor(baseDir, sid))
    await writeFile(mapPathFor(baseDir, sid), raw.subarray(0, TRUNCATED_LENGTH))

    await assertDegradeShape({ baseDir, token })
  })

  it('(d) garbage key file (17 ASCII bytes) ⇒ degrade shape', async () => {
    const baseDir = await makeTmpDir('base')
    const { sid, token } = await seedSession(baseDir)
    // 17 ASCII bytes — not a valid AES-256 key; decrypt fails (chaos recipe).
    await writeFile(keyPathFor(baseDir, sid), Buffer.from('garbage-not-a-key'), { mode: 0o600 })

    await assertDegradeShape({ baseDir, token })
  })

  it.skipIf(IS_WIN32 || IS_ROOT)(
    '(e) chmod 000 map file ⇒ degrade shape (POSIX; win32 modes advisory-only, root bypasses bits)',
    async () => {
      const baseDir = await makeTmpDir('base')
      const { sid, token } = await seedSession(baseDir)
      await chmod(mapPathFor(baseDir, sid), 0o000)

      await assertDegradeShape({ baseDir, token })
    },
  )

  it('(f) valid-but-unknown --session sid (well-formed UUID, no such map) ⇒ degrade shape', async () => {
    const baseDir = await makeTmpDir('base')
    const { token } = await seedSession(baseDir) // a live map that must NOT be read
    const unknownSid = randomUUID()

    await assertDegradeShape({ baseDir, token, session: unknownSid })
  })
})

// Visible skip for row (e) on platforms where the fixture cannot fire
// (chaos.test.ts documented-gap precedent — skip shows in reporter output).
describe.skipIf(!(IS_WIN32 || IS_ROOT))('degrade row (e) platform gap', () => {
  it('skipped: win32 modes are advisory-only / root bypasses permission bits', () => {
    expect(IS_WIN32 || IS_ROOT).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Suite — row (g): lock-held liveness (SC3 'locked' clause, direct evidence)
// ---------------------------------------------------------------------------

describe('row (g) — a held hook-side map lock never blocks, contends, or degrades a restore', () => {
  it('runRestore completes lock-free with correct restored output; the lock survives intact', async () => {
    const baseDir = await makeTmpDir('base')
    const cwd = await makeCwd()
    const { sid, token } = await seedSession(baseDir)
    const mapPath = mapPathFor(baseDir, sid)

    // Hold the lock EXACTLY the way the hook holds it (src/state/lock.js
    // LOCK_OPTS recipe — realpath:false, stale:2500, ms-scale retries).
    const release = await lockfile.lock(mapPath, LOCK_OPTS)
    pendingRelease = release

    // Snapshot AFTER acquisition: the lock artifact is part of the expected
    // listing (it must still be present after the run — never stolen).
    const before = await snapshotState(baseDir)
    expect(before.sessions.names).toContain(`${sid}.map.lock`)

    // A hang here surfaces as the vitest timeout — no bespoke timer.
    const input = `locked ${token} run`
    const run = await captureRun({ baseDir, cwd, stdin: Readable.from([input]) })

    // Liveness + correctness: reads are lock-free by atomic-rename design —
    // the token IS restored (non-vacuity: restored=1, original in stdout).
    expect(run.exitCode).toBeUndefined()
    expect(run.stdout).toBe(`locked ${WORD_ORIGINAL} run`)
    expect(run.stdout).toContain(WORD_ORIGINAL)
    expect(run.stderr).toBe(summaryLine(1, 0, 0, 1)) // summary ONLY — no warn

    // The hook-side lock was never stolen, broken, or waited on.
    expect(await lockfile.check(mapPath, LOCK_OPTS)).toBe(true)

    // Zero litter: listings identical (lock artifact still present) and
    // .map/.key mtimes unchanged. The lock artifact's own mtime is
    // holder-owned (staleness touch timer) — excluded from the comparison.
    const after = await snapshotState(baseDir)
    expect(after.sessions.names).toEqual(before.sessions.names)
    expect(after.keys.names).toEqual(before.keys.names)
    expect(withoutLockEntries(after.sessions.mtimes)).toEqual(
      withoutLockEntries(before.sessions.mtimes),
    )
    expect(after.keys.mtimes).toEqual(before.keys.mtimes)

    // Clean release — throws if the lock was compromised during the run.
    await release()
    pendingRelease = null
    expect(await lockfile.check(mapPath, LOCK_OPTS)).toBe(false)
  })
})
