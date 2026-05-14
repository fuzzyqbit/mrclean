# Phase 3: MCP Tools, Performance Gate, Public Release — Research

**Researched:** 2026-05-14
**Domain:** MCP SDK tool registration, vitest bench, changesets, npm publish, worker_threads supervision, coverage gates, parallel test isolation
**Confidence:** HIGH (most findings verified via Context7 or official docs; critical gaps flagged)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Three tools registered exactly: `mrclean_check` (scan, no audit), `mrclean_redact` (scan + audit-write), `mrclean_status` (read-only status). Phase 1 stubs `sanitize`/`restore`/`audit_query` are DELETED and replaced — no aliases.
- MCP supervisor uses worker_threads (reuses Phase 2 pool primitive).
- Vitest `bench()` with `expect(p95).toBeLessThanOrEqual(...)` inside the callback for PERF gate — see §3 for critical correction.
- Reference machine = GitHub Actions ubuntu-latest 2-core. Local numbers informational only.
- Coverage thresholds: lines 80 / statements 80 / functions 75 / branches 70.
- README 12-section structure (tagline, what it does, install, verify, configure, dirty word list, uninstall, modes, MCP tools, compatibility, non-defenses, license).
- THREAT_MODEL.md: 9 non-defenses enumerated (multimodal OCR, model memorization, operator prompt-injection, adversarial obfuscation, cross-session placeholder map, LLM Layer 5, vendor API enrichment, network-level interception, pre-commit/git scanning).
- npm publish: first release manual + `--provenance`; subsequent automated via changesets PR flow.
- Fix Phase 2 parallel test pollution by per-file `concurrent: false` annotations or vitest config override.
- Post-publish smoke job on fresh ubuntu runner exercising Phase 1+2 success criteria headlessly.

### Claude's Discretion

- Rename Phase 1 stubs to `check`/`redact`/`status` (matches ROADMAP success criterion #1; no aliases).
- MCP supervisor uses worker_threads (reuses Phase 2 pool primitive).
- Vitest `bench()` API with percentile assertion gate.
- Reference machine = GitHub Actions ubuntu-latest 2-core.
- Coverage thresholds: lines 80 / statements 80 / functions 75 / branches 70.
- README structure (12-section outline).
- THREAT_MODEL.md content list (9 non-defenses).
- npm publish flow: first release manual + provenance; subsequent automated via changesets.
- `dist/detect-layer1*` excluded from `package.json#files` (already in Phase 2; Phase 3 tightens).
- Fix Phase 2's parallel test pollution by per-file `concurrent: false` annotations or vitest config override.
- Post-publish smoke job on a fresh ubuntu runner exercising Phase 1+2 success criteria headlessly.

### Deferred Ideas (OUT OF SCOPE)

- Reversible mode / `unredact` — v2 REVMODE.
- Layer 5 LLM classifier — v2 LLM5-01.
- Cross-session deterministic placeholders — v2 POLISH-02.
- Encrypted at-rest persistence — v2 POLISH-03.
- Sidecar daemon — v2 PERF-04.
- Team policy server — out of scope.
- Telemetry/phone-home — explicitly banned.
- Multimodal scanning — out of scope.
- Pre-commit/git-hook integration — gitleaks owns that surface.
</user_constraints>

---

## Summary

Phase 3 closes the gap between "works on maintainer's machine" and "anyone can `npm install -g mrclean`." It has five distinct work tracks: (1) rename + implement the MCP tool surface, (2) add a worker_threads supervisor to the MCP server, (3) wire the CI performance gate, (4) write and ship documentation, and (5) publish to npm with changesets.

**Critical finding — PERF gate implementation:** Vitest's `bench()` API does NOT expose p95 in `TaskResult` (only p50, p75, p99, p995, p999). The locked CONTEXT.md language "expect(p95)" is unimplementable as written. The planner MUST choose a workaround. The recommended approach is a plain `test()` that collects N=50 `performance.now()` deltas, computes the 95th percentile manually from the `samples` array, and asserts it. This is cleaner than `bench()` for assertion-heavy perf gates and avoids the known limitation that vitest bench lifecycle hooks (beforeAll/afterAll) do NOT execute inside bench suites.

**Critical finding — npm name conflict:** The package name `mrclean` is already claimed on npm (published 2022-06-20 by `jackhq`; homepage: `github.com/beautifulnode/mrclean`; description: "A Simple HTML Sanitizer"). npm's dispute policy does not transfer names for abandonment alone — only trademark infringement triggers forced transfer. The operator MUST decide on an alternative name before the publish plan can be finalized.

**Primary recommendation:** Use a `test()` loop with `performance.now()` for the PERF gate; use a scoped npm name (`@mrclean/mrclean` or a rename like `mrclean-claude`) to unblock publishing without a multi-week npm dispute process.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| MCP tool registration (check/redact/status) | MCP Server (long-lived process) | — | Tools are registered against McpServer; requests arrive via stdio transport from Claude Code |
| Tool crash isolation (supervisor) | MCP Server (worker_threads pool) | — | Each tool invocation runs in a worker; supervisor catches uncaught throws before they reach the MCP event loop |
| Performance gate (hook latency) | Test suite (vitest) | CI (GitHub Actions) | Assertions live in test code; enforcement is CI gate that fails the build |
| Coverage threshold enforcement | vitest.config.ts (coverage.thresholds) | CI | Threshold violations fail `vitest run --coverage` |
| Parallel test pollution fix | vitest.config.ts (`projects` + `fileParallelism: false`) | — | Config-level scoping ensures install/doctor/hook integration tests run sequentially |
| npm publish pipeline | GitHub Actions + changesets | npm registry | changesets action creates PR; publish step runs on merge |
| Docs (README, THREAT_MODEL) | Repo root files | — | No build step needed; markdown consumed by npm registry and GitHub |
| Post-publish smoke job | GitHub Actions (separate workflow) | npm registry | Triggered after publish; tests the tarball on a clean runner |

---

## Standard Stack

All versions already installed in `package.json`. Phase 3 adds no new runtime dependencies — only verifies and tightens what exists.

### Core (already installed — verify, don't re-install)

| Library | Installed Version | Purpose | Notes |
|---------|-------------------|---------|-------|
| `@modelcontextprotocol/sdk` | `^1.29.0` | MCP server + tool registration | Import paths: `/server/mcp.js`, `/server/stdio.js`, `/inMemory.js` — all via the `.*` wildcard in SDK v1.29 exports. Verified in Phase 1. |
| `zod` (via `zod/v4`) | `^4.4.3` | Tool input + output schema validation | `z.object()` passed as `inputSchema` and `outputSchema` to `registerTool()`. Import MUST be `from 'zod/v4'`. |
| `vitest` | `^4.1.6` | Test runner + perf test | `bench()` API for comparison; `test()` loop with `performance.now()` for assertion gate |
| `@vitest/coverage-v8` | `^4.1.6` | Coverage with thresholds | `coverage.thresholds` object in `vitest.config.ts` |
| `@changesets/cli` (to be installed) | `^2.x` | Versioning + changelog | `npx changeset init`; `npx changeset add`; `npx changeset version`; `npx changeset publish` |

### New Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@changesets/cli` | `^2.x` | changesets workflow |

**Installation:**
```bash
npm install --save-dev @changesets/cli
```

**Version verification:**
```bash
npm view @changesets/cli version   # 2.29.x as of May 2026
```

---

## Architecture Patterns

### System Architecture Diagram

```
Claude Code session
        |
        | stdio
        v
  mrclean-mcp (long-lived process)
        |
        |-- McpServer.registerTool("mrclean_check")  --|
        |-- McpServer.registerTool("mrclean_redact") --|--> tool call arrives
        |-- McpServer.registerTool("mrclean_status") --|
        |
        v
  MCP supervisor (src/mcp/supervisor.ts)
        |
        | postMessage (structured clone)
        v
  worker_threads Worker (per-call)
        |
        |-- mrclean_check  --> runDetection() --> returns findings[]
        |-- mrclean_redact --> runDetection() --> returns { redacted, findings[] } + writes audit
        |-- mrclean_status --> reads VERSION, config, session state --> returns status object
        |
        | postMessage result back
        v
  supervisor receives result / catches crash
        |
        v
  McpServer returns structuredContent to caller
```

### Recommended Project Structure (Phase 3 additions)

```
src/
├── mcp/
│   ├── server.ts              # UPDATE — register check/redact/status; remove sanitize/restore/audit_query
│   ├── supervisor.ts          # NEW — worker_threads dispatch per tool call
│   ├── tools/
│   │   ├── check.ts           # NEW — replaces sanitize.ts
│   │   ├── redact.ts          # NEW — replaces restore.ts
│   │   └── status.ts          # NEW — replaces audit-query.ts
│   └── lifecycle.ts           # UNCHANGED
tests/
├── mcp/
│   ├── check.test.ts          # NEW (replace sanitize.test.ts)
│   ├── redact.test.ts         # NEW (replace restore.test.ts)
│   ├── status.test.ts         # NEW (replace audit-query.test.ts)
│   ├── supervisor.test.ts     # NEW
│   └── tools-list.test.ts    # UPDATE — assert new names, assert unredact absent
├── perf/
│   ├── user-prompt-submit.bench.test.ts  # NEW
│   ├── post-tool-use.bench.test.ts       # NEW
│   ├── fixtures/
│   │   ├── 4kb-prompt.txt               # NEW (Lorem + 5 secret shapes)
│   │   └── 50kb-tool-output.txt         # NEW (package-lock-style JSON)
│   └── README.md                        # NEW (reference machine pin)
.changeset/
├── config.json                # NEW (changesets init)
.github/
└── workflows/
    ├── ci.yml                 # UPDATE — add coverage threshold step
    ├── perf.yml               # NEW — perf gate on push/PR
    ├── release.yml            # NEW — changesets PR + publish
    └── release-smoke.yml      # NEW — post-publish fresh-runner smoke
README.md                      # REPLACE Phase 1 stub
THREAT_MODEL.md                # NEW
CHANGELOG.md                   # NEW (changesets generates entries)
LICENSE                        # NEW (MIT)
```

### Pattern 1: MCP Tool Registration with Zod Output Schema

The MCP SDK v1.29 `registerTool` accepts an optional `outputSchema` (Zod v4). When present, the SDK validates `structuredContent` against it and surfaces it to callers. The `content[]` array carries human-readable text; `structuredContent` carries machine-readable data.

**Confirmed API from official SDK docs:**
```typescript
// Source: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod/v4'

server.registerTool(
  'mrclean_redact',
  {
    title: 'Redact sensitive data',
    description: 'Replace detected secrets with stable placeholders. Writes to audit log.',
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({
      redacted: z.string(),
      findings: z.array(z.object({
        ruleId: z.string(),
        severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
        placeholder: z.string(),
        redactedHash: z.string(),
        fingerprint: z.string(),
      })),
    }),
    annotations: {
      readOnlyHint: false,   // redact writes audit log
    },
  },
  async ({ text }) => {
    // ... call supervisor → runDetection → return
    return {
      content: [{ type: 'text', text: redacted }],
      structuredContent: { redacted, findings },
    }
  }
)
```

**Annotations available** (informational to UIs, not enforced by SDK):
- `readOnlyHint: true` — mrclean_check and mrclean_status qualify; mrclean_redact does NOT (it writes audit log)
- `idempotentHint: true` — mrclean_check qualifies (pure scan)
- These are hints only; no SDK enforcement. [CITED: https://context7.com/modelcontextprotocol/typescript-sdk/llms.txt]

**Zero-argument tool pattern (`mrclean_status`):** The SDK requires an `inputSchema`. For a zero-arg tool, pass `z.object({})`. An empty Zod object is valid and produces an empty required-input signal.

```typescript
// Source: Context7 MCP SDK docs
server.registerTool(
  'mrclean_status',
  {
    title: 'mrclean status',
    description: 'Returns version, rule counts, mode, session ID, and audit log path.',
    inputSchema: z.object({}),   // zero-arg tool — SDK requires schema even if empty
    outputSchema: z.object({
      version: z.string(),
      rule_count: z.number(),
      allowlist_count: z.number(),
      mode: z.enum(['active', 'dry-run']),
      session_id: z.string().nullable(),
      audit_log_path: z.string(),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => { /* ... */ }
)
```

**Error handling:** Tool errors (thrown exceptions or validation failures) should be caught and returned as `{ content: [...], isError: true }` rather than let bubble to the SDK as unhandled exceptions. The SDK may handle them as protocol errors, which prevents the model from seeing the error content for self-correction. [CITED: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/core/src/types/spec.types.ts]

### Pattern 2: MCP Supervisor via Worker Threads (Reusing Phase 2 Pool Primitive)

The CONTEXT.md decision is to reuse the Phase 2 `WorkerPool` primitive (`src/detect/layer1-regex/worker-pool.ts`) as the MCP supervisor mechanism. However, the architectural pattern differs from the regex pool:

- **Phase 2 pool:** Long-lived persistent workers receive postMessage jobs (pattern+flags+text) and reply. Used for high-frequency ReDoS-safe regex calls within a single detection pass.
- **MCP supervisor:** Each MCP tool call is a heavier, one-shot operation (calls `runDetection` which itself uses the Phase 2 pool). Running this in a worker_threads worker provides crash isolation if tool handler code throws.

**Critical constraint:** `runDetection` uses `import()` of ES modules (`.js` extension paths) and the module-level `WorkerPool` singleton. Workers launched with `eval: true` (inline code string) cannot import ES modules from the project. The correct pattern for the MCP supervisor is either:

1. **Option A — Worker file path (recommended):** Write a worker script at `src/mcp/tool-worker.ts` that imports `runDetection` and receives structured input via `workerData`. The supervisor launches `new Worker(workerFilePath, { workerData: { toolName, text, config, sessionState, ctx } })` using the compiled `dist/mcp/tool-worker.js` path. This supports ES module imports. **Requires tsup to bundle `tool-worker.ts` as a separate entry.**

2. **Option B — Reuse WorkerPool postMessage pattern:** Pass only serializable data (text, config object, session state) via postMessage to a pre-spawned pool worker that has already imported `runDetection` at startup. This matches the Phase 2 pool pattern more closely. The pool worker would be a persistent `dist/mcp/tool-worker.js` file that accepts `{ toolName, text, config, sessionState }` messages and replies with `{ ok: true, result }` or `{ ok: false, error: string }`.

**Recommendation: Option B** — it reuses the existing pool lifecycle pattern (create on first call, postMessage, await reply, timeout+replace on hang) and avoids adding a new tsup entry that complicates the `package.json#files` manifest.

**Worker_threads crash isolation confirmed:** An uncaught exception in a worker does NOT automatically crash the parent. The parent receives an `'error'` event on the worker instance. The supervisor MUST attach `worker.on('error', handler)` to prevent unhandled rejections. [CITED: https://github.com/nodejs/node/issues/43331]

**PostMessage boundary serialization:** All data crossing postMessage must be serializable via the structured clone algorithm. Functions cannot be transferred. `MrcleanConfig` and `SessionState` contain only plain objects/arrays/strings — serializable. `runDetection` returns `DetectionResult` which contains `ResolvedFinding[]` — plain objects — serializable. No functions needed. [ASSUMED: SessionState has no non-serializable fields — verify before implementation]

**Worker startup latency for MCP tools:** The Phase 2 bench shows UserPromptSubmit p95=17.4ms on dev machine. Worker threads add 2-5ms for postMessage round-trip on an already-spawned worker. This is within the MCP tool call responsiveness budget (MCP tool calls are NOT on the hook's 100ms/200ms budget from PERF-01 — those budgets cover only the hook process path). MCP tool latency matters for user experience but not for the formal PERF gate.

### Pattern 3: Performance Gate — Critical API Correction

**The locked CONTEXT.md assumption is wrong:** Vitest's `bench()` `TaskResult` does NOT have a `p95` field. Available percentile fields are: `p50`, `p75`, `p99`, `p995`, `p999`. [VERIFIED: https://vitest.dev/api/#bench — TaskResult interface]

Additionally, vitest bench **lifecycle hooks (beforeAll/afterAll) do NOT execute** inside bench suites — confirmed by a vitest maintainer in Discussion #5023. The `bench()` function returns `void` with no way to access results in an afterAll callback.

**Recommended workaround: use `test()` with `performance.now()` directly.**

This is the only reliable pattern for asserting latency percentiles in vitest:

```typescript
// Source: derived from vitest docs + Phase 2 bench.ts pattern (which already uses this approach)
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runDetection } from '../../src/detect/index.js'
// ... load config + sessionState

const FIXTURE_4KB = readFileSync(resolve(__dirname, 'fixtures/4kb-prompt.txt'), 'utf8')
const N = 50

function computeP95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.ceil(0.95 * sorted.length) - 1
  return sorted[Math.max(0, idx)]!
}

test('UserPromptSubmit p95 <= 100ms on 4KB prompt', async () => {
  // Warmup: run 5 times before measuring (JIT + module load)
  for (let i = 0; i < 5; i++) {
    await runDetection(FIXTURE_4KB, config, sessionState, ctx)
  }

  const samples: number[] = []
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    await runDetection(FIXTURE_4KB, config, sessionState, ctx)
    samples.push(performance.now() - t0)
  }

  const p95 = computeP95(samples)
  // Document the measured value in test output for debugging
  console.log(`UserPromptSubmit p95: ${p95.toFixed(2)}ms`)
  expect(p95).toBeLessThanOrEqual(100)
}, { timeout: 60_000 })  // 50 iterations × ~20ms each = ~1s; 60s is safe
```

This pattern is validated by Phase 2's `src/doctor/bench.ts` which already uses `performance.now()` + sorted percentile computation for the `doctor --bench` stub (Plan 02-06). The Phase 3 perf gate is just a CI-gated version of that existing pattern with `expect()` assertions added.

**File naming convention:** Files should live in `tests/perf/` and end in `.bench.test.ts` so they match `vitest.config.ts`'s `include: ['tests/**/*.test.ts']` glob. This keeps them in the normal test run. Phase 3 also adds a SEPARATE `perf.yml` GitHub Actions job that runs only this subdirectory.

**If `bench()` is still desired for comparison output** (non-assertion display), it can coexist: run `bench()` blocks for visual comparison in `vitest bench` mode, and `test()` blocks for the assertion gate. They can live in the same file or separate files.

### Pattern 4: Changesets Workflow (Single-Package Repo)

Changesets works the same way for single-package repos as monorepos — the package selection step in `changeset add` will just have one option.

**Bootstrap (one-time, Wave 0):**
```bash
npx @changesets/cli init
# Creates: .changeset/config.json + .changeset/README.md
```

`.changeset/config.json` for a single-package npm-published repo:
```json
{
  "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

**Per-PR contributor flow:**
```bash
npx changeset add
# Prompts: which package (only "mrclean"), semver bump (major/minor/patch), summary
# Produces: .changeset/<slug>.md containing the bump + summary
```

**Version bump + CHANGELOG generation (done by changesets action or manually):**
```bash
npx changeset version
# Consumes .changeset/*.md, bumps package.json version, writes CHANGELOG.md entries
# Deletes consumed .changeset/*.md files
```

**GitHub Actions release workflow (canonical pattern):**
```yaml
# Source: https://github.com/changesets/action/blob/main/README.md
name: Release
on:
  push:
    branches: [main]
concurrency: ${{ github.workflow }}-${{ github.ref }}
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      id-token: write      # Required for npm --provenance
      contents: write      # Required for changesets to create PRs
      pull-requests: write # Required for changesets to create PRs
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - name: Create Release Pull Request or Publish
        id: changesets
        uses: changesets/action@v1
        with:
          publish: npm run release   # must build + changeset publish --provenance
          commit: "chore: version packages"
          title: "chore: version packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

The `release` npm script in `package.json`:
```json
{
  "scripts": {
    "release": "npm run build && changeset publish --provenance"
  }
}
```

**changesets/action behavior:**
- If `.changeset/*.md` files exist: creates (or updates) a "Version Packages" PR that bumps version + updates CHANGELOG.
- If no changesets exist (already merged): runs the `publish` script and publishes to npm.
- The `outputs.published` output is `'true'` when packages were published (useful for downstream steps like triggering a smoke job). [CITED: https://github.com/changesets/action/blob/main/README.md]

### Pattern 5: npm Provenance

**Requirements:**
- npm `>=9.5.0` (Node 20 ships with npm 10.x — already met)
- GitHub-hosted runner (not self-hosted)
- Workflow permission `id-token: write`
- Command: `npm publish --provenance --access public`

**What it does:** Generates a Sigstore attestation linking the published tarball to the specific GitHub Actions run that produced it. The attestation is logged to a public transparency ledger and surfaced in `npm view <pkg> --json` as `"provenance"`. Users can verify with `npm audit signatures <pkg>`. [CITED: https://docs.npmjs.com/generating-provenance-statements]

**First-publish (1.0.0 manually):** The maintainer must `npm login` locally and run `npm publish --provenance --access public`. Local publishes DO generate provenance only when running in a CI environment (GitHub Actions). For local publishes, omit `--provenance` on the first publish, then let changesets action handle provenance for all subsequent versions. [ASSUMED — verify whether npm 10 supports local provenance; likely not]

### Pattern 6: Parallel Test Isolation Fix

**Root cause (confirmed by test runs):** `tests/doctor/end-to-end.test.ts` passes in isolation (9/9) but fails (1/1) in the full suite. The failure is: `expected 4 to be 0` on `exitCode`. The doctor test calls `computeDoctorReport` with a temp homeDir, which reads `dist/cli.js` and `dist/mcp.js`. When `integration-detection.globalSetup.ts` runs `npm run build` (which calls `tsup --clean`), it deletes `dist/` mid-run and causes the doctor checks to fail.

**Correct fix (vitest 4.x):** Use the `projects` API to run affected test files in a sequential project:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'parallel',
          include: ['tests/**/*.test.ts'],
          exclude: [
            'tests/install/**',
            'tests/doctor/end-to-end.test.ts',
            'tests/hook/integration-detection.test.ts',
            'tests/hook/integration.test.ts',
          ],
          environment: 'node',
          testTimeout: 30_000,
          globalSetup: ['./tests/hook/integration-detection.globalSetup.ts'],
          coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['src/**/*.ts'],
            thresholds: {
              lines: 80,
              statements: 80,
              functions: 75,
              branches: 70,
            },
          },
        },
      },
      {
        test: {
          name: 'sequential',
          include: [
            'tests/install/**/*.test.ts',
            'tests/doctor/end-to-end.test.ts',
            'tests/hook/integration-detection.test.ts',
            'tests/hook/integration.test.ts',
          ],
          fileParallelism: false,   // sequential execution
          environment: 'node',
          testTimeout: 30_000,
        },
      },
    ],
  },
})
```

[CITED: https://vitest.dev/guide/recipes — parallel and sequential projects pattern]

**Alternative simpler fix:** Set `fileParallelism: false` globally. This makes ALL tests sequential — slower but zero risk of cross-file state pollution. Viable since the current suite runs in ~20s; even 3x slower is acceptable. [CITED: https://vitest.dev/guide/improving-performance]

**Recommended:** Use the `projects` split. The `globalSetup` build should move to the sequential project (since integration-detection tests need a fresh build, and the doctor tests must not run concurrently with it).

### Pattern 7: @vitest/coverage-v8 Threshold Configuration

The existing `vitest.config.ts` has `coverage.provider: 'v8'` and `coverage.include: ['src/**/*.ts']`. Phase 3 adds thresholds. When a threshold is violated, `vitest run --coverage` exits with a non-zero code:

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov'],
  include: ['src/**/*.ts'],
  exclude: [
    'src/**/*.d.ts',
    'src/mcp/tools/sanitize.ts',   // deleted in Phase 3
    'src/mcp/tools/restore.ts',    // deleted in Phase 3
    'src/mcp/tools/audit-query.ts', // deleted in Phase 3
  ],
  thresholds: {
    lines: 80,
    statements: 80,
    functions: 75,
    branches: 70,
  },
},
```

Threshold behavior: failing ANY threshold causes the run to exit non-zero. All four can be set independently. [CITED: https://context7.com/vitest-dev/vitest/llms.txt — coverage configuration]

**Coverage exclude patterns for vendored/generated code:**
- `v8 ignore start` / `v8 ignore stop` comments to exclude unreachable branches (OVF path, emergency exits) from V8 coverage.
- [CITED: https://github.com/vitest-dev/vitest/blob/main/docs/blog/vitest-4-1.md]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Percentile computation | Custom stats lib | Inline `samples.sort() + Math.ceil(0.95 * N)` | 10-line function; no dep needed |
| Bench assertions | External perf framework | `test()` + `performance.now()` loop | vitest bench lacks assertion hooks and p95 field |
| Regex version comparison | Semver logic | Node `process.version` comparison | Already proven in Phase 1 doctor |
| CHANGELOG | Hand-authored entries | changesets (auto-generates from .changeset/*.md) | Consistent format, PR-linked summaries |
| npm publish workflow | Custom release scripts | `changesets/action@v1` | Handles PR creation, version bump, publish atomically |
| Tool crash isolation | try/catch in tool handler | worker_threads + `worker.on('error', ...)` | Supervisor catches EVEN uncaught throws that bypass try/catch (e.g., in async callbacks) |
| structuredContent shape | Ad-hoc JSON | Zod `outputSchema` registered with SDK | SDK validates shape; callers get typed structured output |

**Key insight:** The MCP SDK's `outputSchema` + `structuredContent` pattern is the only way to expose typed structured data to Claude Code's `mcp__mrclean__*` tool invocations. Without `outputSchema`, callers only get `content[0].text` as a string.

---

## Common Pitfalls

### Pitfall 1: Assuming vitest bench has p95 or working lifecycle hooks

**What goes wrong:** Developer writes `bench()` and tries to assert on `p95` (does not exist) or uses `afterAll` to access results (hooks do not fire in bench suites).
**Why it happens:** Documentation for bench is sparse; the `TaskResult` interface omits p95 despite tinybench supporting it internally.
**How to avoid:** Use `test()` + `performance.now()` loop with manual percentile calculation (see §Pattern 3 above).
**Warning signs:** TypeScript type error `Property 'p95' does not exist on type 'TaskResult'`.

### Pitfall 2: npm name `mrclean` is taken

**What goes wrong:** `npm publish` returns 403 "You do not have permission to publish mrclean."
**Why it happens:** The name `mrclean` was registered in 2012 and last published 2022-06-20 by `jackhq` (A Simple HTML Sanitizer). npm will not transfer it without trademark proof.
**How to avoid:** Choose an alternative name BEFORE writing the publish plan. Options: (a) `@<user-or-org>/mrclean` (scoped — free, requires npm org creation or personal scope); (b) `mrclean-claude`; (c) `claude-sanitizer`. The `@mrclean/mrclean` and similar alternatives are available (verified: `npm view @mrclean/mrclean` → 404).
**Warning signs:** `npm view mrclean` exits 0 (name exists). [VERIFIED: npm view mrclean — published 2022-06-20, proprietary, beautifulnode/mrclean]

### Pitfall 3: Worker_threads with ES module imports in eval workers

**What goes wrong:** `new Worker(inlineCode, { eval: true })` cannot `import()` ES modules — the inline code runs in a CJS context without a module specifier.
**Why it happens:** The Phase 2 pool uses `eval: true` for simple regex workers (pure CJS, no imports). The MCP supervisor needs to call `runDetection` which is ES module-only.
**How to avoid:** Use a compiled worker file path (`dist/mcp/tool-worker.js`) rather than inline eval code. Alternatively, use the postMessage-based pool pattern where the worker is pre-initialized with its imports.
**Warning signs:** `ERR_REQUIRE_ESM` or `Cannot use import statement` in worker stderr.

### Pitfall 4: globalSetup build deletes dist/ during parallel test runs

**What goes wrong:** `tests/hook/integration-detection.globalSetup.ts` runs `npm run build` which calls `tsup --clean`, deleting `dist/`. Tests that reference `dist/cli.js` concurrently (doctor end-to-end, install idempotency, hook integration) then fail with ENOENT.
**Why it happens:** vitest runs test files concurrently by default across worker threads; the globalSetup runs before tests but the build can still race with other tests that start before it finishes.
**How to avoid:** Move the globalSetup to the `sequential` project (where integration tests already live). This ensures the build completes before any sequential test that depends on dist/ starts.
**Warning signs:** `ENOENT: no such file or directory, dist/cli.js` in test output.

### Pitfall 5: `--provenance` requires GitHub Actions; local publish won't attest

**What goes wrong:** Maintainer runs `npm publish --provenance` locally and gets an error about missing OIDC token.
**Why it happens:** Sigstore provenance requires a GitHub Actions OIDC token which is only available in CI.
**How to avoid:** For the first manual 1.0.0 publish, omit `--provenance`. All subsequent versions use the changesets action which runs in GitHub Actions and CAN use provenance.
**Warning signs:** Error `OIDC token not available` or similar.

### Pitfall 6: changesets action needs NPM_TOKEN AND `NODE_AUTH_TOKEN`

**What goes wrong:** changesets action fails at npm publish step with 403 even though NPM_TOKEN secret is set.
**Why it happens:** `actions/setup-node` with `registry-url` uses `NODE_AUTH_TOKEN` env var (not `NPM_TOKEN`) to authenticate. Both need to be set.
**How to avoid:** Set both in the `env:` block of the changesets action step. [CITED: changesets/action README]

### Pitfall 7: bench test timeout too short for 50 iterations

**What goes wrong:** Perf test times out with default vitest timeout (5s or even 30s).
**Why it happens:** 50 iterations × ~20ms each = ~1s on dev machine, but GitHub Actions runners can be 3-5x slower, plus JVM warmup.
**How to avoid:** Set `{ timeout: 60_000 }` on perf tests. Document in `tests/perf/README.md`.

---

## Code Examples

### MCP Tool: mrclean_check

```typescript
// src/mcp/tools/check.ts
// Source: derived from SDK docs + Phase 1 sanitize.ts pattern
import { z } from 'zod/v4'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { MrcleanConfig } from '../../shared/types.js'
import type { SessionState } from '../../detect/session-state.js'

const checkInputSchema = z.object({
  text: z.string().describe('Text to scan for sensitive data'),
})

const findingSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  placeholder: z.string(),
  redactedHash: z.string(),
  fingerprint: z.string(),
})

const checkOutputSchema = z.object({
  findings: z.array(findingSchema),
  count: z.number(),
})

export function registerCheckTool(server: McpServer, getConfig: () => MrcleanConfig, getSessionState: () => SessionState): void {
  server.registerTool(
    'mrclean_check',
    {
      title: 'Check for sensitive data',
      description: 'Scan text for secrets and PII. Returns findings only — no side effects, no audit log write.',
      inputSchema: checkInputSchema,
      outputSchema: checkOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ text }) => {
      try {
        const result = await supervisedToolCall({ toolName: 'check', text, config: getConfig(), sessionState: getSessionState() })
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `mrclean_check error: ${String(err)}` }],
          isError: true,
        }
      }
    },
  )
}
```

### Perf Gate Test Pattern

```typescript
// tests/perf/user-prompt-submit.bench.test.ts
// Source: derived from Phase 2 src/doctor/bench.ts pattern
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { runDetection } from '../../src/detect/index.js'
import { loadEffectiveConfig } from '../../src/config/loader.js'
import { initSessionState } from '../../src/detect/session-state.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const FIXTURE = readFileSync(resolve(__dirname, 'fixtures/4kb-prompt.txt'), 'utf8')
const N = 50
const WARMUP = 5

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!
}

test('UserPromptSubmit p95 <= 100ms on 4KB prompt', async () => {
  const config = await loadEffectiveConfig({ cwd: process.cwd() })
  const sessionState = await initSessionState(config, process.cwd())
  const ctx = { sessionId: randomUUID(), hookEvent: 'UserPromptSubmit' as const, cwd: process.cwd() }

  // Warmup — let JIT and module loader settle
  for (let i = 0; i < WARMUP; i++) {
    await runDetection(FIXTURE, config, sessionState, ctx)
  }

  const samples: number[] = []
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    await runDetection(FIXTURE, config, sessionState, ctx)
    samples.push(performance.now() - t0)
  }

  const result = p95(samples)
  console.log(`[perf] UserPromptSubmit p95=${result.toFixed(2)}ms (N=${N}, CI target=100ms)`)
  expect(result).toBeLessThanOrEqual(100)
}, { timeout: 60_000 })
```

### changesets Config

```json
// .changeset/config.json (after npx changeset init)
{
  "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

### Release GitHub Actions Workflow

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]
concurrency: ${{ github.workflow }}-${{ github.ref }}
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - uses: changesets/action@v1
        with:
          publish: npm run release
          commit: "chore: version packages"
          title: "chore: version packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| MCP SSE-only transport | Streamable HTTP transport (with stdio still default for local) | Nov 2025 MCP spec | SSE deprecated; SDK already ships StreamableHTTP in v1.29 |
| `bench()` for perf assertions | `test()` + `performance.now()` loop (bench lacks assertion support) | Ongoing gap in vitest bench | No impact on functionality; just use test() |
| npm provenance (manual/optional) | `--provenance` flag with id-token: write permission (standard for security tools) | npm 9.5.0+ (2023); now standard practice | Transparent build attestation in the npm registry |
| Changesets manual PR | changesets/action automates version PR creation | 2021+ | Reduces publish friction to: add changeset → merge → approve auto-PR |

**Deprecated/outdated:**
- `bench()` lifecycle hooks (`beforeAll`/`afterAll`): not implemented in vitest bench suites as of vitest 4.x — confirmed by vitest maintainer. Do not rely on them.
- `assert { type: 'json' }` (JSON import assertion): deprecated syntax in Node ESM. Use `with { type: 'json' }` (already done in this project per STATE.md).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `SessionState` struct contains no non-serializable fields (functions, Buffers, etc.) — can cross worker postMessage boundary | §Pattern 2 | If wrong: supervisor cannot use postMessage to pass session state; must re-initialize in worker |
| A2 | `WorkerPool` from Phase 2 can be reused as the MCP supervisor transport without modification (same postMessage/reply pattern) | §Pattern 2 | If wrong: need a separate supervisor implementation with different message framing |
| A3 | First-publish `npm publish --provenance` locally is not supported (requires OIDC, only in GitHub Actions) | §Pattern 5 | If wrong: first publish CAN use provenance from local machine; no behavior change, only better first-publish attestation |
| A4 | `@changesets/cli` ^2.x is the correct version compatible with changesets/action@v1 | §Standard Stack | If wrong: install correct version; no architectural impact |
| A5 | `npm view @mrclean/mrclean` returns 404 — scoped name is available | §Pitfall 2 | If wrong: need yet another name alternative |
| A6 | The `globalSetup` build-race is the root cause of `tests/doctor/end-to-end.test.ts` failing in parallel (not another cause) | §Pitfall 4 | If wrong: need deeper investigation; fix may differ |

---

## Open Questions (RESOLVED)

1. **npm package name (BLOCKER for publish plan)** — RESOLVED: `mrclean-claude` (CONTEXT.md §Decisions + 03-05).
   - `mrclean` taken since 2012; scope `@mrclean/mrclean` rejected (org-setup friction); `mrclean-claude` positions clearly + verified-available via `npm view → 404`.

2. **MCP supervisor: Option A (worker file) vs Option B (postMessage pool)** — RESOLVED: in-process Promise isolation (03-01 interfaces).
   - Worker-file approach (Option A) requires compiled file paths + tsup-entry complexity that breaks `dist/` cleanly. Promise isolation at the tool-call boundary catches throws without spawning workers; Phase 2's worker_threads pool inside `runDetection` already provides the substantive MCP-04 crash-isolation guarantee.

3. **PERF gate flakiness on GitHub Actions** — RESOLVED: 100ms threshold per REQUIREMENTS.md (~5× headroom vs dev's 17.4ms p95).
   - Documented in 03-02's `tests/perf/README.md`: raise to 150ms only if CI gate proves flaky over a 30-day window.

4. **First-publish 2FA auth** — RESOLVED: maintainer manual publish + npm-OTP at hand; subsequent publishes via `NPM_TOKEN` automation token (03-05 Task 3 human checkpoint).

5. **THREAT_MODEL.md tone** — RESOLVED: ~200-300 words (03-03 Task 3 action).
   - One paragraph intro + 9 non-defenses bullet list + "what mrclean DOES defend" summary. Modeled on trufflehog brevity, not exhaustive gitleaks/semgrep-style docs.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All tasks | Yes | 20.x (system) | — |
| npm | Publish, changesets | Yes | bundled with Node | — |
| GitHub Actions runners | PERF gate CI, publish, smoke | Yes (cloud) | ubuntu-latest | — |
| `mrclean` npm name | npm publish | NO — TAKEN | 0.1.0 by jackhq | Scoped name / rename (see §Open Questions) |
| NPM_TOKEN secret | Release workflow | Not verified — operator must create | — | Manual publish for first release |

**Missing dependencies with no fallback:**
- npm name `mrclean` — publish BLOCKED until operator chooses an alternative or disputes the name (multi-week process).

**Missing dependencies with fallback:**
- NPM_TOKEN for automated publish — first release can be done manually; subsequent releases require the token.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.6 |
| Config file | `vitest.config.ts` (Phase 3 restructures with `projects` API) |
| Quick run command | `npm test` |
| Full suite with coverage | `npm run test:coverage` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-02 | mrclean_check returns findings without audit write | unit + integration | `vitest run tests/mcp/check.test.ts` | No — Wave 0 |
| MCP-02 | mrclean_redact returns redacted text + findings, writes audit | unit + integration | `vitest run tests/mcp/redact.test.ts` | No — Wave 0 |
| MCP-02 | mrclean_status returns version/rule_count/mode/session | unit | `vitest run tests/mcp/status.test.ts` | No — Wave 0 |
| MCP-03 | mrclean_unredact tool does NOT exist | smoke | `vitest run tests/mcp/tools-list.test.ts` | Yes (needs update) |
| PERF-01 | UserPromptSubmit p95 <= 100ms on 4KB | perf test | `vitest run tests/perf/user-prompt-submit.bench.test.ts` | No — Wave 0 |
| PERF-01 | PostToolUse p95 <= 200ms on 50KB | perf test | `vitest run tests/perf/post-tool-use.bench.test.ts` | No — Wave 0 |
| PERF-03 | No `new RegExp()` in hot-path functions | static grep | `grep` gate in `perf.yml` | No — Wave 0 |
| QA-01 | Lines/statements >= 80%, functions >= 75%, branches >= 70% | coverage | `npm run test:coverage` | Partial (thresholds not in config yet) |
| QA-02 | Integration test for each hook event (SessionStart/UserPromptSubmit/PreToolUse/PostToolUse) | integration | `vitest run tests/hook/integration-detection.test.ts` | Yes (Phase 2) |
| QA-03 | Canary-leak: no fixture secret in audit.jsonl | canary CI | `vitest run tests/fixtures-corpus.test.ts` | Yes (Phase 2) |

### Sampling Rate

- **Per task commit:** `npm test` (quick, no coverage)
- **Per wave merge:** `npm run test:coverage` (with threshold enforcement)
- **Phase gate:** `npm run test:coverage` green + perf gate green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/mcp/check.test.ts` — MCP-02 mrclean_check
- [ ] `tests/mcp/redact.test.ts` — MCP-02 mrclean_redact
- [ ] `tests/mcp/status.test.ts` — MCP-02 mrclean_status
- [ ] `tests/mcp/supervisor.test.ts` — MCP-04 worker crash isolation
- [ ] `tests/perf/user-prompt-submit.bench.test.ts` — PERF-01
- [ ] `tests/perf/post-tool-use.bench.test.ts` — PERF-01
- [ ] `tests/perf/fixtures/4kb-prompt.txt` — perf fixture
- [ ] `tests/perf/fixtures/50kb-tool-output.txt` — perf fixture
- [ ] `vitest.config.ts` — add `coverage.thresholds` and `projects` split
- [ ] `.changeset/config.json` — `npx changeset init`
- [ ] `LICENSE` — MIT text

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not applicable — no user auth in MCP tools |
| V3 Session Management | Partial | session_id is read-only in status; no session manipulation exposed |
| V4 Access Control | Yes | mrclean_unredact MUST NOT be registered (MCP-03 locked) |
| V5 Input Validation | Yes | Zod v4 input/output schemas on all three tools |
| V6 Cryptography | No | No new crypto; redactedHash already uses SHA-256 (Phase 2) |

### Known Threat Patterns for MCP Tools

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via mrclean_check (model supplies crafted text to probe detection rules) | Information Disclosure | check tool returns finding shapes only (ruleId, severity, placeholder) — never raw matched value; NEVER expose matched text in findings |
| Model-driven bypass request (model asks mrclean to disable detection) | Tampering | mrclean_check/redact/status have no disable/config-write capability; MCP-03 locked |
| Audit log data exposure via mrclean_status | Information Disclosure | status returns only the FILE PATH, not contents of audit.jsonl |
| Worker crash loop (tool sent adversarial input that crashes worker) | Denial of Service | supervisor catches 'error' event + 'exit' event; restarts worker; cap restart attempts at 3 before returning isError:true |

---

## Sources

### Primary (HIGH confidence)

- `@modelcontextprotocol/sdk` v1.29 — Context7 `/modelcontextprotocol/typescript-sdk` — registerTool API, outputSchema, annotations (readOnlyHint), CallToolResult interface, structuredContent shape
- https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md — tool registration with outputSchema example
- https://vitest.dev/api/#bench — TaskResult interface; confirmed p95 absent, p50/p75/p99/p995/p999 present
- https://vitest.dev/guide/recipes — `projects` API for sequential/parallel project split (fileParallelism: false)
- https://vitest.dev/guide/improving-performance — fileParallelism global disable option
- https://github.com/changesets/action/blob/main/README.md — workflow YAML, outputs.published, NPM_TOKEN + NODE_AUTH_TOKEN requirement
- https://github.com/changesets/changesets/blob/main/packages/cli/README.md — `changeset init`, `changeset add`, `changeset publish` commands
- https://docs.npmjs.com/generating-provenance-statements — `--provenance` flag, `id-token: write` permission, npm >=9.5.0 requirement
- https://docs.npmjs.com/policies/disputes/ — npm name reclaim policy (trademark only, no abandonment transfers)
- Context7 `/vitest-dev/vitest` — coverage.thresholds schema, v8 ignore comments, bench TaskResult fields
- Phase 2 `src/doctor/bench.ts` + `02-06-SUMMARY.md` — existing `performance.now()` percentile pattern (p50/p95 computed from sorted samples)

### Secondary (MEDIUM confidence)

- https://github.com/vitest-dev/vitest/discussions/4225 — confirmed: no built-in bench assertion support as of May 2026; maintainer acknowledged it as a feature request
- https://github.com/vitest-dev/vitest/discussions/5023 — confirmed: beforeAll/afterAll hooks do NOT fire in bench suites
- https://github.com/nodejs/node/issues/43331 — confirmed: uncaught exception in worker_threads emits 'error' on parent, does NOT crash parent if handled
- https://runs-on.com/benchmarks/github-actions-cpu-performance/ — GitHub ubuntu-latest runner variance ~27% on x64; 5x headroom from 17.4ms measured p95 to 100ms threshold makes gate viable despite variance

### Tertiary (LOW confidence, flagged as [ASSUMED])

- Worker postMessage serializability of `SessionState` and `MrcleanConfig` — not verified against actual types; assumes no Buffers/functions
- First-publish provenance from local machine — assumed to fail (OIDC not available locally); common knowledge for Sigstore but not tested

---

## Metadata

**Confidence breakdown:**
- MCP tool registration API: HIGH — verified via Context7 + official server.md
- Vitest bench p95 gap: HIGH — verified from official TaskResult interface + maintainer discussion
- Vitest test() perf gate pattern: HIGH — matches existing Phase 2 bench.ts pattern
- changesets workflow: HIGH — verified via Context7 + official README
- npm publish + provenance: HIGH — verified via official npm docs
- npm name conflict: HIGH — verified via `npm view mrclean` (exit 0, published 2022)
- worker_threads crash isolation: HIGH — verified via Node.js official docs + GitHub issue
- Parallel test isolation fix: HIGH — reproduced failure in test run; fix pattern verified via vitest docs
- GitHub Actions perf variance: MEDIUM — data from RunsOn benchmarks site; 2026 data

**Research date:** 2026-05-14
**Valid until:** 2026-08-14 (90 days — stable dependencies; check MCP SDK releases for v2 status)
