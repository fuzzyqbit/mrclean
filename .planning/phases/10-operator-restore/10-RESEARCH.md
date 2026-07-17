# Phase 10: Operator Restore - Research

**Researched:** 2026-07-17
**Domain:** Operator-only CLI restore over the Phase 9 encrypted session map (Node/TypeScript, commander CLI, vitest)
**Confidence:** HIGH (codebase integration — every integration point read from shipped source this session); MEDIUM on two design pins flagged in the Assumptions Log

## Summary

Phase 10 turns the Phase 9 session store into an operator round-trip: `mrclean restore` reads redacted text (stdin or file), scans it in a single pass for v2 session-tagged tokens `<MRCLEAN:TYPE:NNN:nonce8>`, looks each token up exactly against the decrypted session map, and emits restored text on stdout — restorable classes (the frozen 7: WORD + 6 PII types) come back; secret-class placeholders, unknown tokens, stale tokens, and OVF tokens pass through unchanged. Per the ROADMAP note, ecosystem research is settled (LLM Guard vault substitution / LiteLLM placeholder maps — exact-match, unmatched-pass-through); this document is therefore a codebase-integration map: what Phase 9 actually exposes, where every Phase 10 touchpoint lives, and which shipped fences and gates constrain the build.

The critical integration facts: the restore read primitive is `readSessionMapFile(baseDir, sid)` in `src/state/map-store.ts` — total-error (null on ANY failure class), returning the full `SessionMapV1` including `original` on restorable entries. It is NOT the hydration facade (`readSessionMapForHydration` deliberately drops originals). Restore inverts `map.entries` into a placeholder→original index, applying the read-side policy gate (`isRestorableType` + `'original' in entry`) that `session-map.ts` explicitly reserves for Phase 10. The shipped cold-path fence (`tests/state/cold-path.test.ts`) confines `createDecipheriv`/`proper-lockfile` tokens to `src/state/` via a full-src walk — so `src/restore/` must consume state exports, never its own crypto. The FORBIDDEN_TOOL_NAMES CI check is T2b of `tests/mcp/tools-list.test.ts` (live stdio integration test), and T2 asserts tools/list is EXACTLY the three shipped tools — Phase 10 adds zero MCP tools. Doctor check-8's header already reserves exit code 1 for this phase's FAIL-loud semantics, and Phase 8 research pins what "unsupported reversible configuration" means: unknown keys inside `[reversible]` that the loader silently tolerates today.

The phase is purely additive outside four seams: new `src/restore/` + a `restore` subcommand in `cli.ts` (dynamic import — hook cold path untouched), a doctor check-8 upgrade, an `mrclean_status` reversible-counters extension, and a deliberate audit-module extension for hash-only restore records. `src/hook/**`, `src/detect/**`, `src/placeholder/**` need zero edits — that zero-diff is itself a phase regression gate (Phase 9's byte-identical discipline, reapplied).

**Primary recommendation:** Build `restoreText()` as a pure single-pass function in `src/restore/` over an inverted index derived from `readSessionMapFile`, with OVF/unknown/secret-class pass-through; wire it CLI-only; extend doctor/status/audit at the named seams; regression-lock the trust boundary with a fence extension (no hook-reachable import of `src/restore/`, no new MCP tools) and a leak-grep extension over restore audit + stderr + error paths.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REVMODE-01 | `mrclean restore` CLI (stdin or file → stdout) — exact map lookup, single-pass token scan, policy-filtered; unknown/stale/OVF pass through; no hook-path restore, no MCP tool (`restore` stays on FORBIDDEN_TOOL_NAMES with CI enforcement) | Patterns 1–4 (read primitive, inverted index, single-pass scan, session discovery); Code Examples 1–3; FORBIDDEN_TOOL_NAMES location + T2 exact-three assertion documented under Integration Points |
| REVMODE-08 | Restore failures degrade one-way (placeholders visible + warning), never block a tool call or disable redaction — separate error domains, no shared kill switch | Pattern 5 (degrade semantics on the total-error read path); Pitfalls 9–10; fence-extension strategy proving structural domain separation; chaos-parity precedent (tests/state/chaos.test.ts) |
| REVMODE-09 | Restore operations audited hash-only; leak-grep extended over map artifacts, restore code paths, and error paths | Pattern 6 (discriminated restore audit record); leak-grep extension strategy in Validation Architecture; assertNoCanaryLeak + pii-canary/pii-stderr precedents; inspection.test.ts map-artifact grep precedent |
| REVMODE-12 | Doctor FAILs loud (never silent no-op) on unsupported reversible configuration; `mrclean_status` reports map entry counts by class + restored/unmatched counters — never values | Pattern 7 (doctor unknown-key FAIL, reserved exit 1); Pattern 8 (status counters: state-confined count reducer + audit-derived restore counters); Assumptions A1–A2 flag the two design pins |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Restore engine (`restoreText`) | Pure library (`src/restore/`) | — | Pure function over (text, index) — no I/O, table-driven testable |
| Map read + decrypt | State module (`src/state/map-store.ts`) | — | Cipher tokens confined to `src/state/` by shipped fence; restore consumes exports only |
| Session discovery + policy index build | CLI layer (`src/restore/` session reader) | State module (paths, SESSION_ID_RE) | Filename-shape enumeration follows the janitor precedent; sid validated before any path derivation |
| CLI I/O (stdin/file → stdout, warnings → stderr) | CLI (`src/cli.ts` + `src/restore/cli` action) | — | Commander dynamic-import subcommand — zero hook-cold-path cost |
| Restore audit (hash-only) | Audit module (`src/audit/`) | CLI (invokes writer) | Same `.mrclean/audit.jsonl` sink; locked no-raw builder discipline (findingToAuditRecord precedent) |
| Doctor FAIL-loud | Doctor (`src/doctor/checks.ts` check 8) | Config (raw-layer key scan) | Exit 1 reserved by 08-03; LOCKED exit-code map otherwise untouched |
| Status counters | MCP tool (`src/mcp/tools/status.ts`) | State module (count-only reducer) + audit reader | Originals never leave `src/state/` stack frames; status stays zero-argument |
| No model-facing restore | Test fences (`tests/mcp/tools-list.test.ts`, cold-path extension) | CI | T2 exact-three + T2b forbidden names + new source-level fence invariants |

## Project Constraints (from CLAUDE.md)

- **Stack:** Node.js >= 20.18.0 + TypeScript ^5.6, commander ^13 (pinned), Vitest 4.x, tsup, picocolors for CLI color — no new runtime deps needed this phase. [VERIFIED: CLAUDE.md + package.json]
- **Performance:** <100 ms UserPromptSubmit / <200 ms PostToolUse budgets apply to HOOKS only. `mrclean restore` is operator-invoked and perf-exempt, but must not regress hook cold start (dynamic-import subcommand pattern already in cli.ts). [VERIFIED: CLAUDE.md constraints + src/cli.ts]
- **Security:** audit log must never contain raw secret values; placeholder→original map handling per REVMODE constraints; "no `zx`/`execa`" and "native `node:fs/promises`" conventions hold. [CITED: CLAUDE.md]
- **User rules:** TDD mandatory (tdd_mode: true in config), 80% coverage floor (workspace thresholds 80/80/75/70 enforced), immutability (build new objects — the restore engine and index builder must not mutate the parsed map), files < 800 lines, error handling explicit. [VERIFIED: .planning/config.json + vitest.config.ts]
- **Commit style:** conventional commits, dist rebuilds as separate chore commits, dist never built from a worktree (rebuild on main post-merge — memory note). [VERIFIED: repo convention in 09 summaries]

## Standard Stack

### Core (all already installed — zero new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `commander` | ^13 (installed) | `restore` subcommand registration | Existing CLI root; `.command('restore [file]')` + dynamic-import action mirrors every shipped subcommand [VERIFIED: src/cli.ts] |
| `node:fs/promises`, `node:crypto` | Node 22.22.0 local / 20 floor | file read, sha256 for audit hashes | Repo convention; `sha256hex` already exported from `src/detect/findings.js` [VERIFIED: src/placeholder/manager.ts import] |
| `src/state/map-store.ts` exports | shipped 09-03 | `readSessionMapFile`, `statePaths`, `mapPathFor` | THE decrypt chokepoint — fence-enforced [VERIFIED: tests/state/cold-path.test.ts invariant 4] |
| `src/state/session-map.ts` exports | shipped 09-02 | `isRestorableType`, `RESTORABLE_TYPES`, `SESSION_ID_RE`, `isValidSessionId`, `V2_TOKEN_RE`, types | Single source of truth for token format + policy partition [VERIFIED: src/state/session-map.ts] |
| `vitest` + `@vitest/coverage-v8` | 4.1.6 (installed) | unit/integration tests | Existing projects config (unit parallel / integration sequential) [VERIFIED: vitest.config.ts + `npx vitest --version`] |
| `picocolors` | ^1.1 (installed) | operator-facing CLI warnings | Existing dependency; CLI stderr copy |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `smol-toml` (via `src/config/` readers) | installed | doctor raw-layer scan for unknown `[reversible]` keys | Doctor FAIL-loud check needs raw table keys BEFORE the tolerant loader drops them (Pattern 7) |
| `src/audit/log.ts` + `src/audit/canary-leak.ts` | shipped | audit append + leak assertion helper | Restore audit writer + REVMODE-09 leak-grep extension |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `readSessionMapFile` direct | `readSessionMapForHydration` facade | Facade DROPS `original` fields (builds `{placeholder, type}` only) — unusable for restore; also synthesizes a fresh provisional map on failure, which restore must never do [VERIFIED: src/state/index.ts buildHydration] |
| Single-pass `String.replace(re, cb)` | Iterative find-and-replace loop | Loop re-scans replacement output → cascades on placeholder-shaped originals; the 09-05 `applyRenamesToText` simultaneity bug (CR-01) is the in-repo proof this class of bug is real [VERIFIED: src/state/index.ts comment] |
| New discriminated restore audit record | Widening `AuditRecord`'s locked unions | AuditRecord requires ruleId/severity/fingerprint/location — a restore summary has none; widening the LOCKED schema risks the canary gate for no benefit (see Pattern 6, Assumption A3) |

**Installation:** none — `npm ls` confirms every module above resolves today. [VERIFIED: package.json + 09-VALIDATION audit]

## Package Legitimacy Audit

**No new packages are installed in this phase.** All recommended modules are either Node built-ins, already-pinned dependencies (`commander@^13`, `picocolors`, `smol-toml`, `vitest@4.1.6`, `proper-lockfile@4.1.2`, `write-file-atomic@7.0.1` — the latter two are not even consumed by restore code), or in-repo source. slopcheck run not applicable.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 OPERATOR SHELL (trusted, local-only)                      MODEL-FACING SURFACES (untouched this phase)
 ─────────────────────────────────────                     ──────────────────────────────────────────────
 stdin or [file] ──► mrclean restore (cli.ts, dynamic import)          Claude Code hooks ──► src/hook/** (ZERO edits)
        │                                                              MCP tools/list ──► exactly 3 tools (T2 locked)
        ▼                                                              'restore' name ──► FORBIDDEN (T2b locked)
 ┌─ src/restore/ ────────────────────────────────┐
 │ 1. discover sessions: readdir sessions/       │        ~/.mrclean/
 │    filename shape <uuid>.map + SESSION_ID_RE  │◄──────── keys/<sid>.key   (0600, 0700 dir)
 │ 2. decrypt: readSessionMapFile(baseDir, sid)  │◄──────── sessions/<sid>.map (ciphertext envelope)
 │    (total-error: ANY failure ⇒ null)          │
 │ 3. build policy index (READ-SIDE GATE):       │
 │    placeholder → original ONLY where          │
 │    isRestorableType(type) && 'original' in e  │
 │    OVF-labelled placeholders excluded         │
 │ 4. restoreText(): ONE pass over input,        │
 │    global v2-token regex, exact index lookup  │
 │    hit ⇒ original · miss/OVF/secret ⇒ token   │
 └───────┬───────────────────────┬───────────────┘
         ▼                       ▼
 stdout: restored text    stderr: summary + degrade warning (never values)
         │
         ▼
 .mrclean/audit.jsonl ◄── hash-only restore record (action:'restore', counts, hashes)
         │
         ▼
 mrclean_status (MCP) ── aggregates restore counters from audit.jsonl (cwd-scoped)
                      ── entry counts by class via count-only reducer in src/state/
 mrclean doctor ────────── check 8: FAIL loud on unknown [reversible] keys (exit 1, reserved)
```

Trust direction (STATE.md cross-phase note, binding): `src/restore/` INTRODUCES sensitive data — the opposite direction from `src/placeholder/`. It is never reachable from any hook or MCP tool path; restored values exist only on operator stdout and in `src/restore/`/`src/state/` stack frames.

### Recommended Project Structure

```
src/
├── restore/
│   ├── index.ts          # restoreText() pure engine + RestoreResult type (restored/unmatched/skipped counts)
│   ├── session-index.ts  # session discovery (readdir + SESSION_ID_RE) + policy-filtered inverted index build
│   └── cli.ts            # runRestore(opts): stdin/file read, engine call, stdout/stderr emission, audit write
├── audit/
│   └── log.ts            # + RestoreAuditRecord (discriminated, locked no-raw builder) — or a sibling restore-log.ts
├── doctor/checks.ts      # checkReversibleState upgraded: FAIL on unknown [reversible] keys (exit 1)
├── mcp/tools/status.ts   # + reversible counters block (counts only, zero-argument tool unchanged)
├── state/
│   └── (optional) counts reducer export — keeps originals confined to src/state/ for the status path
└── cli.ts                # + program.command('restore [file]') with dynamic import
```

Do NOT create `src/mcp/tools/restore.ts` — that Phase 1 stub was deleted in 03-01 and is still enumerated in the vitest coverage `exclude` list as dead history; recreating it would both resurrect the banned surface and confuse the coverage config. [VERIFIED: vitest.config.ts coverage.exclude]

### Pattern 1: The restore read primitive (total-error, lock-free)

**What:** `readSessionMapFile(baseDir, sid)` is the only correct read: one try/catch covers key read → envelope read → length/magic/version gates → GCM decrypt (authTagLength:16, AAD-bound to sid) → JSON parse → schema guard. Every failure class (ENOENT/EACCES/short envelope/tag fail/wrong AAD/bad JSON) returns null — which restore maps to "degrade one-way with warning."
**When to use:** every map read in Phase 10. Reads are lock-free by design — writes are atomic-rename, so a concurrent hook write is invisible (reader sees old or new complete file, never torn). Do NOT take `withMapLock` for reads; do NOT add fsync/mtime side effects (map mtime is the TTL heartbeat — a restore must never make an abandoned session look live, and `readFile` doesn't touch mtime). [VERIFIED: src/state/map-store.ts + src/state/janitor.ts TTL-by-map-mtime]

### Pattern 2: Read-side policy gate (the "second gate" Phase 9 reserved for this phase)

**What:** Index construction applies the secret floor a third time (after the type-level floor and the serializer strip): only entries with `isRestorableType(entry.type) && 'original' in entry` enter the placeholder→original index. `session-map.ts`'s own docstring names this: "(Phase 10 adds the restore-side policy gate on top)". Note `parseMapEntry` already DROPS a poisoned `original` on secret-class entries at read time — the restore gate is defense-in-depth, and the test for it must hand-poison ciphertext (encrypt poisoned JSON with the real key, then assert no restore), because ordinary flows can never produce the poisoned state. [VERIFIED: src/state/session-map.ts parseMapEntry + docstrings]
**Restorable set (frozen — do not widen):** `WORD, PII_EMAIL, PII_PHONE, PII_IP, PII_PERSON, PII_ORG, PII_LOC`. Everything else — all secret TYPEs, SECRET, ENV, ENTROPY, PII_SSN, PII_CREDIT_CARD, and any unknown future TYPE — is secret-class. "Paths/names/identifiers" in SC2 are WORD-typed Layer-4 findings; there is no PATH type. The mixed-content canary's "fake path" must therefore be a word-list term.

### Pattern 3: Single-pass token scan with exact lookup

**What:** One global regex pass, `text.replace(scanRe, callback)` — the callback does an exact `index.get(fullToken)` and returns the original on hit, the token itself on miss. `String.replace` advances past each replacement, so restored output is never re-scanned: a placeholder-shaped ORIGINAL (a WORD whose value literally looks like a token) cannot cascade.
**Scan regex:** the shipped `V2_TOKEN_RE` is anchored (`^...$`) — restore needs the unanchored global variant `/<MRCLEAN:([A-Z0-9_]+):(\d{3}|OVF):([a-f0-9]{8})>/g`. Recommend exporting a `V2_TOKEN_SCAN_RE` beside `V2_TOKEN_RE` in `session-map.ts` (single source of truth for the token grammar) rather than duplicating the pattern in `src/restore/`. [VERIFIED: src/state/session-map.ts V2_TOKEN_RE]
**Pass-through taxonomy (SC1):**
- **v1 tokens** `<MRCLEAN:TYPE:NNN>` (no nonce): never match the v2 scan → pass through (one-way sessions have no map by definition).
- **OVF tokens** (`:OVF:` label): skip lookup entirely at scan time AND exclude OVF-labelled placeholders at index-build time — multiple originals share one OVF token, so inversion is ambiguous (wrong-value restore). [VERIFIED: formatV2Token OVF semantics + manager.ts "last writer wins" comment]
- **Unknown/planted/enumerated:** exact full-token lookup means a token must match placeholder text the map actually issued — wrong nonce8, unissued NNN, or fabricated TYPE all miss. Within-session enumeration of VALID map entries by a model echoing tokens is the documented accepted residual (THREAT_MODEL §5) and restores only restorable-class values.
- **Stale:** well-formed v2 token whose session map was janitor-deleted/TTL-swept, or absent from the surviving map → miss → pass through, counted `unmatched`.

### Pattern 4: Session discovery (janitor filename-shape precedent)

**What:** Enumerate `statePaths(baseDir).sessionsDir` with `readdir`, consider ONLY `<uuid>.map` names whose stem passes `SESSION_ID_RE`, decrypt each candidate via `readSessionMapFile`. Never derive paths from unvalidated input: a `--session <sid>` CLI arg must pass `isValidSessionId` before path construction (Pitfall 5 discipline, same as the janitor). [VERIFIED: src/state/janitor.ts sweep-candidacy rules]
**Selection semantics (planner pin — see Assumption A4):** recommended default is the union index across ALL live decryptable maps: tokens embed nonce8, so cross-session collisions are structurally absent (a token only matches the map that issued it), mixed-session documents restore naturally, and no session flag is needed for the common case. `--session <uuid>` narrows to one map for explicit scoping. Zero decryptable maps ⇒ global degrade warning + pass-through.

### Pattern 5: Fail-one-way degrade semantics (REVMODE-08)

**What:** Every failure lands in the same shape — output equals input for the affected tokens, one human-readable stderr warning that never contains values or map contents, exit code 0 (pipe-friendly cosmetic degradation; see Assumption A5). No retries, no lock waits, no partial-failure exit codes.
**Separate error domains, structurally provable:** redact is fail-closed (exit 2 crash guards in hooks); restore is fail-safe (warn + pass-through). There is no shared kill switch because there is no shared mutable state or config flag: restore reads the map read-only and never touches detection config, session-state, or hook modules. Prove it with fences, not assertions: extend `tests/state/cold-path.test.ts` (or a sibling) so no hook-reachable module — and no `src/detect/`/`src/mcp/` module — ever imports `src/restore/`; chaos parity (six corruption shapes, 09-08 precedent) already proves redaction output is one-way-identical when the store is hostile. [VERIFIED: tests/state/cold-path.test.ts invariants; tests/state/chaos.test.ts existence]

### Pattern 6: Hash-only restore audit (REVMODE-09)

**What:** One audit line per restore invocation appended to `<cwd>/.mrclean/audit.jsonl` via the shipped `appendFile` discipline, as a NEW discriminated record type (recommended, Assumption A3): e.g. `{ ts, action: 'restore', sessionScope, restored, unmatched, skippedSecret, hashes?: [first-16 sha256 of each restored original] }`. Never raw values, never originals, never map paths. Reuse `sha256hex` from `src/detect/findings.js` truncated to 16 hex — byte-consistent with `redactedHash` discipline. `assertNoCanaryLeak` works unchanged on heterogeneous JSONL (it JSON-parses per line and substring-scans), so the existing leak harness extends naturally. The alternative — widening `AuditRecord`'s LOCKED unions (`action: 'restore'`, a non-hook `hookEvent`) — forces fake values into required fields (ruleId/severity/fingerprint/location) and touches a schema two shipped canary tests guard; research SUMMARY's "extend deliberately" is satisfied more safely by the discriminated record in the same file/module with its own LOCKED no-raw builder comment + grep gate (the `findingToAuditRecord` precedent, including its "never blind-spread" CR-01 lesson). [VERIFIED: src/audit/log.ts locked schema + builder; src/audit/canary-leak.ts line semantics]

### Pattern 7: Doctor FAIL-loud on unsupported `[reversible]` configuration (REVMODE-12)

**What:** Phase 8 research pins the meaning: "Unknown keys inside `[reversible]` are ignored (matches current reader tolerance); REVMODE-12's FAIL-loud-on-unsupported-config lands in Phase 10" [CITED: 08-RESEARCH.md §Pattern 3]. Today an operator writing `restore_secrets = true` or a typo'd `ttl_hour = 12` gets silent tolerance — exactly the silent no-op REVMODE-12 bans. The upgraded check 8:
- PASS (disabled/enabled) exactly as today, byte-locked copy (`tests/doctor/checks.test.ts` Test 16 pattern);
- FAIL with `exitCodeOnFail: 1` when either config layer's raw `[reversible]` table carries keys outside the supported set `{enabled, ttl_hours}` — detail names the offending file + key (checkConfigLoad already includes file paths in FAIL details, so this follows precedent; the T-08-08 constant-detail constraint applied to the SKIP path, not FAILs);
- SKIP on unreadable config unchanged (checkConfigLoad owns that FAIL — never double-FAIL one root cause).
**Mechanism caution:** `loadEffectiveConfig` cannot see unknown keys (validator drops them) — the check must re-read raw layers (via `readConfigLayer`'s underlying raw parse or a small exported raw-keys helper in `src/config/`). Wrong-typed known keys already FAIL via checkConfigLoad's ConfigReadError today — no new work. The LOCKED exit-code map (1,2,3,4,6) is untouched; exit 1 was explicitly reserved for this. [VERIFIED: src/doctor/checks.ts:552-597 header + reservation comment]
**Not in the FAIL set:** win32 + enabled is a documented inherited known-gap ("Reversible mode inherits the known-gap; it does not widen it" — THREAT_MODEL §5); at most an informational detail, not a FAIL. The pre-reshape "CC < 2.1.121 ⇒ FAIL" gate died with in-session restore (T1 cut) — the operator CLI has zero hook-contract version dependency (see Assumption A1).

### Pattern 8: `mrclean_status` reversible counters (REVMODE-12)

**What:** Extend `statusOutputSchema` with a counts-only block, e.g. `reversible: { enabled, sessions, entries_by_class: { restorable, secret } (or per-TYPE), restored_total, unmatched_total }`. Two data sources:
- **Entry counts by class:** enumerate `sessionsDir` (filename-shape + SESSION_ID_RE), decrypt each via a count-only reducer that lives in `src/state/` and returns ONLY counts — originals never cross into `src/mcp/` frames. This is the first sanctioned MCP-side state read; it is read-only reporting, distinct from the MCP-lane allocation fence (synthetic sids can never allocate). The tool MUST stay zero-argument (`z.object({})`) so the model can never inject a sid.
- **Restored/unmatched counters:** aggregate `action:'restore'` records from `<cwd>/.mrclean/audit.jsonl` (Assumption A2). Note the scoping asymmetry honestly in copy/tests: session maps are machine-global (`~/.mrclean`), audit counters are project-cwd-scoped.
Missing sessions dir / zero maps / unreadable audit ⇒ zero counts, never an error (status keeps its read-only, never-throw shape). Leak-grep must cover the status output path (structuredContent grep against planted restorable canaries). [VERIFIED: src/mcp/tools/status.ts current shape + registration]

### Anti-Patterns to Avoid

- **Reusing `substituteFindings` or anything span/position-based:** restore has no Finding spans; it is a token-grammar scan + map lookup. STATE.md pins this: "never reuse substituteFindings. Restore = map lookup only, never re-detection, never position-based, never fuzzy." [CITED: STATE.md Cross-Phase Notes]
- **Fuzzy/delimiter-tolerant matching:** explicitly out of scope (REQUIREMENTS "Fuzzy/Levenshtein" row) — distance-1 edits are different identities; wrong-value restore is silent corruption.
- **Restore inside any hook handler or MCP tool:** T1/T6 locked; T2 asserts exactly three tools — any new tool breaks CI by design.
- **Own crypto in `src/restore/`:** `createDecipheriv` outside `src/state/` trips the shipped full-src confinement walk. [VERIFIED: tests/state/cold-path.test.ts invariant 4]
- **Loop-until-no-match replacement:** cascades on placeholder-shaped originals (the applyRenamesToText CR-01 lesson).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Envelope decrypt + validation | own AES-GCM reader | `readSessionMapFile` | Fence-confined; DEP0182 authTagLength guard, AAD sid binding, validate-before-slice already proven [VERIFIED: map-store.ts] |
| Token grammar | new regex literals in restore | export scan variant beside `V2_TOKEN_RE` in session-map.ts | Single source of truth; grammar drift between allocator and restorer is a silent-corruption vector |
| Policy partition | restore-local allow list | `isRestorableType` / `RESTORABLE_TYPES` | The frozen partition + vocabulary-sync test already fail loudly on drift [VERIFIED: session-map.ts + tests/state/secret-floor.test.ts] |
| sid validation | sanitize-by-transform | `isValidSessionId` / `SESSION_ID_RE` | Strict allowlist is the only gate between input and path construction (Pitfall 5) |
| Audit hashing | new hash helper | `sha256hex` (findings.ts), first 16 hex | Byte-consistent with `redactedHash` discipline across the log |
| Leak assertion | new grep harness | `assertNoCanaryLeak` + pii-stderr/pii-canary test shapes | Handles ENOENT-clean, malformed-line-as-leak, substring partial leaks |
| Locking for reads | any lock in restore | nothing — reads are lock-free | Atomic-rename writes make lock-free reads consistent; adding locks couples error domains |

**Key insight:** every hard sub-problem of this phase (crypto, atomicity, policy floor, sid trust, leak proof) was solved and regression-locked in Phase 9 — Phase 10's engineering is a pure function plus disciplined seam wiring, and the main risk is *bypassing* a shipped mechanism, not missing one.

## Common Pitfalls

### Pitfall 1: Inverted index includes OVF entries → ambiguous wrong-value restore
**What goes wrong:** Distinct originals past counter 999 share one `<MRCLEAN:TYPE:OVF:nonce8>` placeholder; naive inversion maps that token to whichever entry enumerates last.
**How to avoid:** Exclude OVF-labelled placeholders at index build AND short-circuit `:OVF:` matches at scan time (belt and braces). SC1 mandates OVF pass-through.
**Warning signs:** table-driven test with two >999 same-TYPE originals restores one of them.

### Pitfall 2: Sequential replace cascades on placeholder-shaped originals
**What goes wrong:** A restored WORD original that itself looks like a token gets re-matched by a later pass or a loop-based replacer — the in-repo CR-01 rename-cascade bug is the precedent.
**How to avoid:** ONE `String.replace(globalRe, cb)` pass; never split/join per token; never loop until stable. Test fixture: map a WORD whose original is literally another live token string; assert single-hop restore.

### Pitfall 3: Reading through the hydration facade
**What goes wrong:** `readSessionMapForHydration` drops `original` fields and fabricates a fresh provisional map on failure — restore would silently restore nothing and mask degrade.
**How to avoid:** `readSessionMapFile` only; null ⇒ explicit degrade warning.

### Pitfall 4: Doctor unknown-key scan via the tolerant loader
**What goes wrong:** `loadEffectiveConfig`/`validateReversibleConfig` silently drop unknown keys — the check would be vacuously green forever (the exact silent no-op REVMODE-12 bans).
**How to avoid:** raw-layer key inspection (both user + project files); unit-test with a planted `restore_secrets = true` asserting FAIL naming the key.

### Pitfall 5: Status tool leaks or grows an argument
**What goes wrong:** returning per-entry data, TYPE lists with originals, or accepting a sid argument turns a counts panel into an oracle reachable by prompt injection.
**How to avoid:** counts only, computed by a reducer inside `src/state/`; input schema stays `z.object({})`; leak-grep over structuredContent with planted canaries; T2 exact-three stays green.

### Pitfall 6: Coupling error domains through shared code or config
**What goes wrong:** a shared "reversible unavailable" flag, a shared warn channel with side effects, or restore importing detection config creates the shared kill switch REVMODE-08 bans.
**How to avoid:** restore reads config only for... nothing — it doesn't need `[reversible]` at all (maps either decrypt or they don't; an operator restoring after disabling reversible should still succeed against surviving maps). Zero imports from `src/detect/`/`src/hook/`; fence-test it.

### Pitfall 7: Restore refreshing map mtime or leaving litter
**What goes wrong:** any write into `sessions/` (tmp files, mtime bump) either makes orphaned maps look live (defeats the TTL sweep) or adds non-conforming litter the janitor refuses to touch.
**How to avoid:** restore's write surface is exactly stdout + stderr + `<cwd>/.mrclean/audit.jsonl`. Assert in tests: sessions/keys dirs byte-identical (names + mtimes) across a restore run.

### Pitfall 8: Breaking byte-identical guarantees by "small" refactors
**What goes wrong:** touching `src/hook/**`, `src/detect/**`, `src/placeholder/**` for convenience (e.g., extracting a shared token helper INTO the manager) erodes the Phase-8/9 byte-identical discipline and the frozen v1 zone.
**How to avoid:** additive-only phase; the git-diff-empty gate over those trees is a named regression check (Phase 9 SC discipline reapplied).

### Pitfall 9: Treating CLI degrade as an error exit
**What goes wrong:** non-zero exit on missing map breaks `cat log | mrclean restore > out` pipelines and trains operators that degrade is failure — pushing toward exactly the "disable it" behavior the constraints warn about.
**How to avoid:** exit 0 + stderr warning on cosmetic degrade (Assumption A5 — planner may add a `--strict` later; YAGNI now).

### Pitfall 10: Testing restore against synthetic maps only
**What goes wrong:** hand-built SessionMapV1 fixtures can drift from what the allocator actually persists (e.g., OVF entries, counter semantics, HMAC keys).
**How to avoid:** at least one integration test drives the REAL pipeline (reversible handler flow from `tests/state/chaos.test.ts`/`inspection.test.ts` HOME-stub precedent) to produce the map, then restores against it — this is also exactly the mixed-content canary shape Phase 11 elevates.

## Code Examples

Verified patterns from the shipped codebase (all paths read this session):

### 1. Read + policy-filtered inverted index (the whole data path)
```typescript
// Source: src/state/map-store.ts (readSessionMapFile), src/state/session-map.ts (isRestorableType)
import { readSessionMapFile, statePaths } from '../state/map-store.js'
import { isRestorableType, SESSION_ID_RE } from '../state/session-map.js'
import { readdir } from 'node:fs/promises'

const OVF_LABEL = ':OVF:'

export async function buildRestoreIndex(baseDir: string): Promise<Map<string, string>> {
  const index = new Map<string, string>()
  let names: string[] = []
  try {
    names = await readdir(statePaths(baseDir).sessionsDir)
  } catch {
    return index // absent dir == zero sessions (degrade upstream)
  }
  for (const name of names) {
    const sid = name.endsWith('.map') ? name.slice(0, -'.map'.length) : null
    if (sid === null || !SESSION_ID_RE.test(sid)) continue // janitor candidacy discipline
    const map = await readSessionMapFile(baseDir, sid) // total-error: null on ANY failure
    if (map === null) continue
    for (const entry of Object.values(map.entries)) {
      // READ-SIDE POLICY GATE (Phase 10's gate on top of the write-time floor):
      if (!isRestorableType(entry.type)) continue
      if (!('original' in entry)) continue
      if (entry.placeholder.includes(OVF_LABEL)) continue // ambiguous shared token
      index.set(entry.placeholder, entry.original)
    }
  }
  return index
}
```

### 2. Single-pass restore engine (pure — the unit-TDD core)
```typescript
// Source pattern: String.replace-with-callback (never re-scans replacements);
// grammar from src/state/session-map.ts V2_TOKEN_RE (export an unanchored scan variant)
const V2_TOKEN_SCAN_RE = /<MRCLEAN:([A-Z0-9_]+):(\d{3}|OVF):([a-f0-9]{8})>/g

export interface RestoreResult {
  text: string
  restored: number
  unmatched: number
  restoredOriginals: string[] // for audit hashing only — never logged raw
}

export function restoreText(input: string, index: ReadonlyMap<string, string>): RestoreResult {
  let restored = 0
  let unmatched = 0
  const restoredOriginals: string[] = []
  const text = input.replace(V2_TOKEN_SCAN_RE, (token, _type, label: string) => {
    if (label === 'OVF') { unmatched++; return token } // SC1: OVF pass-through, no lookup
    const original = index.get(token) // EXACT full-token lookup (nonce8 included)
    if (original === undefined) { unmatched++; return token } // unknown/stale/planted
    restored++
    restoredOriginals.push(original)
    return original
  })
  return { text, restored, unmatched, restoredOriginals }
}
```

### 3. CLI stdin/file read (commander subcommand, dynamic import — shipped idiom)
```typescript
// Source: src/cli.ts subcommand idiom (dynamic import keeps hook cold path clean)
program
  .command('restore [file]')
  .description('Restore policy-permitted placeholders from redacted text (stdin or file) — operator-only, local')
  .option('--session <uuid>', 'Restrict restore to one session map')
  .action(async (file: string | undefined, opts: { session?: string }) => {
    const { runRestore } = await import('./restore/cli.js')
    await runRestore({ file, session: opts.session })
  })
// stdin read (no hook timeout semantics — operator CLI reads to EOF):
async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let out = ''
  for await (const chunk of stream) out += chunk
  return out
}
```

### 4. Hash-only audit hashing (byte-consistent with redactedHash)
```typescript
// Source: src/detect/findings.js sha256hex; src/audit/log.ts redactedHash discipline ("First 16 hex chars")
import { sha256hex } from '../detect/findings.js'
const hashes = result.restoredOriginals.map((v) => sha256hex(v).slice(0, 16))
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| In-session restore via `updatedToolOutput` (pre-reshape plan) | Operator-only CLI restore, zero hook surface | T1 decision 2026-07-14 | CC-version doctor gate (≥2.1.121) is DEAD for restore; "unsupported config" FAIL re-scoped to config keys |
| Phase 1 `restore` MCP tool stub | Deleted; name permanently on FORBIDDEN_TOOL_NAMES | 03-01 / v1 ban reaffirmed | T2 exact-three + T2b are the shipped CI enforcement REVMODE-01 cites |
| Per-process counter placeholders (v1) | Content-addressed v2 tokens with nonce8 in shared encrypted store | Phase 9 (shipped) | Restore is a pure map lookup; planted-token enumeration killed cross-session by nonce |

Ecosystem prior art (settled per ROADMAP note — not re-researched): LLM Guard `Deanonymize` vault substitution (EXACT strategy default, unmatched pass-through, empty-vault warn-and-continue) and LiteLLM placeholder maps follow the same exact-match/pass-through contract this design uses. [CITED: .planning/research/FEATURES.md sources — verified in a prior session, not re-fetched]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "Unsupported reversible configuration" for doctor FAIL-loud = unknown keys in the raw `[reversible]` tables (supported set `{enabled, ttl_hours}`); the pre-reshape CC-version floor is NOT part of it | Pattern 7 | If the operator intended a broader FAIL set (e.g., win32+enabled), check 8 under-fails; conversely an over-broad set makes doctor noisy. Evidence: 08-RESEARCH §Pattern 3 pins the unknown-keys reading post-reshape [CITED]; version-floor evidence is all pre-reshape [ASSUMED interpretation — confirm at plan time] |
| A2 | Restored/unmatched counters for `mrclean_status` are aggregated from `action:'restore'` records in `<cwd>/.mrclean/audit.jsonl` (no new state files) | Pattern 8 | If a sidecar counters file was intended, status wiring changes; audit-derived is simplest and adds zero janitor surface [ASSUMED — design recommendation] |
| A3 | Restore audit ships as a NEW discriminated record type in the same audit.jsonl, not a widening of `AuditRecord`'s LOCKED unions | Pattern 6 | If the planner prefers widening the locked schema, the canary tests + LOCKED comments need coordinated edits; both satisfy "extend deliberately" [ASSUMED — recommendation, research SUMMARY wording is ambiguous] |
| A4 | Default session scope = union index over all live decryptable maps; `--session <uuid>` narrows | Pattern 4 | If per-session-only is required by strict SC1 reading, default flips to "newest map + flag to select"; exact-token lookup keeps both variants safe [ASSUMED — recommendation] |
| A5 | CLI exits 0 on cosmetic degrade (map absent/corrupt), warning on stderr | Pattern 5 / Pitfall 9 | If operators need failure signaling, add `--strict` later; deferring matches YAGNI + "restore is cosmetic" posture [ASSUMED — recommendation] |
| A6 | LLM Guard / LiteLLM prior-art characterization carried from earlier milestone research without re-fetching | State of the Art | Zero build impact — design is fully determined by in-repo contracts [ASSUMED] |

## Open Questions (RESOLVED)

1. **Exact doctor FAIL matrix beyond unknown keys**
   - What we know: exit 1 reserved; unknown-key silent tolerance is the named silent no-op; win32 is a documented inherited gap, not a widening.
   - What's unclear: whether check 8 should also surface (non-FAIL) informational details like win32-enabled or orphaned-map counts.
   - Recommendation: FAIL = unknown keys only (A1); anything else is PASS-detail copy, decided at plan time and byte-locked in tests.
   - RESOLVED: doctor FAIL = unknown `[reversible]` keys only (A1 pin) — pinned in the ROADMAP.md Phase 10 planner-pin note (2026-07-17); implemented by plan 10-04.
2. **`mrclean_status` cross-project scoping copy**
   - What we know: sessions are machine-global; audit counters are cwd-scoped (status already uses `getCwd()` for the audit path).
   - What's unclear: whether entry counts should be filtered to "sessions plausibly belonging to this project" (not derivable — maps don't record cwd).
   - Recommendation: report global session counts with honest field naming (e.g. `sessions` = machine-wide live maps); never claim project scoping the data can't support.
   - RESOLVED: counters aggregate from `action:'restore'` audit records (A2 pin) with machine-global session counts under honest field naming — pinned in the ROADMAP.md Phase 10 planner-pin note (2026-07-17); implemented by plan 10-06.
3. **STATE.md open todo "Phase 10 early: per-tool empirical verification of structured `tool_response` shapes"**
   - What we know: written pre-reshape; the operator CLI has zero PostToolUse dependency; the concern belongs to hook emission (Phase 11's live canary).
   - Recommendation: re-home this todo to Phase 11 during planning; do not spend Phase 10 tokens on live-session experiments.
   - RESOLVED: re-homed to Phase 11 at plan time — recorded beside the planner pins (2026-07-17) in the ROADMAP.md Phase 11 note ("Phase 10 re-homed the stale STATE.md todo ... here"); zero Phase 10 scope.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime + tests | ✓ | 22.22.0 (floor 20 satisfied) | — |
| vitest | test suites | ✓ | 4.1.6 | — |
| tsc | typecheck gate | ✓ | 5.9.3 | — |
| tsup | dist rebuild (chore commits) | ✓ | installed (globalSetup uses it) | — |
| commander / picocolors / smol-toml | CLI + doctor scan | ✓ | installed | — |
| `claude` CLI | NOT needed this phase | n/a | — | Phase 11's live gates own it |

**Missing dependencies with no fallback:** none. This phase is fully offline and installs nothing.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.6 (projects: unit parallel / integration sequential+globalSetup / uat opt-in) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --project=unit <changed test files>` |
| Full suite command | `npm test` (baseline entering Phase 10: **861 passed / 16 skipped, 90 files, exit 0**) |
| Typecheck gate | `npm run typecheck` — differential vs the **38-error baseline** (deferred-items discipline; zero errors allowed in Phase 10 files) |
| Estimated full runtime | ~90 s (integration rebuilds dist via globalSetup) |

### Phase Requirements → Test Map

| Req ID | Behavior (success-criterion signal) | Test Type | Automated Command | File Exists? |
|--------|-------------------------------------|-----------|-------------------|-------------|
| REVMODE-01 | SC1 engine table: exact lookup restores; unknown/stale/planted (wrong nonce, unissued NNN)/OVF/v1 tokens pass through; single-pass no-cascade on placeholder-shaped originals | unit (TDD RED→GREEN) | `npx vitest run tests/restore/engine.test.ts --project=unit` | ❌ Wave 0 |
| REVMODE-01 | SC1 CLI: stdin and file input → restored stdout; `--session` sid gate (isValidSessionId before paths); summary on stderr only | unit (CLI seam, tests/cli precedent) | `npx vitest run tests/cli/restore.test.ts --project=unit` | ❌ Wave 0 |
| REVMODE-01 | SC2 no-model-facing-surface: tools/list still exactly 3 tools, `restore` absent (T2/T2b) | integration (existing, must stay green) | `npm run build && npx vitest run tests/mcp/tools-list.test.ts --project=integration` | ✅ existing |
| REVMODE-01/08 | Source-level fence: no hook-reachable or `src/mcp/`/`src/detect/` module imports `src/restore/`; cipher/lock tokens still confined to `src/state/` | unit (fence extension) | `npx vitest run tests/state/cold-path.test.ts --project=unit` | ✅ extend existing |
| REVMODE-01 | SC2 mixed-content canary (Phase 11 gate name, built now): real reversible pipeline redacts fake AWS key + WORD-term "path"; restore round-trips the WORD, AWS placeholder survives byte-identical | integration (HOME-stub, chaos/inspection harness precedent) | `npx vitest run tests/restore/mixed-canary.test.ts --project=unit` (pure-source harness; promote to integration if it drives dist) | ❌ Wave 0 |
| REVMODE-08 | SC3 degrade matrix: map missing/corrupt/truncated/garbage-key/chmod-000/locked → output==input, one stderr warning without values, exit 0; sessions/keys dirs byte-identical after run (no mtime/litter) | unit | `npx vitest run tests/restore/degrade.test.ts --project=unit` | ❌ Wave 0 |
| REVMODE-08 | SC3 redaction unaffected: existing chaos one-way parity + stress gates stay green with restore code present (no shared kill switch regression) | unit + integration (existing) | `npx vitest run tests/state/chaos.test.ts --project=unit && npm run build && npx vitest run tests/state/stress.test.ts --project=integration` | ✅ existing |
| REVMODE-09 | SC4 hash-only audit: restore invocation writes counts+16-hex hashes only; assertNoCanaryLeak over audit.jsonl with restorable originals as canaries; non-vacuity line-count guard (pii-canary precedent) | unit | `npx vitest run tests/audit/restore-canary-leak.test.ts --project=unit` | ❌ Wave 0 |
| REVMODE-09 | SC4 error-path leak-grep: forced failures (poisoned map incl. hand-poisoned secret-class `original` ciphertext, garbage key, EACCES) leak nothing to stderr or audit; raw map artifact bytes grep clean | unit | same file as above (error-path describe block) + `npx vitest run tests/state/inspection.test.ts --project=unit` (extend) | ❌/✅ Wave 0 + extend |
| REVMODE-12 | SC5 doctor: unknown `[reversible]` key in user OR project layer → FAIL exit 1 naming file+key; supported keys → PASS with byte-locked copy; LOCKED exit map (1,2,3,4,6) unchanged | unit | `npx vitest run tests/doctor/checks.test.ts --project=unit` | ✅ extend existing |
| REVMODE-12 | SC5 status: counters block present (entries by class, sessions, restored/unmatched totals from audit aggregation); zero-argument schema unchanged; planted canaries absent from structuredContent | unit | `npx vitest run tests/mcp/status-reversible.test.ts --project=unit` | ❌ Wave 0 |
| all | Phase regression: full suite green; typecheck == 38-error baseline; `git diff --stat <base> -- src/hook src/detect src/placeholder tests/placeholder tests/detect` EMPTY (additive-phase proof; existing tests/audit files unedited, new files only) | full suite | `npm test && npm run typecheck` | ✅ existing |

### Sampling Rate

- **Per task commit:** `npx vitest run --project=unit <touched suites>` (< 30 s)
- **Per wave merge:** `npm test` (full, ~90 s) + `npm run typecheck` differential vs 38-error baseline
- **Phase gate:** full suite green + tools-list integration green + zero-diff gate over the frozen trees before `/gsd:verify-work`
- **Max feedback latency:** 120 s

### Leak-Grep Extension Strategy (REVMODE-09 spine)

1. **Canary corpus:** synthetic restorable originals (WORD term e.g. `zz-canary-project-path`, `.invalid` email) + synthetic secret canary (non-EXAMPLE fake AWS key — note `AKIAIOSFODNN7EXAMPLE` is allowlisted by gitleaks and produces no findings [VERIFIED: STATE.md 03-01 decision]).
2. **Surfaces swept with `assertNoCanaryLeak` / substring greps:** `<cwd>/.mrclean/audit.jsonl` (restore records), restore stderr on success AND every degrade/error path, `mrclean_status` structuredContent, raw `sessions/*.map` envelope bytes (inspection.test.ts precedent — secret canary must appear in NO artifact; restorable canaries may appear ONLY in restore stdout).
3. **Framing (load-bearing):** restore stdout is the operator-facing restore output — restorable canaries there are the FEATURE. The leak invariant is: secret-class canaries appear on NO surface anywhere (including stdout — placeholder survives), restorable canaries appear ONLY on stdout (never audit, stderr, status, or map-adjacent litter).
4. **Non-vacuity guards everywhere:** assert restore actually restored (restored > 0) before asserting cleanliness; assert audit line exists before grepping it (pii-canary line-count guard precedent).

### Wave 0 Gaps

- [ ] `tests/restore/engine.test.ts` — REVMODE-01 table-driven engine (TDD RED first)
- [ ] `tests/restore/degrade.test.ts` — REVMODE-08 corruption/degrade matrix
- [ ] `tests/restore/mixed-canary.test.ts` — SC2 mixed-content canary against the real pipeline (Phase 11 gate substrate)
- [ ] `tests/cli/restore.test.ts` — CLI seam (stdin/file/--session)
- [ ] `tests/audit/restore-canary-leak.test.ts` — REVMODE-09 audit + stderr + error-path grep
- [ ] `tests/mcp/status-reversible.test.ts` — REVMODE-12 counters
- [ ] Extensions to existing: `tests/state/cold-path.test.ts` (restore-import fence invariants), `tests/doctor/checks.test.ts` (FAIL-loud rows + copy locks), `tests/state/inspection.test.ts` (restore-flow artifact grep)
- Framework install: none — vitest projects already route `tests/restore/**` to the unit project by the default glob [VERIFIED: vitest.config.ts include/exclude]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | local single-user CLI; OS user boundary is the (honestly documented) custody limit |
| V4 Access Control | yes | policy gate = frozen `RESTORABLE_TYPES` partition, applied write-time (P9) + parse-time (P9) + restore-read-time (P10 third gate); no config can widen |
| V5 Input Validation | yes | `SESSION_ID_RE` strict allowlist before any path derivation (CLI `--session` + filename stems); token grammar regex is the only parser of untrusted text; no RegExp built from input |
| V6 Cryptography | yes | never hand-roll — all decrypt via `readSessionMapFile` (fence-enforced confinement of `createDecipheriv` to `src/state/`) |
| V7 Error Handling & Logging | yes | total-error read path; degrade warnings carry no values/paths; hash-only audit via locked builder |
| V8 Data Protection | yes | secret-class originals structurally absent; restored values confined to stdout + restore/state stack frames; status = counts only |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt-injected model invokes restore | Elevation | No MCP tool, no hook path — T2 exact-three + T2b forbidden names + new source fences (CI) |
| Planted/enumerated token in model output later piped through restore | Spoofing / Info disclosure | Exact full-token lookup (nonce8-bearing) restores only map-issued tokens; within-session echo of VALID restorable tokens is the documented accepted residual (THREAT_MODEL §5) — restores names/paths, never secrets |
| Poisoned map (secret entry carrying `original` on disk) | Tampering | GCM auth (tamper ⇒ absent) + parse-time drop + restore-side `isRestorableType` gate; test via hand-poisoned re-encryption with the real key |
| Hostile `--session` value (`../../etc/...`) | Tampering | `isValidSessionId` allowlist before path construction; non-matching ⇒ degrade, zero paths touched |
| Value leakage via audit/stderr/status | Info disclosure | Hash-only builder (never blind-spread — CR-01 lesson), constant-shape warnings, counts-only status, leak-grep regression over all three + error paths |
| Restore failure cascading into redaction | DoS on protection | Structural domain separation (no shared imports/flags), fence tests + chaos parity rerun prove redaction byte-identical with a hostile store |

## Sources

### Primary (HIGH confidence — read from the working tree this session)
- `src/state/session-map.ts` — RESTORABLE_TYPES, entry shapes, V2_TOKEN_RE, SESSION_ID_RE, parse-time floor, "Phase 10 adds the restore-side policy gate" reservation
- `src/state/map-store.ts` — readSessionMapFile total-error contract, envelope/AAD/key custody
- `src/state/index.ts` — facade contracts (why hydration is wrong for restore), applyRenamesToText simultaneity lesson (CR-01)
- `src/state/lock.ts`, `src/state/janitor.ts` — lock semantics (why reads take none), TTL-by-map-mtime, filename candidacy
- `src/placeholder/manager.ts` — v1/v2 allocation, OVF shared-token semantics
- `src/cli.ts` — subcommand + dynamic-import + entrypoint-guard idioms; `restore` name free
- `src/audit/log.ts`, `src/audit/canary-leak.ts` — LOCKED AuditRecord, builder discipline, leak helper semantics
- `src/doctor/checks.ts:552-597`, `src/doctor/index.ts` — check-8 copy locks, reserved exit 1, LOCKED exit map
- `src/mcp/tools/status.ts` — current schema/registration (zero-argument)
- `src/shared/sanitize-output.ts` — no-raw chokepoint precedent for error copy
- `tests/mcp/tools-list.test.ts` — FORBIDDEN_TOOL_NAMES + T2 exact-three (the REVMODE-01 CI check)
- `tests/state/cold-path.test.ts` — fence invariants Phase 10 must respect and extend
- `tests/audit/pii-canary-leak.test.ts`, `tests/copy-drift.test.ts`, `tests/cli/ignore.test.ts` — harness shapes to clone
- `.planning/phases/09-*/09-CONTEXT.md`, `09-07/09-08-SUMMARY.md`, `09-VALIDATION.md` — shipped-state ground truth, baselines (861/16 suite, 38-error typecheck)
- `.planning/phases/08-*/08-RESEARCH.md` §Pattern 3 + OQ3 — "unsupported config lands in Phase 10" pin; `08-03-SUMMARY.md` — reserved exit 1
- `THREAT_MODEL.md` §Reversible Mode — design commitments the CLI must honor; accepted residuals
- `.planning/REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` — requirement texts, gate names, cross-phase pins

### Secondary (MEDIUM confidence)
- `.planning/research/SUMMARY.md` / `FEATURES.md` / `ARCHITECTURE.md` — v3.0 milestone research (partially pre-reshape; used for gate definitions "canary round-trip" + "mixed-content canary" and the `restored/unmatched` counters concept; version-floor material superseded by T1)

### Tertiary (LOW confidence)
- LLM Guard / LiteLLM prior-art characterization — carried from milestone research citations, not re-fetched this session (zero design dependency; A6)

## Metadata

**Confidence breakdown:**
- Codebase integration map (read path, fences, seams, CI checks): HIGH — every claim verified against shipped source this session
- Restore engine pattern (single-pass, exact lookup, pass-through taxonomy): HIGH — determined by in-repo token/store contracts + settled prior art
- Doctor FAIL set + status counter sourcing: MEDIUM — post-reshape interpretation is well-evidenced (08-RESEARCH pin) but the precise matrix is a plan-time pin (Assumptions A1–A2)
- Validation architecture: HIGH — modeled on the approved 09-VALIDATION format with measured baselines

**Research date:** 2026-07-17
**Valid until:** ~2026-08-16 (internal-codebase research — invalidated only by upstream repo changes, not ecosystem drift)
