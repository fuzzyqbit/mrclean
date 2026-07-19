/**
 * SC1a dist-spawn parity gate (REVMODE-11, Plan 11-01).
 *
 * Spawns the SHIPPED dist/cli.js hook twice with the same canary-bearing
 * PostToolUse payload — once under a one-way sandbox HOME (no config) and
 * once under a reversible sandbox HOME (`[reversible]` `enabled = true`) —
 * and asserts the parsed stdouts are deep-equal after stripping the enabled
 * run's v2 nonce tails (`:nonce8>` → `>`), with the raw secret canary absent
 * from both stdouts and from the persisted session map's raw bytes.
 *
 * Why dist level: tests/state/chaos.test.ts proves this parity at the
 * HANDLER level, but 09-08 demonstrated that unit/tsx greens can hide
 * dist-only bugs (tsup shims, `__filename` in bundled CJS deps). REVMODE-11's
 * "hook stdout is unchanged by reversible mode" needs artifact-level proof
 * against the REAL bundle users run.
 *
 * Assertion ORDER is load-bearing (non-vacuity BEFORE parity — a silent
 * config/HOME miss would leave v1 tokens in both runs and make the parity
 * assertion trivially true):
 *   (1) exit 0 both runs
 *   (2) stdout non-empty both runs (substitution occurred)
 *   (3) parse both stdouts; neither RAW stdout string contains SECRET
 *   (4) reversible stdout matches the v2 token probe (branch REALLY engaged)
 *   (5) one-way stdout does NOT match the v2 probe
 *   (6) stripNonceTails(parsedReversible) deep-equals parsedOneway
 *   (7) reversible map file exists; its raw bytes lack SECRET (ciphertext-only)
 *   (8) one-way home has NO sessions dir (REVMODE-05 byte-identical default)
 *
 * Build ownership: NO beforeAll build here — the integration project's
 * globalSetup owns the tsup build (stress.test.ts precedent). This file is
 * dual-listed in vitest.config.ts (unit exclude + integration include) in
 * the SAME commit, so the unit glob can never run it against a stale dist
 * (Pitfall 2, 10-07 vacuous-pass hazard).
 *
 * WIN32 DOCUMENTED GAP (chaos.test.ts WR-04 precedent): os.homedir()
 * resolves USERPROFILE and IGNORES $HOME on win32, so the sandbox HOME
 * redirect cannot isolate the spawned hook there — it would read (and write
 * reversible state into) the developer's REAL home. Suite is
 * skipIf(IS_WIN32) with a visible placeholder describe.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

const DIST_CLI = path.resolve(process.cwd(), 'dist/cli.js')

// ---------------------------------------------------------------------------
// Pinned constants — duplicated from tests/state/chaos.test.ts, not
// re-derived and never cross-imported (duplicate-don't-import discipline).
// ---------------------------------------------------------------------------

/**
 * The one detectable secret. AKIAIOSFODNN7EXAMPLX is the canonical
 * real-detection AWS positive — the AWS-docs EXAMPLE key is
 * gitleaks-allowlisted (`.+EXAMPLE$`), so the X suffix is load-bearing.
 */
const SECRET = 'AKIAIOSFODNN7EXAMPLX'

/** v2 token tail stripper: `<MRCLEAN:TYPE:NNN:nonce8>` → `<MRCLEAN:TYPE:NNN>`. */
const V2_TAIL_RE = /(<MRCLEAN:[A-Z0-9_]+:(?:\d{3}|OVF)):[a-f0-9]{8}>/g
/** Non-global probe copy (toMatch + /g would carry lastIndex state). */
const V2_TAIL_PROBE = /<MRCLEAN:[A-Z0-9_]+:(?:\d{3}|OVF):[a-f0-9]{8}>/

/** win32: os.homedir() reads USERPROFILE and ignores the HOME override. */
const IS_WIN32 = process.platform === 'win32'

// ---------------------------------------------------------------------------
// Sandbox homes + spawn helpers
// ---------------------------------------------------------------------------

/** tmp homes minted by this suite; removed in afterAll (chaos cleanup idiom). */
const cleanupDirs: string[] = []

/**
 * Mint a fresh sandbox HOME. reversibleEnabled writes the minimal user
 * config enabling [reversible] (chaos.test.ts makeHome recipe); the one-way
 * home gets NOTHING — the shipped default must not need a config file.
 */
function makeHome(reversibleEnabled: boolean): string {
  const home = mkdtempSync(path.join(tmpdir(), 'mrclean-dist-parity-home-'))
  cleanupDirs.push(home)
  if (reversibleEnabled) {
    mkdirSync(path.join(home, '.mrclean'), { recursive: true })
    writeFileSync(path.join(home, '.mrclean', 'config.toml'), '[reversible]\nenabled = true\n')
  }
  return home
}

/**
 * Canary-bearing PostToolUse payload (chaos.test.ts makeInput shape; the cwd
 * field mirrors tests/hook/integration.test.ts's static '/tmp' handling).
 * Fresh randomUUID() sid PER run keeps the two runs' state files disjoint.
 */
function makePayload(sid: string): Record<string, unknown> {
  return {
    hook_event_name: 'PostToolUse',
    session_id: sid,
    transcript_path: '/tmp/transcript',
    cwd: '/tmp',
    tool_name: 'Bash',
    tool_input: { command: 'deploy' },
    tool_response: `deploy log: credential ${SECRET} accepted`,
    tool_use_id: 'tool-dist-parity',
  }
}

/** Spawn the SHIPPED dist/cli.js hook under the given sandbox HOME
 *  (integration.test.ts runHook recipe — USERPROFILE mirrored for symmetry). */
function runHook(
  home: string,
  payload: Record<string, unknown>,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [DIST_CLI, 'hook'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/** Normalize a parsed stdout object by stripping v2 nonce tails (structure
 *  preserved — v1 vs v2 token FORM is the only sanctioned delta). */
function stripNonceTails(output: unknown): unknown {
  return JSON.parse(JSON.stringify(output).replace(V2_TAIL_RE, '$1>'))
}

afterAll(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(IS_WIN32)('dist-spawn parity gate (SC1a — shipped bundle, one-way vs reversible)', () => {
  it('reversible stdout deep-equals one-way after nonce strip; zero canary on stdout or in map bytes', () => {
    // Arrange — two sandbox homes, fresh sid per run (same payload TEXT
    // apart from the sid — the "identical input" under test).
    const homeOneway = makeHome(false)
    const homeRev = makeHome(true)
    const sidOneway = randomUUID()
    const sidRev = randomUUID()

    // Act — spawn the shipped bundle once per mode.
    const oneway = runHook(homeOneway, makePayload(sidOneway))
    const reversible = runHook(homeRev, makePayload(sidRev))

    // (1) exit 0 both runs — never a block, never a crash.
    expect(oneway.status).toBe(0)
    expect(reversible.status).toBe(0)

    // (2) stdout non-empty both runs — substitution occurred (a detection
    // miss would pass through with empty stdout and vacuously "match").
    expect(oneway.stdout.length).toBeGreaterThan(0)
    expect(reversible.stdout.length).toBeGreaterThan(0)

    // (3) parse both stdouts; neither RAW stdout string carries the canary.
    const parsedOneway = JSON.parse(oneway.stdout) as unknown
    const parsedReversible = JSON.parse(reversible.stdout) as unknown
    expect(oneway.stdout).not.toContain(SECRET)
    expect(reversible.stdout).not.toContain(SECRET)

    // (4) NON-VACUITY: the reversible branch REALLY engaged — its tokens
    // carry v2 nonce tails (a silent config/HOME miss would leave v1 tokens
    // and make the parity assertion below trivially true).
    expect(reversible.stdout).toMatch(V2_TAIL_PROBE)

    // (5) the one-way run stayed v1 — no nonce tails on the default path.
    expect(oneway.stdout).not.toMatch(V2_TAIL_PROBE)

    // (6) SHAPE parity: strip the reversible run's v2 nonce tails and the
    // parsed stdouts must be deep-equal (same keys, same substitution
    // counts, same additionalContext).
    expect(stripNonceTails(parsedReversible)).toEqual(parsedOneway)

    // (7) map spot-check: the reversible session map exists and its raw
    // bytes are ciphertext-only. Path derived the way
    // src/state/map-store.ts mapPathFor does: <baseDir>/sessions/<sid>.map
    // with baseDir = <home>/.mrclean.
    const mapPath = path.join(homeRev, '.mrclean', 'sessions', `${sidRev}.map`)
    expect(existsSync(mapPath)).toBe(true)
    const rawMapBytes = readFileSync(mapPath)
    expect(rawMapBytes.includes(SECRET)).toBe(false)

    // (8) the one-way home contains NO sessions directory — the
    // byte-identical one-way default writes zero reversible state
    // (REVMODE-05).
    expect(existsSync(path.join(homeOneway, '.mrclean', 'sessions'))).toBe(false)
  })
})

describe.skipIf(!IS_WIN32)('dist-spawn parity — win32 documented gap', () => {
  it('suite skipped: HOME env override cannot redirect os.homedir() on win32 (USERPROFILE)', () => {
    // Placeholder so the win32 skip is VISIBLE in reporter output rather
    // than silently absent (chaos.test.ts WR-04 precedent).
    expect(IS_WIN32).toBe(true)
  })
})
