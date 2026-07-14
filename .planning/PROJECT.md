# mrclean

## What This Is

mrclean is an in-session sanitizer that prevents sensitive data from leaking out of Claude Code sessions to remote services (Anthropic API, cloud agents, MCP endpoints). It hooks into Claude Code via a settings.json hook and an MCP server, intercepting prompts and tool payloads in memory, swapping detected secrets and project-specific terms with stable placeholders before they leave the machine, and optionally restoring placeholders on the return path so file paths, names, and identifiers round-trip cleanly back into the user's view.

## Core Value

Real secrets and proprietary terms never reach the wire — the user keeps Claude Code productivity without trading away repo-level confidentiality.

## Current State

**Shipped:** v2.0 Native-Node PII/NER Layer (2026-06-03) — atop v1.0 MVP (2026-05-14).

**Hardened (2026-07-13):** Phase 01 gap-closure — SC4/HOOK-05 fail-open hole closed. The installer now writes a fail-closed POSIX `/bin/sh` wrapper (`"$1" "$2" hook || exit 2`), so a missing/renamed mrclean bin blocks tool calls instead of silently disabling protection. Confirmed in a live headless Claude session (UAT-2b: canary never leaked). win32 remains a documented fail-open known-gap.

mrclean now ships an opt-in, native-Node PII/NER detection layer with **zero data egress and no Python**:
- Regex structured-PII (email / US SSN / credit card / phone / IP) in the existing `<100ms` hot-path budget, no model required.
- Opt-in in-process NER (PERSON/LOC, advisory) as a warm singleton in the long-lived MCP server **only** — never the hook; fail-closed-for-NER; model provenance stamped in every PII audit entry.
- PII findings flow through the existing placeholder / audit / allowlist pipeline; `[pii]` config sub-table off by default; ML deps are `optionalDependencies` (zero-config `npx` preserved).
- Honest framing everywhere: secrets = deterministic guarantee, NER = best-effort recall aid (false negatives can leak); enforced by a copy-drift CI gate + a leak-grep regression proving no raw PII reaches `audit.jsonl` or any error path.

**Guardrails held:** no Python runtime; cloud PII APIs ruled out; Microsoft Presidio (Python sidecar) remains deferred (PIISEC-03 scope fence). Secrets remain mrclean's deterministic core.

## Current Milestone: v3.0 Reversible Redact Mode

**Goal:** Opt-in reversible redaction — a session-scoped placeholder→original map restores paths/names/identifiers on the return path so they round-trip cleanly back into the user's view, while secrets stay protected on the wire. Default remains one-way.

**Target features:**
- PostToolUse restore path: placeholders → originals on inbound tool results (REVMODE-01; requires Claude Code ≥ 2.1.121)
- Session State Adapter (`src/state/`): map lifecycle, locking + atomic rewrite, janitor cleanup on SessionEnd (REVMODE-02)
- Wire the `restore` MCP tool (stub since Phase 1) to the session map
- THREAT_MODEL.md coverage of reversible-mode blast radius + operator opt-in flow (REVMODE-03)

**Key context:** Map is session-scoped and in-memory by default (PROJECT.md security constraint); any disk persistence must be encrypted at rest and removed on session exit — the requirements step resolves the REVMODE-02 plaintext-session-file tension. Keychain persistence (POLISH-03) deferred.

> Note (2026-07-14): the three v1-era polish candidates (`mrclean init`, surgical uninstall, install-stub dead-keys fix) were verified already shipped 2026-06-01 as quick tasks (commits 0d12c88, ca2891a, 1afefec). Layer-5 `--deep` classifier is the planned v4.0 milestone.

## Requirements

### Validated

- ✓ In-session interception via Claude Code hook (UserPromptSubmit + tool-result paths) — v1.0
- ✓ MCP server entry point (`mrclean_check / mrclean_redact / mrclean_status`) — v1.0
- ✓ Layer 1 — bundled regex pack (secretlint preset + gitleaks rules) — v1.0
- ✓ Layer 2 — Shannon-entropy heuristic + allowlist (hashes/UUIDs/SHAs/base64) — v1.0
- ✓ Layer 3 — `.env*` value auto-extract into in-memory blocklist — v1.0
- ✓ Layer 4 — `.mrclean/words.txt` project dirty-word list — v1.0
- ✓ Stable collision-free placeholders (`<MRCLEAN:TYPE:NNN>`) — v1.0
- ✓ One-way redact mode (default, highest safety) — v1.0
- ✓ Block-on-detect with structured reason payload — v1.0
- ✓ Per-rule action override (block / warn / audit) via config — v1.0
- ✓ Hash-only session audit log at `.mrclean/audit.jsonl` (never raw values) — v1.0
- ✓ npm package + `npx mrclean install` wiring — v1.0
- ✓ `<100ms / <200ms` perf gate enforced in CI — v1.0
- ✓ Layer 6a regex structured-PII (email/SSN/card/phone/IP), hot-path-safe — v2.0
- ✓ Layer 6b opt-in NER (PERSON/LOC), MCP-only, advisory, fail-closed — v2.0
- ✓ Model acquisition/cache/integrity infra + `optionalDependencies` — v2.0
- ✓ PII leak-grep regression + `sanitizeForOutput()` error chokepoint — v2.0
- ✓ Honest best-effort framing + copy-drift CI gate + scope fence (no Python/cloud/unredact) — v2.0
- ✓ `mrclean init` CLI subcommand + `/mrclean:mrclean-init` slash command — quick task 0d12c88 (2026-06-01)
- ✓ Surgical uninstall — removes only mrclean entries, never wholesale-restore — quick task ca2891a (2026-06-01)
- ✓ Install stub no longer advertises dead `[words]`/`[detection]` keys — quick task 1afefec (2026-06-01)

### Active (v3.0)

- [ ] Reversible redact mode — session-scoped placeholder→original map for path/name round-trip (unshipped from original vision)

### Future

- [ ] Layer 5 — optional `--deep` LLM classifier for semantic PII (planned v4.0, off by default)

> Shipped as quick tasks 2026-06-01 (verified 2026-07-14, moved to Validated): `mrclean init` (0d12c88), surgical uninstall (ca2891a), install-stub dead-keys fix (1afefec).

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
| Surface = Claude Code hook + MCP server, in-memory only | Pure runtime interception covers the actual leak path; file-output / batch CLI adds surface area without preventing the runtime leaks the user actually fears | ✓ Good — shipped v1.0, held through v2.0 |
| Layered detection (regex → entropy → env-extract → user words → optional LLM) | Dirty-word lists alone are brittle; layering pushes maintenance onto detectors that need none | ✓ Good — L1–4 v1.0, L6a/L6b PII added v2.0; L5 still deferred |
| Both one-way and reversible redact modes, default one-way | Reversible is a power feature but increases blast radius if the map leaks; safe default is one-way | — Pending — one-way shipped v1.0; reversible mode unshipped (next-milestone candidate) |
| Node.js + TypeScript implementation | Official MCP TypeScript SDK is most mature; Claude Code is Node; npm distribution matches hook integration | ✓ Good — held; native-Node NER (transformers.js) avoided a Python sidecar in v2.0 |
| Adopt gitleaks rule pack rather than author regex from scratch | Community-maintained patterns; reinventing wastes effort, lower coverage | ✓ Good — shipped v1.0 |
| Reversible-mode map is session-scoped, in-memory by default | Limits blast radius if the artifact leaks; encrypted disk persistence opt-in | — Pending — reversible mode not yet built |
| PII/NER off by default; secrets = deterministic guarantee, NER = best-effort recall aid | A security tool must not blur a probabilistic recall aid into a guarantee; false negatives can leak | ✓ Good — v2.0; enforced by copy-drift CI gate + leak-grep regression |
| NER in long-lived MCP server only, never the hook | Keeps the `<100ms` hook hot path model-free; ML import boundary isolated | ✓ Good — v2.0; import-graph test + cold-start perf gate prove it |

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
*Last updated: 2026-07-13 — after Phase 01 gap-closure (SC4/HOOK-05 fail-closed wrapper + live UAT)*
