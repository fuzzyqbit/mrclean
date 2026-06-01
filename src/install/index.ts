/**
 * Install/uninstall orchestrators.
 *
 * Composes the foundation modules into the end-to-end install and uninstall flows.
 * Accepts dependency-injected options for testability (homeDir, cwd, nodePath, paths).
 *
 * Plan 02 replaces the Plan 01 stubs with real implementations.
 *
 * RESEARCH.md §3.1 (install flow), §3.2 (idempotency), §3.3 (atomic writes),
 * OQ-2 (cwd = process.cwd() at install time), OQ-3 (user-scope default).
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import pc from 'picocolors'

import { writeHookEntries, removeHookEntries } from './settings.js'
import { writeMcpServerEntry, removeMcpServerEntry } from './mcp-config.js'
import { createProjectDir } from './project-dir.js'
import { addGitignoreEntries, removeGitignoreEntries } from './gitignore.js'
import { resolveNodePath, resolveMrcleanBinPath, resolveMrcleanMcpPath } from './path-resolver.js'
import { VERSION } from '../shared/version.js'

export interface InstallOpts {
  /** Registration scope. Only 'user' is supported in Phase 1. */
  scope?: 'user' | 'project'
  /** Home directory for config files. Defaults to os.homedir(). Injected in tests. */
  homeDir?: string
  /** Current working directory (project root). Defaults to process.cwd(). Injected in tests. */
  cwd?: string
  /** Absolute path to the Node.js binary. Injected in tests; resolveNodePath() otherwise. */
  nodePath?: string
  /** Absolute path to dist/cli.js. Injected in tests; resolveMrcleanBinPath() otherwise. */
  mrcleanBinPath?: string
  /** Absolute path to dist/mcp.js. Injected in tests; resolveMrcleanMcpPath() otherwise. */
  mcpBinPath?: string
}

export interface UninstallOpts {
  /** Home directory for config files. Defaults to os.homedir(). Injected in tests. */
  homeDir?: string
  /** Current working directory (project root). Defaults to process.cwd(). Injected in tests. */
  cwd?: string
}

/**
 * Run the full install flow:
 * 1. Resolve absolute paths for node + mrclean bins.
 * 2. Write hook entries into ~/.claude/settings.json.
 * 3. Write MCP server entry into ~/.claude.json.
 * 4. Create .mrclean/ in cwd with stub config.toml.
 * 5. Add managed block to project-root .gitignore.
 * 6. Print success banner.
 *
 * Phase 1: only 'user' scope is supported.
 */
export async function runInstall(opts?: InstallOpts): Promise<void> {
  if (opts?.scope === 'project') {
    throw new Error(
      'not implemented in Phase 1: --scope project will write to .mcp.json in Phase 3'
    )
  }

  const home = opts?.homeDir ?? homedir()
  const cwd = opts?.cwd ?? process.cwd()

  const nodePath = opts?.nodePath ?? resolveNodePath()
  const mrcleanBin = opts?.mrcleanBinPath ?? await resolveMrcleanBinPath()
  const mcpBin = opts?.mcpBinPath ?? await resolveMrcleanMcpPath()

  const settingsPath = join(home, '.claude', 'settings.json')
  const claudeJsonPath = join(home, '.claude.json')

  await writeHookEntries(settingsPath, nodePath, mrcleanBin, VERSION)
  await writeMcpServerEntry(claudeJsonPath, nodePath, mcpBin, cwd)
  await createProjectDir(cwd)
  await addGitignoreEntries(cwd)

  process.stdout.write(
    pc.green(`mrclean v${VERSION} installed`) +
    pc.dim(' (hooks: 4, MCP server: mrclean)') +
    '\n'
  )
}

/**
 * Run the full uninstall flow:
 * 1. Surgically remove mrclean hook entries from ~/.claude/settings.json.
 * 2. Surgically remove the mrclean MCP server entry from ~/.claude.json.
 * 3. Remove the managed block from the project-root .gitignore.
 * 4. Print completion message.
 *
 * Removal strategy: SURGICAL, never wholesale-restore. settings.json and ~/.claude.json
 * are shared global files the user edits independently (enabling plugins, tweaking
 * permissions, etc.). Restoring a pre-install backup snapshot would silently clobber every
 * unrelated change made after install. Instead we remove only mrclean's own entries:
 * removeHookEntries filters by the `_mrclean` marker; removeMcpServerEntry deletes the
 * `mrclean` key. Install still writes timestamped backups as a manual safety net — we just
 * never auto-restore them.
 *
 * NOTE: .mrclean/ directory is intentionally NOT deleted.
 * The operator's config.toml, words.txt, and audit log are preserved.
 */
export async function runUninstall(opts?: UninstallOpts): Promise<void> {
  const home = opts?.homeDir ?? homedir()
  const cwd = opts?.cwd ?? process.cwd()

  const settingsPath = join(home, '.claude', 'settings.json')
  const claudeJsonPath = join(home, '.claude.json')

  await removeHookEntries(settingsPath)
  await removeMcpServerEntry(claudeJsonPath, cwd)
  await removeGitignoreEntries(cwd)

  process.stdout.write(
    pc.yellow('mrclean uninstalled') +
    pc.dim(' (mrclean entries removed; your other settings and .mrclean/ left intact)') +
    '\n'
  )
}

