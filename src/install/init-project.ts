/**
 * `mrclean init` — project-local environment scaffolding.
 *
 * Creates the project `.mrclean/` directory with a config.toml stub and seeds a
 * commented words.txt template, then ensures `.mrclean/` is gitignored. This is
 * the lightweight, project-only counterpart to `mrclean install` (which also
 * wires global ~/.claude hooks + MCP). init touches NOTHING global.
 *
 * Idempotent: never clobbers an existing config.toml or words.txt.
 *
 * Security note: words.txt holds proprietary terms the user does not want leaving
 * the machine — committing it would defeat the purpose — so init always ensures the
 * project-root .gitignore ignores `.mrclean/`.
 *
 * Deliberately a CLI command, NOT an MCP tool: the MCP surface enforces the MCP-03
 * invariant (exactly three read-only tools, no disk writes) to close a prompt-
 * injection surface. A write-capable MCP tool would break that.
 */

import { writeFile, access, constants } from 'node:fs/promises'
import { join } from 'node:path'
import pc from 'picocolors'
import { createProjectDir } from './project-dir.js'
import { addGitignoreEntries } from './gitignore.js'

/**
 * Comment-only words.txt seed.
 *
 * MUST contain no live entries — every non-comment, non-blank line becomes an
 * active blocklist term (layer4-words.ts). The example terms are commented out so
 * a freshly seeded file parses to zero entries.
 */
export const WORDS_TXT_STUB = `# .mrclean/words.txt — project-specific terms to redact.
#
# One term per line. Optional per-term action via \`term|action\`:
#   block (default) — redact and block the prompt
#   warn            — redact, log to audit, do NOT block
#   audit           — log to audit only, no block, no banner
#
# Lines starting with # are comments; blank lines are ignored.
# Matching is case-insensitive and whole-word. Hot-reloaded every SessionStart.
#
# Examples — delete these and add your own:
# project-bluebird
# internal-api.acme.com
# customer-acme|warn
# old-codename|audit
`

export interface InitResult {
  /** Absolute path to the project .mrclean/ directory. */
  dir: string
  /** True if config.toml was written this run (false if it already existed). */
  configCreated: boolean
  /** True if words.txt was written this run (false if it already existed). */
  wordsCreated: boolean
}

export interface RunInitOpts {
  /** Project root. Defaults to process.cwd(). */
  cwd?: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Scaffold the project-local mrclean environment. Idempotent and non-clobbering.
 */
export async function runInit(opts: RunInitOpts = {}): Promise<InitResult> {
  const cwd = opts.cwd ?? process.cwd()
  const dirPath = join(cwd, '.mrclean')
  const configPath = join(dirPath, 'config.toml')
  const wordsPath = join(dirPath, 'words.txt')

  // Capture pre-state so the summary reports created vs already-present accurately.
  const configExisted = await exists(configPath)

  // createProjectDir creates .mrclean/ + the config.toml stub (idempotent, no clobber).
  await createProjectDir(cwd)
  const configCreated = !configExisted

  const wordsExisted = await exists(wordsPath)
  if (!wordsExisted) {
    await writeFile(wordsPath, WORDS_TXT_STUB, { encoding: 'utf8', mode: 0o644 })
  }
  const wordsCreated = !wordsExisted

  // Ensure proprietary terms in words.txt never get committed.
  await addGitignoreEntries(cwd)

  const result: InitResult = { dir: dirPath, configCreated, wordsCreated }
  printSummary(result)
  return result
}

function printSummary(result: InitResult): void {
  const tag = (created: boolean): string =>
    created ? pc.green('created') : pc.dim('already present')

  process.stdout.write(
    pc.green('mrclean init') +
      pc.dim(` — ${result.dir} ready`) +
      '\n' +
      `  config.toml  ${tag(result.configCreated)}\n` +
      `  words.txt    ${tag(result.wordsCreated)}\n` +
      `  .gitignore   ${pc.dim('.mrclean/ ignored')}\n` +
      pc.dim('  Add proprietary terms to words.txt (one per line). Hot-reloads next session.') +
      '\n',
  )
}
