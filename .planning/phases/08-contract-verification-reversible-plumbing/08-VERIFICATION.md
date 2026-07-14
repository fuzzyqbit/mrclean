---
phase: 08-contract-verification-reversible-plumbing
verified: 2026-07-14T23:47:30Z
status: gaps_found
score: 14/16 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 12/16
  gaps_closed:
    - "Operator can set the [reversible] config table and the merged effective config honors it across config layers (CR-01 — reproduced FIXED by execution: user opt-in + project partial table now merges to enabled=true; PII repro also preserved; 51/51 config tests; validators contain zero DEFAULT_CONFIG refs)"
    - "The 10K-char output-cap applicability question is empirically settled (E4 — live rerun via the object-shaped Bash leg recorded 'cap does NOT bind updatedToolOutput (~15K survived intact for Bash)'; HOOK-CONTRACT §E4 byte-matches; follow-ups closed)"
  gaps_remaining:
    - "Harness durability (narrowed, not closed): the guarded writer carries forward E1.rendering/E1_shape_validation/E2–E5 and refuses zero-verdict writes, but a partial rerun still destroys the committed E1 per-tool verdicts (reproduced) and a filtered E4/Read-object rerun fabricates verdicts that overwrite the settled answers (code-confirmed)"
  regressions:
    - "HOOK-CONTRACT.md traceability (previously a VERIFIED key link): the 08-09 regeneration left the §E3 evidence excerpt quoting session ids from the destroyed prior artifact (8f87d5ac/e08e5d75 — 0 hits in the committed artifact), and the Read matrix row cites the Bash object-probe session (df4534f2) instead of the Read probe transcript (8ba19558)"
gaps:
  - truth: "The harness is rerunnable on Claude Code upgrades: contract verdicts are recorded findings (SC1 durability / 08-04 truth 3 / 08-08 truth 1)"
    status: partial
    reason: "REPRODUCED during verification against the real committed artifact: buildE1 (tests/uat/findings-builder.ts:109-128) assembles E1 tools and the E1 verdict string exclusively from run.e1Tools with a not-run stub fallback and NO fallback to the previous artifact's E1.tools — a partial rerun recording only E2 passes the zero-verdict guard and rewrites the committed E1 verdict 'Bash: ignored (...); Read: ignored (...); MCP: honored' to 'Bash: not-run; Read: not-run; MCP: not-run', destroying the per-tool evidence the HOOK-CONTRACT §E1 matrix cites. This violates the module's own header guarantee ('stubs appear only when NEITHER side has the record'). Second path (code-confirmed, contract-verification.test.ts:736-754 and :489-532): when the Bash-object leg simply did not run in-process (filtered rerun `vitest -t 'E4'`, or an upgrade run where E1 legs fail at assertSessionRan while later legs succeed), the E4 test still SETS e4Record to an 'unanswerable... (Bash-object verdict: not-run)' verdict and the Read-object leg assembles a 'NOT reproduced this run' shapeValidationRecord — run-wins then overwrites the settled E4 and shape-validation answers. The full-run procedure is safe and was live-proven by 08-09; the upgrade scenario the truth names — a rerun where some legs fail — still destroys committed evidence. The unit tests never catch it: previousArtifact() in findings-builder.test.ts uses tools: {}."
    artifacts:
      - path: "tests/uat/findings-builder.ts"
        issue: "buildE1 (:109-128) has no per-tool carry-forward; only rendering is carried; contradicts the header guarantee at :15-17"
      - path: "tests/uat/contract-verification.test.ts"
        issue: "E4 gating (:732-754) and Read-object shapeValidationRecord assembly (:489-532) record fabricated verdicts when the gate leg is merely not-run-in-process; run-wins overwrites committed answers"
      - path: "tests/uat/findings-builder.test.ts"
        issue: "previousArtifact() fixture uses tools: {} — the E1 per-tool carry gap is uncovered by the offline suite"
    missing:
      - "buildE1 carries forward per-tool records (fresh → previous → stub) and derives the E1 verdict string from the MERGED tool map"
      - "E4 and Read-object legs record NOTHING (leave records undefined) when the object leg did not run in this process, so builder carry-forward preserves the committed answers; fabricate 'unanswerable'/'not reproduced' only when the leg actually ran and produced a non-honored verdict"
      - "Unit test whose previousArtifact() carries populated E1.tools, asserting they survive a run with a disjoint e1Tools set"
  - truth: "docs/HOOK-CONTRACT.md verdicts trace to recorded entries in contract-findings.json (the doc's opening traceability claim; previously a VERIFIED key link)"
    status: partial
    reason: "VERIFIED BY EXECUTION (UUID trace scan): the §E3 evidence excerpt (docs/HOOK-CONTRACT.md:117-119) quotes sid_run1 = 8f87d5ac-b7b7-43bc-95e0-192352a6e416 and fork id e08e5d75-0cdf-4226-bd02-a4f0027a8bff — neither appears in the regenerated artifact (E3.signals now carry 184c5b4a-7a93-4bec-a81e-40d5b3bbe717 / e1036ad1-9ea3-40f1-bf93-e1b461223979). The Read matrix row (:35) cites 'probe session df4534f2-...' — the artifact records that UUID as the BASH object probe session (E1_shape_validation.signals.object_probe_session_id); the Read probe transcript is 8ba19558-500c-4deb-b068-d4903006bb34. The E3 VERDICT itself is unchanged and artifact-confirmed (resume_reuses_session_id: true; fork_minted_new_id: true) — this is citation drift, not a wrong answer. Same root-cause family as gap 1 (regeneration replaced evidence the doc quotes); closable in the same plan."
    artifacts:
      - path: "docs/HOOK-CONTRACT.md"
        issue: "§E3 excerpt (:117-119) quotes destroyed-run sids; Read matrix row (:35) mis-attributes the Bash object-probe session to the Read probe"
    missing:
      - "Refresh the §E3 excerpt with the artifact's current sids (184c5b4a / e1036ad1)"
      - "Cite 8ba19558-500c-4deb-b068-d4903006bb34 for the Read matrix row"
      - "Optional (recommended): copy-drift assertion that every session UUID quoted in HOOK-CONTRACT.md appears in contract-findings.json"
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
  - test: "Accept or redo the E1 terminal-rendering observation method (carried forward unchanged from the initial verification — no override was recorded and the item remains unresolved)"
    expected: "08-04's must-have reads 'human-observed verdict'. The recorded verdict (contract-findings.json experiments.E1.rendering — confirmed to have SURVIVED the 08-09 regeneration via the new carry-forward) was produced by an operator-directed automated tmux PTY capture after the operator replied 'you run it' at the checkpoint — honestly stamped 'operator delegated — NOT the committed harness', but not literally human-observed. Either (a) confirm the delegated automated observation is accepted (add the override below), or (b) run the 5-minute manual observation from 08-04 Task 3 how-to-verify and confirm the terminal renders REWRITTEN_E1_MARKER_x9k2 for the object-shape fixture."
    why_human: "Whether operator delegation satisfies the 'human-observed' intent is an acceptance decision, not a code property; the underlying rendering behavior itself is also inherently visual."
---

# Phase 8: Contract Verification & Reversible Plumbing — Verification Report

**Phase Goal:** Hook-contract unknowns are empirically settled and documented, reversible-mode config/lifecycle plumbing exists with zero behavior change, and THREAT_MODEL.md honestly frames reversible mode before any state code is written
**Verified:** 2026-07-14T23:47:30Z
**Status:** gaps_found
**Re-verification:** Yes — after gap closure (prior: gaps_found, 12/16; plans 08-07/08-08/08-09 executed; fresh code review 08-REVIEW.md committed 2c8b6e6 weighed and its Critical independently reproduced)

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | SC1: E1 (updatedToolOutput honored-ness per tool + terminal rendering) answered, documented, version-stamped | ✓ VERIFIED (regression check) | Artifact E1 verdict "Bash: ignored; Read: ignored; MCP: honored" + E1_shape_validation (object_probe_honored: true, non-empty verbatim_hook_error) survived the 08-09 regeneration; HOOK-CONTRACT §E1 matrix + stamps intact |
| 2  | SC1: E2 (updatedInput context echo) answered and documented | ✓ VERIFIED (regression check) | Artifact E2 "rewrite executed: true; no echo..." carried verbatim; §E2 intact |
| 3  | SC1: E3 (session_id continuity across --resume) answered and documented | ✓ VERIFIED (citation-drift warning) | Artifact E3 confirms resume_reuses_session_id: true, fork_minted_new_id: true; §E3 verdict correct. WARNING: the doc's evidence excerpt quotes destroyed-run sids (gap 2 — traceability, not correctness) |
| 4  | SC1: E4 (10K-char cap applicability) empirically settled | ✓ VERIFIED — GAP CLOSED | Live 08-09 rerun via object leg: verdict "cap does NOT bind updatedToolOutput (~15K survived intact for Bash)"; signals head/tail markers seen, stream_tool_result_char_length 15032; method names e4-object-large-output-hook.sh; stale "#68951 blocked" premise gone (grep 0); §E4 quote byte-matches artifact; both follow-ups closed with owners |
| 5  | SC1: upstream feature request filed and linked | ✓ VERIFIED (re-confirmed live) | `gh issue view 77587` → OPEN, created 2026-07-14, title matches reframed ask; URL at HOOK-CONTRACT.md:193 |
| 6  | SC2: operator can set [reversible] (default OFF) and the merge honors it across layers | ✓ VERIFIED — GAP CLOSED | REPRODUCED FIXED by execution: user `enabled = true` + project `[reversible] future_key = 1` → merged enabled === true; PII repro (user opt-ins + project [pii.regex]-only narrowing) preserves enabled/ner.enabled/confidence=0.9 with entities narrowed to ['email']; single-layer default-fill and absent-table defaults unchanged; 51/51 config tests; all four validator bodies contain 0 DEFAULT_CONFIG refs; cross-layer tests present (future_key in merge+reader suites) |
| 7  | SC2: `mrclean doctor` reports reversible-mode state | ✓ VERIFIED (regression check) | Doctor checks + version-check suites green (50/50 batch incl. dispatcher + copy-drift) |
| 8  | SC2: absent table → shipped v1/v2 behavior byte-identical | ✓ VERIFIED (regression check) | Full `npm test` 633 passed / 14 skipped, exit 0; absent-table repro returns `{enabled:false}`, pii.enabled false; zero edits to detection/placeholder/audit/hook suites across the gap wave |
| 9  | SC3: fresh install registers 5 events, widened SessionStart matcher, SessionEnd routing | ✓ VERIFIED (regression check) | 79/79 install tests green |
| 10 | SC3: re-install on v2.0 shape migrates without duplicates, foreign hooks preserved | ✓ VERIFIED (regression check) | Same suite (migration + idempotency + uninstall-roundtrip green) |
| 11 | SC3: zero exit-2 noise at session start/end | ✓ VERIFIED (regression check) | Artifact E5 record intact (headless firing + real-hook noise verdicts carried); handler still pure (grep: 0 I/O imports in session-end.ts) |
| 12 | SC4: THREAT_MODEL reversible section — blast radius, secret floor, wire re-entry, key-custody, residual risks | ✓ VERIFIED (regression check) | `## Reversible Mode (v3.0)` at THREAT_MODEL.md:141; copy-drift suite green; 08-09 consistency pass confirmed no statements premised on the old E4 verdict (spot-checked: no cap/E4 references in the file) |
| 13 | SC4: PROJECT.md stale return-path wording amended (+ CLAUDE.md mirror) | ✓ VERIFIED (regression check) | "restore MCP tool stub" absent from .planning/PROJECT.md and CLAUDE.md; operator-only `mrclean restore` framing present (3 hits / 1 hit) |
| 14 | Harness rerunnable on CC upgrades without destroying recorded verdicts | ✗ FAILED (partial — narrowed, not closed) | 08-08 delivered real improvements, all verified: zero-verdict guard (skipped run leaves artifact byte-identical — proven), E1.rendering + E1_shape_validation + E2–E5 carry-forward (proven by my repro AND live by 08-09's integrity gate), 6/6 offline builder tests, both fixtures wired (5/3 refs), `pending-interactive` hardcode gone from the suite. BUT reproduced against the committed artifact: a partial rerun recording only E2 rewrites E1 per-tool verdicts to not-run stubs (destroying "Bash: ignored; Read: ignored; MCP: honored"); and the E4/Read-object legs fabricate overwriting verdicts when the object leg merely didn't run in-process. See gap 1 |
| 15 | E1 interactive rendering half has a human-observed verdict | ? UNCERTAIN (carried forward) | Verdict exists, honestly stamped ("operator delegated — NOT the committed harness"), and now survives regeneration via carry-forward. No override recorded since the initial verification — the acceptance decision remains open (see Human Verification) |
| 16 | Plumbing invariants: fail-closed [reversible] validator, unknown-event throw preserved, LOCKED doctor exit-code map unchanged | ✓ VERIFIED (re-proven by execution) | Non-boolean reversible.enabled, string confidence, unpinned model "evil/random-model" all throw ConfigReadError (executed live); dispatcher tests green; every fail-closed throw preserved byte-identical through the CR-01 refactor. WARNING: prototype-chain keys (`model = "constructor"`) bypass the pinned-model gate — pre-existing Phase 6 defect proven by execution, see Anti-Patterns |

**Score:** 14/16 truths verified (1 failed/partial, 1 uncertain)

### Deferred Items

Items not yet met but explicitly owned by later milestone phases (not gaps) — carried forward unchanged:

| # | Item | Addressed In | Evidence |
|---|------|--------------|----------|
| 1 | REVMODE-02 encrypted map persistence | Phase 9 | SC1: "map persists as an encrypted file (AES-256-GCM, fresh IV per write)" |
| 2 | REVMODE-07 reason-aware janitor + TTL sweep | Phase 9 | SC4: "SessionEnd with reason clear/... deletes the session map; resume retains it; orphaned maps... swept" |
| 3 | REVMODE-12 FAIL-loud doctor + mrclean_status counters | Phase 10 | SC5: "doctor FAILs loud (never silent no-op) on unsupported reversible configuration" |
| 4 | THREAT_MODEL finalization vs shipped impl + "encrypted at rest" copy lock | Phase 11 | SC5: "reversible-mode section is finalized against the shipped implementation" |

### Required Artifacts (gap-closure wave; prior-wave artifacts regression-checked green)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/shared/types.ts` | Five partial layer interfaces | ✓ VERIFIED | MrcleanReversibleConfigLayer:370, MrcleanConfigLayer:428 (reversible?:435); full types structurally assignable (DEFAULT_CONFIG legal as layer 1 — no call-site churn) |
| `src/config/index.ts` | Partial validators + merge-time default filling | ✓ VERIFIED | Conditional-spread partials (:219-225, :278-289, :312-316, :342); guarded reversible merge `layer.reversible?.enabled !== undefined` (:549); pii fills via `??` from the accumulated value (:561-597); 0 DEFAULT_CONFIG refs in all four validator bodies (sed|grep) |
| `tests/config/merge.test.ts` / `tests/config/reader.test.ts` | Cross-layer + partiality tests | ✓ VERIFIED | future_key present in both (1/2 hits); Tests G/H/I/J/K in the 51/51-green suite |
| `tests/uat/findings-builder.ts` | Pure guarded builder (min 60 lines) | ⚠️ VERIFIED with defect | 223 lines, pure (no I/O/vitest imports), exports buildFindingsArtifact; guard + rendering/shape_validation/E2–E5 carry-forward work (repro-proven). buildE1 lacks per-tool carry-forward — gap 1 |
| `tests/uat/findings-builder.test.ts` | 6 offline tests (min 60 lines) | ⚠️ VERIFIED with defect | 6/6 passed offline, no MRCLEAN_UAT needed. Fixture uses tools: {} so the per-tool gap is uncovered — gap 1 |
| `tests/uat/contract-verification.test.ts` | Object legs + object-gated E4 + rewired afterAll | ⚠️ VERIFIED with defect | e1-object-rewrite-hook 5 refs (WR-02 orphan closed), e4-object-large-output-hook 3 refs, findings-builder import wired, pending-interactive 0 hits, 11 tests skip cleanly without MRCLEAN_UAT and the artifact stays byte-identical. Fabricated-verdict paths on filtered runs — gap 1 |
| `tests/uat/fixtures/e4-object-large-output-hook.sh` | ~15K object-shaped fixture | ✓ VERIFIED | Executable; contains isImage + E4 markers; leak-grep clean (all 6 fixtures). INFO: no error handling around the node -e emitter (IN-02) |
| `tests/uat/artifacts/contract-findings.json` | Regenerated with E4 settled + curated evidence preserved | ✓ VERIFIED | claude_version 2.1.209, date 2026-07-14; E4 object verdict + signals; E1_shape_validation with non-empty verbatim_hook_error; E1.rendering object with honest method stamp — the 08-08 carry-forward demonstrably worked in the live run. INFO: evidence_paths still leak local absolute paths (IN-03 carry-over) |
| `docs/HOOK-CONTRACT.md` | §E4 settled, Read cell filled, follow-ups closed, guarded-writer procedure | ⚠️ VERIFIED with defect | E4 verdict + read_object_verdict byte-match the artifact; unanswerable/rerun-deferred/UNTESTED all 0 hits; §Closed follow-ups at :172; guarded-writer paragraph at :222-227. §E3 excerpt + Read-row session citation do not trace — gap 2 |
| `dist/cli.js` / `dist/mcp.js` | Rebuilt with the CR-01 merge fix | ✓ VERIFIED | Both contain the guarded merge (`enabled !== undefined`); rebuilt in 695f967 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/config/index.ts | src/shared/types.ts | validators/parseToml/readConfigLayer/mergeConfigs use layer types | ✓ WIRED | MrcleanConfigLayer 7 refs in index.ts |
| src/config/index.ts | merge-time default filling | reversible guard + `?? pii.` accumulated fills | ✓ WIRED | :549, :561-597 — behavior proven by live repro |
| tests/uat/contract-verification.test.ts | tests/uat/fixtures/e1-object-rewrite-hook.sh | E1/Bash-object + E1/Read-object legs | ✓ WIRED | 5 refs (prior ORPHANED status closed) |
| tests/uat/contract-verification.test.ts | tests/uat/findings-builder.ts | afterAll imports buildFindingsArtifact | ✓ WIRED | import confirmed; null → refuses write (proven: skipped run, artifact untouched) |
| tests/uat/contract-verification.test.ts | tests/uat/fixtures/e4-object-large-output-hook.sh | object-gated E4 leg | ✓ WIRED | 3 refs; E4_OBJECT_HOOK first preference |
| docs/HOOK-CONTRACT.md | contract-findings.json | verdicts trace to artifact | ⚠️ PARTIAL | E4 + read_object verdicts byte-match; 3 of 5 quoted session UUIDs trace; §E3 excerpt sids + Read-row citation do NOT trace — gap 2 (regression from the 08-09 regeneration) |
| contract-findings.json | e4-object-large-output-hook.sh | E4 method names the fixture | ✓ WIRED | Method string names the fixture path |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| Merged config reversible/pii | layer partials → accumulated fills | real TOML parse (executed) | Yes — opt-ins survive partial tables | ✓ FLOWING |
| contract-findings.json experiments | buildFindingsArtifact(previous, run) | live 08-09 run + carry-forward | Yes — fresh E4 + preserved curated E1 evidence | ⚠️ FLOWING with destructive edge (partial-run paths, gap 1) |
| HOOK-CONTRACT §E4/§E1 verdicts | quoted artifact strings | regenerated artifact | Yes (byte-match confirmed) | ⚠️ PARTIAL (§E3 excerpt stale — gap 2) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CR-01 reversible repro (user opt-in + project partial table) | tsx repro via loadEffectiveConfig | reversible.enabled === true | ✓ PASS (was FAIL) |
| CR-01 PII repro (user opt-ins + project regex-only narrowing) | tsx repro | enabled/ner.enabled/conf=0.9 kept; entities narrowed | ✓ PASS (was FAIL) |
| Single-layer default-fill + absent-table defaults | tsx repro | ner.model/confidence default-filled; {enabled:false} | ✓ PASS |
| Fail-closed throws (non-bool enabled, string confidence, unpinned model) | tsx repro | all throw ConfigReadError | ✓ PASS |
| Prototype-chain model key (`model = "constructor"`) | tsx repro | ACCEPTED by pinned-model gate | ✗ FAIL (warning — WR-02, pre-existing) |
| E1 per-tool carry-forward under partial rerun | tsx repro vs committed artifact | E1 verdict → "Bash: not-run; Read: not-run; MCP: not-run"; rendering/shape_validation/E4 carried | ✗ FAIL (gap 1 — review Critical independently reproduced) |
| Config suite | `npx vitest run --project=unit tests/config/` | 51/51 passed | ✓ PASS |
| Findings-builder offline suite | `npx vitest run --project=uat tests/uat/findings-builder.test.ts` (no MRCLEAN_UAT) | 6/6 passed | ✓ PASS |
| Guard proof: skipped run leaves artifact untouched | contract suite without MRCLEAN_UAT | 11 skipped; `git status tests/uat/artifacts/` empty | ✓ PASS |
| Doctor + dispatcher + copy-drift | vitest batch | 50/50 passed | ✓ PASS |
| Installer suites | `npx vitest run tests/install/` | 79/79 passed | ✓ PASS |
| Full suite (byte-identical gate) | `npm test` | 633 passed / 14 skipped, exit 0 | ✓ PASS |
| Typecheck differential | `npm run typecheck` | exactly 36 errors = baseline (zero new) | ✓ PASS |
| Upstream issue live | `gh issue view 77587` | OPEN, created 2026-07-14, reframed title | ✓ PASS |
| Doc↔artifact byte-match (E4, read_object) | node byte-match | both true | ✓ PASS |
| Doc UUID traceability scan | node scan of all quoted session UUIDs | 3 trace, 2 do NOT trace (8f87d5ac, e08e5d75) | ✗ FAIL (gap 2) |
| Fixture hygiene | executable bits + leak-grep (AKIA/ghp_/sk-ant) | all 6 executable; 0 leak hits | ✓ PASS |
| session-end no-I/O invariant | grep for config/fs/session-state imports | 0 hits | ✓ PASS |
| Claimed commits exist | git cat-file on 9 hashes (incl. review commit) | all present | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes exist in this repo and none are declared by the gap-closure plans. Step 7c: SKIPPED (no probes declared; the live harness is MRCLEAN_UAT-gated and spends API tokens — the 08-09 live run's committed artifacts, opt-in skip behavior, and guard were verified directly instead).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| REVMODE-10 | 08-04, 08-05, 08-08, 08-09 | Contract behaviors empirically verified + documented; upstream request filed | ✓ SATISFIED (caveats) | All four contract clauses now settled: E1 (per-tool + rendering), E2, E3, E4 (live object-leg rerun); #77587 filed & re-confirmed OPEN. REQUIREMENTS.md `[x]` / Complete — consistent now that E4 is settled. Caveats: rendering-method acceptance is the open human item; the harness durability defect (gap 1) risks the recorded evidence on partial reruns but does not unsettle the requirement's clauses today |
| REVMODE-03 | 08-06, 08-09 | THREAT_MODEL reversible section + PROJECT.md amendment | ✓ SATISFIED | Section + five subsections intact; 08-09 consistency pass found no E4-premised statements to amend; PROJECT/CLAUDE amendments hold; REQUIREMENTS.md `[x]` / Complete |
| REVMODE-02 | 08-01, 08-07 (groundwork) | Config table clause only | ✓ ON TRACK (Phase 9) | CR-01 correctness fix delivered; correctly NOT marked complete |
| REVMODE-07 | 08-02 (groundwork) | Installer/dispatcher clauses only | ✓ ON TRACK (Phase 9) | Unchanged; correctly NOT marked complete |
| REVMODE-12 | 08-03 (groundwork) | Reporting-only doctor clause | ✓ ON TRACK (Phase 10) | Unchanged; correctly NOT marked complete |

Orphan check: REQUIREMENTS.md maps exactly REVMODE-03 and REVMODE-10 to Phase 8 (lines 60, 67) — both claimed by plans. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| tests/uat/findings-builder.ts | 109-128 | buildE1 stubs per-tool verdicts on partial runs, contradicting the module's own header guarantee (:15-17) | 🛑 Blocker | Committed E1 evidence destructible — gap 1 (review CR-01, independently reproduced) |
| tests/uat/contract-verification.test.ts | 732-754, 489-532 | E4/Read-object legs fabricate overwriting verdicts when the gate leg is not-run-in-process | 🛑 Blocker | Settled E4/shape-validation answers destructible by filtered reruns — gap 1 (review WR-01) |
| docs/HOOK-CONTRACT.md | 117-119, 35 | Evidence citations don't trace to the regenerated artifact | ⚠️ Warning | Doc's traceability claim broken in two spots — gap 2 (review WR-03; verified by execution) |
| src/config/index.ts (+ src/model/pipeline-singleton.ts) | 250 (:119-124) | `in MODEL_DESCRIPTORS` accepts prototype-chain keys (`"constructor"` ACCEPTED — proven by execution) | ⚠️ Warning | Pinned-model integrity gate inert for these inputs; failure mode is an unstructured downstream crash, not the designed fail-closed error. Pre-existing from Phase 6 — needs a tracked owner (review WR-02) |
| src/config/index.ts | 510-554 | DEFAULT_CONFIG applied twice (seed + layer 1): latent allowlist double-concat + frozen-object aliasing for entropy/secrets_files/rules | ⚠️ Warning | Invisible today (default axes empty); bites when a bundled default allowlist entry is added (review WR-04) |
| tests/uat/contract-verification.test.ts | 284-295 | scanHookErrorExcerpt flat 600-char slice trails into unrelated transcript JSON; doc quote not byte-verbatim | ℹ️ Info | Review IN-01 |
| tests/uat/fixtures/e4-object-large-output-hook.sh | 22-34 | No error handling around the node -e payload emitter (silent no-op → "indeterminate" run-wins overwrite) | ℹ️ Info | Review IN-02; compounds gap 1's run-wins exposure |
| tests/uat/artifacts/contract-findings.json | evidence_paths | Committed local absolute paths (/Users/me/...) | ℹ️ Info | IN-03 carry-over from initial verification |
| src/shared/types.ts / post-tool-use.ts | 154-165 | Shipped updatedToolOutput still string-only → PostToolUse rewrite inert for built-in Bash (honestly documented) | ⚠️ Warning (carried) | Prior WR-07 / review IN-03: the object-shape emitter fix still has no tracked phase owner |
| tests/doctor/end-to-end.test.ts | 61-306 | `ensureSessionEndRegistered` seam bridge (carried, unchanged by gap wave) | ⚠️ Warning (carried) | Prior WR-04 — deletable now |
| tests/copy-drift.test.ts | 36-46 | SCANNED_SOURCES omits version-check.ts / checks.ts / HOOK-CONTRACT.md (carried) | ⚠️ Warning (carried) | Prior WR-06; a UUID-traceability assertion (gap 2 recommendation) would fit here |

No TBD/FIXME/XXX debt markers in any phase-modified file (scanned all 10 gap-wave files plus docs).

### Human Verification Required

#### 1. E1 rendering observation — accept delegation or redo manually (carried forward)

**Test:** Either (a) confirm you accept the recorded verdict produced by the operator-directed automated tmux PTY capture (you replied "you run it" at the 08-04 Task 3 checkpoint), or (b) run the original 5-minute manual observation: isolated settings file + `claude --settings /tmp/e1-interactive-settings.json --model claude-haiku-4-5`, prompt `echo ORIGINAL_E1_MARKER_q7v4`, observe which marker the tool-result block renders.
**Expected:** The must-have "The interactive terminal-rendering half of E1 has a human-observed verdict" resolves — either by accepted override or by a literally human-observed confirmation matching the recorded verdict (display follows the model-facing value). Note: the recorded evidence now survives harness reruns (carry-forward verified live), so option (a) is durable once accepted.
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

Two of the three prior gaps are cleanly closed, verified by execution, not summary claims:

1. **CR-01 (closed):** parsed TOML layers are true Partials and defaults fill exactly once in mergeConfigs. Both proven repro configurations now pass live (reversible opt-in survives a partial project table; PII opt-ins survive project narrowing while the narrowing still applies), all four validator bodies are DEFAULT_CONFIG-free, the full suite is green with zero detection/placeholder/audit/hook edits, and dist carries the fix.
2. **E4 (closed):** the live 08-09 rerun through the object-shaped Bash leg settled the cap question empirically — "cap does NOT bind updatedToolOutput (~15K survived intact for Bash)" — with byte-matching HOOK-CONTRACT copy, honest downstream implications (tested to ~15K, re-run before relying on far-larger sizes), the Read-object follow-up closed (Bash-style object REJECTED with the zod invalid_union error on record), and zero unowned open follow-ups.

One gap remains, narrowed but real, plus one regression it caused:

3. **Harness durability (partial):** the 08-08 writer genuinely fixed the worst failure modes — zero-verdict guard, verbatim carry-forward for E1.rendering/E1_shape_validation/E2–E5, all live-proven by the 08-09 regeneration preserving the curated evidence. But the review's new Critical is real and was independently reproduced against the committed artifact: `buildE1` carries forward `rendering` and nothing else, so any partial rerun (a filtered `vitest -t 'E2'`, or a CC-upgrade run where the E1 legs fail while later legs succeed — exactly the rerun scenario this truth exists for) rewrites the committed E1 per-tool verdicts to not-run stubs. A second path lets a filtered E4 or Read-object run fabricate "unanswerable"/"not reproduced" verdicts that run-wins over the freshly settled answers. The fix is small and well-specified in 08-REVIEW.md (per-tool carry-forward + record-nothing-when-leg-not-run + one unit test with populated prev tools).
4. **Doc traceability (regression):** the regeneration left HOOK-CONTRACT's §E3 excerpt quoting destroyed-run session ids and the Read matrix row citing the Bash probe session — two citation fixes plus an optional copy-drift UUID assertion, naturally part of the same closure plan as gap 3.

Gaps 3 and 4 share a root cause (regeneration vs. quoted evidence) and can close in one small focused plan with no live tokens required.

---

_Verified: 2026-07-14T23:47:30Z_
_Verifier: Claude (gsd-verifier)_
