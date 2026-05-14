/**
 * Six individual check functions for mrclean doctor.
 *
 * Each check returns a CheckResult with:
 *   name         — short identifier for the check
 *   status       — 'PASS' | 'FAIL' | 'SKIP'
 *   detail       — one-line human-readable description
 *   exitCodeOnFail — exit code this check contributes if it fails (RESEARCH §4.4)
 *
 * Exit code map (LOCKED — RESEARCH §4.4):
 *   1 — hooks not registered / config-load error
 *   2 — MCP server not registered
 *   3 — registered binary path not executable
 *   4 — canary round-trip failed
 *
 * No check function terminates the process — only runDoctor (index.ts) may do so.
 *
 * Plan 01-05.
 */

import { access, constants } from 'node:fs/promises'
import { readJsonOrEmpty } from '../install/atomic-json.js'
import { isMrcleanEntry } from '../install/markers.js'
import { loadEffectiveConfig, ConfigReadError } from '../config/index.js'
import { runHookCanary, runMcpCanary } from './canary.js'

// ---------------------------------------------------------------------------
// CheckResult
// ---------------------------------------------------------------------------

/** Structured result returned by every doctor check function. */
export interface CheckResult {
  name: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  detail: string
  /** Exit code contributed if this check fails (matches RESEARCH §4.4 map). */
  exitCodeOnFail: number
}

// ---------------------------------------------------------------------------
// Required hook events
// ---------------------------------------------------------------------------

const REQUIRED_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
] as const

// ---------------------------------------------------------------------------
// checkHooksRegistered
// ---------------------------------------------------------------------------

/**
 * Verify that all four hook events are registered in settings.json with
 * at least one mrclean-tagged entry (`_mrclean: true`).
 */
export async function checkHooksRegistered(settingsPath: string): Promise<CheckResult> {
  const data = await readJsonOrEmpty(settingsPath)

  const hooks = data.hooks as Record<string, unknown[]> | undefined
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    return {
      name: 'hooks',
      status: 'FAIL',
      detail: 'no mrclean hook entries found in settings.json (missing hooks object)',
      exitCodeOnFail: 1,
    }
  }

  const missing: string[] = []

  for (const event of REQUIRED_EVENTS) {
    const entries = hooks[event]
    if (!Array.isArray(entries) || !entries.some((e) => isMrcleanEntry(e))) {
      missing.push(event)
    }
  }

  if (missing.length > 0) {
    if (missing.length === REQUIRED_EVENTS.length) {
      return {
        name: 'hooks',
        status: 'FAIL',
        detail: 'no mrclean hook entries found — run `mrclean install`',
        exitCodeOnFail: 1,
      }
    }
    return {
      name: 'hooks',
      status: 'FAIL',
      detail: `missing mrclean hook entries for: ${missing.join(', ')} — run \`mrclean install\``,
      exitCodeOnFail: 1,
    }
  }

  return {
    name: 'hooks',
    status: 'PASS',
    detail: `4 hook events registered (${REQUIRED_EVENTS.join(', ')})`,
    exitCodeOnFail: 1,
  }
}

// ---------------------------------------------------------------------------
// checkMcpRegistered
// ---------------------------------------------------------------------------

/**
 * Verify that the mrclean MCP server entry exists in ~/.claude.json under
 * `projects[projectCwd].mcpServers.mrclean` with `type === 'stdio'`.
 */
export async function checkMcpRegistered(
  claudeJsonPath: string,
  projectCwd: string,
): Promise<CheckResult> {
  const data = await readJsonOrEmpty(claudeJsonPath)

  const projects = data.projects as Record<string, Record<string, unknown>> | undefined
  const project = projects?.[projectCwd] as Record<string, unknown> | undefined
  const mcpServers = project?.mcpServers as Record<string, unknown> | undefined
  const mrcleanEntry = mcpServers?.mrclean as Record<string, unknown> | undefined

  if (!mrcleanEntry || mrcleanEntry.type !== 'stdio') {
    return {
      name: 'mcp',
      status: 'FAIL',
      detail: `mrclean MCP server not registered in ${claudeJsonPath} for project ${projectCwd} — run \`mrclean install\``,
      exitCodeOnFail: 2,
    }
  }

  return {
    name: 'mcp',
    status: 'PASS',
    detail: `mrclean MCP server registered (type: stdio) for ${projectCwd}`,
    exitCodeOnFail: 2,
  }
}

// ---------------------------------------------------------------------------
// checkBinsExecutable — internal helper to collect registered binary paths
// ---------------------------------------------------------------------------

/**
 * Extract absolute mrclean binary paths registered in settings.json (hook entries)
 * and in claude.json (MCP server entry).
 *
 * Returns a deduplicated array of absolute paths.
 *
 * @public — used by computeDoctorReport in index.ts to pass the registered paths
 * to the canary checks rather than re-resolving from the running process (which
 * would return the wrong path when invoked from within vitest).
 */
export async function collectRegisteredBinPaths(
  settingsPath: string,
  claudeJsonPath: string,
  projectCwd: string,
): Promise<string[]> {
  const paths = new Set<string>()

  // --- From settings.json hook entries ---
  const settingsData = await readJsonOrEmpty(settingsPath)
  const hooks = settingsData.hooks as Record<string, unknown[]> | undefined

  if (hooks && typeof hooks === 'object') {
    for (const event of REQUIRED_EVENTS) {
      const entries = hooks[event]
      if (!Array.isArray(entries)) continue
      for (const entry of entries) {
        if (!isMrcleanEntry(entry)) continue
        const hookCmds = (entry as Record<string, unknown>).hooks as Array<Record<string, unknown>>
        if (!Array.isArray(hookCmds)) continue
        for (const cmd of hookCmds) {
          const args = cmd.args as string[] | undefined
          // args[0] is the mrclean bin path (process.execPath is in `command`)
          if (Array.isArray(args) && typeof args[0] === 'string') {
            paths.add(args[0])
          }
        }
      }
    }
  }

  // --- From claude.json MCP server entry ---
  const claudeData = await readJsonOrEmpty(claudeJsonPath)
  const projects = claudeData.projects as Record<string, Record<string, unknown>> | undefined
  const project = projects?.[projectCwd] as Record<string, unknown> | undefined
  const mcpServers = project?.mcpServers as Record<string, unknown> | undefined
  const mrcleanEntry = mcpServers?.mrclean as Record<string, unknown> | undefined
  const mcpArgs = mrcleanEntry?.args as string[] | undefined

  if (Array.isArray(mcpArgs) && typeof mcpArgs[0] === 'string') {
    paths.add(mcpArgs[0])
  }

  return [...paths]
}

/**
 * Extract the node binary path and hook/MCP script paths from the registered
 * settings.json and claude.json. Used by computeDoctorReport to run canaries
 * against the installed paths (not the running process argv[1]).
 *
 * Returns:
 *   nodePath    — the registered node binary path (from the first hook command)
 *   hookBinPath — the mrclean CLI bin (first arg of the hook command)
 *   mcpBinPath  — the MCP server bin (first arg of the MCP entry)
 *
 * Returns process.execPath / empty strings if the entries are not found (graceful).
 */
export async function extractRegisteredPaths(
  settingsPath: string,
  claudeJsonPath: string,
  projectCwd: string,
): Promise<{ nodePath: string; hookBinPath: string; mcpBinPath: string }> {
  const settingsData = await readJsonOrEmpty(settingsPath)
  const hooks = settingsData.hooks as Record<string, unknown[]> | undefined

  let nodePath = process.execPath
  let hookBinPath = ''

  if (hooks && typeof hooks === 'object') {
    outer: for (const event of REQUIRED_EVENTS) {
      const entries = hooks[event]
      if (!Array.isArray(entries)) continue
      for (const entry of entries) {
        if (!isMrcleanEntry(entry)) continue
        const hookCmds = (entry as Record<string, unknown>).hooks as Array<Record<string, unknown>>
        if (!Array.isArray(hookCmds)) continue
        for (const cmd of hookCmds) {
          const command = cmd.command as string | undefined
          const args = cmd.args as string[] | undefined
          if (typeof command === 'string') nodePath = command
          if (Array.isArray(args) && typeof args[0] === 'string') hookBinPath = args[0]
          if (hookBinPath) break outer
        }
      }
    }
  }

  const claudeData = await readJsonOrEmpty(claudeJsonPath)
  const projects = claudeData.projects as Record<string, Record<string, unknown>> | undefined
  const project = projects?.[projectCwd] as Record<string, unknown> | undefined
  const mcpServers = project?.mcpServers as Record<string, unknown> | undefined
  const mrcleanEntry = mcpServers?.mrclean as Record<string, unknown> | undefined
  const mcpArgs = mrcleanEntry?.args as string[] | undefined
  const mcpBinPath = Array.isArray(mcpArgs) && typeof mcpArgs[0] === 'string' ? mcpArgs[0] : ''

  return { nodePath, hookBinPath, mcpBinPath }
}

/**
 * Verify that all registered mrclean binary paths are still executable.
 *
 * Reads the actual paths from settings.json and claude.json and calls
 * fs.access(path, X_OK) for each. Fails fast on the first non-executable path.
 */
export async function checkBinsExecutable(
  settingsPath: string,
  claudeJsonPath: string,
  projectCwd: string,
): Promise<CheckResult> {
  const binPaths = await collectRegisteredBinPaths(settingsPath, claudeJsonPath, projectCwd)

  if (binPaths.length === 0) {
    return {
      name: 'bins',
      status: 'FAIL',
      detail: 'no registered mrclean binary paths found — run `mrclean install`',
      exitCodeOnFail: 3,
    }
  }

  for (const binPath of binPaths) {
    try {
      await access(binPath, constants.X_OK)
    } catch {
      return {
        name: 'bins',
        status: 'FAIL',
        detail: `registered binary is not executable: ${binPath}`,
        exitCodeOnFail: 3,
      }
    }
  }

  return {
    name: 'bins',
    status: 'PASS',
    detail: `all ${binPaths.length} registered binary path(s) are executable`,
    exitCodeOnFail: 3,
  }
}

// ---------------------------------------------------------------------------
// checkHookCanary
// ---------------------------------------------------------------------------

/**
 * Run the hook canary round-trip and wrap the result in a CheckResult.
 */
export async function checkHookCanary(
  nodePath: string,
  mrcleanBin: string,
): Promise<CheckResult> {
  const { ok, detail } = await runHookCanary(nodePath, mrcleanBin)
  return {
    name: 'hook-canary',
    status: ok ? 'PASS' : 'FAIL',
    detail,
    exitCodeOnFail: 4,
  }
}

// ---------------------------------------------------------------------------
// checkMcpCanary
// ---------------------------------------------------------------------------

/**
 * Run the MCP canary round-trip and wrap the result in a CheckResult.
 */
export async function checkMcpCanary(
  nodePath: string,
  mcpBin: string,
): Promise<CheckResult> {
  const { ok, detail } = await runMcpCanary(nodePath, mcpBin)
  return {
    name: 'mcp-canary',
    status: ok ? 'PASS' : 'FAIL',
    detail,
    exitCodeOnFail: 4,
  }
}

// ---------------------------------------------------------------------------
// checkConfigLoad
// ---------------------------------------------------------------------------

/**
 * Exercise the three-layer config reader from Plan 01-02b.
 *
 * Calls loadEffectiveConfig({ homeDir, cwd }):
 *   - PASS if config resolves (missing files are normal — uses bundled defaults).
 *   - FAIL with exitCodeOnFail=1 if a ConfigReadError is thrown (malformed file).
 *   - FAIL with exitCodeOnFail=1 for any other unexpected error.
 *
 * The detail message distinguishes between "bundled defaults" and "loaded override".
 * This makes CFG-01/CFG-03 operator-observable via doctor output.
 */
export async function checkConfigLoad(homeDir: string, cwd: string): Promise<CheckResult> {
  const { join } = await import('node:path')
  const { access: fsAccess, constants: fsConstants } = await import('node:fs/promises')

  // Probe whether either config file exists, so we can give an informative detail.
  const userConfigPath = join(homeDir, '.mrclean', 'config.toml')
  const projectConfigPath = join(cwd, '.mrclean', 'config.toml')

  let userExists = false
  let projectExists = false
  try { await fsAccess(userConfigPath, fsConstants.F_OK); userExists = true } catch { /* ok */ }
  try { await fsAccess(projectConfigPath, fsConstants.F_OK); projectExists = true } catch { /* ok */ }

  try {
    await loadEffectiveConfig({ homeDir, cwd })

    if (!userExists && !projectExists) {
      return {
        name: 'config-load',
        status: 'PASS',
        detail: 'using bundled defaults (no config.toml files found)',
        exitCodeOnFail: 1,
      }
    }

    const sources: string[] = []
    if (userExists) sources.push('~/.mrclean/config.toml')
    if (projectExists) sources.push('project-local config loaded')
    return {
      name: 'config-load',
      status: 'PASS',
      detail: sources.join('; '),
      exitCodeOnFail: 1,
    }
  } catch (err) {
    if (err instanceof ConfigReadError) {
      return {
        name: 'config-load',
        status: 'FAIL',
        detail: `malformed config file: ${err.path}: ${err.reason}`,
        exitCodeOnFail: 1,
      }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return {
      name: 'config-load',
      status: 'FAIL',
      detail: `config-load unexpected error: ${msg}`,
      exitCodeOnFail: 1,
    }
  }
}
