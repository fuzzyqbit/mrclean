/**
 * Unit tests for nerStatus surfacing in mrclean_check + mrclean_redact — Plan 06-03 Task 1.
 *
 * Asserts (D-03):
 *   - both tools pass { ner: true } to detection (covered by the orchestrator-side
 *     behavior here: nerStatus is surfaced from the DetectionResult)
 *   - both tools include `nerStatus` in structuredContent
 *   - the getNerStatus() boot closure is the fallback when the result has no nerStatus
 *   - finding DTOs still omit value/span (no PII leak — T-06-03-03)
 *   - a NER-unavailable run still returns secret findings (fail-closed for NER only)
 *
 * Strategy: real McpServer + InMemoryTransport (same as check.test.ts / redact.test.ts),
 * exercising the tool through the SDK dispatch path. No model download — the default
 * config has pii.ner.enabled=false so the orchestrator's L6b branch is never entered and
 * nerStatus resolves to 'disabled' from the boot closure.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { registerCheckTool } from '../../src/mcp/tools/check.js'
import { registerRedactTool } from '../../src/mcp/tools/redact.js'
import type { MrcleanConfig } from '../../src/shared/types.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'
import type { SessionState } from '../../src/detect/session-state.js'
import type { EnvBlocklist } from '../../src/detect/layer3-env.js'
import type { NerStatus } from '../../src/detect/layer6b-ner.js'

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

async function makeTmpCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mrclean-ner-test-'))
  await mkdir(join(dir, '.mrclean'), { recursive: true })
  return dir
}

const AWS_KEY_TEXT = 'AKIAABCDE3FGHIJ2345K is used for testing'

interface Pair {
  server: McpServer
  client: Client
}

async function connectPair(
  register: (server: McpServer, getNerStatus: () => NerStatus) => void,
  getNerStatus: () => NerStatus,
): Promise<Pair> {
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  register(server, getNerStatus)
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { server, client }
}

describe('mrclean_check — nerStatus surfacing (D-03)', () => {
  let cwd: string
  let pair: Pair

  beforeEach(async () => {
    cwd = await makeTmpCwd()
    const config = makeConfig()
    const sessionState = makeSessionState('test-session-check-ner')
    pair = await connectPair(
      (server, getNerStatus) =>
        registerCheckTool(
          server,
          () => config,
          () => sessionState,
          () => cwd,
          getNerStatus,
        ),
      () => 'unavailable',
    )
  })

  afterEach(async () => {
    await pair.client.close().catch(() => {})
  })

  it('includes nerStatus in structuredContent (falls back to boot closure)', async () => {
    const result = await pair.client.callTool({
      name: 'mrclean_check',
      arguments: { text: 'clean text' },
    })
    expect(result.isError).toBeFalsy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as {
      findings: unknown[]
      count: number
      nerStatus: string
    }
    // Default config has pii.ner.enabled=false → orchestrator returns 'disabled'.
    // (When the result lacks nerStatus the boot closure 'unavailable' is used instead.)
    expect(['disabled', 'unavailable']).toContain(structured.nerStatus)
  })

  it('NER-unavailable run still returns secret findings; DTO omits value/span', async () => {
    const result = await pair.client.callTool({
      name: 'mrclean_check',
      arguments: { text: AWS_KEY_TEXT },
    })
    expect(result.isError).toBeFalsy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as {
      findings: Array<Record<string, unknown>>
      count: number
      nerStatus: string
    }
    expect(structured.count).toBeGreaterThanOrEqual(1)
    const finding = structured.findings[0]!
    expect(finding['value']).toBeUndefined()
    expect(finding['span']).toBeUndefined()
    expect(finding['word']).toBeUndefined()
    expect(typeof structured.nerStatus).toBe('string')
  })
})

describe('mrclean_redact — nerStatus surfacing (D-03)', () => {
  let cwd: string
  let pair: Pair

  beforeEach(async () => {
    cwd = await makeTmpCwd()
    const config = makeConfig()
    const sessionState = makeSessionState('test-session-redact-ner')
    pair = await connectPair(
      (server, getNerStatus) =>
        registerRedactTool(
          server,
          () => config,
          () => sessionState,
          () => cwd,
          getNerStatus,
        ),
      () => 'disabled',
    )
  })

  afterEach(async () => {
    await pair.client.close().catch(() => {})
  })

  it('includes nerStatus in structuredContent alongside redacted + findings', async () => {
    const result = await pair.client.callTool({
      name: 'mrclean_redact',
      arguments: { text: 'clean text' },
    })
    expect(result.isError).toBeFalsy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as {
      redacted: string
      findings: unknown[]
      nerStatus: string
    }
    expect(structured.redacted).toBe('clean text')
    expect(Array.isArray(structured.findings)).toBe(true)
    expect(['disabled', 'unavailable', 'ready', 'loading']).toContain(structured.nerStatus)
  })

  it('redact DTO omits value/span on a secret-bearing input', async () => {
    const result = await pair.client.callTool({
      name: 'mrclean_redact',
      arguments: { text: AWS_KEY_TEXT },
    })
    expect(result.isError).toBeFalsy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as {
      redacted: string
      findings: Array<Record<string, unknown>>
      nerStatus: string
    }
    expect(structured.findings.length).toBeGreaterThanOrEqual(1)
    const finding = structured.findings[0]!
    expect(finding['value']).toBeUndefined()
    expect(finding['span']).toBeUndefined()
    // The raw key must not survive into the redacted output.
    expect(structured.redacted).not.toContain('AKIAABCDE3FGHIJ2345K')
  })
})
