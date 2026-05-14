/**
 * mrclean_status tool — Plan 03-01 (MCP-02)
 *
 * Zero-argument status tool. Returns runtime metadata about the mrclean MCP server:
 * version, rule counts, allowlist counts, operating mode, and audit log path.
 *
 * Threat model compliance:
 *   T-03-01-05: returns audit_log_path only (the PATH, not contents). Intentional.
 *
 * MCP-03 invariant: read-only, no write-back path.
 *   `readOnlyHint: true, idempotentHint: true` — no side effects.
 */

import { z } from 'zod/v4'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { VERSION } from '../../shared/version.js'
import { getRuleCount } from '../../detect/layer1-regex/index.js'
import { computeAllowlistCount } from '../../hook/banner.js'
import { loadEffectiveConfig } from '../../config/index.js'
import type { MrcleanConfig } from '../../shared/types.js'
import type { SessionState } from '../../detect/session-state.js'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const statusInputSchema = z.object({})

const statusOutputSchema = z.object({
  version: z.string(),
  rule_count: z.number(),
  allowlist_count: z.number(),
  mode: z.enum(['active', 'dry-run']),
  session_id: z.string().nullable(),
  audit_log_path: z.string(),
})

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the `mrclean_status` tool on the given McpServer.
 *
 * @param server          - The McpServer instance to register on.
 * @param getConfig       - Closure returning the current effective MrcleanConfig.
 * @param getSessionState - Closure returning the current SessionState (unused — status is process-wide).
 * @param getCwd          - Closure returning the project root directory.
 */
export function registerStatusTool(
  server: McpServer,
  getConfig: () => MrcleanConfig,
  _getSessionState: () => SessionState,
  getCwd: () => string,
): void {
  server.registerTool(
    'mrclean_status',
    {
      title: 'Get mrclean MCP server status',
      description:
        'Return runtime metadata: version, active rule count, allowlist entry count, ' +
        'operating mode (active | dry-run), and the path to the audit log file. ' +
        'Zero-argument, read-only, no side effects.',
      inputSchema: statusInputSchema,
      outputSchema: statusOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (_args) => {
      // Load the effective config fresh on each call so status reflects live state.
      // loadEffectiveConfig() is cheap (reads two small TOML files, falls back to defaults).
      const config = await loadEffectiveConfig({ cwd: getCwd() }).catch(() => getConfig())

      const ruleCountResult = getRuleCount()
      const ruleCount = ruleCountResult.total
      const allowlistCount = computeAllowlistCount(config)
      const mode: 'active' | 'dry-run' = config.dry_run ? 'dry-run' : 'active'
      const auditLogPath = join(getCwd(), '.mrclean', 'audit.jsonl')

      const status: z.infer<typeof statusOutputSchema> = {
        version: VERSION,
        rule_count: ruleCount,
        allowlist_count: allowlistCount,
        mode,
        session_id: null,
        audit_log_path: auditLogPath,
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status) }],
        structuredContent: status,
      }
    },
  )
}
