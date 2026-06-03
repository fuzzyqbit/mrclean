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
import { sanitizeForOutput } from '../../shared/sanitize-output.js'
import { PII_BEST_EFFORT_DISCLAIMER } from '../../shared/strings.js'
import type { MrcleanConfig } from '../../shared/types.js'
import type { SessionState } from '../../detect/session-state.js'
import type { ResolvedFinding } from '../../detect/index.js'
import type { NerStatus } from '../../detect/layer6b-ner.js'

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
  // D-06 (PIISEC-02): stable machine-readable best-effort flag. A typed boolean (like the
  // nerStatus enum, NOT free text) so it can never carry matched PII (T-07-02-01). True ONLY
  // for the probabilistic NER lane; false for every deterministic finding. Derived from
  // `source` at map time — `source` itself is NEVER added to this schema (Pitfall 4).
  // Exact mirror of src/mcp/tools/check.ts findingSchema.
  bestEffort: z.boolean(),
})

const redactOutputSchema = z.object({
  redacted: z.string(),
  findings: z.array(findingSchema),
  // D-03: surface the Layer 6b NER lifecycle status to the MCP caller. An enum (not free-form
  // text) so it can never carry matched PII (T-06-03-03). 'disabled' on the no-NER path.
  nerStatus: z.enum(['ready', 'unavailable', 'loading', 'disabled']),
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
    // D-06: bestEffort is true ONLY for the probabilistic NER lane. `source` is read here at
    // map time but is never serialized into the DTO. Deterministic sources → false.
    // Exact mirror of src/mcp/tools/check.ts toFindingDTO.
    bestEffort: f.source === 'pii-ner',
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
 * @param getNerStatus    - Closure returning the live NER lifecycle status (boot preload, D-03/D-05).
 */
export function registerRedactTool(
  server: McpServer,
  getConfig: () => MrcleanConfig,
  getSessionState: () => SessionState,
  getCwd: () => string,
  getNerStatus: () => NerStatus,
): void {
  server.registerTool(
    'mrclean_redact',
    {
      title: 'Redact sensitive data from text',
      description:
        'Scan text through all mrclean detection layers, replace detected secrets ' +
        'with stable placeholders, and write one audit log record per finding. ' +
        'Returns the redacted text and a list of findings (without raw values). ' +
        'Use mrclean_check for a read-only scan with no audit log writes. ' +
        // D-05/D-07: once-per-output honest-framing disclaimer (single source of truth).
        PII_BEST_EFFORT_DISCLAIMER,
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

      // Pass { ner: true } so the MCP path opts into the Layer 6b NER lane (the hook path never
      // does — opts.ner is the sole structural gate, NER-01/D-04). NER errors are NOT caught here:
      // runLayer6bNer already fails closed internally; a tool-level catch would wrongly fail the
      // secret gate.
      const outcome = await supervisedToolCall(() =>
        runDetection(text, getConfig(), getSessionState(), ctx, { ner: true }),
      )

      if (!outcome.ok) {
        // D-03 (PATTERNS.md:228-229): route the surfaced tool-error text through the
        // sanitizeForOutput chokepoint (mirror of check.ts). Belt-and-suspenders over
        // 07-01's supervisor-level scrubbing. No spans at the tool boundary → pass [].
        const safe = sanitizeForOutput(`mrclean_redact error: ${outcome.error}`, [])
        return {
          content: [{ type: 'text' as const, text: safe }],
          isError: true,
        }
      }

      const { substitutedText, findings: rawFindings, budgetExhausted, nerStatus } = outcome.result

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
      // D-03: surface nerStatus. Prefer the per-run status from the DetectionResult; fall back to
      // the boot-preload closure when the run did not enter the L6b branch (e.g. NER config off).
      const structured = { redacted: substitutedText, findings, nerStatus: nerStatus ?? getNerStatus() }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      }
    },
  )
}
