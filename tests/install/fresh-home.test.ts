/**
 * Fresh-HOME install integration tests for runInstall.
 *
 * Reproduces 08-UAT.md test 2 (both gaps) offline:
 *   Gap 1 (major):    `mrclean install` crashes with a raw Node ENOENT stack when
 *                     $HOME/.claude does not exist yet — atomicWriteJson writes its
 *                     tmp file into dirname(target) without ensuring the directory
 *                     exists. Violates the zero-config first-run constraint.
 *   Gap 2 (cosmetic): the success banner hardcodes '(hooks: 4, ...)' while 5 hook
 *                     events are registered (08-02 widened HOOK_EVENTS to 5; the
 *                     banner literal was missed).
 *
 * Contrast tests/install/idempotency.test.ts:23 — that suite PRE-CREATES the
 * .claude dir in beforeEach, which is exactly why gap 1 never surfaced in CI.
 * This suite's beforeEach deliberately does NOT create it (the omission is the
 * point); only the banner test's arrange step mkdirs it inline, to isolate the
 * banner defect (gap 2) from the fresh-HOME ENOENT (gap 1).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { runInstall } from '../../src/install/index.js'
import { resolveMrcleanBinPath, resolveMrcleanMcpPath } from '../../src/install/path-resolver.js'

/** The five events writeHookEntries registers (mirror of settings.ts HOOK_EVENTS). */
const EXPECTED_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
]

/** picocolors may or may not colorize depending on TTY detection — strip either way. */
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*m/g

let tempHome: string
let tempCwd: string

beforeEach(async () => {
  tempHome = join(tmpdir(), `mrclean-fresh-home-${randomUUID()}`)
  tempCwd = join(tmpdir(), `mrclean-fresh-cwd-${randomUUID()}`)
  // Fresh HOME: tempHome exists but the .claude dir is deliberately NOT created here.
  await mkdir(tempHome, { recursive: true })
  await mkdir(tempCwd, { recursive: true })
})

afterEach(async () => {
  // Safety net — spies are restored inline right after runInstall; this catches
  // the rejection path where the inline restore is skipped.
  vi.restoreAllMocks()
  await rm(tempHome, { recursive: true, force: true })
  await rm(tempCwd, { recursive: true, force: true })
})

/** Resolve the DI'd paths runInstall needs (idempotency.test.ts pattern). */
async function resolveInstallPaths(): Promise<{
  nodePath: string
  mrcleanBinPath: string
  mcpBinPath: string
}> {
  return {
    nodePath: process.execPath,
    mrcleanBinPath: await resolveMrcleanBinPath(),
    mcpBinPath: await resolveMrcleanMcpPath(),
  }
}

describe('runInstall on a fresh HOME (08-UAT.md test 2)', () => {
  it('install completes when ~/.claude does not exist yet (zero-config first run)', async () => {
    // Arrange — tempHome exists, tempHome/.claude does NOT (fresh machine)
    const paths = await resolveInstallPaths()
    const chunks: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })

    // Act — must resolve without throwing (today: rejects with ENOENT, gap 1)
    try {
      await runInstall({ homeDir: tempHome, cwd: tempCwd, ...paths })
    } finally {
      spy.mockRestore()
    }

    // Assert — settings.json written with exactly one _mrclean entry per event
    const settingsPath = join(tempHome, '.claude', 'settings.json')
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    for (const event of EXPECTED_HOOK_EVENTS) {
      const mrcleanEntries = (settings.hooks[event] || []).filter(
        (e: Record<string, unknown>) => e._mrclean === true
      )
      expect(mrcleanEntries).toHaveLength(1)
    }

    // Assert — ~/.claude.json parses and carries the mrclean MCP entry for tempCwd
    const claudeJson = JSON.parse(await readFile(join(tempHome, '.claude.json'), 'utf8'))
    expect(claudeJson.projects[tempCwd]?.mcpServers?.mrclean).toBeDefined()
  })

  it('success banner hook count equals the number of registered hook events', async () => {
    // Arrange — pre-create .claude for THIS test only: isolates the banner defect
    // (gap 2) from the fresh-HOME ENOENT (gap 1) so RED fails on the count
    // mismatch, not on ENOENT.
    await mkdir(join(tempHome, '.claude'), { recursive: true })
    const paths = await resolveInstallPaths()
    const chunks: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })

    // Act
    try {
      await runInstall({ homeDir: tempHome, cwd: tempCwd, ...paths })
    } finally {
      spy.mockRestore()
    }

    // Assert — ground truth: hook-event keys in the just-written settings.json
    // whose array actually carries an _mrclean-tagged entry
    const settingsPath = join(tempHome, '.claude', 'settings.json')
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    const registeredEvents = Object.keys(settings.hooks).filter((event) =>
      (settings.hooks[event] || []).some(
        (e: Record<string, unknown>) => e._mrclean === true
      )
    )
    expect(registeredEvents).toHaveLength(5)

    // Assert — the banner's parenthesized count matches the registered ground truth
    const banner = chunks.join('').replace(ANSI_ESCAPE_RE, '')
    const match = banner.match(/\(hooks: (\d+), MCP server: mrclean\)/)
    const bannerCount = Number(match?.[1] ?? NaN)
    expect(bannerCount).toBe(registeredEvents.length)
  })
})
