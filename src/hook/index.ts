/**
 * Hook subcommand entrypoint — reads stdin JSON from Claude Code, dispatches
 * to the appropriate event handler, writes JSON response to stdout, exits.
 *
 * Architecture (RESEARCH.md §6.3):
 *   1. Install crash guards FIRST (uncaughtException + unhandledRejection → exit 2)
 *   2. Read stdin with 10s timeout (Pitfall #4 — Windows/Git Bash pipe stall)
 *   3. JSON.parse the payload
 *   4. dispatch(input) → HookOutput | null
 *   5. Write JSON to stdout (or nothing for null pass-through)
 *   6. Exit 0 on success, exit 2 on any error with structured stderr
 *
 * HOOK-06: stdout receives ONLY the JSON response object (or nothing).
 *          Diagnostics and errors go to stderr only.
 * HOOK-05: fail-closed — any uncaught exception exits 2 with structured stderr.
 */

import { VERSION } from '../shared/version.js'
import { installCrashGuards, writeFailClosedError } from './failclosed.js'
import { readStdinWithTimeout, StdinTimeoutError } from './stdin.js'
import { dispatch } from './dispatcher.js'
import type { HookInput } from '../shared/types.js'

/**
 * Run the hook: install crash guards, read stdin, dispatch event, write stdout, exit.
 *
 * This function never returns — it always calls process.exit().
 */
export async function runHook(): Promise<void> {
  // Install crash guards FIRST — before any other user code — so every
  // subsequent failure path is covered (HOOK-05).
  installCrashGuards(VERSION)

  // Read stdin with a 10-second timeout.
  // Pitfall #4 (RESEARCH.md §8.4): On Windows/Git Bash, stdin pipes can stall.
  // Exit 0 silently on timeout — never block the operator on an upstream stall.
  let raw: string
  try {
    raw = await readStdinWithTimeout(10_000)
  } catch (err) {
    if (err instanceof StdinTimeoutError) {
      process.exit(0)
    }
    writeFailClosedError(err, { version: VERSION, phase: 'stdin' })
    process.exit(2)
  }

  // Empty stdin → pass through silently (Claude Code proceeds normally)
  if (raw.trim() === '') {
    process.exit(0)
  }

  // Parse the hook payload
  let input: HookInput
  try {
    input = JSON.parse(raw) as HookInput
  } catch (err) {
    writeFailClosedError(err, { version: VERSION, phase: 'parse' })
    process.exit(2)
  }

  // Dispatch to the appropriate handler and write the result to stdout
  try {
    const result = dispatch(input)
    if (result !== null) {
      process.stdout.write(JSON.stringify(result))
    }
    process.exit(0)
  } catch (err) {
    writeFailClosedError(err, { version: VERSION, phase: 'dispatch', event: input.hook_event_name })
    process.exit(2)
  }
}
