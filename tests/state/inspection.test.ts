/**
 * SC1 operator dir-inspection as a LITERAL test (Plan 09-08).
 *
 * CONTEXT §Specific Ideas frames SC1 as a real acceptance test: after a
 * reversible session, `ls -la ~/.mrclean/sessions/` shows ciphertext-only
 * files (including any temp files mid-write), keys live in the separate
 * 0700 ~/.mrclean/keys/, and NOTHING state-related sits inside the project
 * tree. This suite literally performs that inspection against a real
 * two-event facade flow:
 *
 *   event 1: hydrate (absent ⇒ fresh) → allocate a WORD original → persist
 *   event 2: hydrate (REAL map now)  → allocate an AWS_KEY original → persist
 *
 * then readdir/stat/byte-scans the state tree:
 *   - sessions/ holds ONLY <sid>.map — zero `<sid>.map.<digits>` tmp residue
 *     (write-file-atomic v7 naming; its signal-exit cleanup ran)
 *   - every state file's raw bytes lack both planted originals and the
 *     '"entries"' JSON marker (ciphertext-only, T-09-08-03)
 *   - keys/ holds ONLY <sid>.key — key and ciphertext in DIFFERENT dirs (D-04)
 *   - POSIX modes: dirs 0700, files 0600 (win32 skip — modes advisory-only
 *     there, Pitfall 8 documented gap)
 *   - a recursive scan of process.cwd() finds NO .mrclean/keys or
 *     .mrclean/sessions dirs — nothing inside the project tree (SC1 clause 3)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  persistAllocations,
  readSessionMapForHydration,
} from '../../src/state/index.js'
import { POST_LOCK_DEADLINE_MS } from '../../src/state/lock.js'
import {
  keyPathFor,
  mapPathFor,
  readSessionMapFile,
  statePaths,
} from '../../src/state/map-store.js'
import { hmacAddress } from '../../src/state/session-map.js'
import { PlaceholderManager } from '../../src/placeholder/manager.js'

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

/** win32 modes are advisory-only — POSIX-only mode assertions (Pitfall 8). */
const IS_WIN32 = process.platform === 'win32'

/** Restorable original — persisted WITH `original`, still never raw on disk. */
const WORD_ORIGINAL = 'inspect-word-original-alpha'
/** Secret-class original — never persisted at all (D-11 floor). */
const SECRET_ORIGINAL = 'AKIAIOSFODNN7INSPECT'

/** Directories the project-tree scan never descends into (speed, not scope). */
const SCAN_SKIP = new Set(['node_modules', '.git', 'dist', 'coverage'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** One facade event: hydrate → fresh manager → allocate ONE value → persist. */
async function runReversibleEvent(
  baseDir: string,
  sid: string,
  value: string,
  type: string,
): Promise<{ counterFloor: number; knownEntries: number }> {
  const hydration = await readSessionMapForHydration({ sessionId: sid, baseDir })
  expect(hydration).not.toBeNull()
  const manager = new PlaceholderManager({ sessionId: sid })
  manager.hydrateReversible(hydration!)
  manager.allocate(value, type)
  const pending = manager.drainPendingAllocations()
  const persisted = await persistAllocations({
    sessionId: sid,
    baseDir,
    pending,
    deadlineMs: POST_LOCK_DEADLINE_MS,
  })
  expect(persisted.status).toBe('ok')
  return { counterFloor: hydration!.counterFloor, knownEntries: hydration!.entriesByHmac.size }
}

/**
 * Recursively collect every `.mrclean/keys` or `.mrclean/sessions` directory
 * under `root` (skipping SCAN_SKIP subtrees for speed — state dirs could
 * never legitimately live there either).
 */
async function findStateDirsUnder(root: string): Promise<string[]> {
  const found: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable subtree — nothing state-related to find
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SCAN_SKIP.has(entry.name)) {
        continue
      }
      const path = join(dir, entry.name)
      if (entry.name === '.mrclean') {
        let inner: string[]
        try {
          inner = await readdir(path)
        } catch {
          continue
        }
        for (const name of inner) {
          if (name === 'keys' || name === 'sessions') {
            found.push(join(path, name))
          }
        }
        continue
      }
      await walk(path)
    }
  }
  await walk(root)
  return found
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SC1 operator inspection (literal dir inspection after a real flow)', () => {
  let baseDir: string
  let sid: string

  beforeEach(async () => {
    baseDir = join(tmpdir(), `mrclean-inspect-${randomUUID()}`)
    sid = randomUUID()
    await mkdir(baseDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('two-event reversible flow leaves ciphertext-only sessions/, separate keys/, correct modes, nothing in the project tree', async () => {
    // Arrange + Act — the real two-event flow (facade-level, baseDir injected)
    const first = await runReversibleEvent(baseDir, sid, WORD_ORIGINAL, 'WORD')
    const second = await runReversibleEvent(baseDir, sid, SECRET_ORIGINAL, 'AWS_KEY')

    // Sanity — event 2 hydrated from event 1's REAL persisted state (the
    // inspection below is not probing an empty store).
    expect(first.knownEntries).toBe(0)
    expect(second.counterFloor).toBe(1)
    expect(second.knownEntries).toBe(1)

    const { keysDir, sessionsDir } = statePaths(baseDir)

    // Assert — sessions/ holds ONLY <sid>.map: no `<sid>.map.<digits>` tmp
    // residue (wfa v7 naming), no strays.
    const sessionFiles = await readdir(sessionsDir)
    expect(sessionFiles).toEqual([`${sid}.map`])

    // Assert — keys/ holds ONLY <sid>.key (separate dir from ciphertext, D-04).
    const keyFiles = await readdir(keysDir)
    expect(keyFiles).toEqual([`${sid}.key`])

    // Assert — ciphertext-only bytes in EVERY state file: neither planted
    // original nor the '"entries"' JSON marker is readable on disk.
    for (const path of [
      ...sessionFiles.map((name) => join(sessionsDir, name)),
      ...keyFiles.map((name) => join(keysDir, name)),
    ]) {
      const raw = await readFile(path)
      expect(raw.includes(WORD_ORIGINAL)).toBe(false)
      expect(raw.includes(SECRET_ORIGINAL)).toBe(false)
      expect(raw.includes('"entries"')).toBe(false)
    }

    // Assert — POSIX permission story: 0700 dirs, 0600 files (win32 skipped
    // below via the dedicated case; here the whole block is POSIX-gated).
    if (!IS_WIN32) {
      expect((await stat(keysDir)).mode & 0o777).toBe(0o700)
      expect((await stat(sessionsDir)).mode & 0o777).toBe(0o700)
      expect((await stat(keyPathFor(baseDir, sid))).mode & 0o777).toBe(0o600)
      expect((await stat(mapPathFor(baseDir, sid))).mode & 0o777).toBe(0o600)
    }

    // Assert — NOTHING state-related inside the project tree (SC1 clause 3):
    // the flow above used baseDir injection; a recursive scan of the actual
    // process.cwd() must find zero .mrclean/keys|sessions dirs.
    const projectStateDirs = await findStateDirsUnder(process.cwd())
    expect(projectStateDirs).toEqual([])

    // Assert — the store still ROUND-TRIPS (inspection proved opacity, not
    // breakage): decrypt shows both entries, secret floor intact (SC3 shape).
    const map = await readSessionMapFile(baseDir, sid)
    expect(map).not.toBeNull()
    expect(Object.keys(map!.entries)).toHaveLength(2)
    const wordEntry = map!.entries[hmacAddress(map!.hashSalt, WORD_ORIGINAL)]
    const secretEntry = map!.entries[hmacAddress(map!.hashSalt, SECRET_ORIGINAL)]
    expect(wordEntry).toBeDefined()
    expect(secretEntry).toBeDefined()
    const word = wordEntry!
    const secret = secretEntry!
    expect('original' in word ? word.original : undefined).toBe(WORD_ORIGINAL)
    expect('original' in secret).toBe(false)
  })

  it.skipIf(!IS_WIN32)('win32 documented gap: mode assertions skipped (advisory-only modes — Pitfall 8)', () => {
    // Placeholder case so the win32 skip is VISIBLE in reporter output
    // rather than silently absent (documented-gap comment precedent).
    expect(IS_WIN32).toBe(true)
  })
})
