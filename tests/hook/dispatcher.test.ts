/**
 * Tests for src/hook/dispatcher.ts
 * Tests: routing + unknown event throw (Test 11)
 */

import { describe, it, expect } from 'vitest'
import { dispatch } from '../../src/hook/dispatcher.js'
import type {
  SessionStartInput,
  UserPromptSubmitInput,
  PreToolUseInput,
  PostToolUseInput,
} from '../../src/shared/types.js'

const base = {
  session_id: 'test-session',
  transcript_path: '/tmp/transcript',
  cwd: '/tmp',
}

describe('dispatch', () => {
  it('Test 11a: routes SessionStart to handleSessionStart', () => {
    const input: SessionStartInput = { ...base, hook_event_name: 'SessionStart', source: 'startup' }
    const output = dispatch(input)
    expect(output).toMatchObject({
      hookSpecificOutput: { hookEventName: 'SessionStart' },
    })
  })

  it('Test 11b: routes UserPromptSubmit to handleUserPromptSubmit', () => {
    const input: UserPromptSubmitInput = {
      ...base,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'hi',
    }
    const output = dispatch(input)
    expect(output).toMatchObject({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit' },
    })
  })

  it('Test 11c: routes PreToolUse to handlePreToolUse', () => {
    const input: PreToolUseInput = {
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_use_id: 'x',
    }
    const output = dispatch(input)
    expect(output).toMatchObject({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    })
  })

  it('Test 11d: routes PostToolUse to handlePostToolUse → returns null', () => {
    const input: PostToolUseInput = {
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_response: 'ok',
      tool_use_id: 'x',
    }
    const output = dispatch(input)
    expect(output).toBeNull()
  })

  it('Test 11e: throws for unknown hook_event_name', () => {
    const input = { ...base, hook_event_name: 'NotAnEvent' } as unknown as Parameters<
      typeof dispatch
    >[0]
    expect(() => dispatch(input)).toThrow('unknown hook event: NotAnEvent')
  })
})
