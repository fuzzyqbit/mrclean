/**
 * Chaos one-way-parity proofs at the HANDLER level (Plan 09-08, SC5 second
 * half; Phase 11 elevates these to CI gates).
 *
 * For each of six corruption shapes — (a) corrupt byte mid-envelope,
 * (b) truncated envelope, (c) chmod 000 map, (d) map path is a directory,
 * (e) map deleted mid-session, (f) garbage key file — handlePostToolUse is
 * driven twice with the SAME secret-bearing payload:
 *
 *   baseline: reversible DISABLED (shipped one-way default)
 *   enabled : reversible ENABLED against the chaos fixture
 *
 * and the two responses must be deep-equal after normalizing the enabled
 * run's v2 token tails (`:nonce8>` → `>`): same shape, same substitution
 * count, same additionalContext — never a thrown error, never a blocked
 * tool. A corrupted store may cost restore capability; it must NEVER cost
 * redaction (fail-open-to-one-way wall, Pitfall 6 / T-09-08-02).
 *
 * REAL modules throughout — src/state, src/placeholder, src/detect all run
 * for real (contrast: tests/hook/reversible-handlers.test.ts stubs the store
 * seam). The only seams stubbed here are ENV seams: vi.stubEnv('HOME', ...)
 * (os.homedir() reads $HOME on POSIX — 08-12 fresh-HOME precedent) plus a
 * minimal user config.toml enabling [reversible] in the enabled home.
 *
 * WIN32 DOCUMENTED GAP (09 review WR-04): os.homedir() resolves USERPROFILE
 * on win32 and IGNORES $HOME, so the HOME stub cannot redirect the enabled
 * run there — it would run against (and write reversible state into) the
 * developer's REAL home. The whole suite is skipIf(IS_WIN32) with a visible
 * placeholder, consistent with the repo's other win32 skips (Pitfall 8).
 *
 * Corruption fixtures duplicate the envelope offsets pinned by
 * tests/state/map-store.test.ts (RESEARCH Pattern 1) — duplicated, not
 * re-derived: magic(8) | version(1) | IV(12) | tag(16) | ct(N).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { chmod, copyFile, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { handlePostToolUse } from '../../src/hook/handlers/post-tool-use.js'
import {
  persistAllocations,
  readSessionMapForHydration,
} from '../../src/state/index.js'
import { POST_LOCK_DEADLINE_MS } from '../../src/state/lock.js'
import {
  ensureSessionKey,
  keyPathFor,
  mapPathFor,
  statePaths,
  writeSessionMapFile,
} from '../../src/state/map-store.js'
import {
  createEmptySessionMap,
  formatV2Token,
  hmacAddress,
  makeMapEntry,
  type SessionMapV1,
} from '../../src/state/session-map.js'
import { PlaceholderManager } from '../../src/placeholder/manager.js'
import type { PostToolUseInput, PostToolUseOutput } from '../../src/shared/types.js'

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

/** win32 modes are advisory-only — chmod-000 case is POSIX-only (Pitfall 8). */
const IS_WIN32 = process.platform === 'win32'
/** root bypasses permission bits — chmod-000 EACCES never fires as uid 0. */
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0

/**
 * The one detectable secret. AKIAIOSFODNN7EXAMPLX is the canonical
 * real-detection AWS positive (orchestrator.test.ts) — the AWS-docs EXAMPLE
 * key is gitleaks-allowlisted, so the X-suffixed variant is required.
 */
const SECRET = 'AKIAIOSFODNN7EXAMPLX'

/** Seed original for pre-corruption store content (never detection-visible). */
const SEED_ORIGINAL = 'chaos-seed-original'

/** Envelope offsets duplicated from map-store.test.ts — do NOT re-derive. */
const ENVELOPE_MAGIC = 'MRCLNMAP'
const CT_OFFSET = 37 // magic(8) + version(1) + IV(12) + tag(16)
const TRUNCATED_TAG_BYTES = 4

/** v2 token tail stripper: `<MRCLEAN:TYPE:NNN:nonce8>` → `<MRCLEAN:TYPE:NNN>`. */
const V2_TAIL_RE = /(<MRCLEAN:[A-Z0-9_]+:(?:\d{3}|OVF)):[a-f0-9]{8}>/g
/** Non-global probe copy (toMatch + /g would carry lastIndex state). */
const V2_TAIL_PROBE = /<MRCLEAN:[A-Z0-9_]+:(?:\d{3}|OVF):[a-f0-9]{8}>/

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a valid one-entry seed map (counter=1) for corruption fixtures. */
function buildSeedMap(sid: string): SessionMapV1 {
  const base = createEmptySessionMap(sid)
  const address = hmacAddress(base.hashSalt, SEED_ORIGINAL)
  return {
    ...base,
    counter: 1,
    entries: {
      [address]: makeMapEntry('WORD', formatV2Token('WORD', 1, base.nonce8), 1, SEED_ORIGINAL),
    },
  }
}

/** Write a fully valid key+map state for `sid` under `baseDir`. */
async function writeSeedState(baseDir: string, sid: string): Promise<void> {
  const key = await ensureSessionKey(baseDir, sid)
  await writeSessionMapFile(baseDir, sid, buildSeedMap(sid), key)
}

/** 26-byte truncated-tag envelope (map-store.test.ts builder, duplicated). */
function buildTruncatedTagEnvelope(): Buffer {
  return Buffer.concat([
    Buffer.from(ENVELOPE_MAGIC),
    Buffer.from([1]),
    randomBytes(12),
    randomBytes(TRUNCATED_TAG_BYTES),
    Buffer.from([0x42]),
  ])
}

/** PostToolUse fixture — single-string tool_response (simplest full-stack probe). */
function makeInput(sid: string, cwd: string): PostToolUseInput {
  return {
    hook_event_name: 'PostToolUse',
    session_id: sid,
    transcript_path: '/tmp/transcript',
    cwd,
    tool_name: 'Bash',
    tool_input: { command: 'deploy' },
    tool_response: `deploy log: credential ${SECRET} accepted`,
    tool_use_id: 'tool-chaos',
  }
}

/** Normalize an output by stripping v2 nonce tails (structure preserved). */
function stripNonceTails(output: PostToolUseOutput | null): unknown {
  return JSON.parse(JSON.stringify(output).replace(V2_TAIL_RE, '$1>'))
}

/**
 * 11-REVIEW WR-02: env-gated audit-sink export for the CI defense-in-depth
 * grep (canary-leak.yml "reversible canary corpus" step). The sandboxes this
 * suite mints live under os.tmpdir() and are removed in afterEach — CI can
 * never scan them in place. When MRCLEAN_TEST_AUDIT_EXPORT_DIR is set (the
 * wire-safety CI step sets it) each sandbox audit.jsonl is copied there
 * BEFORE removal; the CI step greps the copies and FAILS when the exported
 * set is empty, so a silenced in-test assertion (or broken export wiring)
 * surfaces loud. Best-effort: a copy failure never fails the suite — the CI
 * count gate is the loud end. Unset env (every local run) ⇒ exact no-op.
 * Duplicated by value across the wire-safety suites (never cross-imported).
 */
async function exportAuditSink(dir: string, label: string): Promise<void> {
  const exportDir = process.env['MRCLEAN_TEST_AUDIT_EXPORT_DIR']
  if (exportDir === undefined || exportDir === '') return
  try {
    await mkdir(exportDir, { recursive: true })
    await copyFile(
      join(dir, '.mrclean', 'audit.jsonl'),
      join(exportDir, `${label}-${basename(dir)}-audit.jsonl`),
    )
  } catch {
    // ENOENT = a sandbox without an audit sink (expected for home dirs —
    // audit rides the cwd sandboxes); any real copy failure surfaces via
    // the CI step's empty-set gate.
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

// WR-04: on win32, os.homedir() reads USERPROFILE — the HOME stub below
// would silently miss and every enabled run would hit the REAL user home
// (unreliable assertions at best, real ~/.mrclean writes at worst).
describe.skipIf(IS_WIN32)('chaos one-way parity (handler level, real state modules)', () => {
  const cleanupDirs: string[] = []

  beforeEach(() => {
    // Silence facade degrade warns + audit warn noise (manager.test.ts spy
    // idiom); hash-only discipline for these lines is pinned elsewhere.
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    const dirs = cleanupDirs.splice(0)
    await Promise.all(dirs.map((dir) => exportAuditSink(dir, 'chaos')))
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  })

  /** Create a HOME with (or without) a user config enabling [reversible]. */
  async function makeHome(reversibleEnabled: boolean): Promise<string> {
    const home = join(tmpdir(), `mrclean-chaos-home-${randomUUID()}`)
    cleanupDirs.push(home)
    await mkdir(join(home, '.mrclean'), { recursive: true })
    if (reversibleEnabled) {
      await writeFile(join(home, '.mrclean', 'config.toml'), '[reversible]\nenabled = true\n')
    }
    return home
  }

  /** Isolated cwd with .mrclean/ so audit writes land in the tmp tree. */
  async function makeCwd(): Promise<string> {
    const cwd = join(tmpdir(), `mrclean-chaos-cwd-${randomUUID()}`)
    cleanupDirs.push(cwd)
    await mkdir(join(cwd, '.mrclean'), { recursive: true })
    return cwd
  }

  /**
   * Drive the baseline (disabled) and enabled (chaos fixture) runs and
   * assert the parity contract. Distinct fresh sids per run keep the
   * module-level manager/session caches from cross-contaminating counters
   * (same payload text — the "identical input" under test).
   */
  async function assertParity(
    prepareChaos: (stateBase: string, sid: string) => Promise<void>,
  ): Promise<void> {
    // Arrange
    const homeBase = await makeHome(false)
    const homeRev = await makeHome(true)
    const cwd = await makeCwd()
    const sidBase = randomUUID()
    const sidRev = randomUUID()
    const stateBase = join(homeRev, '.mrclean') // facade defaultBaseDir under stubbed HOME
    await prepareChaos(stateBase, sidRev)

    // Act — baseline first (one-way default), then enabled against the chaos
    // fixture. Both must RESOLVE (never a throw — a throw would be exit-2).
    vi.stubEnv('HOME', homeBase)
    const baseline = await handlePostToolUse(makeInput(sidBase, cwd))
    vi.stubEnv('HOME', homeRev)
    const enabled = await handlePostToolUse(makeInput(sidRev, cwd))

    // Assert — substitution happened in BOTH runs (never a block/pass-through
    // regression), raw secret never on the wire.
    expect(baseline).not.toBeNull()
    expect(enabled).not.toBeNull()
    expect(baseline!.hookSpecificOutput?.hookEventName).toBe('PostToolUse')
    expect(typeof enabled!.hookSpecificOutput?.updatedToolOutput).toBe('string')
    expect(JSON.stringify(baseline)).not.toContain(SECRET)
    expect(JSON.stringify(enabled)).not.toContain(SECRET)

    // Assert — NON-VACUITY: the enabled run really took the reversible
    // branch — its tokens carry v2 nonce tails (a silent config/HOME-stub
    // failure would leave v1 tokens and make parity trivially true).
    expect(JSON.stringify(enabled)).toMatch(V2_TAIL_PROBE)
    expect(JSON.stringify(baseline)).not.toMatch(V2_TAIL_PROBE)

    // Assert — SHAPE parity: strip the enabled run's v2 nonce tails and the
    // responses must be deep-equal (same keys, same counts, same
    // additionalContext — v1 vs v2 token FORM is the only sanctioned delta).
    expect(stripNonceTails(enabled)).toEqual(baseline)
  }

  it('(a) corrupt byte mid-envelope ⇒ output identical to one-way', async () => {
    await assertParity(async (base, sid) => {
      await writeSeedState(base, sid)
      const raw = await readFile(mapPathFor(base, sid))
      const tampered = Buffer.from(raw)
      tampered[CT_OFFSET] = tampered[CT_OFFSET]! ^ 0x01
      await writeFile(mapPathFor(base, sid), tampered)
    })
  })

  it('(b) truncated envelope ⇒ output identical to one-way', async () => {
    await assertParity(async (base, sid) => {
      await ensureSessionKey(base, sid)
      await mkdir(statePaths(base).sessionsDir, { recursive: true, mode: 0o700 })
      await writeFile(mapPathFor(base, sid), buildTruncatedTagEnvelope())
    })
  })

  it.skipIf(IS_WIN32 || IS_ROOT)(
    '(c) chmod 000 map ⇒ output identical to one-way (POSIX; win32 modes are advisory-only — Pitfall 8 gap; root bypasses bits)',
    async () => {
      await assertParity(async (base, sid) => {
        await writeSeedState(base, sid)
        await chmod(mapPathFor(base, sid), 0o000)
      })
    },
  )

  it('(d) map path is a DIRECTORY ⇒ output identical to one-way', async () => {
    await assertParity(async (base, sid) => {
      await ensureSessionKey(base, sid)
      await mkdir(mapPathFor(base, sid), { recursive: true })
    })
  })

  it('(e) map deleted mid-session ⇒ parity, and persist after a mid-transaction delete never throws', async () => {
    // Handler-level parity: the session HAD a store (seed), then lost it.
    await assertParity(async (base, sid) => {
      await writeSeedState(base, sid)
      await unlink(mapPathFor(base, sid))
    })

    // Facade-level mid-transaction proof: hydrate from REAL content, delete
    // the map BETWEEN hydrate and persist, then persist — must resolve
    // degraded-or-ok, never throw (the transaction re-reads under the lock
    // and recreates from empty; Pitfall 6 write side).
    const base = join(tmpdir(), `mrclean-chaos-mid-${randomUUID()}`)
    cleanupDirs.push(base)
    const sid = randomUUID()
    await writeSeedState(base, sid)

    const hydration = await readSessionMapForHydration({ sessionId: sid, baseDir: base })
    expect(hydration).not.toBeNull()
    expect(hydration!.counterFloor).toBe(1) // hydrated from REAL content, not fresh
    const manager = new PlaceholderManager({ sessionId: sid })
    manager.hydrateReversible(hydration!)
    manager.allocate('post-delete-original', 'WORD')
    const pending = manager.drainPendingAllocations()
    expect(pending).toHaveLength(1)

    await unlink(mapPathFor(base, sid)) // deleted between hydrate and persist

    const persisted = await persistAllocations({
      sessionId: sid,
      baseDir: base,
      pending,
      deadlineMs: POST_LOCK_DEADLINE_MS,
    })
    expect(['ok', 'degraded']).toContain(persisted.status)
  })

  it('(f) garbage key file ⇒ output identical to one-way', async () => {
    await assertParity(async (base, sid) => {
      await writeSeedState(base, sid)
      // 17 ASCII bytes — not a valid AES-256 key; decrypt AND re-encrypt fail.
      await writeFile(keyPathFor(base, sid), Buffer.from('garbage-not-a-key'), { mode: 0o600 })
    })
  })
})

describe.skipIf(!IS_WIN32)('chaos parity — win32 documented gap (WR-04)', () => {
  it('suite skipped: vi.stubEnv("HOME") cannot redirect os.homedir() on win32 (USERPROFILE)', () => {
    // Placeholder so the win32 skip is VISIBLE in reporter output rather
    // than silently absent (inspection.test.ts documented-gap precedent).
    expect(IS_WIN32).toBe(true)
  })
})
