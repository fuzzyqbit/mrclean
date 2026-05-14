/**
 * PERF-03: Compile-once enforcement gate.
 *
 * Walks src/detect/**\/*.ts and asserts that every `new RegExp(` occurrence is
 * either:
 *   (a) at module scope (zero indentation), OR
 *   (b) inside a function whose name matches /lazy|once|memo|create.*Pool|get.*Pool/i, OR
 *   (c) annotated with `// PERF-03:` on the same line (line-level opt-out), OR
 *   (d) in a file annotated with `// PERF-03-FILE-EXEMPT:` (file-level opt-out).
 *
 * File-level exemptions (case d) are reserved for files where `new RegExp(` appears
 * inside template literal strings (worker source code) — not actual runtime calls.
 *
 * Line-level exemptions (case c) are used where per-call compilation is correct
 * by design (e.g., dynamic pattern from config, per-word regexes compiled at
 * session init, memoized-but-inside-function patterns).
 *
 * Enforcement purpose: prevent regression where a regex pattern is accidentally
 * moved into a per-call function body during refactoring, causing a latency spike
 * that would otherwise be invisible until the performance gate fires.
 */

import { test, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..')
const SRC_DETECT = resolve(REPO_ROOT, 'src', 'detect')

/** Function names that legitimately compile regexes inside their body. */
const LAZY_FN_RE = /(?:lazy|once|memo|create.*Pool|get.*Pool)/i

/** File-level opt-out marker — skips the entire file from scanning. */
const FILE_EXEMPT_MARKER = 'PERF-03-FILE-EXEMPT'

/** Line-level opt-out marker — skips a single occurrence. */
const LINE_EXEMPT_MARKER = 'PERF-03:'

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

/**
 * Recursively yield all .ts file paths under `dir`.
 * Skips node_modules and dist directories.
 */
function* walkTs(dir: string): Generator<string> {
  const entries = readdirSync(dir)
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      yield* walkTs(fullPath)
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      yield fullPath
    }
  }
}

// ---------------------------------------------------------------------------
// Occurrence classifier
// ---------------------------------------------------------------------------

interface RegExpOccurrence {
  lineNumber: number
  indent: number
  insideFunctionName: string | null
  hasLineMarker: boolean
}

/**
 * Simple stack-based function-scope tracker.
 *
 * Tracks the nearest enclosing function name by scanning for:
 *   - `function <name>(` or `async function <name>(`
 *   - `const <name> = function(` or `const <name> = async function(`
 *   - `const <name> = (...) =>` (arrow functions)
 *   - Class method signatures: `<name>(` with modifiers
 *
 * This is intentionally permissive — false negatives (missing function name)
 * are fine: they leave insideFunctionName as null, which the gate treats as
 * "unknown function" and rejects unless a PERF-03: annotation is present.
 *
 * IMPORTANT: Only push to scope stack when the const assignment is a FUNCTION
 * (has `=>` or `function` keyword in the assigned value), not for plain const
 * variable assignments like `const re = new RegExp(...)`.
 */
function findRegexCompiles(content: string): RegExpOccurrence[] {
  const lines = content.split('\n')
  const results: RegExpOccurrence[] = []

  // Track function scope via a stack of { name, openBraceCount }
  // openBraceCount is the cumulative `{` count at the point of function entry.
  type ScopeEntry = { name: string; openBraceCount: number }
  const scopeStack: ScopeEntry[] = []
  let cumulativeBraces = 0

  // Patterns for named function declarations
  const NAMED_FN_RE = /(?:^|\s)(?:async\s+)?function\s+(\w+)\s*\(/
  // const foo = function / const foo = async function
  const CONST_FN_EXPR_RE = /^\s*(?:export\s+)?(?:async\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?function\s*[(*]/
  // const foo = (...) => — must contain '=>' on the same line or next few lines
  const CONST_ARROW_DECL_RE = /^\s*(?:export\s+)?(?:async\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/
  // Class method: indented identifier followed by ( with optional modifiers
  const METHOD_RE = /^\s+(?:(?:private|public|protected|static|async|override|abstract)\s+)*(\w+)\s*\(/

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx] ?? ''
    const lineNumber = lineIdx + 1
    const trimmed = line.trimStart()

    // Skip pure comment lines for function detection (but still count braces)
    const isCommentLine = trimmed.startsWith('//') || trimmed.startsWith('*')

    // Count brace changes on this line (approximate — ignores strings/template literals)
    for (const ch of line) {
      if (ch === '{') cumulativeBraces++
      else if (ch === '}') {
        cumulativeBraces--
        // Pop scope entries closed by this brace
        while (scopeStack.length > 0) {
          const top = scopeStack[scopeStack.length - 1]!
          if (cumulativeBraces < top.openBraceCount) {
            scopeStack.pop()
          } else {
            break
          }
        }
      }
    }

    if (!isCommentLine) {
      // Detect function declarations / expressions and push onto scope stack
      // Order matters: check more specific patterns first.
      const namedFnMatch = NAMED_FN_RE.exec(line)
      const constFnExprMatch = CONST_FN_EXPR_RE.exec(line)
      const constArrowMatch = CONST_ARROW_DECL_RE.exec(line)

      if (namedFnMatch) {
        const name = namedFnMatch[1] ?? '<anonymous>'
        scopeStack.push({ name, openBraceCount: cumulativeBraces })
      } else if (constFnExprMatch) {
        const name = constFnExprMatch[1] ?? '<anonymous>'
        scopeStack.push({ name, openBraceCount: cumulativeBraces })
      } else if (constArrowMatch && line.includes('=>')) {
        // Only treat as arrow function if `=>` is on the same line
        const name = constArrowMatch[1] ?? '<anonymous>'
        scopeStack.push({ name, openBraceCount: cumulativeBraces })
      } else if (METHOD_RE.test(line) && line.includes('(') && line.trim() !== '') {
        // Class method — only push if it looks like a method definition (has opening paren)
        // and there's a brace-opening somewhere near (on this line or next)
        const methodMatch = METHOD_RE.exec(line)
        if (
          methodMatch &&
          !line.includes('new ') && // skip `new Foo(` constructor calls
          !line.includes('=>') // skip arrow assignments captured above
        ) {
          const name = methodMatch[1] ?? '<anonymous>'
          scopeStack.push({ name, openBraceCount: cumulativeBraces })
        }
      }
    }

    // Check for `new RegExp(` on this line
    if (!line.includes('new RegExp(')) continue

    const indent = line.length - trimmed.length

    // Determine the innermost enclosing function name
    const innermostScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : null
    const insideFunctionName = innermostScope?.name ?? null

    const hasLineMarker = line.includes(LINE_EXEMPT_MARKER)

    results.push({ lineNumber, indent, insideFunctionName, hasLineMarker })
  }

  return results
}

// ---------------------------------------------------------------------------
// Gate test
// ---------------------------------------------------------------------------

test('PERF-03: regex patterns compile at module scope or in lazy/pool init', () => {
  const violations: string[] = []

  for (const filePath of walkTs(SRC_DETECT)) {
    const content = readFileSync(filePath, 'utf8')

    // File-level opt-out (for template-literal worker source files)
    if (content.includes(FILE_EXEMPT_MARKER)) continue

    for (const occurrence of findRegexCompiles(content)) {
      // Line-level opt-out
      if (occurrence.hasLineMarker) continue

      // Module scope (zero indentation)
      if (occurrence.indent === 0) continue

      // Inside a function whose name matches the lazy/memo/pool pattern
      if (
        occurrence.insideFunctionName !== null &&
        LAZY_FN_RE.test(occurrence.insideFunctionName)
      ) {
        continue
      }

      // Violation found
      violations.push(
        `${filePath}:${occurrence.lineNumber} — ` +
          `new RegExp inside non-lazy function '${occurrence.insideFunctionName ?? '<unknown>'}'` +
          ` (indent=${occurrence.indent}). ` +
          `Add \`// PERF-03: <reason>\` to the line or \`// PERF-03-FILE-EXEMPT:\` to the file.`,
      )
    }
  }

  expect(violations).toEqual([])
})
