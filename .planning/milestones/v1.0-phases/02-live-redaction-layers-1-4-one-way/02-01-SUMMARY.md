---
phase: 02-live-redaction-layers-1-4-one-way
plan: "01"
subsystem: detection, layer1
tags: [detection, regex, secretlint, gitleaks, redos, worker-threads, layer1, vendor]

requires:
  - "02-00: src/detect/findings.ts (canonical Finding interface + helpers — imported)"
  - "02-00: src/detect/type-map.ts (canonical getTypeForRuleId — imported)"
  - "02-00: package.json (smol-toml + @secretlint/* deps already installed)"

provides:
  - "vendor/gitleaks-rules.toml: 222-rule gitleaks pack (183 usable, 39 skipped)"
  - "vendor/gitleaks-rules.toml.sha256: SHA-256 tamper-detection checksum"
  - "vendor/SKIPPED_GITLEAKS_RULES.md: audit document for 39 skipped rules"
  - "scripts/vendor-gitleaks.ts: build-time fetch script (npm run vendor:gitleaks)"
  - "src/detect/layer1-regex/gitleaks-adapter.ts: adaptGitleaksPattern + loadGitleaksRules"
  - "src/detect/layer1-regex/redos-worker.ts: runRegexInWorker (single-shot, 50ms timeout)"
  - "src/detect/layer1-regex/worker-pool.ts: WorkerPool (size 4, lazy init, replace-on-timeout)"
  - "src/detect/layer1-regex/secretlint-engine.ts: runSecretlint (28-module preset)"
  - "src/detect/layer1-regex/gitleaks-engine.ts: runGitleaks (keyword filter, entropy gate)"
  - "src/detect/layer1-regex/index.ts: runLayer1 + getRuleCount (184 total) + __test__runWorker"
  - "tsup.config.ts: detect-layer1 test-only entry + vendor/ copy to dist/"
  - "package.json: vendor:gitleaks script + explicit files[] excluding detect-layer1"

affects:
  - "02-04: imports runLayer1(text, config, pool) from src/detect/layer1-regex/index.js"
  - "02-05: calls getRuleCount() for banner upgrade (returns {secretlint:1, gitleaks:183, total:184})"

tech-stack:
  patterns:
    - "smol-toml parse() for gitleaks TOML (same as config reader)"
    - "worker_threads eval:true for ReDoS-safe regex (RESEARCH §4.2 verified)"
    - "WorkerPool: lazy init, replace-on-timeout pattern"
    - "Keyword pre-filter: textLowered computed once per runGitleaks call"
    - "Shannon entropy inlined (10 lines) in gitleaks-engine.ts per CONTEXT §Layer 2"
    - "secretlint individual rule creators used (not preset wrapper) to pass enableIDScanRule:true"
    - "tsup onSuccess hook copies vendor/ to dist/ for bundled module path resolution"

key-files:
  created:
    - scripts/vendor-gitleaks.ts
    - vendor/gitleaks-rules.toml
    - vendor/gitleaks-rules.toml.sha256
    - vendor/SKIPPED_GITLEAKS_RULES.md
    - src/detect/layer1-regex/gitleaks-adapter.ts
    - src/detect/layer1-regex/redos-worker.ts
    - src/detect/layer1-regex/worker-pool.ts
    - src/detect/layer1-regex/secretlint-engine.ts
    - src/detect/layer1-regex/gitleaks-engine.ts
    - src/detect/layer1-regex/index.ts
    - tests/detect/layer1/gitleaks-adapter.test.ts
    - tests/detect/layer1/redos-worker.test.ts
    - tests/detect/layer1/secretlint-engine.test.ts
    - tests/detect/layer1/engine-integration.test.ts
    - tests/detect/layer1/bundle-worker.test.ts
  modified:
    - tsup.config.ts (detect-layer1 entry + vendor copy)
    - package.json (vendor:gitleaks script + explicit files[])

decisions:
  - "enableIDScanRule:true for AWS rule — secretlint's AWS Access Key ID rule is disabled by default; mrclean enables it because hook payloads may contain real credentials (false positive rate is acceptable given mrclean's security context)"
  - "Individual rule creators used instead of preset wrapper — needed to pass per-rule options (enableIDScanRule) to sub-rules; the preset's create() just calls registerRule() without forwarding options"
  - "vendor/ copied to dist/ via tsup onSuccess — the adapter resolves vendor path relative to import.meta.url; bundled context needs dist/vendor/"
  - "package.json files[] explicitly enumerated — clearest way to exclude dist/detect-layer1* from npm tarball"
  - "WorkerPool slot array cast — TypeScript strict mode requires explicit cast for array element access to avoid TS18048 'possibly undefined'"
  - "Shannon entropy inlined in gitleaks-engine.ts — cross-plan import of Layer 2 would create coupling; 10-line function is acceptable duplication per CONTEXT §Layer 2"

metrics:
  duration: "~14 min"
  started: "2026-05-14T13:52:40Z"
  completed: "2026-05-14T14:07:00Z"
  tasks: 2
  files_created: 15
  files_modified: 2
  tests_added: 27
  tests_total: 220
---

# Phase 2 Plan 01: Layer 1 Regex Engine Summary

**secretlint preset-recommend + vendored gitleaks TOML (183 usable rules) run in-process with worker_threads 50ms per-pattern ReDoS timeout; bundle-worker test proves the system works in dist/detect-layer1.js**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-14T13:52:40Z
- **Completed:** 2026-05-14T14:07:00Z
- **Tasks:** 2
- **Files created:** 15
- **Files modified:** 2
- **Tests added:** 27 (220 total, up from 193)

## TDD Gate Compliance

This plan used TDD only for Task 2 (tdd="true"). Task 1 was type="auto".

| Gate | Phase | Status |
|------|-------|--------|
| RED | Task 2 (engine tests created before impl) | Tests failed as expected — modules not found |
| GREEN | Task 2 (implementation created) | 27 tests pass |

## Vendored Gitleaks Pack

| Attribute | Value |
|-----------|-------|
| Pinned commit SHA | `9febafb621f407ec7fd0d398783fa3a63418f694` |
| Fetch date | 2026-05-14 |
| Total rules in TOML | 222 |
| Direct (no JS changes) | 78 |
| Adapted ((?i) → /i flag) | 105 |
| Skipped (JS-incompatible) | 39 |
| **Total usable** | **183** |
| SHA-256 checksum | `e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf` |
| TOML file lines | 3220 |

## Adapter Outcomes

The `adaptGitleaksPattern` function handles 4 cases:
1. **Direct** (78 rules): No inline flags → use pattern as-is with no flags
2. **Adapted** (105 rules): Leading `(?i)` prefix → strip prefix, add `/i` flag
3. **Skipped at adaptation** (39 rules): Contains `(?-i:)`, `(?P<name>)`, or `(?i:)` mid-pattern → null
4. **Skipped at compilation** (0 rules in practice): `new RegExp()` throws (POSIX classes) → caught by try/catch

## Worker Pool Sizing Decision

Pool size = 4 (default). Rationale from RESEARCH OQ-5:
- Per-worker spawn cost: 2–5ms
- Keyword-filtered hot path: ~5–20 rules actually execute per hook invocation
- Without pool: 5–20 × 2-5ms = 10–100ms of spawn overhead
- With pool of 4: amortized to near-zero for typical prompts
- Fallback: when all 4 workers are busy, single-shot workers used (documented in worker-pool.ts)

## Bundle-Worker Test Result (RESEARCH OQ-A3)

**Verified:** `worker_threads` with `eval: true` works correctly in the tsup ESM bundle.

- `dist/detect-layer1.js` successfully imports and calls `runLayer1`
- `__test__runWorker` exported from the bundle correctly terminates catastrophic patterns within 50ms
- Both tests pass against the compiled artifact, not just under tsx

## npm Publish Surface

**Approach:** Explicit enumeration in `package.json#files`.

The `files` array lists only public surface:
- `dist/cli.js`, `dist/cli.js.map`, `dist/cli.d.ts`
- `dist/mcp.js`, `dist/mcp.js.map`, `dist/mcp.d.ts`
- `vendor/gitleaks-rules.toml`, `vendor/gitleaks-rules.toml.sha256`, `vendor/SKIPPED_GITLEAKS_RULES.md`
- `README.md`, `LICENSE`

`dist/detect-layer1.js` (and `.map`, `.d.ts`) are NOT listed → excluded from tarball.

Verified by: `node -e "const f=require('./package.json').files||[]; process.exit(f.some(p=>/detect-layer1/.test(p))?1:0)"` exits 0.

## Layer 1 Fitness for Plan 02-04

`runLayer1(text, config, pool)` is ready for the Plan 02-04 orchestrator:
- Returns `{ findings: Finding[], timeoutCount: number }`
- `findings` are fully normalized, deduplicated, allowlist-filtered, and override-applied
- `timeoutCount` is propagated for the 5-timeout budget bail-out in Plan 02-04
- `getRuleCount()` returns `{ secretlint: 1, gitleaks: 183, total: 184 }` for the Plan 02-05 banner

## Wave 1 Contract Honored

- `src/detect/findings.ts` — NOT touched (owned by Plan 02-00)
- `src/detect/type-map.ts` — NOT touched (owned by Plan 02-00)
- All 5 canonical functions (`sha256hex`, `redactedHash`, `fingerprint`, `dedupBySpan`, `getTypeForRuleId`) imported, never redefined

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] secretlint AWS Access Key ID not detected with default options**
- **Found during:** Task 2 GREEN implementation
- **Issue:** `@secretlint/secretlint-rule-aws` disables `reportAWSAccessKey` by default (`enableIDScanRule: false`). Only `reportAWSSecretAccessKey` (which requires key=value context) runs. The test fixture `AKIA1234567890123456` was not detected.
- **Fix:** Used individual rule creators from the preset's `rules` export (not the preset wrapper) and passed `{ enableIDScanRule: true }` to the AWS rule. The preset's `create()` method ignores passed options when registering sub-rules, so individual registration is required.
- **Files modified:** `src/detect/layer1-regex/secretlint-engine.ts` (implementation approach changed)
- **Commit:** `b7d96ed` (part of Task 2 commit)

**2. [Rule 3 - Blocking] TypeScript TS18048 error in worker-pool.ts terminate()**
- **Found during:** Task 2 `npm run build`
- **Issue:** TypeScript strict mode reports `'slot' is possibly 'undefined'` for array element access `this.workers[i]` even after null-check, because the array type `Array<PoolWorker | null>` allows `undefined` via unchecked index access.
- **Fix:** Added explicit type assertion `const slot: PoolWorker | null = this.workers[i] as PoolWorker | null`
- **Files modified:** `src/detect/layer1-regex/worker-pool.ts`
- **Commit:** `b7d96ed` (part of Task 2 commit)

**3. [Rule 2 - Enhancement] tsup onSuccess hook for vendor/ copy**
- **Found during:** Task 1 tsup config (build-time asset resolution)
- **Issue:** The gitleaks adapter resolves vendor/ relative to `import.meta.url`. In the bundled `dist/` context, the vendor directory needs to be at `dist/vendor/` for the path resolution to work.
- **Fix:** Added `onSuccess` hook in `tsup.config.ts` that copies `vendor/*.toml`, `vendor/*.sha256`, `vendor/*.md` to `dist/vendor/` after each build.
- **Files modified:** `tsup.config.ts`
- **Commit:** `6dea5a3` (part of Task 1 commit)

## Known Stubs

None — all modules are fully implemented. The `__test__runWorker` export in `index.ts` is an internal test affordance (prefixed to prevent accidental use) but is functionally complete.

## Threat Flags

None beyond the plan's registered threat model. Key threats are mitigated:

| Threat | Status |
|--------|--------|
| T-02-01-01: Tamper with vendor TOML | SHA-256 checksum committed |
| T-02-01-02: ReDoS via gitleaks patterns | 50ms timeout via worker.terminate() |
| T-02-01-06: HTTP fetch for vendor TOML | HTTPS-only, pinned SHA |
| T-02-01-08: detect-layer1 leaks to npm | Explicit files[] exclusion verified |

## Self-Check: PASSED

- [x] `vendor/gitleaks-rules.toml` exists (3220 lines > 3000 minimum)
- [x] `vendor/gitleaks-rules.toml.sha256` exists (64-char hex)
- [x] `vendor/SKIPPED_GITLEAKS_RULES.md` exists with 39-rule table
- [x] `scripts/vendor-gitleaks.ts` contains pinned SHA `9febafb621f407ec7fd0d398783fa3a63418f694`
- [x] `package.json` contains `vendor:gitleaks` npm script
- [x] `package.json#files` does NOT include `detect-layer1*` (grep gate exits 0)
- [x] `src/detect/findings.ts` and `src/detect/type-map.ts` are untouched (Wave 1 owned)
- [x] `src/detect/layer1-regex/gitleaks-adapter.ts` imports from `smol-toml`
- [x] `src/detect/layer1-regex/redos-worker.ts` imports from `node:worker_threads`
- [x] `src/detect/layer1-regex/worker-pool.ts` exports `WorkerPool` with `runRegex` + `terminate`
- [x] `src/detect/layer1-regex/secretlint-engine.ts` imports from `../findings.js` + `../type-map.js`
- [x] `src/detect/layer1-regex/gitleaks-engine.ts` imports from `../findings.js`
- [x] `src/detect/layer1-regex/index.ts` exports `runLayer1` + `getRuleCount` + `__test__runWorker`
- [x] `tsup.config.ts` declares `detect-layer1` entry
- [x] Task 1 commit `6dea5a3` exists in git log
- [x] Task 2 commit `b7d96ed` exists in git log
- [x] `npx vitest run` → 220 passing tests
- [x] `npm run build` → succeeds (dist/cli.js, dist/mcp.js, dist/detect-layer1.js)
- [x] `getRuleCount()` returns `{ secretlint: 1, gitleaks: 183, total: 184 }` (total > 150)

---
*Phase: 02-live-redaction-layers-1-4-one-way*
*Completed: 2026-05-14*
