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

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------
// REQUIREMENTS.md CFG-02 defines the full v1 schema.
// Phase 1 implements only the dry_run + allowlist subset that is needed for
// no-op behavior and testable end-to-end config merging. Phase 2 will extend
// this interface (detection.entropy_threshold, secrets_files, etc.) without
// breaking the reader contract established in Plan 01-02b.

/**
 * Phase 1 allowlist configuration.
 * Phase 2 will add processing logic; Phase 1 stores the values and round-trips them.
 */
export interface MrcleanAllowlist {
  /** Rule IDs (secretlint/gitleaks) to skip — e.g. "generic-api-key". */
  rules: string[]
  /** Glob patterns to exclude from scanning (Phase 2 consumer). */
  paths: string[]
  /** Literal stopwords to ignore (Phase 2 consumer). */
  stopwords: string[]
  /** Regex pattern strings to ignore (Phase 2 consumer). */
  regexes: string[]
  /** SHA-256 fingerprints of allowed secrets (Phase 2 consumer). */
  fingerprints: string[]
}

/**
 * Effective configuration after merging all three layers (defaults < user < project).
 *
 * REQUIREMENTS.md CFG-01: project-local .mrclean/config.toml is optional — missing file ≡ no overrides.
 * REQUIREMENTS.md CFG-03: precedence is defaults < ~/.mrclean/config.toml < ./.mrclean/config.toml.
 *
 * Phase 2 will add: detection.entropy_threshold, detection.entropy_min_length, secrets_files, etc.
 * Do NOT add Phase 2 fields here — extend the interface in Phase 2 to avoid breaking reader tests.
 */
export interface MrcleanConfig {
  /**
   * Dry-run mode — when true the hook logs redactions without modifying the payload.
   * MODE-01 stub: Phase 2 wires this flag into rule actions.
   */
  dry_run: boolean
  allowlist: MrcleanAllowlist
}
