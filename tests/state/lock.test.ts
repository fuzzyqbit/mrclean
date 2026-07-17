/**
 * Lock recipe + deadline-degrade wrapper contract (09-05, REVMODE-04 / D-02).
 *
 * src/state/lock.ts owns the ONLY proper-lockfile usage in the codebase: the
 * pinned acquire recipe (realpath:false so the map file need not exist yet,
 * stale:2500 crashed-holder recovery, millisecond-scale retries) plus the
 * hand-built deadline-degrade wrapper — the one piece RESEARCH says MUST be
 * hand-built. This suite pins:
 *
 *   - acquire succeeds on a nonexistent map path (realpath:false is
 *     load-bearing — the default config throws ENOENT, verified live)
 *   - fn's return value passes through and the lock is released afterwards
 *     (an immediate second withMapLock acquires)
 *   - an externally-held lock plus a short deadline resolves 'degraded' fast
 *     (never throws, never blocks the hook budget — Pitfall 3 / T-09-05-03)
 *   - fn throwing still releases the lock (finally) and the error propagates
 *     to the facade layer, which owns degrade semantics
 *   - a missing PARENT directory degrades (documents why the 09-05 facade
 *     pre-creates sessionsDir before locking — verified live: proper-lockfile's
 *     mkdir primitive needs the parent to exist even with realpath:false)
 *
 * All lock targets live in a per-test tmpdir — never the real ~/.mrclean.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'

import {
  LOCK_OPTS,
  POST_LOCK_DEADLINE_MS,
  UPS_LOCK_DEADLINE_MS,
  withMapLock,
} from '../../src/state/lock.js'

/** Degraded resolution must land well inside the hook budget, never near 1 s. */
const DEGRADE_ELAPSED_CEILING_MS = 1000
/** Short deadline used to force the degrade race in held-lock cases. */
const SHORT_DEADLINE_MS = 60

describe('state lock (withMapLock)', () => {
  let baseDir: string

  beforeEach(async () => {
    // Arrange (shared): isolated per-test tmpdir — never the real ~/.mrclean
    baseDir = join(tmpdir(), `mrclean-lock-${randomUUID()}`)
    await mkdir(baseDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('exports the pinned recipe and deadline constants', () => {
    // Assert — the exact recipe from RESEARCH Code Example 3 (probed on 4.1.2)
    expect(UPS_LOCK_DEADLINE_MS).toBe(50)
    expect(POST_LOCK_DEADLINE_MS).toBe(100)
    expect(LOCK_OPTS).toMatchObject({
      realpath: false,
      stale: 2500,
      retries: { retries: 12, factor: 1.5, minTimeout: 2, maxTimeout: 10, randomize: true },
    })
  })

  it('acquires on a nonexistent map path (realpath:false is load-bearing)', async () => {
    // Arrange — parent dir exists, map file does NOT (first-transaction shape)
    const mapPath = join(baseDir, 'never-written.map')

    // Act
    const result = await withMapLock(mapPath, POST_LOCK_DEADLINE_MS, async () => 'acquired')

    // Assert — default proper-lockfile config would have thrown ENOENT here
    expect(result).toBe('acquired')
  })

  it('passes fn result through and releases the lock afterwards', async () => {
    // Arrange
    const mapPath = join(baseDir, 'roundtrip.map')

    // Act — two back-to-back exclusive sections on the same target
    const first = await withMapLock(mapPath, POST_LOCK_DEADLINE_MS, async () => ({ value: 42 }))
    const second = await withMapLock(mapPath, POST_LOCK_DEADLINE_MS, async () => 'second')

    // Assert — passthrough intact and the release actually happened (the
    // second acquire would have degraded against a still-held lock)
    expect(first).toEqual({ value: 42 })
    expect(second).toBe('second')
  })

  it("resolves 'degraded' fast when the lock is externally held", async () => {
    // Arrange — occupy the lock directly (simulating another hook process
    // mid-transaction) with the same recipe the wrapper uses
    const mapPath = join(baseDir, 'held.map')
    const release = await lockfile.lock(mapPath, LOCK_OPTS)
    const fn = vi.fn(async () => 'never-entered')

    try {
      // Act
      const started = Date.now()
      const result = await withMapLock(mapPath, SHORT_DEADLINE_MS, fn)
      const elapsed = Date.now() - started

      // Assert — degrade, never throw, never block anywhere near a second
      expect(result).toBe('degraded')
      expect(fn).not.toHaveBeenCalled()
      expect(elapsed).toBeLessThan(DEGRADE_ELAPSED_CEILING_MS)
    } finally {
      await release()
    }
  })

  it('releases the lock when fn throws and propagates the error to the facade layer', async () => {
    // Arrange
    const mapPath = join(baseDir, 'throwing.map')

    // Act + Assert — the txn error escapes withMapLock (the facade owns
    // degrade semantics for thrown transactions)
    await expect(
      withMapLock(mapPath, POST_LOCK_DEADLINE_MS, async () => {
        throw new Error('txn boom')
      }),
    ).rejects.toThrow('txn boom')

    // Assert — released in finally: an immediate re-acquire succeeds
    const result = await withMapLock(mapPath, POST_LOCK_DEADLINE_MS, async () => 'reacquired')
    expect(result).toBe('reacquired')
  })

  it("resolves 'degraded' when the map path parent directory does not exist", async () => {
    // Arrange — proper-lockfile's mkdir lock primitive needs the parent dir
    // even with realpath:false (verified live: ENOENT). The facade pre-creates
    // sessionsDir before locking for exactly this reason.
    const mapPath = join(baseDir, 'missing-dir', 'orphan.map')

    // Act
    const result = await withMapLock(mapPath, SHORT_DEADLINE_MS, async () => 'unreachable')

    // Assert — acquire failure is a degrade, never a throw
    expect(result).toBe('degraded')
  })
})
