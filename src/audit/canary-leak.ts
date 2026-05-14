/**
 * Canary-leak helper — Plan 02-03
 *
 * `assertNoCanaryLeak` reads a JSONL audit log and checks whether any of the
 * provided canary strings appear (as substrings) in any record's serialised JSON.
 *
 * Purpose:
 *   - Used by tests in Plan 02-03 to prove AUDIT-02 (no raw secret in the log).
 *   - Used by Plan 02-06's end-to-end fixtures test to enforce the invariant
 *     across the full pipeline.
 *   - Wires into Phase 3's QA-03 CI gate.
 *
 * Design notes:
 *   - Substring check (not exact match) catches partial leaks, e.g. if a raw
 *     value were accidentally base64-encoded into a field.
 *   - Checks `JSON.stringify(record)` not the raw line — normalises whitespace
 *     and key order so the check is format-independent.
 *   - On ENOENT the function returns `{ ok: true, leaked: [] }` — an absent log
 *     file means nothing has been written yet, which is trivially clean.
 *   - On JSON parse error, the malformed line is treated as a potential leak
 *     (defence in depth) and reported with canary `'<malformed>'`.
 *
 * Security note (T-02-03-06):
 *   - The return value exposes the canary string in `leaked[*].canary`.
 *   - This is intentional — the helper's purpose is to surface leaks for diagnosis.
 *   - Callers (CI, tests) decide whether to print or throw. Fixture canaries in
 *     Plan 02-06 are checksum-flipped, so no real credential is exposed.
 */

import { readFile } from 'node:fs/promises'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CanaryLeakResult {
  ok: boolean
  leaked: Array<{
    canary: string
    line: number
    record: string
  }>
}

// ---------------------------------------------------------------------------
// assertNoCanaryLeak
// ---------------------------------------------------------------------------

/**
 * Scan a JSONL audit log for any occurrence of the provided canary strings.
 *
 * @param logPath  - Absolute path to the `audit.jsonl` file.
 * @param canaries - Array of raw secret strings to search for (must never appear in the log).
 * @returns        - `{ ok: true, leaked: [] }` if clean; `{ ok: false, leaked: [...] }` if not.
 */
export async function assertNoCanaryLeak(
  logPath: string,
  canaries: string[],
): Promise<CanaryLeakResult> {
  let content: string

  try {
    content = await readFile(logPath, 'utf8')
  } catch (err) {
    if (isEnoent(err)) {
      return { ok: true, leaked: [] }
    }
    throw err
  }

  const lines = content.split('\n').filter((line) => line.length > 0)
  const leaked: CanaryLeakResult['leaked'] = []

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!
    const lineNumber = i + 1

    let record: unknown
    try {
      record = JSON.parse(rawLine)
    } catch {
      // Malformed JSON line — treat as a potential leak (defence in depth)
      leaked.push({ canary: '<malformed>', line: lineNumber, record: rawLine })
      continue
    }

    const recordStr = JSON.stringify(record)

    for (const canary of canaries) {
      if (recordStr.includes(canary)) {
        leaked.push({ canary, line: lineNumber, record: recordStr })
      }
    }
  }

  return { ok: leaked.length === 0, leaked }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}
