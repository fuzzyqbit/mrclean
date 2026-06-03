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
 *
 * `updatedToolOutput` requires Claude Code >= v2.1.121 (Plan 02-05 doctor floor bump).
 * When present, it replaces the tool output that re-enters the model context.
 */
export interface PostToolUseOutput {
  hookSpecificOutput?: {
    hookEventName: 'PostToolUse'
    additionalContext?: string
    /** Placeholder-substituted version of the tool output (CC >= v2.1.121). */
    updatedToolOutput?: string
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
// Phase 1 implemented only the dry_run + allowlist subset.
// Phase 2 extends with entropy, secrets_files, and [[rules]] array-of-tables.

/**
 * Allowlist configuration — 5-axis suppression (CFG-04).
 * All axes are concatenated across config layers (RESEARCH §11.4).
 */
export interface MrcleanAllowlist {
  /** Rule IDs (secretlint/gitleaks) to skip — e.g. "generic-api-key". */
  rules: string[]
  /** Glob patterns to exclude from scanning. */
  paths: string[]
  /** Literal stopwords to ignore. */
  stopwords: string[]
  /** Regex pattern strings to ignore. */
  regexes: string[]
  /** SHA-256 fingerprints of allowed secrets (CFG-04 target). */
  fingerprints: string[]
}

/**
 * Phase 2 entropy detection configuration.
 * Tunable via `[entropy]` TOML sub-table (CFG-02).
 */
export interface MrcleanEntropyConfig {
  /** Shannon bits-per-char threshold. Default: 4.5 */
  threshold: number
  /** Minimum string length for entropy check. Default: 20 */
  min_length: number
}

/**
 * Per-rule action override from [[rules]] array-of-tables (CFG-02).
 * Operator sets per-rule actions to block | substitute | audit | off.
 */
export interface MrcleanRuleOverride {
  /** Rule ID string — matches secretlint messageId or gitleaks:rule-id. */
  id: string
  /** Effective action for this rule. */
  action: 'block' | 'substitute' | 'audit' | 'off'
  /** Severity assignment for the finding. */
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
}

/**
 * PII sub-lane action policy — which disposition to apply when a PII entity is found.
 * Per-entity map: ssn/credit_card → 'block'; others default to 'warn'/'audit'.
 * PII-03: "per-entity action policy lets checksum-validated entities (SSN, credit card)
 *   block while other PII defaults to warn/audit."
 */
export type PiiAction = 'block' | 'warn' | 'audit'

/**
 * Regex-PII sub-lane configuration ([pii.regex] in TOML).
 * Hot-path safe — deterministic, pure-JS, no model load.
 */
export interface MrcleanPiiRegexConfig {
  /** Enable regex-PII detection when [pii].enabled is also true. Default: true */
  enabled: boolean
  /**
   * Entity names to detect. Default: ["email","ssn","credit_card","phone","ip"].
   * Merge semantics: LAST-WINS (NOT concat). A project layer can narrow the set.
   * See ARCHITECTURE-v2-pii.md §"Config Surface" (distinct from allowlist concat behavior).
   */
  entities: string[]
  /**
   * Per-entity action policy. Validated against {block, warn, audit}.
   * Default: ssn/credit_card → block; email/phone → warn; ip → audit.
   */
  actions: Record<string, PiiAction>
}

/**
 * NER sub-lane configuration ([pii.ner] in TOML).
 * MCP-server-only — warm singleton, perf-exempt. NEVER runs in the hook process.
 */
export interface MrcleanPiiNerConfig {
  /** Enable NER inference. Default: false (opt-in within opt-in). */
  enabled: boolean
  /** HuggingFace model identifier. Default: "Xenova/bert-base-NER" */
  model: string
  /** ONNX quantization dtype. Default: "int8" (108 MB). "fp32" for higher accuracy. */
  dtype: string
  /**
   * Entity labels to detect. Default: ["PERSON","ORG","LOC"] (MISC excluded — noisy).
   * Merge semantics: LAST-WINS (NOT concat). See MrcleanPiiRegexConfig.entities note.
   */
  entities: string[]
  /** Confidence threshold below which entity spans are dropped. Default: 0.7 (D-07 — this is the CONTEXT `min_score` floor) */
  confidence: number
  /** Allow lazy first-run model download to ~/.mrclean/models/. Default: true */
  allowDownload: boolean
  /** Warm the NER singleton at MCP server boot (vs first tool call). Default: false */
  warmOnBoot: boolean
  /**
   * Per-entity action policy. Validated against {block, warn, audit}.
   * Default: PERSON/ORG → warn; LOC → audit. NER is advisory — never a hard gate.
   */
  actions: Record<string, PiiAction>
}

/**
 * Top-level PII configuration ([pii] in TOML).
 * Phase 4-02 contract: defines the config surface for Phases 5-7.
 * PII-03: OFF by default; secrets remain mrclean's core hard gate.
 *
 * Merge semantics for pii (ARCHITECTURE-v2-pii.md §"Config Surface"):
 *   - pii.enabled, pii.regex.enabled, pii.ner.*: LAST-WINS (scalar)
 *   - pii.regex.entities, pii.ner.entities: LAST-WINS (NOT concat — unlike allowlist)
 *   - pii.regex.actions, pii.ner.actions: LAST-WINS (merged at sub-table level)
 * This allows a project layer to NARROW the entity set (e.g. ["email"] only),
 * rather than accumulating all layers' entity lists.
 */
export interface MrcleanPiiConfig {
  /**
   * Master switch. Default: false.
   * When false, behavior is byte-identical to v1 — absent-[pii] == v1 guarantee.
   */
  enabled: boolean
  /** Regex-PII hot-path lane (L6a). */
  regex: MrcleanPiiRegexConfig
  /** NER inference MCP-only lane (L6b). */
  ner: MrcleanPiiNerConfig
}

/**
 * Effective configuration after merging all three layers (defaults < user < project).
 *
 * REQUIREMENTS.md CFG-01: project-local .mrclean/config.toml is optional — missing file ≡ no overrides.
 * REQUIREMENTS.md CFG-03: precedence is defaults < ~/.mrclean/config.toml < ./.mrclean/config.toml.
 * REQUIREMENTS.md CFG-02: Phase 2 schema adds entropy, secrets_files, [[rules]].
 *
 * Merge semantics (RESEARCH §11.4):
 *   - scalar fields (dry_run, entropy.*, secrets_files, rules): last layer wins
 *   - allowlist arrays (5 axes): concatenated across all layers
 *   - pii (Phase 4-02): scalars + entities arrays use LAST-WINS (NOT concat)
 *     See MrcleanPiiConfig JSDoc for full detail.
 */
export interface MrcleanConfig {
  /**
   * Dry-run mode — when true all findings are audit-logged but payloads are NOT modified.
   * MODE-01 / MODE-02.
   */
  dry_run: boolean
  allowlist: MrcleanAllowlist
  /** Shannon entropy detection settings (Layer 2). */
  entropy: MrcleanEntropyConfig
  /**
   * Additional secret files for Layer 3 (dotenv-format KV files).
   * Flattened from `[secrets_files] paths = [...]` in TOML for ergonomics.
   */
  secrets_files: string[]
  /** Per-rule action overrides from [[rules]] array-of-tables (CFG-02). */
  rules: MrcleanRuleOverride[]
  /**
   * PII detection configuration ([pii] in TOML). Phase 4-02 contract.
   * Default: enabled=false (master off). Absent [pii] table == v1 behavior.
   * PII-03: opt-in; secrets remain the only default hard gate.
   */
  pii: MrcleanPiiConfig
}
