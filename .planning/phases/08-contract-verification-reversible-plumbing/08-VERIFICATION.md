---
phase: 08-contract-verification-reversible-plumbing
verified: 2026-07-14T22:05:00Z
status: gaps_found
score: 12/16 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Operator can set the [reversible] config table and the merged effective config honors it across config layers (SC2 / 08-01 truth 1)"
    status: partial
    reason: "CR-01 reproduced by execution during verification: user-layer `[reversible] enabled = true` + project-layer `[reversible]` carrying only an unknown key (the documented Phase-9 forward-compat scenario) merges to `reversible.enabled = false`. validateReversibleConfig bakes the default into the layer (`enabled: raw['enabled'] === true`) so a TOML layer is never a true Partial and mergeConfigs' last-wins replaces the operator opt-in. Same phase-verified pattern silently disables operator PII opt-ins (pre-existing validatePiiConfig, proven by 08-REVIEW). Single-layer behavior is correct and test-proven; the cross-layer defect is a silent protection-semantics failure in a DLP tool."
    artifacts:
      - path: "src/config/index.ts"
        issue: "validateReversibleConfig (~line 356-364) substitutes the default for an absent `enabled`; mergeConfigs (~570-594) fills pii.enabled from layerPii.enabled unconditionally — layers are never Partials"
      - path: "tests/config/merge.test.ts"
        issue: "No cross-layer test covers user opt-in + project partial table (only programmatic full objects merged)"
    missing:
      - "Partial-shaped layer types for [reversible] and [pii]; absent fields stay undefined in parsed layers"
      - "Default-filling moved into mergeConfigs (fill from accumulated value, not the bundled default)"
      - "Cross-layer merge tests: user `enabled = true` + project partial table must preserve the opt-in"
  - truth: "The 10K-char output-cap applicability question is empirically settled (SC1 / 08-04 truth 1, E4)"
    status: partial
    reason: "E4's recorded verdict is 'unanswerable for built-in tools — blocked by #68951 (updatedToolOutput ignored for Bash/Read)'. The phase's own Task-3 discovery (experiments.E1_shape_validation) overturned that premise: object-shaped payloads ARE honored for Bash on 2.1.209, so E4 became answerable and was deliberately not re-run ('rerun deferred to a follow-up'). No later phase (9/10/11) success criterion owns the rerun — the deferral chain ends in an unowned HOOK-CONTRACT.md open follow-up. Phase goal says 'empirically settled'; E4 is documented but not settled. E4's downstream consumers (Phase 10 restore-in-large-outputs scope, Phase 9 map-size expectations) will consume an unanswered question."
    artifacts:
      - path: "tests/uat/artifacts/contract-findings.json"
        issue: "experiments.E4.verdict premise (channel dead for built-ins) contradicted by experiments.E1_shape_validation in the same artifact"
      - path: "docs/HOOK-CONTRACT.md"
        issue: "§E4 records the stale-premise verdict; §Open follow-ups lists the rerun with no phase owner"
    missing:
      - "E4 rerun using the object-shaped Bash payload (e1-object-rewrite-hook.sh pattern) against >10K output"
      - "Updated E4 verdict in contract-findings.json + docs/HOOK-CONTRACT.md §E4"
      - "Also closes the Read object-shape open follow-up if run in the same session batch"
  - truth: "The harness is rerunnable on Claude Code upgrades: contract verdicts are recorded findings (SC1 durability / 08-04 truth 3)"
    status: failed
    reason: "WR-01/WR-02 confirmed by code read: the afterAll findings writer (tests/uat/contract-verification.test.ts ~351-409) unconditionally overwrites contract-findings.json with `rendering: 'pending-interactive'` hardcoded and NO E1_shape_validation key. The committed artifact's E1.rendering verdict and E1_shape_validation section — the evidence THREAT_MODEL.md §Reversible-3, docs/HOOK-CONTRACT.md §E1, and src/shared/types.ts JSDoc all cite — are destroyed on the very next documented re-verification run. The load-bearing object-shape fixture (e1-object-rewrite-hook.sh) is wired to zero tests (grep: only referenced from docs), so the phase's pivotal discovery is not reproducible by the harness."
    artifacts:
      - path: "tests/uat/contract-verification.test.ts"
        issue: "Writer hardcodes rendering: 'pending-interactive'; no E1_shape_validation record; afterAll overwrites even when beforeAll throws"
      - path: "tests/uat/fixtures/e1-object-rewrite-hook.sh"
        issue: "ORPHANED — executable, leak-clean, but referenced by no test"
    missing:
      - "E1/Bash-object experiment in contract-verification.test.ts using e1-object-rewrite-hook.sh, recording an E1_shape_validation-shaped verdict"
      - "Writer preserves or re-emits E1.rendering and E1_shape_validation (or refuses to overwrite an artifact containing experiments the run did not produce)"
      - "Guard: only write findings when at least one experiment recorded a verdict"
deferred:
  - truth: "REVMODE-02 encrypted session map persistence (config table was Phase 8's clause only)"
    addressed_in: "Phase 9"
    evidence: "Phase 9 SC1: 'the map persists as an encrypted file (AES-256-GCM, fresh IV per write)... key material in a separate 0700 directory'"
  - truth: "REVMODE-07 reason-aware SessionEnd janitor + TTL orphan sweep (installer/dispatcher groundwork shipped this phase)"
    addressed_in: "Phase 9"
    evidence: "Phase 9 SC4: 'SessionEnd with reason clear/logout/prompt_input_exit/other deletes the session map; resume retains it; orphaned maps older than the TTL... swept at SessionStart and MCP-server boot'"
  - truth: "REVMODE-12 doctor FAIL-loud on unsupported reversible config + mrclean_status counters (reporting-only check shipped this phase)"
    addressed_in: "Phase 10"
    evidence: "Phase 10 SC5: 'mrclean doctor FAILs loud (never silent no-op) on unsupported reversible configuration, and mrclean_status reports map entry counts by class plus restored/unmatched counters'"
  - truth: "THREAT_MODEL reversible section finalized against shipped implementation + 'encrypted at rest' copy-drift lock"
    addressed_in: "Phase 11"
    evidence: "Phase 11 SC5: 'THREAT_MODEL.md's reversible-mode section is finalized against the shipped implementation, and the copy-drift CI gate covers the encrypted at rest and honest-framing claims'"
human_verification:
  - test: "Accept or redo the E1 terminal-rendering observation method"
    expected: "08-04's must-have reads 'human-observed verdict'. The recorded verdict (contract-findings.json experiments.E1.rendering) was produced by an operator-directed automated tmux PTY capture after the operator replied 'you run it' at the checkpoint — honestly stamped 'NOT the committed harness', but not literally human-observed. Either (a) confirm the delegated automated observation is accepted (add the override below), or (b) run the 5-minute manual observation from 08-04 Task 3 how-to-verify and confirm the terminal renders REWRITTEN_E1_MARKER_x9k2 for the object-shape fixture."
    why_human: "Whether operator delegation satisfies the 'human-observed' intent is an acceptance decision, not a code property; the underlying rendering behavior itself is also inherently visual."
---

# Phase 8: Contract Verification & Reversible Plumbing — Verification Report

**Phase Goal:** Hook-contract unknowns are empirically settled and documented, reversible-mode config/lifecycle plumbing exists with zero behavior change, and THREAT_MODEL.md honestly frames reversible mode before any state code is written
**Verified:** 2026-07-14T22:05:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | SC1: E1 (updatedToolOutput honored-ness per tool + terminal rendering) answered, documented, version-stamped | ✓ VERIFIED | docs/HOOK-CONTRACT.md §E1 (per-tool matrix, verbatim zod excerpt); contract-findings.json experiments.E1 + E1_shape_validation; 6 "verified on Claude Code" stamps |
| 2  | SC1: E2 (updatedInput context echo) answered and documented | ✓ VERIFIED | contract-findings.json E2 ("rewrite executed: true; transcript tool_use input preserves the ORIGINAL command"); HOOK-CONTRACT §E2 with Phase 10 fence implication |
| 3  | SC1: E3 (session_id continuity across --resume) answered and documented | ✓ VERIFIED | contract-findings.json E3 (resume reuses sid: true; fork-session mints new: true; source:resume via widened matcher); HOOK-CONTRACT §E3 → Phase 9 T5 gate REAL |
| 4  | SC1: E4 (10K-char cap applicability) empirically settled | ✗ FAILED (partial) | Recorded verdict "unanswerable — blocked by #68951" is premised on "ignored for Bash", which the same artifact's E1_shape_validation overturns (object shape HONORED for Bash). Rerun deferred with no owner in Phases 9–11 |
| 5  | SC1: upstream feature request filed and linked | ✓ VERIFIED (deviation noted) | anthropics/claude-code#77587 confirmed live via `gh issue view` (OPEN, 2026-07-14); URL in HOOK-CONTRACT.md:187 + draft header. DEVIATION: primary ask reframed (evidence-driven, orchestrator-directed, operator reviewed+authorized) to per-tool shape docs + loud rejection; the display-only channel is retained inside the filed issue as a distinguished "related future ask", not the headline request |
| 6  | SC2: operator can set [reversible] (default OFF) and the merge honors it | ✗ FAILED (partial) | Single-layer + defaults proven (19/19 config tests green; frozen `{enabled:false}` default at defaults.ts:70). REPRODUCED during verification: user `enabled = true` + project partial `[reversible]` table → merged `enabled = false` (CR-01) — silent clear of operator opt-in in the documented forward-compat scenario |
| 7  | SC2: `mrclean doctor` reports reversible-mode state | ✓ VERIFIED | checkReversibleState (checks.ts:577-597) PASS disabled/enabled + SKIP on config error; wired at doctor/index.ts:150; trio tests green; constant detail strings (no path leak, T-08-08) |
| 8  | SC2: absent table → shipped v1/v2 behavior byte-identical | ✓ VERIFIED | Test F (absent → {enabled:false}); zero edits to detection/placeholder/audit suites across the phase; full-suite runs recorded green at every wave (603→621 passed); spot-check re-runs green |
| 9  | SC3: fresh install registers 5 events, widened SessionStart matcher, SessionEnd routing | ✓ VERIFIED | HOOK_EVENTS 5-tuple + `startup\|resume\|clear\|compact` + matcherless SessionEnd (settings.ts:19-26); dispatcher `case 'SessionEnd'` → pure no-op handler (bare `return null`, zero I/O imports — grep gate clean); 31/31 install tests green |
| 10 | SC3: re-install on v2.0 shape migrates without duplicates, foreign hooks preserved | ✓ VERIFIED | Migration + uninstall-after-migration tests green (settings.test.ts); idempotency + uninstall-roundtrip suites green |
| 11 | SC3: zero exit-2 noise at session start/end | ✓ VERIFIED | contract-findings.json E5: "zero hook-error/exit-2 stderr noise" live with the real built hook (widened matcher + SessionEnd); handler cannot throw (no config load / no I/O) |
| 12 | SC4: THREAT_MODEL reversible section — blast radius, secret floor, wire re-entry, key-custody, residual risks | ✓ VERIFIED | `## Reversible Mode (v3.0)` at THREAT_MODEL.md:141 with the five H3 subsections (151/171/189/226/244); wire re-entry cites docs/HOOK-CONTRACT.md and the corrected shape-validation picture; 'transcript ratchet' + 'design commitment' present |
| 13 | SC4: PROJECT.md stale return-path wording amended (+ CLAUDE.md mirror) | ✓ VERIFIED | Stale sentence absent from both; operator-only `mrclean restore` framing present in both; deferral-describing hits correctly left untouched |
| 14 | Harness rerunnable on CC upgrades without destroying recorded verdicts | ✗ FAILED | Writer (contract-verification.test.ts ~351-409) hardcodes `rendering: 'pending-interactive'`, emits no E1_shape_validation, overwrites unconditionally in afterAll; e1-object-rewrite-hook.sh wired to zero tests — the documented re-verification procedure clobbers the exact evidence HOOK-CONTRACT/THREAT_MODEL/types.ts cite |
| 15 | E1 interactive rendering half has a human-observed verdict | ? UNCERTAIN | Verdict exists and is honestly stamped: "operator-directed automated PTY observation (tmux capture-pane); operator delegated — NOT the committed harness". Not literally human-observed; operator explicitly delegated ("you run it"). Human acceptance decision requested (see Human Verification + override suggestion) |
| 16 | Plumbing invariants: fail-closed [reversible] validator, unknown-event throw preserved, LOCKED doctor exit-code map unchanged | ✓ VERIFIED | ConfigReadError on non-boolean enabled (Test B); dispatcher default throw intact (test green); reversible check PASS/SKIP-only with reserved exit 1 documented in the LOCKED header (checks.ts:17); report.ts untouched |

**Score:** 12/16 truths verified (3 failed/partial, 1 uncertain)

### Deferred Items

Items not yet met but explicitly owned by later milestone phases (not gaps):

| # | Item | Addressed In | Evidence |
|---|------|--------------|----------|
| 1 | REVMODE-02 encrypted map persistence | Phase 9 | SC1: "map persists as an encrypted file (AES-256-GCM, fresh IV per write)" |
| 2 | REVMODE-07 reason-aware janitor + TTL sweep | Phase 9 | SC4: "SessionEnd with reason clear/... deletes the session map; resume retains it; orphaned maps... swept" |
| 3 | REVMODE-12 FAIL-loud doctor + mrclean_status counters | Phase 10 | SC5: "doctor FAILs loud (never silent no-op) on unsupported reversible configuration" |
| 4 | THREAT_MODEL finalization vs shipped impl + "encrypted at rest" copy lock | Phase 11 | SC5: "reversible-mode section is finalized against the shipped implementation" |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/shared/types.ts` | SessionEndInput, unions widened, MrcleanReversibleConfig, honest updatedToolOutput JSDoc | ✓ VERIFIED | SessionEndInput:74 + union:88; MrcleanReversibleConfig:316; MrcleanConfig.reversible:365; E1-stamped JSDoc:139-152 with HOOK-CONTRACT refs (2) |
| `src/config/defaults.ts` | Frozen reversible default {enabled:false} | ✓ VERIFIED | Object.freeze at :70-71 with one-way-guarantee comment |
| `src/config/index.ts` | validateReversibleConfig + parseToml branch + last-wins merge | ✓ VERIFIED (defect noted) | Validator :356-364, parse branch :450-452, seed :552, last-wins :561-563. CR-01 defect lives here (gap 1). SDK key-link "not found" for `DEFAULT_CONFIG\.reversible` was a pattern-escaping false negative — present at :552 |
| `src/hook/handlers/session-end.ts` | Pure no-op handler | ✓ VERIFIED | Bare `return null`; imports only SessionEndInput type; forbidden-import grep clean |
| `src/hook/dispatcher.ts` | SessionEnd routing case | ✓ VERIFIED | `case 'SessionEnd'` :37-38; default throw preserved |
| `src/install/settings.ts` | 5-event HOOK_EVENTS + widened matcher | ✓ VERIFIED | :19 (5 events), :24 (widened matcher), :25 (matcherless SessionEnd) |
| `src/doctor/checks.ts` | checkReversibleState + 5-event REQUIRED_EVENTS + LOCKED header pin | ✓ VERIFIED | REQUIRED_EVENTS :49-55; checkReversibleState :577-597; reporting-only pin :17; derived count |
| `src/doctor/index.ts` | checkReversibleState wired | ✓ VERIFIED | import :35, comment :85, push :150 |
| `tests/uat/harness.ts` | runClaude/assertSessionRan/ClaudeRun exports | ✓ VERIFIED | Exports present; live-session.test.ts imports them; typecheck differential clean |
| `tests/uat/contract-verification.test.ts` | E1-E5 opt-in record-don't-assert harness (min 150 lines) | ⚠️ VERIFIED with defect | Exists, substantive, opt-in gate works (9 skipped without MRCLEAN_UAT). Writer defect = gap 3 (WR-01) |
| `tests/uat/artifacts/contract-findings.json` | Version-stamped E1-E5 verdicts | ⚠️ VERIFIED with defect | claude_version 2.1.209, date, E1–E5 + E1_shape_validation + rendering all present. Partially hand-curated; next harness run destroys the curation (gap 3); evidence_paths leak local absolute paths (IN-03, info) |
| `tests/uat/fixtures/*.sh` (5) | Executable, marker-only fixture hooks | ✓ VERIFIED | All 5 executable; leak-grep (AKIA/ghp_/sk-ant) clean. e1-object-rewrite-hook.sh is ORPHANED (no test references — gap 3) |
| `docs/HOOK-CONTRACT.md` | 5 verdict sections, stamps, upstream URL (min 60 lines) | ✓ VERIFIED | 208 lines; E1–E5 sections; 6 verified-on stamps; #77587 linked :187; re-verification procedure (procedure itself is unsafe per gap 3) |
| `docs/upstream/display-only-channel-request.md` | Filed issue body (min 30 lines) | ✓ VERIFIED | 146 lines; filed status + URL in header; reframe note documents the deviation; cites/distinguishes #18653 + #68951 |
| `THREAT_MODEL.md` | Reversible Mode section, five H3 subsections | ✓ VERIFIED | :141 + subsections :151/:171/:189/:226/:244; honest framing phrases present |
| `tests/copy-drift.test.ts` | Presence gate for section + subsections | ✓ VERIFIED | 8 presence assertions + THREAT_MODEL.md in SCANNED_SOURCES (:40); 13/13 green |
| `dist/cli.js` | Shipped bin carries wave-4 honest copy | ✓ VERIFIED | Regenerated post-wave-4 merge (8992ee4); contains HOOK-CONTRACT reference |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/config/index.ts | src/config/defaults.ts | mergeConfigs seeds from DEFAULT_CONFIG.reversible | ✓ WIRED | :552 (SDK regex miss was false negative) |
| src/config/index.ts | src/shared/types.ts | validator returns MrcleanReversibleConfig | ✓ WIRED | :356 |
| src/hook/dispatcher.ts | src/hook/handlers/session-end.ts | case 'SessionEnd' → handleSessionEnd | ✓ WIRED | import :12, case :37 |
| src/install/settings.ts | src/hook/dispatcher.ts | registration never precedes route | ✓ WIRED | Both landed in 08-02; dispatcher tests green |
| src/doctor/index.ts | src/doctor/checks.ts | results.push(checkReversibleState) | ✓ WIRED | :150 |
| src/doctor/checks.ts | src/config/index.ts | loadEffectiveConfig in try/catch | ✓ WIRED | :579 |
| contract-verification.test.ts | harness.ts | import { runClaude, assertSessionRan } | ✓ WIRED | Confirmed |
| contract-verification.test.ts | contract-findings.json | findings writer | ⚠️ PARTIAL | Wired but destructive on rerun (gap 3) |
| e1-object-rewrite-hook.sh | any test | E1 object-shape leg | ✗ NOT_WIRED | Zero test references (gap 3 / WR-02) |
| docs/HOOK-CONTRACT.md | contract-findings.json | verdicts trace to artifact | ✓ WIRED | 3 references; review confirmed byte-match where quoted |
| src/doctor/version-check.ts | docs/HOOK-CONTRACT.md | doctor copy references contract doc | ✓ WIRED | :122 |
| tests/copy-drift.test.ts | THREAT_MODEL.md | presence assertions | ✓ WIRED | readThreatModel + 8 assertions |
| THREAT_MODEL.md | docs/HOOK-CONTRACT.md | wire re-entry cites by document reference | ✓ WIRED | :195 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| checkReversibleState detail | config.reversible.enabled | loadEffectiveConfig → mergeConfigs | Yes (real TOML parse; verified by execution) | ✓ FLOWING (upstream merge defect = gap 1) |
| doctor report reversible line | CheckResult from checkReversibleState | computeDoctorReport results array | Yes (renderReport iterates generically) | ✓ FLOWING |
| HOOK-CONTRACT verdicts | experiments.* | contract-findings.json (live-run generated + hand-curated) | Yes as committed | ⚠️ STATIC on rerun — regeneration replaces curated evidence with stubs (gap 3) |
| dispatcher SessionEnd | HookInput payload | stdin via fail-closed wrapper | Yes (dispatcher tests exercise real payload shapes) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Config parse/validate/merge + dispatcher + copy-drift | `npx vitest run --project=unit tests/config/... tests/hook/dispatcher.test.ts tests/copy-drift.test.ts` | 40/40 passed | ✓ PASS |
| Doctor checks + version-check copy | `npx vitest run --project=unit tests/doctor/checks.test.ts tests/doctor/version-check.test.ts` | 29/29 passed | ✓ PASS |
| Installer 5-event surface + migration + idempotency + uninstall | `npx vitest run tests/install/*.test.ts` | 31/31 passed | ✓ PASS |
| Doctor end-to-end | `npx vitest run tests/doctor/end-to-end.test.ts` | 9/9 passed | ✓ PASS (seam bridge caveat — WR-04) |
| CR-01 cross-layer merge | tsx repro: user `enabled=true` + project partial table | `reversible.enabled = false` | ✗ FAIL (gap 1) |
| UAT opt-in gate (no tokens in CI) | `npx vitest run --project=uat tests/uat/contract-verification.test.ts` (no MRCLEAN_UAT) | 9 skipped | ✓ PASS |
| Fixture hygiene | `grep -rE "AKIA\|ghp_\|sk-ant" tests/uat/fixtures/` | clean; all 5 executable | ✓ PASS |
| session-end no-I/O invariant | `grep -E "loadEffectiveConfig\|session-state\|node:fs" src/hook/handlers/session-end.ts` | clean | ✓ PASS |
| Upstream issue live | `gh issue view 77587 --repo anthropics/claude-code` | OPEN, filed 2026-07-14, title matches reframed ask | ✓ PASS |
| Claimed commits exist | git cat-file on 14 SUMMARY-claimed hashes | all present | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes exist in this repo and none are declared by the phase plans/summaries. Step 7c: SKIPPED (no probes declared; the phase's live harness is MRCLEAN_UAT-gated and spends API tokens — not run by the verifier; its committed artifacts and opt-in skip behavior were verified instead).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| REVMODE-10 | 08-04, 08-05 | Contract behaviors empirically verified + documented; display-only upstream request filed | ⚠️ PARTIAL | E1/E2/E3/E5 settled + documented; #77587 filed & linked (reframed, operator-authorized). E4 not settled (gap 2); harness durability defect (gap 3). REQUIREMENTS.md correctly still `[ ]` / Pending — consistent with the open E4 clause |
| REVMODE-03 | 08-06 | THREAT_MODEL reversible section + PROJECT.md amendment | ✓ SATISFIED | Section + 5 subsections + drift gate + amendments verified; REQUIREMENTS.md `[x]` / Complete |
| REVMODE-02 | 08-01 (groundwork) | Config table clause only | ✓ ON TRACK (owned by Phase 9) | Correctly NOT marked complete; config-table clause delivered (with gap 1 defect) |
| REVMODE-07 | 08-02 (groundwork) | Installer/dispatcher clauses only | ✓ ON TRACK (owned by Phase 9) | Correctly NOT marked complete; installer widening + migration delivered |
| REVMODE-12 | 08-03 (groundwork) | "Doctor reports reversible state" clause only | ✓ ON TRACK (owned by Phase 10) | Correctly NOT marked complete; reporting-only check delivered |

Orphan check: REQUIREMENTS.md maps exactly REVMODE-03 and REVMODE-10 to Phase 8 — both claimed by plans. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/config/index.ts | ~356-364, ~570-594 | Validator bakes defaults into layers → merge last-wins wipes lower-layer opt-ins (CR-01, reproduced) | 🛑 Blocker | Silent clear of operator [reversible] opt-in; same pattern silently disables PII protections (pre-existing half) — gap 1 |
| tests/uat/contract-verification.test.ts | ~351-409 | Findings writer regenerates artifact without curated E1_shape_validation/rendering; runs even on broken beforeAll | ⚠️ Warning | Documented re-verification destroys cited evidence — gap 3 |
| tests/uat/fixtures/e1-object-rewrite-hook.sh | — | Orphaned fixture (no test references) | ⚠️ Warning | Load-bearing discovery not reproducible by harness — gap 3 |
| tests/doctor/end-to-end.test.ts | 61, 100, 169, 200, 306 | `ensureSessionEndRegistered` seam bridge still live post-merge | ⚠️ Warning | Masks a future installer SessionEnd regression at e2e level (unit tests still catch it) — WR-04; deletable now |
| src/doctor/version-check.ts | 113-124 | `green` status while shipped string-form rewrite is known-inert for built-ins (caveat only in prose detail) | ⚠️ Warning | Operator's primary signal overstates; detail copy itself is honest and stamped — WR-07. The string→object emission fix has no tracked phase owner |
| tests/copy-drift.test.ts | 36-46 | SCANNED_SOURCES omits version-check.ts / checks.ts / HOOK-CONTRACT.md | ⚠️ Warning | New guarantee-adjacent copy surfaces not drift-gated — WR-06 |
| tests/uat/artifacts/contract-findings.json | evidence_paths | Committed local absolute paths (/Users/me/..., /var/folders/...) | ℹ️ Info | Off-brand for leak-grep discipline — IN-03 |
| repo-wide | — | 36 pre-existing tsc errors (baseline at 6f8706b) | ℹ️ Info | Pre-dates Phase 8; differential gate held (zero new errors); disposition documented in deferred-items.md |

No TBD/FIXME/XXX debt markers in any phase-modified file.

### Human Verification Required

#### 1. E1 rendering observation — accept delegation or redo manually

**Test:** Either (a) confirm you accept the recorded verdict produced by the operator-directed automated tmux PTY capture (you replied "you run it" at the 08-04 Task 3 checkpoint), or (b) run the original 5-minute manual observation: isolated settings file + `claude --settings /tmp/e1-interactive-settings.json --model claude-haiku-4-5`, prompt `echo ORIGINAL_E1_MARKER_q7v4`, observe which marker the tool-result block renders.
**Expected:** The must-have "The interactive terminal-rendering half of E1 has a human-observed verdict" resolves — either by accepted override or by a literally human-observed confirmation matching the recorded verdict (display follows the model-facing value).
**Why human:** Acceptance of the delegated method is an operator decision; terminal rendering is inherently visual.

**This looks intentional.** To accept the delegated observation, add to this file's frontmatter:

```yaml
overrides:
  - must_have: "The interactive terminal-rendering half of E1 has a human-observed verdict"
    reason: "Operator explicitly delegated the observation ('you run it') at the Task 3 checkpoint; one-off automated PTY capture recorded with honest method stamp; committed harness gained no PTY automation"
    accepted_by: "{operator}"
    accepted_at: "{ISO timestamp}"
```

A similar override may be recorded for the reframed upstream request (truth 5) if you want the deviation durable across re-verification:

```yaml
  - must_have: "The upstream feature request for a display-only rewrite channel is filed by the operator and its URL is linked in docs/HOOK-CONTRACT.md"
    reason: "Evidence-driven reframe after the E1 shape-validation discovery; display-only channel retained in #77587 Additional Context as distinguished future ask; operator reviewed and authorized gh CLI filing from own account"
    accepted_by: "{operator}"
    accepted_at: "{ISO timestamp}"
```

### Gaps Summary

The phase delivered most of its goal: four of five contract experiments are settled with honestly stamped, evidence-traced verdicts; the reversible config table, SessionEnd no-op routing, 5-event installer surface with free migration, doctor reversible-state reporting, and the THREAT_MODEL reversible section all exist, are wired, and pass their suites; the upstream issue is genuinely filed (#77587, confirmed live) and linked; PROJECT/CLAUDE stale wording is amended; dist carries the honest copy.

Three gaps block a clean pass:

1. **CR-01 (reproduced):** the phase's `[reversible]` validator repeats a default-baking pattern that makes cross-layer merge silently clear operator opt-ins — a project-layer partial `[reversible]` table (the documented Phase 9 forward-compat scenario) disables a user-layer `enabled = true`. Phase 9 builds directly on `reversible.enabled`; this must be fixed before it is consumed. The same proven pattern silently disables PII protections (pre-existing half, but proven this phase).
2. **E4 unsettled:** the 10K-cap question's "unanswerable — blocked" verdict was invalidated by the phase's own shape-validation discovery; the object-shape rerun that would answer it has no owner in any later phase.
3. **Harness durability:** the documented re-verification procedure destroys the phase's pivotal evidence (E1_shape_validation + rendering) because the findings writer doesn't own those records and the object-shape fixture is wired to nothing.

Gaps 2 and 3 share a root cause (harness doesn't own the object-shape leg) and can close in one focused plan; gap 1 is an independent config-merge fix with cross-layer tests.

---

_Verified: 2026-07-14T22:05:00Z_
_Verifier: Claude (gsd-verifier)_
