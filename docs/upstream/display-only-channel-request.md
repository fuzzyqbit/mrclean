# Upstream feature request draft — anthropics/claude-code

> **Status:** filed 2026-07-14 — <https://github.com/anthropics/claude-code/issues/77587>
> (mirrored in `docs/HOOK-CONTRACT.md` §Upstream feature request). Filed with this header block
> and the "Suggested title" section stripped; body started at "## Preflight Checklist".
>
> **Filing is operator-only — never an agent** (Phase 8 RESEARCH Pitfall 8). File via the web UI
> feature-request form (paste each section into the matching template field, pick the dropdowns),
> or via `gh issue create --repo anthropics/claude-code --title "<title below>" --body-file docs/upstream/display-only-channel-request.md`
> (strip this header block first if filing the raw file).
>
> **Reframe note (2026-07-14):** this draft was originally scoped as a "display-only rewrite
> channel" request. The 08-04 E1 shape-validation discovery (object-shaped payloads ARE honored
> for built-in Bash on 2.1.209 — the channel is not dead, the string form is rejected) reframed
> the primary ask to what the evidence supports: document per-tool `updatedToolOutput` shapes and
> make shape-rejection loud (or accept string coercion). The upstream template requires a single
> feature per issue, so the display-only channel is retained under Additional Context as a
> distinguished, separate future ask.

---

## Suggested title

`[FEATURE] Document per-tool updatedToolOutput shapes and make PostToolUse shape-rejection loud (hook-based sanitizer use case)`

## Preflight Checklist

- [x] I have searched existing requests and this feature hasn't been requested yet
      (duplicate-search evidence below, re-run at draft time)
- [x] This is a single feature request (not multiple features)

### Duplicate-search evidence (`gh search issues --repo anthropics/claude-code`, 2026-07-14)

| Query | Result |
|-------|--------|
| `updatedToolOutput display` | no results |
| `hook display-only rewrite` | no results |
| `hook redact transcript display` | no results |
| `updatedToolOutput shape` | only #54196 (closed duplicate of the #68951 bug lineage — a bug report, not a docs/DX request) |
| `updatedToolOutput schema` | no results |

The first three display-oriented queries were also run 2026-07-14 during research with no
relevant hits; all five were re-run 2026-07-14 at draft time with the results above.

## Problem Statement

We build a hook-based sanitizer (secret/PII redaction — [mrclean](https://github.com/fuzzyqbit/mrclean))
that rewrites tool output via PostToolUse `hookSpecificOutput.updatedToolOutput` before it
re-enters model context. On Claude Code 2.1.209 (2026-07-14) we verified empirically, with live
headless sessions and minimal fixture hooks, that:

- `updatedToolOutput` is **shape-validated per tool**, and the expected shapes are **undocumented**:
  - Built-in **Bash** REJECTS string payloads and silently uses the original output. The only
    surfaced signal is a one-line "PostToolUse:Bash hook warning" in the TUI — easy to miss, and
    not visible in headless (`-p`) runs. The rejection detail (from the transcript's
    `hook_error_during_execution` attachment):

    > PostToolUse hook returned updatedToolOutput that does not match Bash's output shape; using
    > original output. [ { "expected": "object", "code": "invalid_type", "path": [],
    > "message": "Invalid input: expected object, received string" } ]

  - Bash **HONORS** an object-shaped payload
    `{"stdout": "...", "stderr": "", "interrupted": false, "isImage": false}` — verified live:
    the model received the rewritten output and the terminal rendered it.
  - Built-in **Read** rejects string payloads too; its expected object shape is unknown to us
    (undocumented — we could not find it in the hooks reference).
  - **MCP tools** honor string payloads (MCP tool-result content is string-shaped).

- For a sanitizer this failure mode is dangerous: the hook believes it redacted a secret from a
  tool result, but the ORIGINAL (secret-bearing) output silently re-enters model context and is
  sent to the API. A **silent no-op is the worst possible failure** for this class of hook.

- The hooks documentation describes `updatedToolOutput` but does not enumerate the per-tool
  expected shapes, so hook authors discover the contract only by reverse-engineering rejection
  warnings per tool, per version.

We believe this also explains #68951 ("`updatedToolOutput` silently ignored for built-in Bash")
and its closed duplicates (#54196, #65403, #67442): those repros most likely emit the string
form, which the per-tool shape validation rejects.

## Proposed Solution

Make the `updatedToolOutput` per-tool contract explicit and its failure loud — any (ideally all)
of the following remedies for the one underlying problem:

1. **Document the expected `updatedToolOutput` shape for every built-in tool** (Bash, Read,
   Edit, Write, Glob, Grep, WebFetch, …) in the hooks reference, next to the existing field docs.
2. **Surface shape-rejection loudly:** elevate the hook warning to a visible error (stderr in
   headless mode, prominent TUI notice) so a sanitizer no-op cannot pass silently.
3. **Accept string coercion for built-in tools** (a bare string maps to the tool's primary text
   field — e.g. `stdout` for Bash), matching what MCP tools already accept and what the #68951
   reporter lineage evidently expected.

## Alternative Solutions

- Current workaround: emit tool-specific object shapes from the hook. Works for Bash once
  reverse-engineered from the zod error; the shape for Read (and other built-ins) is unknown.
- Detect rejection after the fact by parsing `hook_error_during_execution` attachments from the
  transcript JSONL — post-hoc and unreliable as a safety net for a security tool.

## Priority

Medium — Would be very helpful (suggested; operator may adjust. The silent-no-op failure mode is
arguably High for sanitizer/DLP-class hooks.)

## Feature Category

Developer tools/SDK (hooks contract) — or Documentation.

## Use Case Example

1. mrclean registers a PostToolUse hook that redacts detected secrets from tool output before it
   re-enters model context.
2. The model runs `cat .env`; the output contains an API key; the hook emits `updatedToolOutput`
   with the key replaced by a stable placeholder.
3. On 2.1.209, if the hook emits a string for Bash, the rewrite is rejected and the raw key
   silently reaches the model (and thus the API) — the only signal is a one-line TUI warning.
4. With documented per-tool shapes (and/or loud rejection, and/or string coercion), the hook
   either works or fails visibly — it never silently leaks.

## Additional Context

**Prior art (cited and distinguished):**

- **#68951** (open bug): "PostToolUse `updatedToolOutput` silently ignored for built-in Bash
  tool". Our evidence refines it: the channel is NOT dead — string payloads are rejected by
  per-tool shape validation while object payloads are honored (verified on 2.1.209, 2026-07-14).
  We are happy to add this repro detail to that issue as well.
- **#18653** (open feature): "Tool result transform hook for content sanitization" — asks for a
  model-facing transform mechanism. This request is narrower and different: make the EXISTING
  model-facing mechanism (`updatedToolOutput`) documented and loud, not add a new one.
- **#54196 / #65403 / #67442**: earlier reports of the same symptom, closed as duplicates of the
  #68951 lineage.
- **#64326 / #62156 / #66044**: the redaction-feature-request bucket referenced by #68951 — the
  same sanitizer use case motivating this request.

**Related future ask (deliberately NOT part of this single request):** a display-only rewrite
channel (e.g. `displayOverride`) that changes what the user's terminal renders WITHOUT entering
model context or the transcript's model-facing content. Our rendering observation on 2.1.209
confirms the terminal displays the model-facing value (honored rewrite → rewritten output
rendered; rejected rewrite → hook warning and no output line), so a sanitizer cannot show the
user readable originals while sending the model placeholders. We may file that separately; it is
noted here for context and to distinguish it from #18653.

**Method note:** all findings are from live headless `claude -p` sessions with minimal fixture
hooks using marker strings only (e.g. `ORIGINAL_E1_MARKER_q7v4` / `REWRITTEN_E1_MARKER_x9k2`),
plus one interactive PTY observation for the rendering question. Claude Code 2.1.209, 2026-07-14.
