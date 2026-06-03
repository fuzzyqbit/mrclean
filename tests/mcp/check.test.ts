/**
 * Unit tests for mrclean_check tool (src/mcp/tools/check.ts).
 *
 * Strategy: use the real McpServer + InMemoryTransport so we exercise the tool
 * through the SDK's dispatch path (Zod validation + handler dispatch).
 *
 * Audit-log invariant (T-03-01-03): after a mrclean_check call on text that
 * would produce findings, the audit.jsonl file is NOT written.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { registerCheckTool } from '../../src/mcp/tools/check.js'
import type { MrcleanConfig } from '../../src/shared/types.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'
import type { SessionState } from '../../src/detect/session-state.js'
import type { EnvBlocklist } from '../../src/detect/layer3-env.js'

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
  const dir = await mkdtemp(join(tmpdir(), 'mrclean-check-test-'))
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
  const sessionState = makeSessionState('test-session-check')
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerCheckTool(
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

describe('registerCheckTool (mrclean_check)', () => {
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
  })

  it('T1: schema rejects non-string text — isError: true', async () => {
    const result = await client.callTool({
      name: 'mrclean_check',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      arguments: { text: 42 as any },
    })
    expect(result.isError).toBe(true)
  })

  it('T2: clean text returns findings: [] and count: 0', async () => {
    const result = await client.callTool({
      name: 'mrclean_check',
      arguments: { text: 'Hello, world! No secrets here.' },
    })
    expect(result.isError).toBeFalsy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as { findings: unknown[]; count: number }
    expect(structured.findings).toEqual([])
    expect(structured.count).toBe(0)
  })

  it('T3: text with AWS key returns at least 1 finding with the expected shape', async () => {
    const result = await client.callTool({
      name: 'mrclean_check',
      arguments: { text: AWS_KEY_TEXT },
    })
    expect(result.isError).toBeFalsy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as { findings: Array<Record<string, unknown>>; count: number }
    expect(structured.count).toBeGreaterThanOrEqual(1)

    const finding = structured.findings[0]!
    // Required fields present
    expect(typeof finding['ruleId']).toBe('string')
    expect(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).toContain(finding['severity'])
    expect(typeof finding['placeholder']).toBe('string')
    expect(typeof finding['redactedHash']).toBe('string')
    expect(typeof finding['fingerprint']).toBe('string')

    // Forbidden fields absent (information-leak guard — T-03-01-02)
    expect(finding['value']).toBeUndefined()
    expect(finding['span']).toBeUndefined()
  })

  it('T4: audit.jsonl is NOT written (read-only invariant — T-03-01-03)', async () => {
    const beforeCount = await auditLineCount(cwd)

    await client.callTool({
      name: 'mrclean_check',
      arguments: { text: AWS_KEY_TEXT },
    })

    const afterCount = await auditLineCount(cwd)
    expect(afterCount).toBe(beforeCount)
  })

  it('T5: content[0].text is valid JSON matching structuredContent', async () => {
    const result = await client.callTool({
      name: 'mrclean_check',
      arguments: { text: 'clean text' },
    })
    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0]?.text ?? '{}') as { findings: unknown[]; count: number }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as { findings: unknown[]; count: number }
    expect(parsed.findings).toEqual(structured.findings)
    expect(parsed.count).toBe(structured.count)
  })
})
