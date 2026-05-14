/**
 * Unit tests for the restore tool registration.
 * Same behaviors as sanitize — reverse-direction naming, same echo shape.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { registerRestoreTool } from '../../src/mcp/tools/restore.js'

function makeConnectedPair() {
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerRestoreTool(server)
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  return { server, client, clientTransport, serverTransport }
}

describe('registerRestoreTool', () => {
  let client: Client

  beforeEach(async () => {
    const pair = makeConnectedPair()
    client = pair.client
    await pair.server.connect(pair.serverTransport)
    await client.connect(pair.clientTransport)
  })

  afterEach(async () => {
    await client.close().catch(() => {})
  })

  it('echoes text unchanged (Phase 1 no-op)', async () => {
    const result = await client.callTool({
      name: 'restore',
      arguments: { text: 'placeholder' },
    })
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0]?.text).toBe('placeholder')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).structuredContent).toMatchObject({ unchanged: true })
  })

  it('includes sessionId null in structuredContent when not provided', async () => {
    const result = await client.callTool({
      name: 'restore',
      arguments: { text: 'x' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).structuredContent).toMatchObject({ sessionId: null })
  })

  it('includes sessionId in structuredContent when provided', async () => {
    const result = await client.callTool({
      name: 'restore',
      arguments: { text: 'x', sessionId: 'sess-abc' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).structuredContent).toMatchObject({ sessionId: 'sess-abc' })
  })

  it('returns tool error when text is not a string', async () => {
    const result = await client.callTool({
      name: 'restore',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      arguments: { text: 42 as any },
    })
    expect(result.isError).toBe(true)
  })

  it('returns tool error when text is missing', async () => {
    const result = await client.callTool({
      name: 'restore',
      arguments: {},
    })
    expect(result.isError).toBe(true)
  })
})
