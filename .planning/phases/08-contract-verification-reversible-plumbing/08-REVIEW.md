---
phase: 08-contract-verification-reversible-plumbing
reviewed: 2026-07-15T01:05:02Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - tests/uat/findings-builder.ts
  - tests/uat/findings-builder.test.ts
  - tests/uat/contract-verification.test.ts
  - tests/copy-drift.test.ts
  - docs/HOOK-CONTRACT.md
findings:
  critical: 2
  warning: 4
  info: 3
  total: 9
status: issues_found
---

# Phase 8: Code Review Report (Round 2 — gap-closure review of plans 08-10 + 08-11)

**Reviewed:** 2026-07-15T01:05:02Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Scope: commits after `61f81de` (08-10 buildE1 per-tool carry-forward; 08-11 record-nothing gates, HOOK-CONTRACT citation refresh, session-UUID traceability gate). Verification performed: both offline suites executed (24/24 pass); all 5 session UUIDs quoted in `docs/HOOK-CONTRACT.md` mechanically confirmed present in `tests/uat/artifacts/contract-findings.json` independently of the test; every gate path traced against the committed artifact.

**Prior-finding closure status:**

- **Prior CR-01 (buildE1 destroys committed E1 per-tool evidence): core destruction path closed.** The fresh→previous→stub per-tool merge is correct, the verdict string derives from the merged map, and the new disjoint-rerun tests prove byte-identical survival of `tools` + `verdict`. However, the fix introduced a new evidence-provenance defect: buildE1 re-stamps wholly carried-forward evidence with the fresh run's `claude_version`/`date` (new CR-02 below).
- **Prior WR-03 (doc citations orphaned): closed.** Citations refreshed correctly (Read row now cites `8ba19558…`, E3 sids updated), and the new traceability gate is non-vacuous (≥1 guard + positive control) and passing honestly (5/5 traced).
- **Prior WR-01 (fabricate-on-not-run): partially closed.** The implemented E4 gate copies the prior review's suggested snippet verbatim but not its stated requirement ("only record 'unanswerable' when the object leg actually ran"): the conjunct condition leaves a mixed-failure path open that fabricates an "unanswerable" E4 record and destroys the committed E4 answer (new CR-01 below). The shape-validation gate closes the all-legs-absent path but a `-t 'object'` filtered rerun can still overwrite the committed `string_shape_rejected: true` signal with an unmeasured `false` (new WR-01 below).

Prior WR-02 (prototype-chain) and prior WR-04 (double-DEFAULT_CONFIG) are known/out-of-scope and were not made worse by this diff.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: E4 record-nothing gate is too narrow — a mixed partial run fabricates "unanswerable" and destroys the committed E4 verdict

**File:** `tests/uat/contract-verification.test.ts:764-766`
**Issue:** The gate is:

```ts
if (e1ObjectBash === undefined && Object.keys(e1Tools).length === 0) {
  return
}
```

The conjunct defeats the protection whenever ANY string leg recorded. Concrete scenario (a flake mode this file itself documents at lines 578–584 — ToolSearch loops, subagent spawn timeouts): full `MRCLEAN_UAT=1` run where `E1/Bash` (string) succeeds and records `e1Tools['Bash'] = 'ignored…'`, but `E1/Bash-object` fails at `assertSessionRan` before line 449 assigns `e1ObjectBash`. In the E4 test: `objectLeg = false`; `stringHonored = undefined` (Bash/Read verdicts are 'ignored'); the gate condition is false because `e1Tools` is non-empty — so the fall-through **records** `e4Record` = "unanswerable … (Bash-object verdict: not-run …)". `buildE4` is run-wins (`run.e4 !== undefined ? { ...run.e4 } : …`), so the committed verdict `"cap does NOT bind updatedToolOutput (~15K survived intact for Bash)"` is replaced by a verdict derived from a leg that produced no measurement in this process. This is fabrication + destruction of committed evidence (T-08-08-01, Critical class), and the new UUID traceability gate cannot catch it — the doc's E4 section quotes no session UUID. The comment above the gate claims to protect exactly this case ("an upgrade run where the E1 legs fail at assertSessionRan") but the code only protects it when *all* E1 legs failed; the prior review's prose requirement — record only when the object leg *actually ran* — is not met.
**Fix:** Gate on the object leg alone — `e1Tools` being non-empty says nothing about whether the *gate* leg ran:

```ts
// Gate leg produced no verdict in THIS process → no new gate information.
// (e1Tools being non-empty does not mean the Bash-object leg ran.)
if (e1ObjectBash === undefined) {
  return
}
```

The genuine-drift case (object leg ran and was not honored → `e1ObjectBash` defined with a non-'honored' verdict) still falls through and records, as intended. The honored-string-leg upgrade case is unaffected (it takes the `stringHonored` branch before this gate).

### CR-02: buildE1 stamps carried-forward per-tool evidence with the fresh run's `claude_version`/`date` — provenance fabrication on every partial rerun

**File:** `tests/uat/findings-builder.ts:130-139` (stamps at 134–135)
**Issue:** `buildE1` unconditionally returns `claude_version: run.claudeVersion, date: run.date` — even when **all three** tool records were carried forward from the previous artifact (a rerun recording only E2, or a `vitest -t 'object'` filtered rerun that passes the guard via `shapeValidation`). `ToolVerdict` carries no per-tool stamps (`verdict`/`signals`/`evidence_paths` only), so `E1.claude_version`/`E1.date` are the *only* provenance for the per-tool evidence — and they get rewritten. A rerun on Claude Code 2.2.x that records only E2 produces an artifact claiming the E1 Bash/Read/MCP verdicts were verified on 2.2.x when no E1 leg ran there. The artifact's entire purpose is per-version contract evidence ("per-tool, per-version behavior is what this file records" — HOOK-CONTRACT.md:14), and the re-verification procedure tells the operator to refresh doc stamps from it (HOOK-CONTRACT.md:217-220). Note the asymmetry the diff itself created: `buildE5` re-emits `prevE5` verbatim when the run contributed nothing ("version stamps intact", findings-builder.ts:183), and `resolveExperiment`/`buildE4` carry previous records with their embedded stamps — `buildE1` alone rebuilds with fresh stamps (and also rewrites `question`/`method` to the current literals, silently retitling committed evidence). The unit test "carries forward committed E1 per-tool verdicts when a partial rerun records only E2" (findings-builder.test.ts:240-252) asserts `tools` and `verdict` survival but never asserts the stamps, so the gap is untested.
**Fix:** Mirror `buildE5`'s verbatim re-emit, and stamp fresh per-tool records for the mixed case:

```ts
function buildE1(run: RunRecords, prevExperiments: Record<string, unknown>): Record<string, unknown> {
  const prevE1 = recordAt(prevExperiments, 'E1')
  // Run contributed no E1 tool verdicts → re-emit previous E1 verbatim
  // (version stamps intact — mirrors buildE5).
  if (Object.keys(run.e1Tools).length === 0 && prevE1 !== undefined) return { ...prevE1 }
  // ... existing merge path ...
}
```

For the mixed case (fresh Bash + carried Read/MCP under one stamp), add `claude_version`/`date` to `ToolVerdict` (stamped in the harness's `buildE1Verdict`) so merged records keep per-tool provenance. Extend the disjoint-rerun unit test to assert `e1['claude_version']`/`e1['date']` equal the committed stamps (RED first, per TDD).

## Warnings

### WR-01: `string_shape_rejected: false` can be fabricated from an unscanned transcript and overwrite the committed `true` signal

**File:** `tests/uat/contract-verification.test.ts:510, 538` (scan regex at 295)
**Issue:** `const stringRejected = stringShapeHookError !== undefined` conflates "rejection error not found" with "string form not rejected". Two paths write `string_shape_rejected: false` into the fresh record without any string-leg measurement:

1. **Filtered `vitest -t 'object'` rerun** — matches `E1/Bash-object`, `E1/Read-object`, and the `(object-gated…)` E4 test, but NOT `E1/Bash`. `e1BashTranscriptPath` stays null → `stringShapeHookError` undefined → `stringRejected = false`. Both object legs ran, so the Read-object gate (`e1ObjectBash === undefined`) does NOT fire; `shapeValidationRecord` is assembled and run-wins in `buildShapeValidation` — the committed `signals.string_shape_rejected: true` (which backs the doc's "STRING payloads are REJECTED" claim) is flipped to `false` by a run that never exercised the string leg. This is the exact vector the gate's own comment names ("string_shape_rejected from an unstashed transcript") but only guards in the `e1ObjectBash === undefined` branch.
2. **Full run with error-wording drift** — `scanHookErrorExcerpt`'s regex (`does not match|invalid_type`) is coupled to 2.1.209's zod message; a wording change makes the scan miss even though `e1Tools['Bash'].verdict` still says 'ignored' (i.e. it WAS rejected), yielding a self-contradictory record: `string_shape_rejected: false` alongside a carried-forward `verbatim_hook_error` showing the rejection (the builder's field fallback fills only `verbatim_hook_error`, not the signal).

The verdict prose partially discloses case 2 ("not re-observed this run"), but the machine-readable signal is destroyed either way.
**Fix:** Make the signal honest about observation state and corroborate with the string-leg verdict:

```ts
const stringLegObserved = e1BashTranscriptPath !== null
signals: {
  ...
  string_shape_rejected: stringLegObserved ? stringRejected : 'not-observed-this-run',
  string_leg_verdict: e1Tools['Bash']?.verdict ?? 'not-run',
}
```

or extend `buildShapeValidation`'s field-level fallback to preserve the committed `signals.string_shape_rejected` when the fresh run did not observe the string leg.

### WR-02: E1/Read-object record-nothing gate silently discards a genuinely observed drift verdict — no operator signal

**File:** `tests/uat/contract-verification.test.ts:504-506`
**Issue:** In a filtered `vitest -t 'Read-object'` rerun on a future Claude Code version where the Bash-style object is newly HONORED for Read (a contract change directly relevant to mrclean's PostToolUse redaction scope), the leg runs, computes `readObjectVerdict = 'honored (Bash-style object accepted for Read)'`, then hits `if (e1ObjectBash === undefined) return` — the drift observation is dropped with zero output, the test passes green, and the committed artifact continues to assert rejection. Dropping the *host record* is the correct trade-off (fabricating it would be worse), but dropping the observation *silently* violates the harness's own contract ("reports drift instead of breaking CI") and the never-silently-swallow rule.
**Fix:** One line before the return:

```ts
console.warn(
  `mrclean findings: Read-object observation DROPPED (Bash-object gate leg absent this process): ${readObjectVerdict} — rerun the full E1 suite to record it`,
)
```

### WR-03: `E1_TOOL_ORDER` silently drops fresh and previous per-tool records outside {Bash, Read, MCP}

**File:** `tests/uat/findings-builder.ts:59, 122`
**Issue:** `toolEntries` maps only over the fixed `E1_TOOL_ORDER`. Two silent-loss paths: (1) a future harness leg recording `e1Tools['Edit']` without a matching builder update — the fresh verdict is counted by `countRecordedVerdicts` (so the guard passes and the artifact is rewritten with refreshed top-level stamps) yet the verdict itself never appears in the output; (2) a previous artifact carrying a tool key outside the list — dropped on rerun, contradicting the module's "re-emitted verbatim" guarantee (header lines 16-19). No error, no stub, no warning in either direction. In an evidence-preservation module whose sole job is not losing records, key-set truncation should be impossible by construction.
**Fix:** Iterate the union, known tools first for stable ordering:

```ts
const toolNames = [...new Set([...E1_TOOL_ORDER, ...Object.keys(run.e1Tools), ...Object.keys(prevTools)])]
const toolEntries = toolNames.map((tool) => [tool, toolRecord(tool)] as const)
```

Add a unit test with a previous artifact carrying an extra tool key.

### WR-04: malformed committed artifact is treated as absent — one parse error re-arms wholesale overwrite

**File:** `tests/uat/contract-verification.test.ts:363-367`
**Issue:** `catch { previous = undefined }` means any JSON parse failure of the committed artifact (merge-conflict markers, truncated write, stray trailing bytes) disables the entire carry-forward substrate this round hardened: the next run with ≥1 verdict rewrites the file, stubbing every experiment it did not run — committed evidence replaced wholesale. Git makes this recoverable and diff-visible, hence Warning rather than Critical, but the guard philosophy ("a crashed run cannot clobber committed evidence" — HOOK-CONTRACT.md:222-224) has a hole: the one state that most needs operator attention (a corrupted evidence file) is the one state where the writer silently replaces instead of refusing. The `existsSync` check already distinguishes first-run-absent from present-but-unparseable, so failing loudly costs nothing. (Introduced in 08-08; flagged now because the new carry-forward guarantees are only as strong as this parse path.)
**Fix:**

```ts
} catch (error) {
  console.error(
    `mrclean findings: committed artifact at ${FINDINGS_PATH} is unparseable — refusing to overwrite; fix or delete it first (${String(error)})`,
  )
  return
}
```

## Info

### IN-01: session-UUID regex is lowercase-only — an uppercase-pasted citation is invisible to the traceability gate

**File:** `tests/copy-drift.test.ts:181`
**Issue:** `SESSION_UUID_RX` matches `[0-9a-f]` without the `i` flag. Claude session ids are lowercase today, but a future doc edit pasting an uppercase UUID would be neither extracted nor membership-checked, while the `>= 1` non-vacuous guard still passes via the remaining lowercase citations — a partially vacuous gate for exactly the drift it exists to catch.
**Fix:** Add the `i` flag and lowercase both sides before the `artifact.includes(uuid)` check.

### IN-02: a Bash-object-only rerun records a real observation the guard cannot see, then reports "no experiment recorded a verdict"

**File:** `tests/uat/findings-builder.ts:86-89`; `tests/uat/contract-verification.test.ts:449`
**Issue:** `e1ObjectBash` is not part of `RunRecords`, so `countRecordedVerdicts` never counts it. A `vitest -t 'E1/Bash-object'` rerun that observes drift (e.g. the object shape newly REJECTED — which would make mrclean's planned object-shape rewrite inert) records nothing, and the writer's warn ("no experiment recorded a verdict — artifact left untouched") is factually wrong: an experiment did produce a verdict; it just has no home in `RunRecords`. Conservative (nothing destroyed), but a drift-suppression path with a misleading operator message.
**Fix:** Warn explicitly when `e1ObjectBash` is defined but unpersisted, or add it to `RunRecords` and fold it into the E1 signals so the observation survives.

### IN-03: HOOK-CONTRACT Bash object-payload cell cites the PTY probe session where the harness probe is the canonical evidence

**File:** `docs/HOOK-CONTRACT.md:34`
**Issue:** The per-tool matrix's Bash object cell cites probe session `e244a7f9-…` together with the fixture attribution `tests/uat/fixtures/e1-object-rewrite-hook.sh` — but `e244a7f9` is the operator PTY *rendering* probe (artifact `E1.rendering.evidence.object_shape_session_id`); the session that established `object_probe_honored: true` with that fixture is `df4534f2-190a-4060-8d50-0dbf94cfba94` (artifact `E1_shape_validation.signals.object_probe_session_id`). Both trace, so the gate passes, but the citation attributes the harness fixture to the wrong session. (The 08-11 refresh fixed the Read row correctly; the Bash row kept the pre-refresh citation.)
**Fix:** Cite `df4534f2-…` for the fixture-backed object probe, optionally alongside `e244a7f9-…` for the rendering half.

---

_Reviewed: 2026-07-15T01:05:02Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
