---
phase: 02-live-redaction-layers-1-4-one-way
plan: "06"
type: execute
wave: 5
depends_on: ["04", "05"]
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
  - tests/fixtures-corpus-bundle.test.ts
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
    - "tests/fixtures-corpus.test.ts proves 100% positive recall + 0 false positives end-to-end across the orchestrator (tsx path)"
    - "tests/fixtures-corpus-bundle.test.ts proves at least one positive fixture flows through the BUILT dist/ orchestrator (bundle path) — guards against tsup-bundle regressions of runDetection"
    - "tests/fixtures/FIXTURES.md documents the checksum-flip discipline + source format references for every fixture"
    - "`mrclean doctor --bench` runs Layer 1 + Layer 2 against a 4 KB fixture N times and prints p50/p95 latency to stderr (no assertion gate yet — Phase 3)"
    - "The canary-leak guard is preceded by an audit.jsonl existence + line-count check; a silently-empty audit log cannot trick the canary test into a vacuous pass"
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
      provides: "End-to-end corpus test proving recall + false-positive rate + canary-leak (tsx path)"
      contains: "assertNoCanaryLeak"
    - path: "tests/fixtures-corpus-bundle.test.ts"
      provides: "Single-fixture bundle pass: imports runDetection from dist/, asserts finding (bundle path)"
      contains: "dist/detect-layer1"
    - path: "src/doctor/bench.ts"
      provides: "runBenchmark(opts) returning { p50, p95, runsCount }"
      exports: ["runBenchmark", "BenchmarkResult"]
  key_links:
    - from: "tests/fixtures-corpus.test.ts"
      to: "src/detect/index.ts"
      via: "runDetection against each fixture file (tsx path)"
      pattern: "runDetection"
    - from: "tests/fixtures-corpus.test.ts"
      to: "src/audit/canary-leak.ts"
      via: "assertNoCanaryLeak against the test's audit log output"
      pattern: "assertNoCanaryLeak"
    - from: "tests/fixtures-corpus-bundle.test.ts"
      to: "dist/detect-layer1.js (Plan 02-01 test-only entry)"
      via: "dynamic import of bundled artifact, single positive-fixture pass through runDetection"
      pattern: "dist/detect-layer1"
    - from: "src/doctor/bench.ts"
      to: "src/detect/index.ts"
      via: "runDetection in a timed loop"
      pattern: "runDetection"
---

<objective>
Land the positive + negative test fixture corpus that proves the Phase 2 success criterion #4 (100% recall on positives + 0 false positives on negatives), plus the `mrclean doctor --bench` stub that Phase 3's PERF gate will harden into an assertion.

Add a single bundle-corpus pass that imports `runDetection` from the BUILT artifact (`dist/detect-layer1.js`, Plan 02-01's test-only entry) and runs ONE positive fixture through it. This guards against tsup bundling regressions where the dev (tsx) path works but the published bundle silently breaks. The full corpus runs only via the tsx path — relying on Plan 02-01's bundle-worker integration test for worker-isolation coverage.

Strengthen the canary-leak check with an audit.jsonl existence + line-count precondition. If the audit log fails to write silently, the canary check would pass vacuously on an empty log — the line-count gate prevents that false-negative.

Purpose: Without a corpus the success criterion is unmeasurable. The CI canary-leak test runs against actual fixture-generated audit logs and asserts no raw secret string ever lands in the log.

Output: ~22 fixture files, a corpus-runner test (tsx path), a bundle-corpus test (single fixture through dist/), a doctor benchmark stub, and a FIXTURES.md documenting provenance.
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

Corpus runner test plan (tsx path — tests/fixtures-corpus.test.ts):
- For EACH positive fixture: read the file (strip the `# ` header lines via regex `/^#.*$/gm`), call `runDetection(text, DEFAULT_CONFIG, sessionState, ctx)`, assert `result.findings.length >= 1`.
- For EACH negative fixture: same, assert `result.findings.length === 0`.
- For the dotenv-derived fixture: set up a side-by-side `.env` file in a tmp dir; the sessionState's envBlocklist must be loaded from it.
- For words-term fixture: same with `.mrclean/words.txt`.
- After all positives + negatives run:
  - **Existence + line-count gate (NEW):** assert `audit.jsonl` exists AND has line count >= number of positive fixtures (12). This prevents the canary check from passing vacuously on a silently-empty audit log.
  - Then call `assertNoCanaryLeak(auditLogPath, ALL_FIXTURE_VALUES)` and assert `ok: true`.

Bundle-corpus pass plan (NEW — tests/fixtures-corpus-bundle.test.ts):
- Minimal single-fixture pass: import `runDetection` from `dist/detect-layer1.js` (Plan 02-01's test-only entry), run ONE positive fixture (AWS access key) through it, assert at least 1 finding.
- Rationale (LOCKED): cost-minimal regression guard. Plan 02-01's `bundle-worker.test.ts` already proves the worker_threads isolation works in the bundle; this test adds an end-to-end smoke that runDetection's full orchestrator (Layer 1 → 4 + placeholder + audit) also works in the bundled artifact. Running the FULL corpus through the bundle is not cost-effective — Plan 02-01's bundle test + this single-fixture corpus pass together cover the bundle path.
- The test reuses Plan 02-05's vitest globalSetup (`npm run build` runs once before any integration suite) so the dist/ artifact is present when this test executes. If executed in isolation without the globalSetup, the test should fail fast with a clear "run `npm run build` first" message.

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
  <name>Task 1: Fixture corpus (positive + negative) + FIXTURES.md + end-to-end corpus test (tsx path) + single-fixture bundle pass</name>
  <files>tests/fixtures/positive/aws-access-key.txt, tests/fixtures/positive/aws-secret-key.txt, tests/fixtures/positive/github-pat-classic.txt, tests/fixtures/positive/github-pat-fine-grained.txt, tests/fixtures/positive/jwt.txt, tests/fixtures/positive/stripe-live-key.txt, tests/fixtures/positive/openai-key.txt, tests/fixtures/positive/anthropic-key.txt, tests/fixtures/positive/slack-bot-token.txt, tests/fixtures/positive/private-key-pem.txt, tests/fixtures/positive/dotenv-derived.txt, tests/fixtures/positive/words-term.txt, tests/fixtures/negative/uuid-v4.txt, tests/fixtures/negative/uuid-v7.txt, tests/fixtures/negative/git-sha-40.txt, tests/fixtures/negative/git-sha-7.txt, tests/fixtures/negative/npm-integrity-sha512.txt, tests/fixtures/negative/cargo-lock-hash.txt, tests/fixtures/negative/md5-digest.txt, tests/fixtures/negative/sha256-digest.txt, tests/fixtures/negative/base64-image-header.txt, tests/fixtures/negative/lorem-ipsum.txt, tests/fixtures/FIXTURES.md, tests/fixtures-corpus.test.ts, tests/fixtures-corpus-bundle.test.ts</files>
  <read_first>
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §12 (fixture inventory + checksum-flip discipline)
    - src/detect/index.ts (Plan 02-04 — runDetection signature)
    - src/detect/session-state.ts (Plan 02-02 — initSessionState signature)
    - src/audit/canary-leak.ts (Plan 02-03 — assertNoCanaryLeak)
    - src/config/defaults.ts (Plan 02-00 — DEFAULT_CONFIG)
    - tsup.config.ts (Plan 02-01 — confirm `detect-layer1` entry produces `dist/detect-layer1.js`)
    - tests/hook/integration-detection.globalSetup.ts (Plan 02-05 — the build harness; this plan's bundle test piggybacks on it)
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

    Step 4 — `tests/fixtures-corpus.test.ts` (tsx path — full corpus):
    - `beforeAll`: create a tmp directory; `mkdir -p $tmp/.mrclean`. Inside tmp, create `.env` with `MY_API_KEY=secretvalue12345` and `.mrclean/words.txt` with `ACME_INTERNAL_CODENAME`. Build a `DEFAULT_CONFIG_FOR_TEST = { ...DEFAULT_CONFIG, secrets_files: [] }`. Bootstrap `sessionState = await initSessionState({ sessionId: 'corpus-test', homeDir: tmp, cwd: tmp, config })`.
    - `afterAll`: clean tmp.
    - Helper `function stripHeader(content: string): string` removes `# `-prefixed comment lines and blank leading lines.
    - For each positive fixture: `it('catches ${fixtureName}', async () => { const text = stripHeader(readFileSync(...)); const result = await runDetection(text, config, sessionState, ctx); expect(result.findings.length).toBeGreaterThanOrEqual(1) })`. 12 test cases.
    - For each negative fixture: `it('does not flag ${fixtureName}', async () => { ... expect(result.findings).toEqual([]) })`. 10 test cases.
    - **Final pre-canary gate (NEW — line-count guard):**
      ```typescript
      it('audit log was actually written (line-count guard)', async () => {
        const auditPath = path.join(tmp, '.mrclean', 'audit.jsonl');
        const exists = await fs.stat(auditPath).then(() => true, () => false);
        expect(exists).toBe(true);  // audit.jsonl must exist after the positive fixtures ran
        const content = await fs.readFile(auditPath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        expect(lines.length).toBeGreaterThanOrEqual(12);  // 12 positive fixtures → at least 12 audit records
        // Note: this is a hard floor. Layer-1/2 may emit MORE than 1 record per positive fixture
        // (e.g., when both secretlint and gitleaks catch the same shape; dedupBySpan reduces but
        // does not always eliminate). Use >= 12 as a conservative lower bound.
      });
      ```
    - **Canary-leak test (now follows the line-count gate — runs AFTER the precondition is met):**
      ```typescript
      it('audit log contains no raw fixture values', async () => {
        const auditPath = path.join(tmp, '.mrclean', 'audit.jsonl');
        const canaries = [...ALL_FIXTURE_VALUES];
        const result = await assertNoCanaryLeak(auditPath, canaries);
        expect(result.ok).toBe(true);
        if (!result.ok) console.error('LEAKS:', result.leaked);
      });
      ```

    Step 5 — `tests/fixtures-corpus-bundle.test.ts` (NEW — single-fixture bundle pass):
    ```typescript
    import { describe, it, expect, beforeAll } from 'vitest';
    import path from 'node:path';
    import fs from 'node:fs/promises';
    import { fileURLToPath } from 'node:url';
    import { existsSync } from 'node:fs';

    // Bundle smoke: run ONE positive fixture through dist/detect-layer1.js.
    // The full corpus runs via the tsx path in fixtures-corpus.test.ts.
    // This file's purpose is to guard against tsup-bundle regressions of runDetection.
    //
    // Plan 02-05's vitest globalSetup runs `npm run build` before the integration suite,
    // so dist/detect-layer1.js exists by the time this test runs.

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const distEntry = path.resolve(__dirname, '..', 'dist', 'detect-layer1.js');

    describe('fixture corpus — single-fixture bundle pass', () => {
      beforeAll(() => {
        if (!existsSync(distEntry)) {
          throw new Error(
            `dist/detect-layer1.js missing. Run \`npm run build\` first OR rely on the integration suite's globalSetup. Path: ${distEntry}`
          );
        }
      });

      it('runDetection in the bundled artifact catches the AWS positive fixture', async () => {
        const { runDetection } = await import(distEntry);
        // Build a minimal sessionState + ctx for the bundled call.
        const tmp = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'mrclean-bundle-'));
        await fs.mkdir(path.join(tmp, '.mrclean'), { recursive: true });
        const config = { /* DEFAULT_CONFIG mirror — entropy/secrets_files/rules/allowlist/dry_run defaults */ };
        const sessionState = { sessionId: 'bundle-smoke', envBlocklist: { values: new Set(), meta: new Map() }, wordEntries: [], createdAt: new Date().toISOString() };
        const ctx = { sessionId: 'bundle-smoke', hookEvent: 'UserPromptSubmit', cwd: tmp };

        const fixturePath = path.resolve(__dirname, 'fixtures', 'positive', 'aws-access-key.txt');
        const raw = await fs.readFile(fixturePath, 'utf8');
        const text = raw.replace(/^#.*$/gm, '').trim();

        const result = await runDetection(text, config, sessionState, ctx);
        expect(result.findings.length).toBeGreaterThanOrEqual(1);

        await fs.rm(tmp, { recursive: true, force: true });
      });
    });
    ```

    NOTE: `dist/detect-layer1.js` exports `runLayer1` (Plan 02-01), not necessarily `runDetection`. If the dist entry does NOT re-export `runDetection`, choose one of:
    - **Option A (preferred):** extend Plan 02-01's `tsup.config.ts` to ALSO emit `dist/detect.js` from `src/detect/index.ts`. Document this as a SECOND test-only entry. Apply the same `package.json#files` exclusion as for `detect-layer1` so neither leaks to npm consumers.
    - **Option B (fallback):** import `runLayer1` from `dist/detect-layer1.js` and call it directly in this bundle smoke test, asserting `findings.length >= 1`. This still proves the bundled detect engine works end-to-end; the orchestrator/placeholder/audit pieces are exercised exhaustively via the tsx path in `fixtures-corpus.test.ts`.

    The executor selects Option A if the file budget permits (cheap tsup config change + one acceptance grep). Otherwise Option B. Document the choice in 02-06-SUMMARY.md.

    Step 6 — Run `npx vitest run tests/fixtures-corpus.test.ts tests/fixtures-corpus-bundle.test.ts`. Diagnose any failures (most likely candidates: a positive fixture's value doesn't actually match any rule; a negative fixture coincidentally triggers Layer 2 entropy because the keyword pre-filter sees something). Adjust:
    - If a positive fails: examine whether secretlint or gitleaks catches the shape. The `private-key-pem.txt` is most likely to need surrounding context (private-key rule typically requires the `-----BEGIN` header — make sure it's intact).
    - If a negative fails: check Layer 2 entropy with the shape allowlist. Common cause: the negative value has `secret=` nearby (don't include keywords in negative fixtures!). Verify negative fixture text has NO entropy keywords adjacent.
    - Note: Layer 4 word matching is case-insensitive whole-word. The words-term fixture's `ACME_INTERNAL_CODENAME` must match the words.txt entry exactly (we use the SAME literal).

    Commit as `test(02-06): fixture corpus + end-to-end recall/FP-rate test + bundle smoke + audit line-count guard`.
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
      grep -cE "line-count guard|line-count|toBeGreaterThanOrEqual\\(12" tests/fixtures-corpus.test.ts &&
      test -f tests/fixtures-corpus-bundle.test.ts &&
      grep -cE "dist/detect-layer1|dist/detect" tests/fixtures-corpus-bundle.test.ts &&
      npm run build &&
      npx vitest run tests/fixtures-corpus.test.ts tests/fixtures-corpus-bundle.test.ts 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      git log -1 --format=%s | grep -E "^test\(02-06\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - `tests/fixtures/positive/` has exactly 12 .txt files matching the inventory.
    - `tests/fixtures/negative/` has exactly 10 .txt files matching the inventory.
    - `tests/fixtures/FIXTURES.md` exists and documents the checksum-flip discipline (grep `checksum-flip`).
    - `tests/fixtures-corpus.test.ts` imports `runDetection`, `initSessionState`, `assertNoCanaryLeak`.
    - `tests/fixtures-corpus.test.ts` includes the audit.jsonl existence + line-count guard BEFORE the canary-leak assertion (grep for `toBeGreaterThanOrEqual(12)` or equivalent line-count check).
    - `tests/fixtures-corpus-bundle.test.ts` exists and imports from `dist/detect-layer1.js` (or `dist/detect.js` if Option A taken).

    Behavior assertions:
    - 12 positive tests pass (recall 100%).
    - 10 negative tests pass (false-positive rate 0%).
    - 1 line-count guard test passes (audit.jsonl exists with at least 12 lines).
    - 1 canary-leak test passes (audit log contains no raw fixture value).
    - 1 bundle-corpus test passes (single AWS fixture through dist/ orchestrator returns ≥ 1 finding).
    - Total: at least 25 tests pass across the two corpus files.

    Commit assertion:
    - `git log -1 --format=%s` matches `^test\(02-06\)`.
  </acceptance_criteria>
  <done>Corpus established; 100% recall + 0 FP rate proven end-to-end via tsx path; canary-leak helper confirms audit log discipline; line-count gate prevents the canary check from passing vacuously on a silently-empty audit log; single-fixture bundle pass guards against tsup-bundle regressions of runDetection.</done>
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
| T-02-06-05 | Information disclosure | Audit log writes silently fail (filesystem error, permissions, etc.) → audit.jsonl is empty → canary-leak check passes vacuously → a real leak goes undetected | mitigate | NEW: the line-count guard (assert audit.jsonl exists AND has >= 12 lines) runs BEFORE the canary-leak check. If the audit log failed to write, the line-count guard fails first, surfacing the underlying audit-write failure. |
</threat_model>

<verification>
- All 22 fixture files exist with the correct format header.
- `tests/fixtures/FIXTURES.md` documents provenance + checksum-flip + adding-new-fixture guidance.
- 24+ corpus tests pass on the tsx path (12 positive recall + 10 negative FP-rate + 1 line-count guard + 1 canary-leak).
- 1+ bundle-corpus test passes (single AWS fixture through `dist/` returns >= 1 finding).
- `node dist/cli.js doctor --bench` exits 0 and prints `[bench]` markers.
- Default `mrclean doctor` invocation still passes (Plan 01-05 + 02-05 behavior preserved).
- No raw fixture value appears in any audit log entry (canary-leak proven AFTER the line-count guard confirms the log is non-empty — vacuous-pass mode eliminated).
</verification>

<success_criteria>
- Phase 2 ROADMAP success criterion #4 proven: 100% recall on positive corpus; 0 FP on negative corpus.
- Audit-log redaction discipline proven end-to-end via canary-leak check.
- Audit-log write reliability proven via line-count guard (audit.jsonl exists with >= 12 lines after 12 positive fixtures run through runDetection).
- Bundle-path regression guard in place via single-fixture bundle-corpus test (full corpus stays on the tsx path; bundle path covered by this smoke test + Plan 02-01's bundle-worker test).
- `mrclean doctor --bench` available as the harness Phase 3 PERF-02 will extend.
- Phase 1 doctor behavior unchanged for the no-flag invocation.
</success_criteria>

<output>
After completion, create `.planning/phases/02-live-redaction-layers-1-4-one-way/02-06-SUMMARY.md` documenting:
- Final fixture counts (positive + negative).
- Corpus test pass-rate evidence (tsx path).
- Bundle-corpus pass: which option taken (A — added `dist/detect.js` entry, OR B — used `runLayer1` from `dist/detect-layer1.js` directly).
- Line-count guard threshold (12) and any deviation found in practice (e.g., dedup reduced records below 12 → re-tune).
- Bench numbers from a single representative run (p50/p95) so Phase 3 has a calibration point.
- Any fixtures that needed adjustment vs. RESEARCH §12 to pass detection (e.g., adding `Bearer` keyword context to a high-entropy positive that wasn't caught by shape alone).
</output>
