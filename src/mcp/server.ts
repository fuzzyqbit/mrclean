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
 *
 * Tool surface (Plan 03-01 — MCP-02, MCP-03):
 *   Exactly three tools are registered: mrclean_check, mrclean_redact, mrclean_status.
 *   The Phase 1 stubs (sanitize, restore, audit_query) are deleted — NO aliases retained.
 *   The absence of unredact / disable / add_word / config_write / ignore tools is the
 *   MCP-03 invariant, enforced by tests/mcp/tools-list.test.ts.
 *
 * Shutdown (Plan 03-01):
 *   shutdownMcpSupervisor() (from supervisor.ts) is called BEFORE transport.close().
 *   This is the SINGLE shutdown point for detection resources (WorkerPool + PlaceholderManager).
 */

import { VERSION } from '../shared/version.js'
import { installShutdownHandlers } from './lifecycle.js'
import type { MrcleanConfig } from '../shared/types.js'
// TYPE-ONLY import of the NER status union — never pulls the engine runtime onto the cold
// path. The engine (and its @huggingface/transformers dynamic import) is reached EXCLUSIVELY
// through the dynamic import inside startNerPreload, never as a static import (T-06-03-01).
import type { NerStatus } from '../detect/layer6b-ner.js'

/**
 * Start the eager, fire-and-forget NER preload (D-04/D-05) and return a `getNerStatus`
 * closure the check/redact tools read to surface `nerStatus` in their structuredContent.
 *
 * Behavior:
 *   - config.pii.ner.enabled === false → status is 'disabled'; NO transformers import is
 *     attempted, so the cold ML dep never loads on a server that isn't using NER.
 *   - config.pii.ner.enabled === true  → status starts 'loading'; a `void (async () => …)()`
 *     task dynamically imports the pipeline singleton and warms it, flipping status to 'ready'
 *     on success or 'unavailable' on throw. This task is NEVER awaited — the caller (the MCP
 *     server boot) registers and connects the secret tools immediately (D-04, T-06-03-01).
 *   - On a preload throw the server STILL serves secret detection; only NER is degraded
 *     (fail-closed for NER, D-05, T-06-03-02). A single stderr line announces model state
 *     ONLY — it carries no error detail and no input text (Pitfall 5, T-06-03-03).
 *
 * Exported so it can be unit-tested without booting the full stdio transport (whose readline
 * loop keeps the event loop alive).
 *
 * @param config - The effective mrclean configuration.
 * @returns A `getNerStatus()` closure returning the live NER lifecycle status.
 */
export function startNerPreload(config: MrcleanConfig): () => NerStatus {
  let nerStatus: NerStatus = config.pii.ner.enabled ? 'loading' : 'disabled'
  const getNerStatus = (): NerStatus => nerStatus

  if (config.pii.ner.enabled) {
    // Fire-and-forget: NEVER awaited. The secret tools register/connect immediately (D-04).
    void (async () => {
      try {
        const { getNerPipeline } = await import('../model/pipeline-singleton.js')
        await getNerPipeline(config.pii.ner)
        nerStatus = 'ready'
      } catch {
        // Fail-closed for NER only (D-05): the secret gate is unaffected. The stderr line
        // carries model state ONLY — no error object, no matched text (Pitfall 5).
        nerStatus = 'unavailable'
        process.stderr.write('mrclean-mcp: NER unavailable; serving secrets only\n')
      }
    })()
  }

  return getNerStatus
}

export async function runMcpServer(): Promise<void> {
  // Lazy-import SDK per RESEARCH §6.2 — cold-start stays cheap for CLI users.
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')

  // Lazy-import config + session-state setup
  const { loadEffectiveConfig } = await import('../config/index.js')
  const { initSessionState } = await import('../detect/session-state.js')

  const cwd = process.cwd()
  const config = await loadEffectiveConfig({ cwd })
  const sessionState = await initSessionState({
    sessionId: 'mcp-server',
    homeDir: process.env['HOME'] ?? cwd,
    cwd,
    config,
  })

  // Closures passed to each tool registration so tools always see current state.
  const getConfig = () => config
  const getSessionState = () => sessionState
  const getCwd = () => cwd

  // Eager fail-closed NER preload (D-04/D-05). This is fire-and-forget — it MUST run before
  // (and independent of) server.connect() and is NEVER awaited, so the secret tools register
  // and connect immediately even while the ~317 MB / 108 MB model is still loading. On a load
  // failure nerStatus flips to 'unavailable' and the server still serves secret detection.
  const getNerStatus = startNerPreload(config)

  const server = new McpServer({ name: 'mrclean', version: VERSION })

  // Lazy-import tool registrations — avoids loading zod/v4 on the CLI cold path.
  // Plan 03-01: Phase 1 stubs (sanitize, restore, audit_query) are deleted.
  const { registerCheckTool } = await import('./tools/check.js')
  const { registerRedactTool } = await import('./tools/redact.js')
  const { registerStatusTool } = await import('./tools/status.js')

  registerCheckTool(server, getConfig, getSessionState, getCwd, getNerStatus)
  registerRedactTool(server, getConfig, getSessionState, getCwd, getNerStatus)
  registerStatusTool(server, getConfig, getSessionState, getCwd)

  const transport = new StdioServerTransport()

  // SIGINT/SIGTERM registered EXACTLY ONCE via installShutdownHandlers.
  // Do NOT add any process.on('SIGINT'/'SIGTERM') calls here or anywhere else in
  // the MCP server code path — doing so would cause MaxListenersExceededWarning
  // and a signal-handler race condition.
  //
  // Shutdown order (Plan 03-01):
  //   1. shutdownMcpSupervisor() — terminates WorkerPool + clears PlaceholderManager cache
  //   2. transport.close() — closes the stdio transport
  const { shutdownMcpSupervisor } = await import('./supervisor.js')
  installShutdownHandlers(async () => {
    await shutdownMcpSupervisor()
    await transport.close()
  })

  await server.connect(transport)

  // server.connect() resolves once the transport is wired. The stdio transport's
  // internal readline loop keeps the Node.js event loop alive, reading from stdin
  // until EOF or until installShutdownHandlers fires process.exit(0) on signal.
  process.stderr.write(
    `mrclean-mcp v${VERSION} running on stdio — tools: mrclean_check, mrclean_redact, mrclean_status\n`,
  )
}
