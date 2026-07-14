---
phase: 01-wired-skeleton
plan: "04"
subsystem: mcp
tags: [mcp-sdk, zod, stdio, node, typescript, signal-handling]

requires:
  - phase: 01-01
    provides: "package.json scaffold, dist/mcp.js entrypoint with guard, src/mcp/server.ts stub, VERSION export"

provides:
  - "src/mcp/lifecycle.ts — installShutdownHandlers() registers SIGINT+SIGTERM exactly once per process; idempotent via shuttingDown flag"
  - "src/mcp/tools/sanitize.ts — registerSanitizeTool(server); Zod v4 inputSchema; Phase 1 no-op echo"
  - "src/mcp/tools/restore.ts — registerRestoreTool(server); same shape as sanitize; reverse-direction named"
  - "src/mcp/tools/audit-query.ts — registerAuditQueryTool(server); Zod v4 inputSchema with limit max 1000 default 100; Phase 1 empty records"
  - "src/mcp/server.ts (stub replaced) — runMcpServer() with lazy SDK imports, single shutdown registration site"
  - "tests/mcp/ — 26 tests: 15 unit (3 tool files × 5), 4 lifecycle, 7 integration"

affects: [05-doctor, phase-2, phase-3]

tech-stack:
  added:
    - "@modelcontextprotocol/sdk/server/mcp.js — McpServer (via wildcard ./* export in SDK v1.29)"
    - "@modelcontextprotocol/sdk/server/stdio.js — StdioServerTransport (via wildcard ./* export)"
    - "@modelcontextprotocol/sdk/client/index.js — Client (integration tests)"
    - "@modelcontextprotocol/sdk/client/stdio.js — StdioClientTransport (integration tests)"
    - "@modelcontextprotocol/sdk/inMemory.js — InMemoryTransport (unit tests)"
    - "zod/v4 — Zod v4 via CLAUDE.md-mandated import path"
  patterns:
    - "registerTool() with inputSchema as AnySchema (z.object() result, not raw shape)"
    - "Lazy await import() for SDK inside runMcpServer() — cold-start budget preserved"
    - "InMemoryTransport.createLinkedPair() for in-process unit tests without stdio subprocess"
    - "StdioClientTransport for live integration tests (subprocess + stdio round-trip)"
    - "Single shutdown registration site: installShutdownHandlers() only; server.ts adds zero signal listeners"

key-files:
  created:
    - src/mcp/lifecycle.ts
    - src/mcp/tools/sanitize.ts
    - src/mcp/tools/restore.ts
    - src/mcp/tools/audit-query.ts
    - tests/mcp/sanitize.test.ts
    - tests/mcp/restore.test.ts
    - tests/mcp/audit-query.test.ts
    - tests/mcp/server-lifecycle.test.ts
    - tests/mcp/tools-list.test.ts
  modified:
    - src/mcp/server.ts

key-decisions:
  - "SDK v1.29 exports: /server/mcp.js and /server/stdio.js resolve via the ./* wildcard pattern in the package exports field. Named subpaths /server/mcp and /server/stdio do NOT exist — the plan's reference paths are correct but only work because of the wildcard. Confirmed RESEARCH A2 assumption: the paths work."
  - "InMemoryTransport used for unit tests instead of spawning a subprocess — avoids process overhead and makes unit test assertions cleaner. Integration tests (tools-list.test.ts) do the full stdio round-trip."
  - "inputSchema passed as z.object({...}) (AnySchema), not as a raw ZodRawShape — the SDK accepts either form per the TypeScript overload."
  - "lifecycle.ts uses two inline arrow functions per process.on() call (not a single handler) — this is intentional: the outer lambdas isolate each signal name before passing to the shared handler, preventing closure issues."
  - "LATEST_PROTOCOL_VERSION is 2025-11-25 in the installed SDK v1.29.0 — this is NOT hardcoded anywhere; the SDK Client negotiates it automatically."
  - "tsup bundles all source into dist/mcp.js (no individual dist/mcp/lifecycle.js etc.) — lifecycle tests test via the full server binary, not isolated module imports."

patterns-established:
  - "Tool registration: registerXxxTool(server) pattern — isolated module per tool, imported lazily in server.ts"
  - "No top-level SDK imports in any MCP module visible to the CLI cold path"
  - "structuredContent returned alongside content[] in tool callbacks — required for SDK to surface it to callers"

requirements-completed:
  - MCP-01
  - MCP-04

duration: 15min
completed: "2026-05-14"
---

# Phase 1 Plan 04: MCP Tool Stubs Summary

**Long-lived stdio MCP server with three Zod v4-validated no-op tool stubs (sanitize, restore, audit_query) using McpServer + StdioServerTransport, single SIGINT/SIGTERM registration site, and 26 tests including live SDK Client integration**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-14T00:41:00Z
- **Completed:** 2026-05-14T00:53:00Z
- **Tasks:** 2
- **Files created/modified:** 10

## Accomplishments

- Three Phase 1 tool stubs registered with Zod v4 `inputSchema` — all inputs validated by the SDK before handler is called
- `installShutdownHandlers()` is the single SIGINT/SIGTERM registration site: exactly 2 listeners per process, idempotent via `shuttingDown` flag — confirmed by lifecycle tests
- Live stdio integration test: SDK Client connects to the spawned `dist/mcp.js`, performs automatic protocol version negotiation (`LATEST_PROTOCOL_VERSION = '2025-11-25'`), calls all three tools end-to-end
- Crash isolation confirmed: bad input to `sanitize` returns `isError: true`; subsequent calls succeed (T6 + T7)
- RESEARCH A2 closed: `@modelcontextprotocol/sdk/server/mcp.js` and `@modelcontextprotocol/sdk/server/stdio.js` resolve via the `./*` wildcard in the SDK v1.29 package exports

## Task Commits

1. **Task 1 RED: failing unit and lifecycle tests** - `6a21a82` (test)
2. **Task 1 GREEN: implement tool stubs, lifecycle, server** - `9a02422` (feat)
3. **Task 2: live stdio integration test** - `868dd91` (test)

## SDK Version and Export Paths (RESEARCH A2 Closed)

| Import Path | Verified? | Exports |
|-------------|-----------|---------|
| `@modelcontextprotocol/sdk/server/mcp.js` | YES — resolves via `./*` wildcard | `McpServer` |
| `@modelcontextprotocol/sdk/server/stdio.js` | YES — resolves via `./*` wildcard | `StdioServerTransport` |
| `@modelcontextprotocol/sdk/client/index.js` | YES — resolves via `./client` + `./*` | `Client` |
| `@modelcontextprotocol/sdk/client/stdio.js` | YES — resolves via `./*` wildcard | `StdioClientTransport` |
| `@modelcontextprotocol/sdk/inMemory.js` | YES — resolves via `./*` wildcard | `InMemoryTransport` |

SDK version installed: **1.29.0**. `LATEST_PROTOCOL_VERSION = '2025-11-25'` (read from `types.js` — not hardcoded anywhere in mrclean).

## Tool Input/Output Shapes (Phase 2/3 Compatibility Reference)

| Tool | Input (Zod v4) | Phase 1 Output |
|------|----------------|----------------|
| `sanitize` | `{ text: string, sessionId?: string }` | `content[0].text = input.text`, `structuredContent = { unchanged: true, sessionId: ?? null }` |
| `restore` | `{ text: string, sessionId?: string }` | Same as sanitize |
| `audit_query` | `{ sessionId?: string, limit?: number (default 100, max 1000) }` | `content[0].text = '{"records":[]}', structuredContent = { records: [], total: 0 }` |

## Shutdown Timing

- SIGTERM → `process.exit(0)` measured at < 50ms in lifecycle tests (async transport.close() completes quickly since there are no active in-flight requests to drain in Phase 1)
- No `MaxListenersExceededWarning` observed in any test run

## Signal Handler Count Verification

```
process.listenerCount('SIGINT') === 1  after server startup — single handler in lifecycle.ts
process.listenerCount('SIGTERM') === 1 after server startup — single handler in lifecycle.ts
```

Verified indirectly: SIGTERM shutdown message appears exactly once in stderr (not duplicated), and no `MaxListenersExceededWarning` is present — regression guard confirmed by `server-lifecycle.test.ts`.

## Files Created/Modified

- `src/mcp/lifecycle.ts` — `installShutdownHandlers(closeFn)`: SIGINT+SIGTERM, idempotent, single registration site
- `src/mcp/tools/sanitize.ts` — `registerSanitizeTool(server)`: Zod v4 schema, Phase 1 echo
- `src/mcp/tools/restore.ts` — `registerRestoreTool(server)`: Zod v4 schema, Phase 1 echo
- `src/mcp/tools/audit-query.ts` — `registerAuditQueryTool(server)`: Zod v4 schema, empty records
- `src/mcp/server.ts` — replaces Plan 01 stub: lazy SDK imports, three tool registrations, installShutdownHandlers call
- `tests/mcp/sanitize.test.ts` — 5 unit tests via InMemoryTransport
- `tests/mcp/restore.test.ts` — 5 unit tests via InMemoryTransport
- `tests/mcp/audit-query.test.ts` — 5 unit tests via InMemoryTransport
- `tests/mcp/server-lifecycle.test.ts` — 4 child-process lifecycle tests
- `tests/mcp/tools-list.test.ts` — 7 live stdio integration tests via SDK Client

## Decisions Made

- **SDK export paths via wildcard**: The plan referenced `/server/mcp.js` and `/server/stdio.js` as subpaths. These resolve only because the SDK v1.29 package.json has a `./*` wildcard export. The named subpaths `/server/mcp` and `/server/stdio` do NOT exist. This is an important distinction for future dependency upgrades — if the SDK removes the wildcard, imports must be adjusted.
- **InMemoryTransport for unit tests**: Used the SDK's built-in `InMemoryTransport.createLinkedPair()` for in-process tool invocation, avoiding subprocess spawning overhead in unit tests. Full stdio round-trip reserved for `tools-list.test.ts`.
- **Lifecycle tests via dist/mcp.js**: tsup bundles everything into flat dist files; individual `dist/mcp/lifecycle.js` does not exist. Lifecycle behaviors are tested via the full server binary.
- **inputSchema as AnySchema**: Used `z.object({...})` directly (not a ZodRawShape). Both are accepted by the SDK's registerTool overload.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rewrote server-lifecycle.test.ts: dist/mcp/lifecycle.js doesn't exist**
- **Found during:** Task 1 (lifecycle test execution)
- **Issue:** Original test design referenced `dist/mcp/lifecycle.js` for inline child process eval, but tsup bundles everything into `dist/mcp.js` — no individual module files exist in dist/
- **Fix:** Rewrote lifecycle tests to use the full `dist/mcp.js` server binary. Lifecycle behaviors (SIGTERM/SIGINT clean exit, no MaxListenersExceededWarning) verified via spawning the real server and sending signals with a pattern-wait approach.
- **Files modified:** `tests/mcp/server-lifecycle.test.ts`
- **Verification:** 4 lifecycle tests pass; SIGTERM exit 0 confirmed
- **Committed in:** `9a02422` (part of Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking build issue in test design)
**Impact on plan:** No scope change. The lifecycle behaviors specified in the plan are fully verified; only the test mechanism changed from inline eval to process spawn.

## Issues Encountered

None beyond the deviation documented above.

## Known Stubs

The following are intentional Phase 1 stubs (documented in the plan as such):

| Tool | Phase 1 Stub | Resolved by |
|------|-------------|-------------|
| `sanitize` | Always echoes input unchanged | Phase 2 detection layer |
| `restore` | Always echoes input unchanged | Phase 2 REVMODE |
| `audit_query` | Always returns empty records | Phase 2 audit log |

These stubs fully satisfy MCP-01 and MCP-04 for Phase 1. They are not gaps — they are the specified Phase 1 behavior.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced. The MCP server uses stdio only (no TCP socket, no HTTP); it does not expose any new attack surface beyond the existing stdin/stdout pipe that Claude Code manages.

## Next Phase Readiness

- Plan 01-05 (doctor canary round-trip) can now connect to the MCP server via `StdioClientTransport` to verify the server starts and responds to `initialize` — the exact pattern proven in `tools-list.test.ts`
- Phase 2 can replace the tool handler bodies without touching schemas (MCP-01/MCP-04 satisfied)
- Phase 3 tool rename (`sanitize` → `mrclean_check`, etc. per MCP-02) is a drop-in replacement — schema shapes are locked and compatible

## Self-Check: PASSED

- All 10 key files confirmed present on disk
- All 3 task commits confirmed in git log (6a21a82, 9a02422, 868dd91)
- 122 total tests passing (26 new in tests/mcp/)
- Grep gate: zod/v4 imports=3, no top-level SDK in mcp.ts, lazy imports in server.ts=5, non-comment signal handlers in server.ts=0, signal handlers in lifecycle.ts=2

---
*Phase: 01-wired-skeleton*
*Completed: 2026-05-14*
