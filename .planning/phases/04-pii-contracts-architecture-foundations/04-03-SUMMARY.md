---
phase: 04-pii-contracts-architecture-foundations
plan: "03"
subsystem: infra
tags: [optionalDependencies, scope-fence, mcp, security, pii, ner, ml-deps, huggingface, onnxruntime]

requires:
  - phase: 04-pii-contracts-architecture-foundations
    provides: "Plan 04-01 finding shape + audit schema; Plan 04-02 config schema"

provides:
  - "optionalDependencies block declaring @huggingface/transformers@^4.2.0 and onnxruntime-node@^1.24.3"
  - "MODEL-01 invariant test: tests/install/optional-deps.test.ts (6 assertions)"
  - "docs/SCOPE-FENCE.md: four enforceable bans + in-scope allowlist + per-phase transition checklist"
  - "THREAT_MODEL.md ###10 non-defense cross-linking the scope fence"
  - "PIISEC-03 enforcement: FORBIDDEN_TOOL_NAMES extended with 5 PII-write/unredact tool names"

affects:
  - "Phase 5 (regex PII hot-path + model acquisition) — runs optional-deps.test.ts; must pass transition checklist"
  - "Phase 6 (NER inference + MCP wiring) — no new write/unredact MCP tool; ML deps still optional"
  - "Phase 7 (security hardening) — scope fence review at boundary; PIISEC-03 confirmed green"

tech-stack:
  added: ["@huggingface/transformers@^4.2.0 (optionalDependencies)", "onnxruntime-node@^1.24.3 (optionalDependencies)"]
  patterns:
    - "optionalDependencies for ML native builds that must not block core install"
    - "FORBIDDEN_TOOL_NAMES pre-emptive ban pattern for model-facing attack surfaces"

key-files:
  created:
    - "tests/install/optional-deps.test.ts — MODEL-01 invariant: both ML deps in optional, absent from core"
    - "docs/SCOPE-FENCE.md — v2.0 scope fence: 4 bans + in-scope allowlist + 7-item phase-boundary checklist"
  modified:
    - "package.json — added optionalDependencies block with ML deps"
    - "tests/mcp/tools-list.test.ts — FORBIDDEN_TOOL_NAMES extended with 5 PII-write names"
    - "THREAT_MODEL.md — added ###10 non-defense with SCOPE-FENCE cross-link"

key-decisions:
  - "ML deps declared as optionalDependencies (not dependencies): a failed onnxruntime-node native build on musl/Alpine/exotic arch never breaks the core secret tool. Declaration-only in this phase — no npm install run."
  - "FORBIDDEN_TOOL_NAMES extended pre-emptively with pii_unredact/mrclean_pii_unredact/disable_pii/add_pii_word/pii_config_write before any PII tool exists. CI now fails the build if any of these names ever appear in tools/list."
  - "docs/SCOPE-FENCE.md is the single authoritative source for the four v2.0 bans. Every phase boundary runs the 7-item transition checklist defined there."

patterns-established:
  - "optionalDependencies-as-contract: test infrastructure (optional-deps.test.ts) validates the package.json structure at CI, not just at install time"
  - "Pre-emptive FORBIDDEN_TOOL_NAMES: extend the ban list before the capability exists, so the invariant test blocks accidental addition"

requirements-completed: [MODEL-01, PIISEC-03]

duration: 12min
completed: "2026-06-02"
---

# Phase 4 Plan 03: PII Optional Dependencies + Scope Fence Summary

**`optionalDependencies` declaration for ML deps (MODEL-01) + documented v2.0 scope fence banning cloud PII APIs, model-facing unredact tools, and Presidio sidecar (PIISEC-03), with CI-enforced forbidden-tool extension and per-phase transition checklist**

## Performance

- **Duration:** 12 min
- **Started:** 2026-06-02T22:28:00Z
- **Completed:** 2026-06-02T22:40:38Z
- **Tasks:** 2 (Task 0 pre-approved by human operator; Tasks 1 and 2 executed)
- **Files modified:** 5

## Accomplishments

- Declared `@huggingface/transformers@^4.2.0` and `onnxruntime-node@^1.24.3` under `optionalDependencies`; neither appears in `dependencies` — the core install + run path is ML-dep-absent
- Created `tests/install/optional-deps.test.ts` with 6 MODEL-01 invariant assertions (optionalDependencies present, dependencies absent, devDependencies absent, files[] allow-list ML-artifact-free, version range format checks)
- Created `docs/SCOPE-FENCE.md`: four enforceable bans (cloud PII APIs, model-facing unredact/disable tools, Presidio Python sidecar, no out-of-scope entity types) + in-scope allowlist + 7-item per-phase transition checklist
- Extended `FORBIDDEN_TOOL_NAMES` in `tests/mcp/tools-list.test.ts` with `pii_unredact`, `mrclean_pii_unredact`, `disable_pii`, `add_pii_word`, `pii_config_write`; T2b MCP-03 invariant test stays green
- Added `THREAT_MODEL.md ###10` non-defense summarizing all three bans and linking to SCOPE-FENCE.md

## Task Commits

Each task was committed atomically:

1. **Task 0: Verify ML package legitimacy** - Pre-approved (no commit; no files changed)
2. **Task 1: Declare ML deps as optionalDependencies** - `27196e9` (chore)
3. **Task 2: Scope fence + MCP-03 PII ban extension** - `fa71f02` (feat)

**Plan metadata:** (committed below)

## Files Created/Modified

- `package.json` - Added `optionalDependencies` block with `@huggingface/transformers@^4.2.0` and `onnxruntime-node@^1.24.3`
- `tests/install/optional-deps.test.ts` - MODEL-01 invariant test: 6 assertions enforcing ML dep placement
- `docs/SCOPE-FENCE.md` - v2.0 scope fence: 4 bans, in-scope allowlist, 7-item phase-boundary transition checklist
- `THREAT_MODEL.md` - Added ###10 non-defense with rationale for all three bans + SCOPE-FENCE cross-link
- `tests/mcp/tools-list.test.ts` - FORBIDDEN_TOOL_NAMES extended with 5 PII-write/unredact names (PIISEC-03)

## Decisions Made

- **optionalDependencies declaration-only (no npm install):** The plan specified declaration only. `npm install --no-optional` must succeed; the test infrastructure validates the package.json structure statically without downloading packages. Runtime import-isolation (no static import of ML deps on cold paths) is Phase 5/6 scope.
- **Pre-emptive FORBIDDEN_TOOL_NAMES extension:** Adding the PII-write ban before any PII tool exists means the CI gate is in place before anyone could accidentally ship a forbidden tool. Zero risk of false negative in the window between "ban decided" and "CI enforced."
- **Transition checklist at 7 items:** Based on the scope fence bans + MODEL-01 structural requirement. Items: entity types, cloud API client, write/unredact MCP tool, Presidio sidecar, optionalDependencies still optional, ML-dep-absent install, no static ML import on cold path.

## Deviations from Plan

None — plan executed exactly as written. Task 0 was pre-approved by the human operator per checkpoint pre-approval in the execution context.

## Issues Encountered

None. All 14 tests passed on first run (6 optional-deps + 8 mcp tools-list).

## User Setup Required

None — no external service configuration required. The ML packages are declared but not installed; no npm install was run in this phase.

## Next Phase Readiness

- Phase 5 (Regex PII Hot-Path Lane + Model Acquisition) can proceed: `optionalDependencies` block is the dependency-layer guarantee for "core installs with zero ML deps"
- Phase 5 should run the SCOPE-FENCE transition checklist before closing
- Phase 6 inherits the FORBIDDEN_TOOL_NAMES extension; no new write/unredact MCP tool may be added

## Known Stubs

None — this plan makes no behavioral changes, only structural declarations and documentation. No UI-facing data, no data sources wired.

## Threat Flags

None — this phase adds no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. The `optionalDependencies` declaration is a package.json field; no network call is made. THREAT_MODEL.md ###10 documents the fence that prevents scope drift into threat surfaces.

---
*Phase: 04-pii-contracts-architecture-foundations*
*Completed: 2026-06-02*
