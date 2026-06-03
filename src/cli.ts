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

// init subcommand — project-local scaffolding only (no global wiring)
program
  .command('init')
  .description('Scaffold project .mrclean/ with a config.toml stub and a words.txt seed')
  .action(async () => {
    const { runInit } = await import('./install/init-project.js')
    await runInit({})
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

// ignore subcommand (CFG-04)
program
  .command('ignore <fingerprint>')
  .description('Add a fingerprint to the project-local allowlist (.mrclean/config.toml)')
  .action(async (fingerprint: string) => {
    const { runIgnore } = await import('./install/ignore.js')
    await runIgnore({ fingerprint })
  })

// pii parent command + fetch-model subcommand
//
// The dynamic import keeps model/ML code OFF the cold path — users who never
// opt in to PII NER never load model-cache.ts (MODEL-02 cold-path invariant).
const piiCmd = program
  .command('pii')
  .description('PII NER model management (opt-in — off by default)')

piiCmd
  .command('fetch-model')
  .description(
    'Download or side-load the NER model (Xenova/bert-base-NER) into ~/.mrclean/models/',
  )
  .option('--from <path>', 'Side-load from a local file instead of downloading from HuggingFace')
  .action(async (opts: { from?: string }) => {
    const { downloadModel, sideLoadModel } = await import('./model/model-cache.js')
    const { homedir } = await import('node:os')
    const homeDir = homedir()

    if (opts.from) {
      process.stderr.write(`[mrclean] Side-loading model from ${opts.from}\n`)
      await sideLoadModel(homeDir, opts.from)
      process.stderr.write('[mrclean] Model side-loaded and verified successfully.\n')
    } else {
      process.stderr.write('[mrclean] Downloading NER model (~108 MB, one-time)...\n')
      await downloadModel(homeDir, {
        onProgress: (pct) => {
          process.stderr.write(`\r[mrclean] Download progress: ${pct}%`)
        },
      })
      process.stderr.write('\n[mrclean] Model downloaded and verified successfully.\n')
    }
  })

// doctor subcommand
program
  .command('doctor')
  .description('Verify mrclean installation: hook entries, MCP server, canary round-trip')
  .option('--verbose', 'Print detailed check output', false)
  .option('--bench', 'Run a performance benchmark stub (Phase 3 will add the assertion gate)', false)
  .action(async (opts: { verbose: boolean; bench: boolean }) => {
    const { runDoctor } = await import('./doctor/index.js')
    await runDoctor({ verbose: opts.verbose, bench: opts.bench })
  })

// Entrypoint guard: only parse argv when this file is the main module.
// This prevents Commander from consuming process.argv during test imports.
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  await program.parseAsync(process.argv)
}

export { program }
