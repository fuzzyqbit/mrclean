---
phase: 10-operator-restore
verified: 2026-07-18T00:26:53Z
status: passed
score: 41/41 must-haves verified
overrides_applied: 0
---

# Phase 10: Operator Restore Verification Report

**Phase Goal:** Operator can round-trip redacted content locally — `mrclean restore` turns policy-permitted placeholders back into originals with fail-one-way degradation, hash-only audit, and honest doctor/status reporting; zero model-facing restore surface
**Verified:** 2026-07-18T00:26:53Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| SC1 | Operator pipes redacted text (stdin or file) through `mrclean restore` → restored stdout; exact map lookup, single-pass scan; unknown/stale/OVF pass through; planted/enumerated tokens never restored | ✓ VERIFIED | `src/restore/index.ts` (98 lines): exact `index.get(token)` full-token lookup with nonce8, OVF short-circuit BEFORE lookup, single `String.replace` pass. `tests/restore/engine.test.ts` 15/15 green (taxonomy `it.each`, no-cascade describe at L203, grammar sync-lock at L325: `V2_TOKEN_RE.source === '^'+V2_TOKEN_SCAN_RE.source+'$'`). CLI wired: `src/cli.ts:127-133` `.command('restore [file]')` + dynamic import; stdin+file modes tested (`tests/cli/restore.test.ts` green). Live spot-check: `printf ... \| node <symlink-to-dist/cli.js> restore` piped through with exit 0 |
| SC2 | Mixed doc restores real paths/names while every secret-class placeholder survives; no `restore` MCP tool; `restore` on FORBIDDEN_TOOL_NAMES with CI check passing | ✓ VERIFIED | `tests/restore/mixed-canary.test.ts` (252 lines) green: REAL pipeline (persistAllocations → readSessionMapFile → runRestore), 0 `formatV2Token` calls, WORD `zz-canary-project-path-7g2` restores, AWS placeholder byte-identical, `AKIAIOSFODNN7EXAMPLX` never on stdout. `tests/mcp/tools-list.test.ts`: `'restore'` in FORBIDDEN_TOOL_NAMES (L55), exact-three `toEqual(['mrclean_check','mrclean_redact','mrclean_status'])` (L100) — passed inside `npm test`. Both-direction fences live (`tests/state/cold-path.test.ts` L302 describe, positive controls + documented sabotage spot-check) |
| SC3 | Map missing/corrupt/locked → one-way degrade: placeholders visible + warning, no tool call blocked, redaction provably unaffected (separate error domains, no shared kill switch) | ✓ VERIFIED | `tests/restore/degrade.test.ts` (403 lines) green: rows (a)–(f) assert byte-identical stdout + exactly-2-line constant stderr + no exit + listings/mtime snapshots unchanged; row (g) holds a REAL `lockfile.lock(mapPath, LOCK_OPTS)` (L365), restore completes lock-free, `lockfile.check` still true after (L385). `tests/state/chaos.test.ts` green in full suite (redaction parity). Outbound allowlist fence (rule 3) structurally bans config/hook/detect-engine imports from `src/restore/` — no kill switch can exist. Live spot-check: no-maps degrade through dist binary = pass-through + constant warning + exit 0 |
| SC4 | Every restore audited hash-only (never raw values); extended leak-grep passes over map artifacts, restore code paths, and error paths | ✓ VERIFIED | `src/audit/restore-log.ts` (217 lines): destructure-pick LOCKED builder (L78-90), module never hashes (caller boundary); `src/restore/cli.ts:197` `[...new Set(restoredOriginals)].map(redactedHash).sort()`. `tests/audit/restore-canary-leak.test.ts` (497 lines) green: four-surface invariant matrix, success path + garbage-key + chmod-000 + hand-poisoned real-key ciphertext (L417) all swept, non-vacuity guards first. `tests/state/inspection.test.ts` extension green: store byte-inert across a restore run |
| SC5 | `mrclean doctor` FAILs loud (never silent no-op) on unsupported reversible config; `mrclean_status` reports entry counts by class + restored/unmatched counters — never values | ✓ VERIFIED | `src/doctor/checks.ts:613-624`: raw-layer scan via `readRawReversibleKeys` (never the tolerant loader), FAIL detail `unsupported [reversible] key(s): <file>: <key>` with `exitCodeOnFail: 1`; LOCKED detail constants intact (L563-566); `src/doctor/index.ts:150` pushes the check (zero-diff since base). `src/mcp/tools/status.ts`: `reversible` block is z.boolean/z.number only (L50-57), input stays `z.object({})` (L39), counts via `countSessionEntries` reducer inside src/state/, totals via `aggregateRestoreCounters`. Suites green incl. planted-canary absence + Tests 15-17 byte-locked |

**Score:** 5/5 roadmap SCs verified; 36/36 plan-frontmatter truths verified (rollup below) — 41/41 total

### Plan-Truth Rollup (36 truths across 8 plans)

| Plan | Truths | Status | Key evidence |
| ---- | ------ | ------ | ------------ |
| 10-01 (engine) | 4 | ✓ all | Exact-hit-only + taxonomy (15 tests), no-cascade single-pass, secret skippedSecret pass-through (index.ts L79-84), `V2_TOKEN_SCAN_RE` unanchored global twin (session-map.ts L321) sync-locked by test |
| 10-02 (index) | 5 | ✓ all | Read-side gate `isRestorableType && 'original' in entry` (session-index.ts L138-151); hand-poisoned map (`zz-poisoned-secret-original` encrypted under REAL key, test L347) contributes nothing; OVF excluded at build (L147); total-error skip + absent-dir empty; `isValidSessionId` before ANY path derivation (L118-120) |
| 10-03 (audit record) | 4 | ✓ all | Builder input type carries counts + pre-hashed strings only, destructure-pick; heterogeneous JSONL coexistence tested; aggregator never throws (WR-01 strict `counterOrZero` + MAX_SAFE_INTEGER clamp, L174-181 + tamper matrix tests L246-283); `src/audit/log.ts` zero-diff since e950d76 (LOCKED unions untouched) |
| 10-04 (doctor) | 4 | ✓ all | Unknown-key FAIL exit 1 naming file+key; three LOCKED PASS/SKIP detail strings byte-identical; ConfigReadError → existing SKIP (no double-FAIL, checks.ts L642); LOCKED exit map untouched |
| 10-05 (CLI) | 6 | ✓ all | stdout=payload-only / stderr=diagnostics (HOOK-06); all cosmetic failures degrade one-way exit 0; lock-held row (g) direct evidence; hard errors exit via `process.exitCode = 2` + return (WR-03 fix, cli.ts L142-159), sid never echoed; zero litter (listings+mtimes snapshots); one hash-only audit line per completed restore |
| 10-06 (status) | 5 | ✓ all | Counters block numbers/booleans only; reducer inside src/state/ (`counts.ts`, `original` never read — classification type-based only); `z.object({})` input unchanged; per-source `.catch` zeros never-throw; honest scoping copy in description (status.ts L90-91) |
| 10-07 (fences+canary) | 4 | ✓ all | Rule 1 total `'/restore/'` ban on hook set; rule 2 full-src confinement to cli.ts's single dynamic site (`countAwaitImports===1` positive control); rule 3 five-pattern outbound allowlist; mixed canary real-pipeline; T2/T2b green unmodified |
| 10-08 (leak-grep+gate) | 4 | ✓ all | Secret canary on NO surface / restorable canaries ONLY on stdout; forced-failure paths swept; store byte-inert; phase gate re-executed by verifier: `npm test` 962 passed / 18 skipped exit 0, typecheck exactly 38 (0 in phase files), frozen-tree zero-diff |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/restore/index.ts` | restoreText + RestoreResult, ≥40 lines, pure | ✓ VERIFIED | 98 lines; exports both; zero node:fs/node:crypto/config; imported by cli.ts + 3 test suites |
| `src/restore/session-index.ts` | buildRestoreIndex + RestoreIndex, ≥50 lines | ✓ VERIFIED | 154 lines; WR-02 case-insensitive filter fix present (L123-127); wired into restore/cli.ts |
| `src/restore/cli.ts` | runRestore + RunRestoreOpts, ≥80 lines | ✓ VERIFIED | 225 lines; composes index→engine→stdout→audit; WR-03 exitCode+return gates; wired via dynamic import from src/cli.ts and driven by 4 test suites |
| `src/audit/restore-log.ts` | 4 exports, ≥60 lines | ✓ VERIFIED | 217 lines; RestoreAuditRecord/buildRestoreAuditRecord/writeRestoreAuditRecord/aggregateRestoreCounters; WR-01 strict guard + clamp; consumed by restore/cli.ts and mcp/tools/status.ts |
| `src/state/counts.ts` | countSessionEntries + SessionEntryCounts, ≥40 lines | ✓ VERIFIED | 98 lines; counts-only projection, `original` never touched; consumed by status.ts |
| `src/state/session-map.ts` | V2_TOKEN_SCAN_RE additive export | ✓ VERIFIED | L321 beside V2_TOKEN_RE (L308); git diff +13/-0 (additive-only gate met) |
| `src/config/index.ts` | readRawReversibleKeys + SUPPORTED_REVERSIBLE_KEYS | ✓ VERIFIED | L510 + L527; consumed by doctor checks.ts L613-616 |
| `src/doctor/checks.ts` | contains "unsupported [reversible] key" | ✓ VERIFIED | L623 FAIL detail; exitCodeOnFail 1 |
| `src/mcp/tools/status.ts` | reversible block; zero-arg input unchanged | ✓ VERIFIED | L50-57 schema; L39 `z.object({})`; registered in server.ts L130 (call site untouched — optional 5th param defaults) |
| `src/cli.ts` | `restore [file]` subcommand, dynamic-only import | ✓ VERIFIED | L127-133; 0 static restore imports; entrypoint guard now `isMainEntry` (CR-01 fix) |
| `src/shared/entrypoint.ts` (CR-01 fix) | URL-canonical main guard, both bins | ✓ VERIFIED | pathToFileURL + realpath fallback; used by src/cli.ts L143 AND src/mcp.ts L19; regression suite `tests/cli/entrypoint-guard.test.ts` green |
| 13 test files (engine, session-index, restore-log, reversible-raw-keys, checks, cli/restore, degrade, counts, status-reversible, cold-path, mixed-canary, restore-canary-leak, inspection) | all min_lines met, all green | ✓ VERIFIED | 122 passed / 3 platform-skipped in a single verifier-run invocation; line counts 112–666, all above plan minimums |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| src/restore/index.ts | src/state/session-map.ts | V2_TOKEN_SCAN_RE import | ✓ WIRED | Import at L28; no local regex literal |
| tests/restore/engine.test.ts | src/restore/index.ts | table-driven restoreText | ✓ WIRED | 15 assertions |
| src/restore/session-index.ts | src/state/map-store.ts | readSessionMapFile + statePaths | ✓ WIRED | Sole decrypt chokepoint; no own crypto (grep 0) |
| src/restore/session-index.ts | src/state/session-map.ts | isRestorableType + SESSION_ID_RE + isValidSessionId | ✓ WIRED | L36 import, gate at L118/L140 |
| src/audit/restore-log.ts | src/audit/log.ts | AuditWriteError import only | ✓ WIRED | L29; log.ts zero-diff |
| src/restore/cli.ts | src/audit/restore-log.ts + src/detect/findings.ts | redactedHash → buildRestoreAuditRecord → writeRestoreAuditRecord | ✓ WIRED | L46-47 imports; L197-205 usage (SDK false-negative on this link was a `from`-path suffix "(10-05)" parsing artifact — manually confirmed) |
| src/cli.ts | src/restore/cli.ts | `await import('./restore/cli.js')` in .action() | ✓ WIRED | L133; exactly 1 dynamic site, 0 static (SDK false-negative was the regex-escaped pattern — manually confirmed; fence test independently locks it) |
| src/restore/cli.ts | src/restore/index.ts + session-index.ts | restoreText over buildRestoreIndex | ✓ WIRED | L173 + L182 |
| src/mcp/tools/status.ts | src/state/counts.ts | countSessionEntries only (never direct map reads) | ✓ WIRED | L30 + L112; grep for map-store/session-map in status.ts = 0 |
| src/mcp/tools/status.ts | src/audit/restore-log.ts | aggregateRestoreCounters(getCwd()) | ✓ WIRED | L31 + L115 |
| src/doctor/checks.ts | src/config/index.ts | readRawReversibleKeys per layer | ✓ WIRED | L33 import, L613-616 both layers, user first |
| tests/state/cold-path.test.ts | src/cli.ts | positive control countAwaitImports === 1 | ✓ WIRED | L355 |
| tests/restore/mixed-canary.test.ts | src/restore/cli.ts | runRestore over persisted real state | ✓ WIRED | L51 import; persistAllocations L94 |
| tests/audit/restore-canary-leak.test.ts | src/audit/canary-leak.ts + src/restore/cli.ts | assertNoCanaryLeak + runRestore | ✓ WIRED | assertNoCanaryLeak x3, runRestore across success + error paths |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| restore stdout | `result.text` | restoreText ← buildRestoreIndex ← readSessionMapFile (AES-GCM decrypt of real store) | Yes — mixed-canary proves persisted originals flow to stdout | ✓ FLOWING |
| audit.jsonl restore line | `hashes` | redactedHash of engine's restoredOriginals | Yes — seam test parses written line, hashes match expected redactedHash values | ✓ FLOWING |
| status `reversible` block | counts + totals | countSessionEntries (decrypted maps) + aggregateRestoreCounters (audit stream) | Yes — seeded-fixture test asserts sessions:2/restorable:3/secret:1 and restored_total:3/unmatched_total:1 from real files | ✓ FLOWING |
| doctor check 8 FAIL detail | offenders | readRawReversibleKeys raw TOML parse (pre-validation) | Yes — planted `restore_secrets = true` produces FAIL naming file+key | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| All 13 phase suites pass | `npx vitest run <13 files> --project=unit` | 122 passed / 3 skipped, 362ms | ✓ PASS |
| Full-suite phase gate | `npm test` | 962 passed / 18 skipped, exit 0 (matches claimed gate) | ✓ PASS |
| Typecheck differential | `npm run typecheck` grep-counted | TOTAL=38 (== pre-existing baseline), PHASE10=0 | ✓ PASS |
| Frozen-tree zero-diff | `git diff --stat e950d76..HEAD -- src/hook src/detect src/placeholder tests/placeholder tests/detect` | empty | ✓ PASS |
| CR-01 fixed in shipped artifact | `ln -s dist/cli.js /tmp/.../mrclean-link && node <link> --version` | prints `1.0.0-rc.9` (pre-fix: silent exit 0, no output) | ✓ PASS |
| Live degrade through symlinked bin | `printf 'hello <MRCLEAN:WORD:001:aabbccdd> world' \| node <link> restore` (tmp cwd, no maps) | token passed through byte-identical on stdout, constant-shape warnings + summary on stderr, exit 0 | ✓ PASS |
| TDD gate ordering | `git log --grep` per plan | RED test-commit precedes GREEN feat-commit for 10-01..05 (e88edb8→f41a710, 1341b6a→e2e3bf3, 59fcaf5→632db78, 32d2761→a3c149c, f361eff→dca3bcb) | ✓ PASS |
| Review-fix commits present | `git log` | 4e09374 (CR-01), 32b4079 (WR-01), a162909 (WR-02), a23a99a (WR-03), 9ff5278 (statuses), c2c60ba (dist rebuild from main tree) | ✓ PASS |
| dist worktree shim-path landmine | `grep -c '../../..' dist/cli.js` | 0 | ✓ PASS |

### Probe Execution

No probe-script convention in this project (`find scripts -path '*/tests/probe-*.sh'` → none; no PLAN/SUMMARY probe declarations). Verification runs through vitest suites, executed above. Step 7c: N/A.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
| ----------- | ------------ | ----------- | ------ | -------- |
| REVMODE-01 | 10-01, 10-02, 10-05, 10-07 | Local restore CLI (stdin/file→stdout), exact map lookup, single-pass, policy-filtered; unknown/stale/OVF pass through; no hook-path restore, no MCP tool, FORBIDDEN_TOOL_NAMES CI-enforced | ✓ SATISFIED | Engine + index + CLI + fences all verified above; T2/T2b green; `restore` at tools-list.test.ts L55 |
| REVMODE-08 | 10-05, 10-07 | Fail one-way (placeholders visible + warning), never blocks a tool call or disables redaction; separate error domains, no shared kill switch | ✓ SATISFIED | 7-row degrade matrix incl. lock-held liveness; chaos parity green; outbound allowlist fence makes kill-switch coupling a CI failure |
| REVMODE-09 | 10-03, 10-08 | Restore audited hash-only; leak-grep extended over map artifacts, restore code paths, error paths | ✓ SATISFIED | Structural no-raw builder; four-surface matrix over success + 3 forced-failure paths; store byte-inert |
| REVMODE-12 | 10-04, 10-06 | Doctor FAILs loud on unsupported reversible config; status exposes entry counts by class + restored/unmatched counters, never values | ✓ SATISFIED | FAIL exit 1 naming file+key; LOCKED constants byte-identical; numbers/boolean-only schema; planted-canary absence test |

Orphan check: REQUIREMENTS.md traceability maps exactly these four IDs to Phase 10 (all marked Complete) — no orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | No TBD/FIXME/XXX, no TODO/HACK, no console.log, no empty-return stubs in any phase source file | — | Clean |

Review-deferred Info residuals (documented, not debt markers, not must-have failures): IN-01 (stale counts on a pathological stdout-destroyed double-fault; fallback write can rethrow), IN-02 (cross-session identical-token collision is last-write-wins, birthday-bounded ~2⁻³² — comment overstates "structurally absent"), IN-03 (unsalted 16-hex audit hashes dictionary-confirmable — matches shipped hook discipline, recorded as a decision), IN-04 (readRawReversibleKeys duplicates readConfigLayer scaffolding ~20 lines). All four are stamped deferred in 10-REVIEW.md with rationale; Phase 11 (adversarial end-to-end wire gates + THREAT_MODEL.md finalization) is the natural landing zone for IN-01/IN-02 hardening if wanted.

### Disconfirmation Pass (Confirmation Bias Counter)

1. **Partially-met requirement probe:** REVMODE-08's "exit 0 on every cosmetic failure" has one untested pathological path — stdout stream destroyed mid-write (IN-01). Outside the tested matrix; when stdout is gone the consumer is gone, so nothing is "blocked". Info-level residual, not a truth failure.
2. **Vacuous-test probe:** The 10-07 plan's own tools-list gate invocation (`--project=integration`) would have been vacuous (matches zero files); the executor detected and corrected this during execution (ran under `--project=unit` post-build) and documented it. Fence suites carry anti-vacuity positive controls plus a documented sabotage spot-check (planted import tripped rules 1+2, then reverted). No live vacuous test found.
3. **Uncovered-error-path probe:** chmod-000 rows are POSIX-gated with visible platform-skip placeholders; win32 behavior is an accepted documented inherited gap (planner pin A1). All other forced-failure paths (garbage key, corrupt ciphertext, truncated envelope, poisoned store, held lock, audit-write failure) have direct coverage.

### Human Verification Required

None. VALIDATION.md declares no manual-only behaviors; no plan carries `<human-check>` blocks; and every success criterion was verified against executed tests, direct code reads, and a live run of the shipped dist artifact (symlinked-bin `--version` + restore degrade round-trip). The end-to-end live-hook wire gates are Phase 11's explicit scope (built on this phase's mixed-content canary substrate), not a Phase 10 deliverable.

### Gaps Summary

No gaps. All 5 roadmap success criteria and all 36 plan-frontmatter truths are observably true in the codebase. The phase is provably additive outside its sanctioned seams (frozen trees zero-diff since e950d76; LOCKED modules src/audit/log.ts, src/audit/canary-leak.ts, src/doctor/index.ts, src/mcp/server.ts untouched; session-map.ts +13/-0). The post-review fix pass (CR-01, WR-01..03) is verified in source, in regression tests, and empirically against the rebuilt dist artifact.

---

_Verified: 2026-07-18T00:26:53Z_
_Verifier: Claude (gsd-verifier)_
