/**
 * SessionState contract for mrclean detection layers 3 and 4.
 *
 * SessionState carries the per-session data loaded at SessionStart:
 *   - envBlocklist: in-memory blocklist from .env* file parsing (Layer 3)
 *   - wordEntries:  compiled word list from words.txt files (Layer 4)
 *
 * HOOK-PROCESS LIFETIME note:
 *   The Phase 1 hook is one-process-per-event (Claude Code spawns a new hook process for each
 *   hook invocation). SessionState as typed here is per-invocation semantically, but cached
 *   at the module level keyed by sessionId. The first invocation in a process builds the state;
 *   subsequent invocations in the same process re-use the cache (e.g. if Claude Code batches
 *   events). New processes (new OS-level spawn per event) always build fresh state.
 *
 *   Phase 3's PERF gate will measure the per-invocation cost of initSessionState and may
 *   introduce a persistent IPC cache if the reload cost is too high. For v1, per-invocation
 *   rebuild is acceptable (<100ms budget includes file I/O for typical .env sizes).
 *
 * OWNED BY PLAN 02-02. Consumed by Plan 02-04 (orchestrator) and 02-05 (audit log).
 */

import type { EnvBlocklist } from './layer3-env.js'
import { loadEnvBlocklist } from './layer3-env.js'
import type { WordEntry } from './layer4-words.js'
import { loadWordsList } from './layer4-words.js'
import type { MrcleanConfig } from '../shared/types.js'

// ---------------------------------------------------------------------------
// SessionState interface
// ---------------------------------------------------------------------------

/**
 * Session-scoped state initialized once at SessionStart and threaded through
 * all subsequent hook invocations within the same session.
 *
 * The orchestrator (Plan 02-04) creates this via initSessionState() and passes it
 * into runLayer3Env() and runLayer4Words() on every hook event.
 */
export interface SessionState {
  /** Unique session identifier from Claude Code (session_id field in hook input). */
  sessionId: string
  /** Env blocklist loaded from .env* files at SessionStart. */
  envBlocklist: EnvBlocklist
  /** Word entries loaded from words.txt at SessionStart. */
  wordEntries: WordEntry[]
  /** ISO 8601 timestamp of when this state was initialized. */
  createdAt: string
}

// ---------------------------------------------------------------------------
// Per-process cache (HOOK-PROCESS LIFETIME)
// ---------------------------------------------------------------------------

/**
 * Module-level cache of the most recently initialized SessionState.
 * Keyed by sessionId for invalidation when a new session starts.
 *
 * This cache is only useful when multiple hook invocations share the same process
 * (which may occur under Claude Code's execution model in some environments).
 * A new OS-level process spawn always starts with null and rebuilds.
 */
let cachedSessionState: SessionState | null = null

/**
 * Return the cached SessionState if it matches the given sessionId, otherwise null.
 *
 * @param sessionId - The current session's ID from the hook input.
 * @returns         - Cached SessionState or null if not set / different session.
 */
export function getCachedSessionState(sessionId: string): SessionState | null {
  if (cachedSessionState !== null && cachedSessionState.sessionId === sessionId) {
    return cachedSessionState
  }
  return null
}

/**
 * Store a SessionState in the module-level cache.
 *
 * Called by initSessionState() after building state, and can be called directly
 * by Plan 02-04's orchestrator if it manages the cache lifecycle.
 *
 * @param state - The SessionState to cache.
 */
export function setCachedSessionState(state: SessionState): void {
  cachedSessionState = state
}

// ---------------------------------------------------------------------------
// initSessionState
// ---------------------------------------------------------------------------

/**
 * Bootstrap SessionState at SessionStart.
 *
 * Loads the env blocklist and word entries in parallel, then assembles the
 * SessionState object and populates the module-level cache.
 *
 * Called by the Plan 02-04 orchestrator's SessionStart handler.
 * NOT called on PreToolUse/PostToolUse (use getCachedSessionState() there).
 *
 * @param opts.sessionId - Session identifier from Claude Code hook input.
 * @param opts.homeDir   - User's home directory (os.homedir() in production).
 * @param opts.cwd       - Project root (hook_input.cwd).
 * @param opts.config    - Effective mrclean configuration (for secrets_files).
 * @returns              - Fully-initialized SessionState (also stored in cache).
 */
export async function initSessionState({
  sessionId,
  homeDir,
  cwd,
  config,
}: {
  sessionId: string
  homeDir: string
  cwd: string
  config: MrcleanConfig
}): Promise<SessionState> {
  // Load env blocklist and word list in parallel
  const [envBlocklist, wordEntries] = await Promise.all([
    loadEnvBlocklist({ cwd, secretsFiles: config.secrets_files }),
    loadWordsList({ homeDir, cwd }),
  ])

  const state: SessionState = {
    sessionId,
    envBlocklist,
    wordEntries,
    createdAt: new Date().toISOString(),
  }

  // Store in cache for subsequent invocations in the same process
  setCachedSessionState(state)

  return state
}
