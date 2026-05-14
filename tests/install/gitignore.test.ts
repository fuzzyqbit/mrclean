/**
 * Tests for src/install/gitignore.ts
 *
 * Validates: add/remove gitignore entries, idempotency, preservation of existing content.
 * RESEARCH.md §7, OQ-1 (gitignore location), Phase 1 policy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { addGitignoreEntries, removeGitignoreEntries } from '../../src/install/gitignore.js'
import { GITIGNORE_BEGIN, GITIGNORE_END } from '../../src/install/markers.js'

let testCwd: string

beforeEach(async () => {
  testCwd = join(tmpdir(), `mrclean-gi-test-${randomUUID()}`)
  await mkdir(testCwd, { recursive: true })
})

afterEach(async () => {
  await rm(testCwd, { recursive: true, force: true })
})

// Test 8: addGitignoreEntries creates .gitignore with delimited block containing .mrclean/
describe('addGitignoreEntries', () => {
  it('creates .gitignore with a delimited block containing .mrclean/', async () => {
    await addGitignoreEntries(testCwd)

    const content = await readFile(join(testCwd, '.gitignore'), 'utf8')
    expect(content).toContain(GITIGNORE_BEGIN)
    expect(content).toContain(GITIGNORE_END)
    expect(content).toContain('.mrclean/')
  })

  it('preserves existing .gitignore content above the managed block', async () => {
    // Write a pre-existing .gitignore
    await writeFile(join(testCwd, '.gitignore'), 'node_modules/\n', 'utf8')

    await addGitignoreEntries(testCwd)

    const content = await readFile(join(testCwd, '.gitignore'), 'utf8')
    expect(content).toContain('node_modules/')
    expect(content).toContain('.mrclean/')
    expect(content).toContain(GITIGNORE_BEGIN)
  })

  // Test 9: Running addGitignoreEntries twice results in exactly ONE managed block
  it('is idempotent — running twice produces exactly one managed block', async () => {
    await addGitignoreEntries(testCwd)
    await addGitignoreEntries(testCwd)

    const content = await readFile(join(testCwd, '.gitignore'), 'utf8')

    // Count occurrences of the begin marker
    const occurrences = (content.match(new RegExp(GITIGNORE_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length
    expect(occurrences).toBe(1)
  })

  it('existing content is preserved both before and after the block', async () => {
    await writeFile(join(testCwd, '.gitignore'), 'node_modules/\n*.log\n', 'utf8')

    await addGitignoreEntries(testCwd)

    const content = await readFile(join(testCwd, '.gitignore'), 'utf8')
    expect(content).toContain('node_modules/')
    expect(content).toContain('*.log')

    // Begin marker should come AFTER existing content
    const nodeModulesIdx = content.indexOf('node_modules/')
    const beginIdx = content.indexOf(GITIGNORE_BEGIN)
    expect(nodeModulesIdx).toBeLessThan(beginIdx)
  })
})

// Test 10: removeGitignoreEntries removes the block; pre-existing entries preserved
describe('removeGitignoreEntries', () => {
  it('removes the managed block, preserving other entries', async () => {
    await writeFile(join(testCwd, '.gitignore'), 'node_modules/\n*.log\n', 'utf8')

    await addGitignoreEntries(testCwd)
    await removeGitignoreEntries(testCwd)

    const content = await readFile(join(testCwd, '.gitignore'), 'utf8')
    expect(content).not.toContain(GITIGNORE_BEGIN)
    expect(content).not.toContain(GITIGNORE_END)
    expect(content).not.toContain('.mrclean/')
    expect(content).toContain('node_modules/')
    expect(content).toContain('*.log')
  })

  it('is a no-op when no managed block exists', async () => {
    await writeFile(join(testCwd, '.gitignore'), 'node_modules/\n', 'utf8')

    // Should not throw
    await expect(removeGitignoreEntries(testCwd)).resolves.toBeUndefined()

    const content = await readFile(join(testCwd, '.gitignore'), 'utf8')
    expect(content).toContain('node_modules/')
  })

  it('deletes the .gitignore file if it becomes empty after removal', async () => {
    // Start with only the managed block (no pre-existing content)
    await addGitignoreEntries(testCwd)
    await removeGitignoreEntries(testCwd)

    // File should either not exist or be effectively empty
    let content: string
    try {
      content = await readFile(join(testCwd, '.gitignore'), 'utf8')
      expect(content.trim()).toBe('')
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code !== 'ENOENT') throw err
      // File was deleted — that's acceptable
    }
  })
})
