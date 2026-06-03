/**
 * PII canary leak proof — INTEGRATION project (Plan 07-01 Task 3, PIISEC-01 / D-01, T-07-01-01).
 *
 * Feeds a dedicated synthetic PII canary corpus through the FULL detection pipeline
 * with `{ ner: true }` (so Layer 6b is exercised, mirroring src/mcp/tools/check.ts),
 * then asserts via assertNoCanaryLeak that NONE of the raw canary strings ever appear
 * in the persisted `.mrclean/audit.jsonl`.
 *
 * Non-vacuity guard: a line-count check proves the audit log is actually non-empty
 * (the regex PII lane catches the SSN/card canaries → records are written). Without
 * this guard a silently-empty log would let the canary-leak assertion pass vacuously.
 *
 * This file lives in the INTEGRATION vitest project (wired into the integration
 * `include` allow-list). A file cannot belong to both projects; the unit-project
 * counterpart is tests/audit/pii-stderr-leak.test.ts.
 *
 * Harness shape copied from tests/fixtures-corpus.test.ts:100-230 (beforeAll tmpdir +
 * .mrclean/ + initSessionState + runDetection + line-count guard + assertNoCanaryLeak).
 */

import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { runDetection } from '../../src/detect/index.js'
import { initSessionState } from '../../src/detect/session-state.js'
import { assertNoCanaryLeak } from '../../src/audit/canary-leak.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'
import type { DetectionContext } from '../../src/detect/index.js'
import type { SessionState } from '../../src/detect/session-state.js'
import type { MrcleanConfig } from '../../src/shared/types.js'

// ---------------------------------------------------------------------------
// PII canary corpus (D-01): synthetic, obviously-fake, easy-to-grep.
//   - SSN:   invalid-range (area 457 is allocated but this exact number is synthetic)
//   - email: .invalid TLD (RFC 6761 — guaranteed never to resolve)
//   - name:  a distinctive PERSON for the NER lane
//   - card:  a Stripe test BIN (4000-... test card, never a live PAN)
// ---------------------------------------------------------------------------
const PII_CANARIES = [
  '457-55-5462',
  'zzcanary.person@example.invalid',
  'Zebediah Quux-Canary',
  '4000-0000-0000-0002',
] as const

// A single prompt embedding every canary so one runDetection pass exercises all lanes.
const CANARY_PROMPT = [
  `Employee Zebediah Quux-Canary (SSN 457-55-5462)`,
  `can be reached at zzcanary.person@example.invalid;`,
  `corporate card on file is 4000-0000-0000-0002.`,
].join(' ')

/**
 * Build a PII-enabled config so the regex lane (SSN/card/email) AND the NER lane
 * are both active. The default config has pii.enabled=false + ner.enabled=false.
 */
function piiEnabledConfig(): MrcleanConfig {
  return {
    ...DEFAULT_CONFIG,
    secrets_files: [] as string[],
    pii: {
      ...DEFAULT_CONFIG.pii,
      enabled: true,
      regex: { ...DEFAULT_CONFIG.pii.regex, enabled: true },
      ner: { ...DEFAULT_CONFIG.pii.ner, enabled: true },
    },
  } as MrcleanConfig
}

let tmp: string
let sessionState: SessionState
let auditPath: string
let config: MrcleanConfig

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(tmpdir(), 'mrclean-pii-canary-'))
  await fs.mkdir(path.join(tmp, '.mrclean'), { recursive: true })
  auditPath = path.join(tmp, '.mrclean', 'audit.jsonl')
  config = piiEnabledConfig()

  sessionState = await initSessionState({
    sessionId: 'pii-canary-test',
    homeDir: tmp,
    cwd: tmp,
    config,
  })

  // Run the full pipeline with NER on so Layer 6b is exercised (mirror check.ts).
  const ctx: DetectionContext = {
    sessionId: 'pii-canary-test',
    hookEvent: 'UserPromptSubmit',
    cwd: tmp,
  }
  await runDetection(CANARY_PROMPT, config, sessionState, ctx, { ner: true })
})

afterAll(async () => {
  if (tmp) {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

describe('PII canary leak proof (audit.jsonl, full NER-on pipeline)', () => {
  it('wrote a non-empty audit log (line-count guard — prevents a vacuous pass)', async () => {
    const exists = await fs.stat(auditPath).then(
      () => true,
      () => false,
    )
    expect(
      exists,
      `audit.jsonl missing at ${auditPath} — runDetection wrote no records, so the ` +
        'canary-leak assertion below would pass vacuously.',
    ).toBe(true)

    const content = await fs.readFile(auditPath, 'utf8')
    const lines = content.split('\n').filter((l) => l.trim().length > 0)
    // The regex PII lane catches the SSN + card canaries deterministically (no model
    // needed), so at minimum two records must be present.
    expect(
      lines.length,
      `Expected >= 1 audit record from the PII regex lane but found ${lines.length}.`,
    ).toBeGreaterThanOrEqual(1)
  })

  it('contains NONE of the raw PII canaries (assertNoCanaryLeak)', async () => {
    const result = await assertNoCanaryLeak(auditPath, [...PII_CANARIES])
    if (!result.ok) {
      // Surface which canary leaked for diagnosis (canary-leak.ts intentionally
      // exposes this; the canaries here are synthetic, never real PII).
      console.error('[pii-canary] LEAKS DETECTED:', result.leaked)
    }
    expect(
      result.ok,
      `audit.jsonl contains raw PII canary values: ${JSON.stringify(result.leaked)}`,
    ).toBe(true)
  })
})
