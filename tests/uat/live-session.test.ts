/**
 * Live-session UAT — automates the two human_needed items from
 * .planning/phases/01-wired-skeleton/01-VERIFICATION.md by driving a real
 * Claude Code CLI headlessly (`claude -p`).
 *
 * Item 1 — banner + MCP wiring:
 *   The "mrclean active vN.N.N (rules: N, allowlist: N, mode: M)" banner is
 *   injected into the live session via hookSpecificOutput.additionalContext,
 *   and the mrclean MCP server connects. (01-VERIFICATION.md quotes the Phase 1
 *   short-form v0.1.0 banner — that string was replaced by the long form in
 *   Phase 2 / HOOK-07; this test asserts the current long form.)
 *
 * Item 2 — fail-closed, no silent pass-through (SC4):
 *   2a. mrclean crashes internally (malformed .mrclean/config.toml → dispatch
 *       throws → exit 2). Claude Code documents exit 2 as BLOCK. The canary
 *       file name must never reach the model's answer.
 *   2b. Hook bin is gone entirely (spawn/module failure — the modern
 *       equivalent of 01-VERIFICATION's `chmod -x`: exec bits are irrelevant
 *       because the hook runs as `node <bin> hook`). VERIFICATION expects a
 *       block here too; Claude Code docs suggest non-exit-2 failures are
 *       non-blocking. A failure of 2b is therefore a genuine SC4 finding to
 *       report, not a test bug.
 *
 * OPT-IN ONLY: every test self-skips unless MRCLEAN_UAT=1. A run requires an
 * authenticated `claude` binary on PATH and spends real API tokens (~3 Haiku
 * calls). Run via `npm run test:uat`. Never wired into CI.
 *
 * Isolation: hooks/MCP are supplied via explicit --settings / --mcp-config
 * flags pointing at the repo's built dist/ (read-only) — the operator's
 * ~/.claude/settings.json and this repo are never mutated.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { buildHookCommand } from '../../src/install/settings.js'
import { runClaude, assertSessionRan } from './harness.js'

const UAT_ENABLED = process.env.MRCLEAN_UAT === '1'

const REPO_ROOT = process.cwd()
const DIST_CLI = path.resolve(REPO_ROOT, 'dist/cli.js')
const DIST_MCP = path.resolve(REPO_ROOT, 'dist/mcp.js')

/** File name the model must never see when the hook chain is broken. */
const CANARY_FILE = 'UAT_CANARY_7Q3X.txt'

const BANNER_RE =
  /mrclean active v\d+\.\d+\.\d+\S* \(rules: \d+, allowlist: \d+, mode: (active|dry-run)\)/

let sandbox: string
let projectDir: string
let settingsOkPath: string
let settingsBrokenPath: string
let mcpConfigPath: string

/** Build a settings JSON with the four hook entries exactly as install writes them. */
function buildHookSettings(binPath: string): object {
  // Single source of truth for the hook command shape — the shipped
  // fail-closed wrapper (buildHookCommand). The settingsBrokenPath variant
  // (missing bin) therefore exercises the exact spawn-failure path: on POSIX
  // the wrapper exits 2, so UAT-2b's canary-absent assertions are achievable.
  const hookCommand = buildHookCommand(process.execPath, binPath)
  return {
    hooks: {
      SessionStart: [{ matcher: 'startup', hooks: [hookCommand] }],
      UserPromptSubmit: [{ hooks: [hookCommand] }],
      PreToolUse: [{ matcher: '*', hooks: [hookCommand] }],
      PostToolUse: [{ matcher: '*', hooks: [hookCommand] }],
    },
  }
}

describe.skipIf(!UAT_ENABLED)('@uat live claude session (phase 01 human items)', () => {
  beforeAll(() => {
    // Preflight: authenticated claude CLI must exist. Fail loudly, never skip
    // silently — this suite only runs when the operator explicitly opted in.
    const version = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 30_000 })
    if (version.status !== 0) {
      throw new Error(
        `'claude --version' failed (status ${version.status}) — install/authenticate the Claude Code CLI before running test:uat`,
      )
    }

    // Fresh build unless the operator opts out (mirrors integration project).
    if (process.env.SKIP_BUILD !== '1') {
      const build = spawnSync('npm', ['run', 'build'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 120_000,
      })
      if (build.status !== 0) {
        throw new Error(`npm run build failed:\n${build.stderr}`)
      }
    }

    sandbox = mkdtempSync(path.join(tmpdir(), 'mrclean-uat-'))
    projectDir = path.join(sandbox, 'project')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(path.join(projectDir, CANARY_FILE), 'uat canary — must never reach the model\n')

    settingsOkPath = path.join(sandbox, 'settings-ok.json')
    writeFileSync(settingsOkPath, JSON.stringify(buildHookSettings(DIST_CLI), null, 2))

    // "Corrupted bin" variant: hook entries point at a path that does not
    // exist. `node <missing> hook` fails to spawn a working hook — the honest
    // headless equivalent of 01-VERIFICATION's chmod -x scenario.
    settingsBrokenPath = path.join(sandbox, 'settings-broken.json')
    const missingBin = path.join(sandbox, 'missing-bin', 'cli.js')
    writeFileSync(settingsBrokenPath, JSON.stringify(buildHookSettings(missingBin), null, 2))

    mcpConfigPath = path.join(sandbox, 'mcp.json')
    writeFileSync(
      mcpConfigPath,
      JSON.stringify(
        {
          mcpServers: {
            mrclean: { type: 'stdio', command: process.execPath, args: [DIST_MCP] },
          },
        },
        null,
        2,
      ),
    )
  }, 180_000)

  afterAll(() => {
    if (sandbox) rmSync(sandbox, { recursive: true, force: true })
  })

  test('UAT-1: banner reaches the model via additionalContext and mrclean MCP connects', () => {
    // Arrange — clean sandbox project, valid hooks, mrclean MCP configured.
    const prompt =
      "Your context contains a system reminder with a line that starts with 'mrclean active'. " +
      'Reply with that exact line verbatim and nothing else.'

    // Act — real headless session; SessionStart + UserPromptSubmit hooks fire.
    const run = runClaude(prompt, settingsOkPath, { cwd: projectDir, mcpConfigPath })

    // Assert — session ran, banner was injected and quoted back, MCP connected.
    assertSessionRan(run)
    expect(run.status, `claude exited non-zero.\nstderr:\n${run.rawStderr}`).toBe(0)
    expect(run.resultText, `model reply did not quote the banner.\nreply:\n${run.resultText}`).toMatch(
      BANNER_RE,
    )

    const servers = run.init?.mcp_servers ?? []
    const mrclean = servers.find((s) => s.name === 'mrclean')
    expect(mrclean, `mrclean missing from init mcp_servers: ${JSON.stringify(servers)}`).toBeDefined()
    expect(mrclean?.status).toBe('connected')
  })

  test('UAT-2a: internal mrclean crash (exit 2) blocks — canary never reaches the model', () => {
    // Arrange — malformed project config makes every hook dispatch throw →
    // crash guard exits 2 (src/hook/index.ts fail-closed path).
    const mrcleanDir = path.join(projectDir, '.mrclean')
    mkdirSync(mrcleanDir, { recursive: true })
    writeFileSync(path.join(mrcleanDir, 'config.toml'), 'this is [not valid toml\n')

    try {
      // Act — ask for a tool call that would reveal the canary file name.
      const run = runClaude(
        'Run the bash command `ls` in the current directory and report the exact file names you see.',
        settingsOkPath,
        { cwd: projectDir, mcpConfigPath, extraArgs: ['--allowedTools', 'Bash'] },
      )

      // Assert — fail-closed means the canary name never appears anywhere in
      // the model-visible output, whether the block landed on the prompt or
      // the tool call.
      assertSessionRan(run)
      expect(run.resultText).not.toContain(CANARY_FILE)
      expect(run.rawStdout).not.toContain(CANARY_FILE)

      // The failure must be loud somewhere (result text or stderr), not silent.
      const combined = `${run.resultText}\n${run.rawStderr}`.toLowerCase()
      expect(
        /hook|blocked|error/.test(combined),
        `expected a visible hook failure signal.\nresult:\n${run.resultText}\nstderr:\n${run.rawStderr}`,
      ).toBe(true)
    } finally {
      rmSync(mrcleanDir, { recursive: true, force: true })
    }
  })

  test('UAT-2b: missing hook bin (spawn failure) does not silently pass the tool call through', () => {
    // Arrange — settings point at a nonexistent bin (chmod -x equivalent).
    // 01-VERIFICATION expects Claude Code to block here. Claude Code docs say
    // non-exit-2 hook failures are non-blocking — if this test fails with the
    // canary visible, that is a real SC4 finding to record, not a test bug.
    const run = runClaude(
      'Run the bash command `ls` in the current directory and report the exact file names you see.',
      settingsBrokenPath,
      { cwd: projectDir, mcpConfigPath, extraArgs: ['--allowedTools', 'Bash'] },
    )

    // Assert — no silent pass-through of the tool result.
    assertSessionRan(run)
    expect(run.resultText).not.toContain(CANARY_FILE)
    expect(run.rawStdout).not.toContain(CANARY_FILE)
  })
})
