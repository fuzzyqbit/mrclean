/**
 * Tests for src/install/settings.ts
 *
 * Validates: hook entries written for all four events, idempotency,
 * preservation of user hooks, removeHookEntries strips only mrclean entries.
 * RESEARCH.md §1.5 (hook registration shape), §3.2 (idempotency), OQ-3.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { writeHookEntries, removeHookEntries } from '../../src/install/settings.js'

const FIXTURE_EMPTY = new URL('../../tests/fixtures/settings/empty.json', import.meta.url).pathname
const FIXTURE_WITH_HOOKS = new URL('../../tests/fixtures/settings/with-other-hooks.json', import.meta.url).pathname

let testDir: string
let settingsPath: string

beforeEach(async () => {
  testDir = join(tmpdir(), `mrclean-settings-test-${randomUUID()}`)
  await mkdir(testDir, { recursive: true })
  settingsPath = join(testDir, 'settings.json')
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

// Test 1: writeHookEntries produces hook entries for all four events
describe('writeHookEntries', () => {
  it('writes hooks for all four event types from an empty settings.json', async () => {
    await copyFile(FIXTURE_EMPTY, settingsPath)

    await writeHookEntries(settingsPath, '/usr/bin/node', '/path/to/mrclean', '0.1.0')

    const data = JSON.parse(await readFile(settingsPath, 'utf8'))

    expect(data.hooks).toBeDefined()

    const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']
    for (const event of events) {
      expect(Array.isArray(data.hooks[event])).toBe(true)

      const mrcleanEntry = data.hooks[event].find((e: Record<string, unknown>) => e._mrclean === true)
      expect(mrcleanEntry).toBeDefined()
      expect(mrcleanEntry._mrclean).toBe(true)

      // Each entry has a hooks array
      expect(Array.isArray(mrcleanEntry.hooks)).toBe(true)
      const hookCmd = mrcleanEntry.hooks[0]
      expect(hookCmd.type).toBe('command')
      expect(hookCmd.command).toBe('/usr/bin/node')
      expect(hookCmd.args).toEqual(['/path/to/mrclean', 'hook'])
    }
  })

  it('SessionStart entry has matcher "startup"', async () => {
    await copyFile(FIXTURE_EMPTY, settingsPath)

    await writeHookEntries(settingsPath, '/usr/bin/node', '/path/to/mrclean', '0.1.0')

    const data = JSON.parse(await readFile(settingsPath, 'utf8'))
    const entry = data.hooks.SessionStart.find((e: Record<string, unknown>) => e._mrclean)
    expect(entry.matcher).toBe('startup')
  })

  it('PreToolUse and PostToolUse entries have matcher "*"', async () => {
    await copyFile(FIXTURE_EMPTY, settingsPath)

    await writeHookEntries(settingsPath, '/usr/bin/node', '/path/to/mrclean', '0.1.0')

    const data = JSON.parse(await readFile(settingsPath, 'utf8'))
    for (const event of ['PreToolUse', 'PostToolUse']) {
      const entry = data.hooks[event].find((e: Record<string, unknown>) => e._mrclean)
      expect(entry.matcher).toBe('*')
    }
  })

  it('UserPromptSubmit entry has no matcher property (no matcher support per RESEARCH §1.5)', async () => {
    await copyFile(FIXTURE_EMPTY, settingsPath)

    await writeHookEntries(settingsPath, '/usr/bin/node', '/path/to/mrclean', '0.1.0')

    const data = JSON.parse(await readFile(settingsPath, 'utf8'))
    const entry = data.hooks.UserPromptSubmit.find((e: Record<string, unknown>) => e._mrclean)
    expect(entry.matcher).toBeUndefined()
  })

  // Test 2: Pre-existing user-defined hooks are preserved
  it('preserves pre-existing user hooks alongside mrclean entry', async () => {
    await copyFile(FIXTURE_WITH_HOOKS, settingsPath)

    await writeHookEntries(settingsPath, '/usr/bin/node', '/path/to/mrclean', '0.1.0')

    const data = JSON.parse(await readFile(settingsPath, 'utf8'))
    const preToolUseEntries = data.hooks.PreToolUse

    // Both user hook and mrclean hook should exist
    const mrcleanEntry = preToolUseEntries.find((e: Record<string, unknown>) => e._mrclean)
    const userEntry = preToolUseEntries.find((e: Record<string, unknown>) => !e._mrclean)

    expect(mrcleanEntry).toBeDefined()
    expect(userEntry).toBeDefined()
    expect(userEntry.matcher).toBe('Bash')
  })

  // Test 3: Re-running does NOT duplicate the mrclean block
  it('is idempotent — re-running does not create duplicate mrclean entries', async () => {
    await copyFile(FIXTURE_EMPTY, settingsPath)

    await writeHookEntries(settingsPath, '/usr/bin/node', '/path/to/mrclean', '0.1.0')
    await writeHookEntries(settingsPath, '/usr/bin/node', '/path/to/mrclean', '0.1.0')

    const data = JSON.parse(await readFile(settingsPath, 'utf8'))

    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']) {
      const mrcleanEntries = data.hooks[event].filter((e: Record<string, unknown>) => e._mrclean)
      expect(mrcleanEntries).toHaveLength(1)
    }
  })

  it('creates a backup file before writing', async () => {
    await copyFile(FIXTURE_EMPTY, settingsPath)

    await writeHookEntries(settingsPath, '/usr/bin/node', '/path/to/mrclean', '0.1.0')

    const { readdir } = await import('node:fs/promises')
    const files = await readdir(testDir)
    const backups = files.filter(f => f.includes('mrclean-backup'))
    expect(backups.length).toBeGreaterThan(0)
  })
})

// Test 4: removeHookEntries strips mrclean blocks; other hooks intact
describe('removeHookEntries', () => {
  it('removes all _mrclean entries, preserving user hooks', async () => {
    await copyFile(FIXTURE_WITH_HOOKS, settingsPath)

    await writeHookEntries(settingsPath, '/usr/bin/node', '/path/to/mrclean', '0.1.0')
    await removeHookEntries(settingsPath)

    const data = JSON.parse(await readFile(settingsPath, 'utf8'))

    // No mrclean entries across any event
    for (const event of Object.keys(data.hooks)) {
      const mrcleanEntries = data.hooks[event].filter((e: Record<string, unknown>) => e._mrclean)
      expect(mrcleanEntries).toHaveLength(0)
    }

    // User hook preserved
    const preToolUseEntries = data.hooks.PreToolUse
    const userEntry = preToolUseEntries.find((e: Record<string, unknown>) => !e._mrclean)
    expect(userEntry).toBeDefined()
  })

  it('leaves empty arrays (not deleted keys) for events that had only mrclean entries', async () => {
    await copyFile(FIXTURE_EMPTY, settingsPath)

    await writeHookEntries(settingsPath, '/usr/bin/node', '/path/to/mrclean', '0.1.0')
    await removeHookEntries(settingsPath)

    const data = JSON.parse(await readFile(settingsPath, 'utf8'))

    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']) {
      expect(Array.isArray(data.hooks[event])).toBe(true)
      expect(data.hooks[event]).toHaveLength(0)
    }
  })
})
