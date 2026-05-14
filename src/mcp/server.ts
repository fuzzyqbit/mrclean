/**
 * MCP server — stdio transport, long-lived, spawned by Claude Code once per session.
 *
 * Plan 01 stub — body replaced by Plan 04.
 * The stub blocks forever to mimic real server behavior (so imports in tests
 * do NOT execute this function; only `mrclean-mcp` via entrypoint guard does).
 */

/**
 * Run the MCP server: connect stdio transport, register tools, block until SIGTERM.
 *
 * Plan 04 replaces this stub with the real McpServer implementation including
 * tool registration (sanitize, restore, audit_query) and SIGINT/SIGTERM shutdown.
 */
export async function runMcpServer(): Promise<void> {
  process.stderr.write('mcp server: not implemented in Plan 01\n')
  // Block forever to mimic real server behavior; Plan 04 replaces with SDK transport.
  await new Promise<never>(() => {
    // intentionally never resolves
  })
}
