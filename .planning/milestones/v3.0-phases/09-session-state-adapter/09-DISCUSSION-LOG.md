# Phase 9: Session State Adapter - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-17
**Phase:** 09-session-state-adapter
**Mode:** --auto (autonomous — recommended option selected for every question, no AskUserQuestion; auto-advance chain from Phase 8 completion, workflow.auto_advance=true)
**Areas discussed:** Store mechanism, Key custody layout, Janitor unknown-reason policy, TTL config knob

---

## Store mechanism (T2 reconciliation)

| Option | Description | Selected |
|--------|-------------|----------|
| Whole-file encrypt + short locked transaction | ARCHITECTURE variant: read→allocate→encrypt→atomic-rename inside a ~2 ms lock; single failure shape | ✓ |
| Append-only JSONL + lock-free hot path | STACK variant: per-record AES-GCM (AAD=session_id), locks only for janitor/compaction | |

[auto] Store mechanism — Q: "Which T2 mechanism satisfies REVMODE-04 allocate-if-absent?" → Selected: "Whole-file + locked transaction" (recommended: content-addressed allocate-if-absent and the ratified NNN counter both require read-modify-write atomicity a lock-free append cannot give; fewer failure shapes; ~2 ms fits hook budget)

**Notes:** Both variants satisfy the converged invariants; divergence was mechanism-only. ROADMAP explicitly deferred this pin to planning-time — pinned here so researcher/planner inherit one mechanism.

---

## Key custody layout

| Option | Description | Selected |
|--------|-------------|----------|
| Per-session random key file | `~/.mrclean/keys/<sid>.key` 0600 in 0700 dir; ciphertext in separate `~/.mrclean/sessions/`; janitor deletes pair | ✓ |
| Single master key | One key encrypts all session maps; survives janitor; bigger blast radius | |
| MCP-server-memory key | PITFALLS-13: crash kills key → orphans dead; rejected with T2 Option B (hook-only installs get nothing) | |

[auto] Key custody — Q: "Key granularity and location?" → Selected: "Per-session random key file" (recommended: per-session blast radius, pair-delete cleanup story, no KDF surface, satisfies SC1's separate-0700-directory clause verbatim)

---

## Janitor unknown-reason policy

| Option | Description | Selected |
|--------|-------------|----------|
| Retention allowlist (retain ONLY `resume`) | Unknown/future reasons delete map+key; fail-toward-privacy | ✓ |
| Delete-list (delete only documented 4, retain unknowns) | Fail-toward-usability; unknown reasons leave encrypted originals resting | |

[auto] Janitor — Q: "SessionEndInput.reason is an open string (08-01) — what does an unknown future reason do?" → Selected: "Retention allowlist" (recommended: over-deletion = cosmetic re-redaction; under-deletion = recoverable originals lingering on disk; TTL still backstops both)

---

## TTL config knob

| Option | Description | Selected |
|--------|-------------|----------|
| `[reversible] ttl_hours` (int ≥ 1, default 24) | Single knob, fail-closed validation per 08-01 precedent | ✓ |
| `ttl_minutes` / duration string | Finer granularity; more parse surface | |
| No knob (hardcoded 24h) | Violates REVMODE-07 "configurable" | |

[auto] TTL knob — Q: "Config shape for the configurable TTL?" → Selected: "`ttl_hours` integer" (recommended: requirement says 24 h default + configurable; hours granularity matches the requirement text; YAGNI fence keeps the table at exactly `enabled` + `ttl_hours`)

---

## Claude's Discretion

- Lockfile primitive choice (lockdir vs lib) — against SC5 stress + minimal-deps preference
- Encrypted envelope internal schema; content-address hash function (collision residual documented)
- Doctor check-8 copy + mrclean_status counter wording

## Deferred Ideas

- Phase 10: restore CLI and all read-time policy
- Phase 11: canary/chaos/stress CI gates
- v3.x: restore allowlist narrowing, restore-miss telemetry
- Spike wrap-up (positioning spikes — unrelated to this phase)
