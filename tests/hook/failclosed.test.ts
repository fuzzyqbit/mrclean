/**
 * Tests for src/hook/failclosed.ts
 * Tests: installCrashGuards + writeFailClosedError
 *
 * NOTE: uncaughtException + unhandledRejection handlers MUST be tested in child
 * processes — the test framework must not crash.
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { writeFailClosedError } from '../../src/hook/failclosed.js'

const require = createRequire(import.meta.url)

/**
 * Resolve the tsx CLI bin robustly across the real repo AND git worktrees.
 *
 * The worktree node_modules is sparse (no .bin/), so the old worktree-relative
 * `../../node_modules/.bin/tsx` path 404s and spawn returns status:null. Node's
 * module resolution walks up to the parent repo's node_modules, so resolve tsx
 * from its package.json and derive the bin path from there.
 */
function resolveTsxBin(): string {
  const pkgPath = require.resolve('tsx/package.json')
  return join(dirname(pkgPath), 'dist', 'cli.mjs')
}

// Helper: run a TS script in a child process using tsx (required for ESM + TypeScript imports)
function runInChildProcess(script: string): { status: number | null; stderrLine: string } {
  // tsx is the dev-time TS runner; it handles .ts imports via the .js extension aliases
  const tsxBin = resolveTsxBin()
  // Spawn via the current node binary so the .mjs CLI runs regardless of the +x bit
  // (worktree node_modules has no executable .bin shims).
  const result = spawnSync(
    process.execPath,
    [
      tsxBin,
      '--input-type=module',
      '-e',
      script,
    ],
    {
      encoding: 'utf8',
      timeout: 10000,
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
      version: '0.1.0',
    })
    // D-04 (Plan 07-01): the raw throw text MUST NOT be echoed to stderr — the
    // message is routed through the context-free chokepoint to a static safe string,
    // and the raw stack/reason are dropped.
    expect(JSON.stringify(parsed)).not.toContain('boom')
    expect(parsed.message).not.toBe('boom')
    expect(typeof parsed.message).toBe('string')
    expect(parsed.message.length).toBeGreaterThan(0)
    expect(parsed.stack).toBe('redacted')
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
    // D-04: the stringified rejection reason MUST NOT leak to stderr. The `reason`
    // field is replaced with a static marker; the raw 'async-boom' never appears.
    expect(JSON.stringify(parsed)).not.toContain('async-boom')
    expect(parsed.reason).toBe('redacted')
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
      event: 'PreToolUse',
    })
    // D-04: raw message text ('x') is scrubbed to the static safe string; context
    // fields (event) still pass through unchanged.
    expect(parsed.message).not.toBe('x')
    expect(typeof parsed.message).toBe('string')
    expect(parsed.message.length).toBeGreaterThan(0)
    // Must be on a single line (no embedded newlines in the JSON object itself)
    const jsonPart = captured.trimEnd()
    expect(jsonPart).not.toContain('\n')
  })
})
