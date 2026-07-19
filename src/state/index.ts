/**
 * State facade — the ONLY entry point hook handlers use for reversible-mode
 * session state (09-05, REVMODE-04).
 *
 * TRUST STORY (read before wiring a new caller):
 *
 * - session_id is VALIDATED HERE, at the single boundary between raw hook
 *   input and every filesystem path the adapter derives (keys/, sessions/,
 *   lock targets — Pitfall 5 / T-09-05-01). The gate is a strict UUID
 *   allowlist, never sanitize-by-transform. Synthetic ids like 'mcp-server'
 *   fail structurally, which IS the MCP-lane fence: the MCP server can never
 *   reach the store through this facade. Invalid sid ⇒ reversible
 *   unavailable for the event (one-way fallback), zero paths touched.
 *
 * - The READ path (readSessionMapForHydration) is TOTAL (Pitfall 6): map
 *   absent, corrupt, truncated, wrong-key, unreadable — every failure class
 *   lands in a FRESH PROVISIONAL hydration so reversible mode continues;
 *   the locked reconcile fixes identity at persist time. No throw is
 *   reachable — an uncaught throw would become a blocking exit-2 on
 *   PreToolUse via the fail-closed crash guards.
 *
 * - The WRITE path (persistAllocations) DEGRADES, never blocks: lock
 *   deadline exhaustion or any transaction error returns status 'degraded'
 *   with exactly ONE single-line JSON stderr warn (warn + sessionId only —
 *   hash-only discipline, T-09-05-05). Process-local allocations stand;
 *   nothing is written.
 *
 * - The locked transaction (D-01/D-02) wraps ONLY the ~1-3 ms
 *   read→reconcile→allocate→encrypt→write window — never detection. The
 *   FIRST transaction creates the key AND the initial map before releasing
 *   (first-allocation window closed — D-05 / RESEARCH Pattern 6 /
 *   T-09-05-06).
 *
 * Consumed by 09-07 (hook handlers, via lazy import) and 09-08 (stress
 * worker). The MCP lane must NOT be wired here (no CC session_id there).
 */

import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { withMapLock } from './lock.js'
import {
  ensureSessionKey,
  mapPathFor,
  readSessionMapFile,
  statePaths,
  writeSessionMapFile,
} from './map-store.js'
import {
  createEmptySessionMap,
  formatV2Token,
  hmacAddress,
  isValidSessionId,
  makeMapEntry,
  type PendingAllocation,
  type PlaceholderRename,
  type ReversibleHydration,
  type SessionMapV1,
} from './session-map.js'

// Re-export for the handler gate (handlers check BEFORE calling the facade;
// the facade re-checks internally — defense in depth).
export { isValidSessionId } from './session-map.js'

// ---------------------------------------------------------------------------
// Options + results
// ---------------------------------------------------------------------------

/**
 * Common facade options.
 *
 * `baseDir` defaults to `join(homedir(), '.mrclean')`; the override is
 * TEST-ONLY (LoadConfigOpts.homeDir injection precedent) — production
 * callers never pass it.
 */
export interface FacadeOpts {
  sessionId: string
  baseDir?: string
}

/** Options for the locked allocate-and-persist transaction. */
export interface PersistOpts extends FacadeOpts {
  pending: PendingAllocation[]
  deadlineMs: number
}

/** Outcome of persistAllocations. `renames` is [] unless status is 'ok'. */
export interface PersistResult {
  status: 'ok' | 'degraded' | 'noop'
  renames: PlaceholderRename[]
}

/** sessions/ mode mirrors map-store's DIR_MODE (D-04 custody layout). */
const SESSIONS_DIR_MODE = 0o700

function defaultBaseDir(): string {
  return join(homedir(), '.mrclean')
}

// ---------------------------------------------------------------------------
// Stderr warns (single-line JSON, hash-only discipline — T-09-05-05)
// ---------------------------------------------------------------------------

/**
 * Invalid-sid rejection warn. Deliberately carries NO sessionId field: a
 * rejected sid is hostile-shaped input (possibly a path-traversal string)
 * and is never echoed to stderr.
 */
function warnInvalidSessionId(): void {
  process.stderr.write(
    JSON.stringify({ warn: 'mrclean reversible unavailable: invalid session id' }) + '\n',
  )
}

/**
 * Persist-degrade warn: warn + sessionId ONLY (post-tool-use.ts:84-89
 * precedent). Never raw values, never paths.
 */
function warnPersistDegraded(sessionId: string): void {
  process.stderr.write(
    JSON.stringify({ warn: 'mrclean reversible persist degraded', sessionId }) + '\n',
  )
}

// ---------------------------------------------------------------------------
// Hydration read path (lock-free, total)
// ---------------------------------------------------------------------------

/** Build the manager-facing hydration closure set from a plaintext map. */
function buildHydration(map: SessionMapV1): ReversibleHydration {
  const entriesByHmac = new Map<string, { placeholder: string; type: string }>()
  for (const [address, entry] of Object.entries(map.entries)) {
    entriesByHmac.set(address, { placeholder: entry.placeholder, type: entry.type })
  }
  return {
    nonce8: map.nonce8,
    counterFloor: map.counter,
    entriesByHmac,
    hmacOf: (value: string) => hmacAddress(map.hashSalt, value),
    formatToken: (type: string, counter: number) => formatV2Token(type, counter, map.nonce8),
  }
}

/**
 * Read the session map for pre-detection manager hydration (lock-free —
 * D-02: the lock never spans detection).
 *
 * - invalid sid ⇒ null (reversible unavailable; single hash-only warn)
 * - map absent / corrupt / unreadable ⇒ FRESH PROVISIONAL hydration backed
 *   by createEmptySessionMap — reversible continues, the locked reconcile
 *   fixes identity at persist time
 * - NO throw reachable (Pitfall 6)
 */
export async function readSessionMapForHydration(
  opts: FacadeOpts,
): Promise<ReversibleHydration | null> {
  if (!isValidSessionId(opts.sessionId)) {
    warnInvalidSessionId()
    return null
  }
  const baseDir = opts.baseDir ?? defaultBaseDir()
  let map: SessionMapV1 | null
  try {
    // readSessionMapFile is already total (returns null on every failure
    // class); the catch is belt-and-braces so NOTHING can escape this path.
    map = await readSessionMapFile(baseDir, opts.sessionId)
  } catch {
    map = null
  }
  return buildHydration(map ?? createEmptySessionMap(opts.sessionId))
}

// ---------------------------------------------------------------------------
// Locked allocate-and-persist transaction (D-01/D-02 pinned algorithm)
// ---------------------------------------------------------------------------

/**
 * Reconcile pending allocations against the authoritative store map
 * (RESEARCH Pattern 2). Pure: builds a NEW map/entries object — the map
 * read from disk is never mutated.
 *
 * Every pending value is re-addressed with the AUTHORITATIVE hashSalt (a
 * provisional hydration may have used a throwaway salt):
 * - store hit  ⇒ adopt the existing placeholder (foreign/prior allocation
 *   wins — never burn a counter)
 * - store miss ⇒ next counter, fresh v2 token, insert (makeMapEntry applies
 *   the D-11 secret floor structurally)
 * - final placeholder differs from the provisional ⇒ emit a rename so the
 *   caller can correct already-substituted text before emission
 */
function reconcilePending(
  map: SessionMapV1,
  pending: readonly PendingAllocation[],
): { nextMap: SessionMapV1; renames: PlaceholderRename[] } {
  const entries: SessionMapV1['entries'] = { ...map.entries }
  const renames: PlaceholderRename[] = []
  let counter = map.counter

  for (const allocation of pending) {
    const address = hmacAddress(map.hashSalt, allocation.value)
    const existing = entries[address]
    let finalPlaceholder: string
    if (existing !== undefined) {
      finalPlaceholder = existing.placeholder
    } else {
      counter += 1
      finalPlaceholder = formatV2Token(allocation.type, counter, map.nonce8)
      entries[address] = makeMapEntry(allocation.type, finalPlaceholder, counter, allocation.value)
    }
    if (finalPlaceholder !== allocation.provisionalPlaceholder) {
      renames.push({ from: allocation.provisionalPlaceholder, to: finalPlaceholder })
    }
  }

  return { nextMap: { ...map, counter, entries }, renames }
}

/** The 5-step transaction body — runs INSIDE withMapLock only. */
async function runAllocationTransaction(
  baseDir: string,
  sessionId: string,
  pending: readonly PendingAllocation[],
): Promise<PlaceholderRename[]> {
  // 1. Key create-once INSIDE the lock — the first transaction commits key
  //    AND initial map before release (closes the key-before-map window).
  const key = await ensureSessionKey(baseDir, sessionId)
  // 2. Authoritative re-read under the lock (concurrent writes visible).
  const map = (await readSessionMapFile(baseDir, sessionId)) ?? createEmptySessionMap(sessionId)
  // 3. Reconcile every pending allocation against the authoritative store.
  const { nextMap, renames } = reconcilePending(map, pending)
  // 4. Encrypt under a fresh IV + atomic replace (wfa fsync:false). The map
  //    mtime refresh IS the TTL heartbeat (D-07).
  await writeSessionMapFile(baseDir, sessionId, nextMap, key)
  // 5. Renames let the caller correct substituted text before emission.
  return renames
}

/**
 * Persist pending allocations under the cross-process map lock.
 *
 * - `pending: []` ⇒ { status: 'noop' } without taking the lock or touching
 *   the filesystem
 * - invalid sid ⇒ noop (defense in depth — handlers gate first)
 * - lock deadline exhaustion OR any transaction error ⇒
 *   { status: 'degraded' } + exactly ONE hash-only stderr warn; the caller's
 *   process-local allocations stand, nothing was written
 *
 * No throw escapes this function (Pitfall 6 — write side).
 */
export async function persistAllocations(opts: PersistOpts): Promise<PersistResult> {
  if (!isValidSessionId(opts.sessionId)) {
    return { status: 'noop', renames: [] }
  }
  if (opts.pending.length === 0) {
    return { status: 'noop', renames: [] }
  }

  const baseDir = opts.baseDir ?? defaultBaseDir()
  try {
    // proper-lockfile's mkdir primitive needs the lock target's PARENT to
    // exist even with realpath:false (verified live: ENOENT on a missing
    // parent). Pre-create sessions/ OUTSIDE the lock hold — idempotent, and
    // 0700 mirrors map-store's DIR_MODE (D-04). writeSessionMapFile's own
    // mkdir stays as a second, no-op layer.
    await mkdir(statePaths(baseDir).sessionsDir, { recursive: true, mode: SESSIONS_DIR_MODE })

    const outcome = await withMapLock(mapPathFor(baseDir, opts.sessionId), opts.deadlineMs, () =>
      runAllocationTransaction(baseDir, opts.sessionId, opts.pending),
    )
    if (outcome === 'degraded') {
      warnPersistDegraded(opts.sessionId)
      return { status: 'degraded', renames: [] }
    }
    return { status: 'ok', renames: outcome }
  } catch {
    // Thrown transaction errors (key EACCES, disk full, ...) degrade — the
    // write path never blocks the hook and never throws.
    warnPersistDegraded(opts.sessionId)
    return { status: 'degraded', renames: [] }
  }
}

// ---------------------------------------------------------------------------
// Rename application helpers (post-persist text correction)
// ---------------------------------------------------------------------------

/** Escape a literal string for embedding in a RegExp alternation. */
const REGEXP_SPECIALS_RE = /[.*+?^${}()|[\]\\]/g

/**
 * Apply placeholder renames to a substituted text in ONE simultaneous pass:
 * every occurrence of each `from` token is replaced with its `to` token, and
 * a replacement output can NEVER be re-matched by a later rename.
 *
 * Simultaneity is load-bearing (CR-01): reconcilePending emits renames in
 * pending order with strictly increasing counters, so whenever the store
 * counter advanced between hydrate and persist AND the event allocated two
 * or more values, rename i's `to` EQUALS rename i+1's `from` (both carry the
 * store nonce). Sequential split/join application cascades such a chain
 * (:006:→:007:→:008:), collapsing distinct originals onto one on-wire token
 * (PH-03 break) and mis-addressing every Phase 10 restore of the earlier
 * value. The single alternation pass replaces each ORIGINAL occurrence
 * exactly once, so chains are inert. Tokens are literal bracketed strings —
 * escaped before entering the pattern.
 */
export function applyRenamesToText(text: string, renames: PlaceholderRename[]): string {
  if (renames.length === 0) {
    return text
  }
  const byFrom = new Map<string, string>(renames.map((rename) => [rename.from, rename.to]))
  const pattern = [...byFrom.keys()]
    .map((from) => from.replace(REGEXP_SPECIALS_RE, '\\$&'))
    .join('|')
  return text.replace(new RegExp(pattern, 'g'), (match) => byFrom.get(match) ?? match)
}

/** Recursion guard for hostile/pathological payload nesting. */
const MAX_RENAME_WALK_DEPTH = 32

function renameDeep(value: unknown, renames: PlaceholderRename[], depth: number): unknown {
  if (depth >= MAX_RENAME_WALK_DEPTH) {
    return value
  }
  if (typeof value === 'string') {
    return applyRenamesToText(value, renames)
  }
  if (Array.isArray(value)) {
    return value.map((item) => renameDeep(item, renames, depth + 1))
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        renameDeep(item, renames, depth + 1),
      ]),
    )
  }
  return value
}

/**
 * Apply placeholder renames across every string leaf of an arbitrary JSON
 * payload. Immutable: returns NEW objects/arrays at every visited level (the
 * input is never mutated). Depth-capped at 32 — subtrees beyond the cap pass
 * through untouched.
 */
export function applyRenamesDeep(obj: unknown, renames: PlaceholderRename[]): unknown {
  return renameDeep(obj, renames, 0)
}
