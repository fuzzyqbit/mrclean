/**
 * Session-state janitor: reason-aware SessionEnd deletion + TTL orphan sweep
 * (REVMODE-07, plan 09-06).
 *
 * D-06 fail-toward-privacy lifecycle: retention is an ALLOWLIST of exactly
 * ['resume']. The documented delete set (clear / logout / prompt_input_exit
 * / other), the documented-but-not-retained `bypass_permissions_disabled`
 * (src/shared/types.ts:76-78), AND any unknown future reason string all
 * delete the session's key + map. Over-deletion costs a cosmetic
 * re-redaction; under-deletion leaves recoverable originals resting on disk.
 *
 * Two RESEARCH-resolved traps are binding here:
 *
 *   - Deletion order is KEY first, then MAP (D-05): once the key is gone,
 *     any surviving or concurrently-recreated ciphertext is permanently
 *     dead — that IS the crash-cleanup story, and it is why the janitor
 *     needs no lock.
 *   - TTL aging uses MAP mtime ONLY (Pitfall 4): the key file is written
 *     once and its mtime never refreshes; aging by it would delete every
 *     live session after ttl_hours of wall time. The map's mtime refreshes
 *     on every write, so a live session always looks fresh.
 *
 * sid gate (Pitfall 5 / T-09-06-01): the janitor turns sid into unlink
 * targets — isValidSessionId runs BEFORE any path derivation and an invalid
 * sid (traversal attempt, synthetic 'mcp-server', future format drift)
 * deletes NOTHING.
 *
 * Sweep candidacy (T-09-06-06): only filenames we provably created —
 * `<uuid>.key` under keys/, `<uuid>.map` and `*.tmp` under sessions/ — are
 * ever considered; non-conforming names are never touched.
 *
 * TOTAL-ERROR DISCIPLINE (D-07/D-08): both exported functions resolve on
 * every input. Each unlink/stat/readdir is individually guarded; unexpected
 * failures emit ONE single-line JSON stderr warn ({ warn, sessionId? } —
 * the post-tool-use.ts:84-89 shape; never raw values, error text, or
 * paths). Call sites wrap again (belt-and-braces) so a janitor bug can
 * never exit-2 a SessionStart or stop the MCP server.
 */

import { readdir, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { keyPathFor, mapPathFor, statePaths } from './map-store.js'
import { SESSION_ID_RE, isValidSessionId } from './session-map.js'

// ---------------------------------------------------------------------------
// Constants + option shapes (pinned interface, 09-06)
// ---------------------------------------------------------------------------

/** Grace for unpaired/tmp files — covers the first-allocation race window
 *  (the key exists milliseconds before its initial map is written). */
export const ORPHAN_GRACE_MS = 60_000

const MS_PER_HOUR = 3_600_000

/** Test-injection surface shared by both janitor entry points. */
export interface JanitorOpts {
  baseDir?: string
  now?: () => number
}

export interface TtlSweepOpts {
  ttlHours: number
  baseDir?: string
  now?: () => number
}

/** Production base: `~/.mrclean` (map-store.ts baseDir contract). */
function defaultBaseDir(): string {
  return join(homedir(), '.mrclean')
}

// ---------------------------------------------------------------------------
// Total-error primitives
// ---------------------------------------------------------------------------

/**
 * Single-line JSON stderr warn (post-tool-use.ts:84-89 shape). Static
 * message + sessionId only — never raw values, fs error text (Node embeds
 * paths in it), or file contents (hash-only discipline).
 */
function warnJanitor(message: string, sessionId?: string): void {
  try {
    const payload = sessionId === undefined ? { warn: message } : { warn: message, sessionId }
    process.stderr.write(JSON.stringify(payload) + '\n')
  } catch {
    // Even a broken stderr must never break the janitor (total-error policy).
  }
}

/**
 * Unlink one target. ENOENT is success-equivalent — the janitor runs
 * unconditionally at SessionEnd and deleting a nonexistent file is a no-op.
 * Any other failure warns once and is swallowed (per-target isolation: a
 * stuck map never stops the key delete that precedes it — D-05).
 */
async function deleteQuietly(path: string, sessionId?: string): Promise<void> {
  try {
    await unlink(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      warnJanitor('mrclean janitor delete failed', sessionId)
    }
  }
}

/**
 * List a state dir. ENOENT (dir never created) => null, silently; any other
 * failure (EACCES etc.) => null with ONE warn. A null from EITHER dir aborts
 * the whole sweep: classifying against an unreadable dir would misread live
 * pairs as orphans and delete their keys out from under running sessions.
 */
async function readDirSafe(dir: string): Promise<string[] | null> {
  try {
    return await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      warnJanitor('mrclean janitor sweep readdir failed')
    }
    return null
  }
}

/** mtime age in ms against `now`, or null when the entry cannot be stat'ed
 *  (vanished mid-sweep, EACCES, …) — a null is never a delete candidate. */
async function ageOf(path: string, now: number): Promise<number | null> {
  try {
    return now - (await stat(path)).mtimeMs
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// SessionEnd janitor (D-05/D-06)
// ---------------------------------------------------------------------------

/**
 * Reason-aware end-of-session cleanup. Config-free by design: the retention
 * allowlist is code, not config, and deleting nonexistent files is a no-op —
 * so the SessionEnd handler calls this unconditionally.
 *
 * TOTAL: never throws; resolves on every input.
 */
export async function runSessionEndJanitor(
  sid: string,
  reason: string,
  opts?: JanitorOpts,
): Promise<void> {
  // Pitfall 5 gate FIRST: sid derives every delete target below. An invalid
  // sid deletes NOTHING — no reversible state can exist for it anyway.
  if (!isValidSessionId(sid)) {
    return
  }
  // D-06 allowlist: retain on exactly 'resume'. Every other reason —
  // documented delete set, bypass_permissions_disabled, or any unknown
  // future string — falls through to deletion (fail-toward-privacy).
  if (reason === 'resume') {
    return
  }
  const baseDir = opts?.baseDir ?? defaultBaseDir()
  // D-05 ordering (load-bearing): KEY before MAP. Once the key is gone the
  // ciphertext is permanently dead, so no lock is needed; each delete is
  // individually isolated so a stuck map cannot save the key.
  await deleteQuietly(keyPathFor(baseDir, sid), sid)
  await deleteQuietly(mapPathFor(baseDir, sid), sid)
}

// ---------------------------------------------------------------------------
// TTL sweep (D-07, Pitfall 4)
// ---------------------------------------------------------------------------

interface SweepCandidates {
  /** sids present in BOTH dirs — aged by MAP mtime only (Pitfall 4). */
  paired: string[]
  /** sids with a map but no key — undecryptable; aged vs ORPHAN_GRACE_MS. */
  orphanMaps: string[]
  /** sids with a key but no map — aged vs ORPHAN_GRACE_MS. */
  orphanKeys: string[]
  /** `*.tmp` basenames under sessions/ — crashed-write litter. */
  tmps: string[]
}

/** Extract a sid from `<uuid><ext>`; anything else was not created by us. */
function sidFromName(name: string, ext: string): string | null {
  if (!name.endsWith(ext)) {
    return null
  }
  const sid = name.slice(0, -ext.length)
  return SESSION_ID_RE.test(sid) ? sid : null
}

/**
 * Pure classification of raw dir listings into sweep candidates. Only
 * filenames we provably created are candidates — non-conforming names
 * (README.md, notauuid.map, <uuid>.map.bak, …) are never touched
 * (T-09-06-06: shared dirs may contain foreign files).
 */
function classifySweepEntries(keyNames: string[], sessionNames: string[]): SweepCandidates {
  const keySids = new Set<string>()
  for (const name of keyNames) {
    const sid = sidFromName(name, '.key')
    if (sid !== null) {
      keySids.add(sid)
    }
  }

  const paired: string[] = []
  const orphanMaps: string[] = []
  const tmps: string[] = []
  const mapSids = new Set<string>()
  for (const name of sessionNames) {
    if (name.endsWith('.tmp')) {
      tmps.push(name)
      continue
    }
    const sid = sidFromName(name, '.map')
    if (sid === null) {
      continue
    }
    mapSids.add(sid)
    if (keySids.has(sid)) {
      paired.push(sid)
    } else {
      orphanMaps.push(sid)
    }
  }

  const orphanKeys = [...keySids].filter((sid) => !mapSids.has(sid))
  return { paired, orphanMaps, orphanKeys, tmps }
}

/**
 * TTL orphan sweep — runs at SessionStart and MCP-server boot (D-07's two
 * mandated sites; headless sessions never fire SessionEnd, E5).
 *
 * Rules:
 *   - paired sid: MAP mtime age > ttlHours ⇒ delete key then map (D-05
 *     order). The key's own mtime is NEVER consulted (Pitfall 4).
 *   - unpaired half (map w/o key, key w/o map): own mtime older than the
 *     60 s grace ⇒ delete.
 *   - `*.tmp` under sessions/ older than the grace ⇒ delete.
 *   - missing dirs ⇒ return silently; unreadable dirs ⇒ warn + return
 *     (classification against an unreadable dir would be unsound).
 *
 * TOTAL: never throws; per-entry try/catch throughout.
 */
export async function runTtlSweep(opts: TtlSweepOpts): Promise<void> {
  const baseDir = opts.baseDir ?? defaultBaseDir()
  const now = opts.now?.() ?? Date.now()
  const ttlMs = opts.ttlHours * MS_PER_HOUR
  const { keysDir, sessionsDir } = statePaths(baseDir)

  const keyNames = await readDirSafe(keysDir)
  if (keyNames === null) {
    return
  }
  const sessionNames = await readDirSafe(sessionsDir)
  if (sessionNames === null) {
    return
  }

  const { paired, orphanMaps, orphanKeys, tmps } = classifySweepEntries(keyNames, sessionNames)

  // Paired sessions age by MAP mtime ONLY (Pitfall 4): the map refreshes on
  // every write; the once-written key never does. A live session with an
  // old key and a fresh map MUST survive this loop.
  for (const sid of paired) {
    const mapPath = mapPathFor(baseDir, sid)
    const age = await ageOf(mapPath, now)
    if (age !== null && age > ttlMs) {
      // Key first (D-05) — the same load-bearing order as SessionEnd.
      await deleteQuietly(keyPathFor(baseDir, sid), sid)
      await deleteQuietly(mapPath, sid)
    }
  }

  // Unpaired halves age by their own mtime against the grace — the grace
  // covers the first-allocation race (key exists ms before its map).
  for (const sid of orphanMaps) {
    const mapPath = mapPathFor(baseDir, sid)
    const age = await ageOf(mapPath, now)
    if (age !== null && age > ORPHAN_GRACE_MS) {
      await deleteQuietly(mapPath, sid)
    }
  }
  for (const sid of orphanKeys) {
    const keyPath = keyPathFor(baseDir, sid)
    const age = await ageOf(keyPath, now)
    if (age !== null && age > ORPHAN_GRACE_MS) {
      await deleteQuietly(keyPath, sid)
    }
  }

  // Stale tmp litter (crashed atomic writes) — same grace, no sessionId.
  for (const name of tmps) {
    const tmpPath = join(sessionsDir, name)
    const age = await ageOf(tmpPath, now)
    if (age !== null && age > ORPHAN_GRACE_MS) {
      await deleteQuietly(tmpPath)
    }
  }
}
