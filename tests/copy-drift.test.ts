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
  // Reversible-mode section (08-06) carries guarantee-adjacent security prose —
  // covered by the banned-CLAIM scan so overclaims cannot drift in (feeds Phase 11).
  { rel: 'THREAT_MODEL.md', isSource: false },
  { rel: 'src/shared/strings.ts', isSource: true },
  { rel: 'src/hook/handlers/session-start.ts', isSource: true },
  { rel: 'src/doctor/report.ts', isSource: true },
  { rel: 'src/mcp/tools/check.ts', isSource: true },
  { rel: 'src/mcp/tools/redact.ts', isSource: true },
  // Doctor detail strings are user-facing encryption copy ("encrypted session
  // state adapter active") — under the gate since 11-07 (SC5).
  { rel: 'src/doctor/checks.ts', isSource: true },
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

/**
 * Encrypted-at-rest honesty rows — Plan 11-07 Task 2 (REVMODE-11, SC5,
 * T-11-07-01/03).
 *
 * Three encryption-overclaim SHAPES are banned (additive BANNED_COPY_PHRASES
 * entries in src/shared/strings.ts). Per new regex, the file's standard three
 * rows: full SCANNED_SOURCES scan clean, positive control (a synthetic
 * overclaim IS flagged), and an honest-copy self-check (the same-user
 * qualification and the doctor's encrypted-state detail are NOT flagged).
 * Pitfall 5 discipline: ban the claim shape, never the words honest copy
 * needs. Rule for future trips on LOCKED copy: NARROW THE REGEX — never edit
 * LOCKED constants, never weaken a row to vacuity (the positive control keeps
 * a narrowed regex honest).
 */

/** The honest key-custody qualification (THREAT_MODEL §4 shape) every ban must pass. */
const HONEST_ENCRYPTION_QUALIFICATION =
  'encrypted at rest; not a defense against a same-user local attacker'

/** Doctor's user-facing encrypted-state detail (LOCKED constant in src/doctor/checks.ts). */
const DOCTOR_ENCRYPTED_DETAIL =
  'reversible mode: enabled — encrypted session state adapter active'

/** The three 11-07 encryption-overclaim bans, resolved by regex-source fragment. */
const ENCRYPTION_OVERCLAIM_BANS = [
  {
    shape: 'absolute-safety claim (encrypt… cannot be read/recovered/decrypted)',
    sourceFragment: 'cannot be',
    syntheticOverclaim: 'The map is encrypted so its contents cannot be read by anyone.',
  },
  {
    shape: 'exclusive-access claim (only you/the operator can read/decrypt)',
    sourceFragment: 'only (?:you|the operator)',
    syntheticOverclaim: 'Only you can decrypt the session map.',
  },
  {
    shape: 'unconditional-safety claim (safe even if/when/from)',
    sourceFragment: 'safe even',
    syntheticOverclaim: 'With encryption enabled your data is safe even if the machine is stolen.',
  },
] as const

/** Resolve an 11-07 ban from BANNED_COPY_PHRASES by source fragment (throws — non-vacuous). */
function findBannedPhrase(sourceFragment: string): RegExp {
  const rx = BANNED_COPY_PHRASES.find((r) => r.source.includes(sourceFragment))
  if (!rx) {
    throw new Error(`BANNED_COPY_PHRASES has no entry whose source contains "${sourceFragment}"`)
  }
  return rx
}

/** Scan every SCANNED_SOURCES file with a SINGLE regex (same comment-stripping rules). */
function scanSourcesForSinglePhrase(rx: RegExp): Array<{ source: string } & Offender> {
  const offenders: Array<{ source: string } & Offender> = []
  for (const { rel, isSource } of SCANNED_SOURCES) {
    const content = readFileSync(path.join(repoRoot, rel), 'utf8')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (isSource && isCommentLine(line)) continue
      if (rx.test(line)) {
        offenders.push({ source: rel, line: i + 1, phrase: rx.source, text: line.trim() })
      }
    }
  }
  return offenders
}

describe('copy-drift gate extension (11-07): encrypted-at-rest overclaim shapes', () => {
  it.each(ENCRYPTION_OVERCLAIM_BANS)(
    'scan row: no scanned copy source trips the $shape ban',
    ({ sourceFragment }) => {
      const rx = findBannedPhrase(sourceFragment)
      const offenders = scanSourcesForSinglePhrase(rx)
      expect(
        offenders,
        `Encrypted-at-rest overclaim found:\n${offenders
          .map((o) => `  ${o.source}:${o.line} [${o.phrase}] ${o.text}`)
          .join('\n')}`,
      ).toEqual([])
    },
  )

  it.each(ENCRYPTION_OVERCLAIM_BANS)(
    'positive control: a synthetic $shape IS flagged',
    ({ sourceFragment, syntheticOverclaim }) => {
      const rx = findBannedPhrase(sourceFragment)
      // Proves the new ban actually fires — guards against a vacuous all-clean pass.
      expect(rx.test(syntheticOverclaim)).toBe(true)
    },
  )

  it.each(ENCRYPTION_OVERCLAIM_BANS)(
    'honest-copy self-check: the qualification and doctor detail pass the $shape ban',
    ({ sourceFragment }) => {
      const rx = findBannedPhrase(sourceFragment)
      // The honest key-custody qualification must never be collateral damage…
      expect(rx.test(HONEST_ENCRYPTION_QUALIFICATION)).toBe(false)
      // …nor the doctor's LOCKED encrypted-state detail (now a scanned source).
      expect(rx.test(DOCTOR_ENCRYPTED_DETAIL)).toBe(false)
    },
  )
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

/**
 * Reversible-mode presence gate — Plan 08-06 Task 1 (REVMODE-03, T-08-21);
 * anchors finalized by Plan 11-07 (REVMODE-11, SC5).
 *
 * Asserts THREAT_MODEL.md carries the '## Reversible Mode (v3.0)' section, its five
 * required H3 subsections (asserted on stable heading fragments so renumbering does
 * not break the gate), and the honest-framing key phrases. Future edits that
 * silently drop the section or a subsection fail the build.
 *
 * 11-07 finalized the section against the shipped implementation, so the required
 * anchors are now the shipped-fact stamp ('verified against the shipped
 * implementation') and the key-custody honesty fragment ('not a defense against a
 * same-user local attacker'); 'transcript ratchet' is kept. The drafted-era
 * 'design commitment' phrase is gone by design — Pitfall 8: that assertion swap
 * and the doc rewrite land in the SAME commit so the suite is never red between.
 */
const REQUIRED_REVERSIBLE_SUBSECTION_FRAGMENTS = [
  'blast radius',
  'secret floor',
  'wire re-entry',
  'key-custody',
  'residual risks',
] as const

/** Read THREAT_MODEL.md fresh per assertion — the file is small; no caching needed. */
function readThreatModel(): string {
  return readFileSync(path.join(repoRoot, 'THREAT_MODEL.md'), 'utf8')
}

describe('THREAT_MODEL reversible-mode presence gate (08-06, REVMODE-03)', () => {
  it("contains the '## Reversible Mode (v3.0)' section heading", () => {
    expect(readThreatModel()).toContain('## Reversible Mode (v3.0)')
  })

  it.each(REQUIRED_REVERSIBLE_SUBSECTION_FRAGMENTS)(
    'has an H3 subsection heading covering "%s"',
    (fragment) => {
      const h3Headings = readThreatModel()
        .split('\n')
        .filter((line) => line.startsWith('### '))
      expect(
        h3Headings.some((heading) => heading.toLowerCase().includes(fragment)),
        `No H3 heading in THREAT_MODEL.md contains "${fragment}". H3 headings found:\n${h3Headings.join('\n')}`,
      ).toBe(true)
    },
  )

  it("carries the honest-framing key phrase 'transcript ratchet'", () => {
    expect(readThreatModel()).toContain('transcript ratchet')
  })

  it("carries the shipped-fact stamp fragment 'verified against the shipped implementation'", () => {
    expect(readThreatModel()).toContain('verified against the shipped implementation')
  })

  it("carries the key-custody honesty fragment 'not a defense against a same-user local attacker'", () => {
    expect(readThreatModel()).toContain('not a defense against a same-user local attacker')
  })
})

/**
 * HOOK-CONTRACT session-UUID traceability gate — Plan 08-11 Task 3 (WR-03).
 *
 * The 08-09 regeneration replaced the findings artifact's evidence while
 * docs/HOOK-CONTRACT.md kept quoting the destroyed run's session ids
 * (08-VERIFICATION gap 2). This gate makes the doc's opening claim — "every
 * verdict traces to a recorded entry" — build-enforced: every session UUID
 * quoted in the doc must appear in tests/uat/artifacts/contract-findings.json,
 * so future regenerations that orphan a citation fail the offline unit suite.
 */
const SESSION_UUID_RX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

/** Extract deduplicated session UUIDs from a body of text (new array — no mutation). */
function extractSessionUuids(content: string): string[] {
  return Array.from(new Set(content.match(SESSION_UUID_RX) ?? []))
}

describe('HOOK-CONTRACT session-UUID traceability gate (08-11, WR-03)', () => {
  it('every session UUID quoted in HOOK-CONTRACT.md exists in contract-findings.json', () => {
    const doc = readFileSync(path.join(repoRoot, 'docs/HOOK-CONTRACT.md'), 'utf8')
    const artifact = readFileSync(path.join(repoRoot, 'tests/uat/artifacts/contract-findings.json'), 'utf8')

    const quotedUuids = extractSessionUuids(doc)
    // Non-vacuous guard: the doc must actually quote evidence sessions — an
    // empty extraction may not silently pass the membership check below.
    expect(quotedUuids.length).toBeGreaterThanOrEqual(1)

    const untraced = quotedUuids.filter((uuid) => !artifact.includes(uuid))
    expect(
      untraced,
      `HOOK-CONTRACT.md quotes session UUIDs with no entry in contract-findings.json:\n${untraced
        .map((uuid) => `  ${uuid}`)
        .join('\n')}`,
    ).toEqual([])
  })

  it('is non-vacuous: a fabricated UUID is flagged as untraced (positive control)', () => {
    const artifact = readFileSync(path.join(repoRoot, 'tests/uat/artifacts/contract-findings.json'), 'utf8')
    const synthetic = 'evidence from probe session 00000000-0000-4000-8000-000000000000 (fabricated)'
    const quotedUuids = extractSessionUuids(synthetic)
    const untraced = quotedUuids.filter((uuid) => !artifact.includes(uuid))
    // Proves the gate actually fires when a citation does not trace.
    expect(untraced).toEqual(quotedUuids)
    expect(untraced).toHaveLength(1)
  })
})
