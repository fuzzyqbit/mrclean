/**
 * Restore audit record — Phase 10 (10-03), REVMODE-09.
 *
 * Discriminated restore audit record; hook findings stay in log.ts (LOCKED — do
 * not widen its unions). Restore operations append `action: 'restore'` summary
 * lines to the SAME `<cwd>/.mrclean/audit.jsonl` stream as hook AuditRecord
 * lines — a restore summary has no ruleId/severity/fingerprint/location, so it
 * ships as a sibling record type (RESEARCH Assumption A3), never as a widening
 * of the locked AuditRecord schema.
 *
 * Hash-at-the-boundary contract (REVMODE-09):
 *   - This module NEVER sees a raw restored original. Callers (src/restore/cli.ts)
 *     hash each distinct restored original to its first-16-hex SHA-256 form (the
 *     shipped audit-hash discipline from src/detect/findings.js) BEFORE calling
 *     buildRestoreAuditRecord. The builder input carries counts + pre-hashed
 *     strings only, and every field is destructure-picked — raw values cannot
 *     structurally reach the record.
 *   - Status counters aggregate from the audit stream alone (Assumption A2) —
 *     no sidecar state files.
 *
 * Append semantics mirror writeAuditRecord (src/audit/log.ts):
 *   - `fs.appendFile` with `flag: 'a'` for OS-level O_APPEND atomicity.
 *   - `.mrclean/` must exist before first write (created by `mrclean install`).
 *   - Failures surface as AuditWriteError — one error type spans the audit module.
 */

import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AuditWriteError } from './log.js'

// ---------------------------------------------------------------------------
// RestoreAuditRecord — discriminated restore line (sibling of AuditRecord)
// ---------------------------------------------------------------------------

/**
 * One audit line per restore invocation.
 *
 * LOCKED: Do not add fields that could carry raw originals, placeholder map
 * contents, or file paths. The CI canary tests enforce this.
 */
export interface RestoreAuditRecord {
  /** ISO-8601 timestamp (new Date().toISOString()). */
  ts: string
  /** Discriminant vs hook AuditRecord lines (whose action is never 'restore'). */
  action: 'restore'
  /** 'all' (union index, A4 default) or the validated sid when --session is used. */
  sessionScope: string
  /** Count of placeholders restored to originals in this invocation. */
  restored: number
  /** Count of placeholder-shaped tokens with no map entry. */
  unmatched: number
  /** Count of secret-class placeholders refused restoration. */
  skippedSecret: number
  /** First-16-hex SHA-256 of each DISTINCT restored original, sorted (deterministic). */
  hashes: string[]
}

// ---------------------------------------------------------------------------
// buildRestoreAuditRecord
// ---------------------------------------------------------------------------

/**
 * Build a RestoreAuditRecord from counts + PRE-hashed values — purely a builder,
 * no I/O.
 *
 * Hashing happens at the caller boundary (src/restore/cli.ts): this module never
 * sees a raw original. Hashes are normalised to distinct sorted order so the
 * record is deterministic regardless of caller iteration order; the input array
 * is never mutated.
 */
export function buildRestoreAuditRecord(input: {
  sessionScope: string
  restored: number
  unmatched: number
  skippedSecret: number
  hashes: string[]
}): RestoreAuditRecord {
  // LOCKED: NEVER add raw value, original text, file path, or map contents here.
  // CI canary test enforces this. Destructure-pick every field — never blind-spread
  // `input`: TS structural typing lets an over-shaped object (e.g. one carrying a
  // raw `value`) pass the param type, and a spread would serialise it (CR-01).
  return {
    ts: new Date().toISOString(),
    action: 'restore',
    sessionScope: input.sessionScope,
    restored: input.restored,
    unmatched: input.unmatched,
    skippedSecret: input.skippedSecret,
    hashes: [...new Set(input.hashes)].sort(),
  }
}

// ---------------------------------------------------------------------------
// writeRestoreAuditRecord
// ---------------------------------------------------------------------------

/**
 * Append one JSONL restore record to `.mrclean/audit.jsonl` in the given `cwd`.
 *
 * Mirrors writeAuditRecord's append discipline (src/audit/log.ts): O_APPEND via
 * `flag: 'a'`, `.mrclean/` must already exist, typed AuditWriteError on failure
 * with the install hint for the ENOENT case.
 *
 * @param cwd    - Project root directory.
 * @param record - The RestoreAuditRecord to write (hash-only by construction).
 * @throws       - `AuditWriteError` if the write fails (including ENOENT for missing dir).
 */
export async function writeRestoreAuditRecord(
  cwd: string,
  record: RestoreAuditRecord,
): Promise<void> {
  const logPath = auditLogPath(cwd)
  const line = JSON.stringify(record) + '\n'

  try {
    await appendFile(logPath, line, { flag: 'a', encoding: 'utf8' })
  } catch (err) {
    const message = isEnoent(err)
      ? 'mrclean audit: .mrclean/ not found — run `mrclean install`'
      : `mrclean audit: failed to write to ${logPath}`
    throw new AuditWriteError(message, err)
  }
}

// ---------------------------------------------------------------------------
// aggregateRestoreCounters
// ---------------------------------------------------------------------------

/**
 * Sum restored/unmatched counters over all `action: 'restore'` lines in
 * `<cwd>/.mrclean/audit.jsonl`.
 *
 * Total-error reader (T-10-03-03) — the audit file is untrusted after write:
 *   - missing file (ENOENT)   => zeros
 *   - unreadable file         => zeros
 *   - malformed JSON line     => skipped, remaining lines still summed
 *   - non-numeric counter     => counted as 0 for that line (Number coercion guard)
 * Never throws — tampered audit lines cannot crash the status surface.
 */
export async function aggregateRestoreCounters(
  cwd: string,
): Promise<{ restored_total: number; unmatched_total: number }> {
  let content: string
  try {
    content = await readFile(auditLogPath(cwd), 'utf8')
  } catch {
    return { restored_total: 0, unmatched_total: 0 }
  }

  let restoredTotal = 0
  let unmatchedTotal = 0

  for (const line of content.split('\n')) {
    if (line.length === 0) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue // malformed line — skip, never throw
    }
    if (!isRestoreLine(parsed)) continue

    restoredTotal += finiteOrZero(parsed['restored'])
    unmatchedTotal += finiteOrZero(parsed['unmatched'])
  }

  return { restored_total: restoredTotal, unmatched_total: unmatchedTotal }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function auditLogPath(cwd: string): string {
  return join(cwd, '.mrclean', 'audit.jsonl')
}

/** A parsed line counts as a restore record iff its discriminant is exactly 'restore'. */
function isRestoreLine(parsed: unknown): parsed is Record<string, unknown> {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as Record<string, unknown>)['action'] === 'restore'
  )
}

/** Number-coerce a counter field; anything non-finite contributes 0. */
function finiteOrZero(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}
