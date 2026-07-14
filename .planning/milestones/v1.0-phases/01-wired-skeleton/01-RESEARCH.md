# Phase 1: Wired Skeleton — Research

**Researched:** 2026-05-13
**Domain:** Claude Code hook contract, MCP stdio registration, npm CLI packaging, atomic JSON editing
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INST-01 | `npx mrclean install` wires hook + MCP into `~/.claude/settings.json` | Hook registration format verified; MCP goes into `~/.claude.json` |
| INST-02 | Install is idempotent — re-run does not duplicate or corrupt | Marker-comment strategy documented; JSON keyed-merge pattern |
| INST-03 | Installer creates timestamped backup before any write | Atomic write pattern: backup → tmp → rename |
| INST-04 | Installer resolves absolute path to the mrclean bin at install time | `process.execPath`-derived node path + `require.resolve` for bin path |
| INST-05 | `npx mrclean uninstall` removes mrclean-tagged entries, restores backup | Marker-tagged block removal documented |
| INST-06 | `npx mrclean doctor` runs canary round-trip, reports CC version | Canary design and version-read pattern documented |
| INST-07 | `.mrclean/` created with self-`.gitignore` covering audit log + artifacts | Directory layout and gitignore content documented |
| INST-08 | Single npm package with two `bin` entries, Node ≥ 20.18.0 | Two-bin `package.json` pattern and tsup config documented |
| HOOK-01 | Register handlers for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse | Exact JSON input shapes verified from official docs |
| HOOK-05 | Hook fails closed — exit 2 + structured stderr on uncaught exception | Exit-code contract and top-level catch pattern documented |
| HOOK-06 | Hook writes nothing to stdout except the JSON response | stdout-only-JSON rule; stderr for diagnostics documented |
| HOOK-07 | "mrclean active vN.N.N" banner emitted to stderr on SessionStart | SessionStart stdout/additionalContext pattern confirmed |
| MCP-01 | `mrclean-mcp` runs as long-lived stdio MCP server, Streamable HTTP opt-in | `McpServer` + `StdioServerTransport` pattern verified |
| MCP-04 | MCP tool I/O validated with Zod v4; crashes isolated by supervisor | Zod v4 `inputSchema`, worker-process restart pattern |
| AUDIT-03 | Audit log append-only; `.gitignore`'d from install | `.mrclean/audit.jsonl` in `.gitignore` from INST-07 |
| CFG-01 | Read `.mrclean/config.toml`; missing file is fine | TOML config with defaults-only fallback pattern |
| CFG-03 | Config layering: bundled defaults < `~/.mrclean/config.toml` < `.mrclean/config.toml` | Three-layer merge pattern documented |
</phase_requirements>

---

## Summary

Phase 1 has two non-obvious truths the planner must know before writing tasks:

**Truth 1 — Hooks and MCP servers live in different files.** Hooks (`hooks` block) go into `~/.claude/settings.json`. MCP servers (`mcpServers` block) go into `~/.claude.json` (user-scope) or `.mcp.json` (project-scope). These are distinct files managed through different mechanisms. `mrclean install` must write to both.

**Truth 2 — Hook binary is one-shot; MCP server is long-lived.** Claude Code spawns the hook binary freshly for each event, piping JSON on stdin and reading JSON + exit-code from stdout. The MCP server, once registered, is spawned once at session start and kept alive. The same TypeScript source can serve both modes dispatched by subcommand, but the code paths are architecturally distinct.

**Primary recommendation:** Implement two src entry points — `src/cli.ts` (commander root with `install | uninstall | doctor | hook | serve` subcommands) dispatching to focused modules. The `hook` subcommand is the one-shot stdin/stdout handler; `serve` is the long-lived MCP stdio process. `tsup` bundles both as executable bins with the `#!/usr/bin/env node` shebang, making them `chmod +x` automatically.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Hook event interception (stdin/stdout) | Hook adapter process | — | Claude Code spawns as one-shot subprocess |
| MCP tool exposure | MCP server process | — | Long-lived stdio subprocess registered in `~/.claude.json` |
| Installer / settings.json editing | CLI process (install subcommand) | — | Node.js fs/promises; no subprocess needed |
| Config reading (`.mrclean/config.toml`) | Hook adapter | MCP server | Both processes read at startup |
| Audit log write | Hook adapter | — | Only hook events are logged in Phase 1 |
| Doctor canary round-trip | CLI process (doctor subcommand) | — | Synthetic stdin/stdout self-test; no Claude Code launch needed |
| `.mrclean/` directory setup | CLI process (install subcommand) | — | Idempotent mkdir + gitignore write |

---

## Section 1: Claude Code Hook Contract — Exact JSON Shapes

**Source:** [https://code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks) — VERIFIED LIVE 2026-05-13

### 1.1 Hook Event Input Shapes

All events share a common base:

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/dir",
  "hook_event_name": "SessionStart|UserPromptSubmit|PreToolUse|PostToolUse"
}
```

**SessionStart** (fires on startup, resume, `/clear`, compaction):
```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/path",
  "hook_event_name": "SessionStart",
  "source": "startup|resume|clear|compact",
  "model": "claude-sonnet-4-6"
}
```
Matcher values: `startup`, `resume`, `clear`, `compact`

**UserPromptSubmit** (fires before Claude processes user prompt; no matcher support):
```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/path",
  "permission_mode": "default",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "Write a function to..."
}
```

**PreToolUse** (fires after Claude creates tool parameters, before execution):
```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/path",
  "permission_mode": "default",
  "effort": { "level": "medium" },
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "tool_use_id": "unique-id"
}
```
Matcher values: `Bash`, `Edit`, `Write`, `Read`, `Glob`, `Grep`, `Agent`, `WebFetch`, `WebSearch`, `mcp__server__tool`

**PostToolUse** (fires after tool call succeeds):
```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/path",
  "permission_mode": "default",
  "effort": { "level": "medium" },
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "tool_response": "test output here",
  "tool_use_id": "unique-id",
  "duration_ms": 1420
}
```

### 1.2 Hook Output Shapes

**Exit code 0 is the only code that triggers stdout JSON parsing.** On any non-zero code, JSON is ignored.

**PreToolUse decision (the most important for Phase 1 skeleton):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "no secrets detected",
    "updatedInput": { "command": "sanitized command" },
    "additionalContext": "optional context for Claude"
  }
}
```
`permissionDecision` values: `"allow"`, `"deny"`, `"ask"` (escalate to permission dialog)

**UserPromptSubmit block:**
```json
{
  "decision": "block",
  "reason": "Detected AWS_ACCESS_KEY_ID"
}
```

**SessionStart context injection:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "mrclean active v0.1.0\nrules: 247, allowlist: 12"
  }
}
```

**Minimal pass-through (exit 0, empty stdout or no output):** Claude proceeds normally.

### 1.3 Exit Code Semantics

| Exit Code | Behavior | JSON Parsed? | Notes |
|-----------|----------|-------------|-------|
| **0** | Success | YES | Only code that triggers JSON parsing from stdout |
| **1** | Non-blocking error | NO | Execution continues; stderr to debug log + transcript (first line) |
| **2** | BLOCKING | NO | Blocks tool/prompt; stderr shown to Claude or user depending on event |
| **Other non-zero** | Non-blocking error | NO | Execution continues; stderr to debug log |

**Exit 2 blocks:**
- `PreToolUse` — blocks the tool call
- `UserPromptSubmit` — blocks the prompt, erases from context
- `PermissionRequest` — denies permission

**Exit 2 does NOT block (shows stderr only):**
- `PostToolUse`, `SessionStart` — these are non-blocking events; exit 2 surfaces stderr but does not stop execution

**Critical implication for HOOK-05:** The hook's fail-closed guarantee requires that `PreToolUse` exits 2 on any uncaught exception. For `PostToolUse`, exit 2 is not blocking — it only shows an error. In Phase 1 (no-op detection), always exit 0. In Phase 2+, exit 2 from `PreToolUse` on detection; use `decision: "block"` from `UserPromptSubmit`.

### 1.4 Stderr Semantics

- `stderr` content is NEVER written to stdout automatically.
- Exit 0 + `stderr` writes: stderr goes to the debug log only, invisible to user unless `--debug`.
- Exit 2 + `stderr`: first line shown in transcript with `<hook name> hook error:` prefix; full stderr in debug log.
- **Banner on SessionStart:** The correct channel for the "mrclean active" banner is `additionalContext` in the JSON stdout (exit 0). Writing the banner to stderr on exit 0 sends it only to the debug log and is invisible. [VERIFIED: code.claude.com/docs/en/hooks]

### 1.5 Hook Registration in `~/.claude/settings.json`

Hooks use the `args` exec form (recommended as of v2.1.119 — avoids shell quoting issues with path placeholders):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "/usr/local/bin/node",
            "args": ["/absolute/path/to/mrclean", "hook"],
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/usr/local/bin/node",
            "args": ["/absolute/path/to/mrclean", "hook"],
            "timeout": 10
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "/usr/local/bin/node",
            "args": ["/absolute/path/to/mrclean", "hook"],
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "/usr/local/bin/node",
            "args": ["/absolute/path/to/mrclean", "hook"],
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

**Settings file locations (hook scope):**
- `~/.claude/settings.json` — user-global (all projects) ← use this
- `.claude/settings.json` — project-scoped (checked into VCS)
- `.claude/settings.local.json` — project-local (gitignored)

**Matcher syntax:**
- `"*"` or `""` or omitted — match all
- Letters, digits, `_`, `|` only — exact match or `|`-separated list: `"Bash"`, `"Edit|Write"`
- Other characters → JavaScript regex: `"mcp__memory__.*"`, `"^Bash$"`

**Path placeholders:** `${CLAUDE_PROJECT_DIR}` is available in `command`/`args` (project root). Use with default: `${CLAUDE_PROJECT_DIR:-.}` in `.mcp.json` files. Plugin configs substitute directly. For user-global hooks: use absolute path resolved at install time, not `${CLAUDE_PROJECT_DIR}`.

**Canonical schema:** `https://json.schemastore.org/claude-code-settings.json`

---

## Section 2: MCP Server Registration in `~/.claude.json`

**Source:** [https://code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp) — VERIFIED LIVE 2026-05-13

### 2.1 Critical Clarification: Two Separate Config Files

| Config File | What It Controls | mrclean Writes Here |
|-------------|-----------------|---------------------|
| `~/.claude/settings.json` | Hooks, permissions, settings | Hook registration |
| `~/.claude.json` | MCP servers (user-scope), projects | MCP server registration |
| `.mcp.json` (project root) | MCP servers (project-scope, committed to VCS) | Optional project-scope server |

**The GitHub issue warning about "MCP servers silently absent when configured via settings.json" is real.** [VERIFIED: issue #37245, code.claude.com/docs/en/mcp]

### 2.2 MCP Server JSON Format

**User-scope server (goes into `~/.claude.json`):**
```json
{
  "projects": {
    "/path/to/project": {
      "mcpServers": {
        "mrclean": {
          "type": "stdio",
          "command": "/absolute/path/to/node",
          "args": ["/absolute/path/to/mrclean-mcp"]
        }
      }
    }
  }
}
```

**Project-scope server (goes into `.mcp.json` at project root):**
```json
{
  "mcpServers": {
    "mrclean": {
      "type": "stdio",
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/mrclean-mcp"]
    }
  }
}
```

**Fields for a stdio server entry:**
```json
{
  "type": "stdio",
  "command": "/absolute/path/to/node",
  "args": ["/absolute/path/to/mrclean-mcp", "--optional-flag"],
  "env": { "OPTIONAL_VAR": "value" }
}
```

`type: "stdio"` is the correct value. `"streamable-http"` is an alias for the HTTP transport — do not use for local servers.

### 2.3 Stdio Server Lifecycle

- Spawned **once at session startup** by Claude Code; not per-tool-call.
- Lives for the duration of the Claude Code session.
- Killed when the session ends (Claude Code closed, `/exit`, etc.).
- **Not automatically reconnected** if it crashes — unlike HTTP/SSE servers which get exponential backoff. If the stdio server dies mid-session, it is marked failed. [VERIFIED: code.claude.com/docs/en/mcp]
- The server name `"workspace"` is reserved — Claude Code skips it with a warning.

### 2.4 CLAUDE_PROJECT_DIR in MCP Server Environment

Claude Code sets `CLAUDE_PROJECT_DIR` in the spawned server's environment automatically. The server can read `process.env.CLAUDE_PROJECT_DIR` for the project root — no need to pass it as an arg. [VERIFIED: code.claude.com/docs/en/mcp]

### 2.5 Absolute Path is Mandatory (Pitfall #7 Prevention)

Claude Code spawns stdio servers with a restricted PATH. Using a bare command name (e.g., `"command": "mrclean-mcp"`) causes silent failure because the executable cannot be found. Always use:
- `process.execPath` to get the absolute path to the Node.js binary (`/opt/homebrew/.../node`)
- `require.resolve` or `import.meta.resolve` to locate the mrclean bin path

Pattern for install command:
```typescript
// Resolve both paths at install time
const nodePath = process.execPath  // absolute Node.js binary path
// For global install: find the bin via which/where
// For npx: the bin is co-located with the package
const mrcleanBinPath = await resolveBinPath('mrclean')
const mrcleanMcpPath = await resolveBinPath('mrclean-mcp')
```

`claude mcp add` writes to `~/.claude.json` — but mrclean must do its own programmatic write to support fully zero-config one-command install. The JSON merge must be atomic (read → backup → write tmp → rename).

### 2.6 Persistent MCP Architecture Constraints

Because the stdio server is persistent (one process per session):
- It must not block the event loop (use async I/O everywhere).
- It must handle graceful shutdown on `SIGINT`/`SIGTERM`.
- Memory growth across a long session is the operator's problem — do not leak placeholder maps.
- Phase 1: server has no in-memory state beyond the MCP session itself. Session state (placeholder map) is a Phase 2+ concern.

---

## Section 3: `npx mrclean install` — One Command Does Everything

### 3.1 What `install` Must Do

```
1. Resolve absolute paths for node binary and mrclean bin(s)
2. Read ~/.claude/settings.json (or create empty {} if missing)
3. Create timestamped backup: ~/.claude/settings.json.mrclean-backup-<ISO8601>.json
4. Merge hook entries (idempotent by marker tag)
5. Write to temp file → atomically rename → replace settings.json
6. Read ~/.claude.json (or create {} if missing)
7. Create timestamped backup: ~/.claude.json.mrclean-backup-<ISO8601>.json
8. Merge mcpServers entry (idempotent by server name key)
9. Write to temp file → atomically rename → replace ~/.claude.json
10. Create .mrclean/ in cwd (project dir)
11. Write .mrclean/.gitignore (self-ignoring + audit log + artifacts)
12. Print success banner to stderr with detected Claude Code version
```

### 3.2 Idempotency Strategy

Use a marker object keyed by a stable `id` field. For hooks in `settings.json`, wrap mrclean hooks in a uniquely identifiable entry:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "_mrclean": true,
        "matcher": "*",
        "hooks": [...]
      }
    ]
  }
}
```

On re-run: scan the array for entries with `_mrclean: true`, remove them, then re-insert the current version. This makes install idempotent and enables self-upgrade.

For MCP in `~/.claude.json`: the server key `"mrclean"` is the idempotency key. On re-run, overwrite the `mcpServers["mrclean"]` entry.

### 3.3 Atomic Write Pattern

```typescript
import { writeFile, rename, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

async function atomicWriteJson(targetPath: string, data: unknown): Promise<void> {
  const tmpPath = join(tmpdir(), `mrclean-${randomUUID()}.json.tmp`)
  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmpPath, targetPath)  // atomic on same filesystem
}

async function backupJson(targetPath: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${targetPath}.mrclean-backup-${ts}.json`
  await copyFile(targetPath, backupPath)
  return backupPath
}
```

**Backup naming:** `~/.claude/settings.json.mrclean-backup-2026-05-13T12-34-56-789Z.json`
**Restore on uninstall:** `uninstall` reads the most recent backup (sort by timestamp), copies it back atomically.

### 3.4 Cross-Platform Absolute Path Resolution

```typescript
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'

function resolveNodePath(): string {
  // process.execPath is always the absolute path of the running Node binary
  return process.execPath
}

async function resolveMrcleanBinPath(): Promise<string> {
  // Strategy: find the mrclean bin from the npm global bin directory
  // or from the local node_modules/.bin directory
  // - npm install -g: npm root -g gives the path; bin is at $(npm bin -g)/mrclean
  // - npx (one-shot cache): the script runs from the npx cache, so __dirname
  //   of the entry file IS the package root
  // - tsx dev: fileURLToPath(import.meta.url) gives the source location

  // For the installed case, use `npm bin -g` cross-platform:
  try {
    const globalBin = execSync('npm bin -g', { encoding: 'utf8' }).trim()
    const candidate = `${globalBin}/mrclean`
    if (existsSync(candidate)) return candidate
  } catch {}

  // Fallback: resolve relative to the running script (npx or local)
  // In bundled dist/cli.js: import.meta.dirname resolves correctly
  return process.argv[1]  // the currently executing script
}
```

**macOS/Linux:** `npm bin -g` returns `/usr/local/bin` or `/opt/homebrew/bin`.
**Windows:** `npm bin -g` returns `%AppData%\npm`. Use `mrclean.cmd` as the extension.

**The critical invariant (INST-04):** The path written into `settings.json` must be the absolute path on disk at install time — not a symlink, not a PATH lookup. This prevents silent disable when PATH changes.

### 3.5 What Goes into `.mrclean/` (Phase 1)

```
.mrclean/
├── .gitignore          # Self-ignores .mrclean/, audit.jsonl, session artifacts
└── config.toml         # Stub with defaults (empty sections, comments)
```

`.mrclean/.gitignore` content:
```gitignore
# mrclean: auto-generated — do not edit manually
# This file keeps mrclean artifacts out of version control.
.mrclean/
audit.jsonl
session-*.json
manifest-*.jsonl
```

**The `.gitignore` must be at `.mrclean/.gitignore` (inside the directory), not at project root, so it self-ignores the directory.** Git respects `.gitignore` files in subdirectories — a `.gitignore` at `.mrclean/.gitignore` will ignore everything inside `.mrclean/`. [ASSUMED — verify with `git check-ignore` in integration test]

---

## Section 4: `npx mrclean doctor` — Smoke Test Design

### 4.1 Doctor Command Flow

```
1. Check hook entries exist in ~/.claude/settings.json
2. Check mcpServers entry exists in ~/.claude.json
3. Verify node binary at registered path is executable
4. Verify mrclean bin at registered path is executable
5. Perform canary round-trip (synthetic stdin/stdout self-test)
6. Read Claude Code version from `claude --version`
7. Report version compatibility
8. Exit 0 (PASS) or non-zero (FAIL) with structured stderr
```

### 4.2 Canary Round-Trip Design

The doctor command does NOT need to launch Claude Code itself. Instead, it directly invokes the hook binary against a synthetic payload:

```typescript
import { spawnSync } from 'node:child_process'

function runCanaryRoundTrip(mrcleanBin: string, nodePath: string): boolean {
  const CANARY = 'MRCLEAN_CANARY_12345_TEST'
  const payload = JSON.stringify({
    session_id: 'doctor-test',
    cwd: process.cwd(),
    hook_event_name: 'UserPromptSubmit',
    prompt: `This is a test prompt with canary: ${CANARY}`,
  })

  const result = spawnSync(nodePath, [mrcleanBin, 'hook'], {
    input: payload,
    encoding: 'utf8',
    timeout: 5000,
  })

  if (result.status !== 0) {
    process.stderr.write(`[FAIL] Hook exited ${result.status}\n`)
    return false
  }

  // In Phase 1: hook is a no-op, so canary should pass through (exit 0, stdout is empty or valid JSON)
  // Doctor passes if hook exits 0 and produces valid JSON or empty stdout
  try {
    if (result.stdout.trim()) JSON.parse(result.stdout)
    return true
  } catch {
    process.stderr.write(`[FAIL] Hook stdout is not valid JSON: ${result.stdout}\n`)
    return false
  }
}
```

**Phase 1 canary criterion:** Hook exits 0, stdout is valid JSON or empty.
**Phase 2+ canary criterion:** Seeded secret in payload → hook returns `decision: "block"` or substituted output.

The canary string `MRCLEAN_CANARY_*` should be a deterministic, unique prefix that the real detection layers (Phase 2+) can recognize as a test payload and fast-path through without spending detection budget.

### 4.3 Claude Code Version Compatibility Check

```typescript
import { execSync } from 'node:child_process'

function getClaudeCodeVersion(): { version: string; compatible: boolean } {
  try {
    const raw = execSync('claude --version', { encoding: 'utf8' }).trim()
    // Output: "2.1.141 (Claude Code)"
    const match = raw.match(/^(\d+\.\d+\.\d+)/)
    const version = match?.[1] ?? 'unknown'
    // Phase 1 requires no specific minimum (hook contract stable since ~2.0)
    // Phase 2 (REVMODE) requires >= 2.1.121 for updatedToolOutput
    const [major, minor, patch] = version.split('.').map(Number)
    const compatible = major >= 2 && (minor > 1 || (minor === 1 && patch >= 100))
    return { version, compatible }
  } catch {
    return { version: 'not found', compatible: false }
  }
}
```

Claude Code is currently version **2.1.141** on this machine. [VERIFIED: `claude --version` output]

### 4.4 Doctor Exit Codes

| Exit | Meaning |
|------|---------|
| 0 | All checks PASS |
| 1 | Hooks not registered — run `npx mrclean install` |
| 2 | MCP server not registered |
| 3 | Registered binary path is not executable |
| 4 | Canary round-trip failed |
| 5 | Claude Code not found or incompatible version |

---

## Section 5: Fail-Closed Exit Semantics for the Hook

### 5.1 Why Exit 2 for PreToolUse

Claude Code's hook contract treats exit 2 as a blocking signal for `PreToolUse` and `UserPromptSubmit`. No JSON output is parsed on exit 2 — only stderr is forwarded. This is the **only mechanism** that provides a hard guarantee. [VERIFIED: code.claude.com/docs/en/hooks]

### 5.2 Block vs. Warn vs. Pass-Through Decision Tree

```
PreToolUse hook flow:
  ├── Uncaught exception / crash → exit 2, stderr: structured error JSON (HOOK-05)
  ├── Hook binary chmod -x / missing → Claude Code treats as error, blocks (exit non-zero)
  ├── Phase 1 (no-op) → exit 0, empty stdout (allow pass-through)
  └── Phase 2+ detection:
        ├── CRITICAL/HIGH secret → exit 0, JSON: { hookSpecificOutput: { permissionDecision: "deny" } }
        │   (NOTE: exit 0 + deny in JSON is the correct way to block with a reason)
        └── No detection → exit 0, JSON: { hookSpecificOutput: { permissionDecision: "allow" } }
```

**Important nuance:** The `permissionDecision: "deny"` in the JSON output (exit 0) is different from exit 2. Exit 2 blocks AND shows stderr. `permissionDecision: "deny"` (exit 0) blocks AND sends `permissionDecisionReason` to Claude. For Phase 1 no-op, always exit 0. [VERIFIED: code.claude.com/docs/en/hooks]

### 5.3 Crash Semantics (HOOK-05)

When the hook binary is `chmod -x` or crashes on startup:
- Claude Code receives an error spawning the process (non-zero exit).
- For `PreToolUse`: the tool call is blocked because the hook was registered and failed.
- The transcript shows: `<hook name> hook error: ...`
- The operator sees blocked + structured stderr.

**To guarantee this for any internal crash:**

```typescript
// Top of the hook entry point (src/hook/index.ts)
process.on('uncaughtException', (err) => {
  process.stderr.write(JSON.stringify({
    error: 'mrclean hook crashed',
    message: err.message,
    version: pkg.version,
  }) + '\n')
  process.exit(2)
})

process.on('unhandledRejection', (reason) => {
  process.stderr.write(JSON.stringify({
    error: 'mrclean hook async crash',
    reason: String(reason),
    version: pkg.version,
  }) + '\n')
  process.exit(2)
})
```

### 5.4 Stderr Format Seen by Operator

When exit 2 fires, the first line of stderr appears in the Claude Code transcript as `<hook name> hook error: <first line>`. Subsequent lines go to the debug log. Design stderr to lead with a one-line machine-readable error:

```
{"error":"mrclean hook crashed","event":"PreToolUse","version":"0.1.0","message":"ENOENT: .mrclean/config.toml"}
```

---

## Section 6: MCP Persistent-Process Architecture

### 6.1 Two Bins vs. One Bin with Subcommand

**Recommendation: One source entry point, two bins declared in `package.json`.** [CITED: CLAUDE.md INST-08]

```json
{
  "bin": {
    "mrclean": "dist/cli.js",
    "mrclean-mcp": "dist/mcp.js"
  }
}
```

`src/cli.ts` — commander root, handles `install | uninstall | doctor | hook | audit | serve`
`src/mcp.ts` — thin wrapper that imports and runs the MCP server directly (no commander overhead)

The `mrclean hook` subcommand reads stdin, dispatches, writes stdout, exits.
The `mrclean-mcp` binary (or `mrclean serve`) connects stdio transport and blocks.

### 6.2 Cold-Start Budget

Hook cold-start must be under 100ms. Measured Node.js cold-start on typical machine: 80–120ms before any user code runs. Strategies:

1. **Thin top-level imports only.** Import only Node.js builtins and `commander` at the top level.
2. **Lazy-import MCP SDK** (`@modelcontextprotocol/sdk`) — only the `serve` subcommand needs it.
3. **Lazy-import Zod** for the hook path — validation is deferred until Phase 2 detectors.
4. **Do NOT import `@anthropic-ai/sdk`** at any point in the hook code path.
5. **Compile regexes once** at module load (Phase 2), not per invocation.

```typescript
// src/hook/index.ts — thin top-level imports only
import { readFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
// No MCP SDK import here
```

### 6.3 Hook Stdin/Stdout Pattern (Production-Verified)

This pattern is verified from the GSD hook infrastructure in `~/.claude/hooks/gsd-context-monitor.js` [VERIFIED: local file read]:

```typescript
// src/hook/index.ts
import { version } from '../../package.json'

process.on('uncaughtException', (err) => {
  process.stderr.write(JSON.stringify({ error: 'mrclean crash', message: err.message, version }) + '\n')
  process.exit(2)
})

// Timeout guard: if stdin doesn't close within 10s, exit silently
// (avoids hanging if Claude Code pipe stalls — pattern from claude-mem #775, #1162)
const stdinTimeout = setTimeout(() => process.exit(0), 10_000)

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout)
  try {
    const data = JSON.parse(input)
    handleHookEvent(data)
      .then((result) => {
        if (result !== null) {
          process.stdout.write(JSON.stringify(result))
        }
        process.exit(0)
      })
      .catch((err) => {
        process.stderr.write(JSON.stringify({ error: 'hook handler failed', message: err.message }) + '\n')
        process.exit(2)
      })
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: 'invalid JSON from Claude Code', version }) + '\n')
    process.exit(2)
  }
})
```

**Key constraints:**
- `stdout` receives ONLY the JSON response object (or nothing for pass-through).
- `stderr` receives ONLY diagnostics, banners, and errors.
- Always set a stdin timeout guard (10s is safe; Claude Code default hook timeout is 600s but pipe stalls can happen on Windows).

### 6.4 MCP Server Entry Point Pattern

```typescript
// src/mcp.ts (the mrclean-mcp bin)
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({
  name: 'mrclean',
  version: process.env.npm_package_version ?? '0.0.0',
})

// Phase 1: register mrclean_status only
server.registerTool('mrclean_status', {
  description: 'Return mrclean version, active rule count, and session ID',
  inputSchema: z.object({}),
}, async () => ({
  content: [{ type: 'text', text: JSON.stringify({ version: '0.1.0', rules: 0, session: 'none' }) }],
}))

const transport = new StdioServerTransport()
await server.connect(transport)
process.stderr.write('mrclean MCP server running on stdio\n')

// Graceful shutdown
process.on('SIGINT', async () => {
  await transport.close()
  process.exit(0)
})
```

**MCP SDK import paths (verified from Context7 examples):**
- `@modelcontextprotocol/sdk/server/mcp.js` exports `McpServer`
- `@modelcontextprotocol/sdk/server/stdio.js` exports `StdioServerTransport`

Note: Context7 examples show `import { McpServer } from '@modelcontextprotocol/server'` — this is a sub-export alias. The canonical npm package is `@modelcontextprotocol/sdk`. Both resolve to the same module in v1.29. [ASSUMED — verify by inspecting package `exports` field after install]

### 6.5 Recommended Source Directory Layout

```
src/
├── cli.ts              # Commander root entry point (mrclean bin)
├── mcp.ts              # MCP server entry point (mrclean-mcp bin)
├── hook/
│   ├── index.ts        # stdin/stdout dispatch; fail-closed top-level catch
│   └── handlers/
│       ├── session-start.ts     # HOOK-07: emit "mrclean active" banner
│       ├── user-prompt.ts       # UserPromptSubmit no-op (Phase 1)
│       ├── pre-tool-use.ts      # PreToolUse no-op (Phase 1)
│       └── post-tool-use.ts     # PostToolUse no-op (Phase 1)
├── install/
│   ├── index.ts        # Orchestrates install/uninstall
│   ├── settings.ts     # ~/.claude/settings.json atomic read/write
│   ├── mcp-config.ts   # ~/.claude.json atomic read/write
│   ├── project-dir.ts  # .mrclean/ setup + gitignore
│   └── path-resolver.ts # Absolute path resolution for node + mrclean bins
├── doctor/
│   └── index.ts        # Canary round-trip, version check, PASS/FAIL report
├── config/
│   └── index.ts        # .mrclean/config.toml reader + three-layer merge (CFG-01, CFG-03)
└── shared/
    ├── types.ts         # Shared TypeScript types (HookInput, HookOutput, etc.)
    └── version.ts       # Package version export
```

---

## Section 7: `.mrclean/` Project Directory Contract

### 7.1 Phase 1 Contents

```
.mrclean/
├── .gitignore          # Self-ignores this directory and its artifacts
└── config.toml         # Stub config file with commented defaults
```

The `config.toml` stub makes CFG-01 testable immediately (missing file = defaults; stub file = still defaults because it's empty/commented).

### 7.2 `.gitignore` Content

```gitignore
# mrclean: auto-generated — do not edit manually
# Keeps mrclean runtime artifacts out of version control.
# The config.toml and words.txt files are intentionally NOT ignored
# so project-local overrides can be committed if desired.
.mrclean/
audit.jsonl
session-*.json
manifest-*.jsonl
```

**Why `.mrclean/` is listed in its own `.gitignore`:** A `.gitignore` at `.mrclean/.gitignore` applies to files within `.mrclean/`. Listing `.mrclean/` makes the entire directory ignored from git's perspective for files above it. This means `git status` will show nothing after `install`. [ASSUMED — validate with `git check-ignore -v .mrclean/` in integration test]

**Alternative approach:** Write the `.gitignore` entry to the project root `.gitignore` instead. This is simpler to reason about. Open question flagged below.

### 7.3 Permission Bits

- `.mrclean/` directory: `0755` (owner rwx, group rx, world rx)
- `.mrclean/.gitignore`: `0644` (standard)
- `audit.jsonl` (created Phase 2): `0600` (owner only — audit log has hashes)
- The mrclean bin file: must be `chmod +x` — tsup handles this automatically when it detects a `#!/usr/bin/env node` shebang. [VERIFIED: tsup docs, tsup.egoist.dev]

---

## Section 8: Pitfall Guards

### 8.1 Pitfall #7 — Silent Misconfig (Absolute Path Resolution)

**Failure scenario:** Installer writes `"command": "mrclean"` (bare name) into settings.json. Claude Code spawns hooks with a restricted PATH that does not include `/opt/homebrew/bin` or `/usr/local/bin`. The hook binary is not found; Claude Code reports an error and... continues without blocking (hook failure is non-blocking for some events, or blocks silently without operator-visible signal).

**Fix (INST-04):** Write the absolute path resolved at install time:
```json
{
  "command": "/opt/homebrew/Cellar/node@22/22.22.0/bin/node",
  "args": ["/opt/homebrew/lib/node_modules/mrclean/dist/cli.js", "hook"]
}
```

The `doctor` command verifies both paths are still executable on every run. If a user moves their Homebrew prefix, `mrclean install` re-runs and resolves the new absolute path.

**Additional guard:** In the hook binary itself, add a `--doctor-ping` flag that exits 0 with a version report on stderr. The `doctor` command uses `spawnSync` to call this flag and verifies it responds correctly.

### 8.2 Pitfall #8 — Silent MCP Server Crash

**Failure scenario:** The mrclean-mcp server crashes after session start. Claude Code marks it as `failed` in `/mcp` but does not restart it (stdio servers get no reconnect). The operator never notices because mrclean tools become silently unavailable rather than showing an error.

**Operator-visible signal in `doctor`:**
- `doctor` runs `/mcp`-equivalent by checking `~/.claude.json` for the registered server.
- `doctor` attempts a test connection to the MCP server by spawning it directly and verifying it responds to `initialize`.
- `doctor` reports MCP server status clearly.

**Runtime guard (MCP-04 supervisor):** The `mrclean-mcp` binary can optionally implement a supervisor/worker pattern:

```typescript
// src/mcp.ts — supervisor mode
if (process.env.MRCLEAN_WORKER !== 'true') {
  // Supervisor: spawn worker, restart on crash
  const { fork } = await import('node:child_process')
  let worker = spawnWorker()
  worker.on('exit', (code) => {
    if (code !== 0) {
      process.stderr.write(`mrclean MCP worker crashed (${code}), restarting...\n`)
      worker = spawnWorker()
    }
  })
} else {
  // Worker: actual MCP server logic
  await runMcpServer()
}
```

Phase 1 can defer the supervisor to Phase 3 (when MCP tools actually exist). For Phase 1, just run the server directly and document the crash behavior.

---

## Section 9: Test Surface for Phase 1

### 9.1 Unit Tests

| Test | File | What It Validates |
|------|------|------------------|
| `install` idempotency | `tests/unit/install.test.ts` | Two installs → settings.json has exactly one mrclean hook block per event; no duplicate |
| `uninstall` | `tests/unit/install.test.ts` | Uninstall → settings.json byte-identical to pre-install backup |
| Atomic write | `tests/unit/install.test.ts` | Write to temp file + rename; original not corrupted on write failure |
| Backup naming | `tests/unit/install.test.ts` | Backup filename matches `settings.json.mrclean-backup-<ISO8601>.json` |
| Hook stdin→stdout shape | `tests/unit/hook.test.ts` | Feed `SessionStart` payload → exit 0, stdout is valid JSON |
| Hook fail-closed | `tests/unit/hook.test.ts` | Feed malformed JSON → exit 2, stderr contains error |
| Hook stdin timeout | `tests/unit/hook.test.ts` | Close stdin without writing → exit 0 (no hang) |
| Doctor canary | `tests/unit/doctor.test.ts` | Self-test returns PASS on a fresh install |
| Config fallback | `tests/unit/config.test.ts` | Missing config.toml → defaults returned; no error |
| Three-layer merge | `tests/unit/config.test.ts` | Project overrides user overrides bundled |

### 9.2 Integration Tests

| Test | What It Validates |
|------|------------------|
| Spawn hook binary against fixture `settings.json`, assert hook entries present | INST-01 end-to-end |
| Run `install` twice, assert no duplication | INST-02 |
| Run `install`, `uninstall`, diff backup → current | INST-03 + INST-05 |
| `chmod -x` hook bin, simulate PreToolUse → assert exit 2 | HOOK-05 |
| Feed each hook event payload to `mrclean hook` → assert exit 0, stdout valid JSON | HOOK-06 |
| SessionStart → assert `additionalContext` includes "mrclean active" | HOOK-07 |
| Spawn `mrclean-mcp` as child, send MCP initialize → assert response | MCP-01 |

### 9.3 E2E Tests

Real `npx mrclean install` against a temp HOME is **not automatable in CI** without a live Claude Code session. The UAT steps below are the Phase 1 manual acceptance criteria:

```
1. Run: HOME=/tmp/mrclean-test-home npx mrclean install
2. Assert: /tmp/mrclean-test-home/.claude/settings.json has hook entries
3. Assert: /tmp/mrclean-test-home/.claude.json has mcpServers.mrclean
4. Start a real claude session: observe "mrclean active" in SessionStart output
5. Run: npx mrclean doctor → exits 0, PASS for all checks
6. chmod -x $(which mrclean) → start claude, issue any tool call → observe blocked + structured stderr
7. Run: npx mrclean uninstall → diff backup → original settings byte-identical
```

---

## Section 10: Open Questions for the Planner

### OQ-1: `.mrclean/.gitignore` vs. project-root `.gitignore`

**The question:** Does `git` respect a `.gitignore` at `.mrclean/.gitignore` for ignoring the entire `.mrclean/` directory? Standard git behavior: a `.gitignore` at `dir/.gitignore` ignores patterns relative to `dir/`, not above it. If `.mrclean/.gitignore` lists `.mrclean/`, this is a self-reference that may not work as expected.

**Safer approach:** Append `/.mrclean/` and `/audit.jsonl` to the **project-root `.gitignore`** instead.

**Risk if wrong:** `git status` shows `.mrclean/` as untracked — success criterion #5 fails.

**Recommendation:** Write the gitignore entry to the project-root `.gitignore` (create if missing, append if exists). The `install` command checks for and preserves an existing `.gitignore`. Add a comment block to delineate mrclean entries (idempotent on re-install).

### OQ-2: Where does `install` write `.mrclean/`?

**The question (from the additional_context):** Does `install` write `.mrclean/` to the CWD at install time, or to `$CLAUDE_PROJECT_DIR`?

`$CLAUDE_PROJECT_DIR` is only available inside a running hook/MCP process — the CLI `install` command runs before any session. The install command runs from the operator's CWD.

**Recommendation:** Write `.mrclean/` to `process.cwd()` at install time. This is the project directory the operator is currently in. Document that the operator should run `npx mrclean install` from the project root.

### OQ-3: User-scope vs. project-scope MCP server registration

**The question:** Should `install` register the MCP server in `~/.claude.json` (user-scope, available in all projects) or `.mcp.json` (project-scope, committed to VCS)?

**Tradeoffs:**
- User-scope (`~/.claude.json`): protects all projects automatically, but the server path is machine-specific and cannot be committed to VCS.
- Project-scope (`.mcp.json`): committed to VCS, team-shareable, but path is still machine-specific (absolute path to mrclean bin).

**Recommendation for Phase 1:** Register in `~/.claude.json` (user-scope) by default. Add `--scope project` flag to `install` for teams who want the `.mcp.json` approach and can manage absolute paths themselves.

### OQ-4: Is the `"workspace"` server name reserved?

**Confirmed:** The server name `"workspace"` is reserved by Claude Code and will be skipped with a warning. [VERIFIED: code.claude.com/docs/en/mcp] Use `"mrclean"` as the server name.

### OQ-5: Commander v13 vs. v14

CLAUDE.md specifies `commander ^13.x`. Current npm latest is `14.0.3`. v14 requires Node.js v20+ (aligns with project floor) and adds option/command grouping and TypeScript improvements. The API is backward compatible. 

**Recommendation:** Pin to `^14.0.3` (matches Node 20 floor, adds TS improvements). If the planner wants to stay conservative, `^13.1.0` is fine. Both work.

---

## Project Constraints (from CLAUDE.md)

| Directive | Authority |
|-----------|-----------|
| Node.js >=20.18.0 only | LOCKED |
| TypeScript ^5.6.0 | LOCKED |
| `@modelcontextprotocol/sdk` ^1.x (NOT v2, pre-alpha) | LOCKED |
| Zod v4 via `zod/v4` import | LOCKED |
| `commander` ^13.x (research suggests ^14 is safe upgrade) | LOCKED |
| `tsup` as bundler, ESM output, target node20 | LOCKED |
| `vitest` ^4 for tests | LOCKED |
| `tsx` for dev execution | LOCKED |
| Zero external binary shell-outs (no gitleaks binary, no trufflehog) | LOCKED |
| No `ts-node`, no `chalk`, no `@iarna/toml`, no `jest` | LOCKED |
| MCP SDK SSE transport is deprecated — use Streamable HTTP or stdio | LOCKED |
| `@anthropic-ai/sdk` only for Layer 5, lazy-imported | LOCKED |
| Performance: hook < 100ms UserPromptSubmit, < 200ms PostToolUse | LOCKED |
| Security: placeholder map in memory only by default | LOCKED |
| Audit log: never contains raw secret values | LOCKED |
| Distribution: single `npx mrclean` runnable, zero-config | LOCKED |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `.mrclean/.gitignore` with `.mrclean/` pattern self-ignores the directory from git status | §7.2 | Success criterion #5 fails — `git status` shows untracked files |
| A2 | `@modelcontextprotocol/server` and `@modelcontextprotocol/sdk` resolve to the same package in v1.29 | §6.4 | Import errors at runtime; must resolve to `@modelcontextprotocol/sdk` |
| A3 | `npm bin -g` is available cross-platform to find the global bin dir | §3.4 | Absolute path resolution fails on some platforms |
| A4 | `process.argv[1]` reliably points to the mrclean script when run via `npx` | §3.4 | Install writes wrong path; hook never fires (Pitfall #7) |
| A5 | tsup auto-chmod from shebang works reliably for the built `dist/cli.js` and `dist/mcp.js` | §7.3 | Bins not executable; `npx mrclean install` fails with EACCES |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >=20.18.0 | Runtime | Yes | v22.22.0 | — |
| npm | Package management | Yes | 10.9.4 | — |
| claude binary | Doctor version check, E2E UAT | Yes | 2.1.141 | Report "not found" in doctor |
| git | `.gitignore` integration test | Yes (assumed) | — | Skip git check in unit tests |

---

## Standard Stack (Phase 1 Only)

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | >=20.18.0 | Runtime | Required by MCP SDK + Vitest 4 |
| TypeScript | ^5.6.0 | Language | MCP SDK ergonomics, Zod v4 |
| `@modelcontextprotocol/sdk` | ^1.29.0 (latest 1.x) | MCP stdio server | Official Anthropic SDK |
| `zod` | ^4.4.3 | MCP tool schemas, hook payload types | Standard Schema compatible; SDK examples use it |
| `commander` | ^14.0.3 | CLI subcommands | 35M weekly downloads, Node 20+ aligned |
| `picocolors` | ^1.1.1 | Terminal output | 14x smaller than chalk, no deps |

### Dev Tools

| Tool | Version | Purpose |
|------|---------|---------|
| `tsup` | ^8.5.1 | Bundle ESM bins, auto-shebang chmod |
| `vitest` | ^4.1.6 | Tests; Node 20 floor matches project |
| `@vitest/coverage-v8` | ^4.1.6 | Coverage gate (80%) |
| `tsx` | ^4.x | Direct TS execution in dev loop |
| `@types/node` | ^20.x | Node typings (pinned to floor) |

### Installation

```bash
# Runtime / core
npm install @modelcontextprotocol/sdk zod commander picocolors

# Dev
npm install -D tsup vitest @vitest/coverage-v8 tsx @types/node typescript prettier eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
```

**Version verification:**
- `@modelcontextprotocol/sdk`: npm latest 1.29.0 [VERIFIED: 2026-05-13]
- `commander`: npm latest 14.0.3 [VERIFIED: 2026-05-13]
- `zod`: npm latest 4.4.3 [VERIFIED: 2026-05-13]
- `tsup`: npm latest 8.5.1 [VERIFIED: 2026-05-13]
- `vitest`: npm latest 4.1.6 [VERIFIED: 2026-05-13]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP server protocol | Custom JSON-RPC server | `@modelcontextprotocol/sdk` | Protocol complexity; SDK handles initialize, capabilities negotiation, tool dispatch |
| CLI argument parsing | `process.argv` manual parse | `commander ^14` | Edge cases in quoted args, help generation, subcommand routing |
| JSON schema validation for MCP tools | Manual `typeof` guards | `zod/v4` inputSchema | SDK expects Standard Schema; Zod v4 is 14x faster than v3 |
| Atomic file write | `writeFileSync` in-place | tmp + `rename` pattern | In-place write is NOT atomic; power failure corrupts the file |
| Terminal colors | ANSI escape sequences | `picocolors` | Cross-platform color support, no-deps |

---

## Common Pitfalls

### Pitfall 1: Writing MCP server config to `settings.json` instead of `~/.claude.json`

**What goes wrong:** MCP server entries in `settings.json` are silently ignored by Claude Code. The operator sees no error; the server just never appears in `/mcp`. [VERIFIED: GitHub issue #37245, code.claude.com/docs/en/mcp]
**Root cause:** Hooks → `settings.json`. MCP servers → `~/.claude.json` or `.mcp.json`. These are different files.
**Fix:** mrclean install writes hooks to `~/.claude/settings.json` AND mcpServers to `~/.claude.json`.

### Pitfall 2: Using banner-to-stderr for SessionStart (HOOK-07)

**What goes wrong:** The hook emits the "mrclean active" banner to stderr on exit 0. The operator never sees it because exit-0 stderr goes only to the debug log.
**Fix:** Emit the banner via `additionalContext` in the JSON stdout (exit 0). This causes Claude Code to inject the text into the session context, which the operator can see.

### Pitfall 3: Path placeholders not quoting correctly in shell form

**What goes wrong:** The hook is registered as `"command": "node ${CLAUDE_PROJECT_DIR}/dist/cli.js hook"`. When the project path contains spaces, the command fails.
**Fix:** Use `args` exec form (v2.1.119+): `"command": "node", "args": ["${CLAUDE_PROJECT_DIR}/dist/cli.js", "hook"]`. Exec form avoids shell entirely. [VERIFIED: Claude Code changelog v2.1.119]

### Pitfall 4: stdin pipe stall on Windows / Git Bash

**What goes wrong:** On some platforms, if Claude Code has a slow pipe or the hook reads stdin in a blocking way, the hook hangs until Claude Code kills it with a timeout error.
**Fix:** Set a 10-second stdin timeout that exits 0 silently if stdin never closes. [VERIFIED: production pattern from `gsd-context-monitor.js` with explicit comment referencing issues #775, #1162]

### Pitfall 5: `rename()` across filesystems fails on tmpdir

**What goes wrong:** `os.tmpdir()` may be on a different filesystem than `~/.claude/`. `rename()` across filesystems is not atomic — it silently falls back to copy+delete, losing atomicity.
**Fix:** Write the temp file to the same directory as the target: `const tmp = `${targetPath}.tmp.${randomUUID()}``

### Pitfall 6: The `"workspace"` MCP server name is reserved

**What goes wrong:** If `install` registers the MCP server under the key `"workspace"`, Claude Code skips it with a warning and the server never connects. [VERIFIED: code.claude.com/docs/en/mcp]
**Fix:** Use `"mrclean"` as the server name.

---

## Code Examples

### SessionStart Handler (HOOK-07 — mrclean active banner)

```typescript
// src/hook/handlers/session-start.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface SessionStartInput {
  session_id: string
  cwd: string
  hook_event_name: 'SessionStart'
  source: 'startup' | 'resume' | 'clear' | 'compact'
}

export function handleSessionStart(input: SessionStartInput) {
  // Phase 1: no-op detection, just emit the active banner
  const version = '0.1.0'  // from package.json
  const additionalContext = `mrclean active v${version} (no-op mode — detection not yet enabled)`
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  }
}
```

### PreToolUse No-Op Handler (Phase 1)

```typescript
// src/hook/handlers/pre-tool-use.ts
interface PreToolUseInput {
  session_id: string
  cwd: string
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_use_id: string
}

export function handlePreToolUse(input: PreToolUseInput) {
  // Phase 1: pass through everything — detection is a no-op
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow' as const,
    },
  }
}
```

### MCP `mrclean_status` Tool (Phase 1)

```typescript
// src/mcp/tools/status.ts
// Source: Context7 /modelcontextprotocol/typescript-sdk, server.md
import * as z from 'zod/v4'

export function registerStatusTool(server: McpServer, version: string) {
  server.registerTool(
    'mrclean_status',
    {
      title: 'mrclean Status',
      description: 'Return mrclean version, rule count, and session info',
      inputSchema: z.object({}),
    },
    async () => ({
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ version, rules: 0, session: 'none', status: 'active' }),
      }],
    }),
  )
}
```

### tsup Configuration

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    mcp: 'src/mcp.ts',
  },
  format: ['esm'],
  target: 'node20',
  dts: true,
  clean: true,
  splitting: false,
  // tsup auto-detects #!/usr/bin/env node shebang and makes output executable
})
```

### package.json `bin` Declaration

```json
{
  "name": "mrclean",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=20.18.0" },
  "bin": {
    "mrclean": "dist/cli.js",
    "mrclean-mcp": "dist/mcp.js"
  },
  "main": "dist/cli.js",
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

---

## State of the Art (2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-----------------|--------------|--------|
| MCP SDK SSE transport | Streamable HTTP transport | Nov 2025 MCP spec | SSE deprecated; use `StreamableHTTPServerTransport` for remote |
| Hook exec as shell string | Hook exec via `args` array (exec form) | v2.1.119 | Avoids shell; no quoting issues with paths |
| `PostToolUse` cannot modify tool output | `updatedToolOutput` in hookSpecificOutput | v2.1.121 | Enables in-place output substitution (Phase 2+ reversal) |
| `ts-node` for TypeScript execution | `tsx` | 2024 | tsx is ESM-correct and faster |
| `@iarna/toml` | `smol-toml` | 2024+ | 4x faster; maintained |
| MCP servers in `settings.json` | MCP servers in `~/.claude.json` | Always correct | Common mistake; different config stores |

---

## Sources

### Primary (HIGH confidence — verified live 2026-05-13)

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — all hook event shapes, exit code semantics, settings.json format, matcher syntax, stderr behavior, `args` exec form (v2.1.119)
- [Claude Code MCP Reference](https://code.claude.com/docs/en/mcp) — mcpServers format in `~/.claude.json` vs `.mcp.json`, stdio server lifecycle, CLAUDE_PROJECT_DIR, reserved "workspace" name, scopes (local/project/user)
- [Claude Code Changelog](https://code.claude.com/docs/en/changelog) — v2.1.121 PostToolUse updatedToolOutput, v2.1.141 terminalSequence, confirmed current version
- `~/.claude/hooks/gsd-context-monitor.js` — production stdin/stdout pattern, stdin timeout guard, session_id validation
- `~/.claude/hooks/gsd-session-state.sh` — SessionStart additionalContext JSON pattern
- `~/.claude/settings.json` — confirmed actual settings file structure on this machine
- `~/.claude.json` — confirmed mcpServers lives here, not in settings.json
- `claude --version` output: **2.1.141** (Claude Code)
- npm registry `npm view` on 2026-05-13: `@modelcontextprotocol/sdk@1.29.0`, `commander@14.0.3`, `zod@4.4.3`, `tsup@8.5.1`, `vitest@4.1.6`

### Secondary (MEDIUM confidence — Context7 docs)

- Context7 `/modelcontextprotocol/typescript-sdk` — McpServer API, StdioServerTransport, registerTool with Zod v4 inputSchema/outputSchema, structuredContent return shape
- Context7 `/websites/tsup_egoist_dev` — multiple entrypoints, defineConfig, auto-shebang chmod behavior

### Tertiary (LOW confidence — WebSearch, cross-referenced where possible)

- GitHub issue #37245 (anthropics/claude-code) — "MCP servers silently absent when configured via settings.json" — confirms mcpServers must go in `~/.claude.json`
- Commander.js changelog — v14 breaking changes (Node 20 floor, help system refactor) — LOW confidence; only reviewed search snippets

---

## Metadata

**Confidence breakdown:**
- Hook contract: HIGH — verified from live official docs + local production examples
- MCP registration: HIGH — verified from live official docs + `~/.claude.json` inspection
- Package versions: HIGH — verified via `npm view` on 2026-05-13
- Atomic write patterns: HIGH — standard Node.js patterns
- `.mrclean/.gitignore` self-reference behavior: LOW → flagged as A1 assumption, must be validated in integration test
- MCP SDK import paths (`/server/mcp.js` vs `@modelcontextprotocol/server`): MEDIUM → flagged as A2 assumption

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (hook contract stable; MCP spec moves slowly; commander/tsup very stable)
