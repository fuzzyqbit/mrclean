/**
 * Regression suite for the shared entrypoint-main-module guard (phase 10
 * review CR-01).
 *
 * The npm/npx bin wiring on POSIX is a SYMLINK to dist/cli.js, and Node
 * realpaths + percent-encodes the ESM entry URL — the former naive
 * `import.meta.url === `file://${argv[1]}`` comparison made the whole CLI
 * silently inert (`mrclean restore < in > out` produced an EMPTY file,
 * exit 0).
 *
 * These unit rows drive the extracted isMainEntry() with exactly the
 * (import.meta.url, argv[1]) pairs Node produces for each invocation shape:
 * importMetaUrl is computed as pathToFileURL(realpath(entry)).href — the URL
 * Node hands the entry module under its default symlink-following resolution.
 * A true spawn-through-symlink harness against the BUILT bin needs the tsup
 * dist rebuild (integration project); the unit rows cover the guard logic
 * itself without dist.
 *
 * Non-vacuity: the symlink and spaced-path rows each assert the OLD naive
 * comparison fails on the same pair — proving the row exercises the repaired
 * case, not a trivially-equal one.
 */

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { isMainEntry } from '../../src/shared/entrypoint.js'

const cleanupDirs: string[] = []

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mrclean-entrypoint-guard-'))
  cleanupDirs.push(dir)
  return dir
}

/** The URL Node gives the entry module: realpathed + percent-encoded. */
async function entryUrlFor(path: string): Promise<string> {
  return pathToFileURL(await realpath(path)).href
}

describe('isMainEntry — URL-canonical entrypoint guard (CR-01)', () => {
  it('matches a direct invocation (argv[1] = the script path itself)', async () => {
    const dir = await freshDir()
    const script = join(dir, 'cli.js')
    await writeFile(script, '// entry fixture\n', 'utf8')

    expect(isMainEntry(await entryUrlFor(script), script)).toBe(true)
  })

  it('matches a SYMLINKED invocation — the npm/npx bin shape (argv[1] = link, URL = realpath)', async () => {
    const dir = await freshDir()
    const real = join(dir, 'cli.js')
    const link = join(dir, 'mrclean-link')
    await writeFile(real, '// entry fixture\n', 'utf8')
    await symlink(real, link)

    // What Node resolves the ENTRY module URL to (default: follows symlinks).
    const importMetaUrl = await entryUrlFor(real)
    // Non-vacuity: the old naive interpolation fails on this exact pair.
    expect(`file://${link}` === importMetaUrl).toBe(false)

    expect(isMainEntry(importMetaUrl, link)).toBe(true)
  })

  it('matches a path containing a space (percent-encoding divergence)', async () => {
    const dir = await freshDir()
    const spaced = join(dir, 'My Docs')
    await mkdir(spaced, { recursive: true })
    const script = join(spaced, 'cli.js')
    await writeFile(script, '// entry fixture\n', 'utf8')

    const importMetaUrl = await entryUrlFor(script)
    // Non-vacuity: the real entry URL carries %20, the raw interpolation a
    // literal space — the old guard fails on this exact pair.
    expect(importMetaUrl).toContain('%20')
    expect(`file://${script}` === importMetaUrl).toBe(false)

    expect(isMainEntry(importMetaUrl, script)).toBe(true)
  })

  it('is false when argv[1] is a DIFFERENT module (test-import shape)', async () => {
    const dir = await freshDir()
    const entry = join(dir, 'cli.js')
    const other = join(dir, 'vitest-worker.js')
    await writeFile(entry, '// entry fixture\n', 'utf8')
    await writeFile(other, '// other fixture\n', 'utf8')

    expect(isMainEntry(await entryUrlFor(entry), other)).toBe(false)
  })

  it('is false when argv[1] is undefined (embedded/eval invocation)', async () => {
    const dir = await freshDir()
    const entry = join(dir, 'cli.js')
    await writeFile(entry, '// entry fixture\n', 'utf8')

    expect(isMainEntry(await entryUrlFor(entry), undefined)).toBe(false)
  })

  it('is false (never throws) when argv[1] does not exist on disk', async () => {
    const dir = await freshDir()
    const entry = join(dir, 'cli.js')
    await writeFile(entry, '// entry fixture\n', 'utf8')

    expect(isMainEntry(await entryUrlFor(entry), join(dir, 'no-such-file'))).toBe(false)
  })
})
