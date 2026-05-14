/**
 * Claude Code version detection for mrclean doctor.
 *
 * checkClaudeCodeVersion() spawns `claude --version`, parses the semver,
 * and classifies the result as:
 *   green  — version >= 2.1.100 (fully supported)
 *   yellow — version >= 2.0.0 but < 2.1.100 (partially supported; minor features may differ)
 *   red    — version < 2.0.0 (incompatible)
 *   not-found — `claude` binary not found, or version could not be parsed
 *
 * The dependency-injection seam (`runVersionCommand` option) lets tests inject
 * a mock so the test suite is hermetic. Default behavior actually runs `claude --version`.
 *
 * RESEARCH.md §4.3.
 */

import { spawnSync } from 'node:child_process'

/** Status classification for Claude Code version. */
export type ClaudeVersionStatus = 'green' | 'yellow' | 'red' | 'not-found'

/** Result returned by checkClaudeCodeVersion. */
export interface ClaudeVersionResult {
  status: ClaudeVersionStatus
  /** Parsed semver string, e.g. "2.1.141", or "not found" if unavailable. */
  version: string
  /** Human-readable description of the status. */
  detail: string
}

/** Options for checkClaudeCodeVersion. */
export interface CheckClaudeVersionOpts {
  /**
   * Override the command that fetches the Claude Code version string.
   * Default: spawn `claude --version` and return its stdout.
   *
   * TEST-ONLY: this seam exists so vitest tests can inject mock outputs
   * without relying on a real `claude` binary in the test environment.
   */
  runVersionCommand?: () => Promise<string>
}

/**
 * Default version command: spawn `claude --version` synchronously.
 * Throws if the binary is not found or exits non-zero.
 */
function defaultRunVersionCommand(): string {
  const result = spawnSync('claude', ['--version'], {
    encoding: 'utf8',
    timeout: 5_000,
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message ?? `claude --version exited ${String(result.status)}`,
    )
  }
  return (result.stdout ?? '').trim()
}

/**
 * Check the installed Claude Code version.
 *
 * Version compatibility table (RESEARCH §4.3):
 *   >= 2.1.100  → green  (hook contract stable since args exec form at v2.1.119)
 *   >= 2.0.0    → yellow (works but some newer features unavailable)
 *   <  2.0.0    → red    (incompatible — hook contract pre-dates Phase 1 requirements)
 *
 * Accept dep-injection via opts.runVersionCommand for hermetic test runs.
 */
export async function checkClaudeCodeVersion(
  opts?: CheckClaudeVersionOpts,
): Promise<ClaudeVersionResult> {
  let rawOutput: string

  try {
    if (opts?.runVersionCommand) {
      rawOutput = await opts.runVersionCommand()
    } else {
      rawOutput = defaultRunVersionCommand()
    }
  } catch {
    return {
      status: 'not-found',
      version: 'not found',
      detail: '`claude` binary not found or returned an error — install Claude Code and retry',
    }
  }

  // Parse: "2.1.141 (Claude Code)" → ["2", "1", "141"]
  const match = rawOutput.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    return {
      status: 'not-found',
      version: 'not found',
      detail: `unexpected version format from \`claude --version\`: ${rawOutput.slice(0, 80)}`,
    }
  }

  const version = `${match[1]}.${match[2]}.${match[3]}`
  const major = parseInt(match[1], 10)
  const minor = parseInt(match[2], 10)
  const patch = parseInt(match[3], 10)

  if (major >= 2 && minor >= 1 && patch >= 100) {
    return {
      status: 'green',
      version,
      detail: `${version} — fully compatible (args exec form supported, PostToolUse updatedToolOutput available)`,
    }
  }

  if (major >= 2) {
    return {
      status: 'yellow',
      version,
      detail: `${version} — partially compatible; upgrade to >= 2.1.100 for full feature support`,
    }
  }

  return {
    status: 'red',
    version,
    detail: `${version} — incompatible: mrclean requires Claude Code >= 2.0.0`,
  }
}
