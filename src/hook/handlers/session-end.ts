/**
 * SessionEnd hook handler — Phase 8 plumbing (Plan 08-02).
 *
 * Pure no-op: Claude Code ignores SessionEnd output and exit codes
 * [CITED: code.claude.com/docs/en/hooks]. Phase 9 replaces this body with
 * the reason-aware janitor (delete on clear/logout/prompt_input_exit/other,
 * retain on resume; decide bypass_permissions_disabled there).
 *
 * MUST stay free of config loads / I/O: any throw here becomes exit-2 noise
 * at every session end via the fail-closed wrapper (SC3). The `reason` field
 * is an OPEN string — no upstream reason addition can ever make this throw.
 */

import type { SessionEndInput } from '../../shared/types.js'

export async function handleSessionEnd(_input: SessionEndInput): Promise<null> {
  return null
}
