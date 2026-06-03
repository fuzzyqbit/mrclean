/**
 * Unit tests for mrclean_redact tool (src/mcp/tools/redact.ts).
 *
 * Strategy: use the real McpServer + InMemoryTransport to exercise the tool
 * through the SDK's dispatch path.
 *
 * Audit-log test: mrclean_redact MUST write exactly findings.length audit records.
 * budgetExhausted test: simulated via a mock on runDetection (see T5).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { registerRedactTool } from '../../src/mcp/tools/redact.js'
import type { MrcleanConfig } from '../../src/shared/types.js'
import type { SessionState } from '../../src/detect/session-state.js'
import type { EnvBlocklist } from '../../src/detect/layer3-env.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<MrcleanConfig> = {}): MrcleanConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  }
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
  const dir = await mkdtemp(join(tmpdir(), 'mrclean-redact-test-'))
  await mkdir(join(dir, '.mrclean'), { recursive: true })
  return dir
}

async function auditLineCount(cwd: string): Promise<number> {
  const auditPath = join(cwd, '.mrclean', 'audit.jsonl')
  try {
    const content = await readFile(auditPath, 'utf8')
    return content.trim().split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

// A fake AWS access key that matches the gitleaks aws-access-token regex:
//   AKIA + 16 chars from [A-Z2-7], entropy > 3, does NOT end with EXAMPLE.
// The gitleaks rule allowlist rejects keys ending with EXAMPLE (the well-known
// AWS documentation placeholder), so we use a distinct fake value.
const AWS_KEY_TEXT = 'AKIAABCDE3FGHIJ2345K is used for testing'

function makeConnectedPair(cwd: string) {
  const config = makeConfig()
  const sessionState = makeSessionState('test-session-redact')
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerRedactTool(
    server,
    () => config,
    () => sessionState,
    () => cwd,
    () => 'disabled',
  )
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  return { server, client, clientTransport, serverTransport }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerRedactTool (mrclean_redact)', () => {
  let server: McpServer
  let client: Client
  let cwd: string

  beforeEach(async () => {
    cwd = await makeTmpCwd()
    const pair = makeConnectedPair(cwd)
    server = pair.server
    client = pair.client
    await server.connect(pair.serverTransport)
    await client.connect(pair.clientTransport)
  })

  afterEach(async () => {
    await client.close().catch(() => {})
    vi.restoreAllMocks()
  })

  it('T1: schema rejects non-string text — isError: true', async () => {
    const result = await client.callTool({
      name: 'mrclean_redact',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      arguments: { text: 42 as any },
    })
    expect(result.isError).toBe(true)
  })

  it('T2: clean text returns { redacted: input, findings: [] }', async () => {
    const input = 'Hello, world! No secrets here.'
    const result = await client.callTool({
      name: 'mrclean_redact',
      arguments: { text: input },
    })
    expect(result.isError).toBeFalsy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as { redacted: string; findings: unknown[] }
    expect(structured.redacted).toBe(input)
    expect(structured.findings).toEqual([])
  })

  it('T3: AWS key input returns redacted text with placeholder and 1+ findings', async () => {
    const result = await client.callTool({
      name: 'mrclean_redact',
      arguments: { text: AWS_KEY_TEXT },
    })
    expect(result.isError).toBeFalsy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as {
      redacted: string
      findings: Array<Record<string, unknown>>
    }
    // The redacted text should have a placeholder inserted
    expect(structured.redacted).not.toBe(AWS_KEY_TEXT)
    expect(structured.redacted).toContain('<MRCLEAN:')
    expect(structured.findings.length).toBeGreaterThanOrEqual(1)

    const finding = structured.findings[0]!
    // Required fields present
    expect(typeof finding['ruleId']).toBe('string')
    expect(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).toContain(finding['severity'])
    // Forbidden fields absent
    expect(finding['value']).toBeUndefined()
    expect(finding['span']).toBeUndefined()
  })

  it('T4: audit.jsonl GAINS exactly findings.length records after redact call', async () => {
    const beforeCount = await auditLineCount(cwd)

    const result = await client.callTool({
      name: 'mrclean_redact',
      arguments: { text: AWS_KEY_TEXT },
    })
    expect(result.isError).toBeFalsy()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as { findings: unknown[] }
    const expectedNewRecords = structured.findings.length
    const afterCount = await auditLineCount(cwd)

    expect(afterCount - beforeCount).toBe(expectedNewRecords)
  })

  it('T5: budgetExhausted → isError: true with descriptive message', async () => {
    // Mock runDetection to simulate budget exhaustion
    const detectModule = await import('../../src/detect/index.js')
    vi.spyOn(detectModule, 'runDetection').mockResolvedValueOnce({
      findings: [],
      substitutedText: AWS_KEY_TEXT,
      budgetExhausted: true,
      rawTimeoutCount: 5,
    })

    // Need a fresh server/client pair for this test since we're mocking at module level
    const pair2 = makeConnectedPair(cwd)
    const server2 = pair2.server
    const client2 = pair2.client
    await server2.connect(pair2.serverTransport)
    await client2.connect(pair2.clientTransport)

    const result = await client2.callTool({
      name: 'mrclean_redact',
      arguments: { text: AWS_KEY_TEXT },
    })
    expect(result.isError).toBe(true)
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0]?.text).toContain('budget exhausted')

    await client2.close().catch(() => {})
  })
})
