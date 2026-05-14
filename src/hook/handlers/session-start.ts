/**
 * SessionStart hook handler — Phase 1.
 *
 * Emits the "mrclean active" wiring banner via additionalContext (HOOK-07).
 *
 * RESEARCH.md §1.4 (Pitfall #2): The banner MUST go through additionalContext
 * in the JSON stdout (exit 0). Writing the banner to stderr on exit 0 sends it
 * only to the debug log and is invisible to the operator.
 */

import { VERSION } from '../../shared/version.js'
import type { SessionStartInput, SessionStartOutput } from '../../shared/types.js'

/**
 * Phase 1 short form per 01-03-PLAN HOOK-07 scope note.
 *
 * REQUIREMENTS.md HOOK-07 specifies the long-form banner:
 *   `mrclean active vN.N.N (rules: NNN, allowlist: NN)`
 * Phase 1 deliberately delivers the shorter form because rule/allowlist counts
 * cannot be computed until Phase 2 ships the detection engine (Layers 1–4) and
 * the config-driven allowlist (CFG-02). The wiring-signal intent of HOOK-07
 * (operator-visible banner so silent-misconfig is impossible) IS satisfied in
 * Phase 1 — only the format string is reduced. Phase 2 will swap in the
 * long-form banner once DET1-01..DET4-03 and CFG-02 land.
 */
const PHASE1_BANNER = `mrclean active v${VERSION} (no-op mode — detection not yet enabled)`

export function handleSessionStart(_input: SessionStartInput): SessionStartOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: PHASE1_BANNER,
    },
  }
}
