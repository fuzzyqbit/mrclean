---
phase: 03-mcp-tools-performance-gate-public-release
plan: "01"
subsystem: mcp
tags: [mcp-tools, supervisor, zod-v4, structured-content, rename, mcp-02, mcp-03]
dependency_graph:
  requires: ["02-04", "02-05", "03-00"]
  provides: ["mrclean_check", "mrclean_redact", "mrclean_status", "supervisedToolCall", "runDetectionReadOnly"]
  affects: ["src/mcp/server.ts", "src/detect/index.ts", "src/doctor/canary.ts"]
tech_stack:
  added: []
  patterns:
    - "In-process Promise isolation for MCP tool crash protection (supervisedToolCall)"
    - "runDetectionReadOnly: Steps 1-11 of runDetection, audit write Step 12 omitted"
    - "Zod v4 outputSchema + structuredContent for all three tools"
    - "readOnlyHint: true on mrclean_check and mrclean_status"
key_files:
  created:
    - src/mcp/supervisor.ts
    - src/mcp/tools/check.ts
    - src/mcp/tools/redact.ts
    - src/mcp/tools/status.ts
    - tests/mcp/supervisor.test.ts
    - tests/mcp/check.test.ts
    - tests/mcp/redact.test.ts
    - tests/mcp/status.test.ts
  deleted:
    - src/mcp/tools/sanitize.ts
    - src/mcp/tools/restore.ts
    - src/mcp/tools/audit-query.ts
    - tests/mcp/sanitize.test.ts
    - tests/mcp/restore.test.ts
    - tests/mcp/audit-query.test.ts
  modified:
    - src/mcp/server.ts
    - src/detect/index.ts
    - tests/mcp/tools-list.test.ts
    - src/doctor/canary.ts
    - tests/doctor/canary.test.ts
decisions:
  - "Supervisor uses in-process Promise isolation (not per-call worker_threads) per RESEARCH §Pattern 2 / §Pitfall 3"
  - "runDetectionReadOnly added to src/detect/index.ts as additive export; runDetection unchanged"
  - "AWS key test fixture uses AKIAABCDE3FGHIJ2345K (not AKIAIOSFODNN7EXAMPLE which is in gitleaks allowlist)"
  - "doctor/canary.ts runMcpCanary updated from sanitize to mrclean_check (Rule 1 auto-fix)"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-14T19:08:00Z"
  tasks_completed: 2
  files_created: 8
  files_deleted: 6
  files_modified: 5
  tests_added: 19
  tests_total_after: 364
---

# Phase 03 Plan 01: MCP Tool Rename + Supervisor Summary

**One-liner:** Production MCP tool trio `mrclean_check` / `mrclean_redact` / `mrclean_status` replacing Phase 1 stubs; in-process Promise supervisor guards against handler crashes; `runDetectionReadOnly` added for audit-skip check path.

## What Was Built

### Task 1: Supervisor + three new tool files + 19 tests

**`src/mcp/supervisor.ts`**
- Exports `supervisedToolCall<T>(fn: () => Promise<T>)` — wraps any tool handler in try/catch; returns `{ ok: true, result }` or `{ ok: false, error: string }`.
- Exports `shutdownMcpSupervisor` as a re-export of `shutdownDetection` from `src/detect/index.ts`. This is the single shutdown point for the MCP server's detection resources.
- Documented: in-process Promise isolation chosen over `new Worker` per call due to RESEARCH §Pattern 2 / §Pitfall 3 (ESM bundle worker needs compiled entry + tsup entry).

**`src/detect/index.ts` (additive export)**
- `runDetectionReadOnly(text, config, sessionState, ctx)` — runs all four detection layers (Steps 1-11) but omits Step 12 (audit writes). Returns `DetectionResult` with the same shape. Used by `mrclean_check` to satisfy T-03-01-03 (no audit log writes from read-only tool).

**`src/mcp/tools/check.ts`**
- Tool name: `mrclean_check`
- Input: `{ text: string, sessionId?: string }`
- Output: `{ findings: FindingDTO[], count: number }` via `structuredContent`
- `FindingDTO` exposes only: `ruleId, severity, placeholder, redactedHash, fingerprint` — never `value` or `span` (T-03-01-02)
- Annotations: `{ readOnlyHint: true, idempotentHint: true }`
- Calls `runDetectionReadOnly` — never `writeAuditRecord`

**`src/mcp/tools/redact.ts`**
- Tool name: `mrclean_redact`
- Input: `{ text: string, sessionId?: string }`
- Output: `{ redacted: string, findings: FindingDTO[] }` via `structuredContent`
- Calls `runDetection` (full audit-write path)
- Returns `{ isError: true }` when `budgetExhausted: true`

**`src/mcp/tools/status.ts`**
- Tool name: `mrclean_status`
- Input: `z.object({})` — zero arguments
- Output: `{ version, rule_count, allowlist_count, mode, session_id: null, audit_log_path }`
- Annotations: `{ readOnlyHint: true, idempotentHint: true }`
- Calls `loadEffectiveConfig` fresh on each call; `getRuleCount().total` for rule count; `computeAllowlistCount` for allowlist count

### Task 2: Wire server.ts + delete Phase 1 stubs + MCP-03 test

**`src/mcp/server.ts` rewritten:**
- Imports and calls `registerCheckTool`, `registerRedactTool`, `registerStatusTool`
- Loads `loadEffectiveConfig` + `initSessionState` at startup; passes closures to each tool
- Shutdown: `shutdownMcpSupervisor()` before `transport.close()`
- Startup banner: `mrclean-mcp v${VERSION} running on stdio — tools: mrclean_check, mrclean_redact, mrclean_status`

**Deleted (Phase 1 stubs — no aliases):**
- `src/mcp/tools/sanitize.ts`, `restore.ts`, `audit-query.ts`
- `tests/mcp/sanitize.test.ts`, `restore.test.ts`, `audit-query.test.ts`

**`tests/mcp/tools-list.test.ts` updated:**
- T2: asserts `tools.list` returns exactly `['mrclean_check', 'mrclean_redact', 'mrclean_status']` (sorted)
- T2b: asserts none of `['sanitize', 'restore', 'audit_query', 'unredact', 'mrclean_unredact', 'disable', 'add_word', 'config_write', 'ignore']` appear — MCP-03 invariant enforcement
- T3a/T4a/T5a/T6a/T7: behavior tests for new tools replacing old phase-1 assertions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `src/doctor/canary.ts` calling deleted `sanitize` tool**
- **Found during:** Task 2 — after deleting `src/mcp/tools/sanitize.ts`, running the full suite revealed `tests/doctor/canary.test.ts` Test 10 and 3 doctor end-to-end tests failing.
- **Issue:** `runMcpCanary()` in `src/doctor/canary.ts` called `client.callTool({ name: 'sanitize', ... })`. The `sanitize` tool was deleted in this plan.
- **Fix:** Updated `runMcpCanary()` to call `mrclean_check` instead. Changed assertion from echo-check to `structuredContent.count` existence check (mrclean_check is a detection tool, not a pass-through). Updated Test 10 description and assertion regex accordingly.
- **Files modified:** `src/doctor/canary.ts`, `tests/doctor/canary.test.ts`
- **Commit:** 6e1fc90

**2. [Rule 1 - Bug] AWS key test fixture adjusted for gitleaks allowlist**
- **Found during:** Task 1 test run — `AKIAIOSFODNN7EXAMPLE123456789012` produced 0 findings.
- **Issue:** The gitleaks `aws-access-token` rule has a per-rule allowlist regex `.+EXAMPLE$` that rejects keys ending with `EXAMPLE` (the AWS documentation placeholder).
- **Fix:** Changed test fixture to `AKIAABCDE3FGHIJ2345K` — matches `\b(AKIA[A-Z2-7]{16})\b`, entropy 3.78 > threshold 3, does not end with EXAMPLE.
- **Files modified:** `tests/mcp/check.test.ts`, `tests/mcp/redact.test.ts`
- **Commit:** d3e4758

## Supervisor Implementation Choice

**Chosen: In-process Promise isolation (Option B from RESEARCH §Pattern 2)**

The supervisor (`src/mcp/supervisor.ts`) wraps tool handler invocations in `try/catch` Promise isolation. No `new Worker` per call is spawned.

Rationale (documented in supervisor.ts module JSDoc):
- `new Worker` per call (Option A) requires a pre-compiled worker entry point (`dist/mcp/tool-worker.js`) and an additional tsup entry — complex and risky for a security tool's supply chain.
- The substantive MCP-04 guarantee is preserved:
  1. Layer 1 regex execution already runs in `worker_threads` via Phase 2's `WorkerPool` (terminate-and-replace on timeout).
  2. Promise isolation prevents uncaught handler throws from reaching the MCP transport.
- Future upgrade path: create `src/mcp/tool-worker.ts` + tsup entry + swap `supervisedToolCall` to `new Worker`. Public API unchanged.

## `tools/list` JSON from Integration Test

From `tests/mcp/tools-list.test.ts` T2 (live SDK client against `dist/mcp.js`):

```json
["mrclean_check", "mrclean_redact", "mrclean_status"]
```

T2b (MCP-03 invariant) passed — all of the following are absent: `sanitize`, `restore`, `audit_query`, `unredact`, `mrclean_unredact`, `disable`, `add_word`, `config_write`, `ignore`.

## Coverage Delta

Three new source files under `src/mcp/tools/` are now covered by 19 new tests:
- `src/mcp/supervisor.ts`: 5 tests
- `src/mcp/tools/check.ts`: 5 tests
- `src/mcp/tools/redact.ts`: 5 tests
- `src/mcp/tools/status.ts`: 4 tests

`src/detect/index.ts` gained `runDetectionReadOnly` (covered by check.test.ts T3/T4 and redact.test.ts T4).

## Known Stubs

None — all three production tools have real detection logic wired to `runDetection` / `runDetectionReadOnly`.

## Threat Flags

No new threat surface beyond what is tracked in the plan's `<threat_model>`. All five threats addressed:
- T-03-01-01 (Tampering — forbidden tools): MCP-03 invariant test enforces.
- T-03-01-02 (Info disclosure — finding shape): findingSchema excludes `value` + `span`; output schema validated by SDK.
- T-03-01-03 (Info disclosure — check audit write): `runDetectionReadOnly` omits Step 12; check.test.ts T4 asserts at filesystem level.
- T-03-01-04 (DoS — handler crash): `supervisedToolCall` + Phase 2 WorkerPool.
- T-03-01-05/06 (Info disclosure — path / placeholder): accepted per plan.

## Self-Check: PASSED

- All 8 new files exist on disk: CONFIRMED
- All 6 Phase 1 files deleted: CONFIRMED
- Commits d3e4758 and 6e1fc90 exist: CONFIRMED
- `npm run build` exits 0: CONFIRMED
- `dist/mcp.js` contains `mrclean_check`, `mrclean_redact`, `mrclean_status`: CONFIRMED (9 occurrences)
- `dist/mcp.js` does NOT contain `registerSanitizeTool`, `registerRestoreTool`, `registerAuditQueryTool`: CONFIRMED (grep exits 1, 0 matches)
- Full suite: 364/364 tests pass: CONFIRMED
