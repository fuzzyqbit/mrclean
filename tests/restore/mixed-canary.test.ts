/**
 * Mixed-content canary — REAL-pipeline round-trip (Plan 10-07, REVMODE-01;
 * the named Phase 11 gate substrate ROADMAP requires Phase 10 to build
 * against, not retrofit).
 *
 * Pitfall 10 (never synthetic-only): hand-built SessionMapV1 fixtures can
 * drift from what the allocator actually persists (OVF entries, counter
 * semantics, HMAC keys). This suite drives the REAL reversible pipeline —
 * the inspection.test.ts hydrate → allocate → drain → persist recipe — to
 * produce the map, then restores against it through the REAL operator CLI
 * (`runRestore` with injected baseDir/cwd/stdin seams from 10-05).
 *
 * Canary design:
 *   - WORD_ORIGINAL is the "fake path" — WORD-typed BY DESIGN: there is no
 *     PATH type in the frozen 25-entry vocabulary; project paths enter the
 *     map as word-list terms (RESEARCH §Pattern 2).
 *   - SECRET_ORIGINAL is a fake AWS key that must NOT end in 'EXAMPLE' —
 *     the AWS-docs EXAMPLE key is gitleaks-allowlisted (`.+EXAMPLE$`), so
 *     the X-suffixed variant is the canonical detectable fake
 *     (chaos.test.ts precedent).
 *
 * SC2 shape proven end-to-end:
 *   1. the WORD-term placeholder restores to its original (round-trip works,
 *      restored >= 1 in the summary — non-vacuity);
 *   2. the secret-class AWS placeholder survives BYTE-IDENTICAL and the raw
 *      secret never reaches stdout;
 *   3. the stderr summary reports secret-skipped=1;
 *   4. the audit line written under the injected cwd carries neither canary
 *      raw (hash-only end-to-end sanity; the full leak sweep is 10-08's job).
 *
 * Placeholders are sourced from the PERSISTED map (readSessionMapFile +
 * hmacAddress) — tokens are never hand-formatted, so the document exercises
 * exactly what the real allocator emitted (nonce8 included).
 *
 * Unit project (direct src/ imports, tmpdir-injected seams — never the real
 * ~/.mrclean); NOT in the integration include list (vitest project routing:
 * a file cannot belong to both projects).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { persistAllocations, readSessionMapForHydration } from '../../src/state/index.js'
import { POST_LOCK_DEADLINE_MS } from '../../src/state/lock.js'
import { readSessionMapFile } from '../../src/state/map-store.js'
import { hmacAddress } from '../../src/state/session-map.js'
import { PlaceholderManager } from '../../src/placeholder/manager.js'
import { runRestore, type RunRestoreOpts } from '../../src/restore/cli.js'

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

/** The "fake path" — WORD-typed by design (there is no PATH type). */
const WORD_ORIGINAL = 'zz-canary-project-path-7g2'

/**
 * Secret-class canary. MUST NOT end in 'EXAMPLE' — the AWS-docs EXAMPLE key
 * is gitleaks-allowlisted (chaos.test.ts lines 74-78); the X-suffixed
 * variant is the canonical detectable fake.
 */
const SECRET_ORIGINAL = 'AKIAIOSFODNN7EXAMPLX'

/** Non-global v2 token probe (a shared /g regex would carry lastIndex). */
const V2_TOKEN_PROBE = /^<MRCLEAN:[A-Z0-9_]+:(?:\d{3}|OVF):[a-f0-9]{8}>$/

/** The pinned 10-05 summary line, always the LAST stderr line. */
const SUMMARY_RE = /restored=(\d+) unmatched=(\d+) secret-skipped=(\d+) sessions=(\d+)/

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * One REAL facade event: hydrate → fresh manager → allocate ONE value →
 * persist (cloned from tests/state/inspection.test.ts runReversibleEvent —
 * the real-pipeline event driver, POST deadline constant included).
 */
async function runReversibleEvent(
  baseDir: string,
  sid: string,
  value: string,
  type: string,
): Promise<{ counterFloor: number; knownEntries: number }> {
  const hydration = await readSessionMapForHydration({ sessionId: sid, baseDir })
  expect(hydration).not.toBeNull()
  const manager = new PlaceholderManager({ sessionId: sid })
  manager.hydrateReversible(hydration!)
  manager.allocate(value, type)
  const pending = manager.drainPendingAllocations()
  const persisted = await persistAllocations({
    sessionId: sid,
    baseDir,
    pending,
    deadlineMs: POST_LOCK_DEADLINE_MS,
  })
  expect(persisted.status).toBe('ok')
  return { counterFloor: hydration!.counterFloor, knownEntries: hydration!.entriesByHmac.size }
}

/** stdout/stderr snapshot of one captured runRestore invocation. */
interface CapturedRun {
  stdout: string
  stderr: string
}

/**
 * Drive the REAL CLI action with process seams captured (ignore.test.ts
 * harness precedent). process.exit is stubbed to THROW so an unexpected
 * hard-gate exit fails the test loudly instead of killing the worker;
 * the happy path under test never exits.
 */
async function runRestoreCaptured(opts: RunRestoreOpts): Promise<CapturedRun> {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)
  const originalExit = process.exit
  let stdout = ''
  let stderr = ''

  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk)
    return true
  }) as typeof process.stderr.write
  process.exit = ((code?: number) => {
    throw new Error(`unexpected process.exit(${code ?? 0})`)
  }) as typeof process.exit

  try {
    await runRestore(opts)
  } finally {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exit = originalExit
  }
  return { stdout, stderr }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('mixed-content canary (Phase 11 gate substrate)', () => {
  let baseDir: string
  let cwd: string
  let sid: string

  beforeEach(async () => {
    baseDir = join(tmpdir(), `mrclean-mixed-canary-${randomUUID()}`)
    cwd = join(tmpdir(), `mrclean-mixed-canary-cwd-${randomUUID()}`)
    sid = randomUUID()
    await mkdir(baseDir, { recursive: true })
    // .mrclean/ must pre-exist for the audit append (created by `mrclean
    // install` in production — restore-log.ts contract).
    await mkdir(join(cwd, '.mrclean'), { recursive: true })
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  })

  it('WORD-term round-trips to its original while the secret-class AWS placeholder survives byte-identical', async () => {
    // -----------------------------------------------------------------------
    // (1) TWO real reversible events against the tmp store: the WORD canary
    // and the secret-class AWS canary, allocated + persisted by the REAL
    // manager + facade (never a hand-built map — Pitfall 10).
    // -----------------------------------------------------------------------
    const first = await runReversibleEvent(baseDir, sid, WORD_ORIGINAL, 'WORD')
    const second = await runReversibleEvent(baseDir, sid, SECRET_ORIGINAL, 'AWS_KEY')

    // Flow sanity — event 2 hydrated event 1's REAL persisted state.
    expect(first.knownEntries).toBe(0)
    expect(second.counterFloor).toBe(1)
    expect(second.knownEntries).toBe(1)

    // Capture the EMITTED v2 placeholders from the persisted map — never
    // hand-format tokens; the document must carry what the allocator wrote
    // (nonce8 included).
    const map = await readSessionMapFile(baseDir, sid)
    expect(map).not.toBeNull()
    const wordEntry = map!.entries[hmacAddress(map!.hashSalt, WORD_ORIGINAL)]
    const secretEntry = map!.entries[hmacAddress(map!.hashSalt, SECRET_ORIGINAL)]
    expect(wordEntry).toBeDefined()
    expect(secretEntry).toBeDefined()
    const wordPlaceholder = wordEntry!.placeholder
    const secretPlaceholder = secretEntry!.placeholder
    expect(wordPlaceholder).toMatch(V2_TOKEN_PROBE)
    expect(secretPlaceholder).toMatch(V2_TOKEN_PROBE)

    // -----------------------------------------------------------------------
    // (2) Mixed document: both placeholders embedded in prose.
    // -----------------------------------------------------------------------
    const doc =
      `Deploy notes: the service lives under ${wordPlaceholder} on the build host.\n` +
      `Rotate the access key ${secretPlaceholder} before the next release.\n`

    // -----------------------------------------------------------------------
    // (3) The REAL operator CLI round-trip via injected seams.
    // -----------------------------------------------------------------------
    const run = await runRestoreCaptured({ baseDir, cwd, stdin: Readable.from([doc]) })

    // Assertion group 1 — WORD round-trip works (non-vacuous: the summary
    // line's restored count is >= 1 and the word token is GONE from stdout).
    expect(run.stdout).toContain(WORD_ORIGINAL)
    expect(run.stdout).not.toContain(wordPlaceholder)
    const summary = run.stderr.match(SUMMARY_RE)
    expect(summary, `stderr must end with the pinned summary line; got: ${run.stderr}`).not.toBeNull()
    expect(Number(summary![1]), 'restored count (non-vacuity)').toBeGreaterThanOrEqual(1)

    // Assertion group 2 — the secret-class placeholder survives
    // BYTE-IDENTICAL; the raw secret never reaches stdout.
    expect(run.stdout).toContain(secretPlaceholder)
    expect(run.stdout).not.toContain(SECRET_ORIGINAL)

    // Assertion group 3 — the summary reports exactly one secret skip, and
    // sessions=1 proves the REAL persisted map was read (not an empty store).
    expect(run.stderr).toContain('secret-skipped=1')
    expect(Number(summary![4]), 'sessions count (real map read)').toBe(1)
    // The audit append must have succeeded — a failed write would make
    // assertion group 4 vacuous.
    expect(run.stderr).not.toContain('audit write failed')

    // Assertion group 4 — the audit line under the injected cwd is hash-only:
    // neither canary appears raw (end-to-end sanity; full sweep is 10-08).
    const auditRaw = await readFile(join(cwd, '.mrclean', 'audit.jsonl'), 'utf8')
    const lines = auditRaw.split('\n').filter((line) => line.trim().length > 0)
    expect(lines.length, 'audit non-vacuity: at least one record written').toBeGreaterThanOrEqual(1)
    expect(auditRaw).not.toContain(WORD_ORIGINAL)
    expect(auditRaw).not.toContain(SECRET_ORIGINAL)
    const record = JSON.parse(lines[lines.length - 1]!) as {
      action: string
      restored: number
      skippedSecret: number
      hashes: string[]
    }
    expect(record.action).toBe('restore')
    expect(record.restored).toBe(1)
    expect(record.skippedSecret).toBe(1)
    expect(record.hashes).toHaveLength(1)
  })
})
