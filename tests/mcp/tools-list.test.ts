/**
 * Integration test: live stdio MCP round-trip via SDK Client.
 *
 * Spawns dist/mcp.js as a child process and connects the SDK Client via
 * StdioClientTransport. The SDK Client's connect() performs the initialize
 * handshake using the SDK's bundled LATEST_PROTOCOL_VERSION — no hardcoded
 * version string is used here, so the test stays correct as the SDK bumps
 * LATEST_PROTOCOL_VERSION over time.
 *
 * Plan 03-01 (MCP-02 + MCP-03):
 *   T2 asserts exactly ['mrclean_check', 'mrclean_redact', 'mrclean_status'].
 *   T2b asserts none of the forbidden tool names are present (MCP-03 invariant).
 *   T3a/T4a/T5a exercise the real tool behavior (basic smoke tests).
 *   T6a asserts schema validation rejection returns isError: true.
 *   T7 asserts crash isolation (server survives bad input).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSION } from '../../src/shared/version.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../..')
const DIST_MCP = resolve(PROJECT_ROOT, 'dist/mcp.js')

/**
 * MCP-03 invariant: these tool names must NEVER appear in tools/list.
 *
 * Forbidden list covers:
 *   - Phase 1 stubs (sanitize, restore, audit_query)
 *   - Reverse-path tools (unredact, mrclean_unredact)
 *   - Config-write/bypass tools (disable, add_word, config_write, ignore)
 *
 * If any of these appear, the prompt-injection attack surface described in
 * CONTEXT.md §"MCP Tool Surface" MCP-03 Pitfall #10 is exposed.
 */
const FORBIDDEN_TOOL_NAMES = [
  'sanitize',
  'restore',
  'audit_query',
  'unredact',
  'mrclean_unredact',
  'disable',
  'add_word',
  'config_write',
  'ignore',
] as const

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

  it('T2: tools/list returns exactly the three production tool names', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['mrclean_check', 'mrclean_redact', 'mrclean_status'])
  })

  it('T2b: tools/list contains none of the forbidden tool names (MCP-03 invariant)', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    for (const forbidden of FORBIDDEN_TOOL_NAMES) {
      expect(names).not.toContain(forbidden)
    }
  })

  it('T3a: mrclean_check returns { findings, count } shape on clean text', async () => {
    const result = await client.callTool({
      name: 'mrclean_check',
      arguments: { text: 'Hello, world! No secrets here.' },
    })
    expect(result.isError).toBeFalsy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as { findings: unknown[]; count: number }
    expect(Array.isArray(structured.findings)).toBe(true)
    expect(structured.count).toBe(0)
  })

  it('T4a: mrclean_redact returns { redacted, findings } shape on clean text', async () => {
    const input = 'Hello, world! No secrets here.'
    const result = await client.callTool({
      name: 'mrclean_redact',
      arguments: { text: input },
    })
    expect(result.isError).toBeFalsy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as { redacted: string; findings: unknown[] }
    expect(structured.redacted).toBe(input)
    expect(Array.isArray(structured.findings)).toBe(true)
  })

  it('T5a: mrclean_status returns expected shape — version matches, rule_count > 100', async () => {
    const result = await client.callTool({
      name: 'mrclean_status',
      arguments: {},
    })
    expect(result.isError).toBeFalsy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as {
      version: string
      rule_count: number
      allowlist_count: number
      mode: string
      session_id: null
      audit_log_path: string
    }
    expect(structured.version).toBe(VERSION)
    expect(structured.rule_count).toBeGreaterThan(100)
    expect(['active', 'dry-run']).toContain(structured.mode)
    expect(structured.audit_log_path).toMatch(/audit\.jsonl$/)
  })

  it('T6a: mrclean_check with invalid text type → tool error, server survives', async () => {
    let gotError = false
    try {
      const result = await client.callTool({
        name: 'mrclean_check',
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

  it('T7: after bad call, mrclean_check still works (crash isolation)', async () => {
    const result = await client.callTool({
      name: 'mrclean_check',
      arguments: { text: 'after bad call' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const structured = (result as any).structuredContent as { findings: unknown[]; count: number }
    expect(result.isError).toBeFalsy()
    expect(structured.count).toBe(0)
  })
})
