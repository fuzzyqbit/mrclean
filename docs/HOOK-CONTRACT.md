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
| Read (built-in) | **REJECTED** (string form; original output used) | **UNTESTED** — Read's expected output shape is unknown (open follow-up) |
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

`experiments.E3.signals`: `sid_run1 = 8f87d5ac-b7b7-43bc-95e0-192352a6e416`,
reused verbatim by the resume run's init event and hook payloads;
fork-session control minted `e08e5d75-0cdf-4226-bd02-a4f0027a8bff`.

### Downstream implication

- **Phase 9 T5 retain-on-resume gate: REAL, not dead code.** Rehydrating the
  reversible-mode placeholder map on resume has a working substrate — the
  session_id observed by hooks after `--resume` matches the original session.

---

## E4 — Does the documented 10K-char hook-output cap bind `updatedToolOutput`?

**Verdict:** **Unanswerable for built-in tools on this version at run time** —
the string-form `updatedToolOutput` was rejected for Bash and Read (see E1), so
the cap could not be exercised through the built-in path; the MCP path was not
exercised for the cap question. Honest documented outcome per RESEARCH Open
Question 2. **Control finding:** a ~15K-char `additionalContext` was **NOT
capped** in this observation — both HEAD and TAIL markers reached the transcript
(the documented 10K cap was not observed at ~15K).

`[verified on Claude Code 2.1.209, 2026-07-14, live headless -p sessions; ~15K additionalContext control with HEAD/TAIL markers; updatedToolOutput leg gated on E1]`

**Reinterpretation (post shape-validation discovery):** E4 is potentially
answerable via an OBJECT-shaped Bash payload — rerun deferred (open follow-up
below).

### Downstream implications

- **Phase 10 restore-in-large-outputs scope:** no confirmed cap binds
  `updatedToolOutput`; the documented `additionalContext` cap was not observed
  at ~15K on 2.1.209. Do not design around an assumed 10K truncation without
  re-running E4 via the object-shaped payload.
- **Phase 9 map-size expectations:** same — no empirical cap evidence to bound
  placeholder-map growth from tool-output rewrites.

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

## Open follow-ups

1. **Read object-shape probe (E1):** built-in Read with an OBJECT-shaped
   `updatedToolOutput` is untested — Read's expected output shape is unknown.
2. **E4 rerun via object-shaped Bash payload:** now potentially answerable;
   deliberately not re-run during 08-04 Task 3 checkpoint resolution.

Both are recorded in `experiments.E1_shape_validation.reinterpretation_notes`
in the findings artifact.

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
