/**
 * Fail-closed crash guards for the mrclean hook.
 *
 * HOOK-05: Any uncaught exception or unhandled rejection must exit 2 with a
 * structured JSON error on stderr. Exit 2 causes Claude Code to block tool
 * calls (PreToolUse) and prompts (UserPromptSubmit).
 *
 * RESEARCH.md §5.4: Only the FIRST LINE of stderr is surfaced in the Claude
 * Code transcript. The entire error object must serialize to a SINGLE LINE of
 * JSON followed by \n so the operator sees machine-readable context.
 *
 * D-04 (Plan 07-01): this is the PRIME context-free leak vector — it fires before
 * any PII parse, so there are NO detection spans to scrub against. The raw
 * `err.message`, `err.stack`, and any echoed `reason` must NOT reach stderr. We
 * route the message through the `sanitizeForOutput()` context-free chokepoint
 * (static safe string), drop the raw stack echo entirely, and replace any context
 * `reason` (the stringified throw) with a static phase marker.
 */

import { sanitizeForOutput } from '../shared/sanitize-output.js'

/**
 * Writes a single line of structured JSON to stderr describing a fatal error.
 *
 * Critical constraint: the entire error object must be on ONE LINE.
 * JSON.stringify() produces a single line by default (no indentation). The raw
 * `err.stack` is NEVER embedded (D-04) — a static `stack: 'redacted'` marker
 * preserves the payload shape without echoing source paths or input text.
 */
export function writeFailClosedError(
  err: unknown,
  context: Record<string, unknown> & { version?: string },
): void {
  // D-04: context-free path (pre-parse, no spans). Scrub the message to a static safe
  // string and NEVER echo the raw err.stack.
  const rawMessage = err instanceof Error ? err.message : String(err)
  const message = sanitizeForOutput(rawMessage)

  // The crash guards pass `reason: String(reason)` (the stringified throw) in context —
  // that is the same raw error text and must not be echoed. Strip it from the spread and
  // replace with a static marker so the operator still knows the field was present.
  const { reason: _rawReason, ...safeContext } = context as Record<string, unknown>

  const payload: Record<string, unknown> = {
    error: 'mrclean hook crashed',
    message,
    ...safeContext,
    ...(_rawReason !== undefined ? { reason: 'redacted' } : {}),
    // Raw err.stack is intentionally NOT written (D-04). A static marker preserves shape.
    stack: 'redacted',
  }

  // Single-line JSON + newline — JSON.stringify with no indent args produces one line
  process.stderr.write(JSON.stringify(payload) + '\n')
}

/**
 * Install process-level crash guards. Call this at the very top of runHook()
 * before any other user code so every crash path is covered.
 *
 * HOOK-05 requirement: both uncaughtException and unhandledRejection must exit 2.
 *
 * @param version - Package version to embed in the error payload for operator triage.
 */
export function installCrashGuards(version: string): void {
  process.on('uncaughtException', (err: Error) => {
    writeFailClosedError(err, { version, phase: 'uncaughtException' })
    process.exit(2)
  })

  process.on('unhandledRejection', (reason: unknown) => {
    writeFailClosedError(
      reason instanceof Error ? reason : new Error(String(reason)),
      { version, phase: 'unhandledRejection', reason: String(reason) },
    )
    process.exit(2)
  })
}
