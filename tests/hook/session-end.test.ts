/**
 * SessionEnd handler contract (09-06): the Phase 8 no-op is replaced by a
 * lazy-imported, swallow-and-audit janitor call (D-08).
 *
 * Seam: vi.mock of src/state/janitor.js (the handlers.test.ts mock idiom) —
 * the handler reaches the janitor ONLY via dynamic `await import()`, which
 * vitest intercepts the same way as a static import.
 *
 * Pins:
 *   - the handler forwards (session_id, reason) verbatim — reason policy
 *     (the D-06 allowlist) lives in the JANITOR, not here;
 *   - a rejecting janitor still resolves to null (never throws — a throw
 *     would become exit-2 noise at every session end via the fail-closed
 *     wrapper);
 *   - the output contract is unchanged: null for EVERY reason (dispatcher
 *     routing at dispatcher.ts:37-38 needs no edit).
 *
 * Fixture discipline: a real UUID-shaped session_id — 'test-session' fails
 * the sid allowlist by design and would mask the forwarding assertion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/state/janitor.js', () => ({
  runSessionEndJanitor: vi.fn().mockResolvedValue(undefined),
}))

import { handleSessionEnd } from '../../src/hook/handlers/session-end.js'
import { runSessionEndJanitor } from '../../src/state/janitor.js'
import type { SessionEndInput } from '../../src/shared/types.js'

/** UUID-shaped sid — passes the state-layer allowlist (Pitfall 5). */
const UUID_SID = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff'

/** Every documented reason plus a fabricated future one (open string). */
const ALL_REASONS = [
  'resume',
  'clear',
  'logout',
  'prompt_input_exit',
  'other',
  'bypass_permissions_disabled',
  'some_future_reason_v9',
] as const

const makeInput = (reason: string): SessionEndInput => ({
  hook_event_name: 'SessionEnd',
  session_id: UUID_SID,
  transcript_path: '/tmp/transcript',
  cwd: '/tmp',
  reason,
})

beforeEach(() => {
  vi.mocked(runSessionEndJanitor).mockReset()
  vi.mocked(runSessionEndJanitor).mockResolvedValue(undefined)
})

describe('handleSessionEnd — janitor forwarding (REVMODE-07)', () => {
  it('forwards (session_id, reason) to runSessionEndJanitor for a UUID-shaped sid', async () => {
    // Act
    const output = await handleSessionEnd(makeInput('clear'))

    // Assert — verbatim forwarding; policy lives in the janitor
    expect(output).toBeNull()
    expect(runSessionEndJanitor).toHaveBeenCalledTimes(1)
    expect(runSessionEndJanitor).toHaveBeenCalledWith(UUID_SID, 'clear')
  })

  it('still resolves null when the janitor REJECTS (swallow-and-audit, D-08)', async () => {
    // Arrange — a janitor blow-up must never become exit-2 noise
    vi.mocked(runSessionEndJanitor).mockRejectedValueOnce(new Error('janitor exploded'))

    // Act + Assert — resolves (never throws), output contract intact
    await expect(handleSessionEnd(makeInput('logout'))).resolves.toBeNull()
  })

  it.each(ALL_REASONS)(
    "returns null for reason '%s' (output contract unchanged for the dispatcher)",
    async (reason) => {
      await expect(handleSessionEnd(makeInput(reason))).resolves.toBeNull()
    },
  )
})
