---
task: verified-defect-fixes
date: 2026-09-10
branch: fix/verified-defects-2026-09
status: complete
items: 4
commits:
  - e6ac318b4683116a7d7991695a84193cccc36908
  - bf15d301ea9e28d12de54fe28c87ec214ae5c569
  - 7a1bd81ce14378f2de945b7517259a00824a88a4
  - 2ecfdc034b068c9879be9efbe145cbcb5121e3a5
files_changed:
  - package.json
  - README.md
  - src/audit/canary-leak.ts
  - src/detect/layer2-entropy.ts
  - src/detect/index.ts
  - tests/audit/canary-leak.test.ts
  - tests/detect/layer2-entropy.test.ts
tests_added: 7
build_run: false
deps_changed: false
---

# Verified Defect Fixes — 2026-09-10

Four verified defects, one atomic commit each. No architecture change, no dependency
change, no `dist/` rebuild.

---

## Item 1 — false claim in `package.json`

**Commit:** `e6ac318` — `fix: correct overclaiming package description and drop dlp keyword`

**What changed**

| File | Line | Change |
| --- | --- | --- |
| `package.json` | 4 | "prevents secrets and proprietary terms from reaching" -> "reduces the secrets and proprietary terms that reach" |
| `package.json` | 15-24 | removed `"dlp"` from `keywords` (9 keywords remain) |

**Why it was false:** the POSIX hook wrapper in `src/install/settings.ts` is
`'"$1" "$2" hook || exit 2'`, which remaps only NON-ZERO exits. Replacing the
user-writable `dist/cli.js` with a program that exits 0 silently disables every hook.
Model-authored egress is also uninterceptable — no hook sees model output before the
API call. `"dlp"` is a procurement-weight category token; there is no policy engine,
no central management, and no enforcement in this tool.

**Tests:** none (metadata-only change). Verified by re-parsing `package.json`.

---

## Item 2 — false claim in `README.md`

**Commit:** `bf15d30` — `docs: qualify no-network claim for the opt-in NER model download`

**What changed:** `README.md` section 12 (License), lines 293-297.

Before: "...by design and by architecture (no network calls other than the Anthropic
API that Claude Code itself makes)."

After: "...by design and by architecture. A default install makes no network calls
other than the Anthropic API that Claude Code itself makes. The one exception is the
opt-in NER tier, which downloads its model from `huggingface.co` on first use."

**Why it was false:** `src/model/constants.ts:24` (`MODEL_DOWNLOAD_URL`) and `:75`
(`PIIRANHA_DOWNLOAD_URL`) both fetch ONNX weights from `https://huggingface.co/...`.

**Exhaustiveness check:** grep for outbound hosts across `src/**/*.ts` returns only
`huggingface.co` plus one `github.com` docs URL inside a generated config comment
(`src/install/project-dir.ts:17`, not a fetch). So `huggingface.co` is the only
exception and the qualified sentence is complete as well as true.

**Tests:** none (prose change).

---

## Item 3 — vacuous CI guard in the audit canary

**Commit:** `7a1bd81` — `fix: make audit canary scan case-insensitive (guard was vacuous)`

**What changed**

| File | Lines | Change |
| --- | --- | --- |
| `src/audit/canary-leak.ts` | 13-28 | design note records the case-insensitivity contract and why the old one was vacuous |
| `src/audit/canary-leak.ts` | 53-54 | JSDoc: canaries are matched case-insensitively |
| `src/audit/canary-leak.ts` | 74-77 | canaries folded ONCE up front (`{ canary, folded }`), not once per line |
| `src/audit/canary-leak.ts` | 92-101 | compare `recordStr.toLowerCase()` against the folded canary |
| `tests/audit/canary-leak.test.ts` | 117-147 | new regression test |

**Why it was vacuous:** `recordStr.includes(canary)` was case-sensitive. Layer 4
lowercases word rule IDs (`src/detect/layer4-words.ts:199`, `word:${entry.word.toLowerCase()}`)
and `src/audit/log.ts:172` writes the ruleId verbatim, so an uppercase fixture canary
could never match a lowercased ruleId. The assertion was permanently green under a
header claiming "CI canary test enforces this".

**Preserved behaviour:**
- `leaked[*].canary` reports the ORIGINAL canary as passed in, not a folded copy.
- `leaked[*].record` reports the ORIGINAL record casing.
- The `'<malformed>'` defence-in-depth path (line 88) is untouched.
- `toLowerCase` (not `toLocaleLowerCase`) — locale-invariant, so CI results are
  identical on every machine.

**Test added:** `detects a leaked term when the record is lowercased and the canary is uppercase`

**RED (before the fix) — verbatim:**

```
 ❯ |unit| tests/audit/canary-leak.test.ts (6 tests | 1 failed) 10ms
     × detects a leaked term when the record is lowercased and the canary is uppercase 3ms

 FAIL  |unit| tests/audit/canary-leak.test.ts > assertNoCanaryLeak > detects a leaked term when the record is lowercased and the canary is uppercase
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ tests/audit/canary-leak.test.ts:140:23

 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

**GREEN (after the fix) — verbatim:**

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

**Downstream consumers re-run.** `assertNoCanaryLeak` is also used by
`restore-canary-leak.test.ts`, `restore-log.test.ts`, and `fixtures-corpus.test.ts`.
Case-folding can only ever ADD matches, so the `ok === true` consumers were the
regression risk. `npx vitest run --project=unit tests/audit/` -> `44 passed | 1 skipped (45)`.
The single skip is pre-existing and platform-gated ("win32 modes are advisory-only /
root bypasses permission bits").

---

## Item 4 — unbounded entropy token

**Commit:** `2ecfdc0` — `fix: bound Layer 2 entropy token length at 4096 (skip-and-record)`

**What changed**

| File | Lines | Change |
| --- | --- | --- |
| `src/detect/layer2-entropy.ts` | 131-153 | new exported `MAX_TOKEN_LENGTH = 4096` with the WHY recorded inline |
| `src/detect/layer2-entropy.ts` | 166-180 | return type is now `{ findings: Finding[]; skippedOversizedTokens: number }` |
| `src/detect/layer2-entropy.ts` | 182-190 | tokenizer comment: why the quantifier stays unbounded |
| `src/detect/layer2-entropy.ts` | 200-206 | skip-and-count guard, first in the loop |
| `src/detect/layer2-entropy.ts` | 208-219 | remaining steps renumbered (2-6) |
| `src/detect/layer2-entropy.ts` | 238-243 | returns the object; sorts a copy rather than mutating in place |
| `src/detect/layer2-entropy.ts` | 4-13 | header algorithm summary gains step 1a |
| `src/detect/index.ts` | 280, 383 | `findings.push(...l2)` -> `findings.push(...l2.findings)` (`runDetection` + `runDetectionReadOnly`) |
| `tests/detect/layer2-entropy.test.ts` | 1-61 | deterministic fixture generator + `MAX_TOKEN_LENGTH` import |
| `tests/detect/layer2-entropy.test.ts` | 92-165 | 8 existing call sites migrated to `.findings` |
| `tests/detect/layer2-entropy.test.ts` | 175-251 | new `MAX_TOKEN_LENGTH bound` suite (6 tests) |

### Tokenizer approach chosen, and why

**Chosen: keep the greedy unbounded `{min_length,}` quantifier and length-check each
match.** Rejected: bounding the quantifier to `{min_length,MAX_TOKEN_LENGTH}`.

A bounded quantifier makes a 670 KB run match as ~164 adjacent 4096-char fragments.
Each fragment independently clears the escalation path (length >= 40 && entropy >= 5.0),
so the result is ~164 bogus findings where there used to be one — strictly worse than
the defect being fixed. The greedy maximal-munch property of the unbounded quantifier
is precisely what makes the whole run arrive as a SINGLE match, which is what lets the
loop identify it and drop it as a single unit. The fix is therefore three lines in the
loop body rather than a regex rewrite, and the "no adjacent fragment findings" test is
the regression guard for exactly this failure mode.

The guard is placed FIRST in the loop (ahead of `overlapsCovered` and `shannonEntropy`):
it is an O(1) length test, and running it first avoids an O(n) entropy pass over a
multi-hundred-KB string that is about to be discarded. The side effect is that an
over-length run which also happens to be covered by a Layer 1 span counts toward
`skippedOversizedTokens`; a Layer 1 rule matching a 256 KB+ span is not a real case,
and the ordering buys the perf guarantee.

### Over-length behaviour: skip and record

An over-length run is never substituted and never becomes a `Finding`.
`runLayer2Entropy` now returns `{ findings, skippedOversizedTokens }` — the same shape
`runLayer1` already uses for `{ findings, timeoutCount }`, so this follows the
established layer convention rather than inventing one. NO new audit sink was created.
The count is returned but not yet threaded into `DetectionResult` or the audit log;
doing that would change a widely-consumed type and was out of scope for this fix. A
caller that wants to surface the coverage gap can read it today.

### Why 4096 (recorded in the constant's doc comment)

- Largest legitimate entropy finding observed: 146 chars
- Largest finding of ANY rule in the repo ledger: 5,642 chars
- Smallest observed false positive: 256,368 chars (also 323,944 / 396,860 / 499,988 / 669,944)

4096 sits in the empty three-orders-of-magnitude gap between the two populations.

### Defect reproduced on pre-fix code (verbatim)

```
charset size     : 62
input chars      : 307200
input entropy    : 5.954
findings         : 1
finding[0] length: 307200
finding[0] span  : {"start":0,"end":307200}
```

Same script after the fix:

```
charset size     : 62
input chars      : 307200
input entropy    : 5.954
findings         : 0
finding[0] length: n/a
finding[0] span  : n/a
```

### Tests added

1. `exposes MAX_TOKEN_LENGTH as 4096`
2. `still scans a token exactly at MAX_TOKEN_LENGTH`
3. `skips a token one char over MAX_TOKEN_LENGTH and emits no fragment findings`
4. `reports zero findings for a 300 KB high-entropy run instead of one whole-blob finding`
5. `skips only the over-length run — a neighbouring in-range token is still reported`
6. `counts each over-length run separately`

**RED (before the fix) — verbatim tail:**

```
 FAIL  |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy — MAX_TOKEN_LENGTH bound > reports zero findings for a 300 KB high-entropy run instead of one whole-blob finding
AssertionError: Target cannot be null or undefined.
 ❯ tests/detect/layer2-entropy.test.ts:220:29

 FAIL  |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy — MAX_TOKEN_LENGTH bound > skips only the over-length run — a neighbouring in-range token is still reported
AssertionError: Target cannot be null or undefined.
 ❯ tests/detect/layer2-entropy.test.ts:235:29

 FAIL  |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy — MAX_TOKEN_LENGTH bound > counts each over-length run separately
AssertionError: Target cannot be null or undefined.
 ❯ tests/detect/layer2-entropy.test.ts:248:29

 Test Files  1 failed (1)
      Tests  6 failed | 12 passed (18)
```

All 6 new tests failed; the 12 pre-existing tests stayed green during RED.

**GREEN (after the fix) — verbatim:**

```
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

### Fixture note (worth keeping)

The first attempt at these fixtures used a 62-char alphabet STRING LITERAL. That
literal is itself a high-entropy token (length >= 40, entropy ~5.95), so mrclean's own
hook — active in the authoring session — detected it and wrote
`const CHARSET = '<MRCLEAN:ENTROPY:001>'` to disk. Every fixture built from it collapsed
to 16 distinct chars / 3.9 bits per char, silently under the escalation floor, and the
test would have passed vacuously. The charset is now assembled from code points
(`buildTokenCharset()`, lines 30-36) and the reason is documented in the source so it is
not "simplified" back into a literal.

---

## Verification

### Targeted run, both touched test files (verbatim)

```
 RUN  v4.1.6 /Users/me/Documents/code/mrclean

 ✓ |unit| tests/audit/canary-leak.test.ts > assertNoCanaryLeak > returns ok:true when log file does not exist (ENOENT) 2ms
 ✓ |unit| tests/audit/canary-leak.test.ts > assertNoCanaryLeak > returns ok:true when log exists but contains no canary strings 3ms
 ✓ |unit| tests/audit/canary-leak.test.ts > assertNoCanaryLeak > returns ok:false with leak details when the AWS fixture string is present 1ms
 ✓ |unit| tests/audit/canary-leak.test.ts > assertNoCanaryLeak > returns ok:false with <malformed> entry when a line cannot be parsed as JSON 1ms
 ✓ |unit| tests/audit/canary-leak.test.ts > assertNoCanaryLeak > detects only actual leaks when multiple canaries are checked against mixed records 1ms
 ✓ |unit| tests/audit/canary-leak.test.ts > assertNoCanaryLeak > detects a leaked term when the record is lowercased and the canary is uppercase 1ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > shannonEntropy > returns 0 for a string of all identical chars 1ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > shannonEntropy > returns 2 for "abcd" (4 equally likely chars, log2(4) = 2) 0ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > shannonEntropy > returns approximately 4.0 for 64-char hex string (hex charset entropy) 0ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > shannonEntropy > returns higher entropy for a high-entropy random-looking string 0ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy > returns 0 findings for high-entropy token WITHOUT a keyword and length < 40 1ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy > returns 1 finding for high-entropy token WITH a co-located keyword 0ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy > returns 1 finding for 40+ char token with entropy >= 5.0 even without keyword (escalation) 0ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy > returns 0 findings for UUID v4 even with a keyword and high context entropy 0ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy > returns 0 findings for spans already covered by coveredSpans 0ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy > returns 0 findings when threshold is raised to impossibly high value 0ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy > returns findings sorted by span.start ascending 0ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy > findings have correct redactedHash and fingerprint 0ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy — MAX_TOKEN_LENGTH bound > exposes MAX_TOKEN_LENGTH as 4096 0ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy — MAX_TOKEN_LENGTH bound > still scans a token exactly at MAX_TOKEN_LENGTH 1ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy — MAX_TOKEN_LENGTH bound > skips a token one char over MAX_TOKEN_LENGTH and emits no fragment findings 0ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy — MAX_TOKEN_LENGTH bound > reports zero findings for a 300 KB high-entropy run instead of one whole-blob finding 16ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy — MAX_TOKEN_LENGTH bound > skips only the over-length run — a neighbouring in-range token is still reported 5ms
 ✓ |unit| tests/detect/layer2-entropy.test.ts > runLayer2Entropy — MAX_TOKEN_LENGTH bound > counts each over-length run separately 0ms

 Test Files  2 passed (2)
      Tests  24 passed (24)
```

Non-vacuity: 24 reported, 24 expected (6 canary + 18 entropy), and every added test is
named in the output.

### Full unit project (regression sweep)

```
 Test Files  80 passed (80)
      Tests  842 passed | 5 skipped (847)
   Duration  2.26s
```

The 5 skips are pre-existing platform gates.

### Typecheck

`npx tsc --noEmit` reports 76 errors before and 76 after — an identical, pre-existing
baseline. None reference `layer2-entropy.ts`, `canary-leak.ts`, or `detect/index.ts`.
The one match on a touched path is
`tests/detect/orchestrator.test.ts(252,62): Cannot find module '../../src/detect/index.js?budget=1'`,
a pre-existing query-string import trick unrelated to this work. Not fixed — out of scope.

---

## Environment constraints honoured

- No `npm run build` / `tsup`; `dist/` untouched, so the global `mrclean-claude` symlink
  is unaffected.
- No `npm install`; no dependency added, removed, or version-changed.
- The `uat` project was never run. All runs were `--project=unit` with explicit paths.
- `tests/uat/artifacts/contract-findings.json` and the untracked
  `tests/uat/fixtures/echo-shape-probe-hook.mjs` were not touched.
- No commit hook fired; no `--no-verify` used.

## Not done / carried forward

- `skippedOversizedTokens` is returned but not yet surfaced in `DetectionResult`, the
  audit log, or CLI output. Threading it further changes a widely-consumed type and was
  deliberately left out of a defect-fix change set.
- The 76 pre-existing `tsc --noEmit` errors remain.
