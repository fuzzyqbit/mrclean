---
phase: 10
slug: operator-restore
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-17
---

# Phase 10 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Operator CLI ↔ session state | `mrclean restore` reads encrypted session maps via `src/state/` exports only; never owns crypto/locks | Plaintext restorable originals (memory-only, stdout-only) |
| Restore path ↔ model-facing surface | `src/restore/` reachable ONLY via the single dynamic-import site in `src/cli.ts:133`; `restore` on FORBIDDEN_TOOL_NAMES; both-direction import fences | None permitted (structurally enforced) |
| Restore path ↔ audit sink | Hash-at-CLI-boundary (`redactedHash`, distinct+sorted); discriminated `action:'restore'` record | 16-hex truncated hashes + counts only, never values |
| Restore failures ↔ redaction path | Separate error domains; degrade one-way (output==input, exit 0); no shared kill switch (outbound import allowlist fence) | None — redaction provably unaffected |
| Hostile project tree ↔ status counters | `audit.jsonl` treated as untrusted input; strict `counterOrZero` + MAX_SAFE_INTEGER clamp | Numbers/booleans only into `mrclean_status` |

---

## Threat Register

Register authored at plan time (8 plans, 39 threats). Verified 2026-07-17 by gsd-security-auditor against shipped implementation: every mitigation confirmed at file:line with live test execution (128 passed / 3 platform-skipped across 14 phase suites; tools-list 8/8 vs rebuilt dist; typecheck at 38-error baseline with 0 phase-file mentions; frozen-tree zero-diff since `e950d76` re-run by auditor).

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-10-01-01 | Spoofing/Info disc | restore engine | mitigate | Exact full-token `index.get` (`src/restore/index.ts:87`); planted/enumerated taxonomy tests | closed |
| T-10-01-02 | Tampering | restore engine | mitigate | Single-pass `replace` no-cascade (`src/restore/index.ts:71`) | closed |
| T-10-01-03 | Info disclosure | restore engine | mitigate | OVF short-circuit before lookup (`src/restore/index.ts:75-78`) | closed |
| T-10-01-04 | Info disclosure | restore engine | mitigate | secretPlaceholders pass-through → `skippedSecret` (`src/restore/index.ts:81-84`) | closed |
| T-10-01-05 | DoS (ReDoS) | token grammar | accept | Linear bounded grammar; grammar-sync lock test | closed |
| T-10-02-01 | Tampering | session index | mitigate | GCM-gated read + `isRestorableType` + `'original' in entry` triple gate (`src/restore/session-index.ts:133-144`); hand-poisoned-map test | closed |
| T-10-02-02 | Tampering/Elevation | session index | mitigate | `isValidSessionId` before path derivation (`src/restore/session-index.ts:118`) | closed |
| T-10-02-03 | Info disclosure | session index | mitigate | OVF excluded from both structures (`src/restore/session-index.ts:147-149`) | closed |
| T-10-02-04 | Spoofing | session index | mitigate | `sidFromMapName` filename candidacy gate (`src/restore/session-index.ts:70-76`) | closed |
| T-10-02-05 | DoS on protection | session index | mitigate | Read-only fs surface; no-write mtime proof | closed |
| T-10-03-01 | Info disclosure | audit record | mitigate | Pre-hashed input type + destructure-pick builder (`src/audit/restore-log.ts:71-90`) | closed |
| T-10-03-02 | Info disclosure | audit hashes | accept | Truncated-hash dictionary-confirmability = shipped audit posture (IN-03; `src/audit/restore-log.ts:11-17`) | closed |
| T-10-03-03 | Tampering/DoS | counters aggregator | mitigate | Strict `counterOrZero` + clamp (WR-01 fix `32b4079`); tamper matrix green | closed |
| T-10-03-04 | Repudiation | audit writer | mitigate | `AuditWriteError` thrown; CLI warns (`src/restore/cli.ts:206-210`) | closed |
| T-10-03-05 | Tampering | LOCKED audit modules | mitigate | `log.ts`/`canary-leak.ts` byte-untouched since `e950d76` (diff empty) | closed |
| T-10-04-01 | Repudiation | doctor | mitigate | Raw-layer key scan (`src/config/index.ts:527-550`); FAIL exit 1 naming file+key (`src/doctor/checks.ts:612-625`) | closed |
| T-10-04-02 | Elevation | doctor/config | mitigate | Frozen `SUPPORTED_REVERSIBLE_KEYS` filter | closed |
| T-10-04-03 | DoS (noisy doctor) | doctor | mitigate | LOCKED detail constants byte-identical; Tests 15-17 unmodified | closed |
| T-10-04-04 | Tampering | doctor | mitigate | Config-error catch → SKIP not double-FAIL (`src/doctor/checks.ts:635-644`) | closed |
| T-10-05-01 | Tampering/Elevation | restore CLI | mitigate | Sid validated pre-path, never echoed; `exitCode=2` return (WR-03 fix `a23a99a`) | closed |
| T-10-05-02 | Info disclosure | degrade warnings | mitigate | Constant-shape 2-line stderr copy; degrade rows (a)-(f) | closed |
| T-10-05-03 | Info disclosure | CLI audit boundary | mitigate | `[...new Set].map(redactedHash).sort()` (`src/restore/cli.ts:197`) | closed |
| T-10-05-04 | DoS on protection | CLI | mitigate | Zero config/hook/detect-engine imports; lock-held row (g) real-lock liveness (WR-02 fix `a162909` adjacent) | closed |
| T-10-05-05 | Tampering | CLI fs surface | mitigate | Sole write = audit record; listings+mtime snapshots per degrade row | closed |
| T-10-05-06 | Repudiation | audit-write failure | accept | WARN+continue documented residual (`10-05-SUMMARY.md:137`) | closed |
| T-10-06-01 | Info disclosure | status counters | mitigate | Type-only reducer (grep `original`=0); boolean/number-only schema | closed |
| T-10-06-02 | Elevation | status tool | mitigate | `z.object({})` unchanged; `getStateBaseDir` registration-time only | closed |
| T-10-06-03 | Spoofing | status framing | mitigate | Machine-wide vs per-project scoping stated in output (`src/mcp/tools/status.ts:87-92`) | closed |
| T-10-06-04 | DoS | status tool | mitigate | Per-source `.catch` → zeros; never-throw row | closed |
| T-10-06-05 | Tampering | audit.jsonl input | accept | Untrusted-input posture documented; WR-01 clamps bound impact | closed |
| T-10-07-01 | Elevation | model-facing surface | mitigate | Exact-three tools-list + `restore` forbidden (8/8 vs rebuilt dist); fence rules 1+2 | closed |
| T-10-07-02 | DoS on protection | import graph | mitigate | Outbound five-pattern allowlist fence (rule 3) | closed |
| T-10-07-03 | Info disclosure | mixed-content path | mitigate | Real-pipeline canary: AWS placeholder byte-survival, `secret-skipped=1` | closed |
| T-10-07-04 | Tampering (vacuous tests) | fence suite | mitigate | Positive controls + documented sabotage spot-check | closed |
| T-10-08-01 | Info disclosure | leak surfaces | mitigate | `assertNoCanaryLeak` invariant matrix, non-vacuity guards | closed |
| T-10-08-02 | Info disclosure | error paths | mitigate | Garbage-key / chmod-000 / poisoned rows green | closed |
| T-10-08-03 | Info disclosure | secret canary | mitigate | Hand-poisoned real-key ciphertext absent on ALL surfaces incl. stdout | closed |
| T-10-08-04 | Tampering | store integrity | mitigate | Post-restore byte-scan + listings/mtime identity | closed |
| T-10-08-05 | Tampering (regression) | frozen trees | mitigate | Zero-diff `src/hook src/detect src/placeholder tests/placeholder tests/detect` since `e950d76`; typecheck 38-baseline | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-10-01 | T-10-01-05 | Token-scan regex is linear with bounded quantifiers (`{3}`/`{8}`, no nesting); ReDoS not constructible; grammar-sync lock test prevents drift | gsd-security-auditor (plan pin) | 2026-07-17 |
| AR-10-02 | T-10-03-02 | 16-hex truncated `redactedHash` values are dictionary-confirmable by an attacker holding candidate plaintexts — matches shipped hook audit discipline (review IN-03); salting would break cross-record correlation used by operators | gsd-security-auditor (plan pin) | 2026-07-17 |
| AR-10-03 | T-10-05-06 | Audit-write failure degrades to WARN+continue (restore output still delivered); blocking restore on audit failure would invert the fail-one-way posture | gsd-security-auditor (plan pin) | 2026-07-17 |
| AR-10-04 | T-10-06-05 | `audit.jsonl` in a hostile cloned repo can skew informational counters only; strict type guards + clamps (WR-01) bound impact to wrong-but-safe numbers | gsd-security-auditor (plan pin) | 2026-07-17 |
| AR-10-05 | review IN-02 | Cross-session token collision in union index → silent last-write-wins; birthday-bounded ~2⁻³² per session pair; consequence is operator-local wrong-value restore, never a leak. Phase 11 adversarial gates are the landing zone if hardening is wanted | orchestrator (documented residual) | 2026-07-17 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-17 | 39 | 39 (35 mitigated, 4 accepted) | 0 | gsd-security-auditor (fable) |

Audit notes:
- Post-plan review fixes credited where they close register rows: CR-01 `4e09374` (isMainEntry entrypoint guard — closes pre-existing silent-inert-binary defect that would have hollowed out REVMODE-01 via npx/symlink), WR-01 `32b4079` (T-10-03-03), WR-02 `a162909` (session-filter case normalization), WR-03 `a23a99a` (T-10-05-01 exit path).
- Dist rebuild `c2c60ba` audited: 0 worktree shim paths, `isMainEntry` compiled in, tools-list gate green against it.
- SUMMARY threat flags (10-01, 10-07): none open; 10-07 shared-stash process incident resolved (stash verified superseded, dropped).
- Review Info deferrals IN-01/IN-04 map to no register row (error-report staleness cosmetics; config-scaffold duplication). IN-02 recorded as AR-10-05.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter
