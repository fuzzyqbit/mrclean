/**
 * SC2 fs-write interception gate (Plan 11-02, REVMODE-11).
 *
 * tests/state/inspection.test.ts byte-scans FINAL artifacts — a plaintext
 * buffer written to an atomic-write temp file and renamed-then-deleted
 * before the scan would evade it. This suite closes that transient-write
 * dimension: EVERY buffer handed to an fs write API during a real two-event
 * reversible flow PLUS a real restore run is captured in-process at the
 * write call, and none may carry a planted canary original or the
 * '"entries"' plaintext map-JSON marker.
 *
 * Seam (11-RESEARCH Pattern 3 — probe-verified live 2026-07-17 on Node
 * v22.22.0 against the repo's actual write-file-atomic): property-patch the
 * builtin `fs` / `fs/promises` CJS export objects, then
 * module.syncBuiltinESMExports() so ESM named-import bindings (map-store's
 * `import { writeFile } from 'node:fs/promises'`) rebind to the wrappers.
 * This reaches BOTH map-store's ESM writes AND write-file-atomic's fd-based
 * `promisify(fs.write)` temp-file writes (wfa re-promisifies fs.write per
 * call — node_modules/write-file-atomic/lib/index.js:116).
 * `vi.mock('node:fs')` does NOT reach externalized CJS deps — do not
 * substitute it.
 *
 * Non-vacuity (T-11-02-01 — the proof cannot pass with a channel unpatched):
 *   1. some fs.write capture STARTS WITH 'MRCLNMAP'        → wfa temp-file
 *      envelope (map channel via write-file-atomic)
 *   2. some promises.writeFile capture is EXACTLY 32 bytes
 *      on the `<sid>.key.<uint32>` tmp path                → publishKeyOnce
 *      (key channel, src/state/map-store.ts ~line 210)
 *   3. some promises.appendFile capture targets
 *      audit.jsonl, hash-only bytes                        → restore audit
 *      record (src/audit/restore-log.ts ~line 116)
 *
 * Hygiene (T-11-02-02): originals restored + syncBuiltinESMExports re-run
 * in the test body's `finally` AND in an idempotent afterEach — a mid-flow
 * throw can never leak patched builtins into the worker. The unit project's
 * per-file worker isolation makes the process-global patch safe; the
 * sibling hygiene test proves restoration with a live un-captured write.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import {
  persistAllocations,
  readSessionMapForHydration,
} from '../../src/state/index.js'
import { POST_LOCK_DEADLINE_MS } from '../../src/state/lock.js'
import { keyPathFor, readSessionMapFile } from '../../src/state/map-store.js'
import { hmacAddress } from '../../src/state/session-map.js'
import { PlaceholderManager } from '../../src/placeholder/manager.js'

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

/**
 * Patch seam probe-verified on POSIX only (11-RESEARCH Pattern 3); wfa's
 * win32 EPERM rename-retry channel is unverified — visible skip below
 * (chaos.test.ts WR-04 precedent).
 */
const IS_WIN32 = process.platform === 'win32'

/** Pinned Phase-11 canary corpus (10-08): restorable WORD original. */
const WORD_CANARY = 'zz-canary-project-path-7g2'
/**
 * Pinned secret-class canary (10-08). Deliberately NOT the AWS-docs
 * `...EXAMPLE` key — that one is gitleaks-allowlisted and produces no
 * findings; the X-suffixed variant is the canonical detectable positive.
 */
const SECRET_CANARY = 'AKIAIOSFODNN7EXAMPLX'

/**
 * Envelope magic, duplicated by value from src/state/map-store.ts (private
 * constant there — pinned layout, the grammar/offset sync-lock tests own
 * drift). A wfa temp-file write of the map MUST start with these 8 bytes.
 */
const ENVELOPE_MAGIC = Buffer.from('MRCLNMAP')

/** Plaintext SessionMap JSON marker — present in serialized (pre-encrypt)
 *  map bytes; must NEVER appear in any written buffer. */
const PLAINTEXT_MAP_MARKER = '"entries"'

// ---------------------------------------------------------------------------
// Capture harness — module-scope patch seam (11-RESEARCH Pattern 3)
// ---------------------------------------------------------------------------

interface Capture {
  /** Which patched API observed the write. */
  api: string
  /** Path string, or `fd:N` for fd-based writes. */
  target: string
  /** Normalized copy of the buffer handed to the API. */
  bytes: Buffer
}

/** Every buffer handed to a patched write API (reset in afterEach). */
let captured: Capture[] = []

/** Normalize string/Buffer/TypedArray write payloads to a Buffer copy. */
function toBuf(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) {
    return Buffer.from(data)
  }
  if (typeof data === 'string') {
    return Buffer.from(data, 'utf8')
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  }
  return Buffer.from(String(data), 'utf8')
}

/**
 * True builtins, saved at module load (per-file worker isolation — nothing
 * can have patched them before this file evaluated). All 8 wrapped APIs.
 */
const ORIGINALS = {
  write: fs.write,
  writev: fs.writev,
  writeFile: fs.writeFile,
  writeFileSync: fs.writeFileSync,
  appendFile: fs.appendFile,
  appendFileSync: fs.appendFileSync,
  pWriteFile: fsPromises.writeFile,
  pAppendFile: fsPromises.appendFile,
} as const

type LooseFn = (this: unknown, ...args: unknown[]) => unknown

/**
 * Wrap an fs API: record the call, then delegate to the saved original with
 * IDENTICAL arguments and this-binding. The wrapper deliberately does NOT
 * carry util.promisify.custom — write-file-atomic's per-call
 * `promisify(fs.write)` must promisify the WRAPPER (capture), not shortcut
 * to the builtin custom implementation (bypass).
 */
function wrap<T>(original: T, record: (args: unknown[]) => void): T {
  const delegate = original as unknown as LooseFn
  const wrapper = function (this: unknown, ...args: unknown[]): unknown {
    record(args)
    return delegate.apply(this, args)
  }
  return wrapper as unknown as T
}

let patchInstalled = false

/** Install all 8 wrappers, then re-sync ESM named bindings (load-bearing —
 *  without the sync, map-store's ESM imports keep the unpatched builtins
 *  and the channel probes fail loud). Idempotent. */
function installPatch(): void {
  if (patchInstalled) {
    return
  }
  patchInstalled = true
  fs.write = wrap(ORIGINALS.write, (args) => {
    captured.push({ api: 'fs.write', target: `fd:${String(args[0])}`, bytes: toBuf(args[1]) })
  })
  fs.writev = wrap(ORIGINALS.writev, (args) => {
    const buffers = args[1]
    if (Array.isArray(buffers)) {
      for (const chunk of buffers) {
        captured.push({ api: 'fs.writev', target: `fd:${String(args[0])}`, bytes: toBuf(chunk) })
      }
    }
  })
  fs.writeFile = wrap(ORIGINALS.writeFile, (args) => {
    captured.push({ api: 'fs.writeFile', target: String(args[0]), bytes: toBuf(args[1]) })
  })
  fs.writeFileSync = wrap(ORIGINALS.writeFileSync, (args) => {
    captured.push({ api: 'fs.writeFileSync', target: String(args[0]), bytes: toBuf(args[1]) })
  })
  fs.appendFile = wrap(ORIGINALS.appendFile, (args) => {
    captured.push({ api: 'fs.appendFile', target: String(args[0]), bytes: toBuf(args[1]) })
  })
  fs.appendFileSync = wrap(ORIGINALS.appendFileSync, (args) => {
    captured.push({ api: 'fs.appendFileSync', target: String(args[0]), bytes: toBuf(args[1]) })
  })
  fsPromises.writeFile = wrap(ORIGINALS.pWriteFile, (args) => {
    captured.push({ api: 'promises.writeFile', target: String(args[0]), bytes: toBuf(args[1]) })
  })
  fsPromises.appendFile = wrap(ORIGINALS.pAppendFile, (args) => {
    captured.push({ api: 'promises.appendFile', target: String(args[0]), bytes: toBuf(args[1]) })
  })
  syncBuiltinESMExports()
}

/** Restore all 8 builtins and re-sync ESM named bindings. Idempotent —
 *  safe to call from both the test-body `finally` and afterEach. */
function restorePatch(): void {
  if (!patchInstalled) {
    return
  }
  patchInstalled = false
  fs.write = ORIGINALS.write
  fs.writev = ORIGINALS.writev
  fs.writeFile = ORIGINALS.writeFile
  fs.writeFileSync = ORIGINALS.writeFileSync
  fs.appendFile = ORIGINALS.appendFile
  fs.appendFileSync = ORIGINALS.appendFileSync
  fsPromises.writeFile = ORIGINALS.pWriteFile
  fsPromises.appendFile = ORIGINALS.pAppendFile
  syncBuiltinESMExports()
}

// ---------------------------------------------------------------------------
// Real-flow helper
// ---------------------------------------------------------------------------

/**
 * One facade event: hydrate → fresh manager → allocate ONE value → persist.
 * (tests/state/inspection.test.ts recipe, duplicated by value — never
 * cross-imported. Hand-built state would bypass the serializer's secret
 * floor strip and invalidate the proof — Pitfall 10 lineage.)
 */
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
 * Drive runRestore with process.exit/stdout/stderr mirror mocks installed
 * (tests/cli/restore.test.ts capture harness, duplicated by value — never
 * cross-imported). A mocked exit throws to stop execution; non-exit throws
 * repropagate (degrade paths must never throw). Restore stays a DYNAMIC
 * import — the cold-path fence bans static restore imports from hook-side
 * suites, and this file must not create a counterexample pattern.
 */
async function captureRestoreRun(opts: {
  baseDir: string
  cwd: string
  stdin: NodeJS.ReadableStream
}): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
  const { runRestore } = await import('../../src/restore/cli.js')

  const originalExit = process.exit
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)
  let exitCode: number | undefined
  let stdout = ''
  let stderr = ''

  process.exit = ((code?: number) => {
    exitCode = code ?? 0
    throw new Error(`process.exit(${code})`)
  }) as typeof process.exit
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk)
    return true
  }) as typeof process.stderr.write

  try {
    await runRestore(opts)
  } catch (err) {
    if (exitCode === undefined) {
      throw err // a real escape — restore degrade paths must NEVER throw
    }
  } finally {
    process.exit = originalExit
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  }

  return { stdout, stderr, exitCode }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(IS_WIN32)('SC2 fs-write interception (REVMODE-11 — transient-write dimension)', () => {
  let baseDir: string
  let cwdDir: string
  let sid: string

  beforeEach(async () => {
    baseDir = join(tmpdir(), `mrclean-fs-intercept-${randomUUID()}`)
    cwdDir = join(tmpdir(), `mrclean-fs-intercept-cwd-${randomUUID()}`)
    sid = randomUUID()
    await mkdir(baseDir, { recursive: true })
    // .mrclean/ must pre-exist for the restore audit append to land (the
    // audit writer never mkdirs — `mrclean install` owns that in prod).
    await mkdir(join(cwdDir, '.mrclean'), { recursive: true })
  })

  afterEach(async () => {
    // Belt-and-braces hygiene (T-11-02-02): the test body already restores
    // in `finally`; this afterEach guarantees the worker never sees patched
    // builtins even when the body throws before installing its finally.
    restorePatch()
    captured = []
    await rm(baseDir, { recursive: true, force: true })
    await rm(cwdDir, { recursive: true, force: true })
  })

  it('two-event reversible flow + restore run: no plaintext canary reaches ANY write API; all three channels proven intercepted', async () => {
    // Arrange + Act — patch FIRST (a write before install is a miss), then
    // the real two-event flow (WORD then AWS_KEY, pinned 10-08 corpus),
    // then a REAL restore run — all under the same installed patch.
    let run: { stdout: string; stderr: string; exitCode: number | undefined } | undefined
    let secretToken = ''
    installPatch()
    try {
      const first = await runReversibleEvent(baseDir, sid, WORD_CANARY, 'WORD')
      const second = await runReversibleEvent(baseDir, sid, SECRET_CANARY, 'AWS_KEY')

      // Sanity — event 2 hydrated from event 1's REAL persisted state (the
      // captures below observed a live store, not an empty one).
      expect(first.knownEntries).toBe(0)
      expect(second.counterFloor).toBe(1)
      expect(second.knownEntries).toBe(1)

      // Read the PERSISTED placeholders back through the store (inspection
      // recipe — never hand-format tokens; the store is the truth source).
      const map = await readSessionMapFile(baseDir, sid)
      expect(map).not.toBeNull()
      const wordToken = map!.entries[hmacAddress(map!.hashSalt, WORD_CANARY)]!.placeholder
      secretToken = map!.entries[hmacAddress(map!.hashSalt, SECRET_CANARY)]!.placeholder

      // Restore leg — still under the patch, so the audit append is on the
      // captured surface. cwd = tmp project dir (audit sink).
      const doc = `doc ${wordToken} and ${secretToken} end`
      run = await captureRestoreRun({ baseDir, cwd: cwdDir, stdin: Readable.from([doc]) })
    } finally {
      restorePatch()
    }

    // ------------------------------------------------------------------
    // NON-VACUITY BEFORE ABSENCE (10-08 ordering discipline): prove the
    // flow REALLY engaged before any canary-absent assertion may count.
    // ------------------------------------------------------------------

    // (1) The restore REALLY engaged: WORD original restored onto stdout,
    // stderr summary reports restored >= 1. Restore stdout flows through
    // the mirror-mocked process.stdout.write — NOT an fs API — so this
    // operator-local plaintext output is by design and must not (and does
    // not) appear anywhere in the fs captures swept below.
    expect(run).toBeDefined()
    const restoreRun = run!
    expect(restoreRun.exitCode).toBeUndefined()
    expect(restoreRun.stdout).toContain(WORD_CANARY)
    const summaryMatch = restoreRun.stderr.match(/restored=(\d+)/)
    expect(summaryMatch).not.toBeNull()
    expect(Number(summaryMatch![1])).toBeGreaterThanOrEqual(1)

    // (2) The secret placeholder byte-survives on stdout (secret-class is
    // never restored) and the secret original is absent from it.
    expect(restoreRun.stdout).toContain(secretToken)
    expect(restoreRun.stdout.includes(SECRET_CANARY)).toBe(false)

    // Non-vacuity floor — two events + restore must hand buffers to the
    // patched APIs at least 3 times (key-tmp publish + 2 wfa envelope
    // temp writes + the audit append).
    expect(captured.length).toBeGreaterThanOrEqual(3)

    // Channel probe 1 (map channel) — some fd-based fs.write capture starts
    // with the envelope magic: write-file-atomic's TEMP-file bytes were
    // intercepted, ciphertext-framed from the very first byte.
    const wfaEnvelopeWrites = captured.filter(
      (c) =>
        c.api === 'fs.write' &&
        c.bytes.length >= ENVELOPE_MAGIC.length &&
        c.bytes.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC),
    )
    expect(wfaEnvelopeWrites.length).toBeGreaterThanOrEqual(1)
    for (const capture of wfaEnvelopeWrites) {
      expect(capture.target).toMatch(/^fd:\d+$/)
    }

    // Channel probe 2 (key channel) — publishKeyOnce's tmp write: EXACTLY
    // 32 key bytes via promises.writeFile to `<keysDir>/<sid>.key.<uint32>`
    // (exact tmp naming from src/state/map-store.ts publishKeyOnce).
    const keyTmpPrefix = `${keyPathFor(baseDir, sid)}.`
    const keyTmpWrites = captured.filter(
      (c) => c.api === 'promises.writeFile' && c.target.startsWith(keyTmpPrefix),
    )
    expect(keyTmpWrites.length).toBeGreaterThanOrEqual(1)
    for (const capture of keyTmpWrites) {
      expect(capture.bytes.length).toBe(32)
      expect(/^\d+$/.test(capture.target.slice(keyTmpPrefix.length))).toBe(true)
    }

    // (3) Channel probe 3 (audit channel) — the restore audit record landed
    // through the patched promises.appendFile onto audit.jsonl, and that
    // specific capture carries hashes only: both canaries absent from it.
    const auditAppends = captured.filter(
      (c) => c.api === 'promises.appendFile' && c.target.endsWith('audit.jsonl'),
    )
    expect(auditAppends.length).toBeGreaterThanOrEqual(1)
    for (const capture of auditAppends) {
      expect(capture.bytes.includes(WORD_CANARY)).toBe(false)
      expect(capture.bytes.includes(SECRET_CANARY)).toBe(false)
    }

    // (4) ABSENCE — the load-bearing FULL-FLOW sweep over every capture
    // accumulated since the start (both events + the restore run): NO
    // buffer handed to ANY write API carries a canary original or the
    // plaintext map-JSON marker. Temp files included — this is the
    // dimension the post-hoc inspection byte-scan cannot see.
    for (const capture of captured) {
      expect(
        capture.bytes.includes(WORD_CANARY),
        `WORD canary must not reach ${capture.api} → ${capture.target}`,
      ).toBe(false)
      expect(
        capture.bytes.includes(SECRET_CANARY),
        `secret canary must not reach ${capture.api} → ${capture.target}`,
      ).toBe(false)
      expect(
        capture.bytes.includes(PLAINTEXT_MAP_MARKER),
        `plaintext map JSON must not reach ${capture.api} → ${capture.target}`,
      ).toBe(false)
    }
  })

  it('hygiene: builtins pristine after the interception test — patch can never leak into the worker', async () => {
    // Identity restoration for ALL 8 wrapped APIs (finally + afterEach ran).
    expect(fs.write).toBe(ORIGINALS.write)
    expect(fs.writev).toBe(ORIGINALS.writev)
    expect(fs.writeFile).toBe(ORIGINALS.writeFile)
    expect(fs.writeFileSync).toBe(ORIGINALS.writeFileSync)
    expect(fs.appendFile).toBe(ORIGINALS.appendFile)
    expect(fs.appendFileSync).toBe(ORIGINALS.appendFileSync)
    expect(fsPromises.writeFile).toBe(ORIGINALS.pWriteFile)
    expect(fsPromises.appendFile).toBe(ORIGINALS.pAppendFile)

    // A trivial write through the ESM named-import binding is UN-captured —
    // proves syncBuiltinESMExports() re-ran after restore (forgetting the
    // re-sync would leave this binding pointing at the wrapper).
    const before = captured.length
    await writeFile(join(baseDir, 'hygiene-probe.txt'), 'hygiene-probe')
    expect(captured.length).toBe(before)
  })
})

describe.skipIf(!IS_WIN32)('SC2 fs-write interception — win32 documented gap', () => {
  it('suite skipped: patch seam probe-verified on POSIX only (11-RESEARCH Pattern 3)', () => {
    // Placeholder so the win32 skip is VISIBLE in reporter output rather
    // than silently absent (chaos.test.ts WR-04 precedent).
    expect(IS_WIN32).toBe(true)
  })
})
