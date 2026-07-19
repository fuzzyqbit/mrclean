/**
 * REVMODE-04 unit proof: the locked allocate-and-persist transaction (09-05).
 *
 * src/state/index.ts is the facade — the ONLY entry point handlers use. This
 * suite drives the REAL PlaceholderManager (hydrate → allocate → drain) against
 * the real store through full simulated-process cycles and pins:
 *
 *   - fresh-session persist creates key AND map inside ONE locked transaction
 *     (first-allocation window closed — D-05 / RESEARCH Pattern 6 /
 *     T-09-05-06), with the D-11 secret floor visible in the decrypted store
 *   - cross-process identity: a second hydration cycle resolves the same
 *     original to the IDENTICAL placeholder with a noop persist (REVMODE-04)
 *   - reconcile foreign-win: a provisional allocation that loses the race
 *     adopts the store's placeholder via a rename — never burns a counter
 *   - reconcile renumber: provisional counters colliding with foreign entries
 *     land on fresh NNN values — no duplicates, zero loss
 *   - deadline degrade: a held lock yields status 'degraded', leaves the map
 *     byte-identical, and warns EXACTLY once with no raw values (T-09-05-05)
 *   - noop shortcut: empty pending never takes the lock or touches the fs
 *   - the sid gate: invalid session ids ('mcp-server', traversal strings)
 *     make reversible unavailable with ZERO filesystem paths touched
 *     (Pitfall 5 / T-09-05-01 — the MCP-lane fence is structural)
 *   - corrupt-map recovery: hydration returns FRESH provisional state (never
 *     null, never a throw — Pitfall 6) and the next persist replaces the
 *     corrupt file with a valid envelope
 *   - rename helpers: exact text substitution + immutable deep walks
 *
 * All fs cases run against a per-test tmpdir baseDir — never the real
 * ~/.mrclean (injection precedent: LoadConfigOpts.homeDir).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'

import {
  applyRenamesDeep,
  applyRenamesToText,
  isValidSessionId,
  persistAllocations,
  readSessionMapForHydration,
} from '../../src/state/index.js'
import { LOCK_OPTS } from '../../src/state/lock.js'
import {
  ensureSessionKey,
  keyPathFor,
  mapPathFor,
  readSessionMapFile,
  statePaths,
  writeSessionMapFile,
} from '../../src/state/map-store.js'
import {
  createEmptySessionMap,
  formatV2Token,
  hmacAddress,
  makeMapEntry,
  type PendingAllocation,
  type PlaceholderRename,
  type RestorableMapEntry,
  type SessionMapV1,
} from '../../src/state/session-map.js'
import { PlaceholderManager } from '../../src/placeholder/manager.js'

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

/** Fixed valid (UUID-shaped) session id — passes the facade's strict gate. */
const SID = '11111111-2222-4333-8444-555555555555'
/** PostToolUse-class deadline used by every non-degrade persist below. */
const DEADLINE_MS = 100
/** Restorable original — its value MUST appear in the decrypted WORD entry. */
const WORD_ORIGINAL = 'val-A'
/** Secret-class original — its value must NEVER be persisted (D-11 floor). */
const SECRET_ORIGINAL = 'sk-secret'

/** Hand-built pending allocation for facade-level cases without a manager. */
function pendingFixture(value: string): PendingAllocation {
  return { value, type: 'WORD', provisionalPlaceholder: '<MRCLEAN:WORD:001:aabbccdd>' }
}

/** Run one hydrate→allocate cycle against the real manager; return its parts. */
async function hydrateAndAllocate(
  baseDir: string,
  values: ReadonlyArray<{ value: string; type: string }>,
): Promise<{ manager: PlaceholderManager; provisionals: string[]; pending: PendingAllocation[] }> {
  const hydration = await readSessionMapForHydration({ sessionId: SID, baseDir })
  expect(hydration).not.toBeNull()
  const manager = new PlaceholderManager({ sessionId: SID })
  manager.hydrateReversible(hydration!)
  const provisionals = values.map(({ value, type }) => manager.allocate(value, type).placeholder)
  return { manager, provisionals, pending: manager.drainPendingAllocations() }
}

/** Seed the store directly (simulating a foreign process's committed write). */
async function seedStore(
  baseDir: string,
  entries: ReadonlyArray<{ value: string; type: string; counter: number }>,
): Promise<{ map: SessionMapV1; tokens: string[] }> {
  const key = await ensureSessionKey(baseDir, SID)
  const base = createEmptySessionMap(SID)
  const tokens: string[] = []
  const record: SessionMapV1['entries'] = {}
  let counter = 0
  for (const { value, type, counter: n } of entries) {
    const token = formatV2Token(type, n, base.nonce8)
    tokens.push(token)
    record[hmacAddress(base.hashSalt, value)] = makeMapEntry(type, token, n, value)
    counter = Math.max(counter, n)
  }
  const map: SessionMapV1 = { ...base, counter, entries: record }
  await writeSessionMapFile(baseDir, SID, map, key)
  return { map, tokens }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('allocation facade (readSessionMapForHydration + persistAllocations)', () => {
  let baseDir: string

  beforeEach(async () => {
    // Arrange (shared): isolated per-test baseDir — never the real ~/.mrclean
    baseDir = join(tmpdir(), `mrclean-alloc-${randomUUID()}`)
    await mkdir(baseDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // Fresh session: first locked transaction creates key AND map (T-09-05-06)
  // -------------------------------------------------------------------------

  it('persists a fresh session: key + map in one transaction, secret floor intact', async () => {
    // Arrange + Act — full first cycle: hydrate (absent → provisional),
    // allocate one restorable + one secret-class value, drain, persist
    const { provisionals, pending } = await hydrateAndAllocate(baseDir, [
      { value: WORD_ORIGINAL, type: 'WORD' },
      { value: SECRET_ORIGINAL, type: 'AWS_KEY' },
    ])
    expect(pending).toHaveLength(2)
    const result = await persistAllocations({
      sessionId: SID,
      baseDir,
      pending,
      deadlineMs: DEADLINE_MS,
    })

    // Assert — transaction succeeded; BOTH files exist after the first
    // transaction (first-allocation window closed before release)
    expect(result.status).toBe('ok')
    expect((await stat(keyPathFor(baseDir, SID))).isFile()).toBe(true)
    expect((await stat(mapPathFor(baseDir, SID))).isFile()).toBe(true)

    // Assert — decrypted store: 2 entries, counter 2, floor semantics
    const map = await readSessionMapFile(baseDir, SID)
    expect(map).not.toBeNull()
    expect(map!.counter).toBe(2)
    expect(Object.keys(map!.entries)).toHaveLength(2)

    const wordEntry = map!.entries[hmacAddress(map!.hashSalt, WORD_ORIGINAL)]!
    expect(wordEntry.type).toBe('WORD')
    expect((wordEntry as RestorableMapEntry).original).toBe(WORD_ORIGINAL)

    const secretEntry = map!.entries[hmacAddress(map!.hashSalt, SECRET_ORIGINAL)]!
    expect(secretEntry.type).toBe('AWS_KEY')
    expect('original' in secretEntry).toBe(false)

    // Assert — renames correct the manager's substituted text exactly: each
    // provisional token maps onto the store's final placeholder (renames are
    // [] only in the astronomically-unlikely nonce-collision case)
    expect(applyRenamesToText(provisionals[0]!, result.renames)).toBe(wordEntry.placeholder)
    expect(applyRenamesToText(provisionals[1]!, result.renames)).toBe(secretEntry.placeholder)
  })

  // -------------------------------------------------------------------------
  // Cross-process identity (REVMODE-04 core)
  // -------------------------------------------------------------------------

  it('resolves the same original to the identical placeholder across two cycles', async () => {
    // Arrange — cycle 1 (process A) persists WORD_ORIGINAL
    const cycleA = await hydrateAndAllocate(baseDir, [{ value: WORD_ORIGINAL, type: 'WORD' }])
    const resA = await persistAllocations({
      sessionId: SID,
      baseDir,
      pending: cycleA.pending,
      deadlineMs: DEADLINE_MS,
    })
    expect(resA.status).toBe('ok')
    const stored = await readSessionMapFile(baseDir, SID)
    const storedPlaceholder = stored!.entries[hmacAddress(stored!.hashSalt, WORD_ORIGINAL)]!
      .placeholder

    // Act — cycle 2 (process B): fresh manager, fresh hydration read
    const hydrationB = await readSessionMapForHydration({ sessionId: SID, baseDir })
    const managerB = new PlaceholderManager({ sessionId: SID })
    managerB.hydrateReversible(hydrationB!)
    const entryB = managerB.allocate(WORD_ORIGINAL, 'WORD')
    const pendingB = managerB.drainPendingAllocations()
    const resB = await persistAllocations({
      sessionId: SID,
      baseDir,
      pending: pendingB,
      deadlineMs: DEADLINE_MS,
    })

    // Assert — store hit at hydrate (entriesByHmac seeded): identical
    // placeholder, nothing pending, persist noops without taking the lock
    expect(entryB.placeholder).toBe(storedPlaceholder)
    expect(pendingB).toHaveLength(0)
    expect(resB.status).toBe('noop')
    expect(resB.renames).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Reconcile: foreign allocation wins (never burn a counter)
  // -------------------------------------------------------------------------

  it('adopts a foreign allocation for the same original via a rename', async () => {
    // Arrange — process B hydrates while the map is ABSENT (provisional
    // nonce/salt) and allocates WORD_ORIGINAL provisionally at :001:
    const cycleB = await hydrateAndAllocate(baseDir, [{ value: WORD_ORIGINAL, type: 'WORD' }])
    const provisional = cycleB.provisionals[0]!

    // Arrange — meanwhile a foreign process commits WORD_ORIGINAL at :001:
    // with the STORE's nonce (direct map-store write)
    const { tokens } = await seedStore(baseDir, [
      { value: WORD_ORIGINAL, type: 'WORD', counter: 1 },
    ])
    const storeToken = tokens[0]!

    // Act — B persists its provisional allocation
    const result = await persistAllocations({
      sessionId: SID,
      baseDir,
      pending: cycleB.pending,
      deadlineMs: DEADLINE_MS,
    })

    // Assert — foreign allocation wins: rename from provisional to the store
    // token; still ONE entry; counter unchanged (no counter burned)
    expect(result.status).toBe('ok')
    expect(applyRenamesToText(provisional, result.renames)).toBe(storeToken)
    expect(result.renames).toEqual(
      provisional === storeToken ? [] : [{ from: provisional, to: storeToken }],
    )
    const final = await readSessionMapFile(baseDir, SID)
    expect(Object.keys(final!.entries)).toHaveLength(1)
    expect(final!.counter).toBe(1)
    expect(final!.entries[hmacAddress(final!.hashSalt, WORD_ORIGINAL)]!.placeholder).toBe(
      storeToken,
    )
  })

  // -------------------------------------------------------------------------
  // Reconcile: counter renumber (no NNN duplicates, zero loss)
  // -------------------------------------------------------------------------

  it('renumbers a provisional counter that collided with a foreign entry', async () => {
    // Arrange — B hydrates before ANY store write (counterFloor 0) and
    // allocates 'val-C' provisionally at :001:
    const cycleB = await hydrateAndAllocate(baseDir, [{ value: 'val-C', type: 'WORD' }])
    const provisional = cycleB.provisionals[0]!
    expect(provisional).toContain(':001:')

    // Arrange — a foreign write lands: 'val-B' owns counter 1 in the store
    const { map: seeded } = await seedStore(baseDir, [
      { value: 'val-B', type: 'WORD', counter: 1 },
    ])

    // Act — B persists; 'val-C' misses in the store and must renumber
    const result = await persistAllocations({
      sessionId: SID,
      baseDir,
      pending: cycleB.pending,
      deadlineMs: DEADLINE_MS,
    })

    // Assert — 'val-C' landed at :002: with a rename; both entries present;
    // counter advanced to 2; NNN values are duplicate-free
    expect(result.status).toBe('ok')
    const final = await readSessionMapFile(baseDir, SID)
    const finalC = final!.entries[hmacAddress(final!.hashSalt, 'val-C')]!
    const expectedC = formatV2Token('WORD', 2, final!.nonce8)
    expect(finalC.placeholder).toBe(expectedC)
    expect(finalC.counter).toBe(2)
    expect(final!.counter).toBe(2)
    expect(Object.keys(final!.entries)).toHaveLength(2)
    expect(final!.nonce8).toBe(seeded.nonce8)
    // Deterministic rename: provisional was :001:<provNonce>, final is :002:<storeNonce>
    expect(result.renames).toEqual([{ from: provisional, to: expectedC }])
    const counters = Object.values(final!.entries).map((entry) => entry.counter)
    expect(new Set(counters).size).toBe(counters.length)
  })

  // -------------------------------------------------------------------------
  // Reconcile: rename CHAIN (CR-01 regression — renames apply in ONE
  // simultaneous pass; sequential application cascades and corrupts identity)
  // -------------------------------------------------------------------------

  it('applies a reconcile rename chain without cascading: two allocations + one foreign insertion land on DISTINCT store tokens', async () => {
    // Arrange — a committed store at counter 5, so B's provisionals share the
    // STORE nonce (a chain needs rename i's `to` === rename i+1's `from`,
    // which requires hydration from the REAL map)
    await seedStore(baseDir, [{ value: 'val-SEED', type: 'WORD', counter: 5 }])

    // Arrange — process B hydrates (floor 5) and allocates TWO new values:
    // provisionals :006: and :007: under the store nonce
    const cycleB = await hydrateAndAllocate(baseDir, [
      { value: 'val-Y', type: 'WORD' },
      { value: 'val-Z', type: 'WORD' },
    ])
    expect(cycleB.provisionals[0]).toContain(':006:')
    expect(cycleB.provisionals[1]).toContain(':007:')
    const substituted = `y=${cycleB.provisionals[0]} z=${cycleB.provisionals[1]}`

    // Arrange — between B's hydrate and persist, a concurrent process commits
    // ONE allocation: val-FOREIGN takes :006: and advances the store counter
    const cycleF = await hydrateAndAllocate(baseDir, [{ value: 'val-FOREIGN', type: 'WORD' }])
    const persistedF = await persistAllocations({
      sessionId: SID,
      baseDir,
      pending: cycleF.pending,
      deadlineMs: DEADLINE_MS,
    })
    expect(persistedF.status).toBe('ok')

    // Act — B persists; reconcile renumbers BOTH pendings, emitting the chain
    // [{ :006:→:007: }, { :007:→:008: }], then B corrects its substituted text
    const result = await persistAllocations({
      sessionId: SID,
      baseDir,
      pending: cycleB.pending,
      deadlineMs: DEADLINE_MS,
    })
    expect(result.status).toBe('ok')
    expect(result.renames).toHaveLength(2)
    const corrected = applyRenamesToText(substituted, result.renames)

    // Assert — each emitted token equals the STORE's authoritative
    // placeholder for its original, and the two finals are DISTINCT (PH-03).
    // Sequential split/join application would cascade :006:→:007:→:008: and
    // emit :008: for BOTH values (duplicate on-wire token + wrong-value
    // restore in Phase 10 — the CR-01 defect).
    const final = await readSessionMapFile(baseDir, SID)
    const tokenY = final!.entries[hmacAddress(final!.hashSalt, 'val-Y')]!.placeholder
    const tokenZ = final!.entries[hmacAddress(final!.hashSalt, 'val-Z')]!.placeholder
    expect(tokenY).not.toBe(tokenZ)
    expect(corrected).toBe(`y=${tokenY} z=${tokenZ}`)
  })

  // -------------------------------------------------------------------------
  // Deadline degrade: held lock ⇒ 'degraded', map untouched, ONE hash-only warn
  // -------------------------------------------------------------------------

  it("returns 'degraded' with one hash-only warn when the lock deadline exhausts", async () => {
    // Arrange — a committed store state, then hold the lock externally
    // (simulating another process stuck mid-transaction)
    await seedStore(baseDir, [{ value: WORD_ORIGINAL, type: 'WORD', counter: 1 }])
    const bytesBefore = await readFile(mapPathFor(baseDir, SID))
    const release = await lockfile.lock(mapPathFor(baseDir, SID), LOCK_OPTS)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      // Act
      const result = await persistAllocations({
        sessionId: SID,
        baseDir,
        pending: [pendingFixture('val-NEW')],
        deadlineMs: 60,
      })

      // Assert — degraded, nothing written, never a throw
      expect(result.status).toBe('degraded')
      expect(result.renames).toEqual([])
      const bytesAfter = await readFile(mapPathFor(baseDir, SID))
      expect(bytesAfter.equals(bytesBefore)).toBe(true)

      // Assert — exactly ONE single-line JSON warn: sessionId, no raw values
      expect(stderrSpy).toHaveBeenCalledOnce()
      const warnLine = (stderrSpy.mock.calls[0]![0] as string).trimEnd()
      expect(warnLine).not.toContain('\n')
      const warn = JSON.parse(warnLine) as Record<string, unknown>
      expect(warn['sessionId']).toBe(SID)
      expect(warnLine).not.toContain('val-NEW')
    } finally {
      stderrSpy.mockRestore()
      await release()
    }
  })

  // -------------------------------------------------------------------------
  // Noop shortcut: empty pending never takes the lock or touches the fs
  // -------------------------------------------------------------------------

  it('noops on empty pending without creating any lock or state artifacts', async () => {
    // Act
    const result = await persistAllocations({
      sessionId: SID,
      baseDir,
      pending: [],
      deadlineMs: DEADLINE_MS,
    })

    // Assert — noop result and a COMPLETELY untouched baseDir (no keys/,
    // no sessions/, no .lock dirs)
    expect(result.status).toBe('noop')
    expect(result.renames).toEqual([])
    await expect(readdir(baseDir)).resolves.toEqual([])
  })

  // -------------------------------------------------------------------------
  // sid gate: invalid ids make reversible unavailable, ZERO fs paths touched
  // -------------------------------------------------------------------------

  it('rejects invalid session ids with no filesystem side effects', async () => {
    // Arrange — synthetic, path-traversal and test-fixture sids all fail the
    // strict UUID allowlist (Pitfall 5: never sanitize-by-transform)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const invalidSids = ['mcp-server', '../../../etc/foo', 'test-session']
    expect(isValidSessionId(SID)).toBe(true)

    try {
      for (const badSid of invalidSids) {
        // Act
        expect(isValidSessionId(badSid)).toBe(false)
        const hydration = await readSessionMapForHydration({ sessionId: badSid, baseDir })
        const persisted = await persistAllocations({
          sessionId: badSid,
          baseDir,
          pending: [pendingFixture('val-X')],
          deadlineMs: DEADLINE_MS,
        })

        // Assert — reversible unavailable: null hydration + noop persist
        expect(hydration).toBeNull()
        expect(persisted.status).toBe('noop')
        expect(persisted.renames).toEqual([])
      }

      // Assert — the gate fired BEFORE any path join: baseDir has no keys/
      // or sessions/ children at all
      await expect(readdir(baseDir)).resolves.toEqual([])

      // Assert — warns never echo hostile sids (no traversal strings, no
      // raw values in stderr — hash-only discipline)
      const allWarnOutput = stderrSpy.mock.calls.map((call) => String(call[0])).join('')
      expect(allWarnOutput).not.toContain('../../../etc/foo')
      expect(allWarnOutput).not.toContain('val-X')
    } finally {
      stderrSpy.mockRestore()
    }
  })

  // -------------------------------------------------------------------------
  // Corrupt map at hydrate: FRESH provisional (never null), persist repairs
  // -------------------------------------------------------------------------

  it('recovers from a corrupt map: fresh provisional hydration, persist replaces it', async () => {
    // Arrange — key exists, but the map file is garbage bytes
    await ensureSessionKey(baseDir, SID)
    await mkdir(statePaths(baseDir).sessionsDir, { recursive: true, mode: 0o700 })
    await writeFile(mapPathFor(baseDir, SID), Buffer.from('garbage-not-an-envelope'))

    // Act — hydration must be a FRESH provisional (reversible continues), not null
    const hydration = await readSessionMapForHydration({ sessionId: SID, baseDir })

    // Assert — provisional shape: empty entries, counter floor 0
    expect(hydration).not.toBeNull()
    expect(hydration!.counterFloor).toBe(0)
    expect(hydration!.entriesByHmac.size).toBe(0)

    // Act — a full cycle against the provisional state persists successfully
    const manager = new PlaceholderManager({ sessionId: SID })
    manager.hydrateReversible(hydration!)
    manager.allocate(WORD_ORIGINAL, 'WORD')
    const result = await persistAllocations({
      sessionId: SID,
      baseDir,
      pending: manager.drainPendingAllocations(),
      deadlineMs: DEADLINE_MS,
    })

    // Assert — the corrupt file was REPLACED with a valid envelope
    expect(result.status).toBe('ok')
    const repaired = await readSessionMapFile(baseDir, SID)
    expect(repaired).not.toBeNull()
    expect(repaired!.counter).toBe(1)
    expect(Object.keys(repaired!.entries)).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // Rename helpers
  // -------------------------------------------------------------------------

  it('applyRenamesToText replaces every occurrence of each from-token exactly', () => {
    // Arrange — bracketed tokens are overlap-free by construction
    const renames: PlaceholderRename[] = [
      { from: '<MRCLEAN:WORD:001:aaaaaaaa>', to: '<MRCLEAN:WORD:001:bbbbbbbb>' },
      { from: '<MRCLEAN:WORD:002:aaaaaaaa>', to: '<MRCLEAN:WORD:005:bbbbbbbb>' },
    ]
    const text =
      'x <MRCLEAN:WORD:001:aaaaaaaa> mid <MRCLEAN:WORD:002:aaaaaaaa> ' +
      'again <MRCLEAN:WORD:001:aaaaaaaa> end'

    // Act
    const renamed = applyRenamesToText(text, renames)

    // Assert — every occurrence rewritten, surrounding text untouched
    expect(renamed).toBe(
      'x <MRCLEAN:WORD:001:bbbbbbbb> mid <MRCLEAN:WORD:005:bbbbbbbb> ' +
        'again <MRCLEAN:WORD:001:bbbbbbbb> end',
    )
    // Empty rename list is the identity
    expect(applyRenamesToText(text, [])).toBe(text)
  })

  it('applyRenamesToText applies a chained rename set in ONE simultaneous pass (CR-01: a rename output is never re-matched)', () => {
    // Arrange — the CR-01 chain shape: renames[0].to === renames[1].from
    // (routine reconcile output when >= 2 allocations renumber together)
    const renames: PlaceholderRename[] = [
      { from: '<MRCLEAN:WORD:006:939ff7d7>', to: '<MRCLEAN:WORD:007:939ff7d7>' },
      { from: '<MRCLEAN:WORD:007:939ff7d7>', to: '<MRCLEAN:WORD:008:939ff7d7>' },
    ]
    const text = 'y=<MRCLEAN:WORD:006:939ff7d7> z=<MRCLEAN:WORD:007:939ff7d7>'

    // Act
    const renamed = applyRenamesToText(text, renames)

    // Assert — :006:→:007: and :007:→:008:, NEVER :006:→(:007:)→:008:
    expect(renamed).toBe('y=<MRCLEAN:WORD:007:939ff7d7> z=<MRCLEAN:WORD:008:939ff7d7>')
  })

  it('applyRenamesDeep renames nested string leaves immutably', () => {
    // Arrange
    const renames: PlaceholderRename[] = [
      { from: '<MRCLEAN:WORD:001:aaaaaaaa>', to: '<MRCLEAN:WORD:001:bbbbbbbb>' },
    ]
    const input = {
      text: 'lead <MRCLEAN:WORD:001:aaaaaaaa> tail',
      list: ['<MRCLEAN:WORD:001:aaaaaaaa>', 42, null, true],
      nested: { inner: '<MRCLEAN:WORD:001:aaaaaaaa>', count: 7 },
    }
    const snapshot = structuredClone(input)

    // Act
    const output = applyRenamesDeep(input, renames) as typeof input

    // Assert — renamed at every depth, non-strings untouched
    expect(output.text).toBe('lead <MRCLEAN:WORD:001:bbbbbbbb> tail')
    expect(output.list).toEqual(['<MRCLEAN:WORD:001:bbbbbbbb>', 42, null, true])
    expect(output.nested).toEqual({ inner: '<MRCLEAN:WORD:001:bbbbbbbb>', count: 7 })

    // Assert — NEW objects at every level; the input was never mutated
    expect(output).not.toBe(input)
    expect(output.list).not.toBe(input.list)
    expect(output.nested).not.toBe(input.nested)
    expect(input).toEqual(snapshot)

    // Assert — the walk is depth-capped: a leaf buried 40 levels deep stays
    // untouched instead of recursing unboundedly
    let deep: unknown = '<MRCLEAN:WORD:001:aaaaaaaa>'
    for (let level = 0; level < 40; level++) {
      deep = { d: deep }
    }
    let cursor = applyRenamesDeep(deep, renames) as { d: unknown }
    for (let level = 0; level < 39; level++) {
      cursor = cursor.d as { d: unknown }
    }
    expect(cursor.d).toBe('<MRCLEAN:WORD:001:aaaaaaaa>')
  })
})
