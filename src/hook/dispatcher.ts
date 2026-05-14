/**
 * Hook event dispatcher — routes HookInput to the appropriate per-event handler.
 *
 * Phase 2 update (Plan 02-05): handlers are now async (they call runDetection, initSessionState, etc.).
 * The dispatcher is updated to return Promise<HookOutput> and use await.
 *
 * HOOK-01: handlers registered for all four Claude Code hook events.
 */

import type { HookInput, HookOutput } from '../shared/types.js'
import { handleSessionStart } from './handlers/session-start.js'
import { handleUserPromptSubmit } from './handlers/user-prompt-submit.js'
import { handlePreToolUse } from './handlers/pre-tool-use.js'
import { handlePostToolUse } from './handlers/post-tool-use.js'

/**
 * Dispatch a hook event to its handler.
 *
 * Returns a Promise of the handler's output (a typed HookOutput or null for pass-through).
 * Throws `Error('unknown hook event: ...')` for unrecognized event names.
 *
 * TEST-ONLY escape hatch: if `process.env.MRCLEAN_TEST_THROW` is set, a
 * synthetic crash is thrown to verify fail-closed crash guard behaviour.
 * This env var MUST NOT be set in production. See integration tests.
 */
export async function dispatch(input: HookInput): Promise<HookOutput> {
  // TEST-ONLY: synthetic crash injection for integration test 7
  if (process.env['MRCLEAN_TEST_THROW']) {
    throw new Error('synthetic mrclean crash')
  }

  switch (input.hook_event_name) {
    case 'SessionStart':
      return await handleSessionStart(input)

    case 'UserPromptSubmit':
      return await handleUserPromptSubmit(input)

    case 'PreToolUse':
      return await handlePreToolUse(input)

    case 'PostToolUse':
      return await handlePostToolUse(input)

    default: {
      // TypeScript exhaustiveness: cast to access the discriminant for error message
      const eventName = (input as { hook_event_name: string }).hook_event_name
      throw new Error(`unknown hook event: ${eventName}`)
    }
  }
}
