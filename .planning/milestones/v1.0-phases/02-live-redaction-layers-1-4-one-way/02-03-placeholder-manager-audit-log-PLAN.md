---
phase: 02-live-redaction-layers-1-4-one-way
plan: "03"
type: execute
wave: 2
depends_on: ["00"]
files_modified:
  - src/placeholder/manager.ts
  - src/placeholder/substitute.ts
  - src/placeholder/type-map.ts
  - src/audit/log.ts
  - src/audit/canary-leak.ts
  - tests/placeholder/manager.test.ts
  - tests/placeholder/substitute.test.ts
  - tests/audit/log.test.ts
  - tests/audit/canary-leak.test.ts
autonomous: true
requirements: [PH-01, PH-02, PH-03, PH-04, AUDIT-01, AUDIT-02]
tags: [placeholder, audit-log, jsonl, sha256, redaction-discipline]
must_haves:
  truths:
    - "Placeholders are formatted exactly as `<MRCLEAN:TYPE:NNN>` where TYPE is from the locked vocabulary and NNN is 3-digit zero-padded"
    - "Same secret value within a single session always maps to the same placeholder (SHA-256 keyed stability)"
    - "Placeholder counter is global per session; collision-free across TYPEs; max 999, overflow path emits <MRCLEAN:TYPE:OVF>"
    - "Substitution does not mangle text containing JSON, Markdown, code-fence, or unified-diff syntax"
    - "Every detection writes one JSONL record with ts/sessionId/hookEvent/ruleId/severity/action/redactedHash/fingerprint/location"
    - "Audit log NEVER contains the raw secret value, env-var name, or file path outside project root — a canary-leak helper proves it"
    - "src/placeholder/type-map.ts is a THIN RE-EXPORT of getTypeForRuleId from src/detect/type-map.ts (Plan 02-00 canonical); this file exists purely to give callers a 'stable placeholder/' import path"
  artifacts:
    - path: "src/placeholder/manager.ts"
      provides: "PlaceholderManager class with allocate + getByPlaceholder + size"
      exports: ["PlaceholderManager", "PlaceholderEntry"]
    - path: "src/placeholder/substitute.ts"
      provides: "substituteFindings(text, findings) → string (longest-spans-first, no index drift)"
      exports: ["substituteFindings", "ResolvedFinding"]
    - path: "src/placeholder/type-map.ts"
      provides: "Thin re-export of getTypeForRuleId from Plan 02-00's canonical src/detect/type-map.ts"
      exports: ["getTypeForRuleId", "TYPE_VOCABULARY"]
    - path: "src/audit/log.ts"
      provides: "writeAuditRecord(cwd, record) — JSONL appender"
      exports: ["writeAuditRecord", "AuditRecord"]
    - path: "src/audit/canary-leak.ts"
      provides: "assertNoCanaryLeak(logPath, canaries) — CI canary helper"
      exports: ["assertNoCanaryLeak"]
  key_links:
    - from: "src/placeholder/manager.ts"
      to: "src/detect/findings.ts"
      via: "sha256hex helper from Plan 02-00 — IMPORT, do not redefine"
      pattern: "sha256hex"
    - from: "src/placeholder/type-map.ts"
      to: "src/detect/type-map.ts"
      via: "re-export getTypeForRuleId + TYPE_VOCABULARY from Plan 02-00 canonical"
      pattern: "from '../detect/type-map"
    - from: "src/audit/log.ts"
      to: ".mrclean/audit.jsonl"
      via: "fs.appendFile with flag 'a' and JSON.stringify + '\\n'"
      pattern: "appendFile"
---

<objective>
Build the placeholder manager (session-scoped, stable-per-value, collision-free, global counter) and the audit-log writer (JSONL, raw-secret-free) that together satisfy PH-01..04 and AUDIT-01..02. Provide a canary-leak helper that the Phase 3 CI test (and Plan 02-06 fixtures test) can call to assert the audit log never contains a raw secret string.

Purpose: Placeholders are the unit of work Plan 02-05's hook integration emits to Claude Code; the audit log is the only persistent artifact of detection. Both must be correct before the orchestrator (Plan 02-04) glues them together.

Output: A `PlaceholderManager` class, a `substituteFindings` helper, an `writeAuditRecord` appender, and a `assertNoCanaryLeak` CI helper, all unit-tested.

**Wave 1 → Wave 2 contract:** This plan IMPORTS:
- `Finding`, `sha256hex`, `redactedHash`, `fingerprint` from `src/detect/findings.ts` (Plan 02-00 owned — DO NOT CREATE).
- `getTypeForRuleId`, `TYPE_VOCABULARY` from `src/detect/type-map.ts` (Plan 02-00 owned — DO NOT CREATE).

This plan DOES create `src/placeholder/type-map.ts` — but that file is a THIN RE-EXPORT only (`export { getTypeForRuleId, TYPE_VOCABULARY } from '../detect/type-map.js'`). It exists so callers can import from a stable `src/placeholder/` path. It is DISJOINT from `src/detect/type-map.ts` — Plan 02-00 owns the canonical map; this plan only re-exports.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-00-deps-config-schema-toml-migration-PLAN.md
@CLAUDE.md

<interfaces>
**OWNED ELSEWHERE (Plan 02-00 — Wave 1; import only, DO NOT CREATE OR MODIFY):**

From `src/detect/findings.ts`:
- `interface Finding { ruleId, severity, span: { start, end }, value, redactedHash, fingerprint, source, action? }`
- `function sha256hex(value: string): string`  (full 64-char hex)
- `function redactedHash(value: string): string`  (first 16 chars)
- `function fingerprint(ruleId: string, value: string): string`

From `src/detect/type-map.ts`:
- `function getTypeForRuleId(ruleId: string): string`
- `const TYPE_VOCABULARY: readonly string[]`

Wave 1 ran before Wave 2 — these symbols WILL exist when this plan executes. DO NOT redefine them. If you find these files missing during execution, surface a runtime error rather than re-creating them (Plan 02-00's invariants have been violated).

---

Locked placeholder format (PH-01 + CONTEXT §Placeholder Manager):
- `<MRCLEAN:TYPE:NNN>` where TYPE is from the vocabulary and NNN is a 3-digit zero-padded global session counter.
- Overflow: `<MRCLEAN:TYPE:OVF>` after counter > 999.

PlaceholderManager API (RESEARCH §8.2):
```typescript
export interface PlaceholderEntry {
  type: string
  index: number              // 1-based session counter
  firstSeenTs: string        // ISO8601
  placeholder: string        // '<MRCLEAN:AWS_KEY:001>' or '<MRCLEAN:TYPE:OVF>'
  hash: string               // full SHA-256 of value (for cross-reference; redactedHash is the 16-char truncation)
}

export class PlaceholderManager {
  constructor(opts?: { sessionId?: string })
  allocate(value: string, type: string): PlaceholderEntry  // same value → same placeholder
  getByPlaceholder(placeholder: string): PlaceholderEntry | undefined
  size(): number   // current counter value (0 if no allocations)
}
```

AuditRecord (RESEARCH §10.1 + CONTEXT §Audit Log — locked):
```typescript
export interface AuditRecord {
  ts: string                 // ISO8601
  sessionId: string
  hookEvent: 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse'
  ruleId: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  action: 'block' | 'substitute' | 'audit'
  redactedHash: string       // first 16 hex chars of SHA-256(value)
  fingerprint: string        // `${ruleId}:${redactedHash}`
  location: { hookEvent: string; offset: number; length: number }
}
```

LOCKED: NO env-var names, NO raw values, NO file paths outside project root.

substituteFindings (RESEARCH §8.3):
- Sort findings by span.start DESCENDING so substitution from right-to-left doesn't shift earlier indices.
- Each finding has a pre-allocated `placeholder` string; substitution is `text.slice(0, span.start) + placeholder + text.slice(span.end)`.
- `ResolvedFinding = Finding & { placeholder: string }`.

Canary-leak helper:
- `assertNoCanaryLeak(logPath: string, canaries: string[]): Promise<{ ok: boolean; leaked: { canary: string; line: number; record: string }[] }>` — reads the JSONL log, for each line and each canary, checks if the canary appears as a substring. Returns a structured result for both pass and fail (caller decides whether to throw).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: PlaceholderManager + substituteFindings + thin type-map re-export</name>
  <files>src/placeholder/manager.ts, src/placeholder/substitute.ts, src/placeholder/type-map.ts, tests/placeholder/manager.test.ts, tests/placeholder/substitute.test.ts</files>
  <read_first>
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §8 (manager + substitute) + §1.3 + §2 (Type vocabulary union)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md §Placeholder Manager
    - **src/detect/findings.ts (Plan 02-00 — IMPORT `sha256hex`. DO NOT CREATE.)**
    - **src/detect/type-map.ts (Plan 02-00 — re-exported via src/placeholder/type-map.ts. DO NOT CREATE OR MODIFY.)**
  </read_first>
  <behavior>
    PlaceholderManager:
    - `new PlaceholderManager({ sessionId: 's1' })` starts with counter=0.
    - `m.allocate('akia123', 'AWS_KEY')` returns entry with `placeholder: '<MRCLEAN:AWS_KEY:001>'`, `index: 1`, `firstSeenTs: <ISO>`, `hash: <64-char SHA-256>`.
    - `m.allocate('akia123', 'AWS_KEY')` (second call same value) returns the SAME entry (PH-02 stability).
    - `m.allocate('different', 'JWT')` returns entry with `placeholder: '<MRCLEAN:JWT:002>'`, `index: 2` (global counter, not per-TYPE — PH-03).
    - `m.getByPlaceholder('<MRCLEAN:AWS_KEY:001>')` returns the original entry.
    - 1000 unique allocations: the 1000th returns `<MRCLEAN:TYPE:OVF>` AND writes a structured JSON warning to stderr (CONTEXT §Placeholder Manager).
    - Overflow path: subsequent allocations after overflow continue to return OVF placeholders, indexed by the counter; same-value lookups within OVF still return the same entry.

    substituteFindings:
    - Given text `"abcAKIA123xyz" with findings = [{ span: {start:3, end:10}, placeholder: '<MRCLEAN:AWS_KEY:001>' }]`, result is `"abc<MRCLEAN:AWS_KEY:001>xyz"`.
    - Multiple non-overlapping findings: text `"abc XXX def YYY ghi"` with findings at [4,7] and [12,15] → both replaced; index ordering correct.
    - Overlapping findings: assumption is that Plan 02-04's orchestrator runs `dedupBySpan` first; substituteFindings still defensively handles overlap by taking the LATEST (highest span.start) — overlapping findings are not silently lost but the result is deterministic.
    - JSON-context preservation: text `'{"command":"echo XXX"}'` with finding at offset of `XXX` → result is still valid JSON (placeholder uses angle brackets which JSON tolerates inside a string).
    - Markdown code-fence preservation: text containing ` ```python\nxxx\n``` ` with finding inside the fence → fence still parses; angle brackets do not break Markdown.
    - Unified-diff preservation: text containing `-line with secret\n+line without secret` with finding on the secret → diff structure preserved.

    type-map re-export:
    - `getTypeForRuleId('AWSSecretAccessKey')` returns `'AWS_SECRET'`.
    - `getTypeForRuleId('gitleaks:aws-access-token')` returns `'AWS_KEY'`.
    - `getTypeForRuleId('UnknownRule_xyz')` returns `'SECRET'` (fallback).
    - `getTypeForRuleId('entropy:high')` returns `'ENTROPY'`.
    - `getTypeForRuleId('env:literal')` returns `'ENV'`.
    - `getTypeForRuleId('word:foobar')` returns `'WORD'`.
    All of these are provided by Plan 02-00's canonical `src/detect/type-map.ts`; this plan's thin re-export does NOT change behavior.
  </behavior>
  <action>
    Step 1 — `src/placeholder/type-map.ts` (thin re-export — 2-3 lines):
    ```
    // src/placeholder/type-map.ts
    //
    // Thin re-export of the canonical type-map from src/detect/type-map.ts (Plan 02-00 owned).
    // This file exists so callers can import getTypeForRuleId from `src/placeholder/`
    // without crossing into `src/detect/`. Behavior is identical — Plan 02-00 is the source of truth.
    //
    // DO NOT add new mappings here. Revise Plan 02-00 and src/detect/type-map.ts instead.
    export { getTypeForRuleId, TYPE_VOCABULARY } from '../detect/type-map.js';
    ```

    Step 2 — `src/placeholder/manager.ts`:
    - **Imports:** `import { sha256hex } from '../detect/findings.js';`
    - Export `PlaceholderEntry` interface per interfaces block.
    - Implement `PlaceholderManager` class:
      - `private readonly sessionId: string` (default: `'unset'`).
      - `private readonly byHash = new Map<string, PlaceholderEntry>()`.
      - `private readonly byPlaceholder = new Map<string, string>()` (placeholder → hash).
      - `private counter = 0`.
      - `private overflowed = false`.
      - `allocate(value, type)`:
        - `hash = sha256hex(value)` — full 64-char hex.
        - if `byHash.has(hash)` → return cached entry (PH-02).
        - `counter++`.
        - if `counter > 999`:
          - if not yet overflowed: emit `process.stderr.write(JSON.stringify({ warn: 'mrclean placeholder overflow', counter, sessionId }) + '\n')`. Set `overflowed = true`.
          - placeholder = `<MRCLEAN:${type}:OVF>`.
        - else: placeholder = `<MRCLEAN:${type}:${String(counter).padStart(3, '0')}>`.
        - entry = `{ type, index: counter, firstSeenTs: new Date().toISOString(), placeholder, hash }`.
        - `byHash.set(hash, entry)`. `byPlaceholder.set(placeholder, hash)` (note: OVF placeholder collides for same TYPE — last writer wins, document this as expected overflow degradation).
        - return entry.
      - `getByPlaceholder(p)`: `const h = byPlaceholder.get(p); return h ? byHash.get(h) : undefined`.
      - `size(): number`: return `counter`.

    Step 3 — `src/placeholder/substitute.ts`:
    - **Imports:** `import type { Finding } from '../detect/findings.js';`
    - Export `ResolvedFinding = Finding & { placeholder: string }`.
    - Export `substituteFindings(text: string, findings: ResolvedFinding[]): string`:
      - Sort by `span.start DESCENDING`.
      - Iteratively substitute: `text = text.slice(0, span.start) + placeholder + text.slice(span.end)`.
      - Return the modified text.
    - Defensive: if any finding has `span.start === span.end` (zero-length), skip it (defense in depth — Plan 02-01's worker guards against zero-length match loops, but be paranoid).

    Step 4 — `tests/placeholder/manager.test.ts` (~7 tests):
    - allocate returns NNN-formatted placeholder.
    - Same value → same placeholder (stability).
    - Different values → different placeholders, monotonic counter.
    - Counter is global across TYPEs (alloc AWS_KEY then JWT → indices 001, 002).
    - getByPlaceholder round-trips.
    - Overflow at 1000th alloc emits stderr JSON warning and returns OVF placeholder.
    - Overflow path: post-1000 allocations all return OVF; same-value lookups still cached.

    Step 5 — `tests/placeholder/substitute.test.ts` (~5 tests):
    - Single substitution mid-text.
    - Multiple non-overlapping substitutions preserve correct positions.
    - Substitution at start of text (`span.start === 0`).
    - Substitution at end of text (`span.end === text.length`).
    - JSON-context test: `'{"x":"secretXXX"}'` → result is valid JSON (parseable by JSON.parse, with the placeholder inside the string value).

    Commit as `feat(02-03): placeholder manager + substitute helper`.
  </action>
  <verify>
    <automated>
      grep -cE "^export class PlaceholderManager" src/placeholder/manager.ts &&
      grep -cE "MRCLEAN:OVF|MRCLEAN:\\\$" src/placeholder/manager.ts &&
      grep -cE "padStart\\(3" src/placeholder/manager.ts &&
      grep -c "sha256hex" src/placeholder/manager.ts &&
      grep -cE "from ['\"]\\.\\./detect/findings" src/placeholder/manager.ts &&
      grep -cE "^export function substituteFindings" src/placeholder/substitute.ts &&
      grep -cE "from ['\"]\\.\\./detect/type-map" src/placeholder/type-map.ts &&
      test -f src/detect/findings.ts &&
      test -f src/detect/type-map.ts &&
      npx vitest run tests/placeholder/ 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      git log -1 --format=%s | grep -E "^feat\(02-03\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - `src/placeholder/manager.ts` exports `PlaceholderManager` class with `allocate`, `getByPlaceholder`, `size`.
    - `src/placeholder/manager.ts` imports `sha256hex` from `../detect/findings` (grep verified — Plan 02-00 module).
    - Placeholder format string uses `padStart(3, '0')` (3-digit zero-padded).
    - Overflow path writes JSON warning to stderr (grep for `JSON.stringify` near `overflow`).
    - `src/placeholder/substitute.ts` sorts by `span.start` descending (grep for `b.span.start - a.span.start` or similar).
    - `src/placeholder/substitute.ts` imports `Finding` type from `../detect/findings`.
    - `src/placeholder/type-map.ts` re-exports from `../detect/type-map.js` (grep verified).
    - **Wave 1 contract:** `src/detect/findings.ts` and `src/detect/type-map.ts` exist and are NOT in this plan's git diff (Plan 02-00 owns them).

    Behavior assertions:
    - All 12 tests across tests/placeholder/ pass.
    - PH-01..04 all proven:
      - PH-01: format-string test.
      - PH-02: stability test.
      - PH-03: collision-free (global counter) test.
      - PH-04: angle-bracket survival in JSON context test.

    Commit assertion:
    - `git log -1 --format=%s` matches `^feat\(02-03\)`.
  </acceptance_criteria>
  <done>PlaceholderManager + substituteFindings + thin type-map re-export complete; PH-01..04 all proven by tests. Plan 02-00's canonical findings.ts and detect/type-map.ts are imported (not duplicated).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Audit log appender + canary-leak helper</name>
  <files>src/audit/log.ts, src/audit/canary-leak.ts, tests/audit/log.test.ts, tests/audit/canary-leak.test.ts</files>
  <read_first>
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §10 (audit record schema + append discipline)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md §Audit Log
    - **src/detect/findings.ts (Plan 02-00 — Finding shape; IMPORT for the type)**
    - src/placeholder/manager.ts (Task 1 output — PlaceholderEntry provides redactedHash via Finding.redactedHash)
  </read_first>
  <behavior>
    writeAuditRecord:
    - Appends one JSON line + `\n` to `<cwd>/.mrclean/audit.jsonl` via `fs.appendFile` with `flag: 'a'`.
    - If `.mrclean/` does not exist, throws a structured error (the install flow creates it; missing dir = install corruption).
    - Concurrent writes from the same process are serialized at the OS level via append-mode (Node's fs.appendFile uses O_APPEND atomicity — RESEARCH §10.2).
    - JSON record is the AuditRecord interface verbatim — no extra fields, no missing fields.
    - Multiple records appended sequentially → readable line-by-line as JSON.
    - NEVER includes raw value, env-var name, or file path outside project root.
    - Asynchronous (returns Promise) — caller awaits.

    canary-leak:
    - `assertNoCanaryLeak(logPath, canaries)` reads the file, splits on `\n`, parses each non-empty line as JSON, then for each canary string checks if it appears AS A SUBSTRING of `JSON.stringify(record)` (covers any field). Returns `{ ok: boolean; leaked: { canary, line, record }[] }`.
    - Substring (not exact-match) so we catch partial leaks like a base64-encoded variant of the secret slipping into a `value` field by mistake.
    - On ENOENT (empty audit log), returns `{ ok: true, leaked: [] }`.
    - On JSON parse error on any line, returns `{ ok: false, leaked: [{ canary: '<malformed>', line, record }] }` — the canary-leak test is allowed to fail on malformed log entries (defense-in-depth).

    Helper for orchestrator (Plan 02-04 consumer):
    - Export `function findingToAuditRecord(finding: Finding, sessionId: string, hookEvent: string, action: 'block'|'substitute'|'audit'): AuditRecord` — purely a builder, no I/O. Plan 02-04 uses this to convert Findings to AuditRecords before calling writeAuditRecord.
    - Document explicitly: the builder does NOT include raw value or env-var name. It uses `finding.redactedHash` and `finding.fingerprint`. `location.offset = finding.span.start; location.length = finding.span.end - finding.span.start`.
  </behavior>
  <action>
    Step 1 — `src/audit/log.ts`:
    - **Imports:** `import { appendFile } from 'node:fs/promises'; import { join } from 'node:path'; import type { Finding } from '../detect/findings.js';`
    - Export `AuditRecord` interface per interfaces block (locked).
    - Export `async function writeAuditRecord(cwd: string, record: AuditRecord): Promise<void>`:
      - logPath = `join(cwd, '.mrclean', 'audit.jsonl')`.
      - line = `JSON.stringify(record) + '\n'`.
      - `await appendFile(logPath, line, { flag: 'a', encoding: 'utf8' })`.
      - On ENOENT for the directory: re-throw with a wrapped message `mrclean audit: .mrclean/ not found — run \`mrclean install\``. Use a custom error class `AuditWriteError` to make the error catchable upstream.
    - Export `function findingToAuditRecord(finding: Finding, sessionId: string, hookEvent: string, action: 'block'|'substitute'|'audit'): AuditRecord`:
      - Build the record using ONLY safe fields: ts/sessionId/hookEvent/ruleId/severity/action/redactedHash/fingerprint/location.
      - `location: { hookEvent, offset: finding.span.start, length: finding.span.end - finding.span.start }`.
      - Add comment: `// LOCKED: NEVER add raw value, env-var name, or file path here. CI canary test enforces this.`

    Step 2 — `src/audit/canary-leak.ts`:
    - `async function assertNoCanaryLeak(logPath: string, canaries: string[]): Promise<{ ok: boolean; leaked: Array<{ canary: string; line: number; record: string }> }>`:
      - Read file; if ENOENT → `{ ok: true, leaked: [] }`.
      - Split by `\n`, filter empty.
      - For each line (1-indexed): parse JSON inside try/catch. If parse fails, push `{ canary: '<malformed>', line, record: rawLine }` and continue.
      - For each parsed record, build `recordStr = JSON.stringify(record)`.
      - For each canary: if `recordStr.includes(canary)` → push `{ canary, line, record: recordStr }`.
      - Return `{ ok: leaked.length === 0, leaked }`.

    Step 3 — `tests/audit/log.test.ts` (~6 tests):
    - Round-trip: writeAuditRecord then read the file → JSON.parse the last line → equals input record.
    - Sequential writes append; the file contains N lines after N writes.
    - JSONL framing: each line ends with `\n` and is valid JSON.
    - findingToAuditRecord excludes raw value: assert record is JSON.stringify'd and does not include the test fixture's secret value (`AKIAIOSFODNN7EXAMPLX`).
    - findingToAuditRecord location offset/length correct.
    - ENOENT directory throws `AuditWriteError` (test uses a non-existent cwd).

    Step 4 — `tests/audit/canary-leak.test.ts` (~5 tests):
    - Empty log file → ok: true.
    - Log with no canaries → ok: true.
    - Log containing the AWS fixture string (deliberately injected by test) → ok: false; leaked includes that canary.
    - Log with malformed JSON line → ok: false with `<malformed>` entry.
    - Multiple canaries, mixed leak status → leaked array contains only the actual leaks.

    Commit as `feat(02-03): audit log JSONL appender + canary-leak helper`.
  </action>
  <verify>
    <automated>
      grep -c "appendFile" src/audit/log.ts &&
      grep -c "flag: 'a'" src/audit/log.ts &&
      grep -cE "^export async function writeAuditRecord|^export function findingToAuditRecord" src/audit/log.ts &&
      grep -c "AuditWriteError" src/audit/log.ts &&
      grep -cE "^export async function assertNoCanaryLeak" src/audit/canary-leak.ts &&
      grep -v '^//' src/audit/log.ts | grep -cE "(env_var_name|raw_value|sourceFile)" | grep -E "^0$" &&
      npx vitest run tests/audit/ 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      git log -1 --format=%s | grep -E "^feat\(02-03\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - `src/audit/log.ts` exports `writeAuditRecord`, `findingToAuditRecord`, `AuditRecord`, `AuditWriteError`.
    - `writeAuditRecord` uses `appendFile` with `flag: 'a'`.
    - `findingToAuditRecord` body does NOT reference `env_var_name`, `raw_value`, or `sourceFile` (grep gate, excluding comment lines).
    - `src/audit/canary-leak.ts` exports `assertNoCanaryLeak`.

    Behavior assertions:
    - All ~11 audit tests pass.
    - AUDIT-01 proven: round-trip test confirms every required field present in the JSONL line.
    - AUDIT-02 proven: the canary-leak test against an audit log containing actual records does NOT find any of the secret-value fixtures.

    Commit assertion:
    - `git log -1 --format=%s` matches `^feat\(02-03\)`.
  </acceptance_criteria>
  <done>Audit log appender writes correct JSONL records; canary-leak helper proves no raw secret leak; AUDIT-01 + AUDIT-02 fully proven.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Finding→audit log | Findings carry the raw secret VALUE in memory; the audit log writer is contractually forbidden from persisting it. Boundary is enforced by `findingToAuditRecord` not copying `value`. |
| placeholder map→stderr (overflow) | Overflow warning goes to stderr; the warning JSON does NOT include any raw value. |
| placeholder map→memory | The map is in-memory only — no persistence per CONTEXT and PROJECT.md ban. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-03-01 | Information disclosure | A future refactor adds `finding.value` to `findingToAuditRecord` → raw secret persists | mitigate | Grep gate in acceptance criteria (`grep -v '^//' src/audit/log.ts \| grep -cE "(env_var_name|raw_value|sourceFile)"`). The canary-leak test in tests/audit/ + Plan 02-06's end-to-end test enforce it at runtime. |
| T-02-03-02 | Tampering | Someone runs `npm install <malicious>` and patches sha256hex to return a constant — all placeholders collapse | accept | Supply-chain trust handled by package-lock.json + (out of scope) `npm audit`. No defense in this plan. |
| T-02-03-03 | DoS | A million-collision allocation pattern: 1000 unique values + 1 million same-value re-allocations. Map lookup is O(1) — no DoS. | accept | Map size capped at 999 entries (overflow) + memory footprint ~200 KB max (RESEARCH §8.2). |
| T-02-03-04 | Information disclosure | The placeholder OVERFLOW emits stderr — if the operator pipes stderr to a remote logger, the WARNING leaks session id + counter | accept | The warning contains no secret value or env name. Session id is not sensitive. Documented in CONTEXT. |
| T-02-03-05 | Repudiation | An audit log entry's `ts` is local-clock; if the clock is wrong the audit chain is unverifiable | accept | v1 uses `new Date().toISOString()`. Local-clock attack is out of scope (operator owns the machine). |
| T-02-03-06 | Information disclosure | `assertNoCanaryLeak` accidentally prints the canary value in its result struct when invoked by CI | accept | CI consumers receive the structured result; printing it is the operator's choice. The helper's purpose is to detect leaks; surfacing them is the whole point. The fixtures themselves are checksum-flipped (Plan 02-06) so no real cred is exposed even if printed. |
</threat_model>

<verification>
- `npx vitest run tests/placeholder/ tests/audit/` — all ~23 tests pass.
- `grep -v '^//' src/audit/log.ts | grep -cE "(env_var_name|raw_value|sourceFile)"` = 0.
- Audit log round-trip: write 3 records, read file, JSON.parse each line, confirm equal to inputs.
- Canary-leak helper returns `{ ok: false }` when the AWS fixture string is in any audit record field.
- PlaceholderManager: 1000-unique-value test hits overflow path; OVF placeholder format correct.
- PlaceholderManager: stability test (same value twice → same placeholder) PASSES.
- substituteFindings: JSON-context test produces parseable JSON output.
- The Wave 1 contract is honored: `src/detect/findings.ts` and `src/detect/type-map.ts` are Plan 02-00 owned and NOT touched here. `src/placeholder/type-map.ts` is a thin re-export and is DISJOINT from the canonical detect/type-map.ts.
</verification>

<success_criteria>
- PH-01: `<MRCLEAN:TYPE:NNN>` format proven.
- PH-02: same value → same placeholder (stability proven).
- PH-03: global counter prevents cross-TYPE collisions (proven).
- PH-04: angle brackets survive JSON/Markdown/diff (proven via substitute test).
- AUDIT-01: JSONL records with all locked fields written via appendFile.
- AUDIT-02: canary-leak helper proves raw values, env-var names, and file paths are not in the log.
- Plan 02-04 has the contracts it needs (PlaceholderManager + writeAuditRecord + findingToAuditRecord + substituteFindings) to compose the orchestrator.
</success_criteria>

<output>
After completion, create `.planning/phases/02-live-redaction-layers-1-4-one-way/02-03-SUMMARY.md` documenting:
- PlaceholderEntry shape, counter semantics, overflow behavior.
- AuditRecord shape with redaction-discipline rules.
- The canary-leak contract for downstream CI tests (Plan 02-06 + Phase 3 QA-03).
- substituteFindings algorithm + tested context-survival cases (JSON, Markdown, diff).
- Note: this plan IMPORTS from Plan 02-00's canonical `src/detect/findings.ts` and `src/detect/type-map.ts`. The `src/placeholder/type-map.ts` file in this plan is a thin re-export only — no duplicate vocabulary.
</output>
