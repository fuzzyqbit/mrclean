/**
 * mrclean_redact tool — Plan 03-01 (MCP-02)
 *
 * Full redaction tool. Scans text through all four detection layers, applies
 * placeholder substitution, and writes one audit log record per finding.
 *
 * Threat model compliance:
 *   T-03-01-02: findingSchema never exposes raw `value` or `span`.
 *   T-03-01-04: supervisedToolCall wraps handler; throws become { isError: true }.
 *   T-03-01-06: placeholders are intentional — PH-04 format prevents confusion with secrets.
 *
 * MCP-03 invariant: redact tool is a one-way transform; no reverse path is registered.
 *   `readOnlyHint` is NOT set (this tool writes audit log records).
 */

import { z } from 'zod/v4'
import { randomUUID } from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { runDetection } from '../../detect/index.js'
import { supervisedToolCall } from '../supervisor.js'
import type { MrcleanConfig } from '../../shared/types.js'
import type { SessionState } from '../../detect/session-state.js'
import type { ResolvedFinding } from '../../detect/index.js'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const redactInputSchema = z.object({
  text: z.string(),
  sessionId: z.string().optional(),
})

/**
 * Finding DTO — safe subset exposed to MCP callers (same shape as check tool).
 * Never exposes raw `value` or `span`.
 */
const findingSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  placeholder: z.string(),
  redactedHash: z.string(),
  fingerprint: z.string(),
})

const redactOutputSchema = z.object({
  redacted: z.string(),
  findings: z.array(findingSchema),
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
 * Register the `mrclean_redact` tool on the given McpServer.
 *
 * @param server          - The McpServer instance to register on.
 * @param getConfig       - Closure returning the current effective MrcleanConfig.
 * @param getSessionState - Closure returning the current SessionState.
 * @param getCwd          - Closure returning the project root directory.
 */
export function registerRedactTool(
  server: McpServer,
  getConfig: () => MrcleanConfig,
  getSessionState: () => SessionState,
  getCwd: () => string,
): void {
  server.registerTool(
    'mrclean_redact',
    {
      title: 'Redact sensitive data from text',
      description:
        'Scan text through all mrclean detection layers, replace detected secrets ' +
        'with stable placeholders, and write one audit log record per finding. ' +
        'Returns the redacted text and a list of findings (without raw values). ' +
        'Use mrclean_check for a read-only scan with no audit log writes.',
      inputSchema: redactInputSchema,
      outputSchema: redactOutputSchema,
    },
    async (args) => {
      const { text, sessionId: providedSessionId } = args as z.infer<typeof redactInputSchema>
      const sessionId = providedSessionId ?? randomUUID()
      const ctx = {
        sessionId,
        hookEvent: 'UserPromptSubmit' as const,
        cwd: getCwd(),
      }

      const outcome = await supervisedToolCall(() =>
        runDetection(text, getConfig(), getSessionState(), ctx),
      )

      if (!outcome.ok) {
        return {
          content: [{ type: 'text' as const, text: `mrclean_redact error: ${outcome.error}` }],
          isError: true,
        }
      }

      const { substitutedText, findings: rawFindings, budgetExhausted } = outcome.result

      if (budgetExhausted) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'mrclean_redact aborted: detection budget exhausted',
            },
          ],
          isError: true,
        }
      }

      const findings = rawFindings.map(toFindingDTO)
      const structured = { redacted: substitutedText, findings }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      }
    },
  )
}
