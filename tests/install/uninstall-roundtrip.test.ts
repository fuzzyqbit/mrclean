/**
 * Uninstall round-trip integration test.
 *
 * Validates: install then uninstall restores settings.json + claude.json + .gitignore
 * to byte-identical pre-install state.
 * RESEARCH.md §3.1 step 7 (restore on uninstall), INST-03, INST-05.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { runInstall, runUninstall } from '../../src/install/index.js'
import { resolveMrcleanBinPath, resolveMrcleanMcpPath } from '../../src/install/path-resolver.js'

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

// Test 10: install then uninstall = byte-identical to pre-install snapshot
describe('runInstall → runInstall → runUninstall round-trip', () => {
  it('surgically removes mrclean hook entries and preserves unrelated settings, including post-install changes', async () => {
    const settingsPath = join(tempHome, '.claude', 'settings.json')
    const gitignorePath = join(tempCwd, '.gitignore')

    // Pre-install content with unrelated keys.
    await writeFile(
      settingsPath,
      JSON.stringify({ preExisting: true, enabledPlugins: { 'foo@bar': true } }, null, 2),
      'utf8',
    )
    await writeFile(gitignorePath, 'node_modules/\n', 'utf8')

    const nodePath = process.execPath
    const mrcleanBin = await resolveMrcleanBinPath()
    const mcpBin = await resolveMrcleanMcpPath()
    const opts = { homeDir: tempHome, cwd: tempCwd, nodePath, mrcleanBinPath: mrcleanBin, mcpBinPath: mcpBin }

    await runInstall(opts)

    // Simulate a user change made AFTER install — the exact scenario the old
    // wholesale backup-restore clobbered (it reverted to the pre-install snapshot).
    const mid = JSON.parse(await readFile(settingsPath, 'utf8'))
    mid.enabledPlugins['baz@qux'] = true
    await writeFile(settingsPath, JSON.stringify(mid, null, 2), 'utf8')

    await runUninstall({ homeDir: tempHome, cwd: tempCwd })

    const after = JSON.parse(await readFile(settingsPath, 'utf8'))

    // Unrelated settings survive — including the post-install addition.
    expect(after.preExisting).toBe(true)
    expect(after.enabledPlugins).toEqual({ 'foo@bar': true, 'baz@qux': true })

    // All mrclean hook entries are gone.
    for (const event of Object.keys(after.hooks ?? {})) {
      const mrcleanEntries = (after.hooks[event] as Array<Record<string, unknown>>).filter(
        (e) => e._mrclean,
      )
      expect(mrcleanEntries).toHaveLength(0)
    }
  })

  it('restores .gitignore to byte-identical pre-install content', async () => {
    const settingsPath = join(tempHome, '.claude', 'settings.json')
    const gitignorePath = join(tempCwd, '.gitignore')

    const preGitignore = 'node_modules/\n*.log\n'
    await writeFile(gitignorePath, preGitignore, 'utf8')
    await writeFile(settingsPath, '{}', 'utf8')

    const nodePath = process.execPath
    const mrcleanBin = await resolveMrcleanBinPath()
    const mcpBin = await resolveMrcleanMcpPath()

    const opts = { homeDir: tempHome, cwd: tempCwd, nodePath, mrcleanBinPath: mrcleanBin, mcpBinPath: mcpBin }

    await runInstall(opts)
    await runInstall(opts)
    await runUninstall({ homeDir: tempHome, cwd: tempCwd })

    const afterGitignore = await readFile(gitignorePath, 'utf8')
    expect(afterGitignore).toBe(preGitignore)
  })

  it('uninstall does NOT delete the .mrclean/ directory', async () => {
    const settingsPath = join(tempHome, '.claude', 'settings.json')
    await writeFile(settingsPath, '{}', 'utf8')

    const nodePath = process.execPath
    const mrcleanBin = await resolveMrcleanBinPath()
    const mcpBin = await resolveMrcleanMcpPath()

    const opts = { homeDir: tempHome, cwd: tempCwd, nodePath, mrcleanBinPath: mrcleanBin, mcpBinPath: mcpBin }

    await runInstall(opts)
    await runUninstall({ homeDir: tempHome, cwd: tempCwd })

    // .mrclean/ should still exist (uninstall leaves it for the operator)
    const { access, constants } = await import('node:fs/promises')
    await expect(access(join(tempCwd, '.mrclean'), constants.F_OK)).resolves.toBeUndefined()
  })
})

// Test 11: --scope project errors with "not implemented in Phase 1"
describe('runInstall scope validation', () => {
  it('throws with "not implemented in Phase 1" when scope is project', async () => {
    await expect(runInstall({ scope: 'project' })).rejects.toThrow('not implemented in Phase 1')
  })
})
