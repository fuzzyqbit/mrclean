/**
 * Doctor report renderer and exit code calculator.
 *
 * renderReport: prints PASS/FAIL/SKIP lines to stdout with picocolors,
 *   followed by the version line.
 *
 * computeExitCode: returns 0 if all checks PASS, otherwise the first failing
 *   check's exitCodeOnFail (preserving the priority order of the results array).
 *
 * This module never terminates the process — only runDoctor (index.ts) may do so.
 *
 * Plan 01-05.
 */

import pc from 'picocolors'
import type { CheckResult } from './checks.js'
import type { ClaudeVersionResult } from './version-check.js'

/**
 * Pretty-print one line per check result, then the version line.
 *
 * Format:
 *   [PASS] <check name> — <detail>   (green)
 *   [FAIL] <check name> — <detail>   (red)
 *   [SKIP] <check name> — <detail>   (dim/gray)
 *   [<status>] claude --version: <version> — <detail>
 */
export function renderReport(
  results: CheckResult[],
  versionResult: ClaudeVersionResult,
): void {
  for (const r of results) {
    const label = `[${r.status}]`
    const line = `${label} ${r.name} — ${r.detail}`
    if (r.status === 'PASS') {
      process.stdout.write(pc.green(line) + '\n')
    } else if (r.status === 'FAIL') {
      process.stdout.write(pc.red(line) + '\n')
    } else {
      process.stdout.write(pc.dim(line) + '\n')
    }
  }

  // Version line
  const vLabel = versionResult.status === 'green'
    ? pc.green(`[green]`)
    : versionResult.status === 'yellow'
    ? pc.yellow(`[yellow]`)
    : versionResult.status === 'not-found'
    ? pc.dim(`[not-found]`)
    : pc.red(`[red]`)

  process.stdout.write(
    `${vLabel} claude --version: ${versionResult.version} — ${versionResult.detail}\n`,
  )
}

/**
 * Compute the final exit code for the doctor report.
 *
 * Returns 0 if all check results have status 'PASS' or 'SKIP'.
 * Otherwise returns the exitCodeOnFail of the first FAIL entry in the results array.
 * This preserves the priority order defined in computeDoctorReport (hooks → mcp →
 * bins → canaries → config-load).
 */
export function computeExitCode(results: CheckResult[]): number {
  for (const r of results) {
    if (r.status === 'FAIL') {
      return r.exitCodeOnFail
    }
  }
  return 0
}
