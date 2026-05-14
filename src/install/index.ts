/**
 * Install/uninstall subcommand handlers.
 *
 * Plan 01 stubs — bodies will be replaced by Plan 02.
 * Exported signatures are the contracts Plans 02/05 depend on.
 */

export interface InstallOptions {
  scope?: string
}

export interface UninstallOptions {
  /** reserved for Plan 02 */
  backup?: boolean
}

/**
 * Run the install flow: wire hook entries into ~/.claude/settings.json and
 * MCP server entry into ~/.claude.json, create .mrclean/ in cwd.
 *
 * Plan 02 replaces this stub with the real implementation.
 */
export async function runInstall(opts: InstallOptions): Promise<void> {
  if (opts.scope === 'project') {
    process.stderr.write('install --scope project: not implemented in Phase 1\n')
    return
  }
  process.stderr.write('install: not implemented in Plan 01\n')
}

/**
 * Run the uninstall flow: remove mrclean-tagged entries from config files,
 * restore the most recent pre-install backup.
 *
 * Plan 02 replaces this stub with the real implementation.
 */
export async function runUninstall(opts: UninstallOptions): Promise<void> {
  process.stderr.write('uninstall: not implemented in Plan 01\n')
}
