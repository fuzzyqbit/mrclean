/**
 * Hook subcommand handler — reads stdin JSON from Claude Code, dispatches
 * to the appropriate event handler, writes JSON response to stdout.
 *
 * Plan 01 stub — body replaced by Plan 03.
 * Fail-closed top-level catch is wired here even in the stub (HOOK-05).
 */

import type { HookInput, HookOutput } from '../shared/types.js'
import { VERSION } from '../shared/version.js'

/**
 * Run the hook: read stdin, dispatch event, write stdout, exit.
 *
 * Plan 03 replaces this stub with the real implementation including full
 * event dispatch and fail-closed exit-2 semantics.
 */
export async function runHook(): Promise<void> {
  process.stderr.write('hook: not implemented in Plan 01\n')
}

/**
 * Dispatch a hook event to the appropriate handler.
 * Returns null for pass-through (Claude proceeds normally).
 *
 * Plan 03 replaces this stub.
 */
export async function handleHookEvent(input: HookInput): Promise<HookOutput> {
  // Phase 1 no-op: pass through all events
  void input
  return null
}
