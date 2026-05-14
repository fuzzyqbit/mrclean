/**
 * Tests for `mrclean ignore <fingerprint>` — Plan 02-05 Task 2.
 *
 * Tests appendFingerprintToConfig idempotency, creation, and merging with
 * existing config.toml files. The fingerprint validation gate is also tested.
 *
 * CFG-04 requirement: idempotent append to [allowlist].fingerprints in
 * <cwd>/.mrclean/config.toml.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Helper to create a temp project directory
function makeTmpProject(): string {
  const dir = join(tmpdir(), `mrclean-ignore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

// Valid fingerprint shape: ruleId:16hexchars
const VALID_FP_1 = 'AWSAccessKey:abcdef1234567890'
const VALID_FP_2 = 'StripeSecretKey:0123456789abcdef'
const VALID_FP_3 = 'GithubToken:fedcba9876543210'

describe('appendFingerprintToConfig', () => {
  it('Test 1: new config.toml — creates .mrclean/config.toml with fingerprint', async () => {
    const tmpDir = makeTmpProject()

    try {
      const { appendFingerprintToConfig } = await import('../../src/install/ignore.js')
      const result = await appendFingerprintToConfig(tmpDir, VALID_FP_1)

      expect(result.added).toBe(true)
      const configPath = join(tmpDir, '.mrclean', 'config.toml')
      expect(existsSync(configPath)).toBe(true)

      // Parse the created file to verify fingerprint is there
      const { readConfigLayer } = await import('../../src/config/index.js')
      const parsed = await readConfigLayer(configPath)
      expect(parsed.allowlist?.fingerprints).toContain(VALID_FP_1)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('Test 2: existing config.toml with no allowlist — appends allowlist without losing other fields', async () => {
    const tmpDir = makeTmpProject()
    const mrcleanDir = join(tmpDir, '.mrclean')
    mkdirSync(mrcleanDir, { recursive: true })
    writeFileSync(join(mrcleanDir, 'config.toml'), 'dry_run = false\n')

    try {
      const { appendFingerprintToConfig } = await import('../../src/install/ignore.js')
      const result = await appendFingerprintToConfig(tmpDir, VALID_FP_1)

      expect(result.added).toBe(true)

      const { readConfigLayer } = await import('../../src/config/index.js')
      const parsed = await readConfigLayer(join(mrcleanDir, 'config.toml'))
      // dry_run preserved
      expect(parsed.dry_run).toBe(false)
      // fingerprint added
      expect(parsed.allowlist?.fingerprints).toContain(VALID_FP_1)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('Test 3: existing allowlist.fingerprints — appends new fingerprint without losing existing ones', async () => {
    const tmpDir = makeTmpProject()
    const mrcleanDir = join(tmpDir, '.mrclean')
    mkdirSync(mrcleanDir, { recursive: true })
    writeFileSync(
      join(mrcleanDir, 'config.toml'),
      `[allowlist]\nfingerprints = ["${VALID_FP_2}"]\n`,
    )

    try {
      const { appendFingerprintToConfig } = await import('../../src/install/ignore.js')
      const result = await appendFingerprintToConfig(tmpDir, VALID_FP_3)

      expect(result.added).toBe(true)

      const { readConfigLayer } = await import('../../src/config/index.js')
      const parsed = await readConfigLayer(join(mrcleanDir, 'config.toml'))
      expect(parsed.allowlist?.fingerprints).toContain(VALID_FP_2)
      expect(parsed.allowlist?.fingerprints).toContain(VALID_FP_3)
      expect(parsed.allowlist?.fingerprints?.length).toBe(2)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('Test 4: idempotent — same fingerprint twice → file unchanged (byte-compare)', async () => {
    const tmpDir = makeTmpProject()
    const mrcleanDir = join(tmpDir, '.mrclean')
    mkdirSync(mrcleanDir, { recursive: true })
    writeFileSync(
      join(mrcleanDir, 'config.toml'),
      `[allowlist]\nfingerprints = ["${VALID_FP_1}"]\n`,
    )

    try {
      const { appendFingerprintToConfig } = await import('../../src/install/ignore.js')

      // First call with existing fingerprint
      const result = await appendFingerprintToConfig(tmpDir, VALID_FP_1)
      expect(result.added).toBe(false)

      // File content must be byte-identical after the no-op
      const contentAfter = readFileSync(join(mrcleanDir, 'config.toml'), 'utf8')
      expect(contentAfter).toBe(`[allowlist]\nfingerprints = ["${VALID_FP_1}"]\n`)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('runIgnore — fingerprint validation', () => {
  it('Test 5: invalid fingerprint shape → process.exit(2) with stderr error', async () => {
    const { runIgnore } = await import('../../src/install/ignore.js')

    // Capture exit code via mock — since process.exit(2) terminates,
    // we test by catching the error thrown after the mock
    const originalExit = process.exit
    const originalStderr = process.stderr.write.bind(process.stderr)
    let exitCode: number | undefined
    let stderrOutput = ''

    process.exit = ((code?: number) => {
      exitCode = code ?? 0
      throw new Error(`process.exit(${code})`)
    }) as typeof process.exit

    process.stderr.write = ((chunk: unknown) => {
      stderrOutput += String(chunk)
      return true
    }) as typeof process.stderr.write

    try {
      await runIgnore({ fingerprint: 'not-a-fingerprint' })
    } catch (err) {
      // Expected: process.exit throws in our mock
    } finally {
      process.exit = originalExit
      process.stderr.write = originalStderr
    }

    expect(exitCode).toBe(2)
    expect(stderrOutput).toContain('[mrclean]')
  })
})
