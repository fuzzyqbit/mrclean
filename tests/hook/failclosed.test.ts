/**
 * Tests for src/hook/failclosed.ts
 * Tests: installCrashGuards + writeFailClosedError
 *
 * NOTE: uncaughtException + unhandledRejection handlers MUST be tested in child
 * processes — the test framework must not crash.
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFailClosedError } from '../../src/hook/failclosed.js'

// Helper: build a node -e script that installs crash guards and throws/rejects
function runInChildProcess(script: string): { status: number | null; stderrLine: string } {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      script,
    ],
    {
      encoding: 'utf8',
      timeout: 5000,
    },
  )
  const firstLine = (result.stderr ?? '').split('\n')[0] ?? ''
  return { status: result.status, stderrLine: firstLine }
}

describe('installCrashGuards', () => {
  it('Test 4: uncaughtException → exit 2 with structured JSON stderr', () => {
    // Arrange
    const script = `
import { installCrashGuards } from '${process.cwd()}/src/hook/failclosed.js';
installCrashGuards('0.1.0');
// Throw on next tick so the guards are installed first
setTimeout(() => { throw new Error('boom'); }, 0);
`

    // Act
    const { status, stderrLine } = runInChildProcess(script)

    // Assert
    expect(status).toBe(2)
    const parsed = JSON.parse(stderrLine)
    expect(parsed).toMatchObject({
      error: expect.stringContaining('mrclean'),
      message: 'boom',
      version: '0.1.0',
    })
  })

  it('Test 5: unhandledRejection → exit 2 with structured stderr referencing reason', () => {
    // Arrange
    const script = `
import { installCrashGuards } from '${process.cwd()}/src/hook/failclosed.js';
installCrashGuards('0.1.0');
setTimeout(() => { Promise.reject('async-boom'); }, 0);
`

    // Act
    const { status, stderrLine } = runInChildProcess(script)

    // Assert
    expect(status).toBe(2)
    const parsed = JSON.parse(stderrLine)
    expect(parsed).toMatchObject({
      version: '0.1.0',
    })
    // Reason should appear somewhere in the output
    expect(JSON.stringify(parsed)).toContain('async-boom')
  })
})

describe('writeFailClosedError', () => {
  it('Test 6: writes a single JSON line to stderr ending in newline', () => {
    // Arrange — capture stderr
    const lines: string[] = []
    const originalWrite = process.stderr.write.bind(process.stderr)
    let captured = ''
    const spy = (chunk: unknown) => {
      captured += String(chunk)
      return true
    }
    process.stderr.write = spy as typeof process.stderr.write

    // Act
    try {
      writeFailClosedError(new Error('x'), { event: 'PreToolUse' })
    } finally {
      process.stderr.write = originalWrite
    }

    // Assert: exactly one line ending in \n
    expect(captured).toMatch(/\n$/)
    const firstLine = captured.split('\n')[0]
    const parsed = JSON.parse(firstLine ?? '')
    expect(parsed).toMatchObject({
      error: expect.any(String),
      message: 'x',
      event: 'PreToolUse',
    })
    // Must be on a single line (no embedded newlines in the JSON object itself)
    const jsonPart = captured.trimEnd()
    expect(jsonPart).not.toContain('\n')
  })
})
