import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseWordsFile, loadWordsList, runLayer4Words } from '../../src/detect/layer4-words.js'
import type { WordEntry } from '../../src/detect/layer4-words.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'mrclean-layer4-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('parseWordsFile', () => {
  it('parses word-only lines as block action', () => {
    const entries = parseWordsFile('ACME\n')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.word).toBe('ACME')
    expect(entries[0]!.action).toBe('block')
  })

  it('parses word|action lines correctly', () => {
    const entries = parseWordsFile('FooBar|warn\n')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.word).toBe('FooBar')
    expect(entries[0]!.action).toBe('warn')
  })

  it('skips comment and blank lines', () => {
    const content = 'ACME\n# this is a comment\n\nFooBar|warn\n'
    const entries = parseWordsFile(content)
    expect(entries).toHaveLength(2)
  })

  it('parses all four syntax cases from plan example', () => {
    const content = 'ACME\nFooBar|warn\n# comment\n\nNEWWORD|audit\nbadaction|xyz'
    const entries = parseWordsFile(content)
    expect(entries).toHaveLength(4)
    expect(entries[0]!.word).toBe('ACME')
    expect(entries[0]!.action).toBe('block')
    expect(entries[1]!.word).toBe('FooBar')
    expect(entries[1]!.action).toBe('warn')
    expect(entries[2]!.word).toBe('NEWWORD')
    expect(entries[2]!.action).toBe('audit')
    expect(entries[3]!.word).toBe('badaction')
    expect(entries[3]!.action).toBe('block') // xyz coerced to block
  })

  it('strips trailing comments from lines', () => {
    const entries = parseWordsFile('ACME # this is ACMEs word\n')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.word).toBe('ACME')
  })

  it('compiles case-insensitive whole-word regex', () => {
    const entries = parseWordsFile('ACME\n')
    expect(entries[0]!.re).toBeInstanceOf(RegExp)
    // Should have 'i' flag (case insensitive) and 'g' flag (global)
    expect(entries[0]!.re.flags).toContain('i')
    expect(entries[0]!.re.flags).toContain('g')
    // Should use word boundaries
    expect(entries[0]!.re.source).toContain('\\b')
  })
})

describe('loadWordsList', () => {
  it('returns empty array when no words.txt files exist', async () => {
    const entries = await loadWordsList({ homeDir: tmpDir, cwd: tmpDir })
    expect(entries).toHaveLength(0)
  })

  it('project-local entry overrides same-word global entry (project wins)', async () => {
    // Global: foo|warn
    const globalMrcleanDir = join(tmpDir, 'home', '.mrclean')
    await mkdir(globalMrcleanDir, { recursive: true })
    await writeFile(join(globalMrcleanDir, 'words.txt'), 'foo|warn\n')

    // Project: foo|audit (overrides global)
    const projectMrcleanDir = join(tmpDir, 'project', '.mrclean')
    await mkdir(projectMrcleanDir, { recursive: true })
    await writeFile(join(projectMrcleanDir, 'words.txt'), 'foo|audit\n')

    const homeDir = join(tmpDir, 'home')
    const cwd = join(tmpDir, 'project')
    const entries = await loadWordsList({ homeDir, cwd })

    expect(entries).toHaveLength(1)
    expect(entries[0]!.word.toLowerCase()).toBe('foo')
    expect(entries[0]!.action).toBe('audit') // project wins
  })

  it('global + project local union when different words', async () => {
    const globalMrcleanDir = join(tmpDir, 'home', '.mrclean')
    await mkdir(globalMrcleanDir, { recursive: true })
    await writeFile(join(globalMrcleanDir, 'words.txt'), 'foo|warn\n')

    const projectMrcleanDir = join(tmpDir, 'project', '.mrclean')
    await mkdir(projectMrcleanDir, { recursive: true })
    await writeFile(join(projectMrcleanDir, 'words.txt'), 'bar|audit\n')

    const homeDir = join(tmpDir, 'home')
    const cwd = join(tmpDir, 'project')
    const entries = await loadWordsList({ homeDir, cwd })

    expect(entries).toHaveLength(2)
    const words = entries.map((e) => e.word.toLowerCase())
    expect(words).toContain('foo')
    expect(words).toContain('bar')
  })

  it('handles missing global words.txt gracefully (ENOENT → empty)', async () => {
    const projectMrcleanDir = join(tmpDir, '.mrclean')
    await mkdir(projectMrcleanDir, { recursive: true })
    await writeFile(join(projectMrcleanDir, 'words.txt'), 'ACME\n')

    const entries = await loadWordsList({ homeDir: join(tmpDir, 'nonexistent-home'), cwd: tmpDir })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.word).toBe('ACME')
  })
})

describe('runLayer4Words', () => {
  it('returns 0 findings for whole-word boundary miss (ACMEFOO does not match ACME)', () => {
    const entries = parseWordsFile('ACME\n')
    const findings = runLayer4Words('ACMEFOO', entries)
    expect(findings).toHaveLength(0)
  })

  it('returns 1 finding for whole-word match', () => {
    const entries = parseWordsFile('ACME\n')
    const findings = runLayer4Words('foo ACME bar', entries)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.source).toBe('words')
    expect(findings[0]!.ruleId).toBe('word:acme')
    expect(findings[0]!.severity).toBe('HIGH')
  })

  it('matches case-insensitively', () => {
    const entries = parseWordsFile('ACME\n')
    const findings = runLayer4Words('acme corporation', entries)
    expect(findings).toHaveLength(1)
  })

  it('finding action matches word entry action', () => {
    const entries = parseWordsFile('FooBar|warn\n')
    const findings = runLayer4Words('FooBar is here', entries)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.action).toBe('warn')
  })

  it('finding has correct shape: source, ruleId, redactedHash, fingerprint', () => {
    const entries = parseWordsFile('foo\n')
    const findings = runLayer4Words('foo bar baz', entries)
    expect(findings).toHaveLength(1)
    const f = findings[0]!
    expect(f.source).toBe('words')
    expect(f.ruleId).toBe('word:foo')
    expect(f.redactedHash).toMatch(/^[0-9a-f]{16}$/)
    expect(f.fingerprint).toBe(`word:foo:${f.redactedHash}`)
  })

  it('skips occurrences covered by coveredSpans', () => {
    const entries = parseWordsFile('ACME\n')
    const text = 'foo ACME bar'
    const acmeStart = 4
    const coveredSpans = [{ start: acmeStart, end: acmeStart + 4 }]
    const findings = runLayer4Words(text, entries, coveredSpans)
    expect(findings).toHaveLength(0)
  })
})
