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
 * Sweep candidacy (T-09-06-06): only filenames our own stack provably
 * creates are ever considered — `<uuid>.key` and key-publish tmp litter
 * `<uuid>.key.<digits>` under keys/; `<uuid>.map`, write-file-atomic tmp
 * litter `<uuid>.map.<digits>` (v7 getTmpname appends a uint32 — wfa NEVER
 * produces `*.tmp`), and proper-lockfile's `<uuid>.map.lock` lock
 * DIRECTORIES under sessions/. Non-conforming names (including foreign
 * `*.tmp` files) are never touched.
 *
 * TOTAL-ERROR DISCIPLINE (D-07/D-08): both exported functions resolve on
 * every input. Each unlink/stat/readdir is individually guarded; unexpected
 * failures emit ONE single-line JSON stderr warn ({ warn, sessionId? } —
 * the post-tool-use.ts:84-89 shape; never raw values, error text, or
 * paths). Call sites wrap again (belt-and-braces) so a janitor bug can
 * never exit-2 a SessionStart or stop the MCP server.
 */

import { readdir, rm, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { keyPathFor, mapPathFor, statePaths } from './map-store.js'
import { SESSION_ID_RE, isValidSessionId } from './session-map.js'

// ---------------------------------------------------------------------------
// Constants + option shapes (pinned interface, 09-06)
// ---------------------------------------------------------------------------

/** Grace for unpaired halves, atomic-write litter and stale lock dirs —
 *  covers the first-allocation race window (the key exists milliseconds
 *  before its initial map is written) and comfortably exceeds
 *  proper-lockfile's held-lock mtime refresh interval. */
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

/**
 * Remove one stale lock DIRECTORY (proper-lockfile's artifact is a dir, so
 * unlink cannot touch it). force:true makes a dir that vanished mid-sweep a
 * no-op; any other failure warns once and is swallowed (same per-target
 * isolation as deleteQuietly).
 */
async function removeDirQuietly(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true })
  } catch {
    warnJanitor('mrclean janitor delete failed')
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
  /** `<uuid>.map.<digits>` basenames under sessions/ — write-file-atomic v7
   *  tmp litter (getTmpname appends a uint32) left by SIGKILL/OOM/power loss
   *  (signal-exit only covers catchable exits). */
  mapLitter: string[]
  /** `<uuid>.key.<digits>` basenames under keys/ — key-publish tmp litter
   *  (map-store's atomic create-once dance) left by a crash between the tmp
   *  write and its link(2) publication. */
  keyLitter: string[]
  /** `<uuid>.map.lock` basenames under sessions/ — proper-lockfile lock DIRS
   *  left by a killed holder that never re-contended (stale takeover only
   *  fires when someone re-contends that map). */
  staleLocks: string[]
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
 * True for `<uuid><ext>.<digits>` — the tmp shape our atomic-write stack
 * actually produces (write-file-atomic v7 getTmpname: `<target>.<uint32>`;
 * it NEVER produces `*.tmp`). The sid segment must be strictly ours —
 * foreign files that merely look tmp-ish are never candidates.
 */
function isOwnLitterName(name: string, ext: string): boolean {
  const lastDot = name.lastIndexOf('.')
  if (lastDot === -1) {
    return false
  }
  if (!/^\d+$/.test(name.slice(lastDot + 1))) {
    return false
  }
  return sidFromName(name.slice(0, lastDot), ext) !== null
}

/** True for `<uuid>.map.lock` — proper-lockfile's lock DIRECTORY for a map. */
function isOwnLockDirName(name: string): boolean {
  if (!name.endsWith('.lock')) {
    return false
  }
  return sidFromName(name.slice(0, -'.lock'.length), '.map') !== null
}

/**
 * Pure classification of raw dir listings into sweep candidates. Only
 * filenames our own stack provably creates are candidates — non-conforming
 * names (README.md, notauuid.map, <uuid>.map.bak, foo.tmp, …) are never
 * touched (T-09-06-06: shared dirs may contain foreign files).
 */
function classifySweepEntries(keyNames: string[], sessionNames: string[]): SweepCandidates {
  const keySids = new Set<string>()
  const keyLitter: string[] = []
  for (const name of keyNames) {
    const sid = sidFromName(name, '.key')
    if (sid !== null) {
      keySids.add(sid)
      continue
    }
    if (isOwnLitterName(name, '.key')) {
      keyLitter.push(name)
    }
  }

  const paired: string[] = []
  const orphanMaps: string[] = []
  const mapLitter: string[] = []
  const staleLocks: string[] = []
  const mapSids = new Set<string>()
  for (const name of sessionNames) {
    const sid = sidFromName(name, '.map')
    if (sid !== null) {
      mapSids.add(sid)
      if (keySids.has(sid)) {
        paired.push(sid)
      } else {
        orphanMaps.push(sid)
      }
      continue
    }
    if (isOwnLitterName(name, '.map')) {
      mapLitter.push(name)
      continue
    }
    if (isOwnLockDirName(name)) {
      staleLocks.push(name)
    }
  }

  const orphanKeys = [...keySids].filter((sid) => !mapSids.has(sid))
  return { paired, orphanMaps, orphanKeys, mapLitter, keyLitter, staleLocks }
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
 *   - write-file-atomic litter `<uuid>.map.<digits>` under sessions/ and
 *     key-publish litter `<uuid>.key.<digits>` under keys/ older than the
 *     grace ⇒ delete (real tmp naming of our atomic writers — never `*.tmp`).
 *   - stale lock dirs `<uuid>.map.lock` under sessions/ older than the
 *     grace ⇒ remove (a HELD lock's mtime refreshes every ~1.25 s, so it
 *     can never age past the grace).
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

  const { paired, orphanMaps, orphanKeys, mapLitter, keyLitter, staleLocks } =
    classifySweepEntries(keyNames, sessionNames)

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

  // Crashed atomic-write litter (`<sid>.map.<digits>` — write-file-atomic
  // v7's real tmp naming; SIGKILL/OOM/power loss defeat its signal-exit
  // cleanup) — same grace, no sessionId in warns.
  for (const name of mapLitter) {
    const litterPath = join(sessionsDir, name)
    const age = await ageOf(litterPath, now)
    if (age !== null && age > ORPHAN_GRACE_MS) {
      await deleteQuietly(litterPath)
    }
  }

  // Key-publish tmp litter (`<sid>.key.<digits>` — map-store's atomic
  // create-once dance; a crash between the tmp write and its link(2)
  // publication leaves the tmp behind).
  for (const name of keyLitter) {
    const litterPath = join(keysDir, name)
    const age = await ageOf(litterPath, now)
    if (age !== null && age > ORPHAN_GRACE_MS) {
      await deleteQuietly(litterPath)
    }
  }

  // Stale lock DIRS (`<sid>.map.lock`): proper-lockfile refreshes a held
  // lock's mtime every ~1.25 s, so a dir past the 60 s grace belongs to a
  // killed holder that never re-contended.
  for (const name of staleLocks) {
    const lockPath = join(sessionsDir, name)
    const age = await ageOf(lockPath, now)
    if (age !== null && age > ORPHAN_GRACE_MS) {
      await removeDirQuietly(lockPath)
    }
  }
}
