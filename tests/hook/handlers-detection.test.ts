/**
 * Unit tests for hook handlers with detection wired — Plan 02-05 Task 1.
 *
 * Tests the four event handlers after Phase 2 detection is wired in.
 * All external dependencies (loadEffectiveConfig, initSessionState, runDetection,
 * getRuleCount) are mocked so these tests run without real file I/O or regex work.
 *
 * Per the RESEARCH §9.1 correction:
 *   - UserPromptSubmit DENY uses TOP-LEVEL `decision: "block"` + `reason` (NOT permissionDecision)
 *   - PreToolUse uses `hookSpecificOutput.permissionDecision` (correct for that event)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MrcleanConfig } from '../../src/shared/types.js'
import type { DetectionResult } from '../../src/detect/index.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'

// ---------------------------------------------------------------------------
// Shared mock factories — called freshly in each test
// ---------------------------------------------------------------------------

const MOCK_CONFIG_ACTIVE: MrcleanConfig = {
  ...DEFAULT_CONFIG,
  dry_run: false,
}

const MOCK_CONFIG_DRY_RUN: MrcleanConfig = {
  ...DEFAULT_CONFIG,
  dry_run: true,
}

const MOCK_SESSION_STATE = {
  sessionId: 'test-session',
  envBlocklist: new Map(),
  wordEntries: [],
  createdAt: new Date().toISOString(),
}

const BASE_INPUT = {
  session_id: 'test-session',
  transcript_path: '/tmp/transcript',
  cwd: '/tmp',
}

const NO_FINDINGS_RESULT: DetectionResult = {
  findings: [],
  substitutedText: 'some text',
  budgetExhausted: false,
  rawTimeoutCount: 0,
  // Hook path never opts into NER, so the orchestrator always reports 'disabled' (06-02).
  nerStatus: 'disabled',
}

const BUDGET_EXHAUSTED_RESULT: DetectionResult = {
  findings: [],
  substitutedText: '',
  budgetExhausted: true,
  rawTimeoutCount: 5,
  nerStatus: 'disabled',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleSessionStart — Phase 2 wired', () => {
  it('Test 1: bootstraps session state and emits long-form banner in additionalContext', async () => {
    const configMod = await import('../../src/config/index.js')
    const sessionMod = await import('../../src/detect/session-state.js')
    const detectMod = await import('../../src/detect/index.js')
    const layer1Mod = await import('../../src/detect/layer1-regex/index.js')

    const mockLoadConfig = vi.spyOn(configMod, 'loadEffectiveConfig').mockResolvedValue(MOCK_CONFIG_ACTIVE)
    const mockInitState = vi.spyOn(sessionMod, 'initSessionState').mockResolvedValue(MOCK_SESSION_STATE)
    const mockSetState = vi.spyOn(sessionMod, 'setCachedSessionState').mockImplementation(() => {})
    vi.spyOn(detectMod, 'runDetection').mockResolvedValue(NO_FINDINGS_RESULT)
    vi.spyOn(layer1Mod, 'getRuleCount').mockReturnValue({ secretlint: 1, gitleaks: 183, total: 184 })

    const { handleSessionStart } = await import('../../src/hook/handlers/session-start.js')
    const output = await handleSessionStart({
      ...BASE_INPUT,
      hook_event_name: 'SessionStart',
      source: 'startup',
    })

    // Long-form banner with rule/allowlist counts (HOOK-07).
    // Plan 07-03 (D-05): additionalContext is now `banner + '\n' + disclaimer`, so the anchored
    // ^...$ banner pattern matches the FIRST line, and the disclaimer line follows.
    const ctx = output.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx.split('\n')[0]).toMatch(
      /^mrclean active v\d+\.\d+\.\d+[^ ]* \(rules: \d+, allowlist: \d+, mode: (active|dry-run)\)$/,
    )
    expect(ctx).toContain('not a guarantee')
    expect(mockInitState).toHaveBeenCalled()
    expect(mockSetState).toHaveBeenCalled()

    mockLoadConfig.mockRestore()
    mockInitState.mockRestore()
    mockSetState.mockRestore()
  })
})

describe('handleUserPromptSubmit — Phase 2 wired', () => {
  it('Test 2: CRITICAL/HIGH finding → TOP-LEVEL decision:block (NOT under hookSpecificOutput)', async () => {
    const configMod = await import('../../src/config/index.js')
    const sessionMod = await import('../../src/detect/session-state.js')
    const detectMod = await import('../../src/detect/index.js')
    const layer1Mod = await import('../../src/detect/layer1-regex/index.js')

    vi.spyOn(configMod, 'loadEffectiveConfig').mockResolvedValue(MOCK_CONFIG_ACTIVE)
    vi.spyOn(sessionMod, 'getCachedSessionState').mockReturnValue(MOCK_SESSION_STATE)
    vi.spyOn(layer1Mod, 'getRuleCount').mockReturnValue({ secretlint: 1, gitleaks: 183, total: 184 })

    const highResult: DetectionResult = {
      findings: [{
        ruleId: 'AWSAccessKey',
        severity: 'HIGH',
        span: { start: 12, end: 32 },
        value: 'AKIAIOSFODNN7EXAMPLE',
        redactedHash: 'abc123',
        fingerprint: 'AWSAccessKey:abc123def456',
        placeholder: '<MRCLEAN:AWS_KEY:001>',
        effectiveAction: 'block',
      }],
      substitutedText: 'prompt with <MRCLEAN:AWS_KEY:001>',
      budgetExhausted: false,
      rawTimeoutCount: 0,
    }
    vi.spyOn(detectMod, 'runDetection').mockResolvedValue(highResult)

    const { handleUserPromptSubmit } = await import('../../src/hook/handlers/user-prompt-submit.js')
    const output = await handleUserPromptSubmit({
      ...BASE_INPUT,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'AKIAIOSFODNN7EXAMPLE test prompt',
    })

    // TOP-LEVEL decision + reason (RESEARCH §9.1 — NOT permissionDecision)
    expect((output as Record<string, unknown>)['decision']).toBe('block')
    expect(typeof (output as Record<string, unknown>)['reason']).toBe('string')
    expect(((output as Record<string, unknown>)['reason'] as string)).toMatch(/^\[mrclean\]/)

    // Must NOT use permissionDecision anywhere
    expect((output as Record<string, unknown>)['permissionDecision']).toBeUndefined()
    expect((output as Record<string, unknown>)['permissionDecisionReason']).toBeUndefined()
    expect(((output as Record<string, unknown>)['hookSpecificOutput'] as Record<string, unknown> | undefined)?.['permissionDecision']).toBeUndefined()

    vi.restoreAllMocks()
  })

  it('Test 3: MEDIUM finding → allow path with additionalContext warning (NO top-level decision)', async () => {
    const configMod = await import('../../src/config/index.js')
    const sessionMod = await import('../../src/detect/session-state.js')
    const detectMod = await import('../../src/detect/index.js')
    const layer1Mod = await import('../../src/detect/layer1-regex/index.js')

    vi.spyOn(configMod, 'loadEffectiveConfig').mockResolvedValue(MOCK_CONFIG_ACTIVE)
    vi.spyOn(sessionMod, 'getCachedSessionState').mockReturnValue(MOCK_SESSION_STATE)
    vi.spyOn(layer1Mod, 'getRuleCount').mockReturnValue({ secretlint: 1, gitleaks: 183, total: 184 })

    const medResult: DetectionResult = {
      findings: [{
        ruleId: 'GenericApiKey',
        severity: 'MEDIUM',
        span: { start: 0, end: 20 },
        value: 'some-medium-key-value',
        redactedHash: 'def456',
        fingerprint: 'GenericApiKey:def456abc789',
        placeholder: '<MRCLEAN:API_KEY:001>',
        effectiveAction: 'substitute',
      }],
      substitutedText: '<MRCLEAN:API_KEY:001> rest of prompt',
      budgetExhausted: false,
      rawTimeoutCount: 0,
    }
    vi.spyOn(detectMod, 'runDetection').mockResolvedValue(medResult)

    const { handleUserPromptSubmit } = await import('../../src/hook/handlers/user-prompt-submit.js')
    const output = await handleUserPromptSubmit({
      ...BASE_INPUT,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'some-medium-key-value rest of prompt',
    })

    // No top-level decision (allow path)
    expect((output as Record<string, unknown>)['decision']).toBeUndefined()
    // additionalContext should mention the detection
    const ctx = (output.hookSpecificOutput as { additionalContext?: string } | undefined)?.additionalContext
    expect(typeof ctx).toBe('string')
    expect(ctx).toContain('[mrclean]')

    vi.restoreAllMocks()
  })

  it('Test 4: dry_run=true with HIGH finding → allows (NO top-level decision)', async () => {
    const configMod = await import('../../src/config/index.js')
    const sessionMod = await import('../../src/detect/session-state.js')
    const detectMod = await import('../../src/detect/index.js')
    const layer1Mod = await import('../../src/detect/layer1-regex/index.js')

    vi.spyOn(configMod, 'loadEffectiveConfig').mockResolvedValue(MOCK_CONFIG_DRY_RUN)
    vi.spyOn(sessionMod, 'getCachedSessionState').mockReturnValue(MOCK_SESSION_STATE)
    vi.spyOn(layer1Mod, 'getRuleCount').mockReturnValue({ secretlint: 1, gitleaks: 183, total: 184 })

    // dry_run: finding has effectiveAction:'audit' (applyDryRun forces this)
    const dryRunResult: DetectionResult = {
      findings: [{
        ruleId: 'AWSAccessKey',
        severity: 'HIGH',
        span: { start: 0, end: 20 },
        value: 'AKIAIOSFODNN7EXAMPLE',
        redactedHash: 'abc123',
        fingerprint: 'AWSAccessKey:abc123',
        placeholder: '<MRCLEAN:AWS_KEY:001>',
        effectiveAction: 'audit', // dry_run forces audit
      }],
      substitutedText: 'AKIAIOSFODNN7EXAMPLE prompt', // dry_run = original text
      budgetExhausted: false,
      rawTimeoutCount: 0,
    }
    vi.spyOn(detectMod, 'runDetection').mockResolvedValue(dryRunResult)

    const { handleUserPromptSubmit } = await import('../../src/hook/handlers/user-prompt-submit.js')
    const output = await handleUserPromptSubmit({
      ...BASE_INPUT,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'AKIAIOSFODNN7EXAMPLE prompt',
    })

    // dry_run=true NEVER blocks
    expect((output as Record<string, unknown>)['decision']).toBeUndefined()

    vi.restoreAllMocks()
  })

  it('Test 5: budget exhausted → TOP-LEVEL decision:block with budget message', async () => {
    const configMod = await import('../../src/config/index.js')
    const sessionMod = await import('../../src/detect/session-state.js')
    const detectMod = await import('../../src/detect/index.js')
    const layer1Mod = await import('../../src/detect/layer1-regex/index.js')

    vi.spyOn(configMod, 'loadEffectiveConfig').mockResolvedValue(MOCK_CONFIG_ACTIVE)
    vi.spyOn(sessionMod, 'getCachedSessionState').mockReturnValue(MOCK_SESSION_STATE)
    vi.spyOn(layer1Mod, 'getRuleCount').mockReturnValue({ secretlint: 1, gitleaks: 183, total: 184 })
    vi.spyOn(detectMod, 'runDetection').mockResolvedValue(BUDGET_EXHAUSTED_RESULT)

    const { handleUserPromptSubmit } = await import('../../src/hook/handlers/user-prompt-submit.js')
    const output = await handleUserPromptSubmit({
      ...BASE_INPUT,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'some prompt',
    })

    // Budget exhaustion → TOP-LEVEL block
    expect((output as Record<string, unknown>)['decision']).toBe('block')
    const reason = (output as Record<string, unknown>)['reason'] as string
    expect(reason).toContain('budget exhausted')

    vi.restoreAllMocks()
  })
})

describe('handlePreToolUse — Phase 2 wired', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Test 6: detection in tool_input.command → hookSpecificOutput.permissionDecision=allow + updatedInput', async () => {
    const configMod = await import('../../src/config/index.js')
    const sessionMod = await import('../../src/detect/session-state.js')
    const detectMod = await import('../../src/detect/index.js')
    const layer1Mod = await import('../../src/detect/layer1-regex/index.js')

    vi.spyOn(configMod, 'loadEffectiveConfig').mockResolvedValue(MOCK_CONFIG_ACTIVE)
    vi.spyOn(sessionMod, 'getCachedSessionState').mockReturnValue(MOCK_SESSION_STATE)
    vi.spyOn(layer1Mod, 'getRuleCount').mockReturnValue({ secretlint: 1, gitleaks: 183, total: 184 })

    vi.spyOn(detectMod, 'runDetection').mockResolvedValue({
      findings: [{
        ruleId: 'StripeApiKey',
        severity: 'HIGH',
        span: { start: 12, end: 28 },
        value: 'sk_live_XXXXXXXXXXX',
        redactedHash: 'stripe123',
        fingerprint: 'StripeApiKey:stripe123abc',
        placeholder: '<MRCLEAN:STRIPE_KEY:001>',
        effectiveAction: 'block',
      }],
      substitutedText: 'curl -H ... <MRCLEAN:STRIPE_KEY:001>',
      budgetExhausted: false,
      rawTimeoutCount: 0,
    })

    const { handlePreToolUse } = await import('../../src/hook/handlers/pre-tool-use.js')
    const output = await handlePreToolUse({
      ...BASE_INPUT,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'curl -H ... sk_live_XXXXXXXXXXX' },
      tool_use_id: 'tool-123',
    })

    // PreToolUse DOES use hookSpecificOutput.permissionDecision (correct for this event)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(output.hookSpecificOutput.updatedInput).toBeDefined()
  })

  it('Test 7: multi-field tool_input preserves untouched fields, substitutes detected field', async () => {
    const configMod = await import('../../src/config/index.js')
    const sessionMod = await import('../../src/detect/session-state.js')
    const detectMod = await import('../../src/detect/index.js')
    const layer1Mod = await import('../../src/detect/layer1-regex/index.js')

    vi.spyOn(configMod, 'loadEffectiveConfig').mockResolvedValue(MOCK_CONFIG_ACTIVE)
    vi.spyOn(sessionMod, 'getCachedSessionState').mockReturnValue(MOCK_SESSION_STATE)
    vi.spyOn(layer1Mod, 'getRuleCount').mockReturnValue({ secretlint: 1, gitleaks: 183, total: 184 })

    // First call: command field has a finding → substitute
    // Second call: file_path field has no finding → no change
    vi.spyOn(detectMod, 'runDetection')
      .mockResolvedValueOnce({
        findings: [{
          ruleId: 'StripeApiKey',
          severity: 'HIGH',
          span: { start: 5, end: 26 },
          value: 'sk_live_XXXXXXXXXXX',
          redactedHash: 'stripe123',
          fingerprint: 'StripeApiKey:stripe123abc',
          placeholder: '<MRCLEAN:STRIPE_KEY:001>',
          effectiveAction: 'block',
        }],
        substitutedText: 'echo <MRCLEAN:STRIPE_KEY:001>',
        budgetExhausted: false,
        rawTimeoutCount: 0,
      })
      .mockResolvedValueOnce({
        findings: [],
        substitutedText: '/tmp/x',
        budgetExhausted: false,
        rawTimeoutCount: 0,
      })

    const { handlePreToolUse } = await import('../../src/hook/handlers/pre-tool-use.js')
    const output = await handlePreToolUse({
      ...BASE_INPUT,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo sk_live_XXXXXXXXXXX', file_path: '/tmp/x' },
      tool_use_id: 'tool-456',
    })

    // file_path preserved (no finding in second call)
    expect((output.hookSpecificOutput.updatedInput as Record<string, unknown>)?.['file_path']).toBe('/tmp/x')
    // command substituted
    expect((output.hookSpecificOutput.updatedInput as Record<string, unknown>)?.['command']).toContain('<MRCLEAN:')
  })

  it('Test 8: budget exhausted → hookSpecificOutput.permissionDecision=deny', async () => {
    const configMod = await import('../../src/config/index.js')
    const sessionMod = await import('../../src/detect/session-state.js')
    const detectMod = await import('../../src/detect/index.js')
    const layer1Mod = await import('../../src/detect/layer1-regex/index.js')

    vi.spyOn(configMod, 'loadEffectiveConfig').mockResolvedValue(MOCK_CONFIG_ACTIVE)
    vi.spyOn(sessionMod, 'getCachedSessionState').mockReturnValue(MOCK_SESSION_STATE)
    vi.spyOn(layer1Mod, 'getRuleCount').mockReturnValue({ secretlint: 1, gitleaks: 183, total: 184 })
    vi.spyOn(detectMod, 'runDetection').mockResolvedValue(BUDGET_EXHAUSTED_RESULT)

    const { handlePreToolUse } = await import('../../src/hook/handlers/pre-tool-use.js')
    const output = await handlePreToolUse({
      ...BASE_INPUT,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_use_id: 'tool-789',
    })

    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('budget exhausted')
  })

  it('Test 8b: SELF-EXEMPTION — mrclean MCP tool input is passed through untouched (both install namespaces)', async () => {
    // Root-cause regression test: the PreToolUse matcher "*" fires for mrclean's own
    // MCP tools. If we redacted their `text` argument, mrclean_redact/_check would
    // receive placeholder-only text and return findings:[]. Detection MUST NOT run.
    //
    // Claude Code namespaces MCP tools by install method, so the guard must match BOTH:
    //   - plugin install (live deployment): mcp__plugin_mrclean_mrclean__mrclean_<tool>
    //   - CLI install (`mrclean install`):   mcp__mrclean__mrclean_<tool>
    const configMod = await import('../../src/config/index.js')
    const detectMod = await import('../../src/detect/index.js')

    const loadSpy = vi.spyOn(configMod, 'loadEffectiveConfig').mockResolvedValue(MOCK_CONFIG_ACTIVE)
    const detectSpy = vi.spyOn(detectMod, 'runDetection')

    const { handlePreToolUse } = await import('../../src/hook/handlers/pre-tool-use.js')

    for (const toolName of [
      // Plugin-install namespace (the actual live deployment)
      'mcp__plugin_mrclean_mrclean__mrclean_redact',
      'mcp__plugin_mrclean_mrclean__mrclean_check',
      'mcp__plugin_mrclean_mrclean__mrclean_status',
      // CLI-install namespace
      'mcp__mrclean__mrclean_redact',
      'mcp__mrclean__mrclean_check',
      'mcp__mrclean__mrclean_status',
    ]) {
      const output = await handlePreToolUse({
        ...BASE_INPUT,
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
        tool_input: { text: 'here is <MRCLEAN:STRIPE_KEY:001>in a sentence' },
        tool_use_id: 'tool-self',
      })

      // Allowed, with NO updatedInput (input passed through verbatim → tool sees real secret)
      expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
      expect(output.hookSpecificOutput.updatedInput).toBeUndefined()
    }

    // Detection must never have been invoked for the self-tools (and config not even loaded).
    expect(detectSpy).not.toHaveBeenCalled()
    expect(loadSpy).not.toHaveBeenCalled()
  })

  it('Test 8c: NEGATIVE — a foreign tool with a mrclean-like name is NOT exempted (still gets detection)', async () => {
    // The guard must be precise: a different server that happens to expose a tool named
    // `mrclean_check` (e.g. mcp__notmrclean__mrclean_check or mcp__other__something) must
    // still receive full detection/substitution — only OUR two namespaces are exempt.
    const configMod = await import('../../src/config/index.js')
    const sessionMod = await import('../../src/detect/session-state.js')
    const detectMod = await import('../../src/detect/index.js')
    const layer1Mod = await import('../../src/detect/layer1-regex/index.js')

    vi.spyOn(configMod, 'loadEffectiveConfig').mockResolvedValue(MOCK_CONFIG_ACTIVE)
    vi.spyOn(sessionMod, 'getCachedSessionState').mockReturnValue(MOCK_SESSION_STATE)
    vi.spyOn(layer1Mod, 'getRuleCount').mockReturnValue({ secretlint: 1, gitleaks: 183, total: 184 })

    // Build the secret-shaped string at runtime so no literal secret token appears in this
    // source file (the live mrclean PostToolUse hook would otherwise redact it on save).
    const stripeKey = ['sk', 'live', '51H8h2kLqVb3xYzPq4r5T6u7'].join('_')

    const detectSpy = vi.spyOn(detectMod, 'runDetection').mockResolvedValue({
      findings: [{
        ruleId: 'StripeApiKey',
        severity: 'HIGH',
        span: { start: 0, end: stripeKey.length },
        value: stripeKey,
        redactedHash: 'stripe123',
        fingerprint: 'StripeApiKey:stripe123abc',
        placeholder: '<MRCLEAN:STRIPE_KEY:001>',
        effectiveAction: 'block',
      }],
      substitutedText: '<MRCLEAN:STRIPE_KEY:001>',
      budgetExhausted: false,
      rawTimeoutCount: 0,
    })

    const { handlePreToolUse } = await import('../../src/hook/handlers/pre-tool-use.js')

    for (const toolName of ['mcp__notmrclean__mrclean_check', 'mcp__other__something']) {
      const output = await handlePreToolUse({
        ...BASE_INPUT,
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
        tool_input: { text: stripeKey },
        tool_use_id: 'tool-foreign',
      })

      // Foreign tool → detection runs and substitution is applied.
      expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
      expect(output.hookSpecificOutput.updatedInput).toBeDefined()
    }

    // Detection MUST have run for the foreign tools.
    expect(detectSpy).toHaveBeenCalled()
  })
})

describe('handlePostToolUse — Phase 2 wired', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Test 9: string tool_response with detection → updatedToolOutput with placeholder', async () => {
    const configMod = await import('../../src/config/index.js')
    const sessionMod = await import('../../src/detect/session-state.js')
    const detectMod = await import('../../src/detect/index.js')
    const layer1Mod = await import('../../src/detect/layer1-regex/index.js')

    vi.spyOn(configMod, 'loadEffectiveConfig').mockResolvedValue(MOCK_CONFIG_ACTIVE)
    vi.spyOn(sessionMod, 'getCachedSessionState').mockReturnValue(MOCK_SESSION_STATE)
    vi.spyOn(layer1Mod, 'getRuleCount').mockReturnValue({ secretlint: 1, gitleaks: 183, total: 184 })
    vi.spyOn(detectMod, 'runDetection').mockResolvedValue({
      findings: [{
        ruleId: 'GithubToken',
        severity: 'HIGH',
        span: { start: 7, end: 46 },
        value: 'ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        redactedHash: 'gh123',
        fingerprint: 'GithubToken:gh123abc',
        placeholder: '<MRCLEAN:GH_TOKEN:001>',
        effectiveAction: 'block',
      }],
      substitutedText: 'token=<MRCLEAN:GH_TOKEN:001> and more output',
      budgetExhausted: false,
      rawTimeoutCount: 0,
    })

    const { handlePostToolUse } = await import('../../src/hook/handlers/post-tool-use.js')
    const output = await handlePostToolUse({
      ...BASE_INPUT,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: {},
      tool_response: 'token=ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX and more output',
      tool_use_id: 'tool-111',
    })

    expect(output).not.toBeNull()
    const o = output as Record<string, unknown>
    const hso = o['hookSpecificOutput'] as Record<string, unknown>
    expect(hso['updatedToolOutput']).toContain('<MRCLEAN:GH_TOKEN:001>')
    expect(typeof hso['updatedToolOutput']).toBe('string')
  })

  it('Test 10: non-string tool_response coerces to JSON before detection', async () => {
    const configMod = await import('../../src/config/index.js')
    const sessionMod = await import('../../src/detect/session-state.js')
    const detectMod = await import('../../src/detect/index.js')
    const layer1Mod = await import('../../src/detect/layer1-regex/index.js')

    vi.spyOn(configMod, 'loadEffectiveConfig').mockResolvedValue(MOCK_CONFIG_ACTIVE)
    vi.spyOn(sessionMod, 'getCachedSessionState').mockReturnValue(MOCK_SESSION_STATE)
    vi.spyOn(layer1Mod, 'getRuleCount').mockReturnValue({ secretlint: 1, gitleaks: 183, total: 184 })
    vi.spyOn(detectMod, 'runDetection').mockImplementation(async (text: string) => {
      // Verify the non-string was JSON-stringified before being passed to detection
      expect(typeof text).toBe('string')
      return {
        findings: [{
          ruleId: 'SomeToken',
          severity: 'HIGH',
          span: { start: 10, end: 30 },
          value: 'some-token-value-12345',
          redactedHash: 'tok123',
          fingerprint: 'SomeToken:tok123abc',
          placeholder: '<MRCLEAN:GENERIC:001>',
          effectiveAction: 'block' as const,
        }],
        substitutedText: '{"output":"<MRCLEAN:GENERIC:001>"}',
        budgetExhausted: false,
        rawTimeoutCount: 0,
      }
    })

    const { handlePostToolUse } = await import('../../src/hook/handlers/post-tool-use.js')
    const output = await handlePostToolUse({
      ...BASE_INPUT,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: {},
      tool_response: { output: 'some-token-value-12345' },
      tool_use_id: 'tool-222',
    })

    expect(output).not.toBeNull()
    const o = output as Record<string, unknown>
    const hso = o['hookSpecificOutput'] as Record<string, unknown>
    expect(typeof hso['updatedToolOutput']).toBe('string')
    expect(hso['updatedToolOutput']).toContain('<MRCLEAN:GENERIC:001>')
  })

  it('Test 11: SELF-EXEMPTION — mrclean MCP tool output is passed through (both install namespaces)', async () => {
    // Root-cause regression test: mrclean_redact/_check output is already sanitized.
    // PostToolUse must not re-run detection on it — for EITHER install namespace:
    //   - plugin install (live deployment): mcp__plugin_mrclean_mrclean__mrclean_<tool>
    //   - CLI install:                       mcp__mrclean__mrclean_<tool>
    const configMod = await import('../../src/config/index.js')
    const detectMod = await import('../../src/detect/index.js')

    const loadSpy = vi.spyOn(configMod, 'loadEffectiveConfig').mockResolvedValue(MOCK_CONFIG_ACTIVE)
    const detectSpy = vi.spyOn(detectMod, 'runDetection')

    const { handlePostToolUse } = await import('../../src/hook/handlers/post-tool-use.js')

    for (const toolName of [
      'mcp__plugin_mrclean_mrclean__mrclean_redact',
      'mcp__plugin_mrclean_mrclean__mrclean_check',
      'mcp__plugin_mrclean_mrclean__mrclean_status',
      'mcp__mrclean__mrclean_redact',
      'mcp__mrclean__mrclean_check',
      'mcp__mrclean__mrclean_status',
    ]) {
      const output = await handlePostToolUse({
        ...BASE_INPUT,
        hook_event_name: 'PostToolUse',
        tool_name: toolName,
        tool_input: {},
        tool_response: '{"redacted":"<MRCLEAN:SECRET:001>","findings":[{"ruleId":"GITHUB_TOKEN"}]}',
        tool_use_id: 'tool-self-post',
      })

      expect(output).toBeNull()
    }

    expect(detectSpy).not.toHaveBeenCalled()
    expect(loadSpy).not.toHaveBeenCalled()
  })

  it('Test 11b: NEGATIVE — a foreign tool with a mrclean-like name is NOT exempted (output re-detected)', async () => {
    // A different server exposing a `mrclean_check` tool (e.g. mcp__notmrclean__mrclean_check)
    // must still have its output scanned and substituted.
    const configMod = await import('../../src/config/index.js')
    const sessionMod = await import('../../src/detect/session-state.js')
    const detectMod = await import('../../src/detect/index.js')
    const layer1Mod = await import('../../src/detect/layer1-regex/index.js')

    vi.spyOn(configMod, 'loadEffectiveConfig').mockResolvedValue(MOCK_CONFIG_ACTIVE)
    vi.spyOn(sessionMod, 'getCachedSessionState').mockReturnValue(MOCK_SESSION_STATE)
    vi.spyOn(layer1Mod, 'getRuleCount').mockReturnValue({ secretlint: 1, gitleaks: 183, total: 184 })

    // Build the secret-shaped token at runtime so no literal secret appears in this source.
    const ghToken = ['ghp', 'A'.repeat(36)].join('_')

    const detectSpy = vi.spyOn(detectMod, 'runDetection').mockResolvedValue({
      findings: [{
        ruleId: 'GithubToken',
        severity: 'HIGH',
        span: { start: 0, end: ghToken.length },
        value: ghToken,
        redactedHash: 'gh123',
        fingerprint: 'GithubToken:gh123abc',
        placeholder: '<MRCLEAN:GH_TOKEN:001>',
        effectiveAction: 'block',
      }],
      substitutedText: '<MRCLEAN:GH_TOKEN:001>',
      budgetExhausted: false,
      rawTimeoutCount: 0,
    })

    const { handlePostToolUse } = await import('../../src/hook/handlers/post-tool-use.js')
    const output = await handlePostToolUse({
      ...BASE_INPUT,
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__notmrclean__mrclean_check',
      tool_input: {},
      tool_response: ghToken,
      tool_use_id: 'tool-foreign-post',
    })

    expect(output).not.toBeNull()
    const hso = (output as Record<string, unknown>)['hookSpecificOutput'] as Record<string, unknown>
    expect(hso['updatedToolOutput']).toContain('<MRCLEAN:GH_TOKEN:001>')
    expect(detectSpy).toHaveBeenCalled()
  })
})
