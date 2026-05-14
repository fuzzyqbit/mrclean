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
      // Version result should be present
      expect(['green', 'yellow', 'not-found']).toContain(report.versionResult.status)
    } finally {
      await cleanup()
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

      const { computeDoctorReport } = await import('../../src/doctor/index.js')
      const report = await computeDoctorReport({ homeDir, cwd })

      expect(report.exitCode).toBe(2)
      const mcpResult = report.results.find((r) => r.name === 'mcp')
      expect(mcpResult?.status).toBe('FAIL')
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
