/**
 * PostToolUse hook handler — Phase 2 wired (Plan 02-05).
 *
 * RESEARCH §9.4: PostToolUse uses `hookSpecificOutput.updatedToolOutput` (CC >= v2.1.121).
 * PostToolUse is NON-BLOCKING — even exit 2 only shows stderr and cannot stop execution.
 *
 * RESEARCH Pitfall #7: `tool_response` may be a non-string object.
 * Coerce to string: `typeof r === 'string' ? r : JSON.stringify(r)`.
 * The substituted output is always emitted as a STRING in `updatedToolOutput`.
 *
 * Behavior matrix:
 *   | Condition             | Response                                       |
 *   |-----------------------|------------------------------------------------|
 *   | budget exhausted      | null (pass-through); stderr warning logged     |
 *   | dry_run=true          | null (no substitution; detections logged only) |
 *   | any detection         | hookSpecificOutput.updatedToolOutput           |
 *   | no detection          | null (pass-through)                            |
 */

import { homedir } from 'node:os'
import { loadEffectiveConfig } from '../../config/index.js'
import {
  getCachedSessionState,
  initSessionState,
  setCachedSessionState,
} from '../../detect/session-state.js'
import {
  runDetection,
  hydrateSessionManager,
  drainSessionAllocations,
} from '../../detect/index.js'
import type { PostToolUseInput, PostToolUseOutput } from '../../shared/types.js'

/**
 * Reversible-mode capability handle (Phase 9, Plan 09-07 — REVMODE-02).
 *
 * Non-null ONLY when [reversible] is enabled AND the sid passed the strict
 * UUID allowlist AND store hydration succeeded. Carries the lazily-imported
 * state facade namespace so the whole event uses EXACTLY ONE dynamic import
 * site — the cold-path import-graph fence (tests/state/cold-path.test.ts)
 * bans every static form of `src/state/` from this module (Pitfall 7).
 * `typeof import(...)` below is a TYPE position — erased at compile, loads
 * nothing.
 */
interface ReversibleHandle {
  facade: typeof import('../../state/index.js')
  deadlineMs: number
}

/**
 * Matches mrclean's OWN MCP tools regardless of install method.
 *
 * Claude Code namespaces MCP tools by install method:
 *   - Plugin install (live deployment): `mcp__plugin_mrclean_mrclean__mrclean_<tool>`
 *   - CLI install (`mrclean install`):   `mcp__mrclean__mrclean_<tool>`
 *
 * SELF-EXEMPTION: mrclean_redact / mrclean_check already return sanitized output
 * (placeholders, never raw secrets). Re-running detection on their output is wasteful
 * and would re-process the placeholder strings they intentionally emit. Pass through.
 *
 * Anchored + enumerated so a foreign server (e.g. `mcp__notmrclean__mrclean_check`) is
 * NOT exempted and still gets detection.
 */
const MRCLEAN_TOOL_RE = /^mcp__(plugin_mrclean_mrclean|mrclean)__mrclean_(check|redact|status)$/

export async function handlePostToolUse(
  input: PostToolUseInput,
): Promise<PostToolUseOutput | null> {
  // Step 0: Self-exemption — never re-process the output of mrclean's own MCP tools.
  if (MRCLEAN_TOOL_RE.test(input.tool_name)) {
    return null
  }

  // Step 1: Load config
  const config = await loadEffectiveConfig({ homeDir: homedir(), cwd: input.cwd })

  // Step 2: Ensure SessionState cached (defensive bootstrap)
  let state = getCachedSessionState(input.session_id)
  if (!state) {
    state = await initSessionState({
      sessionId: input.session_id,
      homeDir: homedir(),
      cwd: input.cwd,
      config,
    })
    setCachedSessionState(state)
  }

  // Step 2b: Reversible hydrate (Plan 09-07, REVMODE-02) — gate order matters:
  // the config master switch is OUTERMOST (a disabled session allocates zero
  // promises and never touches src/state/), then the strict UUID sid allowlist
  // (the facade re-checks internally — defense in depth). The state facade is
  // reachable ONLY via this one dynamic import (cold-path fence, Pitfall 7).
  // The WHOLE block is a try/catch wall: ANY facade error means one-way
  // fallback — no new throw may surface (Pitfall 6; PostToolUse is
  // non-blocking, but exit-2 stderr noise on every tool result is still a
  // failure mode).
  let reversible: ReversibleHandle | null = null
  if (config.reversible.enabled) {
    try {
      const facade = await import('../../state/index.js')
      if (facade.isValidSessionId(input.session_id)) {
        const hydration = await facade.readSessionMapForHydration({
          sessionId: input.session_id,
        })
        if (hydration) {
          hydrateSessionManager(input.session_id, hydration)
          const { POST_LOCK_DEADLINE_MS } = await import('../../state/lock.js')
          reversible = { facade, deadlineMs: POST_LOCK_DEADLINE_MS }
        }
      }
    } catch {
      // One-way fallback: reversible stays null; detection runs unchanged.
    }
  }

  // Step 3: Coerce tool_response to string (RESEARCH Pitfall #7)
  const text =
    typeof input.tool_response === 'string'
      ? input.tool_response
      : JSON.stringify(input.tool_response)

  // Step 4: Run detection
  const result = await runDetection(text, config, state, {
    sessionId: input.session_id,
    hookEvent: 'PostToolUse',
    cwd: input.cwd,
  })

  // Step 5: Budget exhausted → pass through (non-blocking); log structured stderr warning
  if (result.budgetExhausted) {
    // Reversible drain-DISCARD (T-09-07-04): nothing is emitted on this path,
    // so persisting would orphan store entries for values that never shipped.
    if (reversible) {
      try {
        drainSessionAllocations(input.session_id)
      } catch {
        // One-way fallback (Pitfall 6) — the pass-through below is unchanged.
      }
    }
    process.stderr.write(
      JSON.stringify({
        warn: 'mrclean detection budget exhausted on PostToolUse',
        sessionId: input.session_id,
      }) + '\n',
    )
    return null
  }

  // Step 6: dry_run=true → no substitution; detections already audit-logged by runDetection
  if (config.dry_run) {
    // Reversible drain-DISCARD (T-09-07-04): dry_run substitutes nothing, so
    // a persisted entry would be an orphan the operator could never restore to.
    if (reversible) {
      try {
        drainSessionAllocations(input.session_id)
      } catch {
        // One-way fallback (Pitfall 6) — the null pass-through is unchanged.
      }
    }
    return null
  }

  // Step 7: Any detection → return updatedToolOutput with substituted text
  if (result.findings.length > 0) {
    let emittedText = result.substitutedText

    // Step 7b: Reversible drain → SINGLE locked persist → reconcile renames
    // (Plan 09-07). Renames swap provisional tokens that lost the store race
    // for the authoritative ones BEFORE emission (both placeholder-shaped —
    // the wire only ever carries placeholders, T-09-07-01). 'degraded'/'noop'
    // emit as-is: provisional tokens stand, the facade already warned once.
    // The emitted shape is UNCHANGED: string-form updatedToolOutput (E1).
    if (reversible) {
      try {
        const pending = drainSessionAllocations(input.session_id)
        if (pending.length > 0) {
          const persisted = await reversible.facade.persistAllocations({
            sessionId: input.session_id,
            pending,
            deadlineMs: reversible.deadlineMs,
          })
          if (persisted.status === 'ok' && persisted.renames.length > 0) {
            emittedText = reversible.facade.applyRenamesToText(emittedText, persisted.renames)
          }
        }
      } catch {
        // One-way emission — provisional tokens stand; never throw (Pitfall 6).
      }
    }

    return {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        updatedToolOutput: emittedText,
        additionalContext: `[mrclean] substituted ${result.findings.length} secret(s) in tool output`,
      },
    }
  }

  // Step 8: No findings → pass through (null → no stdout bytes written)
  return null
}
