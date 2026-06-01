/**
 * Unit tests for runInit (`mrclean init`).
 *
 * Validates: creates .mrclean/ + config.toml + words.txt on first run; idempotent
 * (no clobber) on re-run; the seeded words.txt parses to ZERO active word entries
 * (it is comment-only — must never inject real blocklist terms); .mrclean/ is added
 * to the project-root .gitignore.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { runInit, WORDS_TXT_STUB } from '../../src/install/init-project.js'
import { loadWordsList } from '../../src/detect/layer4-words.js'

describe('runInit', () => {
  let cwd: string
  let home: string

  beforeEach(async () => {
    cwd = join(tmpdir(), `mrclean-init-cwd-${randomUUID()}`)
    home = join(tmpdir(), `mrclean-init-home-${randomUUID()}`)
    await mkdir(cwd, { recursive: true })
    await mkdir(home, { recursive: true })
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  })

  it('creates .mrclean/, config.toml and words.txt on first run', async () => {
    const result = await runInit({ cwd })

    expect(result.configCreated).toBe(true)
    expect(result.wordsCreated).toBe(true)

    const config = await readFile(join(cwd, '.mrclean', 'config.toml'), 'utf8')
    const words = await readFile(join(cwd, '.mrclean', 'words.txt'), 'utf8')
    expect(config).toContain('[allowlist]')
    expect(words).toBe(WORDS_TXT_STUB)
  })

  it('is idempotent — re-run does not clobber an edited words.txt', async () => {
    await runInit({ cwd })

    const wordsPath = join(cwd, '.mrclean', 'words.txt')
    await writeFile(wordsPath, 'project-bluebird\n', 'utf8')

    const result = await runInit({ cwd })
    expect(result.configCreated).toBe(false)
    expect(result.wordsCreated).toBe(false)

    const words = await readFile(wordsPath, 'utf8')
    expect(words).toBe('project-bluebird\n')
  })

  it('seeded words.txt parses to zero active word entries (comment-only)', async () => {
    await runInit({ cwd })

    // Point homeDir at an isolated empty dir so the global words.txt cannot leak in.
    const entries = await loadWordsList({ homeDir: home, cwd })
    expect(entries).toEqual([])
  })

  it('adds .mrclean/ to the project-root .gitignore', async () => {
    await runInit({ cwd })

    const gi = await readFile(join(cwd, '.gitignore'), 'utf8')
    expect(gi).toContain('.mrclean/')
  })
})
