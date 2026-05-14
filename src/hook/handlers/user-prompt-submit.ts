/**
 * UserPromptSubmit hook handler — Phase 2 wired (Plan 02-05).
 *
 * RESEARCH §9.1 CORRECTION (critical):
 *   UserPromptSubmit uses TOP-LEVEL `decision: "block"` + `reason`.
 *   The deny fields for the OTHER hook event (PreToolUse) must not appear here.
 *   See RESEARCH §9.3 for the correct PreToolUse output shape.
 *
 * Behavior matrix:
 *   | Condition                           | Response                                         |
 *   |-------------------------------------|--------------------------------------------------|
 *   | budget exhausted                    | TOP-LEVEL decision:block + budget reason         |
 *   | dry_run=true + any finding          | hookSpecificOutput.additionalContext warning      |
 *   | CRITICAL or HIGH finding            | TOP-LEVEL decision:block + reason + additionalCtx|
 *   | MEDIUM or LOW finding only          | hookSpecificOutput.additionalContext warning      |
 *   | no findings                         | hookSpecificOutput.additionalContext (banner)    |
 *
 * Security (T-02-05-01): The `reason` field ONLY contains ruleId + severity + offset + placeholder.
 * Raw secret values NEVER appear in the JSON output.
 */

import { homedir } from 'node:os'
import { loadEffectiveConfig } from '../../config/index.js'
import {
  getCachedSessionState,
  initSessionState,
  setCachedSessionState,
} from '../../detect/session-state.js'
import { runDetection } from '../../detect/index.js'
import { getRuleCount } from '../../detect/layer1-regex/index.js'
import { buildBanner, computeAllowlistCount } from '../banner.js'
import type { UserPromptSubmitInput, UserPromptSubmitOutput } from '../../shared/types.js'
import type { ResolvedFinding } from '../../detect/index.js'

export async function handleUserPromptSubmit(
  input: UserPromptSubmitInput,
): Promise<UserPromptSubmitOutput> {
  // Step 1: Load config
  const config = await loadEffectiveConfig({ homeDir: homedir(), cwd: input.cwd })

  // Step 2: Ensure SessionState is cached (defensive — SessionStart may not fire in /clear/compact)
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

  // Step 3: Run detection
  const result = await runDetection(input.prompt, config, state, {
    sessionId: input.session_id,
    hookEvent: 'UserPromptSubmit',
    cwd: input.cwd,
  })

  // Step 4: Handle budget exhausted (fail-closed, blocks regardless of dry_run)
  // The budget-exhausted message is STATIC — contains no input data (T-02-05-06)
  if (result.budgetExhausted) {
    return {
      decision: 'block',
      reason: '[mrclean] detection budget exhausted (5 pattern timeouts) — prompt blocked for safety',
    }
  }

  // Step 5: dry_run=true → never block; emit warning context only
  if (config.dry_run) {
    const banner = buildBanner(config, getRuleCount().total, computeAllowlistCount(config))
    const dryRunMsg =
      result.findings.length > 0
        ? `[mrclean] dry-run: ${result.findings.length} detection(s) — no action taken`
        : banner
    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: dryRunMsg,
      },
    }
  }

  // Step 6: Check for CRITICAL or HIGH findings
  const highFindings = result.findings.filter(
    (f) => f.effectiveAction === 'block',
  ) as ResolvedFinding[]

  if (highFindings.length > 0) {
    // Pick the first high/critical finding for the reason field
    const top = highFindings[0]!
    // Security (T-02-05-01): reason uses ONLY ruleId + severity + offset + placeholder — NOT raw value
    const reason = `[mrclean] ${top.ruleId} (${top.severity}): detected at offset ${top.span.start} — rewrite prompt before submitting`
    const placeholderList = result.findings.map((f) => f.placeholder).join(', ')

    return {
      decision: 'block',
      reason,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `[mrclean] blocked: ${placeholderList}`,
      },
    }
  }

  // Step 7: MEDIUM/LOW only → additionalContext warning (allow path)
  // Note: Claude Code does NOT support silent prompt rewrite for UserPromptSubmit.
  // We emit an additionalContext warning so the operator sees the audit hint.
  if (result.findings.length > 0) {
    const severities = [...new Set(result.findings.map((f) => f.severity))].join(', ')
    const placeholderList = result.findings.map((f) => f.placeholder).join(', ')
    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `[mrclean] ${result.findings.length} detection(s) (${severities}) — placeholders: ${placeholderList}`,
      },
    }
  }

  // Step 8: No findings → emit banner so wiring signal still fires
  const banner = buildBanner(config, getRuleCount().total, computeAllowlistCount(config))
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: banner,
    },
  }
}
