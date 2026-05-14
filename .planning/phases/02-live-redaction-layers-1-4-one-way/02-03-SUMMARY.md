---
phase: 02-live-redaction-layers-1-4-one-way
plan: "03"
subsystem: placeholder
tags: [placeholder, sha256, audit-log, jsonl, canary-leak, redaction-discipline]

requires:
  - phase: 02-live-redaction-layers-1-4-one-way
    plan: "00"
    provides: "sha256hex, redactedHash, fingerprint, Finding interface, getTypeForRuleId, TYPE_VOCABULARY"

provides:
  - "PlaceholderManager: SHA-256 keyed, global session counter (001..999), OVF path, in-memory only"
  - "substituteFindings: right-to-left span replacement for index-drift-free redaction"
  - "src/placeholder/type-map.ts: thin re-export of src/detect/type-map.ts (Plan 02-00 canonical)"
  - "writeAuditRecord: JSONL appender using fs.appendFile with flag:'a'; AuditWriteError on ENOENT"
  - "findingToAuditRecord: safe builder — no raw value, no env-var name, no external file paths"
  - "assertNoCanaryLeak: CI helper that proves no canary string appears in any audit record field"

affects:
  - 02-04-hook-orchestrator
  - 02-05-dry-run-mode
  - 02-06-integration-tests
  - phase-3-qa-03

tech-stack:
  added: []
  patterns:
    - "SHA-256 keyed Map for stable placeholder allocation (same value → same placeholder)"
    - "Global session counter (not per-TYPE) for collision-free cross-TYPE ordering"
    - "Right-to-left span substitution to eliminate index drift when replacing multiple findings"
    - "fs.appendFile with flag:'a' for O_APPEND JSONL atomicity"
    - "findingToAuditRecord builder explicitly excludes finding.value (LOCKED comment + canary test)"
    - "ENOENT-tolerant canary helper for CI use before any records have been written"

key-files:
  created:
    - src/placeholder/manager.ts
    - src/placeholder/substitute.ts
    - src/placeholder/type-map.ts
    - src/audit/log.ts
    - src/audit/canary-leak.ts
    - tests/placeholder/manager.test.ts
    - tests/placeholder/substitute.test.ts
    - tests/audit/log.test.ts
    - tests/audit/canary-leak.test.ts
  modified: []

key-decisions:
  - "Global counter per session (not per-TYPE): ensures PH-03 collision-free ordering trivially"
  - "OVF placeholder emits stderr JSON warning (not throw) on first overflow: non-fatal degradation"
  - "byPlaceholder Map uses last-writer-wins for OVF same-TYPE collisions: documented expected degradation"
  - "findingToAuditRecord LOCKED comment + grep gate: prevents future refactors from accidentally adding finding.value"
  - "assertNoCanaryLeak uses JSON.stringify(record) for substring search: normalises field order, catches partial leaks"
  - "ENOENT on writeAuditRecord throws AuditWriteError (not swallowed): install corruption surfaces immediately"

patterns-established:
  - "PlaceholderEntry shape: { type, index, firstSeenTs, placeholder, hash } — hash is full 64-char SHA-256"
  - "AuditRecord shape: ts/sessionId/hookEvent/ruleId/severity/action/redactedHash/fingerprint/location (LOCKED)"
  - "ResolvedFinding = Finding & { placeholder } — orchestrator sets placeholder after PlaceholderManager.allocate()"

requirements-completed: [PH-01, PH-02, PH-03, PH-04, AUDIT-01, AUDIT-02]

duration: 15min
completed: 2026-05-14
---

# Phase 2 Plan 03: Placeholder Manager + Audit Log Summary

**SHA-256 keyed PlaceholderManager with global session counter, right-to-left substituteFindings, JSONL audit log with raw-value exclusion enforced by a canary-leak CI helper**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-14T10:25:00Z
- **Completed:** 2026-05-14T10:29:00Z
- **Tasks:** 2 (both TDD)
- **Files created:** 9 (5 src + 4 tests)

## Accomplishments

- `PlaceholderManager` allocates `<MRCLEAN:TYPE:NNN>` placeholders using SHA-256 keyed Maps; same value always returns the same placeholder (PH-02 stability); global counter across TYPEs (PH-03 collision-free); overflow at >999 emits stderr JSON warning and falls back to `<MRCLEAN:TYPE:OVF>`
- `substituteFindings` processes findings right-to-left (descending span.start) so earlier indices are never disturbed; zero-length spans skipped defensively; angle brackets survive JSON string values (PH-04 proven)
- `src/placeholder/type-map.ts` is a thin re-export (3 lines) — `getTypeForRuleId` and `TYPE_VOCABULARY` live only in `src/detect/type-map.ts` (Plan 02-00 canonical); no duplication
- `writeAuditRecord` appends JSONL via `fs.appendFile(flag:'a')`; missing `.mrclean/` throws `AuditWriteError` (not silently swallowed); AUDIT-01 proven by round-trip test
- `findingToAuditRecord` is a pure builder that explicitly excludes `finding.value`, env-var names, and external file paths; LOCKED comment and grep gate enforced in acceptance criteria; AUDIT-02 proven by canary-leak test
- `assertNoCanaryLeak` reads the JSONL log, checks every canary string as a substring of `JSON.stringify(record)` (catches partial leaks), returns `{ok, leaked}` structured result; ENOENT returns `ok:true`; malformed JSON returns `ok:false` with `<malformed>` entry

## Task Commits

1. **Task 1: PlaceholderManager + substituteFindings + thin type-map re-export** - `302c77e` (feat)
2. **Task 2: Audit log JSONL appender + canary-leak helper** - `be75446` (feat)

## Files Created/Modified

- `src/placeholder/manager.ts` — PlaceholderManager class; imports sha256hex from src/detect/findings.ts
- `src/placeholder/substitute.ts` — substituteFindings; imports Finding type from src/detect/findings.ts
- `src/placeholder/type-map.ts` — thin re-export of getTypeForRuleId + TYPE_VOCABULARY from src/detect/type-map.ts
- `src/audit/log.ts` — AuditRecord interface, AuditWriteError class, writeAuditRecord, findingToAuditRecord
- `src/audit/canary-leak.ts` — assertNoCanaryLeak CI helper
- `tests/placeholder/manager.test.ts` — 8 tests (format, stability, global counter, overflow, round-trip)
- `tests/placeholder/substitute.test.ts` — 6 tests (single, multiple, start/end, JSON context, zero-length guard)
- `tests/audit/log.test.ts` — 6 tests (round-trip, sequential append, JSONL framing, AuditWriteError, raw-value exclusion, location)
- `tests/audit/canary-leak.test.ts` — 5 tests (ENOENT, no-canary, detected leak, malformed JSON, mixed canaries)

## Decisions Made

- **Global counter (not per-TYPE):** PH-03 demands collision-free ordering across TYPEs; a global counter achieves this trivially. If the counter were per-TYPE, `<MRCLEAN:AWS_KEY:001>` and `<MRCLEAN:JWT:001>` would both exist in the same session — confusing to operators who reason "the 3rd thing redacted this session".
- **OVF path is non-fatal (stderr warning, not throw):** The hook is in the hot path of Claude Code's prompt submission. Throwing on overflow would block the user entirely. Falling back to `<MRCLEAN:TYPE:OVF>` preserves redaction (value still not sent to Anthropic API) while alerting the operator to a pathological session.
- **byPlaceholder last-writer-wins for OVF same-TYPE:** After overflow, multiple distinct values map to the same `<MRCLEAN:TYPE:OVF>` placeholder. This is documented expected degradation — there is no way to distinguish OVF entries by placeholder alone (they all look the same). The `byHash` map still returns the correct entry for a given value, preserving stability (PH-02) even in the OVF regime.
- **assertNoCanaryLeak checks JSON.stringify(record) not the raw line:** This normalises field order and whitespace, ensuring the check works regardless of how the record was serialised. It also catches partial leaks where the value might appear inside a nested object.

## Canary-Leak Contract

The `assertNoCanaryLeak(logPath, canaries)` function is the canonical CI gate for AUDIT-02:

```typescript
const result = await assertNoCanaryLeak('/path/to/.mrclean/audit.jsonl', [
  'AKIAIOSFODNN7EXAMPLX',  // AWS key fixture
  'ghp_abc123...',          // GitHub token fixture
])
if (!result.ok) {
  throw new Error(`Audit log leaked secret: ${JSON.stringify(result.leaked)}`)
}
```

- **ENOENT** → `{ ok: true, leaked: [] }` (absent log = trivially clean)
- **Malformed JSON line** → `{ ok: false, leaked: [{ canary: '<malformed>', line, record }] }` (defence in depth)
- **Canary found** → `{ ok: false, leaked: [{ canary, line, record }] }` (canary is the raw fixture string)
- **Plan 02-06** uses this helper for end-to-end fixtures tests
- **Phase 3 QA-03** wires it as a build-time CI gate

## PlaceholderEntry Shape

```typescript
interface PlaceholderEntry {
  type: string       // e.g. 'AWS_KEY'
  index: number      // 1-based global session counter; >999 = OVF
  firstSeenTs: string // ISO8601
  placeholder: string // '<MRCLEAN:AWS_KEY:001>' or '<MRCLEAN:TYPE:OVF>'
  hash: string       // full 64-char SHA-256 of the original value
}
```

## AuditRecord Shape (Locked)

```typescript
interface AuditRecord {
  ts: string           // ISO8601 (local clock)
  sessionId: string    // UUID from PlaceholderManager constructor
  hookEvent: 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse'
  ruleId: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  action: 'block' | 'substitute' | 'audit'
  redactedHash: string  // first 16 hex chars of SHA-256(value) — safe for logs
  fingerprint: string   // `${ruleId}:${redactedHash}` — stable composite
  location: { hookEvent: string; offset: number; length: number }
}
// NEVER includes: raw value, env-var name, file paths outside project root
```

## substituteFindings Algorithm

Right-to-left processing prevents index drift:

```
sort findings by span.start DESCENDING
for each finding:
  if span.start === span.end: skip (zero-length guard)
  result = result.slice(0, span.start) + finding.placeholder + result.slice(span.end)
```

Context survival tested:
- **JSON:** `'{"command":"echo AKIAIOSFODNN7EXAMPLE"}'` → `JSON.parse()` still works with `<MRCLEAN:AWS_KEY:001>` inside the string value
- **Markdown:** angle brackets are legal in Markdown; code fences not disturbed
- **Unified diff:** only the span content is replaced; `+/-` prefix lines intact

## Wave 1 Contract Honoured

`src/detect/findings.ts` and `src/detect/type-map.ts` are Plan 02-00 owned and NOT touched here:
- `PlaceholderManager` imports `sha256hex` from `../detect/findings.js`
- `substituteFindings` imports `Finding` type from `../detect/findings.js`
- `src/placeholder/type-map.ts` re-exports `getTypeForRuleId` + `TYPE_VOCABULARY` from `../detect/type-map.js` — no vocabulary duplication

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

Plan 02-04 (hook orchestrator) has all contracts it needs:
- `PlaceholderManager.allocate(value, type)` → `PlaceholderEntry`
- `substituteFindings(text, resolvedFindings)` → redacted string
- `writeAuditRecord(cwd, record)` → JSONL append
- `findingToAuditRecord(finding, sessionId, hookEvent, action)` → `AuditRecord`
- `getTypeForRuleId(ruleId)` → TYPE string (via `src/placeholder/type-map.ts` re-export)

---
*Phase: 02-live-redaction-layers-1-4-one-way*
*Completed: 2026-05-14*

## Self-Check: PASSED

Files verified:
- src/placeholder/manager.ts — FOUND
- src/placeholder/substitute.ts — FOUND
- src/placeholder/type-map.ts — FOUND
- src/audit/log.ts — FOUND
- src/audit/canary-leak.ts — FOUND
- tests/placeholder/manager.test.ts — FOUND
- tests/placeholder/substitute.test.ts — FOUND
- tests/audit/log.test.ts — FOUND
- tests/audit/canary-leak.test.ts — FOUND

Commits verified:
- 302c77e (Task 1: placeholder manager + substitute helper) — FOUND
- be75446 (Task 2: audit log appender + canary-leak helper) — FOUND

Tests: 296 passed (25 new in this plan), 0 failed
Build: SUCCESS
