/**
 * Tests for src/hook/handlers/*
 * Tests: all four per-event handlers (Tests 7-10)
 */

import { describe, it, expect } from 'vitest'
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

const BANNER_PATTERN = /^mrclean active v\d+\.\d+\.\d+ \(no-op mode — detection not yet enabled\)$/

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
  it('Test 7: returns hookSpecificOutput with Phase 1 short banner in additionalContext', () => {
    // Act
    const output = handleSessionStart(sessionStartInput)

    // Assert structure
    expect(output).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: expect.stringMatching(BANNER_PATTERN),
      },
    })

    // Assert exact Phase 1 short form (no rule/allowlist counts)
    expect(output.hookSpecificOutput.additionalContext).not.toContain('rules:')
    expect(output.hookSpecificOutput.additionalContext).not.toContain('allowlist:')
    expect(output.hookSpecificOutput.additionalContext).toContain('no-op mode')
  })
})

describe('handleUserPromptSubmit', () => {
  it('Test 8: returns additionalContext banner; no decision:block (Phase 1 no-op)', () => {
    // Act
    const output = handleUserPromptSubmit(userPromptInput)

    // Assert banner present
    expect(output.hookSpecificOutput?.additionalContext).toMatch(BANNER_PATTERN)

    // Assert Phase 1 never blocks
    expect((output as { decision?: string }).decision).toBeUndefined()
  })
})

describe('handlePreToolUse', () => {
  it('Test 9: returns permissionDecision:allow; no updatedInput (Phase 1 no-op)', () => {
    // Act
    const output = handlePreToolUse(preToolInput)

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
  it('Test 10: returns null (pass-through, caller skips stdout write)', () => {
    // Act
    const output = handlePostToolUse(postToolInput)

    // Assert
    expect(output).toBeNull()
  })
})
