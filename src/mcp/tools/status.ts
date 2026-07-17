/**
 * mrclean_status tool — Plan 03-01 (MCP-02), reversible counters 10-06 (REVMODE-12)
 *
 * Zero-argument status tool. Returns runtime metadata about the mrclean MCP server:
 * version, rule counts, allowlist counts, operating mode, audit log path, and a
 * reversible counters block — numbers and booleans ONLY, never values.
 *
 * Threat model compliance:
 *   T-03-01-05: returns audit_log_path only (the PATH, not contents). Intentional.
 *   T-10-06-01: entry counts come from the counts reducer INSIDE src/state/ —
 *     decrypted `original` strings never enter this module's stack frames.
 *   T-10-06-02: input schema stays z.object({}) — no sid/path argument can ever
 *     be injected by a prompt-influenced model. The state baseDir closure is
 *     registration-time (server-side), never model-reachable.
 *   T-10-06-03: honest scoping — session/entry counts are machine-global
 *     (~/.mrclean); restored/unmatched totals aggregate THIS project's audit log.
 *
 * MCP-03 invariant: read-only, no write-back path.
 *   `readOnlyHint: true, idempotentHint: true` — no side effects.
 */

import { z } from 'zod/v4'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { VERSION } from '../../shared/version.js'
import { getRuleCount } from '../../detect/layer1-regex/index.js'
import { computeAllowlistCount } from '../../hook/banner.js'
import { loadEffectiveConfig } from '../../config/index.js'
import { countSessionEntries, type SessionEntryCounts } from '../../state/counts.js'
import { aggregateRestoreCounters } from '../../audit/restore-log.js'
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
  // REVMODE-12 counters block — z.boolean()/z.number() ONLY, never strings:
  // no original text, TYPE list, or path can structurally fit this schema.
  reversible: z.object({
    enabled: z.boolean(),
    sessions: z.number(),
    entries_restorable: z.number(),
    entries_secret: z.number(),
    restored_total: z.number(),
    unmatched_total: z.number(),
  }),
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
 * @param getStateBaseDir - Closure returning the reversible state base dir
 *                          (default `~/.mrclean`). Registration-time only —
 *                          never reachable from tool arguments (T-10-06-02).
 */
export function registerStatusTool(
  server: McpServer,
  getConfig: () => MrcleanConfig,
  _getSessionState: () => SessionState,
  getCwd: () => string,
  getStateBaseDir: () => string = () => join(homedir(), '.mrclean'),
): void {
  server.registerTool(
    'mrclean_status',
    {
      title: 'Get mrclean MCP server status',
      description:
        'Return runtime metadata: version, active rule count, allowlist entry count, ' +
        'operating mode (active | dry-run), the path to the audit log file, and a ' +
        'reversible counters block (enabled flag, session count, entry counts by ' +
        'class, restored/unmatched totals — counts only, never values; session ' +
        'counts are machine-wide, restore totals are per-project). ' +
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

      // REVMODE-12 data sources — each individually wrapped (never-throw
      // posture, same as the config load above): a corrupt store or audit
      // stream degrades to zeros, never to a tool error. Both sources are
      // total-error internally; the .catch is belt-and-braces.
      const counts = await countSessionEntries(getStateBaseDir()).catch(
        (): SessionEntryCounts => ({ sessions: 0, restorable: 0, secret: 0 }),
      )
      const totals = await aggregateRestoreCounters(getCwd()).catch(() => ({
        restored_total: 0,
        unmatched_total: 0,
      }))

      // Built field-by-field — never spread a foreign object into the model-
      // facing payload (over-shaped inputs must not structurally serialise).
      const reversible = {
        enabled: config.reversible.enabled === true,
        sessions: counts.sessions,
        entries_restorable: counts.restorable,
        entries_secret: counts.secret,
        restored_total: totals.restored_total,
        unmatched_total: totals.unmatched_total,
      }

      const status: z.infer<typeof statusOutputSchema> = {
        version: VERSION,
        rule_count: ruleCount,
        allowlist_count: allowlistCount,
        mode,
        session_id: null,
        audit_log_path: auditLogPath,
        reversible,
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status) }],
        structuredContent: status,
      }
    },
  )
}
