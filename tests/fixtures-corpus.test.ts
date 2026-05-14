/**
 * End-to-end fixture corpus test (tsx path).
 *
 * Proves Phase 2 success criterion #4:
 *   - 100% recall on positive fixtures (12 files — one per secret type)
 *   - 0 false positives on negative fixtures (10 files — UUIDs, hashes, lorem, etc.)
 *
 * Also verifies the audit log discipline:
 *   - Line-count guard: audit.jsonl must exist AND have >= 12 lines after positives run
 *   - Canary-leak guard: no raw fixture value appears in any audit record
 *
 * Plan 02-06.
 */

import { beforeAll, afterAll, it, describe, expect } from 'vitest'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { runDetection } from '../src/detect/index.js'
import { initSessionState } from '../src/detect/session-state.js'
import { assertNoCanaryLeak } from '../src/audit/canary-leak.js'
import { DEFAULT_CONFIG } from '../src/config/defaults.js'
import type { DetectionContext } from '../src/detect/index.js'
import type { SessionState } from '../src/detect/session-state.js'

// ---------------------------------------------------------------------------
// Fixture inventory
// ---------------------------------------------------------------------------

/**
 * Raw values embedded in the positive fixture files (checksum-flipped).
 * Used for the canary-leak check — these must NOT appear in any audit record.
 */
const ALL_FIXTURE_VALUES = [
  'AKIAIOSFODNN7EXAMPLX',
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLXKEY',
  'ghp_1234567890abcdefGHIJKLMNOPQRSTUVWXYZ',
  'github_pat_11ABCDE0000000000000000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.XXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'sk_live_0000000000000000000000000000000x',
  'sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAT3BlbkFJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'xoxb-000000000000-000000000000-AAAAAAAAAAAAAAAAAAAAAAAAX',
  // Private key PEM: use a distinctive substring from the base64 body (not the header which may be too common)
  'MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEA',
  'secretvalue12345',
  'ACME_INTERNAL_CODENAME',
] as const

/** Positive fixture file names (relative to tests/fixtures/positive/) */
const POSITIVE_FIXTURES = [
  'aws-access-key.txt',
  'aws-secret-key.txt',
  'github-pat-classic.txt',
  'github-pat-fine-grained.txt',
  'jwt.txt',
  'stripe-live-key.txt',
  'openai-key.txt',
  'anthropic-key.txt',
  'slack-bot-token.txt',
  'private-key-pem.txt',
  'dotenv-derived.txt',
  'words-term.txt',
] as const

/** Negative fixture file names (relative to tests/fixtures/negative/) */
const NEGATIVE_FIXTURES = [
  'uuid-v4.txt',
  'uuid-v7.txt',
  'git-sha-40.txt',
  'git-sha-7.txt',
  'npm-integrity-sha512.txt',
  'cargo-lock-hash.txt',
  'md5-digest.txt',
  'sha256-digest.txt',
  'base64-image-header.txt',
  'lorem-ipsum.txt',
] as const

const FIXTURES_DIR = path.resolve(import.meta.dirname, 'fixtures')
const POSITIVE_DIR = path.join(FIXTURES_DIR, 'positive')
const NEGATIVE_DIR = path.join(FIXTURES_DIR, 'negative')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip comment lines (starting with #) and leading/trailing blank lines from fixture content.
 * The remaining text is what detection layers actually scan.
 */
function stripHeader(content: string): string {
  return content
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim()
}

// ---------------------------------------------------------------------------
// Test setup: tmp dir with .env and words.txt for Layer 3 + Layer 4
// ---------------------------------------------------------------------------

let tmp: string
let sessionState: SessionState
let auditPath: string

beforeAll(async () => {
  // Create a temp directory with the Layer 3 + Layer 4 fixture files
  tmp = await fs.mkdtemp(path.join(tmpdir(), 'mrclean-corpus-'))
  await fs.mkdir(path.join(tmp, '.mrclean'), { recursive: true })

  // Layer 3: .env file with the dotenv-derived fixture value
  await fs.writeFile(path.join(tmp, '.env'), 'MY_API_KEY=secretvalue12345\n', 'utf8')

  // Layer 4: words.txt with the words-term fixture value
  await fs.writeFile(
    path.join(tmp, '.mrclean', 'words.txt'),
    'ACME_INTERNAL_CODENAME\n',
    'utf8',
  )

  auditPath = path.join(tmp, '.mrclean', 'audit.jsonl')

  // Build session state (triggers Layer 3 env scan + Layer 4 words.txt load)
  const config = { ...DEFAULT_CONFIG, secrets_files: [] as string[] }
  sessionState = await initSessionState({
    sessionId: 'corpus-test',
    homeDir: tmp,
    cwd: tmp,
    config,
  })
})

afterAll(async () => {
  if (tmp) {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Positive fixture tests (12 total — 100% recall required)
// ---------------------------------------------------------------------------

describe('positive fixtures — Layer 1/2/3/4 recall', () => {
  for (const fixtureName of POSITIVE_FIXTURES) {
    it(`catches ${fixtureName}`, async () => {
      const filePath = path.join(POSITIVE_DIR, fixtureName)
      const raw = readFileSync(filePath, 'utf8')
      const text = stripHeader(raw)

      const ctx: DetectionContext = {
        sessionId: 'corpus-test',
        hookEvent: 'UserPromptSubmit',
        cwd: tmp,
      }

      const result = await runDetection(text, { ...DEFAULT_CONFIG, secrets_files: [] as string[] }, sessionState, ctx)

      expect(
        result.findings.length,
        `Expected >= 1 finding for ${fixtureName} but got 0.\nText scanned:\n${text}`,
      ).toBeGreaterThanOrEqual(1)
    })
  }
})

// ---------------------------------------------------------------------------
// Negative fixture tests (10 total — 0 false positives required)
// ---------------------------------------------------------------------------

describe('negative fixtures — no false positives', () => {
  for (const fixtureName of NEGATIVE_FIXTURES) {
    it(`does not flag ${fixtureName}`, async () => {
      const filePath = path.join(NEGATIVE_DIR, fixtureName)
      const raw = readFileSync(filePath, 'utf8')
      const text = stripHeader(raw)

      const ctx: DetectionContext = {
        sessionId: 'corpus-test',
        hookEvent: 'UserPromptSubmit',
        cwd: tmp,
      }

      const result = await runDetection(text, { ...DEFAULT_CONFIG, secrets_files: [] as string[] }, sessionState, ctx)

      expect(
        result.findings,
        `Expected 0 findings for ${fixtureName} but got ${result.findings.length}.\nText scanned:\n${text}\nFindings:\n${JSON.stringify(result.findings.map((f) => ({ ruleId: f.ruleId, value: f.value.slice(0, 20) + '...' })), null, 2)}`,
      ).toEqual([])
    })
  }
})

// ---------------------------------------------------------------------------
// Audit log discipline tests (must run AFTER positive fixtures)
// ---------------------------------------------------------------------------

describe('audit log discipline', () => {
  it('audit log was actually written (line-count guard)', async () => {
    const exists = await fs.stat(auditPath).then(
      () => true,
      () => false,
    )
    expect(
      exists,
      `audit.jsonl missing at ${auditPath} — runDetection may not be writing audit records`,
    ).toBe(true)

    const content = await fs.readFile(auditPath, 'utf8')
    const lines = content.split('\n').filter((l) => l.trim().length > 0)
    expect(
      lines.length,
      `Expected >= 12 audit records (one per positive fixture minimum) but found ${lines.length}. ` +
        'If runDetection is not writing audit records, the canary-leak check below would pass vacuously.',
    ).toBeGreaterThanOrEqual(12)
    // Note: actual count may be higher — Layer 1 may emit multiple records per fixture
    // when both secretlint and gitleaks catch the same shape (dedup reduces but may not fully collapse).
  })

  it('audit log contains no raw fixture values (canary-leak guard)', async () => {
    const canaries = [...ALL_FIXTURE_VALUES]
    const result = await assertNoCanaryLeak(auditPath, canaries)
    if (!result.ok) {
      console.error('[corpus] CANARY LEAKS DETECTED:', result.leaked)
    }
    expect(result.ok, `Audit log contains raw fixture values: ${JSON.stringify(result.leaked)}`).toBe(true)
  })
})
