# Architecture Research — v2.0 Native-Node PII/NER Layer Integration

**Domain:** Integrating an in-process transformers.js ONNX NER + regex-PII detection layer into mrclean's existing layered hook/MCP architecture (milestone v2.0)
**Researched:** 2026-06-01
**Confidence:** HIGH (existing architecture read directly from source; transformers.js lifecycle/caching verified via Context7 `/huggingface/transformers.js`; latency grounded in published benchmarks)

> NOTE: This file is the v2.0-milestone-scoped companion to the v1 `ARCHITECTURE.md`
> in this directory. It does NOT supersede it — it integrates WITH the architecture
> that doc describes (hook-as-pure-function, two parallel surfaces, shared Core Library).

---

## TL;DR — The One Decision That Drives Everything

The 108 MB ONNX NER model **cannot run in the one-process-per-event hook**. Every hook event is a fresh OS process where the transformers.js pipeline singleton is `null`; loading the model from disk (graph deserialize into the ONNX-Runtime WASM backend + a JIT warm-up inference pass) costs **hundreds of milliseconds to seconds**, and warm BERT-NER inference is itself ~110–220 ms/call. Both exceed the < 100 ms UserPromptSubmit / < 200 ms PostToolUse budget on their own, before adding the existing Layer 1–4 cost.

Therefore the integration splits into **two cleanly separated lanes**:

| Lane | Where it runs | Budget | What it does |
|------|---------------|--------|--------------|
| **Regex-PII (the cheap half)** | In the hot-path hook, as a new deterministic sub-layer | Inside < 100/200 ms | email, US SSN, credit-card (Luhn), phone, IP — pure regex, microseconds, no model |
| **NER (the expensive half)** | Long-lived MCP server only (warm singleton), **never** the hook | Perf-exempt (like Layer 5) | PERSON / ORG / LOC via `Xenova/bert-base-NER` int8 |

This mirrors the existing Layer 5 (`--deep` LLM) precedent exactly: the deterministic gate stays on the wire; the model-backed pass is opt-in and lives off the hot path.

---

## Standard Architecture

### System Overview (after v2.0)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       CLAUDE CODE (host process)                           │
└───────────────┬──────────────────────────────────────┬───────────────────┘
                │ spawns per event                       │ spawns once/session
                ▼                                        ▼
┌──────────────────────────────────┐   ┌──────────────────────────────────────┐
│  HOOK PROCESS (dist/cli.js hook)  │   │   MCP STDIO SERVER (long-lived)        │
│  one-process-per-event, <100ms    │   │   warm process, perf-exempt            │
│                                   │   │                                        │
│  runDetection(text, cfg, state)   │   │  3 read-only tools (MCP-03 invariant)  │
│   ├─ L1 secretlint+gitleaks       │   │   ├─ mrclean_check                     │
│   ├─ L2 entropy                   │   │   ├─ mrclean_redact                    │
│   ├─ L3 env-blocklist             │   │   └─ mrclean_status                    │
│   ├─ L4 words                     │   │                                        │
│   ├─ L6a REGEX-PII  ◄── NEW       │   │  runDetection(..., {ner:true}) ◄── NEW │
│   │   (email/ssn/cc/phone/ip)     │   │   └─ L6b NER PIPELINE (warm singleton) │
│   └─ [L5 / L6b NER: SKIPPED here] │   │        Xenova/bert-base-NER int8       │
│                                   │   │        loaded once, reused all calls   │
└───────────────┬──────────────────┘   └───────────────────┬────────────────────┘
                │                                           │
                └──────────────┬────────────────────────────┘
                               ▼
        ┌──────────────────────────────────────────────────┐
        │   SHARED DETECTION CORE (process-agnostic)         │
        │   findings.ts · dedupBySpan · type-map · allowlist │
        │   PlaceholderManager · substitute · audit/log      │
        └──────────────────────────────────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────────────┐
        │   MODEL CACHE (on disk, ~/.mrclean/models/)        │
        │   ONNX weights + tokenizer.json + config.json      │
        │   downloaded lazily on first opt-in (zero-config)  │
        └──────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | New / Modified |
|-----------|----------------|----------------|
| `detect/layer6-pii/regex.ts` | Deterministic structured-PII regex (email, SSN, CC+Luhn, phone, IP). Hot-path safe. Emits `Finding[]` with `source: 'pii-regex'`. | **NEW** |
| `detect/layer6-pii/ner.ts` | Wraps the transformers.js token-classification pipeline. Owns aggregation of subword tokens → entity spans, confidence thresholding. Emits `Finding[]` with `source: 'pii-ner'`. | **NEW** |
| `detect/layer6-pii/pipeline-singleton.ts` | The lazy-loaded model singleton (`getInstance()` pattern). Owns `env.cacheDir`, `env.allowRemoteModels`. Load-failure → throws typed `ModelLoadError`. | **NEW** |
| `detect/layer6-pii/model-cache.ts` | Resolve cache dir, check model presence, drive first-run download with progress, size/integrity guard. | **NEW** |
| `detect/layer6-pii/entities.ts` | entity-label → TYPE mapping + per-entity confidence thresholds + subword-aggregation rules. | **NEW** |
| `detect/index.ts` (orchestrator) | Add L6a (regex-PII) into the fixed layer chain after L4; gate L6b (NER) behind an `opts.ner` flag. | **MODIFIED** |
| `detect/findings.ts` | Add `'pii-regex'` and `'pii-ner'` to `Finding.source` union and to `SOURCE_PRECEDENCE`. | **MODIFIED** |
| `detect/type-map.ts` | Add PII TYPEs (`PERSON, ORG, LOC, EMAIL, SSN, CC, PHONE, IP`) to `TYPE_VOCABULARY` + rule-id mappings. | **MODIFIED** |
| `config/defaults.ts` + `shared/types.ts` | Add `pii` config sub-table (enable, ner enable, model choice, entity toggles, confidence). | **MODIFIED** |
| `mcp/server.ts` + tools (`check.ts`, `redact.ts`) | Warm the NER singleton at server boot / first call; pass `{ ner: true }` into `runDetection`. | **MODIFIED** |
| `hook/*` handlers | No change — they call `runDetection` without `opts.ner`, so NER is structurally never reachable from the hook. | **UNCHANGED** (by design) |
| `PlaceholderManager`, `audit/log`, 5-axis allowlist | Reused as-is. PII findings flow through the identical pipeline. | **UNCHANGED** (reuse) |

---

## Recommended Project Structure

```
src/
├── detect/
│   ├── index.ts                      # MODIFIED: L6a always; L6b gated by opts.ner
│   ├── findings.ts                   # MODIFIED: source union + precedence
│   ├── type-map.ts                   # MODIFIED: PII TYPE vocabulary entries
│   ├── session-state.ts              # MODIFIED (optional): hold warm pipeline ref in MCP
│   ├── layer1-regex/ …               # unchanged
│   ├── layer2-entropy.ts             # unchanged
│   ├── layer3-env.ts                 # unchanged
│   ├── layer4-words.ts               # unchanged
│   └── layer6-pii/                   # NEW package — all PII code lives here
│       ├── index.ts                  # runLayer6PiiRegex(...) + runLayer6PiiNer(...)
│       ├── regex.ts                  # L6a — deterministic structured PII
│       ├── luhn.ts                   # credit-card checksum (false-positive guard)
│       ├── ner.ts                    # L6b — NER inference + span aggregation
│       ├── pipeline-singleton.ts     # lazy warm singleton + load-failure handling
│       ├── model-cache.ts            # cache dir resolution + first-run download
│       └── entities.ts               # entity-label → TYPE + confidence thresholds
├── config/
│   └── defaults.ts                   # MODIFIED: pii defaults (off)
├── shared/
│   └── types.ts                      # MODIFIED: MrcleanPiiConfig interface
└── mcp/
    ├── server.ts                     # MODIFIED: warm singleton, pass ner:true
    └── tools/
        ├── check.ts                  # MODIFIED: runDetectionReadOnly({ner:true})
        └── redact.ts                 # MODIFIED: runDetection({ner:true})
```

### Structure Rationale

- **`detect/layer6-pii/` as a self-contained package:** Everything model-related is quarantined under one folder so the heavy transformers.js dependency is reachable through exactly one `import()` boundary (`pipeline-singleton.ts`). Nothing in the hot path statically references it. This is the same isolation strategy the codebase already uses for `@anthropic-ai/sdk` (Layer 5) and the MCP SDK (`mcp/server.ts` lazy-imports everything).
- **Regex and NER split into separate files even though both are "Layer 6":** Opposite cost profiles, opposite lanes. Regex is hot-path; NER is MCP-only. Co-locating under `layer6-pii/` but separating files keeps the boundary explicit and lets the hot path import only `regex.ts`.
- **`model-cache.ts` separate from `pipeline-singleton.ts`:** Cache resolution / download UX is filesystem + network policy (zero-config, integrity, fail-closed); the singleton is inference plumbing. Different concerns, different test surfaces.

---

## Architectural Patterns

### Pattern 1: Two-Lane Layer 6 (deterministic on-wire, model off-wire)

**What:** Layer 6 is a pair. `L6a` (regex) joins the fixed hot-path chain after L4. `L6b` (NER) is only invoked when `runDetection` receives `opts.ner === true`, which only the MCP server passes.

**When to use:** Always, for any detector whose cost is bimodal (a cheap deterministic part and an expensive model part covering the same domain).

**Trade-offs:** Hook users get email/SSN/CC/phone/IP coverage for free within budget. PERSON/ORG/LOC coverage requires routing text through the MCP server's `mrclean_check` / `mrclean_redact` tools — not automatic on every prompt. This is an honest limitation, not a defect: automatic NER on the wire is physically incompatible with the perf budget under one-process-per-event.

**Example:**
```typescript
// detect/index.ts — additive, preserves existing L1→L2→L3→L4 chain
export interface DetectionOptions { ner?: boolean }   // NEW, defaults false

// after the existing L4 push:
const l6regex = runLayer6PiiRegex(text, config, findings.map(f => f.span))  // hot-path, always
findings.push(...l6regex)

if (opts?.ner && config.pii.ner.enabled) {              // MCP-only branch
  const l6ner = await runLayer6PiiNer(text, config, findings.map(f => f.span))
  findings.push(...l6ner)
}
```

### Pattern 2: Warm-Singleton in the long-lived process, lazy `import()` everywhere

**What:** The transformers.js pipeline is created once per MCP-server lifetime via the documented `getInstance()` singleton, and `@huggingface/transformers` is reached only through a dynamic `import()` so non-opted-in users never load it.

**When to use:** Any 100+ MB native/WASM dependency in a tool that also ships a latency-critical cold-start path.

**Trade-offs:** The MCP server pays a one-time multi-hundred-ms-to-seconds warm-up (acceptable: perf-exempt, amortized over the whole session). The hook never pays it because the hook never sets `opts.ner` and never imports the module.

**Example:**
```typescript
// detect/layer6-pii/pipeline-singleton.ts  (verified against Context7 transformers.js docs)
let instance: Promise<unknown> | null = null

export function getNerPipeline(cfg: MrcleanPiiConfig): Promise<unknown> {
  if (instance) return instance
  instance = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers') // lazy boundary
    env.cacheDir = resolveModelCacheDir()             // ~/.mrclean/models
    env.allowRemoteModels = cfg.ner.allowDownload     // gate network on first run
    return pipeline('token-classification', cfg.ner.model, { dtype: cfg.ner.dtype }) // int8
  })()
  return instance
}
```

### Pattern 3: Fail-closed on model load, fail-open on the hot path

**What:** Two different failure semantics for two different lanes, consistent with the existing `failclosed.ts` philosophy and the Layer-1 budget-exhaustion deny path.

- **MCP NER load failure** (model missing + offline, corrupt download, WASM init crash): the NER lane fails **closed for NER** — `mrclean_check`/`mrclean_redact` return a structured `nerStatus: "unavailable"` and fall back to running L1–L4 + L6a-regex only. It does **not** crash the MCP server (the deterministic secret gate must keep working). The audit log records `pii-ner: model_unavailable` (no raw value).
- **Hot-path:** unchanged — L6a regex is pure JS and shares the existing fail-closed crash guards in `hook/failclosed.ts`. No new failure mode enters the hook.

**When to use:** Whenever an optional enrichment layer can fail independently of the core safety guarantee.

**Trade-offs:** "Fail-closed for NER but keep secrets working" is correct because mrclean's core value is secret exfiltration prevention; PII is the opt-in enrichment. A model load failure must never take down the secret gate. (Contrast: a Layer 1 ReDoS budget exhaustion *does* hard-block, because that is the core gate failing — see `user-prompt-submit.ts` Step 4.)

**Example:**
```typescript
let pipe
try {
  pipe = await getNerPipeline(cfg)
} catch (err) {
  // structured, value-free; secret gate (L1–L4 + L6a) already produced findings
  return { findings: deterministicFindings, nerStatus: 'unavailable', reason: classify(err) }
}
```

---

## Data Flow

### Hot-path flow (hook — NER never runs)

```
UserPromptSubmit / PostToolUse
        ↓
runDetection(text, cfg, state, ctx)        // opts.ner = undefined
        ↓
L1 → L2 → L3 → L4 → L6a-regex(email/ssn/cc/phone/ip)
        ↓
dedupBySpan → effectiveAction → PlaceholderManager.allocate(value, PII_TYPE)
        ↓
substituteFindings → audit/log → DetectionResult
        ↓
hook handler maps effectiveAction → block / additionalContext / pass-through
```

### MCP-server flow (NER warm singleton in play)

```
Claude calls mrclean_check / mrclean_redact (text arg)
        ↓
runDetection(text, cfg, sessionState, ctx, { ner: true })
        ↓
L1 → L2 → L3 → L4 → L6a-regex
        ↓
L6b-NER:  getNerPipeline() ──first call──► load from ~/.mrclean/models (warm-up)
                          └─subsequent────► reuse warm pipeline (~110–220ms infer)
        ↓
NER output (subword tokens) → aggregate to entity spans → confidence filter
        ↓  → Finding[] { source:'pii-ner', ruleId:'pii:PERSON', value, span }
dedupBySpan (precedence: secretlint > gitleaks > entropy > env > words > pii-regex > pii-ner)
        ↓
PlaceholderManager.allocate → <MRCLEAN:PERSON:001> … → substitute → audit → result
```

### First-run model download (zero-config)

```
First time pii.enabled && pii.ner.enabled, MCP server boot:
        ↓
model-cache.ts: is ~/.mrclean/models/Xenova--bert-base-NER present?
   ├─ yes → load from cache, no network
   └─ no  → if cfg.ner.allowDownload (default true): fetch from HF Hub,
            stream to cache dir with progress to stderr, size/integrity guard
        ↓
  (offline + missing) → ModelLoadError → nerStatus: 'unavailable' (fail-closed for NER)
```

### Findings → existing pipeline reuse (no new sink)

A PII `Finding` is structurally identical to a secret `Finding`. It re-uses, with **zero new sink code**:
- `PlaceholderManager.allocate(value, type)` → stable `<MRCLEAN:PERSON:NNN>` per session.
- `substituteFindings` → same span-replacement engine.
- `audit/log` `findingToAuditRecord` → same JSONL, `redactedHash` only (T-02-05-01: raw PII value, like raw secrets, **never** logged).
- 5-axis allowlist → `rules` axis suppresses `pii:PERSON`; `stopwords`/`regexes` suppress known-safe names; `fingerprints` suppress a specific PII value.

---

## Model Loading Lifecycle — the central problem, resolved

| Question | Answer |
|----------|--------|
| Reload per event in the hook? | **Yes, it would** — fresh process ⇒ `instance === null` every time. This is why NER is **excluded from the hook entirely.** |
| Cost of a cold load | Download (first run only) + ONNX graph deserialize into WASM backend + JIT warm-up pass. Hundreds of ms to seconds. **>> 100 ms budget.** |
| Cost of warm inference | ~110–220 ms for BERT-class NER per call (ONNX). **> 100 ms budget on its own.** |
| Viable homes | (1) **Long-lived MCP server** — warm singleton, perf-exempt. **← recommended primary.** (2) A separate persistent "warm daemon" the hook talks to over IPC — **rejected for v2.0** (adds process-supervision surface, socket protocol, and a new attack surface into a process holding decrypted data; YAGNI until users demand automatic on-wire NER). The v1 `ARCHITECTURE.md` already evaluated and deferred a sidecar daemon (its Option C) for the same reasons. |
| Why reuse MCP, not build a daemon | The MCP server already *is* the long-lived warm process mrclean ships (`mcp/server.ts`, `mcp/supervisor.ts`, `mcp/lifecycle.ts`). A bespoke NER daemon duplicates that lifecycle/supervision for marginal benefit. |
| Singleton lifetime | One pipeline per MCP-server process, created lazily on first NER-bearing tool call (or eagerly at boot if `pii.ner.warmOnBoot`). Cleared on shutdown alongside WorkerPool/PlaceholderManager in `shutdownMcpSupervisor` (see `mcp/server.ts` shutdown order). |
| Cache location | `~/.mrclean/models/` via `env.cacheDir` (NOT the transformers.js default `./node_modules/@huggingface/transformers/.cache/`, which is wiped on reinstall and not user-visible). Co-located with existing `~/.mrclean/config.toml`. |
| First-run UX | Lazy fetch on first opt-in; progress to stderr; never bundled in the npm tarball (keeps `npx mrclean` install small, honoring the zero-config constraint). `env.allowRemoteModels` gates the download; offline + missing ⇒ fail-closed-for-NER. |

---

## Config Surface

```toml
[pii]
enabled = false              # master switch (off by default — secrets remain core)

[pii.regex]                  # the hot-path lane (cheap, deterministic)
enabled = true               # when [pii].enabled, regex PII is on by default
entities = ["email", "ssn", "credit_card", "phone", "ip"]   # per-entity toggle

[pii.ner]                    # the MCP-only lane (model-backed, perf-exempt)
enabled = false              # opt-in within opt-in
model = "Xenova/bert-base-NER"
dtype = "int8"               # 108 MB; "fp32" available for higher accuracy
entities = ["PERSON", "ORG", "LOC"]   # MISC excluded by default (noisy)
confidence = 0.9             # below this score → drop the entity
allowDownload = true         # first-run network fetch permitted
warmOnBoot = false           # warm singleton at MCP boot vs first tool call
```

Defaults wire through the existing `mergeConfigs(DEFAULT_CONFIG, userLayer, projectLayer)` chain (`config/defaults.ts`, `Object.freeze`'d). `pii.*.entities` arrays should follow the documented merge semantics in `shared/types.ts` — the roadmap's config plan must pin whether entity arrays use allowlist-style concat or scalar last-wins (recommend last-wins for entity toggles to allow project-level narrowing).

---

## Anti-Patterns

### Anti-Pattern 1: Running NER inside the hook "just for UserPromptSubmit"

**What people do:** Add the NER pipeline to the hot-path chain, trying to stay under budget with a smaller model or token cap.
**Why it's wrong:** Even warm inference is > 100 ms; and the hook is never warm (one-process-per-event ⇒ cold every time). No model is small enough to load + infer under 100 ms per spawn. Users disable mrclean.
**Do this instead:** NER lives in the long-lived MCP server only. Hot path gets the deterministic regex-PII lane.

### Anti-Pattern 2: Statically importing `@huggingface/transformers` from a cold-start-reachable module

**What people do:** `import { pipeline } from '@huggingface/transformers'` at the top of a detect module.
**Why it's wrong:** Pulls the WASM/ONNX runtime into the CLI/hook cold path for 100% of users including those who never enable PII, blowing the cold-start budget.
**Do this instead:** Dynamic `import()` inside `pipeline-singleton.ts`, reached only via the `opts.ner` branch — identical to how `@anthropic-ai/sdk` (Layer 5) and the MCP SDK are already lazy-loaded.

### Anti-Pattern 3: Letting a model-load failure crash the MCP server / secret gate

**What people do:** `await getNerPipeline()` unguarded at the top of a tool handler.
**Why it's wrong:** A corrupt download or offline box would take down the secret-detection tools too — failing the core value to protect the opt-in enrichment.
**Do this instead:** Fail-closed-for-NER: catch, set `nerStatus: 'unavailable'`, return deterministic findings (L1–L4 + L6a) anyway.

### Anti-Pattern 4: Bundling the 108 MB model into the npm package

**What people do:** Ship weights in the tarball so it works offline day one.
**Why it's wrong:** Breaks the zero-config small-`npx` constraint; 99% of users (PII off by default) pay the download.
**Do this instead:** Lazy fetch to `~/.mrclean/models/` on first opt-in.

### Anti-Pattern 5: Routing tool output through NER automatically via the PostToolUse hook

**What people do:** Try to call the MCP server's NER tool from the PostToolUse hook to get "automatic" PII on tool results.
**Why it's wrong:** Reintroduces the cold-start/latency problem (hook → MCP round-trip per event) and couples the hook to the MCP server being alive — the v1 architecture explicitly rejected hook→MCP coupling (its Option B).
**Do this instead:** Keep hook and MCP independent surfaces. NER is an explicit, on-demand MCP operation, not an automatic hot-path step.

---

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| hook handlers ↔ `runDetection` | direct call, **no `ner` opt** | Structurally guarantees NER is unreachable from the hook. |
| MCP tools ↔ `runDetection` | direct call, `{ ner: true }` | Only callers that pass the flag. |
| `runDetection` ↔ `layer6-pii/index` | direct (regex) + dynamic-import-guarded (ner) | Regex statically linked (cheap); NER behind `import()`. |
| `layer6-pii/ner` ↔ transformers.js | dynamic `import()` in `pipeline-singleton.ts` | Single lazy boundary for the heavy dep. |
| `pipeline-singleton` ↔ disk cache | `env.cacheDir = ~/.mrclean/models` | First-run download; offline fail-closed. |
| PII findings ↔ PlaceholderManager / audit / allowlist | reuse existing sinks unchanged | New TYPEs + `Finding.source` values are the only schema additions. |

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Hugging Face Hub | first-run model download via transformers.js `env.allowRemoteModels` | One-time, opt-in, to local cache. **No inference traffic ever leaves the box** — model runs in-process. Preserves mrclean's "no data egress" invariant (cloud PII APIs were explicitly ruled out in PROJECT.md §guardrails). |

---

## Suggested Build Order (dependency-honoring)

1. **Schema + vocabulary foundation** (no behavior): add `'pii-regex'`/`'pii-ner'` to `Finding.source` + `SOURCE_PRECEDENCE`; add PII TYPEs + rule-id mappings to `type-map.ts`; add `MrcleanPiiConfig` to `shared/types.ts` + `defaults.ts` (off). *Unblocks everything; touches Plan-02-00-owned files (`findings.ts`, `type-map.ts`) which carry "revise plan first" warnings — sequence first and revise those plans.*
2. **L6a regex-PII (hot-path lane)**: `layer6-pii/regex.ts` + `luhn.ts`; wire into `runDetection` after L4 (always-on, gated by `pii.regex.enabled`). Ship + validate within the < 100/200 ms budget via `doctor/bench.ts`. *Delivers PII value to hook users immediately; no model dependency.*
3. **Model-cache + singleton plumbing**: `model-cache.ts`, `pipeline-singleton.ts` with lazy `import()`, fail-closed-for-NER. *Pure infra; testable without wiring into detection (load/fail/cache-resolution tests).*
4. **L6b NER inference**: `ner.ts` + `entities.ts` (subword aggregation, confidence filter); gate behind `opts.ner && pii.ner.enabled`. *Depends on 1 + 3.*
5. **MCP server wiring**: pass `{ ner: true }` from `check.ts`/`redact.ts`; warm singleton at boot or first call; `nerStatus` in tool output; clear on `shutdownMcpSupervisor`. *Depends on 4. Verify the MCP-03 invariant still holds — no new write/disk tool is added; NER is an enrichment of existing read-only tools.*
6. **Zero-config first-run UX + doctor**: progress reporting; extend `doctor/checks.ts` with a model-presence/cache check; surface offline behavior. *Depends on 3 + 5.*

**Roadmap flags:**
- Steps 1–2 are low-risk, deterministic, hot-path — standard patterns.
- Steps 3–4 carry the technical risk and **warrant a phase-specific spike before committing the model choice**: (a) transformers.js v4 package name is `@huggingface/transformers` (the legacy `@xenova/transformers` is superseded — confirm which the v2.0 STACK targets); (b) ONNX-Runtime WASM init behavior on the Node 20 floor; (c) confirm the `int8` variant of `Xenova/bert-base-NER` exists on the Hub and its real cold-load + warm-infer timings on target hardware. Spike 002 (already proposed in spike 001's follow-ups for a live Presidio run) is the natural place to also benchmark this.

---

## Sources

- mrclean source (read directly, HIGH): `src/detect/index.ts`, `src/detect/findings.ts`, `src/detect/session-state.ts`, `src/detect/type-map.ts`, `src/config/defaults.ts`, `src/shared/types.ts`, `src/hook/handlers/user-prompt-submit.ts`, `src/hook/failclosed.ts`, `src/mcp/server.ts`, `src/placeholder/type-map.ts`.
- `.planning/PROJECT.md` (v2.0 milestone goal, guardrails: no Python, no egress, off-by-default, Presidio deferred).
- `.planning/spikes/001-vs-presidio/README.md` (complementary positioning; PII entity set; mrclean misses all PII today; proposed spike 002).
- `.planning/research/ARCHITECTURE.md` (v1 — two-surface model, hook-as-pure-function, sidecar-daemon deferral, hook↔MCP independence; this doc integrates with those decisions).
- Transformers.js docs via Context7 `/huggingface/transformers.js` (HIGH): singleton `getInstance()` pattern (`tutorials/node.md`); `env.cacheDir` default `./node_modules/@huggingface/transformers/.cache/`; `env.localModelPath`; `env.allowRemoteModels = false` for offline; `dtype: 'int8'` quantization API; package name `@huggingface/transformers` (v4+, supersedes `@xenova/transformers`).
- Cold-start / inference latency (MEDIUM, multiple sources): cold load = download + WASM graph deserialize + warm-up pass (hundreds of ms–seconds); ONNX BERT-class NER warm inference ~110–220 ms/call. SitePoint "Optimizing Transformers.js for Production"; PkgPulse "Transformers.js vs ONNX Runtime Web 2026".

---
*Architecture research for: in-process transformers.js ONNX NER + regex-PII layer integration into mrclean v2.0*
*Researched: 2026-06-01*
