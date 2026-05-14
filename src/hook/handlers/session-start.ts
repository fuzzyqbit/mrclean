/**
 * SessionStart hook handler — Phase 2 wired (Plan 02-05).
 *
 * Replaces Phase 1's static short-form banner with the full HOOK-07 long-form:
 *   `mrclean active vN.N.N (rules: NNN, allowlist: NN, mode: active|dry-run)`
 *
 * Execution steps:
 *   1. Load effective config (all 3 layers: defaults < user < project).
 *   2. Initialize SessionState: loads Layer 3 env blocklist + Layer 4 words.txt.
 *   3. Cache the SessionState for subsequent hook events (UserPromptSubmit etc.)
 *   4. Build long-form banner from live rule count + allowlist count + mode.
 *   5. Return banner via additionalContext.
 *
 * On ConfigReadError: re-throw — installCrashGuards catches this and exits 2 (fail-closed).
 *
 * HOOK-07 deliverable: This is the plan that upgrades the Phase 1 short banner to the
 * full live-rule-count form. Phase 1's "no-op mode" string is removed.
 */

import { homedir } from 'node:os'
import { loadEffectiveConfig } from '../../config/index.js'
import { initSessionState, setCachedSessionState } from '../../detect/session-state.js'
import { getRuleCount } from '../../detect/layer1-regex/index.js'
import { buildBanner, computeAllowlistCount } from '../banner.js'
import type { SessionStartInput, SessionStartOutput } from '../../shared/types.js'

export async function handleSessionStart(input: SessionStartInput): Promise<SessionStartOutput> {
  // Step 1: Load effective config (3 layers merged)
  // ConfigReadError propagates — fail-closed via installCrashGuards → exit 2
  const config = await loadEffectiveConfig({ homeDir: homedir(), cwd: input.cwd })

  // Step 2: Initialize session state (Layer 3 env blocklist + Layer 4 words.txt)
  const state = await initSessionState({
    sessionId: input.session_id,
    homeDir: homedir(),
    cwd: input.cwd,
    config,
  })

  // Step 3: Cache for subsequent hook events in the same process
  setCachedSessionState(state)

  // Step 4: Build long-form banner (HOOK-07)
  const ruleCount = getRuleCount().total
  const allowlistCount = computeAllowlistCount(config)
  const banner = buildBanner(config, ruleCount, allowlistCount)

  // Step 5: Return banner via additionalContext
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: banner,
    },
  }
}
