/**
 * ReDoS-safe regex execution via worker_threads.
 *
 * JavaScript's RegExp runs on the main event loop — a catastrophic backtracking
 * pattern completely blocks the event loop; setTimeout callbacks cannot fire
 * while RegExp.exec() is running. The only safe interruption mechanism is
 * worker.terminate() from a separate thread.
 *
 * Pattern (RESEARCH §4.2 — runtime-verified on Node v22.22.0):
 *   1. Spawn a Worker with the regex job via workerData
 *   2. Set a setTimeout(..., timeoutMs) that calls w.terminate()
 *   3. On message (success) or error (compile fail), clear the timer and resolve
 *   4. On terminate (timeout), the promise resolves with { ok: false, timedOut: true }
 *
 * Exports:
 *   RegexWorkerResult — discriminated union for worker results
 *   runRegexInWorker  — single-shot worker per regex execution (safe, used in tests)
 *   WorkerPool        — pool of persistent workers for lower latency (used by engines)
 */

import { Worker } from 'node:worker_threads'

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type RegexWorkerResult =
  | { ok: true; matches: { start: number; end: number; value: string }[] }
  | { ok: false; timedOut: true }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Worker code (embedded string — no separate file needed in bundled dist)
// RESEARCH OQ-A3: eval:true + embedded string works in both tsx and tsup ESM bundle.
// ---------------------------------------------------------------------------

// Note: This string is CommonJS-style because Node worker threads created with
// eval:true use CommonJS by default (no module type negotiation for eval workers).
// We use require() for worker_threads in the eval code.
const WORKER_CODE = `
const { parentPort, workerData } = require('worker_threads');
const { pattern, flags, text } = workerData;
try {
  const re = new RegExp(pattern, flags + 'g');
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    matches.push({ start: m.index, end: re.lastIndex, value: m[1] !== undefined ? m[1] : m[0] });
    // Guard zero-length match to avoid infinite loop
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  parentPort.postMessage({ ok: true, matches });
} catch(e) {
  parentPort.postMessage({ ok: false, error: e.message });
}
`

// ---------------------------------------------------------------------------
// runRegexInWorker — single-shot (one worker per call)
// Used directly by tests and as a fallback when WorkerPool is unavailable.
// ---------------------------------------------------------------------------

/**
 * Run a regex pattern against `text` in an isolated worker thread with a timeout.
 *
 * @param pattern   - The regex source string (without delimiters or flags).
 * @param flags     - Regex flags string (e.g. '' or 'i'). Do NOT include 'g' — it is added internally.
 * @param text      - The input text to search.
 * @param timeoutMs - Maximum ms to allow the worker to run (default 50ms per CONTEXT-lock).
 *
 * @returns RegexWorkerResult discriminated union.
 */
export function runRegexInWorker(
  pattern: string,
  flags: string,
  text: string,
  timeoutMs = 50,
): Promise<RegexWorkerResult> {
  return new Promise((resolve) => {
    const w = new Worker(WORKER_CODE, {
      eval: true,
      workerData: { pattern, flags, text },
    })

    const timer = setTimeout(() => {
      w.terminate()
      resolve({ ok: false, timedOut: true })
    }, timeoutMs)

    w.on('message', (result: RegexWorkerResult) => {
      clearTimeout(timer)
      // Terminate the worker after it sends its result — single-shot workers are disposable
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
