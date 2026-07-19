/**
 * SC5 16-process integration stress gate (Plan 09-08, REVMODE-04).
 *
 * Spawns 16 REAL Node processes (dist/state-stress-worker.js — the TEST-ONLY
 * tsup entry built by the integration project's globalSetup) that contend on
 * ONE session map: every worker runs 25 hydrate→allocate→drain→persist
 * transactions (20 SHARED originals + 5 unique), released simultaneously by
 * a go-file barrier. 400 contended transactions per run.
 *
 * The six assertion families are ALL mandatory (Phase 11 elevates this gate
 * to CI — it must already pass at integration level):
 *   1. zero LOST entries      — decrypted map has exactly 20 + 16*5 = 100
 *   2. counter integrity      — map.counter === 100
 *   3. zero NNN duplicates    — 100 distinct placeholders, all NNN-form
 *                               (counts never near 999 ⇒ assert NO OVF)
 *   4. cross-process identity — all 16 workers report the SAME placeholder
 *                               for each shared original (and it matches the
 *                               store's authoritative entry)
 *   5. zero degrades          — sum(degradeCount) === 0. LOAD-BEARING
 *                               (Pitfall 3): a pass that quietly lost entries
 *                               to process-local fallback must FAIL.
 *   6. secret floor holds     — 'AWS_KEY'-typed shared entries lack
 *                               `original` in the decrypted map (D-11 under
 *                               contention, not just in quiet unit suites).
 *
 * Worker deadline is 500 ms (harness-only knob, T-09-08-06). RESEARCH's
 * 150 ms reference (400 txns / 117 ms / 0 timeouts) was measured against the
 * zero-dep mkdir-lockdir fallback probing every 0.5-2 ms; the shipped
 * proper-lockfile ladder probes at 2→10 ms and its giveup was re-measured at
 * ~119 ms (09-05 perf note). Under the 16-process boot storm the SLOWEST
 * first-transaction acquire tail exceeded 150 ms on the executor machine
 * (2/400 pure-deadline degrades at 150 ms; 0/400 across three consecutive
 * runs at 500 ms — perf-gate evidence, tuned per T-09-08-06). The PRODUCTION
 * constants stay untouched: UPS_LOCK_DEADLINE_MS=50, POST_LOCK_DEADLINE_MS=100.
 * The zero-degrade assertion is NEVER the knob.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  SHARED_ORIGINALS,
  STRESS_SID,
  UNIQUE_PER_WORKER,
  uniqueOriginal,
} from './fixtures/stress-worker.js'
import { readSessionMapFile } from '../../src/state/map-store.js'
import { V2_TOKEN_RE, hmacAddress } from '../../src/state/session-map.js'

// ---------------------------------------------------------------------------
// Harness constants
// ---------------------------------------------------------------------------

const WORKER = join(process.cwd(), 'dist', 'state-stress-worker.js')
const WORKER_COUNT = 16
/**
 * Harness deadline — measured-margin value (see header; prod stays 50/100).
 * Raised from 500ms after the first real ubuntu-latest CI run (T-09-08-06,
 * 2026-07-18): 1/400 pure-deadline degrades under GitHub Actions' shared
 * 2-vCPU runner + V8 coverage instrumentation overhead on the 16-process
 * boot-storm's slowest first-transaction lock-acquire tail (500ms held
 * 0/400 across three consecutive local-executor runs, but that machine has
 * no coverage instrumentation and dedicated cores). 1500ms gives 3x margin
 * over the local-executor-sufficient value while staying well inside the
 * test's 60s outer timeout. The zero-degrade assertion itself is untouched.
 */
const WORKER_DEADLINE_MS = 1500
/** Boot settle before the barrier drops, so all 16 procs contend at once. */
const SETTLE_MS = 200
const EXPECTED_ENTRIES = SHARED_ORIGINALS.length + WORKER_COUNT * UNIQUE_PER_WORKER // 100

interface WorkerReport {
  workerId: number
  results: Record<string, string>
  degradeCount: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Spawn one worker and resolve its single-JSON-line stdout report. */
function runWorker(baseDir: string, workerId: number, goFile: string): Promise<WorkerReport> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      [WORKER, baseDir, String(workerId), goFile, String(WORKER_DEADLINE_MS)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`worker ${workerId} exited ${code}; stderr: ${stderr.slice(0, 500)}`))
        return
      }
      const lastLine = stdout.trim().split('\n').pop() ?? ''
      try {
        resolve(JSON.parse(lastLine) as WorkerReport)
      } catch {
        reject(new Error(`worker ${workerId} emitted unparseable stdout: ${stdout.slice(0, 500)}`))
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('@hook-integration SC5 stress gate — 16 processes, one map', () => {
  let baseDir: string

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'mrclean-stress-'))
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it(
    '16 real processes x 25 txns: 0 lost / 0 dups / 0 disagreements / 0 degrades',
    { timeout: 60_000 },
    async () => {
      // Arrange — spawn all 16 workers; they poll the go-file barrier.
      const goFile = join(baseDir, 'go')
      const pending = Array.from({ length: WORKER_COUNT }, (_, id) =>
        runWorker(baseDir, id, goFile),
      )

      // Act — settle boot, then drop the barrier so the burst is simultaneous.
      await sleep(SETTLE_MS)
      const burstStart = performance.now()
      await writeFile(goFile, 'go')
      const reports = await Promise.all(pending)
      const burstMs = performance.now() - burstStart

      // Decrypt the FINAL map through the real store (test-owned key path).
      const map = await readSessionMapFile(baseDir, STRESS_SID)
      expect(map).not.toBeNull()
      const entries = Object.values(map!.entries)

      // Assert 1 — zero LOST entries: exactly 20 shared + 16*5 unique = 100.
      expect(entries).toHaveLength(EXPECTED_ENTRIES)

      // Assert 2 — counter integrity: the authoritative counter equals the
      // entry count (no burned or skipped counters).
      expect(map!.counter).toBe(EXPECTED_ENTRIES)

      // Assert 3 — zero NNN duplicates. Counts never approach 999 here, so
      // OVF must be entirely absent (the OVF exemption never engages).
      const placeholders = entries.map((entry) => entry.placeholder)
      for (const placeholder of placeholders) {
        expect(placeholder).toMatch(V2_TOKEN_RE)
        expect(placeholder).not.toContain(':OVF:')
      }
      expect(new Set(placeholders).size).toBe(EXPECTED_ENTRIES)

      // Assert 4 — cross-process identity: every worker reports the SAME
      // placeholder for each of the 20 shared originals, and that placeholder
      // is the store's authoritative one.
      for (const shared of SHARED_ORIGINALS) {
        const reported = new Set(
          reports.map((report) => {
            const placeholder = report.results[shared.value]
            expect(placeholder).toBeDefined()
            return placeholder!
          }),
        )
        expect(reported.size).toBe(1)
        const storeEntry = map!.entries[hmacAddress(map!.hashSalt, shared.value)]
        expect(storeEntry).toBeDefined()
        expect(reported.has(storeEntry!.placeholder)).toBe(true)
      }

      // Assert 4b — every reported allocation (unique originals included)
      // resolved to the store's entry: nothing lives only process-locally.
      for (const report of reports) {
        for (const [value, placeholder] of Object.entries(report.results)) {
          const storeEntry = map!.entries[hmacAddress(map!.hashSalt, value)]
          expect(storeEntry).toBeDefined()
          expect(storeEntry!.placeholder).toBe(placeholder)
        }
        for (let n = 0; n < UNIQUE_PER_WORKER; n++) {
          expect(report.results[uniqueOriginal(report.workerId, n)]).toBeDefined()
        }
      }

      // Assert 5 — ZERO degrade fallbacks (LOAD-BEARING, Pitfall 3): a pass
      // that lost entries to process-local fallback must fail HERE even if
      // the map happens to look complete.
      const totalDegrades = reports.reduce((sum, report) => sum + report.degradeCount, 0)
      expect(totalDegrades).toBe(0)

      // Assert 6 — secret floor under stress: AWS_KEY-typed shared entries
      // structurally lack `original`; WORD-typed shared entries carry it.
      for (const shared of SHARED_ORIGINALS) {
        const storeEntry = map!.entries[hmacAddress(map!.hashSalt, shared.value)]
        expect(storeEntry).toBeDefined()
        const entry = storeEntry!
        if (shared.type === 'AWS_KEY') {
          expect('original' in entry).toBe(false)
        } else {
          expect('original' in entry ? entry.original : undefined).toBe(shared.value)
        }
      }

      // Reference telemetry for the SUMMARY (not an assertion — T-09-08-06
      // accepts CI timing variance; the deadline constant is the only knob).
      process.stderr.write(
        JSON.stringify({
          info: 'stress burst complete',
          burstMs: Math.round(burstMs),
          entries: entries.length,
          degrades: totalDegrades,
        }) + '\n',
      )
    },
  )
})
