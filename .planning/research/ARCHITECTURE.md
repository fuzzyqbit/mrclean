# Architecture Research

**Domain:** In-session AI-payload-redaction for Claude Code (hook + MCP integration)
**Researched:** 2026-05-13
**Confidence:** HIGH (hook contract verified against Anthropic CHANGELOG; MCP transports verified against current MCP spec)

---

## TL;DR

mrclean is **two parallel surfaces** sharing one core: (a) a hook adapter that Claude Code spawns per-event over stdin/stdout, and (b) an MCP server Claude can call as a tool. The architecturally-pivotal finding is that **Claude Code v2.1.121+ supports `hookSpecificOutput.updatedToolOutput` on PostToolUse for all tools** — meaning inbound tool-result redaction is contractually possible without a custom proxy. The other pivotal finding is that **`UserPromptSubmit` hooks cannot rewrite the prompt** — they can only block or append `additionalContext` (open feature requests #34390, #46761, #53330). Outbound redaction must therefore be expressed as **block + reason** for prompts and **`updatedInput`** for tool calls.

The single hardest design question — *where does the placeholder map live across hook invocations?* — has a clean answer driven by these constraints:

- **One-way mode** needs no cross-invocation state. Each hook is independent. No daemon required.
- **Reversible mode** needs the outbound substitution map to be readable by a later inbound `PostToolUse` hook in the same session. Since hooks are spawned fresh per event with **no shared memory**, state must be persisted somewhere. The right answer is a **per-session file under `~/.claude/mrclean/sessions/<session_id>.json`** keyed off the `session_id` field that every hook receives — *not* a sidecar daemon. A daemon adds IPC, lifecycle, and crash-recovery surface for marginal latency gains; file-backed state with `flock` is simpler, survives process crashes, and matches the patterns the wider hook ecosystem already uses (`disler/claude-code-hooks-mastery` does exactly this).

Build order: **Installer → Detection Engine (layers 1-4) → Hook Adapter (one-way) → MCP Server → Reversible mode (file-backed map) → Layer 5 LLM classifier.** Sidecar daemon is *not* on the critical path and may never be needed.

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Claude Code Process                           │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                       Event Bus                                  │ │
│  │  SessionStart  UserPromptSubmit  PreToolUse  PostToolUse        │ │
│  └────────┬─────────────┬─────────────────┬──────────────┬──────────┘ │
│           │             │                 │              │            │
│   spawns subprocess per event (cold start, parallel-safe)             │
└───────────┼─────────────┼─────────────────┼──────────────┼────────────┘
            │             │                 │              │
            ▼             ▼                 ▼              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  mrclean Hook Adapter (single bin)                   │
│   Reads JSON from stdin → routes by hook_event_name → writes JSON   │
│   to stdout. Cold start ~30-80ms (Node.js + module load).            │
│                                                                       │
│   ┌────────────┐  ┌─────────────────┐  ┌──────────────────────────┐ │
│   │ Hook Router│→ │ Config Loader   │→ │ Session State Adapter    │ │
│   │            │  │ (memoized in    │  │ (file lock + JSON r/w on │ │
│   │            │  │  warm v8 cache) │  │  ~/.claude/mrclean/...)  │ │
│   └─────┬──────┘  └─────────────────┘  └────────────┬─────────────┘ │
│         │                                            │               │
│         ▼                                            ▼               │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │                      Core Library (shared)                    │  │
│   │                                                               │  │
│   │  ┌────────────────────┐    ┌─────────────────────────────┐   │  │
│   │  │ Detection Engine   │    │ Placeholder Manager         │   │  │
│   │  │                    │    │                             │   │  │
│   │  │ L1: Regex pack     │    │ - substitute(text, matches) │   │  │
│   │  │ L2: Entropy        │    │ - allocate(value) → token   │   │  │
│   │  │ L3: .env values    │ →  │ - lookup(token) → value     │   │  │
│   │  │ L4: Word list      │    │ - persist(sessionId)        │   │  │
│   │  │ L5: LLM (opt-in)   │    │   [reversible mode only]    │   │  │
│   │  └─────────┬──────────┘    └──────────┬──────────────────┘   │  │
│   │            │                           │                      │  │
│   │            ▼                           ▼                      │  │
│   │  ┌──────────────────────────────────────────────────────┐    │  │
│   │  │  Audit Logger (append .mrclean/audit.jsonl)          │    │  │
│   │  │  rule_id, severity, sha256(value), session_id, ts    │    │  │
│   │  └──────────────────────────────────────────────────────┘    │  │
│   └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
            ▲                                           ▲
            │                                           │
            │ same Core Library (no IPC, in-process)    │
            │                                           │
┌───────────┴───────────────────────────────────────────┴──────────────┐
│              mrclean MCP Server (separate process)                   │
│   Long-lived, started by Claude Code via .mcp.json or settings.json  │
│   Transports: stdio (default), Streamable HTTP (--http opt-in)       │
│                                                                       │
│   Tools exposed:                                                      │
│     - redact(text, mode)        → returns sanitized text + map       │
│     - restore(text, sessionId)  → reverses placeholders for human    │
│     - audit_show(sessionId)     → returns recent audit entries       │
│     - block_term(term)          → adds runtime word to .mrclean      │
└──────────────────────────────────────────────────────────────────────┘
            ▲
            │
┌───────────┴────────────────────────────────────────────────────────┐
│                Installer CLI (`npx mrclean install`)                │
│   - Reads existing ~/.claude/settings.json (if any)                 │
│   - Deep-merges hook entries (idempotent; identifies own entries    │
│     by stable "name": "mrclean" marker)                             │
│   - Writes .mrclean/config.json template in project cwd             │
│   - Optionally registers MCP server in ~/.claude.json               │
│   - Prints "next steps" with detection-layer toggles                │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Talks to |
|-----------|----------------|----------|
| **Installer CLI** | One-shot: read+merge `~/.claude/settings.json`, register hook entries, optionally register MCP server, scaffold `.mrclean/` in project. Idempotent — safe to re-run. | Filesystem only |
| **Hook Adapter (bin)** | Single Node.js entrypoint Claude Code spawns per hook event. Reads JSON from stdin, routes by `hook_event_name`, calls into Core Library, writes JSON decision to stdout. | stdin/stdout, Core Library, Session State |
| **Hook Router** | Dispatches based on `hook_event_name` to per-event handlers. Each handler knows the input/output contract for that event. | Hook Adapter, event handlers |
| **Config Loader** | Loads `.mrclean/config.json` (project) merged over `~/.claude/mrclean/config.json` (user) merged over built-in defaults. Memoized per process (cold per hook spawn — that's fine). | Filesystem |
| **Detection Engine** | Pure function: `(text, config) → DetectedSpan[]`. Runs layers 1-4 always; layer 5 only when `--deep` and configured. No I/O, no state. Highly testable with golden fixtures. | Config Loader (read-only) |
| **Placeholder Manager** | Owns the substitution semantics: stable token format (`<MRCLEAN:KIND:NNN>`), collision-free allocation within a session, deterministic IDs (sha256 of value, truncated, monotonic per-kind suffix). In reversible mode, owns the in-memory `Map<token, original>` and serialization. | Session State Adapter (reversible only) |
| **Session State Adapter** | Reads/writes `~/.claude/mrclean/sessions/<session_id>.json` under `flock`. Map is plaintext on disk by default; opt-in encryption via `MRCLEAN_SESSION_KEY` env var. TTL'd (deleted on `SessionEnd` if hook fires; swept by installer on next run). | Filesystem, OS file locking |
| **Audit Logger** | Appends one JSON line per match to `.mrclean/audit.jsonl` in the project cwd. Never logs raw values — only `sha256(value)[:16]` + rule_id + severity + offset. Append-only, fsync per write. | Filesystem |
| **MCP Server** | Long-lived process Claude Code launches once per session via `.mcp.json`. Exposes the same Core Library as MCP tools for cases where the hook isn't enough (explicit redact-this-blob calls, audit queries, runtime word additions). Holds its own session-scoped state in memory. | stdio or Streamable HTTP, Core Library, Session State |

---

## The Pivotal Architectural Question: Where Does Session State Live?

This is the question that will define whether mrclean ships in a week or a quarter. The constraint chain:

1. **Claude Code spawns a fresh process for every hook event.** No in-memory persistence between events. Confirmed in the official hooks reference: *"Hooks spawn fresh for each event (no persistence between events)."*
2. **Reversible mode requires that the placeholder→original map written during outbound redaction (PreToolUse) is readable during inbound restoration (PostToolUse).** These are separate process invocations, sometimes seconds apart.
3. **Every hook receives `session_id`.** This is the natural correlation key.

There are three viable storage strategies. Pick exactly one for v1, plan for the third only if the second proves insufficient:

### Option A — File-backed per-session map (RECOMMENDED for v1)

**Where:** `~/.claude/mrclean/sessions/<session_id>.json`

**How:**
- PreToolUse handler: open file with exclusive `flock`, read existing map, merge new mappings, write atomically (write to `.tmp` then rename), release lock.
- PostToolUse handler: open file with shared `flock`, read map, run restoration, release lock. No write.
- SessionEnd handler (if registered): delete the file.
- Janitor sweep on `SessionStart`: delete files older than 7 days.

**Pros:**
- Zero IPC. Survives crashes of any single hook invocation.
- Matches the pattern `disler/claude-code-hooks-mastery` already proves works for stateful hooks.
- Trivial to test — fixtures are just files.
- Crash-resistant: a hook that dies mid-write doesn't corrupt the session (atomic rename).
- Encryption is opt-in, lives at the file boundary.

**Cons:**
- Filesystem latency on every hook (typically <5ms; well inside the 100/200ms hook budgets).
- File contention if many parallel hooks for the same session race — `flock` serializes them, which is what you want anyway for map consistency.
- Map persists across crashes including crashes you'd *want* to wipe state from. Mitigated by SessionEnd cleanup + janitor.

**Why this is right for v1:** It satisfies every requirement, has the smallest moving-parts surface, and is the boring choice. The performance budget is generous enough that the disk hit is invisible.

### Option B — MCP server holds the map in-process

**Where:** Inside the long-lived MCP server's RAM, keyed by `session_id`.

**How:** Hook adapter, instead of touching files, invokes the MCP server (same machine, stdio or local HTTP) with `redact()` / `restore()` tool calls. MCP server keeps the map in a `Map<sessionId, Map<token, value>>`.

**Pros:**
- No disk I/O.
- One source of truth even if multiple hook events race.
- Encryption at rest is moot — RAM only.

**Cons:**
- Hook adapter now has a dependency on the MCP server being running. If the user disables MCP, reversible mode breaks silently.
- Calling MCP from a hook means a sub-1s round-trip on a transport that wasn't designed for hook fanout. Adds 20-50ms latency per hook.
- MCP server crash = total session map loss. No crash recovery without writing to disk anyway, at which point you're doing Option A with extra steps.
- Conflates two surfaces (hook + MCP) in a way that makes either harder to disable independently.

**Verdict:** Tempting but worse than A. Only consider if Option A's filesystem latency turns out to violate the 100ms budget on slow disks (it won't on SSD; might on network-mounted homedir, which is a niche).

### Option C — Sidecar daemon over Unix socket (DEFER, possibly forever)

**Where:** A `mrclean-daemon` process spawned on first hook invocation, listens on `/tmp/mrclean-<uid>.sock`. Hook is a thin client that connects, sends event JSON, gets decision JSON back.

**How:**
- First hook spawns the daemon if `mrclean-daemon.pid` is stale.
- Daemon holds maps in RAM, persists snapshots to `~/.claude/mrclean/sessions/` periodically and on SIGTERM.
- Daemon self-exits after N minutes of idleness.

**Pros:**
- Eliminates Node.js cold-start cost (~30-80ms per hook). The hook client could be a 5MB statically-linked Go/Rust binary that connects in <2ms.
- True per-session in-memory state with no file contention.
- Centralizes audit logging without per-hook file appends.

**Cons:**
- A whole new process lifecycle to manage: spawn, health check, crash recovery, shutdown.
- Two-binary distribution (client + daemon) breaks the "single npm package" simplicity.
- Unix socket path management on Windows is awkward (named pipes have different semantics).
- Adds attack surface: the socket is a control channel into a process holding decrypted secrets.
- **The 100/200ms budget is generous enough that Node cold-start is unlikely to be the bottleneck.** If it is, profile first.

**Verdict:** Build only if Option A demonstrably violates the perf budget for real users, *and* a profile shows Node cold-start is the dominant cost. This is a v2 conversation, not a v1 conversation. Do not build speculatively.

### Decision

**v1: Option A.** Reversible-mode map lives in `~/.claude/mrclean/sessions/<session_id>.json`, accessed under `flock`, deleted on `SessionEnd`. The Session State Adapter is a thin module — easy to swap to Option B or C later behind a stable interface if profiling demands it.

---

## Data Flow

### Outbound: User prompt → Claude (sanitize on the way out)

```
User types prompt in Claude Code
    │
    ▼
Claude Code fires UserPromptSubmit
    │  spawns: node mrclean-hook (fresh process)
    │  stdin: {"hook_event_name":"UserPromptSubmit","session_id":"abc",
    │          "prompt":"deploy to AKIAIOSFODNN7EXAMPLE","cwd":"...",
    │          "transcript_path":"..."}
    ▼
mrclean Hook Adapter
    │
    ├─→ Hook Router: route to UserPromptSubmit handler
    │
    ├─→ Config Loader: load merged config
    │
    ├─→ Detection Engine.scan(prompt, config)
    │     L1 regex: matches AKIA... → AWS_ACCESS_KEY_ID, severity=critical
    │     L2 entropy: no additional matches
    │     L3 env values: no match (no .env loaded yet at session start)
    │     L4 word list: no match
    │     → DetectedSpan[{kind:"AWS_KEY", value:"AKIA...", offset:11, len:20}]
    │
    ├─→ Audit Logger.append({rule:"aws-access-key",
    │                        sha:"a1b2c3...", session:"abc", ts:...})
    │
    ├─→ Decision: contains_critical → BLOCK with reason
    │     (UserPromptSubmit cannot rewrite — only block or add context)
    │
    ▼
stdout: {"decision":"block",
         "reason":"mrclean: AWS access key detected in prompt.
                   Replace it with a placeholder and resubmit.
                   See .mrclean/audit.jsonl for details."}
exit 0
    │
    ▼
Claude Code shows the reason to the user; prompt is not sent to the model.
```

**Key constraint:** `UserPromptSubmit` cannot mutate the prompt as of Claude Code v2.1.123. Three open feature requests track this (#34390, #46761, #53330). For v1, the only honest options on prompt are *block-with-reason* or *allow-with-warning-via-additionalContext*. Silent rewriting would require either a `replaceUserMessage` field that doesn't exist, or terminal-input interception (out of scope).

This is a defensible v1 stance: the user gets told exactly what was detected and rewrites their prompt themselves. Compare gitleaks pre-commit, which does the same thing.

### Outbound: Tool call → external service (sanitize tool args)

```
Claude Code is about to call: Bash(curl -H "Authorization: Bearer sk_live_..." api.com)
    │
    ▼
Claude Code fires PreToolUse with matcher "Bash"
    │  stdin: {"hook_event_name":"PreToolUse","session_id":"abc",
    │          "tool_name":"Bash",
    │          "tool_input":{"command":"curl -H \"Authorization: Bearer sk_live_xyz\" ..."},
    │          "tool_use_id":"t1"}
    ▼
mrclean Hook Adapter → PreToolUse handler
    │
    ├─→ Detection Engine.scan(tool_input.command)
    │     → DetectedSpan[{kind:"STRIPE_KEY", value:"sk_live_xyz", offset:24, len:32}]
    │
    ├─→ Placeholder Manager.allocate("sk_live_xyz", "STRIPE_KEY")
    │     → "<MRCLEAN:STRIPE_KEY:001>"
    │
    ├─→ if reversible mode:
    │     Session State Adapter.persist("abc", {"<MRCLEAN:STRIPE_KEY:001>":"sk_live_xyz"})
    │       (flock + atomic rewrite of sessions/abc.json)
    │
    ├─→ Build modified command with placeholder substituted
    │
    ├─→ Audit Logger.append({...})
    │
    ▼
stdout: {"hookSpecificOutput":{
           "hookEventName":"PreToolUse",
           "permissionDecision":"allow",
           "updatedInput":{"command":"curl -H \"Authorization: Bearer <MRCLEAN:STRIPE_KEY:001>\" ..."}
         }}
exit 0
    │
    ▼
Claude Code executes the modified command (placeholder goes out to api.com — guaranteed to fail
the API call, which is the point: the secret never leaves the machine).
    │
    ▼
PostToolUse fires with tool_response containing whatever curl returned.
```

**Key constraint:** `updatedInput` requires `permissionDecision: "allow"` or `"ask"` to take effect. With `"defer"` it is silently ignored. This is documented in the SDK reference and applies equally to shell-command hooks.

### Inbound: Tool result → Claude (restore placeholders on the way in)

This path only matters in **reversible mode**. In one-way mode, PostToolUse is purely observational (audit only).

```
Bash tool finishes; tool_response = "ls -la /Users/alice/Projects/CodenameZephyr/secrets.json"
    │
    ▼
Claude Code fires PostToolUse with matcher "Bash"
    │  stdin: {"hook_event_name":"PostToolUse","session_id":"abc",
    │          "tool_name":"Bash",
    │          "tool_input":{...},
    │          "tool_response":"ls -la /Users/alice/Projects/CodenameZephyr/...",
    │          "tool_use_id":"t1","duration_ms":42}
    ▼
mrclean Hook Adapter → PostToolUse handler
    │
    ├─→ Detection Engine.scan(tool_response)
    │     L4 word list: matches "CodenameZephyr"
    │     → DetectedSpan[{kind:"USER_WORD", value:"CodenameZephyr", offset:..., len:14}]
    │
    ├─→ Placeholder Manager.allocate("CodenameZephyr", "USER_WORD")
    │     → "<MRCLEAN:USER_WORD:042>"
    │
    ├─→ Session State Adapter.persist (so user-facing restore can reverse it later)
    │
    ├─→ Build sanitized response with placeholders substituted in
    │
    ▼
stdout: {"hookSpecificOutput":{
           "hookEventName":"PostToolUse",
           "updatedToolOutput":"ls -la /Users/alice/Projects/<MRCLEAN:USER_WORD:042>/..."
         }}
exit 0
    │
    ▼
Claude Code shows Claude the sanitized output. Codename never reaches the model.
```

**Critical version dependency:** `hookSpecificOutput.updatedToolOutput` for non-MCP tools was added in **Claude Code v2.1.121** (changelog: *"PostToolUse hooks can now replace tool output for all tools via `hookSpecificOutput.updatedToolOutput` (previously MCP-only)"*). Below v2.1.121, mrclean's inbound-redaction path simply does not work for Bash/Read/Edit. The installer should detect Claude Code version and warn if older.

### MCP server path (parallel surface, not in the hook flow)

The MCP server is **not** in the data path of the hook flow — they're independent surfaces, both backed by the same Core Library. The MCP server exists for cases the hook can't address:

- **Explicit redaction:** Claude calls `mcp__mrclean__redact(text)` mid-conversation when it knows it's about to paste something sensitive into a different tool (e.g., a follow-up `WebFetch`).
- **User-facing restore:** A separate UI tool (or `npx mrclean show <session_id>`) calls `restore()` to render the original values for the human reading the transcript later.
- **Runtime configuration:** `block_term("internal-codename")` adds a word to the live blocklist without restarting the session.
- **Audit query:** `audit_show(session_id)` for the agent to introspect what was redacted in this session.

The MCP server holds its own copy of the in-memory state map for the lifetime of the session. It writes to the same `sessions/<session_id>.json` files the hooks read, so the two surfaces stay coherent (the file is the source of truth; both reads/writes go through Session State Adapter).

---

## How MCP Server Differs from Hook Surface

| Dimension | Hook Adapter | MCP Server |
|-----------|--------------|------------|
| **Process model** | Spawned fresh per event (cold start, ~50ms overhead) | Long-lived for session (started once, persists until session end) |
| **Invocation** | Automatic — Claude Code spawns it on every matching event | Explicit — Claude (the model) chooses to call a tool |
| **Coverage** | Every prompt and every tool call goes through it (deterministic) | Only when Claude decides to call (best-effort) |
| **Configurability** | Routed via `~/.claude/settings.json` `hooks` block | Routed via `~/.claude.json` `mcpServers` block or `.mcp.json` |
| **Transport** | stdin/stdout JSON, exit code | MCP JSON-RPC over stdio or Streamable HTTP |
| **State** | None in-process (cold start); state via file | In-process (RAM) + file for cross-process coherence |
| **Failure mode** | Per-event isolated; one bad hook call can't break the session | Server crash takes out the tool surface for the whole session |
| **Use it for** | Always-on guard rails (redact every secret regardless of model behavior) | On-demand operations (explicit redact, audit query, restore for humans) |

**Layering rule:** The hook is the safety net. The MCP server is the convenience layer. The hook must stand alone — if a user disables the MCP server, the redaction guarantee still holds. The MCP server must not duplicate the hook's job (don't redact the same payload twice).

---

## Recommended Project Structure

```
mrclean/
├── package.json                 # bin: { "mrclean": "./dist/cli/index.js" }
├── README.md
├── src/
│   ├── core/                    # Pure logic, no I/O. Reusable from hook AND MCP.
│   │   ├── detection/
│   │   │   ├── index.ts         # scan(text, config) → DetectedSpan[]
│   │   │   ├── layer1-regex.ts  # gitleaks-derived regex pack
│   │   │   ├── layer2-entropy.ts# Shannon entropy heuristic + allowlist
│   │   │   ├── layer3-env.ts    # parses .env* files
│   │   │   ├── layer4-words.ts  # .mrclean/words.txt loader
│   │   │   ├── layer5-llm.ts    # opt-in LLM classifier (deferred)
│   │   │   └── rules/
│   │   │       └── gitleaks.toml  # vendored ruleset
│   │   ├── placeholder/
│   │   │   ├── manager.ts       # allocate, lookup, format token
│   │   │   ├── token-format.ts  # <MRCLEAN:KIND:NNN> ↔ parse
│   │   │   └── id-strategy.ts   # deterministic per-kind monotonic
│   │   ├── audit/
│   │   │   └── logger.ts        # append .mrclean/audit.jsonl
│   │   ├── config/
│   │   │   ├── schema.ts        # zod schema for config file
│   │   │   ├── loader.ts        # merge defaults + user + project
│   │   │   └── defaults.ts
│   │   └── types.ts             # DetectedSpan, RedactionMap, Config, etc.
│   │
│   ├── state/                   # I/O boundary. The only place files are touched.
│   │   ├── session-store.ts     # flock + atomic rewrite of sessions/<id>.json
│   │   ├── encryption.ts        # opt-in AES-GCM via MRCLEAN_SESSION_KEY
│   │   └── janitor.ts           # sweep stale sessions on SessionStart
│   │
│   ├── hook/                    # Hook adapter — the bin entrypoint for hook events.
│   │   ├── adapter.ts           # main(): read stdin → route → write stdout
│   │   ├── router.ts            # dispatch on hook_event_name
│   │   ├── handlers/
│   │   │   ├── session-start.ts # extract .env values into runtime blocklist
│   │   │   ├── user-prompt-submit.ts # block-with-reason on critical
│   │   │   ├── pre-tool-use.ts  # updatedInput with placeholders
│   │   │   └── post-tool-use.ts # updatedToolOutput in reversible mode
│   │   └── stdio.ts             # safe JSON read/write, never throws to stdout
│   │
│   ├── mcp/                     # MCP server — separate bin entrypoint.
│   │   ├── server.ts            # @modelcontextprotocol/sdk McpServer
│   │   ├── transports.ts        # stdio default; HTTP via --http
│   │   ├── tools/
│   │   │   ├── redact.ts        # tool: redact(text, mode)
│   │   │   ├── restore.ts       # tool: restore(text, sessionId)
│   │   │   ├── audit-show.ts    # tool: audit_show(sessionId)
│   │   │   └── block-term.ts    # tool: block_term(term)
│   │   └── session-bridge.ts    # share state with hook via session-store
│   │
│   └── cli/                     # User-facing CLI (npx mrclean ...)
│       ├── index.ts             # commander: install | uninstall | doctor | show
│       ├── commands/
│       │   ├── install.ts       # writes ~/.claude/settings.json
│       │   ├── uninstall.ts     # removes our hook entries (idempotent)
│       │   ├── doctor.ts        # checks Claude Code version, hook wiring
│       │   └── show.ts          # render restored output for a session
│       └── settings-merge.ts    # idempotent JSON deep-merge with marker
│
├── test/
│   ├── fixtures/
│   │   ├── prompts/             # golden inputs
│   │   │   ├── aws-key.txt
│   │   │   ├── github-token.txt
│   │   │   └── ...
│   │   └── expected/            # golden outputs (sanitized form)
│   │       ├── aws-key.txt
│   │       └── ...
│   ├── unit/                    # mirrors src/ tree
│   │   ├── core/detection/      # scan() against fixtures
│   │   ├── core/placeholder/    # token uniqueness, format
│   │   └── state/               # session-store concurrency
│   ├── integration/
│   │   ├── hook-end-to-end.ts   # spawn mrclean bin with fixture stdin,
│   │   │                        # assert stdout matches contract
│   │   ├── mcp-end-to-end.ts    # in-process MCP client → tool calls
│   │   └── installer.ts         # install on tmp HOME, verify settings.json
│   └── e2e/
│       └── claude-code-sim.ts   # simulate full session: SessionStart →
│                                # UserPromptSubmit → PreToolUse → PostToolUse
└── .mrclean/                    # template scaffolded by `mrclean install`
    ├── config.json              # rule overrides, mode, layer toggles
    ├── words.txt                # user dirty-word list (created empty)
    └── audit.jsonl              # append-only audit log (created empty)
```

### Structure Rationale

- **`core/` is pure and side-effect free.** Detection and placeholder logic must be testable without spinning up processes or touching disk. This is also what gets reused identically by the hook surface and the MCP surface.
- **`state/` is the only place files are touched.** All the gnarliness of `flock`, atomic writes, encryption, and TTL is one module. Swap to a different backend (Option B daemon, in-memory for tests) by replacing this module.
- **`hook/` and `mcp/` are sibling adapters.** Each is a thin shell over `core/` plus event-specific I/O. Neither imports the other.
- **`cli/` is a third entrypoint** for human interaction. It can read the same audit log and session files for `mrclean show`.
- **Two bins in `package.json`:** `"mrclean"` (CLI + hook — same binary, dispatched by argv[2]) and `"mrclean-mcp"` (MCP server). Or one bin with a sub-command — fewer bins is simpler.

---

## Architectural Patterns

### Pattern 1: Hook-as-pure-function

**What:** Every hook handler is `(input: HookInput) => HookOutput` — pure given the file-backed state. No globals, no side effects beyond audit log + session file.

**When to use:** Every hook handler in `src/hook/handlers/`.

**Trade-offs:** Forces all I/O through `state/` and `audit/` modules. Slightly more boilerplate; massive testability win.

```typescript
// Pseudocode
async function handlePreToolUse(input: PreToolUseInput, deps: Deps): Promise<PreToolUseOutput> {
  const config = await deps.config.load(input.cwd)
  const text = extractScannableText(input.tool_input)
  const spans = detect(text, config)
  if (spans.length === 0) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }
  const map = await deps.state.read(input.session_id)
  const newMap = allocateAll(spans, map)
  const updatedInput = applySubstitutions(input.tool_input, spans, newMap)
  if (config.mode === 'reversible') await deps.state.write(input.session_id, newMap)
  await deps.audit.append(spans.map(toAuditEntry))
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput } }
}
```

### Pattern 2: Layered detection with short-circuit

**What:** Run layer 1 → 2 → 3 → 4 → 5 in order; short-circuit on critical-severity match if the user has set "block on first critical." Otherwise gather all matches and substitute in a single pass.

**When to use:** `core/detection/index.ts` `scan()`.

**Trade-offs:** Layer ordering matters for performance (regex is fastest, LLM is slowest). Putting LLM last and gating it on `--deep` means typical hooks never pay the cost. Short-circuit on critical is a UX choice — debatable; could surprise users by not surfacing all matches at once.

### Pattern 3: Session ID as the only correlation key

**What:** Never invent your own session identifier. Always use `input.session_id` provided by Claude Code. File names, audit entries, MCP map keys — all keyed on it.

**When to use:** Everywhere session correlation is needed.

**Trade-offs:** Coupling to Claude Code's lifecycle is the entire point — mrclean has no meaningful concept of "session" outside Claude Code's. Makes correlation across hook invocations and MCP calls trivial and unambiguous.

### Pattern 4: Stdin/stdout discipline for hooks

**What:** The hook adapter must write *only* the JSON decision to stdout. All logging goes to stderr. Any uncaught exception must be caught at the top level, logged to stderr, and produce a permissive default output (don't break Claude Code because mrclean crashed).

**When to use:** `src/hook/adapter.ts`.

**Trade-offs:** "Fail open" (allow on crash) vs "fail closed" (block on crash) is a security policy decision. v1 should fail open with a loud stderr message — a redaction tool that breaks the IDE will get uninstalled within an hour. Document the choice clearly.

### Pattern 5: Idempotent installer

**What:** `mrclean install` must be safe to run any number of times. Tag mrclean's own entries in settings.json with a stable marker (e.g., `"name": "mrclean"` or a `_mrclean: true` field). On re-run: deep-read existing, replace mrclean entries, leave others untouched.

**When to use:** `src/cli/commands/install.ts`.

**Trade-offs:** Requires careful JSON merging — naive `Object.assign` will obliterate user customizations. Use a JSON-aware merge with explicit policy: arrays of hooks are filtered for `_mrclean` markers and rewritten; everything else is preserved.

---

## Anti-Patterns

### Anti-Pattern 1: Putting state in module-level variables

**What people do:** `let sessionMap = new Map()` at the top of a module, expecting it to persist across hook invocations.

**Why it's wrong:** Each hook is a fresh Node.js process. Module state resets every time. You'll get correct behavior in tests (where you call the function in the same process) and silent breakage in production.

**Do this instead:** Always go through `state/session-store.ts`. Treat module-level mutable state as a code smell in this codebase.

### Anti-Pattern 2: Spawning a sub-process from inside a hook

**What people do:** Hook calls `child_process.spawn('python', ['some-detector.py'])` for an "advanced" check.

**Why it's wrong:** Compounds cold-start cost. A hook that takes 800ms because it spawns Python is one users disable.

**Do this instead:** Implement detection in TypeScript. For LLM (layer 5), call an HTTP API directly with `fetch`. If you absolutely need a binary, distribute it via `optionalDependencies` and keep the spawn out of the hot path.

### Anti-Pattern 3: Modifying the prompt in UserPromptSubmit "creatively"

**What people do:** Try to use `additionalContext` to "ask Claude to ignore the secret" or attempt to terminate the original prompt's processing some other way.

**Why it's wrong:** `UserPromptSubmit` only blocks or appends. Anything you put in `additionalContext` *adds to* the prompt — the original secret still goes to the model. Trying to be clever produces a false sense of security.

**Do this instead:** Block with a clear reason and let the user rewrite. Track upstream feature requests #34390, #46761, #53330 — when any of those land with `replaceUserMessage` semantics, switch to silent rewrite. Until then, *block* is the only honest answer for prompts.

### Anti-Pattern 4: Storing the placeholder map encrypted by default

**What people do:** Encrypt session files at rest using a hardcoded key or one derived from the session ID, "for safety."

**Why it's wrong:** The encryption key is then either constant (no security) or trivially derivable from public data (worse than no encryption — false sense of safety). Disk encryption belongs at the OS layer.

**Do this instead:** Plaintext by default. Provide an opt-in `MRCLEAN_SESSION_KEY` env var path to AES-GCM if the user wants it (e.g., they're on a multi-user machine). Document that the right answer for "I don't trust my disk" is FileVault/dm-crypt, not application-level encryption with no key management story.

### Anti-Pattern 5: Treating MCP server and hook as redundant safety nets

**What people do:** Run detection in both hook and MCP, "just to be sure."

**Why it's wrong:** Doubles the latency, doubles the audit log noise, and creates ambiguity about which one's substitution map is canonical. If the user disables one, the other's behavior changes invisibly.

**Do this instead:** Hook is the always-on enforcement layer. MCP is for *different* operations (explicit redact, restore, audit query). They share state via the session file but should never both redact the same payload.

---

## Build Order (Dependencies First)

The right build order is dictated by what depends on what. **Each step ships something demonstrable before the next step starts.**

### Step 0 — Repo scaffold (½ day)

`package.json` with two bin entries; TypeScript + tsup for build; vitest; biome/eslint. CI on Node 18/20/22.

### Step 1 — Installer (1 day) **[ship-blocking, but trivial]**

`mrclean install` writes a *no-op* hook into `~/.claude/settings.json` (echo input → stdout). Lets you prove the wiring end-to-end before any detection logic exists. Adds `mrclean doctor` to verify wiring.

**Why first:** Validates the integration assumption (does Claude Code actually invoke our binary?) before we invest in detection. If the install/wiring story is broken, nothing else matters.

### Step 2 — Detection Engine layers 1-4 (3-5 days)

`src/core/detection/`. Pure functions. Layer 1 (gitleaks regex pack), layer 2 (entropy + allowlist), layer 3 (env extractor), layer 4 (word list). Vetted against golden fixtures from day one.

**Why second:** Pure logic, no I/O dependencies, fully testable in isolation. The riskiest detection layer (layer 1's regex coverage) is the one most worth building and reviewing first.

### Step 3 — Audit Logger (½ day)

`src/core/audit/`. Append-only JSONL with sha-only values.

**Why now:** Used by every other component going forward. Trivial dependency.

### Step 4 — Hook Adapter, one-way mode only (2-3 days)

`src/hook/`. SessionStart (loads .env into runtime blocklist), UserPromptSubmit (block-with-reason), PreToolUse (`updatedInput`). PostToolUse is observational only at this stage.

**At this point you have a shippable v0.1.** It catches secrets in prompts and tool calls, blocks or redacts them outbound. No reversible mode yet. No restore. No MCP. This is the MVP — get it in front of users.

### Step 5 — MCP Server (3-4 days)

`src/mcp/`. stdio transport first; HTTP transport later. Tools: `redact()`, `audit_show()`, `block_term()`. (No `restore()` yet — that needs reversible mode.) Reuses Core Library entirely.

**Why now:** Independent surface. Doesn't gate reversible mode; can ship in parallel.

### Step 6 — Session State Adapter (2-3 days)

`src/state/`. Atomic file write under flock. SessionStart janitor sweep. SessionEnd cleanup.

**Why now:** Reversible mode depends on this and only this.

### Step 7 — Reversible mode (2-3 days)

PostToolUse handler emits `updatedToolOutput`. Placeholder Manager gains persistence. MCP server gains `restore()` tool. CLI gains `mrclean show <session_id>`.

**Critical version check:** `mrclean doctor` must verify Claude Code >= 2.1.121 before enabling reversible mode. Fall back gracefully on older versions.

### Step 8 — Layer 5 LLM classifier (2-4 days, opt-in)

Off by default. `--deep` flag or config `deep: true` enables it. Calls Anthropic API or local model. Cost-gated.

**Why last:** Highest complexity, lowest urgency, opt-in only. Don't let it block anything earlier.

### Step 9 — Sidecar daemon (DEFER)

Only if Step 4-7 profile shows Node cold-start is the dominant latency cost. Not in v1 plan. Possibly never.

---

## Test Architecture

### Layer 1: Unit tests (mirrors `src/`)

Detection layer has the highest test density. Each rule in the regex pack gets:

- A positive fixture (`test/fixtures/prompts/aws-key.txt`) → expected match
- A negative fixture (`test/fixtures/prompts/aws-key-negative.txt`) → expected no-match
- A boundary fixture (right at entropy threshold) → behavior pinned

Placeholder Manager unit tests:
- Token format round-trip (parse what you format)
- Collision-free allocation (1000 random values → 1000 unique tokens)
- Determinism (same value → same token within a session)
- Distinct values → distinct tokens even if they hash similarly

State store unit tests:
- Concurrent reader/writer (spawn N children, all hit the same session file, assert no corruption)
- Atomic write (kill mid-write, verify file is either old-version or new-version, never partial)

### Layer 2: Hook contract integration tests

```
test/integration/hook-end-to-end.ts:
  for each fixture in test/fixtures/hook-events/:
    spawn mrclean bin
    pipe fixture.stdin (Claude-Code-shaped JSON) to its stdin
    capture stdout, stderr, exit code
    assert stdout matches fixture.expected (JSON deep equality)
    assert exit code matches fixture.expected_exit
```

Fixtures cover every hook event × every detection layer × both modes:
- `pre-tool-use-bash-with-aws-key/`
- `post-tool-use-bash-restoration-reversible/`
- `user-prompt-submit-with-jwt-blocks/`
- `session-start-loads-env-values/`

These run the actual binary the way Claude Code runs it — they catch packaging bugs, JSON parsing edge cases, exit code mistakes, and contract regressions.

### Layer 3: Simulated full-session E2E

```
test/e2e/claude-code-sim.ts:
  Set up tmp HOME, run `mrclean install`.
  Programmatically spawn the hook bin in sequence, simulating:
    1. SessionStart event → assert .env values are in subsequent blocklist
    2. UserPromptSubmit with secret → assert blocked
    3. UserPromptSubmit without secret → assert allowed
    4. PreToolUse Bash with secret → assert updatedInput contains placeholder
    5. PostToolUse Bash returning user-word → assert updatedToolOutput substituted
    6. Restart simulation: spawn another hook with same session_id,
       assert reversible-mode map is still readable
```

This is the test that gives confidence the whole system actually composes. It's slow (file I/O, multiple spawns) so it lives in a separate test target run on CI not on every save.

### Layer 4: Real Claude Code integration (manual + CI smoke)

A small script that drives the actual `claude` CLI in headless mode (`claude -p`) against a corpus of prompts known to contain secrets, scrapes the resulting audit log, and asserts every secret was caught. Run weekly on CI; run manually before each release. This is what catches breakage from Claude Code hook contract changes upstream.

### Golden fixture format

```
test/fixtures/hook-events/pre-tool-use-bash-with-aws-key/
├── stdin.json          # exact JSON Claude Code would send
├── stdout.json         # exact JSON we expect to write
├── stderr.txt          # expected stderr (or empty)
├── exit                # expected exit code as integer
└── env.json            # any env vars to set (config overrides, etc.)
```

Test runner just iterates the directory. Adding a new test = creating a new folder. Reviewing a redaction change = looking at the diff in `stdout.json`.

---

## Scaling Considerations

mrclean runs on one developer's machine, in one Claude Code session, processing one stream of events serially per session. There is no horizontal scaling story.

| Scale | What changes |
|-------|--------------|
| 1 user, 1 session | Default. Reference architecture above. |
| 1 user, many parallel sessions | Same architecture. Each session has its own `<session_id>.json`. Audit log appends are per-project so they don't collide. |
| Many users sharing a CI runner | Each user is a separate `~/.claude/`. No shared state. |
| Per-event throughput | Cap is Claude Code's hook fanout, not mrclean's. mrclean's hot path is regex over a few KB of text — sub-millisecond outside cold-start. |

**The only real scaling concern is cold-start latency** (Node.js + module load = 30-80ms before our code runs). The 100ms UserPromptSubmit budget and 200ms PostToolUse budget tolerate this. If they don't on some user's machine, that's the trigger to revisit Option C (sidecar daemon).

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Claude Code (hook surface) | Subprocess spawn per event over stdin/stdout JSON | Contract is documented and stable; track changelog for breaking changes |
| Claude Code (MCP surface) | Long-lived process via stdio (default) or Streamable HTTP | Use `@modelcontextprotocol/sdk` TypeScript SDK |
| Anthropic API (layer 5, opt-in) | HTTPS POST | Only invoked when `deep` mode enabled; respects `ANTHROPIC_API_KEY` |
| Filesystem | Direct (Node `fs`) | All session/audit/config I/O is local |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Hook ↔ Core Library | Direct in-process function call | Same Node process; no serialization |
| MCP ↔ Core Library | Direct in-process function call | Same as hook side; identical Core import |
| Hook ↔ MCP | None directly | Coordinate only via `state/session-store` files |
| Hook ↔ State | File I/O under `flock` | The single I/O choke point; mockable for tests |
| Installer ↔ Claude Code settings | Read+merge+write JSON file | Idempotent; tag own entries for safe re-runs |

---

## Sources

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — confirms hooks spawn fresh per event, no inter-event state; documents `session_id`, `transcript_path`, `cwd` in every hook input; full I/O contracts for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse including `updatedInput` and `updatedToolOutput`
- [Claude Code CHANGELOG (raw)](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md) — confirms `updatedToolOutput` for all tools added in v2.1.121; PostToolUse `duration_ms` available; `additionalContext` for UserPromptSubmit added earlier
- [Claude Agent SDK — Hooks](https://code.claude.com/docs/en/agent-sdk/hooks) — formalizes hook output schema including `hookSpecificOutput.updatedToolOutput` and `permissionDecision: "allow|deny|ask|defer"`; documents must-pair `permissionDecision` with `updatedInput`
- [Issue #34390 — UserPromptSubmit prompt modification](https://github.com/anthropics/claude-code/issues/34390) — confirms current limitation: cannot rewrite prompts, only block or append context
- [Issue #46761](https://github.com/anthropics/claude-code/issues/46761) and [Issue #53330](https://github.com/anthropics/claude-code/issues/53330) — open feature requests for `replaceUserMessage` / `modifiedPrompt`; not yet implemented as of May 2026
- [Issue #18594 / #4544](https://github.com/anthropics/claude-code/issues/18594) — historical PostToolUse-modification requests; both pre-date the v2.1.121 ship that delivered the capability
- [MCP Transports specification](https://modelcontextprotocol.io/docs/concepts/transports) — stdio vs Streamable HTTP semantics; session ID via `Mcp-Session-Id` header; lifecycle of long-lived MCP server processes
- [@modelcontextprotocol/sdk on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) and [typescript-sdk on GitHub](https://github.com/modelcontextprotocol/typescript-sdk) — official TS SDK; `McpServer` + `StdioServerTransport` lifecycle pattern
- [disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery) — production reference for stateful hooks using session-keyed files (no daemon); validates the file-backed-state architecture choice
- [gitleaks default ruleset](https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml) — TOML rule format mrclean's layer 1 vendors
- [secretlint on npm](https://www.npmjs.com/package/secretlint) — JS-native alternative ruleset and rule-pattern format; useful as a fallback or supplement to gitleaks rules
- [Node.js `net` Unix socket docs](https://nodejs.org/api/net.html) — referenced for the deferred Option C sidecar evaluation

---
*Architecture research for: in-session Claude Code redaction tooling*
*Researched: 2026-05-13*
