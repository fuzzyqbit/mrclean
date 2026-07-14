---
phase: 02-live-redaction-layers-1-4-one-way
plan: "01"
type: execute
wave: 2
depends_on: ["00"]
files_modified:
  - vendor/gitleaks-rules.toml
  - vendor/gitleaks-rules.toml.sha256
  - vendor/SKIPPED_GITLEAKS_RULES.md
  - scripts/vendor-gitleaks.ts
  - src/detect/layer1-regex/index.ts
  - src/detect/layer1-regex/secretlint-engine.ts
  - src/detect/layer1-regex/gitleaks-adapter.ts
  - src/detect/layer1-regex/gitleaks-engine.ts
  - src/detect/layer1-regex/redos-worker.ts
  - src/detect/layer1-regex/worker-pool.ts
  - tsup.config.ts
  - package.json
  - tests/detect/layer1/secretlint-engine.test.ts
  - tests/detect/layer1/gitleaks-adapter.test.ts
  - tests/detect/layer1/redos-worker.test.ts
  - tests/detect/layer1/engine-integration.test.ts
  - tests/detect/layer1/bundle-worker.test.ts
autonomous: true
requirements: [DET1-01, DET1-02, DET1-03, DET1-04]
tags: [detection, regex, secretlint, gitleaks, redos, worker-threads, layer1]
must_haves:
  truths:
    - "Layer 1 detects every shape in the positive fixture corpus (AWS, GitHub, Stripe, OpenAI, Anthropic, JWT, Slack) without shelling out to any Go binary"
    - "Gitleaks TOML is vendored at build time and parsed in-process; ~143 rules adapted, ~38 logged-and-skipped at startup"
    - "Each Layer 1 detection emits the locked normalized finding shape from src/detect/findings.ts (Plan 02-00)"
    - "A catastrophic-backtracking regex on a known-bad input is terminated within 50 ms via worker_threads.terminate(), and the timeout count is observable"
    - "Worker isolation works in the tsup-built dist/cli.js bundle, not just under tsx"
    - "The detect-layer1 tsup entry exists for test-affordance only — dist/detect-layer1.js is NOT shipped to npm consumers (excluded from package.json#files)"
  artifacts:
    - path: "vendor/gitleaks-rules.toml"
      provides: "Vendored gitleaks rule pack (pinned commit SHA)"
      min_lines: 3000
    - path: "src/detect/layer1-regex/index.ts"
      provides: "runLayer1(text, config) → Promise<Finding[]>"
      exports: ["runLayer1", "getRuleCount"]
    - path: "src/detect/layer1-regex/secretlint-engine.ts"
      provides: "Secretlint lintSource runner, message→Finding conversion"
      exports: ["runSecretlint"]
    - path: "src/detect/layer1-regex/gitleaks-adapter.ts"
      provides: "TOML rule → JS-compatible {pattern, flags} | null"
      exports: ["adaptGitleaksPattern", "loadGitleaksRules"]
    - path: "src/detect/layer1-regex/redos-worker.ts"
      provides: "runRegexInWorker(pattern, flags, text, timeoutMs)"
      exports: ["runRegexInWorker"]
    - path: "vendor/SKIPPED_GITLEAKS_RULES.md"
      provides: "Auditable list of rule IDs skipped at adapter time + reason"
      contains: "rule-id"
  key_links:
    - from: "src/detect/layer1-regex/gitleaks-engine.ts"
      to: "src/detect/layer1-regex/redos-worker.ts"
      via: "runRegexInWorker for each compiled pattern"
      pattern: "runRegexInWorker"
    - from: "src/detect/layer1-regex/index.ts"
      to: "src/detect/layer1-regex/secretlint-engine.ts AND gitleaks-engine.ts"
      via: "runLayer1 calls both engines and unions findings, deduping spans"
      pattern: "runSecretlint|runGitleaks"
    - from: "scripts/vendor-gitleaks.ts"
      to: "vendor/gitleaks-rules.toml"
      via: "Build-time fetch with SHA-256 checksum"
      pattern: "vendor/gitleaks-rules.toml"
    - from: "src/detect/layer1-regex/secretlint-engine.ts AND gitleaks-engine.ts"
      to: "src/detect/findings.ts AND src/detect/type-map.ts"
      via: "IMPORT canonical Finding + dedupBySpan + redactedHash + fingerprint + getTypeForRuleId from Plan 02-00 modules"
      pattern: "from '../findings'|from '../type-map'"
---

<objective>
Implement Layer 1 of the detection engine: in-process secret detection via `@secretlint/core` (28-module preset) plus a vendored `gitleaks/config/gitleaks.toml` rule pack adapted to JavaScript regex syntax, with `worker_threads`-based per-pattern timeouts to defend against ReDoS.

Purpose: Satisfies DET1-01..04 — the broad coverage of community-maintained shape patterns, the long-tail gitleaks rule set, the normalized finding shape consumed by all later plans, and the ReDoS-safe execution surface.

Output: A `runLayer1(text, config)` orchestrator that returns `Finding[]`, a build-time vendoring script, an audit document listing skipped gitleaks rules, and integration tests that prove the bundle works (not just dev).

**Wave 1 → Wave 2 contract:** This plan IMPORTS `Finding`, `redactedHash`, `fingerprint`, `sha256hex`, `dedupBySpan` from `src/detect/findings.ts` (owned by Plan 02-00). This plan IMPORTS `getTypeForRuleId` from `src/detect/type-map.ts` (also owned by Plan 02-00). Those modules already exist by the time this plan executes (Wave 2 starts after Wave 1 completes). DO NOT create or modify either file.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-00-deps-config-schema-toml-migration-PLAN.md
@.planning/phases/01-wired-skeleton/01-SKELETON.md
@CLAUDE.md

<interfaces>
**OWNED ELSEWHERE (Plan 02-00 — Wave 1; import only, DO NOT CREATE OR MODIFY):**

From `src/detect/findings.ts`:
- `interface Finding { ruleId, severity, span: { start, end }, value, redactedHash, fingerprint, source, action? }`
- `function sha256hex(value: string): string`
- `function redactedHash(value: string): string`  (first 16 hex chars)
- `function fingerprint(ruleId: string, value: string): string`  (`${ruleId}:${redactedHash(value)}`)
- `function dedupBySpan(findings: Finding[]): Finding[]`  (source-precedence + longest-span dedup)

From `src/detect/type-map.ts`:
- `function getTypeForRuleId(ruleId: string): string`  (returns from locked TYPE_VOCABULARY or 'SECRET' fallback)
- `const TYPE_VOCABULARY: readonly string[]`

These exist because Wave 1 (Plan 02-00) ran first. Wave 2 plans import from them. **Do not redefine the Finding interface or the type-map.** If you find yourself wanting a new TYPE entry, revise Plan 02-00 first.

---

Locked secretlint API (RESEARCH §1.2 — verified):
- `import { lintSource } from '@secretlint/core'`
- `import { creator as presetCreator } from '@secretlint/secretlint-rule-preset-recommend'`
- `lintSource({ source: { content, filePath: 'hook-input.txt', ext: '.txt', contentType: 'text' }, options: { config: { rules: [{ id: '...preset...', rule: presetCreator, options: {}, severity: 'error', disabled: false }] }, locale: 'en', maskSecrets: false } })`
- Returns `{ messages: SecretlintMessage[] }` with `{ messageId, ruleId, range: [start, end], severity }`.

Locked gitleaks adapter (RESEARCH §2.2):
```typescript
function adaptGitleaksPattern(rawRegex: string): { pattern: string; flags: string } | null {
  if (rawRegex.includes('(?-i:') || rawRegex.includes('(?P<')) return null;
  if (rawRegex.includes('(?i:')) return null;  // mid-pattern (?i:) — skip
  if (rawRegex.startsWith('(?i)')) return { pattern: rawRegex.slice(4), flags: 'i' };
  return { pattern: rawRegex, flags: '' };
}
```
Empirically: 79 direct + ~105 adapted = ~184 usable; ~38 skipped. POSIX classes `[[:alnum:]]` throw on `new RegExp()` — outer try/catch eats them.

Locked worker pattern (RESEARCH §4.2 — runtime-verified):
- `Worker(WORKER_CODE, { eval: true, workerData: { pattern, flags, text } })`
- `setTimeout(() => w.terminate(), 50)` is the ONLY safe way to interrupt regex execution.
- ESM in tsup bundle is RESEARCH OQ A3 — must be acceptance-tested against `dist/cli.js`.

Severity mapping (RESEARCH §1.3):
- secretlint `error` → HIGH, `warning` → MEDIUM, `info` → LOW.
- CRITICAL is reserved for explicit type-map promotion (e.g., `AWSSecretAccessKey` → CRITICAL via custom check in this engine; the type-map only maps to TYPE strings).
- gitleaks default severity: HIGH (the rule pack does not encode a severity field).

Worker pool sizing (RESEARCH OQ-5):
- Researcher confirmed a pool IS needed to meet the 100ms budget; per-regex spawn cost is 2-5ms × ~10-20 keyword-filtered regex executions = 20-100ms in cold path. Default pool size: 4 workers.
- Worker pool exposed via `WorkerPool` class with `runRegex(pattern, flags, text, timeoutMs): Promise<RegexWorkerResult>` and `terminate(): Promise<void>` (called at hook process exit).
- Pool reuses worker instances; on timeout, the bad worker is `terminate()`-ed and replaced.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Vendor gitleaks rule pack + build the JS-compatible adapter + worker scaffold</name>
  <files>scripts/vendor-gitleaks.ts, vendor/gitleaks-rules.toml, vendor/gitleaks-rules.toml.sha256, vendor/SKIPPED_GITLEAKS_RULES.md, src/detect/layer1-regex/gitleaks-adapter.ts, src/detect/layer1-regex/redos-worker.ts, src/detect/layer1-regex/worker-pool.ts, tsup.config.ts, package.json, tests/detect/layer1/gitleaks-adapter.test.ts, tests/detect/layer1/redos-worker.test.ts</files>
  <read_first>
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §2 + §3 + §4 (gitleaks shape + smol-toml + ReDoS worker)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md §Layer 1 — Regex Rules
    - **src/detect/findings.ts (Plan 02-00 — Finding interface + helpers; this task IMPORTS, does NOT create)**
    - **src/detect/type-map.ts (Plan 02-00 — getTypeForRuleId; this task IMPORTS, does NOT create)**
    - tsup.config.ts (current bundler config — extend `entry` to include the detect-layer1 test-only entry, and confirm `format: ['esm']`)
    - https://raw.githubusercontent.com/gitleaks/gitleaks/master/config/gitleaks.toml (do NOT WebFetch — the vendoring script fetches at build time; for plan purposes assume 222 rules, 3209 lines per RESEARCH)
    - Phase 1 src/cli.ts, src/hook/index.ts to confirm ESM import style + tsup ESM bundling expectations
  </read_first>
  <action>
    Step 1 — `scripts/vendor-gitleaks.ts` (build-time vendoring script):
    - Pin a specific commit SHA of `gitleaks/gitleaks` master (researcher noted the rule pack as of 2026-05-14; planner records "see vendor script" — the script writes the pinned SHA into a header comment of `vendor/gitleaks-rules.toml`).
    - Fetch `https://raw.githubusercontent.com/gitleaks/gitleaks/<PINNED_SHA>/config/gitleaks.toml` using Node 20+ built-in `fetch` (no axios/node-fetch). Validate HTTP 200.
    - Write fetched body to `vendor/gitleaks-rules.toml`. Prepend a small header comment (TOML `#` comments) stating `# vendored from gitleaks/gitleaks@<SHA> on <ISO date>`.
    - Compute SHA-256 of the file body, write hex digest to `vendor/gitleaks-rules.toml.sha256`.
    - Add npm script `"vendor:gitleaks": "tsx scripts/vendor-gitleaks.ts"` to package.json.
    - Run the script once to populate `vendor/`. Verify `vendor/gitleaks-rules.toml` has > 3000 lines and parses with `smol-toml` (smoke check inline in the script).

    Step 2 — `src/detect/layer1-regex/gitleaks-adapter.ts`:
    - Export `adaptGitleaksPattern(rawRegex: string): { pattern: string; flags: string } | null` exactly per RESEARCH §2.2.
    - Export `loadGitleaksRules(): CompiledGitleaksRule[]` — lazy-singleton, reads `vendor/gitleaks-rules.toml` via `node:fs.readFileSync` (resolved relative to `import.meta.url`), parses with `smol-toml`, runs every rule through `adaptGitleaksPattern`, attempts `new RegExp(pattern, flags)` inside try/catch. Rules that return `null` from the adapter OR throw on RegExp construction are added to a `skippedRules: { id: string; reason: string }[]` array. The skipped list is LOGGED ONCE per process startup to stderr (count + path to the markdown audit file). The `vendor/SKIPPED_GITLEAKS_RULES.md` markdown file is generated by the vendoring script (Step 1) at vendor time so it stays deterministic and git-tracked.
    - `CompiledGitleaksRule` shape: `{ id: string; pattern: string; flags: string; keywords: string[]; entropy?: number; allowlists: GitleaksAllowlist[]; globalAllowlist: GitleaksAllowlist }`. The compiled `RegExp` itself is built fresh per-execution inside the worker (per-pattern compilation happens once on startup; we cache the source `pattern + flags` and re-construct inside the worker to avoid serialization issues).
    - Document the expected counts in a comment: "Empirical (RESEARCH §2.2): ~143 adapted + ~79 direct = ~184 usable; ~38 skipped. Actual count printed to stderr at startup."

    Step 3 — `src/detect/layer1-regex/redos-worker.ts`:
    - Export `runRegexInWorker(pattern: string, flags: string, text: string, timeoutMs = 50): Promise<RegexWorkerResult>`.
    - `RegexWorkerResult = { ok: true; matches: { start: number; end: number; value: string }[] } | { ok: false; timedOut: true } | { ok: false; error: string }`.
    - Implementation per RESEARCH §4.2 — inline WORKER_CODE string, `new Worker(WORKER_CODE, { eval: true, workerData: { pattern, flags, text } })`, single-shot. The worker is `terminate()`-ed in the timeout path AND after a successful message — never leaked.
    - Add a SHEBANG-FREE WORKER_CODE that uses `parentPort.postMessage` and `workerData` and does the full match loop inclusive of zero-length-match guard from RESEARCH §4.2.

    Step 4 — `src/detect/layer1-regex/worker-pool.ts`:
    - Per RESEARCH OQ-5: a pool IS needed to hit the 100ms budget. Implement `class WorkerPool { constructor(size: number = 4); runRegex(pattern, flags, text, timeoutMs): Promise<RegexWorkerResult>; async terminate(): Promise<void> }`.
    - Implementation: a fixed pool of `Worker` instances created lazily on first `runRegex` call. Each worker is held in a free-list; `runRegex` grabs a free worker, sends `{ pattern, flags, text }`, awaits the response or timeout. On timeout, `worker.terminate()` is called and the slot is replaced with a fresh worker (since the terminated one is dead). The pool DOES NOT block when all workers are busy — it falls back to single-shot workers (Plan 02-04 may revisit if benchmarks indicate). Document this fall-back in a code comment.
    - Worker code is the SAME WORKER_CODE used by `redos-worker.ts`, but the pool's workers are long-lived and receive multiple regex jobs via `postMessage`. Each pool worker has its own state machine: `idle | running`. The pool emits a `terminate()` method called by `Plan 02-05`'s hook shutdown path (planner: surface this as an exit hook target).
    - Provide both `runRegexInWorker` (single-shot, used by tests) AND `WorkerPool` (used by the engine). The engine prefers the pool when available.

    Step 5 — `tsup.config.ts` (test-affordance entry + npm-publish exclusion):
    - Add a third entry: `src/detect/layer1-regex/index.ts` → `dist/detect-layer1.js`. tsup multi-entry syntax: `entry: { cli: 'src/cli.ts', mcp: 'src/mcp.ts', 'detect-layer1': 'src/detect/layer1-regex/index.ts' }`. This entry exists PURELY so Task 2's bundle-worker integration test can import from a built artifact — it is NOT part of the published API.
    - Confirm bundling includes `vendor/` files (probably via `loader` or `publicDir` — verify in the build output). If tsup does not bundle non-JS assets, add a postbuild step in the package.json `build` script: `tsup && node -e \"... copy vendor/ to dist/ ...\"`. Simplest approach: just copy `vendor/gitleaks-rules.toml` into `dist/` after build. Add `"build": "tsup && cp -r vendor dist/"` (or a tsx postbuild script for cross-platform).

    Step 6 — `package.json` publish surface (CRITICAL — internal modules must NOT leak):
    - Update `package.json#files` array to include `vendor/` so `npm publish` ships the rule pack.
    - Update `package.json#files` to EXPLICITLY exclude `dist/detect-layer1.js` and `dist/detect-layer1.js.map` and `dist/detect-layer1.d.ts` from the published tarball. The cleanest way to do this is to use a glob include + a `.npmignore` entry OR write the `files` array to only enumerate the actual public surface: `["dist/cli.js", "dist/cli.js.map", "dist/cli.d.ts", "dist/mcp.js", "dist/mcp.js.map", "dist/mcp.d.ts", "vendor/gitleaks-rules.toml", "vendor/gitleaks-rules.toml.sha256", "vendor/SKIPPED_GITLEAKS_RULES.md", "bin/", "README.md", "LICENSE"]` (enumerate the public surface explicitly; do NOT include `dist/detect-layer1*`).
    - Alternative if a wildcard is already in place: add a `.npmignore` entry of `dist/detect-layer1*`. Either approach satisfies the acceptance criterion.
    - Document this exclusion in a comment near the `files` field (use a sibling `// "comment_files": "..."` JSON-comment-style key if the existing convention permits, or note it in the SUMMARY).

    Step 7 — tests/detect/layer1/gitleaks-adapter.test.ts (~6 tests):
    - `adaptGitleaksPattern('(?i)foo')` → `{ pattern: 'foo', flags: 'i' }`.
    - `adaptGitleaksPattern('(?-i:abc)foo')` → `null`.
    - `adaptGitleaksPattern('(?P<name>foo)')` → `null`.
    - `adaptGitleaksPattern('(?i:foo)bar')` → `null`.
    - `adaptGitleaksPattern('\\b(AKIA[A-Z2-7]{16})\\b')` → `{ pattern: '\\b(AKIA[A-Z2-7]{16})\\b', flags: '' }`.
    - `loadGitleaksRules()` returns >= 150 rules (lower bound — actual is ~184; we set a loose floor to avoid flakiness on upstream rule changes). The first call writes the count to stderr.

    Step 8 — tests/detect/layer1/redos-worker.test.ts (~4 tests):
    - Match a literal pattern (`/AKIA[A-Z2-7]{16}/g` on text containing `AKIAIOSFODNN7EXAMPLE`) and assert `result.ok === true` and `matches[0].value === 'AKIAIOSFODNN7EXAMPLE'`.
    - Pathological pattern `^(a+)+$` on `'a'.repeat(28) + 'b'` with `timeoutMs = 50` returns `{ ok: false, timedOut: true }` within ~200ms wall-clock.
    - `WorkerPool` of size 2 successfully processes 5 sequential simple regex jobs and returns expected results.
    - `WorkerPool.terminate()` resolves cleanly even with idle workers.
    - DO NOT add the bundle-worker test here — that lives in tests/detect/layer1/bundle-worker.test.ts in Task 2 (after the dist is built).

    Run the test file and confirm all pass. Commit as `feat(02-01): vendor gitleaks rule pack + adapter + ReDoS worker pool`.
  </action>
  <verify>
    <automated>
      test -f vendor/gitleaks-rules.toml &&
      test -f vendor/gitleaks-rules.toml.sha256 &&
      test -f vendor/SKIPPED_GITLEAKS_RULES.md &&
      [ "$(wc -l < vendor/gitleaks-rules.toml)" -gt 3000 ] &&
      grep -c "vendor:gitleaks" package.json &&
      grep -c "from 'smol-toml'" src/detect/layer1-regex/gitleaks-adapter.ts &&
      grep -c "worker_threads" src/detect/layer1-regex/redos-worker.ts &&
      grep -c "WorkerPool" src/detect/layer1-regex/worker-pool.ts &&
      test -f src/detect/findings.ts &&
      test -f src/detect/type-map.ts &&
      npx vitest run tests/detect/layer1/gitleaks-adapter.test.ts tests/detect/layer1/redos-worker.test.ts 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      git log -1 --format=%s | grep -E "^feat\(02-01\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - `vendor/gitleaks-rules.toml` exists and is > 3000 lines (sanity bound for the 3209-line pack).
    - `vendor/gitleaks-rules.toml.sha256` exists with a 64-char hex digest matching `sha256sum vendor/gitleaks-rules.toml`.
    - `vendor/SKIPPED_GITLEAKS_RULES.md` exists with a non-empty markdown table.
    - `scripts/vendor-gitleaks.ts` references a pinned commit SHA (grep for "github.com/gitleaks/gitleaks" followed by a 40-char hex).
    - `package.json` contains `"vendor:gitleaks"` npm script.
    - `package.json#files` lists `vendor/` (or `vendor/gitleaks-rules.toml` + `vendor/gitleaks-rules.toml.sha256` + `vendor/SKIPPED_GITLEAKS_RULES.md` enumerated).
    - **CRITICAL — Wave 1 contract:** `src/detect/findings.ts` and `src/detect/type-map.ts` exist (created by Plan 02-00; this plan does NOT touch them).
    - `src/detect/layer1-regex/redos-worker.ts` imports from `'node:worker_threads'` and exports `runRegexInWorker`.
    - `src/detect/layer1-regex/worker-pool.ts` exports `WorkerPool` with `runRegex` and `terminate` methods.

    Behavior assertions:
    - `npx vitest run tests/detect/layer1/gitleaks-adapter.test.ts tests/detect/layer1/redos-worker.test.ts` — all ~10 tests pass.
    - Catastrophic backtracking pathological test completes in < 200ms wall-clock (proves worker.terminate() actually interrupts).
    - `loadGitleaksRules()` returns >= 150 compiled rules (loose floor — RESEARCH estimates 184).

    Commit assertion:
    - `git log -1 --format=%s` matches `^feat\(02-01\):`.
  </acceptance_criteria>
  <done>Gitleaks vendored + adapter compiles ~184 rules + drops ~38 to a markdown audit log; worker-thread regex runner kills pathological patterns within 50ms; tests green. findings.ts/type-map.ts imported from Plan 02-00, not created here.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Secretlint engine + gitleaks engine + runLayer1 orchestrator + bundle-aware integration test</name>
  <files>src/detect/layer1-regex/secretlint-engine.ts, src/detect/layer1-regex/gitleaks-engine.ts, src/detect/layer1-regex/index.ts, tests/detect/layer1/secretlint-engine.test.ts, tests/detect/layer1/engine-integration.test.ts, tests/detect/layer1/bundle-worker.test.ts</files>
  <read_first>
    - src/detect/layer1-regex/gitleaks-adapter.ts (Task 1 output — re-use loadGitleaksRules + CompiledGitleaksRule shape)
    - src/detect/layer1-regex/redos-worker.ts, worker-pool.ts (Task 1 output — re-use WorkerPool)
    - **src/detect/findings.ts (Plan 02-00 — IMPORT `Finding`, `redactedHash`, `fingerprint`, `dedupBySpan`. DO NOT redefine the Finding interface.)**
    - **src/detect/type-map.ts (Plan 02-00 — IMPORT `getTypeForRuleId`. DO NOT redefine the type-map.)**
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §1 (secretlint API) + §2.3 + §2.4 (keywords filter + allowlist evaluation)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md §Layer 1
    - src/shared/types.ts (MrcleanConfig from Plan 02-00 — read `entropy`, `secrets_files`, `rules`, `allowlist`)
    - package.json#files — confirm `dist/detect-layer1.js` is NOT in the published `files` list
  </read_first>
  <behavior>
    Test cases the implementation must satisfy:

    secretlint-engine.ts:
    - Given input `"AKIAIOSFODNN7EXAMPLE the_rest_of_prompt"` returns at least one Finding with `source: 'secretlint'` and `span` covering positions [0, 20].
    - Given input `"Lorem ipsum dolor sit amet"` returns `[]` (no findings).
    - Each Finding has correct `ruleId` (= secretlint messageId), `severity` per the mapping (error → HIGH unless promoted to CRITICAL for `AWSSecretAccessKey`/`PrivateKey`), `redactedHash` (16 hex chars), `fingerprint` (`ruleId:redactedHash`).
    - `runSecretlint` is callable repeatedly without leaks (`for (let i = 0; i < 10; i++) await runSecretlint(text); expect(noLeak).toBe(true)` — assert by tracking allocated object count or simply running the loop and confirming no thrown).

    gitleaks-engine.ts:
    - Given input `"AKIAIOSFODNN7EXAMPLX"` (the checksum-flipped AWS fixture from RESEARCH §12), gitleaks-engine returns at least one Finding with `source: 'gitleaks'` and ruleId namespaced as `gitleaks:<original-rule-id>` (e.g. `gitleaks:aws-access-token`).
    - Keyword pre-filter is correctly applied: a rule with `keywords = ['akia']` must NOT execute against text that lacks 'akia' (case-insensitive). Verified by spying on `WorkerPool.runRegex` call count being < total rule count.
    - A budget-bail-out signal: when `WorkerPool.runRegex` returns `{ ok: false, timedOut: true }` 5 times in a single `runGitleaks` call, the function returns its findings-so-far AND sets an out-param/exposed counter so the orchestrator (in 02-04) can emit the budget-exhausted block. Implementation choice: `runGitleaks(text, config) → Promise<{ findings: Finding[]; timeoutCount: number }>`. Document the contract in JSDoc.

    runLayer1 (src/detect/layer1-regex/index.ts):
    - `runLayer1(text, config, pool) → Promise<{ findings: Finding[]; timeoutCount: number }>`. Calls secretlint-engine and gitleaks-engine in parallel via Promise.all, unions the findings, and runs `dedupBySpan` (IMPORTED from Plan 02-00) to drop overlapping spans (secretlint preferred over gitleaks for identical spans — per CONTEXT §Detection-Layer Ordering, enforced by 02-00's source-precedence dedup).
    - Allowlist filtering applied: any finding whose `ruleId` is in `config.allowlist.rules`, or whose `fingerprint` is in `config.allowlist.fingerprints`, OR whose `value` matches any regex in `config.allowlist.regexes`, OR whose `value` is in `config.allowlist.stopwords`, is dropped.
    - Per-rule action override (`config.rules: MrcleanRuleOverride[]`): if a rule's `action === 'off'`, drop all findings with that ruleId. If `action === 'audit'` or `'block'` or `'substitute'`, attach the action to the finding via the optional `Finding.action` field (already part of the canonical interface from Plan 02-00).
    - Severity override from `MrcleanRuleOverride.severity` also applied.
    - Export `getRuleCount(): { secretlint: number; gitleaks: number; total: number }` (for the Phase 2 banner upgrade in Plan 02-05).

    Bundle-worker integration test:
    - This is the OQ-A3 verification (RESEARCH §1456): worker_threads with `{ eval: true }` may not work in the tsup ESM bundle. Test imports `runLayer1` from the bundled `dist/detect-layer1.js` (test-only entry from Task 1) and asserts it returns a finding on the AWS fixture AND that pathological-pattern termination still works in the bundled artifact.
    - The `dist/detect-layer1.js` entry is for tests ONLY — it is NOT shipped to npm consumers (excluded via `package.json#files`).

    All tests run as part of `npm run test`. The bundle-worker.test.ts runs after `npm run build` (the test uses a `beforeAll` hook that calls `npx tsup` if `dist/detect-layer1.js` is missing — bound on time with a 60s ceiling).
  </behavior>
  <action>
    Step 1 — `src/detect/layer1-regex/secretlint-engine.ts`:
    - **Imports:** `import type { Finding } from '../findings.js'; import { redactedHash, fingerprint } from '../findings.js'; import { getTypeForRuleId } from '../type-map.js';` (relative path from `src/detect/layer1-regex/` to `src/detect/`).
    - Export `async function runSecretlint(text: string): Promise<Finding[]>`.
    - Inside: lazy-import `@secretlint/core` and `@secretlint/secretlint-rule-preset-recommend` (per CLAUDE.md cold-start posture).
    - Build the `lintSource` call with the shape from RESEARCH §1.2 (locked literal in interfaces block above). filePath: `'hook-input.txt'`, ext: `'.txt'`, contentType: `'text'`, maskSecrets: `false`.
    - Map each `result.messages[]` to a `Finding` per RESEARCH §1.3 conversion. Severity mapping: error → HIGH, warning → MEDIUM, info → LOW. Promote to CRITICAL ONLY if `getTypeForRuleId(msg.messageId) === 'AWS_SECRET' || getTypeForRuleId(msg.messageId) === 'PRIVATE_KEY'` (CONTEXT-locked CRITICAL tier — the type-map serves dual duty as both placeholder TYPE source AND CRITICAL gate).
    - Set `source: 'secretlint'`, `value: text.slice(start, end)`, `redactedHash: redactedHash(value)`, `fingerprint: fingerprint(messageId, value)`.

    Step 2 — `src/detect/layer1-regex/gitleaks-engine.ts`:
    - **Imports:** `import type { Finding } from '../findings.js'; import { redactedHash, fingerprint } from '../findings.js';`
    - Export `async function runGitleaks(text: string, pool: WorkerPool, timeoutMs = 50): Promise<{ findings: Finding[]; timeoutCount: number }>`.
    - Load rules via `loadGitleaksRules()` (lazy-singleton).
    - For each rule: keyword pre-filter (`rule.keywords.some(kw => textLowered.includes(kw))` — `textLowered` is `text.toLowerCase()` computed ONCE outside the loop, NOT per rule). If no keywords, run unconditionally.
    - For each surviving rule, call `pool.runRegex(rule.pattern, rule.flags, text, timeoutMs)`. On `{ ok: true, matches }`, convert each match to a Finding: `ruleId: 'gitleaks:' + rule.id` (namespace gitleaks rule IDs to match the type-map convention from Plan 02-00), severity defaults to HIGH (gitleaks does not encode severity). Apply per-rule allowlists (RESEARCH §2.4): stopword + regex; skip path checks (no file path in hook payload — RESEARCH §2.4 says "skip").
    - Apply global allowlist same way.
    - Apply rule's `entropy` minimum if set: if `shannonEntropy(value) < rule.entropy`, drop the finding. Inline a 10-line shannon function HERE OR re-export from a shared module (recommendation: inline; Plan 02-02 has its own copy in layer2-entropy.ts — the duplication is acceptable per CONTEXT and saves a cross-plan coupling). Add a comment: `// Shannon dup: gitleaks layer mirrors Layer 2's algorithm per CONTEXT §Layer 2`.
    - Track `timeoutCount`: each `{ ok: false, timedOut: true }` from the pool increments it. Continue execution even on timeout (the rule that timed out is skipped, but other rules still run). Return early with current findings + `timeoutCount` only when `timeoutCount >= 5` — this is the CONTEXT-locked detection-budget bail-out.
    - Per-rule allowlist `regexes` are compiled ONCE on first load (cache on the rule object — `rule._compiledAllowlistRegexes`). Do not recompile per call.

    Step 3 — `src/detect/layer1-regex/index.ts`:
    - **Imports:** `import type { Finding } from '../findings.js'; import { dedupBySpan } from '../findings.js';`
    - Export `runLayer1(text: string, config: MrcleanConfig, pool: WorkerPool): Promise<{ findings: Finding[]; timeoutCount: number }>`.
    - Implementation: parallel `Promise.all([runSecretlint(text), runGitleaks(text, pool)])`. Union findings. Apply `dedupBySpan` (from Plan 02-00) — that helper's source-precedence ordering is already locked, so it transparently picks secretlint over gitleaks on identical spans.
    - Apply global config.allowlist: drop finding if `config.allowlist.rules.includes(ruleId)` OR `config.allowlist.fingerprints.includes(fingerprint)` OR any regex in `config.allowlist.regexes` matches the value OR any literal in `config.allowlist.stopwords` is found in the value.
    - Apply per-rule overrides from `config.rules`: build a `Map<string, MrcleanRuleOverride>` at function entry, then for each finding look up `map.get(finding.ruleId)`. If `action === 'off'` → drop. Else attach `finding.action = override.action` and override `finding.severity = override.severity`.
    - Return `{ findings, timeoutCount }` (sum of timeoutCount from gitleaks; secretlint does not run regexes through the worker pool so no timeouts there).
    - Export `getRuleCount(): { secretlint: number; gitleaks: number; total: number }` — used by Plan 02-05 banner.

    Step 4 — tests:

    tests/detect/layer1/secretlint-engine.test.ts (~4 tests):
    - AWS access key fixture (text from RESEARCH §12 — synthesize a value with the AKIA prefix and a deliberately invalid checksum suffix `X`).
    - Negative: Lorem ipsum → 0 findings.
    - Severity mapping: feed an input known to produce a `warning` from secretlint (planner: a low-confidence pattern such as a generic base64 token; if no test exists, mock secretlint via `vi.mock('@secretlint/core', () => ({ lintSource: vi.fn(async () => ({ messages: [{ messageId: 'TestRule', ruleId: '...', range: [0, 5], severity: 'warning' }] })) }))` and assert the resulting Finding has `severity: 'MEDIUM'`).
    - Repeated invocation (10x) does not throw and does not exceed reasonable runtime (loose bound).

    tests/detect/layer1/engine-integration.test.ts (~5 tests):
    - End-to-end: positive AWS fixture → at least one Finding (from either secretlint or gitleaks; we don't pin which engine catches it).
    - Allowlist drop by ruleId: config with `allowlist.rules: ['AWSAccessKeyID']` → AWS access key text returns 0 findings.
    - Allowlist drop by fingerprint: compute fingerprint for the AWS fixture, add to `allowlist.fingerprints`, assert dropped.
    - Per-rule action override: config with `rules: [{ id: 'AWSAccessKeyID', action: 'audit', severity: 'LOW' }]` → AWS fixture produces a Finding with `.severity === 'LOW'` and `.action === 'audit'`.
    - Per-rule `action: 'off'`: config with `rules: [{ id: 'AWSAccessKeyID', action: 'off', severity: 'LOW' }]` → 0 findings.

    tests/detect/layer1/bundle-worker.test.ts (~2 tests):
    - `beforeAll` runs `npm run build` (timeout 60s) if `dist/detect-layer1.js` is missing.
    - Test 1: `await import('../../../dist/detect-layer1.js')`, call exported `runLayer1` with AWS fixture text → at least 1 finding.
    - Test 2: inject a pathological pattern via a test-only export `__test__runWorker(pattern, flags, text, timeoutMs)` from the bundled module; assert it terminates within 200ms with `timedOut: true`. (Planner note: this requires the index.ts to export a test-only helper; mark it with a `__test__` prefix and a `@internal` JSDoc.)

    Run all Layer 1 tests:
    `npx vitest run tests/detect/layer1/` — all pass.
    `npm run build` — succeeds, produces `dist/detect-layer1.js`.
    `npx vitest run tests/detect/layer1/bundle-worker.test.ts` — passes.

    Commit as `feat(02-01): secretlint + gitleaks engines + runLayer1 orchestrator + bundle integration test`.
  </action>
  <verify>
    <automated>
      grep -c "lintSource" src/detect/layer1-regex/secretlint-engine.ts &&
      grep -c "runGitleaks" src/detect/layer1-regex/gitleaks-engine.ts &&
      grep -c "timeoutCount" src/detect/layer1-regex/gitleaks-engine.ts &&
      grep -cE "^export async function runLayer1|^export function getRuleCount" src/detect/layer1-regex/index.ts &&
      grep -c "detect-layer1" tsup.config.ts &&
      grep -cE "from ['\"]\\.\\./findings" src/detect/layer1-regex/secretlint-engine.ts &&
      grep -cE "from ['\"]\\.\\./type-map" src/detect/layer1-regex/secretlint-engine.ts &&
      grep -cE "from ['\"]\\.\\./findings" src/detect/layer1-regex/gitleaks-engine.ts &&
      grep -cE "from ['\"]\\.\\./findings" src/detect/layer1-regex/index.ts &&
      node -e "const f=require('./package.json').files||[]; const leak=f.some(p=>/detect-layer1/.test(p)); process.exit(leak?1:0)" &&
      npm run build &&
      test -f dist/detect-layer1.js &&
      npx vitest run tests/detect/layer1/ 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      git log -1 --format=%s | grep -E "^feat\(02-01\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - `src/detect/layer1-regex/secretlint-engine.ts` calls `lintSource` (grep = 1) and lazy-imports `@secretlint/core`.
    - `src/detect/layer1-regex/secretlint-engine.ts` imports `Finding`, `redactedHash`, `fingerprint` from `../findings` (grep verified).
    - `src/detect/layer1-regex/secretlint-engine.ts` imports `getTypeForRuleId` from `../type-map` (grep verified).
    - `src/detect/layer1-regex/gitleaks-engine.ts` exports `runGitleaks`, uses `WorkerPool.runRegex`, applies keyword pre-filter, returns `{ findings, timeoutCount }`.
    - `src/detect/layer1-regex/gitleaks-engine.ts` imports from `../findings` (grep verified).
    - `src/detect/layer1-regex/index.ts` exports `runLayer1(text, config, pool)` returning `{ findings: Finding[]; timeoutCount: number }` and `getRuleCount()`.
    - `src/detect/layer1-regex/index.ts` imports `dedupBySpan` from `../findings` (Plan 02-00).
    - `tsup.config.ts` declares the `detect-layer1` entry.
    - **CRITICAL — npm publish surface:** `package.json#files` does NOT include `detect-layer1` (verified by `node` script: any entry matching `/detect-layer1/` causes exit 1).
    - `src/detect/findings.ts` and `src/detect/type-map.ts` are NOT in this plan's git diff (Plan 02-00 owns them).

    Behavior assertions:
    - `npx vitest run tests/detect/layer1/` — all ~11 tests pass.
    - `npm run build` exits 0 and produces `dist/detect-layer1.js`.
    - bundle-worker.test.ts proves runLayer1 works in the bundled artifact AND worker termination works in the bundle.
    - Allowlist by ruleId/fingerprint/regex/stopword all functioning (1 test each).
    - Per-rule overrides (off + audit) functioning (2 tests).

    Commit assertion:
    - `git log -1 --format=%s` matches `^feat\(02-01\)`.
  </acceptance_criteria>
  <done>Layer 1 is fully wired against canonical Wave 1 types: secretlint + gitleaks both catch real-shape secrets, allowlist filters and per-rule overrides apply, worker pool kills ReDoS patterns, and the bundle-worker integration test proves the system works in `dist/` not just under tsx. The detect-layer1 bundle entry exists for tests only — excluded from the published npm package.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| network→build | `scripts/vendor-gitleaks.ts` fetches a remote TOML at build time. Build-time-only — not at runtime. |
| user-controlled text→worker | Hook input text crosses into a Node Worker for regex execution. Worker is isolated and `terminate()`-able. |
| config→runLayer1 | `MrcleanConfig.rules` and `.allowlist` are operator-controlled; they can disable detection rules. Documented behavior, not a flaw. |
| internal modules → npm publish | `dist/detect-layer1.js` is a test-only bundle entry. It must NOT be published to npm — `package.json#files` exclusion prevents the leak. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-01-01 | Tampering | `vendor/gitleaks-rules.toml` modified post-vendoring to weaken rules | mitigate | SHA-256 checksum file committed alongside the TOML. Recommend documenting in vendor/README.md the verify-checksum step; OPTIONAL runtime checksum verification deferred (low value for an MIT-licensed open ruleset, high noise). |
| T-02-01-02 | DoS | Adversarial regex pattern from gitleaks TOML triggers catastrophic backtracking on hook input | mitigate | `WorkerPool.runRegex` enforces 50ms per-pattern timeout via `worker.terminate()` (RESEARCH §4.2 — verified). Detection budget bails out at 5 timeouts in a single hook invocation (Plan 02-04 owns the deny path). |
| T-02-01-03 | DoS | The pool itself fills up under concurrent runLayer1 calls, blocking the event loop | mitigate | Pool falls back to single-shot workers when all are busy (documented); for the one-hook-process-per-Claude-Code-session model this is not expected to fire. |
| T-02-01-04 | Information disclosure | A failing regex error message includes the raw secret value from the worker | accept | Worker stringifies errors via `err.message` only; node:worker_threads errors do not include workerData by default. The bundle test confirms no leakage; defense-in-depth would be a JSDoc note. |
| T-02-01-05 | Tampering | A malicious `[[rules]]` override sets `action: 'off'` on `AWSAccessKeyID` for the operator | accept | Per-rule action override is a documented feature (CFG-02). The operator owns the config file. Mitigation: Phase 2 banner (Plan 02-05) reports the active rule count and mode so disabled rules are visible. |
| T-02-01-06 | Spoofing | The vendor script fetches over HTTP (not HTTPS) and gets a hostile rule pack | mitigate | Script uses `https://raw.githubusercontent.com/...` (HTTPS-only); the URL is pinned at a specific commit SHA. Verified by the `grep` in the verification block. |
| T-02-01-07 | Repudiation | The skipped-rule list is silently mutated post-vendoring | accept | `vendor/SKIPPED_GITLEAKS_RULES.md` is git-tracked; rebase diffs are auditable. |
| T-02-01-08 | Information disclosure | `dist/detect-layer1.js` is shipped to npm, exposing internal detection helpers as a public API | mitigate | `package.json#files` explicitly excludes `dist/detect-layer1*`. Acceptance criterion grep verifies absence. |
</threat_model>

<verification>
- `vendor/gitleaks-rules.toml` exists, is > 3000 lines, and its SHA-256 matches `vendor/gitleaks-rules.toml.sha256`.
- `loadGitleaksRules()` returns >= 150 compiled rules on first call.
- A pathological `'a'.repeat(28) + 'b'` against `^(a+)+$` terminates in < 200ms wall-clock via `WorkerPool.runRegex(..., 50)`.
- `npm run build` produces `dist/cli.js`, `dist/mcp.js`, AND `dist/detect-layer1.js`.
- `package.json#files` does NOT list `dist/detect-layer1*` — `npm pack --dry-run` (informational, not in CI gate) confirms the tarball excludes it.
- `runLayer1` against the AWS-shaped fixture returns at least one Finding when called against `dist/detect-layer1.js` (proves bundle works, not just dev).
- `getRuleCount().total` is > 150 (used by banner in Plan 02-05).
- The Wave 1 contract is honored: `src/detect/findings.ts` and `src/detect/type-map.ts` are owned by Plan 02-00, NOT touched here.
</verification>

<success_criteria>
- DET1-01: secretlint preset-recommend integrated; in-process; no shell-out.
- DET1-02: gitleaks rule pack vendored, parsed with smol-toml, ~184 rules adapted to JS regex.
- DET1-03: every Finding emits `{ ruleId, severity, span, value, redactedHash, fingerprint }` using the canonical Finding from Plan 02-00.
- DET1-04: per-pattern 50ms timeout via worker_threads, verified by pathological-pattern test in dev AND in the bundled dist.
- Bundle-worker test passes → safe for production distribution.
- Allowlist + per-rule overrides applied per CFG-02 schema (Plan 02-00 extension).
- `dist/detect-layer1.js` is a TEST-ONLY artifact; it is NOT exposed via the published npm package.
</success_criteria>

<output>
After completion, create `.planning/phases/02-live-redaction-layers-1-4-one-way/02-01-SUMMARY.md` documenting:
- Vendored gitleaks commit SHA and rule count.
- Adapter outcomes (compile-direct / adapt / skipped counts; final usable count).
- Worker pool sizing decision and bundle-worker test result.
- Layer 1 fitness for Plan 02-04's orchestrator integration.
- Confirmation that `dist/detect-layer1.js` is excluded from the npm publish surface (which approach was taken: `package.json#files` enumeration OR `.npmignore` entry).
</output>
