/**
 * Smoke tests for the mrclean scaffold.
 *
 * These tests verify that each src/ entrypoint module can be imported without
 * throwing, and that they export the documented API shapes. They do NOT invoke
 * any long-running operations (no server start, no stdin reads).
 *
 * Test 1: cli.ts resolves (module loads without crashing).
 * Test 2: mcp.ts resolves; importing it does NOT start the MCP server.
 * Test 3: shared/version.ts exports a non-empty VERSION string matching package.json.
 * Test 4: shared/types.ts resolves (TypeScript types compile and module loads).
 * Test 5: All stub modules export their documented function signatures.
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }

describe('mrclean scaffold smoke tests', () => {
  it('Test 1: cli.ts imports without throwing', async () => {
    // The module must not call program.parseAsync at import time
    await expect(import('../src/cli.js')).resolves.toBeDefined()
  })

  it('Test 2: mcp.ts imports without starting the server', async () => {
    // The entrypoint guard (import.meta.url check) must prevent server startup on import
    const mod = await import('../src/mcp.js')
    expect(mod).toBeDefined()
  })

  it('Test 3: shared/version.ts exports a non-empty VERSION matching package.json', async () => {
    const { VERSION } = await import('../src/shared/version.js')
    expect(typeof VERSION).toBe('string')
    expect(VERSION.length).toBeGreaterThan(0)
    expect(VERSION).toBe(pkg.version)
  })

  it('Test 4: shared/types.ts module loads (TypeScript compilation succeeded)', async () => {
    // This test verifies that shared/types.ts has no import errors and compiles.
    // Types themselves are erased at runtime; we just verify the module resolves.
    const mod = await import('../src/shared/types.js')
    expect(mod).toBeDefined()
  })

  it('Test 5: all stub modules export their documented function signatures', async () => {
    const { runInstall, runUninstall } = await import('../src/install/index.js')
    const { runHook } = await import('../src/hook/index.js')
    const { runDoctor } = await import('../src/doctor/index.js')
    const { runMcpServer } = await import('../src/mcp/server.js')

    expect(typeof runInstall).toBe('function')
    expect(typeof runUninstall).toBe('function')
    expect(typeof runHook).toBe('function')
    expect(typeof runDoctor).toBe('function')
    expect(typeof runMcpServer).toBe('function')
  })
})
