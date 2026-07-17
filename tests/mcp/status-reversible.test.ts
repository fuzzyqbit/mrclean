/**
 * InMemoryTransport suite for the mrclean_status reversible counters block
 * (Plan 10-06 Task 2, REVMODE-12 / SC5 status half).
 *
 * Verifies:
 *   - zero-state defaults: fresh baseDir + cwd => all-zero counters, enabled false
 *   - seeded counts: Task-1 fixture maps + audit.jsonl restore lines aggregate
 *   - zero-argument lock: inputSchema has no properties; six v1 fields unchanged
 *   - never-throw: baseDir-as-FILE + audit-as-DIRECTORY => zeros, no error
 *   - planted-canary absence: restorable originals never serialise into output
 *
 * Harness cloned from tests/mcp/status.test.ts (makeConnectedPair); seed
 * recipe cloned from tests/state/counts.test.ts (chaos.test.ts lineage).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { registerStatusTool } from '../../src/mcp/tools/status.js'
import type { MrcleanConfig } from '../../src/shared/types.js'
import type { SessionState } from '../../src/detect/session-state.js'
import type { EnvBlocklist } from '../../src/detect/layer3-env.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'
import { ensureSessionKey, writeSessionMapFile } from '../../src/state/map-store.js'
import {
  createEmptySessionMap,
  formatV2Token,
  hmacAddress,
  makeMapEntry,
  type SessionMapEntry,
  type SessionMapV1,
} from '../../src/state/session-map.js'

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

/** The exact zero-state reversible block (plan 10-06 interfaces contract). */
const ZERO_REVERSIBLE = {
  enabled: false,
  sessions: 0,
  entries_restorable: 0,
  entries_secret: 0,
  restored_total: 0,
  unmatched_total: 0,
}

/** Seed entry spec: TYPE + original value handed to makeMapEntry. */
interface SeedSpec {
  type: string
  original: string
}

/** sid1: two restorable WORD entries + one secret-class AWS_KEY entry. */
const SID1_SPECS: readonly SeedSpec[] = [
  { type: 'WORD', original: 'status-rev-word-alpha' },
  { type: 'WORD', original: 'status-rev-word-beta' },
  { type: 'AWS_KEY', original: 'AKIASTATUSREVFIXTURE' },
]

/** sid2: one restorable PII_EMAIL entry. */
const SID2_SPECS: readonly SeedSpec[] = [{ type: 'PII_EMAIL', original: 'status-rev@example.com' }]

/** Restorable canary that must NEVER appear in any status output. */
const CANARY = 'zz-canary-status-leak'

/** Two restore summary lines (restored 2/1, unmatched 1/0) + one hook line. */
const AUDIT_LINES = [
  JSON.stringify({
    ts: '2026-07-17T00:00:00.000Z',
    action: 'restore',
    sessionScope: 'all',
    restored: 2,
    unmatched: 1,
    skippedSecret: 0,
    hashes: [],
  }),
  JSON.stringify({
    ts: '2026-07-17T00:00:01.000Z',
    action: 'restore',
    sessionScope: 'all',
    restored: 1,
    unmatched: 0,
    skippedSecret: 0,
    hashes: [],
  }),
  // Hook AuditRecord sibling line — action is never 'restore'; must be ignored.
  JSON.stringify({
    ts: '2026-07-17T00:00:02.000Z',
    sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    hookEvent: 'UserPromptSubmit',
    ruleId: 'AWSAccessKeyID',
    severity: 'CRITICAL',
    action: 'substitute',
    redactedHash: '0123456789abcdef',
    fingerprint: 'AWSAccessKeyID:0123456789abcdef',
    location: { hookEvent: 'UserPromptSubmit', offset: 0, length: 20 },
  }),
].join('\n')

// ---------------------------------------------------------------------------
// Test helpers (status.test.ts harness + counts.test.ts seed recipe)
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<MrcleanConfig> = {}): MrcleanConfig {
  return { ...DEFAULT_CONFIG, ...overrides }
}

function emptyBlocklist(): EnvBlocklist {
  return { values: new Set(), meta: new Map() }
}

function makeSessionState(sessionId: string): SessionState {
  return {
    sessionId,
    envBlocklist: emptyBlocklist(),
    wordEntries: [],
    createdAt: new Date().toISOString(),
  }
}

/** Build a valid map with one entry per spec (counter = spec index + 1). */
function buildMapFromSpecs(sid: string, specs: readonly SeedSpec[]): SessionMapV1 {
  const base = createEmptySessionMap(sid)
  const entries: Record<string, SessionMapEntry> = {}
  specs.forEach((spec, index) => {
    const counter = index + 1
    entries[hmacAddress(base.hashSalt, spec.original)] = makeMapEntry(
      spec.type,
      formatV2Token(spec.type, counter, base.nonce8),
      counter,
      spec.original,
    )
  })
  return { ...base, counter: specs.length, entries }
}

/** Write a fully valid key+map state for `sid` under `baseDir`. */
async function writeSeededSession(
  baseDir: string,
  sid: string,
  specs: readonly SeedSpec[],
): Promise<void> {
  const key = await ensureSessionKey(baseDir, sid)
  await writeSessionMapFile(baseDir, sid, buildMapFromSpecs(sid, specs), key)
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('mrclean_status reversible counters block', () => {
  let cleanupDirs: string[]
  let openClients: Client[]

  beforeEach(() => {
    cleanupDirs = []
    openClients = []
  })

  afterEach(async () => {
    for (const client of openClients) {
      await client.close().catch(() => {})
    }
    for (const dir of cleanupDirs) {
      await rm(dir, { recursive: true, force: true })
    }
  })

  /** Fresh project cwd with .mrclean/ and a project-layer [reversible] pin —
   *  the project layer wins the config merge, so `enabled: false` is
   *  deterministic regardless of the machine's ~/.mrclean/config.toml. */
  async function makeTmpCwd(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'mrclean-status-rev-cwd-'))
    cleanupDirs.push(dir)
    await mkdir(join(dir, '.mrclean'), { recursive: true })
    await writeFile(join(dir, '.mrclean', 'config.toml'), '[reversible]\nenabled = false\n')
    return dir
  }

  /** Fresh state baseDir (no sessions/ or keys/ until seeded). */
  async function makeTmpBaseDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'mrclean-status-rev-state-'))
    cleanupDirs.push(dir)
    return dir
  }

  /** Register + connect a linked pair with injected cwd and state baseDir. */
  async function connect(cwd: string, baseDir: string): Promise<Client> {
    const config = makeConfig()
    const sessionState = makeSessionState('test-session-status-rev')
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerStatusTool(
      server,
      () => config,
      () => sessionState,
      () => cwd,
      () => baseDir,
    )
    const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    openClients.push(client)
    return client
  }

  /** Zero-argument call; asserts success and returns structuredContent. */
  async function callStatus(client: Client): Promise<Record<string, unknown>> {
    const result = await client.callTool({ name: 'mrclean_status', arguments: {} })
    expect(result.isError).toBeFalsy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (result as any).structuredContent as Record<string, unknown>
  }

  it('reports the all-zero reversible block on fresh state (zero-state defaults)', async () => {
    // Arrange
    const cwd = await makeTmpCwd()
    const baseDir = await makeTmpBaseDir()
    const client = await connect(cwd, baseDir)

    // Act
    const structured = await callStatus(client)

    // Assert
    expect(structured['reversible']).toEqual(ZERO_REVERSIBLE)
  })

  it('aggregates seeded maps and audit restore lines into honest counts', async () => {
    // Arrange — machine-global session state + project-cwd audit stream
    const cwd = await makeTmpCwd()
    const baseDir = await makeTmpBaseDir()
    await writeSeededSession(baseDir, randomUUID(), SID1_SPECS)
    await writeSeededSession(baseDir, randomUUID(), SID2_SPECS)
    await writeFile(join(cwd, '.mrclean', 'audit.jsonl'), AUDIT_LINES + '\n')
    const client = await connect(cwd, baseDir)

    // Act
    const structured = await callStatus(client)

    // Assert — 3 restorable (2 WORD + 1 PII_EMAIL), 1 secret (AWS_KEY);
    // restore totals sum ONLY the two action:'restore' lines (2+1 / 1+0)
    expect(structured['reversible']).toEqual({
      enabled: false,
      sessions: 2,
      entries_restorable: 3,
      entries_secret: 1,
      restored_total: 3,
      unmatched_total: 1,
    })
  })

  it('keeps the zero-argument input schema and the six v1 fields unchanged', async () => {
    // Arrange
    const cwd = await makeTmpCwd()
    const baseDir = await makeTmpBaseDir()
    const client = await connect(cwd, baseDir)

    // Act
    const { tools } = await client.listTools()
    const statusTool = tools.find((tool) => tool.name === 'mrclean_status')
    const structured = await callStatus(client)

    // Assert — no argument can ever be injected by a prompt-influenced model
    expect(statusTool).toBeDefined()
    const properties = (statusTool?.inputSchema as { properties?: Record<string, unknown> })
      .properties
    expect(Object.keys(properties ?? {})).toHaveLength(0)

    // Assert — the six pre-existing top-level fields keep their v1 shapes
    expect(typeof structured['version']).toBe('string')
    expect(typeof structured['rule_count']).toBe('number')
    expect(typeof structured['allowlist_count']).toBe('number')
    expect(['active', 'dry-run']).toContain(structured['mode'])
    expect(structured['session_id']).toBeNull()
    expect(typeof structured['audit_log_path']).toBe('string')
  })

  it('never throws: baseDir-as-FILE plus unreadable audit yield zero counts', async () => {
    // Arrange — baseDir is a FILE; audit.jsonl is a DIRECTORY (readFile EISDIR)
    const cwd = await makeTmpCwd()
    await mkdir(join(cwd, '.mrclean', 'audit.jsonl'))
    const parent = await mkdtemp(join(tmpdir(), 'mrclean-status-rev-file-'))
    cleanupDirs.push(parent)
    const fileAsBaseDir = join(parent, 'file-not-dir')
    await writeFile(fileAsBaseDir, 'not a directory')
    const client = await connect(cwd, fileAsBaseDir)

    // Act
    const structured = await callStatus(client)

    // Assert — read-only never-throw posture: zeros, never an error
    expect(structured['reversible']).toEqual(ZERO_REVERSIBLE)
  })

  it('never serialises a planted restorable canary into the status output', async () => {
    // Arrange — a decryptable map whose WORD original is the canary
    const cwd = await makeTmpCwd()
    const baseDir = await makeTmpBaseDir()
    await writeSeededSession(baseDir, randomUUID(), [{ type: 'WORD', original: CANARY }])
    const client = await connect(cwd, baseDir)

    // Act
    const structured = await callStatus(client)

    // Assert — counts confirm the map WAS read; the canary text never escapes
    expect(structured['reversible']).toEqual({
      ...ZERO_REVERSIBLE,
      sessions: 1,
      entries_restorable: 1,
    })
    expect(JSON.stringify(structured)).not.toContain(CANARY)
  })
})
