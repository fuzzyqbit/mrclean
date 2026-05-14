/**
 * Integration test: live stdio MCP round-trip via SDK Client.
 *
 * Spawns dist/mcp.js as a child process and connects the SDK Client via
 * StdioClientTransport. The SDK Client's connect() performs the initialize
 * handshake using the SDK's bundled LATEST_PROTOCOL_VERSION — no hardcoded
 * version string is used here, so the test stays correct as the SDK bumps
 * LATEST_PROTOCOL_VERSION over time.
 *
 * Tests:
 * 1. Initialize handshake — serverInfo.name === 'mrclean'
 * 2. tools/list returns exactly ['audit_query', 'restore', 'sanitize']
 * 3. sanitize echoes text unchanged
 * 4. restore echoes text unchanged
 * 5. audit_query returns { records: [] }
 * 6. sanitize with invalid text type → isError: true, server stays alive
 * 7. After invalid call, sanitize still works (crash isolation)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../..')
const DIST_MCP = resolve(PROJECT_ROOT, 'dist/mcp.js')

describe('mrclean-mcp stdio integration', { timeout: 30000 }, () => {
  let client: Client
  let transport: StdioClientTransport

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [DIST_MCP],
    })
    // Client.connect() performs the MCP initialize handshake using the SDK's
    // bundled LATEST_PROTOCOL_VERSION — no hardcoded version string needed.
    client = new Client({ name: 'mrclean-test-client', version: '0.0.0' }, { capabilities: {} })
    await client.connect(transport)
  }, 20000)

  afterAll(async () => {
    await client.close().catch(() => {})
  })

  it('T1: initialize — serverInfo.name is mrclean', () => {
    const info = client.getServerVersion()
    expect(info?.name).toBe('mrclean')
    expect(typeof info?.version).toBe('string')
  })

  it('T2: tools/list returns exactly three Phase 1 tool names', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['audit_query', 'restore', 'sanitize'])
  })

  it('T3: sanitize echoes text unchanged (Phase 1 no-op)', async () => {
    const result = await client.callTool({
      name: 'sanitize',
      arguments: { text: 'hello world' },
    })
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0]?.text).toBe('hello world')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).structuredContent).toMatchObject({ unchanged: true })
  })

  it('T4: restore echoes text unchanged (Phase 1 no-op)', async () => {
    const result = await client.callTool({
      name: 'restore',
      arguments: { text: 'placeholder' },
    })
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0]?.text).toBe('placeholder')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).structuredContent).toMatchObject({ unchanged: true })
  })

  it('T5: audit_query returns empty records', async () => {
    const result = await client.callTool({
      name: 'audit_query',
      arguments: {},
    })
    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0]?.text ?? '{}')
    expect(parsed).toEqual({ records: [] })
  })

  it('T6: sanitize with invalid text type → tool error, server survives', async () => {
    let gotError = false
    try {
      const result = await client.callTool({
        name: 'sanitize',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        arguments: { text: 42 as any },
      })
      // SDK may return isError: true instead of throwing
      if (result.isError) gotError = true
    } catch {
      // SDK may throw a structured error
      gotError = true
    }
    expect(gotError).toBe(true)
  })

  it('T7: after bad call, sanitize still works (crash isolation)', async () => {
    const result = await client.callTool({
      name: 'sanitize',
      arguments: { text: 'after bad call' },
    })
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0]?.text).toBe('after bad call')
    expect(result.isError).toBeFalsy()
  })
})
