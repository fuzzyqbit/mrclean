# mrclean

## What This Is

mrclean is an in-session sanitizer that prevents sensitive data from leaking out of Claude Code sessions to remote services (Anthropic API, cloud agents, MCP endpoints). It hooks into Claude Code via a settings.json hook and an MCP server, intercepting prompts and tool payloads in memory, swapping detected secrets and project-specific terms with stable placeholders before they leave the machine, and, in opt-in reversible mode, letting the operator restore file paths, names, and identifiers locally via the `mrclean restore` CLI — never on the model-facing return path.

## Core Value

Real secrets and proprietary terms never reach the wire — the user keeps Claude Code productivity without trading away repo-level confidentiality.

## Current State

**Shipped:** v2.0 Native-Node PII/NER Layer (2026-06-03) — atop v1.0 MVP (2026-05-14).

**Phase 9 complete (2026-07-17):** Session State Adapter — reversible sessions now persist an AES-256-GCM-encrypted placeholder→original map under `~/.mrclean/sessions/` (per-session key in separate 0700 `~/.mrclean/keys/`, ciphertext-only on disk including temp files), with content-addressed allocate-if-absent under a short proper-lockfile transaction (16-process stress: 0 lost / 0 duplicates / 0 disagreements), session-tagged v2 tokens (v1 one-way path byte-frozen), a structural secret floor (secret-class entries persist no `original` — not config-widenable), and a reason-aware SessionEnd janitor (retain only `resume`) + unconditional TTL sweep at SessionStart and MCP boot. Code review caught and closed one critical (rename-chain corruption → single-pass replacement) and four warnings; the stress gate exposed and fixed two shipped-bundle bugs (tsup `__filename` shim, ELOCKED re-arm). Verified 22/22; REVMODE-02/04/05/06/07 complete. Suite 861 passed / 16 skipped.

**Phase 8 complete (2026-07-15):** Contract Verification & Reversible Plumbing — all four LOW-confidence hook-contract questions empirically settled in live headless sessions and locked into `docs/HOOK-CONTRACT.md` (key finding: object-shaped `updatedToolOutput` IS honored for Bash on 2.1.209 and the 10K output cap does NOT bind it; string shape rejected). `[reversible]` config table landed (default OFF, byte-identical shipped behavior when absent) with true-Partial cross-layer merge semantics so operator opt-ins survive partial higher-layer tables. Installer widened to the 5-event surface with idempotent migration; doctor reports reversible state. THREAT_MODEL.md reversible section drafted with copy-drift + evidence-UUID-traceability CI gates; contract-findings artifact hardened against partial-rerun evidence destruction/fabrication. Post-phase UAT (12 tests, delegated CLI observation) surfaced and closed two install-surface gaps in gap-closure round 3 (08-12): `atomicWriteJson` now mkdirs missing parents so zero-config fresh-HOME install works, and the install banner derives its hook count from `HOOK_EVENTS.length` — re-verified 20/20 (2026-07-17).

**Hardened (2026-07-13):** Phase 01 gap-closure — SC4/HOOK-05 fail-open hole closed. The installer now writes a fail-closed POSIX `/bin/sh` wrapper (`"$1" "$2" hook || exit 2`), so a missing/renamed mrclean bin blocks tool calls instead of silently disabling protection. Confirmed in a live headless Claude session (UAT-2b: canary never leaked). win32 remains a documented fail-open known-gap.

mrclean now ships an opt-in, native-Node PII/NER detection layer with **zero data egress and no Python**:
- Regex structured-PII (email / US SSN / credit card / phone / IP) in the existing `<100ms` hot-path budget, no model required.
- Opt-in in-process NER (PERSON/LOC, advisory) as a warm singleton in the long-lived MCP server **only** — never the hook; fail-closed-for-NER; model provenance stamped in every PII audit entry.
- PII findings flow through the existing placeholder / audit / allowlist pipeline; `[pii]` config sub-table off by default; ML deps are `optionalDependencies` (zero-config `npx` preserved).
- Honest framing everywhere: secrets = deterministic guarantee, NER = best-effort recall aid (false negatives can leak); enforced by a copy-drift CI gate + a leak-grep regression proving no raw PII reaches `audit.jsonl` or any error path.

**Guardrails held:** no Python runtime; cloud PII APIs ruled out; Microsoft Presidio (Python sidecar) remains deferred (PIISEC-03 scope fence). Secrets remain mrclean's deterministic core.

## Current Milestone: v3.0 Reversible Redact Mode — Foundations + Operator Restore

**Goal:** Opt-in reversible-redaction foundations — a session-scoped, encrypted placeholder→original map that survives across hook events, plus an operator-only `mrclean restore` CLI that restores paths/names/identifiers locally. Zero model-facing restore surface, zero wire re-exposure. Default remains one-way.

**Reshaped 2026-07-14 (T1 decision):** research proved the hook contract has no display-only rewrite channel — `updatedToolOutput` replaces what the *model* sees, so in-session restore would permanently re-expose restored values to the API (transcript ratchet). In-session restore is deferred until upstream ships a display-only channel; this milestone ships the foundations and the operator-side round-trip instead.

**Target features:**
- Session State Adapter (`src/state/`): encrypted per-session map (AES-256-GCM, key material in separate dir, never project tree), locking + atomic rewrite, reason-aware janitor on SessionEnd + TTL orphan sweep (REVMODE-02)
- Content-addressed placeholder allocation under shared session state — fixes the latent cross-process counter-collision gap in reversible sessions; session-tagged v2 token format (`<MRCLEAN:TYPE:NNN:nonce8>`) in reversible mode only, v1 format untouched for one-way default
- Hardcoded restore floor: secret-class originals are never persisted anywhere — structurally unrestorable, no config can widen
- Operator-only `mrclean restore` CLI (REVMODE-01 reshaped): local exact-map-lookup restore; no MCP tool (`restore` stays CI-banned), no hook-path restore
- Phase-1 empirical contract verification (updatedToolOutput rendering, updatedInput echo, session_id resume continuity, 10K cap) + upstream feature request for a display-only rewrite channel
- THREAT_MODEL.md coverage of reversible-mode blast radius, secret floor, wire-re-entry rationale (REVMODE-03)

**Key context:** "In-memory by default" in Constraints describes one-way mode (no map at all); opting into reversible = consenting to encrypted session-scoped disk state, removed on session exit (janitor + TTL). Keychain persistence (POLISH-03) deferred. If Claude Code ships a display-only restore channel, in-session round-trip becomes a v3.x fast-follow on these foundations.

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

- [ ] Reversible-redaction foundations — encrypted session-scoped placeholder→original map, cross-process placeholder stability, operator-only restore CLI (in-session restore deferred pending upstream display-only channel)

### Future

- [ ] Layer 5 — optional `--deep` LLM classifier for semantic PII (planned v4.0, off by default)

> Shipped as quick tasks 2026-06-01 (verified 2026-07-14, moved to Validated): `mrclean init` (0d12c88), surgical uninstall (ca2891a), install-stub dead-keys fix (1afefec).

### Out of Scope

- Standalone batch CLI that scans a directory and writes sanitized copies — superseded by in-memory interception; no file output mode in v1
- Pre-commit / git-hook integration — out of scope for v1; existing tools (gitleaks, trufflehog) cover this surface and mrclean is the in-session complement, not a replacement
- Sanitizing arbitrary HTTP traffic via local proxy — too invasive for the leverage; hook + MCP cover the Claude Code surface deterministically
- Persisting the placeholder→original map across sessions — reversible mode is session-scoped only, to limit blast radius if the map file leaks
- Multi-user / team policy server with central rule distribution — single-developer workflow first; team mode deferred until v1 ships and demand is real
- In-session restore via `updatedToolOutput` (or any hook-path restore) — the hook contract has no display-only channel; restored values would enter model context and re-ship to the API permanently (transcript ratchet). Deferred until upstream ships a display-only rewrite surface (T1 decision, 2026-07-14)
- Model-facing `restore` MCP tool — prompt-injected model calling restore is a self-service deanonymization oracle; `restore` stays on FORBIDDEN_TOOL_NAMES with CI enforcement (reaffirmed 2026-07-14)

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
| v3.0 reshape: no in-session restore; operator-only CLI (T1) | No display-only hook channel exists — `updatedToolOutput` is model-facing; restored values ratchet into the transcript and re-ship to the API permanently | — Pending — v3.0 requirements decision 2026-07-14 |
| Map = encrypted per-session file under `~/.mrclean/sessions/` (T2) | Crash-safe, works for hook-only installs, counter survives restarts; MCP-resident memory loses map + resets counter on server restart (wrong-value restore) | — Pending — v3.0 |
| Session-tagged v2 token format in reversible mode only (T4) | Sequential NNN is enumerable (planted-token deanonymization oracle); per-session CSPRNG nonce kills enumeration; one-way v1 format contract untouched | — Pending — v3.0 |
| Secret-class originals never persisted — hardcoded restore floor (T3) | Caps map blast radius to one session's paths/names, never keys; structural (no original stored), not a config filter | — Pending — v3.0 |

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
*Last updated: 2026-07-17 — Phase 9 (Session State Adapter) complete: encrypted cross-process session map shipped, verified 22/22*
