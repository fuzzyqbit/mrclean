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

import { isMainEntry } from './shared/entrypoint.js'

// Entrypoint guard: only start the MCP server when this file is the main
// module. URL-canonical comparison (realpath + pathToFileURL — CR-01): the
// former naive `file://${argv[1]}` interpolation never matched through
// symlinked bins (the npm/npx wiring shape), spaced paths, or on Windows.
if (isMainEntry(import.meta.url, process.argv[1])) {
  const { runMcpServer } = await import('./mcp/server.js')
  await runMcpServer()
}
