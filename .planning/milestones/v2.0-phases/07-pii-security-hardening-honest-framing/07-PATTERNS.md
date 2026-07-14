# Phase 7: PII Security Hardening & Honest Framing - Pattern Map

**Mapped:** 2026-06-03 (re-mapped — verified against current source)
**Files analyzed:** 16 (3 new src/test, 1 optional src, 5 modified src, 2 modified test/CI, 4 modified docs/copy, plus extend 2 MCP tests)
**Analogs found:** 14 / 16 (2 net-new with strong adjacent precedents)

This is a HARDENING + FRAMING phase. Almost everything attaches to existing files and copies an
existing single-sink / single-harness discipline. The only genuinely new runtime code is one pure
function (`sanitizeForOutput`). Decisions D-01..D-08 are LOCKED.

**Source-path corrections to RESEARCH.md (verified this session):**
- RESEARCH cited `src/audit/failclosed.ts` — the actual file is **`src/hook/failclosed.ts`**.
- RESEARCH cited `src/shared/strings.ts` — that file does **NOT exist yet** (`src/shared/` has only
  `types.ts`, `version.ts`). It would be NEW (optional).
- Assumption A1 is **CONFIRMED**: `ResolvedFinding extends Finding` (`src/detect/index.ts:92`) and
  `Finding.source` includes `'pii-ner'` (`src/detect/findings.ts:47`), so `toFindingDTO` has `source`.

## File Classification

| New/Modified File | New/Mod | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|---------|------|-----------|----------------|---------------|
| `src/audit/sanitize-output.ts` (name at discretion) | NEW | utility (pure fn) | transform | `src/audit/log.ts` `findingToAuditRecord` (single-sink lock) + `src/audit/canary-leak.ts` (pure shape) | role-match |
| `tests/audit/sanitize-output.test.ts` | NEW | test (unit) | transform | `tests/audit/canary-leak.test.ts` | exact (sibling dir) |
| `tests/audit/pii-leak.test.ts` | NEW | test (integration+unit) | file-I/O + event-driven | `tests/fixtures-corpus.test.ts` + `tests/audit/canary-leak.test.ts` | exact (combine two) |
| `tests/copy-drift.test.ts` | NEW | test (unit) | file-I/O (static scan) | `tests/audit/canary-leak.test.ts` substring loop | role-match |
| `src/shared/strings.ts` | NEW (optional) | config/constants | — | `src/shared/version.ts` (single const export) | role-match |
| `src/mcp/tools/check.ts` | MOD | controller (MCP tool) | request-response | self / `redact.ts` (`nerStatus` enum + `toFindingDTO`) | exact (self) |
| `src/mcp/tools/redact.ts` | MOD | controller (MCP tool) | request-response | self / `check.ts` | exact (self) |
| `src/hook/failclosed.ts` | MOD | utility (error sink) | error/transform | self (`writeFailClosedError`) | exact (self) |
| `src/mcp/supervisor.ts` | MOD | middleware (catch boundary) | error/request-response | self (`supervisedToolCall`) | exact (self) |
| `src/mcp/server.ts` | MOD | service (stderr writes) | error/event-driven | self (`server.ts:67`, `:137`) | exact (self) |
| `src/cli.ts` / `src/hook/banner.ts` | MOD | controller / view | request-response | `buildBanner` (`banner.ts:42-49`) | exact (self) |
| `src/doctor/report.ts` (+ `src/doctor/checks.ts` optional) | MOD | view + service | request-response | self (`renderReport` + `CheckResult`) | exact (self) |
| `tests/mcp/check.test.ts` + `tests/mcp/redact.test.ts` | EXTEND | test (unit) | request-response | self (T3 finding-shape assertion) | exact (self) |
| `.github/workflows/canary-leak.yml` | MOD | config (CI) | batch | self (double-pass gate) | exact (self) |
| `README.md` (new §PII framing) | MOD | docs (prose) | n/a | §10 "What this does NOT defend against" + `docs/SCOPE-FENCE.md` | role-match |
| `docs/SCOPE-FENCE.md` | MOD | docs (prose) | n/a | self (Phase 4 scope-fence) | exact (self) |

## Pattern Assignments

### `src/audit/sanitize-output.ts` (NEW — utility, transform) — PIISEC-01 / D-03, D-04

**Analog (discipline):** `src/audit/log.ts` `findingToAuditRecord` — the LOCKED single point where a
Finding becomes safe output. **Analog (module shape):** `src/audit/canary-leak.ts` — a pure,
dependency-light module: one exported fn, defensive branches, internal `isEnoent`-style helpers, no I/O.

**Single-sink LOCKED comment to copy** (`src/audit/log.ts:167`, `:182-185`):
```typescript
// LOCKED: NEVER add raw value, env-var name, file path, or raw PII here. CI canary test enforces this.
...
// LOCKED no-raw defense: destructure-pick ONLY the four model-identity keys.
// Never blind-spread `provenance` — TS structural typing lets an over-shaped
// object (e.g. a Finding carrying `value`) pass the param type, and a blind
// spread would serialize that raw text into audit.jsonl (CR-01).
```
Apply an analogous lock: error-path ONLY, never imported into `detect/` or the success branch.

**Two-mode pure-function shape** (RESEARCH §Code Examples — the locked illustrative shape; conforms to
coding-style "return new, no mutation"):
```typescript
export interface DetectedSpanValue { value: string }

export function sanitizeForOutput(
  message: string,
  detectedSpans: readonly DetectedSpanValue[],
  fallback = 'mrclean: an error occurred (details withheld to avoid leaking input)',
): string {
  // D-04 context-free guard: a pre-detection failure (model-load, JSON.parse on raw stdin)
  // has no spans. We cannot prove the message is clean → emit the static fallback.
  if (detectedSpans.length === 0) return fallback
  let out = message
  for (const { value } of detectedSpans) {
    if (value.length === 0) continue
    out = out.split(value).join('<redacted>')   // literal replace — ReDoS-free, input not mutated
  }
  return out
}
```
- *Context-bearing* (error after detection ran): scrub each passed-in detected value.
  Note: the RESEARCH-locked shape uses a literal `'<redacted>'` placeholder. An equally valid option is
  substituting `redactedHash(value)` (`src/detect/findings.ts`) to mirror how audit records carry only
  the hash — planner picks; both keep raw text out.
- *Context-free* (model-load failure before any parse, D-04, Pitfall 2): empty spans → static fallback,
  NEVER echo the offending payload.

**Hot-path fence (D-04):** error paths ONLY. Do NOT import from `runDetection` happy path or the
< 100 ms hook gate. The `opts.ner` structural gate in `src/detect/index.ts` (keeping ML off the cold
path) is the precedent for keeping this off the hot path.

---

### `tests/audit/sanitize-output.test.ts` (NEW — test, unit) — PIISEC-01

**Analog:** `tests/audit/canary-leak.test.ts` (`:32-114`) — AAA structure, fixture-string constant at
top, positive + negative cases. `sanitizeForOutput` is pure, so no tmpdir is needed.

**Imports (ESM `.js` suffix — project convention, `canary-leak.test.ts:12`):**
```typescript
import { describe, expect, it } from 'vitest'
import { sanitizeForOutput } from '../../src/audit/sanitize-output.js'
```
Cases: (a) message containing a detected value → value scrubbed; (b) context-free (empty spans) →
static fallback, input echoed nowhere (D-04); (c) multiple spans scrubbed; (d) safe message passes
through. Use the 2-arg `it(name, fn)` form (Vitest 3-arg `test()` was migrated in Phase 3).

---

### `tests/audit/pii-leak.test.ts` (NEW — test, integration+unit) — PIISEC-01 / D-01, D-02

**Analog 1 (end-to-end harness):** `tests/fixtures-corpus.test.ts`. Copy the `beforeAll` tmpdir +
`.env` + `.mrclean/words.txt` + `initSessionState` + `runDetection` + **line-count guard** +
`assertNoCanaryLeak`. The line-count guard (`:201-220`) is load-bearing — it prevents a vacuous pass on
a silently-empty audit log.

**Corpus + canary-list pattern to copy** (`tests/fixtures-corpus.test.ts:35-49`, `:222-229`):
```typescript
const PII_CORPUS = {
  ssn:   '000-12-3456',                 // invalid-by-construction SSN shape (easy grep)
  email: 'leak-canary@example.invalid',
  name:  'Zzyzx Quibblefax',            // implausible PERSON → NER target, unambiguous grep
  card:  '4000 0000 0000 0002',         // Luhn-shaped test card
} as const
const ALL = Object.values(PII_CORPUS)
// ...
const result = await assertNoCanaryLeak(auditPath, [...ALL])
expect(result.ok, `Audit log contains raw PII: ${JSON.stringify(result.leaked)}`).toBe(true)
```
Feed through `runDetection(text, config, sessionState, ctx, { ner: true })` so the L6b NER lane is
exercised (`{ ner:true }` is the sole structural gate, `src/mcp/tools/check.ts:121`).

**Reuse, do not rebuild:** `assertNoCanaryLeak` AS-IS (`src/audit/canary-leak.ts:56`) — already handles
ENOENT-clean, malformed-line-as-suspect, key-order-normalized `JSON.stringify` substring match.

**Forced-failure injection (D-02 — representative set, not every catch).** Assert no corpus value
reaches captured stderr. Spy pattern (RESEARCH §Pattern 2):
```typescript
const writes: string[] = []
const spy = vi.spyOn(process.stderr, 'write')
  .mockImplementation((s: any) => { writes.push(String(s)); return true })
// ...trigger path...
spy.mockRestore()
for (const v of ALL) expect(writes.join('')).not.toContain(v)
```
1. **Corrupt/missing model** — mock `getNerPipeline` to throw → `runLayer6bNer` boundary 1
   (`src/detect/layer6b-ner.ts:201-207`) returns `{ findings:[], status:'unavailable' }`. Verify the
   no-matched-text fail-closed contract (`layer6b-ner.ts:16-22`).
2. **NER inference throw** — mock the singleton's `pipe(text)` to throw → boundary 2
   (`src/detect/layer6b-ner.ts:209-215`). Same fail-closed return.
3. **Supervisor catch** — make the wrapped `fn` throw an error whose message embeds a corpus value →
   `supervisedToolCall` returns `{ ok:false, error }` (`src/mcp/supervisor.ts:55-61`); the tool surfaces
   `mrclean_check error: ${outcome.error}` (`src/mcp/tools/check.ts:124-128`). Assert the surfaced text
   is scrubbed post-chokepoint.

**Vitest project placement (`vitest.config.ts`):** the full-pipeline audit.jsonl test belongs in the
**`integration`** project (add to its `include` list — it owns the tsup `globalSetup`, runs
`fileParallelism:false`). The spy-only forced-failure tests run in the default **`unit`** project
(`include: ['tests/**/*.test.ts']`). Keep the model OUT of the test by mocking `getNerPipeline`
(RESEARCH §Environment Availability — model-free, fast CI).

---

### `tests/copy-drift.test.ts` (NEW — test, unit) — PIISEC-02 / D-05, D-08

**Analog:** `tests/audit/canary-leak.test.ts` substring loop (`:89-93`), inverted intent: read string
sources, regex-scan for banned CLAIM phrases, fail if any found. (RESEARCH recommends BOTH a Vitest test
AND a belt-and-suspenders CI grep — mirroring the existing `canary-leak.yml` double-pass.)

**Scan pattern** (RESEARCH §Code Examples):
```typescript
import { readFileSync } from 'node:fs'
const SOURCES = ['README.md','src/cli.ts','src/doctor/report.ts','docs/SCOPE-FENCE.md',
                 'src/mcp/tools/check.ts','src/mcp/tools/redact.ts','src/shared/strings.ts']
const BANNED = [/redacts? all PII/i, /\b(GDPR|HIPAA|CCPA)\b[^.]*compliant/i,
                /\bfully compliant\b/i, /\bguarantees? (that )?(all|every) /i]
for (const src of SOURCES) {
  const text = readFileSync(src, 'utf8')
  for (const re of BANNED)
    expect(re.test(text), `Banned overclaim ${re} in ${src}`).toBe(false)
}
```
**CRITICAL (Pitfall 5):** ban CLAIM shapes, not the bare word "guarantee" — the honest disclaimer
itself says "NOT a guarantee" and must not trip the gate. MCP tool description strings to scan live at
`check.ts:99-102` / `redact.ts:93-97`. Add a `disclaimer present` positive assertion (D-05) checking the
disclaimer string appears once in README PII §, the doctor output source, and the banner builder.

---

### `src/shared/strings.ts` (NEW, optional — constants) — PIISEC-02 / D-05, D-07

**Analog:** `src/shared/version.ts` — a tiny single-purpose const-export module in the same dir.
Centralize the ONE disclaimer string (D-07 stance) + the banned-phrase list so README / doctor / CLI /
banner reuse one source of truth (RESEARCH §Pattern 5) and `tests/copy-drift.test.ts` imports both.
D-07 stance (locked): "best-effort ML PII hint, not a guarantee; NER false negatives can leak;
`words.txt` + deterministic layers (secrets + checksum'd PII) are the real must-not-leak mechanism;
secrets remain the deterministic guarantee."

---

### `src/mcp/tools/check.ts` + `src/mcp/tools/redact.ts` (MOD — controller, request-response) — D-06 / D-03

**Analog:** each other (identical `findingSchema` + `toFindingDTO`: `check.ts:45-73`, `redact.ts:39-67`)
AND the existing `nerStatus` enum precedent (`check.ts:53-59`, `redact.ts:47-53`) — a typed,
non-free-text field that can never carry matched PII. Apply the SAME edit to both (keep them mirrors).

**Schema extension** (`check.ts:45-51`, identical `redact.ts:39-45`):
```typescript
const findingSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  placeholder: z.string(),
  redactedHash: z.string(),
  fingerprint: z.string(),
  advisory: z.boolean(),   // D-06: stable, always-emit boolean. true ONLY for the probabilistic NER lane.
})
```
**Mapper extension** (`check.ts:65-73`, identical `redact.ts:59-67`):
```typescript
function toFindingDTO(f: ResolvedFinding): z.infer<typeof findingSchema> {
  return {
    ruleId: f.ruleId, severity: f.severity, placeholder: f.placeholder,
    redactedHash: f.redactedHash, fingerprint: f.fingerprint,
    advisory: f.source === 'pii-ner',   // ResolvedFinding has `source`; schema still hides it. Pitfall 4 avoided.
  }
}
```
Recommend always-emit boolean (deterministic findings get `false`) for a stable schema (Open Question 2).

**isError text routing (D-03):** route `mrclean_check error: ${outcome.error}` (`check.ts:124-128`) and
the redact isError returns (`redact.ts:118-123`, `:127-137`) through `sanitizeForOutput`.

**Disclaimer once-per-output (D-05):** carry the best-effort note ONCE — e.g. in the tool `description`
or a single top-level `structuredContent` field (`check.ts:134`, `redact.ts:142`) — NOT per finding.

---

### `src/hook/failclosed.ts` (MOD — utility/error sink) — PIISEC-01 / D-03, D-04

**Analog:** self — `writeFailClosedError` (`src/hook/failclosed.ts:21-37`) is THE single hook stderr
error sink. PRIME D-04 leak vector: it currently embeds raw `err.message` AND `err.stack`:
```typescript
const message = err instanceof Error ? err.message : String(err)
const stack = err instanceof Error && err.stack ? err.stack : undefined
const payload: Record<string, unknown> = { error: 'mrclean hook crashed', message, ...context,
  ...(stack !== undefined ? { stack } : {}) }
```
Hook crashes are typically context-free (parse/stdin/model-load) → route through `sanitizeForOutput`
with `[]` spans so the payload emits a static message and never echoes input or a payload-bearing stack
frame (Pitfall 2). Keep the single-line-JSON contract (`failclosed.ts:8-11`, `:35-36`) intact — only the
field CONTENT changes.

---

### `src/mcp/supervisor.ts` (MOD — middleware/catch boundary) — PIISEC-01 / D-03

**Analog:** self — `supervisedToolCall` catch (`src/mcp/supervisor.ts:55-61`) returns `err.message` raw,
which is interpolated into MCP tool text (`check.ts:126`, `redact.ts:120`). Route through the chokepoint:
```typescript
} catch (err) {
  const raw = err instanceof Error ? err.message : String(err)
  return { ok: false, error: sanitizeForOutput(raw, []) }   // supervisor catch has no detection context → static
}
```
Preserve the `{ ok, result } | { ok, error }` discriminated-union public API unchanged.

---

### `src/mcp/server.ts` (MOD — service/stderr) — PIISEC-01 / D-03

**Analog:** self — two stderr writes: `server.ts:67` ("NER unavailable; serving secrets only\n") and
`server.ts:137` (running banner — static + version). Both currently carry NO input text, so they satisfy
D-04 as-is; route any future input-bearing writes through the chokepoint and add a guard comment.
Open Question 1: assess `mcp/lifecycle.ts` shutdown writes (likely signal-name only, no input).

---

### `src/cli.ts` / `src/hook/banner.ts` (MOD — controller / view) — PIISEC-02 / D-05, D-08 target

**Analog:** `buildBanner` (`src/hook/banner.ts:42-49`) — the single banner string builder
(`mrclean active vN.N.N (rules: ..., allowlist: ..., mode: ...)`). Append the once-per-session
best-effort PII note here (via `src/shared/strings.ts`), keeping `buildBanner` pure (no I/O). `cli.ts`
emits to stderr at `:95-105` and is a banned-phrase scan SOURCE (D-08). `picocolors` (used in
`report.ts:15`) is the coloring precedent if the line wants emphasis.

---

### `src/doctor/report.ts` (+ `src/doctor/checks.ts` optional) (MOD — view + service) — PIISEC-02 / D-05

**Analog:** self — `renderReport` (`src/doctor/report.ts:28-56`) loops `CheckResult`s then prints a
trailing version line with `picocolors`. Add ONE trailing disclaimer line after the version line (once
per output, D-05), styled `pc.dim(...)` to match:
```typescript
process.stdout.write(pc.dim(PII_BEST_EFFORT_DISCLAIMER) + '\n')   // D-05: once per output, not per finding
```
Optional `src/doctor/checks.ts` — `CheckResult` is `{ name, status:'PASS'|'FAIL'|'SKIP', detail }`
(`checks.ts:33-36`); a framing note can ride on the model-cache check's `detail` (a PASS/SKIP detail
string, never a new failing exit code). Keep it to ONE disclaimer per output.

---

### `tests/mcp/check.test.ts` + `tests/mcp/redact.test.ts` (EXTEND — test, unit) — PIISEC-02 / D-06

**Analog:** self — `check.test.ts` T3 (`:129-152`) asserts the per-finding DTO shape via
`(result as any).structuredContent.findings[0]` (`:124`, `:136`). Extend: a `pii-ner` finding →
`advisory:true`; a deterministic secret finding → `advisory:false`. Mirror in `redact.test.ts`. See
`tests/mcp/check-redact-ner.test.ts` for the existing NER-in-MCP test that already drives the lane.

---

### `.github/workflows/canary-leak.yml` (MOD — CI) — PIISEC-01

**Analog:** self — the existing double-pass gate (`canary-leak.yml:33-39` vitest assertion +
`:41-62` belt-and-suspenders `grep -F` over `tests/fixtures/positive/*.txt`). Add a PII pass: run
`tests/audit/pii-leak.test.ts` (integration project) AND a second `grep -F` for each PII corpus value
against `.mrclean/audit*.jsonl`. Copy the `set -e` + per-value `grep -F` + `::error::` loop (`:48-62`).

---

### `README.md` (new §PII framing) + `docs/SCOPE-FENCE.md` (MOD — docs) — PIISEC-02 / D-05, D-07

**Analog:** README §10 "What this does NOT defend against" (`README.md:242-260`) — candid, bulleted
"limitations" section; the "Short list:" bullet style is the template. The PII/NER layer is currently
UNMENTIONED in README (verified: §1–§11 have no PII heading), so this is greenfield CONTENT mapped to an
existing STRUCTURE. Place near §8 (MCP tools, which expose NER) or alongside §10. Stance LOCKED per D-07.
`docs/SCOPE-FENCE.md` (Phase 4) must stay consistent — align the secrets=deterministic-guarantee vs
PII/NER=best-effort framing, do not contradict the locked scope fence. Both files are D-08 scan SOURCES.

## Shared Patterns

### Single no-raw chokepoint discipline (D-03 — the core new mechanism)
**Source:** `src/audit/log.ts` `findingToAuditRecord` (`:160-195`, esp. the LOCKED comment `:182-185`).
**Apply to:** new `sanitizeForOutput`, and the four error sinks routing through it —
`src/hook/failclosed.ts`, `src/mcp/supervisor.ts`, `check.ts`/`redact.ts` isError returns,
`src/mcp/server.ts`. ONE sink, not scattered guards. Error paths ONLY — never `detect/`, never the
success branch (D-04 hot-path fence).

### No-raw-value substring leak detection (reuse, do not rebuild)
**Source:** `src/audit/canary-leak.ts` `assertNoCanaryLeak` (`:56-97`).
**Apply to:** `tests/audit/pii-leak.test.ts` (verbatim reuse), the CI grep, and (inverted intent) the
banned-phrase scan in `tests/copy-drift.test.ts`.

### Machine-readable status/flag, never free-form text on PII surfaces
**Source:** `nerStatus: z.enum([...])` (`check.ts:53-59`, "an enum not free-form so it can never carry
matched PII").
**Apply to:** the new `advisory` boolean (both tools) and `sanitizeForOutput`'s context-free static
messages.

### redactedHash, never raw value
**Source:** `redactedHash`/`fingerprint` carried in `findingToAuditRecord` (`log.ts:174-176`); raw
`finding.value` deliberately excluded.
**Apply to:** `sanitizeForOutput` (if hash-substitution variant chosen); all MCP DTO mappers stay
compliant — the new `advisory` flag must remain boolean, never carry text.

### Centralized once-per-output disclaimer copy (D-05/D-07)
**Source pattern:** `src/shared/version.ts` single-const export.
**Apply to:** new `src/shared/strings.ts`, reused by README, `src/doctor/report.ts`,
`src/cli.ts`/`src/hook/banner.ts`, and `tests/copy-drift.test.ts`.

### Double-pass CI leak gate (defense-in-depth)
**Source:** `.github/workflows/canary-leak.yml` (in-test assertion + `grep -F` second pass).
**Apply to:** the new PII leak job.

### Cold-path import fence + ESM `.js` import suffix + 2-arg `it()` (project conventions)
**Source:** `opts.ner` structural gate keeping ML off the hook path (`src/detect/index.ts`); every test
imports `../../src/...js`; Vitest 3-arg `test()` migrated to 2-arg-options in Phase 3.
**Apply to:** `sanitizeForOutput` stays off the hot path (D-04); all new tests follow the import/`it`
conventions.

## No Analog Found

No file is fully analog-less. The two NEW src modules below have no identical-role predecessor but copy
a strong adjacent discipline; the README PII section is greenfield CONTENT mapped to an existing STRUCTURE.

| File | Role | Data Flow | Note |
|------|------|-----------|------|
| `src/audit/sanitize-output.ts` | utility (pure error-scrub fn) | transform | No prior output-scrubbing fn; copies `findingToAuditRecord` single-sink lock + `canary-leak.ts` pure-module shape. Exact illustrative shape in RESEARCH §Code Examples. |
| `src/shared/strings.ts` (optional) | constants | — | No prior centralized-copy module; `src/shared/version.ts` is the exact const-export shape. |

## Metadata

**Analog search scope:** `src/audit/`, `src/mcp/` (supervisor + tools + server), `src/detect/`,
`src/doctor/`, `src/hook/`, `src/shared/`, `src/cli.ts`, `tests/`, `tests/audit/`, `tests/mcp/`,
`.github/workflows/`, `docs/`, `README.md`, `vitest.config.ts`.
**Files scanned (full or targeted):** `src/audit/log.ts`, `src/audit/canary-leak.ts`,
`tests/audit/canary-leak.test.ts`, `tests/fixtures-corpus.test.ts`, `src/mcp/tools/check.ts`,
`src/mcp/tools/redact.ts`, `src/mcp/supervisor.ts`, `src/hook/failclosed.ts`, `src/detect/layer6b-ner.ts`,
`src/detect/index.ts` (ResolvedFinding), `src/detect/findings.ts` (Finding.source), `src/doctor/report.ts`,
`src/doctor/checks.ts`, `src/cli.ts`, `src/mcp/server.ts`, `src/hook/banner.ts`, `vitest.config.ts`,
`.github/workflows/canary-leak.yml`, `README.md` (§8/§10/§11), plus `tests/mcp/` + `docs/` + `src/shared/`
directory listings.
**Pattern extraction date:** 2026-06-03
