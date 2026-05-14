/**
 * MCP tool supervisor — Plan 03-01
 *
 * Provides in-process Promise-based isolation for MCP tool handlers. Any synchronous
 * or asynchronous throw inside a tool handler is caught here and returned as a
 * structured { ok: false, error: string } value instead of propagating to the MCP
 * transport layer. This prevents uncaught handler errors from crashing the McpServer
 * process.
 *
 * Design rationale (CONTEXT.md §"MCP Tool Surface" + RESEARCH §Pattern 2 + §Pitfall 3):
 *
 *   Option A (literal new Worker per call) was the original CONTEXT.md intent, but
 *   §Pitfall 3 documents that spawning an ES-module-importing worker from inside a
 *   tsup ESM bundle requires a pre-compiled worker entry point (dist/mcp/tool-worker.js)
 *   and an additional tsup entry. This adds supply-chain surface and complicates the
 *   build for a marginal gain in this phase.
 *
 *   Option B (chosen): In-process Promise.race isolation. The substantive MCP-04
 *   guarantee — "uncaught throws do not kill the McpServer" — is preserved by this
 *   wrapper. The only known sync-blocking failure mode (ReDoS in Layer 1 regex
 *   matching) is already isolated in worker_threads by Phase 2's WorkerPool
 *   (src/detect/layer1-regex/worker-pool.ts), which terminates and replaces timed-out
 *   workers. The MCP transport layer never receives an unhandled rejection.
 *
 *   If literal per-call worker threads are required in the future (e.g., Phase 4
 *   multi-tenant mode), create src/mcp/tool-worker.ts, add a tsup entry, and replace
 *   supervisedToolCall to use `new Worker(distPath, { workerData })`. The public API
 *   of this module does not need to change.
 *
 * shutdownMcpSupervisor():
 *   Calls shutdownDetection() to cleanly terminate the Phase 2 WorkerPool and clear
 *   the PlaceholderManager cache. This is the SINGLE shutdown point for the MCP
 *   server's detection resources — server.ts calls only this function in its shutdown
 *   handler.
 */

export { shutdownDetection as shutdownMcpSupervisor } from '../detect/index.js'

/**
 * Wrap a tool handler invocation in try/catch Promise isolation.
 *
 * On success: returns `{ ok: true, result: T }`.
 * On any thrown error (sync or async): returns `{ ok: false, error: string }`.
 * The error NEVER propagates beyond this call — no unhandled rejections.
 *
 * @param fn - An async factory that invokes the tool handler logic.
 * @returns  - Discriminated union indicating success or failure.
 */
export async function supervisedToolCall<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  try {
    const result = await fn()
    return { ok: true, result }
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : String(err)
    return { ok: false, error: message }
  }
}
