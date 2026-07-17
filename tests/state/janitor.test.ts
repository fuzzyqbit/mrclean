/**
 * REVMODE-07 unit proof: reason-aware SessionEnd janitor + TTL orphan sweep
 * (09-06).
 *
 * Pins the full D-05/D-06/D-07 lifecycle contract, including both
 * RESEARCH-resolved traps:
 *
 *   - D-06 allowlist: retention on exactly `reason === 'resume'`. The
 *     documented delete set (clear / logout / prompt_input_exit / other),
 *     the documented-but-not-retained `bypass_permissions_disabled`
 *     (src/shared/types.ts:76-78), AND any unknown future reason string all
 *     delete key + map (fail-toward-privacy).
 *   - D-05 ordering: KEY deleted before MAP, each individually isolated —
 *     proven by making the map undeletable (a non-empty directory at the
 *     map path) and asserting the key still dies.
 *   - Pitfall 4 (the load-bearing sweep case): paired sessions age by MAP
 *     mtime ONLY. A live session with an old key and a fresh map SURVIVES;
 *     a fresh key cannot save a stale map.
 *   - Pitfall 5: sid derives every delete target — an invalid sid
 *     (traversal attempt, synthetic 'mcp-server') deletes NOTHING.
 *   - T-09-06-06: only filenames we provably created (`<uuid>.key`,
 *     `<uuid>.map`, `*.tmp` under sessions/) are sweep candidates.
 *
 * All fs cases run against a per-test tmpdir baseDir — never the real
 * ~/.mrclean (injection precedent: tests/state/map-store.test.ts).
 *
 * DOCUMENTED GAP (RESEARCH Pitfall 8): chmod is advisory-only on win32 and
 * meaningless as root — the unreadable-dir case is POSIX-only, non-root.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chmod, mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ORPHAN_GRACE_MS, runSessionEndJanitor, runTtlSweep } from '../../src/state/janitor.js'
import { keyPathFor, mapPathFor, statePaths } from '../../src/state/map-store.js'

// ---------------------------------------------------------------------------
// Fixture constants + helpers
// ---------------------------------------------------------------------------

/** win32 modes are advisory-only — POSIX-only assertions (Pitfall 8 gap). */
const IS_WIN32 = process.platform === 'win32'
/** root bypasses permission bits — chmod-000 EACCES is meaningless as uid 0. */
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0

const HOUR_MS = 3_600_000
const SECOND_MS = 1_000

/** Every reason OUTSIDE the ['resume'] allowlist deletes — including the
 *  DOCUMENTED bypass_permissions_disabled (types.ts:76-78, D-06 delete side)
 *  and a fabricated future reason (open-string strengthening case). */
const DELETING_REASONS = [
  'clear',
  'logout',
  'prompt_input_exit',
  'other',
  'bypass_permissions_disabled',
  'some_future_reason_v9',
] as const

function spyOnStderr() {
  return vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
}

let root: string
let baseDir: string
let stderrSpy: ReturnType<typeof spyOnStderr>

beforeEach(async () => {
  // baseDir nested two levels deep so `../../../` traversal from keys/
  // resolves INSIDE the disposable root — decoys stay observable.
  root = join(tmpdir(), `mrclean-janitor-${randomUUID()}`)
  baseDir = join(root, 'deep', 'base')
  await mkdir(statePaths(baseDir).keysDir, { recursive: true })
  await mkdir(statePaths(baseDir).sessionsDir, { recursive: true })
  stderrSpy = spyOnStderr()
})

afterEach(async () => {
  stderrSpy.mockRestore()
  // chmod-000 dirs must be re-opened before rm can descend into them.
  await chmod(statePaths(baseDir).sessionsDir, 0o700).catch(() => {})
  await chmod(statePaths(baseDir).keysDir, 0o700).catch(() => {})
  await rm(root, { recursive: true, force: true })
})

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Plant a raw key+map pair (deletion tests need bytes on disk, not crypto). */
async function plantPair(sid: string): Promise<{ keyPath: string; mapPath: string }> {
  const keyPath = keyPathFor(baseDir, sid)
  const mapPath = mapPathFor(baseDir, sid)
  await writeFile(keyPath, randomBytes(32))
  await writeFile(mapPath, randomBytes(64))
  return { keyPath, mapPath }
}

/** Set a file's mtime to `ageMs` in the past (deterministic TTL aging). */
async function backdate(path: string, ageMs: number): Promise<void> {
  const t = new Date(Date.now() - ageMs)
  await utimes(path, t, t)
}

/** stderr writes that carry the single-line JSON warn shape. */
function janitorWarnCalls(): string[] {
  return stderrSpy.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.includes('"warn"'))
}

// ---------------------------------------------------------------------------
// runSessionEndJanitor — D-06 reason allowlist + D-05 ordering + Pitfall 5
// ---------------------------------------------------------------------------

describe('runSessionEndJanitor — reason matrix (D-06 allowlist)', () => {
  it("retains BOTH key and map on reason 'resume' (the only allowlisted reason)", async () => {
    // Arrange
    const sid = randomUUID()
    const { keyPath, mapPath } = await plantPair(sid)

    // Act
    await runSessionEndJanitor(sid, 'resume', { baseDir })

    // Assert
    expect(await exists(keyPath)).toBe(true)
    expect(await exists(mapPath)).toBe(true)
  })

  it.each(DELETING_REASONS)('deletes key AND map on reason %s', async (reason) => {
    // Arrange
    const sid = randomUUID()
    const { keyPath, mapPath } = await plantPair(sid)

    // Act
    await runSessionEndJanitor(sid, reason, { baseDir })

    // Assert — fail-toward-privacy: everything outside the allowlist deletes
    expect(await exists(keyPath)).toBe(false)
    expect(await exists(mapPath)).toBe(false)
  })
})

describe('runSessionEndJanitor — key-first ordering + per-target isolation (D-05)', () => {
  it('deletes the KEY even when the MAP is undeletable; resolves with one warn', async () => {
    // Arrange — key is a normal file; the map path is a NON-EMPTY DIRECTORY
    // so unlink fails (EPERM/EISDIR). If deletion ran map-first (or one
    // failure aborted the run), the key would survive — this observable
    // proves key-before-map AND per-target error isolation.
    const sid = randomUUID()
    const keyPath = keyPathFor(baseDir, sid)
    const mapPath = mapPathFor(baseDir, sid)
    await writeFile(keyPath, randomBytes(32))
    await mkdir(mapPath)
    await writeFile(join(mapPath, 'blocker'), 'x')

    // Act — must resolve, never throw (total-error contract)
    await expect(runSessionEndJanitor(sid, 'clear', { baseDir })).resolves.toBeUndefined()

    // Assert — dead ciphertext needs no lock: the key is GONE
    expect(await exists(keyPath)).toBe(false)
    expect(await exists(mapPath)).toBe(true)

    // Exactly one warn (the stuck map), single-line JSON, hash-only fields —
    // never paths (paths embed the state layout) and never file contents.
    const warns = janitorWarnCalls()
    expect(warns).toHaveLength(1)
    const parsed = JSON.parse(warns[0]!.trimEnd()) as Record<string, unknown>
    expect(typeof parsed['warn']).toBe('string')
    expect(parsed['sessionId']).toBe(sid)
    expect(warns[0]).not.toContain(baseDir)
  })
})

describe('runSessionEndJanitor — invalid sid deletes NOTHING (Pitfall 5)', () => {
  it("traversal sid '../../../etc/foo' resolves without touching the traversal target", async () => {
    // Arrange — plant decoys exactly where a naively-joined path would land:
    // join(baseDir, 'keys', '../../../etc/foo.key') === root/etc/foo.key
    const decoyDir = join(root, 'etc')
    await mkdir(decoyDir, { recursive: true })
    const decoyKey = join(decoyDir, 'foo.key')
    const decoyMap = join(decoyDir, 'foo.map')
    await writeFile(decoyKey, 'decoy-key')
    await writeFile(decoyMap, 'decoy-map')

    // Act — a deleting reason, so only the sid gate stands between the
    // janitor and the decoys
    await expect(
      runSessionEndJanitor('../../../etc/foo', 'clear', { baseDir }),
    ).resolves.toBeUndefined()

    // Assert — the gate held: nothing outside baseDir was touched
    expect(await exists(decoyKey)).toBe(true)
    expect(await exists(decoyMap)).toBe(true)
  })

  it("synthetic sid 'mcp-server' resolves and deletes nothing, even inside baseDir", async () => {
    // Arrange — plant literal-name decoys INSIDE the state dirs
    const decoyKey = join(statePaths(baseDir).keysDir, 'mcp-server.key')
    const decoyMap = join(statePaths(baseDir).sessionsDir, 'mcp-server.map')
    await writeFile(decoyKey, 'decoy-key')
    await writeFile(decoyMap, 'decoy-map')

    // Act
    await expect(runSessionEndJanitor('mcp-server', 'clear', { baseDir })).resolves.toBeUndefined()

    // Assert — invalid sid means delete NOTHING (MCP-lane fence holds)
    expect(await exists(decoyKey)).toBe(true)
    expect(await exists(decoyMap)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// runTtlSweep — map-mtime aging (Pitfall 4), orphan grace, tmp litter,
// non-conforming names, missing/unreadable dirs
// ---------------------------------------------------------------------------

describe('runTtlSweep — paired sessions age by MAP mtime ONLY (Pitfall 4)', () => {
  it('LIVE SESSION SURVIVES: old key (48h) + fresh map with ttlHours 24', async () => {
    // Arrange — the key mtime never refreshes after creation; a live session
    // always has a fresh map. Aging by key mtime would delete this session.
    const sid = randomUUID()
    const { keyPath, mapPath } = await plantPair(sid)
    await backdate(keyPath, 48 * HOUR_MS)

    // Act
    await runTtlSweep({ ttlHours: 24, baseDir })

    // Assert — THE load-bearing case: both halves survive
    expect(await exists(keyPath)).toBe(true)
    expect(await exists(mapPath)).toBe(true)
  })

  it('stale pair deleted: map 25h old with ttlHours 24 (fresh key cannot save it)', async () => {
    // Arrange — key stays fresh: proves the decision reads the MAP mtime
    const sid = randomUUID()
    const { keyPath, mapPath } = await plantPair(sid)
    await backdate(mapPath, 25 * HOUR_MS)

    // Act
    await runTtlSweep({ ttlHours: 24, baseDir })

    // Assert
    expect(await exists(keyPath)).toBe(false)
    expect(await exists(mapPath)).toBe(false)
  })

  it('ttlHours knob respected: 25h-old map SURVIVES with ttlHours 48', async () => {
    // Arrange
    const sid = randomUUID()
    const { keyPath, mapPath } = await plantPair(sid)
    await backdate(mapPath, 25 * HOUR_MS)

    // Act
    await runTtlSweep({ ttlHours: 48, baseDir })

    // Assert
    expect(await exists(keyPath)).toBe(true)
    expect(await exists(mapPath)).toBe(true)
  })
})

describe('runTtlSweep — unpaired halves against the 60s orphan grace', () => {
  it('orphan map (no key) 30s old survives the grace window', async () => {
    // Arrange — inside grace: covers the first-allocation race window
    const sid = randomUUID()
    const mapPath = mapPathFor(baseDir, sid)
    await writeFile(mapPath, randomBytes(64))
    await backdate(mapPath, 30 * SECOND_MS)

    // Act
    await runTtlSweep({ ttlHours: 24, baseDir })

    // Assert
    expect(await exists(mapPath)).toBe(true)
  })

  it('orphan map (no key) 120s old is deleted', async () => {
    // Arrange
    const sid = randomUUID()
    const mapPath = mapPathFor(baseDir, sid)
    await writeFile(mapPath, randomBytes(64))
    await backdate(mapPath, 120 * SECOND_MS)

    // Act
    await runTtlSweep({ ttlHours: 24, baseDir })

    // Assert — a map without its key is undecryptable dead weight
    expect(await exists(mapPath)).toBe(false)
  })

  it('orphan key (no map) 30s old survives the grace window', async () => {
    // Arrange
    const sid = randomUUID()
    const keyPath = keyPathFor(baseDir, sid)
    await writeFile(keyPath, randomBytes(32))
    await backdate(keyPath, 30 * SECOND_MS)

    // Act
    await runTtlSweep({ ttlHours: 24, baseDir })

    // Assert
    expect(await exists(keyPath)).toBe(true)
  })

  it('orphan key (no map) 120s old is deleted', async () => {
    // Arrange
    const sid = randomUUID()
    const keyPath = keyPathFor(baseDir, sid)
    await writeFile(keyPath, randomBytes(32))
    await backdate(keyPath, 120 * SECOND_MS)

    // Act
    await runTtlSweep({ ttlHours: 24, baseDir })

    // Assert
    expect(await exists(keyPath)).toBe(false)
  })

  it('exports ORPHAN_GRACE_MS = 60s (the pinned first-allocation race cover)', () => {
    expect(ORPHAN_GRACE_MS).toBe(60_000)
  })
})

describe('runTtlSweep — stale sessions/*.tmp litter', () => {
  it('tmp file 120s old is deleted', async () => {
    // Arrange — crashed atomic-write litter
    const tmpPath = join(statePaths(baseDir).sessionsDir, 'partial-write.tmp')
    await writeFile(tmpPath, randomBytes(16))
    await backdate(tmpPath, 120 * SECOND_MS)

    // Act
    await runTtlSweep({ ttlHours: 24, baseDir })

    // Assert
    expect(await exists(tmpPath)).toBe(false)
  })

  it('tmp file 10s old survives (an in-flight atomic write is not litter)', async () => {
    // Arrange
    const tmpPath = join(statePaths(baseDir).sessionsDir, 'in-flight.tmp')
    await writeFile(tmpPath, randomBytes(16))
    await backdate(tmpPath, 10 * SECOND_MS)

    // Act
    await runTtlSweep({ ttlHours: 24, baseDir })

    // Assert
    expect(await exists(tmpPath)).toBe(true)
  })
})

describe('runTtlSweep — never delete what we did not create (T-09-06-06)', () => {
  it('non-conforming filenames survive no matter how old they are', async () => {
    // Arrange — WAY past every threshold; only name-shape protects them
    const uuid = randomUUID()
    const { keysDir, sessionsDir } = statePaths(baseDir)
    const foreign = [
      join(sessionsDir, 'README.md'),
      join(sessionsDir, 'notauuid.map'),
      join(sessionsDir, `${uuid}.map.bak`),
      join(keysDir, 'README.md'),
      join(keysDir, 'notauuid.key'),
    ]
    for (const path of foreign) {
      await writeFile(path, 'foreign-content')
      await backdate(path, 100 * HOUR_MS)
    }

    // Act
    await runTtlSweep({ ttlHours: 24, baseDir })

    // Assert — none of them were ours to touch
    for (const path of foreign) {
      expect(await exists(path)).toBe(true)
    }
  })
})

describe('runTtlSweep — missing / unreadable dirs are total (D-07/D-08)', () => {
  it('missing keys/ AND sessions/ dirs resolve silently (no warns)', async () => {
    // Arrange — a base dir that was never initialized
    const emptyBase = join(root, 'never-initialized')

    // Act + Assert — resolves, no throw, no stderr noise
    await expect(runTtlSweep({ ttlHours: 24, baseDir: emptyBase })).resolves.toBeUndefined()
    expect(janitorWarnCalls()).toHaveLength(0)
  })

  it('missing keys/ dir (sessions/ present) resolves silently and sweeps nothing', async () => {
    // Arrange — without key-side visibility, map classification is unsound:
    // the pinned contract is "missing dirs => return", so even an old orphan
    // map survives this degenerate layout.
    const sid = randomUUID()
    const mapPath = mapPathFor(baseDir, sid)
    await writeFile(mapPath, randomBytes(64))
    await backdate(mapPath, 120 * SECOND_MS)
    await rm(statePaths(baseDir).keysDir, { recursive: true, force: true })

    // Act
    await expect(runTtlSweep({ ttlHours: 24, baseDir })).resolves.toBeUndefined()

    // Assert
    expect(await exists(mapPath)).toBe(true)
    expect(janitorWarnCalls()).toHaveLength(0)
  })

  it.skipIf(IS_WIN32 || IS_ROOT)(
    'unreadable sessions/ dir (chmod 000) resolves with a warn and deletes NOTHING',
    async () => {
      // Arrange — an old orphan key is the canary: if the sweep wrongly
      // trusted "no maps visible" it would delete this key out from under a
      // possibly-live session.
      const sid = randomUUID()
      const keyPath = keyPathFor(baseDir, sid)
      await writeFile(keyPath, randomBytes(32))
      await backdate(keyPath, 120 * SECOND_MS)
      await chmod(statePaths(baseDir).sessionsDir, 0o000)

      // Act — must resolve, never throw
      await expect(runTtlSweep({ ttlHours: 24, baseDir })).resolves.toBeUndefined()

      // Assert — warned once, bailed, canary key survived
      await chmod(statePaths(baseDir).sessionsDir, 0o700)
      expect(janitorWarnCalls().length).toBeGreaterThanOrEqual(1)
      expect(await exists(keyPath)).toBe(true)
    },
  )
})
