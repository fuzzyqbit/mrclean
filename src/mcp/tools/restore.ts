/**
 * restore tool — Phase 1 no-op stub.
 *
 * Reverse-direction counterpart to sanitize.
 * Phase 1 behavior: echoes input text unchanged.
 * Full placeholder-restoration behavior is a Phase 2 REVMODE concern.
 *
 * Input schema: Zod v4 (required per CLAUDE.md — Standard Schema compatible with MCP SDK v1.29).
 */

import { z } from 'zod/v4'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const inputSchema = z.object({
  text: z.string(),
  sessionId: z.string().optional(),
})

export function registerRestoreTool(server: McpServer): void {
  server.registerTool(
    'restore',
    {
      title: 'Restore placeholders (Phase 1 no-op stub)',
      description:
        'Restore placeholders to original values. Phase 1 echoes input text unchanged. Full behavior is a Phase 2 REVMODE concern.',
      inputSchema,
    },
    async (args) => {
      const { text, sessionId } = args as z.infer<typeof inputSchema>
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { unchanged: true, sessionId: sessionId ?? null },
      }
    },
  )
}
