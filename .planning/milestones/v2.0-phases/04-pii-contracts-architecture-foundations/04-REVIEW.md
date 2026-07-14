---
phase: 04-pii-contracts-architecture-foundations
reviewed: 2026-06-02T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/detect/findings.ts
  - src/detect/type-map.ts
  - src/audit/log.ts
  - src/config/defaults.ts
  - src/config/index.ts
  - src/shared/types.ts
  - docs/SCOPE-FENCE.md
  - THREAT_MODEL.md
  - package.json
findings:
  critical: 1
  warning: 1
  info: 1
  total: 3
status: resolved
---

# Phase 04: Code Review Report

**Reviewed:** 2026-06-02T00:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 4 adds PII source tags to `Finding`, 8 PII TYPE vocabulary entries, PII provenance
fields to `AuditRecord`, the `[pii]` config sub-table (with full validator + merge
semantics), `optionalDependencies` for the two ML packages, `docs/SCOPE-FENCE.md`, and the
THREAT_MODEL.md non-defense entry. The implementation is largely correct and the
architecture decisions are sound — the locked precedence chain, frozen defaults,
fail-closed validator pattern, and scope fence are all implemented properly.

One security-class finding requires a fix before Phase 5 builds against this layer: the
`provenance` spread in `findingToAuditRecord` is not guarded at runtime. TypeScript's
structural typing means a caller who accidentally or deliberately includes extra fields
(including `value`) in the provenance argument will silently serialize those fields into
the audit record, bypassing the no-raw-PII rule that is the primary security contract of
this codebase.

---

## Critical Issues

### CR-01: Provenance spread in `findingToAuditRecord` is unguarded at runtime — no-raw-PII rule can be bypassed

**File:** `src/audit/log.ts:184`

**Issue:** The spread `...(provenance !== undefined ? provenance : {})` passes **all
enumerable properties** of the `provenance` argument into the returned `AuditRecord`, not
just the four declared fields (`engine`, `model_rev`, `quant`, `backend`). TypeScript's
structural typing does _not_ strip extra properties at runtime: a variable of type
`{ engine: string; value: string }` is assignable to `FindingProvenance` without a
TypeScript error (excess-property checking only applies to object literals at the call
site, not to pre-assigned variables). If a future caller constructs `provenance` by
spreading a `Finding` or any object that carries sensitive text, that text will be
serialized into `audit.jsonl` with no runtime guard. This directly violates the LOCKED
comment on line 168 (`NEVER add raw value … or raw PII here`) and the project-level
security constraint in CLAUDE.md ("Audit log must never contain raw secret values").

The existing tests in `log.test.ts` (lines 170–212) verify that specific correct callers
do not leak — but they do not prevent a future incorrect caller from leaking via this path.
The `canary-leak.test.ts` file was not updated to cover the provenance spread path at all.

**Fix:** Destructure only the four allowed keys explicitly instead of spreading the whole
object:

```typescript
// src/audit/log.ts — findingToAuditRecord return statement
return {
  ts: new Date().toISOString(),
  sessionId,
  hookEvent: hookEvent as AuditRecord['hookEvent'],
  ruleId: finding.ruleId,
  severity: finding.severity,
  action,
  redactedHash: finding.redactedHash,
  fingerprint: finding.fingerprint,
  location: {
    hookEvent,
    offset: finding.span.start,
    length: finding.span.end - finding.span.start,
  },
  // Pick only the 4 allowed provenance keys — never spread the whole object.
  // This enforces the no-raw rule even if the caller passes a provenance object
  // that was accidentally constructed with extra properties (structural typing pitfall).
  ...(provenance !== undefined
    ? {
        ...(provenance.engine !== undefined && { engine: provenance.engine }),
        ...(provenance.model_rev !== undefined && { model_rev: provenance.model_rev }),
        ...(provenance.quant !== undefined && { quant: provenance.quant }),
        ...(provenance.backend !== undefined && { backend: provenance.backend }),
      }
    : {}),
}
```

Add a test to `tests/audit/canary-leak.test.ts` that calls `findingToAuditRecord` with a
provenance-like object containing an extra `value` field and asserts the result does not
serialize that value.

---

## Warnings

### WR-01: `validatePiiActionsMap` error message echoes the raw config value — inconsistent with all other validators

**File:** `src/config/index.ts:183-186`

**Issue:** The error thrown when a PII action value is invalid includes
`got ${JSON.stringify(value)}` (line 185), which echoes the raw string from the operator's
`config.toml` into the error message. Every other validator in this file describes the
expected type without echoing the received value (`[entropy].threshold must be a number`,
`[[rules]][0].action must be one of: block, substitute, audit, off`, etc.). While a config
action value is unlikely to be a secret, embedding untrusted file content in error messages
is inconsistent with the project's security-first conventions and sets a precedent that is
unsafe to follow in later validators (e.g., `model` field, entity names). Error messages
that include `ConfigReadError.reason` may be forwarded to logs or the CLI's stderr where
they persist.

**Fix:** Remove the `got …` clause from the error message, matching the style of all other
validators:

```typescript
// src/config/index.ts — validatePiiActionsMap
throw new ConfigReadError(
  filePath,
  `${context}.${key} must be one of: block, warn, audit`,
)
```

---

## Info

### IN-01: AuditRecord has an orphaned block-comment that will not appear as TSDoc for any field

**File:** `src/audit/log.ts:58-68`

**Issue:** The `/** Optional PII-NER provenance fields … NEVER use these fields to carry
matched text … */` block at lines 58–67 is followed by a blank line (line 68) before the
`engine?` field at line 70. A TSDoc comment must be immediately adjacent to the member it
documents; the blank line breaks the association. The NEVER-use warning will not appear in
IDE hover/IntelliSense for any of the four fields. This is not a runtime bug — each field
already has its own inline `/** … */` — but the security warning about "NEVER use these
fields to carry matched text" is effectively invisible to IDE users and future maintainers.

**Fix:** Remove the blank line so the block attaches to `engine?`, or (since each field
already has per-field JSDoc) delete the orphaned block entirely — the per-field docs are
sufficient.

---

## Findings Not Raised (reasoning)

- **`dedupBySpan` multi-overlap handling**: the early `break` on first overlap means a
  candidate that overlaps two survivors only evicts/defers against the _first_ one found.
  This logic is **pre-existing** (present at `ee3c675`) and unchanged in Phase 4 — out of
  scope for this review.

- **`pii.ner.model` accepts any string (no allowlist)**: Phase 4 is config-contract only;
  no detector loads the model yet. This becomes a Phase 6 concern (MODEL-03 integrity
  check), not a Phase 4 defect.

- **`mergeConfigs` dead-code branches** (`layerPii.regex !== undefined`): since
  `validatePiiConfig` always fills in `regex` and `ner`, these `undefined` checks can
  never be false when input comes from the parser. This is harmless dead code, not a bug.

- **`dotenv@^17.4.2` vs recommended `^16.x`**: pre-existing, not introduced in Phase 4.

---

_Reviewed: 2026-06-02T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
