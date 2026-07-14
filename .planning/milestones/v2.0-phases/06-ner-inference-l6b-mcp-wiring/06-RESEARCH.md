# Phase 6: NER Inference (L6b) + MCP Wiring - Research

**Researched:** 2026-06-02
**Domain:** transformers.js v4 token-classification (ONNX BERT-NER) as a warm singleton inside the long-lived MCP server; wiring an MCP-only Layer 6b into the existing detection orchestrator; fail-closed model lifecycle; audit provenance; piiranha model-tier swap.
**Confidence:** HIGH (codebase contracts read directly; transformers.js v4 API + model facts verified against live HuggingFace Hub + official docs; onnxruntime-node failure modes verified). MEDIUM on two items flagged in the Assumptions Log (exact NER output `start/end` offset availability for BERT-NER tokenizer; piiranha label→PERSON/ORG/LOC remap design).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `mrclean_redact` SUBSTITUTES detected PERSON/ORG/LOCATION with `<MRCLEAN:PII_PERSON|PII_ORG|PII_LOC:NNN>` placeholders via the existing `PlaceholderManager`, single ordered substitution pass, one allocator. One-way (no restore this milestone).
- **D-02:** NER NEVER denies/blocks. "Advisory by default" = substitute-and-allow. The hard deny gate stays deterministic-only (secrets + checksum'd PII). NER findings resolve to `substitute`, never `block`.
- **D-03:** NER findings reported on BOTH `mrclean_check` (advisory metadata: counts/spans/scores, no raw value) AND `mrclean_redact` (substituted text + finding metadata).
- **D-04:** EAGER preload at MCP server startup when `pii.ner.enabled = true`. One-time per long-lived server process (NOT per hook event).
- **D-05:** Eager load is fail-closed FOR NER ONLY: model-load failure ⇒ server STILL starts and serves secret detection; `nerStatus: "unavailable"`; detection degrades to Layers 1–4 + regex-PII. Server must never crash/refuse to start because NER failed.
- **D-06:** Singleton loads via the Phase 5 `model-cache.ts` path (SHA-256-verified cache at `~/.mrclean/models/`). CRITICAL: override transformers.js `env.cacheDir` to `~/.mrclean/models/` BEFORE any pipeline/model call (Phase 5 RESEARCH Pitfall 1).
- **D-07:** Default `min_score = 0.7` (per-entity confidence floor), tunable via config.
- **D-08:** Entities below `min_score` dropped ENTIRELY (not substituted, not surfaced). Single floor governs both substitution and advisory reporting.
- **D-09:** PERSON, ORG, LOCATION all ON by default when `pii.ner.enabled`. Each independently toggleable via `pii.ner.entities` array, last-wins merge.
- **D-10:** Append `pii-regex > pii-ner` to the tail of `SOURCE_PRECEDENCE`. `dedupBySpan` keeps longest-span-wins, then source-order. (ALREADY DONE in `findings.ts` — verified.)
- **D-11:** NER overlap override: a `pii-ner` finding that overlaps a higher-precedence span AT ALL is DROPPED ENTIRELY, regardless of length. NER does NOT win a region via longest-span-wins. No partial substitution. Deliberate exception to pure longest-span-wins, scoped to `pii-ner` source ONLY.
- **D-12:** Every pii-ner audit entry populates `engine` (e.g. `pii-ner@<model-sha>`), `model_rev`, `quant`, `backend` (`onnxruntime-node` vs `wasm`) via `findingToAuditRecord` — no raw PII value.
- **D-13:** Default `Xenova/bert-base-NER` int8 (~108 MB); optional piiranha (~317 MB) tier selectable via `pii.ner.model` config, swapped in place. (Locked fence — no other tiers.)

### Claude's Discretion

- Exact mechanism for threading the NER opt-in into detection (an `ner` flag on opts that only the MCP tools set) — provided the hook path can NEVER reach L6b.
- `nerStatus` response shape and where it surfaces in check/redact structuredContent.
- Whether eager preload awaits load before serving, or loads async and reports `nerStatus: "loading"` until ready (must not block secret detection either way).
- Tokenizer/aggregation strategy for subword → entity span reconstruction.

### Deferred Ideas (OUT OF SCOPE)

None deferred in discussion. Explicitly out of scope (locked fences): cloud PII APIs; model-facing unredact tool; Presidio Python sidecar; reversible PII placeholders (one-way only this milestone); additional model tiers beyond bert-base-NER + piiranha; the Phase 7 leak-grep / honest-framing hardening.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NER-01 | Open-class NER (PERSON, ORG, LOCATION) via `@huggingface/transformers` ONNX (`Xenova/bert-base-NER` int8) running ONLY in the long-lived MCP server as a lazy warm singleton — opt-in, structurally unreachable from the per-event hook | Pattern 1 (warm singleton), Pattern 2 (MCP-only opt-in threading), Pattern 4 (orchestrator wiring), Code E1–E4, Architecture Map |
| NER-02 | Per-entity confidence threshold (`min_score`, tunable); NER entities advisory (warn/audit) by default | Pattern 3 (aggregation + score gating), D-07/D-08 reconciliation (Pitfall 3), Code E2/E5 |
| NER-03 | NER failure (model load or inference error) fails closed FOR NER only — degrades to L1–4 + regex PII, reports NER unavailable; secret gate never crashes | Pattern 5 (supervisor fail-closed), Pitfall 1 (onnxruntime-node native-binary failure), Code E6/E7 |
| NER-04 | Optional higher-recall PII model tier (piiranha ONNX, ~317 MB) selectable via config, swappable with default ~108 MB model | §piiranha Tier (CRITICAL label-vocabulary finding), Pitfall 6, Assumption A2, Open Question 2 |
| MODEL-04 | Audit entries for PII findings record model revision + quantization + backend; no raw PII value | Pattern 6 (audit provenance), Code E8; audit schema already carries fields (verified `src/audit/log.ts`) |
</phase_requirements>

## Summary

Phase 6 has remarkably low schema risk because Phase 4 pre-built every contract this phase needs. **Verified in the live codebase:** `TYPE_VOCABULARY` already contains `PII_PERSON/PII_ORG/PII_LOC`; `type-map.ts` already maps `pii:PERSON|ORG|LOC` → those TYPEs; `SOURCE_PRECEDENCE` already ends with `...pii-regex, pii-ner` (D-10 is **already done** — verify, do not re-add); `AuditRecord` + `findingToAuditRecord` already carry the optional `engine/model_rev/quant/backend` provenance fields with a no-raw-value LOCKED guard; `MrcleanPiiNerConfig` already exists in `shared/types.ts` and is wired into `DEFAULT_CONFIG.pii.ner`; `model-cache.ts` already downloads + SHA-256-verifies `Xenova/bert-base-NER onnx/model_int8.onnx` (real pinned hash `7de0a460…`, 108,486,236 bytes — confirmed against the live Hub file this session). So Phase 6 is overwhelmingly *new behavior wired into stable seams*, not contract design.

The work splits cleanly into four concerns: (1) a **warm-singleton pipeline module** (`pipeline-singleton.ts`) that lazy-`import()`s `@huggingface/transformers`, sets `env.cacheDir` to `~/.mrclean/models/` before any load, and returns a cached `token-classification` pipeline; (2) the **L6b engine** (`layer6b-ner.ts`) that runs the pipeline, aggregates subword tokens into entity spans with char offsets + per-entity scores, applies the `min_score` floor, and emits `Finding[]` with `source:'pii-ner'`; (3) **orchestrator + MCP wiring** — an `opts.ner` flag on `runDetection`/`runDetectionReadOnly` that ONLY `check.ts`/`redact.ts` set (the hook handlers never pass it, so the heavy `import()` is structurally unreachable from the cold path), plus eager preload + `nerStatus` surfacing at server boot; (4) the **D-11 overlap drop**, implemented as a dedicated pre-`dedupBySpan` filter pass scoped to `pii-ner` (NOT a change to `dedupBySpan`, whose generic longest-span-wins is shared by all layers and must stay untouched).

**Three findings require planner attention before locking the plan.** (a) **Config naming/default mismatch:** the existing config field is `pii.ner.confidence` defaulting to `0.9`, but D-07 mandates a default of `0.7` and calls it `min_score`. The planner must reconcile — recommend keeping the field name `confidence` (already shipped in the Phase 4 contract; renaming churns `shared/types.ts`/`defaults.ts`/tests) and changing the DEFAULT VALUE `0.9 → 0.7`. (b) **piiranha is NOT a transparent swap:** `onnx-community/piiranha-v1-detect-personal-information-ONNX` is a DeBERTa-v2 model whose label vocabulary is 17 PII-specific classes (`GIVENNAME`, `SURNAME`, `CITY`, `STREET`, `ZIPCODE`, `EMAIL`, `TELEPHONENUM`, …) with **no PERSON/ORG/LOC labels and no ORG concept at all** — so D-13's "swap in place" requires a model→canonical-entity label-mapping layer, a SECOND pinned SHA-256, and a license review (base model is `cc-by-nc-nd-4.0`, NonCommercial-NoDerivatives — a genuine concern for an MIT-distributed tool). (c) **onnxruntime-node has no automatic WASM fallback** — it is glibc-linked and throws on musl/Alpine or a missing prebuilt native binary; the `backend` audit field is `onnxruntime-node` in practice, and "wasm fallback" is a manual stub-swap, not automatic. This makes NER-03 fail-closed handling load-bearing on exactly this failure mode.

**Primary recommendation:** Sequence as 3 plans honoring the architecture build order: **06-01** = pipeline singleton + L6b NER engine + entity aggregation/mapping (depends on Phase 5 `model-cache.ts`, testable with a mocked pipeline — no 108 MB download in CI); **06-02** = orchestrator `opts.ner` wiring + D-11 overlap-drop filter + audit provenance (MODEL-04); **06-03** = MCP server eager preload + `nerStatus` in check/redact + piiranha tier swap (NER-04) with its second pinned hash + label-map. Reconcile the `confidence` default (0.9→0.7) in a Wave-0 task in 06-01.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| NER inference (model run) | API/Backend — MCP server (long-lived) | — | 108 MB model + ~110–220 ms warm inference physically exceeds the per-event hook budget; lives only in the warm process (cardinal decision, STATE.md). |
| Warm singleton lifecycle | API/Backend — MCP server boot/`lifecycle.ts` | — | One pipeline per server process; eager-loaded at boot when `pii.ner.enabled` (D-04); cleared in `shutdownMcpSupervisor`. |
| Lazy `@huggingface/transformers` `import()` | API/Backend — `pipeline-singleton.ts` | — | Single dynamic-import boundary keeps the heavy dep off the CLI/hook cold path (Anti-Pattern 2). |
| MCP-only opt-in gate (`opts.ner`) | API/Backend — `detect/index.ts` + MCP tools | — | Only `check.ts`/`redact.ts` pass `{ner:true}`; hook handlers never do ⇒ NER structurally unreachable from hook (D-04, NER-01). |
| Subword→span aggregation + score gate | API/Backend — `layer6b-ner.ts` | — | BIO/subword reconstruction + `min_score` floor is pure post-processing of pipeline output (D-07/D-08). |
| D-11 overlap drop | API/Backend — `detect/index.ts` pre-dedup filter | — | A `pii-ner`-scoped filter BEFORE `dedupBySpan`; must not alter the shared generic dedup (D-11). |
| Substitution / placeholders | API/Backend — existing `PlaceholderManager` | — | Reused unchanged; NER findings flow through the same allocator (D-01, zero new sink). |
| Audit provenance | API/Backend — `findingToAuditRecord` | — | `engine/model_rev/quant/backend` already in schema; NER populates them (D-12, MODEL-04). |
| `nerStatus` surfacing | API/Backend — MCP tools structuredContent | — | check/redact report loading/ready/unavailable (D-03, D-05; discretion on shape). |
| Model acquisition + integrity | API/Backend — Phase 5 `model-cache.ts` | — | Reused; piiranha tier (NER-04) needs a second download URL + pinned hash. |

## Standard Stack

### Core (no NEW packages — both already declared as optionalDependencies in Phase 4)

| Library | Declared | Registry (verified this session) | Purpose | Notes |
|---------|----------|----------------------------------|---------|-------|
| `@huggingface/transformers` | `^4.2.0` | `4.2.0` latest (published 2026-04-22) | `pipeline('token-classification', …)`, `env.cacheDir`, `env.allowRemoteModels`, `env.backends.onnx` | optionalDependency; reached ONLY via dynamic `import()` in `pipeline-singleton.ts`. NOT installed in `node_modules` by default (verified — correct, PII off by default). |
| `onnxruntime-node` | `^1.24.3` | `1.26.0` latest (published 2026-05-08); `os: [win32, darwin, linux]` | Native ONNX backend transformers.js uses in Node | optionalDependency. glibc-linked, NO musl prebuilt, NO automatic WASM fallback (Pitfall 1). `1.26.0` is within `^1.24.3`. |

### Supporting (all stdlib / already in codebase)

| Library | Purpose | Notes |
|---------|---------|-------|
| `node:crypto` | reuse `redactedHash`/`fingerprint` for NER findings; SHA-256 model integrity | already used in `findings.ts`, `model-cache.ts`. |
| existing `PlaceholderManager`, `substituteFindings`, `findingToAuditRecord`, `isAllowlisted`, `dedupBySpan` | NER findings reuse all sinks with ZERO new code | verified present in codebase. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Xenova/bert-base-NER` int8 | `onnx-community/piiranha-…-ONNX` int8 | piiranha is the NER-04 opt-in tier, NOT a default — higher recall on PII-specific classes but incompatible label set (needs remap), 317 MB, and a NonCommercial license on the base model. Default stays bert-base-NER. |
| Warm singleton in MCP server | Separate persistent "warm daemon" + IPC | Rejected by ARCHITECTURE-v2-pii.md — duplicates the MCP lifecycle, adds a socket/process-supervision attack surface. The MCP server already IS the long-lived warm process. |
| `aggregation_strategy: 'simple'`/`'first'` server-side | Manual BIO aggregation in `layer6b-ner.ts` | See Pattern 3 / Open Question 1 — verify whether transformers.js exposes `aggregation_strategy` for token-classification; if not, aggregate manually from per-token `entity`+`index`. |

**Installation:** No `npm install` in this phase. ML deps are pre-declared optionalDependencies; they are installed only when the operator opts in (Phase 5 acquisition path / `mrclean pii-init`). Do NOT add them to regular `dependencies`.

**Version verification (run this session):**
```
npm view @huggingface/transformers version   → 4.2.0   (time.modified 2026-04-22)
npm view onnxruntime-node version             → 1.26.0  (time.modified 2026-05-08)
npm view onnxruntime-node os                  → [win32, darwin, linux]   (no musl/alpine)
```

## Package Legitimacy Audit

slopcheck `scan` was run against a temp manifest declaring both deps (the `install` subcommand would trigger a real native build, so `scan` was used to avoid side effects). Both `[OK]`. Both are discovered from authoritative sources (CLAUDE.md locked stack + official HuggingFace/Microsoft repos) AND registry-verified.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@huggingface/transformers` | npm | ~2 yrs (since 2024-08) | very high | github.com/huggingface/transformers.js | [OK] | Approved (Phase 4-03 + re-verified) |
| `onnxruntime-node` | npm | ~5 yrs (since 2021-05) | very high | github.com/microsoft/onnxruntime | [OK] | Approved (Phase 4-03 + re-verified) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**Models (not npm packages, but supply-chain artifacts — integrity-pinned):**

| Model artifact | Host | Size (verified) | Integrity | Disposition |
|----------------|------|-----------------|-----------|-------------|
| `Xenova/bert-base-NER` `onnx/model_int8.onnx` | HF Hub | 108,486,236 bytes (verified via `x-linked-size`) | SHA-256 `7de0a4606c65…` pinned in `constants.ts` | Approved (Phase 5) |
| `onnx-community/piiranha-v1-detect-personal-information-ONNX` `onnx/model_int8.onnx` | HF Hub | 317.1 MB (verified via Hub API `blobs=true`) | **No pinned SHA-256 yet** — Wave 0 task in 06-03 must compute + pin a second constant | NER-04 opt-in tier; gated behind a checkpoint (license review + hash). |

## Architecture Patterns

### System Architecture Diagram

```
                        MCP SERVER BOOT (long-lived process)
                                   │
         ┌─────────────────────────┴──────────────────────────┐
         │  runMcpServer()  (src/mcp/server.ts)                 │
         │   loadEffectiveConfig → config.pii.ner.enabled?      │
         │        │ false → register tools, NER never loaded     │
         │        │ true  → EAGER preload (D-04):                │
         │        ▼                                              │
         │   getNerPipeline(config)  ── async, fail-closed ──┐   │
         │   (pipeline-singleton.ts)                          │   │
         │     env.cacheDir = ~/.mrclean/models  (BEFORE load)│   │
         │     import('@huggingface/transformers')  ◄─lazy────┤   │
         │     pipeline('token-classification', model, {dtype})│  │
         │        success → nerStatus='ready'                  │   │
         │        throw   → nerStatus='unavailable' (CAUGHT)   │   │
         │                  server STILL serves secrets (D-05) │   │
         └───────────────────────────┬────────────────────────┘   │
                                     │                              │
   Claude calls mrclean_check / mrclean_redact (text)              │
                                     │                              │
   runDetectionReadOnly / runDetection(text, cfg, state, ctx,      │
                                       { ner: true })  ◄── ONLY MCP │
                                     │                              │
   L1 secretlint+gitleaks → L2 entropy → L3 env → L4 words         │
        → L6a regex-PII (pii.enabled gate)                         │
        → if (opts.ner && cfg.pii.ner.enabled):                    │
              L6b NER ── await getNerPipeline() ◄──reuse singleton──┘
                   │ inference → raw token output
                   │ aggregate subwords → entity spans (start,end,score)
                   │ drop score < min_score (D-07/D-08)
                   │ map model label → pii:PERSON|ORG|LOC (D-09 entities filter)
                   │ emit Finding[] { source:'pii-ner', action:'substitute' }
                   ▼
        DROP pii-ner findings overlapping ANY higher-precedence span (D-11)
                   │   ← dedicated pre-dedup filter, pii-ner-scoped
                   ▼
        dedupBySpan  (generic, UNCHANGED — longest-span-wins + source order)
                   ▼
        effectiveAction (NER → substitute, never block — D-02)
                   ▼
        PlaceholderManager.allocate(value, 'PII_PERSON'|'PII_ORG'|'PII_LOC')
                   ▼
        substituteFindings → redact output (D-01)
                   ▼
        audit: findingToAuditRecord(f, …, provenance{engine,model_rev,quant,backend})  (D-12)
                   ▼
        tool result: { redacted|findings, count, nerStatus }   (D-03)

   HOOK PROCESS (UserPromptSubmit/PostToolUse): runDetection(…) with NO ner opt
        → opts.ner === undefined → L6b branch never entered → import() never reached
        → cold start unchanged (NER structurally unreachable)
```

### Recommended Project Structure

The Phase-5 `model-cache.ts` lives at `src/model/`. ARCHITECTURE-v2-pii.md proposed a `src/detect/layer6-pii/` package, but the SHIPPED layout put L6a flat at `src/detect/layer6a-pii.ts` and the cache at `src/model/`. **Follow the shipped layout** (flat files, mirror L6a) — do not introduce the `layer6-pii/` sub-package mid-stream; that churns import paths for already-shipped Phase 5 code.

```
src/
├── model/
│   ├── model-cache.ts            # EXISTING (Phase 5) — reuse download/verify/sideload
│   ├── constants.ts              # MODIFY: add piiranha MODEL_ID/URL/PINNED hash (NER-04)
│   └── pipeline-singleton.ts     # NEW: lazy import() + env.cacheDir + warm getNerPipeline()
├── detect/
│   ├── layer6b-ner.ts            # NEW: run pipeline, aggregate spans, min_score gate, emit Finding[]
│   ├── ner-entities.ts           # NEW: model-label → pii:TYPE mapping + per-model label set
│   ├── ner-overlap.ts            # NEW (or inline in index.ts): D-11 pii-ner overlap-drop filter
│   ├── index.ts                  # MODIFY: opts.ner flag; L6b branch after L6a; D-11 filter pre-dedup
│   ├── findings.ts               # NO CHANGE for precedence (pii-ner already in SOURCE_PRECEDENCE)
│   └── type-map.ts               # NO CHANGE (pii:PERSON|ORG|LOC already mapped) — VERIFY only
├── audit/
│   └── log.ts                    # NO schema change (engine/model_rev/quant/backend present) — populate
├── config/
│   └── defaults.ts               # MODIFY: pii.ner.confidence default 0.9 → 0.7 (D-07 reconcile)
└── mcp/
    ├── server.ts                 # MODIFY: eager preload when pii.ner.enabled; thread nerStatus getter
    ├── lifecycle.ts              # MODIFY (optional): clear singleton on shutdown
    └── tools/
        ├── check.ts              # MODIFY: pass {ner:true}; add nerStatus to structuredContent
        └── redact.ts             # MODIFY: pass {ner:true}; add nerStatus to structuredContent
tests/
├── model/pipeline-singleton.test.ts   # NEW: mocked pipeline (no download)
├── detect/layer6b-ner.test.ts         # NEW: inject fake classifier; aggregation + min_score
├── detect/ner-overlap.test.ts         # NEW: D-11 drop-on-overlap cases
├── detect/orchestrator-ner.test.ts    # NEW: opts.ner gating; hook path never loads pipeline
└── mcp/check-redact-ner.test.ts       # NEW: nerStatus shapes; fail-closed
```

### Pattern 1: Warm-singleton pipeline with lazy import (the heavy-dep boundary)

**What:** One pipeline per MCP-server lifetime, created via a cached promise; `@huggingface/transformers` reached only through a dynamic `import()`. **When:** any 100+ MB native/WASM dep in a tool that also ships a latency-critical cold start. **Example:**

```typescript
// src/model/pipeline-singleton.ts  (NEW)
// Source: [VERIFIED: huggingface.co/docs/transformers.js/tutorials/node] getInstance singleton +
//         env.cacheDir override; [VERIFIED: codebase] MODEL_CACHE_PATH/constants reuse
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { MrcleanPiiNerConfig } from '../shared/types.js'

// Opaque pipeline type — we never statically import transformers types (keeps cold path clean).
export type NerPipeline = (text: string, opts?: Record<string, unknown>) => Promise<unknown>

let instance: Promise<NerPipeline> | null = null
let backendLabel: 'onnxruntime-node' | 'wasm' | 'unknown' = 'unknown'

export function getNerBackend(): string { return backendLabel }

export function resetNerSingleton(): void { instance = null }   // for shutdown + tests

export function getNerPipeline(ner: MrcleanPiiNerConfig): Promise<NerPipeline> {
  if (instance) return instance
  instance = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers') // ← lazy boundary
    // D-06 / Phase 5 Pitfall 1: set BEFORE any load. env.cacheDir is the JS knob
    // (NOT TRANSFORMERS_CACHE, which is Python-only).
    env.cacheDir = join(homedir(), '.mrclean', 'models')
    env.allowRemoteModels = ner.allowDownload          // gate first-run network fetch
    // backend introspection for the audit `backend` field (D-12):
    try { backendLabel = env.backends?.onnx ? 'onnxruntime-node' : 'unknown' } catch { backendLabel = 'unknown' }
    return (await pipeline('token-classification', ner.model, { dtype: ner.dtype })) as unknown as NerPipeline
  })()
  return instance
}
```

### Pattern 2: MCP-only opt-in threading (the structural unreachability proof)

**What:** add `opts?: DetectionOptions` with `ner?: boolean` to `runDetection`/`runDetectionReadOnly`; ONLY `check.ts`/`redact.ts` pass `{ ner: true }`. The hook handlers (`src/hook/handlers/*`) call `runDetection(text, cfg, state, ctx)` with no 5th arg ⇒ `opts.ner` is `undefined` ⇒ the L6b branch (the ONLY place `pipeline-singleton.ts` is imported) is never entered ⇒ the dynamic `import('@huggingface/transformers')` is unreachable from the cold path. **Verification task for the plan:** add a test asserting no hook-reachable module statically imports `pipeline-singleton.ts` (grep the import graph), plus a perf-gate assertion that hook cold-start is unchanged (STATE.md p95 17.4 ms baseline must hold). **Example:**

```typescript
// src/detect/index.ts  (MODIFY)
export interface DetectionOptions { ner?: boolean }   // NEW, defaults to NER-off

export async function runDetection(
  text: string, config: MrcleanConfig, sessionState: SessionState,
  ctx: DetectionContext, opts: DetectionOptions = {},          // ← 5th arg, defaults {}
): Promise<DetectionResult> {
  // … L1–L4, then L6a exactly as today …
  if (config.pii.enabled && config.pii.regex.enabled) {
    findings.push(...runLayer6aPii(text, config.pii.regex, config, findings.map(f => f.span)))
  }
  // L6b — MCP-only, behind the flag AND the config gate. import() lives in layer6b-ner.ts.
  let nerStatus: NerStatus = 'disabled'
  if (opts.ner && config.pii.ner.enabled) {
    const { runLayer6bNer } = await import('./layer6b-ner.js')   // lazy even here
    const out = await runLayer6bNer(text, config.pii.ner, config, findings.map(f => f.span))
    findings.push(...out.findings)
    nerStatus = out.status                                       // 'ready' | 'unavailable'
  }
  // D-11 overlap drop BEFORE dedup (see Pattern 4) …
  // … dedup, resolve, substitute, audit (with provenance) …
  return { /* …existing… */, nerStatus }   // add nerStatus to DetectionResult
}
```

### Pattern 3: Subword → entity-span aggregation + `min_score` gate (the L6b engine core)

**What:** the `token-classification` pipeline returns per-(sub)token objects. BERT WordPiece splits words into `##` subwords with BIO labels (`B-PER`, `I-PER`, `O`, …). The engine must (a) stitch consecutive same-entity subwords into one span, (b) compute a per-entity score (min or mean of subword scores — pick min for a conservative floor), (c) recover char `start/end` offsets, (d) drop spans below `min_score`, (e) map `PER→PERSON`/`ORG→ORG`/`LOC→LOCATION`, filtered by `config.pii.ner.entities`. **Two viable routes** depending on what transformers.js exposes (Open Question 1):

- **Route A (preferred if available):** pass an aggregation option so the pipeline returns grouped `entity_group` objects with `start`/`end`. Python transformers calls this `aggregation_strategy` (`'simple'|'first'|'average'|'max'`). transformers.js historically used `ner`/`token-classification` returning per-token output; the grouped API may differ. The plan MUST verify against the installed `4.2.0` package surface in a Wave-0 task.
- **Route B (always works):** request per-token output and aggregate manually in `ner-entities.ts`. This is the safe default — do not block the plan on Route A.

```typescript
// src/detect/layer6b-ner.ts  (NEW) — Route B manual aggregation (works regardless of API surface)
// Source: [VERIFIED: huggingface.co/Xenova/bert-base-NER config.json] id2label =
//   {O, B-MISC,I-MISC, B-PER,I-PER, B-ORG,I-ORG, B-LOC,I-LOC}
import type { Finding } from './findings.js'
import { redactedHash, fingerprint } from './findings.js'
import { isAllowlisted } from './allowlist.js'
import { getNerPipeline } from '../model/pipeline-singleton.js'
import { mapModelLabel } from './ner-entities.js'
import type { MrcleanPiiNerConfig, MrcleanConfig } from '../shared/types.js'

export type NerStatus = 'ready' | 'unavailable' | 'loading' | 'disabled'

interface RawToken { entity: string; score: number; index: number; word: string; start?: number; end?: number }

export async function runLayer6bNer(
  text: string, ner: MrcleanPiiNerConfig, config: MrcleanConfig,
  coveredSpans: readonly { start: number; end: number }[] = [],
): Promise<{ findings: Finding[]; status: NerStatus }> {
  let pipe
  try { pipe = await getNerPipeline(ner) }
  catch { return { findings: [], status: 'unavailable' } }     // NER-03 fail-closed for LOAD

  let raw: RawToken[]
  try { raw = (await pipe(text)) as RawToken[] }
  catch { return { findings: [], status: 'unavailable' } }     // NER-03 fail-closed for INFERENCE

  const spans = aggregateBio(raw, text)        // stitch B-/I- runs → {label,start,end,score}
  const findings: Finding[] = []
  for (const s of spans) {
    if (s.score < ner.confidence) continue                     // D-07/D-08 floor (field: confidence)
    const canonical = mapModelLabel(ner.model, s.label)        // 'PERSON'|'ORG'|'LOC'|null
    if (!canonical || !ner.entities.includes(canonical)) continue  // D-09 per-entity toggle
    const value = text.slice(s.start, s.end)
    const candidate: Finding = {
      ruleId: `pii:${canonical}`, severity: 'MEDIUM',          // MEDIUM ⇒ substitute default (D-02)
      span: { start: s.start, end: s.end }, value,
      redactedHash: redactedHash(value), fingerprint: fingerprint(`pii:${canonical}`, value),
      source: 'pii-ner', action: 'substitute',                 // explicit substitute, never block
    }
    if (isAllowlisted(candidate, config)) continue             // 5-axis allowlist reuse
    findings.push(candidate)
  }
  return { findings: findings.sort((a, b) => a.span.start - b.span.start), status: 'ready' }
}
```

### Pattern 4: D-11 overlap-drop — a `pii-ner`-scoped pre-dedup filter (NOT a `dedupBySpan` change)

**What:** D-11 is a deliberate exception to longest-span-wins, scoped to `pii-ner` only. `dedupBySpan` is generic and shared by all layers — DO NOT special-case a source inside it. Instead, BEFORE calling `dedupBySpan`, drop every `pii-ner` finding that overlaps ANY non-`pii-ner` finding already in the accumulator. **Why a separate pass:** keeps the generic dedup pure (easy to reason about, no regression risk for L1–L4/L6a), and makes D-11 independently testable. **Example:**

```typescript
// src/detect/ner-overlap.ts  (NEW)
// D-11: a pii-ner finding overlapping ANY higher-precedence span is DROPPED ENTIRELY,
// regardless of length. Higher-precedence = every non-pii-ner source (secretlint…pii-regex).
export function dropNerOverlaps(findings: Finding[]): Finding[] {
  const higher = findings.filter(f => f.source !== 'pii-ner')
  return findings.filter(f => {
    if (f.source !== 'pii-ner') return true
    return !higher.some(h => f.span.start < h.span.end && h.span.start < f.span.end)
  })
}
// In index.ts, immediately before dedupBySpan:
//   const filtered = dropNerOverlaps(findings)
//   const deduped  = dedupBySpan(filtered)
```

### Pattern 5: Fail-closed supervisor — NER errors never reach the secret gate

**What:** every NER touchpoint (load + per-inference) is wrapped so a throw becomes `nerStatus:'unavailable'` + empty NER findings; deterministic findings (L1–4 + L6a) are returned anyway. The MCP tool path already wraps handlers in `supervisedToolCall`, but that converts a throw into `isError:true` for the WHOLE tool — which would WRONGLY fail the secret gate too. So the catch must live INSIDE `runLayer6bNer` (as in Pattern 3), not be delegated to `supervisedToolCall`. Eager preload at boot must also catch (D-05) so the server starts regardless. **Example (boot):**

```typescript
// src/mcp/server.ts  (MODIFY) — eager preload, fail-closed (D-04/D-05)
let nerStatus: NerStatus = config.pii.ner.enabled ? 'loading' : 'disabled'
const getNerStatus = () => nerStatus
if (config.pii.ner.enabled) {
  // Discretion D: load async, report 'loading' until ready; never block secret tools.
  void (async () => {
    try { const { getNerPipeline } = await import('../model/pipeline-singleton.js')
          await getNerPipeline(config.pii.ner); nerStatus = 'ready' }
    catch (err) { nerStatus = 'unavailable'
          process.stderr.write(`mrclean-mcp: NER unavailable (${classifyLoadError(err)}); serving secrets only\n`) }
  })()
}
// pass getNerStatus into registerCheckTool/registerRedactTool
```

### Anti-Patterns to Avoid

- **Statically importing `@huggingface/transformers`** from any cold-start-reachable module — pulls onnxruntime-node into 100% of users' hook path. Dynamic `import()` only, inside `pipeline-singleton.ts`/`layer6b-ner.ts`.
- **Letting model-load failure crash the MCP server** — the secret gate must survive. Catch at boot AND in `runLayer6bNer`.
- **Special-casing `pii-ner` inside `dedupBySpan`** — keep the generic dedup pure; do D-11 in a separate pass.
- **NER returning `action:'block'`** — D-02: NER is substitute-only. Set `action:'substitute'` explicitly; do not rely on severity-default for HIGH.
- **Routing PostToolUse hook output through the MCP NER tool** for "automatic" NER — reintroduces the cold-start/round-trip problem; hook↔MCP independence is locked.
- **Renaming the config field `confidence`→`min_score`** — churns the shipped Phase 4 contract. Change the DEFAULT VALUE only (0.9→0.7); keep the field name.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NER model inference | Custom ONNX session glue | `@huggingface/transformers` `pipeline('token-classification', …)` | Owns tokenizer, BIO decode, ONNX session; battle-tested. |
| Model download + SHA-256 verify | New downloader | Phase 5 `model-cache.ts` (`downloadModel`/`verifyModelIntegrity`/`sideLoadModel`) | Already built, tested, fail-closed; piiranha tier just adds a URL + hash. |
| Placeholder allocation / substitution | New NER substitution sink | `PlaceholderManager` + `substituteFindings` | D-01 single ordered pass, one allocator — zero new sink. |
| Audit record build | New NER audit writer | `findingToAuditRecord(f, …, provenance)` | Schema already carries engine/model_rev/quant/backend with no-raw guard. |
| 5-axis allowlist for NER | Re-implement allowlist | shared `isAllowlisted(finding, config)` | Same machinery L1–L6a use. |
| Subword span char offsets | Re-tokenize text yourself | Pipeline token `start/end` if present; else map token `index`→char via the offset array | Re-tokenizing risks drift from the model's own tokenizer. |

**Key insight:** Phase 6 is integration, not invention. Every sink, the dedup, the audit schema, the config interface, and the model-acquisition path already exist. The only genuinely new code is the pipeline singleton, the subword→span aggregation, the label map, the D-11 filter, and the boot/`nerStatus` wiring.

## Runtime State Inventory

> Phase 6 is NOT a rename/refactor/migration phase. No stored-data/registered-state migration is required. Two stateful concerns, both addressed in-design:
> - **Warm singleton (in-memory):** lives in the MCP process only; cleared via `resetNerSingleton()` in `shutdownMcpSupervisor`. Not persisted. **None to migrate.**
> - **On-disk model cache** (`~/.mrclean/models/`): already managed by Phase 5; piiranha tier ADDS a file but does not migrate existing state. **None to migrate.**

## Common Pitfalls

### Pitfall 1: onnxruntime-node fails on musl/Alpine and on missing prebuilt binary — NO automatic WASM fallback

**What goes wrong:** transformers.js in Node uses `onnxruntime-node` (native). It is glibc-linked with no musl prebuilt; on Alpine, exotic arch, or a corrupt/missing `.node` binary it throws at first inference (or at import). There is NO automatic switch to the WASM (`onnxruntime-web`) backend in Node — the "fallback" requires manually stubbing `onnxruntime-node` so transformers loads `onnxruntime-web`.
**Why it happens:** the package lacks `detect-libc`-style runtime selection; transformers.js imports `onnxruntime-node` when it resolves.
**How to avoid:** treat this as the PRIMARY NER-03 failure mode. The boot preload and `runLayer6bNer` catch it ⇒ `nerStatus:'unavailable'`, secrets keep working. Do NOT attempt an in-process WASM auto-fallback this phase (out of scope; manual stub only). Document the Alpine limitation. The audit `backend` field is `onnxruntime-node` in practice.
**Warning signs:** `Error: Cannot find module '…/onnxruntime_binding.node'`, `Error relocating … (musl)`, server logs "NER unavailable" on Alpine.
**Source:** [VERIFIED: github.com/microsoft/onnxruntime#9483 / #6800; github.com/huggingface/transformers.js#1275]; [VERIFIED: npm onnxruntime-node os=[win32,darwin,linux]].

### Pitfall 2: `env.cacheDir` default is module-relative `./node_modules/@huggingface/transformers/.cache/` — wiped on reinstall, not the SHA-pinned path

**What goes wrong:** if `env.cacheDir` is not set before the first `pipeline()` call, transformers caches under `node_modules` (or cwd `./.cache`), NOT `~/.mrclean/models/`. The model re-downloads, bypasses the Phase 5 SHA-256-verified file, and is lost on `npm i`.
**How to avoid (D-06):** set `env.cacheDir = join(homedir(), '.mrclean', 'models')` inside `getNerPipeline` BEFORE the `pipeline()` call (Pattern 1). Setting it afterward has no effect. Do NOT use `TRANSFORMERS_CACHE` (Python-only env var, no effect in JS).
**Warning signs:** model present in `~/.mrclean/models/` but a second copy appears under `node_modules`; integrity check passes but the pipeline still re-downloads.
**Source:** [VERIFIED: huggingface.co/docs/transformers.js/tutorials/node — "cached … in ./node_modules/@huggingface/transformers/.cache/ … change via env.cacheDir"]; Phase 5 RESEARCH Pitfall 1.

### Pitfall 3: Config field is `confidence` (default 0.9) but the contract is `min_score` (default 0.7)

**What goes wrong:** `MrcleanPiiNerConfig.confidence` ships at `0.9` (verified `defaults.ts`), but D-07 mandates a default of `0.7`. If the plan reads "min_score" literally it will look for a non-existent field; if it ignores the value it ships the wrong floor.
**How to avoid:** Wave-0 reconciliation task in 06-01: keep the field name `confidence` (renaming churns the Phase 4 contract + tests), change ONLY the default value `0.9 → 0.7` in `defaults.ts`, and document "the `min_score` in CONTEXT == `pii.ner.confidence` in config". `runLayer6bNer` reads `ner.confidence`.
**Warning signs:** tests asserting `0.9`; docs saying `min_score` with no matching field.
**Source:** [VERIFIED: codebase `src/config/defaults.ts:57` confidence:0.9, `src/shared/types.ts:239`]; [CONTEXT D-07].

### Pitfall 4: `dtype:'int8'` vs the canonical transformers.js alias `q8`, and which ONNX file it loads

**What goes wrong:** the download URL pins `onnx/model_int8.onnx` (108 MB, SHA-verified). The pipeline must load THAT file. transformers.js dtype aliases are `fp32/fp16/q8/q4/int8/uint8/bnb4/q4f16`; `q8` is the documented WASM default. If `dtype:'int8'` resolves to a different filename than what `model-cache.ts` downloaded, the pipeline re-downloads or fails integrity expectations.
**How to avoid:** Wave-0 task: confirm `dtype:'int8'` resolves to `onnx/model_int8.onnx` for `Xenova/bert-base-NER` against the installed `4.2.0`. The Hub repo has both `model_int8.onnx` and `model_quantized.onnx`; for bert-base-NER they may be the same bytes. If `int8` does not map to the pinned file, either change the pinned file to match the dtype the pipeline picks, or set `dtype` to the alias that loads `model_int8.onnx`. Keep `model-cache.ts`'s URL and the pipeline's `dtype` in agreement.
**Warning signs:** pipeline downloads a second onnx file; SHA mismatch on a file the cache never wrote.
**Source:** [VERIFIED: huggingface.co/docs/transformers.js dtype list]; [VERIFIED: HF Hub file listing for both models].

### Pitfall 5: NER `value` is raw PII — must never reach audit, error text, or tool output unredacted

**What goes wrong:** a NER finding's `value` is a real person/org/place name. Logging it, putting it in an error string, or returning it in the check/redact DTO leaks PII (violates MODEL-04 / the Phase 7 leak-grep).
**How to avoid:** reuse the existing guards verbatim — `findingToAuditRecord` already excludes `value` (LOCKED); the check/redact `findingSchema` already omits `value`/`span` (verified). For NER, ALSO ensure the `classifyLoadError`/`nerStatus` strings never interpolate matched text (they describe model/backend state only). The redacted OUTPUT text is fine — it contains placeholders, not raw names.
**Warning signs:** an error string containing a detected name; a finding DTO with a `word`/`value` field.
**Source:** [VERIFIED: codebase `src/audit/log.ts` LOCKED comment; `src/mcp/tools/check.ts` findingSchema].

### Pitfall 6: piiranha is a DIFFERENT label space — "swap in place" is not transparent (NER-04)

**What goes wrong:** D-13 says piiranha is "swapped in place of the default." But `piiranha-v1-…-ONNX` (DeBERTa-v2) emits 17 PII labels (`GIVENNAME, SURNAME, CITY, STREET, ZIPCODE, BUILDINGNUM, EMAIL, TELEPHONENUM, SOCIALNUM, CREDITCARDNUMBER, IDCARDNUM, USERNAME, PASSWORD, ACCOUNTNUM, DRIVERLICENSENUM, TAXNUM, DATEOFBIRTH`) — there is NO `PERSON`, NO `ORG`, NO `LOC`, and NO organization concept at all. A naive swap yields zero PERSON/ORG/LOC findings.
**How to avoid:** `ner-entities.ts` must hold a per-MODEL label map. For piiranha → canonical: `{GIVENNAME, SURNAME} → PERSON`; `{CITY, STREET, ZIPCODE, BUILDINGNUM} → LOC`; `ORG → (none — piiranha cannot produce ORG)`. Decide and DOCUMENT the scope: either (a) piiranha maps only the labels that fit PERSON/LOC and silently yields no ORG, or (b) piiranha is explicitly a higher-recall PERSON/LOC tier. Recommend (a) with a documented note. Also: piiranha overlaps L6a regex on EMAIL/phone/SSN/CC — those must still defer to L6a via D-11.
**Warning signs:** enabling piiranha produces no findings; ORG entities silently disappear.
**Source:** [VERIFIED: HF API config.json id2label for both models, fetched this session].

### Pitfall 7: piiranha base-model license is NonCommercial-NoDerivatives (cc-by-nc-nd-4.0)

**What goes wrong:** mrclean publishes under MIT. The piiranha base model `iiiorg/piiranha-v1-detect-personal-information` is `cc-by-nc-nd-4.0`. Shipping or even auto-downloading it as a default could create a license mismatch / redistribution concern. (mrclean does NOT bundle the model — it lazy-downloads on opt-in — which mitigates redistribution, but ND/NC still constrains commercial/derivative use.)
**How to avoid:** gate the piiranha tier behind a `checkpoint:human-verify` task: confirm the operator accepts the model license; do NOT make piiranha a default; document the license in user-facing copy for that tier. The default bert-base-NER (Apache/MIT-compatible Xenova export) is unaffected.
**Warning signs:** piiranha set as default; no license note on the tier.
**Source:** [VERIFIED: HF API cardData.license=cc-by-nc-nd-4.0 for iiiorg/piiranha base; onnx-community export card lists base_model=iiiorg/piiranha].

### Pitfall 8: Eager preload blocking the MCP server's `connect()` / first tool response

**What goes wrong:** if eager preload `await`s the 108 MB load synchronously in `runMcpServer` before `server.connect(transport)`, Claude Code sees a multi-hundred-ms-to-second stall on MCP startup; worse, a slow/hung download blocks the secret tools from becoming available.
**How to avoid (D-04/D-05 + Discretion):** kick off preload as a fire-and-forget `void (async()=>…)()` that flips `nerStatus` `loading→ready|unavailable`; register and connect tools immediately. check/redact run secrets always; if a call arrives while `nerStatus==='loading'`, either skip L6b for that call (report `loading`) or `await` the in-flight singleton promise — recommend awaiting the SAME cached promise so the first NER-bearing call gets results once ready, while secret detection never waits.
**Warning signs:** MCP "server starting" hang; secret tools unresponsive during model download.
**Source:** [VERIFIED: codebase `src/mcp/server.ts` connect sequence]; [CONTEXT D-04/D-05 + Discretion].

## Code Examples

### E1: Orchestrator opts.ner branch (full shape) — see Pattern 2.

### E2: min_score gate + entities filter — see Pattern 3 (`if (s.score < ner.confidence) continue` then `ner.entities.includes(canonical)`).

### E3: Mocked pipeline for CI (no 108 MB download) — testability (NER-03 unit testing)

```typescript
// tests/detect/layer6b-ner.test.ts  (NEW)
// Inject a fake classifier by mocking the singleton module — CI never downloads the model.
import { vi, test, expect } from 'vitest'

vi.mock('../../src/model/pipeline-singleton.js', () => ({
  getNerPipeline: vi.fn(async () => async (_text: string) => ([
    { entity: 'B-PER', score: 0.99, index: 1, word: 'Ada',   start: 0,  end: 3 },
    { entity: 'I-PER', score: 0.98, index: 2, word: 'Love',  start: 4,  end: 8 },
    { entity: 'B-ORG', score: 0.55, index: 4, word: 'Acme',  start: 12, end: 16 }, // below 0.7 → dropped
  ])),
  getNerBackend: () => 'onnxruntime-node',
  resetNerSingleton: vi.fn(),
}))

test('aggregates PER subwords, drops sub-floor ORG, emits one PERSON finding', async () => {
  const { runLayer6bNer } = await import('../../src/detect/layer6b-ner.js')
  const cfg = { enabled: true, model: 'Xenova/bert-base-NER', dtype: 'int8',
    entities: ['PERSON','ORG','LOC'], confidence: 0.7, allowDownload: false,
    warmOnBoot: true, actions: { PERSON:'warn', ORG:'warn', LOC:'audit' } }
  const { findings, status } = await runLayer6bNer('Ada Love at Acme', cfg as any, {} as any)
  expect(status).toBe('ready')
  expect(findings.map(f => f.ruleId)).toEqual(['pii:PERSON'])  // ORG dropped by min_score
})
```

### E4: Fail-closed load test

```typescript
test('model load failure → status unavailable, zero NER findings, no throw', async () => {
  vi.doMock('../../src/model/pipeline-singleton.js', () => ({
    getNerPipeline: vi.fn(async () => { throw new Error('Cannot find module onnxruntime_binding.node') }),
    getNerBackend: () => 'unknown', resetNerSingleton: vi.fn(),
  }))
  const { runLayer6bNer } = await import('../../src/detect/layer6b-ner.js')
  const r = await runLayer6bNer('x', { enabled:true, entities:['PERSON'], confidence:0.7 } as any, {} as any)
  expect(r).toEqual({ findings: [], status: 'unavailable' })   // NER-03
})
```

### E5: Audit provenance population (MODEL-04 / D-12)

```typescript
// In runDetection's audit step, for source==='pii-ner' findings:
import { getNerBackend } from '../model/pipeline-singleton.js'
const provenance = f.source === 'pii-ner'
  ? { engine: `pii-ner@${PINNED_MODEL_SHA256.slice(0,12)}`,
      model_rev: PINNED_MODEL_SHA256, quant: config.pii.ner.dtype, backend: getNerBackend() }
  : undefined
writeAuditRecord(ctx.cwd, findingToAuditRecord(f, ctx.sessionId, ctx.hookEvent, f.effectiveAction, provenance))
// findingToAuditRecord already destructure-picks ONLY engine/model_rev/quant/backend (no raw value).
```

### E6: nerStatus in tool structuredContent (D-03)

```typescript
// check.ts / redact.ts — add nerStatus from the DetectionResult (or the boot getNerStatus()).
const structured = { findings, count: findings.length, nerStatus: outcome.result.nerStatus }
// outputSchema gains: nerStatus: z.enum(['ready','unavailable','loading','disabled'])
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@xenova/transformers` | `@huggingface/transformers` (v4) | v3→v4, Aug 2024 | Use the new scope (already in package.json). |
| `pipeline('ner', …)` | `pipeline('token-classification', …)` (`'ner'` is an accepted alias) | v2+ | Use `'token-classification'`. |
| `TRANSFORMERS_CACHE` env (Python) | `env.cacheDir` programmatic (JS) | always | Python var has NO effect in JS; set `env.cacheDir`. |
| onnxruntime-node auto WASM fallback (assumed) | NO auto fallback in Node; manual stub only | n/a | NER-03 fail-closed must handle native-binary failure. |

**Deprecated/outdated:** `@xenova/transformers` scope (superseded); SSE MCP transport (irrelevant here).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `token-classification` pipeline returns per-token objects with usable char `start/end` offsets for `Xenova/bert-base-NER`; if absent, char offsets are recovered by manual aggregation (Route B) | Pattern 3, Open Question 1 | If offsets are missing AND manual recovery is wrong, NER spans are misaligned → wrong substitution ranges. Wave-0 task must verify against installed 4.2.0. |
| A2 | piiranha label→canonical map: `{GIVENNAME,SURNAME}→PERSON`, `{CITY,STREET,ZIPCODE,BUILDINGNUM}→LOC`, no ORG | Pitfall 6, NER-04 | If the mapping is rejected by the user, piiranha tier needs a different entity contract. Gate behind checkpoint. |
| A3 | `dtype:'int8'` loads exactly `onnx/model_int8.onnx` (the SHA-pinned file) for bert-base-NER on transformers.js 4.2.0 | Pitfall 4 | If it loads a different file, pipeline re-downloads / SHA expectations diverge. Wave-0 verify. |
| A4 | Recommend keeping config field name `confidence` (not renaming to `min_score`), changing default 0.9→0.7 | Pitfall 3 | If the user insists on a `min_score` field name, a contract rename + test churn is required. Flag in discuss/plan. |
| A5 | `env.backends.onnx` truthiness is a reliable proxy for "native onnxruntime-node in use" for the audit `backend` field | Pattern 1, E5 | If unreliable, `backend` may mislabel; low risk (default `onnxruntime-node` is correct in supported envs). |
| A6 | Eager preload as fire-and-forget with `await` on the cached promise for the first NER call satisfies D-04/D-05 without blocking secrets | Pitfall 8, Pattern 5 | If the user wants preload to fully block boot, switch to awaited load — but that risks Pitfall 8. Discretion item. |

## Open Questions

1. **transformers.js v4 token-classification aggregation + offsets.** What we know: Python transformers exposes `aggregation_strategy`; transformers.js returns per-token output and supports a `'token-classification'`/`'ner'` pipeline. What's unclear: whether the installed 4.2.0 exposes a grouped `entity_group` mode and whether `start/end` char offsets are populated for the WordPiece tokenizer. Recommendation: Wave-0 task in 06-01 — install the optional dep in a scratch dir, run the pipeline on one fixture, capture the exact output shape, and pick Route A or Route B. Default to Route B (manual BIO aggregation) so the plan is not blocked.
2. **piiranha entity contract (NER-04).** What we know: 17 PII labels, no ORG, NonCommercial-ND base license. What's unclear: whether the user wants piiranha to (a) map only to PERSON/LOC with no ORG, or (b) expand the NER entity set to piiranha's richer PII labels (which overlaps L6a — would need its own precedence rules). Recommendation: scope piiranha as a PERSON/LOC higher-recall tier (option a) for this phase; defer richer-label exposure. Gate behind a checkpoint (license + hash + map).
3. **Where the `model_rev` value comes from for the audit.** What we know: `PINNED_MODEL_SHA256` is the file content hash. What's unclear: whether `model_rev` should be the HF revision string vs the content SHA. Recommendation: use the content SHA (deterministic, already pinned) and document it; HF revision is not exposed locally without network.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js ≥20.18.0 | all | ✓ | enforced | — |
| `@huggingface/transformers` installed | NER inference | ✗ by default (optionalDep, not in node_modules — verified) | `^4.2.0` (4.2.0) | NER-03 fail-closed → `nerStatus:'unavailable'`; installed on opt-in |
| `onnxruntime-node` installed | native ONNX backend | ✗ by default (optionalDep) | `^1.24.3` (1.26.0) | NO auto WASM fallback; fail-closed on musl/missing binary |
| `Xenova/bert-base-NER int8` (108 MB) | default NER | ✗ until opt-in download | SHA `7de0a460…` pinned | Phase 5 download/side-load; fail-closed if absent+offline |
| piiranha int8 (317 MB) | NER-04 tier | ✗ | NO pinned hash yet (Wave-0 06-03) | tier optional; gated behind checkpoint |

**Missing dependencies with no fallback:** none that block the secret gate (NER is opt-in; fail-closed preserves secrets).
**Missing dependencies with fallback:** ML deps + models → `nerStatus:'unavailable'`, detection degrades to L1–4 + regex-PII (NER-03).

## Validation Architecture

> `workflow.nyquist_validation` is `false` in `.planning/config.json` — section SKIPPED.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | partial | MCP-03 invariant: NER enriches read/transform-only tools; NO new write/unredact tool. Verify tools-list test still passes. |
| V5 Input Validation | yes | NER input is untrusted hook/tool text; tool args validated by Zod v4 (existing). `min_score` floor is a numeric config bound — validate range [0,1]. |
| V6 Cryptography | yes | SHA-256 model integrity via Phase 5 `node:crypto` (reused for piiranha second hash). Never hand-roll. |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Raw PII (names) leaking into audit / error text / tool DTO | Information Disclosure | `findingToAuditRecord` excludes `value` (LOCKED); findingSchema omits value/span; nerStatus/error strings carry model state only (Pitfall 5). Phase 7 leak-grep covers exception paths. |
| Model file tampering (bert OR piiranha) | Tampering | SHA-256 pinned + verified on load (Phase 5); piiranha needs a second pinned hash (Wave-0). |
| NER model-load failure crashing the secret gate | Denial of Service | Fail-closed-for-NER at boot AND per-call; secrets unaffected (NER-03, Pattern 5, Pitfall 1). |
| Prompt-injection in tool text trying to disable/abuse NER | Tampering / EoP | MCP surface stays read/transform-only (MCP-03); no NER toggle/unredact tool exposed. |
| Heavy dep on the hook cold path (perf DoS) | Denial of Service | Structural unreachability (Pattern 2) + import-graph test + perf-gate assertion (hook p95 unchanged). |
| Supply-chain: piiranha NonCommercial-ND license | Compliance | Gate tier behind checkpoint; do not default; lazy-download only; document license (Pitfall 7). |

## Sources

### Primary (HIGH confidence)
- [VERIFIED: codebase] `src/detect/index.ts` (orchestrator L1–L6a, runDetection/runDetectionReadOnly, audit step), `src/detect/findings.ts` (Finding shape, SOURCE_PRECEDENCE already ends `…pii-regex,pii-ner`, dedupBySpan), `src/detect/type-map.ts` (PII_PERSON/ORG/LOC in TYPE_VOCABULARY; pii:PERSON|ORG|LOC mapped), `src/detect/layer6a-pii.ts` (layer pattern to mirror), `src/audit/log.ts` (AuditRecord engine/model_rev/quant/backend + findingToAuditRecord no-raw LOCKED guard), `src/mcp/server.ts`/`lifecycle.ts`/`supervisor.ts`/`tools/{check,redact,status}.ts`, `src/model/{model-cache.ts,constants.ts}` (real pinned SHA `7de0a460…`), `src/shared/types.ts` (MrcleanPiiNerConfig), `src/config/defaults.ts` (pii.ner.confidence:0.9).
- [VERIFIED: huggingface.co/docs/transformers.js/tutorials/node] getInstance singleton; `env.cacheDir` default `./node_modules/@huggingface/transformers/.cache/`; `env.localModelPath`; `env.allowRemoteModels=false`.
- [VERIFIED: huggingface.co/docs/transformers.js/api/pipelines] task name `token-classification` (alias `ner`).
- [VERIFIED: huggingface.co/docs/transformers.js/api/backends/onnx] `env.backends.onnx`; node uses onnxruntime-node, browser uses onnxruntime-web (not bundled in node).
- [VERIFIED: HF Hub API, fetched this session] `Xenova/bert-base-NER` config.json id2label = O/B-MISC/I-MISC/B-PER/I-PER/B-ORG/I-ORG/B-LOC/I-LOC; `onnx/model_int8.onnx` x-linked-size 108,486,236; `onnx-community/piiranha-v1-detect-personal-information-ONNX` pipeline=token-classification, lib=transformers.js, `onnx/model_int8.onnx`=317.1 MB, id2label 17 PII labels (no PERSON/ORG/LOC); base license cc-by-nc-nd-4.0.
- [VERIFIED: npm registry] `@huggingface/transformers` 4.2.0 (2026-04-22); `onnxruntime-node` 1.26.0 (2026-05-08), os=[win32,darwin,linux].
- [VERIFIED: slopcheck scan] both ML deps `[OK]`.
- `.planning/research/ARCHITECTURE-v2-pii.md` (two-lane Layer 6, warm singleton, fail-closed semantics, build order).
- `.planning/phases/05-…/05-RESEARCH.md` (env.cacheDir Pitfall 1, model-cache API, dtype task name).

### Secondary (MEDIUM confidence)
- [VERIFIED: github.com/microsoft/onnxruntime#9483, #6800; github.com/huggingface/transformers.js#1275] onnxruntime-node musl/Alpine failure; no auto WASM fallback (manual stub).
- [CITED: huggingface transformers Python token_classification pipeline docs] aggregation_strategy semantics (none/simple/first/average/max) — informs Route A; JS surface must be verified (Open Question 1).

### Tertiary (LOW confidence — verify in Wave 0)
- [ASSUMED] token-classification char `start/end` offsets present for bert-base-NER (A1).
- [ASSUMED] `dtype:'int8'` ⇒ loads `model_int8.onnx` (A3).
- [ASSUMED] piiranha label→PERSON/LOC map and "no ORG" scoping (A2).

## Metadata

**Confidence breakdown:**
- Standard stack / model facts: HIGH — versions, file sizes, label sets, license all verified against live Hub + registry this session.
- Architecture / wiring seams: HIGH — every integration point read directly from shipped code; most contracts pre-built in Phase 4.
- Pitfalls: HIGH — onnxruntime-node/musl, env.cacheDir, config-name mismatch, piiranha label divergence all verified.
- transformers.js v4 NER output shape (offsets/aggregation): MEDIUM — Route B (manual aggregation) de-risks; Wave-0 verifies Route A.

**Research date:** 2026-06-02
**Valid until:** 2026-08-02 (transformers.js 4.x patch releases expected, no breaking change anticipated; model files are content-pinned).
