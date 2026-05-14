/**
 * PostToolUse hook handler — Phase 1.
 *
 * Returns null to signal pass-through — the caller (runHook) must skip the
 * stdout write when null is returned. Claude Code proceeds normally.
 *
 * RESEARCH.md §1.3: PostToolUse is non-blocking even on exit 2 (it only shows
 * stderr). Phase 1 does nothing; Phase 2+ will use updatedToolOutput for
 * placeholder restoration in REVMODE.
 */

import type { PostToolUseInput } from '../../shared/types.js'

export function handlePostToolUse(_input: PostToolUseInput): null {
  // Phase 1 no-op: pass through all post-tool events
  return null
}
