# Phase 6: NER Inference (L6b) + MCP Wiring - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver opt-in open-class NER (PERSON, ORG, LOCATION) as Layer 6b, running ONLY as a
lazy/eager warm singleton inside the long-lived MCP server — structurally unreachable from
the per-event hook hot path. NER findings are advisory in the sense that they NEVER hard-block
a request (the deterministic secret layers + checksum'd PII remain the only default deny gate),
but they DO substitute into redacted output. NER fails closed: a model load/inference failure
degrades detection to Layers 1–4 + regex-PII and reports NER unavailable, never crashing the
secret-detection gate. Every PII audit entry records model_rev/quant/backend (no raw PII value).
A higher-recall piiranha (~317 MB) model tier is selectable via config in place of the default
~108 MB `Xenova/bert-base-NER` int8.

Requirements: NER-01, NER-02, NER-03, NER-04, MODEL-04 (5).

**Out of scope (other phases / locked fences):** no cloud PII APIs; no model-facing unredact
tool; no Presidio Python sidecar; PII placeholder reversibility (one-way only this milestone);
the leak-grep / honest-framing hardening (Phase 7).
</domain>

<decisions>
## Implementation Decisions

### Redact behavior (NER-01, NER-02)
- **D-01:** `mcp__mrclean__redact` **SUBSTITUTES** detected PERSON/ORG/LOCATION with
  `<MRCLEAN:PII_PERSON|PII_ORG|PII_LOCATION:NNN>` placeholders in its returned text — NER
  entities round-trip through the existing `PlaceholderManager` exactly like secrets and
  regex-PII, with the single ordered substitution pass and one allocator. Substitution is
  **one-way** (no restore this milestone — ties to the deferred REVMODE backlog).
- **D-02:** NER **never denies/blocks** a request. "Advisory by default" = substitute-and-allow,
  not deny. The hard deny gate stays deterministic-only (secrets + checksum'd PII like SSN/CC).
  In `effectiveAction` terms: NER findings resolve to `substitute`, never `block`.
- **D-03:** NER findings are reported on BOTH `mcp__mrclean__check` (advisory metadata: counts/
  spans/scores, no raw value) and `mcp__mrclean__redact` (substituted text + finding metadata).

### Warm singleton lifecycle (NER-01, NER-03)
- **D-04:** **Eager preload at MCP server startup** when `pii.ner.enabled = true` — the
  ~108 MB model loads into the warm singleton on server boot so the first `check`/`redact`
  call is already warm. The cost is one-time per long-lived server process (NOT per hook event).
- **D-05:** Eager load is **fail-closed for NER only**: if the model fails to load at boot
  (missing/corrupt model, offline, native build failure), the MCP server STILL starts and
  serves secret detection; NER reports `nerStatus: "unavailable"` and detection degrades to
  Layers 1–4 + regex-PII. The server must never crash or refuse to start because NER failed.
- **D-06:** The singleton loads via the Phase 5 `model-cache.ts` path (SHA-256-verified cache
  at `~/.mrclean/models/`). CRITICAL (Phase 5 RESEARCH Pitfall 1): `@huggingface/transformers`
  v4's default `env.cacheDir` is cwd-relative `./.cache` — it MUST be overridden to the stable
  `~/.mrclean/models/` path before any pipeline/model call.

### Confidence threshold + default entities (NER-02)
- **D-07:** Default `min_score = 0.7` (per-entity confidence floor), tunable via config.
  Rationale: because entities above the floor now get SUBSTITUTED (not just flagged), 0.7
  balances scrubbing real names against false-positive redactions of innocent words.
- **D-08:** Entities below `min_score` are dropped entirely (not substituted, not surfaced
  as findings) — a single floor governs both substitution and advisory reporting.
- **D-09:** All three classes **PERSON, ORG, LOCATION on by default** when `pii.ner.enabled`.
  Each is independently toggleable via the `pii.ner.entities` array using last-wins merge
  semantics (consistent with the Phase 4 `pii.*.entities` decision).

### Overlap precedence (NER-01)
- **D-10:** Append `pii-regex > pii-ner` to the tail of `SOURCE_PRECEDENCE` in
  `src/detect/findings.ts` (pii-ner is the LOWEST-precedence source). `dedupBySpan` keeps its
  existing rule: longest-span-wins, then source-order.
- **D-11:** **NER overlap override:** a `pii-ner` finding that overlaps a higher-precedence
  span (any secret, regex-PII, or already-resolved span) at all is **DROPPED ENTIRELY** —
  regardless of length. NER does NOT win a region via longest-span-wins against a deterministic
  source. No partial substitution, no fragmented placeholders. This realizes the locked
  "NER excluded from `<MRCLEAN:*>` ranges" / single-ordered-pass invariant. (This is a
  deliberate exception to pure longest-span-wins, scoped to the pii-ner source only.)

### Audit reproducibility (MODEL-04)
- **D-12:** Every NER (pii-ner) audit entry populates `engine` (e.g. `pii-ner@<model-sha>`),
  `model_rev`, `quant`, and `backend` (`onnxruntime-node` vs `wasm`) via the existing
  `findingToAuditRecord` builder — no raw PII value (hash/fingerprint only), extending the
  existing AUDIT no-raw-value guarantee. The audit schema already carries these fields
  (Phase 4 contract, `src/audit/log.ts`).

### Model tier (NER-04)
- **D-13:** Default model `Xenova/bert-base-NER` int8 (~108 MB); optional piiranha (~317 MB)
  tier selectable via `pii.ner.model` config, swapped in place of the default. (Locked scope
  fence — no other tiers.)

### Claude's Discretion
- Exact mechanism for threading the NER opt-in into detection (e.g. an `ner` flag on
  `DetectionContext`/opts that only the MCP tools set, vs a new param) — planner/researcher
  decides, provided the hook path can NEVER reach L6b.
- `nerStatus` response shape and where it surfaces in the check/redact structuredContent.
- Whether eager preload awaits load before serving, or loads async and reports
  `nerStatus: "loading"` until ready (must not block secret detection either way).
- Tokenizer/aggregation strategy for subword → entity span reconstruction (transformers.js
  pipeline detail).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v2.0 PII/NER architecture & build order
- `.planning/research/ARCHITECTURE-v2-pii.md` — the v2 PII/NER architecture: two-lane Layer 6
  (L6a regex hot-path / L6b NER MCP-only), warm-singleton model, overlap handling, audit
  schema rationale, the cardinal "NER never in the hook" decision.

### Model acquisition & transformers.js v4 (Phase 5 research — load path NER builds on)
- `.planning/phases/05-regex-pii-hot-path-lane-l6a-model-acquisition/05-RESEARCH.md` —
  transformers.js v4 import paths, `env.cacheDir` override (Pitfall 1, highest-risk), warm
  singleton pattern (Pattern 3 / E3 / E4), `ModelRegistry.is_pipeline_cached()`, WASM-vs-
  onnxruntime-node backend latency, int8-vs-fp32 recall on code-style content.

### Implementation surfaces (existing code NER wires into)
- `src/model/model-cache.ts` + `src/model/constants.ts` — Phase 5 SHA-256-verified model
  load path + `MODEL_CACHE_PATH`; the singleton MUST load through this, never re-download.
- `src/detect/index.ts` — `runDetection` / `runDetectionReadOnly`; L6b wires in after L6a,
  before `dedupBySpan`, behind an MCP-only NER opt-in (hook path must stay unreachable).
- `src/detect/findings.ts` — `Finding` shape, `SOURCE_PRECEDENCE` (append `pii-ner` at tail),
  `dedupBySpan`, `fingerprint`/`redactedHash`. **Owned by Plan 02-00** — revise the owning
  plan first if its single-source-of-truth modules change.
- `src/detect/type-map.ts` — `getTypeForRuleId`; add `PII_PERSON`/`PII_ORG`/`PII_LOCATION`
  TYPE mappings for `pii:person|org|location` rule IDs. **Owned by Plan 02-00.**
- `src/audit/log.ts` — `AuditRecord` (already has `engine`/`model_rev`/`quant`/`backend`) +
  `findingToAuditRecord` (the ONLY no-raw-value sink point).
- `src/mcp/tools/check.ts` + `src/mcp/tools/redact.ts` — the two tools that expose NER; both
  call detection via the supervisor. `redact.ts` substitutes; `check.ts` is read-only/advisory.
- `src/mcp/server.ts` + `src/mcp/lifecycle.ts` — MCP server boot; eager-preload hook lives here.

### Requirements
- `.planning/REQUIREMENTS.md` §NER-01..04, §MODEL-04 — the 5 phase requirements verbatim.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PlaceholderManager` (session-scoped, global counter, stable per session) — NER substitution
  reuses it unchanged; zero new sink code (the Phase 4 PII contract).
- `findingToAuditRecord` + `AuditRecord` — already carries `engine`/`model_rev`/`quant`/`backend`;
  NER just populates them.
- `model-cache.ts` (`isModelCached`, `verifyModelIntegrity`, `downloadModel`, `sideLoadModel`)
  and `checkModelCache` doctor check — built and tested in Phase 5; the singleton consumes them.
- `dedupBySpan` + `SOURCE_PRECEDENCE` + `isAllowlisted` (shared, Phase 5) — NER findings flow
  through the same dedup, precedence, and 5-axis allowlist machinery.

### Established Patterns
- Layer functions append findings then `dedupBySpan` resolves overlaps; L6b mirrors L6a's
  insertion point but gated by an MCP-only opt-in instead of `pii.enabled`.
- MCP tools call detection through `supervisedToolCall` (Promise isolation, MCP-04 ReDoS/crash
  safety) — NER inference errors must be caught here and surfaced as `nerStatus`, never thrown.
- `effectiveAction` resolution: HIGH→block, MEDIUM→substitute, LOW→audit. NER entities want
  `substitute` (not block) → severity MEDIUM (or explicit action), consistent with D-02.

### Integration Points
- New: `src/detect/layer6b-ner.ts` (NER engine) + a pipeline/warm-singleton module
  (e.g. `src/model/pipeline-singleton.ts`) loaded only from MCP server init.
- `runDetection`/`runDetectionReadOnly` gain an MCP-only NER opt-in; the hook entrypoint never
  sets it (verify: no pipeline import reachable from the hook path; hook cold-start unchanged).
</code_context>

<specifics>
## Specific Ideas

- The substitution-vs-advisory tension was resolved deliberately: NER substitutes (scrubs names
  from the wire) but never denies — so it strengthens privacy without turning best-effort ML
  into a hard gate. Phase 7 must frame this honestly (recall is best-effort; false negatives
  can still leak).
- `min_score = 0.7` and all-three-entities are STARTING defaults chosen with substitution in
  mind; both are config-tunable, so they can be revisited empirically after Phase 6 lands.
</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Reversible PII placeholders, cloud PII APIs,
unredact tool, Presidio sidecar, and additional model tiers remain explicitly out of scope.)
</deferred>

---

*Phase: 6-NER Inference (L6b) + MCP Wiring*
*Context gathered: 2026-06-02*
