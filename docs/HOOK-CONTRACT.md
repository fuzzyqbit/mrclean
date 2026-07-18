# Claude Code Hook Contract — Empirically Verified Answers (Phase 8)

This document records the **empirically verified** answers to the hook-contract
questions that mrclean's reversible-mode design depends on (REVMODE-10). Every
verdict below traces to a recorded entry in the findings artifact
[`tests/uat/artifacts/contract-findings.json`](../tests/uat/artifacts/contract-findings.json),
produced by the rerunnable experiment harness
`tests/uat/contract-verification.test.ts` (opt-in: `MRCLEAN_UAT=1 npm run test:uat`,
record-don't-assert — harness integrity is hard-asserted, contract verdicts are recorded).

**Verification target:** Claude Code **2.1.209**, **2026-07-14**. Upstream bug
[anthropics/claude-code#68951](https://github.com/anthropics/claude-code/issues/68951)
confirmed still OPEN at run time. Docs claims are NOT treated as settled facts —
per-tool, per-version behavior is what this file records. Re-run the harness on
Claude Code upgrades and refresh the stamps below.

---

## E1 — Is PostToolUse `updatedToolOutput` honored, per tool? What does the terminal render?

**Verdict:** The channel is **NOT dead for built-in tools — it is SHAPE-VALIDATED per
tool.** STRING payloads are REJECTED for built-in Bash (zod `invalid_type`:
"expected object, received string") with an easy-to-miss hook warning, and the
original output is used. OBJECT-shaped payloads (`{stdout, stderr, interrupted,
isImage}`) ARE HONORED for Bash — the rewrite reached the model AND the terminal.
MCP tool results accept string content and are honored.

`[verified on Claude Code 2.1.209, 2026-07-14, live headless -p sessions with fixture PostToolUse rewrite hooks (record-don't-assert) + operator-directed PTY probes]`

### Per-tool matrix

| Tool | String payload | Object payload |
|------|----------------|----------------|
| Bash (built-in) | **REJECTED** — zod shape validation; hook warning; original output used | **HONORED** — `{stdout, stderr, interrupted, isImage}` (probe session `e244a7f9-6296-4413-a636-efea169636e2`; fixture `tests/uat/fixtures/e1-object-rewrite-hook.sh`) |
| Read (built-in) | **REJECTED** (string form; original output used) | **REJECTED** — Bash-style object refused: "rejected — zod error names Read's expected output shape (see verbatim excerpt)" (zod `invalid_union`, "No matching discriminator", path `["type"]`; probe session `8ba19558-500c-4deb-b068-d4903006bb34`, `experiments.E1_shape_validation.signals.read_object_verdict`/`read_object_hook_error`) |
| MCP tools | **HONORED** — MCP content is string-shaped (model quoted the REWRITTEN marker) | n/a |

### Evidence excerpt

Verbatim hook error from the string-shape session transcript
(`experiments.E1_shape_validation.verbatim_hook_error` in contract-findings.json):

> PostToolUse hook returned updatedToolOutput that does not match Bash's output
> shape; using original output. [ { "expected": "object", "code": "invalid_type",
> "path": [], "message": "Invalid input: expected object, received string" } ]

Sessions: `79b56324-4cc2-4817-8ea9-c8e604bb18c5` (string form, rejected) /
`e244a7f9-6296-4413-a636-efea169636e2` (object form, honored).

### Terminal rendering (interactive half)

**Verdict:** The terminal **displays the model-facing value.** An honored rewrite
(object shape) renders the REWRITTEN output; a rejected rewrite (string shape)
renders a "PostToolUse:Bash hook warning" line and NO output line. No observed
case renders the original alongside a successful rewrite — user view follows
model view; there is no separate display channel.

`[verified on Claude Code 2.1.209, 2026-07-14, operator-directed automated PTY observation (tmux capture-pane; one-off — not the committed harness)]`

### Downstream implications

- **THREAT_MODEL wire re-entry / doctor copy:** PostToolUse redaction of built-in
  Bash output IS achievable — but only when the hook emits the tool-specific
  OBJECT shape. mrclean's shipped handler (`src/hook/handlers/post-tool-use.ts`
  Step 7) emits the STRING form, so on 2.1.209 mrclean's PostToolUse rewrite is
  honored for MCP tool outputs and **silently inert for built-in tools** (the
  rejection warning is visible only as a transcript/TUI hook-warning line).
  Doctor copy updated accordingly (`src/doctor/version-check.ts` green detail).
- **#68951 reinterpretation:** the "silently ignored for built-in Bash" reports
  most likely use the string form. Our object-shape evidence extends that issue.
- **Rendering (Phase 10 restore-path UX):** display follows the model-facing
  value — a display-only rewrite channel does not exist (see Upstream feature
  request below).

---

## E2 — Does PreToolUse `updatedInput` echo into the transcript / model context?

**Verdict:** **No context echo observed.** The rewritten command EXECUTED (tool
output contained the UPDATED marker), but the transcript `tool_use` input block
preserves the ORIGINAL command — the model quoted the original command and the
updated output.

`[verified on Claude Code 2.1.209, 2026-07-14, live headless -p session; fixture PreToolUse allow+updatedInput hook (complete tool_input object)]`

### Evidence excerpt

`experiments.E2.signals.model_reply_excerpt`:

> **(1) Exact command run:** `echo INPUT_ORIG_MARKER_e2`
> **(2) Exact output returned:** `INPUT_UPDATED_MARKER_e2`

Transcript signals: `tool_use` input contains original (not updated);
`tool_result` contains updated (not original).

### Downstream implication

- **Phase 10 input-restore scope fence:** no transcript echo of `updatedInput`
  was observed, so an input-side restore would not ratchet via the tool_use
  block on this version — recorded for the v3.x decision. The fence stands
  regardless: input-side restore remains deferred this milestone (T1 locked).

---

## E3 — Is `session_id` continuous across `--resume` in hook payloads?

**Verdict:** **Yes — plain `--resume` REUSES the session_id** in hook payloads
(SessionStart + UserPromptSubmit both logged the original id). Control:
`--resume <sid> --fork-session` minted a NEW id. SessionStart fired with
`source: "resume"` through the widened `startup|resume|clear|compact` matcher
(live proof of the 08-02 installer pattern).

`[verified on Claude Code 2.1.209, 2026-07-14, live headless sessions from the same cwd; log-hook side file on SessionStart+UserPromptSubmit; control run with --fork-session]`

### Evidence excerpt

`experiments.E3.signals`: `sid_run1 = 184c5b4a-7a93-4bec-a81e-40d5b3bbe717`,
reused verbatim by the resume run's init event and hook payloads;
fork-session control minted `e1036ad1-9ea3-40f1-bf93-e1b461223979`.

### Downstream implication

- **Phase 9 T5 retain-on-resume gate: REAL, not dead code.** Rehydrating the
  reversible-mode placeholder map on resume has a working substrate — the
  session_id observed by hooks after `--resume` matches the original session.

---

## E4 — Does the documented 10K-char hook-output cap bind `updatedToolOutput`?

**Verdict:** **The cap does NOT bind `updatedToolOutput`.** Recorded verdict
(`experiments.E4.verdict`):
"cap does NOT bind updatedToolOutput (~15K survived intact for Bash)".
A >10K Bash output (`seq 1 3000`) was rewritten by the fixture hook to a ~15K
OBJECT-shaped `updatedToolOutput`; both HEAD and TAIL markers reached the
model-facing `tool_result` intact (observed length: 15,032 chars). **Control finding:** a ~15K-char `additionalContext` was **NOT
capped** in this observation — both HEAD and TAIL markers reached the transcript
(the documented 10K cap was not observed at ~15K).

`[verified on Claude Code 2.1.209, 2026-07-14, live headless -p session; >10K Bash output; ~15K OBJECT-shaped updatedToolOutput via tests/uat/fixtures/e4-object-large-output-hook.sh]`

### Downstream implications

- **Phase 10 restore-in-large-outputs scope:** no truncation bound applies to
  `updatedToolOutput` rewrites at ~15K on this version — a full-size rewritten
  tool output survives intact, so restore-scope design needs no 10K truncation
  carve-out. The bound is tested to ~15K; re-run E4 with a larger payload before
  relying on sizes far beyond that.
- **Phase 9 map-size expectations:** tool-output rewrites are not clipped at 10K
  on 2.1.209, so placeholder-map growth from large-output rewrites is bounded by
  actual tool-output size, not by a hook-output cap.

---

## E5 — Does SessionEnd fire in headless `-p` mode? Does mrclean's real hook produce noise?

**Verdict:** **SessionEnd did NOT fire in headless `-p` mode** (side file never
written). And mrclean's real fail-closed hook (SessionStart widened matcher +
SessionEnd no-op) produced **zero hook-error / exit-2 stderr noise** in a live
session — SC3's live observable satisfied.

`[verified on Claude Code 2.1.209, 2026-07-14, live headless -p sessions; log-hook side file for firing; real built hook + stderr scan for noise]`

### Downstream implication

- **Phase 9 janitor:** SessionEnd is absent in headless mode (and per upstream
  docs never fires on crash/SIGKILL) — the TTL sweep is **mandatory**, not a
  backstop. Assumption A4 confirmed pessimistic.

---

## Per-tool tool_response shapes (PostToolUse input)

**Question (re-homed Phase 10 STATE.md todo):** does the shipped handler's
Step 3 coercion (`typeof tool_response === 'string' ? tool_response :
JSON.stringify(tool_response)` — `src/hook/handlers/post-tool-use.ts`) scan
structured `tool_response` INPUT shapes adequately per tool? Upstream docs
show only a Bash string example; the per-tool input shape is undocumented.
This is the INPUT-side complement of E1's OUTPUT-side shape validation.

**Verdict: pending first MRCLEAN_UAT=1 wire-safety run (CLI 2.1.212).**
Verdicts here are **recorded, never asserted** (Pattern 2 discipline — the
harness reports upstream drift as findings instead of red CI). The 2.1.209
stamps on the E-sections above remain in force until that run re-stamps them.

### Per-tool matrix

| Tool | `typeof tool_response` | Structure observed | Stringify-coercion adequacy |
|------|------------------------|--------------------|-----------------------------|
| Bash | pending first MRCLEAN_UAT=1 wire-safety run (CLI 2.1.212) | pending first MRCLEAN_UAT=1 wire-safety run (CLI 2.1.212) | pending first MRCLEAN_UAT=1 wire-safety run (CLI 2.1.212) |
| Read | pending first MRCLEAN_UAT=1 wire-safety run (CLI 2.1.212) | pending first MRCLEAN_UAT=1 wire-safety run (CLI 2.1.212) | pending first MRCLEAN_UAT=1 wire-safety run (CLI 2.1.212) |
| Grep | pending first MRCLEAN_UAT=1 wire-safety run (CLI 2.1.212) | pending first MRCLEAN_UAT=1 wire-safety run (CLI 2.1.212) | pending first MRCLEAN_UAT=1 wire-safety run (CLI 2.1.212) |
| MCP (mcp__wire-canary__echo_project_notes) | pending first MRCLEAN_UAT=1 wire-safety run (CLI 2.1.212) | pending first MRCLEAN_UAT=1 wire-safety run (CLI 2.1.212) | pending first MRCLEAN_UAT=1 wire-safety run (CLI 2.1.212) |

### Evidence

Filled by the `tests/uat/wire-safety.test.ts` survey legs: the
`tool_response_shapes` record in
[`tests/uat/artifacts/contract-findings.json`](../tests/uat/artifacts/contract-findings.json),
captured by the parallel observer hook
`tests/uat/fixtures/postresp-log-hook.sh` (appends
`{tool_name, typeof tool_response, truncated raw JSON}` per PostToolUse
event; hooks on one event run in parallel, so the observer records the raw
pre-substitution payload even alongside mrclean's real hook). Run via the
[Re-verification procedure](#re-verification-procedure); when the live run
re-stamps this matrix, update the doc and the artifact TOGETHER — the
session-UUID traceability gate (tests/copy-drift.test.ts) build-enforces
that any session UUID quoted here traces to the artifact. This section
deliberately quotes none until then.

### Downstream implications

- **The E1 asymmetry stays the interpretation lens** for whatever the survey
  records: string `updatedToolOutput` is honored for MCP tools and REJECTED
  for built-in Bash
  ([#68951](https://github.com/anthropics/claude-code/issues/68951) /
  [#77587](https://github.com/anthropics/claude-code/issues/77587) — both
  OPEN as of 2026-07-17). The INPUT-side shapes recorded here say whether
  Step 3's `JSON.stringify` sees the full structured payload; the
  OUTPUT-side validation in §E1 says whether a rewritten result is accepted
  back per tool.
- **Detection-coverage consequence:** if a tool's `tool_response` arrives as
  a structured object whose stringified form omits or transforms scanned
  text, detection coverage for that tool is affected — that would be a
  recorded finding to carry into THREAT_MODEL.md, never a silent assumption.

---

## Closed follow-ups

Both former open items were settled empirically by the 08-08 harness legs, run
live in 08-09 (fresh 2.1.209 stamps, 2026-07-14):

- **Read object-shape probe (E1): CLOSED.** The Bash-style OBJECT payload is
  REJECTED for built-in Read — the zod `invalid_union` error ("No matching
  discriminator", path `["type"]`) names Read's expected output shape as a
  discriminated union the Bash shape does not satisfy. Recorded in
  `experiments.E1_shape_validation.signals` (`read_object_verdict`,
  `read_object_hook_error`); rerunnable via the committed E1/Read-object leg.
  Read's exact accepted shape remains undocumented upstream — what is settled
  is that the Bash shape is refused, with the verbatim error on record.
- **E4 rerun via object-shaped Bash payload: CLOSED.** Run through the honored
  Bash-object leg — the cap does not bind at ~15K (see §E4). Recorded in
  `experiments.E4`.

---

## Upstream feature request

**Status:** filed 2026-07-14 — <https://github.com/anthropics/claude-code/issues/77587>

Filed as: "[FEATURE] Document per-tool updatedToolOutput shapes and make
PostToolUse shape-rejection loud (hook-based sanitizer use case)". Body taken
from the draft below with its header block and "Suggested title" section
stripped (body started at "## Preflight Checklist"); no other edits.

Draft: [`docs/upstream/display-only-channel-request.md`](upstream/display-only-channel-request.md).
Reframed per the E1 shape-validation discovery: the primary asks are
(a) document per-tool `updatedToolOutput` shapes, (b) surface shape-rejection
warnings loudly (or accept string coercion for built-ins); a display-only
rewrite channel for the sanitizer round-trip UX (grounded in the E1 rendering
verdict: display follows the model-facing value) is retained as distinguished
related context. Filing was operator-authorized and executed from the
operator's account — never autonomously by an agent (RESEARCH Pitfall 8).

---

## Re-verification procedure

```sh
MRCLEAN_UAT=1 npm run test:uat   # opt-in; spends ~cents of Haiku tokens
```

The harness regenerates `tests/uat/artifacts/contract-findings.json` with fresh
version stamps. On any Claude Code upgrade that changes a verdict, update this
document's stamps and the consuming copy (`src/shared/types.ts` JSDoc,
`src/doctor/version-check.ts` detail, THREAT_MODEL.md wire re-entry section).

The findings writer is guarded (08-08, proven live in 08-09): a run that records
zero verdicts refuses to overwrite the artifact, so an auth-failed or crashed run
cannot clobber committed evidence. Interactive-only evidence the headless harness
cannot reproduce (`E1.rendering`, the string-shape `verbatim_hook_error`) is
carried forward from the previous artifact — re-running on upgrades no longer
destroys cited evidence (WR-01 closed).
