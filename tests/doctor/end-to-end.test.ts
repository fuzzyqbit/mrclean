/**
 * End-to-end tests for computeDoctorReport and runDoctor (CLI wrapper).
 *
 * All core scenario tests call computeDoctorReport() directly to avoid
 * process.exit killing the vitest runner. One test (Test 8) uses spawnSync
 * to confirm the full CLI path works.
 *
 * Test scenarios (from Plan 01-05):
 *   1. Happy path — install → computeDoctorReport → exitCode 0, all PASS
 *   2. No install — computeDoctorReport → exitCode 1 (hooks not registered)
 *   3. Partial install (hooks only) — exitCode 2 (MCP not registered)
 *   4. chmod -x dist/cli.js → exitCode 3 (bin not executable)
 *   5. install → uninstall → computeDoctorReport → exitCode 1 (hooks gone)
 *   6. install → config-load check is PASS
 *   7. install → malformed config.toml → config-load FAIL, exitCode 1
 *   8. CLI round-trip: node dist/cli.js doctor (after install) exits 0, stdout has 6 [PASS] lines
 *
 * Plan 01-05 TDD RED: these tests must fail before index.ts is implemented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, rm, chmod, copyFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../..')
const DIST_CLI = resolve(PROJECT_ROOT, 'dist/cli.js')
const DIST_MCP = resolve(PROJECT_ROOT, 'dist/mcp.js')

/** Create a clean temp HOME + cwd pair. */
async function makeTempEnv(): Promise<{ homeDir: string; cwd: string; cleanup: () => Promise<void> }> {
  const homeDir = join(tmpdir(), `mrclean-e2e-home-${randomUUID()}`)
  const cwd = join(tmpdir(), `mrclean-e2e-cwd-${randomUUID()}`)
  await mkdir(join(homeDir, '.claude'), { recursive: true })
  await mkdir(cwd, { recursive: true })
  return {
    homeDir,
    cwd,
    cleanup: async () => {
      await rm(homeDir, { recursive: true, force: true })
      await rm(cwd, { recursive: true, force: true })
    },
  }
}

/**
 * Wave-2 seam bridge (08-03): doctor now requires the 5-event hook surface
 * (including SessionEnd), but the installer's SessionEnd registration lands
 * in plan 08-02 (same wave, parallel worktree). Until 08-02 merges, a fresh
 * install writes only 4 events — so add a SessionEnd mrclean entry IF (and
 * only if) it is missing after install. Post-merge the installer registers
 * SessionEnd itself and this helper becomes a pure no-op, keeping these
 * tests exercising the real installer output. Safe to delete once the
 * installer's 5-event surface is asserted in tests/install/.
 */
async function ensureSessionEndRegistered(homeDir: string, binPath = DIST_CLI): Promise<void> {
  const settingsPath = join(homeDir, '.claude', 'settings.json')
  const raw = await readFile(settingsPath, 'utf8')
  const settings = JSON.parse(raw) as { hooks?: Record<string, unknown[]> }
  const hooks = settings.hooks ?? {}
  const existing = hooks['SessionEnd']
  const hasMrcleanSessionEnd =
    Array.isArray(existing) &&
    existing.some(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        (e as Record<string, unknown>)['_mrclean'] === true,
    )
  if (hasMrcleanSessionEnd) return

  const { buildHookCommand } = await import('../../src/install/settings.js')
  const hookCmd = buildHookCommand(process.execPath, binPath)
  // SessionEnd is registered with NO matcher key (matchers filter on `reason`).
  const next = {
    ...settings,
    hooks: {
      ...hooks,
      SessionEnd: [...(Array.isArray(existing) ? existing : []), { _mrclean: true, hooks: [hookCmd] }],
    },
  }
  await writeFile(settingsPath, JSON.stringify(next, null, 2), 'utf8')
}

/** Run install via the runInstall API (not CLI) so we control homeDir/cwd. */
async function doInstall(homeDir: string, cwd: string): Promise<void> {
  const { runInstall } = await import('../../src/install/index.js')
  await runInstall({
    homeDir,
    cwd,
    nodePath: process.execPath,
    mrcleanBinPath: DIST_CLI,
    mcpBinPath: DIST_MCP,
  })
  await ensureSessionEndRegistered(homeDir)
}

/** Run uninstall via the runUninstall API. */
async function doUninstall(homeDir: string, cwd: string): Promise<void> {
  const { runUninstall } = await import('../../src/install/index.js')
  await runUninstall({ homeDir, cwd })
}

describe('computeDoctorReport end-to-end', { timeout: 60000 }, () => {
  beforeAll(() => {
    if (!existsSync(DIST_CLI) || !existsSync(DIST_MCP)) {
      throw new Error('dist/ not found — run npm run build first')
    }
  })

  // ---------------------------------------------------------------------------
  // Test 1: Happy path
  // ---------------------------------------------------------------------------
  it('Test 1: install → computeDoctorReport → exitCode 0, all PASS', async () => {
    const { homeDir, cwd, cleanup } = await makeTempEnv()
    // Hermetic (root cause B): stub the Claude Code version so this test never
    // depends on a real `claude` binary being on the executing machine's PATH
    // (ubuntu CI runners have none, which previously escalated an all-green
    // report from exit 0 to exit 5).
    const savedFakeVersion = process.env['MRCLEAN_TEST_FAKE_CLAUDE_VERSION']
    process.env['MRCLEAN_TEST_FAKE_CLAUDE_VERSION'] = '2.1.141 (Claude Code)'
    try {
      await doInstall(homeDir, cwd)

      const { computeDoctorReport } = await import('../../src/doctor/index.js')
      const report = await computeDoctorReport({ homeDir, cwd })

      expect(report.exitCode).toBe(0)
      const failedChecks = report.results.filter((r) => r.status === 'FAIL')
      expect(failedChecks).toHaveLength(0)
      // All non-SKIP should be PASS
      const passChecks = report.results.filter((r) => r.status === 'PASS')
      expect(passChecks.length).toBeGreaterThanOrEqual(5)
      // Exact, non-vacuous assertion proving the stub (not a real `claude`
      // binary) drove the result -- a real installed version will differ.
      expect(report.versionResult.version).toBe('2.1.141')
      expect(report.versionResult.status).toBe('green')
    } finally {
      await cleanup()
      if (savedFakeVersion === undefined) {
        delete process.env['MRCLEAN_TEST_FAKE_CLAUDE_VERSION']
      } else {
        process.env['MRCLEAN_TEST_FAKE_CLAUDE_VERSION'] = savedFakeVersion
      }
    }
  })

  // ---------------------------------------------------------------------------
  // Test 2: No install → hooks not registered → exitCode 1
  // ---------------------------------------------------------------------------
  it('Test 2: no install → computeDoctorReport → exitCode 1 (hooks not registered)', async () => {
    const { homeDir, cwd, cleanup } = await makeTempEnv()
    try {
      const { computeDoctorReport } = await import('../../src/doctor/index.js')
      const report = await computeDoctorReport({ homeDir, cwd })

      expect(report.exitCode).toBe(1)
      const hooksResult = report.results.find((r) => r.name === 'hooks')
      expect(hooksResult?.status).toBe('FAIL')
    } finally {
      await cleanup()
    }
  })

  // ---------------------------------------------------------------------------
  // Test 3: Partial install (hooks only) → MCP not registered → exitCode 2
  // ---------------------------------------------------------------------------
  it('Test 3: hooks only (no MCP) → exitCode 2', async () => {
    const { homeDir, cwd, cleanup } = await makeTempEnv()
    try {
      // Write only hook entries, skip MCP
      const { writeHookEntries } = await import('../../src/install/settings.js')
      const settingsPath = join(homeDir, '.claude', 'settings.json')
      await writeFile(settingsPath, '{}', 'utf8') // create the file first
      const { VERSION } = await import('../../src/shared/version.js')
      await writeHookEntries(settingsPath, process.execPath, DIST_CLI, VERSION)
      await ensureSessionEndRegistered(homeDir)

      const { computeDoctorReport } = await import('../../src/doctor/index.js')
      const report = await computeDoctorReport({ homeDir, cwd })

      expect(report.exitCode).toBe(2)
      const mcpResult = report.results.find((r) => r.name === 'mcp')
      expect(mcpResult?.status).toBe('FAIL')
      // src/doctor/index.ts fix: an unregistered MCP bin path must never be
      // silently substituted with process.execPath and spawned as a canary
      // probe -- it should be an explicit SKIP instead.
      const mcpCanaryResult = report.results.find((r) => r.name === 'mcp-canary')
      expect(mcpCanaryResult?.status).toBe('SKIP')
      expect(mcpCanaryResult?.detail).toContain('no MCP binary path registered')
    } finally {
      await cleanup()
    }
  })

  // ---------------------------------------------------------------------------
  // Test 4: chmod -x dist/cli.js → exitCode 3 (bin not executable)
  // ---------------------------------------------------------------------------
  it('Test 4: chmod -x on registered bin → exitCode 3', async () => {
    const { homeDir, cwd, cleanup } = await makeTempEnv()
    // Copy dist/cli.js to a controlled temp location so we can chmod it
    const fakeBin = join(tmpdir(), `mrclean-fake-bin-${randomUUID()}.js`)
    try {
      await copyFile(DIST_CLI, fakeBin)
      // Install with the fake bin path
      const { runInstall } = await import('../../src/install/index.js')
      await runInstall({
        homeDir,
        cwd,
        nodePath: process.execPath,
        mrcleanBinPath: fakeBin,
        mcpBinPath: DIST_MCP,
      })
      await ensureSessionEndRegistered(homeDir, fakeBin)

      // chmod -x the fake bin
      await chmod(fakeBin, 0o644)

      const { computeDoctorReport } = await import('../../src/doctor/index.js')
      const report = await computeDoctorReport({ homeDir, cwd })

      expect(report.exitCode).toBe(3)
      const binsResult = report.results.find((r) => r.name === 'bins')
      expect(binsResult?.status).toBe('FAIL')
    } finally {
      await cleanup()
      await rm(fakeBin, { force: true })
    }
  })

  // ---------------------------------------------------------------------------
  // Test 5: install → uninstall → computeDoctorReport → exitCode 1
  // ---------------------------------------------------------------------------
  it('Test 5: install → uninstall → computeDoctorReport → exitCode 1 (hooks gone)', async () => {
    const { homeDir, cwd, cleanup } = await makeTempEnv()
    // Hermetic (root cause B): same stub as Test 1 -- reportBefore's exitCode 0
    // assertion reaches the version-check escalation branch and must not
    // depend on a real `claude` binary being on PATH.
    const savedFakeVersion = process.env['MRCLEAN_TEST_FAKE_CLAUDE_VERSION']
    process.env['MRCLEAN_TEST_FAKE_CLAUDE_VERSION'] = '2.1.141 (Claude Code)'
    try {
      await doInstall(homeDir, cwd)

      // Verify installed state is good
      const { computeDoctorReport } = await import('../../src/doctor/index.js')
      const reportBefore = await computeDoctorReport({ homeDir, cwd })
      expect(reportBefore.exitCode).toBe(0)

      await doUninstall(homeDir, cwd)

      const reportAfter = await computeDoctorReport({ homeDir, cwd })
      expect(reportAfter.exitCode).toBe(1)
      const hooksResult = reportAfter.results.find((r) => r.name === 'hooks')
      expect(hooksResult?.status).toBe('FAIL')
    } finally {
      await cleanup()
      if (savedFakeVersion === undefined) {
        delete process.env['MRCLEAN_TEST_FAKE_CLAUDE_VERSION']
      } else {
        process.env['MRCLEAN_TEST_FAKE_CLAUDE_VERSION'] = savedFakeVersion
      }
    }
  })

  // ---------------------------------------------------------------------------
  // Test 6: install → config-load check PASS
  // ---------------------------------------------------------------------------
  it('Test 6: install → config-load check is PASS', async () => {
    const { homeDir, cwd, cleanup } = await makeTempEnv()
    try {
      await doInstall(homeDir, cwd)

      const { computeDoctorReport } = await import('../../src/doctor/index.js')
      const report = await computeDoctorReport({ homeDir, cwd })

      const configResult = report.results.find((r) => r.name === 'config-load')
      expect(configResult?.status).toBe('PASS')
    } finally {
      await cleanup()
    }
  })

  // ---------------------------------------------------------------------------
  // Test 7: install → malformed config.toml → config-load FAIL, exitCode 1
  // ---------------------------------------------------------------------------
  it('Test 7: install + malformed config.toml → config-load FAIL, exitCode 1', async () => {
    const { homeDir, cwd, cleanup } = await makeTempEnv()
    try {
      await doInstall(homeDir, cwd)

      // Overwrite the project-local config.toml with malformed TOML
      const configPath = join(cwd, '.mrclean', 'config.toml')
      await writeFile(configPath, 'this is = = = malformed toml\n', 'utf8')

      const { computeDoctorReport } = await import('../../src/doctor/index.js')
      const report = await computeDoctorReport({ homeDir, cwd })

      const configResult = report.results.find((r) => r.name === 'config-load')
      expect(configResult?.status).toBe('FAIL')
      // If hooks/mcp/bins all pass, config-load FAIL should drive the exit code to 1
      // (or another non-zero code if there are other failures)
      expect(report.exitCode).toBeGreaterThan(0)
    } finally {
      await cleanup()
    }
  })

  // ---------------------------------------------------------------------------
  // Test 8: CLI round-trip via spawnSync → 6 [PASS] lines in stdout
  // ---------------------------------------------------------------------------
  it('Test 8: node dist/cli.js install + doctor → exits 0, stdout has 6 [PASS] lines', async () => {
    const { homeDir, cwd, cleanup } = await makeTempEnv()
    try {
      // Install via CLI
      const installResult = spawnSync(
        process.execPath,
        [DIST_CLI, 'install'],
        {
          env: { ...process.env, HOME: homeDir, MRCLEAN_TEST_FAKE_CLAUDE_VERSION: '2.1.141 (Claude Code)' },
          cwd,
          encoding: 'utf8',
          timeout: 10_000,
        },
      )
      expect(installResult.status).toBe(0)

      // Seam bridge: the CLI install above runs the worktree installer (4
      // events until 08-02 merges) — patch in SessionEnd if missing so the
      // spawned doctor sees the required 5-event surface.
      await ensureSessionEndRegistered(homeDir)

      // Run doctor via CLI with MRCLEAN_TEST_FAKE_CLAUDE_VERSION env var
      const doctorResult = spawnSync(
        process.execPath,
        [DIST_CLI, 'doctor'],
        {
          env: {
            ...process.env,
            HOME: homeDir,
            MRCLEAN_TEST_FAKE_CLAUDE_VERSION: '2.1.141 (Claude Code)',
          },
          cwd,
          encoding: 'utf8',
          timeout: 30_000,
        },
      )

      expect(doctorResult.status).toBe(0)

      // Stdout should contain [PASS] lines for all 6 checks
      const stdout = doctorResult.stdout ?? ''
      const passLines = stdout.split('\n').filter((l) => l.includes('[PASS]'))
      expect(passLines.length).toBeGreaterThanOrEqual(6)

      // Verify the 6 specific check names appear
      const checkNames = ['hooks', 'mcp', 'bins', 'hook-canary', 'mcp-canary', 'config-load']
      for (const name of checkNames) {
        expect(stdout).toContain(name)
      }
    } finally {
      await cleanup()
    }
  })
})

describe('process.exit placement invariant', () => {
  it('runDoctor is exported from src/doctor/index.ts', async () => {
    const mod = await import('../../src/doctor/index.js')
    expect(typeof mod.runDoctor).toBe('function')
    expect(typeof mod.computeDoctorReport).toBe('function')
  })
})
