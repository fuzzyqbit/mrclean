/**
 * Orchestrator integration tests for runDetection (src/detect/index.ts).
 *
 * Tests the full pipeline: Layer 1 → Layer 2 → Layer 3 → Layer 4 → placeholder
 * allocation → audit log → DetectionResult.
 *
 * Plan 02-04 — TDD test file (RED gate).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtemp, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MrcleanConfig } from '../../src/shared/types.js'
import type { SessionState } from '../../src/detect/session-state.js'
import type { EnvBlocklist } from '../../src/detect/layer3-env.js'
import type { WordEntry } from '../../src/detect/layer4-words.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid MrcleanConfig — uses DEFAULT_CONFIG to include pii (Phase 4-02) */
function makeConfig(overrides: Partial<MrcleanConfig> = {}): MrcleanConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  }
}

/** Empty env blocklist */
function emptyBlocklist(): EnvBlocklist {
  return { values: new Set(), meta: new Map() }
}

/** Minimal valid SessionState */
function makeSessionState(
  sessionId: string,
  overrides: Partial<SessionState> = {},
): SessionState {
  return {
    sessionId,
    envBlocklist: emptyBlocklist(),
    wordEntries: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

/** Create a temp dir with a .mrclean sub-directory for audit log writes */
async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mrclean-test-'))
  await mkdir(join(dir, '.mrclean'), { recursive: true })
  return dir
}

/** Create a temp dir WITHOUT the .mrclean sub-directory */
async function makeTmpDirNoMrclean(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'mrclean-no-mrclean-'))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runDetection orchestrator', () => {
  afterEach(() => {
    // Clear module-level caches between tests to avoid cross-test interference
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Test 1: Layer 1 fires, places placeholder, writes audit record
  // -------------------------------------------------------------------------
  it('Test 1: Layer 1 fires on AWS key — places placeholder, writes audit record', async () => {
    // Dynamically import to get fresh module state
    const { runDetection, shutdownDetection } = await import('../../src/detect/index.js')

    const cwd = await makeTmpDir()
    const sessionId = 'test-session-1'
    const text = 'The AWS key is AKIAIOSFODNN7EXAMPLX and nothing else'
    const config = makeConfig()
    const sessionState = makeSessionState(sessionId)
    const ctx = { sessionId, hookEvent: 'UserPromptSubmit' as const, cwd }

    const result = await runDetection(text, config, sessionState, ctx)

    // Should detect the AWS key
    expect(result.findings.length).toBeGreaterThanOrEqual(1)

    const awsFinding = result.findings.find(
      (f) => f.ruleId.toLowerCase().includes('aws'),
    )
    expect(awsFinding).toBeDefined()
    expect(awsFinding!.placeholder).toMatch(/^<MRCLEAN:AWS_KEY:\d{3}>$/)
    expect(awsFinding!.effectiveAction).toBe('block')

    // Substituted text should contain the placeholder, not the raw key
    expect(result.substitutedText).toContain(awsFinding!.placeholder)
    expect(result.substitutedText).not.toContain('AKIAIOSFODNN7EXAMPLX')

    // Audit log should have at least 1 line
    const auditPath = join(cwd, '.mrclean', 'audit.jsonl')
    const logContent = await readFile(auditPath, 'utf8')
    const lines = logContent.trim().split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThanOrEqual(1)

    const record = JSON.parse(lines[0]!)
    expect(record.sessionId).toBe(sessionId)
    expect(record.hookEvent).toBe('UserPromptSubmit')
    expect(record.ruleId).toBeDefined()

    await shutdownDetection()
  })

  // -------------------------------------------------------------------------
  // Test 2: Span-dedup proven — Layer 1 span suppresses Layer 2 on same region
  // -------------------------------------------------------------------------
  it('Test 2: Span-dedup — Layer 1 span prevents Layer 2 from duplicating the same span', async () => {
    const { runDetection, shutdownDetection } = await import('../../src/detect/index.js')

    const cwd = await makeTmpDir()
    const sessionId = 'test-session-2'
    // AWS key also has high entropy → would fire Layer 2 if not for span dedup
    const text = 'secret: AKIAIOSFODNN7EXAMPLX'
    const config = makeConfig({ entropy: { threshold: 3.0, min_length: 10 } })
    const sessionState = makeSessionState(sessionId)
    const ctx = { sessionId, hookEvent: 'UserPromptSubmit' as const, cwd }

    const result = await runDetection(text, config, sessionState, ctx)

    // Only one finding should cover the AWS key region (Layer 1 wins, Layer 2 skips)
    const awsRegionFindings = result.findings.filter((f) => f.value.includes('AKIAIOSFODNN7EXAMPLX'))
    expect(awsRegionFindings).toHaveLength(1)
    expect(awsRegionFindings[0]!.source).toBe('secretlint')

    await shutdownDetection()
  })

  // -------------------------------------------------------------------------
  // Test 3: Layer 3 fires when env value present
  // -------------------------------------------------------------------------
  it('Test 3: Layer 3 fires when env value is in the blocklist', async () => {
    const { runDetection, shutdownDetection } = await import('../../src/detect/index.js')

    const cwd = await makeTmpDir()
    const sessionId = 'test-session-3'
    const secretValue = 'secretvalue12345'
    const text = `the ${secretValue} leaked into the prompt`
    const config = makeConfig()

    const envBlocklist: EnvBlocklist = {
      values: new Set([secretValue]),
      meta: new Map([[secretValue, { sourceFile: '/home/user/.env' }]]),
    }
    const sessionState = makeSessionState(sessionId, { envBlocklist })
    const ctx = { sessionId, hookEvent: 'UserPromptSubmit' as const, cwd }

    const result = await runDetection(text, config, sessionState, ctx)

    const envFinding = result.findings.find((f) => f.source === 'env')
    expect(envFinding).toBeDefined()
    expect(envFinding!.ruleId).toBe('env:literal')
    expect(envFinding!.placeholder).toMatch(/^<MRCLEAN:ENV:\d{3}>$/)

    // Substituted text should replace the env value
    expect(result.substitutedText).not.toContain(secretValue)
    expect(result.substitutedText).toContain(envFinding!.placeholder)

    await shutdownDetection()
  })

  // -------------------------------------------------------------------------
  // Test 4: Layer 4 warn action normalizes to effectiveAction: 'audit' (LOCKED)
  // -------------------------------------------------------------------------
  it("Test 4: Layer 4 wordEntry.action='warn' produces effectiveAction='audit' (LOCKED criterion)", async () => {
    const { runDetection, shutdownDetection } = await import('../../src/detect/index.js')

    const cwd = await makeTmpDir()
    const sessionId = 'test-session-4'
    const text = 'contact ACME today'
    const config = makeConfig()

    const wordEntries: WordEntry[] = [
      {
        word: 'ACME',
        action: 'warn',
        re: /\bACME\b/gi,
      },
    ]
    const sessionState = makeSessionState(sessionId, { wordEntries })
    const ctx = { sessionId, hookEvent: 'UserPromptSubmit' as const, cwd }

    const result = await runDetection(text, config, sessionState, ctx)

    // LOCKED: exactly 1 finding with source='words' and ruleId='word:acme'
    const wordFinding = result.findings.find((f) => f.source === 'words')
    expect(wordFinding).toBeDefined()
    expect(wordFinding!.ruleId).toBe('word:acme')

    // LOCKED: effectiveAction must be 'audit' (NOT 'warn') — normalized by orchestrator step 8a
    expect(wordFinding!.effectiveAction).toBe('audit')

    // Also assert that substitutedText still contains the placeholder
    // ('audit' effectiveAction does NOT mean "don't substitute" — only dry_run suppresses substitution)
    expect(result.substitutedText).toContain(wordFinding!.placeholder)
    expect(result.substitutedText).not.toContain('ACME')

    await shutdownDetection()
  })

  // -------------------------------------------------------------------------
  // Test 5: dry_run=true coerces every action to audit + substitutedText === original
  // -------------------------------------------------------------------------
  it('Test 5: dry_run=true coerces every action to audit; substitutedText equals original input', async () => {
    const { runDetection, shutdownDetection } = await import('../../src/detect/index.js')

    const cwd = await makeTmpDir()
    const sessionId = 'test-session-5'
    const text = 'The AWS key is AKIAIOSFODNN7EXAMPLX in this prompt'
    const config = makeConfig({ dry_run: true })
    const sessionState = makeSessionState(sessionId)
    const ctx = { sessionId, hookEvent: 'UserPromptSubmit' as const, cwd }

    const result = await runDetection(text, config, sessionState, ctx)

    // Findings should exist (detection still runs)
    expect(result.findings.length).toBeGreaterThanOrEqual(1)

    // All effective actions must be 'audit'
    for (const finding of result.findings) {
      expect(finding.effectiveAction).toBe('audit')
    }

    // substitutedText must equal the original input (no substitution in dry_run)
    expect(result.substitutedText).toBe(text)

    await shutdownDetection()
  })

  // -------------------------------------------------------------------------
  // Test 6: Budget bail-out flag — 5+ timeouts → budgetExhausted: true
  // -------------------------------------------------------------------------
  it('Test 6: Budget bail-out — 5 timeouts from Layer 1 surfaces budgetExhausted: true', async () => {
    // Mock runLayer1 to return timeoutCount: 5
    vi.doMock('../../src/detect/layer1-regex/index.js', () => ({
      runLayer1: vi.fn().mockResolvedValue({ findings: [], timeoutCount: 5 }),
      getRuleCount: vi.fn().mockReturnValue({ secretlint: 1, gitleaks: 183, total: 184 }),
    }))

    const { runDetection, shutdownDetection } = await import('../../src/detect/index.js?budget=1')

    const cwd = await makeTmpDir()
    const sessionId = 'test-session-6'
    const text = 'some text'
    const config = makeConfig()
    const sessionState = makeSessionState(sessionId)
    const ctx = { sessionId, hookEvent: 'UserPromptSubmit' as const, cwd }

    const result = await runDetection(text, config, sessionState, ctx)

    expect(result.budgetExhausted).toBe(true)
    expect(result.rawTimeoutCount).toBe(5)

    await shutdownDetection()
    vi.doUnmock('../../src/detect/layer1-regex/index.js')
  })

  // -------------------------------------------------------------------------
  // Test 7: Placeholder stability across calls — same session + same value = same placeholder
  // -------------------------------------------------------------------------
  it('Test 7: Placeholder stability — same sessionId + same value returns same placeholder', async () => {
    const { runDetection, shutdownDetection } = await import('../../src/detect/index.js')

    const cwd = await makeTmpDir()
    const sessionId = 'test-session-7-stable'
    const secretValue = 'stableenv12345678'
    const text = `secret: ${secretValue}`
    const config = makeConfig()

    const envBlocklist: EnvBlocklist = {
      values: new Set([secretValue]),
      meta: new Map([[secretValue, { sourceFile: '/home/user/.env' }]]),
    }
    const sessionState = makeSessionState(sessionId, { envBlocklist })
    const ctx = { sessionId, hookEvent: 'UserPromptSubmit' as const, cwd }

    // First call
    const result1 = await runDetection(text, config, sessionState, ctx)
    const placeholder1 = result1.findings.find((f) => f.source === 'env')?.placeholder

    // Second call — same session, same value
    const result2 = await runDetection(text, config, sessionState, ctx)
    const placeholder2 = result2.findings.find((f) => f.source === 'env')?.placeholder

    expect(placeholder1).toBeDefined()
    expect(placeholder2).toBeDefined()
    expect(placeholder1).toBe(placeholder2)

    await shutdownDetection()
  })

  // -------------------------------------------------------------------------
  // Test 8: Audit log resilience — missing .mrclean/ dir does NOT throw
  // -------------------------------------------------------------------------
  it('Test 8: Audit log resilience — missing .mrclean/ does not throw from runDetection', async () => {
    const { runDetection, shutdownDetection } = await import('../../src/detect/index.js')

    // cwd points to a directory WITHOUT .mrclean/
    const cwd = await makeTmpDirNoMrclean()
    const sessionId = 'test-session-8'
    const secretValue = 'reslientenv12345'
    const text = `value: ${secretValue}`
    const config = makeConfig()

    const envBlocklist: EnvBlocklist = {
      values: new Set([secretValue]),
      meta: new Map([[secretValue, { sourceFile: '/home/user/.env' }]]),
    }
    const sessionState = makeSessionState(sessionId, { envBlocklist })
    const ctx = { sessionId, hookEvent: 'UserPromptSubmit' as const, cwd }

    // Must not throw even though .mrclean/ doesn't exist
    const result = await expect(
      runDetection(text, config, sessionState, ctx),
    ).resolves.toBeDefined()

    await shutdownDetection()
  })
})
