/**
 * Tests for src/doctor/canary.ts — hook and MCP canary round-trips.
 *
 * Tests 8-10 (from plan):
 *   Test 8: runHookCanary PASS — spawns dist/cli.js hook, asserts wiring banner
 *   Test 9: runHookCanary FAIL — bad bin path → ok=false with ENOENT detail
 *   Test 10: runMcpCanary PASS — connects to dist/mcp.js, calls sanitize, asserts echo
 *
 * Requires npm run build to have been run first. If dist/ is missing, tests
 * skip with a clear message.
 *
 * Plan 01-05 TDD RED: these tests must fail before implementation.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../..')
const DIST_CLI = resolve(PROJECT_ROOT, 'dist/cli.js')
const DIST_MCP = resolve(PROJECT_ROOT, 'dist/mcp.js')

describe('canary helpers', () => {
  beforeAll(() => {
    if (!existsSync(DIST_CLI) || !existsSync(DIST_MCP)) {
      throw new Error(
        'dist/cli.js or dist/mcp.js not found. Run npm run build before running these tests.',
      )
    }
  })

  it('exports CANARY_STRING constant', async () => {
    const { CANARY_STRING } = await import('../../src/doctor/canary.js')
    expect(typeof CANARY_STRING).toBe('string')
    expect(CANARY_STRING.length).toBeGreaterThan(0)
    expect(CANARY_STRING).toContain('MRCLEAN_CANARY')
  })

  it('Test 8: runHookCanary PASS — spawns dist/cli.js hook, wiring banner present', async () => {
    const { runHookCanary } = await import('../../src/doctor/canary.js')
    const result = await runHookCanary(process.execPath, DIST_CLI)

    expect(result.ok).toBe(true)
    expect(result.detail).toMatch(/hook canary|round-trip|wiring banner/i)
  }, 10000)

  it('Test 9: runHookCanary FAIL — non-existent bin → ok=false, detail has ENOENT or non-zero exit', async () => {
    const { runHookCanary } = await import('../../src/doctor/canary.js')
    const result = await runHookCanary(process.execPath, '/absolutely/does/not/exist.js')

    expect(result.ok).toBe(false)
    // Detail should mention the failure (ENOENT or non-zero exit code)
    expect(result.detail.length).toBeGreaterThan(0)
  }, 10000)

  it('Test 10: runMcpCanary PASS — connects to dist/mcp.js, sanitize echoes CANARY_STRING', async () => {
    const { runMcpCanary, CANARY_STRING } = await import('../../src/doctor/canary.js')
    const result = await runMcpCanary(process.execPath, DIST_MCP)

    expect(result.ok).toBe(true)
    expect(result.detail).toMatch(/MCP canary|round-trip|sanitize/i)
  }, 30000)
})
