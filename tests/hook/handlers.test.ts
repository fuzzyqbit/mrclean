/**
 * Phase 2 updated tests for src/hook/handlers/*
 * Tests: all four per-event handlers in the Phase 2 wired state.
 *
 * Phase 1 tests validated no-op behavior. Phase 2 handlers call runDetection,
 * initSessionState, etc. — all external deps are mocked for fast, hermetic tests.
 *
 * These tests validate the basic output shapes (happy path with no findings).
 * Detailed behavior (block/substitute/dry_run/budget) is in handlers-detection.test.ts.
 */

import { describe, it, expect, vi } from 'vitest'

// Mock external deps
vi.mock('../../src/config/index.js', () => ({
  loadEffectiveConfig: vi.fn().mockResolvedValue({
    dry_run: false,
    allowlist: { rules: [], paths: [], stopwords: [], regexes: [], fingerprints: [] },
    entropy: { threshold: 4.5, min_length: 20 },
    secrets_files: [],
    rules: [],
  }),
}))

vi.mock('../../src/detect/session-state.js', () => ({
  initSessionState: vi.fn().mockResolvedValue({
    sessionId: 'test-session',
    envBlocklist: new Map(),
    wordEntries: [],
    createdAt: new Date().toISOString(),
  }),
  getCachedSessionState: vi.fn().mockReturnValue({
    sessionId: 'test-session',
    envBlocklist: new Map(),
    wordEntries: [],
    createdAt: new Date().toISOString(),
  }),
  setCachedSessionState: vi.fn(),
}))

vi.mock('../../src/detect/index.js', () => ({
  runDetection: vi.fn().mockResolvedValue({
    findings: [],
    substitutedText: 'hello world',
    budgetExhausted: false,
    rawTimeoutCount: 0,
  }),
  shutdownDetection: vi.fn(),
}))

vi.mock('../../src/detect/layer1-regex/index.js', () => ({
  getRuleCount: vi.fn().mockReturnValue({ secretlint: 1, gitleaks: 183, total: 184 }),
}))

import { handleSessionStart } from '../../src/hook/handlers/session-start.js'
import { handleUserPromptSubmit } from '../../src/hook/handlers/user-prompt-submit.js'
import { handlePreToolUse } from '../../src/hook/handlers/pre-tool-use.js'
import { handlePostToolUse } from '../../src/hook/handlers/post-tool-use.js'
import type {
  SessionStartInput,
  UserPromptSubmitInput,
  PreToolUseInput,
  PostToolUseInput,
} from '../../src/shared/types.js'

// Phase 2 long-form banner pattern (version may include pre-release suffix, e.g. 1.0.0-rc.1)
const BANNER_PATTERN = /^mrclean active v\d+\.\d+\.\d+[^ ]* \(rules: \d+, allowlist: \d+, mode: (active|dry-run)\)$/

// Minimal valid fixtures
const sessionStartInput: SessionStartInput = {
  hook_event_name: 'SessionStart',
  session_id: 'test-session',
  transcript_path: '/tmp/transcript',
  cwd: '/tmp',
  source: 'startup',
}

const userPromptInput: UserPromptSubmitInput = {
  hook_event_name: 'UserPromptSubmit',
  session_id: 'test-session',
  transcript_path: '/tmp/transcript',
  cwd: '/tmp',
  prompt: 'hello world',
}

const preToolInput: PreToolUseInput = {
  hook_event_name: 'PreToolUse',
  session_id: 'test-session',
  transcript_path: '/tmp/transcript',
  cwd: '/tmp',
  tool_name: 'Bash',
  tool_input: { command: 'ls' },
  tool_use_id: 'tool-123',
}

const postToolInput: PostToolUseInput = {
  hook_event_name: 'PostToolUse',
  session_id: 'test-session',
  transcript_path: '/tmp/transcript',
  cwd: '/tmp',
  tool_name: 'Bash',
  tool_input: { command: 'ls' },
  tool_response: 'file1\nfile2',
  tool_use_id: 'tool-123',
}

describe('handleSessionStart', () => {
  it('Test 7: returns hookSpecificOutput with Phase 2 long-form banner in additionalContext', async () => {
    // Act
    const output = await handleSessionStart(sessionStartInput)

    // Assert structure — Phase 2 long-form banner (HOOK-07)
    expect(output).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: expect.stringMatching(BANNER_PATTERN),
      },
    })

    // Assert Phase 2 long form (has rule/allowlist counts — NOT "no-op mode")
    expect(output.hookSpecificOutput?.additionalContext).toContain('rules:')
    expect(output.hookSpecificOutput?.additionalContext).toContain('allowlist:')
    expect(output.hookSpecificOutput?.additionalContext).not.toContain('no-op mode')
  })
})

describe('handleUserPromptSubmit', () => {
  it('Test 8: no findings → banner in additionalContext; no decision:block (allow path)', async () => {
    // Act
    const output = await handleUserPromptSubmit(userPromptInput)

    // Assert banner present
    expect(output.hookSpecificOutput?.additionalContext).toMatch(BANNER_PATTERN)

    // Assert Phase 2 never blocks on clean prompt
    expect((output as { decision?: string }).decision).toBeUndefined()
  })
})

describe('handlePreToolUse', () => {
  it('Test 9: no findings → permissionDecision:allow; no updatedInput', async () => {
    // Act
    const output = await handlePreToolUse(preToolInput)

    // Assert
    expect(output).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    })
    expect(output.hookSpecificOutput.updatedInput).toBeUndefined()
  })
})

describe('handlePostToolUse', () => {
  it('Test 10: no findings → returns null (pass-through, caller skips stdout write)', async () => {
    // Act
    const output = await handlePostToolUse(postToolInput)

    // Assert
    expect(output).toBeNull()
  })
})
