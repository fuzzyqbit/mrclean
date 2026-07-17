/**
 * PreToolUse hook handler — Phase 2 wired (Plan 02-05).
 *
 * RESEARCH §9.3: PreToolUse uses `hookSpecificOutput.permissionDecision` (correct for this event).
 *   - `permissionDecision: "allow"` with `updatedInput` for substitution.
 *   - `permissionDecision: "deny"` for budget-exhausted block.
 *   Note: `permissionDecision` is ONLY valid for PreToolUse — NOT for UserPromptSubmit.
 *
 * Behavior matrix:
 *   | Condition                 | Response                                                    |
 *   |---------------------------|-------------------------------------------------------------|
 *   | budget exhausted          | hookSpecificOutput.permissionDecision:deny + reason         |
 *   | dry_run=true              | hookSpecificOutput.permissionDecision:allow + dry-run msg   |
 *   | any detection in fields   | hookSpecificOutput.permissionDecision:allow + updatedInput  |
 *   | no detection              | hookSpecificOutput.permissionDecision:allow (pass-through)  |
 *
 * Deep substitution (T-02-05-03):
 *   Only string-typed leaf fields are rewritten. Non-string fields (numbers, booleans,
 *   objects) pass through untouched. Recursion depth is capped at MAX_DEPTH (32).
 *
 * RESEARCH Pitfall #4: `updatedInput` must be the COMPLETE tool_input object
 * (all fields preserved, only string leaves with detections substituted).
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
import type { PreToolUseInput, PreToolUseOutput, MrcleanConfig } from '../../shared/types.js'
import type { SessionState } from '../../detect/session-state.js'
import type { DetectionContext, ResolvedFinding } from '../../detect/index.js'

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

/** Maximum recursion depth for deep-substitute to prevent infinite loops (T-02-05-09). */
const MAX_DEPTH = 32

/**
 * Matches mrclean's OWN MCP tools regardless of install method.
 *
 * Claude Code namespaces MCP tools by how the server was installed:
 *   - Plugin install (the live deployment): server namespace = `plugin_mrclean_mrclean`
 *     → tool names are `mcp__plugin_mrclean_mrclean__mrclean_check` / `_redact` / `_status`
 *   - CLI install (`mrclean install`):       server namespace = `mrclean`
 *     → tool names are `mcp__mrclean__mrclean_check` / `_redact` / `_status`
 *
 * SELF-EXEMPTION (root-cause fix for the "empty findings" defect):
 *   The PreToolUse hook matcher is "*" — it fires for EVERY tool, including mrclean's own
 *   MCP tools. Without this guard, substituteToolInputDeep would rewrite the `text` argument
 *   of a mrclean_redact / mrclean_check call into placeholders BEFORE the tool runs. The tool
 *   would then scan placeholder-only text, find nothing, and return findings:[]. mrclean's own
 *   redaction tools MUST receive real secrets to do their job — so we pass their input through
 *   untouched.
 *
 * The pattern is anchored and enumerates exactly the three tool names, so a similarly-named
 * FOREIGN server (e.g. `mcp__notmrclean__mrclean_check` or `mcp__other__something`) is NOT
 * exempted and still receives full detection.
 */
const MRCLEAN_TOOL_RE = /^mcp__(plugin_mrclean_mrclean|mrclean)__mrclean_(check|redact|status)$/

/**
 * Recursively walk a tool_input object, running detection on each string-typed leaf.
 *
 * Returns a new object (immutable) with substitutions applied to string fields that
 * had findings. Non-string fields are preserved exactly.
 *
 * Cycle detection: we use a visited Set (JSON.stringify-based would fail on non-JSON;
 * instead cap recursion depth at MAX_DEPTH which is sufficient for tool_input shapes).
 */
async function substituteToolInputDeep(
  obj: unknown,
  config: MrcleanConfig,
  state: SessionState,
  ctx: DetectionContext,
  depth: number,
  allFindings: ResolvedFinding[],
  budgetSignal: { exhausted: boolean },
): Promise<unknown> {
  // Depth guard (T-02-05-09 — prevents infinite recursion on deeply nested inputs)
  if (depth > MAX_DEPTH) return obj

  if (typeof obj === 'string') {
    if (budgetSignal.exhausted) return obj

    const result = await runDetection(obj, config, state, ctx)
    if (result.budgetExhausted) {
      budgetSignal.exhausted = true
      return obj
    }
    if (result.findings.length > 0) {
      allFindings.push(...result.findings)
      return result.substitutedText
    }
    return obj
  }

  if (Array.isArray(obj)) {
    const newArr: unknown[] = []
    for (const item of obj) {
      newArr.push(
        await substituteToolInputDeep(item, config, state, ctx, depth + 1, allFindings, budgetSignal),
      )
    }
    return newArr
  }

  if (typeof obj === 'object' && obj !== null) {
    const newObj: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      newObj[key] = await substituteToolInputDeep(
        value,
        config,
        state,
        ctx,
        depth + 1,
        allFindings,
        budgetSignal,
      )
    }
    return newObj
  }

  // Primitives (number, boolean, null, undefined) — pass through untouched (T-02-05-03)
  return obj
}

export async function handlePreToolUse(input: PreToolUseInput): Promise<PreToolUseOutput> {
  // Step 0: Self-exemption — never redact the arguments of mrclean's own MCP tools.
  // (Doing so would blind mrclean_redact / mrclean_check, which must see real secrets.)
  if (MRCLEAN_TOOL_RE.test(input.tool_name)) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    }
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
  // fallback — no new throw may reach installCrashGuards' exit-2 (Pitfall 6).
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

  const ctx: DetectionContext = {
    sessionId: input.session_id,
    hookEvent: 'PreToolUse',
    cwd: input.cwd,
  }

  // Step 3: Deep-substitute all string leaves in tool_input
  const allFindings: ResolvedFinding[] = []
  const budgetSignal = { exhausted: false }

  const updatedToolInput = await substituteToolInputDeep(
    input.tool_input,
    config,
    state,
    ctx,
    0,
    allFindings,
    budgetSignal,
  )

  // Step 4: Budget exhausted → deny (PreToolUse uses permissionDecision here — correct)
  if (budgetSignal.exhausted) {
    // Reversible drain-DISCARD (T-09-07-04): the deny path emits nothing, so
    // persisting would orphan store entries for values that never shipped.
    if (reversible) {
      try {
        drainSessionAllocations(input.session_id)
      } catch {
        // One-way fallback (Pitfall 6) — the deny response below is unchanged.
      }
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          '[mrclean] detection budget exhausted — tool call blocked for safety',
      },
    }
  }

  // Step 5: dry_run=true → allow but log only (no substitution sent)
  if (config.dry_run) {
    // Reversible drain-DISCARD (T-09-07-04): dry_run substitutes nothing, so
    // a persisted entry would be an orphan the operator could never restore to.
    if (reversible) {
      try {
        drainSessionAllocations(input.session_id)
      } catch {
        // One-way fallback (Pitfall 6) — the dry-run response below is unchanged.
      }
    }
    const dryRunMsg =
      allFindings.length > 0
        ? `[mrclean] dry_run: ${allFindings.length} detection(s) logged, no substitution`
        : '[mrclean] dry_run: no detections'
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: dryRunMsg,
      },
    }
  }

  // Step 6: Any findings → return updatedInput with substitutions
  if (allFindings.length > 0) {
    let emittedInput = updatedToolInput

    // Step 6b: Reversible drain → SINGLE locked persist → reconcile renames
    // (Plan 09-07). The drain batches allocations across ALL string leaves of
    // this event (RESEARCH Pattern 2) — exactly one transaction per event.
    // Renames swap provisional tokens that lost the store race for the
    // authoritative ones BEFORE emission (both placeholder-shaped — the wire
    // only ever carries placeholders, T-09-07-01). 'degraded'/'noop' emit
    // as-is: provisional tokens stand, the facade already warned once.
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
            emittedInput = reversible.facade.applyRenamesDeep(emittedInput, persisted.renames)
          }
        }
      } catch {
        // One-way emission — provisional tokens stand; never throw (Pitfall 6).
      }
    }

    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: `[mrclean] substituted ${allFindings.length} secret(s)`,
        updatedInput: emittedInput as Record<string, unknown>,
      },
    }
  }

  // Step 7: No findings → pass through
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  }
}
