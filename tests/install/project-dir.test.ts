/**
 * Tests for src/install/project-dir.ts
 *
 * Validates: createProjectDir creates .mrclean/ with config.toml stub;
 * re-running does NOT clobber existing config.toml.
 * RESEARCH.md §7, Phase 1 contract.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { createProjectDir } from '../../src/install/project-dir.js'

let testCwd: string

beforeEach(async () => {
  testCwd = join(tmpdir(), `mrclean-pd-test-${randomUUID()}`)
  await mkdir(testCwd, { recursive: true })
})

afterEach(async () => {
  await rm(testCwd, { recursive: true, force: true })
})

// Test 11: createProjectDir creates .mrclean/ and stub config.toml
describe('createProjectDir', () => {
  it('creates .mrclean/ directory with 0755 perms', async () => {
    await createProjectDir(testCwd)

    const dirStat = await stat(join(testCwd, '.mrclean'))
    expect(dirStat.isDirectory()).toBe(true)

    // Check permissions: on POSIX, mode & 0o777 should be 0o755
    const mode = dirStat.mode & 0o777
    expect(mode).toBe(0o755)
  })

  it('creates .mrclean/config.toml with stub content', async () => {
    await createProjectDir(testCwd)

    const configPath = join(testCwd, '.mrclean', 'config.toml')
    const content = await readFile(configPath, 'utf8')

    // Must be a comment-only stub (no live key = value lines)
    // The Plan 01-02b config reader must treat this as an empty layer
    expect(content).toContain('#')

    // Should NOT have live key=value pairs (only comments and section headers)
    const liveLines = content
      .split('\n')
      .filter(line => line.trim() && !line.trim().startsWith('#') && !line.trim().startsWith('['))
    expect(liveLines).toHaveLength(0)
  })

  it('returns { created: true, path } on first call', async () => {
    const result = await createProjectDir(testCwd)
    expect(result.created).toBe(true)
    expect(result.path).toBe(join(testCwd, '.mrclean'))
  })

  it('returns { created: false } without clobbering existing config.toml', async () => {
    // First call
    await createProjectDir(testCwd)

    // Modify the config.toml (simulating user edits)
    const configPath = join(testCwd, '.mrclean', 'config.toml')
    await writeFile(configPath, '# User has edited this file\n[allowlist]\nrules = []\n', 'utf8')

    // Second call
    const result = await createProjectDir(testCwd)
    expect(result.created).toBe(false)

    // User content must be preserved
    const content = await readFile(configPath, 'utf8')
    expect(content).toContain('User has edited this file')
    expect(content).toContain('[allowlist]')
  })

  it('config.toml has 0644 permissions', async () => {
    await createProjectDir(testCwd)

    const configStat = await stat(join(testCwd, '.mrclean', 'config.toml'))
    const mode = configStat.mode & 0o777
    expect(mode).toBe(0o644)
  })
})
