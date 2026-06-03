/**
 * sanitizeForOutput() — the SINGLE no-raw error/diagnostic chokepoint (Plan 07-01, PIISEC-01).
 *
 * Every error or diagnostic string that crosses the trust boundary from detection
 * internals to stderr / the MCP tool transcript / the model context MUST pass
 * through this function first. It mirrors the single-locked-sink discipline of
 * `findingToAuditRecord` (src/audit/log.ts:144-195): one chokepoint, one greppable
 * invariant comment, enforced by the leak-grep regression tests (D-03/D-04).
 *
 * Two modes:
 *   - with-context: callers that hold detected spans (each carrying `value` +
 *     `redactedHash` from a Finding) pass them in; every literal occurrence of a
 *     raw `value` substring in the message is replaced by its `redactedHash`.
 *   - context-free: callers with no spans (empty array or undefined) — e.g. a
 *     model-load failure that fires BEFORE any text is parsed, so there are no
 *     spans to scrub against — get a STATIC structured message back. The original
 *     `err.message` / input text is NEVER echoed (D-04).
 *
 * Cold-path/hot-path fence (T-07-01-05): this module imports ONLY `redactedHash`
 * and types from `../detect/findings.js`. It pulls in NO detection engine and NO ML
 * runtime, and is NEVER called from the detection happy path or the <100ms hook
 * gate. The substitution reuses the finding's existing `redactedHash` — it never
 * re-hashes and never emits the raw value.
 *
 * ReDoS-free: substitution uses literal `split(value).join(hash)`, never a RegExp
 * built from untrusted input (inverts the `includes()` substring scan in
 * src/audit/canary-leak.ts:89-93).
 */

import type { Finding } from '../detect/findings.js'

/**
 * The minimal span shape the chokepoint needs: the raw matched `value` and its
 * audit-safe `redactedHash`. A full `Finding` satisfies this structurally.
 */
export type ScrubSpan = Pick<Finding, 'value' | 'redactedHash'>

/**
 * Static, payload-independent message emitted on the context-free path (D-04).
 * It carries NO raw input text — a model-load/pre-parse failure has no spans to
 * scrub against, so echoing the original message would risk leaking unparsed PII.
 */
const STATIC_CONTEXT_FREE_MESSAGE =
  'mrclean: an internal error occurred; details withheld to avoid leaking sensitive input'

/**
 * Minimum fragment length (in chars) of a raw `value` that, if it survives the
 * scrub as a contiguous substring of the output, triggers the partial-leak
 * fallback (WR-01). Below this length a fragment is too short/common to treat as
 * a meaningful secret leak (e.g. a 2–3 char run of digits from an SSN that
 * collides with ordinary text), and refusing on it would trade away all
 * diagnostic value for no real confidentiality gain. Only values of at least
 * this length are checked at all.
 */
const MIN_PARTIAL_LEAK_FRAGMENT_LENGTH = 8

/**
 * Defense-in-depth check (WR-01): does any contiguous fragment of `value` with
 * length >= MIN_PARTIAL_LEAK_FRAGMENT_LENGTH still appear in `scrubbed`?
 *
 * `scrubSpan` removes only WHOLE-value occurrences, so a truncated fragment (a
 * tokenizer printing `near token '457-55-54'`, or a value split across a line
 * wrap) can survive. If any such fragment remains we must refuse to emit the
 * partially-scrubbed payload. We slide a window of the threshold length across
 * the value — if the value is shorter than the threshold it is not checked.
 */
function hasResidualValueFragment(scrubbed: string, value: string): boolean {
  if (value.length < MIN_PARTIAL_LEAK_FRAGMENT_LENGTH) return false
  const lastStart = value.length - MIN_PARTIAL_LEAK_FRAGMENT_LENGTH
  for (let start = 0; start <= lastStart; start += 1) {
    const fragment = value.slice(start, start + MIN_PARTIAL_LEAK_FRAGMENT_LENGTH)
    if (scrubbed.includes(fragment)) return true
  }
  return false
}

/**
 * Scrub a single span's raw `value` out of `message`, replacing every literal
 * occurrence with its `redactedHash`. Literal split/join keeps it ReDoS-free.
 */
function scrubSpan(message: string, span: ScrubSpan): string {
  if (span.value.length === 0) return message
  return message.split(span.value).join(span.redactedHash)
}

/**
 * Sanitize an error/diagnostic string before it crosses to stderr or MCP text.
 *
 * LOCKED: every error/diagnostic string written to stderr or MCP tool text MUST
 * pass through here. Enforced by the leak-grep regression tests (tests/audit/
 * pii-canary-leak.test.ts + tests/audit/pii-stderr-leak.test.ts).
 *
 * @param message - The raw error/diagnostic string.
 * @param spans   - Detected spans to scrub against. When absent/empty, the
 *                  context-free static message is returned and `message` is NOT echoed.
 * @returns         A safe string carrying no raw PII value.
 */
export function sanitizeForOutput(message: string, spans?: readonly ScrubSpan[]): string {
  // LOCKED: every error/diagnostic string written to stderr or MCP tool text MUST
  // pass through this chokepoint. CI leak-grep tests enforce this at runtime.
  // Context-free mode (D-04): no spans to scrub against → never echo the input.
  if (spans === undefined || spans.length === 0) {
    return STATIC_CONTEXT_FREE_MESSAGE
  }

  // With-context mode: literal-replace each raw value with its redactedHash.
  let scrubbed = message
  for (const span of spans) {
    scrubbed = scrubSpan(scrubbed, span)
  }

  // Defense-in-depth (WR-01): scrubSpan only removes WHOLE-value occurrences. If a
  // raw value of meaningful length still appears as a PARTIAL substring after
  // scrubbing (a tokenizer printing a truncated fragment, or a value split across a
  // line wrap), refuse to emit the partially-scrubbed payload and fall back to the
  // static context-free message. We NEVER emit a partially-scrubbed string — for a
  // security tool, a lost diagnostic is strictly preferable to a residual-secret leak.
  for (const span of spans) {
    if (hasResidualValueFragment(scrubbed, span.value)) {
      return STATIC_CONTEXT_FREE_MESSAGE
    }
  }

  return scrubbed
}
