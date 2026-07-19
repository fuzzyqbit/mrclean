/**
 * CLI seam suite for `mrclean restore` — plan 10-05 Task 1 (REVMODE-01).
 *
 * Drives runRestore(opts) DIRECTLY with injected baseDir/cwd/stdin — no
 * binary spawning (tests/cli/ignore.test.ts precedent; the commander wiring
 * itself is covered by the shipped `program` export + entrypoint guard).
 *
 * Proven here:
 * - stdin mode: restored payload on stdout EXACTLY (no trailing additions);
 *   diagnostics + counts summary ONLY on stderr (HOOK-06 discipline)
 * - file mode: same restored stdout from an operator-named input file
 * - --session narrowing: other sessions' tokens stay unmatched; sessions=1
 * - malformed --session ⇒ exit 2, constant ERR line, sid NEVER echoed,
 *   stdout empty, baseDir listings untouched (validated BEFORE any path
 *   derivation — T-10-05-01)
 * - unreadable input file ⇒ exit 2, ERR line carries the operator's own path
 * - errored stdin stream ⇒ exit 2, constant ERR line, never stream-error
 *   text or a raw stack (11-REVIEW WR-04)
 * - audit: exactly one action:'restore' JSONL line per run; hashes are the
 *   distinct SORTED redactedHash values of restored originals; raw originals
 *   NEVER appear in the file (hash-at-the-boundary — T-10-05-03)
 * - audit degrade: missing <cwd>/.mrclean/ ⇒ restored stdout unaffected,
 *   WARN-audit-failed + summary, exit 0 (best-effort posture, T-10-05-06)
 * - summary counts === engine RestoreResult counts + index.sessions
 *
 * Every fixture is REAL ciphertext: ensureSessionKey + writeSessionMapFile
 * (never hand-written JSON in sessionsDir — Pitfall 10 discipline).
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'

import { redactedHash } from '../../src/detect/findings.js'
import { ensureSessionKey, statePaths, writeSessionMapFile } from '../../src/state/map-store.js'
import {
  createEmptySessionMap,
  formatV2Token,
  hmacAddress,
  makeMapEntry,
  type SessionMapEntry,
  type SessionMapV1,
} from '../../src/state/session-map.js'

// ---------------------------------------------------------------------------
// Pinned stderr copy (byte-locked — single-line, '\n'-terminated; never
// values, never map paths, never fs-error text)
// ---------------------------------------------------------------------------

const WARN_AUDIT_FAILED = '[mrclean] restore: audit write failed — restored output unaffected\n'
const ERR_BAD_SESSION = '[mrclean] restore: invalid --session id (expected UUID)\n'
const ERR_STDIN_READ = '[mrclean] restore: cannot read stdin\n'

/** The always-last stderr line: counts summary. */
function summaryLine(
  restored: number,
  unmatched: number,
  secretSkipped: number,
  sessions: number,
): string {
  return `[mrclean] restore: restored=${restored} unmatched=${unmatched} secret-skipped=${secretSkipped} sessions=${sessions}\n`
}

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

/** Restorable original — synthetic, obviously fake. */
const WORD_ORIGINAL = 'cli-word-original-alpha'

/** Secret-class original — X-suffixed AWS style (never allowlisted). */
const SECRET_ORIGINAL = 'AKIAIOSFODNN7EXAMPLX'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const cleanupDirs: string[] = []

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTmpDir(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `mrclean-restore-cli-${prefix}-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  cleanupDirs.push(dir)
  return dir
}

/** Isolated cwd; `.mrclean/` pre-created unless the test probes audit degrade. */
async function makeCwd(withMrcleanDir = true): Promise<string> {
  const cwd = await makeTmpDir('cwd')
  if (withMrcleanDir) {
    await mkdir(join(cwd, '.mrclean'), { recursive: true })
  }
  return cwd
}

interface SeededSession {
  sid: string
  /** The restorable WORD token (counter 1). */
  token: string
  /** Present when seeded with a secret-class AWS_KEY entry (counter 2). */
  secretToken?: string
}

/** Seed one REAL encrypted session map (WORD entry; optional secret entry). */
async function seedSession(
  baseDir: string,
  wordOriginal: string,
  opts?: { withSecret?: boolean },
): Promise<SeededSession> {
  const sid = randomUUID()
  const base = createEmptySessionMap(sid)
  const token = formatV2Token('WORD', 1, base.nonce8)
  const entries: Record<string, SessionMapEntry> = {
    [hmacAddress(base.hashSalt, wordOriginal)]: makeMapEntry('WORD', token, 1, wordOriginal),
  }
  let counter = 1
  let secretToken: string | undefined
  if (opts?.withSecret === true) {
    counter = 2
    secretToken = formatV2Token('AWS_KEY', 2, base.nonce8)
    entries[hmacAddress(base.hashSalt, SECRET_ORIGINAL)] = makeMapEntry(
      'AWS_KEY',
      secretToken,
      2,
      SECRET_ORIGINAL,
    )
  }
  const map: SessionMapV1 = { ...base, counter, entries }
  const key = await ensureSessionKey(baseDir, sid)
  await writeSessionMapFile(baseDir, sid, map, key)
  return { sid, token, secretToken }
}

/** Sorted listings of sessions/ + keys/ ('<absent>' marker when missing). */
async function snapshotListings(baseDir: string): Promise<Record<string, string[]>> {
  const { sessionsDir, keysDir } = statePaths(baseDir)
  const safeList = async (dir: string): Promise<string[]> => {
    try {
      return (await readdir(dir)).sort()
    } catch {
      return ['<absent>']
    }
  }
  return { sessions: await safeList(sessionsDir), keys: await safeList(keysDir) }
}

// ---------------------------------------------------------------------------
// Process seam harness (ignore.test.ts:127-152 clone + stdout mirror mock)
// ---------------------------------------------------------------------------

interface RunRestoreOptsShape {
  file?: string
  session?: string
  cwd?: string
  baseDir?: string
  stdin?: NodeJS.ReadableStream
}

interface CapturedRun {
  stdout: string
  stderr: string
  exitCode: number | undefined
}

/**
 * Call runRestore with stdout.write / stderr.write mirror mocks installed
 * and process.exitCode captured (WR-03: the hard gates set exitCode and
 * RETURN so pending stderr pipe writes can flush — they never call
 * process.exit). process.exit is stubbed to THROW as a regression guard: a
 * reintroduced exit() call would drop piped diagnostics in production and
 * kill the vitest worker here. Every throw REPROPAGATES — degrade paths
 * must never throw, so an escape is a genuine failure.
 */
async function captureRun(opts: RunRestoreOptsShape): Promise<CapturedRun> {
  const { runRestore } = await import('../../src/restore/cli.js')

  const originalExit = process.exit
  const originalExitCode = process.exitCode
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)
  let stdout = ''
  let stderr = ''

  process.exit = ((code?: number) => {
    throw new Error(
      `unexpected process.exit(${code ?? 0}) — hard gates must set process.exitCode and return (WR-03)`,
    )
  }) as typeof process.exit
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk)
    return true
  }) as typeof process.stderr.write
  process.exitCode = undefined

  let exitCode: number | undefined
  try {
    await runRestore(opts)
  } finally {
    // Capture BEFORE restoring so the harness never leaks a hard-gate
    // exitCode into the vitest worker's own exit status.
    exitCode = typeof process.exitCode === 'number' ? process.exitCode : undefined
    process.exitCode = originalExitCode
    process.exit = originalExit
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  }

  return { stdout, stderr, exitCode }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('runRestore — stdin/file modes and stream separation (SC1)', () => {
  it('stdin mode: restored text on stdout EXACTLY; stderr is the summary line only', async () => {
    const baseDir = await makeTmpDir('base')
    const cwd = await makeCwd()
    const { token } = await seedSession(baseDir, WORD_ORIGINAL)
    const input = `before ${token} after`

    const run = await captureRun({ baseDir, cwd, stdin: Readable.from([input]) })

    expect(run.exitCode).toBeUndefined()
    expect(run.stdout).toBe(`before ${WORD_ORIGINAL} after`)
    expect(run.stderr).toBe(summaryLine(1, 0, 0, 1))
  })

  it('file mode: same restored stdout from an input file', async () => {
    const baseDir = await makeTmpDir('base')
    const cwd = await makeCwd()
    const { token } = await seedSession(baseDir, WORD_ORIGINAL)
    const inputPath = join(cwd, 'redacted.txt')
    await writeFile(inputPath, `before ${token} after`, 'utf8')

    const run = await captureRun({ baseDir, cwd, file: inputPath })

    expect(run.exitCode).toBeUndefined()
    expect(run.stdout).toBe(`before ${WORD_ORIGINAL} after`)
    expect(run.stderr).toBe(summaryLine(1, 0, 0, 1))
  })

  it('--session narrowing: other session token stays unmatched, sessions=1, audit scoped to the sid', async () => {
    const baseDir = await makeTmpDir('base')
    const cwd = await makeCwd()
    const s1 = await seedSession(baseDir, 'narrow-original-one')
    const s2 = await seedSession(baseDir, 'narrow-original-two')
    const input = `${s1.token} | ${s2.token}`

    const run = await captureRun({
      baseDir,
      cwd,
      session: s1.sid,
      stdin: Readable.from([input]),
    })

    expect(run.exitCode).toBeUndefined()
    expect(run.stdout).toBe(`narrow-original-one | ${s2.token}`)
    expect(run.stderr).toBe(summaryLine(1, 1, 0, 1))

    // sessionScope carries the validated sid ('all' is the no-filter scope).
    const auditRaw = await readFile(join(cwd, '.mrclean', 'audit.jsonl'), 'utf8')
    const lines = auditRaw.split('\n').filter((line) => line.length > 0)
    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0] as string) as Record<string, unknown>
    expect(record['sessionScope']).toBe(s1.sid)
  })
})

describe('runRestore — hard input errors exit 2 (planner pin A5 boundary)', () => {
  it.each(['not-a-uuid', '../../etc'])(
    'malformed --session %j: exit 2, sid never echoed, stdout empty, baseDir untouched',
    async (badSid) => {
      const baseDir = await makeTmpDir('base')
      const cwd = await makeCwd()
      await seedSession(baseDir, WORD_ORIGINAL)
      const before = await snapshotListings(baseDir)

      const run = await captureRun({
        baseDir,
        cwd,
        session: badSid,
        stdin: Readable.from(['never read']),
      })

      expect(run.exitCode).toBe(2)
      expect(run.stderr).toBe(ERR_BAD_SESSION)
      expect(run.stderr).not.toContain(badSid) // hostile-shaped input non-echo
      expect(run.stdout).toBe('')
      expect(await snapshotListings(baseDir)).toEqual(before)
    },
  )

  it('unreadable input file: exit 2, ERR line carries the operator path', async () => {
    const baseDir = await makeTmpDir('base')
    const cwd = await makeCwd()
    const missingPath = join(cwd, 'does-not-exist.txt')

    const run = await captureRun({ baseDir, cwd, file: missingPath })

    expect(run.exitCode).toBe(2)
    expect(run.stderr).toBe(`[mrclean] restore: cannot read input file: ${missingPath}\n`)
    expect(run.stdout).toBe('')
  })

  it('errored stdin stream: exit 2, constant ERR line, no stream-error text, stdout empty', async () => {
    const baseDir = await makeTmpDir('base')
    const cwd = await makeCwd()
    await seedSession(baseDir, WORD_ORIGINAL)
    const before = await snapshotListings(baseDir)
    // First read raises — readAll's async iterator rejects (closed-fd / EIO
    // on hangup / broken-pipe shapes; 11-REVIEW WR-04). Without the gate the
    // rejection escaped runRestore and crashed the commander top-level await
    // with a raw stack and exit 1 — neither contracted error domain.
    const failingStdin = new Readable({
      read() {
        this.destroy(new Error('EIO: i/o error, read'))
      },
    })

    const run = await captureRun({ baseDir, cwd, stdin: failingStdin })

    expect(run.exitCode).toBe(2)
    expect(run.stderr).toBe(ERR_STDIN_READ) // byte-locked constant line
    expect(run.stderr).not.toContain('EIO') // never stream-error text
    expect(run.stdout).toBe('')
    expect(await snapshotListings(baseDir)).toEqual(before)
  })
})

describe('runRestore — hash-only audit record (REVMODE-09 boundary)', () => {
  it('appends exactly one action=restore line; hashes are distinct sorted redactedHash; raw originals absent', async () => {
    const baseDir = await makeTmpDir('base')
    const cwd = await makeCwd()
    const seeded = await seedSession(baseDir, WORD_ORIGINAL)
    // Token appears TWICE: restored=2 occurrences, hashes dedupe to ONE value.
    const input = `${seeded.token} and again ${seeded.token}`

    const run = await captureRun({ baseDir, cwd, stdin: Readable.from([input]) })

    expect(run.exitCode).toBeUndefined()
    expect(run.stdout).toBe(`${WORD_ORIGINAL} and again ${WORD_ORIGINAL}`)

    const auditRaw = await readFile(join(cwd, '.mrclean', 'audit.jsonl'), 'utf8')
    const lines = auditRaw.split('\n').filter((line) => line.length > 0)
    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0] as string) as Record<string, unknown>
    expect(record['action']).toBe('restore')
    expect(record['sessionScope']).toBe('all')
    expect(record['restored']).toBe(2)
    expect(record['unmatched']).toBe(0)
    expect(record['skippedSecret']).toBe(0)
    expect(record['hashes']).toEqual([redactedHash(WORD_ORIGINAL)])
    // Raw original NEVER in the audit file (substring grep, T-10-05-03).
    expect(auditRaw).not.toContain(WORD_ORIGINAL)
  })

  it('audit degrade: cwd without .mrclean/ ⇒ restored stdout unaffected, WARN + summary, exit 0', async () => {
    const baseDir = await makeTmpDir('base')
    const cwd = await makeCwd(false) // no .mrclean/ — appendFile ENOENTs
    const seeded = await seedSession(baseDir, WORD_ORIGINAL)

    const run = await captureRun({
      baseDir,
      cwd,
      stdin: Readable.from([`x ${seeded.token} y`]),
    })

    expect(run.exitCode).toBeUndefined()
    expect(run.stdout).toBe(`x ${WORD_ORIGINAL} y`)
    expect(run.stderr).toBe(WARN_AUDIT_FAILED + summaryLine(1, 0, 0, 1))
  })
})

describe('runRestore — summary counts mirror the engine result (SC1)', () => {
  it('restored/unmatched/secret-skipped/sessions all non-zero and exact', async () => {
    const baseDir = await makeTmpDir('base')
    const cwd = await makeCwd()
    const seeded = await seedSession(baseDir, WORD_ORIGINAL, { withSecret: true })
    // A well-formed token no session ever issued (unknown nonce8).
    const unknownToken = formatV2Token('WORD', 99, 'deadbeef')
    const input = `${seeded.token} ${seeded.secretToken as string} ${unknownToken}`

    const run = await captureRun({ baseDir, cwd, stdin: Readable.from([input]) })

    expect(run.exitCode).toBeUndefined()
    // WORD restored; secret placeholder + unknown token pass through.
    expect(run.stdout).toBe(`${WORD_ORIGINAL} ${seeded.secretToken as string} ${unknownToken}`)
    expect(run.stderr).toBe(summaryLine(1, 1, 1, 1))
  })
})
