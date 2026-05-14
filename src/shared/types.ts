/**
 * Shared TypeScript types for the mrclean hook contract.
 *
 * Input shapes: RESEARCH.md §1.1 — verified from code.claude.com/docs/en/hooks (2026-05-13)
 * Output shapes: RESEARCH.md §1.2 — verified from code.claude.com/docs/en/hooks (2026-05-13)
 *
 * These types are LOCKED by the Claude Code hook contract and must not be altered
 * without verifying against the upstream docs. Plans 02/03/04/05 import these
 * without modification.
 */

// ---------------------------------------------------------------------------
// Hook Input Types
// ---------------------------------------------------------------------------

/** Common base fields present on every hook event. See RESEARCH.md §1.1. */
export interface HookInputBase {
  session_id: string
  transcript_path: string
  cwd: string
  hook_event_name: 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse'
}

/**
 * SessionStart — fires on startup, resume, /clear, and compaction.
 * Source: field `source` is one of: startup | resume | clear | compact
 */
export interface SessionStartInput extends HookInputBase {
  hook_event_name: 'SessionStart'
  source: 'startup' | 'resume' | 'clear' | 'compact'
  model?: string
}

/**
 * UserPromptSubmit — fires before Claude processes the user prompt.
 * Note: no matcher support for this event type.
 */
export interface UserPromptSubmitInput extends HookInputBase {
  hook_event_name: 'UserPromptSubmit'
  prompt: string
  permission_mode?: string
}

/**
 * PreToolUse — fires after Claude creates tool parameters, before execution.
 * Matcher values: Bash, Edit, Write, Read, Glob, Grep, Agent, WebFetch, WebSearch, mcp__server__tool
 */
export interface PreToolUseInput extends HookInputBase {
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_use_id: string
  permission_mode?: string
}

/**
 * PostToolUse — fires after tool call succeeds.
 * Matcher values: same as PreToolUse.
 */
export interface PostToolUseInput extends HookInputBase {
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_response: unknown
  tool_use_id: string
  duration_ms?: number
  permission_mode?: string
}

/** Union of all possible hook input payloads. */
export type HookInput =
  | SessionStartInput
  | UserPromptSubmitInput
  | PreToolUseInput
  | PostToolUseInput

// ---------------------------------------------------------------------------
// Hook Output Types
// ---------------------------------------------------------------------------

/**
 * SessionStart output — inject additional context into the session.
 * Source: RESEARCH.md §1.2 — verified from code.claude.com/docs/en/hooks (2026-05-13)
 */
export interface SessionStartOutput {
  hookSpecificOutput: {
    hookEventName: 'SessionStart'
    additionalContext?: string
  }
}

/**
 * UserPromptSubmit output — either inject context or block the prompt.
 * Use `decision: "block"` with `reason` to block the prompt.
 */
export interface UserPromptSubmitOutput {
  hookSpecificOutput?: {
    hookEventName: 'UserPromptSubmit'
    additionalContext?: string
  }
  decision?: 'block'
  reason?: string
}

/**
 * PreToolUse output — allow, deny, or ask for permission escalation.
 * `permissionDecision: "deny"` (exit 0) blocks with a reason sent to Claude.
 * Exit 2 blocks the tool call AND shows stderr in the transcript.
 */
export interface PreToolUseOutput {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse'
    permissionDecision: 'allow' | 'deny' | 'ask'
    permissionDecisionReason?: string
    updatedInput?: Record<string, unknown>
    additionalContext?: string
  }
}

/**
 * PostToolUse output — optionally inject additional context after a tool runs.
 * PostToolUse is non-blocking: exit 2 only shows stderr, it cannot stop execution.
 */
export interface PostToolUseOutput {
  hookSpecificOutput?: {
    hookEventName: 'PostToolUse'
    additionalContext?: string
  }
}

/**
 * Union of all possible hook output payloads.
 * `null` means pass-through (exit 0, empty stdout — Claude proceeds normally).
 */
export type HookOutput =
  | SessionStartOutput
  | UserPromptSubmitOutput
  | PreToolUseOutput
  | PostToolUseOutput
  | null
