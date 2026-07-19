# Phase 8: Contract Verification & Reversible Plumbing - Research

**Researched:** 2026-07-14
**Domain:** Claude Code hook-contract empirical verification (live headless sessions) + zero-behavior-change config/lifecycle plumbing for reversible mode
**Confidence:** HIGH (contract docs fetched live 2026-07-14; all codebase touchpoints read from source; upstream issue tracker verified via `gh`)

## Summary

Phase 8 is two decoupled workstreams. **Workstream 1 (REVMODE-10)** settles four LOW-confidence hook-contract questions with live headless experiments and files an upstream feature request for a display-only rewrite channel. **Workstream 2 (REVMODE-03 + plumbing)** lands the `[reversible]` config table, SessionEnd routing, the widened SessionStart matcher with install migration, doctor reporting, and the THREAT_MODEL.md reversible-mode section — all with zero change to shipped one-way redaction behavior.

The single most important finding of this research session: **`updatedToolOutput` is reportedly broken (silently ignored) for the built-in Bash tool on current Claude Code** — open canonical bug [anthropics/claude-code#68951](https://github.com/anthropics/claude-code/issues/68951), filed 2026-06-17, confirmed still reproducible on v2.1.207 in a comment dated 2026-07-12 (two days ago) `[VERIFIED: gh issue view, 2026-07-14]`. The local CLI is 2.1.209 and no changelog entry mentions a fix `[VERIFIED: CHANGELOG.md fetch, 2026-07-14]`. This has implications beyond reversible-mode planning: mrclean's **shipped** PostToolUse redaction path (`src/hook/handlers/post-tool-use.ts` Step 7) emits `updatedToolOutput` — if the field is ignored for Bash, secret redaction of Bash tool *results* silently does not reach the model on affected versions. Experiment E1 must therefore answer "is it honored at all, per tool?" before the rendering question, and the answer feeds both the THREAT_MODEL draft and doctor honesty copy.

Second key finding: the live hooks doc confirms **SessionEnd matchers filter on the `reason` field**, and there is a **sixth reason value — `bypass_permissions_disabled`** — that the milestone research and REVMODE-07's reason list do not mention `[CITED: code.claude.com/docs/en/hooks, fetched 2026-07-14]`. The Phase 8 SessionEnd handler must be a pure no-op that tolerates *any* reason string (no matcher on registration, no config load, no I/O), so no upstream reason addition can ever produce exit-2 noise through the fail-closed wrapper. Third: the documented `--fork-session` flag ("When resuming, create a new session ID instead of reusing the original") is documented evidence that plain `--resume` *reuses* the session ID — raising the prior on T5's retain-on-resume rehydration being real, but hook-payload continuity still needs the cheap empirical check `[CITED: claude --help, v2.1.209]`.

**Primary recommendation:** Plan two parallel-safe waves — (A) plumbing + tests (deterministic, no tokens), (B) UAT-harness contract experiments (opt-in, live, ~cents of Haiku) — then a serial documentation wave (docs/HOOK-CONTRACT.md answers, THREAT_MODEL.md section, PROJECT.md amendment, upstream issue filed via operator checkpoint) that consumes B's answers.

## Locked Decisions (no CONTEXT.md — constraints from PROJECT.md / STATE.md)

No `08-CONTEXT.md` exists (`has_context: false`). The equivalent constraints are the T1–T6 decisions recorded in PROJECT.md Key Decisions and STATE.md (2026-07-14). These are **made decisions — Phase 8 verifies and documents; it does not re-litigate**:

- **T1 (locked):** No in-session restore. `updatedToolOutput` is model-facing; transcript ratchet is permanent. Milestone reshaped to operator-only restore CLI. Phase 8's experiments *refine the evidence*, they do not reopen the decision.
- **T2 (locked):** Map = encrypted per-session file under `~/.mrclean/sessions/` (Phase 9 builds it; Phase 8 only ships the config/lifecycle plumbing).
- **T3 (locked):** Secret-class originals never persisted — structural floor (THREAT_MODEL section must explain this).
- **T4 (locked):** Session-tagged v2 tokens in reversible mode only; v1 format untouched for one-way default.
- **T5 (ratified, evidence pending):** Retain map on SessionEnd `reason: resume`; Phase 8's E3 (`session_id` continuity) decides whether Phase 9 rehydration is real or dead code.
- **T6 (locked):** `restore` MCP tool stays banned (`FORBIDDEN_TOOL_NAMES`, tests/mcp/tools-list.test.ts:44); restore ships as operator CLI in Phase 10.
- **Scope fence:** Deferred ideas (in-session restore fast-follow, input-side restore, fuzzy matching, keychain custody, Layer 5) are OUT — do not plan tasks for them.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REVMODE-10 | Hook-contract behaviors empirically verified in live headless sessions and documented — `updatedToolOutput` terminal rendering, PreToolUse `updatedInput` context echo, `session_id` continuity across `--resume`, 10K-char output-cap applicability — and an upstream feature request for a display-only rewrite channel is filed | §Experiment Design (E1–E5): concrete observables, fixture-hook pattern from #68951 repro, UAT-2b harness precedent (tests/uat/live-session.test.ts); §Upstream Feature Request: template + prior-art issues to cite/distinguish (#18653, #68951); §State of the Art: what the docs already answer vs what stays empirical |
| REVMODE-03 | THREAT_MODEL.md reversible-mode section (map blast radius, secret floor, wire re-entry analysis, key-custody honesty, residual risks); PROJECT.md stale "restore MCP tool stub" wording amended | §THREAT_MODEL.md Section Design: existing H3-numbered style, content outline mapped to T1–T6; §PROJECT.md Amendment Audit: the literal "stub" wording is already gone — remaining stale text located at PROJECT.md "What This Is" (line 5) |
</phase_requirements>

Success criteria SC2 (`[reversible]` table + doctor) and SC3 (installer SessionEnd + matcher migration) are REVMODE-07/-02/-12 *groundwork* owned by this phase per the roadmap note — supported by §Plumbing Patterns below.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Contract experiments (live sessions) | UAT test harness (opt-in vitest `uat` project) | Operator (interactive rendering check) | Precedent: tests/uat/live-session.test.ts spawns real `claude -p`; "terminal rendering" may need one interactive human observation |
| Contract answers documentation | Repo docs (`docs/HOOK-CONTRACT.md`, new) | src/shared/types.ts JSDoc | Operator-readable per SC1; types carry version-stamped contract comments already (LOCKED header) |
| `[reversible]` config table | Config loader (src/config/) | — | `[pii]` sub-table precedent: frozen default, absent-table == shipped guarantee |
| SessionEnd routing + no-op handler | Hook dispatcher (src/hook/) | Installer (registration) | Dispatcher throws on unknown events → exit-2 via fail-closed wrapper; handler MUST ship with-or-before registration |
| SessionStart matcher widening + migration | Installer (src/install/settings.ts) | Doctor (REQUIRED_EVENTS check) | `HOOK_MATCHERS.SessionStart: 'startup'` at line 23; existing filter-and-replace idempotency makes migration nearly free |
| Reversible-mode state reporting | Doctor (src/doctor/checks.ts) | — | Seven-check CheckResult pattern; exit-code map is LOCKED — new check needs deliberate code choice |
| THREAT_MODEL reversible section | Repo docs (THREAT_MODEL.md) | Phase 11 copy-drift gate (build against it) | H3 numbered sections style; Phase 8 drafts from decisions + E-answers, Phase 11 finalizes |
| Upstream feature request | Operator (checkpoint, `gh issue create`) | Repo docs (draft body + link recording) | Public post on the user's GitHub account — never auto-file |

## Standard Stack

### Core

**No new runtime or dev dependencies.** Phase 8 is plumbing + experiments over the existing stack `[VERIFIED: read from package.json/source this session]`:

| Library | Version | Purpose in Phase 8 | Status |
|---------|---------|--------------------|--------|
| Node.js | v22.22.0 local (floor >=20.18.0) | runtime | installed `[VERIFIED: node --version]` |
| TypeScript ^5.6 + tsup + tsx | as shipped | build/dev | existing |
| Vitest ^4.1 (`unit`/`integration`/`uat` projects) | as shipped | all tests incl. live-session harness | existing |
| smol-toml | ^1.6.1 | `[reversible]` table parses through existing reader | existing |
| Claude Code CLI | **2.1.209 local** | experiment substrate | `[VERIFIED: claude --version, 2026-07-14]` |
| `gh` CLI | authenticated (account fuzzyqbit) | upstream issue search/filing | `[VERIFIED: gh auth status]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| UAT vitest harness for experiments | Standalone scripts in `scripts/` | Harness is rerunnable on CC upgrades (contract-drift detection) and reuses assertSessionRan/stream-json parsing; scripts rot. Use the harness. |
| Minimal standalone fixture hooks (bash/node one-liners writing canned JSON) | Driving experiments through the full mrclean hook | Fixture hooks isolate the *contract* question from mrclean's detection stack (matches #68951's repro method); mrclean-in-the-loop is a follow-up assertion, not the primary instrument |
| Human interactive check for terminal rendering | node-pty / tmux automation | PTY automation of the Claude TUI is brittle and a new dep for a one-shot observation — use a `checkpoint:human-verify` task instead |

**Installation:** none.

## Package Legitimacy Audit

**This phase installs no external packages.** All work uses existing dependencies (verified against package.json) plus the already-installed `claude` and `gh` CLIs. slopcheck run not required; nothing to audit.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                        WORKSTREAM 1 — Contract experiments (opt-in, live)
┌──────────────────────────────────────────────────────────────────────────────┐
│  tests/uat/contract-verification.test.ts  (MRCLEAN_UAT=1, --project=uat)     │
│                                                                              │
│  mkdtemp sandbox ──► fixture hook scripts (canned JSON out, side-file log)   │
│        │                    │                                                │
│        ▼                    ▼                                                │
│  settings-EX.json ──► claude -p "<prompt>" --settings … --output-format      │
│                        stream-json --verbose --max-turns 4 (Haiku)           │
│                              │                                               │
│              ┌───────────────┼──────────────────┐                            │
│              ▼               ▼                  ▼                            │
│      stream-json events   ~/.claude/projects/   side files written           │
│      (init/assistant/     <cwd-slug>/<sid>.jsonl by fixture hooks            │
│       user/result)        (transcript = render   (session_id log,            │
│                            source)               SessionEnd reason)          │
│              └───────────────┴──────────────────┘                            │
│                              ▼                                               │
│              per-question verdicts ──► docs/HOOK-CONTRACT.md                 │
│                              │         (answer + CC version + date + method) │
│                              ├──► THREAT_MODEL.md reversible section (draft) │
│                              └──► upstream issue draft ──► checkpoint:       │
│                                     operator files via gh ──► link recorded  │
└──────────────────────────────────────────────────────────────────────────────┘

                        WORKSTREAM 2 — Plumbing (deterministic, zero behavior change)
┌──────────────────────────────────────────────────────────────────────────────┐
│ config.toml [reversible] ──► readConfigLayer ──► validateReversibleConfig    │
│  (absent ⇒ DEFAULT_CONFIG.reversible.enabled=false ⇒ byte-identical v1/v2)   │
│                                                                              │
│ mrclean install ──► writeHookEntries: HOOK_EVENTS += SessionEnd,             │
│   SessionStart matcher 'startup' → 'startup|resume|clear|compact'            │
│   (filter _mrclean entries + re-add ⇒ migration is the same code path)       │
│                                                                              │
│ Claude Code ──SessionEnd payload──► /bin/sh wrapper ──► dispatch()           │
│   ──► handleSessionEnd (PURE no-op: return null; tolerates any reason)       │
│                                                                              │
│ mrclean doctor ──► checkReversibleState (reports enabled/disabled)           │
│   + REQUIRED_EVENTS widened to 5 ──► renderReport                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (Phase 8 delta)

```
src/
├── shared/types.ts            # +SessionEndInput, hook_event_name union += 'SessionEnd',
│                              #  +MrcleanReversibleConfig on MrcleanConfig
├── hook/
│   ├── dispatcher.ts          # +case 'SessionEnd'
│   └── handlers/session-end.ts  # NEW — pure no-op (return null), no config load, no I/O
├── config/
│   ├── defaults.ts            # +reversible: Object.freeze({ enabled: false })
│   └── index.ts               # +validateReversibleConfig, LAST-WINS merge (pii precedent)
├── install/settings.ts        # HOOK_EVENTS += 'SessionEnd'; SessionStart matcher widened
└── doctor/checks.ts           # +checkReversibleState; REQUIRED_EVENTS → 5 events
docs/
└── HOOK-CONTRACT.md           # NEW — empirical answers, version-stamped (SC1 home)
tests/
├── uat/contract-verification.test.ts  # NEW — E1–E5 harness (opt-in)
├── install/settings.test.ts   # matcher assertions updated; v2.0→v3.0 migration fixture
├── hook/dispatcher.test.ts    # SessionEnd routes; unknown event still throws
├── config/reader.test.ts      # [reversible] parse/validate/merge/absent-default
└── doctor/checks.test.ts      # 5-event fixtures; reversible-state check
THREAT_MODEL.md                # +reversible-mode section (drafted, Phase 11 finalizes)
.planning/PROJECT.md           # stale wording amendment (see audit below)
```

### Pattern 1: Fixture-hook experiment (isolate the contract, not mrclean)

**What:** Each experiment registers a *minimal* standalone hook (a small shell/node script writing canned `hookSpecificOutput` JSON and appending observations to a side file) via a sandbox `--settings` JSON — exactly the repro method used in upstream #68951.
**When to use:** All of E1–E5. mrclean's real hook is added only as a secondary assertion (e.g., "mrclean's PostToolUse emits the same shape").
**Example:**

```jsonc
// settings-e1.json — sandbox, never touches ~/.claude/settings.json
// Source: pattern from tests/uat/live-session.test.ts + anthropics/claude-code#68951 repro
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "/bin/sh",
                     "args": ["-c", "cat > /dev/null; printf '%s' \"$1\"", "e1-hook",
                              "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"updatedToolOutput\":\"REWRITTEN_E1_MARKER_x9k2\"}}"],
                     "timeout": 10 } ] }
    ]
  }
}
```

```ts
// Harness skeleton — Source: tests/uat/live-session.test.ts (UAT-2b, shipped)
const run = runClaude(
  'Run the bash command `echo ORIGINAL_E1_MARKER_q7v4` and then repeat back the exact output you saw.',
  settingsE1Path,
  ['--allowedTools', 'Bash'],
)
assertSessionRan(run)
// Verdict signals (record all three; do not assert a hoped-for answer):
// 1. run.resultText — does the model quote ORIGINAL or REWRITTEN?
// 2. transcript jsonl (~/.claude/projects/<slug>/<session_id>.jsonl) tool_result content
// 3. stream-json user-message tool_result content
```

### Pattern 2: Record-don't-assert experiment tests

**What:** Experiments record verdicts (write a findings JSON artifact + console table) rather than hard-asserting an expected contract answer. Only *harness-integrity* assertions are hard (session ran, hook fired, side file written).
**When to use:** All contract questions. The point is discovery; a "failing" contract answer (e.g., `updatedToolOutput` ignored) is a *finding*, not a test failure. Guard against vacuous passes with `assertSessionRan` (shipped pattern).
**Why:** #68951 proves the answer can change per CC version; the harness is rerun on upgrades and should report drift, not break CI.

### Pattern 3: `[pii]` config-table precedent for `[reversible]`

**What:** Frozen default sub-table; absent table ≡ shipped guarantee; LAST-WINS scalar merge; typed validator throwing `ConfigReadError` on wrong types.
**Example:**

```ts
// Source: src/config/defaults.ts ([pii] precedent, read this session)
reversible: Object.freeze({
  enabled: false,   // master switch OFF; absent-[reversible] == shipped one-way guarantee
}) as unknown as MrcleanReversibleConfig,
```

Keep the Phase 8 surface minimal (`enabled` only). Phase 9 extends with `ttl_hours` etc. — do not speculate fields now (YAGNI). Unknown keys inside `[reversible]` are ignored (matches current reader tolerance); REVMODE-12's FAIL-loud-on-unsupported-config lands in Phase 10.

### Pattern 4: No-op SessionEnd handler with open reason type

**What:** Handler returns `null` immediately; performs no config load, no session-state init, no filesystem I/O.
**Why:** (a) SessionEnd output/exit codes are ignored by Claude Code, so any work is wasted; (b) `loadEffectiveConfig` throws `ConfigReadError` on malformed TOML → crash guard exit 2 → fail-closed wrapper noise at every session end (violates SC3); (c) Phase 9's janitor replaces the body — Phase 8 only proves routing.

```ts
// src/shared/types.ts addition — reason left open to absorb upstream additions
export interface SessionEndInput extends HookInputBase {
  hook_event_name: 'SessionEnd'
  /** Documented values as of CC 2.1.209: clear | resume | logout | prompt_input_exit
   *  | bypass_permissions_disabled | other. Upstream may add more — treat as open string.
   *  [CITED: code.claude.com/docs/en/hooks, fetched 2026-07-14] */
  reason: string
}
```

Register SessionEnd **without a matcher** (SessionEnd matchers filter on `reason` — mrclean must see every reason so Phase 9's janitor logic lives in the handler, immune to upstream reason additions) `[CITED: code.claude.com/docs/en/hooks]`.

### Pattern 5: Migration = existing idempotent replace

**What:** `writeHookEntries` already filters out all `_mrclean: true` entries per event and re-adds fresh ones. Adding `SessionEnd` to `HOOK_EVENTS` and changing `HOOK_MATCHERS.SessionStart` to `'startup|resume|clear|compact'` makes re-running `mrclean install` the migration — no separate migration code path.
**Verify with:** a test that seeds a v2.0-shaped settings.json (4 events, `matcher: 'startup'`, plus a foreign user hook entry) and asserts post-install: 5 events, widened matcher, exactly one mrclean entry per event, foreign entry untouched. `removeHookEntries` iterates `Object.keys(hooks)` so uninstall handles SessionEnd with zero change `[VERIFIED: src/install/settings.ts read this session]`.
**Matcher syntax:** matchers are regex — alternation `startup|resume|clear|compact` is the documented pattern for multi-value matchers `[CITED: code.claude.com/docs/en/hooks]`.

### Anti-Patterns to Avoid

- **Loading config or session state in the SessionEnd handler:** turns every session end into a potential exit-2 (see Pattern 4).
- **Registering SessionEnd with a reason matcher:** silently drops future upstream reasons from Phase 9's janitor view.
- **Hard-asserting hoped-for contract answers in the UAT harness:** converts findings into flaky CI (Pattern 2).
- **Auto-filing the upstream GitHub issue from an agent:** public post on the operator's account — must be a human checkpoint.
- **Rewriting `handleSessionStart` behavior for resume/clear/compact sources in this phase:** matcher widening intentionally makes the existing handler fire on those sources (state re-init + banner re-injection is desired and matches its current contract); reason-specific logic is Phase 9.
- **Expanding `[reversible]` config fields speculatively:** Phase 9 owns the store schema; extra keys now force churn.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Live headless session driving | New spawn/parse machinery | `runClaude` + `assertSessionRan` + StreamEvent parsing from tests/uat/live-session.test.ts | Shipped, handles auth-failure/vacuous-pass traps already |
| Interactive TUI observation | node-pty / tmux automation | `checkpoint:human-verify` (one manual interactive session) | PTY automation of Claude's TUI is brittle, adds a dep for a one-shot look |
| settings.json editing/backup | ad-hoc JSON writes | `readJsonOrEmpty` / `atomicWriteJson` / `backupJson` (src/install/atomic-json.ts) | Atomic + timestamped backup already shipped |
| Claude version parse/compare | semver dep or new parser | `checkClaudeCodeVersion` (src/doctor/version-check.ts) with its DI seam | Shipped, hermetic-testable |
| TOML parsing for `[reversible]` | any new parsing | existing `readConfigLayer` + a `validateReversibleConfig` sibling | `[pii]` validator precedent is 1:1 |
| Feature-request formatting | freeform issue text | upstream `feature_request.yml` template fields | Repo enforces template; preflight checklist requires prior-art search `[VERIFIED: gh api .github/ISSUE_TEMPLATE]` |

**Key insight:** Every Phase 8 mechanism has a shipped precedent in this repo; the only genuinely new artifact class is the findings document (docs/HOOK-CONTRACT.md).

## Runtime State Inventory

This phase migrates live, out-of-repo registered state (the operator's Claude Code hook registration), so the inventory applies:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no datastore holds hook shapes (verified: settings are the only registration) | — |
| Live service config | `~/.claude/settings.json` mrclean hook entries: 4 events, `SessionStart` matcher `'startup'`, fail-closed wrapper shape (existing v2.0 installs in the field) | Re-run of `mrclean install` migrates (Pattern 5); migration test against v2.0-shaped fixture required; timestamped backup already taken by `backupJson` |
| OS-registered state | None — hooks are the only OS-user-level registration; MCP entry in `~/.claude.json` unchanged this phase | — |
| Secrets/env vars | None touched. `MRCLEAN_UAT=1` opt-in gate only; experiments must keep using `--settings`/`--mcp-config` sandbox isolation so the operator's real settings are never mutated (UAT-2b precedent) | none |
| Build artifacts | `dist/` rebuilt by UAT beforeAll (`npm run build`) — no stale-name risk | none |

**Nothing found in remaining categories:** stated explicitly above with verification method (source read of src/install/*, tests/uat/*).

## Experiment Design (REVMODE-10 core)

Five experiments. All follow Patterns 1–2; each records: answer, claude version (`claude --version` at run time), date, method, raw-evidence pointers (transcript path excerpts). Cost estimate: ~10–20 Haiku calls total (cents); each run ≤150 s (UAT timeout precedent).

### E1 — `updatedToolOutput`: honored per tool? rendered where?

- **Hypothesis (evidence-backed):** IGNORED for built-in Bash as of 2.1.207 `[VERIFIED: gh issue #68951 comment 2026-07-12]`; unknown for Read and MCP tools; unknown on 2.1.209.
- **Matrix:** Bash, Read, one MCP tool (use a fixture MCP echo server or Read — note mrclean self-exempts its own tools via `MRCLEAN_TOOL_RE`, so don't use `mrclean_check` as the rewrite target).
- **Signals:** (1) model's next-turn quote of tool output (ORIGINAL vs REWRITTEN marker); (2) transcript jsonl `tool_result` content; (3) stream-json user-event `tool_result`.
- **Rendering half:** transcript is the terminal's render source (user view == model view per milestone research `[ASSUMED — this is exactly what E1 verifies]`). Headless runs answer the model-facing half; one `checkpoint:human-verify` interactive session answers literal terminal display.
- **Product implication:** if ignored for Bash on 2.1.209, mrclean's shipped PostToolUse redaction of Bash results is silently inert → THREAT_MODEL known-gap entry + doctor honesty copy (the current green "fully compatible (PostToolUse updatedToolOutput supported)" message at src/doctor/version-check.ts:116 overclaims).

### E2 — PreToolUse `updatedInput`: context echo?

- **Setup:** fixture PreToolUse hook (matcher Bash) returns `permissionDecision: "allow"` + `updatedInput` rewriting `echo INPUT_ORIG_MARKER` → `echo INPUT_UPDATED_MARKER` (complete tool_input object — shipped Pitfall: partial objects are wrong `[VERIFIED: src/hook/handlers/pre-tool-use.ts:21]`).
- **Signals:** (1) tool actually executes updated command (output contains UPDATED); (2) transcript `tool_use` block input — ORIGINAL or UPDATED?; (3) model's next-turn answer to "quote the exact command you ran".
- **Consequence:** if UPDATED echoes into transcript/model context → input-side restore has the same ratchet → stays deferred (Phase 10 scope fence confirmed). If it does NOT echo, input-side restore remains *deferred anyway* this milestone (locked), but the answer is recorded for the v3.x decision.

### E3 — `session_id` continuity across `--resume`

- **Setup:** fixture hook on SessionStart+UserPromptSubmit appends `{event, session_id, source}` to a side file. Run 1: `claude -p … --settings <sandbox>`; capture session_id (side file; stream-json init event also carries it `[ASSUMED — verify on first harness run]`). Run 2: `claude -p --resume <sid> …` from the same cwd. Control: `--resume <sid> --fork-session` (expect a NEW id `[CITED: claude --help v2.1.209]`).
- **Signals:** side-file session_id equality across runs; SessionStart fires with `source: "resume"` (doubles as proof the widened matcher works via sandbox settings).
- **Documented prior:** `--fork-session` text implies default resume reuses the ID (MEDIUM); hook-payload continuity is the load-bearing empirical fact for Phase 9 T5.

### E4 — 10K-char cap vs `updatedToolOutput`

- **Documented:** cap applies to "hook output strings, including `additionalContext`, `systemMessage`, and plain stdout"; overflow is "saved to a file and replaced with a preview and file path" `[CITED: code.claude.com/docs/en/hooks, fetched 2026-07-14]`. `updatedToolOutput` is NOT explicitly listed — that's the open question.
- **Setup:** Bash produces >10K output (`seq 1 3000`); fixture hook returns ~15K `updatedToolOutput` with HEAD/TAIL markers. Control: `additionalContext` >10K (documented capped — validates the harness can observe the file-preview replacement).
- **Signals:** transcript/model view — full text vs preview+path vs truncation; whether TAIL marker survives.
- **Consequence:** binds Phase 10's restore-in-large-outputs scope and Phase 9's map-size expectations. Note: E4 is moot for Bash if E1 shows the field is ignored for Bash — run E4 against whichever tool E1 proves honored (or record "unanswerable on this version" — an honest, documented outcome).

### E5 — SessionEnd firing + reason observability (bonus, cheap)

- **Setup:** fixture SessionEnd hook appends `{reason}` to a side file; run a normal `-p` session to completion.
- **Signals:** does SessionEnd fire in print mode? which reason? (`other` expected for `-p` exit `[ASSUMED]`). Also proves zero exit-2 noise with a no-op handler in the sandbox, satisfying SC3's observable.
- **Value:** REVMODE-07's Phase 9 janitor needs to know SessionEnd actually fires headlessly; the milestone research notes it never fires on crash/SIGKILL `[CITED: milestone SUMMARY.md, sourced from live docs 2026-07-14]`.

### Where answers land

`docs/HOOK-CONTRACT.md` (new): one section per question — verdict, CC version + date, method, evidence excerpt, downstream implication (Phase 9 T5 gate / Phase 10 input-restore fence / doctor copy). Also update the affected JSDoc in src/shared/types.ts (LOCKED header requires citing upstream verification — this phase IS that verification). STATE.md decision entries at phase transition per normal GSD flow.

## Upstream Feature Request (SC1 second half)

- **Repo:** `anthropics/claude-code`, issues enabled, `feature_request.yml` template with a preflight checklist requiring prior-art search `[VERIFIED: gh api, 2026-07-14]`.
- **The ask:** a **display-only rewrite channel** — a PostToolUse (and ideally UserPromptSubmit/assistant-message) field that changes what the *user's terminal renders* without entering model context or the transcript's model-facing content (e.g., `displayOverride`). Motivation: sanitizers need placeholders model-side but readability user-side; today user view == model view.
- **Prior art to cite and DISTINGUISH (all verified open/closed this session):**
  - #18653 (open, FEATURE: tool-result transform for sanitization) — model-facing transform; different ask.
  - #68951 (open, BUG: `updatedToolOutput` ignored for built-in Bash; prior reports #54196/#65403/#67442 closed as duplicates) — evidence the existing model-facing channel is both broken and unsuitable; strengthens the case.
  - #64326 / #62156 / #66044 — referenced by #68951 as the redaction-feature-request bucket `[CITED: #68951 body]`.
- **No existing display-only request found** — searches for "updatedToolOutput display", "hook display-only rewrite", "hook redact transcript display" returned nothing relevant `[VERIFIED: gh search issues, 2026-07-14]`. A new issue is appropriate.
- **Process:** draft the full issue body in-repo (e.g., appendix of docs/HOOK-CONTRACT.md or `docs/upstream/display-only-channel-request.md`), include E1 evidence, then `checkpoint:human-action`: operator reviews and files via `gh issue create --repo anthropics/claude-code` (or web), then records the issue URL back into docs/HOOK-CONTRACT.md (SC1 requires "filed and linked").

## THREAT_MODEL.md Section Design (REVMODE-03)

Current file: 10 H3-numbered Non-Defense sections + "What mrclean DOES defend against" + "Reporting" `[VERIFIED: read this session]`. Recommended: a new top-level `## Reversible Mode (v3.0)` section between Non-Defenses and "What mrclean DOES defend against", using the same H3-numbered style:

1. **Map blast radius** — what a fully exfiltrated session map leaks (one session's paths/names/identifiers, never keys) and why session-scoping caps it (T2/T3).
2. **The structural secret floor** — secret-class originals never persisted; map entries structurally lack `original`; no config can widen (T3). Contrast with ecosystem (no reference tool ships a non-configurable exclusion).
3. **Wire re-entry: why in-session restore is deferred** — `updatedToolOutput` is model-facing; transcript ratchet is permanent (history re-ships on every request and on resume); user view == model view; link E1 evidence + the filed upstream request (T1). Include the E1 finding on `updatedToolOutput` honored-ness as a shipped-behavior caveat if confirmed broken.
4. **Key-custody honesty** — file-based key custody defends against casual exfil of the map file alone, NOT against a same-user local attacker who can read both directories; name the adversary classes it does and does not stop (feeds Phase 11 copy-drift gate over "encrypted at rest" claims).
5. **Accepted residual risks** — retain-on-resume TTL window; enumeration residual under v2 tokens; SessionEnd best-effort (crash ⇒ TTL sweep is the backstop); win32 fail-open known-gap interaction.

Phase 8 drafts from made decisions + E-answers; Phase 11 finalizes against the shipped implementation and locks with copy-drift. Write it so claims about *unbuilt* code are framed as design commitments, not shipped facts (honest-framing discipline).

### PROJECT.md Amendment Audit

The literal "restore MCP tool stub / stub since Phase 1" wording is **already gone** from PROJECT.md (amended in the 2026-07-14 reshape) `[VERIFIED: grep this session]`. Remaining stale text: **PROJECT.md "What This Is" (line 5)** still says "…optionally restoring placeholders on the return path so file paths, names, and identifiers round-trip cleanly back into the user's view" — that describes in-session return-path restore, contradicting T1. The project-level CLAUDE.md mirrors the same sentence. Plan: amend both to operator-only-restore framing; if the planner finds no other stale wording, record "audited, one instance amended" against SC4.

## Common Pitfalls

### Pitfall 1: SessionEnd registered before the dispatcher route ships
**What goes wrong:** `dispatch()` throws `unknown hook event: SessionEnd` → crash guard exit 2 → fail-closed wrapper exit 2 at every session end (SC3 violated).
**Why:** dispatcher's default case throws by design `[VERIFIED: src/hook/dispatcher.ts:48]`.
**How to avoid:** types + dispatcher + no-op handler land in the same plan as (or before) the installer change; a dispatcher unit test proves SessionEnd routes and unknown events still throw.
**Warning signs:** hook error banners at session end in the E5 sandbox run.

### Pitfall 2: SessionEnd handler doing work
**What goes wrong:** config load in the handler → `ConfigReadError` on malformed TOML → exit 2 noise at session end; SessionEnd output is ignored anyway so any output is dead code.
**How to avoid:** pure `return null` (Pattern 4). Phase 9 replaces the body deliberately.

### Pitfall 3: Treating "byte-identical" as "no test changes anywhere"
**What goes wrong:** SC2's byte-identical guarantee is about the one-way redaction path and absent-`[reversible]` config, but SC3 *intends* registration-surface changes — tests asserting `matcher: 'startup'` (tests/install/settings.test.ts:68), doctor's "4 hook events" detail + REQUIRED_EVENTS, dispatcher fixtures, and tests/uat `buildHookSettings` all change on purpose.
**How to avoid:** plan wording: "existing detection/placeholder/audit suites pass unchanged; installer/doctor/dispatcher tests updated to the new 5-event surface" — and list the exact files (grep inventory in this doc's structure section).
**Warning signs:** a plan that forbids touching any test, or one that silently rewrites detection tests.

### Pitfall 4: Widened matcher's second-order effects treated as regressions
**What goes wrong:** SessionStart now fires on resume/clear/compact — banner re-injection and session-state re-init occur where they previously didn't; on malformed project config, the existing fail-closed exit 2 now also surfaces on `/clear`/resume.
**Why it's OK:** re-init on resume is a latent bug *fix* (env-blocklist/words cache was never rebuilt on resume); exit-2-on-malformed-config is existing intended behavior extended consistently. `model` field may be absent on clear/compact — handler doesn't read it `[VERIFIED: session-start.ts]`.
**How to avoid:** document as intended in the plan; E3/E5 sandbox runs observe it live.

### Pitfall 5: Experiments driven through mrclean's full stack
**What goes wrong:** detection/self-exemption/dry-run logic confounds the contract observation (e.g., mrclean returns `null` on no-findings so `updatedToolOutput` is never emitted; `MRCLEAN_TOOL_RE` self-exempts its own MCP tools).
**How to avoid:** minimal fixture hooks (Pattern 1); mrclean-in-the-loop only as a secondary confirmation.

### Pitfall 6: Reading stale docs answers as settled empirical facts
**What goes wrong:** the docs are silent or non-committal on exactly the four questions (that's why they're LOW confidence); #68951 proves documented ≠ honored, per tool and per version.
**How to avoid:** every docs/HOOK-CONTRACT.md verdict carries CC version + date + method; the harness is rerunnable; doctor copy references the *verified-on* version.

### Pitfall 7: Doctor exit-code map drift
**What goes wrong:** the seven-check exit-code map (1,2,3,4,6) is LOCKED `[VERIFIED: checks.ts header]`; bolting a new failing code on ad hoc breaks the documented map.
**How to avoid:** Phase 8's `checkReversibleState` is *reporting*: PASS "reversible mode: disabled (default one-way)" when off; when enabled, PASS with state detail — plus FAIL (reuse config-domain exit code 1, or deliberately extend the map with a new code and update the header comment) only for the version-floor case (enabled + CC < 2.1.121). Planner picks one and documents it in the LOCKED header.

### Pitfall 8: Filing the upstream issue non-interactively
**What goes wrong:** an agent posting to a public repo on the operator's GitHub account without review.
**How to avoid:** draft in-repo + `checkpoint:human-action`; the template preflight requires the duplicate-search evidence this research already gathered.

## Code Examples

### Widened installer constants (Pattern 5)

```ts
// src/install/settings.ts — Source: current file lines 18–27 [VERIFIED], target shape
const HOOK_EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'] as const

const HOOK_MATCHERS: Record<HookEvent, string | undefined> = {
  SessionStart: 'startup|resume|clear|compact',  // regex alternation [CITED: hooks docs]
  SessionEnd: undefined,   // no matcher — matcher filters on `reason`; handler must see ALL reasons
  UserPromptSubmit: undefined,
  PreToolUse: '*',
  PostToolUse: '*',
}
```

### No-op SessionEnd handler

```ts
// src/hook/handlers/session-end.ts — NEW (Pattern 4)
import type { SessionEndInput } from '../../shared/types.js'

/**
 * SessionEnd no-op (Phase 8 plumbing). Claude Code ignores SessionEnd output and
 * exit codes [CITED: code.claude.com/docs/en/hooks]. Phase 9 replaces this body with
 * the reason-aware janitor (delete on clear/logout/prompt_input_exit/other, retain
 * on resume; decide bypass_permissions_disabled there).
 * MUST stay free of config loads / I/O: any throw here becomes exit-2 noise at
 * every session end via the fail-closed wrapper (SC3).
 */
export async function handleSessionEnd(_input: SessionEndInput): Promise<null> {
  return null
}
```

### Config validator sibling ([pii] precedent)

```ts
// src/config/index.ts — validateReversibleConfig, mirrors validatePii* shape [VERIFIED precedent]
function validateReversibleConfig(raw: unknown, filePath: string): MrcleanReversibleConfig {
  if (!isRecord(raw)) {
    throw new ConfigReadError(filePath, '[reversible] must be a TOML sub-table')
  }
  if (raw['enabled'] !== undefined && typeof raw['enabled'] !== 'boolean') {
    throw new ConfigReadError(filePath, '[reversible].enabled must be a boolean')
  }
  return { enabled: raw['enabled'] === true }
}
```

### Session-id side-file fixture hook (E3)

```sh
#!/bin/sh
# e3-log-hook.sh — appends {event, session_id, source} from the stdin payload to $E3_LOG
# jq-free: node one-liner keeps deps at zero
node -e '
  let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
    const p=JSON.parse(d);
    require("fs").appendFileSync(process.env.E3_LOG,
      JSON.stringify({e:p.hook_event_name,sid:p.session_id,src:p.source??null})+"\n");
  })'
exit 0
```

## State of the Art

| Old Approach / Belief | Current Verified Fact | When Changed / Verified | Impact |
|--------------|------------------|--------------|--------|
| `updatedToolOutput` works for all tools since 2.1.121 (SDK changelog) | Silently ignored for built-in Bash — open bug #68951, repro'd on 2.1.163/2.1.177/**2.1.207** | verified 2026-07-14 | E1 hypothesis; shipped-mrclean PostToolUse gap to document; doctor copy overclaims |
| SessionEnd reasons: clear/resume/logout/prompt_input_exit/other (milestone research) | Docs now list a sixth: `bypass_permissions_disabled`; SessionEnd matcher filters on `reason` | docs fetched 2026-07-14 | Open reason type; register without matcher; Phase 9 janitor decides the new reason |
| `session_id` continuity across `--resume` fully unknown (LOW) | `--fork-session` flag documents "create a new session ID **instead of reusing the original**" — default resume implies reuse | claude --help v2.1.209 | Raises T5 prior to MEDIUM; E3 still required for hook-payload proof |
| 10K cap possibly binds all hook output | Docs enumerate `additionalContext`, `systemMessage`, plain stdout; overflow = file + preview + path; `updatedToolOutput` unlisted | docs fetched 2026-07-14 | E4 tests the unlisted field; overflow behavior (file redirect) is itself a finding for Phase 10 |
| Claude Code release train ~2.1.209 | 2.1.209 confirmed latest (changelog head) and installed locally | verified 2026-07-14 | Experiments run on the current release |
| PROJECT.md contains stale "restore MCP tool stub" wording | Literal wording already amended 2026-07-14; remaining stale text is the "What This Is" return-path sentence | grep this session | SC4 task becomes: audit + amend "What This Is" (and CLAUDE.md mirror) |

**Deprecated/outdated:**
- `updatedMCPToolOutput` — deprecated in favor of `updatedToolOutput` `[CITED: milestone SUMMARY.md / SDK changelog]`; never target it.
- Assumption that documented hook fields are honored — #68951 establishes docs ≠ behavior per tool; hence the version-stamped verification discipline.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | stream-json `init`/`result` events carry `session_id` usable by the harness | E3 | Low — side-file hook logging is the primary instrument; stream-json is a convenience |
| A2 | The interactive terminal renders tool output from the same transcript content the model consumes (user view == model view) | E1 | Medium — this is precisely what E1 + the human-verify checkpoint test; if false, a display-only channel may already effectively exist and T1's evidence base shifts (decision still stands until upstream ships an explicit channel) |
| A3 | `claude -p --resume <sid>` works in print mode from the same cwd | E3 | Low — docs show `-c -p` works; if `--resume` misbehaves in print mode, fall back to `--continue` or `--session-id` seeding, and record the limitation |
| A4 | SessionEnd fires at the end of headless `-p` sessions (reason likely `other`) | E5 | Medium — if it never fires headlessly, SC3's "no exit-2 noise" is verified interactively instead, and Phase 9's janitor leans harder on the TTL sweep (already mandatory) |
| A5 | `bypass_permissions_disabled` should be treated as delete-class by the Phase 9 janitor | Pattern 4 / THREAT_MODEL | Low for Phase 8 (no-op); flag to Phase 9 planning explicitly |

## Open Questions (RESOLVED)

1. **Is `updatedToolOutput` honored for ANY tool on 2.1.209?** — RESOLVED: answered by experiment design — E1 per-tool matrix is the phase's first experiment (deliberately empirical; REVMODE-10 deliverable). Every downstream doc (THREAT_MODEL §3, doctor copy, upstream issue) consumes its verdict. Adopted in 08-04.
   - What we know: broken for Bash through 2.1.207; unknown for Read/MCP tools; no fix in changelog through 2.1.209.
   - What's unclear: per-tool matrix on the current version.
2. **Does E4 have a testable substrate?** — RESOLVED: answered by experiment design — E4 runs with an honest fallback: "unanswerable on vX — blocked by #68951" is a legitimate documented verdict (SC1 requires documented answers, not positive ones). Adopted in 08-04.
   - If E1 shows the field ignored for all built-in tools, the 10K-cap question can't be answered for `updatedToolOutput` on this version.
3. **Doctor exit code for enabled-but-unsupported reversible config** (Pitfall 7). — RESOLVED: reporting-only this phase; exit 1 (config domain) reserved, LOCKED map untouched. Pinned as planner decision in 08-03 Task 2; FAIL-loud semantics deferred to Phase 10 (REVMODE-12).
4. **Where the experiment harness lives long-term.** — RESOLVED: `tests/uat/contract-verification.test.ts` under the existing `uat` project (opt-in, never CI), rerunnable on CC upgrades; findings artifact `tests/uat/artifacts/contract-findings.json` is the durable output. Adopted in 08-04.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Claude Code CLI (authenticated) | E1–E5 live experiments | ✓ | 2.1.209 | none — experiments are the phase; UAT preflight fails loud if auth expired (shipped pattern) |
| Node.js >= 20 | build/tests | ✓ | v22.22.0 | — |
| `gh` CLI (authenticated) | upstream issue search/filing | ✓ | account fuzzyqbit | web UI filing |
| npm scripts (`test`, `test:uat`, `build`, `typecheck`) | all waves | ✓ | per package.json | — |
| API budget (~10–20 Haiku calls) | experiments | ✓ (operator consent implied by MRCLEAN_UAT opt-in) | ~cents | reduce matrix |
| Transcript dir `~/.claude/projects/<slug>/` | E1/E2/E4 evidence | ✓ (prior UAT sandbox transcripts observed) | — | stream-json only |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1 (projects: `unit` parallel, `integration` sequential + tsup globalSetup, `uat` opt-in) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --project=unit <file>` |
| Full suite command | `npm test` (coverage gate: `npm run test:coverage` — 80/80/75/70 thresholds) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REVMODE-10 | Contract experiments run + record verdicts (harness integrity asserted; verdicts recorded) | live UAT (opt-in, spends tokens) | `npm run test:uat` (`--project=uat`) | ❌ Wave 0: `tests/uat/contract-verification.test.ts` |
| REVMODE-10 | Terminal rendering (interactive half) | manual-only — TUI observation; PTY automation rejected (Don't Hand-Roll) | checkpoint:human-verify | — |
| REVMODE-10 | Upstream issue filed + linked | manual-only — public post on operator account | checkpoint:human-action; link greppable in docs/HOOK-CONTRACT.md | — |
| REVMODE-03 | THREAT_MODEL reversible section present with required subsections | unit (content grep, copy-drift precedent) | `npx vitest run --project=unit tests/copy-drift.test.ts` (extend) | ✅ extend `tests/copy-drift.test.ts` |
| SC2 | `[reversible]` parse/validate/merge; absent table ⇒ `enabled:false` default | unit | `npx vitest run --project=unit tests/config/reader.test.ts` | ✅ extend |
| SC2 | Byte-identical one-way default | full suite green unchanged (detection/placeholder/audit suites untouched) | `npm test` | ✅ existing suites ARE the proof |
| SC3 | 5-event registration, widened matcher, v2.0→v3.0 migration without duplication, foreign hooks preserved | unit/integration | `npx vitest run tests/install/settings.test.ts tests/install/idempotency.test.ts` | ✅ extend (v2.0-shaped fixture new) |
| SC3 | SessionEnd dispatch routes; unknown events still throw; no-op returns null | unit | `npx vitest run --project=unit tests/hook/dispatcher.test.ts` | ✅ extend |
| SC3 | No exit-2 noise on session start/end (live) | live UAT (E5) + sandbox settings | `npm run test:uat` | ❌ Wave 0 (same harness file) |
| SC2 | Doctor reports reversible state; 5-event REQUIRED_EVENTS | unit | `npx vitest run --project=unit tests/doctor/checks.test.ts` | ✅ extend |

### Sampling Rate
- **Per task commit:** `npx vitest run --project=unit <touched-area tests>` + `npm run typecheck`
- **Per wave merge:** `npm test`
- **Phase gate:** `npm run test:coverage` green + one `npm run test:uat` run (operator-invoked) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/uat/contract-verification.test.ts` — E1–E5 harness (covers REVMODE-10, SC3 live observables)
- [ ] v2.0-shaped settings fixture for the migration test (extends tests/install/settings.test.ts)
- Framework install: none — existing infrastructure covers everything else.

## Security Domain

`security_enforcement` is absent from .planning/config.json → treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | no auth surface this phase |
| V3 Session Management | no (Claude-Code-session lifecycle ≠ web sessions; state code is Phase 9) | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `[reversible]` values validated via `ConfigReadError` path (typed validator, fail-closed); SessionEnd payload treated as untrusted (open `reason` string, no eval/exec); hook stdin already JSON.parse-guarded with exit-2 crash guards |
| V6 Cryptography | no this phase — Phase 9 owns AES-256-GCM store (never hand-roll; node:crypto stdlib per milestone STACK) | — |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Migration clobbers foreign user hooks in settings.json | Tampering | Surgical `_mrclean`-tagged filter + `backupJson` (shipped); migration test asserts foreign entries preserved |
| SessionEnd handler throw → exit-2 noise / user distrust → uninstall | DoS (of protection, socially) | Pure no-op handler; E5 live check; dispatcher test |
| Experiment sandbox leaking into operator's real config | Tampering | `--settings`/`--mcp-config`/`--strict-mcp-config` isolation (UAT-2b precedent); never write `~/.claude/settings.json` from tests |
| Shipped PostToolUse redaction inert for Bash (if E1 confirms #68951 on 2.1.209) | Information Disclosure | Document as THREAT_MODEL known-gap + doctor honest copy; UserPromptSubmit/PreToolUse layers still hold; full behavioral canary lands Phase 11 |
| Upstream issue leaking non-public detail | Information Disclosure | Human checkpoint review before filing (repo is the operator's public OSS anyway) |
| Fixture hook scripts with real secrets | Information Disclosure | Marker strings only (e.g., `ORIGINAL_E1_MARKER_q7v4`); leak-grep discipline continues |

## Sources

### Primary (HIGH confidence)
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) — fetched 2026-07-14: SessionEnd reasons (6 values incl. `bypass_permissions_disabled`), SessionEnd matcher-on-reason + output ignored, SessionStart source/matcher table, `updatedToolOutput`/`updatedInput` semantics, 10K-char cap wording + file-overflow behavior, common output fields (`systemMessage`, `suppressOutput`, `continue`).
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) + local `claude --help` (v2.1.209) — `--resume`, `--session-id <uuid>`, `--fork-session` ("instead of reusing the original"), `--settings`, `--output-format stream-json`.
- `gh issue view` / `gh search issues` on anthropics/claude-code (2026-07-14) — #68951 (open, labels: bug/has-repro/area:hooks; comment 2026-07-12 repro on 2.1.207), #18653 (open feature request), #54196/#65403/#67442 (closed duplicates), issue templates present.
- [anthropics/claude-code CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md) — head 2.1.209; no updatedToolOutput fix entries; 2.1.167 SessionStart stderr-on-exit-2 fix.
- mrclean source read this session: src/install/settings.ts, src/hook/{index,dispatcher}.ts, src/hook/handlers/{session-start,post-tool-use,pre-tool-use}.ts, src/config/{defaults,index}.ts, src/doctor/{checks,report,version-check}.ts, src/shared/types.ts, tests/uat/live-session.test.ts, THREAT_MODEL.md, vitest.config.ts, package.json, test-grep inventory.
- .planning: REQUIREMENTS.md, ROADMAP.md, STATE.md, PROJECT.md, research/SUMMARY.md (+ targeted PITFALLS.md greps) — T1–T6 decisions, cross-phase notes, phase criteria.

### Secondary (MEDIUM confidence)
- Milestone research (research/SUMMARY.md, 2026-07-14) claims re-verified where load-bearing: SessionEnd not fired on crash/SIGKILL, parallel hook execution, transcript-ratchet reasoning, 2.1.121 `updatedToolOutput` floor.

### Tertiary (LOW confidence — the phase's own experiments resolve these)
- Terminal rendering of `updatedToolOutput` (A2); `updatedInput` transcript echo; hook-payload `session_id` continuity across `--resume` (documented hint only); 10K cap on `updatedToolOutput`; SessionEnd firing in `-p` mode (A4); stream-json session_id fields (A1).

## Metadata

**Confidence breakdown:**
- Contract facts (docs-level): HIGH — fetched live today, cross-checked against local CLI help and upstream tracker.
- Codebase touchpoints & plumbing patterns: HIGH — read directly from source; every pattern has a shipped precedent.
- Experiment outcomes: deliberately UNKNOWN — that is the phase's purpose; hypotheses are evidence-ranked (E1 has an open upstream bug behind it).
- Pitfalls: HIGH — derived from source facts (dispatcher throw, LOCKED exit map, matcher semantics) rather than speculation.

**Research date:** 2026-07-14
**Valid until:** ~2026-07-28 (Claude Code releases roughly weekly; #68951 status and the changelog head should be re-checked at plan execution start — a fix landing mid-phase changes E1's hypothesis, not the harness)
