/**
 * Atomic read/write of ~/.claude/settings.json for hook registration.
 *
 * Hooks go into ~/.claude/settings.json (NOT ~/.claude.json — see Pitfall #1).
 * Each mrclean entry is tagged with `_mrclean: true` for idempotent removal/upgrade.
 *
 * RESEARCH.md §1.5 (hook registration shape), §3.2 (idempotency strategy).
 */

import { access, constants } from 'node:fs/promises'
import { readJsonOrEmpty, atomicWriteJson, backupJson } from './atomic-json.js'
import { isMrcleanEntry } from './markers.js'

/**
 * The four hook events mrclean registers for.
 * Ordered per RESEARCH.md §1.1 for consistent output.
 */
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'] as const
type HookEvent = (typeof HOOK_EVENTS)[number]

/** Matcher per event. `undefined` means no matcher field (UserPromptSubmit). */
const HOOK_MATCHERS: Record<HookEvent, string | undefined> = {
  SessionStart: 'startup',
  UserPromptSubmit: undefined,    // No matcher support per RESEARCH §1.1
  PreToolUse: '*',
  PostToolUse: '*',
}

interface HookCommand {
  type: 'command'
  command: string
  args: string[]
  timeout: number
}

interface HookEntry {
  _mrclean: true
  matcher?: string
  hooks: HookCommand[]
}

/**
 * Write mrclean hook entries into settings.json for all four events.
 *
 * Idempotent: any existing `_mrclean: true` entries are replaced, not duplicated.
 * Creates a timestamped backup before writing if the file exists.
 *
 * @param settingsPath - Absolute path to ~/.claude/settings.json
 * @param nodePath     - Absolute path to the Node.js binary (process.execPath)
 * @param mrcleanBinPath - Absolute path to dist/cli.js
 * @param version      - mrclean version string (written to no field currently, reserved)
 */
export async function writeHookEntries(
  settingsPath: string,
  nodePath: string,
  mrcleanBinPath: string,
  _version: string,
): Promise<void> {
  const data = await readJsonOrEmpty(settingsPath)

  // Ensure hooks object exists
  if (typeof data.hooks !== 'object' || data.hooks === null || Array.isArray(data.hooks)) {
    data.hooks = {}
  }
  const hooks = data.hooks as Record<string, unknown[]>

  for (const event of HOOK_EVENTS) {
    // Ensure the event array exists
    if (!Array.isArray(hooks[event])) {
      hooks[event] = []
    }

    // Remove any existing mrclean entries (idempotency)
    hooks[event] = hooks[event].filter((entry) => !isMrcleanEntry(entry))

    // Build the new mrclean entry
    const hookCmd: HookCommand = {
      type: 'command',
      command: nodePath,
      args: [mrcleanBinPath, 'hook'],
      timeout: 10,
    }

    const matcher = HOOK_MATCHERS[event]
    const entry: HookEntry = matcher !== undefined
      ? { _mrclean: true, matcher, hooks: [hookCmd] }
      : { _mrclean: true, hooks: [hookCmd] }

    hooks[event] = [...hooks[event], entry]
  }

  // Backup the existing file before writing
  try {
    await access(settingsPath, constants.F_OK)
    await backupJson(settingsPath)
  } catch {
    // File does not exist yet — no backup needed
  }

  await atomicWriteJson(settingsPath, data)
}

/**
 * Remove all mrclean-tagged hook entries from settings.json.
 *
 * Preserves user-defined hooks. Leaves empty arrays for events that had
 * only mrclean entries (preserves the hooks object structure).
 * Creates a timestamped backup before writing.
 *
 * @param settingsPath - Absolute path to ~/.claude/settings.json
 */
export async function removeHookEntries(settingsPath: string): Promise<void> {
  const data = await readJsonOrEmpty(settingsPath)

  if (typeof data.hooks !== 'object' || data.hooks === null || Array.isArray(data.hooks)) {
    return // Nothing to do
  }

  const hooks = data.hooks as Record<string, unknown[]>
  let modified = false

  for (const event of Object.keys(hooks)) {
    const entries = hooks[event]
    if (!Array.isArray(entries)) continue

    const filtered = entries.filter((entry) => !isMrcleanEntry(entry))
    if (filtered.length !== entries.length) {
      hooks[event] = filtered
      modified = true
    }
  }

  if (!modified) return

  await backupJson(settingsPath)
  await atomicWriteJson(settingsPath, data)
}
