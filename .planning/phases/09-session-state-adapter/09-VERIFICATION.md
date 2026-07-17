---
phase: 09-session-state-adapter
verified: 2026-07-17T05:10:49Z
status: passed
score: 22/22 must-haves verified
overrides_applied: 0
requirements_verified: [REVMODE-02, REVMODE-04, REVMODE-05, REVMODE-06, REVMODE-07]
review_fixes_verified: [CR-01, WR-01, WR-02, WR-03, WR-04]
---

# Phase 9: Session State Adapter — Verification Report

**Phase Goal:** An enabled reversible session persists an encrypted, cross-process placeholder→original map with stable content-addressed allocation, a structural secret floor, and a reason-aware lifecycle janitor — while the one-way default stays byte-identical.
**Verified:** 2026-07-17T05:10:49Z
**Status:** passed
**Re-verification:** No — initial verification (no prior VERIFICATION.md)

Verification was performed against the actual codebase at HEAD (589a1ea), not SUMMARY claims. The full suite and typecheck were re-run in this verification's own process.

## Goal Achievement

### Observable Truths — ROADMAP Success Criteria (contract)

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| SC1 | Placeholders allocated in one hook event resolve to originals in a later hook process; map persists AES-256-GCM with fresh IV per write; sessions/ ciphertext-only incl. temp files; keys in separate 0700 dir; nothing in project tree | ✓ VERIFIED | `src/state/map-store.ts:124-136` (fresh `randomBytes(12)` IV per encrypt), `:331-342` (only ciphertext handed to write-file-atomic, mode 0600). `tests/state/inspection.test.ts:145-208` is a literal executable inspection: two-event flow where event 2 hydrates event 1's persisted entry (`counterFloor === 1`, `knownEntries === 1`), asserts every byte-file in sessions/ and keys/ contains neither originals nor `"entries"`, 0700 dirs / 0600 files, `findStateDirsUnder(process.cwd()) === []`. Handler-level round trip in `tests/hook/reversible-handlers.test.ts`. All green in suite run. |
| SC2 | Concurrent processes redacting the same original get identical placeholders (content-addressed under shared state); reversible sessions issue v2 `<MRCLEAN:TYPE:NNN:nonce8>`; one-way default keeps v1 format and code path byte-identical | ✓ VERIFIED | `tests/state/stress.test.ts:122` — 16 REAL spawned processes × 25 txns over 20 shared originals: 0 lost / 0 dups / 0 cross-process disagreements / 0 degrades (passed in suite). `src/state/session-map.ts:300-308` formatV2Token + V2_TOKEN_RE. v1 byte-identical: `src/placeholder/manager.ts:89-93` early-return gate (`this.reversible !== null`) leaves the v1 block untouched; `git log b5a16b0..HEAD -- tests/placeholder/manager.test.ts` shows ZERO phase 9 edits (last touched by phase-2 commit 302c77e); chaos parity + cold-path fence both green. |
| SC3 | Decrypting and dumping a session map shows secret-class entries structurally lack `original`; no configuration can widen the restorable set — only narrow it | ✓ VERIFIED | Three independent proof layers, all green: `tests/state/secret-floor.test.ts:130,142,224-225` (`'original' in entry === false` for all 18 secret-class TYPEs + unknown TYPEs); `tests/state/map-store.test.ts:428` (round-trip through the REAL encrypted file); `tests/state/inspection.test.ts:205-206` (live-flow decrypt-and-dump: WORD carries original, AWS_KEY lacks it). No-config-widening is structural: `src/state/session-map.ts` accepts no config parameter anywhere; `RESTORABLE_TYPES` is `Object.freeze`d code (lines 42-50); floor enforced at construction (`makeMapEntry`), write (`toPersistableEntry`), and read (`parseMapEntry` drops poisoned `original`). |
| SC4 | SessionEnd reason `clear`/`logout`/`prompt_input_exit`/`other` deletes the map; `resume` retains; TTL orphans (24h default, configurable) swept at SessionStart and MCP boot | ✓ VERIFIED | `src/state/janitor.ts:173-187` — retention is an allowlist of exactly `'resume'`; every other reason (incl. unknown strings and `bypass_permissions_disabled`) deletes key-then-map. Sweep sites: `src/hook/handlers/session-start.ts:43-48` and `src/mcp/server.ts:95-100`, both non-fatal try/catch, both pass `config.reversible.ttl_hours` (default 24 in `src/config/defaults.ts:73`, fail-closed integer>=1 validation in `src/config/index.ts:346-351`). `tests/state/janitor.test.ts` + `tests/hook/session-end.test.ts` green. |
| SC5 | Adapter holds against named Phase 11 gates at integration level: 8–16-process stress loses/corrupts no entries; corrupt/missing/chmod'd map treated as absent — redaction provably unaffected | ✓ VERIFIED | 16-process stress gate passed in this verification's own suite run (spawns `dist/state-stress-worker.js` — real processes, go-file barrier, zero-degrade assertion is load-bearing per test header). `tests/state/chaos.test.ts:153-311` — corrupt/missing/chmod-000/dir-as-map/delete-mid-session all assert handler output identical to one-way mode at handler level. |

### Observable Truths — Plan-Level (distinct from SCs)

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| T6  | proper-lockfile@^4.1.2 + write-file-atomic@^7.0.1 in dependencies; @types/proper-lockfile@^4.1.4 in devDependencies | ✓ VERIFIED | `package.json:72,74,84` — exact pins present |
| T7  | `[reversible].ttl_hours` fail-closed (non-integer or <1 ⇒ ConfigReadError naming file); default 24; per-field last-wins merge survives partial tables | ✓ VERIFIED | `src/config/index.ts:346-355` (`'[reversible].ttl_hours must be an integer >= 1'` via ConfigReadError with filePath); conditional-spread true-partial; merge doc at `:518-522`; `tests/config/reader.test.ts` + `merge.test.ts` green |
| T8  | hmacAddress deterministic per salt, differs across salts | ✓ VERIFIED | `src/state/session-map.ts:278-280` (HMAC-SHA256 keyed by hex-decoded per-session salt); secret-floor suite green |
| T9  | Decrypt rejects short envelope / bad magic / bad version / truncated tag / flipped byte / wrong AAD / wrong key — every read failure returns ABSENT (null), never throws | ✓ VERIFIED | `src/state/map-store.ts:147-168` validate-before-slice with `authTagLength: 16` (DEP0182 guard, line 163); `readSessionMapFile:295-307` single total catch → null; 33-case corruption matrix in `tests/state/map-store.test.ts:191-320` green |
| T10 | Hydrated store entries win (no counter burn, no pending entry); new reversible allocations drainable exactly once | ✓ VERIFIED | `src/placeholder/manager.ts:233-236` (cached HMAC hit returns before `counter++`/pending push); `drainPendingAllocations` at `:209`; `tests/state/tokens-v2.test.ts` green |
| T11 | A process whose provisional placeholder loses the race gets a rename to the store's placeholder before emission | ✓ VERIFIED | `src/state/index.ts:192-217` reconcilePending (adopt-existing / renumber / emit rename); `tests/state/allocation.test.ts` foreign-win + renumber + CR-01 chain cases green |
| T12 | Lock deadline exhaustion returns 'degraded' — nothing written, exactly one hash-only stderr warn, never a throw | ✓ VERIFIED | `src/state/lock.ts:98-150` deadline race (timer cleared in finally, late-acquire released, ELOCKED re-arm wall-clock-capped); `src/state/index.ts:271-281` single `warnPersistDegraded` (warn+sessionId only); `tests/state/allocation.test.ts:361+` held-lock case green |
| T13 | Invalid sids ('mcp-server', path traversal) make reversible unavailable — null/noop, zero filesystem paths touched | ✓ VERIFIED | `src/state/session-map.ts:321-326` strict UUID allowlist; `src/state/index.ts:158-161` (read) and `:252-254` (persist returns noop BEFORE any mkdir); janitor gates at `janitor.ts:173-175`; handlers gate first + facade re-checks (defense in depth) |
| T14 | First locked transaction creates key AND initial map before releasing | ✓ VERIFIED | `src/state/index.ts:220-237` — `ensureSessionKey` (step 1) and `writeSessionMapFile` (step 4) both inside `withMapLock` body |
| T15 | Janitor deletes KEY before MAP (both SessionEnd and TTL paths) | ✓ VERIFIED | `src/state/janitor.ts:186-187` and `:344-345` — key first at both sites, per-target isolation |
| T16 | TTL ages paired sessions by MAP mtime ONLY — old-key/fresh-map sessions survive | ✓ VERIFIED | `src/state/janitor.ts:339-347` — only `mapPathFor` is stat'ed for paired sids; key mtime never consulted; janitor tests green |
| T17 | Orphan halves, real wfa litter (`<uuid>.map.<digits>`), key-publish litter (`<uuid>.key.<digits>`), and stale lock dirs (`<uuid>.map.lock`) older than 60s grace are swept; fresh ones and foreign files (incl. foreign `*.tmp`) survive | ✓ VERIFIED | `src/state/janitor.ts:230-247` (isOwnLitterName/isOwnLockDirName — sid segment must match SESSION_ID_RE), `:351-398` sweep loops; no `*.tmp` rule exists anywhere (WR-01 fix) |
| T18 | Handlers hydrate the manager BEFORE detection and persist drained allocations in EXACTLY ONE locked transaction AFTER detection; renames applied to emitted output | ✓ VERIFIED | `src/hook/handlers/pre-tool-use.ts:183-200` (Step 2b hydrate) + `:278-294` (Step 6b single drain→persist→applyRenamesDeep); `post-tool-use.ts:98-113` + `:174-195` (applyRenamesToText on string updatedToolOutput); drain-and-DISCARD on deny/dry_run paths in both handlers |
| T19 | With reversible disabled, no static import of src/state/, proper-lockfile, or write-file-atomic in the hook-reachable module graph | ✓ VERIFIED | Repo-wide grep: cipher primitives, proper-lockfile, and write-file-atomic imports exist ONLY under `src/state/` (`lock.ts:24`, `map-store.ts:36`); `tests/state/cold-path.test.ts` (6-test import-graph fence incl. dynamic-import-count pins) green |
| T20 | PostToolUse emitted shape unchanged (string updatedToolOutput, E1); degrade/corrupt-store paths emit exactly one-way output | ✓ VERIFIED | `post-tool-use.ts:195` string-form updatedToolOutput; chaos parity suite compares full handler outputs disabled-vs-enabled-corrupt, green |
| T21 | Doctor check-8 enabled copy no longer says "plumbing only"; test asserts constant byte-for-byte | ✓ VERIFIED | `src/doctor/checks.ts:558-559` — `'reversible mode: enabled — encrypted session state adapter active'`; `tests/doctor/checks.test.ts` green in suite |
| T22 | Full suite green at post-fix baseline; typecheck at documented baseline; dist rebuilds landed as separate chore commits | ✓ VERIFIED | Ran here: **861 passed / 16 skipped, exit 0** (matches claimed baseline exactly). `npm run typecheck`: **38 errors** — byte-count match to documented baseline (deferred-items.md: 36 pre-existing + 2 pre-existing in `src/model/pipeline-singleton.ts` at the phase base commit); ZERO errors in any phase 9 file. Dist chores: a02b67f, 4ba417a, 551cfef, 589a1ea |

**Score:** 22/22 truths verified

### Review-Fix Closure (post-plan context — verified in code, not from SUMMARY)

| Finding | Fix Commit | Verified In Code | Status |
| ------- | ---------- | ---------------- | ------ |
| CR-01 rename-chain corruption | 4b7f457 (+ regression 6dee57d) | `src/state/index.ts:307-316` — single simultaneous pass via `Map` + escaped alternation regex; a rename output can never be re-matched. Regression tests at `tests/state/allocation.test.ts:306-355` (end-to-end: two allocations + foreign insertion land on DISTINCT store tokens, `corrected === y=<tokenY> z=<tokenZ>`) and `:523-537` (unit chain case, exact review repro shape). Both green. | ✓ CLOSED |
| WR-01 janitor swept wrong tmp shape | d3ab5fb | `src/state/janitor.ts` — sweeps `<uuid>.map.<digits>`, `<uuid>.key.<digits>`, `<uuid>.map.lock` dirs; generic `*.tmp` rule removed entirely; foreign files never candidates (sid segment must match SESSION_ID_RE) | ✓ CLOSED |
| WR-02 sweep gated on reversible.enabled | e654c6d | `session-start.ts:38-48` and `mcp/server.ts:92-100` — sweep now UNCONDITIONAL at both sites with WR-02 rationale comments; only map CREATION remains flag-gated | ✓ CLOSED |
| WR-03 torn key write | 993f108 | `map-store.ts:208-277` — `publishKeyOnce` writes 32 bytes to private `wx` tmp then `link(2)` publishes atomically (EEXIST = loser reads winner); read-back validates `length === KEY_BYTES` with unlink-and-recreate self-heal, bounded to 2 attempts; tmp litter shape matches janitor sweep | ✓ CLOSED |
| WR-04 chaos suite hits real home on win32 | 8c8c171 | `tests/state/chaos.test.ts:153` — `describe.skipIf(IS_WIN32)` on the whole parity suite; visible win32 placeholder describe at `:315-316` | ✓ CLOSED |

Info items IN-01..IN-05 remain open by design (informational; not required for phase goal). Notable residuals: `parseSessionMap` still assigns to a plain object (IN-01, defense-in-depth only); substitution handlers use two dynamic import sites vs the "exactly one" comment (IN-02, comment drift — fence test pins both counts).

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/state/session-map.ts` | Schema, frozen partition, floor, hmacAddress, formatV2Token, sid gate, contracts; >=120 lines | ✓ VERIFIED | 359 lines; all 10 declared exports present; wired into map-store/index/janitor/manager (type-only) |
| `src/state/map-store.ts` | GCM envelope, key custody, total read, wfa write; >=100 lines | ✓ VERIFIED | 342 lines; all 9 declared exports; `authTagLength: 16` (:163), `fsync: false` (:341) |
| `src/state/lock.ts` | Lock recipe + deadline-degrade; >=50 lines | ✓ VERIFIED | 183 lines; withMapLock/UPS_LOCK_DEADLINE_MS/POST_LOCK_DEADLINE_MS/LOCK_OPTS; `realpath: false` (:70) |
| `src/state/index.ts` | Facade: sid gate, hydration read, locked persist, renames; >=120 lines | ✓ VERIFIED | 350 lines; all 5 declared exports; consumed by both handlers via dynamic import |
| `src/state/janitor.ts` | runSessionEndJanitor + runTtlSweep, total-error, clock-injectable; >=80 lines | ✓ VERIFIED | 398 lines; all 3 declared exports; wired from session-end/session-start/mcp-server |
| `src/placeholder/manager.ts` | hydrateReversible/drainPending seam; v1 lines untouched | ✓ VERIFIED | hydrateReversible (:183), drainPendingAllocations (:209), v2 branch early-return; type-only state import (:27) |
| `src/detect/index.ts` | hydrateSessionManager/drainSessionAllocations pass-throughs | ✓ VERIFIED | :189-200 via getOrCreateManager — the seam both handlers consume |
| `src/hook/handlers/pre-tool-use.ts` / `post-tool-use.ts` | Reversible branches | ✓ VERIFIED | Contains persistAllocations / applyRenamesDeep / applyRenamesToText as declared |
| `src/hook/handlers/session-end.ts` / `session-start.ts` / `src/mcp/server.ts` | Janitor + sweep wiring | ✓ VERIFIED | Lazy `await import('../../state/janitor.js')` in try/catch at all three sites |
| `src/config/index.ts` / `defaults.ts` / `src/shared/types.ts` | ttl_hours widening | ✓ VERIFIED | Validation, default 24, type widening all present |
| `src/doctor/checks.ts` | check-8 enabled copy | ✓ VERIFIED | REVERSIBLE_DETAIL_ENABLED updated, byte-locked by test |
| `package.json` | Pinned deps | ✓ VERIFIED | proper-lockfile/write-file-atomic/@types pins present |
| `tsup.config.ts` | state-stress-worker test entry | ✓ VERIFIED | :17; `dist/state-stress-worker.js` exists (97 KB, rebuilt by globalSetup) |
| Tests: secret-floor (544L), map-store (631L), tokens-v2 (261L), lock (143L), allocation (577L), janitor (506L), session-end (in tests/hook), reversible-handlers, cold-path (230L), stress (220L) + worker fixture (200L), chaos (321L), inspection (214L) | Per-plan min_lines | ✓ VERIFIED | All exceed min_lines; all executed green in this verification's suite run |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| session-map.ts | detect/type-map.ts | TYPE_VOCABULARY import | ✓ WIRED | `:27` import; NEVER_RESTORABLE derived by filter (:60-62); vocabulary-sync test guards drift |
| map-store.ts | node:crypto | `authTagLength: 16` | ✓ WIRED | `:163` — single decrypt construction in codebase (repo-wide grep confirms no cipher calls outside src/state/) |
| map-store.ts | write-file-atomic | `fsync: false, mode: 0o600` | ✓ WIRED | `:341`; only wfa import site in src/ |
| map-store.ts | session-map.ts | serialize/parse on plaintext side | ✓ WIRED | `:38,303,337` |
| index.ts | lock.ts | persistAllocations wraps transaction in withMapLock | ✓ WIRED | `:268-270` |
| index.ts | map-store.ts | ensureSessionKey/read/write inside transaction | ✓ WIRED | `:227-234` |
| lock.ts | proper-lockfile | `realpath: false` recipe | ✓ WIRED | `:69-73`; only proper-lockfile import site in src/ |
| manager.ts | session-map.ts | TYPE-ONLY import (cold-path safe) | ✓ WIRED | `:27` `import type` — erased at runtime; fence test confirms |
| detect/index.ts | manager.ts | hydrateSessionManager via getOrCreateManager | ✓ WIRED | `:189-200` |
| pre/post-tool-use.ts | state/index.js | `await import` gated on config.reversible.enabled | ✓ WIRED | pre `:186`, post `:101` — inside enabled-gate + try/catch |
| pre/post-tool-use.ts | detect/index.ts | drainSessionAllocations (static, additive) | ✓ WIRED | Named imports; called on all four emit/discard paths |
| session-end.ts | janitor.ts | dynamic-only import in try/catch | ✓ WIRED | `:32` — no static janitor import (fence-tested) |
| janitor.ts | map-store.ts | statePaths/keyPathFor/mapPathFor derive delete targets | ✓ WIRED | `:48` — every delete target derived from path helpers |
| tsup.config.ts | stress-worker fixture | TEST-ONLY entry | ✓ WIRED | Entry `:17`; stress test spawns `dist/state-stress-worker.js` × 16 |
| doctor/checks.ts | checks test | enabled-copy constant byte-lock | ✓ WIRED | Pattern `reversible mode: enabled` asserted in test |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| pre-tool-use reversible branch | `persisted.renames` → `emittedInput` | drainSessionAllocations → persistAllocations → reconcilePending against decrypted store | Yes — stress + allocation tests prove store round-trip mutates emitted tokens | ✓ FLOWING |
| post-tool-use reversible branch | `emittedText` | Same chain via applyRenamesToText | Yes — reversible-handlers test asserts v2 tail on wire | ✓ FLOWING |
| Hydration → manager | `entriesByHmac` / `counterFloor` | readSessionMapFile (real decrypt of prior event's file) | Yes — inspection test: event 2 sees `counterFloor === 1`, `knownEntries === 1` from event 1's persisted state | ✓ FLOWING |
| TTL sweep sites | `ttlHours` | `config.reversible.ttl_hours` (validated, default 24) | Yes — real config value at both sites | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full suite incl. 16-process stress, chaos parity, inspection, floor, corruption matrix, CR-01 regressions | `npm test` | 90 files passed / 2 skipped; **861 tests passed / 16 skipped**; exit 0 | ✓ PASS |
| Typecheck at documented baseline | `npm run typecheck` | Exactly **38 errors**, all in pre-existing files (deferred-items.md set); zero in phase 9 files | ✓ PASS |
| v1 test file untouched by phase | `git log b5a16b0..HEAD -- tests/placeholder/manager.test.ts` | Empty — only ever touched by phase-2 commit 302c77e | ✓ PASS |
| Crypto/lock/wfa isolation | repo-wide grep | createCipheriv/createDecipheriv/proper-lockfile/write-file-atomic imports only under src/state/ | ✓ PASS |
| Stress worker bundle present | `ls dist/state-stress-worker.js` | 97,761 bytes, rebuilt during suite globalSetup | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| — | `find scripts -path '*/tests/probe-*.sh'` | No conventional probes exist; no probes declared in any phase 9 PLAN/SUMMARY | N/A (skipped — none declared or conventional) |

### Requirements Coverage

| Requirement | Source Plans | Description (abridged) | Status | Evidence |
| ----------- | ------------ | ---------------------- | ------ | -------- |
| REVMODE-02 | 09-01, 09-03, 09-07, 09-08 | Encrypted session-scoped map, AES-256-GCM fresh IV, key in separate 0700 dir, ciphertext-only incl. temp files, never in project tree | ✓ SATISFIED | SC1 evidence chain: map-store envelope + inspection test + handler wiring |
| REVMODE-04 | 09-05, 09-07, 09-08 | Collision-free stable placeholders across concurrent processes via content-addressed allocation | ✓ SATISFIED | SC2/T11-T14: HMAC addressing, locked reconcile, 16-process stress gate zero disagreements |
| REVMODE-05 | 09-04, 09-07 | v2 session-tagged tokens with CSPRNG nonce; v1 one-way format and code path byte-identical | ✓ SATISFIED | SC2/T10: formatV2Token, hydration-gated branch, zero v1 test edits, cold-path fence |
| REVMODE-06 | 09-02 | Secret-class originals never persisted; entries structurally lack `original`; no config can widen | ✓ SATISFIED | SC3: three-layer floor, frozen partition, no config surface in module |
| REVMODE-07 | 09-01, 09-06 | Reason-aware SessionEnd (delete/retain), TTL sweep at SessionStart + MCP boot, configurable 24h; installer SessionStart matcher widening | ✓ SATISFIED | SC4/T15-T17: janitor + both sweep sites + ttl_hours config. Installer matcher clause (`startup|resume|clear|compact`) shipped in Phase 8 (commit a943b56, 08-02) and present at `src/install/settings.ts:27` with `_mrclean`-tagged idempotent upgrade as the migration path — no overclaim: the codebase satisfies every clause at the time the requirement is marked Complete |

**Orphaned requirements check:** REQUIREMENTS.md maps exactly REVMODE-02/04/05/06/07 to Phase 9 (lines 59-64); REVMODE-03 → Phase 8 (Complete), REVMODE-01/08/09 → Phase 10 (Pending). No orphans. All five Phase 9 rows marked Complete are honest.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | No TBD/FIXME/XXX/TODO/HACK markers in any phase-modified source file | — | None |
| pre-tool-use.ts / post-tool-use.ts | 46-48 / 39-43 | Comment says "EXACTLY ONE dynamic import site" but handlers use two (`state/index.js` + `state/lock.js`) | ℹ️ Info | Review IN-02 (open by design); fence test pins both counts, so the graph is still enforced — comment drift only |
| session-map.ts | 256 | `entries[key] = entry` on plain object (`__proto__` key drops entry) | ℹ️ Info | Review IN-01 (open by design); writer can only emit hex keys; impact is entry-loss under an attacker who already holds the session key |

### Human Verification Required

None. Every success criterion in this phase was authored as a machine-checkable proof ("...in a test", "at integration level", literal dir-inspection test), and every proof was re-executed in this verification's own process (suite exit 0). No plan defers `<human-check>` items. Live-wire adversarial end-to-end verification (real Claude Code session) is the explicit charter of Phase 11 ("Wire-Safety Verification & Hardening — CI proves the milestone's negative claims... via adversarial end-to-end gates"), against whose named gates this phase built and passed integration-level equivalents (SC5).

### Gaps Summary

No gaps. All 22 must-haves verified against the codebase; all 5 review findings (1 critical, 4 warnings) confirmed fixed in code with regression coverage; suite and typecheck independently reproduced at the claimed baselines.

Notes for the record (non-gaps):

- **WR-02 trade-off:** the TTL sweep now dynamically imports `state/janitor.js` (and transitively map-store/wfa) at SessionStart and MCP boot even when reversible is disabled. This is deliberate (crash-residue privacy beats module-load purity), documented in code, and does not touch the substitution handlers' cold path or any emitted output — SC2's byte-identical clause is about the v1 placeholder format and substitution code path, which chaos parity + the fence + zero-edit v1 tests prove intact. Review IN-05 suggests a leaf `paths.ts` module if the load ever matters.
- **Typecheck baseline is 38, not the 36 cited in the 09-08 plan truth:** the drift (2 pre-existing errors in `src/model/pipeline-singleton.ts` from an optionalDependency minor resolve) is documented in `deferred-items.md`, exists at the phase base commit, and the differential gate was applied against the actual 38-error set — zero new errors from Phase 9.

---

_Verified: 2026-07-17T05:10:49Z_
_Verifier: Claude (gsd-verifier)_
