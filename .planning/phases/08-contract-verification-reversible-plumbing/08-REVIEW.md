---
phase: 08-contract-verification-reversible-plumbing
reviewed: 2026-07-14T21:44:01Z
depth: standard
files_reviewed: 30
files_reviewed_list:
  - THREAT_MODEL.md
  - docs/HOOK-CONTRACT.md
  - docs/upstream/display-only-channel-request.md
  - src/config/defaults.ts
  - src/config/index.ts
  - src/doctor/checks.ts
  - src/doctor/index.ts
  - src/doctor/version-check.ts
  - src/hook/dispatcher.ts
  - src/hook/handlers/session-end.ts
  - src/install/settings.ts
  - src/shared/types.ts
  - tests/config/merge.test.ts
  - tests/config/reader.test.ts
  - tests/copy-drift.test.ts
  - tests/doctor/checks.test.ts
  - tests/doctor/end-to-end.test.ts
  - tests/doctor/version-check.test.ts
  - tests/hook/dispatcher.test.ts
  - tests/install/idempotency.test.ts
  - tests/install/settings.test.ts
  - tests/uat/artifacts/contract-findings.json
  - tests/uat/contract-verification.test.ts
  - tests/uat/fixtures/e1-object-rewrite-hook.sh
  - tests/uat/fixtures/e1-rewrite-hook.sh
  - tests/uat/fixtures/e2-updated-input-hook.sh
  - tests/uat/fixtures/e4-large-output-hook.sh
  - tests/uat/fixtures/log-hook.sh
  - tests/uat/harness.ts
  - tests/uat/live-session.test.ts
findings:
  critical: 1
  warning: 7
  info: 7
  total: 15
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-07-14T21:44:01Z
**Depth:** standard
**Files Reviewed:** 30
**Status:** issues_found

## Summary

Reviewed the Phase 8 contract-verification surface: the E1–E5 UAT harness and
fixtures, the 5-event installer/doctor widening, the `[reversible]` config
plumbing, and the verified-contract documentation (HOOK-CONTRACT.md,
THREAT_MODEL.md reversible section, upstream request draft).

The three phase-specific security review criteria were checked explicitly:

- **(a) Fixture hygiene:** all five fixture scripts
  (`e1-rewrite-hook.sh`, `e1-object-rewrite-hook.sh`, `e2-updated-input-hook.sh`,
  `e4-large-output-hook.sh`, `log-hook.sh`) contain only marker strings
  (`ORIGINAL_E1_MARKER_q7v4`, `REWRITTEN_E1_MARKER_x9k2`, `INPUT_ORIG_MARKER_e2`,
  `E4_*_MARKER`) — no real secret shapes. **PASS.**
- **(b) Operator settings isolation (write side):** every settings JSON the UAT
  suites produce is written under a `mkdtempSync` sandbox and passed via
  `--settings`; `~/.claude/settings.json` and `~/.claude.json` are never
  written. Transcript access (`findTranscript`) is read-only. **PASS on
  writes** — but read-side isolation is incomplete (WR-03).
- **(c) Docs vs recorded verdicts:** HOOK-CONTRACT.md's E1–E5 verdicts, session
  IDs, verbatim zod error, E3 sid values, E4 control result, and E5
  headless/noise verdicts all match `contract-findings.json` byte-for-byte
  where quoted. **PASS as committed** — but the artifact is partially
  hand-curated and the documented re-run procedure destroys the cited
  evidence (WR-01/WR-02).

One Critical defect was found and **proven by execution**: the three-layer
config merge silently disables operator-enabled protections when a
higher-precedence layer contains a partial `[pii.*]` or `[reversible]` table
(CR-01). The remaining findings are quality/reliability defects in the doctor,
the UAT harness lifecycle, and gate coverage.

## Critical Issues

### CR-01: Partial higher-layer config tables silently wipe operator-enabled protections (proven)

**File:** `src/config/index.ts:316` (also 199–230, 236–297, 356–364, 570–594)
**Issue:** The per-table validators eagerly fill absent fields from
`DEFAULT_CONFIG` instead of leaving them absent, so a file layer is never a
true `Partial`. `mergeConfigs`' documented deep-merge
(`src/config/index.ts:517-518`: "a layer that sets only [pii.regex] does NOT
wipe [pii.ner]") is therefore defeated for every TOML-sourced layer — the
guard `layerPii.ner !== undefined` (line 581) is always true because
`validatePiiConfig` has already substituted defaults.

Reproduced against the current source with `tsx`:

- User `~/.mrclean/config.toml`: `[pii] enabled = true`, `[pii.ner] enabled = true`, `confidence = 0.9`
- Project `./.mrclean/config.toml`: **only** `[pii.regex] entities = ["email"]`
- Result: `pii.enabled = false`, `pii.ner.enabled = false`,
  `pii.ner.confidence = 0.7` — the operator's global PII opt-in (including the
  SSN/credit-card **block** actions) is silently disabled by a project file
  that never mentions `[pii]` or `[pii.ner]`.

The Phase 8 addition repeats the pattern: `validateReversibleConfig`
(line 363, `enabled: raw['enabled'] === true`) bakes the default into the
layer, so a project-layer `[reversible]` table that omits `enabled` (e.g. one
carrying only future Phase-9 keys, which line 354 documents as tolerated)
silently clears a user-layer `enabled = true`. Reproduced: user
`[reversible] enabled = true` + project `[reversible] future_key = 1` →
`reversible.enabled = false`. The reversible half fails in the safe direction
(a risk-increasing feature turns off), but the PII half is a silent protection
loss in a DLP tool — the exact failure class mrclean exists to prevent — and
`doctor` has no check that would surface it.

**Fix:** Make parsed layers true Partials and move default-filling into the
merge. Sketch for the scalar case:

```ts
// validatePiiConfig — do not substitute defaults:
const enabled = 'enabled' in raw ? (raw['enabled'] as boolean) : undefined
// (same for regex/ner sub-tables and their fields: absent → undefined)

// mergeConfigs — fill from the accumulated value, not the bundled default:
pii = {
  enabled: layerPii.enabled ?? pii.enabled,
  regex: layerPii.regex !== undefined ? mergeRegex(pii.regex, layerPii.regex) : pii.regex,
  ner:   layerPii.ner   !== undefined ? mergeNer(pii.ner, layerPii.ner)     : pii.ner,
}
// validateReversibleConfig:
return { enabled: 'enabled' in raw ? raw['enabled'] === true : undefined }
// mergeConfigs:
if (layer.reversible?.enabled !== undefined) reversible = { enabled: layer.reversible.enabled }
```

This requires widening the layer types (e.g. `Partial`-shaped Pii/Reversible
layer interfaces) and adding cross-layer merge tests (user opt-in + project
partial table) — no test today covers the failing scenario
(`tests/config/merge.test.ts` only merges programmatic full objects).

## Warnings

### WR-01: The documented re-verification procedure destroys the evidence the docs cite

**File:** `tests/uat/contract-verification.test.ts:351-409` (writer), `:367`
**Issue:** The `afterAll` findings writer regenerates
`tests/uat/artifacts/contract-findings.json` with an `experiments` object that
has **no `E1_shape_validation` key** and hardcodes
`rendering: 'pending-interactive' as unknown`. The committed artifact,
however, contains a hand-curated `E1_shape_validation` section (verbatim zod
error, probe session IDs, reinterpretation notes) and a full `E1.rendering`
object — content that THREAT_MODEL.md (§Reversible-3), docs/HOOK-CONTRACT.md
(evidence excerpt, per-tool matrix, open follow-ups), and
`src/shared/types.ts` JSDoc all trace to. HOOK-CONTRACT.md's own
re-verification procedure ("`MRCLEAN_UAT=1 npm run test:uat` … regenerates
contract-findings.json") therefore **clobbers the shape-validation evidence
and rendering verdict on the very next run**, breaking the file's opening
claim that "Every verdict below traces to a recorded entry in the findings
artifact." The hand-appended verdict suffixes ("see E1_shape_validation: …")
in E1/E4 are likewise lost. Additionally, `afterAll` runs even when
`beforeAll` throws (e.g. broken build), overwriting the artifact with
`not-recorded` stubs.
**Fix:** Have the harness own the whole artifact: drive the object-shape leg
(see WR-02) and emit `E1_shape_validation` + `rendering` records itself; until
then, refuse to overwrite an existing artifact when key experiments are
missing (or write to a timestamped sibling and require an explicit promote
step), and guard the writer with "only write if at least one experiment
recorded a verdict."

### WR-02: `e1-object-rewrite-hook.sh` is wired to nothing — the load-bearing half of E1 is not reproducible by the harness

**File:** `tests/uat/fixtures/e1-object-rewrite-hook.sh:1-26`
**Issue:** No committed test references this fixture (verified by grep across
`tests/` and `src/`). The object-shape verdict — the discovery the entire
phase pivots on ("object payloads ARE honored for Bash") — was produced by an
ad-hoc probe session (`e244a7f9-…`), so `npm run test:uat` cannot re-verify it
on a Claude Code upgrade. HOOK-CONTRACT.md instructs operators to "re-run the
harness on Claude Code upgrades and refresh the stamps," but the harness only
re-runs the string-form legs.
**Fix:** Add an `E1/Bash-object` test in `contract-verification.test.ts` using
this fixture (same shape as the existing E1/Bash test with `E1_HOOK` swapped
for the object fixture), recording its verdict into an
`E1_shape_validation`-shaped record (ties into WR-01).

### WR-03: UAT harness does not isolate the read side — operator's global hooks run inside every experiment

**File:** `tests/uat/harness.ts:85-114`; `tests/uat/contract-verification.test.ts:30-33`
**Issue:** `claude -p --settings <sandbox.json>` layers the sandbox settings
*on top of* the operator's real `~/.claude/settings.json` (and any managed /
project settings); only MCP is pinned via `--strict-mcp-config`. On this dev
machine a global mrclean install is plausible — in that case the real
fail-closed mrclean hooks fire in every E1–E5 session alongside the fixture
hooks, able to rewrite prompts/outputs and contaminate the recorded contract
verdicts; the E5 stderr noise scan can also pick up noise from foreign hooks
(false SC3 failure) or mask attribution. The isolation comment ("the
operator's ~/.claude/settings.json is never touched") is true for writes only.
**Fix:** Run experiment sessions under a scratch config root (e.g. set
`CLAUDE_CONFIG_DIR` — or `HOME` — to a mkdtemp dir in `runClaude`'s env and
adjust `findTranscript` to scan that root), or add a preflight
harness-integrity assertion that the operator's settings.json contains no hook
entries before running experiments.

### WR-04: `ensureSessionEndRegistered` seam bridge now silently patches over installer regressions

**File:** `tests/doctor/end-to-end.test.ts:51-88` (calls at 100, 169, 200, 306)
**Issue:** The bridge exists so doctor e2e tests pass before the 08-02
installer landed. Both waves are merged: `src/install/settings.ts` registers
SessionEnd and `tests/install/settings.test.ts` asserts the 5-event surface —
the helper's own comment says it is "safe to delete once the installer's
5-event surface is asserted in tests/install/," which is now true. Left in
place it is worse than dead code: if the installer ever *loses* SessionEnd
registration, these e2e tests will silently re-add it and keep passing,
hiding exactly the regression `checks.test.ts` Test 3b exists to catch — but
only at the unit level, not end-to-end.
**Fix:** Delete `ensureSessionEndRegistered` and its four call sites; the e2e
suite should exercise the real installer output unmodified.

### WR-05: `mrclean doctor --verbose` is an advertised no-op; `quiet` option is dead

**File:** `src/doctor/index.ts:48-58, 89-93, 187-203`
**Issue:** `DoctorOpts.verbose` ("Print detailed check output") is accepted
from the CLI (`src/cli.ts:113-117` wires `--verbose` through) but `runDoctor`
never reads it — output is identical with and without the flag. Similarly,
`computeDoctorReport`'s `quiet?: boolean` option is never referenced. Both are
silent contract violations toward the operator and dead surface area.
**Fix:** Either implement verbose rendering in `renderReport` (pass the flag
through) or remove the option from `DoctorOpts` and the CLI definition;
delete the unused `quiet` field.

### WR-06: Copy-drift gate does not cover the Phase 8 user-facing copy surfaces

**File:** `tests/copy-drift.test.ts:36-46`
**Issue:** `SCANNED_SOURCES` scans `src/doctor/report.ts` but not
`src/doctor/version-check.ts` (green/yellow detail strings — new
guarantee-adjacent E1 copy added this phase) nor `src/doctor/checks.ts`
(reversible-state and fail-closed/fail-open detail strings), nor
`docs/HOOK-CONTRACT.md` (operator-facing contract doc). Overclaim language
("guarantees…", "fully compliant…") could drift into doctor output or the
contract doc without failing the D-08 gate, which is the gate's stated
purpose ("permanently fails the build if … CLAIM language enters any
user-facing copy source").
**Fix:** Add `{ rel: 'src/doctor/version-check.ts', isSource: true }`,
`{ rel: 'src/doctor/checks.ts', isSource: true }`, and
`{ rel: 'docs/HOOK-CONTRACT.md', isSource: false }` to `SCANNED_SOURCES`.

### WR-07: Doctor reports green while PostToolUse redaction of built-in tool output is known-inert

**File:** `src/doctor/version-check.ts:113-124` (also `src/shared/types.ts:154-165`, `THREAT_MODEL.md:222-224`)
**Issue:** For any version ≥ 2.1.121 the version check returns `status:
'green'` with the E1 caveat carried only inside the detail sentence. Per the
phase's own findings, mrclean's shipped PostToolUse handler emits the STRING
form, which 2.1.209 rejects for built-in Bash/Read — so the tool-output
redaction lane silently no-ops for built-ins while the operator's primary
signal (green) says "hook contract compatible." The upstream request this
phase filed calls this exact condition "the worst possible failure" for a
sanitizer, and THREAT_MODEL's stated mitigation ("must emit per-tool object
shapes … treat any shape-validation warning as a redaction failure") has no
implementation, no failing check, and no tracked gate in the reviewed changes.
The green status also asserts behavior for the whole ≥ 2.1.121 range from a
single 2.1.209 observation (stamped, but the status color is not qualified).
**Fix:** Until `post-tool-use.ts` emits per-tool object shapes, degrade the
version status to `yellow` for the affected range (or add a dedicated
`post-tool-rewrite` check that WARNs), so the inert-redaction condition is
visible in the status column, not only in prose. Update
`tests/doctor/version-check.test.ts` Test 11h accordingly.

## Info

### IN-01: Orphaned/duplicated section banners strand checkConfigLoad's JSDoc

**File:** `src/doctor/checks.ts:429-495`
**Issue:** The JSDoc block documenting `checkConfigLoad` (lines 431–441) sits
above a `checkModelCache` banner and the `checkModelCache` function; a second
`checkConfigLoad` banner (491–493) precedes the actual function, which ends up
with no attached doc comment.
**Fix:** Move the JSDoc to directly above `checkConfigLoad`; delete the
duplicate banner.

### IN-02: Stale comments contradicting shipped behavior

**File:** `src/doctor/version-check.ts:5-9`; `src/doctor/index.ts:180-186`; `tests/uat/live-session.test.ts:61-75`; `THREAT_MODEL.md:3-4, 272`
**Issue:** (1) version-check header says green is "≥ 2.1.100" — code floor is
2.1.121. (2) `runDoctor` JSDoc says "the normal 6-check doctor report" — there
are now 8 checks. (3) `buildHookSettings` claims "the four hook entries
exactly as install writes them" — the installer now writes five events with
the widened SessionStart matcher. (4) THREAT_MODEL intro/defends-against says
"the four Claude Code hook events" — accurate for the *scanning* surface but
now ambiguous against the registered 5-event surface (SessionEnd no-op).
**Fix:** Refresh the four comment sites (e.g. "four scanning events plus the
SessionEnd lifecycle no-op" in THREAT_MODEL).

### IN-03: Committed artifact leaks operator-machine absolute paths

**File:** `tests/uat/artifacts/contract-findings.json:28, 44-45, 62, 77-79, 103-105, 133, 188, 216, 237`
**Issue:** `evidence_paths` embed `/Users/me/.claude/projects/...` and
`/var/folders/...` — local username and machine directory structure committed
to the repo. Mild, but off-brand for a project enforcing leak-grep discipline.
**Fix:** Relativize to `~` or record only the project-slug + session-id
components when writing evidence paths.

### IN-04: Defaults layer double-applied; merged config can alias frozen default objects

**File:** `src/config/index.ts:524-528, 633`
**Issue:** `mergeConfigs` seeds every field from `DEFAULT_CONFIG` internally,
and the canonical call passes `DEFAULT_CONFIG` again as layer 1 — allowlist
axes would concatenate twice if bundled defaults ever gain entries (currently
all empty, so latent). Separately, when no layer overrides them, the returned
`entropy` object and allowlist axis arrays are the `Object.freeze`d defaults
typed as mutable — a consumer `push()` throws `TypeError` at runtime.
**Fix:** Either stop seeding internally (require the defaults layer) or skip
frozen-default layers for concat axes; return fresh copies of
`entropy`/allowlist when untouched.

### IN-05: Malformed 4-arg wrapper mis-extracts node/bin

**File:** `src/doctor/checks.ts:85-108`
**Issue:** `MIN_WRAPPER_ARGS = 4` accepts `['-c', <script>, 'mrclean-hook',
<node>]` (bin missing) and extracts `nodePath='mrclean-hook'`,
`binPath=<node>`. The shipped installer always writes 5 args, and the failure
direction is safe (bins check FAILs on the bogus path), but the guard is off
by one relative to the real shape.
**Fix:** Require `args.length >= 5` for the wrapper tail, or validate that
`args[args.length - 1] !== args[2]`.

### IN-06: Hook-canary fallback runs `node <node> hook` when hooks are unregistered but an MCP bin exists

**File:** `src/doctor/index.ts:116-124`
**Issue:** If settings.json has no mrclean hook entries but claude.json has
the MCP entry, `checkBinsExecutable` PASSes (MCP bin found) and
`extractRegisteredPaths` returns `hookBinPath: ''`, so
`checkHookCanary(nodePath, hookBinPath || process.execPath)` spawns node with
the node binary as the script — a guaranteed nonsense FAIL. The exit code is
still 1 (hooks FAIL wins), but the canary line confuses diagnosis.
**Fix:** SKIP the hook canary when `hookBinPath` is empty instead of
substituting `process.execPath`.

### IN-07: Test hygiene — unused imports and non-finally tmp cleanup

**File:** `tests/doctor/checks.test.ts:10, 94-548`
**Issue:** `beforeAll`/`afterAll` are imported but unused. Every test creates
a tmp dir and removes it with a trailing `await rm(...)` not wrapped in
`try/finally` — any assertion failure leaks the directory (the e2e suite uses
`try/finally` correctly; this file does not).
**Fix:** Drop the unused imports; move cleanup into `afterEach` or
`try/finally`.

---

_Reviewed: 2026-07-14T21:44:01Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
