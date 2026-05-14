/**
 * mrclean_check tool — Plan 03-01 (MCP-02)
 *
 * Read-only detection tool. Scans text through all four detection layers and
 * returns a finding list WITHOUT writing any audit log records.
 *
 * Threat model compliance:
 *   T-03-01-02: findingSchema never exposes raw `value` or `span` — only
 *               ruleId, severity, placeholder, redactedHash, fingerprint.
 *   T-03-01-03: runDetectionReadOnly skips Step 12 (audit writes) entirely.
 *               tests/mcp/check.test.ts verifies at the file-system level.
 *
 * MCP-03 invariant: this tool is read-only and carries no write-back path.
 *   `readOnlyHint: true` informs the MCP client that this tool is side-effect-free.
 */

import { z } from 'zod/v4'
import { randomUUID } from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { runDetectionReadOnly } from '../../detect/index.js'
import { supervisedToolCall } from '../supervisor.js'
import type { MrcleanConfig } from '../../shared/types.js'
import type { SessionState } from '../../detect/session-state.js'
import type { ResolvedFinding } from '../../detect/index.js'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const checkInputSchema = z.object({
  text: z.string(),
  sessionId: z.string().optional(),
})

/**
 * Finding DTO — safe subset exposed to MCP callers.
 *
 * Deliberately omits:
 *   - `value`  — the raw matched secret (NEVER expose via MCP)
 *   - `span`   — byte-level position (information leak for targeted extraction)
 *   - `source` — internal layer label (unnecessary surface)
 *   - `action` — pre-resolution field; consumers get effectiveAction via severity
 */
const findingSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  placeholder: z.string(),
  redactedHash: z.string(),
  fingerprint: z.string(),
})

const checkOutputSchema = z.object({
  findings: z.array(findingSchema),
  count: z.number(),
})

// ---------------------------------------------------------------------------
// Finding → DTO mapper
// ---------------------------------------------------------------------------

function toFindingDTO(f: ResolvedFinding): z.infer<typeof findingSchema> {
  return {
    ruleId: f.ruleId,
    severity: f.severity,
    placeholder: f.placeholder,
    redactedHash: f.redactedHash,
    fingerprint: f.fingerprint,
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the `mrclean_check` tool on the given McpServer.
 *
 * @param server          - The McpServer instance to register on.
 * @param getConfig       - Closure returning the current effective MrcleanConfig.
 * @param getSessionState - Closure returning the current SessionState.
 * @param getCwd          - Closure returning the project root directory.
 */
export function registerCheckTool(
  server: McpServer,
  getConfig: () => MrcleanConfig,
  getSessionState: () => SessionState,
  getCwd: () => string,
): void {
  server.registerTool(
    'mrclean_check',
    {
      title: 'Check text for sensitive data (read-only)',
      description:
        'Scan text through all mrclean detection layers and return findings. ' +
        'Does NOT redact the text or write any audit log entry. ' +
        'Use mrclean_redact to redact and audit-log findings.',
      inputSchema: checkInputSchema,
      outputSchema: checkOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { text, sessionId: providedSessionId } = args as z.infer<typeof checkInputSchema>
      const sessionId = providedSessionId ?? randomUUID()
      const ctx = {
        sessionId,
        hookEvent: 'UserPromptSubmit' as const,
        cwd: getCwd(),
      }

      const outcome = await supervisedToolCall(() =>
        runDetectionReadOnly(text, getConfig(), getSessionState(), ctx),
      )

      if (!outcome.ok) {
        return {
          content: [{ type: 'text' as const, text: `mrclean_check error: ${outcome.error}` }],
          isError: true,
        }
      }

      const findings = outcome.result.findings.map(toFindingDTO)
      const structured = { findings, count: findings.length }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      }
    },
  )
}
