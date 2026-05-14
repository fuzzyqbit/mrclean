import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEnvBlocklist, runLayer3Env } from '../../src/detect/layer3-env.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'mrclean-layer3-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('loadEnvBlocklist', () => {
  it('includes values from .env and .env.local, excludes .env.example', async () => {
    await writeFile(join(tmpDir, '.env'), 'MY_API_KEY=secretvalue12345\n')
    await writeFile(join(tmpDir, '.env.local'), 'OTHER=truevaluexyzlong\n')
    await writeFile(join(tmpDir, '.env.example'), 'MY_API_KEY=ignored\n')

    const blocklist = await loadEnvBlocklist({ cwd: tmpDir })

    expect(blocklist.values.has('secretvalue12345')).toBe(true)
    expect(blocklist.values.has('truevaluexyzlong')).toBe(true)
    expect(blocklist.values.has('ignored')).toBe(false) // .env.example excluded
  })

  it('skips values shorter than 8 chars', async () => {
    await writeFile(join(tmpDir, '.env'), 'SHORT=abc\n') // 3 chars

    const blocklist = await loadEnvBlocklist({ cwd: tmpDir })

    expect(blocklist.values.has('abc')).toBe(false)
  })

  it('skips boolean literal values (true/false/1/0/yes/no/on/off)', async () => {
    const content = [
      'A=true',
      'B=false',
      'C=1',
      'D=0',
      'E=yes',
      'F=no',
      'G=on',
      'H=off',
      'I=TRUE', // case-insensitive
    ].join('\n')
    await writeFile(join(tmpDir, '.env'), content + '\n')

    const blocklist = await loadEnvBlocklist({ cwd: tmpDir })

    expect(blocklist.values.size).toBe(0)
  })

  it('skips shape-allowlisted values (UUID)', async () => {
    await writeFile(
      join(tmpDir, '.env'),
      'UUID=550e8400-e29b-41d4-a716-446655440000\n',
    )

    const blocklist = await loadEnvBlocklist({ cwd: tmpDir })

    expect(blocklist.values.has('550e8400-e29b-41d4-a716-446655440000')).toBe(false)
  })

  it('loads additional files from secretsFiles option', async () => {
    await writeFile(join(tmpDir, 'custom.env'), 'K=alongvalue12345\n')

    const blocklist = await loadEnvBlocklist({
      cwd: tmpDir,
      secretsFiles: ['custom.env'],
    })

    expect(blocklist.values.has('alongvalue12345')).toBe(true)
  })

  it('excludes .env.sample and .env.template variants', async () => {
    await writeFile(join(tmpDir, '.env.sample'), 'KEY=samplevalue\n')
    await writeFile(join(tmpDir, '.env.template'), 'KEY=templatevalue\n')
    await writeFile(join(tmpDir, '.env'), 'KEY=realvalue12345\n')

    const blocklist = await loadEnvBlocklist({ cwd: tmpDir })

    expect(blocklist.values.has('samplevalue')).toBe(false)
    expect(blocklist.values.has('templatevalue')).toBe(false)
    expect(blocklist.values.has('realvalue12345')).toBe(true)
  })

  it('meta map tracks source file for each value', async () => {
    await writeFile(join(tmpDir, '.env'), 'MY_API_KEY=secretvalue12345\n')

    const blocklist = await loadEnvBlocklist({ cwd: tmpDir })

    expect(blocklist.meta.has('secretvalue12345')).toBe(true)
    const meta = blocklist.meta.get('secretvalue12345')!
    expect(meta.sourceFile).toMatch(/\.env$/)
  })
})

describe('runLayer3Env', () => {
  it('returns 1 finding when a blocklisted value appears in text', async () => {
    await writeFile(join(tmpDir, '.env'), 'MY_API_KEY=secretvalue12345\n')
    const blocklist = await loadEnvBlocklist({ cwd: tmpDir })

    const text = 'the secretvalue12345 is here'
    const findings = runLayer3Env(text, blocklist)

    expect(findings).toHaveLength(1)
    expect(findings[0]!.source).toBe('env')
    expect(findings[0]!.ruleId).toBe('env:literal')
    expect(findings[0]!.severity).toBe('HIGH')
    expect(findings[0]!.span.start).toBe(4)
    expect(findings[0]!.span.end).toBe(4 + 'secretvalue12345'.length)
    expect(findings[0]!.value).toBe('secretvalue12345')
  })

  it('returns 0 findings when value is not in text', async () => {
    await writeFile(join(tmpDir, '.env'), 'MY_API_KEY=secretvalue12345\n')
    const blocklist = await loadEnvBlocklist({ cwd: tmpDir })

    const findings = runLayer3Env('no secrets here', blocklist)
    expect(findings).toHaveLength(0)
  })

  it('skips occurrences covered by coveredSpans', async () => {
    await writeFile(join(tmpDir, '.env'), 'MY_API_KEY=secretvalue12345\n')
    const blocklist = await loadEnvBlocklist({ cwd: tmpDir })

    const text = 'the secretvalue12345 is here'
    const tokenStart = 4
    const tokenEnd = 4 + 'secretvalue12345'.length
    const coveredSpans = [{ start: tokenStart, end: tokenEnd }]
    const findings = runLayer3Env(text, blocklist, coveredSpans)

    expect(findings).toHaveLength(0)
  })

  it('finding has valid redactedHash and fingerprint', async () => {
    await writeFile(join(tmpDir, '.env'), 'MY_API_KEY=secretvalue12345\n')
    const blocklist = await loadEnvBlocklist({ cwd: tmpDir })

    const findings = runLayer3Env('secretvalue12345', blocklist)
    expect(findings).toHaveLength(1)
    const f = findings[0]!
    expect(f.redactedHash).toMatch(/^[0-9a-f]{16}$/)
    expect(f.fingerprint).toBe(`env:literal:${f.redactedHash}`)
  })
})
