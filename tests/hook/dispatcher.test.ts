/**
 * Tests for src/hook/dispatcher.ts
 * Tests: routing + unknown event throw (Test 11)
 *
 * Phase 2 update (Plan 02-05): dispatch() is now async — tests use await.
 * External deps (config, session-state, detection, getRuleCount) are mocked
 * so these tests remain fast and hermetic.
 */

import { describe, it, expect, vi } from 'vitest'

// Mock all external dependencies so dispatcher tests don't do real I/O
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
    substitutedText: '',
    budgetExhausted: false,
    rawTimeoutCount: 0,
  }),
  shutdownDetection: vi.fn(),
}))

vi.mock('../../src/detect/layer1-regex/index.js', () => ({
  getRuleCount: vi.fn().mockReturnValue({ secretlint: 1, gitleaks: 183, total: 184 }),
}))

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
  it('Test 11a: routes SessionStart to handleSessionStart', async () => {
    const input: SessionStartInput = { ...base, hook_event_name: 'SessionStart', source: 'startup' }
    const output = await dispatch(input)
    expect(output).toMatchObject({
      hookSpecificOutput: { hookEventName: 'SessionStart' },
    })
  })

  it('Test 11b: routes UserPromptSubmit to handleUserPromptSubmit', async () => {
    const input: UserPromptSubmitInput = {
      ...base,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'hi',
    }
    const output = await dispatch(input)
    expect(output).toMatchObject({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit' },
    })
  })

  it('Test 11c: routes PreToolUse to handlePreToolUse', async () => {
    const input: PreToolUseInput = {
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_use_id: 'x',
    }
    const output = await dispatch(input)
    expect(output).toMatchObject({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    })
  })

  it('Test 11d: routes PostToolUse to handlePostToolUse → returns null (no findings)', async () => {
    const input: PostToolUseInput = {
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_response: 'ok',
      tool_use_id: 'x',
    }
    const output = await dispatch(input)
    expect(output).toBeNull()
  })

  it('Test 11e: throws for unknown hook_event_name', async () => {
    const input = { ...base, hook_event_name: 'NotAnEvent' } as unknown as Parameters<
      typeof dispatch
    >[0]
    await expect(dispatch(input)).rejects.toThrow('unknown hook event: NotAnEvent')
  })
})
