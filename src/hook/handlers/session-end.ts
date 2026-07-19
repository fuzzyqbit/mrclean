/**
 * SessionEnd hook handler — reason-aware janitor (Plan 09-06, REVMODE-07;
 * replaces the Phase 8 no-op).
 *
 * Claude Code ignores SessionEnd output and exit codes
 * [CITED: code.claude.com/docs/en/hooks], but the fail-closed wrapper still
 * turns an uncaught throw into exit-2 noise at every session end — so the
 * janitor is reached ONLY via lazy `await import()` inside a total
 * try/catch (swallow-and-audit, D-08). The janitor itself never throws;
 * this catch is belt-and-braces.
 *
 * Retention is the D-06 ALLOWLIST: `reason === 'resume'` retains the
 * session's map + key; EVERY other reason deletes them, key first then map
 * (D-05 — dead ciphertext needs no lock). That delete set includes the
 * documented reasons (clear / logout / prompt_input_exit / other), any
 * unknown future reason string (`reason` is an OPEN string), and —
 * resolving the Phase 8 "decide bypass_permissions_disabled there" note —
 * `bypass_permissions_disabled` (documented at src/shared/types.ts:76-78):
 * it is not 'resume', so the allowlist DELETES map + key
 * (fail-toward-privacy).
 *
 * Config-free by design: the allowlist is code, not config, and deleting
 * nonexistent files is a no-op — the janitor runs UNCONDITIONALLY. The
 * lazy import keeps src/state/ off the one-way cold path (Pitfall 7;
 * 09-07's import-graph test asserts no static import here).
 */

import type { SessionEndInput } from '../../shared/types.js'

export async function handleSessionEnd(input: SessionEndInput): Promise<null> {
  try {
    const { runSessionEndJanitor } = await import('../../state/janitor.js')
    await runSessionEndJanitor(input.session_id, input.reason)
  } catch {
    // swallow-and-audit (D-08): janitor errors must never produce exit-2 at session end
  }
  return null
}
