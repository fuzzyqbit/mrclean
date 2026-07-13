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
 * Build the fail-closed hook command Claude Code spawns for every event.
 *
 * A `type: "command"` hook runs in **exec form when `args` is present** — Claude
 * Code resolves `command` as an executable and spawns it directly with `args`,
 * no shell. Claude Code only BLOCKS a tool call when the hook exits 2; every
 * other non-zero exit is treated as a non-blocking error by platform design.
 *
 * The old shape (`command: node, args: [bin, 'hook']`) therefore fails OPEN when
 * the bin is deleted/renamed: `node <missing> hook` exits 1 (module-not-found)
 * or ENOENT, so mrclean never gets to exit 2 and the tool call silently proceeds
 * (SC4 / HOOK-05 hole). See 01-06 design_notes.
 *
 * POSIX (darwin/linux) — primary, deterministically tested:
 *   command = `/bin/sh`
 *   args    = `['-c', '"$1" "$2" hook || exit 2', 'mrclean-hook', nodePath, binPath]`
 *   `$0` = `mrclean-hook` label, `$1` = nodePath, `$2` = binPath. sh QUOTES the
 *   positional params — no string interpolation of paths, so no shell injection
 *   and spaces/metacharacters are handled. `node <bin> hook` inherits sh's
 *   stdin/stdout/stderr (the hook payload still flows in on stdin; the hook's
 *   stdout JSON — banner / permissionDecision — flows straight back out).
 *   `|| exit 2` fires on ANY non-zero inner status (1, 2, 127, signal death) →
 *   sh exits 2 (BLOCK). Inner exit 0 short-circuits `||` → sh exits 0 (PASS).
 *   The wrapper lives in the OS shell (not the deletable `dist/`), so it survives
 *   bin deletion and fails CLOSED.
 *
 * win32 — KNOWN GAP (no wrapper this plan): keeps the plain exec form
 *   (`command: nodePath, args: [binPath, 'hook']`). The cmd.exe nested-quote
 *   wrapper is fragile/untested — a single mis-quote would false-positive BLOCK
 *   every tool call. win32 therefore stays fail-OPEN on spawn failure until a
 *   tested wrapper ships (documented known-gap; the constraints deprioritize
 *   Windows). No shell wrapper → no shell-injection surface.
 *
 * @param nodePath       - Absolute path to the Node.js binary (process.execPath)
 * @param mrcleanBinPath - Absolute path to dist/cli.js
 * @param platform       - Target platform (defaults to process.platform)
 */
export function buildHookCommand(
  nodePath: string,
  mrcleanBinPath: string,
  platform: NodeJS.Platform = process.platform,
): HookCommand {
  if (platform === 'win32') {
    // KNOWN GAP: plain exec form, no shell wrapper — stays fail-OPEN on a
    // missing bin until a tested cmd.exe wrapper ships.
    return {
      type: 'command',
      command: nodePath,
      args: [mrcleanBinPath, 'hook'],
      timeout: 10,
    }
  }

  // POSIX: fail-closed /bin/sh wrapper. `"$1" "$2"` are shell-quoted (no
  // interpolation → injection-safe, space-safe); `|| exit 2` remaps ANY inner
  // failure to a BLOCK.
  return {
    type: 'command',
    command: '/bin/sh',
    args: ['-c', '"$1" "$2" hook || exit 2', 'mrclean-hook', nodePath, mrcleanBinPath],
    timeout: 10,
  }
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

    // Build the new mrclean entry via the fail-closed wrapper (HOOK-05).
    // The `_mrclean: true` marker stays on the OUTER entry (below), so the
    // wrapper shape change does not affect idempotent replace/remove.
    const hookCmd: HookCommand = buildHookCommand(nodePath, mrcleanBinPath)

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
