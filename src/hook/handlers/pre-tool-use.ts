/**
 * PreToolUse hook handler — Phase 1.
 *
 * Phase 1: no-op. All tool calls are allowed unconditionally.
 *
 * RESEARCH.md §5.2: In Phase 2+, detection results will set permissionDecision
 * to "deny" (exit 0 + JSON) for detected secrets, or "allow" for clean inputs.
 * Exit 2 is reserved for unhandled crashes (fail-closed via installCrashGuards).
 */

import type { PreToolUseInput, PreToolUseOutput } from '../../shared/types.js'

export function handlePreToolUse(_input: PreToolUseInput): PreToolUseOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow' as const,
    },
  }
}
