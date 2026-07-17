/**
 * SC5 stress worker fixture (Plan 09-08, REVMODE-04).
 *
 * Built as the TEST-ONLY tsup entry `state-stress-worker` (detect-layer1
 * precedent) and spawned 16x by tests/state/stress.test.ts. Each process
 * drives the REAL facade + manager per transaction — no mocks, no shortcuts,
 * and deliberately NO direct node:crypto usage (all envelope work happens
 * inside src/state/, behind the public facade).
 *
 * argv contract (pinned by the plan — the test builds this exact vector):
 *   [0] node  [1] dist/state-stress-worker.js
 *   [2] baseDir   — injected state root (never the real ~/.mrclean)
 *   [3] workerId  — integer 0..15
 *   [4] goFile    — start-barrier path; the worker polls until it exists so
 *                   all 16 processes contend simultaneously
 *   [5] deadlineMs — persist lock deadline (the test passes a harness-only
 *                   measured-margin value — see stress.test.ts header;
 *                   production constants UPS_LOCK_DEADLINE_MS=50 /
 *                   POST_LOCK_DEADLINE_MS=100 are NOT changed by this fixture)
 *
 * stdout contract (single JSON line):
 *   { workerId: number, results: Record<originalValue, finalPlaceholder>,
 *     degradeCount: number }
 *
 * Transaction loop (one hydrate→allocate→drain→persist cycle PER original —
 * 25 cycles per worker = 400 contended transactions across the burst):
 *   hydrate fresh → allocate ONE value → drain → persist → record the FINAL
 *   placeholder (provisional corrected by any reconcile renames). A persist
 *   status of 'degraded' increments degradeCount — the test's zero-degrade
 *   assertion is load-bearing (Pitfall 3: a pass that quietly lost entries
 *   to process-local fallback must FAIL).
 */

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import {
  applyRenamesToText,
  persistAllocations,
  readSessionMapForHydration,
} from '../../../src/state/index.js'
import { PlaceholderManager } from '../../../src/placeholder/manager.js'

// ---------------------------------------------------------------------------
// Shared contract constants (imported by tests/state/stress.test.ts)
// ---------------------------------------------------------------------------

/**
 * Fixed valid-UUID session id shared by all 16 workers AND the test (the
 * test decrypts the final map under this sid). Passes SESSION_ID_RE.
 */
export const STRESS_SID = '5c5e55ed-0908-4a7e-9b1e-57ee55c0ffee'

export interface StressOriginal {
  value: string
  type: string
}

/** All 16 workers allocate these SAME 20 originals (contention surface). */
export const SHARED_ORIGINAL_COUNT = 20

/**
 * SHARED originals alternate types — even index 'WORD' (restorable), odd
 * index 'AWS_KEY' (secret-class) — so the secret floor is exercised UNDER
 * STRESS, not just in the quiet unit suites.
 */
export const SHARED_ORIGINALS: readonly StressOriginal[] = Object.freeze(
  Array.from({ length: SHARED_ORIGINAL_COUNT }, (_, index) => ({
    value: `shared-original-${String(index).padStart(2, '0')}`,
    type: index % 2 === 0 ? 'WORD' : 'AWS_KEY',
  })),
)

/** Each worker also allocates this many originals nobody else touches. */
export const UNIQUE_PER_WORKER = 5

/** Unique-original naming contract shared with the test's assertions. */
export function uniqueOriginal(workerId: number, n: number): string {
  return `w${workerId}-original-${n}`
}

/** The 25-transaction workload for one worker: 20 shared + 5 unique. */
export function workloadFor(workerId: number): readonly StressOriginal[] {
  const unique = Array.from({ length: UNIQUE_PER_WORKER }, (_, n) => ({
    value: uniqueOriginal(workerId, n),
    type: 'WORD',
  }))
  return [...SHARED_ORIGINALS, ...unique]
}

// ---------------------------------------------------------------------------
// Worker body
// ---------------------------------------------------------------------------

/** Barrier poll interval + cap (cap prevents an orphaned worker hanging). */
const BARRIER_POLL_MS = 2
const BARRIER_CAP_MS = 30_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForGoFile(goFile: string): Promise<void> {
  const cap = Date.now() + BARRIER_CAP_MS
  while (!existsSync(goFile)) {
    if (Date.now() > cap) {
      process.exit(3)
    }
    await sleep(BARRIER_POLL_MS)
  }
}

interface WorkerReport {
  workerId: number
  results: Record<string, string>
  degradeCount: number
}

/**
 * One full transaction: hydrate a FRESH manager from the store, allocate the
 * single value, drain, persist under the lock, and return the FINAL
 * placeholder (post-rename) plus whether the persist degraded.
 */
async function runTransaction(
  baseDir: string,
  original: StressOriginal,
  deadlineMs: number,
): Promise<{ placeholder: string; degraded: boolean }> {
  const hydration = await readSessionMapForHydration({ sessionId: STRESS_SID, baseDir })
  if (hydration === null) {
    // Unreachable for a valid sid — treated as a fatal worker error.
    process.exit(4)
  }
  const manager = new PlaceholderManager({ sessionId: STRESS_SID })
  manager.hydrateReversible(hydration)

  const entry = manager.allocate(original.value, original.type)
  const pending = manager.drainPendingAllocations()
  const persisted = await persistAllocations({
    sessionId: STRESS_SID,
    baseDir,
    pending,
    deadlineMs,
  })

  // Store-race losers get their provisional token renamed to the store
  // winner; a store HIT (empty pending → noop) keeps the hydrated token.
  const placeholder = applyRenamesToText(entry.placeholder, persisted.renames)
  return { placeholder, degraded: persisted.status === 'degraded' }
}

async function main(): Promise<void> {
  const baseDir = process.argv[2]
  const workerIdArg = process.argv[3]
  const goFile = process.argv[4]
  const deadlineArg = process.argv[5]
  if (
    baseDir === undefined ||
    workerIdArg === undefined ||
    goFile === undefined ||
    deadlineArg === undefined
  ) {
    process.stderr.write('usage: state-stress-worker <baseDir> <workerId> <goFile> <deadlineMs>\n')
    process.exit(1)
  }
  const workerId = Number.parseInt(workerIdArg, 10)
  const deadlineMs = Number.parseInt(deadlineArg, 10)
  if (Number.isNaN(workerId) || Number.isNaN(deadlineMs)) {
    process.exit(1)
  }

  await waitForGoFile(goFile)

  const outcomes: Array<readonly [string, string]> = []
  let degradeCount = 0
  for (const original of workloadFor(workerId)) {
    const { placeholder, degraded } = await runTransaction(baseDir, original, deadlineMs)
    outcomes.push([original.value, placeholder] as const)
    if (degraded) {
      degradeCount += 1
    }
  }

  const report: WorkerReport = {
    workerId,
    results: Object.fromEntries(outcomes),
    degradeCount,
  }
  process.stdout.write(JSON.stringify(report) + '\n')
}

// Run ONLY when executed as the spawned entry (node dist/state-stress-worker.js
// ...). The test imports this module for the shared constants — the URL guard
// keeps that import side-effect free.
const invokedAsMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedAsMain) {
  main().catch(() => process.exit(2))
}
