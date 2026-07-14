# Phase 7: PII Security Hardening & Honest Framing - Research

**Researched:** 2026-06-03
**Domain:** Defensive output-sanitization (single-chokepoint error/exception scrubbing), leak-grep regression testing, CI copy-drift/banned-phrase enforcement, machine-readable advisory flags in MCP `structuredContent` — all in an existing Node 20 / TS 5.6 / Vitest 4 codebase
**Confidence:** HIGH (every surface read directly from source; no new external dependency; decisions D-01..D-08 are locked)

## Summary

Phase 7 is a **hardening + framing** phase, not a feature phase. It adds zero new detection
capability and zero new external runtime dependencies. The entire phase is built from patterns
the codebase already established: the single-sink no-raw-value discipline of `findingToAuditRecord`
(`src/audit/log.ts`), the substring-grep harness of `assertNoCanaryLeak` (`src/audit/canary-leak.ts`),
the fixture-corpus end-to-end test (`tests/fixtures-corpus.test.ts`), and the enum-not-free-text
`nerStatus` field already present on MCP `structuredContent` (`src/mcp/tools/check.ts` / `redact.ts`).

Two deliverables. **PIISEC-01** = a PII leak-grep regression test (extending the existing corpus +
canary harness with synthetic SSN/email/name/card) that asserts no raw PII value reaches
`.mrclean/audit.jsonl` OR any stderr/error/exception path, including three deliberately-triggered
failure paths (corrupt/missing model, NER inference throw, supervisor catch) — PLUS a single central
`sanitizeForOutput()` chokepoint installed on the error/exception sinks so leaks are *structurally*
impossible, not merely test-caught (defense-in-depth, D-03/D-04). **PIISEC-02** = honest framing:
a once-per-output disclaimer on README/CLI/doctor/MCP that the PII/NER layer is a best-effort ML
recall aid (false negatives CAN leak) — explicitly NOT a guarantee — with a stable machine-readable
`advisory`/`bestEffort` flag on NER findings (D-06) and a banned-phrase CI grep test (D-08) that
fails the build on compliance/guarantee language drift.

**Primary recommendation:** Treat every task as an extension of an existing single-sink/single-harness
pattern, never a new mechanism. The `sanitizeForOutput()` chokepoint is the one genuinely new piece of
runtime code — design it as a pure function that lives on error paths ONLY (D-04: never the < 100 ms
hot path, never the secret-detection gate), taking `(message, detectedSpans)` and returning a scrubbed
string, with a context-free branch that emits a static message when no spans exist (model-load-before-parse).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `sanitizeForOutput()` error chokepoint | Shared Core (`src/audit/` or `src/shared/`) | Hook stderr sink + MCP supervisor | Must be reachable from both surfaces' error paths but live in the process-agnostic core like `findingToAuditRecord`. Error-path-only — never imported into the hot detection path. |
| PII leak-grep regression test | Test tier (`tests/`) | — | Pure verification; runs in the existing `integration` vitest project + canary-leak CI job. No src behavior. |
| Banned-phrase / copy-drift CI grep | Test tier (`tests/`) + CI (`.github/workflows/`) | — | Scans user-facing string SOURCES (README, CLI strings, doctor strings, MCP tool descriptions). Pure static scan, no runtime. |
| `advisory`/`bestEffort` flag on NER findings | API/Backend (MCP server tools) | Shared schema (`zod/v4` output schema in `check.ts`/`redact.ts`) | The flag surfaces wherever NER findings appear programmatically — belongs in the MCP `structuredContent` output schema, next to the existing `nerStatus` enum. |
| Disclaimer copy (README/doctor/CLI banner) | Docs + CLI/Frontend-equivalent | — | User-facing prose; once-per-output (D-05). README is the static doc tier; doctor/CLI emit at runtime to stderr/stdout. |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Leak-grep regression test (PIISEC-01)**
- **D-01:** Build a dedicated PII leak corpus — distinct, easy-to-grep synthetic values (test SSN,
  email, person name, credit-card number) chosen so a grep for each raw string is unambiguous. Fed
  through the full pipeline; assert none appear in `audit.jsonl` OR stderr. Reuse the existing
  `tests/audit/canary-leak.test.ts` harness rather than inventing a new one.
- **D-02:** Cover a representative set of deliberately-triggered failure paths, not every catch block.
  Required forced-failures: corrupt/missing model, NER inference throw, supervisor catch.

**Structural guard — error-sanitization chokepoint (PIISEC-01)**
- **D-03:** Go beyond test-only: add ONE central `sanitizeForOutput()` chokepoint applied at the
  stderr/error sink and exception formatting, scrubbing anything matching detected spans before it is
  written. Single chokepoint — not scattered guards.
- **D-04 (constraint for planner):** Exception paths that fire WITHOUT a detection context (e.g.
  model-load failure before any PII is parsed) have no spans to scrub — the chokepoint must additionally
  ensure error messages from those paths NEVER echo raw input text (emit structured/static messages,
  not the offending payload). The chokepoint lives on error paths only — it must NOT touch the < 100 ms
  hook hot path or the secret-detection gate.

**Honest-framing surfacing (PIISEC-02)**
- **D-05:** Disclaimer surfaces on all surfaces, once per output: README PII section + one-line
  `mrclean doctor` note + CLI/banner line. Disclaimer appears ONCE per output, NOT per finding.
- **D-06:** Add a stable machine-readable flag (e.g. `advisory` / `bestEffort: true`) on NER findings in
  MCP `check`/`redact` `structuredContent`, so the best-effort asterisk is present wherever NER findings
  surface programmatically — satisfying SC-3 without per-finding visual repetition.
- **D-07:** Framing content stance (locked): "best-effort ML PII hint, not a guarantee"; NER false
  negatives can leak; `words.txt` + deterministic layers (secrets + checksum'd PII) are the real
  must-not-leak mechanism; secrets remain the deterministic guarantee. No language drifting toward
  "redacts all PII" or compliance claims.

**Banned-phrase enforcement (PIISEC-02)**
- **D-08:** Add a CI grep test that fails the build if user-facing strings (README PII section, CLI
  output, doctor output, MCP tool descriptions) contain compliance/guarantee language — e.g.
  "redacts all PII", "compliant", "guarantee(s)", "GDPR", "HIPAA". (Planner: define the banned-phrase
  list + which string sources are scanned.)

### Claude's Discretion
- Exact `sanitizeForOutput()` signature, location, and how detected spans are threaded to it.
- Precise synthetic PII corpus values (must be obviously fake yet realistic-shaped).
- Exact wording of the README PII section, doctor note, and CLI/banner disclaimer line — draft per
  D-07 stance; user reviews.
- Exact banned-phrase regex list and the set of string sources the CI test scans.
- Response-field name/shape for the `advisory`/`bestEffort` flag in structuredContent.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. Reversible PII placeholders, additional model tiers,
cloud PII APIs, unredact tool, and Presidio sidecar remain explicitly out of scope per the locked
Phase 4 scope fence. **This phase HARDENS and FRAMES the existing surface — it does not extend
detection.**

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PIISEC-01 | A leak-grep test asserts no raw PII value appears in audit logs or error/diagnostic output paths | Reuse `assertNoCanaryLeak` substring grep (`src/audit/canary-leak.ts`) + `tests/fixtures-corpus.test.ts` structure; extend with PII corpus + three forced-failure paths (D-02). Add `sanitizeForOutput()` chokepoint on the four real error sinks (`failclosed.ts writeFailClosedError`, `supervisor.ts supervisedToolCall`, MCP tool `isError` returns, `mcp/server.ts` stderr writes). See §Architecture Patterns 1–3, §Code Examples. |
| PIISEC-02 | User-facing copy frames the PII/NER layer as a best-effort recall aid, explicitly NOT a guarantee — secrets remain the deterministic guarantee | Add `advisory: true` to the `findingSchema` for `source==='pii-ner'` findings in `check.ts`/`redact.ts` output schemas (zod/v4). Add once-per-output disclaimer to README §new PII section, doctor report, CLI/MCP banner. Add banned-phrase CI grep over user-facing string sources. See §Architecture Patterns 4–5, §Code Examples. |

## Standard Stack

**No new external runtime or dev dependency is required for this phase.** Every capability is built
from libraries already present and locked in `package.json`. This is the correct outcome for a
hardening/framing phase and aligns with the project's minimal-supply-chain stance for a security tool.

### Core (already installed — reuse, do not add)
| Library | Version (installed) | Purpose in this phase | Why standard |
|---------|--------------------|----------------------|--------------|
| `vitest` | `^4.1.6` | Leak-grep regression test + banned-phrase test runner | Already the project test runner; `integration` project owns the dist/ build globalSetup. `[VERIFIED: package.json]` |
| `zod` (via `zod/v4`) | `^4.4.3` | Extend MCP `findingSchema`/output schema with the `advisory` flag | MCP SDK tool registration already uses `zod/v4` output schemas in `check.ts`/`redact.ts`. `[VERIFIED: package.json + src]` |
| `@modelcontextprotocol/sdk` | `^1.29.0` | `structuredContent` carries the `advisory` flag to MCP callers | Already wired; `nerStatus` enum is the existing precedent for a machine-readable status field. `[VERIFIED: package.json + src]` |
| `node:fs/promises` (`readFile`/`appendFile`) | built-in | Leak-grep reads `audit.jsonl`; banned-phrase test reads README/source | Already used by `canary-leak.ts` and `log.ts`. `[VERIFIED: src]` |
| `node:test`-free — use `vitest` `describe/it` | — | Test structure | Project standard. `[VERIFIED: src]` |

### Supporting (already installed)
| Library | Version | Purpose | When to use |
|---------|---------|---------|-------------|
| `picocolors` | `^1.1.1` | Color the doctor disclaimer line / leak-test failure output | Already the project's terminal-color lib (`src/doctor/report.ts`). `[VERIFIED: src]` |
| `commander` | `^13.1.0` | (No change needed) CLI banner/disclaimer is emitted via existing subcommand stderr writes | Already wired in `src/cli.ts`. `[VERIFIED: src]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vitest-based banned-phrase test | A standalone shell grep step in CI only | Vitest keeps it runnable locally (`npm test`) and inside coverage gating; a CI-only shell step is invisible to devs pre-push. **Recommendation: do BOTH** — a Vitest test for local signal + a belt-and-suspenders CI grep, mirroring the existing canary-leak.yml double-pass (test assertion + defense-in-depth `grep -F`). |
| `sanitizeForOutput()` as a shared-core pure fn | Scattered inline scrubbing at each sink | D-03 explicitly locks single-chokepoint. Scattered guards drift and miss new sinks. |
| New synthetic corpus file under `tests/fixtures/pii/` | Inline string constants in the test | Inline constants (like `ALL_FIXTURE_VALUES` in `fixtures-corpus.test.ts`) are simpler and keep the grep canaries co-located with the assertion. Either is acceptable; inline matches the existing secrets pattern. |

**Installation:** None. (No `npm install` for this phase.)

## Package Legitimacy Audit

> Not applicable — this phase installs **no external packages**. All capabilities use already-locked
> dependencies (`vitest`, `zod`, `@modelcontextprotocol/sdk`) and Node built-ins. slopcheck/registry
> verification is unnecessary because the dependency set does not change.

**Packages removed due to slopcheck [SLOP] verdict:** none (no packages added).
**Packages flagged as suspicious [SUS]:** none (no packages added).

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────── USER-FACING SURFACES (PIISEC-02) ───────────────────┐
                         │                                                                          │
  README.md (NEW PII §) ─┤  D-05 disclaimer (once per output)        D-08 banned-phrase CI grep ───┼─► FAIL build on
  CLI/MCP banner ────────┤  "best-effort ML hint, NOT a guarantee"   scans these SOURCES ──────────┘   compliance/guarantee
  mrclean doctor note ───┤                                                                              language
  MCP tool descriptions ─┘
                         │
  MCP check/redact ──────┴─► structuredContent.findings[].advisory:true   ◄── D-06 (zod/v4 schema, per pii-ner finding)
                                                                                emitted ONCE per finding, not per char

  ┌──────────────────────────── DETECTION (UNCHANGED — read only) ────────────────────────────┐
  │  text ─► L1..L4 ─► L6a regex-PII ─► [MCP only] L6b NER ─► findings[] {value, span, source}  │
  └───────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ findings (carry value+span)
            ┌──────────────────────────────────┼───────────────────────────────────────────┐
            │                                   ▼                                            │
            │   ERROR / EXCEPTION SINKS  ─────► sanitizeForOutput(message, detectedSpans) ───┤  D-03/D-04
            │   • failclosed.writeFailClosedError (hook stderr)        │                     │  (error paths ONLY —
            │   • supervisor.supervisedToolCall {ok:false,error}       │ scrub spans         │   NEVER hot path,
            │   • check/redact isError text returns                    │ OR static msg if    │   NEVER secret gate)
            │   • mcp/server.ts stderr writes                          │ no span context     │
            └─────────────────────────────────────────────────────────┴─────────────────────┘
                                               │ scrubbed output
                                               ▼
                              stderr / error transcript / audit.jsonl
                                               ▲
            ┌──────────────────────────────────┴───────────────────────────────────────────┐
            │  PII LEAK-GREP REGRESSION TEST (PIISEC-01)                                      │
            │  feed PII corpus ─► run full pipeline + 3 forced failures (D-02) ─►             │
            │  assertNoCanaryLeak(audit.jsonl, piiCorpus) AND grep(captured stderr, corpus)  │
            └────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
src/
├── audit/
│   ├── log.ts                  # UNCHANGED — already excludes finding.value (single sink precedent)
│   ├── canary-leak.ts          # UNCHANGED — reuse assertNoCanaryLeak as-is (substring grep)
│   └── sanitize-output.ts      # NEW — sanitizeForOutput() single chokepoint (error-path only)
├── hook/
│   └── failclosed.ts           # MODIFIED — route writeFailClosedError message through sanitizeForOutput
├── mcp/
│   ├── supervisor.ts           # MODIFIED — route supervisedToolCall error string through chokepoint
│   ├── server.ts               # MODIFIED — route stderr writes through chokepoint (where they can carry input)
│   └── tools/
│       ├── check.ts            # MODIFIED — add `advisory` to findingSchema for pii-ner; isError via chokepoint
│       └── redact.ts           # MODIFIED — same
├── doctor/
│   ├── report.ts               # MODIFIED — emit once-per-output D-05 disclaimer line
│   └── checks.ts               # (optional) — disclaimer note alongside model-cache check
└── shared/
    └── strings.ts              # (optional) — centralize disclaimer text + banned-phrase list as exports

tests/
├── audit/
│   └── pii-leak.test.ts        # NEW — PIISEC-01 leak-grep + 3 forced-failure paths (D-01/D-02)
├── copy-drift.test.ts          # NEW — PIISEC-02 banned-phrase scan over user-facing sources (D-08)
└── fixtures/pii/               # (optional) NEW — synthetic PII corpus files (or inline in pii-leak.test.ts)

.github/workflows/
└── canary-leak.yml             # MODIFIED — add PII leak-test job + belt-and-suspenders PII grep pass

README.md                       # MODIFIED — NEW PII/NER framing section (currently UNMENTIONED)
```

### Pattern 1: Single-chokepoint output sanitization (mirror `findingToAuditRecord`)

**What:** ONE pure function `sanitizeForOutput(message, detectedSpans)` that every error/exception sink
routes through before writing to stderr/transcript. Mirrors the locked single-sink discipline of
`findingToAuditRecord` (the ONLY Finding→AuditRecord converter, which excludes `finding.value`).

**When to use:** At every error path that could embed user input or a detected value — and ONLY error
paths (D-04: never the hot path, never the secret gate).

**The two real error-sink categories (from source):**
1. **Context-bearing** — an error fired AFTER detection ran, so detected spans/values exist to scrub.
   (e.g., a tool handler throws after `runDetection` produced findings.) → scrub by replacing each
   detected value with a placeholder/`<redacted>`.
2. **Context-free** — an error fired BEFORE any detection (model-load failure, JSON.parse failure on
   raw stdin). No spans exist. → D-04 mandate: emit a STATIC structured message, NEVER echo the raw
   input/payload. `writeFailClosedError` currently includes `message` and `err.stack` — these must not
   carry the offending payload text.

**Example:** see §Code Examples → `sanitizeForOutput`.

### Pattern 2: Leak-grep regression as a corpus + substring-grep extension

**What:** Extend the proven `tests/fixtures-corpus.test.ts` shape — feed a corpus through `runDetection`,
then call `assertNoCanaryLeak(auditPath, corpus)`. For PII, add a captured-stderr grep too (the existing
secrets test only greps `audit.jsonl`; PIISEC-01 additionally requires stderr/error-path coverage).

**When to use:** Always for must-not-leak guarantees. The substring (not exact-match) check in
`assertNoCanaryLeak` already catches partial/encoded leaks and treats malformed lines as suspect.

**Capturing stderr in Vitest:** spy on `process.stderr.write` (e.g. `vi.spyOn(process.stderr, 'write')`)
or invoke the hook/MCP path as a child process and capture its `stderr` stream, then grep the captured
buffer for each corpus value. Child-process capture is the more faithful end-to-end signal for the hook
(which calls `process.exit`); a `process.stderr.write` spy is lighter for unit-level chokepoint tests.

### Pattern 3: Forced-failure injection for the three required paths (D-02)

**What:** Deliberately trigger the three real PII-carrying error paths and assert no raw PII leaks:
1. **Corrupt/missing model** — `getNerPipeline` throws → `runLayer6bNer` catch boundary 1 returns
   `{ findings: [], status: 'unavailable' }` (already implemented in `layer6b-ner.ts`). Verify no input
   text reaches stderr on this path.
2. **NER inference throw** — `pipe(text)` throws → catch boundary 2, same return. Inject by mocking the
   singleton to return a `pipe` that throws.
3. **Supervisor catch** — `supervisedToolCall` returns `{ ok: false, error: message }`; the tool then
   returns `isError: true` with `mrclean_check error: ${outcome.error}`. Inject by making the wrapped
   `fn` throw an error whose message contains a corpus PII value, then assert the surfaced text is scrubbed.

**When to use:** Representative coverage (D-02), NOT exhaustive per-catch enumeration.

### Pattern 4: Machine-readable advisory flag in `structuredContent` (mirror `nerStatus`)

**What:** Add a stable `advisory: true` (or `bestEffort: true`) boolean to the per-finding DTO in
`check.ts`/`redact.ts` output schemas, set true only for `source === 'pii-ner'` findings. This mirrors
the existing `nerStatus` enum precedent: a machine-readable, non-free-text field that can never carry
matched PII. Emit ONCE per finding (D-06) — not per character, not a repeated visual asterisk.

**When to use:** Wherever NER findings surface programmatically (MCP `structuredContent`). The
deterministic secret/regex-PII findings do NOT get the flag — only NER (the probabilistic lane).

**Schema-shape note:** the current `findingSchema` (in both tools) deliberately omits `source`. To set
`advisory` per-finding, the mapper `toFindingDTO` needs the finding's `source` at map time (it has the
`ResolvedFinding`, which carries `source`). Add `advisory: f.source === 'pii-ner'` in the mapper and a
`advisory: z.boolean()` (or `.optional()`) field in `findingSchema`. Decide whether to set the flag only
when true or always emit the boolean — recommend always-emit-boolean for a stable, predictable schema.

### Pattern 5: Once-per-output disclaimer + centralized copy source

**What:** A single exported disclaimer string (D-07 stance) reused across README (static), doctor report
(runtime stdout), and the CLI/MCP banner (runtime stderr). Emitted ONCE per output (D-05), never per
finding. Centralizing the text in one module (`src/shared/strings.ts`) makes the banned-phrase test and
human review trivial and prevents copy drift across surfaces.

**When to use:** Any time the same user-facing claim must appear on multiple surfaces consistently.

### Anti-Patterns to Avoid
- **Putting `sanitizeForOutput()` on the hot path or secret gate** — D-04 forbids it; would risk the
  < 100 ms / < 200 ms budget and could weaken the deterministic gate. Error paths ONLY.
- **Echoing raw input on context-free failures** — `writeFailClosedError` must not surface the offending
  stdin payload or a stack frame containing it (D-04). Static structured messages only.
- **Per-finding visual disclaimer repetition** — D-05/D-06 explicitly: once per output / one flag per
  finding, never an asterisk on every entity (noise on prose with many names).
- **Scrubbing by re-running detection inside the error path** — would couple the error path to the
  detector and risk re-entrancy; scrub against the ALREADY-detected spans passed in, or emit static.
- **Compliance/guarantee language anywhere in user copy** — D-07/D-08. The banned-phrase test is the
  enforcement, but authors must write to the stance from the start.
- **Adding a new audit field that could carry raw text** — `findingToAuditRecord` is LOCKED; the
  `advisory` flag belongs in MCP `structuredContent`, NOT in `AuditRecord`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Substring leak detection in JSONL | A new grep/parse loop | `assertNoCanaryLeak` (`src/audit/canary-leak.ts`) | Already handles ENOENT (clean), malformed-line-as-suspect, key-order-normalized `JSON.stringify` substring match. `[VERIFIED: src]` |
| Feed-corpus-through-pipeline harness | A bespoke test scaffold | `tests/fixtures-corpus.test.ts` structure (tmpdir + `initSessionState` + `runDetection` + line-count guard + canary check) | Proven; the line-count guard prevents vacuous passes on a silently-empty log. `[VERIFIED: src]` |
| No-raw-value audit guarantee | New audit sink for PII | `findingToAuditRecord` (already excludes `value`; destructure-picks only safe provenance keys) | PII inherits the guarantee for free — the test just proves it end-to-end. `[VERIFIED: src]` |
| Machine-readable status field in MCP output | A free-text status string | The `nerStatus` enum precedent — add `advisory` as a typed `zod/v4` boolean | Free text can carry PII; typed boolean/enum cannot. `[VERIFIED: src]` |
| Double-pass CI leak gate | A single brittle assertion | The `canary-leak.yml` pattern: in-test assertion + belt-and-suspenders `grep -F` step | Catches future test-bugs where the in-test assertion is silenced/skipped. `[VERIFIED: src]` |

**Key insight:** This phase's value is *applying existing single-sink/single-harness discipline to the
PII surface and the error paths*, not inventing mechanisms. The only net-new runtime code is one pure
function (`sanitizeForOutput`).

## Common Pitfalls

### Pitfall 1: Stderr leak path is wider than the audit log
**What goes wrong:** The existing secrets canary test greps `audit.jsonl` only. A PII value can still
leak via `writeFailClosedError` (`err.message`/`err.stack`), `supervisedToolCall` error strings, MCP
`isError` text (`mrclean_check error: ${outcome.error}`), or `mcp/server.ts` stderr writes — none of
which the current test covers.
**Why it happens:** Error messages frequently interpolate the offending value or stack frames.
**How to avoid:** PIISEC-01 must capture stderr (spy or child-process) and grep it for the corpus, AND
the `sanitizeForOutput()` chokepoint must wrap all four sinks (D-03).
**Warning signs:** Any `error: ${...}` / `${err.message}` template literal in an error path.

### Pitfall 2: Context-free failures have no spans — scrubbing silently no-ops
**What goes wrong:** A model-load failure or `JSON.parse(rawStdin)` failure fires before any detection,
so `detectedSpans` is empty; a naive `sanitizeForOutput` that only replaces known spans would pass the
raw payload straight through.
**Why it happens:** The chokepoint is span-driven, but these paths have no span context (D-04).
**How to avoid:** The chokepoint needs an explicit context-free branch that returns a STATIC structured
message and NEVER includes the raw input/stack. `writeFailClosedError` must be reworked so its
`message`/`stack`/`reason` fields cannot carry the payload on parse/stdin paths.
**Warning signs:** `writeFailClosedError(err, { phase: 'parse' })` currently passes `err.message` and
`err.stack` — a parse error message can include a snippet of the malformed input.

### Pitfall 3: Putting the flag/scrub on the wrong tier and breaking perf or the gate
**What goes wrong:** Importing `sanitizeForOutput` into the detection hot path, or making the secret gate
depend on it, risks the latency budget and could let a sanitizer bug weaken the deterministic gate.
**Why it happens:** Convenience — one helper called everywhere.
**How to avoid:** D-04 — error paths ONLY. The hot path's success route never calls it. Add a comment +
(optionally) a PERF-style lint/grep guard like the existing `PERF-03` annotations.
**Warning signs:** A `sanitizeForOutput` import inside `detect/` or in a non-error branch.

### Pitfall 4: `advisory` flag added without `source` reaching the DTO mapper
**What goes wrong:** `findingSchema` deliberately omits `source`; if the mapper doesn't read `source`,
the flag can't be set correctly (or gets set on every finding, mislabeling deterministic findings).
**Why it happens:** The DTO was designed to hide `source`/`span`/`value`.
**How to avoid:** Set `advisory: f.source === 'pii-ner'` inside `toFindingDTO` (it receives the full
`ResolvedFinding`, which has `source`). Keep `source` out of the schema; only the derived boolean ships.
**Warning signs:** Deterministic secret findings showing `advisory: true`.

### Pitfall 5: Banned-phrase test false-positives on legitimate negated copy
**What goes wrong:** The honest-framing copy itself may contain "guarantee" in a negation ("this is NOT
a guarantee") — a naive substring ban would flag the very disclaimer it's protecting.
**Why it happens:** Banned terms appear in both the bad claim and its honest negation.
**How to avoid:** Scope the banned-phrase regexes to the *claim* shapes ("redacts all PII", "GDPR
compliant", "guarantees that") and allow the negated disclaimer forms; OR maintain an explicit
allowlist for the sanctioned disclaimer line. Test the test against the actual disclaimer copy.
**Warning signs:** The disclaimer line tripping the banned-phrase gate.

### Pitfall 6: NER provenance fields in `AuditRecord` are non-deterministic across env
**What goes wrong:** (Inherited from Phase 6.) Audit reproducibility requires `engine`/`model_rev`/
`quant`/`backend` — but these must carry model identity only, never matched text. A blind spread of a
`provenance` object that is structurally an over-shaped `Finding` would serialize raw text.
**Why it happens:** TS structural typing lets an over-shaped object satisfy the param type.
**How to avoid:** Already mitigated — `findingToAuditRecord` destructure-picks only the four keys. The
PII leak test should assert this still holds for NER findings (corpus includes a NER-detected name).
**Warning signs:** Any `...provenance` blind spread reintroduced into `log.ts`.

## Runtime State Inventory

> This phase adds NO stored data, registers NO OS state, and changes NO secrets/env-var names. It is a
> code + test + docs change. The inventory below is included because the phase touches the audit log and
> error sinks; all categories verified.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `.mrclean/audit.jsonl` is WRITTEN by detection but this phase only READS it (leak grep) and asserts the no-raw rule holds for PII. No schema change to written records (the `advisory` flag goes in MCP `structuredContent`, NOT `AuditRecord`). | None — read-only verification |
| Live service config | None — no external service config touched. | None |
| OS-registered state | None — no Task Scheduler/launchd/pm2/systemd registration. | None |
| Secrets/env vars | `MRCLEAN_TEST_FAKE_CLAUDE_VERSION` test escape hatch exists (doctor); no new env var. No secret key names referenced or renamed. | None |
| Build artifacts | New test files run via the `integration` vitest project (owns `tsup --clean` globalSetup); a new src file (`sanitize-output.ts`) is bundled by `tsup` automatically. No stale-artifact risk — no rename. | None — `npm run build` picks up new src |

**Nothing found in Live service config / OS-registered state / Secrets:** verified by source read —
this phase is pure code/test/docs with read-only audit-log access.

## Code Examples

### `sanitizeForOutput()` — single chokepoint (NEW, error-path only)
```typescript
// src/audit/sanitize-output.ts  (illustrative shape — exact signature is Claude's discretion, D-03)
//
// Pure function. NO I/O. Called ONLY from error/exception sinks (D-04: never the hot path,
// never the secret gate). Two modes:
//   1) context-bearing: scrub any detected value out of the message
//   2) context-free:    no spans → return a STATIC structured message, never echo raw input

export interface DetectedSpanValue {
  /** The raw matched value to scrub from output (from an already-produced Finding). */
  value: string
}

/**
 * Scrub detected PII/secret values from an error/diagnostic message before it is written.
 *
 * @param message       - The candidate error/diagnostic text.
 * @param detectedSpans - Values already detected in THIS request (empty for pre-detection failures).
 * @param fallback      - Static message to emit when there is no detection context (D-04 context-free).
 */
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
    out = out.split(value).join('<redacted>')   // simple, ReDoS-free literal replace
  }
  return out
}
```

### Routing the supervisor error string through the chokepoint (MODIFIED)
```typescript
// src/mcp/supervisor.ts — error string scrubbed before it can reach a tool's isError text.
// detectedSpans is threaded from the surrounding tool call's findings (context-bearing case).
} catch (err) {
  const raw = err instanceof Error ? err.message : String(err)
  // For a supervisor catch we typically have NO detection context (the throw aborted detection),
  // so pass [] → static fallback (D-04). When the caller DOES have findings, it scrubs at its sink.
  return { ok: false, error: sanitizeForOutput(raw, [] ) }
}
```

### PII leak-grep test — corpus + audit + stderr + forced failures (NEW, PIISEC-01)
```typescript
// tests/audit/pii-leak.test.ts (illustrative)
import { describe, it, expect, vi } from 'vitest'
import { assertNoCanaryLeak } from '../../src/audit/canary-leak.js'

// D-01: obviously-fake yet realistic-shaped, unambiguous to grep
const PII_CORPUS = {
  ssn:   '000-12-3456',                  // invalid-by-construction SSN shape
  email: 'leak-canary@example.invalid',
  name:  'Zzyzx Quibblefax',             // implausible name → unambiguous grep
  card:  '4000 0000 0000 0002',          // Luhn-shaped test card
} as const
const ALL = Object.values(PII_CORPUS)

it('no raw PII reaches audit.jsonl after full-pipeline run', async () => {
  // ... feed each corpus value through runDetection({ ner: true }) into a tmp .mrclean/ ...
  const result = await assertNoCanaryLeak(auditPath, ALL)
  expect(result.ok, JSON.stringify(result.leaked)).toBe(true)
})

it('no raw PII reaches stderr on the supervisor-catch failure path (D-02)', async () => {
  const writes: string[] = []
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s: any) => { writes.push(String(s)); return true })
  // force supervisedToolCall to catch an error whose message embeds a corpus value
  // ... invoke the tool path that throws ...
  spy.mockRestore()
  for (const v of ALL) expect(writes.join('')).not.toContain(v)
})

// + analogous tests for: corrupt/missing model (getNerPipeline throws),
//   NER inference throw (pipe(text) throws) — both already fail closed in layer6b-ner.ts;
//   assert their stderr/status output carries no corpus value.
```

### `advisory` flag on NER findings in MCP structuredContent (MODIFIED, PIISEC-02 / D-06)
```typescript
// src/mcp/tools/check.ts (and redact.ts) — findingSchema + mapper
const findingSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  placeholder: z.string(),
  redactedHash: z.string(),
  fingerprint: z.string(),
  // D-06: stable machine-readable best-effort flag. True ONLY for the probabilistic NER lane.
  advisory: z.boolean(),
})

function toFindingDTO(f: ResolvedFinding): z.infer<typeof findingSchema> {
  return {
    ruleId: f.ruleId,
    severity: f.severity,
    placeholder: f.placeholder,
    redactedHash: f.redactedHash,
    fingerprint: f.fingerprint,
    advisory: f.source === 'pii-ner',   // ResolvedFinding carries `source`; schema still hides it
  }
}
```

### Banned-phrase CI grep test (NEW, PIISEC-02 / D-08)
```typescript
// tests/copy-drift.test.ts (illustrative — exact list + sources are Claude's discretion)
import { readFileSync } from 'node:fs'

// Scan user-facing SOURCES (D-08). MCP tool descriptions live in check.ts/redact.ts registerTool().
const SOURCES = ['README.md', 'src/cli.ts', 'src/doctor/report.ts',
                 'src/mcp/tools/check.ts', 'src/mcp/tools/redact.ts', 'src/shared/strings.ts']

// Claim-shaped bans (avoid Pitfall 5: do not ban bare "guarantee" — ban the CLAIM).
const BANNED = [
  /redacts? all PII/i,
  /\b(GDPR|HIPAA|CCPA)\b[^.]*compliant/i,
  /\bfully compliant\b/i,
  /\bguarantees? (that )?(all|every) /i,
]

it('no compliance/guarantee overclaim in user-facing copy', () => {
  for (const src of SOURCES) {
    const text = readFileSync(src, 'utf8')
    for (const re of BANNED) {
      expect(re.test(text), `Banned overclaim "${re}" found in ${src}`).toBe(false)
    }
  }
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Leak guarantee proven by audit-log grep only | Audit-log grep + error/stderr-path grep + structural chokepoint | This phase (PIISEC-01, D-03) | Closes the error-message leak vector a security tool is judged on |
| Implicit "it redacts PII" framing risk | Explicit, enforced "best-effort recall aid, not a guarantee" + CI ban on overclaims | This phase (PIISEC-02, D-07/D-08) | Trust framing becomes machine-enforced, not just authorial intent |
| NER findings indistinguishable from deterministic in MCP output | `advisory: true` boolean per NER finding | This phase (D-06) | Programmatic consumers can treat NER as probabilistic |

**Deprecated/outdated:**
- None relevant. Vitest 3-arg `test(name, fn, opts)` was already migrated to `test(name, opts, fn)`
  in Phase 3 (STATE.md) — new tests must use the 2-arg-options form.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ResolvedFinding` carries a `source` field readable inside `toFindingDTO` | Pattern 4 / Code Examples | If absent, the mapper needs `source` threaded in another way; LOW risk — `layer6b-ner.ts` sets `source:'pii-ner'` on every finding and the DTO mapper receives the resolved finding. Planner should confirm `ResolvedFinding` type in `src/detect/index.ts`. `[ASSUMED]` |
| A2 | Capturing stderr via `vi.spyOn(process.stderr,'write')` is sufficient for the chokepoint unit tests; child-process capture is needed only for the full hook path (which calls `process.exit`) | Pattern 2 / Pitfall 1 | If the hook spawns and exits before a spy can observe, child-process capture is required for those cases. MEDIUM — affects test design, not the guarantee. `[ASSUMED]` |
| A3 | No banned-phrase scanning library is needed — a Vitest regex test + CI `grep` belt-and-suspenders is the project-consistent approach | Standard Stack / Alternatives | None material; matches existing `canary-leak.yml` double-pass. `[ASSUMED]` |

**Note:** Decisions D-01..D-08 are LOCKED (CONTEXT.md), not assumptions. The above are
implementation-detail assumptions the planner should confirm against current source during planning.

## Open Questions (RESOLVED)

1. **Exact set of stderr sinks the chokepoint must wrap**
   - What we know: four real PII-carrying error sinks identified in source — `failclosed.writeFailClosedError`,
     `supervisor.supervisedToolCall`, MCP tool `isError` returns (`check.ts`/`redact.ts`), and
     `mcp/server.ts` stderr writes (`server.ts:67`, `:137`).
   - What's unclear: whether `mcp/lifecycle.ts` shutdown-signal stderr writes (`lifecycle.ts:20/:26`)
     can ever carry input text (they currently carry only signal names / shutdown errors).
   - Recommendation: wrap the four confirmed sinks; assess lifecycle writes — likely no input context,
     so static messages already satisfy D-04. Planner enumerates the final sink list as a task.
   - RESOLVED by 07-01 Task 2: the chokepoint wraps `supervisor.supervisedToolCall` (catch boundary) and
     `failclosed.writeFailClosedError` (stderr JSON writer, raw `stack` echo dropped); the MCP `isError`
     returns in `check.ts`/`redact.ts` are routed in 07-03 Task 4. `mcp/lifecycle.ts:20/:26` shutdown-signal
     writes were assessed as static / no input-text interpolation (they carry only signal names + shutdown
     errors), so they already satisfy D-04 and are intentionally NOT wrapped — documented as the final sink list.

2. **Whether `advisory` is always-emitted or only-when-true**
   - What we know: D-06 wants a stable flag; the schema currently has no optional fields on findings.
   - What's unclear: stable-shape (always `advisory: boolean`) vs. minimal (`advisory?: true`).
   - Recommendation: always-emit `advisory: z.boolean()` for a predictable schema; deterministic
     findings get `false`. (Claude's discretion per CONTEXT — recommend always-emit.)
   - RESOLVED by 07-02 Task 1: always-emitted. The field ships as `bestEffort: z.boolean()` (renamed from the
     research-era `advisory` placeholder) on every finding DTO — `true` for `source === 'pii-ner'`, `false`
     for every deterministic lane — giving the stable, predictable schema shape.

3. **Disclaimer copy wording (D-07 stance)**
   - What we know: stance is locked; exact wording is Claude's discretion, user reviews.
   - Recommendation: draft one disclaimer string in `src/shared/strings.ts`, reuse across surfaces;
     gate it behind the banned-phrase test (Pitfall 5) and stage as a `checkpoint:human-review` for copy.
   - RESOLVED by 07-03: a single `PII_BEST_EFFORT_DISCLAIMER` const in `src/shared/strings.ts` is drafted
     (Task 1), gated by the copy-drift banned-phrase test (Task 3, Pitfall 5 self-check), and the exact
     wording is staged behind the 07-03 Task 5 `checkpoint:human-verify` copy-review sign-off (D-07).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All (test + build) | ✓ | `>=20.18.0` (project floor) | — |
| Vitest | Leak-grep + banned-phrase tests | ✓ | `^4.1.6` (installed) | — |
| `grep -F` (CI bash) | Belt-and-suspenders CI leak pass | ✓ (ubuntu-latest runner) | GNU grep | The in-test assertion alone is the primary gate |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none — the NER model is NOT required at test time. The forced
"corrupt/missing model" path (D-02) is exercised by *mocking* `getNerPipeline` to throw, so the test
runs without downloading the ~108 MB model. This keeps the leak test in the fast `integration` project
and the CI canary-leak job model-free.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.6` (+ `@vitest/coverage-v8`) |
| Config file | `vitest.config.ts` (unit + integration projects; integration owns `tsup --clean` globalSetup) |
| Quick run command | `npx vitest run tests/audit/pii-leak.test.ts tests/copy-drift.test.ts` |
| Full suite command | `npm test` (`vitest run`) — full suite green before `/gsd:verify-work` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIISEC-01 | No raw PII in `audit.jsonl` after full-pipeline run (incl. NER) | integration | `npx vitest run --project=integration tests/audit/pii-leak.test.ts -t "audit.jsonl"` | ❌ Wave 0 |
| PIISEC-01 | No raw PII in stderr on supervisor-catch path | unit | `npx vitest run tests/audit/pii-leak.test.ts -t "supervisor-catch"` | ❌ Wave 0 |
| PIISEC-01 | No raw PII in stderr on corrupt/missing model path | unit | `npx vitest run tests/audit/pii-leak.test.ts -t "model"` | ❌ Wave 0 |
| PIISEC-01 | No raw PII in stderr on NER inference-throw path | unit | `npx vitest run tests/audit/pii-leak.test.ts -t "inference"` | ❌ Wave 0 |
| PIISEC-01 | `sanitizeForOutput` scrubs detected spans; emits static msg with no spans (D-04) | unit | `npx vitest run tests/audit/sanitize-output.test.ts` | ❌ Wave 0 |
| PIISEC-02 | NER findings carry `advisory:true` in MCP `structuredContent`; deterministic carry `false` | unit | `npx vitest run tests/mcp/check.test.ts tests/mcp/redact.test.ts -t "advisory"` | ⚠️ extend existing |
| PIISEC-02 | No compliance/guarantee overclaim in user-facing sources (D-08) | unit | `npx vitest run tests/copy-drift.test.ts` | ❌ Wave 0 |
| PIISEC-02 | Disclaimer present once in README PII §, doctor output, banner (D-05) | unit | `npx vitest run tests/copy-drift.test.ts -t "disclaimer present"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/audit/pii-leak.test.ts tests/copy-drift.test.ts`
- **Per wave merge:** `npm test` (full suite) + `npm run typecheck`
- **Phase gate:** Full suite + coverage thresholds (80/80/75/70) green; `canary-leak.yml` (extended with
  the PII job) green; `npm run build` clean — before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/audit/sanitize-output.ts` — the single chokepoint (covers PIISEC-01 D-03/D-04)
- [ ] `tests/audit/sanitize-output.test.ts` — chokepoint unit tests (span-scrub + context-free static)
- [ ] `tests/audit/pii-leak.test.ts` — leak-grep + 3 forced-failure paths (PIISEC-01, D-01/D-02)
- [ ] `tests/copy-drift.test.ts` — banned-phrase + disclaimer-presence (PIISEC-02, D-05/D-08)
- [ ] (optional) `src/shared/strings.ts` — centralized disclaimer text + banned-phrase list
- [ ] (optional) `tests/fixtures/pii/*` — synthetic PII corpus files (or inline in pii-leak.test.ts)
- [ ] Extend `tests/mcp/check.test.ts` + `tests/mcp/redact.test.ts` — assert `advisory` flag (D-06)
- [ ] Extend `.github/workflows/canary-leak.yml` — add PII leak-test job + belt-and-suspenders PII grep

*Framework already present — no install needed.*

## Security Domain

> `security_enforcement` is not explicitly `false` in config (treated as enabled). This phase IS a
> security hardening phase, so this section is central, not incidental.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface in mrclean |
| V3 Session Management | no | Session IDs are placeholder-map scoping only, not security tokens |
| V4 Access Control | no | No access-control surface |
| V5 Input Validation | yes | Hook stdin JSON parse already fail-closes (`hook/index.ts`); MCP inputs validated via `zod/v4`. This phase adds: error-path output must not echo raw input on parse failure (D-04). |
| V6 Cryptography | no (reuse) | `redactedHash` (SHA-256 truncation) already exists in `findings.ts`; this phase adds no crypto |
| V7 Error Handling & Logging | **yes (core of this phase)** | `sanitizeForOutput()` chokepoint (D-03) ensures error/log output never leaks sensitive values; leak-grep test (D-01/D-02) verifies; audit log already no-raw (`findingToAuditRecord`) |
| V8 Data Protection | **yes** | Defense-in-depth: sensitive PII/secret values must not reach stderr, transcripts, or `audit.jsonl` via any path including exceptions |

### Known Threat Patterns for Node/TS error-handling + ML-NER tool

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Sensitive value leaked via exception message / stack trace | Information Disclosure | `sanitizeForOutput()` single chokepoint on all error sinks; static message on context-free failures (D-04) |
| Raw input echoed on JSON.parse / stdin / model-load failure | Information Disclosure | Static structured error, never include payload/stack snippet (D-04; rework `writeFailClosedError`) |
| Raw PII written to `audit.jsonl` | Information Disclosure | `findingToAuditRecord` excludes `value`; PII leak-grep test proves it for PII + NER (PIISEC-01) |
| NER failure crashing the deterministic secret gate | Denial of Service | Fail-closed-for-NER (already in `layer6b-ner.ts`); catch lives in the engine, NOT the supervisor (would wrongly fail the whole tool) |
| Overclaim ("redacts all PII", "GDPR compliant") misleading users into unsafe behavior | (Trust/Repudiation) | Honest-framing copy (D-07) + banned-phrase CI gate (D-08) + `advisory` flag (D-06) |
| Prompt-injection forcing a leak via tool error text | Tampering / Info Disclosure | MCP outputs are typed (`zod/v4`); status/flag fields are enums/booleans that cannot carry matched text; error text routed through chokepoint |

## Project Constraints (from CLAUDE.md)

| Directive | How this phase complies |
|-----------|--------------------------|
| Hook hot path < 100 ms / < 200 ms | `sanitizeForOutput()` lives on ERROR paths ONLY (D-04); never imported into the success/detection path. No new hot-path cost. |
| Audit log must never contain raw secret/PII values | Reuses locked `findingToAuditRecord`; PII leak-grep test proves the guarantee end-to-end including NER findings. |
| Zero new attack surface / minimal supply chain | No new external dependency added — all built from `vitest`/`zod`/SDK + Node built-ins. |
| Immutability (coding-style) | `sanitizeForOutput` is a pure function returning a new string; no mutation of inputs. |
| Error handling — never silently swallow | Errors are still surfaced (fail-closed exit 2 in hook, `isError` in MCP); only their *content* is scrubbed, never suppressed. |
| Input validation at boundaries | MCP `zod/v4` schemas extended for `advisory`; hook stdin parse remains fail-closed. |
| Testing — TDD, ≥80% coverage, AAA structure | Wave 0 writes tests first; new src kept small/focused; coverage thresholds (80/80/75/70) gate the phase. |
| File organization — small focused files | `sanitize-output.ts` and `strings.ts` are small single-purpose modules (<200 lines). |
| GSD workflow enforcement | All edits flow through the planned phase. |

## Sources

### Primary (HIGH confidence — read directly from source this session)
- `src/audit/log.ts` — `AuditRecord`, `findingToAuditRecord` (locked no-raw sink, destructure-pick provenance)
- `src/audit/canary-leak.ts` — `assertNoCanaryLeak` substring-grep harness (ENOENT/malformed handling)
- `tests/audit/canary-leak.test.ts` — existing secrets leak-grep harness to extend
- `tests/fixtures-corpus.test.ts` — end-to-end corpus + audit + canary structure to mirror
- `src/mcp/supervisor.ts` — `supervisedToolCall` catch boundary (a forced-failure path + chokepoint site)
- `src/mcp/tools/check.ts`, `src/mcp/tools/redact.ts` — `findingSchema`, `toFindingDTO`, `nerStatus` enum precedent
- `src/detect/layer6b-ner.ts` — two fail-closed boundaries (model load + inference); `source:'pii-ner'`; `action:'substitute'`
- `src/hook/failclosed.ts`, `src/hook/index.ts` — `writeFailClosedError` (message/stack), crash guards, parse/stdin error paths
- `src/cli.ts`, `src/doctor/index.ts`, `src/doctor/report.ts`, `src/hook/banner.ts` — user-facing output sinks for D-05
- `.github/workflows/canary-leak.yml` — double-pass leak gate pattern to extend
- `vitest.config.ts`, `package.json` — test projects, coverage thresholds, installed deps (no new dep needed)
- `.planning/phases/07-.../07-CONTEXT.md` — locked decisions D-01..D-08
- `.planning/REQUIREMENTS.md` §PIISEC-01/02, `.planning/STATE.md`, `.planning/research/ARCHITECTURE-v2-pii.md`

### Secondary (MEDIUM confidence)
- None required — phase is internal hardening; no external API/library research needed.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependency; all from `package.json` read directly.
- Architecture (chokepoint + leak-grep + flag + copy): HIGH — every surface and the existing patterns
  read from source; decisions are locked.
- Pitfalls: HIGH — derived from concrete code (stderr sinks, context-free `writeFailClosedError`,
  DTO `source` omission, negated-disclaimer false-positive).

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (stable — internal-only patterns; no fast-moving external dependency)
