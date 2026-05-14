/**
 * audit_query tool — Phase 1 no-op stub.
 *
 * Phase 1 behavior: always returns empty records (audit log is a Phase 2+ concern).
 *
 * Input schema: Zod v4 (required per CLAUDE.md — Standard Schema compatible with MCP SDK v1.29).
 */

import { z } from 'zod/v4'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const inputSchema = z.object({
  sessionId: z.string().optional(),
  limit: z.number().int().positive().max(1000).default(100),
})

export function registerAuditQueryTool(server: McpServer): void {
  server.registerTool(
    'audit_query',
    {
      title: 'Query audit log (Phase 1 no-op stub)',
      description:
        'Query the mrclean audit log for redaction events. Phase 1 always returns empty records. Real audit log is a Phase 2+ concern.',
      inputSchema,
    },
    async (_args) => {
      // Phase 1: no audit records exist yet
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ records: [] }) }],
        structuredContent: { records: [], total: 0 },
      }
    },
  )
}
