/**
 * Tests for src/doctor/version-check.ts — Claude Code version detection.
 *
 * Test 11 (from plan):
 *   - green for version >= 2.1.100 (injected mock)
 *   - not-found if claude is not installed (injected mock)
 *   - red for version <= 1.99.0 (injected mock)
 *
 * Uses the dep-injection seam: checkClaudeCodeVersion({ runVersionCommand? })
 *
 * Plan 01-05 TDD RED: these tests must fail before implementation.
 */

import { describe, it, expect } from 'vitest'
import type { ClaudeVersionStatus } from '../../src/doctor/version-check.js'

describe('checkClaudeCodeVersion', () => {
  it('exports ClaudeVersionStatus type and checkClaudeCodeVersion function', async () => {
    const mod = await import('../../src/doctor/version-check.js')
    expect(typeof mod.checkClaudeCodeVersion).toBe('function')
  })

  it('Test 11a: green — version >= 2.1.100 (injected mock)', async () => {
    const { checkClaudeCodeVersion } = await import('../../src/doctor/version-check.js')
    const result = await checkClaudeCodeVersion({
      runVersionCommand: async () => '2.1.141 (Claude Code)',
    })
    expect(result.status).toBe<ClaudeVersionStatus>('green')
    expect(result.version).toBe('2.1.141')
    expect(typeof result.detail).toBe('string')
  })

  it('Test 11b: yellow — version >= 2.0.0 but < 2.1.100 (injected mock)', async () => {
    const { checkClaudeCodeVersion } = await import('../../src/doctor/version-check.js')
    const result = await checkClaudeCodeVersion({
      runVersionCommand: async () => '2.0.50 (Claude Code)',
    })
    expect(result.status).toBe<ClaudeVersionStatus>('yellow')
    expect(result.version).toBe('2.0.50')
  })

  it('Test 11c: red — version <= 1.99.0 (injected mock)', async () => {
    const { checkClaudeCodeVersion } = await import('../../src/doctor/version-check.js')
    const result = await checkClaudeCodeVersion({
      runVersionCommand: async () => '1.99.0 (Claude Code)',
    })
    expect(result.status).toBe<ClaudeVersionStatus>('red')
    expect(result.version).toBe('1.99.0')
  })

  it('Test 11d: not-found — runVersionCommand throws (claude not installed)', async () => {
    const { checkClaudeCodeVersion } = await import('../../src/doctor/version-check.js')
    const result = await checkClaudeCodeVersion({
      runVersionCommand: async () => {
        throw new Error('command not found: claude')
      },
    })
    expect(result.status).toBe<ClaudeVersionStatus>('not-found')
    expect(result.version).toBe('not found')
  })

  it('Test 11e: real invocation — returns a status (green/yellow/red/not-found)', async () => {
    const { checkClaudeCodeVersion } = await import('../../src/doctor/version-check.js')
    // No mock — actually run `claude --version`
    const result = await checkClaudeCodeVersion()
    expect(['green', 'yellow', 'red', 'not-found']).toContain(result.status)
    expect(typeof result.version).toBe('string')
    expect(typeof result.detail).toBe('string')
  })
})
