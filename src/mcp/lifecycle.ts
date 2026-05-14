/**
 * MCP server lifecycle — graceful shutdown on SIGINT/SIGTERM.
 *
 * THIS IS THE ONLY SITE in the MCP server that registers SIGINT/SIGTERM listeners.
 * runMcpServer() in server.ts must NOT register any additional signal listeners.
 *
 * Design:
 * - Exactly one listener per signal (no MaxListenersExceededWarning).
 * - Idempotent across multiple signals via the `shuttingDown` flag.
 * - Awaits the caller's closeFn() before exiting, allowing clean transport teardown.
 */

export function installShutdownHandlers(closeFn: () => Promise<void>): void {
  let shuttingDown = false

  const handler = (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true

    process.stderr.write(`mrclean-mcp: received ${signal}, shutting down\n`)

    closeFn()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`mrclean-mcp: shutdown error: ${msg}\n`)
        process.exit(1)
      })
  }

  // Exactly 2 listener registrations — one per signal.
  // No other code in the MCP server may register these signals.
  process.on('SIGINT', () => handler('SIGINT'))
  process.on('SIGTERM', () => handler('SIGTERM'))
}
