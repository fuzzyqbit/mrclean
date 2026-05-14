/**
 * UserPromptSubmit hook handler — Phase 1.
 *
 * RESEARCH.md §1.4 + §1.2 confirms that additionalContext is the operator-
 * visible wiring signal for this event. SessionStart additionalContext is not
 * always visible in all UI surfaces; UserPromptSubmit additionalContext fires
 * on every prompt, ensuring the operator sees the banner in practice.
 *
 * Phase 1: no-op detection. The banner is the only output.
 */

import { VERSION } from '../../shared/version.js'
import type { UserPromptSubmitInput, UserPromptSubmitOutput } from '../../shared/types.js'

/**
 * Phase 1 short form per 01-03-PLAN HOOK-07 scope note.
 *
 * REQUIREMENTS.md HOOK-07 specifies the long-form banner:
 *   `mrclean active vN.N.N (rules: NNN, allowlist: NN)`
 * Phase 1 delivers the short form — counts cannot be computed without the
 * detection engine (Phase 2). Phase 2 will swap this string for the long form
 * once DET1-01..DET4-03 and CFG-02 land.
 */
const PHASE1_BANNER = `mrclean active v${VERSION} (no-op mode — detection not yet enabled)`

export function handleUserPromptSubmit(_input: UserPromptSubmitInput): UserPromptSubmitOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: PHASE1_BANNER,
    },
  }
}
