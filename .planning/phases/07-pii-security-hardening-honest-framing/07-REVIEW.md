---
phase: 07-pii-security-hardening-honest-framing
reviewed: 2026-06-03T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - src/shared/sanitize-output.ts
  - src/shared/strings.ts
  - src/hook/failclosed.ts
  - src/hook/handlers/session-start.ts
  - src/mcp/supervisor.ts
  - src/mcp/tools/check.ts
  - src/mcp/tools/redact.ts
  - src/doctor/report.ts
  - .github/workflows/canary-leak.yml
  - vitest.config.ts
  - tests/audit/pii-canary-leak.test.ts
  - tests/audit/pii-stderr-leak.test.ts
  - tests/copy-drift.test.ts
findings:
  critical: 0
  warning: 2
  warning_resolved: 2
  info: 3
  note: 2
  total: 7
status: warnings_resolved
resolved:
  - WR-01
  - WR-02
---

# Phase 7: Code Review Report

**Reviewed:** 2026-06-03
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found (no BLOCKERs)

## Summary

Reviewed the PII security-hardening and honest-framing surface for Phase 7 with a
focus on the central trust risk: a security tool leaking the very PII/secrets it
scrubs through error, diagnostic, or exception output.

**The core security objective holds.** The `sanitizeForOutput()` chokepoint is
correctly designed and correctly wired:

- The context-free path (D-04) returns a static, payload-independent message and
  **never echoes raw input** — verified across `failclosed.ts`, `supervisor.ts`,
  and the `check.ts`/`redact.ts` `isError` branches.
- `failclosed.ts` strips the raw `reason` (the stringified throw), drops `err.stack`
  entirely, and routes `err.message` through the context-free chokepoint. No raw
  PII/secret leak path to stderr was found.
- The substitution path uses literal `split(value).join(hash)` — **no RegExp built
  from untrusted input**, so it is ReDoS-free as claimed.
- The `bestEffort` flag is a typed boolean derived from `source === 'pii-ner'` at
  map time; `source`/`value`/`span` are never serialized into the MCP DTOs (D-06).
- The chokepoint is imported ONLY in error sinks — **never on the <100ms hook hot
  path or the detection happy path** (verified via import grep). Hot-path fence holds.
- The banned-phrase regexes match claim *shapes* and do not self-trip on the honest
  disclaimer's "not a guarantee" wording; the copy-drift test includes a positive
  control and a Pitfall-5 self-check.
- The doctor canary uses `startsWith('mrclean active v')`, so the SessionStart
  disclaimer line appended after the banner does not break wiring detection.

No CRITICAL findings. Two WARNINGs concern the with-context scrub mode's partial-value
gap and a context-discard quality bug in the MCP error branches. Remaining items are
maintainability/coverage notes.

## Warnings

### WR-01: With-context scrub only removes *whole-value* occurrences — partial secret substrings pass through

**Status:** RESOLVED (commit a617d03) — added a post-scrub defense-in-depth pass in
`sanitizeForOutput`: if any contiguous fragment (length ≥ 8) of a span value still
appears after whole-value scrubbing, it falls back to the static context-free message
instead of emitting a partially-scrubbed payload. Boundary unit test added.

**File:** `src/shared/sanitize-output.ts:50-53`
**Issue:** `scrubSpan` replaces only exact literal occurrences of `span.value`
(`message.split(span.value).join(span.redactedHash)`). If an error/diagnostic string
contains a *partial* span value (e.g. a tokenizer or parser that prints
`"...near token '457-55' "`, a truncated stack frame, or a value split across a line
wrap), the partial substring of a real secret/PII survives the scrub. The unit tests
(`tests/shared/sanitize-output.test.ts`) only exercise whole-value occurrences, so this
gap is unproven. With-context mode is documented as a first-class mode and is the only
mode that ever emits attacker/payload-influenced text, so this is the higher-risk path
even though no production caller passes real spans yet (see IN-01).
**Fix:** Either (a) document explicitly that with-context mode assumes whole-value
occurrences and require callers to never emit substrings of detected values, or
(b) harden by also redacting any high-entropy/value-derived fragments. Minimal safe
hardening — when in with-context mode, if any span `value` length ≥ N still appears in
part, fall back to the static message rather than emitting a partially-scrubbed string:
```ts
// After scrubbing, defense-in-depth: if any raw value still partially present, refuse.
for (const span of spans) {
  if (span.value.length >= 8 && scrubbed.includes(span.value)) {
    return STATIC_CONTEXT_FREE_MESSAGE // never emit a partially-scrubbed payload
  }
}
return scrubbed
```
At minimum, add a unit test asserting a partial-substring case to document the boundary.

### WR-02: MCP error branch interpolates `outcome.error` then discards it — dead interpolation, lost context

**Status:** RESOLVED (commit 3852eba) — removed the dead `sanitizeForOutput(..., [])`
pass; the error branches now prepend a static tool marker (`mrclean_check:` /
`mrclean_redact:`) to the supervisor's already-sanitized `outcome.error`. No raw input
is echoed (supervisedToolCall already routes the throw through the context-free
chokepoint). The two tools remain exact mirrors; dist rebuilt.

**File:** `src/mcp/tools/check.ts:142`, `src/mcp/tools/redact.ts:136`
**Issue:** `sanitizeForOutput(`mrclean_check error: ${outcome.error}`, [])` passes an
**empty span array**, which forces context-free mode and returns the constant
`STATIC_CONTEXT_FREE_MESSAGE`. The interpolated string — including the
`mrclean_check error:` prefix and the *already-sanitized* `outcome.error` from the
supervisor — is computed and then thrown away. This is safe (no leak) but: (1) the
tool-identifying prefix the comment intends to surface is lost, so both tools emit the
identical generic message and the MCP caller cannot tell which tool failed; (2) the
string concatenation is dead work; (3) the comment claims "belt-and-suspenders over
07-01's supervisor-level scrubbing" but passing `[]` actually *discards* the
supervisor's already-safe message rather than re-scrubbing it.
**Fix:** Since `outcome.error` is already context-free-safe (the supervisor scrubbed it),
emit it directly without a second pointless chokepoint pass, or prepend a static tool
marker that survives:
```ts
// outcome.error is already sanitized by supervisedToolCall (context-free static msg).
const safe = `mrclean_check: ${outcome.error}`
return { content: [{ type: 'text' as const, text: safe }], isError: true }
```
If a second pass is genuinely wanted for defense-in-depth, do not pass `[]` — that
guarantees the static message and erases the prefix. Keep the prefix as a static literal
outside the scrub call.

## Info

### IN-01: With-context scrub mode has no production caller — currently exercised only by unit tests

**File:** `src/shared/sanitize-output.ts:75-80`
**Issue:** Every production call site passes either no spans (`failclosed.ts:37`,
`supervisor.ts:62`) or an explicit empty array (`check.ts:142`, `redact.ts:136`), all of
which take the context-free branch. The with-context substitution branch is reachable
only from `tests/shared/sanitize-output.test.ts`. The two-mode API is defensible as a
documented forward-looking surface, but a reader may assume detected spans are threaded
through somewhere in this phase — they are not.
**Fix:** Either thread real spans from a detection-context error site (the original D-03
intent — "scrubbing anything matching detected spans") so the mode earns its keep, or add
a one-line note at the call sites/module header that no in-phase caller uses with-context
mode and it exists for future detection-context error paths.

### IN-02: `writeFailClosedError` payload spread lets a `context` key silently override sanitized fields

**File:** `src/hook/failclosed.ts:44-51`
**Issue:** `error` and `message` are set before `...safeContext` is spread. If a future
caller passes a `context` containing `message`, `error`, or `version` keys (the type is
`Record<string, unknown> & { version?: string }`, so arbitrary keys are allowed), the
spread would override the sanitized `message`/`error` with unsanitized context data.
Today only `{ version, phase }` / `{ version, phase, reason }` are passed, so there is no
live leak — but the ordering is a latent footgun for a security-critical sink.
**Fix:** Spread `safeContext` first, then set the sanitized/static fields last so they
always win:
```ts
const payload: Record<string, unknown> = {
  ...safeContext,
  error: 'mrclean hook crashed',
  message,
  ...(_rawReason !== undefined ? { reason: 'redacted' } : {}),
  stack: 'redacted',
}
```

### IN-03: PII canary corpus duplicated across three locations — drift risk

**File:** `tests/audit/pii-canary-leak.test.ts:40-45`, `tests/audit/pii-stderr-leak.test.ts:43-48`, `.github/workflows/canary-leak.yml:79-84`
**Issue:** The four synthetic canary values are hand-copied into two test files and the CI
YAML's bash array. The integration/unit split deliberately avoids cross-project import,
and the CI grep is intentionally independent — both are reasonable. But three copies of
the same literal set will drift: if someone adds a fifth canary to the corpus, the
CI defense-in-depth grep silently stops covering it with no failure signal.
**Fix:** Acceptable trade-off as documented, but add a comment in each location pointing
to the others, or have the CI step read the canary list from a single committed fixture
file (e.g. `tests/fixtures/pii-canaries.txt`) that both the integration test and the YAML
consume, so the set has one source of truth.

## Notes

### NOTE-01: Banned-phrase regex `/\bguarantees? (that )?(all|every) /i` requires a trailing space — sentence-final overclaim escapes

**File:** `src/shared/strings.ts:50`
**Issue:** The trailing space in the pattern means "mrclean guarantees all." (period, no
following token) is NOT flagged, while "guarantees all PII" is. A copy author could write
"mrclean guarantees every secret." and pass the gate. Low risk (the most common overclaims
are caught), but the gate is narrower than it reads.
**Fix:** Replace the trailing literal space with a word boundary / lookahead:
`/\bguarantees? (that )?(all|every)\b/i`.

### NOTE-02: Banned-phrase coverage is keyed to the literal token "PII"

**File:** `src/shared/strings.ts:43`
**Issue:** `/redacts? all PII/i` only fires on the exact token "PII". Equivalent overclaims
like "redacts all personal data" or "removes every secret" are not covered. This matches
the locked D-08 list (a defined, intentionally narrow set), so it is a NOTE not a defect —
flagged so future copy-review knows the gate is allowlist-shaped, not semantic.
**Fix:** Optional — broaden to `/redacts? all (PII|personal data|secrets)/i` if the team
wants wider coverage; otherwise document the gate as a known-narrow tripwire.

---

_Reviewed: 2026-06-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
