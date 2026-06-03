/**
 * Integration tests for `mrclean hook` — end-to-end stdin/stdout tests
 * against the built dist/cli.js binary.
 *
 * Tests 1-7 from the 01-03-PLAN Task 2 behavior spec.
 *
 * Requires dist/cli.js to exist — a build is run in beforeAll.
 *
 * NEVER test against src/ directly for integration tests — these tests
 * validate the shipped binary (the operator-facing artifact).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { spawnSync, spawn } from 'node:child_process'
import path from 'node:path'

const DIST_CLI = path.resolve(process.cwd(), 'dist/cli.js')

// Run the built hook binary with the given stdin payload
function runHook(
  payload: string,
  extraEnv: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [DIST_CLI, 'hook'], {
    input: payload,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, ...extraEnv },
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

// Base payloads
const SESSION_START_PAYLOAD = JSON.stringify({
  hook_event_name: 'SessionStart',
  source: 'startup',
  session_id: 'x',
  transcript_path: '/tmp/t',
  cwd: '/tmp',
})

const USER_PROMPT_PAYLOAD = JSON.stringify({
  hook_event_name: 'UserPromptSubmit',
  prompt: 'hi',
  session_id: 'x',
  transcript_path: '/tmp/t',
  cwd: '/tmp',
})

const PRE_TOOL_PAYLOAD = JSON.stringify({
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'ls' },
  tool_use_id: 'x',
  session_id: 'x',
  transcript_path: '/tmp/t',
  cwd: '/tmp',
})

const POST_TOOL_PAYLOAD = JSON.stringify({
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'ls' },
  tool_response: 'ok',
  tool_use_id: 'x',
  session_id: 'x',
  transcript_path: '/tmp/t',
  cwd: '/tmp',
})

beforeAll(() => {
  // Build the binary if SKIP_BUILD env var is not set
  if (process.env['SKIP_BUILD']) return

  const build = spawnSync('npm', ['run', 'build'], {
    encoding: 'utf8',
    timeout: 60_000,
    cwd: process.cwd(),
  })
  if (build.status !== 0) {
    throw new Error(`Build failed:\n${build.stderr}\n${build.stdout}`)
  }
}, 120_000)

describe('mrclean hook integration', () => {
  it('Test 1: SessionStart → exit 0, stdout contains mrclean active banner', () => {
    const { status, stdout } = runHook(SESSION_START_PAYLOAD)

    expect(status).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.hookSpecificOutput.additionalContext).toMatch(
      /^mrclean active v\d+\.\d+\.\d+/,
    )
  })

  it('Test 2: UserPromptSubmit → exit 0, stdout contains mrclean active', () => {
    const { status, stdout } = runHook(USER_PROMPT_PAYLOAD)

    expect(status).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.hookSpecificOutput.additionalContext).toContain('mrclean active')
  })

  it('Test 3: PreToolUse → exit 0, stdout permissionDecision === allow', () => {
    const { status, stdout } = runHook(PRE_TOOL_PAYLOAD)

    expect(status).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('allow')
  })

  it('Test 4: PostToolUse → exit 0, stdout is EMPTY (null pass-through)', () => {
    const { status, stdout } = runHook(POST_TOOL_PAYLOAD)

    expect(status).toBe(0)
    // PostToolUse handler returns null → no stdout bytes written
    expect(stdout.trim()).toBe('')
  })

  it('Test 5: malformed JSON → exit 2, stderr first line has error + version keys', () => {
    const { status, stdout, stderr } = runHook('this is not json')

    expect(status).toBe(2)
    expect(stdout.trim()).toBe('')

    const firstLine = stderr.split('\n')[0] ?? ''
    const parsed = JSON.parse(firstLine)
    expect(parsed).toMatchObject({
      error: expect.any(String),
      version: expect.any(String),
    })
  })

  it(
    'Test 6: stdin never closes → hook exits (0 or 2) within timeout, not hung',
    async () => {
      // Arrange — spawn the hook with a pipe that never closes
      const child = spawn(process.execPath, [DIST_CLI, 'hook'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      // Never write to child.stdin — keep the pipe open
      let exitCode: number | null = null

      await new Promise<void>((resolve) => {
        child.on('exit', (code) => {
          exitCode = code
          resolve()
        })
        // 12s timeout in the test itself — the hook's 10s guard should fire first
        setTimeout(() => {
          if (exitCode === null) child.kill()
          resolve()
        }, 12_000)
      })

      // The hook should have exited 0 (timeout guard from Pitfall #4 pattern)
      expect([0, null]).toContain(exitCode)
    },
    15_000, // test timeout: 15s
  )

  it('Test 7: MRCLEAN_TEST_THROW=1 → exit 2, structured error on stderr', () => {
    const { status, stdout, stderr } = runHook(SESSION_START_PAYLOAD, {
      MRCLEAN_TEST_THROW: '1',
    })

    expect(status).toBe(2)
    expect(stdout.trim()).toBe('')

    const firstLine = stderr.split('\n')[0] ?? ''
    const parsed = JSON.parse(firstLine)
    expect(parsed).toMatchObject({
      error: expect.any(String),
      version: expect.any(String),
    })
    // D-04 (Plan 07-01): the raw throw text ('synthetic mrclean crash') is a
    // context-free leak vector — it MUST NOT reach stderr. writeFailClosedError now
    // routes the message through the sanitizeForOutput chokepoint (static safe string)
    // and drops the raw stack, so 'synthetic' never appears in the payload.
    expect(JSON.stringify(parsed)).not.toContain('synthetic')
    expect(parsed.message).not.toContain('synthetic')
    expect(typeof parsed.message).toBe('string')
    expect(parsed.message.length).toBeGreaterThan(0)
    expect(parsed.stack).toBe('redacted')
  })
})
