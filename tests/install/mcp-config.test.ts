/**
 * Tests for src/install/mcp-config.ts
 *
 * Validates: MCP server entry written with correct shape, idempotency,
 * preservation of sibling servers, removeMcpServerEntry.
 * RESEARCH.md §2.2 (mcpServers JSON shape), §3.2 (idempotency), OQ-3.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, readFile, rm, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { writeMcpServerEntry, removeMcpServerEntry } from '../../src/install/mcp-config.js'

const FIXTURE_EMPTY = new URL('../../tests/fixtures/claudejson/empty.json', import.meta.url).pathname
const FIXTURE_WITH_MCP = new URL('../../tests/fixtures/claudejson/with-other-mcp.json', import.meta.url).pathname

let testDir: string
let claudeJsonPath: string

beforeEach(async () => {
  testDir = join(tmpdir(), `mrclean-mcp-test-${randomUUID()}`)
  await mkdir(testDir, { recursive: true })
  claudeJsonPath = join(testDir, 'claude.json')
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

// Test 5: writeMcpServerEntry writes mcpServers.mrclean in the correct shape
describe('writeMcpServerEntry', () => {
  it('writes mcpServers.mrclean entry with correct stdio shape', async () => {
    await copyFile(FIXTURE_EMPTY, claudeJsonPath)

    await writeMcpServerEntry(claudeJsonPath, '/usr/bin/node', '/path/to/mcp.js', '/my/project')

    const data = JSON.parse(await readFile(claudeJsonPath, 'utf8'))

    expect(data.projects).toBeDefined()
    expect(data.projects['/my/project']).toBeDefined()
    expect(data.projects['/my/project'].mcpServers).toBeDefined()

    const mrclean = data.projects['/my/project'].mcpServers.mrclean
    expect(mrclean).toEqual({
      type: 'stdio',
      command: '/usr/bin/node',
      args: ['/path/to/mcp.js'],
    })
  })

  // Test 6: Pre-existing MCP servers in same project are preserved
  it('preserves pre-existing MCP servers under the same project', async () => {
    await copyFile(FIXTURE_WITH_MCP, claudeJsonPath)

    await writeMcpServerEntry(claudeJsonPath, '/usr/bin/node', '/path/to/mcp.js', '/other/project')

    const data = JSON.parse(await readFile(claudeJsonPath, 'utf8'))

    // Original server preserved
    expect(data.projects['/other/project'].mcpServers.someserver).toBeDefined()
    // mrclean added
    expect(data.projects['/other/project'].mcpServers.mrclean).toBeDefined()
  })

  it('preserves other projects when writing to a new project path', async () => {
    await copyFile(FIXTURE_WITH_MCP, claudeJsonPath)

    await writeMcpServerEntry(claudeJsonPath, '/usr/bin/node', '/path/to/mcp.js', '/new/project')

    const data = JSON.parse(await readFile(claudeJsonPath, 'utf8'))

    // Original project preserved
    expect(data.projects['/other/project']).toBeDefined()
    expect(data.projects['/other/project'].mcpServers.someserver).toBeDefined()
    // New project added
    expect(data.projects['/new/project'].mcpServers.mrclean).toBeDefined()
  })

  // Test 7: Re-running overwrites mrclean entry (idempotent self-upgrade)
  it('is idempotent — re-running overwrites mrclean without touching siblings', async () => {
    await copyFile(FIXTURE_WITH_MCP, claudeJsonPath)

    await writeMcpServerEntry(claudeJsonPath, '/usr/bin/node', '/path/v1/mcp.js', '/other/project')
    await writeMcpServerEntry(claudeJsonPath, '/usr/bin/node', '/path/v2/mcp.js', '/other/project')

    const data = JSON.parse(await readFile(claudeJsonPath, 'utf8'))
    const mrclean = data.projects['/other/project'].mcpServers.mrclean

    // Should have the updated path
    expect(mrclean.args[0]).toBe('/path/v2/mcp.js')

    // Sibling preserved
    expect(data.projects['/other/project'].mcpServers.someserver).toBeDefined()

    // Exactly one mrclean entry
    const keys = Object.keys(data.projects['/other/project'].mcpServers)
    const mrcleanKeys = keys.filter(k => k === 'mrclean')
    expect(mrcleanKeys).toHaveLength(1)
  })

  it('creates a backup before writing', async () => {
    await copyFile(FIXTURE_EMPTY, claudeJsonPath)

    await writeMcpServerEntry(claudeJsonPath, '/usr/bin/node', '/path/to/mcp.js', '/my/project')

    const { readdir } = await import('node:fs/promises')
    const files = await readdir(testDir)
    const backups = files.filter(f => f.includes('mrclean-backup'))
    expect(backups.length).toBeGreaterThan(0)
  })
})

// Test 8: removeMcpServerEntry deletes mrclean key; siblings untouched
describe('removeMcpServerEntry', () => {
  it('removes the mrclean server entry, preserving siblings', async () => {
    await copyFile(FIXTURE_WITH_MCP, claudeJsonPath)

    await writeMcpServerEntry(claudeJsonPath, '/usr/bin/node', '/path/to/mcp.js', '/other/project')
    await removeMcpServerEntry(claudeJsonPath, '/other/project')

    const data = JSON.parse(await readFile(claudeJsonPath, 'utf8'))

    expect(data.projects['/other/project'].mcpServers.mrclean).toBeUndefined()
    expect(data.projects['/other/project'].mcpServers.someserver).toBeDefined()
  })

  it('leaves empty mcpServers object when mrclean was the only entry', async () => {
    await copyFile(FIXTURE_EMPTY, claudeJsonPath)

    await writeMcpServerEntry(claudeJsonPath, '/usr/bin/node', '/path/to/mcp.js', '/my/project')
    await removeMcpServerEntry(claudeJsonPath, '/my/project')

    const data = JSON.parse(await readFile(claudeJsonPath, 'utf8'))

    // mcpServers key remains (empty object, not deleted)
    expect(data.projects['/my/project'].mcpServers).toEqual({})
  })

  it('is a no-op when mrclean entry does not exist', async () => {
    await copyFile(FIXTURE_WITH_MCP, claudeJsonPath)

    // Should not throw
    await expect(removeMcpServerEntry(claudeJsonPath, '/other/project')).resolves.toBeUndefined()

    const data = JSON.parse(await readFile(claudeJsonPath, 'utf8'))
    expect(data.projects['/other/project'].mcpServers.someserver).toBeDefined()
  })
})
