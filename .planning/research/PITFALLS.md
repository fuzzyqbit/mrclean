# Pitfalls Research

**Domain:** Reversible redaction (session-scoped placeholder→original restore) added to an existing one-way in-session sanitizer — per-event hook processes + long-lived MCP server split
**Milestone:** v3.0 Reversible Redact Mode (REVMODE-01/02/03)
**Researched:** 2026-07-14
**Confidence:** HIGH on Claude Code hook contract facts (verified against live docs); HIGH on architecture-specific reasoning (derived from shipped v1/v2 invariants in PROJECT.md); MEDIUM on concurrency failure reports and LLM placeholder-mangling prevalence (community postmortems + vendor docs, multiple sources agree)

## Context: What Makes This Milestone Dangerous

mrclean's core value is a *negative guarantee*: "real secrets never reach the wire." v1.0/v2.0 earned that guarantee with a one-way design — nothing sensitive is ever stored, so there is nothing to leak, nothing to restore into the wrong place, and nothing to race over. Reversible mode inverts every one of those properties: it **stores originals** (map file = new leak surface), it **writes originals back into content** (restore = new reinsertion surface), and it **shares mutable state across short-lived parallel processes** (map = new race surface).

The verified hook-contract facts this milestone rests on:

- **PostToolUse can rewrite tool results** via `hookSpecificOutput.updatedToolOutput` — but that rewritten output goes **into model context**, i.e., onto the wire at the next API call. The restore path is *wire-bound*, not just user-bound. `additionalContext` also enters model context. (HIGH — official hooks reference)
- **Transcript contamination is a ratchet**: hooks only process *new* prompts and tool payloads — conversation history is never re-run through redaction. Once a raw value enters the transcript, every subsequent API request re-ships it, it persists in `~/.claude/projects/**/*.jsonl`, and it re-ships again on `--resume`. No hook can claw it back. (HIGH — follows directly from the hook contract)
- **PostToolUse exit code 2 is NON-blocking** — unlike PreToolUse, you cannot fail-closed on the return path via exit codes. The tool already ran; the only levers are `updatedToolOutput` and `decision: "block"`. (HIGH — official hooks reference)
- **The field names are asymmetric**: PreToolUse rewrites via `updatedInput`, PostToolUse via `updatedToolOutput`, both nested under `hookSpecificOutput`. Easy to conflate; unknown fields are silently ignored by Claude Code. (HIGH)
- **SessionEnd output is completely ignored** (exit codes and JSON both) and fires with reasons including `resume` — it is a best-effort side-effect slot, not a guaranteed cleanup point (does NOT fire on crash/kill), and naive "delete map on SessionEnd" breaks resumed sessions. (HIGH — official hooks reference)
- **Hooks execute in parallel**; when multiple hooks rewrite the same content, last-writer-wins non-deterministically, and concurrent hook writes to shared JSON files are a community-documented corruption source. (MEDIUM-HIGH — docs + multiple community postmortems)
- **The upstream changelog rolls off old versions** (GitHub `main` currently starts at 2.1.209) — you cannot verify historical feature support (e.g., the ≥ 2.1.121 floor for REVMODE-01) from the changelog at runtime. Version gating must be done directly. (HIGH — verified this session)
- Prior art (LLM Guard `Deanonymize`, LangChain `PresidioReversibleAnonymizer`, Microsoft PII Shield) ships **fuzzy matching strategies because models mangle placeholders** — case changes, typos, dropped delimiters, tokens split across wrapped lines. Fuzzy restore is the industry workaround; for a security tool it is also a mis-restore hazard. (HIGH — LLM Guard docs via Context7; MEDIUM on prevalence)

## Critical Pitfalls

### Pitfall 1: "User-View Only" Restore Has No Hook-Native Home — `updatedToolOutput` Is Model-Facing

**What goes wrong:**
The milestone copy says restore brings values "back into the user's view," and the v2.0 scope fence bans model-facing unredact. But the hook contract offers no user-display-only rewrite channel: `updatedToolOutput` replaces what *the model* sees, `additionalContext` enters model context, and the terminal renders from the same transcript the model consumes. Restoring identifier-class values (paths, names, Layer-4 dirty words) via PostToolUse therefore puts them into model context → onto the wire at the next API call — quietly un-redacting exactly the proprietary terms the user listed. And per the ratchet fact above, it is unrecoverable: history is never re-sanitized, so one restored value leaks on *every subsequent request* and persists in the on-disk transcript for resume to re-ship.

This is the trap hiding inside REVMODE-01 as written: "restore on PostToolUse" is either (a) a deliberate, documented decision that identifier classes re-enter the wire in reversible mode, or (b) an accidental scope-fence breach that looks correct in every local test — because the user's view and the model's view are the same transcript, the leak is invisible in the terminal.

**Why it happens:**
`updatedToolOutput` is the obvious, documented way to rewrite a tool result, and the restored output looks right on screen. Developers conflate "what I see" with "what stays local." The ≥ 2.1.121 version floor suggests the design assumed a specific capability — if that capability is just `updatedToolOutput`, the "user-view only" framing and the implementation contradict each other.

**How to avoid:**
- **Phase 1 go/no-go verification (before any implementation):** establish exactly what Claude Code ≥ 2.1.121 provides for the restore path, and specifically whether *any* display-only surface exists. If none does, the design must change: restrict restore to surfaces mrclean owns (a `mrclean show`/`mrclean audit --restored` CLI rendering, MCP tool results returned only in user-invoked flows) — or make the per-class wire-exposure decision explicitly and write it into THREAT_MODEL.md ("reversible mode re-exposes path/name/identifier classes to Anthropic's API"), consistent with v2.0's honest-framing precedent and enforced by the copy-drift CI gate.
- **Canary round-trip CI test (non-negotiable regardless of the decision):** seed a canary identifier, run restore through the chosen channel in a live headless session (the Phase 01 UAT-2b harness is the right vehicle), capture the next outbound API request body, and grep for the canary. Whatever the documented policy is, this test proves the implementation matches it.
- **Verify PreToolUse `updatedInput` reflection before using input-side restore:** restoring placeholders in tool *inputs* so tools execute against real local paths is the natural companion feature — but it is unverified whether the rewritten input is reflected back into the transcript/model context. Same canary methodology; if it reflects, input-side restore has the same ratchet problem.

**Warning signs:**
Design docs that say "restore on PostToolUse" without naming the exact JSON field and its visibility semantics; no test that inspects an actual outbound request body; restored values appearing in `~/.claude/projects/**/*.jsonl` beyond the intended surface; THREAT_MODEL.md silent on where restored values travel.

**Phase to address:**
Requirements/threat-model phase (REVMODE-03) — this is the go/no-go question for the milestone shape; every later phase depends on the answer. The canary round-trip gate lands in the verification phase.

---

### Pitfall 2: The Map File Becomes the Leak Vector

**What goes wrong:**
The placeholder→original map is, by construction, a curated index of everything mrclean decided was sensitive this session — neatly labeled with types. Persisted as plaintext JSON, it is a *better* exfiltration target than the raw repo: backup agents, cloud sync (iCloud/Dropbox indexing `~`), Spotlight, other agents' Read tools, and `git add .` all pick it up. Sub-failures compound: default `0644` perms from umask; the map landing **inside the project tree** (`.mrclean/` is in-repo — the model itself can `Read` it, and a `.gitignore` lapse commits it); the encryption key stored beside the ciphertext (encryption theater); un-fsynced temp files from atomic rewrites lingering after crash. A recursive twist: if the model ever reads the map file (or its plaintext temp sibling), the contents flow into a tool result and mrclean's own detectors become the last line of defense against its own artifact.

**Why it happens:**
The path of least resistance is "reuse `.mrclean/` like audit.jsonl does" and `fs.writeFile(path, JSON.stringify(map))`. The audit log got away with in-repo placement because it is hash-only. The map is categorically different — it contains originals — and the difference is easy to miss because the plumbing looks identical.

**How to avoid:**
- **State dir outside the project tree**: `~/.claude/mrclean/state/<sha256(session_id)>/` (or XDG state dir), directory `0700`, files `0600`, created with `O_EXCL`; temp files for atomic rewrite created `0600` in the same directory.
- **Ciphertext-only-on-disk invariant**: encrypt in memory *first*; the byte stream handed to any `fs` call — including the temp file in temp+rename — is always ciphertext. Never write plaintext then encrypt. Enforce with a test that intercepts fs writes during a map update and asserts no plaintext canary appears in any written buffer.
- **Encrypt at rest (AES-256-GCM)** per the PROJECT.md constraint, with key custody resolved in requirements *before* building (see Pitfall 13).
- **Structural blast-radius cap**: the persistent map only ever contains identifier-class entries (see Pitfall 3). Then even a leaked map exposes paths/names, not credentials.
- **Defense in depth**: add the state dir to the PreToolUse denylist so the model's own Read/Bash/Grep calls against it are blocked.

**Warning signs:**
Any `writeFile` in `src/state/` without an explicit `mode`; state path derived from `cwd` or project root; key material and ciphertext in the same directory without a documented tradeoff; a plaintext buffer flowing toward a temp-file write; a test fixture map containing an AWS-shaped string.

**Phase to address:**
Requirements/threat-model phase (REVMODE-03) decides key custody and placement; state-adapter phase (REVMODE-02) implements; verification phase checks perms + placement + a leak-grep over the state dir.

---

### Pitfall 3: Restore Reinserts SECRETS into Wire-Bound Content

**What goes wrong:**
`updatedToolOutput` replaces what *the model* sees — restored content goes into model context and out to the Anthropic API on the next turn (Pitfall 1 covers the identifier-class policy question; this pitfall is about the class that has no policy question at all). A class-blind restore ("look up every placeholder, swap in the original") sends secrets right back to the wire, silently, while the user believes they're protected. This is worse than having no tool. The same trap exists on the MCP side: the `restore` tool's result is a tool result → model context → wire, **and the model itself can invoke it** — prompt-injected content ("run mrclean restore on this text") turns the restore tool into a self-service deanonymization oracle. Tokenization-vault practice is unambiguous that the reversal path is the highest-value, most-privileged surface in the system; here the "caller" is an LLM steered by whatever untrusted content it last read.

**Why it happens:**
v1.0 has one placeholder pipeline for all layers, so the obvious implementation is one `Map<placeholder, original>` and one `restore(text)` function. Nothing in that shape distinguishes an ENV secret from a file path. The milestone's own copy — "paths/names/identifiers round-trip, secrets stay protected" — is a *policy*; policies enforced by config flags get flipped.

**How to avoid:**
- **Secrets never enter the reversible map — by construction, not by filter.** Two stores: secret-class placeholders live only in the ephemeral in-process flow exactly as in v1.0 (nothing persisted, nothing restorable); the session map's entry type is `IdentifierEntry` (path/filename/project-term classes) and cannot represent secret classes at the type level. `restore()` accepts only the identifier store.
- Per-class `restorable` allowlist decided at detection time, hardcoded for secret classes (never configurable to true — no `restore.include_secrets` knob, ever).
- The MCP `restore` tool refuses secret-class placeholders unconditionally, never returns raw values to model-initiated calls (metadata-only responses are the safe shape), audit-logs every invocation, and is documented as model-invocable in THREAT_MODEL.md (prompt-injection scenario enumerated).
- **Canary regression**: seed a fake AWS key + a fake project path; run a full reversible round trip; assert the path round-trips and the key placeholder survives *every* surface (updatedToolOutput, MCP tool results, state file, audit, stderr). Extend the existing v2.0 leak-grep to cover this.

**Warning signs:**
A single map keyed only by placeholder string; `map.get(ph)` with no class check anywhere in the restore path; a `restoreAll` or `mode: "full"` config option; the restore MCP tool accepting arbitrary text and returning restored text unconditionally.

**Phase to address:**
REVMODE-03 (threat model states the invariant as a hard scope fence, like v2.0's "no unredact" fence); REVMODE-01 implements the type-separated stores; verification phase owns the canary grep.

---

### Pitfall 4: Placeholder Collision / Instability Across Processes

**What goes wrong:**
v1.0's "stable collision-free placeholders" guarantee was earned inside a single process. Hooks are per-event *processes* that run in parallel: two concurrent PostToolUse events each start a counter, both allocate `<MRCLEAN:PATH:007>` for *different* originals, and the map now lies. Restore then swaps in the **wrong original** — one file's path appears where another's belonged, corrupting content the user trusts. The dual failure is the same original getting *different* placeholders across events, which breaks the model's ability to correlate references across turns (degraded, not dangerous — but it erodes the feature's whole point).

A second instability source: the model mangles placeholders — case changes (`<mrclean:path:003>`), markdown escaping (`\<MRCLEAN:PATH:003\>`), zero-padding drift, dropped angle brackets (models and renderers treat `<...>` as an HTML/XML tag), tokens split across wrapped lines or streaming chunk boundaries. LLM Guard ships `fuzzy` and `case_insensitive` matching strategies precisely for this. **Do not copy that answer**: fuzzy restore in a security tool can match the wrong span and reinsert a value where it doesn't belong.

**How to avoid:**
- Placeholder allocation moves into the locked session store: look up by hash of the original first (content-addressed → same original, same placeholder), allocate the next counter *under the same lock* on miss.
- Strict exact-match restore only, with at most *bounded normalization* (case-fold, strip backslash-escapes) that can never alter TYPE or digits. A mangled placeholder that doesn't match stays unrestored (fail-safe) and emits an advisory audit event; never fuzzy, never nearest-neighbor on NNN.
- **Track the restore-miss rate**: count placeholder-shaped strings remaining after restore per event (hash-only audit metric). This is the field signal that a model/renderer is mangling tokens — tune the *normalizer* with observed variants, never the match strictness.
- Property test: N concurrent processes sanitize overlapping content → no duplicate placeholder for distinct originals, no distinct placeholders for one original, and every issued placeholder round-trips. Mangling-corpus test: case/escape/wrap/truncation variants → correct-or-skip, never wrong-NNN.

**Warning signs:**
A module-scope `let counter = 0` in hook-path code; placeholder computed before the lock is acquired; test suite only exercises single-process sequential flows; any dependency or code path implementing approximate matching; users reporting literal placeholder text in output (miss-rate signal, not a reason to go fuzzy).

**Phase to address:**
REVMODE-02 — allocation is a state-adapter responsibility; the restore engine (REVMODE-01) consumes it and owns the matcher + miss-rate metric.

---

### Pitfall 5: Concurrent Hook Events Corrupt the Map

**What goes wrong:**
Claude Code fires hooks in parallel, and parallel tool calls mean parallel PostToolUse events. Two processes doing read → modify → `writeFile` on `session-map.json` produce last-writer-wins entry loss (later restores silently miss) or torn/interleaved JSON (map unreadable — see Pitfall 10 for what must NOT happen next). Concurrent hook writes corrupting shared JSON is a documented failure mode in the Claude Code hooks community.

**Why it happens:**
The single-process mental model again. Also, developers avoid file locking because it "adds latency" — and mrclean genuinely has `<100ms/<200ms` budgets — so the lock gets skipped "for now."

**How to avoid:**
- Advisory lock around every map mutation: `proper-lockfile` (mkdir-strategy lock; stale-lock timeout ~2–5s, bounded retries with jitter) or an `O_EXCL` lock-dir; measured lock hold time target < 10ms. Note `write-file-atomic` alone does NOT provide cross-process mutual exclusion — temp+rename prevents torn files, not lost updates; you need both.
- All writes are atomic: temp file (`0600`, same directory, ciphertext per Pitfall 2) → `fsync` → `rename`. Never write in place.
- Reads are defensive: schema-validate (Zod) on load; a corrupt file is treated as *absent for restore purposes* (fail-safe no-op) plus an audit event — never an uncaught exception in the hook.
- Consider (and document the rejection or adoption of) the single-writer alternative: the long-lived MCP server owns all map state in memory, hooks submit via local IPC. Stronger — no file races, and it pairs with memory-only key custody (Pitfall 13) — but adds an IPC dependency to the hot path. This is the state-adapter's central design decision; make it explicitly.
- Stress test in CI: spawn 8–16 concurrent hook processes hammering allocate/restore on one session; assert zero lost entries and valid JSON after every interleaving.

**Warning signs:**
`readFile`/`JSON.parse`/`writeFile` sequences with no lock in `src/state/`; intermittent "unknown placeholder" restore misses only under parallel tool bursts; JSON parse errors in the Claude Code debug log.

**Phase to address:**
REVMODE-02 — "locking + atomic rewrite" is literally named in the milestone; the CI stress test belongs to the same phase's success criteria. Flag the IPC-vs-lockfile decision for design review at phase start.

---

### Pitfall 6: Session Identity Confusion / Spoofing Restores Another Session's Values

**What goes wrong:**
Two different trust levels get conflated. The `session_id` in a **hook payload** comes from Claude Code — trusted. A `session_id` passed as an **MCP tool argument** is authored by the model — untrusted and prompt-injectable. If the `restore` tool takes session_id as a parameter, injected content can request *any* session's map. Secondary failures: raw session_id interpolated into a filename is a path-traversal vector (`"../../..."`); and when a lookup misses, "helpful" code that falls back to scanning all map files performs cross-session restore — placeholders from session A resolved with session B's values.

Subagents add a subtle variant: Task-tool sub-sessions can carry distinct session_ids, so parent-issued placeholders won't resolve in a naively-keyed child map. The correct behavior is *leave them unrestored*, not "search other maps."

**How to avoid:**
- The MCP server derives session binding from the **transport**, never from a model-supplied argument: stdio server = the session that spawned it; Streamable HTTP = the transport-layer MCP session ID. The `restore` tool schema has no session_id parameter at all.
- session_id → filename via `sha256(session_id)` (fixed hex alphabet — no traversal possible by construction).
- No cross-session fallback, ever. Unknown placeholder = pass through unchanged + advisory audit event.
- The per-session nonce in the placeholder format (Pitfall 7) makes foreign-session placeholders inert even if code regresses.

**Warning signs:**
`session_id: z.string()` in the restore tool's input schema; `path.join(stateDir, sessionId + ".json")`; any loop over `fs.readdir(stateDir)` in a restore code path.

**Phase to address:**
REVMODE-01 (restore tool wiring — transport-derived binding); REVMODE-03 (threat model enumerates the two trust levels and the prompt-injection scenario explicitly).

---

### Pitfall 7: Partial Restore on Substring/Overlapping Placeholders — and Placeholder Injection

**What goes wrong:**
Two related failures in the replacement engine:

1. **Substring clobbering.** `<MRCLEAN:PATH:1>` is a prefix of `<MRCLEAN:PATH:10>` once counters outgrow their padding (v1.0's `NNN` caps at 999; long sessions with many paths will pass it). Naive per-entry sequential `replaceAll` in map order turns `<MRCLEAN:PATH:100>` into `{restored-path-1}00>` — corrupted content written back into model context or user files.
2. **Placeholder injection.** Multi-pass replacement re-scans already-restored text; and the v1.0 format is **guessable**. Attacker-controlled content (a fetched web page, a README in a cloned repo) can embed literal `<MRCLEAN:ENV:001>` … `<MRCLEAN:ENV:050>` strings — sequential counters make spray-and-see enumeration trivial. A restore pass that matches them swaps in *real values from the map*, and that content flows onward — to model context (wire), or **to disk** if the placeholder sits inside a `Write`/`Edit` tool input (real proprietary path persisted into the repo → committed → leaked). Reversible mode turns a guessable placeholder format into an exfiltration oracle. (With the Pitfall 3 invariant in place the blast radius is identifiers, not secrets — but paths/names are exactly what mrclean promised to keep off the wire.)

**How to avoid:**
- **Single-pass replacement**: one compiled regex matching the full delimited token shape, with a callback that does an exact-token map lookup. Never iterate `for (entry of map) text = text.replaceAll(...)`. Output text is never re-scanned.
- **Placeholder format v2 for reversible mode**: add an unguessable per-session segment — `<MRCLEAN:TYPE:NNN:xxxxxxxx>` where `xxxxxxxx` is from a per-session CSPRNG nonce. Planted/guessed tokens can't match; foreign-session tokens can't match (Pitfall 6); the regex requires the closing delimiter so prefix-substring ambiguity is gone regardless of counter width.
- Only tokens the *current session's map actually issued* are ever replaced (lookup-miss = pass through).
- **Restore never runs on tool inputs or file-write payloads** — one `restore()` chokepoint bound to the designated surface (per the Pitfall 1 decision), the way v2.0 binds output through `sanitizeForOutput()`. As a tripwire, flag placeholder-shaped strings appearing in `Write`/`Edit` tool inputs (a placeholder being persisted to disk is either injection or a model mistake — both worth surfacing).
- Adversarial fixtures in the test suite: maps of 1/10/100/1500 entries; adjacent, repeated, and nested tokens; a restored value that itself contains a token-shaped string; planted tokens for entries that don't exist; planted tokens copied from a *different* session's map.

**Warning signs:**
A `replaceAll` loop over map entries; zero tests above 999 entries; no adversarial fixture with a literal placeholder embedded in "external" tool output; placeholder format unchanged from v1.0 in reversible mode; restore logic reachable from more than one call site.

**Phase to address:**
Format v2 + allocation in REVMODE-02; the single-pass restore engine + adversarial fixtures in REVMODE-01.

---

### Pitfall 8: Restore Feeds Back into Redact — Placeholder Churn and Map Growth

**What goes wrong:**
A restored value re-enters a surface that outbound redaction scans: the user quotes restored output in their next prompt, or restored text lands in a file whose contents a later tool result echoes. Detection fires on the value again — correct and necessary. The failure is what happens next if allocation is not content-addressed at that moment: a **new** placeholder is minted for the same original. The map grows every turn, the model sees multiple aliases for one entity (degrading cross-turn reasoning — the exact thing round-tripping was meant to fix), NNN inflates past its padding (aggravating Pitfall 7's substring hazard), and the audit log fills with churn. The degenerate case is a fixpoint-style "replace until no placeholders remain" restore loop meeting a self-referencing value — a map entry whose original literally contains placeholder-shaped text (entirely plausible in mrclean's own repo, where test fixtures contain `<MRCLEAN:...>` strings) — producing unbounded substitution or an injection amplifier.

**Why it happens:**
One-way mode never needed value→placeholder idempotence *across* events, only within one. Restore creates the redact→restore→redact cycle for the first time, and the cycle spans process boundaries where in-memory dedup doesn't exist.

**How to avoid:**
- Content-addressed allocation under the store lock (Pitfall 4) is the necessary foundation — same original always yields the same placeholder for the session, no matter which process re-detects it.
- **Single-pass substitution in BOTH directions**, never iterate to fixpoint; restored output is never re-scanned by the same event's pipeline.
- **Defined per-event ordering invariant**: redact and restore never both traverse the same text within one event; document which surfaces are redact-only (outbound) and which are restore-only (the Pitfall 1 surface) and assert it at the pipeline entry point.
- **Map-growth alarm**: warn and cap (e.g., 5k entries, matching the perf-trap threshold) — entry count growing linearly with turns instead of plateauing is the churn signature.
- Audit invariant check: distinct placeholders per value-hash must be exactly 1; a CI test runs a scripted multi-event session and asserts the map plateaus.

**Warning signs:**
Multiple placeholders in the audit log hashing to the same value hash; NNN counter far exceeding distinct-entity count; map entry count growing every turn in a session that touches the same files repeatedly; any loop of the shape `while (containsPlaceholder(text))`.

**Phase to address:**
REVMODE-02 (content-addressed allocation); REVMODE-01 (single-pass engine + ordering invariant); the plateau test in the verification phase.

---

### Pitfall 9: Audit Log Captures Restored Values

**What goes wrong:**
v1.0's invariant — audit.jsonl is hash-only, and it lives *in-repo* — meets a new code path that holds originals in its hands after map lookup. The classic leak is the error path: `throw new Error(\`failed to restore ${ph} -> ${entry.original}\`)`, a debug log of before/after diffs, or an audit event recording the restored text. One interpolated template literal and the in-repo audit file (or Claude Code's debug log, or stderr shown to the model) contains raw originals.

**Why it happens:**
Error messages want context; restore errors are most usefully described by what failed to restore. v2.0 already fought this battle (`sanitizeForOutput()` chokepoint + leak-grep regression) — the risk is the *new* module not being wired through the *existing* chokepoint.

**How to avoid:**
- Every log/error/audit emission in `src/state/` and the restore engine routes through the existing `sanitizeForOutput()` chokepoint. No new logger.
- Restore audit events carry `{placeholder, class, valueHash}` only — same discipline as detection events.
- Extend the v2.0 leak-grep regression: run a full reversible-mode session with seeded canaries and grep audit.jsonl, stderr, stdout JSON, and the debug transcript for them. This is cheap and already has CI precedent.

**Warning signs:**
Template literals interpolating `entry.original` anywhere; `catch (e) { throw new Error(...context...) }` wrappers in restore code; any `console.*` call in `src/state/` that bypasses the chokepoint.

**Phase to address:**
REVMODE-01 (wiring through the chokepoint is an implementation requirement); verification phase owns the extended leak-grep gate.

---

### Pitfall 10: Fail-Open Temptation — Degraded Restore Disabling Redaction

**What goes wrong:**
The correct failure asymmetry is subtle and must be designed, not discovered: the **sanitize direction is fail-closed** (Phase 01 just shipped a wrapper where a missing bin blocks tool calls with exit 2), while the **restore direction is fail-safe** — a missing/corrupt/undecryptable map means content passes through *with placeholders still in it*: ugly, zero leak. The trap has two shapes: (a) shared error handling or a single `enabled` flag, where "reversible mode is broken, disable mrclean for this session so the user isn't stuck" ships a leak in one code review; (b) making restore failures *blocking* — note PostToolUse exit 2 is non-blocking anyway, but a developer who moves restore into a blocking position (or uses `decision: "block"`) makes map corruption halt all tool flow, and a user whose tool is stuck **uninstalls it** — fail-open by user action.

**How to avoid:**
- Two error domains with no shared kill switch: `SanitizeError` → fail-closed (block, exit 2 on PreToolUse/UserPromptSubmit); `RestoreError` → fail-safe no-op + one-time `systemMessage` warning to the user + audit event. Nothing in the restore error path may touch sanitize configuration or the wrapper.
- Restore failures never block: no `decision: "block"`, no nonzero exits for restore-only problems on PostToolUse. Never partially restore with uncertain values — an unrestored placeholder beats a wrong substitution everywhere.
- Chaos contract test: mid-session, corrupt the map / delete it / `chmod 000` it / truncate mid-JSON → assert (1) placeholders pass through unrestored, (2) a seeded canary secret is *still redacted* on the next outbound event, (3) no tool call was blocked.

**Warning signs:**
One top-level try/catch wrapping the entire hook `main()`; any config value like `mode: "off"` reachable from an error handler; a restore failure that produces exit code 2 on a blocking event; user-facing docs implying reversible-mode breakage turns protection off.

**Phase to address:**
REVMODE-02 defines the error taxonomy (state adapter is where failures originate); verification phase runs the chaos tests. REVMODE-03 documents the asymmetry as policy.

---

### Pitfall 11: Claude Code Hook Contract Drift (PostToolUse Rewrite Semantics)

**What goes wrong:**
REVMODE-01 depends on `hookSpecificOutput.updatedToolOutput`, available only on Claude Code ≥ 2.1.121. Three drift modes: (a) an **older** Claude Code silently ignores the unknown field — restore silently no-ops, users see raw placeholders and blame mrclean (confusing but safe); (b) a **future** version renames/moves the field (the contract has churned before — the ecosystem deprecated SSE transport in one spec revision, `additionalContext` semantics for Stop hooks changed in 2.1.183) — same silent no-op, but after a working install regresses via auto-update; (c) precedence changes when *multiple* hooks return `updatedToolOutput` — docs already note last-writer-wins is non-deterministic for parallel hooks, so another output-rewriting hook in the user's config can clobber mrclean's restore (or worse, mrclean's *sanitize* rewrite). Also verified: the upstream changelog rolls old entries off (`main` currently starts at 2.1.209), so historical capability can't be confirmed from the changelog — version gates must be explicit.

**How to avoid:**
- Install-time + `mrclean doctor` version gate: parse `claude --version`, refuse to *enable reversible mode* below 2.1.121 (with a clear message); one-way mode is unaffected.
- Runtime capability canary in doctor: a headless round-trip (the Phase 01 UAT-2b harness is exactly the right precedent) that plants a placeholder in a synthetic tool result and asserts the restored form reached the transcript — proving `updatedToolOutput` was honored, not just emitted.
- All contract knowledge in one module (`src/hooks/contract.ts`): field names, event shapes, version floors, doc URL, last-verified date. Zod-validate incoming payloads; treat unknown shapes as fail-safe (restore no-op) or fail-closed (sanitize block) per direction.
- CI job against the latest Claude Code release (the Compatibility constraint already mandates tracking release notes — this makes it mechanical).
- Doctor warns when *other* PostToolUse output-rewriting hooks are registered alongside mrclean.

**Warning signs:**
Users reporting "placeholders in my terminal" after a Claude Code auto-update; doctor green while restore no-ops (doctor checks presence, not behavior); contract field names spelled inline across multiple files.

**Phase to address:**
REVMODE-01 (contract module + version gate ship with the restore path); doctor canary in the verification phase.

---

### Pitfall 12: Crash Leaves Orphaned Session State

**What goes wrong:**
SessionEnd is not a guaranteed cleanup point: it doesn't fire on SIGKILL, crashes, or power loss, and its output/exit codes are *ignored by design* — it's best-effort. Orphaned map files accumulate in the state dir indefinitely: a growing, timestamped index of sensitive identifiers that outlives every session it belonged to. The opposite failure is just as real: SessionEnd fires with reason `resume` when a session merely *suspends* — a janitor that deletes the map on every SessionEnd breaks resumed sessions, leaving placeholders in the resumed transcript permanently unrestorable (and, absent the format-v2 nonce of Pitfall 7, a *new* session's freshly-restarted counter can collide with stale transcript placeholders — silent wrong-value restore). Compaction is a third nuance: placeholders can survive `/compact` inside summarized context, so the map must survive compaction too (SessionStart fires with `source: "compact"` — that is not a new session).

**How to avoid:**
- **Reason-aware SessionEnd**: delete on `clear` / `logout` / `other` / `prompt_input_exit`; retain with TTL on `resume`.
- **Janitor sweeps at multiple points, not just SessionEnd**: at SessionStart, at MCP server boot, and lazily (cheap mtime scan) on hook invocation — delete maps past TTL (24h default, configurable) and emit an audit event per deletion.
- **Make orphans worthless**: if key custody is MCP-server-memory-only, a crash kills the key with the process and orphaned ciphertext is self-neutralizing garbage — the janitor becomes hygiene, not a security control. This property should weigh heavily in the REVMODE-03 key-custody decision (Pitfall 13).
- The per-session nonce (Pitfall 7) doubles as the resume-collision guard: stale placeholders from a prior session can never match a new session's map.
- Test matrix: kill -9 the session mid-flight → next SessionStart sweeps; suspend/resume → map survives and round-trip still works; `/compact` → map survives.

**Warning signs:**
Cleanup logic existing *only* in the SessionEnd handler; the state dir growing week over week on a dev machine; resumed sessions showing raw placeholders (deleted too eagerly); a resume showing a *wrong* restored value (collision — incident-grade, see Pitfall 4).

**Phase to address:**
REVMODE-02 — "janitor cleanup on SessionEnd" is named in the milestone, but the phase must implement the multi-point sweep, not just the SessionEnd handler.

---

### Pitfall 13: Key-Management Footguns for Encrypted-at-Rest Without a Keychain

**What goes wrong:**
Keychain custody is deferred (POLISH-03), so the key must live somewhere less good. The classic failures, all observed repeatedly in local-tool crypto:
- **Key beside ciphertext** (key file in the state dir, or key embedded in the map header) — obfuscation, not encryption; every exfiltration vector in Pitfall 2 grabs both.
- **Key derived from `session_id`** — session_id appears in every hook payload, in transcripts, and potentially in logs; anything that read the transcript can derive the key. Same for hostname, machine ID, or project path: derivable inputs are not keys.
- **Key in an environment variable** — leaks via child-process inheritance, `ps eww`/`/proc`, crash dumps, CI logs.
- **AES-GCM nonce reuse** — a static IV, or an IV stored once per file while the file is rewritten on every map mutation, is catastrophic for GCM (keystream reuse + authentication forgery). Frequent crash-recovery rewrites make this the *likely* failure, not a corner case.
- **Decrypt-then-trust** — skipping auth-tag verification (or using CBC without a MAC) lets a tampered map feed attacker-chosen "originals" into restore.
- **Overclaiming** — "encrypted at rest" copy that implies protection from a same-user local attacker, which no keychain-less custody delivers (the key is readable by the same user who reads the ciphertext); or claiming secure memory erasure, which Node cannot guarantee (GC copies Buffers — say "held in process memory," never "securely erased").

**How to avoid:**
- **Prefer MCP-server-memory custody**: random 256-bit DEK from `crypto.randomBytes` generated at session start, held only in the long-lived MCP server's memory; hooks perform map operations via IPC (pairs with the Pitfall 5 single-writer option) so the key never touches disk. Crash kills the key → orphans are dead ciphertext (Pitfall 12). Note this makes crash *recovery* of the map impossible — decide in requirements whether crash recovery is even a requirement; "crash = map irrecoverable" is arguably the correct semantics for a session-scoped, blast-radius-limited artifact.
- If a keyfile fallback is chosen: random (never derived), `0600`, in a *different* directory from the ciphertext, covered by the janitor + SessionStart sweep, and documented in THREAT_MODEL.md as defending against the backup/sync/indexer/git class only — **not** same-user malware. The copy-drift CI gate (v2.0 precedent) should cover the "encrypted at rest" claim wording.
- Mechanics: `aes-256-gcm` via `crypto.createCipheriv`, fresh `randomBytes(12)` IV **per encryption event**, IV + auth tag stored alongside ciphertext, tag verification failure = treat map as absent (fail-safe restore skip per Pitfall 10), never best-effort decrypt. Never `crypto.createCipher` (deprecated, IV-less).

**Warning signs:**
Any key argument tracing back to session_id / hostname / a constant; IV generated at file creation instead of per write; `createCipher` (no `-iv`) anywhere; README or THREAT_MODEL text claiming local-attacker protection or secure memory wiping; key and ciphertext in the same directory without a documented tradeoff.

**Phase to address:**
REVMODE-03 decides custody and the honest claim *first* (including whether disk persistence exists at all); REVMODE-02 implements; verification phase greps docs vs. implementation via the copy-drift gate.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Restore identifiers via `updatedToolOutput` without an explicit wire-exposure decision | Ships REVMODE-01 as written | Silently un-redacts Layer-4 terms; transcript ratchet makes it unrecoverable (Pitfall 1) | Never without a THREAT_MODEL decision + canary round-trip gate |
| Plaintext map "temporarily," encrypt later | Ships REVMODE-02 faster | The tool's own artifact violates its core value from day one; "later" arrives after a leak | **Never** — PROJECT.md constraint is explicit |
| Temp+rename with plaintext temp file, encrypt afterwards | Reuses atomic-write library defaults | Crash window leaves plaintext on disk (Pitfall 2) | Never — ciphertext-only-on-disk invariant |
| Reuse v1.0 placeholder format (no nonce) for reversible mode | No format migration | Guessable tokens = placeholder-injection oracle (Pitfall 7); resume-collision hazard (Pitfall 12); retrofit forces a map schema migration | Never for reversible mode; one-way mode may keep v1 format |
| Single shared map for all detection layers | Less plumbing | Secrets become restorable the day someone flips a flag (Pitfall 3) | Never — class separation must be structural |
| Skip file locking to protect the latency budget | Saves ~1–5ms | Silent entry loss / torn JSON under parallel tool calls (Pitfall 5) | Never; if the budget genuinely can't absorb it, that's a design signal to move writes to the MCP server, not to drop the lock |
| Cleanup only in SessionEnd | One handler, done | Orphan accumulation + broken resume (Pitfall 12) | Only as the *first* commit of the janitor work, never at phase close |
| Fuzzy placeholder matching to handle model mangling | Better restore recall | Mis-restore into wrong spans; unauditable behavior in a security tool (Pitfall 4) | Never; bounded normalization + log-and-skip instead |
| Key derived from session_id ("no key storage problem!") | Zero key-management code | Key recoverable from transcripts/logs — encryption theater (Pitfall 13) | Never |
| Restore tool takes session_id as an argument | Easy multi-session testing | Model-invocable cross-session deanonymization (Pitfall 6) | Never in shipped tool; acceptable in a test-only harness binary |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code PostToolUse | Assuming `updatedToolOutput` is display-only | It replaces what *the model* sees → wire-bound; per-class exposure decision + canary round-trip test (Pitfall 1) |
| Claude Code PostToolUse | Assuming exit 2 blocks (it does on PreToolUse) | Exit codes are non-blocking on PostToolUse; the only levers are `updatedToolOutput` and `decision: "block"` — design restore as fail-safe no-op |
| Claude Code PostToolUse | Emitting `updatedInput` (PreToolUse field) on the return path | `hookSpecificOutput.updatedToolOutput` — asymmetric names; centralize in a contract module with Zod schemas |
| Claude Code PreToolUse | Assuming `updatedInput` rewrites stay out of model context | Unverified — canary-test whether rewritten inputs are reflected into the transcript before building input-side restore on it |
| Claude Code transcripts | Forgetting `~/.claude/projects/**/*.jsonl` persists whatever hooks emit | Restored values in transcripts re-ship on resume; keep restored values off transcript surfaces |
| Claude Code SessionEnd | Relying on it for guaranteed cleanup or returning JSON from it | Output ignored, not crash-proof; reason-aware handling (`resume` ≠ terminate) + multi-point janitor |
| Claude Code hooks (general) | Assuming serialized hook execution | Hooks run in parallel; other users' output-rewriting hooks can clobber yours (last-writer-wins); doctor should detect co-registered rewriting hooks |
| MCP `restore` tool | Trusting model-supplied arguments for identity; returning raw values to model-initiated calls | Transport-derived session binding; metadata-only responses to the model; the model is inside the threat model here |
| MCP stdio vs Streamable HTTP | Testing reversible mode only on stdio | Streamable HTTP sessions have their own session-ID semantics; the map keying must be verified on both transports (Compatibility constraint) |
| Existing v1.0 placeholder pipeline | Bolting restore onto the current in-process map | Allocation must move into the shared locked store or cross-process stability breaks (Pitfall 4) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Lock contention on the map under parallel tool bursts | PostToolUse latency spikes past 200ms; hooks time out | Lock hold < 10ms, atomic rename writes, bounded retry with jitter; lock-timeout → restore skips (fail-safe), never blocks; measure in the existing perf CI gate | ~4+ simultaneous tool calls with map writes |
| Full map load + decrypt per hook event | Per-event latency grows with session length | Map stays small (identifier classes only); cap entries (e.g., 5k) with advisory once exceeded; AES-GCM on <100KB is sub-ms — fine | Sessions with tens of thousands of distinct identifiers |
| Rebuilding the restore regex per event from a giant alternation | CPU spike on large maps | Single token-shape regex + map lookup callback (O(1) per match), not an alternation of all placeholders | Alternation approach breaks around thousands of entries; lookup approach doesn't |
| Re-encrypting the snapshot on every PostToolUse | Write amplification, more crash windows, more IVs to get right | Write on change-batch or interval if disk persistence exists at all; moot under MCP-memory custody | High tool-call-frequency sessions |
| Placeholder churn from non-idempotent allocation (Pitfall 8) | Map and latency grow every turn | Content-addressed allocation; plateau assertion in CI | Long sessions revisiting the same files |
| Janitor scanning the state dir synchronously in the hook hot path | Every hook pays a directory-scan tax | Lazy sweep with a throttle marker (at most once per N minutes), full sweep only at SessionStart/MCP boot | State dirs with hundreds of orphans (i.e., after the bug you were preventing) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Restoring any class via a model-facing surface without a documented decision | Identifier classes ratchet into transcript → every later API call leaks them; unrecoverable | Phase-1 exposure decision; canary round-trip CI proving outbound bodies match policy |
| Map file inside the project tree | Model reads it via Read tool; git commits it; scanners index it | State dir under `~/.claude/mrclean/state/`, never `cwd`; PreToolUse denylist on the state dir |
| Plaintext in atomic-write temp files | Crash artifacts recoverable from disk | Encrypt in memory first; fs-write interception test asserts ciphertext-only |
| Encryption key beside ciphertext, undocumented | Users believe "encrypted at rest" means more than it does | Prefer MCP-memory key custody; if keyfile fallback, document the exact adversary classes it does/doesn't stop in THREAT_MODEL.md |
| Key derived from session_id / machine ID; key in env var | Key recoverable from transcripts, logs, `ps`, crash dumps | Random `randomBytes(32)` DEK only; memory custody preferred |
| AES-GCM nonce reuse across map rewrites; decrypt without tag verification | Keystream reuse + forgery; tampered map feeds attacker-chosen "originals" into restore | Fresh random 12-byte IV per write; tag failure = map absent (fail-safe) |
| Guessable placeholder format in reversible mode | Placeholder injection = deanonymization oracle for attacker-controlled content; enumerable via sequential NNN | Per-session CSPRNG nonce segment in every reversible placeholder |
| Restore MCP tool callable with arbitrary text/session | Prompt-injected exfiltration via tool results (which reach the wire) | Transport-bound session identity; identifier-class-only restore; metadata-only returns; scenario in THREAT_MODEL.md |
| Restored originals in error messages / audit | In-repo audit.jsonl or model-visible stderr carries raw values | All restore-path output through `sanitizeForOutput()`; extended leak-grep with canaries |
| session_id used raw in file paths | Path traversal writing/reading outside state dir | `sha256(session_id)` filenames |
| Shared kill switch between sanitize and restore | Restore breakage disables protection | Separate error domains; chaos test proves sanitize survives restore failure |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent restore no-op (version too old, map gone) | Raw placeholders all over the terminal, user blames mrclean and uninstalls | One-time `systemMessage` explaining degraded state + `mrclean doctor` hint; doctor canary detects it |
| Restore failures blocking tool calls | Session unusable; user disables the whole tool (fail-open by frustration) | Restore is never blocking, ever |
| Wrong-value restore (collision, fuzzy match, resume-stale placeholder) | Worst outcome — user sees a confidently wrong path/name and may act on it | Prefer unrestored placeholder over any uncertain substitution, everywhere |
| Reversible mode enabled without understanding blast radius | Users opt in casually, then panic on discovering a state file exists | Explicit opt-in flow (REVMODE-03) that prints what is stored, where, encrypted how, deleted when — and where restored values travel (Pitfall 1 decision) |
| "Encrypted at rest" copy implying local-attacker protection | False sense of security | THREAT_MODEL-sourced copy; covered by the copy-drift CI gate like v2.0's honest-framing claims |
| Janitor deleting the map on suspend | Resumed sessions permanently show placeholders | Reason-aware SessionEnd (`resume` retains with TTL) |
| Placeholder soup in model prose (identifiers never restored in user-visible assistant text) | Feature feels broken even when working — there is no hook to rewrite assistant display text | Set expectations in docs: round-trip covers tool results and files, not the model's prose; consider a `mrclean show` CLI to render a transcript with restores applied |

## "Looks Done But Isn't" Checklist

- [ ] **Restore surface policy:** Often missing the outbound proof — verify the restored canary does NOT appear in the next outbound API request body (or appears only per the documented per-class decision), and check `~/.claude/projects/**/*.jsonl` for the same
- [ ] **Restore engine:** Often missing adversarial fixtures — verify planted-token, cross-session-token, token-inside-restored-value, and >999-entry cases all pass
- [ ] **State adapter:** Often missing concurrency proof — verify the 8–16 concurrent process stress test exists and gates CI, not just unit tests of the lock wrapper
- [ ] **Idempotence:** Often missing the cross-event check — verify the same value redacted in two separate hook processes yields the SAME placeholder, and the map plateaus in a scripted long session
- [ ] **Encryption at rest:** Often missing key-custody honesty — verify THREAT_MODEL.md names the adversary classes the chosen custody model does NOT stop; verify fresh IV per write and tag-verification-failure handling
- [ ] **Ciphertext-only:** Often missing the temp-file check — verify intercepted fs writes (including atomic-write temp files) never contain a plaintext canary
- [ ] **Janitor:** Often missing the non-SessionEnd sweeps — verify kill -9 → SessionStart sweep test, and resume-retention test
- [ ] **Fail-safe restore:** Often missing the sanitize-survival assertion — chaos test must prove a canary is still redacted *after* restore breaks, not just that restore no-ops
- [ ] **Version gate:** Often missing behavioral verification — doctor must prove `updatedToolOutput` was *honored* (headless canary), not just that the version string parses ≥ 2.1.121
- [ ] **Audit discipline:** Often missing the new-module bypass — verify leak-grep runs against a reversible-mode session, including stderr and debug transcript, with seeded canaries
- [ ] **MCP restore tool:** Often missing transport-binding tests on Streamable HTTP — verify session identity is transport-derived on both transports, and that a model-initiated call gets no raw values
- [ ] **Type-filtered restore:** Often missing the structural check — verify secret-class entries *cannot be constructed* in the persistent map type, and a mixed-content session's state file greps clean

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Raw values ratcheted into transcript (Pitfall 1/3) | HIGH | No hook-level recovery — values already shipped and re-ship with history. `/clear` stops the re-shipping; treat exposed terms as disclosed; rotate anything credential-adjacent. Prevent-only — hence the Phase 1 gate |
| Map leaked (plaintext or key+ciphertext) | HIGH | Treat every identifier in it as exposed; rotate anything credential-adjacent it referenced; ship state-dir relocation + perms fix; postmortem in THREAT_MODEL.md |
| Secrets found in the persistent map | HIGH | Incident-level: this violates core value. Purge state dirs on update (janitor kill-switch), rotate affected secrets, add the structural type separation that should have existed, add regression grep |
| Placeholder collision corrupted user files | MEDIUM | Map is the source of truth for what was written where; provide `mrclean repair <file>` best-effort re-restore; fix allocation locking; property tests |
| Placeholder churn / map bloat discovered | LOW-MEDIUM | Content-addressed allocation fix; one-time map dedup by value-hash; plateau test added to CI |
| Torn/corrupt map JSON | LOW | Fail-safe already handles it (restore no-op); janitor quarantines the corrupt file with an audit event; session continues one-way |
| Restore regressed after Claude Code update | LOW | Doctor canary identifies it; disable reversible mode with systemMessage until contract module updated; one-way protection unaffected |
| Orphan accumulation discovered | LOW | Janitor TTL sweep clears on next start; if custody was memory-key, orphans were dead ciphertext anyway |

## Pitfall-to-Phase Mapping

Assumes the roadmap orders v3.0 roughly as: **P1 Threat model & design (REVMODE-03) → P2 Session State Adapter (REVMODE-02) → P3 Restore path + MCP tool (REVMODE-01) → P4 Verification/UAT**. Threat model must come FIRST, not last — Pitfalls 1, 2, 3, 6, 10, and 13 are design decisions, and PROJECT.md already flags that requirements must resolve the REVMODE-02 plaintext-session-file tension before build. **P1 contains the milestone's go/no-go question (Pitfall 1) and P2's IPC-vs-lockfile choice (Pitfall 5) — flag both phases for design-level research.**

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Model-facing restore surface / user-view fence | P1 exposure decision + ≥2.1.121 capability verification. **Go/no-go gate** | Canary round-trip: restored value absent from next outbound request body (UAT-2b harness) in P4 |
| 2. Map file as leak vector | P1 decides custody/placement; P2 implements | Perms/placement assertions + fs-write ciphertext interception + state-dir leak-grep in P4 |
| 3. Restore reinserts secrets | P1 invariant (scope fence); P3 type-separated stores + metadata-only MCP tool | Canary round-trip grep across all surfaces in P4 |
| 4. Placeholder collision/instability/mangling | P2 (locked, content-addressed allocation); P3 matcher + miss-rate metric | Multi-process property test in P2 CI; mangling-corpus test in P3 |
| 5. Concurrent map corruption | P2 (locking + atomic rewrite; IPC-vs-lockfile decision) | 8–16 process stress test gating CI |
| 6. Session spoofing/confusion | P1 trust-boundary enumeration; P3 transport binding | Tool-schema review (no session_id param) + cross-session fixture in P4 |
| 7. Partial restore / placeholder injection | P2 format v2 (nonce); P3 single-pass engine + Write/Edit tripwire | Adversarial fixture suite in P3; injection canary in P4 |
| 8. Restore→redact churn loop | P2 content-addressed allocation; P3 single-pass + ordering invariant | Plateau assertion + distinct-placeholder-per-value-hash audit check in P4 |
| 9. Audit captures restored values | P3 (chokepoint wiring) | Extended leak-grep gate in P4 |
| 10. Fail-open temptation | P1 policy; P2 error taxonomy | Chaos tests (corrupt/delete/chmod map) in P4 |
| 11. Hook contract drift | P3 (contract module + version gate) | Doctor headless canary (UAT-2b harness) in P4; ongoing CI vs latest Claude Code |
| 12. Crash orphans / resume | P2 (multi-point janitor, reason-aware SessionEnd) | kill -9 / resume / compact test matrix in P2–P4 |
| 13. Key-management footguns | P1 custody + honest-claim decision; P2 implementation | IV-per-write + tag-failure tests in P2; copy-drift gate over "encrypted at rest" claims in P4 |

## Sources

**HIGH confidence (official docs, verified 2026-07-14):**
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — `updatedToolOutput` under `hookSpecificOutput` for PostToolUse ("directly replaces the tool's result that Claude sees"); `additionalContext` enters model context; `updatedInput` for PreToolUse (asymmetric); PostToolUse exit 2 non-blocking; SessionEnd output ignored, not fired on crash/kill, reasons include `resume`; SessionStart sources include `compact`; hooks run in parallel, multiple `updatedToolOutput` writers undefined; hook payload common fields incl. `session_id`
- [Claude Code CHANGELOG (main)](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) — verified old entries roll off (currently starts at 2.1.209); 2.1.183 Stop/SubagentStop `additionalContext` change as contract-churn precedent
- [LLM Guard Deanonymize scanner docs](https://protectai.github.io/llm-guard/output_scanners/deanonymize/) (via Context7 `/protectai/llm-guard`) — Vault pattern; `exact` / `case_insensitive` / `fuzzy` / `combined_exact_fuzzy` matching strategies exist because models mangle placeholders
- [`write-file-atomic` (npm org)](https://github.com/npm/write-file-atomic) — temp+rename semantics; provides atomicity, NOT cross-process mutual exclusion
- [`proper-lockfile` (npm)](https://www.npmjs.com/package/proper-lockfile) — mkdir-strategy inter-process lock, stale-lock mtime threshold

**MEDIUM confidence (multiple community/vendor sources agree):**
- [Claude Code Hooks: Why Each of My 95 Hooks Exists](https://blakecrosley.com/blog/claude-code-hooks) and [claudefa.st hooks guide](https://claudefa.st/blog/tools/hooks/hooks-guide) — parallel hook execution; last-writer-wins on concurrent rewrites; JSON corruption from concurrent hook writes, fixed via serialization
- [Claude Code Hooks in 2026: A Production Playbook](https://www.totalum.app/blog/claude-code-hooks-totalum) — PostToolUse behavior under parallel tool calls
- [Microsoft PII Shield privacy proxy](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/introducing-pii-shield-a-privacy-proxy-for-every-llm-call/4514726) — reversible placeholder detokenization where the model rewrites everything around tokens; placeholder survival as the restore contract
- [Secure LLM Usage With Reversible Data Anonymization (DZone)](https://dzone.com/articles/llm-pii-anonymization-guide) and [Redacting PII Before It Hits the LLM](https://nirajranasinghe.medium.com/redacting-pii-before-it-hits-the-llm-0fe9507f05e0) — reversible tokenization pattern and in-memory mapping as the standard shape
- [Protecting the tokenization reversal path (NHIMG)](https://nhimg.org/faq/how-can-organisations-protect-the-reversal-path-in-a-tokenization-model/) and [Baffle: Data Tokenization is Insecure — examples](https://baffle.io/blog/why-data-tokenization-is-insecure/) — the reversal path as the highest-value privileged surface; enumeration/oracle attacks against detokenization; audit-all-detokenizations guidance
- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) and [Unit 42: web-based indirect prompt injection in the wild](https://unit42.paloaltonetworks.com/ai-agent-prompt-injection/) — untrusted tool-consumed content steering agents; basis for the restore-oracle and placeholder-injection attack chains

**Project-internal (HIGH confidence):**
- `.planning/PROJECT.md` — security constraint (memory-only default, encrypted-at-rest if persisted, removed on session exit); REVMODE-01/02/03 scope; ≥ 2.1.121 floor; v2.0 `sanitizeForOutput()` chokepoint + leak-grep + copy-drift-gate precedents; Phase 01 fail-closed wrapper + UAT-2b headless canary precedent; v2.0 scope fence (no model-facing unredact); out-of-scope: no cross-session map persistence

**Open questions (LOW confidence — resolve in P1):**
- What exactly Claude Code ≥ 2.1.121 provides for REVMODE-01 — specifically whether any user-display-only restore surface exists. Current public docs show only model-facing rewrite fields; the changelog rollback makes historical verification impossible from docs alone. This is the milestone's go/no-go item (Pitfall 1).
- Whether PreToolUse `updatedInput` rewrites are reflected back into the transcript/model context. Determines whether input-side restore (tools executing against real local paths) is safe or has the same ratchet problem. Same canary methodology.

---
*Pitfalls research for: mrclean v3.0 Reversible Redact Mode*
*Researched: 2026-07-14*
