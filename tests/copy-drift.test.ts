/**
 * Copy-drift gate — Plan 07-03 Task 3 (PIISEC-02 D-08, T-07-03-01/02/05).
 *
 * Permanently fails the build if compliance/guarantee CLAIM language enters any
 * user-facing copy source, and asserts the honest-framing disclaimer is present in
 * the README PII section (D-05). Single source of truth: BANNED_COPY_PHRASES and
 * PII_BEST_EFFORT_DISCLAIMER are imported from src/shared/strings.ts.
 *
 * Pitfall 5 (CRITICAL): the regexes ban claim SHAPES ("redacts all PII", "GDPR
 * compliant", "guarantees all ..."), NEVER the bare word "guarantee" — the honest
 * disclaimer itself contains "not a guarantee" and MUST pass. A self-check below
 * asserts the disclaimer string is not flagged.
 *
 * Comment-hygiene: source files (.ts) may legitimately mention "guarantee" in JSDoc
 * prose, so comment-only lines (^\s*[/*]) are stripped before scanning source files.
 * README is prose and is scanned whole.
 *
 * Scan-and-report shape inverts src/audit/canary-leak.ts (forbidden phrases instead
 * of forbidden canaries): accumulate offenders per source, fail if any.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BANNED_COPY_PHRASES, PII_BEST_EFFORT_DISCLAIMER } from '../src/shared/strings.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

/**
 * User-facing string sources scanned for banned CLAIM phrases (D-08).
 *   - isSource=true → strip comment-only lines before scanning (JSDoc may say "guarantee").
 *   - isSource=false (README) → scan whole (it is prose).
 */
const SCANNED_SOURCES: ReadonlyArray<{ rel: string; isSource: boolean }> = [
  { rel: 'README.md', isSource: false },
  { rel: 'src/shared/strings.ts', isSource: true },
  { rel: 'src/hook/handlers/session-start.ts', isSource: true },
  { rel: 'src/doctor/report.ts', isSource: true },
  { rel: 'src/mcp/tools/check.ts', isSource: true },
  { rel: 'src/mcp/tools/redact.ts', isSource: true },
]

/** A single banned-phrase hit. */
interface Offender {
  line: number
  phrase: string
  text: string
}

/** True if a source line is comment-only (leading `//`, `/*`, `*`). */
function isCommentLine(line: string): boolean {
  return /^\s*[/*]/.test(line)
}

/**
 * Scan a body of text line-by-line for any banned CLAIM phrase. When `stripComments`
 * is set, comment-only lines are skipped (JSDoc prose may mention "guarantee").
 */
function scanForBannedPhrases(content: string, stripComments: boolean): Offender[] {
  const offenders: Offender[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (stripComments && isCommentLine(line)) continue
    for (const rx of BANNED_COPY_PHRASES) {
      if (rx.test(line)) {
        offenders.push({ line: i + 1, phrase: rx.source, text: line.trim() })
      }
    }
  }
  return offenders
}

describe('copy-drift gate (D-08): banned CLAIM phrases', () => {
  it('no user-facing copy source contains a banned compliance/guarantee CLAIM phrase', () => {
    const allOffenders: Array<{ source: string } & Offender> = []
    for (const { rel, isSource } of SCANNED_SOURCES) {
      const content = readFileSync(path.join(repoRoot, rel), 'utf8')
      for (const o of scanForBannedPhrases(content, isSource)) {
        allOffenders.push({ source: rel, ...o })
      }
    }
    expect(
      allOffenders,
      `Banned overclaim copy found:\n${allOffenders
        .map((o) => `  ${o.source}:${o.line} [${o.phrase}] ${o.text}`)
        .join('\n')}`,
    ).toEqual([])
  })

  it('is non-vacuous: a synthetic "redacts all PII" input is flagged (positive control)', () => {
    const synthetic = 'mrclean redacts all PII and is fully compliant with GDPR.'
    const offenders = scanForBannedPhrases(synthetic, false)
    // Proves the detector actually fires — guards against a vacuous all-clean pass.
    expect(offenders.length).toBeGreaterThanOrEqual(1)
  })

  it('Pitfall 5 self-check: the honest disclaimer ("not a guarantee") is NOT flagged', () => {
    const offenders = scanForBannedPhrases(PII_BEST_EFFORT_DISCLAIMER, false)
    expect(offenders).toEqual([])
  })
})

describe('disclaimer-presence gate (D-05)', () => {
  it('the README PII section contains the disclaimer key phrase ("not a guarantee")', () => {
    const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8')
    // The disclaimer constant says "not a guarantee"; gate Task 2's README content on it.
    expect(readme).toContain('not a guarantee')
  })

  it('the centralized disclaimer constant itself carries the key phrase', () => {
    // Guards against the constant drifting away from the phrase the gate above asserts.
    expect(PII_BEST_EFFORT_DISCLAIMER).toContain('not a guarantee')
  })
})
