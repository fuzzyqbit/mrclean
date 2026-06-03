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
import { PII_BEST_EFFORT_DISCLAIMER } from '../../shared/strings.js'
import type { MrcleanConfig } from '../../shared/types.js'
import type { SessionState } from '../../detect/session-state.js'
import type { ResolvedFinding } from '../../detect/index.js'
import type { NerStatus } from '../../detect/layer6b-ner.js'

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
  // D-06 (PIISEC-02): stable machine-readable best-effort flag. A typed boolean (like the
  // nerStatus enum, NOT free text) so it can never carry matched PII (T-07-02-01). True ONLY
  // for the probabilistic NER lane; false for every deterministic finding. Derived from
  // `source` at map time — `source` itself is NEVER added to this schema (Pitfall 4).
  bestEffort: z.boolean(),
})

const checkOutputSchema = z.object({
  findings: z.array(findingSchema),
  count: z.number(),
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
    // map time but is never serialized into the DTO (mirrors the nerStatus enum-not-free-text
    // discipline). Deterministic sources (secretlint/gitleaks/entropy/env/words/pii-regex) → false.
    bestEffort: f.source === 'pii-ner',
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
 * @param getNerStatus    - Closure returning the live NER lifecycle status (boot preload, D-03/D-05).
 */
export function registerCheckTool(
  server: McpServer,
  getConfig: () => MrcleanConfig,
  getSessionState: () => SessionState,
  getCwd: () => string,
  getNerStatus: () => NerStatus,
): void {
  server.registerTool(
    'mrclean_check',
    {
      title: 'Check text for sensitive data (read-only)',
      description:
        'Scan text through all mrclean detection layers and return findings. ' +
        'Does NOT redact the text or write any audit log entry. ' +
        'Use mrclean_redact to redact and audit-log findings. ' +
        // D-05/D-07: once-per-output honest-framing disclaimer (single source of truth).
        PII_BEST_EFFORT_DISCLAIMER,
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

      // Pass { ner: true } so the MCP path opts into the Layer 6b NER lane (the hook path never
      // does — opts.ner is the sole structural gate, NER-01/D-04). NER errors are NOT caught here:
      // runLayer6bNer already fails closed internally (returns status 'unavailable'); a tool-level
      // catch would wrongly fail the secret gate.
      const outcome = await supervisedToolCall(() =>
        runDetectionReadOnly(text, getConfig(), getSessionState(), ctx, { ner: true }),
      )

      if (!outcome.ok) {
        return {
          content: [{ type: 'text' as const, text: `mrclean_check error: ${outcome.error}` }],
          isError: true,
        }
      }

      const findings = outcome.result.findings.map(toFindingDTO)
      // D-03: surface nerStatus. Prefer the per-run status from the DetectionResult; fall back to
      // the boot-preload closure when the run did not enter the L6b branch (e.g. NER config off).
      const structured = {
        findings,
        count: findings.length,
        nerStatus: outcome.result.nerStatus ?? getNerStatus(),
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      }
    },
  )
}
