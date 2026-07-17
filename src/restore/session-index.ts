/**
 * Restore session index: discovery + policy-filtered inverted index over the
 * encrypted session store (REVMODE-01, plan 10-02).
 *
 * TRUST DIRECTION: src/restore/ runs in the OPPOSITE direction from
 * src/placeholder/ — it re-introduces sensitive originals into operator-local
 * memory for the `mrclean restore` CLI, never onto the model-facing path.
 * Nothing under src/hook/, src/detect/, src/placeholder/, or src/mcp/ may
 * ever import this module (cold-path fence direction is enforced by the
 * Phase 10 fence tests; the sanctioned consumer is the CLI, dynamically
 * imported).
 *
 * THE READ-SIDE POLICY GATE (the third layer, reserved by Phase 9):
 * only entries passing `isRestorableType(entry.type) && 'original' in entry`
 * contribute a placeholder->original pair — on top of the write-time secret
 * floor (serializer strip) and the parse-time drop. A hand-poisoned map
 * (secret-class entry carrying `original`, re-encrypted under the real key)
 * contributes NOTHING restorable. OVF-labelled placeholders are excluded at
 * build time: multiple originals share one OVF token, so inversion would be
 * an ambiguous wrong-value restore (Pitfall 1).
 *
 * READ-ONLY BY DESIGN (Pitfall 7 / REVMODE-08 groundwork): the fs surface is
 * EXACTLY readdir + readSessionMapFile — zero write calls, zero locks, zero
 * stat. Reads are lock-free by the store's atomic-rename design, and reading
 * never refreshes map mtime (the TTL heartbeat), so a restore can neither
 * make an abandoned session look live nor contend hook-path locks. Decrypt
 * happens ONLY inside readSessionMapFile (THE chokepoint — no own crypto
 * here; cipher primitives are confined to src/state/). The hydration facade
 * read is deliberately NOT used (Pitfall 3): it drops `original` fields and
 * fabricates a fresh provisional map on failure — both wrong for restore.
 */

import { readdir } from 'node:fs/promises'

import { readSessionMapFile, statePaths } from '../state/map-store.js'
import { isRestorableType, isValidSessionId, SESSION_ID_RE } from '../state/session-map.js'

/** Session-map filename extension (janitor candidacy shape: `<uuid>.map`). */
const MAP_EXT = '.map'

/** OVF label segment inside a v2 token — ambiguous shared token (Pitfall 1). */
const OVF_LABEL = ':OVF:'

/**
 * The policy-filtered restore index. Built fresh per call — callers never
 * receive shared mutable state.
 */
export interface RestoreIndex {
  /** placeholder -> original, policy-gated (restorable-typed, non-OVF). */
  placeholders: ReadonlyMap<string, string>
  /** Placeholders of entries FAILING the restorable gate (secret-class). */
  secretPlaceholders: ReadonlySet<string>
  /** Count of maps that decrypted successfully. */
  sessions: number
}

/** Structurally-empty index (fresh instances — immutability discipline). */
function emptyRestoreIndex(): RestoreIndex {
  return { placeholders: new Map(), secretPlaceholders: new Set(), sessions: 0 }
}

/**
 * Extract a sid from `<uuid>.map`; anything else was not created by us.
 *
 * Duplicates the janitor's private sidFromName discipline (janitor.ts) on
 * purpose — different trust tier: the janitor DELETES against this shape,
 * restore only READS, and sharing a helper would couple the error domains
 * REVMODE-08 keeps separate.
 */
function sidFromMapName(name: string): string | null {
  if (!name.endsWith(MAP_EXT)) {
    return null
  }
  const sid = name.slice(0, -MAP_EXT.length)
  return SESSION_ID_RE.test(sid) ? sid : null
}

/**
 * List candidate sids in the sessions dir. ENOENT (dir never created) and
 * every other listing failure yield the SAME empty list — an absent store
 * means zero sessions, never a throw (total-error read discipline).
 */
async function listCandidateSids(sessionsDir: string): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(sessionsDir)
  } catch {
    return []
  }
  return names.map(sidFromMapName).filter((sid): sid is string => sid !== null)
}

/**
 * Build the policy-filtered inverted index (placeholder -> original) plus
 * the secret-placeholder set the restore engine short-circuits on.
 *
 * Default scope is the union across ALL live decryptable maps (planner pin
 * A4): nonce8 in every token makes cross-session collisions structurally
 * absent. An optional sessionFilter narrows to one map — it is validated
 * via isValidSessionId BEFORE any path derivation (Pitfall 5 / janitor gate
 * order), even though callers validate too (defense in depth): an invalid
 * filter returns an empty index having touched zero paths.
 *
 * Corrupt/undecryptable maps are skipped silently and never counted in
 * `sessions` (they are janitor candidacy, not restore input).
 */
export async function buildRestoreIndex(
  baseDir: string,
  sessionFilter?: string,
): Promise<RestoreIndex> {
  if (sessionFilter !== undefined && !isValidSessionId(sessionFilter)) {
    return emptyRestoreIndex()
  }
  const { sessionsDir } = statePaths(baseDir)
  const discovered = await listCandidateSids(sessionsDir)
  const candidates =
    sessionFilter === undefined ? discovered : discovered.filter((sid) => sid === sessionFilter)

  const placeholders = new Map<string, string>()
  const secretPlaceholders = new Set<string>()
  let sessions = 0
  for (const sid of candidates) {
    const map = await readSessionMapFile(baseDir, sid) // total-error: null on ANY failure
    if (map === null) {
      continue
    }
    sessions += 1
    for (const entry of Object.values(map.entries)) {
      // READ-SIDE POLICY GATE (third layer over write-time floor + parse drop)
      if (!isRestorableType(entry.type)) {
        secretPlaceholders.add(entry.placeholder)
        continue
      }
      if (!('original' in entry)) {
        continue // restorable-typed but valueless: nothing to restore
      }
      if (entry.placeholder.includes(OVF_LABEL)) {
        continue // ambiguous shared token — in NEITHER structure (Pitfall 1)
      }
      placeholders.set(entry.placeholder, entry.original)
    }
  }
  return { placeholders, secretPlaceholders, sessions }
}
