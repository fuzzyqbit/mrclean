/**
 * Stdin reader with timeout guard for the mrclean hook.
 *
 * Pitfall #4 (RESEARCH.md §8): On Windows / Git Bash, stdin pipes can stall.
 * A timeout that exits 0 silently prevents the hook from hanging until
 * Claude Code kills it with a transcript error.
 */

import { Readable } from 'node:stream'

/** Thrown when stdin does not close within the given timeout. */
export class StdinTimeoutError extends Error {
  constructor() {
    super('stdin timeout')
    this.name = 'StdinTimeoutError'
  }
}

/**
 * Reads all bytes from stdin (or the provided stream) and resolves to a string
 * when the stream ends. Rejects with `StdinTimeoutError` if the stream does
 * not close within `timeoutMs` milliseconds.
 *
 * The optional `stream` parameter exists for testability — in production,
 * callers omit it and get `process.stdin`.
 */
export function readStdinWithTimeout(
  timeoutMs: number,
  stream: typeof process.stdin = process.stdin,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let chunks = ''
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new StdinTimeoutError())
      }
    }, timeoutMs)

    stream.setEncoding('utf8')

    stream.on('data', (chunk: string) => {
      chunks += chunk
    })

    stream.on('end', () => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(chunks)
      }
    })

    stream.on('error', (err: Error) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(err)
      }
    })
  })
}
