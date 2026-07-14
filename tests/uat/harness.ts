/**
 * Shared UAT harness — extracted from tests/uat/live-session.test.ts (Plan 08-04).
 *
 * Drives a real Claude Code CLI headlessly (`claude -p`) and parses its
 * stream-json output. Consumed by:
 *   - tests/uat/live-session.test.ts        (phase 01 human items)
 *   - tests/uat/contract-verification.test.ts (phase 08 E1–E5 contract experiments)
 *
 * NOT a test file — the vitest `uat` project only matches tests/uat/**\/*.test.ts,
 * so this module is never collected as a suite.
 *
 * Isolation contract (UAT-2b precedent): callers supply sandbox --settings /
 * --mcp-config paths; the operator's ~/.claude/settings.json is never touched.
 */

import { spawnSync } from 'node:child_process'

/** Model + turn caps keep a full run at a few cents of Haiku usage. */
export const CLAUDE_MODEL = 'claude-haiku-4-5'
export const MAX_TURNS = 4
export const CLAUDE_TIMEOUT_MS = 150_000

export interface StreamEvent {
  type: string
  subtype?: string
  result?: string
  is_error?: boolean
  /** Present on system/init (and most) events — used by E3 continuity checks. */
  session_id?: string
  /** assistant/user events carry the API message; content blocks live here. */
  message?: { content?: unknown }
  mcp_servers?: Array<{ name: string; status: string }>
}

export interface ClaudeRun {
  status: number | null
  events: StreamEvent[]
  init: StreamEvent | undefined
  resultEvent: StreamEvent | undefined
  resultText: string
  rawStdout: string
  rawStderr: string
}

export interface RunClaudeOptions {
  /** Project directory the session runs in (sandbox project, never the repo). */
  cwd: string
  /** When set, passed as `--mcp-config <path> --strict-mcp-config`. */
  mcpConfigPath?: string
  /** Extra CLI args appended after the standard flag set. */
  extraArgs?: string[]
  /** Extra env vars merged over process.env (e.g. fixture side-file paths). */
  env?: Record<string, string>
  /** Turn-cap override; defaults to MAX_TURNS. */
  maxTurns?: number
  /**
   * Per-run spawn timeout override; defaults to CLAUDE_TIMEOUT_MS. Needed for
   * runs where deferred MCP tool discovery (ToolSearch) adds turns before the
   * tool call lands (observed on CC 2.1.209 in the E1/MCP experiment).
   */
  timeoutMs?: number
}

/**
 * Guard against vacuous passes: a run that never produced a model turn (auth
 * failure, CLI error) must abort the test loudly instead of letting negative
 * assertions ("canary absent") pass on an empty transcript.
 */
export function assertSessionRan(run: ClaudeRun): void {
  if (run.resultText.includes('Failed to authenticate')) {
    throw new Error(
      'BLOCKER: nested claude CLI could not authenticate (OAuth expired and headless refresh failed). ' +
        'Refresh credentials (run `claude` in a fresh terminal or `claude login`), then rerun npm run test:uat.\n' +
        `result: ${run.resultText}`,
    )
  }
  if (run.resultEvent === undefined) {
    throw new Error(
      `BLOCKER: claude produced no result event — session never ran.\nstderr:\n${run.rawStderr}\nstdout tail:\n${run.rawStdout.slice(-1000)}`,
    )
  }
}

/** Run `claude -p` in a sandbox project and parse its stream-json output. */
export function runClaude(prompt: string, settingsPath: string, options: RunClaudeOptions): ClaudeRun {
  const mcpArgs =
    options.mcpConfigPath !== undefined
      ? ['--mcp-config', options.mcpConfigPath, '--strict-mcp-config']
      : []

  const proc = spawnSync(
    'claude',
    [
      '-p',
      prompt,
      '--model',
      CLAUDE_MODEL,
      '--max-turns',
      String(options.maxTurns ?? MAX_TURNS),
      '--settings',
      settingsPath,
      ...mcpArgs,
      '--output-format',
      'stream-json',
      '--verbose',
      ...(options.extraArgs ?? []),
    ],
    {
      cwd: options.cwd,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? CLAUDE_TIMEOUT_MS,
      env: { ...process.env, ...options.env },
    },
  )

  const events: StreamEvent[] = []
  for (const line of (proc.stdout ?? '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      events.push(JSON.parse(trimmed) as StreamEvent)
    } catch {
      // Non-JSON noise on stdout is tolerated (never expected from stream-json).
    }
  }

  const init = events.find((e) => e.type === 'system' && e.subtype === 'init')
  const resultEvent = events.find((e) => e.type === 'result')
  return {
    status: proc.status,
    events,
    init,
    resultEvent,
    resultText: resultEvent?.result ?? '',
    rawStdout: proc.stdout ?? '',
    rawStderr: proc.stderr ?? '',
  }
}
