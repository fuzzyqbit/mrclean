/**
 * REVMODE-09 leak-grep over the integrated restore surface — plan 10-08
 * Task 1 (SC4 second half: 10-03 locked the record shape; THIS file locks
 * the integrated system including error paths).
 *
 * The invariant matrix (RESEARCH Leak-Grep Extension Strategy — load-bearing
 * framing):
 *
 *   | surface                       | restorable canaries | secret canary |
 *   |-------------------------------|---------------------|---------------|
 *   | restore stdout                | REQUIRED (feature)  | FORBIDDEN     |
 *   | restore stderr                | FORBIDDEN           | FORBIDDEN     |
 *   | audit.jsonl                   | FORBIDDEN (hashes)  | FORBIDDEN     |
 *   | sessions/*.map + keys/* bytes | FORBIDDEN (cipher)  | FORBIDDEN     |
 *
 * The v2.0 Phase 7 lesson is binding: leak tests must audit the FULLY
 * INTEGRATED surface and cover exception paths, not just the happy path.
 * The error block forces three failures — (a) garbage key, (b) EACCES map,
 * (c) hand-poisoned secret-class `original` re-encrypted under the REAL key
 * — and sweeps every surface again on each.
 *
 * Non-vacuity guards precede every cleanliness assertion (pii-canary-leak
 * line-count precedent): restored >= 2 and >= 1 action:'restore' audit line
 * are proven BEFORE any absence grep; error paths assert their well-formed
 * tokens PRESENT in stdout before asserting pass-through cleanliness.
 *
 * State is seeded through the REAL facade flow (hydrate → allocate →
 * persist; tests/state/inspection.test.ts runReversibleEvent recipe) — never
 * hand-written map JSON (Pitfall 10). The process-seam capture harness is
 * duplicated by value from tests/cli/restore.test.ts (never cross-imported).
 */

import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'

import { assertNoCanaryLeak } from '../../src/audit/canary-leak.js'
import { PlaceholderManager } from '../../src/placeholder/manager.js'
import { persistAllocations, readSessionMapForHydration } from '../../src/state/index.js'
import { POST_LOCK_DEADLINE_MS } from '../../src/state/lock.js'
import {
  encryptMapBuffer,
  keyPathFor,
  mapPathFor,
  readSessionMapFile,
  statePaths,
} from '../../src/state/map-store.js'
import { hmacAddress } from '../../src/state/session-map.js'

// ---------------------------------------------------------------------------
// Platform guards (chaos.test.ts:69-71, duplicated by value)
// ---------------------------------------------------------------------------

/** win32 modes are advisory-only — chmod-000 case is POSIX-only (Pitfall 8). */
const IS_WIN32 = process.platform === 'win32'
/** root bypasses permission bits — chmod-000 EACCES never fires as uid 0. */
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0

// ---------------------------------------------------------------------------
// Canary corpus (pinned by plan 10-08 <interfaces>; reusable by Phase 11)
// ---------------------------------------------------------------------------

/** Restorable WORD-typed canary — synthetic "project path" stand-in. */
const WORD_CANARY = 'zz-canary-project-path-7g2'
/** Restorable PII_EMAIL canary — .invalid TLD (RFC 6761, never resolves). */
const EMAIL_CANARY = 'kim.canary@zz.invalid'
/** Restorable-class corpus: may appear ONLY on restore stdout (the feature). */
const RESTORABLE_CANARIES = [WORD_CANARY, EMAIL_CANARY] as const

/**
 * Secret-class canary: fake AWS key deliberately NOT ending in 'EXAMPLE' —
 * `AKIAIOSFODNN7EXAMPLE` is in the gitleaks per-rule allowlist (`.+EXAMPLE$`)
 * and would vanish from detection-adjacent fixtures (03-01 landmine).
 */
const SECRET_CANARY = 'AKIAIOSFODNN7EXAMPLX'

/** Every canary — the full sweep list for audit/stderr/artifact surfaces. */
const ALL_CANARIES = [...RESTORABLE_CANARIES, SECRET_CANARY]

// ---------------------------------------------------------------------------
// Pinned stderr copy (byte-locked — must match src/restore/cli.ts exactly;
// duplicated by value, never cross-imported)
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

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTmpDir(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `mrclean-restore-leak-${prefix}-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  cleanupDirs.push(dir)
  return dir
}

/** Isolated cwd WITH .mrclean/ so the audit write succeeds (the sink under test). */
async function makeCwd(): Promise<string> {
  const cwd = await makeTmpDir('cwd')
  await mkdir(join(cwd, '.mrclean'), { recursive: true })
  return cwd
}

interface CanaryTokens {
  wordToken: string
  emailToken: string
  secretToken: string
}

/**
 * Seed all three canaries through the REAL facade flow (inspection.test.ts
 * runReversibleEvent recipe — hydrate → allocate → persist), then read the
 * PERSISTED placeholders back from the encrypted store (never trust
 * provisional tokens; the round-trip read doubles as artifact non-vacuity:
 * the map REALLY holds these allocations).
 */
async function seedCanaryState(baseDir: string, sid: string): Promise<CanaryTokens> {
  const hydration = await readSessionMapForHydration({ sessionId: sid, baseDir })
  expect(hydration).not.toBeNull()
  const manager = new PlaceholderManager({ sessionId: sid })
  manager.hydrateReversible(hydration!)
  manager.allocate(WORD_CANARY, 'WORD')
  manager.allocate(EMAIL_CANARY, 'PII_EMAIL')
  manager.allocate(SECRET_CANARY, 'AWS_KEY')
  const pending = manager.drainPendingAllocations()
  expect(pending).toHaveLength(3)
  const persisted = await persistAllocations({
    sessionId: sid,
    baseDir,
    pending,
    deadlineMs: POST_LOCK_DEADLINE_MS,
  })
  expect(persisted.status).toBe('ok')

  const map = await readSessionMapFile(baseDir, sid)
  expect(map).not.toBeNull()
  const tokenFor = (original: string): string => {
    const entry = map!.entries[hmacAddress(map!.hashSalt, original)]
    expect(entry, `no persisted entry for ${original}`).toBeDefined()
    return entry!.placeholder
  }
  return {
    wordToken: tokenFor(WORD_CANARY),
    emailToken: tokenFor(EMAIL_CANARY),
    secretToken: tokenFor(SECRET_CANARY),
  }
}

/** All state artifact paths (sessions/* + keys/*) for the raw byte sweep. */
async function listArtifactPaths(baseDir: string): Promise<string[]> {
  const { sessionsDir, keysDir } = statePaths(baseDir)
  const sessionFiles = await readdir(sessionsDir)
  const keyFiles = await readdir(keysDir)
  return [
    ...sessionFiles.map((name) => join(sessionsDir, name)),
    ...keyFiles.map((name) => join(keysDir, name)),
  ]
}

/** Sweep raw artifact bytes: NO canary of either class is ever readable. */
async function assertArtifactsClean(baseDir: string): Promise<void> {
  const paths = await listArtifactPaths(baseDir)
  expect(paths.length, 'artifact sweep must scan at least map+key').toBeGreaterThanOrEqual(2)
  for (const path of paths) {
    const raw = await readFile(path)
    for (const canary of ALL_CANARIES) {
      expect(raw.includes(canary), `canary ${canary} readable in raw artifact ${path}`).toBe(false)
    }
  }
}

/**
 * Read audit.jsonl, assert non-vacuity (>= minLines action:'restore' lines)
 * FIRST, then assert NO canary of either class appears (assertNoCanaryLeak —
 * ENOENT-clean + malformed-line-as-leak semantics from src/audit/canary-leak).
 */
async function assertAuditNonVacuousAndClean(cwd: string, minLines: number): Promise<void> {
  const auditPath = join(cwd, '.mrclean', 'audit.jsonl')
  const exists = await readFile(auditPath, 'utf8').then(
    (content) => content,
    () => null,
  )
  expect(
    exists,
    `audit.jsonl missing at ${auditPath} — the canary sweep below would pass vacuously`,
  ).not.toBeNull()
  const lines = (exists as string).split('\n').filter((line) => line.length > 0)
  const restoreLines = lines.filter((line) => {
    try {
      return (JSON.parse(line) as Record<string, unknown>)['action'] === 'restore'
    } catch {
      return false
    }
  })
  expect(
    restoreLines.length,
    `expected >= ${minLines} action:'restore' audit line(s), found ${restoreLines.length}`,
  ).toBeGreaterThanOrEqual(minLines)

  const result = await assertNoCanaryLeak(auditPath, ALL_CANARIES)
  if (!result.ok) {
    // Diagnosis aid (pii-canary precedent) — canaries are synthetic.
    console.error('[restore-canary] AUDIT LEAKS DETECTED:', result.leaked)
  }
  expect(result.ok, `audit.jsonl contains raw canary values: ${JSON.stringify(result.leaked)}`).toBe(
    true,
  )
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
  const originalExitCode = process.exitCode
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)
  let stdout = ''
  let stderr = ''

  // WR-03 shape: hard gates set process.exitCode and RETURN (flush-safe);
  // process.exit is stubbed to THROW as a regression guard. Any throw
  // repropagates — degrade paths must NEVER throw.
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
    // Capture BEFORE restoring so a hard-gate exitCode never leaks into the
    // vitest worker's own exit status.
    exitCode = typeof process.exitCode === 'number' ? process.exitCode : undefined
    process.exitCode = originalExitCode
    process.exit = originalExit
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  }

  return { stdout, stderr, exitCode }
}

// ---------------------------------------------------------------------------
// Suite — SUCCESS PATH (the four-surface invariant matrix)
// ---------------------------------------------------------------------------

describe('restore leak-grep — success path sweeps all four surfaces (REVMODE-09)', () => {
  it('restorable canaries ONLY on stdout; secret canary on NO surface; placeholder survives byte-identical', async () => {
    // Arrange — REAL facade-seeded state carrying all three canaries.
    const baseDir = await makeTmpDir('base')
    const cwd = await makeCwd()
    const sid = randomUUID()
    const tokens = await seedCanaryState(baseDir, sid)
    const input = `path ${tokens.wordToken} mail ${tokens.emailToken} key ${tokens.secretToken} end`

    // Act
    const run = await captureRun({ baseDir, cwd, stdin: Readable.from([input]) })
    expect(run.exitCode).toBeUndefined()

    // NON-VACUITY FIRST (pii-canary precedent — a restore that restored
    // nothing would make every absence grep below pass vacuously):
    // (1) the summary reports restored >= 2 (both restorable canaries hit);
    const restoredMatch = /restored=(\d+)/.exec(run.stderr)
    expect(restoredMatch, 'stderr carries no restored= summary').not.toBeNull()
    expect(Number(restoredMatch![1])).toBeGreaterThanOrEqual(2)
    // (2) audit.jsonl exists with >= 1 action:'restore' line (checked inside
    //     the audit sweep helper, non-vacuity before cleanliness).

    // MATRIX — restore stdout: restorable canaries REQUIRED (the feature);
    // the AWS placeholder survives BYTE-IDENTICAL (secret never restored).
    expect(run.stdout).toBe(`path ${WORD_CANARY} mail ${EMAIL_CANARY} key ${tokens.secretToken} end`)
    expect(run.stdout).toContain(WORD_CANARY)
    expect(run.stdout).toContain(EMAIL_CANARY)
    expect(run.stdout).toContain(tokens.secretToken)
    expect(run.stdout).not.toContain(SECRET_CANARY)

    // MATRIX — restore stderr: NO canary of either class (byte-locked shape:
    // exactly the counts summary — restored=2, unmatched=0, skipped=1).
    expect(run.stderr).toBe(summaryLine(2, 0, 1, 1))
    for (const canary of ALL_CANARIES) {
      expect(run.stderr, `canary ${canary} leaked to stderr`).not.toContain(canary)
    }

    // MATRIX — audit.jsonl: hashes only, no canary of either class.
    await assertAuditNonVacuousAndClean(cwd, 1)

    // MATRIX — raw map/key artifact bytes: ciphertext only, no canary.
    await assertArtifactsClean(baseDir)
  })
})

// ---------------------------------------------------------------------------
// Suite — ERROR PATHS (Phase 7 lesson: exception paths swept, not just happy)
// ---------------------------------------------------------------------------

describe('restore leak-grep — every forced-failure path leaks nothing (REVMODE-09)', () => {
  /**
   * Shared degrade-shape sweep: stdout === input byte-identical (token
   * present — non-vacuous pass-through), byte-locked stderr, no canary on
   * stdout/stderr, audit non-vacuous + clean, artifacts still ciphertext.
   */
  async function assertErrorPathLeakFree(opts: {
    baseDir: string
    input: string
    expectedStderr: string
    /** Undo fixture damage that blocks the sweep itself (e.g. chmod-000 back). */
    prepareArtifactSweep?: () => Promise<void>
  }): Promise<void> {
    const cwd = await makeCwd()
    const run = await captureRun({
      baseDir: opts.baseDir,
      cwd,
      stdin: Readable.from([opts.input]),
    })

    // One-way degrade: never an exit, stdout === input byte-identical.
    expect(run.exitCode).toBeUndefined()
    expect(run.stdout).toBe(opts.input)

    // stderr byte-locked (constant shape — no values, no paths, no fs text).
    expect(run.stderr).toBe(opts.expectedStderr)
    for (const canary of ALL_CANARIES) {
      expect(run.stdout, `canary ${canary} leaked to stdout on an error path`).not.toContain(canary)
      expect(run.stderr, `canary ${canary} leaked to stderr on an error path`).not.toContain(canary)
    }

    // Audit sweep: record written (non-vacuity) and canary-free.
    await assertAuditNonVacuousAndClean(cwd, 1)

    // Artifacts: the (corrupted) store still never shows a canary in raw bytes.
    await opts.prepareArtifactSweep?.()
    await assertArtifactsClean(opts.baseDir)
  }

  it('(a) garbage 17-byte key ⇒ pass-through; stderr + audit + artifacts canary-free', async () => {
    const baseDir = await makeTmpDir('base')
    const sid = randomUUID()
    const tokens = await seedCanaryState(baseDir, sid)
    // 17 ASCII bytes — not a valid AES-256 key; decrypt fails (chaos recipe f).
    await writeFile(keyPathFor(baseDir, sid), Buffer.from('garbage-not-a-key'), { mode: 0o600 })

    const input = `head ${tokens.wordToken} ${tokens.secretToken} tail`
    // sessions=0 ⇒ both tokens unmatched, constant warning + summary.
    await assertErrorPathLeakFree({
      baseDir,
      input,
      expectedStderr: WARN_NO_MAPS + summaryLine(0, 2, 0, 0),
    })
  })

  it.skipIf(IS_WIN32 || IS_ROOT)(
    '(b) chmod-000 map (EACCES) ⇒ pass-through; stderr + audit + artifacts canary-free (POSIX; win32 modes advisory-only, root bypasses bits)',
    async () => {
      const baseDir = await makeTmpDir('base')
      const sid = randomUUID()
      const tokens = await seedCanaryState(baseDir, sid)
      await chmod(mapPathFor(baseDir, sid), 0o000)

      const input = `head ${tokens.wordToken} ${tokens.secretToken} tail`
      await assertErrorPathLeakFree({
        baseDir,
        input,
        expectedStderr: WARN_NO_MAPS + summaryLine(0, 2, 0, 0),
        // The 000 mode blocks the sweep's own readFile — restore mode AFTER
        // the run so the sweep genuinely scans the (untouched) envelope bytes.
        prepareArtifactSweep: () => chmod(mapPathFor(baseDir, sid), 0o600),
      })
    },
  )

  it('(c) hand-poisoned ciphertext (secret entry carrying original, REAL key) ⇒ never restored, never leaked', async () => {
    // Arrange — seed, then hand-poison: the AWS entry gets `original:
    // SECRET_CANARY` attached in plaintext JSON and re-encrypted under the
    // REAL session key. Ordinary flows can never produce this envelope —
    // serializeSessionMap strips the property — so JSON.stringify +
    // encryptMapBuffer are used directly (the sanctioned poison recipe).
    const baseDir = await makeTmpDir('base')
    const sid = randomUUID()
    const tokens = await seedCanaryState(baseDir, sid)
    const key = await readFile(keyPathFor(baseDir, sid))
    const map = await readSessionMapFile(baseDir, sid)
    expect(map).not.toBeNull()
    const awsAddress = hmacAddress(map!.hashSalt, SECRET_CANARY)
    const awsEntry = map!.entries[awsAddress]!
    const poisoned = {
      ...map!,
      entries: {
        ...map!.entries,
        [awsAddress]: {
          placeholder: awsEntry.placeholder,
          type: awsEntry.type,
          counter: awsEntry.counter,
          original: SECRET_CANARY,
        },
      },
    }
    const poisonedJson = JSON.stringify(poisoned)
    // NON-VACUITY: the poisoned plaintext REALLY carries the secret canary —
    // prove the fixture is what it claims before proving the system drops it.
    expect(poisonedJson).toContain(SECRET_CANARY)
    await writeFile(
      mapPathFor(baseDir, sid),
      encryptMapBuffer(Buffer.from(poisonedJson, 'utf8'), key, sid),
    )

    // Act 1 — restore a document carrying ONLY the poisoned secret token.
    const cwd = await makeCwd()
    const input = `poisoned ${tokens.secretToken} survives`
    const run = await captureRun({ baseDir, cwd, stdin: Readable.from([input]) })

    // Assert — the map DECRYPTED and indexed (sessions=1 — this is NOT a
    // degrade; the triple gate parse-drop + read-gate did the work), yet the
    // secret token passed through byte-identical: stdout === input.
    expect(run.exitCode).toBeUndefined()
    expect(run.stdout).toBe(input)
    expect(run.stderr).toBe(summaryLine(0, 0, 1, 1))
    for (const canary of ALL_CANARIES) {
      expect(run.stdout, `canary ${canary} on stdout from a poisoned store`).not.toContain(canary)
      expect(run.stderr, `canary ${canary} on stderr from a poisoned store`).not.toContain(canary)
    }

    // Act 2 — the SAME poisoned map still restores its restorable entry
    // (proves the store is live and functional, not accidentally degraded —
    // the poison drop is surgical, not a whole-map failure).
    const run2 = await captureRun({
      baseDir,
      cwd,
      stdin: Readable.from([`word ${tokens.wordToken} end`]),
    })
    expect(run2.exitCode).toBeUndefined()
    expect(run2.stdout).toBe(`word ${WORD_CANARY} end`)
    expect(run2.stdout).not.toContain(SECRET_CANARY)
    expect(run2.stderr).toBe(summaryLine(1, 0, 0, 1))
    for (const canary of ALL_CANARIES) {
      expect(run2.stderr, `canary ${canary} on stderr (poisoned run 2)`).not.toContain(canary)
    }

    // Audit sweep across BOTH runs (2 restore lines) + artifact sweep. The
    // poisoned envelope itself is ciphertext — the canary stays unreadable.
    await assertAuditNonVacuousAndClean(cwd, 2)
    await assertArtifactsClean(baseDir)
  })
})

// Visible skip for row (b) on platforms where the fixture cannot fire
// (chaos/degrade documented-gap precedent — skip shows in reporter output).
describe.skipIf(!(IS_WIN32 || IS_ROOT))('restore leak-grep row (b) platform gap', () => {
  it('skipped: win32 modes are advisory-only / root bypasses permission bits', () => {
    expect(IS_WIN32 || IS_ROOT).toBe(true)
  })
})
