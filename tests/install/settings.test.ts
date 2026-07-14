/**
 * Tests for src/install/settings.ts
 *
 * Validates: hook entries written for all five events, idempotency,
 * preservation of user hooks, removeHookEntries strips only mrclean entries,
 * v2.0 (4-event) → v3.0 (5-event) migration.
 * RESEARCH.md §1.5 (hook registration shape), §3.2 (idempotency), OQ-3.
 * Phase 8 (08-02): SessionEnd registration + widened SessionStart matcher.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, readFile, writeFile, rm, copyFile, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

import { writeHookEntries, removeHookEntries, buildHookCommand } from '../../src/install/settings.js'

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

// Test 1: writeHookEntries produces hook entries for all five events
describe('writeHookEntries', () => {
  it('writes hooks for all five event types from an empty settings.json', async () => {
    await copyFile(FIXTURE_EMPTY, settingsPath)

    await writeHookEntries(settingsPath, '/usr/bin/node', '/path/to/mrclean', '0.1.0')

    const data = JSON.parse(await readFile(settingsPath, 'utf8'))

    expect(data.hooks).toBeDefined()

    const events = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']
    for (const event of events) {
      expect(Array.isArray(data.hooks[event])).toBe(true)

      const mrcleanEntry = data.hooks[event].find((e: Record<string, unknown>) => e._mrclean === true)
      expect(mrcleanEntry).toBeDefined()
      expect(mrcleanEntry._mrclean).toBe(true)

      // Each entry has a hooks array — now the fail-closed POSIX /bin/sh wrapper
      // (executor + CI are POSIX; win32 shape is asserted separately below).
      expect(Array.isArray(mrcleanEntry.hooks)).toBe(true)
      const hookCmd = mrcleanEntry.hooks[0]
      expect(hookCmd.type).toBe('command')
      expect(hookCmd.command).toBe('/bin/sh')
      expect(hookCmd.args[0]).toBe('-c')
      expect(hookCmd.args[1]).toContain('|| exit 2')
      // The node + mrclean bin paths are the last two positional params.
      expect(hookCmd.args[hookCmd.args.length - 2]).toBe('/usr/bin/node')
      expect(hookCmd.args[hookCmd.args.length - 1]).toBe('/path/to/mrclean')
    }
  })

  it('SessionStart entry has widened matcher "startup|resume|clear|compact"', async () => {
    await copyFile(FIXTURE_EMPTY, settingsPath)

    await writeHookEntries(settingsPath, '/usr/bin/node', '/path/to/mrclean', '0.1.0')

    const data = JSON.parse(await readFile(settingsPath, 'utf8'))
    const entry = data.hooks.SessionStart.find((e: Record<string, unknown>) => e._mrclean)
    expect(entry.matcher).toBe('startup|resume|clear|compact')
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

  it('SessionEnd entry has no matcher property (matcher would filter on `reason`; handler must see ALL reasons)', async () => {
    await copyFile(FIXTURE_EMPTY, settingsPath)

    await writeHookEntries(settingsPath, '/usr/bin/node', '/path/to/mrclean', '0.1.0')

    const data = JSON.parse(await readFile(settingsPath, 'utf8'))
    const entry = data.hooks.SessionEnd.find((e: Record<string, unknown>) => e._mrclean)
    expect(entry).toBeDefined()
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

    for (const event of ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']) {
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

  // Migration: an already-installed user with the OLD (pre-wrapper) entry shape
  // must be upgraded in place to the new fail-closed wrapper — exactly one
  // mrclean entry per event, no duplication. isMrcleanEntry keys on the
  // `_mrclean` marker (not the command shape), so the old entries are filtered
  // out and replaced by writeHookEntries.
  it('migrates OLD-shape _mrclean entries to the new wrapper shape (no duplicate)', async () => {
    const oldBin = '/old/install/dist/cli.js'
    const oldHookCmd = {
      type: 'command',
      command: '/usr/bin/node',
      args: [oldBin, 'hook'],
      timeout: 10,
    }
    const seed = {
      hooks: {
        SessionStart: [{ _mrclean: true, matcher: 'startup', hooks: [oldHookCmd] }],
        UserPromptSubmit: [{ _mrclean: true, hooks: [oldHookCmd] }],
        PreToolUse: [{ _mrclean: true, matcher: '*', hooks: [oldHookCmd] }],
        PostToolUse: [{ _mrclean: true, matcher: '*', hooks: [oldHookCmd] }],
      },
    }
    await writeFile(settingsPath, JSON.stringify(seed, null, 2), 'utf8')

    await writeHookEntries(settingsPath, '/usr/bin/node', '/new/install/dist/cli.js', '0.1.0')

    const data = JSON.parse(await readFile(settingsPath, 'utf8'))
    for (const event of ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']) {
      const mrcleanEntries = data.hooks[event].filter((e: Record<string, unknown>) => e._mrclean === true)
      // Exactly one entry per event — old shape replaced, not duplicated.
      expect(mrcleanEntries).toHaveLength(1)
      // ...and it is the new POSIX wrapper shape.
      expect(mrcleanEntries[0].hooks[0].command).toBe('/bin/sh')
      const args = mrcleanEntries[0].hooks[0].args as string[]
      expect(args[args.length - 1]).toBe('/new/install/dist/cli.js')
    }
  })

  // Migration: a v2.0 install (4 events, SessionStart matcher 'startup', POSIX
  // wrapper shape) must converge on the v3.0 5-event surface via the existing
  // idempotent filter-and-replace loop — no duplicates, foreign hooks untouched.
  it('migrates a v2.0 4-event install to the 5-event v3.0 surface (no duplicates, foreign hooks byte-identical)', async () => {
    const v2Cmd = buildHookCommand('/usr/bin/node', '/v2/install/dist/cli.js', 'linux')
    const foreignEntry = {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: '/usr/local/bin/my-hook', args: [], timeout: 5 }],
    }
    const seed = {
      hooks: {
        SessionStart: [{ _mrclean: true, matcher: 'startup', hooks: [v2Cmd] }],
        UserPromptSubmit: [{ _mrclean: true, hooks: [v2Cmd] }],
        PreToolUse: [foreignEntry, { _mrclean: true, matcher: '*', hooks: [v2Cmd] }],
        PostToolUse: [{ _mrclean: true, matcher: '*', hooks: [v2Cmd] }],
      },
    }
    await writeFile(settingsPath, JSON.stringify(seed, null, 2), 'utf8')

    await writeHookEntries(settingsPath, '/usr/bin/node', '/new/install/dist/cli.js', '0.1.0')

    const data = JSON.parse(await readFile(settingsPath, 'utf8'))

    // All 5 events present, exactly ONE _mrclean entry per event.
    for (const event of ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']) {
      expect(Array.isArray(data.hooks[event])).toBe(true)
      const mrcleanEntries = data.hooks[event].filter((e: Record<string, unknown>) => e._mrclean === true)
      expect(mrcleanEntries).toHaveLength(1)
    }

    // SessionStart matcher widened.
    const sessionStart = data.hooks.SessionStart.find((e: Record<string, unknown>) => e._mrclean)
    expect(sessionStart.matcher).toBe('startup|resume|clear|compact')

    // SessionEnd matcherless.
    const sessionEnd = data.hooks.SessionEnd.find((e: Record<string, unknown>) => e._mrclean)
    expect(sessionEnd.matcher).toBeUndefined()

    // Foreign user hook byte-identical.
    const foreign = data.hooks.PreToolUse.find((e: Record<string, unknown>) => !e._mrclean)
    expect(foreign).toEqual(foreignEntry)
  })

  it('uninstall after v2.0→v3.0 migration removes all 5 mrclean entries, leaves the foreign entry', async () => {
    const v2Cmd = buildHookCommand('/usr/bin/node', '/v2/install/dist/cli.js', 'linux')
    const foreignEntry = {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: '/usr/local/bin/my-hook', args: [], timeout: 5 }],
    }
    const seed = {
      hooks: {
        SessionStart: [{ _mrclean: true, matcher: 'startup', hooks: [v2Cmd] }],
        UserPromptSubmit: [{ _mrclean: true, hooks: [v2Cmd] }],
        PreToolUse: [foreignEntry, { _mrclean: true, matcher: '*', hooks: [v2Cmd] }],
        PostToolUse: [{ _mrclean: true, matcher: '*', hooks: [v2Cmd] }],
      },
    }
    await writeFile(settingsPath, JSON.stringify(seed, null, 2), 'utf8')

    await writeHookEntries(settingsPath, '/usr/bin/node', '/new/install/dist/cli.js', '0.1.0')
    await removeHookEntries(settingsPath)

    const data = JSON.parse(await readFile(settingsPath, 'utf8'))

    // All 5 event arrays exist and carry zero mrclean entries.
    for (const event of ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']) {
      expect(Array.isArray(data.hooks[event])).toBe(true)
      const mrcleanEntries = data.hooks[event].filter((e: Record<string, unknown>) => e._mrclean === true)
      expect(mrcleanEntries).toHaveLength(0)
    }

    // Foreign user hook survives uninstall byte-identical.
    const foreign = data.hooks.PreToolUse.find((e: Record<string, unknown>) => !e._mrclean)
    expect(foreign).toEqual(foreignEntry)
  })
})

// ---------------------------------------------------------------------------
// buildHookCommand — fail-closed wrapper contract (HOOK-05)
// ---------------------------------------------------------------------------

describe('buildHookCommand', () => {
  it('POSIX branch returns the /bin/sh fail-closed wrapper with positional params', () => {
    const cmd = buildHookCommand('/usr/bin/node', '/path/to/mrclean', 'linux')

    expect(cmd.type).toBe('command')
    expect(cmd.command).toBe('/bin/sh')
    expect(cmd.args[0]).toBe('-c')
    expect(cmd.args[1]).toContain('|| exit 2')
    // $0 label, then node + bin as the last two positional params.
    expect(cmd.args[cmd.args.length - 2]).toBe('/usr/bin/node')
    expect(cmd.args[cmd.args.length - 1]).toBe('/path/to/mrclean')
    expect(cmd.timeout).toBe(10)
  })

  it('darwin branch also returns the /bin/sh wrapper (POSIX)', () => {
    const cmd = buildHookCommand('/usr/bin/node', '/path/to/mrclean', 'darwin')
    expect(cmd.command).toBe('/bin/sh')
    expect(cmd.args[0]).toBe('-c')
  })

  it('win32 branch returns the plain exec form (documented known-gap — no shell wrapper)', () => {
    const cmd = buildHookCommand('C:\\node\\node.exe', 'C:\\mrclean\\dist\\cli.js', 'win32')

    expect(cmd.type).toBe('command')
    expect(cmd.command).toBe('C:\\node\\node.exe')
    expect(cmd.args).toEqual(['C:\\mrclean\\dist\\cli.js', 'hook'])
    expect(cmd.timeout).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// Deterministic wrapper proof — runs the actual POSIX wrapper via /bin/sh
// (no live Claude session needed): exit-code remap, plus the WR-03 security
// guarantees (injection safety, space safety, stdin passthrough) that the
// buildHookCommand JSDoc asserts. Skipped on win32 (no shell wrapper).
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === 'win32')('buildHookCommand POSIX exit-code remap (spawnSync)', () => {
  let stubDir: string

  beforeEach(async () => {
    stubDir = join(tmpdir(), `mrclean-wrapper-stub-${randomUUID()}`)
    await mkdir(stubDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(stubDir, { recursive: true, force: true })
  })

  /** Run the built wrapper command exactly as Claude Code would spawn it. */
  function runWrapper(
    binPath: string,
    opts: { nodePath?: string; input?: string; cwd?: string } = {},
  ): ReturnType<typeof spawnSync> {
    const cmd = buildHookCommand(opts.nodePath ?? process.execPath, binPath, 'linux')
    return spawnSync(cmd.command, cmd.args, { encoding: 'utf8', input: opts.input, cwd: opts.cwd })
  }

  it('missing bin → sh exits 2 (spawn failure fails CLOSED)', () => {
    const missing = join(stubDir, 'does-not-exist.js')
    const res = runWrapper(missing)
    expect(res.status).toBe(2)
  })

  it('inner exit 0 → sh exits 0 (normal pass-through preserved)', async () => {
    const stub = join(stubDir, 'ok.js')
    await writeFile(stub, 'process.exit(0)\n', 'utf8')
    const res = runWrapper(stub)
    expect(res.status).toBe(0)
  })

  it('inner exit 2 → sh exits 2 (mrclean crash-guard block preserved)', async () => {
    const stub = join(stubDir, 'crash.js')
    await writeFile(stub, 'process.exit(2)\n', 'utf8')
    const res = runWrapper(stub)
    expect(res.status).toBe(2)
  })

  it('inner writes a JSON line then exits 0 → sh exits 0 AND stdout carries the JSON (banner/permissionDecision survives the wrapper)', async () => {
    const JSON_LINE = '{"hookSpecificOutput":{"permissionDecision":"allow"}}'
    const stub = join(stubDir, 'json.js')
    await writeFile(
      stub,
      `process.stdout.write(${JSON.stringify(JSON_LINE)} + "\\n"); process.exit(0)\n`,
      'utf8',
    )
    const res = runWrapper(stub)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain(JSON_LINE)
  })

  // -------------------------------------------------------------------------
  // WR-03: deterministic proof of the security guarantees the buildHookCommand
  // JSDoc asserts. A regression to string interpolation
  // (`"${nodePath}" "${binPath}" hook || exit 2`) would fail these.
  // -------------------------------------------------------------------------

  it('passes a bin path with spaces + shell metacharacters literally — injected command does NOT execute', async () => {
    // Arrange: bin path embeds spaces AND a `; touch PWNED #` injection attempt.
    const evilDir = join(stubDir, 'dir with spaces')
    await mkdir(evilDir, { recursive: true })
    const evil = join(evilDir, 'x; touch PWNED #.js')
    await writeFile(evil, 'process.exit(0)\n', 'utf8')

    // Act: cwd pinned to stubDir so a fired `touch PWNED` would land there.
    const res = runWrapper(evil, { cwd: stubDir })

    // Assert: "$2" is a quoted positional param — the whole path resolves as
    // one literal file (exit 0) and the embedded command never fires.
    expect(res.status).toBe(0)
    expect(existsSync(join(stubDir, 'PWNED'))).toBe(false)
    expect(existsSync(join(evilDir, 'PWNED'))).toBe(false)
  })

  it('resolves and executes when BOTH node and bin paths contain spaces (wrapper quoting)', async () => {
    // Arrange: node symlinked into a spaced dir, bin written into another.
    const nodeDir = join(stubDir, 'node dir with spaces')
    const binDir = join(stubDir, 'bin dir with spaces')
    await mkdir(nodeDir, { recursive: true })
    await mkdir(binDir, { recursive: true })
    const spacedNode = join(nodeDir, 'node')
    await symlink(process.execPath, spacedNode)
    const spacedBin = join(binDir, 'ok.js')
    await writeFile(spacedBin, 'process.exit(0)\n', 'utf8')

    // Act
    const res = runWrapper(spacedBin, { nodePath: spacedNode })

    // Assert: quoted "$1" "$2" keep each spaced path a single word → exit 0.
    expect(res.status).toBe(0)
  })

  it('delivers the hook payload piped on stdin to the inner process intact (no silent fail-OPEN)', async () => {
    // Arrange: stub echoes everything it receives on stdin back to stdout.
    // If stdin passthrough broke, the real hook's own stdin timeout would
    // exit 0 — a silent fail-OPEN — which is why this must stay guarded.
    const PAYLOAD = '{"hook_event_name":"UserPromptSubmit","prompt":"hello"}'
    const stub = join(stubDir, 'echo-stdin.js')
    await writeFile(
      stub,
      'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{process.stdout.write("GOT:"+d);process.exit(0)});\n',
      'utf8',
    )

    // Act
    const res = runWrapper(stub, { input: PAYLOAD })

    // Assert: the inner node process inherited sh's stdin — payload intact.
    expect(res.status).toBe(0)
    expect(res.stdout).toContain(`GOT:${PAYLOAD}`)
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

    for (const event of ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']) {
      expect(Array.isArray(data.hooks[event])).toBe(true)
      expect(data.hooks[event]).toHaveLength(0)
    }
  })
})
