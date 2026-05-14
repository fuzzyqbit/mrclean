---
phase: 02-live-redaction-layers-1-4-one-way
plan: "06"
type: execute
wave: 4
depends_on: ["04"]
files_modified:
  - tests/fixtures/positive/aws-access-key.txt
  - tests/fixtures/positive/aws-secret-key.txt
  - tests/fixtures/positive/github-pat-classic.txt
  - tests/fixtures/positive/github-pat-fine-grained.txt
  - tests/fixtures/positive/jwt.txt
  - tests/fixtures/positive/stripe-live-key.txt
  - tests/fixtures/positive/openai-key.txt
  - tests/fixtures/positive/anthropic-key.txt
  - tests/fixtures/positive/slack-bot-token.txt
  - tests/fixtures/positive/private-key-pem.txt
  - tests/fixtures/positive/dotenv-derived.txt
  - tests/fixtures/positive/words-term.txt
  - tests/fixtures/negative/uuid-v4.txt
  - tests/fixtures/negative/uuid-v7.txt
  - tests/fixtures/negative/git-sha-40.txt
  - tests/fixtures/negative/git-sha-7.txt
  - tests/fixtures/negative/npm-integrity-sha512.txt
  - tests/fixtures/negative/cargo-lock-hash.txt
  - tests/fixtures/negative/md5-digest.txt
  - tests/fixtures/negative/sha256-digest.txt
  - tests/fixtures/negative/base64-image-header.txt
  - tests/fixtures/negative/lorem-ipsum.txt
  - tests/fixtures/FIXTURES.md
  - tests/fixtures-corpus.test.ts
  - src/doctor/bench.ts
  - src/doctor/index.ts
  - src/cli.ts
  - tests/doctor/bench.test.ts
autonomous: true
requirements: []
tags: [fixtures, recall, false-positive-rate, bench, doctor]
must_haves:
  truths:
    - "Every positive fixture file contains a real-shape (checksum-flipped) secret that Layer 1 catches with 100% recall"
    - "Every negative fixture file contains a high-entropy or special-shape value that no detection layer flags"
    - "tests/fixtures-corpus.test.ts proves 100% positive recall + 0 false positives end-to-end across the orchestrator"
    - "tests/fixtures/FIXTURES.md documents the checksum-flip discipline + source format references for every fixture"
    - "`mrclean doctor --bench` runs Layer 1 + Layer 2 against a 4 KB fixture N times and prints p50/p95 latency to stderr (no assertion gate yet — Phase 3)"
    - "No fixture string ever appears in the audit log after the corpus test runs (canary-leak helper verifies this)"
  artifacts:
    - path: "tests/fixtures/positive/*.txt"
      provides: "12 positive fixture files with synthetic checksum-flipped secrets"
      min_lines: 1
    - path: "tests/fixtures/negative/*.txt"
      provides: "10 negative fixture files (UUIDs, git SHAs, hashes, lorem)"
      min_lines: 1
    - path: "tests/fixtures/FIXTURES.md"
      provides: "Documentation of fixture provenance + checksum-flip discipline"
      contains: "checksum-flip"
    - path: "tests/fixtures-corpus.test.ts"
      provides: "End-to-end corpus test proving recall + false-positive rate + canary-leak"
      contains: "assertNoCanaryLeak"
    - path: "src/doctor/bench.ts"
      provides: "runBenchmark(opts) returning { p50, p95, runsCount }"
      exports: ["runBenchmark", "BenchmarkResult"]
  key_links:
    - from: "tests/fixtures-corpus.test.ts"
      to: "src/detect/index.ts"
      via: "runDetection against each fixture file"
      pattern: "runDetection"
    - from: "tests/fixtures-corpus.test.ts"
      to: "src/audit/canary-leak.ts"
      via: "assertNoCanaryLeak against the test's audit log output"
      pattern: "assertNoCanaryLeak"
    - from: "src/doctor/bench.ts"
      to: "src/detect/index.ts"
      via: "runDetection in a timed loop"
      pattern: "runDetection"
---

<objective>
Land the positive + negative test fixture corpus that proves the Phase 2 success criterion #4 (100% recall on positives + 0 false positives on negatives), plus the `mrclean doctor --bench` stub that Phase 3's PERF gate will harden into an assertion.

Purpose: Without a corpus the success criterion is unmeasurable. The CI canary-leak test runs against actual fixture-generated audit logs and asserts no raw secret string ever lands in the log.

Output: ~22 fixture files, a corpus-runner test, a doctor benchmark stub, and a FIXTURES.md documenting provenance.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-04-detection-orchestrator-dry-run-PLAN.md
@.planning/phases/01-wired-skeleton/01-05-SUMMARY.md
@CLAUDE.md

<interfaces>
Fixture inventory (from RESEARCH §12 — checksum-flipped values):

Positive fixtures (one .txt file per type; each contains the synthetic value embedded in a short natural-language sentence so detection layers see realistic context):
- aws-access-key.txt: `AKIAIOSFODNN7EXAMPLX` (last char E→X)
- aws-secret-key.txt: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLXKEY`
- github-pat-classic.txt: `ghp_1234567890abcdefGHIJKLMNOPQRSTUVWXYZ` (40-char shape)
- github-pat-fine-grained.txt: `github_pat_11ABCDE0000000000000000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
- jwt.txt: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.XXXXXXXXXXXXXXXXXXXXXXXXXXX`
- stripe-live-key.txt: `sk_live_0000000000000000000000000000000x`
- openai-key.txt: `sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
- anthropic-key.txt: `sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
- slack-bot-token.txt: `xoxb-000000000000-000000000000-AAAAAAAAAAAAAAAAAAAAAAAAX`
- private-key-pem.txt: a minimal `-----BEGIN PRIVATE KEY-----\n<padding>\n-----END PRIVATE KEY-----` block (use placeholder base64 that doesn't decode to a real key — the secretlint privatekey rule fires on the structure)
- dotenv-derived.txt: contains a fake `.env`-style `MY_API_KEY=secretvalue12345` value; the corpus test loads a side-by-side .env file to populate the blocklist; this fixture's text contains "secretvalue12345" (the value not the variable name) so Layer 3 catches it
- words-term.txt: contains `ACME_INTERNAL_CODENAME` which is also a side-by-side words.txt entry; Layer 4 catches it

Negative fixtures (one .txt file per type — no detection layer should flag):
- uuid-v4.txt: `550e8400-e29b-41d4-a716-446655440000`
- uuid-v7.txt: `018f4c6a-b420-7e3a-8000-000000000000`
- git-sha-40.txt: `a94a8fe5ccb19ba61c4c0873d391e987982fbbd3`
- git-sha-7.txt: `a94a8fe`
- npm-integrity-sha512.txt: `sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==`
- cargo-lock-hash.txt: `ab12cd34ef56` (12-char low-entropy hex)
- md5-digest.txt: `5d41402abc4b2a76b9719d911017c592`
- sha256-digest.txt: `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`
- base64-image-header.txt: `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAC`
- lorem-ipsum.txt: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Lorem ipsum dolor sit amet.`

Fixture file format (each file):
```
# mrclean test fixture — synthetic invalid value for detection pattern testing
# Source: <service> token format from official documentation
# Checksum-flip: <description>
# License: test fixture only — not a real credential
#
<text-containing-the-fixture-value>
```

Corpus runner test plan:
- For EACH positive fixture: read the file (strip the `# ` header lines via regex `/^#.*$/gm`), call `runDetection(text, DEFAULT_CONFIG, sessionState, ctx)`, assert `result.findings.length >= 1`.
- For EACH negative fixture: same, assert `result.findings.length === 0`.
- For the dotenv-derived fixture: set up a side-by-side `.env` file in a tmp dir; the sessionState's envBlocklist must be loaded from it.
- For words-term fixture: same with `.mrclean/words.txt`.
- After all positives + negatives run, call `assertNoCanaryLeak(auditLogPath, ALL_FIXTURE_VALUES)` and assert `ok: true`.

ALL_FIXTURE_VALUES is the list of the 12 raw values embedded in positive fixtures. The audit log must not contain any of them.

Bench stub (RESEARCH §13.1):
- `runBenchmark({ runsCount = 10 }): Promise<BenchmarkResult>` where `BenchmarkResult = { p50: number; p95: number; runsCount: number }`.
- Builds a synthetic 4 KB prompt: `'This is a synthetic 4KB test prompt. '.repeat(114).slice(0, 4096)`.
- Calls `runDetection(FIXTURE_4KB, DEFAULT_CONFIG, mockSessionState, ctx)` runsCount times, recording `performance.now()` deltas.
- Sorts times, picks p50 and p95.
- Returns numbers; Plan 02-05 already updated doctor — this plan wires `--bench` to `runBenchmark` and prints results via picocolors.
- NO assertions — Phase 3 PERF-02 owns that.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fixture corpus (positive + negative) + FIXTURES.md + end-to-end corpus test</name>
  <files>tests/fixtures/positive/aws-access-key.txt, tests/fixtures/positive/aws-secret-key.txt, tests/fixtures/positive/github-pat-classic.txt, tests/fixtures/positive/github-pat-fine-grained.txt, tests/fixtures/positive/jwt.txt, tests/fixtures/positive/stripe-live-key.txt, tests/fixtures/positive/openai-key.txt, tests/fixtures/positive/anthropic-key.txt, tests/fixtures/positive/slack-bot-token.txt, tests/fixtures/positive/private-key-pem.txt, tests/fixtures/positive/dotenv-derived.txt, tests/fixtures/positive/words-term.txt, tests/fixtures/negative/uuid-v4.txt, tests/fixtures/negative/uuid-v7.txt, tests/fixtures/negative/git-sha-40.txt, tests/fixtures/negative/git-sha-7.txt, tests/fixtures/negative/npm-integrity-sha512.txt, tests/fixtures/negative/cargo-lock-hash.txt, tests/fixtures/negative/md5-digest.txt, tests/fixtures/negative/sha256-digest.txt, tests/fixtures/negative/base64-image-header.txt, tests/fixtures/negative/lorem-ipsum.txt, tests/fixtures/FIXTURES.md, tests/fixtures-corpus.test.ts</files>
  <read_first>
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §12 (fixture inventory + checksum-flip discipline)
    - src/detect/index.ts (Plan 02-04 — runDetection signature)
    - src/detect/session-state.ts (Plan 02-02 — initSessionState signature)
    - src/audit/canary-leak.ts (Plan 02-03 — assertNoCanaryLeak)
    - src/config/defaults.ts (Plan 02-00 — DEFAULT_CONFIG)
  </read_first>
  <action>
    Step 1 — Create the 12 positive fixture files exactly per the interfaces inventory. Each file follows the format header above. Embed the synthetic value in a natural-language sentence so the keyword pre-filters (gitleaks) have realistic context.

    Example template for `aws-access-key.txt`:
    ```
    # mrclean test fixture — synthetic invalid value for detection pattern testing
    # Source: AWS Access Key ID format from official AWS docs (20-char shape)
    # Checksum-flip: last char 'E' replaced with 'X' — pattern still matches but value is invalid
    # License: test fixture only — not a real credential
    
    Please use the access key AKIAIOSFODNN7EXAMPLX for the deployment.
    ```

    Step 2 — Create the 10 negative fixture files similarly. Example for `uuid-v4.txt`:
    ```
    # mrclean test fixture — synthetic high-entropy non-secret
    # Source: RFC 4122 UUID v4 example
    # License: test fixture only
    
    Session id is 550e8400-e29b-41d4-a716-446655440000.
    ```

    Step 3 — Write `tests/fixtures/FIXTURES.md` documenting:
    - The checksum-flip discipline (why we don't commit real secrets even in tests).
    - The format-source for each fixture (official docs URL or rule-source).
    - The negative-fixture rationale (why each shape is a known false-positive risk).
    - Guidance for adding NEW fixtures (where, format, naming).

    Step 4 — `tests/fixtures-corpus.test.ts`:
    - `beforeAll`: create a tmp directory; `mkdir -p $tmp/.mrclean`. Inside tmp, create `.env` with `MY_API_KEY=secretvalue12345` and `.mrclean/words.txt` with `ACME_INTERNAL_CODENAME`. Build a `DEFAULT_CONFIG_FOR_TEST = { ...DEFAULT_CONFIG, secrets_files: [] }`. Bootstrap `sessionState = await initSessionState({ sessionId: 'corpus-test', homeDir: tmp, cwd: tmp, config })`.
    - `afterAll`: clean tmp.
    - Helper `function stripHeader(content: string): string` removes `# `-prefixed comment lines and blank leading lines.
    - For each positive fixture: `it('catches ${fixtureName}', async () => { const text = stripHeader(readFileSync(...)); const result = await runDetection(text, config, sessionState, ctx); expect(result.findings.length).toBeGreaterThanOrEqual(1) })`. 12 test cases.
    - For each negative fixture: `it('does not flag ${fixtureName}', async () => { ... expect(result.findings).toEqual([]) })`. 10 test cases.
    - Final test: `it('audit log contains no raw fixture values', async () => { const auditPath = path.join(tmp, '.mrclean', 'audit.jsonl'); const canaries = [...ALL_FIXTURE_VALUES]; const result = await assertNoCanaryLeak(auditPath, canaries); expect(result.ok).toBe(true); if (!result.ok) console.error('LEAKS:', result.leaked) })`.

    Step 5 — Run `npx vitest run tests/fixtures-corpus.test.ts`. Diagnose any failures (most likely candidates: a positive fixture's value doesn't actually match any rule; a negative fixture coincidentally triggers Layer 2 entropy because the keyword pre-filter sees something). Adjust:
    - If a positive fails: examine whether secretlint or gitleaks catches the shape. The `private-key-pem.txt` is most likely to need surrounding context (private-key rule typically requires the `-----BEGIN` header — make sure it's intact).
    - If a negative fails: check Layer 2 entropy with the shape allowlist. Common cause: the negative value has `secret=` nearby (don't include keywords in negative fixtures!). Verify negative fixture text has NO entropy keywords adjacent.
    - Note: Layer 4 word matching is case-insensitive whole-word. The words-term fixture's `ACME_INTERNAL_CODENAME` must match the words.txt entry exactly (we use the SAME literal).

    Commit as `test(02-06): fixture corpus + end-to-end recall/FP-rate test`.
  </action>
  <verify>
    <automated>
      [ "$(ls tests/fixtures/positive/ | wc -l)" -eq 12 ] &&
      [ "$(ls tests/fixtures/negative/ | wc -l)" -eq 10 ] &&
      test -f tests/fixtures/FIXTURES.md &&
      grep -c "checksum-flip" tests/fixtures/FIXTURES.md &&
      test -f tests/fixtures-corpus.test.ts &&
      grep -c "assertNoCanaryLeak" tests/fixtures-corpus.test.ts &&
      grep -c "runDetection" tests/fixtures-corpus.test.ts &&
      npx vitest run tests/fixtures-corpus.test.ts 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      git log -1 --format=%s | grep -E "^test\(02-06\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - `tests/fixtures/positive/` has exactly 12 .txt files matching the inventory.
    - `tests/fixtures/negative/` has exactly 10 .txt files matching the inventory.
    - `tests/fixtures/FIXTURES.md` exists and documents the checksum-flip discipline (grep `checksum-flip`).
    - `tests/fixtures-corpus.test.ts` imports `runDetection`, `initSessionState`, `assertNoCanaryLeak`.

    Behavior assertions:
    - 12 positive tests pass (recall 100%).
    - 10 negative tests pass (false-positive rate 0%).
    - 1 canary-leak test passes (audit log contains no raw fixture value).
    - Total: 23 tests pass in tests/fixtures-corpus.test.ts.

    Commit assertion:
    - `git log -1 --format=%s` matches `^test\(02-06\)`.
  </acceptance_criteria>
  <done>Corpus established; 100% recall + 0 FP rate proven end-to-end; canary-leak helper confirms audit log discipline.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: doctor --bench stub + tests</name>
  <files>src/doctor/bench.ts, src/doctor/index.ts, src/cli.ts, tests/doctor/bench.test.ts</files>
  <read_first>
    - src/doctor/index.ts (Plan 01-05 + Plan 02-05 — DoctorOpts, computeDoctorReport, runDoctor)
    - src/cli.ts (current doctor subcommand registration — add --bench option)
    - src/detect/index.ts (Plan 02-04 — runDetection signature)
    - src/detect/session-state.ts (Plan 02-02 — initSessionState — for the bench's session bootstrap)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §13 (bench stub spec)
  </read_first>
  <behavior>
    runBenchmark:
    - Default `runsCount = 10`.
    - Builds `FIXTURE_4KB = 'This is a synthetic 4KB test prompt. '.repeat(114).slice(0, 4096)`.
    - Bootstraps `mockSessionState` with empty envBlocklist + empty wordEntries.
    - Calls `runDetection` runsCount times; records `performance.now()` deltas in a `times` array.
    - Returns `{ p50: times.sort()[Math.floor(runs*0.5)], p95: times.sort()[Math.floor(runs*0.95)], runsCount }`.

    CLI:
    - `mrclean doctor --bench` runs `runBenchmark()` and prints the result with picocolors:
      ```
      [bench] runs=10
      [bench] UserPromptSubmit p50=23.4ms p95=78.1ms (target Phase 3: <100ms)
      ```
    - Returns exit 0 regardless of latency.
    - Default `mrclean doctor` (no `--bench`) preserves Plan 01-05 behavior.
    - Document in `--help` text: "Run a performance benchmark (Phase 2 stub; Phase 3 will add the assertion gate)".

    Tests:
    - `runBenchmark({ runsCount: 3 })` returns `{ p50: number, p95: number, runsCount: 3 }` with positive numeric values.
    - p95 >= p50.
    - Bench completes in reasonable time (< 5s wall-clock for runsCount=3) — defensive bound.
    - CLI integration: `spawnSync('node', ['dist/cli.js', 'doctor', '--bench'])` exits 0 and stdout (or stderr) contains `[bench]` markers.
  </behavior>
  <action>
    Step 1 — `src/doctor/bench.ts`:
    - Export `interface BenchmarkResult { p50: number; p95: number; runsCount: number }`.
    - Export `async function runBenchmark(opts: { runsCount?: number } = {}): Promise<BenchmarkResult>` per behavior.
    - Use `performance.now()` (built-in, no import needed in Node 20+).
    - Use a synthetic empty SessionState — no need to touch the filesystem during bench.

    Step 2 — `src/doctor/index.ts`:
    - Add `bench?: boolean` field to `DoctorOpts`.
    - Update `runDoctor(opts)`: if `opts?.bench` → call `runBenchmark()` and print the result via picocolors; exit 0. Else proceed with existing computeDoctorReport + renderReport + exit flow.

    Step 3 — `src/cli.ts`:
    - Update the `doctor` subcommand to accept `--bench` option:
      ```
      .option('--bench', 'Run a performance benchmark stub (Phase 3 will add the assertion gate)', false)
      .action(async (opts: { verbose: boolean; bench: boolean }) => {
        const { runDoctor } = await import('./doctor/index.js')
        await runDoctor({ verbose: opts.verbose, bench: opts.bench })
      })
      ```

    Step 4 — `tests/doctor/bench.test.ts` (~3 tests):
    - Unit: `runBenchmark({ runsCount: 3 })` returns a BenchmarkResult; p50 and p95 are positive numbers; p95 >= p50; runsCount === 3.
    - Integration: `spawnSync('node', ['dist/cli.js', 'doctor', '--bench'])` (after `npm run build`); exit 0; stdout or stderr contains the `[bench]` marker.

    Run `npx vitest run tests/doctor/bench.test.ts` — all pass.

    Commit as `feat(02-06): doctor --bench stub + p50/p95 latency print`.
  </action>
  <verify>
    <automated>
      grep -cE "^export async function runBenchmark|^export interface BenchmarkResult" src/doctor/bench.ts &&
      grep -c "performance.now" src/doctor/bench.ts &&
      grep -c "bench" src/cli.ts &&
      grep -c "runBenchmark" src/doctor/index.ts &&
      npm run build &&
      npx vitest run tests/doctor/bench.test.ts 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      git log -1 --format=%s | grep -E "^feat\(02-06\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - `src/doctor/bench.ts` exports `runBenchmark` and `BenchmarkResult`.
    - `src/cli.ts` registers `--bench` flag for doctor.
    - `src/doctor/index.ts` calls `runBenchmark` when `opts.bench` is truthy.

    Behavior assertions:
    - 3 bench tests pass.
    - `node dist/cli.js doctor --bench` exits 0 and prints `[bench]` markers.
    - Default `mrclean doctor` invocation still produces the Phase 1 6-check report (no regression).

    Commit assertion:
    - `git log -1 --format=%s` matches `^feat\(02-06\)`.
  </acceptance_criteria>
  <done>doctor --bench prints p50/p95 latency over 10 runs of a 4 KB fixture through runDetection; no assertions (Phase 3 owns those); Phase 1 doctor behavior preserved for the no-flag path.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| filesystem fixture → test runtime | Fixture files are checked in; they MUST contain only synthetic (checksum-flipped) values. |
| audit log → canary-leak helper → test assertion | Test writes audit records and then reads them back to assert no raw value leaked. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-06-01 | Information disclosure | A future maintainer commits a REAL secret as a "fixture" | mitigate | FIXTURES.md documents the checksum-flip discipline. The canary-leak test in `tests/fixtures-corpus.test.ts` will not catch a real secret (it asserts no fixture value is in the audit log — but if the fixture IS the real secret, the assertion passes vacuously). Recommended: add a pre-commit hook in Phase 3 that runs gitleaks against `tests/fixtures/` and rejects matches that aren't on a known-checksum-flipped allowlist. Out of scope for this plan. |
| T-02-06-02 | DoS | `runBenchmark` with runsCount=10000 takes forever | accept | CLI accepts the default 10; the user is welcome to time-box themselves. |
| T-02-06-03 | Information disclosure | Bench output prints prompt content (the synthetic 4KB) to stderr | accept | The 4KB fixture is a hardcoded benign string — no secrets. No leak. |
| T-02-06-04 | Tampering | A negative fixture is later modified to include a keyword like `secret=` — Layer 2 entropy fires; test newly fails | accept | Test failure is the correct response. Maintainer fixes the fixture (negative fixtures should NOT contain entropy keywords). |
</threat_model>

<verification>
- All 22 fixture files exist with the correct format header.
- `tests/fixtures/FIXTURES.md` documents provenance + checksum-flip + adding-new-fixture guidance.
- 23 corpus tests pass (12 positive recall + 10 negative FP-rate + 1 canary-leak).
- `node dist/cli.js doctor --bench` exits 0 and prints `[bench]` markers.
- Default `mrclean doctor` invocation still passes (Plan 01-05 + 02-05 behavior preserved).
- No raw fixture value appears in any audit log entry (canary-leak proven).
</verification>

<success_criteria>
- Phase 2 ROADMAP success criterion #4 proven: 100% recall on positive corpus; 0 FP on negative corpus.
- Audit-log redaction discipline proven end-to-end via canary-leak check.
- `mrclean doctor --bench` available as the harness Phase 3 PERF-02 will extend.
- Phase 1 doctor behavior unchanged for the no-flag invocation.
</success_criteria>

<output>
After completion, create `.planning/phases/02-live-redaction-layers-1-4-one-way/02-06-SUMMARY.md` documenting:
- Final fixture counts (positive + negative).
- Corpus test pass-rate evidence.
- Bench numbers from a single representative run (p50/p95) so Phase 3 has a calibration point.
- Any fixtures that needed adjustment vs. RESEARCH §12 to pass detection (e.g., adding `Bearer` keyword context to a high-entropy positive that wasn't caught by shape alone).
</output>
