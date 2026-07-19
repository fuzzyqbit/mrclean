---
phase: 8
slug: contract-verification-reversible-plumbing
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-16
---

# Phase 8 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| config.toml layers → merged runtime config | Untrusted user/project TOML crosses into the protection policy; project layer must never weaken user opt-ins | Config values / policy-controlling |
| mrclean install → ~/.claude/settings.json | Installer mutates operator-owned live Claude Code config shared with foreign hooks | Hook registrations / operator config |
| Claude Code hook payloads → hook stdin | Untrusted event payloads (open `reason` string, tool outputs) cross into the fail-closed wrapper | Event JSON / untrusted |
| Test harness → operator's live Claude Code config | Experiments must never touch ~/.claude/settings.json or ~/.claude.json | Sandbox settings / operator config |
| Fixture hooks → Anthropic API (live sessions) | Everything a fixture emits reaches the wire | Marker strings only |
| Harness → ~/.claude/projects transcripts | Evidence reads of local transcripts (sandbox sessions only) | Session transcripts / local-sensitive |
| Repo docs / issue drafts → public GitHub | Issue body published publicly under the operator's account | Public text / reputation |
| Harness run records → committed contract evidence → shipped copy | contract-findings.json is the evidence base cited by THREAT_MODEL.md, HOOK-CONTRACT.md, doctor/types copy; reruns cross this boundary | Version-stamped evidence |
| Security docs → operator/user trust | THREAT_MODEL.md overclaims become exploitable expectations | Guarantee claims |

---

## Threat Register

All 49 register entries verified closed on 2026-07-16 by 11 per-plan auditors + 31 adversarial refuters (every CLOSED claim independently upheld). Supply-chain rows collapsed by ID.

| Threat ID | Plan | Category | Component | Disposition | Mitigation (verified evidence) | Status |
|-----------|------|----------|-----------|-------------|--------------------------------|--------|
| T-08-01 | 08-01 | Tampering | validateReversibleConfig | mitigate | ConfigReadError on non-table / non-boolean `enabled`, no silent coercion — src/config/index.ts:335-343; Test B tests/config/reader.test.ts:145-162 | closed |
| T-08-02 | 08-01 | Elevation of Privilege | absent-[reversible] default path | mitigate | Frozen `Object.freeze({ enabled: false })` default — src/config/defaults.ts:70-71; merge seeds fresh copy src/config/index.ts:538-551; Test F tests/config/merge.test.ts:97-105; full-suite gate green | closed |
| T-08-03 | 08-01 | Denial of Service | SessionEnd `reason` typing | mitigate | Open `string` type — src/shared/types.ts:74-80; pure no-op handler; Tests 11g/11h tests/hook/dispatcher.test.ts:122-140 | closed |
| T-08-04 | 08-02 | Tampering | writeHookEntries migration | mitigate | `_mrclean === true` typeguard filter — src/install/markers.ts:21-28, src/install/settings.ts:133-153; timestamped backupJson settings.ts:155-161; foreign-entries byte-identical test | closed |
| T-08-05 | 08-02 | Denial of Service | handleSessionEnd fail path | mitigate | Pure `return null`, type-only import, no config load / no I/O — src/hook/handlers/session-end.ts:14-18; grep gate forbids loadEffectiveConfig / node:fs | closed |
| T-08-06 | 08-02 | Denial of Service | SessionEnd registration order | mitigate | Handler + dispatcher case + installer constants in same plan, handler task first — git b4df3ac ordering; dispatcher routing test | closed |
| T-08-07 | 08-02 | Spoofing | Widened SessionStart matcher | accept | AR-01 | closed |
| T-08-08 | 08-03 | Information Disclosure | checkReversibleState detail strings | mitigate | Constant state-only detail strings, never values/paths/map contents — src/doctor/checks.ts:552-560; exact-string tests | closed |
| T-08-09 | 08-03 | Repudiation | Silent no-op on reversible misconfig | accept | AR-02 | closed |
| T-08-10 | 08-03 | Denial of Service | Malformed config crashing doctor | mitigate | Loader errors caught → SKIP; checkConfigLoad owns the FAIL — src/doctor/checks.ts:577-597 | closed |
| T-08-11 | 08-03 | Tampering | Ad-hoc exit code vs LOCKED map | mitigate | PASS/SKIP only, no FAIL path — src/doctor/checks.ts:577-597; LOCKED header :10-19; exitCodeOnFail === 1 test | closed |
| T-08-12 | 08-04 | Tampering | Experiment sandbox → operator config | mitigate | `--settings` + `--mcp-config` + `--strict-mcp-config` on every spawn — tests/uat/harness.ts:86-101; mkdtemp sandbox tests/uat/contract-verification.test.ts:332; operator settings residue-free | closed |
| T-08-13 | 08-04 | Information Disclosure | Fixture secret shapes | mitigate | All six fixtures marker-only (read in full); leak-grep gate (AKIA/ghp_/sk-ant) over tests/uat/fixtures/ | closed |
| T-08-14 | 08-04 | Denial of Service | Hard-asserted contract verdicts | mitigate | MRCLEAN_UAT=1 opt-in `describe.skipIf` — contract-verification.test.ts:58,304; record-don't-assert into findings artifact | closed |
| T-08-15 | 08-04 | Information Disclosure | Interactive-session sandbox residue | mitigate | Isolated /tmp settings + marker fixture verified; deletion leg completed in-audit 2026-07-16 — `/tmp/e1-interactive-settings.json` and job-tmp `e1-*` PTY captures (contained operator email) removed, verified absent | closed |
| T-08-16 | 08-05 | Information Disclosure | Upstream issue content | mitigate | Blocking human checkpoint before filing — 08-05-PLAN.md:119; draft marker strings + public issue refs only; leak-grep clean | closed |
| T-08-17 | 08-05 | Spoofing | Public filing as the operator | mitigate | Blocking checkpoint upheld (draft human-reviewed); execution-time substitution operator-authorized → AR-07 | closed |
| T-08-18 | 08-05 | Repudiation | Doctor/types copy overclaim | mitigate | E1-gated deterministic version-stamped copy — src/doctor/version-check.ts:113-123; claims trace to contract-findings.json; lockstep tests | closed |
| T-08-19 | 08-06 | Repudiation | Unbuilt-code claims as shipped facts | mitigate | Design-commitment framing — THREAT_MODEL.md:143-149; 'design commitment' phrase asserted by presence gate | closed |
| T-08-20 | 08-06 | Information Disclosure | Key-custody overclaim | mitigate | §4 Key-custody honesty names stopped vs not-stopped adversary classes — THREAT_MODEL.md:226-234 | closed |
| T-08-21 | 08-06 | Tampering | Doc section silently dropped | mitigate | Copy-drift presence gate: heading + five subsection fragments — tests/copy-drift.test.ts:144-168, every unit run | closed |
| T-08-07-01 | 08-07 | Elevation of Privilege | mergeConfigs cross-layer merge | mitigate | Partial layer types — src/shared/types.ts:259-428; merge-time filling from accumulated value; Tests G/H prove user opt-ins survive partial project tables | closed |
| T-08-07-02 | 08-07 | Tampering | Validator fail-closed throws | mitigate | Every ConfigReadError reason string unchanged — src/config/index.ts:210-341; pre-existing throw tests green | closed |
| T-08-07-03 | 08-07 | Elevation of Privilege | Default relocation (validators → merge) | mitigate | Defaults apply exactly once at DEFAULT_CONFIG merge seed — src/config/index.ts:511-539; Test K + merge Test F; full-suite gate | closed |
| T-08-08-01 | 08-08 | Tampering | afterAll findings writer | mitigate | Null on zero verdicts — tests/uat/findings-builder.ts:227-228 (guard :86-89); carry-forward :118-127; offline unit tests | closed |
| T-08-08-02 | 08-08 | Repudiation | Orphaned e1-object-rewrite-hook.sh | mitigate | E1/Bash-object test wires fixture — tests/uat/contract-verification.test.ts:439-463; hook-fired hard assert :453 | closed |
| T-08-08-03 | 08-08 | Information Disclosure | New fixture content | mitigate | E4 object fixture markers-only — tests/uat/fixtures/e4-object-large-output-hook.sh:22-31; leak-grep re-run | closed |
| T-08-08-04 | 08-08 | Denial of Service | Non-gated builder test | accept | AR-03 | closed |
| T-08-09-01 | 08-09 | Repudiation | HOOK-CONTRACT verdict quotes | mitigate | Byte-match traceability — docs/HOOK-CONTRACT.md:3-6; verified via node string-inclusion check against committed artifact | closed |
| T-08-09-02 | 08-09 | Tampering | Live rerun vs curated evidence | mitigate | node -e integrity gate re-run exit 0 — E1_shape_validation + rendering survive regeneration, tests/uat/artifacts/contract-findings.json:84-110 | closed |
| T-08-09-03 | 08-09 | Information Disclosure | Fixture payloads in live sessions | mitigate | Marker strings only (E4 HEAD/TAIL, E1 markers); sandbox `--settings` isolation asserted | closed |
| T-08-09-04 | 08-09 | Spoofing | Unauthenticated/foreign claude CLI | mitigate | Preflight `claude --version` + assertSessionRan BLOCKER — tests/uat/contract-verification.test.ts:305-313; failed run writes nothing | closed |
| T-08-10-01 | 08-10 | Tampering | buildE1 per-tool carry-forward | mitigate | fresh → previous → stub resolution — tests/uat/findings-builder.ts:119-127; failing-first offline tests + repro against committed artifact | closed |
| T-08-10-02 | 08-10 | Repudiation | Vacuous-pass test fixtures | mitigate | previousArtifact() mirrors committed populated E1.tools — tests/uat/findings-builder.test.ts:114-134; regression fails 3 named tests | closed |
| T-08-10-03 | 08-10 | Denial of Service | Offline unit suite | accept | AR-04 | closed |
| T-08-11-01 | 08-11 | Tampering | E4 + Read-object record assembly | mitigate | Record-nothing gates on `e1ObjectBash === undefined` / empty e1Tools — tests/uat/contract-verification.test.ts:515-520; 11-skipped byte-identical-artifact run; honest-drift path preserved | closed |
| T-08-11-02 | 08-11 | Repudiation | HOOK-CONTRACT evidence citations | mitigate | Citations refreshed to committed sids — docs/HOOK-CONTRACT.md:35,117,119; permanent offline UUID-traceability gate with positive control in tests/copy-drift.test.ts | closed |
| T-08-11-03 | 08-11 | Information Disclosure | Copy-drift gate reads artifact | accept | AR-05 | closed |
| T-08-SC | 08-01…08-09 | Tampering | npm/pip/cargo installs | accept | AR-06 (one entry per plan, 9 total) | closed |
| T-08-10-SC | 08-10 | Tampering | npm/pip/cargo installs | accept | AR-06 | closed |
| T-08-11-SC | 08-11 | Tampering | npm/pip/cargo installs | accept | AR-06 | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-08-07 (08-02) | Widened SessionStart matcher fires on resume/clear/compact — intended: re-init fixes a latent stale-cache bug; exit-2 on malformed config is existing fail-closed behavior extended consistently | operator (plan-time disposition) | 2026-07-14 |
| AR-02 | T-08-09 (08-03) | Silent no-op on reversible misconfig deferred by design: Phase 8 doctor PASSes with honest "plumbing only" copy; FAIL-loud lands in Phase 10 (REVMODE-12) | operator (plan-time disposition) | 2026-07-14 |
| AR-03 | T-08-08-04 (08-08) | findings-builder.test.ts runs non-gated in the uat project — pure module test, <1 s, zero tokens, zero claude spawn; safe under `npm test` and CI | operator (plan-time disposition) | 2026-07-14 |
| AR-04 | T-08-10-03 (08-10) | Offline unit suite: pure module tests, <1 s, zero tokens, single readFileSync in verify repro | operator (plan-time disposition) | 2026-07-14 |
| AR-05 | T-08-11-03 (08-11) | Copy-drift gate reads two already-committed files and asserts substring membership; session UUIDs are not secrets; nothing new written | operator (plan-time disposition) | 2026-07-14 |
| AR-06 | T-08-SC (08-01…08-09), T-08-10-SC, T-08-11-SC | Supply chain: zero package installs across all 11 plans — package-legitimacy gate not applicable (RESEARCH §Package Legitimacy Audit) | operator (plan-time disposition) | 2026-07-14 |
| AR-07 | T-08-17 (08-05) | Execution-time substitution of the registered control: the orchestrator executed `gh issue create` from the operator's account under explicit operator authorization at the blocking checkpoint (08-05-SUMMARY.md deviation 5 + frontmatter decision; docs/HOOK-CONTRACT.md:206-207 records "operator-authorized and executed from the operator's account — never autonomously by an agent"). Threat intent — no unreviewed agent post as the operator — upheld: draft was human-reviewed at the gate, filing was operator-directed, and the executor agent never ran the filing command (08-05-SUMMARY.md Threat Flags). Residual risk: none new; the filed issue is anthropics/claude-code#77587 with marker strings + public refs only. | operator (execution-time authorization at checkpoint, 2026-07-14) | 2026-07-16 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-16 | 49 | 49 | 0 | gsd-secure-phase (ultracode workflow wf_3e68c6b2-34b: 11 per-plan auditors + 31 adversarial refuters, Fable 5; 42 agents, 0 errors; T-08-15 remediated in-audit — sandbox residue deleted and verified absent; T-08-17 recorded as AR-07) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-16
