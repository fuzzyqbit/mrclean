/**
 * Tests for src/hook/stdin.ts
 * Tests: readStdinWithTimeout + StdinTimeoutError
 */

import { describe, it, expect } from 'vitest'
import { Readable } from 'node:stream'
import { readStdinWithTimeout, StdinTimeoutError } from '../../src/hook/stdin.js'

describe('readStdinWithTimeout', () => {
  it('Test 1: resolves to input string when stream closes normally', async () => {
    // Arrange
    const stream = Readable.from(['{"a":1}']) as unknown as NodeJS.ReadableStream

    // Act
    const result = await readStdinWithTimeout(5000, stream as typeof process.stdin)

    // Assert
    expect(result).toBe('{"a":1}')
  })

  it('Test 2: rejects with StdinTimeoutError if no end event fires within timeout', async () => {
    // Arrange — a stream that never ends
    const stream = new Readable({
      read() {
        // never push null
      },
    }) as unknown as typeof process.stdin

    // Act + Assert
    await expect(readStdinWithTimeout(50, stream)).rejects.toBeInstanceOf(StdinTimeoutError)
  })

  it('Test 3: accumulates chunks across multiple data events', async () => {
    // Arrange — stream with multiple chunks
    async function* gen() {
      yield '{"hello":'
      yield '"world"}'
    }
    const stream = Readable.from(gen()) as unknown as typeof process.stdin

    // Act
    const result = await readStdinWithTimeout(5000, stream)

    // Assert
    expect(result).toBe('{"hello":"world"}')
  })
})

describe('StdinTimeoutError', () => {
  it('is an instance of Error', () => {
    const err = new StdinTimeoutError()
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(StdinTimeoutError)
    expect(err.message).toBe('stdin timeout')
  })
})
