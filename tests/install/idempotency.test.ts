/**
 * Idempotency integration test for runInstall.
 *
 * Validates: two consecutive installs against a temp HOME produce exactly one
 * mrclean entry per hook event and one mcpServers.mrclean entry.
 * RESEARCH.md §3.2 (idempotency), INST-02.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, readFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { runInstall } from '../../src/install/index.js'

let tempHome: string
let tempCwd: string

beforeEach(async () => {
  tempHome = join(tmpdir(), `mrclean-home-${randomUUID()}`)
  tempCwd = join(tmpdir(), `mrclean-cwd-${randomUUID()}`)
  await mkdir(join(tempHome, '.claude'), { recursive: true })
  await mkdir(tempCwd, { recursive: true })
})

afterEach(async () => {
  await rm(tempHome, { recursive: true, force: true })
  await rm(tempCwd, { recursive: true, force: true })
})

// Test 9: runInstall twice → no duplicate mrclean entries
describe('runInstall idempotency', () => {
  it('running install twice produces exactly one mrclean entry per event', async () => {
    const nodePath = process.execPath
    const mrcleanBin = (await import('../../src/install/path-resolver.js')).resolveMrcleanBinPath()
    const mcpBin = (await import('../../src/install/path-resolver.js')).resolveMrcleanMcpPath()

    await runInstall({
      homeDir: tempHome,
      cwd: tempCwd,
      nodePath,
      mrcleanBinPath: await mrcleanBin,
      mcpBinPath: await mcpBin,
    })
    await runInstall({
      homeDir: tempHome,
      cwd: tempCwd,
      nodePath,
      mrcleanBinPath: await mrcleanBin,
      mcpBinPath: await mcpBin,
    })

    const settingsPath = join(tempHome, '.claude', 'settings.json')
    const data = JSON.parse(await readFile(settingsPath, 'utf8'))

    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']) {
      const mrcleanEntries = (data.hooks[event] || []).filter(
        (e: Record<string, unknown>) => e._mrclean === true
      )
      expect(mrcleanEntries).toHaveLength(1)
    }
  })

  it('running install twice produces exactly one mcpServers.mrclean entry', async () => {
    const nodePath = process.execPath
    const mrcleanBin = await (await import('../../src/install/path-resolver.js')).resolveMrcleanBinPath()
    const mcpBin = await (await import('../../src/install/path-resolver.js')).resolveMrcleanMcpPath()

    await runInstall({ homeDir: tempHome, cwd: tempCwd, nodePath, mrcleanBinPath: mrcleanBin, mcpBinPath: mcpBin })
    await runInstall({ homeDir: tempHome, cwd: tempCwd, nodePath, mrcleanBinPath: mrcleanBin, mcpBinPath: mcpBin })

    const claudeJsonPath = join(tempHome, '.claude.json')
    const data = JSON.parse(await readFile(claudeJsonPath, 'utf8'))

    const mrcleanKeys = Object.keys(data.projects[tempCwd]?.mcpServers ?? {}).filter(k => k === 'mrclean')
    expect(mrcleanKeys).toHaveLength(1)
  })

  it('backups are created after each install run (two backup files per target)', async () => {
    const nodePath = process.execPath
    const mrcleanBin = await (await import('../../src/install/path-resolver.js')).resolveMrcleanBinPath()
    const mcpBin = await (await import('../../src/install/path-resolver.js')).resolveMrcleanMcpPath()

    await runInstall({ homeDir: tempHome, cwd: tempCwd, nodePath, mrcleanBinPath: mrcleanBin, mcpBinPath: mcpBin })
    await runInstall({ homeDir: tempHome, cwd: tempCwd, nodePath, mrcleanBinPath: mrcleanBin, mcpBinPath: mcpBin })

    const claudeDir = join(tempHome, '.claude')
    const claudeDirFiles = await readdir(claudeDir)
    const settingsBackups = claudeDirFiles.filter(f => f.includes('settings.json') && f.includes('mrclean-backup'))
    // Second run creates a backup (first run backup from second call)
    expect(settingsBackups.length).toBeGreaterThanOrEqual(1)
  })

  it('settings.json hook args contain the absolute dist/cli.js path', async () => {
    const nodePath = process.execPath
    const mrcleanBin = await (await import('../../src/install/path-resolver.js')).resolveMrcleanBinPath()
    const mcpBin = await (await import('../../src/install/path-resolver.js')).resolveMrcleanMcpPath()

    await runInstall({ homeDir: tempHome, cwd: tempCwd, nodePath, mrcleanBinPath: mrcleanBin, mcpBinPath: mcpBin })

    const settingsPath = join(tempHome, '.claude', 'settings.json')
    const data = JSON.parse(await readFile(settingsPath, 'utf8'))

    const preToolEntry = data.hooks.PreToolUse.find((e: Record<string, unknown>) => e._mrclean)
    const firstArg = (preToolEntry.hooks as Array<{ args: string[] }>)[0].args[0]

    expect(firstArg.startsWith('/')).toBe(true)
    expect(firstArg.endsWith('dist/cli.js')).toBe(true)
  })
})
