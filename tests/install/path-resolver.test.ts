/**
 * Tests for src/install/path-resolver.ts
 *
 * Validates: resolveNodePath returns absolute executable, resolveMrcleanBinPath resolves to dist/cli.js.
 * RESEARCH.md §3.4 (cross-platform path resolution), INST-04.
 */

import { describe, it, expect } from 'vitest'
import { access, constants } from 'node:fs/promises'

import {
  resolveNodePath,
  resolveMrcleanBinPath,
  resolveMrcleanMcpPath,
} from '../../src/install/path-resolver.js'

// Test 6: resolveNodePath returns absolute executable path
describe('resolveNodePath', () => {
  it('returns an absolute path (starts with /)', () => {
    const nodePath = resolveNodePath()
    expect(nodePath.startsWith('/')).toBe(true)
  })

  it('the returned path is executable', async () => {
    const nodePath = resolveNodePath()
    // access with X_OK should not throw
    await expect(access(nodePath, constants.X_OK)).resolves.toBeUndefined()
  })

  it('is the same as process.execPath', () => {
    expect(resolveNodePath()).toBe(process.execPath)
  })
})

// Test 7: resolveMrcleanBinPath returns absolute path ending in dist/cli.js
describe('resolveMrcleanBinPath', () => {
  it('returns an absolute path ending in dist/cli.js', async () => {
    const binPath = await resolveMrcleanBinPath()
    expect(binPath.startsWith('/')).toBe(true)
    expect(binPath.endsWith('dist/cli.js')).toBe(true)
  })

  it('the returned dist/cli.js file exists on disk (requires npm run build first)', async () => {
    const binPath = await resolveMrcleanBinPath()
    // This test requires that npm run build has been run; it verifies INST-04
    await expect(access(binPath)).resolves.toBeUndefined()
  })
})

describe('resolveMrcleanMcpPath', () => {
  it('returns an absolute path ending in dist/mcp.js', async () => {
    const mcpPath = await resolveMrcleanMcpPath()
    expect(mcpPath.startsWith('/')).toBe(true)
    expect(mcpPath.endsWith('dist/mcp.js')).toBe(true)
  })

  it('the returned dist/mcp.js file exists on disk (requires npm run build first)', async () => {
    const mcpPath = await resolveMrcleanMcpPath()
    await expect(access(mcpPath)).resolves.toBeUndefined()
  })
})
