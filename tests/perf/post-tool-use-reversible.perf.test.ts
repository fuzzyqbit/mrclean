/**
 * Performance row — reversible-mode PostToolUse overhead (Plan 11-06 Task 3,
 * REVMODE-11; closes the STATE.md "Reversible-mode PostToolUse overhead —
 * TBD (Phase 9/11)" metric).
 *
 * The sibling gate (post-tool-use.perf.test.ts) drives `runDetection` only —
 * the reversible hydrate→allocate→persist→lock path is unmeasured there. This
 * row drives the REAL `handlePostToolUse` twice with the chaos secret-bearing
 * payload:
 *
 *   block 1 (baseline)  : one-way default HOME stub (no [reversible] config)
 *   block 2 (reversible): HOME stub with `[reversible] enabled = true`
 *
 * A FRESH randomUUID session_id per iteration means every iteration pays the
 * full cost realistically: config load + session-state bootstrap + (block 2)
 * store hydration, allocation drain, encrypted persist under the lock ladder.
 *
 * Non-vacuity (10-08 ordering discipline — prove the mechanism engaged before
 * trusting the numbers): one sampled reversible output must carry v2 nonce
 * tails (V2_TAIL_PROBE) and one sampled baseline output must NOT — a silent
 * config/HOME-stub failure would otherwise measure one-way twice.
 *
 * Gate: reversible p95 < 200 ms (the PostToolUse budget, REQUIREMENTS
 * PERF-01b). Both p95s, the overhead delta (reversible minus baseline), and
 * headroom % are logged for the STATE.md metric row.
 *
 * Uses plain test() + performance.now() + manual p95 — NOT bench(), which
 * does not expose p95 (analog's RESEARCH §Pitfall 1). Runs in the integration
 * project via the existing tests/perf/** glob (no config edit; perf.yml picks
 * it up unchanged).
 *
 * WIN32 DOCUMENTED GAP (chaos WR-04 precedent): os.homedir() resolves
 * USERPROFILE on win32 and IGNORES $HOME, so the vi.stubEnv('HOME') seam
 * cannot redirect the runs there — skip with a visible placeholder.
 */

import { test, expect, afterEach, vi } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { handlePostToolUse } from '../../src/hook/handlers/post-tool-use.js'
import type { PostToolUseInput, PostToolUseOutput } from '../../src/shared/types.js'

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

/** win32: HOME env is ignored by os.homedir() — POSIX-only suite (WR-04). */
const IS_WIN32 = process.platform === 'win32'

/**
 * The one detectable secret — duplicated from tests/state/chaos.test.ts, do
 * NOT re-derive (the AWS-docs EXAMPLE key is gitleaks-allowlisted; the
 * X-suffixed variant is required for real detection).
 */
const SECRET = 'AKIAIOSFODNN7EXAMPLX'

/**
 * v2 token tail probe — duplicated from tests/state/chaos.test.ts, do NOT
 * re-derive. Non-global copy (toMatch + /g would carry lastIndex state).
 */
const V2_TAIL_PROBE = /<MRCLEAN:[A-Z0-9_]+:(?:\d{3}|OVF):[a-f0-9]{8}>/

const N = 50
const WARMUP = 5
const THRESHOLD = 200 // ms — the PostToolUse budget (REQUIREMENTS PERF-01b)

// ---------------------------------------------------------------------------
// Fixture helpers (chaos.test.ts seams, duplicated by value)
// ---------------------------------------------------------------------------

const cleanupDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(
    cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

/** Create a HOME with (or without) a user config enabling [reversible]. */
async function makeHome(reversibleEnabled: boolean): Promise<string> {
  const home = join(tmpdir(), `mrclean-perf-rev-home-${randomUUID()}`)
  cleanupDirs.push(home)
  await mkdir(join(home, '.mrclean'), { recursive: true })
  if (reversibleEnabled) {
    await writeFile(join(home, '.mrclean', 'config.toml'), '[reversible]\nenabled = true\n')
  }
  return home
}

/** Isolated cwd with .mrclean/ so audit writes land in the tmp tree. */
async function makeCwd(): Promise<string> {
  const cwd = join(tmpdir(), `mrclean-perf-rev-cwd-${randomUUID()}`)
  cleanupDirs.push(cwd)
  await mkdir(join(cwd, '.mrclean'), { recursive: true })
  return cwd
}

/** PostToolUse fixture — secret-bearing single-string tool_response (chaos makeInput). */
function makeInput(sid: string, cwd: string): PostToolUseInput {
  return {
    hook_event_name: 'PostToolUse',
    session_id: sid,
    transcript_path: '/tmp/transcript',
    cwd,
    tool_name: 'Bash',
    tool_input: { command: 'deploy' },
    tool_response: `deploy log: credential ${SECRET} accepted`,
    tool_use_id: 'tool-perf-rev',
  }
}

// ---------------------------------------------------------------------------
// Percentile helper (analog post-tool-use.perf.test.ts, duplicated by value)
// ---------------------------------------------------------------------------

/** Compute the 95th percentile from a sample array (non-mutating sort copy). */
function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.ceil(0.95 * sorted.length) - 1
  return sorted[Math.max(0, idx)] ?? 0
}

// ---------------------------------------------------------------------------
// Measurement block
// ---------------------------------------------------------------------------

interface BlockResult {
  p95Ms: number
  sample: PostToolUseOutput | null
}

/**
 * Drive the real handler N times (after WARMUP) under a stubbed HOME.
 * Fresh randomUUID() session_id per iteration — every iteration pays the full
 * config-load + bootstrap + (reversible) hydrate/persist/lock cost.
 */
async function measureBlock(home: string, cwd: string): Promise<BlockResult> {
  vi.stubEnv('HOME', home)

  for (let i = 0; i < WARMUP; i++) {
    await handlePostToolUse(makeInput(randomUUID(), cwd))
  }

  const samples: number[] = []
  let sample: PostToolUseOutput | null = null
  for (let i = 0; i < N; i++) {
    const input = makeInput(randomUUID(), cwd)
    const t0 = performance.now()
    const output = await handlePostToolUse(input)
    samples.push(performance.now() - t0)
    sample = sample ?? output
  }

  return { p95Ms: p95(samples), sample }
}

// ---------------------------------------------------------------------------
// Perf row test
// ---------------------------------------------------------------------------

test.skipIf(IS_WIN32)(
  'reversible PostToolUse p95 < 200ms; overhead delta vs one-way baseline logged',
  { timeout: 120_000 },
  async () => {
    // Silence facade degrade warns + audit warn noise (chaos.test.ts spy
    // idiom) so the reporter output stays readable; both blocks are treated
    // identically so the delta is unaffected.
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const homeBaseline = await makeHome(false)
    const homeReversible = await makeHome(true)
    const cwd = await makeCwd()

    const baseline = await measureBlock(homeBaseline, cwd)
    const reversible = await measureBlock(homeReversible, cwd)

    // Non-vacuity FIRST (10-08 ordering): the reversible block really took
    // the reversible branch — its tokens carry v2 nonce tails; the baseline
    // block did not. A silent HOME-stub/config failure would otherwise
    // measure one-way twice and render the delta meaningless.
    expect(baseline.sample).not.toBeNull()
    expect(reversible.sample).not.toBeNull()
    expect(JSON.stringify(reversible.sample)).toMatch(V2_TAIL_PROBE)
    expect(JSON.stringify(baseline.sample)).not.toMatch(V2_TAIL_PROBE)

    // Wire-safety sanity: the raw secret never appears in either output.
    expect(JSON.stringify(baseline.sample)).not.toContain(SECRET)
    expect(JSON.stringify(reversible.sample)).not.toContain(SECRET)

    const deltaMs = reversible.p95Ms - baseline.p95Ms
    const headroomPct = (((THRESHOLD - reversible.p95Ms) / THRESHOLD) * 100).toFixed(0)
    console.log(
      `[perf] PostToolUse reversible p95=${reversible.p95Ms.toFixed(2)}ms, ` +
        `one-way baseline p95=${baseline.p95Ms.toFixed(2)}ms, ` +
        `overhead delta=${deltaMs.toFixed(2)}ms ` +
        `(N=${N}, threshold=${THRESHOLD}ms, headroom=${headroomPct}%)`,
    )

    expect(reversible.p95Ms).toBeLessThan(THRESHOLD)
  },
)

test.skipIf(!IS_WIN32)(
  'suite skipped on win32: vi.stubEnv("HOME") cannot redirect os.homedir() (USERPROFILE — WR-04)',
  () => {
    // Placeholder so the win32 skip is VISIBLE in reporter output rather
    // than silently absent (chaos.test.ts documented-gap precedent).
    expect(IS_WIN32).toBe(true)
  },
)
