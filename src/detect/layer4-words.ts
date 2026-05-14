/**
 * Layer 4 (user dirty-word list) for mrclean.
 *
 * Reads words.txt from:
 *   - ~/.mrclean/words.txt  (user-global, loaded first)
 *   - <cwd>/.mrclean/words.txt (project-local, overrides same-word global entries)
 *
 * Syntax (one entry per line):
 *   word              → action defaults to 'block'
 *   word|action       → action ∈ {block, warn, audit}; invalid actions default to 'block'
 *   # comment         → full-line or trailing comment (stripped before parsing)
 *   <blank line>      → ignored
 *
 * Match semantics: case-insensitive whole-word boundary regex (\bword\b, 'gi' flags).
 *
 * Rule IDs: word:<lowercased-word>  (e.g. "word:acme", "word:foobar")
 * Severity: HIGH — operator added these words deliberately.
 * Action: set per-word (orchestrator 02-04 normalises 'warn' → 'audit' on output).
 *
 * OWNED BY PLAN 02-02. Imports Finding/redactedHash/fingerprint from Plan 02-00.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Finding } from './findings.js'
import { redactedHash, fingerprint } from './findings.js'

// ---------------------------------------------------------------------------
// WordEntry
// ---------------------------------------------------------------------------

/**
 * A parsed entry from words.txt, ready for regex matching.
 */
export interface WordEntry {
  /** Original word text (preserves case as written in words.txt). */
  word: string
  /** Effective action for this word's matches. */
  action: 'block' | 'warn' | 'audit'
  /** Pre-compiled case-insensitive whole-word regex ('gi' flags). */
  re: RegExp
}

// ---------------------------------------------------------------------------
// parseWordsFile
// ---------------------------------------------------------------------------

/**
 * Parse the contents of a words.txt file into WordEntry[].
 *
 * Algorithm:
 *   1. Split into lines.
 *   2. Strip trailing `# comment` (regex /#.*$/).
 *   3. Trim whitespace; skip blank lines.
 *   4. Find first `|`; left = word, right = action (default 'block').
 *   5. Validate action ∈ {block, warn, audit}; coerce invalid to 'block'.
 *   6. Escape regex metacharacters in word.
 *   7. Compile RegExp with `\b${escaped}\b` pattern and 'gi' flags.
 *
 * @param content - Raw text content of a words.txt file.
 * @returns       - Array of WordEntry in file order.
 */
export function parseWordsFile(content: string): WordEntry[] {
  const entries: WordEntry[] = []
  const validActions = new Set<string>(['block', 'warn', 'audit'])

  for (const rawLine of content.split('\n')) {
    // Step 2: Strip trailing comment (# and everything after)
    const stripped = rawLine.replace(/#.*$/, '').trim()

    // Step 3: Skip blank lines
    if (stripped === '') continue

    // Step 4: Split on first `|`
    const pipeIndex = stripped.indexOf('|')
    const word = pipeIndex === -1 ? stripped : stripped.slice(0, pipeIndex)
    const rawAction = pipeIndex === -1 ? '' : stripped.slice(pipeIndex + 1).trim()

    if (word === '') continue

    // Step 5: Validate action
    const action: 'block' | 'warn' | 'audit' = validActions.has(rawAction)
      ? (rawAction as 'block' | 'warn' | 'audit')
      : 'block'

    // Step 6: Escape regex metacharacters
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // Step 7: Compile case-insensitive whole-word regex
    const re = new RegExp(`\\b${escaped}\\b`, 'gi') // PERF-03: per-word pattern from words.txt; parseWordsFile called once at session init (initSessionState), not on the hook hot path.

    entries.push({ word, action, re })
  }

  return entries
}

// ---------------------------------------------------------------------------
// loadWordsList
// ---------------------------------------------------------------------------

/**
 * Load and merge WordEntry lists from user-global and project-local words.txt files.
 *
 * Merge semantics:
 *   1. Parse user-global (~/.mrclean/words.txt) → build map keyed by lowercased word.
 *   2. Parse project-local (<cwd>/.mrclean/words.txt) → override same-word global entries.
 *   3. Return the merged map values as a WordEntry array.
 *
 * Missing files (ENOENT) → empty entry list (no error).
 *
 * @param opts.homeDir - User's home directory (e.g. process.env.HOME or os.homedir()).
 * @param opts.cwd     - Project root directory.
 * @returns            - Merged WordEntry array (project-local entries win on same-word conflicts).
 */
export async function loadWordsList({
  homeDir,
  cwd,
}: {
  homeDir: string
  cwd: string
}): Promise<WordEntry[]> {
  const globalPath = join(homeDir, '.mrclean', 'words.txt')
  const projectPath = join(cwd, '.mrclean', 'words.txt')

  async function readWords(filePath: string): Promise<WordEntry[]> {
    try {
      const content = await readFile(filePath, 'utf8')
      return parseWordsFile(content)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  const globalEntries = await readWords(globalPath)
  const projectEntries = await readWords(projectPath)

  // Merge: global first, then project overrides same-word entries
  const mergedMap = new Map<string, WordEntry>()

  for (const entry of globalEntries) {
    mergedMap.set(entry.word.toLowerCase(), entry)
  }

  for (const entry of projectEntries) {
    // Project-local wins on same-word conflict
    mergedMap.set(entry.word.toLowerCase(), entry)
  }

  return [...mergedMap.values()]
}

// ---------------------------------------------------------------------------
// runLayer4Words
// ---------------------------------------------------------------------------

/**
 * Scan `text` for matches against any WordEntry's regex.
 *
 * Each match produces one Finding per occurrence. The Finding's action field is set
 * directly from the WordEntry's action (the orchestrator 02-04 normalises 'warn' → 'audit').
 *
 * IMPORTANT: Each entry's regex uses the 'g' flag — reset lastIndex before each exec loop.
 *
 * @param text         - Source text to scan.
 * @param entries      - Loaded WordEntry list from loadWordsList().
 * @param coveredSpans - Spans claimed by prior layers. Skipped.
 * @returns            - Findings sorted by span.start ascending.
 */
export function runLayer4Words(
  text: string,
  entries: WordEntry[],
  coveredSpans: readonly { start: number; end: number }[] = [],
): Finding[] {
  const findings: Finding[] = []

  for (const entry of entries) {
    // Reset the regex state before each exec loop (global regex maintains lastIndex)
    entry.re.lastIndex = 0

    let match: RegExpExecArray | null
    // eslint-disable-next-line no-cond-assign
    while ((match = entry.re.exec(text)) !== null) {
      const matchedText = match[0]
      const spanStart = match.index
      const spanEnd = spanStart + matchedText.length

      // Skip if overlaps a covered span
      let covered = false
      for (const span of coveredSpans) {
        if (spanStart < span.end && span.start < spanEnd) {
          covered = true
          break
        }
      }
      if (covered) continue

      const ruleId = `word:${entry.word.toLowerCase()}`
      const hash = redactedHash(matchedText)
      const fp = fingerprint(ruleId, matchedText)

      findings.push({
        ruleId,
        severity: 'HIGH',
        span: { start: spanStart, end: spanEnd },
        value: matchedText,
        redactedHash: hash,
        fingerprint: fp,
        source: 'words',
        action: entry.action,
      })
    }
  }

  // Return sorted by span.start ascending
  return findings.sort((a, b) => a.span.start - b.span.start)
}
