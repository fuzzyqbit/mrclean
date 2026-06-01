# mrclean

## What This Is

mrclean is an in-session sanitizer that prevents sensitive data from leaking out of Claude Code sessions to remote services (Anthropic API, cloud agents, MCP endpoints). It hooks into Claude Code via a settings.json hook and an MCP server, intercepting prompts and tool payloads in memory, swapping detected secrets and project-specific terms with stable placeholders before they leave the machine, and optionally restoring placeholders on the return path so file paths, names, and identifiers round-trip cleanly back into the user's view.

## Core Value

Real secrets and proprietary terms never reach the wire — the user keeps Claude Code productivity without trading away repo-level confidentiality.

## Current Milestone: v2.0 Native-Node PII/NER Layer

**Goal:** Add an opt-in, native-Node PII/NER detection layer — no Python, no data egress, no break to the < 100 ms hot path or zero-config `npx`.

**Target features:**
- In-process NER (names / orgs / locations) via transformers.js ONNX (`Xenova/bert-base-NER` int8, ~108 MB)
- Regex structured-PII: email, US SSN, credit card, phone, IP address
- Opt-in + perf-exempt integration (Layer-5 style); existing secretlint/gitleaks + entropy layers remain the **hard deterministic gate** for secrets
- PII findings flow through the existing pipeline → `<MRCLEAN:PII:NNN>` placeholders, audit log, 5-axis allowlist, per-rule action + config toggle
- Zero-config model UX: lazy-fetch + cache the ONNX model on first opt-in (no multi-hundred-MB bundle)

**Key context / guardrails:**
- No Python runtime; cloud PII APIs ruled out (sending text off-box to detect leakage defeats the purpose).
- Microsoft Presidio (Python sidecar) is **deferred** as a compliance-tier alternative — not the default (footprint breaks zero-config `npx`).
- PII layer **off by default**; secrets remain mrclean's core. Grounded in spike 001 (`vs-presidio`) + exploration research.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] In-session interception via Claude Code hook (settings.json) covering UserPromptSubmit and tool-result paths so any text on its way to the model is scanned
- [ ] MCP server entry point so Claude can also call mrclean as a tool when wired explicitly into a session
- [ ] Layer 1 detection — bundled regex pack for common secret formats (AWS, GitHub, OpenAI, Anthropic, JWTs, PEM blocks, Slack, Stripe, generic high-confidence token shapes)
- [ ] Layer 2 detection — Shannon-entropy heuristic above a tunable threshold and length, with built-in allowlist for hashes, UUIDs, git SHAs, common base64 image data
- [ ] Layer 3 detection — auto-extract values from `.env*` files at session start and add those values (not the keys) to the in-memory blocklist
- [ ] Layer 4 detection — optional user dirty-word file under `.mrclean/words.txt` for project-specific terms (codenames, customer names, internal hostnames)
- [ ] Layer 5 detection — optional `--deep` LLM classifier pass for semantic PII / proprietary content; off by default for cost
- [ ] Placeholder substitution with stable, collision-free tokens (e.g., `<MRCLEAN:SECRET:001>`) that survive code edits and remain unique across a session
- [ ] One-way redact mode — sanitize outbound payloads, no restore (highest safety, default)
- [ ] Reversible mode — sanitize outbound, persist a session-scoped placeholder→original map, restore placeholders on inbound tool results before they re-enter the model context, so paths/names round-trip
- [ ] Block-on-detect default action with structured reason payload returned to Claude Code so the agent knows why a tool call was rewritten or denied
- [ ] Per-rule action override (block / warn / audit) via config file
- [ ] Session-local audit log of every match (rule, severity, redacted token hash) at `.mrclean/audit.jsonl` — never logs the original secret
- [ ] Distributed as an npm package with a CLI bin (`npx mrclean install` to wire hook + MCP into the user's `~/.claude/settings.json`)

### Out of Scope

- Standalone batch CLI that scans a directory and writes sanitized copies — superseded by in-memory interception; no file output mode in v1
- Pre-commit / git-hook integration — out of scope for v1; existing tools (gitleaks, trufflehog) cover this surface and mrclean is the in-session complement, not a replacement
- Sanitizing arbitrary HTTP traffic via local proxy — too invasive for the leverage; hook + MCP cover the Claude Code surface deterministically
- Persisting the placeholder→original map across sessions — reversible mode is session-scoped only, to limit blast radius if the map file leaks
- Multi-user / team policy server with central rule distribution — single-developer workflow first; team mode deferred until v1 ships and demand is real

## Context

- Built specifically for Claude Code (Anthropic CLI, desktop, web, IDE extensions). Hook contract and MCP transport (stdio + Streamable HTTP) are the integration surface.
- Cloud / remote Claude Code surfaces (claude.ai/code, remote agents, headless CI) are the primary leak risk because the user has less visual control over what gets sent than in a local terminal session.
- Industry baseline for secret detection is the gitleaks rule pack — mrclean adopts those rules rather than reinventing patterns and adds entropy + env-extract + dirty-words layers on top to catch the long tail.
- Prior art on this exact problem (in-session redaction for AI coding agents) is thin — most existing tools (gitleaks, trufflehog, detect-secrets) are pre-commit/CI scanners, not runtime interceptors. mrclean's leverage is the hook/MCP integration, not the detection engine.
- User has already established that a literal "dirty word" list is brittle as a primary mechanism but useful as a fourth layer for project-specific terms regex and entropy will never catch.

## Constraints

- **Tech stack**: Node.js + TypeScript — required for clean integration with the official MCP TypeScript SDK and for shipping a single `npx`-runnable bin alongside Claude Code's existing Node ecosystem.
- **Performance**: Hook execution must add < 100 ms to a typical UserPromptSubmit and < 200 ms to a typical PostToolUse — slower than that and users will disable it. Layer 5 LLM pass is exempt because it is opt-in.
- **Security**: The placeholder→original map in reversible mode lives in memory only by default; if persisted to disk for crash recovery, it must be encrypted at rest and removed on session exit. Audit log must never contain raw secret values.
- **Compatibility**: Must work against current Claude Code hook contract (UserPromptSubmit, PreToolUse, PostToolUse) and MCP spec (stdio + Streamable HTTP transports). Track Claude Code release notes for hook contract changes.
- **Distribution**: Zero-config first run — `npx mrclean install` must wire everything with sensible defaults; users should not have to author a config file to get protection on day one.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Surface = Claude Code hook + MCP server, in-memory only | Pure runtime interception covers the actual leak path; file-output / batch CLI adds surface area without preventing the runtime leaks the user actually fears | — Pending |
| Layered detection (regex → entropy → env-extract → user words → optional LLM) | Dirty-word lists alone are brittle and high-maintenance; layering pushes the maintenance burden onto detectors that need none and keeps the user list small | — Pending |
| Both one-way and reversible redact modes, default one-way | Reversible mode is a power feature for path/name round-trip but increases blast radius if the map leaks; safe default is one-way | — Pending |
| Node.js + TypeScript implementation | Official MCP TypeScript SDK is the most mature; Claude Code itself is Node, so users already have a runtime; npm distribution matches existing hook integration patterns | — Pending |
| Adopt gitleaks rule pack rather than author regex from scratch | Years of community-maintained patterns; reinventing wastes effort and produces lower coverage | — Pending |
| Reversible-mode map is session-scoped, in-memory by default | Limits blast radius if the artifact ever leaks; encrypted disk persistence is opt-in for crash recovery | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-01 — milestone v2.0 (Native-Node PII/NER Layer) started*
