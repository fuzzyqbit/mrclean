/**
 * Unit tests for src/doctor/checks.ts — six check functions.
 *
 * All tests run against synthetic JSON fixtures written to tmp directories.
 * No real ~/.claude/ files are touched.
 *
 * Plan 01-05 TDD RED: these tests must fail before implementation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  checkHooksRegistered,
  checkMcpRegistered,
  checkBinsExecutable,
  checkConfigLoad,
} from '../../src/doctor/checks.js'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, rm, chmod } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../..')
const DIST_CLI = resolve(PROJECT_ROOT, 'dist/cli.js')
const DIST_MCP = resolve(PROJECT_ROOT, 'dist/mcp.js')

// Helpers for synthetic JSON fixtures
async function makeTmpDir(): Promise<string> {
  const d = join(tmpdir(), `mrclean-check-test-${randomUUID()}`)
  await mkdir(d, { recursive: true })
  return d
}

function buildSettings(events: string[]): Record<string, unknown> {
  const hooks: Record<string, unknown[]> = {}
  const hookCmd = {
    type: 'command',
    command: process.execPath,
    args: [DIST_CLI, 'hook'],
    timeout: 10,
  }
  for (const event of events) {
    if (event === 'UserPromptSubmit') {
      hooks[event] = [{ _mrclean: true, hooks: [hookCmd] }]
    } else if (event === 'SessionStart') {
      hooks[event] = [{ _mrclean: true, matcher: 'startup', hooks: [hookCmd] }]
    } else {
      hooks[event] = [{ _mrclean: true, matcher: '*', hooks: [hookCmd] }]
    }
  }
  return { hooks }
}

function buildClaudeJson(projectCwd: string, includeMrclean = true): Record<string, unknown> {
  if (!includeMrclean) {
    return { projects: { [projectCwd]: { mcpServers: {} } } }
  }
  return {
    projects: {
      [projectCwd]: {
        mcpServers: {
          mrclean: {
            type: 'stdio',
            command: process.execPath,
            args: [DIST_MCP],
          },
        },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// checkHooksRegistered
// ---------------------------------------------------------------------------

describe('checkHooksRegistered', () => {
  it('Test 1: PASS — settings.json has mrclean entries for all 4 events', async () => {
    const tmp = await makeTmpDir()
    const settingsPath = join(tmp, 'settings.json')
    const allEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']
    await writeFile(settingsPath, JSON.stringify(buildSettings(allEvents), null, 2), 'utf8')

    const result = await checkHooksRegistered(settingsPath)

    expect(result.status).toBe('PASS')
    expect(result.name).toBe('hooks')
    expect(result.detail).toMatch(/4/)
    expect(typeof result.exitCodeOnFail).toBe('number')

    await rm(tmp, { recursive: true, force: true })
  })

  it('Test 2: FAIL — empty settings.json → no mrclean hook entries', async () => {
    const tmp = await makeTmpDir()
    const settingsPath = join(tmp, 'settings.json')
    await writeFile(settingsPath, '{}', 'utf8')

    const result = await checkHooksRegistered(settingsPath)

    expect(result.status).toBe('FAIL')
    expect(result.exitCodeOnFail).toBe(1)
    expect(result.detail).toMatch(/no mrclean hook entries/i)

    await rm(tmp, { recursive: true, force: true })
  })

  it('Test 3: FAIL — partial settings (only 2 of 4 events) → mentions missing events', async () => {
    const tmp = await makeTmpDir()
    const settingsPath = join(tmp, 'settings.json')
    const partialEvents = ['SessionStart', 'UserPromptSubmit']
    await writeFile(settingsPath, JSON.stringify(buildSettings(partialEvents), null, 2), 'utf8')

    const result = await checkHooksRegistered(settingsPath)

    expect(result.status).toBe('FAIL')
    expect(result.exitCodeOnFail).toBe(1)
    // Should mention the missing events
    expect(result.detail).toMatch(/PreToolUse|PostToolUse/i)

    await rm(tmp, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// checkMcpRegistered
// ---------------------------------------------------------------------------

describe('checkMcpRegistered', () => {
  it('Test 4: PASS — claude.json has mrclean MCP entry for projectCwd', async () => {
    const tmp = await makeTmpDir()
    const claudeJsonPath = join(tmp, '.claude.json')
    const cwd = '/some/project'
    await writeFile(claudeJsonPath, JSON.stringify(buildClaudeJson(cwd, true), null, 2), 'utf8')

    const result = await checkMcpRegistered(claudeJsonPath, cwd)

    expect(result.status).toBe('PASS')
    expect(result.name).toBe('mcp')
    expect(typeof result.exitCodeOnFail).toBe('number')

    await rm(tmp, { recursive: true, force: true })
  })

  it('Test 5: FAIL — claude.json missing mrclean MCP entry → exitCode 2', async () => {
    const tmp = await makeTmpDir()
    const claudeJsonPath = join(tmp, '.claude.json')
    const cwd = '/some/project'
    await writeFile(claudeJsonPath, JSON.stringify(buildClaudeJson(cwd, false), null, 2), 'utf8')

    const result = await checkMcpRegistered(claudeJsonPath, cwd)

    expect(result.status).toBe('FAIL')
    expect(result.exitCodeOnFail).toBe(2)

    await rm(tmp, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// checkBinsExecutable
// ---------------------------------------------------------------------------

describe('checkBinsExecutable', () => {
  it('Test 6: PASS — dist/cli.js and dist/mcp.js are executable', async () => {
    const tmp = await makeTmpDir()
    const cwd = tmp
    const settingsPath = join(tmp, 'settings.json')
    const claudeJsonPath = join(tmp, '.claude.json')

    const allEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']
    await writeFile(settingsPath, JSON.stringify(buildSettings(allEvents), null, 2), 'utf8')
    await writeFile(claudeJsonPath, JSON.stringify(buildClaudeJson(cwd, true), null, 2), 'utf8')

    const result = await checkBinsExecutable(settingsPath, claudeJsonPath, cwd)

    expect(result.status).toBe('PASS')
    expect(result.name).toBe('bins')
    expect(typeof result.exitCodeOnFail).toBe('number')

    await rm(tmp, { recursive: true, force: true })
  })

  it('Test 7: FAIL — chmod 644 on a bin → FAIL with exitCodeOnFail=3, names the file', async () => {
    const tmp = await makeTmpDir()
    const cwd = tmp

    // Copy dist/cli.js to a temp location and chmod it non-executable
    const fakeBin = join(tmp, 'fake-cli.js')
    const { copyFile } = await import('node:fs/promises')
    await copyFile(DIST_CLI, fakeBin)
    await chmod(fakeBin, 0o644)

    const settingsPath = join(tmp, 'settings.json')
    const claudeJsonPath = join(tmp, '.claude.json')

    // Build settings pointing to the non-executable fake bin
    const hookCmd = {
      type: 'command',
      command: process.execPath,
      args: [fakeBin, 'hook'],
      timeout: 10,
    }
    const settings = {
      hooks: {
        SessionStart: [{ _mrclean: true, matcher: 'startup', hooks: [hookCmd] }],
        UserPromptSubmit: [{ _mrclean: true, hooks: [hookCmd] }],
        PreToolUse: [{ _mrclean: true, matcher: '*', hooks: [hookCmd] }],
        PostToolUse: [{ _mrclean: true, matcher: '*', hooks: [hookCmd] }],
      },
    }
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
    await writeFile(claudeJsonPath, JSON.stringify(buildClaudeJson(cwd, true), null, 2), 'utf8')

    const result = await checkBinsExecutable(settingsPath, claudeJsonPath, cwd)

    expect(result.status).toBe('FAIL')
    expect(result.exitCodeOnFail).toBe(3)
    expect(result.detail).toContain(fakeBin)

    await rm(tmp, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// checkConfigLoad
// ---------------------------------------------------------------------------

describe('checkConfigLoad', () => {
  it('Test 12: PASS — no config files → uses bundled defaults', async () => {
    const homeDir = await makeTmpDir()
    const cwd = await makeTmpDir()

    const result = await checkConfigLoad(homeDir, cwd)

    expect(result.status).toBe('PASS')
    expect(result.name).toBe('config-load')
    expect(result.detail).toMatch(/defaults/i)

    await rm(homeDir, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  })

  it('Test 13: PASS — valid project-local config.toml → loaded successfully', async () => {
    const homeDir = await makeTmpDir()
    const cwd = await makeTmpDir()
    const configDir = join(cwd, '.mrclean')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'config.toml'), 'dry_run = true\n', 'utf8')

    const result = await checkConfigLoad(homeDir, cwd)

    expect(result.status).toBe('PASS')
    expect(result.detail).toMatch(/project|loaded/i)

    await rm(homeDir, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  })

  it('Test 14: FAIL — malformed TOML → FAIL with exitCodeOnFail=1, names the file', async () => {
    const homeDir = await makeTmpDir()
    const cwd = await makeTmpDir()
    const configDir = join(cwd, '.mrclean')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'config.toml'), 'this is = = = malformed\n', 'utf8')

    const result = await checkConfigLoad(homeDir, cwd)

    expect(result.status).toBe('FAIL')
    expect(result.exitCodeOnFail).toBe(1)
    expect(result.detail).toMatch(/malformed|config/i)

    await rm(homeDir, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  })
})
