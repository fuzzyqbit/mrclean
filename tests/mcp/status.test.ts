/**
 * Unit tests for mrclean_status tool (src/mcp/tools/status.ts).
 *
 * Strategy: use the real McpServer + InMemoryTransport.
 *
 * Verifies:
 *   - Zero-arg call succeeds
 *   - structuredContent.version matches package.json version
 *   - rule_count > 100 (gitleaks vendor provides 183+ rules)
 *   - audit_log_path ends with '.mrclean/audit.jsonl'
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { registerStatusTool } from '../../src/mcp/tools/status.js'
import { VERSION } from '../../src/shared/version.js'
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
  const dir = await mkdtemp(join(tmpdir(), 'mrclean-status-test-'))
  await mkdir(join(dir, '.mrclean'), { recursive: true })
  return dir
}

function makeConnectedPair(cwd: string) {
  const config = makeConfig()
  const sessionState = makeSessionState('test-session-status')
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerStatusTool(
    server,
    () => config,
    () => sessionState,
    () => cwd,
  )
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  return { server, client, clientTransport, serverTransport }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerStatusTool (mrclean_status)', () => {
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

  it('T1: zero-arg call succeeds (no isError)', async () => {
    const result = await client.callTool({
      name: 'mrclean_status',
      arguments: {},
    })
    expect(result.isError).toBeFalsy()
  })

  it('T2: structuredContent.version matches package.json VERSION', async () => {
    const result = await client.callTool({
      name: 'mrclean_status',
      arguments: {},
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as { version: string }
    expect(structured.version).toBe(VERSION)
  })

  it('T3: rule_count > 100 (gitleaks vendor has 183+ usable rules)', async () => {
    const result = await client.callTool({
      name: 'mrclean_status',
      arguments: {},
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as { rule_count: number }
    expect(structured.rule_count).toBeGreaterThan(100)
  })

  it('T4: audit_log_path ends with .mrclean/audit.jsonl', async () => {
    const result = await client.callTool({
      name: 'mrclean_status',
      arguments: {},
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as {
      audit_log_path: string
      mode: string
      session_id: string | null
      allowlist_count: number
    }
    expect(structured.audit_log_path).toContain('.mrclean')
    expect(structured.audit_log_path).toMatch(/audit\.jsonl$/)
    expect(['active', 'dry-run']).toContain(structured.mode)
    expect(structured.session_id).toBeNull()
    expect(typeof structured.allowlist_count).toBe('number')
  })
})
