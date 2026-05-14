#!/usr/bin/env node
/**
 * mrclean CLI entrypoint.
 *
 * Commander root with registered (stub) subcommands:
 *   install   → src/install/index.ts → runInstall(opts)   (Plan 02)
 *   uninstall → src/install/index.ts → runUninstall(opts) (Plan 02)
 *   hook      → src/hook/index.ts    → runHook()          (Plan 03)
 *   doctor    → src/doctor/index.ts  → runDoctor(opts)    (Plan 05)
 *
 * IMPORTANT: commander is pinned to ^13.x (CLAUDE.md LOCK).
 * The .command().option().action().parseAsync() surface is identical in 13 and 14.
 *
 * The entrypoint guard (import.meta.url check) prevents parseAsync from running
 * when this module is imported in tests.
 */

import { Command } from 'commander'
import { VERSION } from './shared/version.js'

const program = new Command()

program
  .name('mrclean')
  .description('In-session secret sanitizer for Claude Code')
  .version(VERSION)

// install subcommand
program
  .command('install')
  .description('Wire mrclean hook + MCP server into ~/.claude/settings.json and ~/.claude.json')
  .option('--scope <scope>', 'Registration scope: user or project', 'user')
  .action(async (opts: { scope: string }) => {
    const { runInstall } = await import('./install/index.js')
    const scope = opts.scope === 'project' ? 'project' : 'user'
    await runInstall({ scope })
  })

// uninstall subcommand
program
  .command('uninstall')
  .description('Remove mrclean hook + MCP entries and restore the pre-install backup')
  .action(async () => {
    const { runUninstall } = await import('./install/index.js')
    await runUninstall({})
  })

// hook subcommand (the one-shot stdin/stdout handler)
program
  .command('hook')
  .description('Hook handler — reads Claude Code hook event from stdin, writes JSON to stdout')
  .action(async () => {
    const { runHook } = await import('./hook/index.js')
    await runHook()
  })

// doctor subcommand
program
  .command('doctor')
  .description('Verify mrclean installation: hook entries, MCP server, canary round-trip')
  .option('--verbose', 'Print detailed check output', false)
  .action(async (opts: { verbose: boolean }) => {
    const { runDoctor } = await import('./doctor/index.js')
    await runDoctor({ verbose: opts.verbose })
  })

// Entrypoint guard: only parse argv when this file is the main module.
// This prevents Commander from consuming process.argv during test imports.
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  await program.parseAsync(process.argv)
}

export { program }
