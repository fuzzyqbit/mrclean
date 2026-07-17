---
phase: 9
slug: session-state-adapter
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-17
---

# Phase 9 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| npm registry → node_modules | third-party code enters runtime tree at install (proper-lockfile, write-file-atomic) | executable code |
| operator TOML → effective config | untrusted config values cross into janitor TTL math | config values |
| detection findings → persisted map entries | raw secret values cross from memory toward disk; the secret-class floor is THE control | secrets / originals |
| hook payload sid → filesystem paths | SESSION_ID_RE allowlist gates every path consumer (facade, janitor) | untrusted session IDs |
| memory plaintext → disk | encrypt-before-any-write line; temp files included | plaintext map contents |
| on-disk artifacts → decrypt path | hostile/corrupt bytes may be fed to the reader (chaos surface) | untrusted ciphertext |
| concurrent processes → shared map file | locked transaction is the mutual-exclusion boundary | map state |
| hook payload (sid, reason) → filesystem DELETES | janitor turns untrusted input into unlink targets — highest blast radius in phase | delete targets |
| shared ~/.mrclean dirs → sweep decisions | any user process can plant files in swept directories | foreign files |
| tool_input / tool_response → wire (model-facing stdout) | rename application decides which tokens actually ship | placeholders vs originals |
| config + sid → reversible activation | the gate keeping one-way sessions byte-identical | activation state |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-09-SC | Tampering (supply chain) | proper-lockfile, write-file-atomic, @types/proper-lockfile | mitigate | slopcheck [OK] all three (09-RESEARCH.md:121); versions pinned in package.json:72,74,84; no postinstall scripts | closed |
| T-09-01-01 | Tampering | validateReversibleConfig | mitigate | fail-closed ConfigReadError on invalid ttl_hours — src/config/index.ts:346-350 (NaN/Infinity fail Number.isInteger) | closed |
| T-09-01-02 | DoS | mergeConfigs reversible branch | mitigate | per-field `??` accumulation — src/config/index.ts:569-573; Test G mirror tests/config/merge.test.ts:144-159 | closed |
| T-09-02-01 | Info disclosure | makeMapEntry / serializeSessionMap | mitigate | secret-class lacks `original` at type level (session-map.ts:83-87) + write-strip (:167-177) + read-drop (:219-223); tests/state/secret-floor.test.ts:121-432 | closed |
| T-09-02-02 | Info disclosure | hmacAddress | mitigate | HMAC-SHA256 (session-map.ts:278-280), per-session 32-byte CSPRNG salt (:118,130) stored only inside encrypted envelope | closed |
| T-09-02-03 | Info disclosure | v2 tokens | mitigate | per-session CSPRNG nonce8 embedded in every token — session-map.ts:117,129,300-305 | closed |
| T-09-02-04 | EoP | SESSION_ID_RE | mitigate | strict UUID allowlist, never sanitize-by-transform — session-map.ts:321-326 | closed |
| T-09-02-05 | Info disclosure | HMAC collision | accept | ~2^-128/pair; comment tagged "ACCEPTED RESIDUAL (T-09-02-05)" at session-map.ts:274-276 | closed |
| T-09-03-01 | Tampering | decryptMapBuffer | mitigate | envelope length/magic/version validated before slicing (map-store.ts:148-156), authTagLength:16 explicit (:163); truncated-tag tests map-store.test.ts:230-248 | closed |
| T-09-03-02 | Spoofing | envelope AAD | mitigate | AAD = mrclean-map-v1:<sid> on encrypt+decrypt — map-store.ts:56,113-115,127,164; cross-sid decrypt throws (test :293) | closed |
| T-09-03-03 | Info disclosure | writeSessionMapFile temp files | mitigate | wfa receives ciphertext only (map-store.ts:337-341); SC1 byte-scan test map-store.test.ts:447-460 | closed |
| T-09-03-04 | Info disclosure | key custody | mitigate | keys/ 0700 separate from sessions/ 0700, key file 0600, pure randomBytes(32) — map-store.ts:58-59,77,248,268,340; POSIX asserts test :357-365 | closed |
| T-09-03-05 | Tampering | IV handling | mitigate | fresh randomBytes(12) per encryption event, never stored/reused — map-store.ts:125; divergence tests :214-221,431-444 | closed |
| T-09-03-06 | DoS | fsync inside future lock | mitigate | fsync:false pinned with safety-argument comment — map-store.ts:317-324,341 | closed |
| T-09-03-07 | Info disclosure | win32 advisory modes | accept | chmod advisory-only on win32; header comment map-store.ts:28-31 + skipIf(IS_WIN32) with Pitfall 8 comments in tests | closed |
| T-09-04-01 | Info disclosure | v2 tokens (allocator) | mitigate | nonce8 via injected formatToken closure — manager.ts:254, state/index.ts:141; tag asserted on NNN+OVF shapes tokens-v2.test.ts:58,126 | closed |
| T-09-04-02 | Info disclosure | pending buffer / warns | mitigate | PendingAllocation memory-only (manager.ts:71,267); sole stderr emission = hash-free overflow warn (:242-251) | closed |
| T-09-04-03 | Tampering | v1 path regression | mitigate | early-return into allocateReversible (manager.ts:91-93), v1 block :95-137 untouched; byte-identical gate tokens-v2.test.ts:227 | closed |
| T-09-04-04 | DoS | hook cold path | mitigate | type-only imports erased (manager.ts:27, detect/index.ts:70); import-graph fence tests/state/cold-path.test.ts:132-204 | closed |
| T-09-04-05 | Spoofing | OVF token collisions | accept | OVF never restored (session-map.ts:293-294); expected-degradation comments manager.ts:119,265; stress exemption documented stress.test.ts:151-155 | closed |
| T-09-05-01 | EoP | sid → path interpolation | mitigate | isValidSessionId gates BOTH facade entry points before any path join — state/index.ts:158-161,252-254; zero-fs-artifact tests allocation.test.ts:421-458 | closed |
| T-09-05-02 | Tampering | concurrent map writes | mitigate | proper-lockfile mutex wrapping read→reconcile→allocate→encrypt→write — lock.ts:24,110, state/index.ts:220-237,268-270; D-02 restated lock.ts:6-8 | closed |
| T-09-05-03 | DoS | lock contention vs hook budget | mitigate | retry ladder ~46-190ms giveup + deadlineMs race + degrade-to-process-local — lock.ts:69-73,98-150, state/index.ts:271-281 (ELOCKED re-arm bounded by deadline, 09-08 strengthening) | closed |
| T-09-05-04 | DoS | crashed lock holder | mitigate | stale:2500 (lock.ts:71) + signal-exit release (:19-21); degraded path never throws (:142-144 + facade catch) | closed |
| T-09-05-05 | Info disclosure | degrade/reject warns | mitigate | single-line JSON warns, sessionId only, hostile sid never echoed — state/index.ts:110-124; stderr-spy tests allocation.test.ts:384-390,450-454 | closed |
| T-09-05-06 | Info disclosure | first-allocation window | mitigate | key AND initial map written inside first locked transaction before release — state/index.ts:227-234; test allocation.test.ts:154-158 | closed |
| T-09-05-07 | Tampering | degraded-mode divergent placeholders | accept | warned once (state/index.ts:120-124), cosmetic restore-scope; SC5 asserts zero degrades under 16-way stress (stress.test.ts:189-192) | closed |
| T-09-06-01 | EoP | runSessionEndJanitor sid handling | mitigate | isValidSessionId before any delete-path derivation — janitor.ts:173-175; decoy-survival tests janitor.test.ts:186-228 | closed |
| T-09-06-02 | Info disclosure | retention decision | mitigate | allowlist retain-on-'resume' only, unknown reasons delete — janitor.ts:179-181; fabricated-future-reason test janitor.test.ts:57-64 | closed |
| T-09-06-03 | Info disclosure | crash/partial-delete residue | mitigate | key deleted FIRST (janitor.ts:186-187,344-345) — orphaned ciphertext dead without key; undeletable-map test janitor.test.ts:156 | closed |
| T-09-06-04 | DoS | sweep deleting live sessions | mitigate | paired aging by MAP mtime only — janitor.ts:339-347; live-session-survives test janitor.test.ts:230 | closed |
| T-09-06-05 | DoS | janitor errors at session end / boot | mitigate | total functions + swallow-and-audit at all three call sites — session-end.ts:31-36, session-start.ts:43-48, mcp/server.ts:95-100 | closed |
| T-09-06-06 | Tampering | deleting foreign files in shared dirs | mitigate | candidacy allowlist `<uuid>.{key,map}[.<digits>]` + `<uuid>.map.lock` — janitor.ts:216-296 (narrower than register's `*.tmp`: foreign tmp never deletable); test janitor.test.ts:422-455 | closed |
| T-09-06-07 | Info disclosure | idle-session sweep loss | accept | fail-toward-privacy docstring janitor.ts:5-10; 09-RESEARCH.md:261 Pitfall 4 | closed |
| T-09-07-01 | Info disclosure | handler reversible branch | mitigate | stdout ships substituted placeholders only; originals only via persistAllocations — pre-tool-use.ts:278-303, post-tool-use.ts:174-198; tests reversible-handlers.test.ts:272,459 | closed |
| T-09-07-02 | DoS | facade errors on PreToolUse | mitigate | try/catch around every reversible block + total facade (double wall) — pre-tool-use.ts:185-199,226-232,247-253,279-293 + post mirror; chaos parity chaos.test.ts:235-306, facade-rejection reversible-handlers.test.ts:420,591 | closed |
| T-09-07-03 | Tampering | one-way path drift | mitigate | import-graph fence incl. exactly-one-dynamic-import-per-handler (cold-path.test.ts:132-204); disabled-path zero-facade-call tests reversible-handlers.test.ts:334,536 | closed |
| T-09-07-04 | Info disclosure | dry_run persisting unsent substitutions | mitigate | drain-and-discard on deny/dry_run/budget-exhausted — pre-tool-use.ts:226-232,245-253, post-tool-use.ts:134-140,154-160; tests reversible-handlers.test.ts:353,376,554,575 | closed |
| T-09-07-05 | Spoofing | provisional token pre-existing in source text | accept | ~2^-32 (requires guessing this process's 8-hex CSPRNG nonce, session-map.ts:129); THIS LOG ENTRY is the canonical acceptance artifact — promised code comment absent (see Accepted Risks) | closed |
| T-09-08-01 | Tampering | concurrent allocation integrity | mitigate | stress gate 16 procs × 25 txns: 0 lost / 0 dups / 0 disagreements / 0 degrades — stress.test.ts:110-215 (zero-degrade assertion :189-192); passed live during audit | closed |
| T-09-08-02 | DoS | corrupted map blocking tools | mitigate | chaos parity for all six corruption classes incl. chmod-000 — chaos.test.ts:235-306; never throw/deny, shape-identical one-way output | closed |
| T-09-08-03 | Info disclosure | plaintext residue on disk | mitigate | byte-scan of every sessions/ file incl. tmp residue — inspection.test.ts:131-189 | closed |
| T-09-08-04 | Info disclosure | doctor copy leaking state internals | mitigate | constant state-only details, SKIP-on-config-error constant detail — doctor/checks.ts:557-593; byte-for-byte locks checks.test.ts:482-542 | closed |
| T-09-08-05 | Tampering | test-only worker shipping to npm | mitigate | package.json files[] explicit enumeration; `npm pack --dry-run` during audit confirms stress-worker + detect-layer1 absent from tarball | closed |
| T-09-08-06 | DoS | CI timing variance vs stress deadline | accept | header comment tagged T-09-08-06 (stress.test.ts:26-35); deadline tuned 150→500ms on measured perf-gate evidence; zero-degrade assertion never the knob | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-09-01 | T-09-02-05 | HMAC-SHA256 address collision ~2^-128/pair → cosmetic wrong-value restore in Phase 10; code comment at session-map.ts:274-276 | operator (plan-time disposition; artifact verified by gsd-security-auditor) | 2026-07-17 |
| AR-09-02 | T-09-03-07 | win32 chmod advisory-only — NTFS does not enforce 0600/0700; documented gap (Pitfall 8), POSIX asserted, win32 skipped | operator (plan-time disposition; artifact verified) | 2026-07-17 |
| AR-09-03 | T-09-04-05 | OVF token shared across distinct originals past counter 999 — same degradation class as v1; OVF never restored | operator (plan-time disposition; artifact verified) | 2026-07-17 |
| AR-09-04 | T-09-05-07 | deadline-degraded process may emit divergent process-local tokens — warned once, cosmetic (restore-scope); zero degrades observed under 16-way stress | operator (plan-time disposition; artifact verified) | 2026-07-17 |
| AR-09-05 | T-09-06-07 | session idle past ttl_hours swept by another session's start → originals permanently unrestorable; fail-toward-privacy by design | operator (plan-time disposition; artifact verified) | 2026-07-17 |
| AR-09-06 | T-09-07-05 | rename `from` token pre-existing verbatim in source text ~2^-32 (unobservable-beforehand per-session CSPRNG nonce8); **canonical acceptance artifact is this entry** — plan promised a code comment that is absent; optional one-liner on `applyRenamesToText` may be added in a future phase | operator (plan-time disposition; audit 2026-07-17 flagged missing comment, non-blocking) | 2026-07-17 |
| AR-09-07 | T-09-08-06 | CI timing variance vs stress deadline — tune deadline constant on perf-gate evidence only; zero-degrade assertion is never the knob | operator (plan-time disposition; artifact verified) | 2026-07-17 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-17 | 45 | 45 | 0 | gsd-security-auditor (Fable 5) — evidence grep-verified + 14 suites run live (246 passed / 2 win32-gap skips); npm pack dry-run verified |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-17
