# Stack Research

**Domain:** In-process, native-Node PII/NER detection layer (opt-in tier) for mrclean v2.0 — no Python, no data egress
**Researched:** 2026-06-01
**Confidence:** HIGH (versions/sizes verified live against npm + Hugging Face API; transformers.js docs via Context7)

> Scope note: This file covers ONLY the **new** PII/NER capability for milestone v2.0. The existing
> Node 20+/TS stack, hooks, MCP stdio server, secretlint+gitleaks+entropy+.env+words.txt layers,
> placeholder manager, audit log, allowlist, tsup, and Vitest are already validated — see CLAUDE.md.
> Nothing here changes those picks; it adds an opt-in lane on top of them.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **`@huggingface/transformers`** | `^4.2.0` (current latest; `next` = `4.0.0-next.11`) | In-process ONNX inference engine for the NER pass — `pipeline('token-classification', …)` | The **maintained** successor to `@xenova/transformers`, which is frozen at `2.17.2` (last published 2024-05-29, no releases since). The Xenova package is a dead end; `@huggingface/transformers` is the org-owned continuation, actively shipping. On Node it runs models **CPU-only via native `onnxruntime-node`** (no GPU, no Python, no network at inference time). Exposes `env.cacheDir`, `dtype`-based quantization selection, and `progress_callback` for lazy-download UX — exactly the controls the zero-config model strategy needs. |
| **`onnxruntime-node`** | `1.24.3` (pinned transitively by `@huggingface/transformers@4.2.0`) | Native CPU inference backend | **Do not install directly** — it arrives as a dependency of `@huggingface/transformers` and is version-locked there (transformers 4.2.0 pins `onnxruntime-node@1.24.3`, `sharp@^0.34.5`, `onnxruntime-web@1.26.0-dev`). It ships **prebuilt native binaries** per platform (darwin-arm64/x64, linux, win32) via npm optional deps — no compiler needed on install, but it IS a native module: it inflates `node_modules`, can fail on musl/Alpine without the right prebuild, and is the reason the whole NER engine must live behind the opt-in lane, never in the default `npx` cold path. |

### NER Models (lazy-downloaded ONNX, not bundled)

All sizes are **verified live** against the Hugging Face blob API on 2026-06-01. Pick the `int8`/`quantized`/`uint8` variant (they are byte-identical in size and are what transformers.js fetches when `dtype: 'int8'` or the legacy `quantized: true` is set).

| Model | int8 / quantized size | Entities | Recommendation |
|-------|----------------------|----------|----------------|
| **`Xenova/bert-base-NER`** | **108.5 MB** (int8/uint8); `q4f16` 93.7 MB; fp32 431 MB | PER, ORG, LOC, MISC (4 classes, CoNLL-2003) | **DEFAULT.** Smallest credible NER model, matches PROJECT.md's ~108 MB target. Covers the "names / orgs / locations" goal directly. Already published in transformers.js ONNX layout. Fast enough for the perf-exempt lane. |
| **`onnx-community/piiranha-v1-detect-personal-information-ONNX`** | **317.1 MB** (int8/quantized/uint8); fp16 575 MB; fp32 1150 MB | Purpose-built PII token classifier (names, emails, phone, SSN-like, account #s, etc.) | **OPTIONAL upgrade tier.** ~3× the download of bert-base-NER and a DeBERTa-v3 backbone (heavier per-token). Offer as an opt-in `--pii-model piiranha` for users who want structured-PII coverage from the model itself rather than from regex. Low community traction (515 downloads, 1 like) — treat as MEDIUM-maturity. |
| **`onnx-community/gliner_multi_pii-v1`** | **349.1 MB** (int8/quantized) | Zero-shot GLiNER — arbitrary entity labels at inference time (you pass the label set) | **DEFER.** GLiNER's zero-shot labeling is powerful but the transformers.js `token-classification` pipeline does **not** natively drive GLiNER's prompt-based head; it needs custom pre/post-processing (the `gliner` npm wrapper, v0.0.19, last touched 2025-03, is `0.0.x` and immature). Not worth the integration risk for v2.0. Revisit if users need custom entity types. |

**Model UX strategy (verified against transformers.js Node docs):**
- Default cache is `./node_modules/@huggingface/transformers/.cache/`. **Override** with `env.cacheDir` to a stable user-level path (e.g. `~/.mrclean/models/`) so the model survives `npm` reinstalls and is shared across projects.
- Set `env.allowRemoteModels = true` on first opt-in (to fetch), then the cached copy is used offline. Optionally set `env.allowLocalModels`/`env.localModelPath` to force offline-only after first fetch.
- Use the **singleton pipeline pattern** (lazy `getInstance()`) — load the model once per process, never at module top-level, so a session that never opts in pays zero cost.
- Wire `progress_callback` into the CLI to show a one-time download progress bar (`mrclean enable-pii` style), satisfying "zero-config but no multi-hundred-MB bundle."
- Quantization: pass `dtype: 'int8'` (modern API) — the legacy `quantized: true` boolean is deprecated in favor of `dtype` in transformers.js v3+.

### Structured-PII detection (regex + validators, zero model)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **`validator`** | `^13.15.35` | Battle-tested validators behind hand-rolled regex matches: `isEmail`, `isCreditCard` (Luhn), `isIP` (v4/v6), `isMobilePhone` | Use as the **confirmation step** after a cheap regex pre-filter. mrclean already vendors+runs gitleaks regexes itself; the structured-PII rules (email/SSN/CC/phone/IP) follow the same pattern — small TS rule pack, then `validator` to kill false positives (e.g. Luhn-check a 16-digit run before redacting). ~7M weekly downloads, zero runtime deps, MIT. |
| **Hand-rolled regex rule pack** | inline (~80–120 LOC) | The 5 structured-PII patterns, expressed in the existing rule-engine shape | DRY with the existing gitleaks-TOML engine: define `email`, `us_ssn`, `credit_card`, `phone`, `ipv4/ipv6` as rules that feed the **same** placeholder manager (`<MRCLEAN:PII:NNN>`), audit log, and 5-axis allowlist. Luhn + `validator.isCreditCard` gates the CC rule; a context check (digit grouping `xxx-xx-xxxx`) gates SSN to cut false positives. This is the KISS choice over a third-party PII redactor. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **`@types/validator`** | TS types for `validator` | Dev dep; `validator` ships no bundled types. Pin `^13.x`. |
| existing `tsup` / `Vitest` | Build + test the new layer | No change. **Caveat:** `@huggingface/transformers` + `onnxruntime-node` must be marked **external** in the tsup config (they are native/large and already-resolved at the consumer) — never bundle them. Lazy `import()` keeps them out of the default entry graph. |

## Installation

```bash
# New runtime deps for the PII/NER layer (regular deps, but LAZY-imported behind the opt-in tier)
npm install @huggingface/transformers@^4.2.0 validator@^13.15.35

# (onnxruntime-node + sharp arrive transitively, version-pinned by @huggingface/transformers — do NOT add directly)

# Dev
npm install -D @types/validator@^13
```

Models are **not** an npm dependency — they are fetched at runtime on first opt-in into `env.cacheDir`.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@huggingface/transformers@^4.2.0` | `@xenova/transformers@2.17.2` | **Never.** Frozen since 2024-05-29; superseded by the HF-org package. Only relevant if pinning to a years-old model loader for reproducibility, which we don't want. |
| `Xenova/bert-base-NER` (108 MB) | `piiranha-...-ONNX` (317 MB) | When the user explicitly opts into heavier, PII-specialized model coverage and accepts the 3× download + slower per-token inference. Offer as a flag, not the default. |
| Hand-rolled regex + `validator` | `gliner_multi_pii-v1` (349 MB, zero-shot) | When users need **custom/arbitrary** entity types (e.g. "internal project codename" as an NER label) that fixed regex + bert-base-NER can't express. Defer until demand is real; integration is non-trivial. |
| Hand-rolled regex + `validator` | `redact-pii@3.4.0` | **Never (see What NOT to Use).** Its built-in patterns are fine but the package drags in `@google-cloud/dlp`. |
| `validator` | `card-validator@10.0.4` | If you need card-brand detection (Visa/Amex/…) beyond Luhn validity. Not needed — mrclean only needs "is this a real card number" to decide whether to redact. |
| Native `onnxruntime-node` (via transformers) | `onnxruntime-web` (WASM) on Node | Only if a target platform has no `onnxruntime-node` prebuild (e.g. exotic arch). WASM is slower; acceptable fallback for the perf-exempt lane but adds complexity. Detect-and-fallback, don't default to it. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **`redact-pii` (solvvy)** | Depends on **`@google-cloud/dlp`** (+ `lodash`). DLP is a *cloud* redaction backend — pulling it in bloats install with a Google Cloud client and adds a data-egress-capable code path into a tool whose entire premise is "no text leaves the box." Supply-chain + threat-model mismatch even if you only call the sync regex path. | Hand-rolled regex pack + `validator`; or `@redactpii/node` (zero-dep, regex-only) if a turnkey lib is wanted. |
| **Microsoft Presidio (Python sidecar)** | Requires Python runtime + spaCy/transformers model (hundreds of MB) + an out-of-process call. Breaks the zero-config `npx`, no-Python, in-process constraints. Spike 001 already framed it as **complementary, deferred** — a compliance-tier alternative, not the default. | In-process `@huggingface/transformers` NER. Keep Presidio as a documented "compliance tier" pointer only. |
| **Any cloud PII API** (AWS Comprehend, GCP DLP, Azure PII) | Sending text off-box to detect leakage **defeats mrclean's purpose** and is explicitly ruled out in PROJECT.md. | Local ONNX inference only. |
| **`@xenova/transformers`** | Frozen 2024; superseded. | `@huggingface/transformers`. |
| **Installing `onnxruntime-node` directly** | Version drift against the one `@huggingface/transformers` pins (`1.24.3`); mismatched native ABI → load failures. | Let it come transitively; keep it external in tsup. |
| **Bundling the model into the npm tarball** | Multi-hundred-MB package install for an off-by-default feature; kills the zero-config first-run promise. | Lazy runtime download into `env.cacheDir` with `progress_callback`. |
| **Loading the NER pipeline at module top-level** | `onnxruntime-node` native load + model deserialize would blow the <100 ms UserPromptSubmit budget for *every* user, opted-in or not. | Lazy `import()` + singleton, only inside the opt-in PII code path. |

## Stack Patterns by Variant

**If user has NOT opted into PII (default):**
- Zero new cost. `@huggingface/transformers` is never imported; no model on disk. The existing secretlint+gitleaks+entropy+.env+words.txt pipeline is unchanged and remains the **hard deterministic gate** for secrets.

**If user opts into structured-PII only (regex tier):**
- Load the hand-rolled regex pack + `validator`. No model download. Runs in the **same single Node process**; cheap enough it *could* run in the hot path, but route it through the opt-in lane for consistency. Findings → `<MRCLEAN:PII:NNN>` via the existing placeholder manager.

**If user opts into NER (model tier, `--deep`-style):**
- Lazy-load `@huggingface/transformers`, fetch `Xenova/bert-base-NER` int8 (~108 MB) once into `~/.mrclean/models/`, build the singleton pipeline. **Perf-exempt** like the existing Layer 5 LLM pass — runs out of the <100 ms / <200 ms budget by design. Cap/chunk input length to bound latency. NER + regex tiers compose: regex for structured IDs, NER for free-text names/orgs/locations.

**If user needs heavier PII coverage:**
- Swap model to `piiranha-...-ONNX` int8 (~317 MB) via config — same pipeline code, different `model` id.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@huggingface/transformers@^4.2.0` | Node `>=20` | Aligns with mrclean's existing Node 20 floor. Uses native `fetch`/ESM. |
| `@huggingface/transformers@4.2.0` | `onnxruntime-node@1.24.3` (pinned), `sharp@^0.34.5`, `onnxruntime-web@1.26.0-dev` | These are exact/transitive pins inside transformers; treat them as opaque and external. `sharp` is only used for image models (irrelevant to NER) but still installs — another reason to keep this whole subtree behind opt-in. |
| `@huggingface/transformers` | tsup (ESM, `target: node20`) | Mark `@huggingface/transformers` and `onnxruntime-node` as `external` in tsup; rely on lazy `import()` so they stay out of the default bundle graph. |
| `validator@^13.15.35` | Node `>=20`, zero runtime deps | Pairs with `@types/validator@^13` (dev). |
| ONNX model variant | `dtype: 'int8'` (modern) / `quantized: true` (legacy) | Prefer `dtype`. int8 == quantized == uint8 in file size for both candidate models (verified). |

## Sources

- Context7 `/huggingface/transformers.js` — `token-classification` / pipeline API, `env.cacheDir`, `dtype` quantization, `progress_callback`, singleton ESM pattern, default cache path. HIGH.
- `npm view @huggingface/transformers` (live, 2026-06-01) — version `4.2.0`, `next 4.0.0-next.11`; deps pin `onnxruntime-node@1.24.3`, `sharp@^0.34.5`, `onnxruntime-web@1.26.0-dev`. HIGH.
- `npm view @xenova/transformers` — `2.17.2`, last modified 2024-05-29 (frozen). HIGH.
- Hugging Face blob API (`?blobs=true`, live) — verified ONNX file sizes: `Xenova/bert-base-NER` int8 108.5 MB; `onnx-community/piiranha-...-ONNX` int8 317.1 MB; `onnx-community/gliner_multi_pii-v1` int8 349.1 MB. HIGH.
- `npm view redact-pii dependencies` — confirms `@google-cloud/dlp` + `lodash` deps. HIGH.
- `npm view validator` (`13.15.35`), `card-validator` (`10.0.4`), `gliner` (`0.0.19`, 2025-03) — version/maturity signals. HIGH.
- [redact-pii / basic-redact-pii / @redactpii/node on npm](https://www.npmjs.com/package/redact-pii) — corroborates DLP dependency and the zero-dep offline forks. MEDIUM.
- `.planning/spikes/001-vs-presidio/README.md` — Presidio deferred-as-complementary framing; entity-coverage gap mrclean must close. HIGH (internal).

---
*Stack research for: native-Node PII/NER detection layer (mrclean v2.0)*
*Researched: 2026-06-01*
