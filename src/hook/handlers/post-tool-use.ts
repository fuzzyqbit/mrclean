/**
 * PostToolUse hook handler — Phase 2 wired (Plan 02-05).
 *
 * RESEARCH §9.4: PostToolUse uses `hookSpecificOutput.updatedToolOutput` (CC >= v2.1.121).
 * PostToolUse is NON-BLOCKING — even exit 2 only shows stderr and cannot stop execution.
 *
 * RESEARCH Pitfall #7: `tool_response` may be a non-string object.
 * Coerce to string: `typeof r === 'string' ? r : JSON.stringify(r)`.
 * The substituted output is always emitted as a STRING in `updatedToolOutput`.
 *
 * Behavior matrix:
 *   | Condition             | Response                                       |
 *   |-----------------------|------------------------------------------------|
 *   | budget exhausted      | null (pass-through); stderr warning logged     |
 *   | dry_run=true          | null (no substitution; detections logged only) |
 *   | any detection         | hookSpecificOutput.updatedToolOutput           |
 *   | no detection          | null (pass-through)                            |
 */

import { homedir } from 'node:os'
import { loadEffectiveConfig } from '../../config/index.js'
import {
  getCachedSessionState,
  initSessionState,
  setCachedSessionState,
} from '../../detect/session-state.js'
import { runDetection } from '../../detect/index.js'
import type { PostToolUseInput, PostToolUseOutput } from '../../shared/types.js'

export async function handlePostToolUse(
  input: PostToolUseInput,
): Promise<PostToolUseOutput | null> {
  // Step 1: Load config
  const config = await loadEffectiveConfig({ homeDir: homedir(), cwd: input.cwd })

  // Step 2: Ensure SessionState cached (defensive bootstrap)
  let state = getCachedSessionState(input.session_id)
  if (!state) {
    state = await initSessionState({
      sessionId: input.session_id,
      homeDir: homedir(),
      cwd: input.cwd,
      config,
    })
    setCachedSessionState(state)
  }

  // Step 3: Coerce tool_response to string (RESEARCH Pitfall #7)
  const text =
    typeof input.tool_response === 'string'
      ? input.tool_response
      : JSON.stringify(input.tool_response)

  // Step 4: Run detection
  const result = await runDetection(text, config, state, {
    sessionId: input.session_id,
    hookEvent: 'PostToolUse',
    cwd: input.cwd,
  })

  // Step 5: Budget exhausted → pass through (non-blocking); log structured stderr warning
  if (result.budgetExhausted) {
    process.stderr.write(
      JSON.stringify({
        warn: 'mrclean detection budget exhausted on PostToolUse',
        sessionId: input.session_id,
      }) + '\n',
    )
    return null
  }

  // Step 6: dry_run=true → no substitution; detections already audit-logged by runDetection
  if (config.dry_run) {
    return null
  }

  // Step 7: Any detection → return updatedToolOutput with substituted text
  if (result.findings.length > 0) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        updatedToolOutput: result.substitutedText,
        additionalContext: `[mrclean] substituted ${result.findings.length} secret(s) in tool output`,
      },
    }
  }

  // Step 8: No findings → pass through (null → no stdout bytes written)
  return null
}
