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
  checkReversibleState,
  extractRegisteredPaths,
} from '../../src/doctor/checks.js'
import { buildHookCommand } from '../../src/install/settings.js'
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
  // Use the shipped wrapper builder so fixtures stay in lock-step with the
  // installer's actual output (fail-closed /bin/sh wrapper on POSIX).
  const hookCmd = buildHookCommand(process.execPath, DIST_CLI)
  for (const event of events) {
    if (event === 'UserPromptSubmit') {
      hooks[event] = [{ _mrclean: true, hooks: [hookCmd] }]
    } else if (event === 'SessionStart') {
      hooks[event] = [
        { _mrclean: true, matcher: 'startup|resume|clear|compact', hooks: [hookCmd] },
      ]
    } else if (event === 'SessionEnd') {
      // SessionEnd matchers filter on `reason` — the installer registers it
      // with NO matcher key so the handler sees ALL reasons (08-02).
      hooks[event] = [{ _mrclean: true, hooks: [hookCmd] }]
    } else {
      hooks[event] = [{ _mrclean: true, matcher: '*', hooks: [hookCmd] }]
    }
  }
  return { hooks }
}

/** The full 5-event hook surface required by doctor as of Phase 8 (08-03). */
const ALL_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
]

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
  it('Test 1: PASS — settings.json has mrclean entries for all 5 events', async () => {
    const tmp = await makeTmpDir()
    const settingsPath = join(tmp, 'settings.json')
    await writeFile(settingsPath, JSON.stringify(buildSettings(ALL_EVENTS), null, 2), 'utf8')

    const result = await checkHooksRegistered(settingsPath)

    expect(result.status).toBe('PASS')
    expect(result.name).toBe('hooks')
    expect(result.detail).toMatch(/5 hook events registered/)
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

  it('Test 3: FAIL — partial settings (only 2 of 5 events) → mentions missing events', async () => {
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

  it('Test 3b: FAIL — legacy 4-event install (missing SessionEnd) → mentions SessionEnd', async () => {
    const tmp = await makeTmpDir()
    const settingsPath = join(tmp, 'settings.json')
    // The pre-Phase-8 installer surface: everything except SessionEnd.
    const legacyEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']
    await writeFile(settingsPath, JSON.stringify(buildSettings(legacyEvents), null, 2), 'utf8')

    const result = await checkHooksRegistered(settingsPath)

    expect(result.status).toBe('FAIL')
    expect(result.exitCodeOnFail).toBe(1)
    expect(result.detail).toMatch(/SessionEnd/)
    expect(result.detail).toMatch(/mrclean install/i)

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

    await writeFile(settingsPath, JSON.stringify(buildSettings(ALL_EVENTS), null, 2), 'utf8')
    await writeFile(claudeJsonPath, JSON.stringify(buildClaudeJson(cwd, true), null, 2), 'utf8')

    const result = await checkBinsExecutable(settingsPath, claudeJsonPath, cwd)

    expect(result.status).toBe('PASS')
    expect(result.name).toBe('bins')
    expect(typeof result.exitCodeOnFail).toBe('number')

    await rm(tmp, { recursive: true, force: true })
  })

  it('Test 7: FAIL (POSIX) — chmod 644 on a bin → exitCodeOnFail=3, fail-closed BLOCK wording', async () => {
    const tmp = await makeTmpDir()
    const cwd = tmp

    // Copy dist/cli.js to a temp location and chmod it non-executable
    const fakeBin = join(tmp, 'fake-cli.js')
    const { copyFile } = await import('node:fs/promises')
    await copyFile(DIST_CLI, fakeBin)
    await chmod(fakeBin, 0o644)

    const settingsPath = join(tmp, 'settings.json')
    const claudeJsonPath = join(tmp, '.claude.json')

    // Build settings via the shipped wrapper, pointing at the non-executable
    // fake bin — doctor must extract the bin from the wrapper tail.
    const hookCmd = buildHookCommand(process.execPath, fakeBin, 'linux')
    const settings = {
      hooks: {
        SessionStart: [
          { _mrclean: true, matcher: 'startup|resume|clear|compact', hooks: [hookCmd] },
        ],
        SessionEnd: [{ _mrclean: true, hooks: [hookCmd] }],
        UserPromptSubmit: [{ _mrclean: true, hooks: [hookCmd] }],
        PreToolUse: [{ _mrclean: true, matcher: '*', hooks: [hookCmd] }],
        PostToolUse: [{ _mrclean: true, matcher: '*', hooks: [hookCmd] }],
      },
    }
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
    await writeFile(claudeJsonPath, JSON.stringify(buildClaudeJson(cwd, true), null, 2), 'utf8')

    // Explicit POSIX platform → deterministic fail-closed wording regardless
    // of the host the tests run on.
    const result = await checkBinsExecutable(settingsPath, claudeJsonPath, cwd, 'linux')

    expect(result.status).toBe('FAIL')
    expect(result.exitCodeOnFail).toBe(3)
    expect(result.detail).toContain(fakeBin)
    // Fail-closed messaging: doctor must state the block-until-reinstall
    // consequence of a missing/non-executable bin (POSIX wrapper).
    expect(result.detail).toMatch(/BLOCKS every tool call/i)
    expect(result.detail).toMatch(/exit 2|fail-closed/i)
    expect(result.detail).toMatch(/mrclean install/i)
    // Must NOT carry the win32 fail-open wording on POSIX.
    expect(result.detail).not.toMatch(/fails OPEN|UNPROTECTED/i)

    await rm(tmp, { recursive: true, force: true })
  })

  it('Test 7b: FAIL (win32) — missing bin → honest fail-OPEN warning, no false BLOCK reassurance', async () => {
    const tmp = await makeTmpDir()
    const cwd = tmp

    // Copy dist/cli.js to a temp location and chmod it non-executable
    const fakeBin = join(tmp, 'fake-cli.js')
    const { copyFile } = await import('node:fs/promises')
    await copyFile(DIST_CLI, fakeBin)
    await chmod(fakeBin, 0o644)

    const settingsPath = join(tmp, 'settings.json')
    const claudeJsonPath = join(tmp, '.claude.json')

    // win32 installs the plain exec form (known-gap, fail-OPEN on spawn
    // failure) — doctor must mirror that posture in its FAIL wording instead
    // of claiming the POSIX wrapper blocks tool calls (WR-01).
    const hookCmd = buildHookCommand(process.execPath, fakeBin, 'win32')
    const settings = {
      hooks: {
        SessionStart: [
          { _mrclean: true, matcher: 'startup|resume|clear|compact', hooks: [hookCmd] },
        ],
        SessionEnd: [{ _mrclean: true, hooks: [hookCmd] }],
        UserPromptSubmit: [{ _mrclean: true, hooks: [hookCmd] }],
        PreToolUse: [{ _mrclean: true, matcher: '*', hooks: [hookCmd] }],
        PostToolUse: [{ _mrclean: true, matcher: '*', hooks: [hookCmd] }],
      },
    }
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
    await writeFile(claudeJsonPath, JSON.stringify(buildClaudeJson(cwd, true), null, 2), 'utf8')

    const result = await checkBinsExecutable(settingsPath, claudeJsonPath, cwd, 'win32')

    expect(result.status).toBe('FAIL')
    expect(result.exitCodeOnFail).toBe(3)
    expect(result.detail).toContain(fakeBin)
    // Honest fail-open wording: tool calls pass through unprotected.
    expect(result.detail).toMatch(/fails OPEN/i)
    expect(result.detail).toMatch(/UNPROTECTED/i)
    expect(result.detail).toMatch(/mrclean install/i)
    // Must NOT falsely claim the fail-closed BLOCK posture on Windows.
    expect(result.detail).not.toMatch(/BLOCKS every tool call/i)
    expect(result.detail).not.toMatch(/fail-closed/i)

    await rm(tmp, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// extractRegisteredPaths — wrapper vs plain-exec shape discrimination (WR-02)
// ---------------------------------------------------------------------------

describe('extractRegisteredPaths — hook shape discrimination', () => {
  /** Write settings.json + empty .claude.json fixtures around one hook command. */
  async function writeHookFixture(
    hookCmd: Record<string, unknown>,
  ): Promise<{ tmp: string; settingsPath: string; claudeJsonPath: string }> {
    const tmp = await makeTmpDir()
    const settingsPath = join(tmp, 'settings.json')
    const claudeJsonPath = join(tmp, '.claude.json')
    const settings = {
      hooks: {
        SessionStart: [{ _mrclean: true, matcher: 'startup', hooks: [hookCmd] }],
      },
    }
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
    await writeFile(claudeJsonPath, '{}', 'utf8')
    return { tmp, settingsPath, claudeJsonPath }
  }

  it('plain-exec shape with a .mjs bin extracts bin from args[0], not the wrapper tail', async () => {
    // Regression for the old `args[0].endsWith('.js')` heuristic: a legacy /
    // win32 entry with a non-.js bin used to fall into the wrapper branch and
    // mis-extract nodePath=<bin>, binPath='hook'.
    const mjsBin = '/opt/mrclean/dist/cli.mjs'
    const hookCmd = {
      type: 'command',
      command: process.execPath,
      args: [mjsBin, 'hook'],
      timeout: 10,
    }
    const { tmp, settingsPath, claudeJsonPath } = await writeHookFixture(hookCmd)

    const { nodePath, hookBinPath } = await extractRegisteredPaths(settingsPath, claudeJsonPath, tmp)

    expect(nodePath).toBe(process.execPath)
    expect(hookBinPath).toBe(mjsBin)

    await rm(tmp, { recursive: true, force: true })
  })

  it('plain-exec shape with an extensionless bin extracts bin from args[0]', async () => {
    const bareBin = '/usr/local/bin/mrclean-launcher'
    const hookCmd = {
      type: 'command',
      command: process.execPath,
      args: [bareBin, 'hook'],
      timeout: 10,
    }
    const { tmp, settingsPath, claudeJsonPath } = await writeHookFixture(hookCmd)

    const { nodePath, hookBinPath } = await extractRegisteredPaths(settingsPath, claudeJsonPath, tmp)

    expect(nodePath).toBe(process.execPath)
    expect(hookBinPath).toBe(bareBin)

    await rm(tmp, { recursive: true, force: true })
  })

  it('wrapper shape with a non-.js bin still extracts node + bin from the tail', async () => {
    // The discriminator must key on command === '/bin/sh' && args[0] === '-c',
    // not on the bin filename — a .mjs bin inside the wrapper tail must extract.
    const mjsBin = '/opt/mrclean/dist/cli.mjs'
    const hookCmd = buildHookCommand(process.execPath, mjsBin, 'linux')
    const { tmp, settingsPath, claudeJsonPath } = await writeHookFixture(
      hookCmd as unknown as Record<string, unknown>,
    )

    const { nodePath, hookBinPath } = await extractRegisteredPaths(settingsPath, claudeJsonPath, tmp)

    expect(nodePath).toBe(process.execPath)
    expect(hookBinPath).toBe(mjsBin)

    await rm(tmp, { recursive: true, force: true })
  })

  it('wrapper shape built by the shipped installer (.js bin) extracts unchanged', async () => {
    // Behavior-identical guard for the current real shape.
    const hookCmd = buildHookCommand(process.execPath, DIST_CLI, 'linux')
    const { tmp, settingsPath, claudeJsonPath } = await writeHookFixture(
      hookCmd as unknown as Record<string, unknown>,
    )

    const { nodePath, hookBinPath } = await extractRegisteredPaths(settingsPath, claudeJsonPath, tmp)

    expect(nodePath).toBe(process.execPath)
    expect(hookBinPath).toBe(DIST_CLI)

    await rm(tmp, { recursive: true, force: true })
  })

  it('malformed wrapper (/bin/sh -c with no node/bin tail) extracts nothing instead of garbage', async () => {
    const hookCmd = {
      type: 'command',
      command: '/bin/sh',
      args: ['-c', '"$1" "$2" hook || exit 2'],
      timeout: 10,
    }
    const { tmp, settingsPath, claudeJsonPath } = await writeHookFixture(hookCmd)

    const { nodePath, hookBinPath } = await extractRegisteredPaths(settingsPath, claudeJsonPath, tmp)

    // Graceful fallbacks: nodePath defaults to process.execPath, bin stays empty —
    // crucially NOT nodePath='-c' / binPath='<script>'.
    expect(nodePath).toBe(process.execPath)
    expect(hookBinPath).toBe('')

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

// ---------------------------------------------------------------------------
// checkReversibleState — REPORTING-ONLY in Phase 8 (08-03, REVMODE-12 groundwork)
// ---------------------------------------------------------------------------

describe('checkReversibleState', () => {
  it('Test 15: PASS — no [reversible] table → disabled (default one-way)', async () => {
    const homeDir = await makeTmpDir()
    const cwd = await makeTmpDir()
    const configDir = join(cwd, '.mrclean')
    await mkdir(configDir, { recursive: true })
    // Valid config with NO [reversible] table — the shipped default surface.
    await writeFile(join(configDir, 'config.toml'), 'dry_run = false\n', 'utf8')

    const result = await checkReversibleState(homeDir, cwd)

    // Exact detail string: state only — never config values, paths, or map
    // contents (T-08-08 mitigation).
    expect(result).toEqual({
      name: 'reversible',
      status: 'PASS',
      detail: 'reversible mode: disabled (default one-way)',
      exitCodeOnFail: 1,
    })

    await rm(homeDir, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  })

  it('Test 16: PASS — [reversible] enabled = true → enabled, plumbing only', async () => {
    const homeDir = await makeTmpDir()
    const cwd = await makeTmpDir()
    const configDir = join(cwd, '.mrclean')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'config.toml'), '[reversible]\nenabled = true\n', 'utf8')

    const result = await checkReversibleState(homeDir, cwd)

    expect(result).toEqual({
      name: 'reversible',
      status: 'PASS',
      detail: 'reversible mode: enabled — plumbing only (session state adapter lands in Phase 9)',
      exitCodeOnFail: 1,
    })
    expect(result.detail).toMatch(/enabled/)
    expect(result.detail).toMatch(/Phase 9/)

    await rm(homeDir, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  })

  it('Test 17: SKIP — malformed config.toml → defers to the config check (no double-FAIL)', async () => {
    const homeDir = await makeTmpDir()
    const cwd = await makeTmpDir()
    const configDir = join(cwd, '.mrclean')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'config.toml'), 'this is = = = malformed\n', 'utf8')

    const result = await checkReversibleState(homeDir, cwd)

    // checkConfigLoad owns the FAIL for this root cause (T-08-10): the
    // reversible check must SKIP — never FAIL, never crash doctor.
    expect(result).toEqual({
      name: 'reversible',
      status: 'SKIP',
      detail: 'config unreadable — see config check',
      exitCodeOnFail: 1,
    })
    expect(result.detail).toMatch(/config/)

    await rm(homeDir, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  })
})
