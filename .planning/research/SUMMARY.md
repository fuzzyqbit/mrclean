# Project Research Summary

**Project:** mrclean
**Domain:** Opt-in, native-Node PII/NER detection layer for an in-session LLM-boundary sanitizer (milestone v2.0)
**Researched:** 2026-06-01
**Confidence:** HIGH

> Scope: This summary covers ONLY the v2.0 "Native-Node PII/NER Layer" milestone. The v1 whole-product summary is preserved at `SUMMARY.v1.md`. All four research files treat the existing v1 substrate (secretlint/gitleaks/entropy/.env/words.txt secret layers, `<MRCLEAN:*>` placeholder manager, audit log, 5-axis allowlist, hook + MCP wiring, tsup/Vitest) as a fixed foundation the PII layer plugs into.

## Executive Summary

mrclean v2.0 adds an opt-in PII/NER tier that catches what the deterministic secret layers can't: free-text **names, orgs, and locations** (which have no regex signature) plus **structured PII** (email/SSN/credit-card/phone/IP, which do). Experts build this exactly the way Microsoft Presidio does — regex+checksum recognizers for closed-class entities, an ML NER model for open-class ones, per-finding confidence scores with thresholds — but mrclean must achieve that *behavior* without Presidio's Python/cloud stack. The recommended approach: run NER in-process via `@huggingface/transformers@^4.2.0` (the maintained successor to the frozen `@xenova/transformers`) on ONNX through native `onnxruntime-node`, with `Xenova/bert-base-NER` int8 (~108 MB) as the default model, lazy-fetched and SHA-pinned to `~/.mrclean/models/`. Structured PII stays pure-JS: a small hand-rolled regex pack confirmed by the `validator` library plus a Luhn check.

The single load-bearing architectural decision is that **NER cannot run in the hook**. Claude Code spawns a fresh OS process per hook event, so a 108 MB model would cold-load (hundreds of ms to seconds) on *every* prompt and tool result — 10–100× over the < 100 ms / < 200 ms budget. The resolution is a two-lane Layer 6: **L6a regex-PII is pure-JS and joins the hot path**, while **L6b NER runs ONLY in the warm, long-lived MCP server** as a lazy-loaded warm singleton, perf-exempt exactly like the existing Layer-5 `--deep` LLM pass. PII findings flow through the existing placeholder manager, audit log, and 5-axis allowlist unchanged — the only schema additions are new `PII_*` TYPEs and `pii-regex`/`pii-ner` finding sources.

The key risks are all about not over-trusting a probabilistic detector in a security tool. NER is **advisory by default** (warn/audit), never a hard gate — secrets remain the only default hard block, with checksum'd entities (SSN/CC) allowed to block. The ML dependency tree must be declared as **optionalDependencies** so a failed native build (musl/Alpine, exotic arch — onnxruntime-node is glibc-linked and does NOT auto-fall-back to WASM in Node) never breaks the core secret tool. The model download must be explicit, consented, SHA-256-verified, and cached to a stable user-level path (never cwd-relative `./.cache`). Raw PII must never reach the audit log or error paths. And the milestone needs a hard scope fence to avoid drifting into "a worse Presidio in Node." Cloud PII APIs (AWS Comprehend, GCP DLP, Azure) and `redact-pii` (pulls `@google-cloud/dlp` = cloud egress) are explicitly banned.

## Key Findings

### Recommended Stack

The NER engine is `@huggingface/transformers@^4.2.0` running CPU-only in-process via native `onnxruntime-node@1.24.3` (transitively pinned — never installed directly). `@xenova/transformers` is a dead end (frozen at 2.17.2 since 2024-05-29). All ML deps must be **optionalDependencies** so the core secret tool installs and runs even when the native build fails. Structured PII is hand-rolled regex confirmed by `validator@^13.15.35` + Luhn — DRY with the existing gitleaks-TOML rule engine. Models are NOT npm deps; they lazy-download on first opt-in. `redact-pii`, Presidio sidecar, and any cloud PII API are rejected.

**Core technologies:**
- **`@huggingface/transformers@^4.2.0`** — in-process ONNX `token-classification` NER — maintained successor to frozen `@xenova/transformers`; exposes `env.cacheDir`, `dtype` quantization, `progress_callback` for the lazy-download UX.
- **`onnxruntime-node@1.24.3`** (transitive, optional) — native CPU inference backend — prebuilt per-platform binaries; glibc-linked, NO auto-WASM-fallback in Node; the reason the whole NER subtree must live behind the opt-in lane and `optionalDependencies`.
- **`Xenova/bert-base-NER` int8 (~108 MB)** — default model, PER/ORG/LOC/MISC — smallest credible NER model; lazy-fetched + SHA-pinned to `~/.mrclean/models/`. `piiranha` (~317 MB) optional tier; `gliner_multi_pii` (~349 MB zero-shot) deferred (no native pipeline support).
- **`validator@^13.15.35`** — checksum/format confirmation behind regex pre-filter — `isEmail`/`isCreditCard` (Luhn)/`isIP`/`isMobilePhone`; zero runtime deps, MIT.

### Expected Features

PII/NER splits into two separable requirement clusters: a **regex structured-PII pack** (cheap, no model, hot-path-safe — ships independently) and **NER** (names/orgs/locations, drags in the ~108 MB ML runtime). The MVP ships both, but the regex half alone is a shippable PII story. NER is advisory: default action warn/audit; only checksum'd entities (SSN/CC) may block; secrets remain the only default hard gate. A per-entity `min_score` threshold is mandatory — NER without it is unshippable (FP avalanche).

**Must have (table stakes, P1 for v2.0):**
- Opt-in flag, default OFF, perf-exempt (mirrors Layer 5) — non-negotiable guardrail.
- Regex PII pack: email, US phone, US_SSN, credit-card+Luhn, IPv4/IPv6 — pure-JS, no model.
- PERSON via `Xenova/bert-base-NER` int8 — the reason this is a PII/NER milestone.
- Lazy model fetch + cache on first opt-in — protects zero-config `npx`.
- Per-entity confidence threshold + per-entity action (block/warn/audit).
- Findings flow into existing placeholder (`PII_*` TYPE) + audit + 5-axis allowlist — "free" reuse, no new anonymizer code.

**Should have (competitive, P2 post-validation):**
- ORG + LOCATION via NER — same model, mostly threshold tuning; overlaps the `words.txt` proprietary-term mission.
- Context-word score boosting (promote marginal `dob:`/`ssn:` hits) — reuses entropy-Layer-2 keyword proximity.
- IBAN + crypto-address (checksum-validated regex).
- NER on size-capped PostToolUse spans (only after profiling proves a safe budget).

**Defer (v3+):**
- Multi-language / swappable NER model — English covers the dominant case.
- Medical/PHI entities, country-specific gov IDs — route to the deferred Presidio compliance tier, not core.
- Model-facing `unredact`/`disable_pii` MCP tool — banned (prompt-injection bypass, same as v1 MCP-03).

### Architecture Approach

Layer 6 is a **two-lane pair** that mirrors the existing Layer-5 precedent. **L6a (regex-PII)** is deterministic, pure-JS, and joins the fixed hot-path chain after L4 — gated by `pii.regex.enabled`. **L6b (NER)** is only invoked when `runDetection` receives `opts.ner === true`, which **only the MCP server passes** — structurally guaranteeing NER is unreachable from the hook. The transformers.js pipeline is a lazy-`import()`ed warm singleton created once per MCP-server lifetime. Model load failure is **fail-closed-for-NER** (return `nerStatus: 'unavailable'`, fall back to L1–L4+L6a) and must never crash the secret gate. All PII findings reuse the existing placeholder manager, audit log, and 5-axis allowlist with zero new sink code.

**Major components (all new code quarantined under `src/detect/layer6-pii/`):**
1. **`regex.ts` + `luhn.ts` (L6a)** — deterministic structured-PII, hot-path-safe; emits `Finding[]` with `source: 'pii-regex'`.
2. **`pipeline-singleton.ts` + `model-cache.ts`** — the single lazy `import()` boundary for `@huggingface/transformers`; `env.cacheDir = ~/.mrclean/models`; cache resolution, consented first-run download, integrity guard, typed `ModelLoadError`.
3. **`ner.ts` + `entities.ts` (L6b)** — NER inference, subword→span aggregation, per-entity confidence filter, label→TYPE mapping; emits `source: 'pii-ner'`. MCP-only.
4. **Modified shared core** — `detect/index.ts` (add L6a always, gate L6b by `opts.ner`), `findings.ts` (source union + precedence), `type-map.ts` (PII TYPE vocabulary), `config/defaults.ts` (`[pii]` table, off), `mcp/server.ts` (warm singleton, pass `{ner:true}`, `nerStatus` in tool output, clear on shutdown).
5. **Unchanged reuse** — `PlaceholderManager`, `audit/log`, 5-axis allowlist, all hook handlers (they never set `opts.ner`).

### Critical Pitfalls

1. **Loading the ONNX model in the per-event hook process** — fresh process per event ⇒ full model reload every prompt, 10–100× over budget. Avoid: NER runs ONLY in the warm MCP server; hook stays regex-PII only. (Phase 1, the cardinal sin.)
2. **`onnxruntime-node` native install failing / breaking zero-config `npx`** — glibc-linked, no WASM auto-fallback in Node; breaks on musl/Alpine/exotic arch. Avoid: ML deps as `optionalDependencies`; runtime guard + graceful "PII unavailable, secrets unaffected" degrade; CI install matrix (macOS arm64, glibc x64, **musl/Alpine**, win32). (Phase 1 + 2.)
3. **NER treated as a hard gate / false-negative-induced leaks** — recall drops on code/logs/non-Western names; misframing makes users stop self-censoring. Avoid: NER advisory (warn/audit) only; deterministic layers + `words.txt` remain the real guarantee; copy says "best-effort hint, not a guarantee." (Phase 1 semantics + Phase 3 eval/copy.)
4. **Unverified model download into a security tool's own process** — supply-chain attack vector; HF does no integrity check by default. Avoid: ship a pinned SHA-256 manifest, verify on load, refuse on mismatch; pin revision SHA; HTTPS-only; `optionalDependencies` isolation. (Phase 2.)
5. **Raw PII in audit log / error paths** — turns `.mrclean/audit.jsonl` into a plaintext PII DB in the repo. Avoid: hash-only audit entries `{entity_type, severity, token_hash, engine, model_rev, offset}`; scrub all error/exception paths; leak-grep regression test. (Phase 1 schema + Phase 4 hardening.)

Also material: FP flood shredding code/JSON (Phase 3 — default audit, confidence threshold, code-skip, structured-payload parseability tests); non-determinism breaking reproducible audit (Phase 1 — pin revision SHA + record quant/backend); warm-process memory growth from leaky onnxruntime sessions (Phase 2 — single reused session, tensor disposal, worker recycling + RSS watchdog); placeholder collisions / reversibility breakage (Phase 3 — single ordered substitution pass, exclude `<MRCLEAN:*>` ranges from NER input); scope creep into "a worse Presidio" (Phase 1 scope fence, enforced every transition).

## Implications for Roadmap

Architecture's "Suggested Build Order" and the pitfalls phase-mapping converge on a clean four-phase structure. Schema/contract foundations and the cardinal architecture decisions come first; the cheap regex lane ships independently before the heavy ML lane; security hardening closes the milestone.

### Phase 1: Foundations, Contracts & Architecture Decisions
**Rationale:** The load-bearing decisions (NER-off-the-hook, advisory-not-gate, optionalDependencies, audit schema, scope fence) must be locked before any model code exists — Pitfalls 1, 2, 4, 6, 8, 11 all anchor here. Schema additions unblock everything downstream and touch Plan-02-00-owned files (`findings.ts`, `type-map.ts`) that carry "revise plan first" warnings.
**Delivers:** `'pii-regex'`/`'pii-ner'` added to `Finding.source` + `SOURCE_PRECEDENCE`; PII TYPEs + rule-id mappings in `type-map.ts`; `MrcleanPiiConfig` in `shared/types.ts` + `defaults.ts` (off); audit schema fields (`engine`, `model_rev`, `quant`, `backend`, hash-only, extend no-raw rule to PII); ML deps declared as `optionalDependencies`; documented scope fence + advisory-gate semantics in acceptance criteria.
**Addresses:** opt-in/perf-exempt guardrail, finding-shape integration contract.
**Avoids:** Pitfall 1 (architecture placement), 2 (optionalDeps), 4 (advisory gate), 6 (audit schema/pin), 8 (hash-only schema), 11 (scope fence).

### Phase 2: Regex Structured-PII Lane (L6a) + Model Acquisition Infra
**Rationale:** Regex PII is high-value, low-cost, hot-path-safe with zero model dependency — ship it first as a standalone PII story. In parallel, build the model-acquisition/caching/integrity infra (pure infra, testable without inference) and warm-process memory management, since these gate the NER lane.
**Delivers:** `layer6-pii/regex.ts` + `luhn.ts` wired into `runDetection` after L4 (gated by `pii.regex.enabled`), validated within < 100/200 ms via `doctor/bench.ts`; `model-cache.ts` + `pipeline-singleton.ts` with lazy `import()`, `env.cacheDir = ~/.mrclean/models`, consented SHA-256-verified first-run download, fail-closed-for-NER, single-reused-session + tensor disposal + RSS watchdog/worker recycling; CI install matrix incl. musl/Alpine.
**Uses:** `validator`, hand-rolled regex pack, `@huggingface/transformers` cache/env API.
**Implements:** L6a hot-path lane; model cache + singleton plumbing components.
**Avoids:** Pitfall 2 (matrix CI + graceful degrade), 3 (cache-dir pinning, offline side-load, consented fetch), 7 (SHA manifest), 9 (memory management).

### Phase 3: NER Inference (L6b) + MCP Wiring + Detection Integration
**Rationale:** Depends on Phase 1 schema + Phase 2 infra. This is where the probabilistic detector meets the deterministic pipeline — the FP/overlap/reproducibility risks all land here.
**Delivers:** `ner.ts` + `entities.ts` (subword aggregation, per-entity confidence filter, default action audit/warn, code-shaped-token stop-list, code-content skip); gated behind `opts.ner && pii.ner.enabled`; MCP `check.ts`/`redact.ts` pass `{ner:true}`, warm singleton at boot/first call, `nerStatus` output, cleared on `shutdownMcpSupervisor` (verify MCP-03 read/transform-only invariant holds); unified single-ordered substitution pass with one allocator, NER excluded from `<MRCLEAN:*>` ranges; cross-machine reproducibility + structured-payload + mixed secret+PII round-trip tests.
**Addresses:** PERSON (+ ORG/LOC) NER, per-entity threshold/action.
**Avoids:** Pitfall 5 (defaults/thresholds/code-skip/parseability), 6 (cross-machine reproducibility), 10 (unified pipeline/overlap/round-trip).

### Phase 4: Security Hardening, Zero-Config UX & Honest Copy
**Rationale:** Final gate — close the security and trust surface a security tool is held to.
**Delivers:** leak-grep regression test (test PII absent from `audit.jsonl` + stderr incl. exception paths); reversible-mode PII map inherits secret-map rules (in-memory default, encrypted-at-rest + session-exit wipe if persisted); first-run progress UX + `mrclean pii fetch-model --from <path>` offline side-load + `allowRemoteModels=false`; `doctor/checks.ts` model-presence/cache check; README/copy ruthlessly framed "best-effort ML PII hint, not a guarantee."
**Avoids:** Pitfall 8 (leak-grep, error-path scrubbing), 4 (honest copy), 3 (offline/consent UX).

### Phase Ordering Rationale

- **Schema + decisions first** because `findings.ts`/`type-map.ts`/audit-schema/optionalDeps choices propagate everywhere and several are irreversible-cheaply (the cardinal NER-placement and advisory-gate calls).
- **Regex lane before NER lane** because the two are genuinely separable clusters: regex has zero model dependency, is hot-path-safe, and is independently shippable PII value — de-risking the milestone if NER slips.
- **Model infra (Phase 2) before inference (Phase 3)** because cache/integrity/memory plumbing is testable without the model and gates the NER lane.
- **Security hardening last** because it audits the fully-integrated surface (audit privacy, reversible map, offline) end-to-end.

### Research Flags

Phases likely needing deeper research / a spike during planning:
- **Phase 2 & 3 (NER model + inference):** `--research-phase` recommended. Open questions to resolve with a benchmark on target hardware: exact `onnxruntime-node` cold-load + warm-infer latency for `Xenova/bert-base-NER` int8 (macOS arm64 + Linux glibc); WASM-backend latency (decides whether musl gets NER or regex-only); whether int8 vs fp32 meaningfully degrades PER/ORG recall on code-style content. Architecture explicitly proposes folding this into Spike 002 (already queued from spike 001). Also confirm the `@huggingface/transformers` v4 `exports`/import paths against the live package.
- **Phase 3 (substitution integration):** overlap/precedence + reversible round-trip with mixed secret+PII content is novel territory for the v1 non-overlapping pipeline — warrants careful test design.

Phases with standard patterns (skip research-phase):
- **Phase 1:** schema/config additions follow established v1 patterns (`mergeConfigs`, `Finding` union, `TYPE_VOCABULARY`).
- **Phase 2 regex lane:** deterministic regex + `validator` + Luhn, DRY with the existing gitleaks engine — well-trodden.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions/sizes verified live against npm + Hugging Face blob API on 2026-06-01; transformers.js API confirmed via Context7. |
| Features | HIGH | Presidio entity split + detection-method split verified via official docs; transformers.js NER path verified via HF model card; integration constraints from mrclean's own PROJECT/REQUIREMENTS/spike 001. |
| Architecture | HIGH | Existing architecture read directly from source; transformers.js lifecycle/caching verified via Context7; the NER-off-the-hook decision is grounded in the Claude Code per-event-process contract. |
| Pitfalls | HIGH | Architectural/latency/supply-chain pitfalls confirmed against onnxruntime/transformers.js/claude-code issue trackers + the dslim/bert-base-NER model card. |

**Overall confidence:** HIGH

### Gaps to Address

- **Exact cold-load + warm-infer latency (and WASM-backend latency)** for `Xenova/bert-base-NER` int8 on target hardware — public ms figures are hardware-specific. Handle: benchmark in a Phase 2/3 spike to size the MCP warm-process budget and decide musl/exotic-platform NER posture.
- **int8 vs fp32 recall delta on mrclean-style content (code/logs/non-Western names)** — affects false-negative posture and the reproducibility variant choice. Handle: measure on a non-CoNLL corpus during Phase 3 eval; keep the quant variant recorded in the audit schema.
- **`@huggingface/transformers` v4 import-path / `exports` surface** — confirm during Phase 2 against the live package (does not change the recommendation, only import paths).
- **Entity-array config merge semantics** (`pii.*.entities`) — pin allowlist-concat vs scalar-last-wins; architecture recommends last-wins to allow project-level narrowing. Handle: decide in the Phase 1 config plan.

## Sources

### Primary (HIGH confidence)
- Context7 `/huggingface/transformers.js` — `token-classification` pipeline API, `env.cacheDir`/`allowRemoteModels`, `dtype: 'int8'` quantization, `progress_callback`, singleton ESM pattern, default cwd-relative cache footgun.
- `npm view @huggingface/transformers` / `@xenova/transformers` / `validator` / `redact-pii` (live, 2026-06-01) — versions, transitive pins (`onnxruntime-node@1.24.3`, `sharp@^0.34.5`), `@google-cloud/dlp` dep confirmation, Xenova frozen-since-2024.
- Hugging Face blob API (`?blobs=true`, live) — verified ONNX int8 sizes: `Xenova/bert-base-NER` 108.5 MB, `piiranha` 317.1 MB, `gliner_multi_pii` 349.1 MB.
- [dslim/bert-base-NER model card](https://huggingface.co/dslim/bert-base-NER) — CoNLL-2003 recall (PER ~0.98, ORG ~0.94, LOC ~0.97) + explicit domain-drift warning.
- [Microsoft Presidio — Supported PII Entities](https://microsoft.github.io/presidio/supported_entities/) — regex+context vs NER detection-method split, anonymize operators.
- [anthropics/claude-code#39391](https://github.com/anthropics/claude-code/issues/39391) (fresh process per hook event) + [#50270](https://github.com/anthropics/claude-code/issues/50270) (glibc-only native binary, no JS fallback).
- [microsoft/onnxruntime#26831/#25325/#22271](https://github.com/microsoft/onnxruntime/issues/26831) — Node binding memory leaks (Pitfall 9).
- [huggingface/huggingface_hub#2364](https://github.com/huggingface/huggingface_hub/issues/2364) — no default download integrity check (Pitfall 7).
- [huggingface/transformers.js#997](https://github.com/huggingface/transformers.js/issues/997) — cwd-relative cache path footgun (Pitfall 3).
- mrclean source (read directly): `src/detect/index.ts`, `findings.ts`, `type-map.ts`, `session-state.ts`, `config/defaults.ts`, `shared/types.ts`, `hook/handlers/user-prompt-submit.ts`, `hook/failclosed.ts`, `mcp/server.ts`.
- mrclean `PROJECT.md` / `REQUIREMENTS.md` / spike 001 (`vs-presidio`) — milestone guardrails, finding-shape contract (DET1-03), 5-axis allowlist (CFG-02), MCP read/transform-only (MCP-03), Presidio-deferred framing, structured-payload corruption lesson.

### Secondary (MEDIUM confidence)
- SitePoint "Optimizing Transformers.js for Production" + PkgPulse "Transformers.js vs ONNX Runtime Web 2026" — cold-load/inference latency ranges (hundreds of ms–seconds cold; ~110–220 ms warm).
- [arxiv 2505.01067](https://arxiv.org/pdf/2505.01067) (malicious model-repo configs) + [CVE-2026-1839](https://www.sentinelone.com/vulnerability-database/cve-2026-1839/) (HF Transformers RCE class) — supply-chain argument for ONNX-not-pickle + SHA verification.
- [redact-pii on npm](https://www.npmjs.com/package/redact-pii) — corroborates `@google-cloud/dlp` dependency.

### Tertiary (LOW confidence — measure in spike)
- Exact `onnxruntime-node` cold-load/warm-infer ms for the chosen model on target hardware; WASM-backend latency; int8-vs-fp32 recall delta — all hardware/corpus-specific, flagged for a Phase 2/3 benchmark spike.

---
*Research completed: 2026-06-01*
*Ready for roadmap: yes*
