/**
 * Counts-only projection over the encrypted session store (REVMODE-12, 10-06).
 *
 * First sanctioned MCP-side state READ: `original` strings never leave this
 * module's stack frames. The reducer decrypts each candidate map via the
 * readSessionMapFile chokepoint, classifies entries by TYPE alone
 * (isRestorableType), and returns numeric tallies ONLY — mirroring how
 * buildHydration (src/state/index.ts) deliberately drops `original` before
 * anything crosses a module boundary.
 *
 * Read-only by construction: zero writes, zero locks, total-error per map —
 * an undecryptable or foreign file is silently invisible, never an error
 * (the status surface keeps its never-throw posture).
 */

import { readdir } from 'node:fs/promises'
import { readSessionMapFile, statePaths } from './map-store.js'
import { isRestorableType, SESSION_ID_RE } from './session-map.js'

/** Numeric tallies over decryptable session maps under a state baseDir. */
export interface SessionEntryCounts {
  /** Decryptable maps under baseDir/sessions. */
  sessions: number
  /** Entries whose TYPE is in the frozen restorable-7 partition. */
  restorable: number
  /** All other entries (secret-class, including unknown future TYPEs). */
  secret: number
}

// ---------------------------------------------------------------------------
// Candidacy (janitor idiom, deliberately duplicated)
// ---------------------------------------------------------------------------

const MAP_EXT = '.map'

/**
 * Extract a sid from a `<uuid>.map` basename, or null for anything else.
 *
 * Deliberate duplication of janitor.ts#sidFromName: the janitor DELETES on
 * this shape (destructive trust tier); this reducer only COUNTS (read-only
 * tier). Sharing one helper would couple those trust tiers behind a single
 * edit point.
 */
function sidFromMapName(name: string): string | null {
  if (!name.endsWith(MAP_EXT)) {
    return null
  }
  const sid = name.slice(0, -MAP_EXT.length)
  return SESSION_ID_RE.test(sid) ? sid : null
}

/** List the sessions dir; ANY failure (ENOENT, ENOTDIR, EACCES) => empty —
 *  unlike janitor.ts#readDirSafe (destructive sweep aborts on null), a count
 *  over an unreadable dir is simply zero. */
async function readDirQuietly(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Count decryptable sessions and their entries by class under `baseDir`.
 *
 * Total per map: readSessionMapFile's null (missing key, tamper, wrong AAD,
 * bad schema, ...) skips the candidate silently. Absent dir / no candidates /
 * all-corrupt => all-zero counts. Never throws.
 */
export async function countSessionEntries(baseDir: string): Promise<SessionEntryCounts> {
  const names = await readDirQuietly(statePaths(baseDir).sessionsDir)
  let sessions = 0
  let restorable = 0
  let secret = 0
  for (const name of names) {
    const sid = sidFromMapName(name)
    if (sid === null) {
      continue
    }
    const map = await readSessionMapFile(baseDir, sid)
    if (map === null) {
      continue
    }
    sessions += 1
    for (const entry of Object.values(map.entries)) {
      if (isRestorableType(entry.type)) {
        restorable += 1
      } else {
        secret += 1
      }
    }
  }
  return { sessions, restorable, secret }
}
