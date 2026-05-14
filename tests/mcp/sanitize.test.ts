/**
 * Unit tests for the sanitize tool registration.
 *
 * Strategy: use the real McpServer + an in-memory paired transport (InMemoryTransport)
 * so we exercise the tool through the SDK's dispatch path, which handles Zod validation
 * and error wrapping, rather than calling the handler directly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { registerSanitizeTool } from '../../src/mcp/tools/sanitize.js'

function makeConnectedPair() {
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerSanitizeTool(server)
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  return { server, client, clientTransport, serverTransport }
}

describe('registerSanitizeTool', () => {
  let server: McpServer
  let client: Client

  beforeEach(async () => {
    const pair = makeConnectedPair()
    server = pair.server
    client = pair.client
    await server.connect(pair.serverTransport)
    await client.connect(pair.clientTransport)
  })

  afterEach(async () => {
    await client.close().catch(() => {})
  })

  it('echoes text unchanged (Phase 1 no-op)', async () => {
    const result = await client.callTool({
      name: 'sanitize',
      arguments: { text: 'hello' },
    })
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0]?.text).toBe('hello')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).structuredContent).toMatchObject({ unchanged: true })
  })

  it('includes sessionId null in structuredContent when not provided', async () => {
    const result = await client.callTool({
      name: 'sanitize',
      arguments: { text: 'hello' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).structuredContent).toMatchObject({ sessionId: null })
  })

  it('includes sessionId in structuredContent when provided', async () => {
    const result = await client.callTool({
      name: 'sanitize',
      arguments: { text: 'hello', sessionId: 'sess-123' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).structuredContent).toMatchObject({ sessionId: 'sess-123' })
  })

  it('returns tool error when text is not a string (invalid input)', async () => {
    const result = await client.callTool({
      name: 'sanitize',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      arguments: { text: 42 as any },
    })
    // The SDK surfaces validation errors as isError: true in the result
    expect(result.isError).toBe(true)
  })

  it('returns tool error when text is missing entirely', async () => {
    const result = await client.callTool({
      name: 'sanitize',
      arguments: {},
    })
    expect(result.isError).toBe(true)
  })
})
