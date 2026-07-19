---
phase: 08-contract-verification-reversible-plumbing
plan: 07
subsystem: config
tags: [config, toml, merge, partial-layers, cr-01, gap-closure, tdd]
requires:
  - "08-01 ([reversible] config table + MrcleanReversibleConfig contract)"
provides:
  - "Partial-shaped layer types: MrcleanConfigLayer, MrcleanPiiConfigLayer, MrcleanPiiRegexConfigLayer, MrcleanPiiNerConfigLayer, MrcleanReversibleConfigLayer (src/shared/types.ts)"
  - "Validators return true partials (zero DEFAULT_CONFIG refs in validator bodies); parseToml/readConfigLayer return MrcleanConfigLayer"
  - "mergeConfigs fills defaults from the ACCUMULATED value only — user-layer opt-ins survive partial higher-precedence tables (CR-01 fixed)"
affects:
  - "Phase 9 (session state adapter consumes reversible.enabled — now safe against partial project [reversible] tables)"
  - "PII lanes (user [pii]/[pii.ner] opt-ins incl. SSN/credit-card BLOCK actions no longer silently disabled by project narrowing)"
tech-stack:
  added: []
  patterns:
    - "Conditional-spread partial construction (...(k in raw ? { k: v } : {})) keeps absent keys absent so toEqual({}) deep-equality holds"
    - "Merge-time filling via ?? from the accumulated value — defaults apply exactly once at the DEFAULT_CONFIG seed"
    - "Differential typecheck gate (error-set diff vs 36-error baseline) reused from 08-01"
key-files:
  created: []
  modified:
    - src/shared/types.ts
    - src/config/index.ts
    - tests/config/merge.test.ts
    - tests/config/reader.test.ts
    - dist/cli.js (rebuild)
    - dist/mcp.js (rebuild)
decisions:
  - "Layer partials built with conditional spreads (immutable, no incremental mutation) — absent keys omitted entirely, never assigned undefined"
  - "Every fail-closed ConfigReadError throw preserved byte-identical, including the T-06-04-03 unpinned-model rejection"
  - "Full config types remain structurally assignable to their layer types — DEFAULT_CONFIG stays a legal first layer of mergeConfigs, so no call-site changes"
  - "REFACTOR window skipped — a shared present-key extractor would couple per-field throws with differing guards (typeof vs isStringArray vs pinned-model set) for no behavior gain (same call as 08-01)"
  - "Zero pre-existing test assertions changed — the merged-level invariant held without needing the layer-assertion escape hatch"
metrics:
  duration: "~10 min"
  completed: "2026-07-14"
  tasks: 3
  commits: 3
requirements-progress: "REVMODE-02 correctness fix — the config table now merges safely across partial layers; requirement still completes in Phase 9 (session state adapter). NOT marked complete (consistent with 08-01)."
---

# Phase 8 Plan 07: Cross-Layer Partial Config Merge (CR-01 Fix) Summary

**One-liner:** Parsed TOML config layers are now true Partials (absent fields stay absent) and mergeConfigs fills defaults exclusively from the accumulated value — so a project-layer partial `[reversible]`/`[pii.*]` table can no longer silently wipe a user-layer protection opt-in (CR-01, the DLP-tool protection-loss class mrclean exists to prevent).

## TDD Narrative (plan type: tdd)

**RED (`ec76cf7`):** Added five tests encoding the two proven CR-01 repros plus guards:
- Test G (merge.test.ts, real TOML files): user `[reversible] enabled = true` + project `[reversible] future_key = 1` → expects merged `reversible.enabled === true`. Failed at RED with `expected true, received false`.
- Test H (merge.test.ts): user `[pii] enabled = true` + `[pii.ner] enabled = true, confidence = 0.9` + project file containing ONLY `[pii.regex] entities = ["email"]` → expects user opt-ins preserved AND project narrowing applied. Failed at RED (`enabled` false, confidence reset to 0.7).
- Test K (merge.test.ts, regression guard): single-layer `[pii] enabled = true` still default-fills every unset field exactly once. Passed at RED and stayed green (guards the default relocation).
- Test I (reader.test.ts): `[reversible] future_key = 1` parses to `{}` — no baked `enabled`. Failed at RED (`{ enabled: false }` received).
- Test J (reader.test.ts): `[pii]`/`[pii.ner] confidence = 0.9` parses to a true partial (`pii.enabled`/`pii.regex` absent, `ner` toEqual `{ confidence: 0.9 }`). Failed at RED (baked defaults received).

All four failures were assertion-level (wrong values), not import/syntax — fail-fast rule satisfied. Real TOML files through `loadEffectiveConfig` were load-bearing: programmatic `mergeConfigs` layers cannot reproduce CR-01 because the defect lived in the validators.

**GREEN (`a7b3ece`):** Root-cause fix in two coordinated moves:
1. **Layer types** — five partial interfaces added to `src/shared/types.ts` directly after their full counterparts, with the design invariant that every full type is structurally assignable to its layer type (DEFAULT_CONFIG remains a legal first merge layer; zero call-site churn).
2. **Validators + merge** — all four `validate*` functions return true partials built with conditional spreads (absent keys omitted entirely; zero `DEFAULT_CONFIG` references remain in any validator body — verified by sed|grep gates). `mergeConfigs` now fills from the accumulated value: the reversible merge is guarded on `layer.reversible?.enabled !== undefined`, and every pii field fills via `??` from the accumulated pii (explicit `false` still wins — `??` triggers on `undefined` only; entity arrays and actions maps replace wholesale when present).

Tests G/H/I/J went green, K stayed green, and the full config suite (51) plus doctor checks (20, `checkReversibleState` consumes `loadEffectiveConfig` unchanged) passed with **zero pre-existing assertion edits**.

**REFACTOR:** Evaluated and skipped. The residual repetition is the conditional-spread present-key pattern, but each field pairs a distinct fail-closed throw (different reason strings; `typeof` boolean/string/number vs `isStringArray` vs the pinned-model descriptor check). A shared generic extractor would force those differing semantics together for no behavior gain — the same judgment 08-01 recorded when skipping its extraction as non-trivial.

## Commits

| Commit | Type | What |
|--------|------|------|
| ec76cf7 | test | Failing cross-layer partial-table merge tests (G/H/I/J) + passing default-relocation guard (K) |
| a7b3ece | feat | Partial layer types, partial validators, merge-time default filling from the accumulated value |
| 695f967 | chore | dist rebuild (integration globalSetup `tsup --clean`; repo convention, cf. 08-01 684ab65) |

## Must-Haves Verification

- **Truth 1** — user `[reversible] enabled = true` survives a project `[reversible]` table carrying only unknown/future keys: proven by Test G (merged `reversible.enabled === true`).
- **Truth 2** — user `[pii] enabled = true` + `[pii.ner]` opt-ins survive a project layer setting only `[pii.regex]`: proven by Test H (enabled/ner.enabled/confidence keep user values; `regex.entities` narrowed to `['email']`).
- **Truth 3** — parsed layers are true Partials: proven by Tests I and J (absent fields absent, never default-substituted).
- **Truth 4** — merged output unchanged for single-layer/absent-table scenarios: Test K + pii-schema "absent [pii] == v1 guarantee" + merge Test F all green; full `npm test` green (627 passed / 12 skipped) with ZERO edits to tests/detect/, tests/placeholder/, tests/audit/, tests/hook/ (byte-identical gate).
- **Truth 5** — wrong-typed fields still fail closed: pre-existing throw tests (non-boolean enabled, string confidence, unpinned ner.model) all green with byte-identical ConfigReadError reasons.

## Verification Gates

- `npx vitest run --project=unit tests/config/` — 51/51 green (G/H/I/J/K + all pre-existing).
- `npm test` — 627 passed / 12 skipped, exit 0; no detection/placeholder/audit/hook suite edits.
- Validator bodies: `sed -n '/^function validate.../,/^}/p' | grep -c DEFAULT_CONFIG` → 0 for all four.
- `grep -c "MrcleanConfigLayer" src/config/index.ts` → 7 (≥3); `src/shared/types.ts` → 1 (≥1).
- `grep -c "layer.reversible?.enabled !== undefined" src/config/index.ts` → 1.
- TDD gate order: `test(08-07)` ec76cf7 precedes `feat(08-07)` a7b3ece.
- Typecheck differential: exactly the 36-error baseline at every commit boundary — zero new errors.

## Deviations from Plan

None - plan executed exactly as written. (The plan's escape hatch allowing layer-level assertion updates in pre-existing tests was not needed — no pre-existing assertion changed.)

## Known Stubs

None — no placeholder values, empty-data wirings, or TODO markers introduced.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or trust-boundary schema changes beyond the plan's threat model. T-08-07-01/-02/-03 mitigations are implemented and test-proven (Tests G/H for cross-layer elevation, preserved throws for tampering, Test K + suite for default relocation); T-08-SC not applicable (zero package installs).

## Self-Check: PASSED

All modified files present on disk; commits ec76cf7 (test), a7b3ece (feat), 695f967 (chore) verified in git log; working tree clean.
