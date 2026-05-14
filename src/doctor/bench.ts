/**
 * Doctor bench stub — Plan 02-06.
 *
 * `runBenchmark` measures p50/p95 of Layer 1 + Layer 2 hook latency over N runs
 * against a synthetic 4 KB prompt fixture. Returns numbers; no assertions are made
 * (Phase 3 PERF-02 owns the assertion gate).
 *
 * Called by `runDoctor({ bench: true })` and `mrclean doctor --bench`.
 *
 * Performance note: the WorkerPool is created fresh for each benchmark run and
 * terminated afterward to avoid leaving threads running after the bench completes.
 * Phase 3 will reuse a persistent pool if the spawn overhead dominates.
 */

import { runDetection } from '../detect/index.js'
import { DEFAULT_CONFIG } from '../config/defaults.js'
import type { SessionState } from '../detect/session-state.js'
import type { DetectionContext } from '../detect/index.js'

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/** Benchmark result returned by runBenchmark. */
export interface BenchmarkResult {
  /** Median (50th percentile) latency in milliseconds. */
  p50: number
  /** 95th percentile latency in milliseconds. */
  p95: number
  /** Number of benchmark runs completed. */
  runsCount: number
}

// ---------------------------------------------------------------------------
// Synthetic 4 KB fixture
// ---------------------------------------------------------------------------

/**
 * Synthetic 4 KB prompt fixture with no embedded secrets.
 * Layer 1 + Layer 2 run against this text on every bench iteration.
 *
 * The fixture is deliberately benign so no audit records are emitted and
 * no placeholder allocations occur — purely measuring detection throughput.
 */
const FIXTURE_4KB = 'This is a synthetic 4KB test prompt. '.repeat(114).slice(0, 4096)

// ---------------------------------------------------------------------------
// Mock session state (no filesystem I/O — bench is self-contained)
// ---------------------------------------------------------------------------

/**
 * Minimal SessionState for the benchmark — empty env blocklist and no word entries.
 * The bench does not scan .env files or words.txt; those are Layer 3 + 4 costs
 * that are measured separately. Phase 2 bench focuses on Layer 1 + Layer 2.
 */
const BENCH_SESSION_STATE: SessionState = {
  sessionId: 'bench',
  envBlocklist: {
    values: new Set<string>(),
    meta: new Map<string, string>(),
  },
  wordEntries: [],
  createdAt: new Date().toISOString(),
}

/**
 * Detection context for bench runs — cwd is irrelevant because there are no
 * findings and therefore no audit records to write.
 */
const BENCH_CTX: DetectionContext = {
  sessionId: 'bench',
  hookEvent: 'UserPromptSubmit',
  cwd: process.cwd(),
}

// ---------------------------------------------------------------------------
// runBenchmark
// ---------------------------------------------------------------------------

/**
 * Run the detection pipeline N times against the 4 KB fixture and compute
 * p50 and p95 latency percentiles.
 *
 * @param opts.runsCount - Number of benchmark iterations (default 10).
 * @returns              - BenchmarkResult with p50, p95 (ms), and runsCount.
 */
export async function runBenchmark(opts: { runsCount?: number } = {}): Promise<BenchmarkResult> {
  const runsCount = opts.runsCount ?? 10

  // Use a per-bench session state with a unique session ID to avoid polluting
  // the module-level PlaceholderManager cache from other test runs.
  const benchSessionState: SessionState = {
    ...BENCH_SESSION_STATE,
    sessionId: `bench-${Date.now()}`,
    createdAt: new Date().toISOString(),
  }
  const benchCtx: DetectionContext = {
    ...BENCH_CTX,
    sessionId: benchSessionState.sessionId,
  }

  const times: number[] = []

  for (let i = 0; i < runsCount; i++) {
    const t0 = performance.now()
    await runDetection(FIXTURE_4KB, DEFAULT_CONFIG, benchSessionState, benchCtx)
    times.push(performance.now() - t0)
  }

  // Sort ascending for percentile computation
  times.sort((a, b) => a - b)

  const p50 = times[Math.floor(runsCount * 0.5)] ?? 0
  const p95 = times[Math.floor(runsCount * 0.95)] ?? 0

  return { p50, p95, runsCount }
}
