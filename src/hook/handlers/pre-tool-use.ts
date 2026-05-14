/**
 * PreToolUse hook handler — Phase 2 wired (Plan 02-05).
 *
 * RESEARCH §9.3: PreToolUse uses `hookSpecificOutput.permissionDecision` (correct for this event).
 *   - `permissionDecision: "allow"` with `updatedInput` for substitution.
 *   - `permissionDecision: "deny"` for budget-exhausted block.
 *   Note: `permissionDecision` is ONLY valid for PreToolUse — NOT for UserPromptSubmit.
 *
 * Behavior matrix:
 *   | Condition                 | Response                                                    |
 *   |---------------------------|-------------------------------------------------------------|
 *   | budget exhausted          | hookSpecificOutput.permissionDecision:deny + reason         |
 *   | dry_run=true              | hookSpecificOutput.permissionDecision:allow + dry-run msg   |
 *   | any detection in fields   | hookSpecificOutput.permissionDecision:allow + updatedInput  |
 *   | no detection              | hookSpecificOutput.permissionDecision:allow (pass-through)  |
 *
 * Deep substitution (T-02-05-03):
 *   Only string-typed leaf fields are rewritten. Non-string fields (numbers, booleans,
 *   objects) pass through untouched. Recursion depth is capped at MAX_DEPTH (32).
 *
 * RESEARCH Pitfall #4: `updatedInput` must be the COMPLETE tool_input object
 * (all fields preserved, only string leaves with detections substituted).
 */

import { homedir } from 'node:os'
import { loadEffectiveConfig } from '../../config/index.js'
import {
  getCachedSessionState,
  initSessionState,
  setCachedSessionState,
} from '../../detect/session-state.js'
import { runDetection } from '../../detect/index.js'
import type { PreToolUseInput, PreToolUseOutput, MrcleanConfig } from '../../shared/types.js'
import type { SessionState } from '../../detect/session-state.js'
import type { DetectionContext, ResolvedFinding } from '../../detect/index.js'

/** Maximum recursion depth for deep-substitute to prevent infinite loops (T-02-05-09). */
const MAX_DEPTH = 32

/**
 * Recursively walk a tool_input object, running detection on each string-typed leaf.
 *
 * Returns a new object (immutable) with substitutions applied to string fields that
 * had findings. Non-string fields are preserved exactly.
 *
 * Cycle detection: we use a visited Set (JSON.stringify-based would fail on non-JSON;
 * instead cap recursion depth at MAX_DEPTH which is sufficient for tool_input shapes).
 */
async function substituteToolInputDeep(
  obj: unknown,
  config: MrcleanConfig,
  state: SessionState,
  ctx: DetectionContext,
  depth: number,
  allFindings: ResolvedFinding[],
  budgetSignal: { exhausted: boolean },
): Promise<unknown> {
  // Depth guard (T-02-05-09 — prevents infinite recursion on deeply nested inputs)
  if (depth > MAX_DEPTH) return obj

  if (typeof obj === 'string') {
    if (budgetSignal.exhausted) return obj

    const result = await runDetection(obj, config, state, ctx)
    if (result.budgetExhausted) {
      budgetSignal.exhausted = true
      return obj
    }
    if (result.findings.length > 0) {
      allFindings.push(...result.findings)
      return result.substitutedText
    }
    return obj
  }

  if (Array.isArray(obj)) {
    const newArr: unknown[] = []
    for (const item of obj) {
      newArr.push(
        await substituteToolInputDeep(item, config, state, ctx, depth + 1, allFindings, budgetSignal),
      )
    }
    return newArr
  }

  if (typeof obj === 'object' && obj !== null) {
    const newObj: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      newObj[key] = await substituteToolInputDeep(
        value,
        config,
        state,
        ctx,
        depth + 1,
        allFindings,
        budgetSignal,
      )
    }
    return newObj
  }

  // Primitives (number, boolean, null, undefined) — pass through untouched (T-02-05-03)
  return obj
}

export async function handlePreToolUse(input: PreToolUseInput): Promise<PreToolUseOutput> {
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

  const ctx: DetectionContext = {
    sessionId: input.session_id,
    hookEvent: 'PreToolUse',
    cwd: input.cwd,
  }

  // Step 3: Deep-substitute all string leaves in tool_input
  const allFindings: ResolvedFinding[] = []
  const budgetSignal = { exhausted: false }

  const updatedToolInput = await substituteToolInputDeep(
    input.tool_input,
    config,
    state,
    ctx,
    0,
    allFindings,
    budgetSignal,
  )

  // Step 4: Budget exhausted → deny (PreToolUse uses permissionDecision here — correct)
  if (budgetSignal.exhausted) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          '[mrclean] detection budget exhausted — tool call blocked for safety',
      },
    }
  }

  // Step 5: dry_run=true → allow but log only (no substitution sent)
  if (config.dry_run) {
    const dryRunMsg =
      allFindings.length > 0
        ? `[mrclean] dry_run: ${allFindings.length} detection(s) logged, no substitution`
        : '[mrclean] dry_run: no detections'
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: dryRunMsg,
      },
    }
  }

  // Step 6: Any findings → return updatedInput with substitutions
  if (allFindings.length > 0) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: `[mrclean] substituted ${allFindings.length} secret(s)`,
        updatedInput: updatedToolInput as Record<string, unknown>,
      },
    }
  }

  // Step 7: No findings → pass through
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  }
}
