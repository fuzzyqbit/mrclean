---
phase: 11-wire-safety-verification-hardening
reviewed: 2026-07-18T04:19:32Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - .github/workflows/canary-leak.yml
  - .github/workflows/test.yml
  - docs/HOOK-CONTRACT.md
  - src/restore/cli.ts
  - src/restore/session-index.ts
  - src/shared/strings.ts
  - THREAT_MODEL.md
  - vitest.config.ts
  - tests/copy-drift.test.ts
  - tests/hook/dist-parity.test.ts
  - tests/perf/post-tool-use-reversible.perf.test.ts
  - tests/restore/degrade.test.ts
  - tests/restore/session-index.test.ts
  - tests/cli/restore.test.ts
  - tests/state/fs-interception.test.ts
  - tests/uat/fixtures/echo-mcp-server.mjs
  - tests/uat/fixtures/postresp-log-hook.sh
  - tests/uat/wire-safety.test.ts
findings:
  critical: 0
  warning: 4
  info: 7
  total: 11
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-07-18T04:19:32Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Adversarial review of the Phase 11 wire-safety gates and the two shipped src fixes (collision demote, outer-catch honesty), with cross-referencing into the modules the tests and CI steps depend on (`src/state/session-map.ts`, `src/state/map-store.ts`, `src/restore/index.ts`, `src/audit/restore-log.ts`, `src/hook/handlers/post-tool-use.ts`, `src/install/settings.ts`, `tests/uat/harness.ts`). No structural pre-pass was provided; all findings below are narrative.

Traced and confirmed sound:

- **Collision demote (11-03):** the sticky `demoted` Set in `src/restore/session-index.ts` is correct across all orderings I traced (conflict, third-occurrence re-entry, benign duplicate); demoted tokens land as `unmatched` at restore time, matching THREAT_MODEL §5's claim. Restorable scope is strictly narrowed — no phase-10 invariant weakened.
- **Outer-catch honesty (11-04):** counts reset before any emission, guarded fallback write, warn/stdout dedupe flags all correct; byte-locked by degrade rows 1/2.
- **fs-interception patch hygiene:** ORIGINALS captured at module load, install/restore idempotent, `finally` + `afterEach` + live hygiene-probe test proving `syncBuiltinESMExports` re-ran. Channel probes (envelope magic on fd writes, 32-byte key tmp with exact `keyPathFor` prefix, audit append) all verified against the real `map-store.ts` constants (`MRCLNMAP`, `CIPHERTEXT_OFFSET` 37, `publishKeyOnce` tmp naming).
- **Duplicated-by-value constants** (`MRCLEAN_TOOL_RE`, V2 token regexes, envelope offsets, secret canary) all match their ground-truth sources byte-for-byte — except one drifted harness clone (IN-02).
- **Non-vacuity ordering** in dist-parity, perf, degrade, fs-interception, and wire-safety is real, ordered before absence assertions, and fails loud in both directions (a broken hook shape in the UAT harness produces raw canaries on the wire → absence assert fails; a config/HOME miss fails the v2 probes).
- **Copy-drift anchor pairing:** the three 11-07 ban regexes pass THREAT_MODEL's honest copy, positive controls fire, and the shipped-fact/key-custody anchors exist in THREAT_MODEL — verified by running the gate (25/25 pass). The restore/session-index/degrade/cli/fs-interception suites also pass locally (36 passed, 2 win32 placeholders skipped).
- **CI count-guard semantics:** "Test Files N passed" cannot match a partial-failure line (`Test Files 1 failed | 2 passed` does not satisfy `Test Files\s+3 passed`), the named files route to the correct projects per `vitest.config.ts`, and `set -o pipefail` closes the nonzero-exit-with-intact-summary hole as documented.

The four warnings are CI-gate reliability/vacuity issues and two robustness gaps; none re-exposes originals on any wire path.

## Warnings

### WR-01: Wire-safety CI gate pipeline can false-fail via `grep -q` early-exit SIGPIPE under pipefail

**File:** `.github/workflows/canary-leak.yml:118-121`
**Issue:** `npx vitest run … | tee /dev/stderr | grep -Eq "Test Files\s+3 passed"` — `grep -q` exits with status 0 the moment the summary line matches (POSIX-mandated). Vitest prints several more lines after `Test Files N passed` (`Tests …`, `Start at …`, `Duration …`); once grep exits, `tee`'s next write to its stdout pipe raises EPIPE/SIGPIPE (exit 141), and vitest's next write to the dead `tee` can do the same. With `set -o pipefail` those non-zero statuses fail the step even though every test passed. This is an intermittent false-red on a security gate — it cannot false-green, but flaky reds erode trust in exactly the gate that must stay credible (re-run-until-green habituation).
**Fix:**
```yaml
run: |
  run_and_guard() {
    local project="$1" expected="$2"; shift 2
    local out; out="$(mktemp)"
    npx vitest run --project="$project" "$@" >"$out" 2>&1
    local status=$?
    cat "$out"
    [ "$status" -eq 0 ] || exit "$status"
    grep -Eq "Test Files\s+${expected} passed" "$out"
  }
  run_and_guard unit 3 tests/audit/restore-canary-leak.test.ts tests/state/chaos.test.ts tests/state/fs-interception.test.ts
  run_and_guard integration 2 tests/hook/dist-parity.test.ts tests/state/stress.test.ts
```
(Any equivalent capture-then-grep form works; the point is that grep must not share a live pipe with vitest.)

### WR-02: "Defense-in-depth grep — reversible canary corpus" step is structurally vacuous — it can never scan the surface it claims to backstop

**File:** `.github/workflows/canary-leak.yml:123-146`
**Issue:** The step greps `.mrclean/audit*.jsonl` relative to the checkout, guarded by `[ -d .mrclean ]`. But every suite this step claims to backstop writes audit output exclusively under `os.tmpdir()` sandboxes, never the workspace root (verified: `tests/audit/restore-canary-leak.test.ts` → `mrclean-restore-leak-*` tmp cwd; `tests/state/chaos.test.ts` → `mrclean-chaos-cwd-*`; `tests/state/fs-interception.test.ts` → `mrclean-fs-intercept-cwd-*`; `tests/state/stress.test.ts` → `mrclean-stress-*` mkdtemp; `tests/hook/dist-parity.test.ts` → payload cwd `/tmp`). The reversible canaries (`zz-canary-project-path-7g2`, `kim.canary@zz.invalid`, `AKIAIOSFODNN7EXAMPLX`) therefore never appear in any file this step can see, so it always prints "passed" while scanning nothing relevant. The stated purpose — "catches any future test-bug where those assertions are silenced or skipped" (line 128-130) — cannot fire: silencing the in-test assertions does not move the audit sinks to the repo root. This is a gate that passes without proving anything, presented as a second layer of defense.
**Fix:** Either (a) delete the step and rely on the in-test `assertNoCanaryLeak`/byte-scan assertions (which are the real gates), or (b) make the sinks scannable — e.g., have the wire-safety suites accept an env-provided audit root (`MRCLEAN_TEST_AUDIT_DIR`) that CI sets to a workspace path and the step greps — or at minimum (c) rewrite the step comment to state honestly that it only covers a hypothetical future repo-root audit sink, so the next reader does not count it as live coverage.

### WR-03: Survey verdict fallback can record a different tool's shape under the requested tool's name in the committed evidence artifact

**File:** `tests/uat/wire-safety.test.ts:453`
**Issue:** `const entry = entries.find((e) => e.tool_name === toolName) ?? entries[0]` — when the observer log contains entries but none for `toolName` (model used a different tool, PostToolUse fired for an unexpected tool, tool call denied), the verdict for `toolName` is silently built from `entries[0]`, i.e. some other tool's `typeof`/shape. The only hard assertion is `entries.length > 0`. This writes a mislabeled per-tool verdict into `tests/uat/artifacts/contract-findings.json`, which `docs/HOOK-CONTRACT.md`'s "Per-tool tool_response shapes" matrix re-stamps from — corrupting the exact evidence chain the copy-drift traceability gate exists to protect. `observed_tool_names` in signals makes the mislabel *discoverable*, but nothing makes it *loud*.
**Fix:**
```ts
const entry = entries.find((e) => e.tool_name === toolName)
expect(
  entry,
  `harness integrity: no ${toolName} entry in ${logPath} — observed: ${[...new Set(entries.map((e) => e.tool_name))].join(', ')}`,
).toBeDefined()
if (entry === undefined) return
```

### WR-04: `runRestore` stdin read sits outside both error domains — a stream error crashes with a raw stack instead of the contracted exit shapes

**File:** `src/restore/cli.ts:161`
**Issue:** The module's contract (lines 17-31) is total: hard input errors exit 2 with a constant line; everything else degrades one-way with exit 0. But `input = await readAll(stdin)` runs before the degrade `try` and has no handler of its own (unlike the file branch at 152-159). A stdin stream `'error'` event (closed fd, EIO on hangup, broken pipe upstream) makes the async iterator throw, `runRestore` rejects, and `src/cli.ts`'s top-level `await program.parseAsync(...)` turns that into an unhandled-rejection crash: raw stack trace on stderr, exit code 1 — neither error domain, no constant-shape diagnostic, no counts summary.
**Fix:**
```ts
} else {
  try {
    input = await readAll(stdin)
  } catch {
    process.stderr.write('[mrclean] restore: cannot read stdin\n')
    process.exitCode = 2
    return
  }
}
```
(Constant copy, no error text — same discipline as the other hard gates; add a matching byte-locked row to tests/cli/restore.test.ts.)

## Info

### IN-01: Cross-class placeholder collisions bypass the IN-02 demote and are safe only by engine precedence

**File:** `src/restore/session-index.ts:143-170`
**Issue:** The sticky-Set demote only compares within `placeholders`. A placeholder claimed secret-class by session A and restorable (with an original) by session B ends up in *both* `secretPlaceholders` and `placeholders` — never demoted. The outcome is fail-safe solely because `restoreText` (src/restore/index.ts:81) checks `secretPlaceholders` before the index lookup, so the token passes through — but it is counted `skippedSecret` rather than `unmatched` (inconsistent with the documented "ambiguous token demotes to unmatched" treatment), and a dead pair remains in the returned index.
**Fix:** Either demote cross-structure conflicts too (check `secretPlaceholders.has(entry.placeholder)` before `placeholders.set`, and vice versa), or add a comment in `buildRestoreIndex` documenting that safety depends on restoreText's secret-first precedence so a future reordering there cannot silently create a wrong-value restore.

### IN-02: `captureRestoreRun` in fs-interception drifted from the WR-03 harness it claims to duplicate

**File:** `tests/state/fs-interception.test.ts:252-292`
**Issue:** The comment says "tests/cli/restore.test.ts capture harness, duplicated by value" — but this clone is the older shape: it never reads, resets, or restores `process.exitCode`; `exitCode` is only set via a `process.exit` stub that `runRestore` (WR-03 compliant) never calls. Consequently `expect(restoreRun.exitCode).toBeUndefined()` (line 367) is satisfied even if a hard gate fired (`process.exitCode = 2` + return), and that exitCode would leak into the vitest worker. Currently unreachable (no `session`/`file` opts passed), and the stdout/summary non-vacuity assertions independently catch a degraded run — but the drift is exactly what the duplicate-don't-import discipline warns about.
**Fix:** Copy the tests/cli/restore.test.ts harness verbatim (save/capture/restore `process.exitCode`; `process.exit` stub throws unconditionally).

### IN-03: The fs-write sweep's "ANY write API" claim covers 8 APIs; sync fd-writes, streams, and FileHandle writes are unwrapped

**File:** `tests/state/fs-interception.test.ts:123-132`
**Issue:** `fs.writeSync`, `fs.writevSync`, `fs.createWriteStream`, and `fsPromises.open()`/`FileHandle.write/writev` are not wrapped. The channel probes protect the three *known* channels from silently going dark, but a future additional write channel through an unwrapped API (e.g., a debug dump via `writeSync`) would evade the "no plaintext canary reaches ANY write API" sweep without failing anything. THREAT_MODEL §2 repeats the "every buffer handed to an fs write API" phrasing.
**Fix:** Wrap the sync/fd variants too (cheap), or narrow the header + THREAT_MODEL wording to "the write APIs the reversible flow uses, pinned by channel probes."

### IN-04: dist-parity uses static `/tmp` as the payload cwd — audit appends and config reads escape the sandbox

**File:** `tests/hook/dist-parity.test.ts:104`
**Issue:** With payload `cwd: '/tmp'`, the spawned hook's audit sink is `/tmp/.mrclean/audit.jsonl` (written if a stray `/tmp/.mrclean` exists — litter outside the suite's `afterAll` cleanup), and a pre-existing `/tmp/.mrclean/config.toml` on a dev machine would flip the one-way run into reversible mode. That failure is loud (assertion 5 breaks), not vacuous, but the diagnosis would be mystifying. chaos.test.ts (the suite this file cites for its recipes) mints per-test tmp cwds.
**Fix:** `cwd: mkdtempSync(join(tmpdir(), 'mrclean-dist-parity-cwd-'))` per run, pushed onto `cleanupDirs`.

### IN-05: Session-UUID traceability regex is lowercase-only — case-variant citations are invisible to the gate

**File:** `tests/copy-drift.test.ts:299`
**Issue:** `SESSION_UUID_RX = /[0-9a-f]{8}-…/g` extracts only lowercase UUIDs. An uppercase or mixed-case session UUID quoted in HOOK-CONTRACT.md would not be extracted at all, silently escaping the membership check (the gate's own non-vacuity guard only requires ≥1 extraction overall).
**Fix:** Add the `i` flag and compare lowercased on both sides: `artifact.toLowerCase().includes(uuid.toLowerCase())`.

### IN-06: Hard p95 < 200 ms gate also runs in the 3-node test matrix and under V8 coverage instrumentation

**File:** `tests/perf/post-tool-use-reversible.perf.test.ts:204`, `vitest.config.ts:137`
**Issue:** Because the file rides the integration project's `tests/perf/**` glob, the threshold assertion executes in `npm test` (test.yml, 3 matrix slots) and in `npm run test:coverage` (V8 coverage — the repo's own comment estimates ~30% overhead), not just perf.yml. This row does crypto + fs + lock work per iteration, so shared-runner variance plus instrumentation eats headroom; a spike flakes three workflows at once. Sibling precedent exists (post-tool-use.perf.test.ts), so this is additive risk, not new design.
**Fix:** Log always, but gate the `toBeLessThan(THRESHOLD)` assert behind an env flag set only in perf.yml, or apply an instrumentation multiplier when `process.env.VITEST_COVERAGE` is present.

### IN-07: `wireRecord.evidence_paths` commits absolute `/Users/<name>` transcript paths into the tracked artifact

**File:** `tests/uat/wire-safety.test.ts:701,850`
**Issue:** Both the drift and PASS records set `evidence_paths: [transcriptPath1]` — an absolute path under the operator's home (username-bearing) that dangles after any transcript cleanup. The same file's survey verdicts deliberately record `evidence_paths: []` "no dangling paths" (line 464-466). Precedent exists (the committed artifact already carries 10 `/Users/…` paths from earlier phases), so this is consistency drift, not a new leak class — but for a confidentiality-focused repo, home-dir paths in tracked files are gratuitous.
**Fix:** Record `path.basename(transcriptPath1)` (the `<session_id>.jsonl` name is what traceability needs) or a `~`-relative form.

---

_Reviewed: 2026-07-18T04:19:32Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
