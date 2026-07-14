---
phase: 08-contract-verification-reversible-plumbing
reviewed: 2026-07-14T23:35:24Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/config/index.ts
  - src/shared/types.ts
  - tests/config/merge.test.ts
  - tests/config/reader.test.ts
  - tests/uat/findings-builder.ts
  - tests/uat/findings-builder.test.ts
  - tests/uat/contract-verification.test.ts
  - tests/uat/fixtures/e4-object-large-output-hook.sh
  - tests/uat/artifacts/contract-findings.json
  - docs/HOOK-CONTRACT.md
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 8: Code Review Report (GAP-CLOSURE wave — plans 08-07/08-08/08-09)

**Reviewed:** 2026-07-14T23:35:24Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Reviewed the Phase 8 gap-closure changes (commits after `793bbce`): the CR-01
cross-layer partial config merge fix (plan 08-07), the guarded findings writer
with carry-forward (plan 08-08 / prior WR-01), the object-shape E1/E4 harness
legs (plan 08-08 / prior WR-02), and the live E4 rerun + HOOK-CONTRACT refresh
(plan 08-09).

**Prior CR-01 (partial-table config merge) is correctly fixed.** Validators now
return true Partials (conditional spreads, no baked defaults), `mergeConfigs`
fills defaults exactly once from the accumulated value, and the regression
tests (merge Tests D–K, reader Tests A–J) prove both directions with real TOML
files. All 24 config tests and all 6 findings-builder tests pass. `dist/cli.js`
and `dist/mcp.js` contain the new merge logic (not stale).

**Prior WR-01 (rerun clobbers committed evidence) is only partially fixed.**
The new `buildFindingsArtifact` guard and carry-forward cover E1.rendering,
E1_shape_validation, E2–E5 — but NOT the E1 per-tool verdicts. A partial rerun
that records any single verdict passes the zero-verdict guard and replaces the
committed E1 Bash/Read/MCP records (verdicts, signals, evidence paths) with
`not-run` stubs. Proven by execution against the committed artifact (CR-01
below). This is exactly the T-08-08-01 tampering scenario the module's own
header claims to prevent.

Also proven by execution: the fail-closed pinned-model gate accepts
prototype-chain keys (`model = "constructor"` passes validation, WR-02), and
two HOOK-CONTRACT.md evidence citations no longer trace to the regenerated
artifact (WR-03).

## Narrative Findings (AI reviewer)

### Critical Issues

#### CR-01: Partial harness rerun replaces committed E1 per-tool evidence with `not-run` stubs

**File:** `tests/uat/findings-builder.ts:109-127` (guard at `:84-87`)
**Issue:** `buildE1` builds `tools` and the E1 `verdict` string exclusively
from `run.e1Tools`, with no fallback to the previous artifact's
`E1.tools`/`verdict`:

```ts
const tools = Object.fromEntries(
  E1_TOOL_ORDER.map((tool) => [tool, run.e1Tools[tool] ?? { verdict: 'not-run', signals: {}, evidence_paths: [] }]),
)
const verdict = E1_TOOL_ORDER.map((tool) => `${tool}: ${run.e1Tools[tool]?.verdict ?? 'not-run'}`).join('; ')
```

Only `rendering` is carried forward. The zero-verdict guard
(`countRecordedVerdicts`) passes as soon as ANY experiment records a verdict,
so a partial rerun — `vitest -t 'E2'`, or a run where the E1 legs fail at
`assertSessionRan` while later legs succeed — rewrites the artifact with all
three E1 per-tool records stubbed out. Proven by execution against the
committed `tests/uat/artifacts/contract-findings.json`:

```
guard passed (artifact would be overwritten): true
E1 verdict AFTER rerun: Bash: not-run; Read: not-run; MCP: not-run
E1 Bash tool record AFTER rerun: {"verdict":"not-run","signals":{},"evidence_paths":[]}
prev E1 verdict WAS: Bash: ignored (...); Read: ignored (...); MCP: honored
```

This destroys the exact evidence cited by THREAT_MODEL.md, HOOK-CONTRACT.md
§E1, and the `src/shared/types.ts` JSDoc, and directly violates the module's
stated guarantee (lines 15-17: "stubs appear only when NEITHER side has the
record"). The unit tests never catch it because `previousArtifact()` in
`findings-builder.test.ts:83` uses `tools: {}`.
**Fix:** Carry forward per-tool records and derive the verdict from the merged
map:

```ts
function buildE1(run: RunRecords, prevExperiments: Record<string, unknown>): Record<string, unknown> {
  const prevE1 = recordAt(prevExperiments, 'E1')
  const prevTools = recordAt(prevE1 ?? {}, 'tools') ?? {}
  const toolRecord = (tool: string): Record<string, unknown> => {
    const fresh = run.e1Tools[tool]
    if (fresh !== undefined) return { ...fresh }
    const prev = recordAt(prevTools, tool)
    if (prev !== undefined) return { ...prev }
    return { verdict: 'not-run', signals: {}, evidence_paths: [] }
  }
  const tools = Object.fromEntries(E1_TOOL_ORDER.map((tool) => [tool, toolRecord(tool)]))
  const verdict = E1_TOOL_ORDER.map((tool) => `${tool}: ${String((tools[tool] as Record<string, unknown>)['verdict'])}`).join('; ')
  // ... rendering carry-forward unchanged
}
```

Add a unit test whose `previousArtifact()` carries populated `E1.tools` and
assert they survive a run with a disjoint `e1Tools` set.

### Warnings

#### WR-01: E4 gating fabricates an "unanswerable" verdict when its gate leg simply did not run — overwriting the committed answer

**File:** `tests/uat/contract-verification.test.ts:732-755` (same pattern at `:493-532`)
**Issue:** The E4 test gates on `e1ObjectBash?.verdict === 'honored'`, where
`e1ObjectBash` is module state set by the E1/Bash-object test *in the same
process*. In a filtered rerun (`vitest -t 'E4'`) or a run where the
E1/Bash-object leg fails before recording, `e1ObjectBash` is `undefined` — and
the test still SETS `e4Record` to an "unanswerable" verdict. Because `run.e4`
is then defined, `buildE4`'s carry-forward never engages and the committed
"cap does NOT bind updatedToolOutput (~15K survived intact for Bash)" verdict
is replaced by "unanswerable... (Bash-object verdict: not-run)". The gate
cannot distinguish *ran-and-not-honored* (a genuine drift finding worth
recording) from *not-run-in-this-process* (no new information). The
E1/Read-object test has the same flaw: it assembles a fresh
`shapeValidationRecord` with verdict "shape-validation conclusion NOT
reproduced this run" when `e1ObjectBash` is merely absent, and run-wins
replaces the committed shape-validation verdict.
**Fix:** When the gate information is absent because the leg did not run,
leave the record `undefined` so builder carry-forward preserves the committed
answer:

```ts
if (e1ObjectBash === undefined && Object.keys(e1Tools).length === 0) {
  // E1 legs did not run in this process — record nothing; carry-forward keeps
  // the committed E4/shape-validation evidence intact.
  return
}
```

Only record "unanswerable"/"not reproduced" when the object leg actually ran
and produced a non-honored verdict.

#### WR-02: Pinned-model fail-closed gate bypassed by prototype-chain keys (`in` operator on a plain object)

**File:** `src/config/index.ts:250-255` (downstream twin: `src/model/pipeline-singleton.ts:119-124`)
**Issue:** The T-06-04-03 gate uses `(raw['model'] as string) in MODEL_DESCRIPTORS`.
`MODEL_DESCRIPTORS` is a frozen plain object literal, so inherited keys pass:
`"constructor"`, `"toString"`, `"valueOf"`, `"hasOwnProperty"`, `"__proto__"`,
etc. all satisfy the check. Proven by execution:

```
[pii.ner] model = "constructor"  →  ACCEPTED unpinned model: {"model":"constructor"}
```

The defense-in-depth check at the inference load path is bypassed the same
way: `MODEL_DESCRIPTORS['constructor']` returns `Object` (truthy), so
`if (!descriptor)` does not trip either. The load then dies incidentally with
a `TypeError` inside `isModelCached` (no `cachePath` function) instead of the
designed structured fail-closed error. No unpinned bytes reach
transformers.js today, but both *intentional* integrity gates are inert for
these inputs and the failure mode is an unstructured crash. (Pre-existing
from Phase 6; surfaced here because `src/config/index.ts` is in scope.)
**Fix:** Use own-property checks at both sites:

```ts
if ('model' in raw && !Object.hasOwn(MODEL_DESCRIPTORS, raw['model'] as string)) { ... }
// pipeline-singleton.ts:
const descriptor = Object.hasOwn(MODEL_DESCRIPTORS, ner.model) ? MODEL_DESCRIPTORS[ner.model] : undefined
```

#### WR-03: HOOK-CONTRACT.md evidence citations do not trace to the regenerated findings artifact

**File:** `docs/HOOK-CONTRACT.md:117-119` and `docs/HOOK-CONTRACT.md:35`
**Issue:** The doc's premise (line 5-7) is that "Every verdict below traces to
a recorded entry in the findings artifact." Two citations now fail that test
after the 08-09 regeneration:

1. The E3 evidence excerpt cites `sid_run1 = 8f87d5ac-b7b7-43bc-95e0-192352a6e416`
   and fork id `e08e5d75-0cdf-4226-bd02-a4f0027a8bff`. Neither UUID appears
   anywhere in the committed artifact (`grep -c` = 0); the regenerated E3
   record carries `184c5b4a-7a93-4bec-a81e-40d5b3bbe717` /
   `e1036ad1-9ea3-40f1-bf93-e1b461223979`. The doc quotes evidence from a
   destroyed prior run.
2. The per-tool matrix Read row cites "probe session
   `df4534f2-190a-4060-8d50-0dbf94cfba94`" — but per the artifact,
   `df4534f2...` is the **Bash** object probe
   (`E1_shape_validation.signals.object_probe_session_id`); the Read probe
   transcript is `8ba19558-500c-4deb-b068-d4903006bb34` (second entry in
   `E1_shape_validation.evidence_paths`).

**Fix:** Update the E3 excerpt to the artifact's current sids and cite
`8ba19558-500c-4deb-b068-d4903006bb34` for the Read row. Consider a
copy-drift test (the repo already has `tests/copy-drift.test.ts` precedent)
asserting that every session UUID quoted in HOOK-CONTRACT.md appears in
`contract-findings.json`.

#### WR-04: `mergeConfigs` applies DEFAULT_CONFIG twice — latent allowlist double-concat and frozen-object aliasing

**File:** `src/config/index.ts:510-554`
**Issue:** The accumulators are seeded from `DEFAULT_CONFIG` (lines 511-539)
AND the canonical call passes `DEFAULT_CONFIG` again as layer 1
(`loadEffectiveConfig`, line 636). For last-wins fields this double
application is idempotent, but for the concat field it is not: the seed copies
`DEFAULT_CONFIG.allowlist`, then layer 1 concatenates
`DEFAULT_CONFIG.allowlist` onto it (line 552-553). Today every default axis is
empty, so the bug is invisible — the day a bundled default allowlist entry is
added, every merged config silently duplicates it. Relatedly, the loop
re-aliases frozen defaults and caller-owned arrays for wholesale-replace
fields (`entropy = layer.entropy`, `secretsFiles = layer.secrets_files`,
`rules = layer.rules`, lines 543-545): with DEFAULT_CONFIG as layer 1 the
returned config's `entropy`/`secrets_files`/`rules` are the `Object.freeze`d
default objects — defeating the seed's deliberate `Array.from` defensive
copies and contradicting the file's own "never alias the frozen default"
convention (line 538). Any future consumer that mutates these fields gets a
strict-mode `TypeError`.
**Fix:** Either stop seeding from `DEFAULT_CONFIG` (require it as layer 1, as
documented) or skip concat/copy work when `layer === DEFAULT_CONFIG`; and copy
on assignment: `entropy = { ...layer.entropy }`,
`secretsFiles = Array.from(layer.secrets_files)`,
`rules = layer.rules.map((r) => ({ ...r }))`.

### Info

#### IN-01: `scanHookErrorExcerpt` writes ~400 chars of unrelated transcript JSON into the "verbatim" evidence field; doc quote is not byte-verbatim

**File:** `tests/uat/contract-verification.test.ts:284-295`; `docs/HOOK-CONTRACT.md:40-45`
**Issue:** The regex match starts at `updatedToolOutput` and the excerpt takes
a flat 600 chars from `match.index`, so the committed
`verbatim_hook_error`/`read_object_hook_error` fields (artifact lines 90, 98)
trail off into unrelated transcript metadata (`toolUseID`, `uuid`,
`timestamp`, sandbox `cwd`). Additionally the doc's "verbatim" quote prepends
"PostToolUse hook returned " — text the artifact field cannot contain because
the regex starts after it.
**Fix:** Anchor the slice to the sentence (e.g. extend the regex through the
closing `]` of the zod error array and slice `match[0]`), and either widen the
regex to capture the "PostToolUse hook returned" prefix or trim the doc quote
to match the field.

#### IN-02: E4 object fixture has no error handling around the `node -e` payload emitter

**File:** `tests/uat/fixtures/e4-object-large-output-hook.sh:22-34`
**Issue:** If the `node -e` invocation fails, the script still `exit 0`s with
empty stdout — the hook silently no-ops, and the E4 leg records
"indeterminate" (a defined `run.e4`), which overwrites the committed "cap does
NOT bind" verdict via run-wins. The harness-integrity check only proves the
script *started* (HOOK_LOG line is written before `node` runs).
**Fix:** Append the HOOK_LOG marker only after `node` succeeds, or
`node -e '...' || echo "e4-object-fixture: node payload emitter FAILED" >&2`.

#### IN-03: `PostToolUseOutput.updatedToolOutput` remains string-only — shipped PostToolUse redaction is inert for built-in tools

**File:** `src/shared/types.ts:154-165`
**Issue:** The E1 finding this phase settled is that built-in Bash honors only
the OBJECT shape `{stdout, stderr, interrupted, isImage}` — yet the locked
type (and `post-tool-use.ts` Step 7) still emits the string form, so mrclean's
PostToolUse rewrite protects MCP tool outputs only. The JSDoc documents this
honestly, and changing the emitter is out of this wave's scope — but for a DLP
tool "built-in Bash output is not redacted on the return path" is a live
protection gap, not just a doc note.
**Fix:** Ensure a tracked Phase 9/10 item exists to emit the per-tool object
shape for Bash (and to keep the E1/Read-object "shape unknown upstream"
limitation on record); the type would then become
`updatedToolOutput?: string | Record<string, unknown>`.

---

_Reviewed: 2026-07-14T23:35:24Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
