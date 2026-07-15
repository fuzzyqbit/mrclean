---
phase: 08-contract-verification-reversible-plumbing
verified: 2026-07-15T01:25:43Z
status: passed
score: 16/16 must-haves verified (15 direct + 1 accepted override)
overrides_applied: 1
overrides:
  - must_have: "The interactive terminal-rendering half of E1 has a human-observed verdict"
    reason: "Operator explicitly delegated the observation ('you run it') at the Task 3 checkpoint; one-off automated PTY capture recorded with honest method stamp; committed harness gained no PTY automation"
    accepted_by: "operator"
    accepted_at: "2026-07-15T01:34:11Z"
    method: "delegated-tmux-pty (accepted via AskUserQuestion gate)"
re_verification:
  previous_status: gaps_found
  previous_score: 14/16
  gaps_closed:
    - "Harness durability (gap 1, fully closed): buildE1 carries per-tool records forward (fresh -> previous -> stub) with the verdict derived from the MERGED map, re-emits the previous E1 verbatim (provenance stamps intact) when a run contributed zero E1 verdicts, and preserves unknown tool keys by union iteration; the E4 record-nothing gate is widened to `e1ObjectBash === undefined` alone (flaked-leg fabrication path closed); the Read-object leg records nothing when the gate leg is absent and warns loudly when a genuine drift observation is dropped; string_shape_rejected is honest about observation state ('not-observed-this-run' + string_leg_verdict corroboration) instead of flipping to a fabricated false; an unparseable committed artifact fails loud and refuses the write. All reproduced by execution against the REAL committed artifact: an E2-only rerun on a simulated future Claude Code version leaves E1/E1_shape_validation/E3/E4/E5 byte-identical including stamps"
    - "HOOK-CONTRACT.md traceability (gap 2, fully closed): all 5 session UUIDs quoted in the doc trace to contract-findings.json (0 untraced; stale 8f87d5ac/e08e5d75/df4534f2 citations gone); §E3 quotes the committed sids 184c5b4a/e1036ad1; the Read matrix row cites the Read probe transcript 8ba19558; E4 and read_object_verdict quotes still byte-match; a permanent copy-drift UUID-traceability gate with a non-vacuous >=1 guard and a fabricated-UUID positive control is green (15/15)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Accept or redo the E1 terminal-rendering observation method (carried forward unchanged — no override has been recorded through two re-verifications)"
    expected: "08-04's must-have reads 'human-observed verdict'. The recorded verdict (contract-findings.json experiments.E1.rendering — durable across reruns via the now-hardened carry-forward) was produced by an operator-directed automated tmux PTY capture after the operator replied 'you run it' at the checkpoint — honestly stamped 'operator delegated — NOT the committed harness', but not literally human-observed. Either (a) confirm the delegated automated observation is accepted (add the override below), or (b) run the 5-minute manual observation from 08-04 Task 3 how-to-verify and confirm the terminal renders REWRITTEN_E1_MARKER_x9k2 for the object-shape fixture."
    why_human: "Whether operator delegation satisfies the 'human-observed' intent is an acceptance decision, not a code property; the underlying rendering behavior itself is also inherently visual."
---

# Phase 8: Contract Verification & Reversible Plumbing — Verification Report (Final Re-verification)

**Phase Goal:** Hook-contract unknowns are empirically settled and documented, reversible-mode config/lifecycle plumbing exists with zero behavior change, and THREAT_MODEL.md honestly frames reversible mode before any state code is written
**Verified:** 2026-07-15T01:25:43Z
**Status:** human_needed
**Re-verification:** Yes — third pass, after gap-closure round 2 (plans 08-10/08-11) plus the six round-2 review fixes (commits 79705c1, e5b5601, ca767a8, d257e30, e5fcb57, 14707d2 — all confirmed present in git and verified in source, not from SUMMARY claims)

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | SC1: E1 (updatedToolOutput honored-ness per tool + terminal rendering) answered, documented, version-stamped | ✓ VERIFIED (regression) | Artifact E1 verdict "Bash: ignored; Read: ignored; MCP: honored" + E1_shape_validation intact (claude_version 2.1.209, date 2026-07-14); HOOK-CONTRACT §E1 matrix intact; full suite green |
| 2  | SC1: E2 (updatedInput context echo) answered and documented | ✓ VERIFIED (regression) | Artifact E2 record intact; carried verbatim through all repro scenarios this round |
| 3  | SC1: E3 (session_id continuity across --resume) answered and documented | ✓ VERIFIED — citation drift RESOLVED | Artifact E3 confirms resume_reuses_session_id: true, fork_minted_new_id: true; §E3 excerpt now quotes the committed sids 184c5b4a-7a93-4bec-a81e-40d5b3bbe717 / e1036ad1-9ea3-40f1-bf93-e1b461223979 (prior-round warning cleared) |
| 4  | SC1: E4 (10K-char cap applicability) empirically settled | ✓ VERIFIED (regression) | Committed verdict "cap does NOT bind updatedToolOutput (~15K survived intact for Bash)" intact; §E4 quote byte-matches artifact (re-executed byte-match: true) |
| 5  | SC1: upstream feature request filed and linked | ✓ VERIFIED (re-confirmed live) | `gh issue view 77587` → state OPEN, created 2026-07-14, reframed title; URL linked in HOOK-CONTRACT.md |
| 6  | SC2: operator can set [reversible] (default OFF) and the merge honors it across layers | ✓ VERIFIED (regression) | Full suite 639/14 green includes 51/51 config tests; dist/cli.js and dist/mcp.js carry the guarded merge (`layer.reversible?.enabled !== void 0` — esbuild-transpiled form of the source guard); zero src changes since 695f967 rebuild (fix commits touched only tests/), so dist is current |
| 7  | SC2: `mrclean doctor` reports reversible-mode state | ✓ VERIFIED (regression) | Doctor/dispatcher suites inside the green 639/14 full run; REVERSIBLE_DETAIL strings present in dist |
| 8  | SC2: absent table → shipped v1/v2 behavior byte-identical | ✓ VERIFIED (regression) | `npm test` 639 passed / 14 skipped, exit 0; zero detection/placeholder/audit/hook edits in the fix wave (git diff 46837e5..HEAD touches only 3 test files) |
| 9  | SC3: fresh install registers 5 events, widened SessionStart matcher, SessionEnd routing | ✓ VERIFIED (regression) | Install suites inside the green full run; unchanged by fix wave |
| 10 | SC3: re-install on v2.0 shape migrates without duplicates, foreign hooks preserved | ✓ VERIFIED (regression) | Same suites green; unchanged by fix wave |
| 11 | SC3: zero exit-2 noise at session start/end | ✓ VERIFIED (regression) | Artifact E5 record intact (carried verbatim in all repros); session-end handler still pure (only a type import: `import type { SessionEndInput }`) |
| 12 | SC4: THREAT_MODEL reversible section — blast radius, secret floor, wire re-entry, key-custody, residual risks | ✓ VERIFIED (regression) | `## Reversible Mode (v3.0)` at THREAT_MODEL.md:141 (repo root); copy-drift honest-framing tests green in 15/15 suite |
| 13 | SC4: PROJECT.md stale return-path wording amended (+ CLAUDE.md mirror) | ✓ VERIFIED (regression) | "restore MCP tool stub" 0 hits in .planning/PROJECT.md and CLAUDE.md |
| 14 | Harness rerunnable on CC upgrades without destroying recorded verdicts | ✓ VERIFIED — GAP CLOSED (adversarially re-probed) | See Gap-Closure Evidence below: every previously reproduced destruction/fabrication path re-tested against the REAL committed artifact and confirmed closed; 10/10 offline builder tests; both record-nothing gates in source (comment-filtered grep = 2); old conjunct gate gone (0 hits) |
| 15 | E1 interactive rendering half has a human-observed verdict | ? UNCERTAIN (carried forward) | Verdict exists, honestly stamped ("operator delegated — NOT the committed harness"), durable across reruns. No override recorded (frontmatter overrides_applied: 0 in both prior verifications) — the acceptance decision remains open (see Human Verification) |
| 16 | Plumbing invariants: fail-closed [reversible] validator, unknown-event throw preserved, LOCKED doctor exit-code map unchanged | ✓ VERIFIED (regression) | Proven by execution in the prior round; fix commits touched only tests/uat + tests/copy-drift (git diff --stat 46837e5..HEAD), so src validators are byte-identical to the live-proven state; full suite green |

**Score:** 15/16 truths verified (1 uncertain — human acceptance decision)

### Gap-Closure Evidence (adversarial re-probes, all run in this verification — not trusted from SUMMARY/fixer claims)

**Gap 1 — harness durability.** Each failure mode documented in 08-REVIEW.md (round 2) checked against source and, where offline-testable, executed against the REAL committed `tests/uat/artifacts/contract-findings.json`:

| Failure mode (review ID) | Fix verified | Method | Result |
|---|---|---|---|
| Partial rerun (E2-only) rewrites E1 per-tool verdicts to not-run stubs (round-1 CR-01) | buildE1 per-tool carry-forward + merged-map verdict (findings-builder.ts:119-136) | tsx repro: buildFindingsArtifact(realArtifact, {e2 only, claudeVersion 2.2.500}) | E1/E1_shape_validation/E3/E4/E5 ALL byte-identical to committed (JSON.stringify equality) |
| Wholly carried-forward E1 re-stamped with fresh run's version — provenance fabrication (round-2 CR-02) | Verbatim re-emit `if (Object.keys(run.e1Tools).length === 0 && prevE1 !== undefined) return { ...prevE1 }` (findings-builder.ts:118) | Same repro on simulated CC 2.2.500 upgrade + unit test asserting deliberately-older stamps (2.1.100/2026-06-01) survive | E1.claude_version stays "2.1.209 (Claude Code)"; unit test green |
| Mixed flake (string Bash recorded, object leg flaked) fabricates "unanswerable" E4 and destroys settled verdict (round-2 CR-01) | E4 gate widened to `e1ObjectBash === undefined` alone (contract-verification.test.ts:791); old conjunct `Object.keys(e1Tools).length === 0` fully removed (grep = 0) | Source trace of the exact review scenario: objectLeg=false, stringHonored=undefined, e1Tools non-empty → gate fires on undefined object leg → return, e4Record stays undefined → buildE4 carry-forward (repro-proven verbatim) | Closed; honest-drift path (object leg RAN, non-honored) still falls through and records — "unanswerable" template preserved (grep = 3) |
| Filtered rerun fabricates shapeValidationRecord when gate leg absent | Read-object gate `if (e1ObjectBash === undefined)` (contract-verification.test.ts:515) | Source trace + `vitest -t 'E4'` reasoning: zero recorded verdicts → guard returns null → artifact untouched (proven: 11 skipped run leaves `git status tests/uat/artifacts/` empty) | Closed |
| `string_shape_rejected: true` flipped to fabricated `false` by a `-t 'object'` rerun (round-2 WR-01) | `stringLegObserved ? stringRejected : 'not-observed-this-run'` + `string_leg_verdict` corroboration (contract-verification.test.ts:529-563) | Source verification: the committed boolean can no longer be replaced by a fabricated false; an unobserved string leg yields the honest sentinel plus carried verbatim_hook_error (field fallback, unit-tested) | Closed per the review's accepted fix option A |
| Genuine drift observation silently dropped (round-2 WR-02) | console.warn "observation DROPPED ... rerun the full E1 suite to record it" before the gate return (:516-518) | grep + source read | Closed |
| Unknown tool keys truncated (round-2 WR-03) | Union iteration `[...new Set([...E1_TOOL_ORDER, ...run keys, ...prev keys])]` (findings-builder.ts:131) | tsx repro: real artifact + synthetic Edit key survives a mixed rerun verbatim and appears in the verdict string; unit test asserts ['Bash','Read','MCP','Edit'] ordering | Closed |
| Unparseable committed artifact treated as absent — re-arms wholesale overwrite (round-2 WR-04) | catch → console.error "unparseable — refusing to overwrite" → return BEFORE any write (contract-verification.test.ts:365-375) | Source read (no other write path exists in afterAll); behavior not live-tested to avoid corrupting committed state | Closed (code-verified) |

**Gap 2 — doc traceability.** Executed scans, not doc claims:

- Whole-doc UUID trace: 5 unique session UUIDs quoted (e244a7f9, 8ba19558, 79b56324, 184c5b4a, e1036ad1) — **0 untraced** against the raw artifact.
- Stale citations gone: 8f87d5ac / e08e5d75 / df4534f2 — 0 hits in docs/HOOK-CONTRACT.md.
- §E3 excerpt (doc :117-119) quotes the committed `sid_run1 = 184c5b4a-...` and fork id `e1036ad1-...` — matches `experiments.E3.signals` exactly (checked against parsed JSON).
- Read matrix row (:35) cites probe session `8ba19558-...` with the `read_object_verdict`/`read_object_hook_error` signal paths.
- Byte-match re-executed: doc contains `experiments.E4.verdict` and `experiments.E1_shape_validation.signals.read_object_verdict` verbatim — both true.
- Non-vacuous gate: tests/copy-drift.test.ts:181-216 — `extractSessionUuids` + `expect(quotedUuids.length).toBeGreaterThanOrEqual(1)` guard + fabricated-UUID positive control (00000000-0000-4000-8000-000000000000 flagged untraced). Suite 15/15 green.

### Required Artifacts (fix-wave scope; prior-wave artifacts regression-checked via full suite)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `tests/uat/findings-builder.ts` | Per-tool carry-forward, verbatim re-emit, union iteration | ✓ VERIFIED | 244 lines, pure (no I/O/vitest imports); header guarantee (:15-19) now factually true — proven by repro |
| `tests/uat/findings-builder.test.ts` | Populated previousArtifact() E1.tools + stamp/union/stub coverage | ✓ VERIFIED | 10/10 offline tests, no MRCLEAN_UAT; fixture mirrors committed verdicts with deliberately older stamps; `tools: {}` coverage hole gone |
| `tests/uat/contract-verification.test.ts` | Widened E4 gate, Read-object gate + warn, honest string_shape signal, fail-loud parse | ✓ VERIFIED | All four in source at :791, :515, :516-518, :529-563, :365-375; comment-filtered `e1ObjectBash === undefined` count = 2; 11 skipped cleanly without MRCLEAN_UAT, artifact byte-identical |
| `tests/copy-drift.test.ts` | UUID traceability gate, non-vacuous, positive control | ✓ VERIFIED | 15/15 green; ≥1 extraction guard + fabricated-UUID control both present |
| `docs/HOOK-CONTRACT.md` | Citations trace; verdict quotes byte-match | ✓ VERIFIED | 5/5 UUIDs trace; stale sids 0 hits; E4 + read_object byte-match true |
| `tests/uat/artifacts/contract-findings.json` | Untouched by fix wave | ✓ VERIFIED | `git status --porcelain tests/uat/artifacts/` empty throughout all suite runs this verification |
| `dist/cli.js` / `dist/mcp.js` | Current (no src changes since 695f967) | ✓ VERIFIED | Guarded merge present in both (`reversible?.enabled !== void 0`, 1 hit each); fix commits touched only tests |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| tests/uat/findings-builder.test.ts | tests/uat/findings-builder.ts | buildFindingsArtifact import, offline durability proof | ✓ WIRED | 10/10 green without MRCLEAN_UAT |
| tests/uat/findings-builder.ts | previous artifact E1.tools | recordAt(prevE1 ?? {}, 'tools') per-tool lookup | ✓ WIRED | Repro-proven against the real committed artifact |
| tests/uat/contract-verification.test.ts | tests/uat/findings-builder.ts | afterAll → buildFindingsArtifact; undefined records trigger carry-forward | ✓ WIRED | null → refuses write (proven: skipped run, artifact untouched); unparseable → refuses write (code-verified) |
| tests/copy-drift.test.ts | docs/HOOK-CONTRACT.md + contract-findings.json | UUID extraction asserted as subset of artifact | ✓ WIRED | Non-vacuous + positive control, 15/15 |
| docs/HOOK-CONTRACT.md | contract-findings.json | verdicts + all quoted session UUIDs trace | ✓ WIRED | Previously PARTIAL — restored: 0 untraced, byte-matches true, now build-enforced |
| contract-findings.json | e4-object-large-output-hook.sh | E4 method names the fixture | ✓ WIRED (regression) | Method string intact in committed artifact |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| contract-findings.json experiments | buildFindingsArtifact(previous, run) | live 08-09 run + hardened carry-forward | Yes — and destructive edges from both prior rounds now closed (repro-proven) | ✓ FLOWING |
| HOOK-CONTRACT verdicts + citations | quoted artifact strings/UUIDs | committed artifact | Yes — byte-match + 5/5 UUID trace, build-enforced by copy-drift gate | ✓ FLOWING |
| Merged config reversible/pii | layer partials → accumulated fills | real TOML parse | Yes (regression: 51/51 config tests inside green full suite; dist carries guard) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite (byte-identical gate) | `npm test` | 639 passed / 14 skipped, exit 0 | ✓ PASS |
| Findings-builder offline suite | `npx vitest run --project=uat tests/uat/findings-builder.test.ts` (no MRCLEAN_UAT) | 10/10 passed | ✓ PASS |
| Copy-drift suite incl. UUID gate + positive control | `npx vitest run --project=unit tests/copy-drift.test.ts` | 15/15 passed | ✓ PASS |
| Contract suite skip-guard | `npx vitest run --project=uat tests/uat/contract-verification.test.ts` (no MRCLEAN_UAT) | 11 skipped, exit 0; artifact untouched | ✓ PASS |
| E2-only partial rerun vs REAL artifact (simulated CC 2.2.500 upgrade) | tsx repro | E1/E1_shape_validation/E3/E4/E5 byte-identical incl. stamps; committed E4 verdict + string_shape_rejected: true preserved | ✓ PASS (was FAIL) |
| Mixed rerun (fresh Bash only) vs REAL artifact | tsx repro | Read/MCP carried verbatim; verdict from MERGED map; rendering carried | ✓ PASS (was FAIL) |
| Unknown tool key (synthetic Edit) survival | tsx repro | Carried verbatim + in verdict string | ✓ PASS |
| Zero-verdict guard | tsx repro | returns null | ✓ PASS |
| Typecheck differential | `npm run typecheck` | exactly 36 errors = baseline (zero new) | ✓ PASS |
| Doc UUID traceability scan | node scan | 5 unique UUIDs, 0 untraced | ✓ PASS (was FAIL) |
| Doc↔artifact byte-match (E4, read_object) | node byte-match | both true | ✓ PASS |
| Upstream issue live | `gh issue view 77587` | OPEN, 2026-07-14, reframed title | ✓ PASS |
| Fix commits exist | git cat-file on 6 hashes + review commit 46837e5 | all present; diff scope = 3 test files only | ✓ PASS |
| Debt markers in phase-modified files | grep TBD/FIXME/XXX across 5 files | 0 hits | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes exist in this repo (find = 0) and none are declared by plans 08-10/08-11 (grep = 0). Step 7c: SKIPPED (no probes declared; the live harness is MRCLEAN_UAT-gated and spends API tokens — offline repros against the committed artifact were run instead, above).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| REVMODE-10 | 08-04, 08-05, 08-08, 08-09, 08-10, 08-11 | Contract behaviors empirically verified + documented; upstream request filed | ✓ SATISFIED | All four contract clauses settled and now durably recorded (destruction/fabrication paths closed); #77587 OPEN; REQUIREMENTS.md line 23 `[x]`, line 67 Complete. Remaining caveat: rendering-method acceptance is the open human item |
| REVMODE-03 | 08-06, 08-09, 08-11 | THREAT_MODEL reversible section + PROJECT.md amendment | ✓ SATISFIED | Section at THREAT_MODEL.md:141; PROJECT/CLAUDE amendments hold; REQUIREMENTS.md line 29 `[x]`, line 60 Complete |
| REVMODE-02 / -07 / -12 | groundwork only | Later-phase clauses | ✓ ON TRACK (Phases 9/9/10) | Correctly NOT marked complete; see Deferred Items in prior verification (unchanged) |

Orphan check: REQUIREMENTS.md maps exactly REVMODE-03 and REVMODE-10 to Phase 8 (lines 60, 67) — both claimed by plans. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/config/index.ts (+ src/model/pipeline-singleton.ts) | ~250 | `in MODEL_DESCRIPTORS` accepts prototype-chain keys (`model = "constructor"` ACCEPTED — proven by execution in prior round; unchanged by fix wave) | ⚠️ Warning (carried — OWNER NEEDED) | Pre-existing Phase 6 defect; pinned-model gate inert for these inputs; NOT a Phase 8 truth — needs a tracked owner (round-2 review confirmed not made worse) |
| src/config/index.ts | 510-554 | DEFAULT_CONFIG applied twice (seed + layer 1): latent allowlist double-concat + frozen-object aliasing | ⚠️ Warning (carried — OWNER NEEDED) | Invisible today; bites when a bundled default allowlist entry is added (round-1 WR-04) |
| tests/uat/findings-builder.ts | 140-148 | Mixed-case E1 provenance granularity: a rerun with ≥1 fresh E1 verdict re-stamps the whole E1 record (carried Read/MCP records fall under the fresh run's claude_version/date) — repro-confirmed: E1.claude_version becomes 2.2.500 while Read/MCP verdicts are carried | ⚠️ Warning | Round-2 CR-02's PRIMARY path (wholly-carried re-stamp) is closed and test-locked; the review's secondary suggestion (per-tool stamps in ToolVerdict) was not implemented. Verdicts are never destroyed; git history recovers stamps. Residual, owner needed |
| tests/copy-drift.test.ts | 181 | SESSION_UUID_RX lowercase-only, no `i` flag — an uppercase-pasted UUID would be invisible to the gate | ℹ️ Info | Round-2 review IN-01, unaddressed (Info items out of fixer scope) |
| tests/uat/findings-builder.ts / contract-verification.test.ts | RunRecords / :457 | e1ObjectBash not part of RunRecords — a Bash-object-only filtered rerun's observation is unpersisted and the "no experiment recorded a verdict" warn is misleading for it | ℹ️ Info | Round-2 review IN-02, unaddressed; conservative (nothing destroyed) |
| docs/HOOK-CONTRACT.md | 34 | Bash object cell cites the PTY rendering probe session (e244a7f9) alongside the harness fixture; the fixture-backed probe session is df4534f2 (in artifact, no longer in doc) | ℹ️ Info | Round-2 review IN-03, unaddressed; both citations trace, attribution is imprecise |
| tests/uat/artifacts/contract-findings.json | evidence_paths | Committed local absolute paths (/Users/me/...) | ℹ️ Info | IN-03 carry-over from initial verification |
| src/shared/types.ts / post-tool-use.ts | 154-165 | Shipped updatedToolOutput still string-only → PostToolUse rewrite inert for built-in Bash (honestly documented) | ⚠️ Warning (carried — OWNER NEEDED) | Object-shape emitter fix has no tracked phase owner |
| tests/doctor/end-to-end.test.ts | 61-306 | `ensureSessionEndRegistered` seam bridge | ⚠️ Warning (carried) | Round-1 WR-04 — deletable now |
| tests/copy-drift.test.ts | 36-46 | SCANNED_SOURCES omits version-check.ts / checks.ts / HOOK-CONTRACT.md prose | ⚠️ Warning (carried) | Round-1 WR-06 (the UUID gate added this round covers citations, not banned phrases) |

No TBD/FIXME/XXX debt markers in any phase-modified file.

### Human Verification Required

#### 1. E1 rendering observation — accept delegation or redo manually (carried forward, third round)

**Test:** Either (a) confirm you accept the recorded verdict produced by the operator-directed automated tmux PTY capture (you replied "you run it" at the 08-04 Task 3 checkpoint), or (b) run the original 5-minute manual observation: isolated settings file + `claude --settings /tmp/e1-interactive-settings.json --model claude-haiku-4-5`, prompt `echo ORIGINAL_E1_MARKER_q7v4`, observe which marker the tool-result block renders.
**Expected:** The must-have "The interactive terminal-rendering half of E1 has a human-observed verdict" resolves — either by accepted override or by a literally human-observed confirmation matching the recorded verdict (display follows the model-facing value). The recorded evidence is now durably protected: partial/filtered/flaked reruns can no longer destroy or re-stamp it (proven this round), so option (a) is a one-time decision.
**Why human:** Acceptance of the delegated method is an operator decision; terminal rendering is inherently visual.

**This looks intentional.** To accept the delegated observation, add to this file's frontmatter:

```yaml
overrides:
  - must_have: "The interactive terminal-rendering half of E1 has a human-observed verdict"
    reason: "Operator explicitly delegated the observation ('you run it') at the Task 3 checkpoint; one-off automated PTY capture recorded with honest method stamp; committed harness gained no PTY automation"
    accepted_by: "{operator}"
    accepted_at: "{ISO timestamp}"
```

### Gaps Summary

No gaps remain. Both round-2 gaps are closed and were verified adversarially by execution against the real committed artifact, not from fixer or SUMMARY claims:

1. **Harness durability (closed):** every documented destruction/fabrication path — E2-only partial rerun stubbing E1, wholesale provenance re-stamp, mixed-flake E4 fabrication, filtered-rerun shape-validation fabrication, string_shape_rejected flip, silent drift drop, unknown-key truncation, unparseable-artifact overwrite re-arm — is closed in source and, where offline-testable, repro-proven closed. The offline builder suite (10/10) now locks the guarantees with fixtures mirroring the committed artifact, including deliberately older stamps so provenance survival is provable.
2. **Doc traceability (closed):** 5/5 quoted session UUIDs trace, stale citations are gone, verdict quotes byte-match, and the copy-drift UUID gate makes the doc's "every verdict traces" claim build-enforced with a positive control proving the gate fires.

The only open item is the carried human acceptance decision on the E1 rendering observation method (truth 15). Three carried warnings need owners outside Phase 8: the prototype-chain pinned-model bypass (Phase 6 pre-existing), the double-DEFAULT_CONFIG latent defect, and the string-only updatedToolOutput emitter; plus one new warning-level residual (mixed-case E1 stamp granularity — round-2 CR-02's secondary suggestion).

---

_Verified: 2026-07-15T01:25:43Z_
_Verifier: Claude (gsd-verifier)_
