/**
 * Doctor subcommand — orchestrator.
 *
 * computeDoctorReport(opts) is a pure async function: runs all six checks plus the
 * version check, returns { exitCode, results, versionResult }. Tests call it directly.
 * It never terminates the process — that responsibility belongs only to runDoctor.
 *
 * runDoctor(opts) is the thin CLI wrapper that calls computeDoctorReport, renderReport,
 * and then exits the process. It is the ONLY site in the doctor subsystem that calls
 * the process exit function.
 *
 * Exit code map (LOCKED — RESEARCH §4.4):
 *   0 — all checks PASS
 *   1 — hooks not registered OR config-load error
 *   2 — MCP server not registered
 *   3 — registered binary path not executable
 *   4 — canary round-trip failed (hook OR MCP)
 *   5 — Claude Code not found or incompatible version
 *   6 — NER model present but integrity (SHA-256) check failed
 *
 * Plan 01-05 (replaces Plan 01 stub).
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  checkHooksRegistered,
  checkMcpRegistered,
  checkBinsExecutable,
  checkHookCanary,
  checkMcpCanary,
  checkConfigLoad,
  checkModelCache,
  extractRegisteredPaths,
  type CheckResult,
} from './checks.js'
import { checkClaudeCodeVersion, type ClaudeVersionResult } from './version-check.js'
import { renderReport, computeExitCode } from './report.js'
import { runBenchmark, type BenchmarkResult } from './bench.js'

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Options for runDoctor (CLI wrapper). homeDir and cwd default to system values. */
export interface DoctorOpts {
  homeDir?: string
  cwd?: string
  /** Print detailed check output. */
  verbose?: boolean
  /**
   * Run a performance benchmark (Phase 2 stub; Phase 3 will add the assertion gate).
   * When true, skips the normal doctor checks and runs runBenchmark() instead.
   */
  bench?: boolean
}

export type { BenchmarkResult }

/** Full report returned by computeDoctorReport. */
export interface DoctorReport {
  exitCode: number
  results: CheckResult[]
  versionResult: ClaudeVersionResult
}

// ---------------------------------------------------------------------------
// computeDoctorReport — pure, testable core
// ---------------------------------------------------------------------------

/**
 * Run all six doctor checks plus the Claude Code version check.
 * Returns { exitCode, results, versionResult } — never exits the process.
 *
 * Check order (priority order for exit code computation):
 *   1. checkHooksRegistered  — exitCode 1 on fail
 *   2. checkMcpRegistered    — exitCode 2 on fail
 *   3. checkBinsExecutable   — exitCode 3 on fail; gates canary skips
 *   4. checkHookCanary       — exitCode 4 on fail (SKIP if bins failed)
 *   5. checkMcpCanary        — exitCode 4 on fail (SKIP if bins failed)
 *   6. checkConfigLoad       — exitCode 1 on fail
 *   7. checkModelCache       — exitCode 6 on fail (SKIP if model not downloaded)
 *   + version check          — exitCode 5 if red/not-found AND no other failures
 */
export async function computeDoctorReport(opts: {
  homeDir: string
  cwd: string
  quiet?: boolean
}): Promise<DoctorReport> {
  const { homeDir, cwd } = opts

  const settingsPath = join(homeDir, '.claude', 'settings.json')
  const claudeJsonPath = join(homeDir, '.claude.json')

  const results: CheckResult[] = []

  // 1. Hook registration check
  results.push(await checkHooksRegistered(settingsPath))

  // 2. MCP registration check
  results.push(await checkMcpRegistered(claudeJsonPath, cwd))

  // 3. Executable bits check
  results.push(await checkBinsExecutable(settingsPath, claudeJsonPath, cwd))

  // 4 & 5. Canary checks — SKIP if bins are not executable (they would fail anyway)
  //
  // Use extractRegisteredPaths() to get the INSTALLED bin paths from settings.json,
  // not resolveMrcleanBinPath(). When invoked from vitest, process.argv[1] points to
  // the vitest binary — resolveMrcleanBinPath() would return the wrong path. The
  // installed paths are the ground truth for what the hook/MCP actually use.
  const binsResult = results[results.length - 1]!
  if (binsResult.status === 'PASS') {
    const { nodePath, hookBinPath, mcpBinPath } = await extractRegisteredPaths(
      settingsPath,
      claudeJsonPath,
      cwd,
    )
    results.push(await checkHookCanary(nodePath, hookBinPath || process.execPath))
    results.push(await checkMcpCanary(nodePath, mcpBinPath || process.execPath))
  } else {
    results.push({
      name: 'hook-canary',
      status: 'SKIP',
      detail: 'skipped: registered bins are not executable',
      exitCodeOnFail: 4,
    })
    results.push({
      name: 'mcp-canary',
      status: 'SKIP',
      detail: 'skipped: registered bins are not executable',
      exitCodeOnFail: 4,
    })
  }

  // 6. Config-load check — exercises loadEffectiveConfig; makes CFG-01/CFG-03 operator-visible
  results.push(await checkConfigLoad(homeDir, cwd))

  // 7. Model-cache check — SKIP when model not downloaded (stays green for non-NER users);
  //    PASS when present + SHA-256 verified; FAIL (exit 6) on integrity mismatch.
  results.push(await checkModelCache(homeDir))

  // Version check.
  // TEST-ONLY escape hatch: if MRCLEAN_TEST_FAKE_CLAUDE_VERSION is set, inject
  // that string as the version command output. This lets CI/CD tests run
  // hermetically without requiring a real `claude` binary.
  const fakeVersion = process.env['MRCLEAN_TEST_FAKE_CLAUDE_VERSION']
  const versionResult = await checkClaudeCodeVersion(
    fakeVersion ? { runVersionCommand: async () => fakeVersion } : undefined,
  )

  // Compute exit code from check results (priority order = array order above)
  let exitCode = computeExitCode(results)

  // If all checks pass but version is red/not-found → escalate to exit 5
  if (exitCode === 0 && (versionResult.status === 'red' || versionResult.status === 'not-found')) {
    exitCode = 5
  }

  return { exitCode, results, versionResult }
}

// ---------------------------------------------------------------------------
// runDoctor — thin CLI wrapper
// ---------------------------------------------------------------------------

/**
 * CLI wrapper: resolves homeDir/cwd, runs computeDoctorReport, renders the report,
 * and terminates the process with the computed exit code.
 *
 * When `opts.bench` is true, runs runBenchmark() and prints p50/p95 latency to stderr
 * instead of the normal 6-check doctor report. Exits 0 regardless of latency
 * (Phase 3 PERF-02 owns the assertion gate).
 *
 * This is the ONLY place in the entire doctor subsystem where the process terminates
 * via an exit call — computeDoctorReport and runBenchmark are pure and never do this.
 */
export async function runDoctor(opts?: DoctorOpts): Promise<void> {
  if (opts?.bench) {
    const result = await runBenchmark()
    process.stderr.write(`[bench] runs=${result.runsCount}\n`)
    process.stderr.write(
      `[bench] UserPromptSubmit p50=${result.p50.toFixed(1)}ms p95=${result.p95.toFixed(1)}ms (target Phase 3: <100ms)\n`,
    )
    process.exit(0)
  }

  const homeDir = opts?.homeDir ?? homedir()
  const cwd = opts?.cwd ?? process.cwd()

  const report = await computeDoctorReport({ homeDir, cwd })
  renderReport(report.results, report.versionResult)
  process.exit(report.exitCode)
}
