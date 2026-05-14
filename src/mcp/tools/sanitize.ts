/**
 * sanitize tool — Phase 1 no-op stub.
 *
 * Phase 1 behavior: echoes input text unchanged.
 * Phase 2+ will replace the handler body with real detection + redaction logic.
 *
 * Input schema: Zod v4 (required per CLAUDE.md — Standard Schema compatible with MCP SDK v1.29).
 */

import { z } from 'zod/v4'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const inputSchema = z.object({
  text: z.string(),
  sessionId: z.string().optional(),
})

export function registerSanitizeTool(server: McpServer): void {
  server.registerTool(
    'sanitize',
    {
      title: 'Sanitize text (Phase 1 no-op stub)',
      description:
        'Returns input text unchanged. Real detection and redaction arrives in Phase 2.',
      inputSchema,
    },
    async (args) => {
      // args is already validated by the SDK; safe to destructure directly
      const { text, sessionId } = args as z.infer<typeof inputSchema>
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { unchanged: true, sessionId: sessionId ?? null },
      }
    },
  )
}
