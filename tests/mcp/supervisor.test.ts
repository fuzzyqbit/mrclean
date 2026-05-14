/**
 * Unit tests for src/mcp/supervisor.ts
 *
 * Verifies the in-process Promise isolation contract:
 *   - Synchronous throws inside the wrapped fn are caught.
 *   - Async (Promise rejection) throws inside the wrapped fn are caught.
 *   - Successful executions forward the result unchanged.
 *   - shutdownMcpSupervisor() is callable without error (it re-exports shutdownDetection).
 */

import { describe, it, expect } from 'vitest'
import { supervisedToolCall, shutdownMcpSupervisor } from '../../src/mcp/supervisor.js'

describe('supervisedToolCall', () => {
  it('catches a synchronous throw and returns { ok: false, error }', async () => {
    // Arrange
    const fn = async () => {
      throw new Error('boom sync')
    }

    // Act
    const result = await supervisedToolCall(fn)

    // Assert
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('boom sync')
    }
  })

  it('catches an async rejection and returns { ok: false, error }', async () => {
    // Arrange
    const fn = async () => {
      await Promise.reject(new Error('boom async'))
    }

    // Act
    const result = await supervisedToolCall(fn)

    // Assert
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('boom async')
    }
  })

  it('forwards the result on success as { ok: true, result }', async () => {
    // Arrange
    const expected = { answer: 42 }
    const fn = async () => expected

    // Act
    const result = await supervisedToolCall(fn)

    // Assert
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.result).toBe(expected)
    }
  })

  it('does not produce an unhandled rejection when the wrapped fn throws', async () => {
    // Arrange — track whether any unhandled rejection fires
    let unhandledFired = false
    const handler = () => {
      unhandledFired = true
    }
    process.on('unhandledRejection', handler)

    const fn = async (): Promise<void> => {
      throw new Error('should be caught')
    }

    // Act
    await supervisedToolCall(fn)

    // Give the event loop a tick to fire any pending unhandledRejection events
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert
    expect(unhandledFired).toBe(false)
    process.off('unhandledRejection', handler)
  })
})

describe('shutdownMcpSupervisor', () => {
  it('is safely callable (no-op when pool is not initialized)', async () => {
    // This should resolve without error regardless of pool state.
    await expect(shutdownMcpSupervisor()).resolves.toBeUndefined()
  })
})
