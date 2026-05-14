/**
 * MCP server — stdio transport, long-lived, spawned by Claude Code once per session.
 *
 * Architecture notes (see RESEARCH §6.2, §6.4, §2.6):
 * - All SDK imports are lazy (inside the function body) to keep CLI cold-start cheap.
 * - Tool module imports are also lazy for the same reason.
 * - SIGINT/SIGTERM are registered EXACTLY ONCE via installShutdownHandlers.
 *   runMcpServer() must NOT register additional signal listeners.
 * - The stdio transport's internal read loop keeps the event loop alive after
 *   server.connect() returns — no redundant keepalive construct is needed.
 */

import { VERSION } from '../shared/version.js'
import { installShutdownHandlers } from './lifecycle.js'

export async function runMcpServer(): Promise<void> {
  // Lazy-import SDK per RESEARCH §6.2 — cold-start stays cheap for CLI users.
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')

  const server = new McpServer({ name: 'mrclean', version: VERSION })

  // Lazy-import tool registrations — avoids loading zod/v4 on the CLI cold path.
  const { registerSanitizeTool } = await import('./tools/sanitize.js')
  const { registerRestoreTool } = await import('./tools/restore.js')
  const { registerAuditQueryTool } = await import('./tools/audit-query.js')

  registerSanitizeTool(server)
  registerRestoreTool(server)
  registerAuditQueryTool(server)

  const transport = new StdioServerTransport()

  // SIGINT/SIGTERM registered EXACTLY ONCE via installShutdownHandlers.
  // Do NOT add any process.on('SIGINT'/'SIGTERM') calls here or anywhere else in
  // the MCP server code path — doing so would cause MaxListenersExceededWarning
  // and a signal-handler race condition.
  installShutdownHandlers(async () => {
    await transport.close()
  })

  await server.connect(transport)

  // server.connect() resolves once the transport is wired. The stdio transport's
  // internal readline loop keeps the Node.js event loop alive, reading from stdin
  // until EOF or until installShutdownHandlers fires process.exit(0) on signal.
  process.stderr.write(`mrclean-mcp v${VERSION} running on stdio\n`)
}
