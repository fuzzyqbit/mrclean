#!/usr/bin/env node
/**
 * mrclean-mcp entrypoint — thin shebang wrapper for the MCP stdio server.
 *
 * Lazy-imports the MCP SDK inside src/mcp/server.ts to keep CLI cold-start cheap
 * (RESEARCH §6.2). This entrypoint does nothing except start the server when run
 * directly; importing this module in tests does NOT start the server.
 *
 * The entrypoint guard prevents runMcpServer() from being called when this module
 * is imported (e.g., in smoke tests).
 */

// Entrypoint guard: only start the MCP server when this file is the main module.
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const { runMcpServer } = await import('./mcp/server.js')
  await runMcpServer()
}
