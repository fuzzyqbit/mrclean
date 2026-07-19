/**
 * `mrclean restore` CLI action — plan 10-05 (REVMODE-01 / REVMODE-08 /
 * REVMODE-09).
 *
 * runRestore composes the wave-1 contracts into the operator round-trip:
 * stdin-or-file read → buildRestoreIndex (10-02) → restoreText (10-01) →
 * stdout emission → hash-only audit (10-03). Operator-only: the SOLE
 * sanctioned import site is the dynamic import inside src/cli.ts's
 * `.action()` (fence-locked in 10-07) — the hook cold path never loads this
 * module.
 *
 * Stream discipline (HOOK-06 carried over): stdout receives ONLY the
 * restored payload; every diagnostic and the counts summary go to stderr.
 * Warning copy is constant-shape — never values, never map paths, never
 * fs-error text (T-10-05-02).
 *
 * Error domains (REVMODE-08, planner pin A5):
 * - HARD input errors exit 2: malformed --session (validated BEFORE any
 *   path derivation, sid never echoed — T-10-05-01), unreadable input
 *   file (the echoed path is the operator's own argument), and an errored
 *   stdin stream (constant line, never stream-error text — 11-REVIEW
 *   WR-04). The gates set
 *   `process.exitCode = 2` and RETURN — never `process.exit()` (WR-03):
 *   stderr writes are async when piped on POSIX, and process.exit() does
 *   not wait for pending stream flushes, so exiting immediately after
 *   stderr.write could drop the only operator-facing diagnostic. Letting
 *   the event loop drain flushes the line; Node then exits with code 2.
 * - EVERY cosmetic failure degrades one-way: stdout === input for affected
 *   tokens, one constant warning, exit 0 — pipe-friendly, never blocking.
 * - Restore and redact share NO kill switch: this module reads config for
 *   NOTHING and imports nothing from detect-engine/hook/config/state-write
 *   paths (Pitfall 6). Reads are lock-free by the store's atomic-rename
 *   design — a held hook-side map lock never blocks or degrades a restore.
 *
 * Write surface is EXACTLY stdout + stderr + <cwd>/.mrclean/audit.jsonl
 * (Pitfall 7): sessions/ and keys/ are never written, never mtime-refreshed
 * (TTL heartbeat preserved — T-10-05-05).
 *
 * Hash boundary (T-10-05-03): raw restored originals are hashed to their
 * first-16-hex SHA-256 form (redactedHash, distinct + sorted) HERE and
 * nowhere logged — the audit builder never sees a raw value.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { buildRestoreAuditRecord, writeRestoreAuditRecord } from '../audit/restore-log.js'
import { redactedHash } from '../detect/findings.js'
import { isValidSessionId } from '../state/session-map.js'
import { restoreText } from './index.js'
import { buildRestoreIndex } from './session-index.js'

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RunRestoreOpts {
  /** Input file path; absent ⇒ read stdin to EOF. */
  file?: string
  /** sid narrowing; validated HERE before any path derivation. */
  session?: string
  /** Default process.cwd() — audit sink scope. */
  cwd?: string
  /** Default join(homedir(), '.mrclean') — TEST-ONLY override (state precedent). */
  baseDir?: string
  /** Default process.stdin — test seam. */
  stdin?: NodeJS.ReadableStream
}

// ---------------------------------------------------------------------------
// Pinned stderr copy (byte-locked by tests/cli/restore.test.ts +
// tests/restore/degrade.test.ts — single-line, '\n'-terminated, never
// values/map-paths/fs-error text)
// ---------------------------------------------------------------------------

const WARN_NO_MAPS = '[mrclean] restore: no readable session map — placeholders left unchanged\n'
const WARN_AUDIT_FAILED = '[mrclean] restore: audit write failed — restored output unaffected\n'
const ERR_BAD_SESSION = '[mrclean] restore: invalid --session id (expected UUID)\n'
const ERR_STDIN_READ = '[mrclean] restore: cannot read stdin\n'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Production state root (janitor/state 2-line idiom; tests always inject). */
function defaultBaseDir(): string {
  return join(homedir(), '.mrclean')
}

/**
 * Accumulate a stream to EOF (RESEARCH Code Example 3). The hook's
 * readStdinWithTimeout is deliberately the WRONG shape here — its 10 s
 * timeout + exit-0-on-stall is hook-contract behavior; an operator CLI
 * reads until the pipe closes. Buffer-concat (not string +=) keeps
 * multi-byte UTF-8 sequences split across chunk boundaries intact.
 */
async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Immutable counts snapshot for the always-last summary line. */
interface SummaryCounts {
  restored: number
  unmatched: number
  skippedSecret: number
  sessions: number
}

const ZERO_COUNTS: SummaryCounts = { restored: 0, unmatched: 0, skippedSecret: 0, sessions: 0 }

function summaryLine(counts: SummaryCounts): string {
  return (
    `[mrclean] restore: restored=${counts.restored} unmatched=${counts.unmatched} ` +
    `secret-skipped=${counts.skippedSecret} sessions=${counts.sessions}\n`
  )
}

// ---------------------------------------------------------------------------
// runRestore
// ---------------------------------------------------------------------------

/**
 * The operator restore round-trip. Hard input errors exit 2; everything
 * else resolves with exit 0 (cosmetic degrade = pass-through + warning).
 */
export async function runRestore(opts: RunRestoreOpts): Promise<void> {
  const {
    file,
    session,
    cwd = process.cwd(),
    baseDir = defaultBaseDir(),
    stdin = process.stdin,
  } = opts

  // (1) HARD gate: hostile-shaped --session is validated BEFORE any path
  // derivation and NEVER echoed (T-10-05-01; state/index.ts non-echo
  // precedent). Outside the degrade try/catch on purpose — exit 2 is real.
  // exitCode + return (never process.exit — WR-03): the diagnostic must
  // survive a piped stderr; exit() would race the pending async write.
  if (session !== undefined && !isValidSessionId(session)) {
    process.stderr.write(ERR_BAD_SESSION)
    process.exitCode = 2
    return
  }

  // (2) HARD gate: unreadable input file exits 2 (same exitCode + return
  // flush discipline as gate 1). The echoed path is the operator's OWN
  // argument — never a derived map path.
  let input: string
  if (file !== undefined) {
    try {
      input = await readFile(file, 'utf8')
    } catch {
      process.stderr.write(`[mrclean] restore: cannot read input file: ${file}\n`)
      process.exitCode = 2
      return
    }
  } else {
    // (2b) HARD gate (11-REVIEW WR-04): an errored stdin stream (closed fd,
    // EIO on hangup, broken pipe upstream) is a hard input error exactly
    // like the unreadable-file branch above — same constant-line + exitCode
    // + return flush discipline, never stream-error text. Without this
    // catch the readAll rejection escaped runRestore into src/cli.ts's
    // top-level `await program.parseAsync(...)` as an unhandled-rejection
    // crash: raw stack on stderr, exit 1 — neither contracted domain.
    try {
      input = await readAll(stdin)
    } catch {
      process.stderr.write(ERR_STDIN_READ)
      process.exitCode = 2
      return
    }
  }

  // (3)-(7) total posture (state/index.ts persistAllocations precedent): a
  // cosmetic failure can never produce a nonzero exit or a lost output.
  let counts = ZERO_COUNTS
  let stdoutWritten = false
  let warnedNoMaps = false
  try {
    // (3) Lock-free discovery + policy-gated inverted index (10-02) — the
    // total-error read path funnels every corruption shape into sessions=0
    // or unmatched pass-through; runRestore adds NO new failure modes.
    const index = await buildRestoreIndex(baseDir, session)

    // (4) Constant-shape degrade warning — no values, no paths, no fs detail.
    if (index.sessions === 0) {
      process.stderr.write(WARN_NO_MAPS)
      warnedNoMaps = true
    }

    // (5) Single-pass exact-lookup engine (10-01).
    const result = restoreText(input, index.placeholders, index.secretPlaceholders)
    counts = {
      restored: result.restored,
      unmatched: result.unmatched,
      skippedSecret: result.skippedSecret,
      sessions: index.sessions,
    }

    // (6) THE ONLY stdout write — the restored payload, nothing else.
    process.stdout.write(result.text)
    stdoutWritten = true

    // (7) Hash boundary (T-10-05-03): distinct + sorted redactedHash of the
    // restored originals — raw values travel NO further than this expression.
    try {
      const hashes = [...new Set(result.restoredOriginals)].map(redactedHash).sort()
      const record = buildRestoreAuditRecord({
        sessionScope: session ?? 'all',
        restored: result.restored,
        unmatched: result.unmatched,
        skippedSecret: result.skippedSecret,
        hashes,
      })
      await writeRestoreAuditRecord(cwd, record)
    } catch {
      // Best-effort audit (T-10-05-06 accepted residual, shipped hook
      // posture): warn + continue — restored output is unaffected.
      process.stderr.write(WARN_AUDIT_FAILED)
    }
  } catch {
    // Belt-and-braces: an UNEXPECTED throw (the wave-1 read path is total,
    // so this is defense in depth) degrades one-way — output equals input,
    // constant warning, exit 0. Flags prevent double stdout/warn emission.
    // IN-01a: reset FIRST — the summary must never report pre-throw counts;
    // a run whose catch fired reports ZERO work (honest degrade).
    counts = ZERO_COUNTS
    if (!stdoutWritten) {
      try {
        process.stdout.write(input)
      } catch {
        // IN-01b: degrade is one-way — if even the fallback write fails
        // there is nothing safer to do; the warning + zero-counts summary
        // on stderr are the signal. This documented swallow IS the error
        // handling.
      }
    }
    if (!warnedNoMaps) {
      process.stderr.write(WARN_NO_MAPS)
    }
  }

  // (8) Counts summary — ALWAYS the last stderr line, never on stdout.
  process.stderr.write(summaryLine(counts))
}
