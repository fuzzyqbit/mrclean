---
phase: 10-operator-restore
reviewed: 2026-07-17T23:53:59Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - src/audit/restore-log.ts
  - src/cli.ts
  - src/config/index.ts
  - src/doctor/checks.ts
  - src/mcp/tools/status.ts
  - src/restore/cli.ts
  - src/restore/index.ts
  - src/restore/session-index.ts
  - src/state/counts.ts
  - src/state/session-map.ts
  - tests/audit/restore-canary-leak.test.ts
  - tests/audit/restore-log.test.ts
  - tests/cli/restore.test.ts
  - tests/config/reversible-raw-keys.test.ts
  - tests/doctor/checks.test.ts
  - tests/mcp/status-reversible.test.ts
  - tests/restore/degrade.test.ts
  - tests/restore/engine.test.ts
  - tests/restore/mixed-canary.test.ts
  - tests/restore/session-index.test.ts
  - tests/state/cold-path.test.ts
  - tests/state/counts.test.ts
  - tests/state/inspection.test.ts
findings:
  critical: 1
  warning: 3
  info: 4
  total: 8
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-07-17T23:53:59Z
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Reviewed the Phase 10 "Operator Restore" surface: the single-pass restore engine (`src/restore/index.ts`), the policy-gated session index (`src/restore/session-index.ts`), the `runRestore` CLI action (`src/restore/cli.ts`), the hash-only restore audit record (`src/audit/restore-log.ts`), the counts reducer (`src/state/counts.ts`), the status-tool counters block (`src/mcp/tools/status.ts`), the doctor FAIL-loud scan (`src/doctor/checks.ts`, `src/config/index.ts`), the token-grammar export (`src/state/session-map.ts`), the CLI wiring (`src/cli.ts`), and all 13 phase test files.

The security-critical invariants hold under adversarial probing. Verified directly: the secret floor's triple gate (type shape + serializer strip + parse drop + read-side gate) blocks a hand-poisoned secret-class `original` re-encrypted under the real key; the audit builder destructure-picks and cannot serialise over-shaped input; `--session` is UUID-validated before any path derivation; the import fences (cold-path + restore trust-boundary tests) structurally isolate `src/restore/` to the one sanctioned dynamic import in `src/cli.ts`; restore is byte-inert on the session store (listings + mtimes snapshot-verified); no raw canary reaches stdout/stderr/audit/artifacts on happy or forced-failure paths. All 13 phase test files pass locally (114 passed, 3 platform-skipped). The 10 phase source files are clean under the project tsconfig.

However, three demonstrated defects were found (reproduced empirically during this review, not inferred from reading): the CLI entrypoint guard makes the entire binary — including the new `mrclean restore` — silently inert when invoked through a symlinked bin (the exact shape npm/npx install on POSIX), through a path containing spaces, or on Windows (CR-01); the restore-counter aggregator can be driven to `Infinity`/negative totals by a tampered project-local `audit.jsonl`, which breaks the `mrclean_status` tool's stated never-throw invariant because zod v4 `z.number()` rejects `Infinity` (WR-01); and an uppercase `--session` UUID passes validation but silently matches zero sessions (WR-02).

Context note (outside the reviewed file list, no finding filed): repo-wide `npm run typecheck` (`tsc --noEmit`) currently fails on pre-existing errors in `src/audit/log.ts`, `src/detect/layer1-regex/*`, `src/doctor/bench.ts`, `src/doctor/version-check.ts`, `src/model/pipeline-singleton.ts`, and `tests/audit/log.test.ts`. None of these are Phase 10 files, but the typecheck gate is red.

## Critical Issues

### CR-01: Entrypoint guard makes the CLI (including `mrclean restore`) silently inert via symlinked bins, spaced paths, and on Windows

**Status:** fixed — commit `4e09374`. Guard extracted to `src/shared/entrypoint.ts` (`isMainEntry`: direct pathToFileURL comparison, then realpath fallback — also correct under `--preserve-symlinks-main`) and applied to BOTH `src/cli.ts` and `src/mcp.ts`. Regression: `tests/cli/entrypoint-guard.test.ts` drives the extracted guard with the exact (import.meta.url, argv[1]) pairs Node produces (premise re-verified empirically on this Node: entry URL realpaths `/tmp` symlink prefix AND the link itself) — symlinked-bin, spaced-path (%20), wrong-module, undefined-argv, and missing-path rows, with non-vacuity asserts that the OLD naive comparison fails each repaired pair. A spawn-through-symlink row against the BUILT `dist/cli.js` was deliberately NOT added: dist/ is orchestrator-owned and rebuilt centrally post-merge, so a dist-spawning unit row would run red against the stale pre-fix bundle until the rebuild; that harness belongs to the integration project after dist is rebuilt (verifier: `ln -s <repo>/dist/cli.js /tmp/x && node /tmp/x --version` should print the version once rebuilt).
**File:** `src/cli.ts:138`
**Issue:** The main-module guard compares URLs by naive string interpolation:

```ts
const isMain = import.meta.url === `file://${process.argv[1]}`
```

Node realpaths and percent-encodes the ESM entry URL, but `process.argv[1]` is the raw invocation path. The comparison fails — and the CLI registers its commands, never calls `parseAsync`, and exits 0 with no output — whenever:

1. the bin is invoked through a symlink — which is exactly how npm and npx wire `bin` entries on POSIX (`node_modules/.bin/mrclean` → `dist/cli.js`, `/opt/homebrew/bin/mrclean` → `../lib/node_modules/...`). The project's stated distribution channel is "a single `npx`-runnable bin";
2. any path component contains a space or URL-escapable character (`file:///Users/me/My%20Docs/...` vs `file:///Users/me/My Docs/...`), or a symlinked prefix (macOS `/tmp` → `/private/tmp`);
3. on Windows, where `file://C:\...` never matches a `file:///C:/...` URL — the guard is always false there.

**Demonstrated during review against the real built artifact:**

```
$ ln -s .../mrclean/dist/cli.js /tmp/mrclean-review-bin/mrclean-link
$ node /tmp/mrclean-review-bin/mrclean-link --version
   (no output, exit 0)
$ node .../mrclean/dist/cli.js --version
1.0.0-rc.9
```

Phase 10 impact: `npx mrclean restore < redacted.txt > restored.txt` produces an **empty** `restored.txt` with exit 0 — a silently wrong result from the phase's headline deliverable. The broader impact predates this phase (the guard is pre-existing; the phase diff only added the `restore` subcommand), but every phase test drives `runRestore` directly or spawns `dist/cli.js` by absolute non-symlinked path, so no test can catch it. The identical guard exists in `src/mcp.ts:14` (outside this review's file list — fix both). Note the security-adjacent variant: a registered hook path with a space or symlinked component makes `cli.js hook` exit 0 with empty stdout, which the hook contract treats as pass-through — silent fail-open (doctor's canary does catch this, but only if run).

**Fix:**
```ts
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const argv1 = process.argv[1]
let isMain = false
if (argv1 !== undefined) {
  try {
    isMain = import.meta.url === pathToFileURL(realpathSync(argv1)).href
  } catch {
    isMain = false // argv[1] unreadable — behave as imported module
  }
}
if (isMain) {
  await program.parseAsync(process.argv)
}
```
Apply the same fix to `src/mcp.ts`. Add a regression test that spawns `dist/cli.js` through a symlink (the npm bin shape) and asserts `--version` produces output.

## Warnings

### WR-01: Tampered project-local `audit.jsonl` can drive restore totals to `Infinity`/negative — `mrclean_status` then violates its never-throw invariant

**Status:** fixed — commit `32b4079`. `finiteOrZero` (Number-coercion) replaced by strict `counterOrZero` (`typeof value === 'number' && Number.isSafeInteger(value) && value >= 0`), accumulator clamped at `Number.MAX_SAFE_INTEGER` — totals are now always non-negative safe integers, so zod v4 `z.number()` in `statusOutputSchema` can never reject them. Tamper matrix added to `tests/audit/restore-log.test.ts`: `1e308`×2 (Infinity feeder), negatives, `true`, `[7]`, `'5'`, fractional `1.5`, and a MAX_SAFE_INTEGER×2 clamp row.
**File:** `src/audit/restore-log.ts:164-165, 189-192` (surfaced via `src/mcp/tools/status.ts:112-119`)
**Issue:** `finiteOrZero` guards each *line* (`Number.isFinite`), but not the *accumulator*, and `Number()` coercion accepts values the docstring claims are "counted as 0". Demonstrated during review with a 3-line crafted `audit.jsonl`:

- two lines with `"restored": 1e308` → `restored_total: Infinity` (each line is finite; the sum overflows);
- `"unmatched": -500` plus `"unmatched": true` → `unmatched_total: -499` (negatives pass; `Number(true) === 1`; `Number([7]) === 7`; `Number("5") === 5` — all contrary to the "non-numeric counter → 0" contract);
- verified: `z.number().safeParse(Infinity).success === false` under the project's zod v4 — the MCP SDK validates `structuredContent` against `statusOutputSchema`, so the `mrclean_status` call returns a **tool error**, directly contradicting the module's own locked comment ("tampered audit lines cannot crash the status surface") and the REVMODE-12 never-throw posture. The `.catch` in status.ts cannot help: `aggregateRestoreCounters` resolves successfully with `Infinity`; the failure happens later in output validation. The text-content channel also degrades (`JSON.stringify(Infinity)` → `null`).

`<cwd>/.mrclean/audit.jsonl` is a project-tree file — a hostile cloned repo can ship it, so this is reachable from untrusted input, not just local tampering. Impact is confined to the status/diagnostic surface (no redaction or leak impact).

**Fix:** validate the raw JSON value strictly and clamp the accumulator:
```ts
function counterOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}
// in the loop:
restoredTotal = Math.min(restoredTotal + counterOrZero(parsed['restored']), Number.MAX_SAFE_INTEGER)
unmatchedTotal = Math.min(unmatchedTotal + counterOrZero(parsed['unmatched']), Number.MAX_SAFE_INTEGER)
```
Extend `tests/audit/restore-log.test.ts` with the `1e308`×2, negative, boolean, and `[7]` tamper rows (the existing tamper test only covers the string `'banana'`).

### WR-02: Uppercase `--session` UUID passes validation but silently restores nothing

**Status:** fixed — commit `a162909`. Filter comparison normalized once at the `buildRestoreIndex` boundary (`sid.toLowerCase() === sessionFilter.toLowerCase()`); the sid handed to `readSessionMapFile` keeps its on-disk casing, and the shared `SESSION_ID_RE` is untouched for hook-side use. Regression row in `tests/restore/session-index.test.ts` uses a FIXED lowercase sid (hex letters guaranteed — a random UUID could theoretically be all digits) uppercased as the filter: `sessions: 1` and the WORD pair indexed.
**File:** `src/restore/session-index.ts:117` (with `src/state/session-map.ts:334-335` and `src/restore/cli.ts:135`)
**Issue:** `SESSION_ID_RE` carries the `i` flag, so `isValidSessionId('ABC…-UPPERCASE-UUID')` is true and the CLI hard gate does not exit 2. But `buildRestoreIndex` narrows with a case-sensitive comparison against sids derived from on-disk filenames (lowercase, from `randomUUID()`/hook payloads):

```ts
discovered.filter((sid) => sid === sessionFilter)
```

Demonstrated during review: for a seeded session, `buildRestoreIndex(baseDir, sid.toUpperCase())` returns `sessions: 0` while the lowercase filter returns `sessions: 1`. The operator gets a full pass-through plus the misleading `no readable session map` warning for a session that exists — a silent wrong result for a validly-formatted argument (UUID hex is case-insensitive per RFC 4122; uppercase is common when copied from other tools). Failure direction is safe (pass-through, never a wrong restore), but the behavior contradicts the validator's own acceptance.

**Fix:** normalize once at the boundary in `buildRestoreIndex` (keeps the shared regex untouched for hook-side use):
```ts
const filter = sessionFilter?.toLowerCase()
...
sessionFilter === undefined ? discovered : discovered.filter((sid) => sid.toLowerCase() === filter)
```
Add a test row: seeded session + uppercased `--session` → `sessions: 1`.

### WR-03: `process.exit(2)` immediately after `process.stderr.write` can drop the diagnostic on piped stderr

**Status:** fixed — commit `a23a99a`. Both hard gates now set `process.exitCode = 2` and `return`, letting the event loop drain and flush before Node exits with code 2. All four process-seam harnesses (tests/cli/restore, tests/restore/degrade, tests/restore/mixed-canary, tests/audit/restore-canary-leak) updated per the review's suggestion: they assert `process.exitCode` directly (captured then reset so a gate can never leak a nonzero code into the vitest worker) and keep a throw-on-`process.exit` stub as a regression guard.
**File:** `src/restore/cli.ts:136-137, 147-148`
**Issue:** Per Node's process-I/O documentation, writes to `process.stderr` are asynchronous when stderr is a pipe on POSIX, and `process.exit()` does not wait for pending stream writes. When the operator pipes stderr (e.g. `2>&1 | tee`, or captured by a wrapper script), the `ERR_BAD_SESSION` / `cannot read input file` line can be truncated or lost entirely — exit code 2 arrives with no explanation. The message is the only operator-facing diagnostic for the two hard gates.

**Fix:** set the exit code and return instead of terminating, letting the event loop drain and flush:
```ts
if (session !== undefined && !isValidSessionId(session)) {
  process.stderr.write(ERR_BAD_SESSION)
  process.exitCode = 2
  return
}
```
(Same for the unreadable-file gate.) This also removes the need for the throw-based `process.exit` stubs in the four test harnesses — `captureRun` could assert `process.exitCode` directly.

## Info

### IN-01: `runRestore` outer catch can report stale non-zero counts against pass-through output, and its fallback write can rethrow

**Status:** deferred — Info findings are outside this fix pass's scope (Critical + Warning only).
**File:** `src/restore/cli.ts:156-214`
**Issue:** `counts` is assigned at step (5), before the stdout write at step (6). If `process.stdout.write(result.text)` throws (e.g. synchronous throw on a destroyed stream after downstream EPIPE), the catch emits the original `input` — but the always-last summary line still reports the pre-computed `restored=N`, contradicting the actual output. Additionally, the fallback `process.stdout.write(input)` inside the catch targets the same broken stream and can rethrow, escaping `runRestore` as an unhandled rejection despite the "cosmetic failure can never produce a nonzero exit" contract.
**Fix:** in the catch, reset `counts = ZERO_COUNTS` before falling through to the summary, and wrap the fallback write in its own try/catch.

### IN-02: Cross-session placeholder collision is silent last-write-wins, not "structurally absent"

**Status:** deferred — Info findings are outside this fix pass's scope (Critical + Warning only).
**File:** `src/restore/session-index.ts:140`
**Issue:** `placeholders.set(entry.placeholder, entry.original)` overwrites on identical tokens from different sessions (same TYPE + NNN + nonce8). With a 4-byte nonce this is birthday-bounded (~2⁻³² per session pair, not zero), so the union-scope comment's "cross-session collisions structurally absent" overstates the guarantee; a collision would silently restore one session's token to the other session's value (a wrong-value restore, the same class the OVF exclusion exists to prevent). The engine's secret-first check already makes restorable-vs-secret conflicts fail safe.
**Fix:** on a duplicate key with a *different* original, delete the entry from `placeholders` (demote to unmatched) instead of overwriting — mirrors the OVF ambiguity treatment. One-line comment fix at minimum.

### IN-03: Restore audit hashes are dictionary-confirmable (accepted shipped discipline — for the record)

**Status:** deferred — for-the-record finding; the review itself states no action required (accepted shipped discipline).
**File:** `src/restore/cli.ts:187`
**Issue:** `redactedHash` is an unsalted first-16-hex SHA-256. Anyone holding `<cwd>/.mrclean/audit.jsonl` (a committable project file) can confirm guessed restorable-class values (emails, names, word-list terms) against the `hashes` array. This matches the shipped hook audit discipline — the same values were already hashed by the same function at detection time — so no new value class is exposed; the marginal change is that restore replicates hashes into whichever project cwd the operator runs in. Contrast with `hmacAddress`, which is deliberately salted for exactly this dictionary-confirmation reason. No action required; documenting so the tradeoff stays a decision rather than an accident.

### IN-04: `readRawReversibleKeys` duplicates `readConfigLayer`'s read/parse scaffolding

**Status:** deferred — Info findings are outside this fix pass's scope (Critical + Warning only).
**File:** `src/config/index.ts:527-550`
**Issue:** The ENOENT-→-empty, empty-file-→-empty, and parse-→-ConfigReadError scaffolding is copy-pasted from `readConfigLayer` (~20 lines). The two paths can drift (e.g. whitespace/BOM handling, error message shape) and doctor's raw scan would then disagree with the loader about the same file.
**Fix:** extract a shared internal helper, e.g. `async function readTomlTable(filePath): Promise<Record<string, unknown> | null>` returning `null` for absent/empty, throwing `ConfigReadError` on malformed, and have both public functions consume it.

---

_Reviewed: 2026-07-17T23:53:59Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Fix pass: 2026-07-18T00:13:07Z — CR-01 `4e09374`, WR-01 `32b4079`, WR-02 `a162909`, WR-03 `a23a99a` fixed; IN-01..IN-04 deferred (out of fix scope). Fixer: Claude (gsd-code-fixer)_
