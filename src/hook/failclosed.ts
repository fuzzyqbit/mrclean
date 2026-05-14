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
 */

/**
 * Writes a single line of structured JSON to stderr describing a fatal error.
 *
 * Critical constraint: the entire error object must be on ONE LINE.
 * JSON.stringify() produces a single line by default (no indentation).
 * If `err.stack` is included, it's embedded as a JSON string value — no
 * embedded newlines appear because JSON strings escape \n to the literal `\n`.
 */
export function writeFailClosedError(
  err: unknown,
  context: Record<string, unknown> & { version?: string },
): void {
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error && err.stack ? err.stack : undefined

  const payload: Record<string, unknown> = {
    error: 'mrclean hook crashed',
    message,
    ...context,
    ...(stack !== undefined ? { stack } : {}),
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
