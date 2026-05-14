/**
 * Worker pool for ReDoS-safe regex execution.
 *
 * RESEARCH OQ-5: A pool IS needed to meet the 100ms hook latency budget.
 * Per-worker spawn cost is 2–5ms × ~10–20 keyword-filtered regex executions
 * = 20–100ms in the cold path. Reusing persistent workers amortizes this cost.
 *
 * Pool semantics:
 *   - Fixed size (default 4). Workers are created lazily on first runRegex call.
 *   - Each worker is either 'idle' or 'running'.
 *   - When a free worker is available: send the job to it, await result or timeout.
 *   - When all workers are busy: fall back to a single-shot worker (see NOTE below).
 *
 * NOTE: The fall-back to single-shot workers when the pool is full is intentional.
 * For mrclean's hook model (one hook process per Claude Code session), concurrent
 * runLayer1 calls are extremely rare. The fall-back path avoids backpressure under
 * the unlikely concurrent-invocation scenario. Plan 02-04 may revisit if benchmarks
 * show contention.
 *
 * On timeout, the timed-out worker is terminated and REPLACED with a fresh idle worker
 * (a terminated worker cannot receive new messages).
 *
 * Call `pool.terminate()` at process exit (Plan 02-05 hook shutdown path) to gracefully
 * close all workers and avoid lingering threads.
 *
 * Exports:
 *   WorkerPool — reusable regex worker pool
 */

import { Worker } from 'node:worker_threads'
import { type RegexWorkerResult } from './redos-worker.js'

// ---------------------------------------------------------------------------
// Worker code — same as in redos-worker.ts (duplication is intentional;
// pool workers use the same execution model but communicate via postMessage
// after creation, not via workerData for the per-job payload).
//
// The pool's long-lived workers accept messages of the form { pattern, flags, text }
// and reply with a RegexWorkerResult. This keeps a single code path for both
// single-shot and pooled modes.
// ---------------------------------------------------------------------------

// Long-lived worker code: waits for postMessage jobs instead of reading from workerData
const POOL_WORKER_CODE = `
const { parentPort } = require('worker_threads');
parentPort.on('message', ({ pattern, flags, text }) => {
  try {
    const re = new RegExp(pattern, flags + 'g');
    const matches = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      matches.push({ start: m.index, end: re.lastIndex, value: m[1] !== undefined ? m[1] : m[0] });
      if (re.lastIndex === m.index) re.lastIndex++;
    }
    parentPort.postMessage({ ok: true, matches });
  } catch(e) {
    parentPort.postMessage({ ok: false, error: e.message });
  }
});
`

// Single-shot fallback code (same as redos-worker.ts WORKER_CODE)
const SINGLE_SHOT_CODE = `
const { parentPort, workerData } = require('worker_threads');
const { pattern, flags, text } = workerData;
try {
  const re = new RegExp(pattern, flags + 'g');
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    matches.push({ start: m.index, end: re.lastIndex, value: m[1] !== undefined ? m[1] : m[0] });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  parentPort.postMessage({ ok: true, matches });
} catch(e) {
  parentPort.postMessage({ ok: false, error: e.message });
}
`

// ---------------------------------------------------------------------------
// WorkerPool
// ---------------------------------------------------------------------------

type WorkerState = 'idle' | 'running'

interface PoolWorker {
  worker: Worker
  state: WorkerState
}

/**
 * A fixed-size pool of long-lived worker_threads for regex execution.
 *
 * Workers are created lazily on the first `runRegex` call and reused for
 * subsequent calls. On timeout, the offending worker is terminated and
 * replaced with a fresh idle worker.
 */
export class WorkerPool {
  private readonly size: number
  private readonly workers: Array<PoolWorker | null>
  private initialized = false

  constructor(size = 4) {
    this.size = size
    this.workers = new Array<PoolWorker | null>(size).fill(null)
  }

  /** Initialize all workers eagerly (called on first runRegex). */
  private ensureInitialized(): void {
    if (this.initialized) return
    for (let i = 0; i < this.size; i++) {
      this.workers[i] = this.createWorker()
    }
    this.initialized = true
  }

  private createWorker(): PoolWorker {
    return {
      worker: new Worker(POOL_WORKER_CODE, { eval: true }),
      state: 'idle',
    }
  }

  /** Find the index of an idle worker, or -1 if all are busy. */
  private findIdleSlot(): number {
    for (let i = 0; i < this.size; i++) {
      if (this.workers[i]?.state === 'idle') return i
    }
    return -1
  }

  /**
   * Run a regex against `text` using a pooled worker.
   *
   * If all workers are busy, falls back to a single-shot worker (documented fallback).
   *
   * @param pattern   - The regex source string.
   * @param flags     - Regex flags ('' or 'i'). 'g' is added internally.
   * @param text      - Input text to search.
   * @param timeoutMs - Per-pattern timeout in ms (default 50ms).
   */
  runRegex(
    pattern: string,
    flags: string,
    text: string,
    timeoutMs = 50,
  ): Promise<RegexWorkerResult> {
    this.ensureInitialized()

    const slotIdx = this.findIdleSlot()

    if (slotIdx === -1) {
      // All workers busy — fall back to single-shot worker
      // This is a documented fallback; see module-level NOTE.
      return this.runSingleShot(pattern, flags, text, timeoutMs)
    }

    const slot = this.workers[slotIdx]!
    slot.state = 'running'

    return new Promise((resolve) => {
      const w = slot.worker

      const timer = setTimeout(() => {
        // On timeout: terminate the worker, replace with a fresh one
        w.terminate().catch(() => undefined)
        this.workers[slotIdx] = this.createWorker()
        resolve({ ok: false, timedOut: true })
      }, timeoutMs)

      const onMessage = (result: RegexWorkerResult): void => {
        clearTimeout(timer)
        w.off('message', onMessage)
        w.off('error', onError)
        slot.state = 'idle'
        resolve(result)
      }

      const onError = (err: Error): void => {
        clearTimeout(timer)
        w.off('message', onMessage)
        w.off('error', onError)
        slot.state = 'idle'
        resolve({ ok: false, error: err.message })
      }

      w.on('message', onMessage)
      w.on('error', onError)
      w.postMessage({ pattern, flags, text })
    })
  }

  /** Fall back to a single-shot worker when all pool slots are busy. */
  private runSingleShot(
    pattern: string,
    flags: string,
    text: string,
    timeoutMs: number,
  ): Promise<RegexWorkerResult> {
    return new Promise((resolve) => {
      const w = new Worker(SINGLE_SHOT_CODE, {
        eval: true,
        workerData: { pattern, flags, text },
      })

      const timer = setTimeout(() => {
        w.terminate()
        resolve({ ok: false, timedOut: true })
      }, timeoutMs)

      w.on('message', (result: RegexWorkerResult) => {
        clearTimeout(timer)
        void w.terminate()
        resolve(result)
      })

      w.on('error', (err) => {
        clearTimeout(timer)
        void w.terminate()
        resolve({ ok: false, error: err.message })
      })
    })
  }

  /**
   * Terminate all pool workers.
   *
   * Call at process exit (Plan 02-05 hook shutdown path) to clean up threads.
   * After terminate(), the pool is unusable — create a new instance if needed.
   */
  async terminate(): Promise<void> {
    const promises: Promise<number>[] = []
    for (let i = 0; i < this.size; i++) {
      const slot = this.workers[i]
      if (slot !== null) {
        promises.push(slot.worker.terminate())
        this.workers[i] = null
      }
    }
    await Promise.all(promises)
    this.initialized = false
  }
}
