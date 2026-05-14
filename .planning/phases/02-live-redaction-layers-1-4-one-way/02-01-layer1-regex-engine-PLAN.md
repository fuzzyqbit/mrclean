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
  - src/detect/findings.ts
  - src/detect/layer1-regex/index.ts
  - src/detect/layer1-regex/secretlint-engine.ts
  - src/detect/layer1-regex/gitleaks-adapter.ts
  - src/detect/layer1-regex/gitleaks-engine.ts
  - src/detect/layer1-regex/redos-worker.ts
  - src/detect/layer1-regex/worker-pool.ts
  - src/detect/type-map.ts
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
    - "Each Layer 1 detection emits the locked normalized finding shape `{ ruleId, severity, span, value, redactedHash, fingerprint }`"
    - "A catastrophic-backtracking regex on a known-bad input is terminated within 50 ms via worker_threads.terminate(), and the timeout count is observable"
    - "Worker isolation works in the tsup-built dist/cli.js bundle, not just under tsx"
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
    - path: "src/detect/findings.ts"
      provides: "Finding type + sha256hex/redactedHash/fingerprint helpers"
      exports: ["Finding", "redactedHash", "fingerprint"]
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
---

<objective>
Implement Layer 1 of the detection engine: in-process secret detection via `@secretlint/core` (28-module preset) plus a vendored `gitleaks/config/gitleaks.toml` rule pack adapted to JavaScript regex syntax, with `worker_threads`-based per-pattern timeouts to defend against ReDoS.

Purpose: Satisfies DET1-01..04 — the broad coverage of community-maintained shape patterns, the long-tail gitleaks rule set, the normalized finding shape consumed by all later plans, and the ReDoS-safe execution surface.

Output: A `runLayer1(text, config)` orchestrator that returns `Finding[]`, a build-time vendoring script, an audit document listing skipped gitleaks rules, and integration tests that prove the bundle works (not just dev).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md
@.planning/phases/01-wired-skeleton/01-SKELETON.md
@CLAUDE.md

<interfaces>
Locked finding shape (RESEARCH §1.3 + CONTEXT §Layer 1):
```typescript
export interface Finding {
  ruleId: string                                           // e.g. "AWSSecretAccessKey" or "gitleaks:aws-access-token"
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  span: { start: number; end: number }                     // half-open [start, end) into source text
  value: string                                            // raw matched substring — never logged, hashed immediately
  redactedHash: string                                     // first 16 hex chars of SHA-256(value)
  fingerprint: string                                      // `${ruleId}:${redactedHash}`
  source: 'secretlint' | 'gitleaks' | 'entropy' | 'env' | 'words'   // for downstream dedup + audit
}
```

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
- CRITICAL is reserved for explicit type-map promotion (e.g., `AWSSecretAccessKey` → CRITICAL via type-map.ts).
- gitleaks default severity: HIGH (the rule pack does not encode a severity field).

Type-map (CONTEXT §Placeholder Manager — TYPE vocabulary list):
- `src/detect/type-map.ts` exports `getTypeForRuleId(ruleId: string): string` returning the placeholder TYPE.
- Initial vocabulary union: AWS_KEY, AWS_SECRET, GH_TOKEN, JWT, STRIPE_KEY, OPENAI_KEY, ANTHROPIC_KEY, PRIVATE_KEY, SLACK_TOKEN, GCP_KEY, DATABRICKS_KEY, AZURE_KEY, CF_KEY, ENV (L3), WORD (L4), ENTROPY (L2). Default for unknown gitleaks rule-id: `SECRET`.

Worker pool sizing (RESEARCH OQ-5):
- Researcher confirmed a pool IS needed to meet the 100ms budget; per-regex spawn cost is 2-5ms × ~10-20 keyword-filtered regex executions = 20-100ms in cold path. Default pool size: 4 workers.
- Worker pool exposed via `WorkerPool` class with `runRegex(pattern, flags, text, timeoutMs): Promise<RegexWorkerResult>` and `terminate(): Promise<void>` (called at hook process exit).
- Pool reuses worker instances; on timeout, the bad worker is `terminate()`-ed and replaced.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Vendor gitleaks rule pack + build the JS-compatible adapter + worker scaffold</name>
  <files>scripts/vendor-gitleaks.ts, vendor/gitleaks-rules.toml, vendor/gitleaks-rules.toml.sha256, vendor/SKIPPED_GITLEAKS_RULES.md, src/detect/findings.ts, src/detect/type-map.ts, src/detect/layer1-regex/gitleaks-adapter.ts, src/detect/layer1-regex/redos-worker.ts, src/detect/layer1-regex/worker-pool.ts, tsup.config.ts, package.json, tests/detect/layer1/gitleaks-adapter.test.ts, tests/detect/layer1/redos-worker.test.ts</files>
  <read_first>
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §2 + §3 + §4 (gitleaks shape + smol-toml + ReDoS worker)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md §Layer 1 — Regex Rules
    - tsup.config.ts (current bundler config — extend `entry` to include the vendoring script if needed, and confirm `format: ['esm']`)
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

    Step 2 — `src/detect/findings.ts` (shared by ALL layers in this plan + 02-02 + 02-03):
    - Export the `Finding` interface exactly as specified in the interfaces block above.
    - Export `sha256hex(value: string): string` (full hex digest, used by Plan 02-03 placeholder manager).
    - Export `redactedHash(value: string): string` (first 16 hex chars of SHA-256(value)).
    - Export `fingerprint(ruleId: string, value: string): string` (returns `${ruleId}:${redactedHash(value)}`).
    - Export `dedupBySpan(findings: Finding[]): Finding[]` — when two findings cover overlapping spans, prefer the one with the LARGER span (longest match wins); when spans are identical, prefer the source order `secretlint > gitleaks > entropy > env > words` per CONTEXT §Detection-Layer Ordering. Document the order in a code comment.

    Step 3 — `src/detect/type-map.ts`:
    - Export `getTypeForRuleId(ruleId: string): string` returning the placeholder TYPE from the locked vocabulary list above.
    - The internal map is a constant Object: secretlint messageIds and common gitleaks rule-ids point to the right TYPE. Examples to include:
      - `AWSAccessKeyID` → `AWS_KEY`; `AWSSecretAccessKey` → `AWS_SECRET`
      - `GitHubPersonalAccessToken` / `gitleaks:github-pat` / `gitleaks:github-fine-grained-pat` → `GH_TOKEN`
      - `StripeAccessToken` / `gitleaks:stripe-access-token` → `STRIPE_KEY`
      - `OpenAIAPIKey` → `OPENAI_KEY`; `AnthropicAPIKey` → `ANTHROPIC_KEY`
      - JWT detector → `JWT`; Slack → `SLACK_TOKEN`; Private key PEM → `PRIVATE_KEY`
      - GCP → `GCP_KEY`; Databricks → `DATABRICKS_KEY`; Azure → `AZURE_KEY`; Cloudflare → `CF_KEY`
    - Default fallback for unknown rule-id: `SECRET` (logged to type-map at first use; not an error).

    Step 4 — `src/detect/layer1-regex/gitleaks-adapter.ts`:
    - Export `adaptGitleaksPattern(rawRegex: string): { pattern: string; flags: string } | null` exactly per RESEARCH §2.2.
    - Export `loadGitleaksRules(): CompiledGitleaksRule[]` — lazy-singleton, reads `vendor/gitleaks-rules.toml` via `node:fs.readFileSync` (resolved relative to `import.meta.url`), parses with `smol-toml`, runs every rule through `adaptGitleaksPattern`, attempts `new RegExp(pattern, flags)` inside try/catch. Rules that return `null` from the adapter OR throw on RegExp construction are added to a `skippedRules: { id: string; reason: string }[]` array, then written ONCE per process startup to `vendor/SKIPPED_GITLEAKS_RULES.md` — write-once-and-only-if-different so we don't fight tests; safer: write the markdown file from the vendoring script (Step 1), and `loadGitleaksRules` only LOGS the skipped count to stderr.
    - Decision (planner: write the markdown from the vendoring script so it's deterministic and git-tracked). `vendor/SKIPPED_GITLEAKS_RULES.md` is generated by Step 1 by performing the same compile-test loop at vendoring time. Format: a markdown table with columns `rule_id | reason (named-group / inline-flag / mid-pattern-flag / posix-class / other)`.
    - `CompiledGitleaksRule` shape: `{ id: string; pattern: string; flags: string; keywords: string[]; entropy?: number; allowlists: GitleaksAllowlist[]; globalAllowlist: GitleaksAllowlist }`. The compiled `RegExp` itself is built fresh per-execution inside the worker (per-pattern compilation happens once on startup; we cache the source `pattern + flags` and re-construct inside the worker to avoid serialization issues).
    - Document the expected counts in a comment: "Empirical (RESEARCH §2.2): ~143 adapted + ~79 direct = ~184 usable; ~38 skipped. Actual count printed to stderr at startup."

    Step 5 — `src/detect/layer1-regex/redos-worker.ts`:
    - Export `runRegexInWorker(pattern: string, flags: string, text: string, timeoutMs = 50): Promise<RegexWorkerResult>`.
    - `RegexWorkerResult = { ok: true; matches: { start: number; end: number; value: string }[] } | { ok: false; timedOut: true } | { ok: false; error: string }`.
    - Implementation per RESEARCH §4.2 — inline WORKER_CODE string, `new Worker(WORKER_CODE, { eval: true, workerData: { pattern, flags, text } })`, single-shot. The worker is `terminate()`-ed in the timeout path AND after a successful message — never leaked.
    - Add a SHEBANG-FREE WORKER_CODE that uses `parentPort.postMessage` and `workerData` and does the full match loop inclusive of zero-length-match guard from RESEARCH §4.2.

    Step 6 — `src/detect/layer1-regex/worker-pool.ts`:
    - Per RESEARCH OQ-5: a pool IS needed to hit the 100ms budget. Implement `class WorkerPool { constructor(size: number = 4); runRegex(pattern, flags, text, timeoutMs): Promise<RegexWorkerResult>; async terminate(): Promise<void> }`.
    - Implementation: a fixed pool of `Worker` instances created lazily on first `runRegex` call. Each worker is held in a free-list; `runRegex` grabs a free worker, sends `{ pattern, flags, text }`, awaits the response or timeout. On timeout, `worker.terminate()` is called and the slot is replaced with a fresh worker (since the terminated one is dead). The pool DOES NOT block when all workers are busy — it falls back to single-shot workers (Plan 02-04 may revisit if benchmarks indicate). Document this fall-back in a code comment.
    - Worker code is the SAME WORKER_CODE used by `redos-worker.ts`, but the pool's workers are long-lived and receive multiple regex jobs via `postMessage`. Each pool worker has its own state machine: `idle | running`. The pool emits a `terminate()` method called by `Plan 02-05`'s hook shutdown path (planner: surface this as an exit hook target).
    - Provide both `runRegexInWorker` (single-shot, used by tests) AND `WorkerPool` (used by the engine). The engine prefers the pool when available.

    Step 7 — `tsup.config.ts`:
    - Confirm bundling includes `vendor/` files (probably via `loader` or `publicDir` — verify in the build output). If tsup does not bundle non-JS assets, add a postbuild step in the package.json `build` script: `tsup && node -e \"... copy vendor/ to dist/ ...\"`. Simplest approach: just copy `vendor/gitleaks-rules.toml` into `dist/` after build. Add `"build": "tsup && cp -r vendor dist/"` (or a tsx postbuild script for cross-platform).
    - This ensures the published npm package includes the vendored rules.
    - Update `files` in package.json to include `vendor/` so `npm publish` ships it.

    Step 8 — tests/detect/layer1/gitleaks-adapter.test.ts (~6 tests):
    - `adaptGitleaksPattern('(?i)foo')` → `{ pattern: 'foo', flags: 'i' }`.
    - `adaptGitleaksPattern('(?-i:abc)foo')` → `null`.
    - `adaptGitleaksPattern('(?P<name>foo)')` → `null`.
    - `adaptGitleaksPattern('(?i:foo)bar')` → `null`.
    - `adaptGitleaksPattern('\\b(AKIA[A-Z2-7]{16})\\b')` → `{ pattern: '\\b(AKIA[A-Z2-7]{16})\\b', flags: '' }`.
    - `loadGitleaksRules()` returns >= 150 rules (lower bound — actual is ~184; we set a loose floor to avoid flakiness on upstream rule changes). The first call writes the count to stderr.

    Step 9 — tests/detect/layer1/redos-worker.test.ts (~4 tests):
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
      grep -cE "AWSAccessKeyID|AWS_KEY" src/detect/type-map.ts &&
      grep -cE "^export interface Finding " src/detect/findings.ts &&
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
    - `package.json` contains `"vendor:gitleaks"` npm script and lists `vendor/` in `files`.
    - `src/detect/findings.ts` exports `Finding`, `redactedHash`, `fingerprint`, `sha256hex`, `dedupBySpan` (grep each).
    - `src/detect/type-map.ts` `getTypeForRuleId('AWSAccessKeyID')` returns `'AWS_KEY'` (test in adapter.test.ts asserts this).
    - `src/detect/layer1-regex/redos-worker.ts` imports from `'node:worker_threads'` and exports `runRegexInWorker`.
    - `src/detect/layer1-regex/worker-pool.ts` exports `WorkerPool` with `runRegex` and `terminate` methods.

    Behavior assertions:
    - `npx vitest run tests/detect/layer1/gitleaks-adapter.test.ts tests/detect/layer1/redos-worker.test.ts` — all ~10 tests pass.
    - Catastrophic backtracking pathological test completes in < 200ms wall-clock (proves worker.terminate() actually interrupts).
    - `loadGitleaksRules()` returns >= 150 compiled rules (loose floor — RESEARCH estimates 184).

    Commit assertion:
    - `git log -1 --format=%s` matches `^feat\(02-01\):`.
  </acceptance_criteria>
  <done>Gitleaks vendored + adapter compiles ~184 rules + drops ~38 to a markdown audit log; worker-thread regex runner kills pathological patterns within 50ms; finding shape + type-map exported; tests green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Secretlint engine + gitleaks engine + runLayer1 orchestrator + bundle-aware integration test</name>
  <files>src/detect/layer1-regex/secretlint-engine.ts, src/detect/layer1-regex/gitleaks-engine.ts, src/detect/layer1-regex/index.ts, tests/detect/layer1/secretlint-engine.test.ts, tests/detect/layer1/engine-integration.test.ts, tests/detect/layer1/bundle-worker.test.ts</files>
  <read_first>
    - src/detect/layer1-regex/gitleaks-adapter.ts (Task 1 output — re-use loadGitleaksRules + CompiledGitleaksRule shape)
    - src/detect/layer1-regex/redos-worker.ts, worker-pool.ts (Task 1 output — re-use WorkerPool)
    - src/detect/findings.ts, src/detect/type-map.ts (Task 1)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §1 (secretlint API) + §2.3 + §2.4 (keywords filter + allowlist evaluation)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md §Layer 1
    - src/shared/types.ts (MrcleanConfig from Plan 02-00 — read `entropy`, `secrets_files`, `rules`, `allowlist`)
  </read_first>
  <behavior>
    Test cases the implementation must satisfy:

    secretlint-engine.ts:
    - Given input `"AKIAIOSFODNN7EXAMPLE the_rest_of_prompt"` returns at least one Finding with `source: 'secretlint'` and `span` covering positions [0, 20].
    - Given input `"Lorem ipsum dolor sit amet"` returns `[]` (no findings).
    - Each Finding has correct `ruleId` (= secretlint messageId), `severity` per the mapping (error → HIGH unless promoted by type-map), `redactedHash` (16 hex chars), `fingerprint` (`ruleId:redactedHash`).
    - `runSecretlint` is callable repeatedly without leaks (`for (let i = 0; i < 10; i++) await runSecretlint(text); expect(noLeak).toBe(true)` — assert by tracking allocated object count or simply running the loop and confirming no thrown).

    gitleaks-engine.ts:
    - Given input `"AKIAIOSFODNN7EXAMPLX"` (the checksum-flipped AWS fixture from RESEARCH §12), gitleaks-engine returns at least one Finding with `source: 'gitleaks'` and ruleId `aws-access-token` (or whatever the actual rule id is in the vendored TOML — grep at test time).
    - Keyword pre-filter is correctly applied: a rule with `keywords = ['akia']` must NOT execute against text that lacks 'akia' (case-insensitive). Verified by spying on `WorkerPool.runRegex` call count being < total rule count.
    - A budget-bail-out signal: when `WorkerPool.runRegex` returns `{ ok: false, timedOut: true }` 5 times in a single `runGitleaks` call, the function returns its findings-so-far AND sets an out-param/exposed counter so the orchestrator (in 02-04) can emit the budget-exhausted block. Implementation choice: `runGitleaks(text, config) → Promise<{ findings: Finding[]; timeoutCount: number }>`. Document the contract in JSDoc.

    runLayer1 (src/detect/layer1-regex/index.ts):
    - `runLayer1(text, config) → Promise<{ findings: Finding[]; timeoutCount: number }>`. Calls secretlint-engine and gitleaks-engine in parallel via Promise.all, unions the findings, and runs `dedupBySpan` to drop overlapping spans (secretlint preferred over gitleaks for identical spans — per CONTEXT §Detection-Layer Ordering).
    - Allowlist filtering applied: any finding whose `ruleId` is in `config.allowlist.rules`, or whose `fingerprint` is in `config.allowlist.fingerprints`, OR whose `value` matches any regex in `config.allowlist.regexes`, OR whose `value` is in `config.allowlist.stopwords`, is dropped.
    - Per-rule action override (`config.rules: MrcleanRuleOverride[]`): if a rule's `action === 'off'`, drop all findings with that ruleId. If `action === 'audit'` or `'block'` or `'substitute'`, attach the action to the finding via a new field `Finding.action?: string` (NOT in the locked finding shape — exposed via an extension; planner: extend the Finding type in findings.ts to add `action?: 'block' | 'substitute' | 'audit' | 'off'`).
    - Severity override from `MrcleanRuleOverride.severity` also applied.
    - Export `getRuleCount(): number` returning `secretlintRuleCount + gitleaksRuleCount` (for the Phase 2 banner upgrade in Plan 02-05).

    Bundle-worker integration test:
    - This is the OQ-A3 verification (RESEARCH §1456): worker_threads with `{ eval: true }` may not work in the tsup ESM bundle. Test spawns `node dist/cli.js` after running a hidden "trigger-runLayer1" code path (we add a `--detect-once` test-only flag to the CLI — see Task 3 if scope changes, or simpler: write a tiny shim script `scripts/test-layer1-bundle.ts` that imports from `dist/` and runs runLayer1 once, and spawn that with `spawnSync(node, [scripts/test-layer1-bundle.js, fixture])`).
    - Cleanest approach: after `npm run build`, write a sibling `scripts/test-layer1-bundle.js` (plain JS, no TS) that does `const { runLayer1 } = await import('../dist/cli.js')` — but cli.js is the CLI entry, not the detection module. Alternative: tsup should ALSO bundle `src/detect/layer1-regex/index.ts` to `dist/detect-layer1.js` as a third entry. Add this as a tsup multi-entry, then the bundle test imports from `../dist/detect-layer1.js`.
    - The test asserts: `runLayer1(AWS_FIXTURE_TEXT, DEFAULT_CONFIG)` returns at least one finding, AND a pathological `'a'.repeat(28) + 'b'` input against an injected catastrophic pattern terminates within 200ms (proves worker termination works in the bundled artifact).

    All tests run as part of `npm run test`. The bundle-worker.test.ts runs after `npm run build` (the test uses a `beforeAll` hook that calls `npx tsup` if `dist/detect-layer1.js` is missing — bound on time with a 60s ceiling).
  </behavior>
  <action>
    Step 1 — `src/detect/layer1-regex/secretlint-engine.ts`:
    - Export `async function runSecretlint(text: string): Promise<Finding[]>`.
    - Inside: lazy-import `@secretlint/core` and `@secretlint/secretlint-rule-preset-recommend` (per CLAUDE.md cold-start posture).
    - Build the `lintSource` call with the shape from RESEARCH §1.2 (locked literal in interfaces block above). filePath: `'hook-input.txt'`, ext: `'.txt'`, contentType: `'text'`, maskSecrets: `false`.
    - Map each `result.messages[]` to a `Finding` per RESEARCH §1.3 conversion. Severity mapping: error → HIGH, warning → MEDIUM, info → LOW. Promote to CRITICAL ONLY if `getTypeForRuleId(msg.messageId) === 'AWS_SECRET' || === 'PRIVATE_KEY'` (CONTEXT-locked CRITICAL tier).
    - Set `source: 'secretlint'`, `value: text.slice(start, end)`, `redactedHash: redactedHash(value)`, `fingerprint: fingerprint(messageId, value)`.

    Step 2 — `src/detect/layer1-regex/gitleaks-engine.ts`:
    - Export `async function runGitleaks(text: string, pool: WorkerPool, timeoutMs = 50): Promise<{ findings: Finding[]; timeoutCount: number }>`.
    - Load rules via `loadGitleaksRules()` (lazy-singleton).
    - For each rule: keyword pre-filter (`rule.keywords.some(kw => textLowered.includes(kw))` — `textLowered` is `text.toLowerCase()` computed ONCE outside the loop, NOT per rule). If no keywords, run unconditionally.
    - For each surviving rule, call `pool.runRegex(rule.pattern, rule.flags, text, timeoutMs)`. On `{ ok: true, matches }`, convert each match to a Finding: `ruleId: 'gitleaks:' + rule.id` (planner: namespace gitleaks rule IDs to distinguish from secretlint), severity defaults to HIGH (gitleaks does not encode severity). Apply per-rule allowlists (RESEARCH §2.4): stopword + regex; skip path checks (no file path in hook payload — RESEARCH §2.4 says "skip").
    - Apply global allowlist same way.
    - Apply rule's `entropy` minimum if set: if `shannonEntropy(value) < rule.entropy`, drop the finding. Inline a 10-line shannon function HERE OR re-export from a shared module (recommendation: inline; Plan 02-02 has its own copy in layer2-entropy.ts — the duplication is acceptable per CONTEXT and saves a cross-plan coupling). Add a comment: `// Shannon dup: gitleaks layer mirrors Layer 2's algorithm per CONTEXT §Layer 2`.
    - Track `timeoutCount`: each `{ ok: false, timedOut: true }` from the pool increments it. Continue execution even on timeout (the rule that timed out is skipped, but other rules still run). Return early with current findings + `timeoutCount` only when `timeoutCount >= 5` — this is the CONTEXT-locked detection-budget bail-out.
    - Per-rule allowlist `regexes` are compiled ONCE on first load (cache on the rule object — `rule._compiledAllowlistRegexes`). Do not recompile per call.

    Step 3 — `src/detect/layer1-regex/index.ts`:
    - Export `runLayer1(text: string, config: MrcleanConfig, pool: WorkerPool): Promise<{ findings: Finding[]; timeoutCount: number }>`.
    - Implementation: parallel `Promise.all([runSecretlint(text), runGitleaks(text, pool)])`. Union findings. Apply `dedupBySpan` with the source-precedence order locked in findings.ts.
    - Apply global config.allowlist: drop finding if `config.allowlist.rules.includes(ruleId)` OR `config.allowlist.fingerprints.includes(fingerprint)` OR any regex in `config.allowlist.regexes` matches the value OR any literal in `config.allowlist.stopwords` is found in the value.
    - Apply per-rule overrides from `config.rules`: build a `Map<string, MrcleanRuleOverride>` at function entry, then for each finding look up `map.get(finding.ruleId)`. If `action === 'off'` → drop. Else attach `finding.action = override.action` and override `finding.severity = override.severity`.
    - Return `{ findings, timeoutCount }` (sum of timeoutCount from gitleaks; secretlint does not run regexes through the worker pool so no timeouts there).
    - Export `getRuleCount(): { secretlint: number; gitleaks: number; total: number }` — used by Plan 02-05 banner.

    Step 4 — `src/detect/findings.ts` extension:
    - Extend `Finding` with optional `action?: 'block' | 'substitute' | 'audit' | 'off'`. Document in JSDoc that this is set by `runLayer1` after applying `config.rules` overrides, and defaults to `'block'` for CRITICAL/HIGH, `'substitute'` for MEDIUM, `'audit'` for LOW (Plan 02-04 orchestrator may also normalize). Adjust dedupBySpan to preserve the action field.

    Step 5 — tests:

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

    Step 6 — tsup multi-entry:
    - Update `tsup.config.ts` to add a third entry: `src/detect/layer1-regex/index.ts` → `dist/detect-layer1.js`. tsup multi-entry syntax: `entry: { cli: 'src/cli.ts', mcp: 'src/mcp.ts', 'detect-layer1': 'src/detect/layer1-regex/index.ts' }`. This is purely a test-affordance — production code uses the cli.js entrypoint.

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
      npm run build &&
      test -f dist/detect-layer1.js &&
      npx vitest run tests/detect/layer1/ 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      git log -1 --format=%s | grep -E "^feat\(02-01\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - `src/detect/layer1-regex/secretlint-engine.ts` calls `lintSource` (grep = 1) and lazy-imports `@secretlint/core`.
    - `src/detect/layer1-regex/gitleaks-engine.ts` exports `runGitleaks`, uses `WorkerPool.runRegex`, applies keyword pre-filter, returns `{ findings, timeoutCount }`.
    - `src/detect/layer1-regex/index.ts` exports `runLayer1(text, config, pool)` returning `{ findings: Finding[]; timeoutCount: number }` and `getRuleCount()`.
    - `tsup.config.ts` declares the `detect-layer1` entry.

    Behavior assertions:
    - `npx vitest run tests/detect/layer1/` — all ~11 tests pass.
    - `npm run build` exits 0 and produces `dist/detect-layer1.js`.
    - bundle-worker.test.ts proves runLayer1 works in the bundled artifact AND worker termination works in the bundle.
    - Allowlist by ruleId/fingerprint/regex/stopword all functioning (1 test each).
    - Per-rule overrides (off + audit) functioning (2 tests).

    Commit assertion:
    - `git log -1 --format=%s` matches `^feat\(02-01\)`.
  </acceptance_criteria>
  <done>Layer 1 is fully wired: secretlint + gitleaks both catch real-shape secrets, allowlist filters and per-rule overrides apply, worker pool kills ReDoS patterns, and the bundle-worker integration test proves the system works in `dist/` not just under tsx.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| network→build | `scripts/vendor-gitleaks.ts` fetches a remote TOML at build time. Build-time-only — not at runtime. |
| user-controlled text→worker | Hook input text crosses into a Node Worker for regex execution. Worker is isolated and `terminate()`-able. |
| config→runLayer1 | `MrcleanConfig.rules` and `.allowlist` are operator-controlled; they can disable detection rules. Documented behavior, not a flaw. |

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
</threat_model>

<verification>
- `vendor/gitleaks-rules.toml` exists, is > 3000 lines, and its SHA-256 matches `vendor/gitleaks-rules.toml.sha256`.
- `loadGitleaksRules()` returns >= 150 compiled rules on first call.
- A pathological `'a'.repeat(28) + 'b'` against `^(a+)+$` terminates in < 200ms wall-clock via `WorkerPool.runRegex(..., 50)`.
- `npm run build` produces `dist/cli.js`, `dist/mcp.js`, AND `dist/detect-layer1.js`.
- `runLayer1` against the AWS-shaped fixture returns at least one Finding when called against `dist/detect-layer1.js` (proves bundle works, not just dev).
- `getRuleCount().total` is > 150 (used by banner in Plan 02-05).
</verification>

<success_criteria>
- DET1-01: secretlint preset-recommend integrated; in-process; no shell-out.
- DET1-02: gitleaks rule pack vendored, parsed with smol-toml, ~184 rules adapted to JS regex.
- DET1-03: every Finding emits `{ ruleId, severity, span, value, redactedHash, fingerprint }`.
- DET1-04: per-pattern 50ms timeout via worker_threads, verified by pathological-pattern test in dev AND in the bundled dist.
- Bundle-worker test passes → safe for production distribution.
- Allowlist + per-rule overrides applied per CFG-02 schema (Plan 02-00 extension).
</success_criteria>

<output>
After completion, create `.planning/phases/02-live-redaction-layers-1-4-one-way/02-01-SUMMARY.md` documenting:
- Vendored gitleaks commit SHA and rule count.
- Adapter outcomes (compile-direct / adapt / skipped counts; final usable count).
- Worker pool sizing decision and bundle-worker test result.
- Layer 1 fitness for Plan 02-04's orchestrator integration.
</output>
