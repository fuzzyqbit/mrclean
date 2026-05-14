/**
 * Unit tests for the audit_query tool registration.
 * Phase 1: always returns empty records.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { registerAuditQueryTool } from '../../src/mcp/tools/audit-query.js'

function makeConnectedPair() {
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerAuditQueryTool(server)
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  return { server, client, clientTransport, serverTransport }
}

describe('registerAuditQueryTool', () => {
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

  it('returns empty records with default limit', async () => {
    const result = await client.callTool({
      name: 'audit_query',
      arguments: {},
    })
    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0]?.text ?? '{}')
    expect(parsed).toEqual({ records: [] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).structuredContent).toMatchObject({ records: [], total: 0 })
  })

  it('accepts explicit limit within bounds', async () => {
    const result = await client.callTool({
      name: 'audit_query',
      arguments: { limit: 50 },
    })
    expect(result.isError).toBeFalsy()
    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0]?.text ?? '{}')
    expect(parsed).toEqual({ records: [] })
  })

  it('accepts optional sessionId', async () => {
    const result = await client.callTool({
      name: 'audit_query',
      arguments: { sessionId: 'sess-xyz' },
    })
    expect(result.isError).toBeFalsy()
  })

  it('returns tool error when limit exceeds 1000', async () => {
    const result = await client.callTool({
      name: 'audit_query',
      arguments: { limit: 5000 },
    })
    expect(result.isError).toBe(true)
  })

  it('returns tool error when limit is not a positive integer', async () => {
    const result = await client.callTool({
      name: 'audit_query',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      arguments: { limit: -1 as any },
    })
    expect(result.isError).toBe(true)
  })
})
