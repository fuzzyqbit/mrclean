# Phase 6: NER Inference (L6b) + MCP Wiring - Pattern Map

**Mapped:** 2026-06-02
**Files analyzed:** 13 (5 new, 8 modified)
**Analogs found:** 13 / 13 (every new/modified file has a strong in-repo analog)

> Phase 6 is **integration, not invention**. Every sink (PlaceholderManager, audit, allowlist,
> dedup), the Finding contract, the TYPE vocabulary, the config interface, and the model-acquisition
> path already exist. New code = pipeline singleton, subword→span aggregation, label map, D-11 filter,
> and boot/`nerStatus` wiring. The analogs below are concrete; copy from them.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/detect/layer6b-ner.ts` (NEW) | service (detection layer engine) | transform (text→Finding[]) | `src/detect/layer6a-pii.ts` | exact (sibling layer) |
| `src/model/pipeline-singleton.ts` (NEW) | provider (warm singleton) | request-response (lazy load→pipeline) | `src/model/model-cache.ts` + `src/detect/index.ts` pool singleton | role-match (model lifecycle) |
| `src/detect/ner-entities.ts` (NEW) | utility (label map) | transform (model label→canonical TYPE) | `src/detect/type-map.ts` `RULE_ID_TO_TYPE` | exact (static map + lookup fn) |
| `src/detect/ner-overlap.ts` (NEW) | utility (span filter) | transform (Finding[]→Finding[]) | `src/detect/findings.ts` `dedupBySpan`/`spansOverlap` | role-match (span algebra) |
| `tests/detect/layer6b-ner.test.ts` (NEW) | test | — | `tests/detect/layer6a-pii.test.ts` | exact |
| `tests/model/pipeline-singleton.test.ts` (NEW) | test | — | `tests/model/model-cache.test.ts` | role-match |
| `src/detect/index.ts` (MODIFY) | controller (orchestrator) | request-response | self (L6a guarded-call block, lines 311-318/222-228) | exact (mirror L6a insertion) |
| `src/mcp/tools/check.ts` (MODIFY) | controller (MCP tool) | request-response | self + `redact.ts` | exact |
| `src/mcp/tools/redact.ts` (MODIFY) | controller (MCP tool) | request-response | self + `check.ts` | exact |
| `src/mcp/server.ts` (MODIFY) | config (boot wiring) | event-driven (boot) | self (lazy-import + getConfig closures) | exact |
| `src/audit/log.ts` (MODIFY — populate only) | model (audit record) | file-I/O | self (`findingToAuditRecord` provenance arg, lines 160-195) | exact (fields exist) |
| `src/model/constants.ts` (MODIFY — piiranha tier) | config (constants) | — | self (`MODEL_ID`/`URL`/`SHA`/`CACHE_PATH`) | exact |
| `src/config/defaults.ts` (MODIFY — `confidence` 0.9→0.7) | config | — | self (`pii.ner` block, lines 52-65) | exact |

**No-change-but-verify** (per RESEARCH — contracts already shipped in Phase 4):
`src/detect/findings.ts` (`SOURCE_PRECEDENCE` already ends `…pii-regex, pii-ner` — line 103, VERIFIED, do **not** re-add),
`src/detect/type-map.ts` (`pii:PERSON|ORG|LOC` → `PII_PERSON|PII_ORG|PII_LOC` already mapped — lines 208-210, VERIFIED).

---

## Pattern Assignments

### `src/detect/layer6b-ner.ts` (service, transform) — NEW

**Analog:** `src/detect/layer6a-pii.ts` (the sibling Layer 6a engine — mirror its shape exactly).

**Imports pattern** (`layer6a-pii.ts:28-31` — copy verbatim, add the pipeline + label-map imports):
```typescript
import type { Finding } from './findings.js'
import { redactedHash, fingerprint } from './findings.js'
import { isAllowlisted } from './allowlist.js'
import type { MrcleanPiiNerConfig, MrcleanConfig } from '../shared/types.js'
// NER-specific additions:
import { getNerPipeline, getNerBackend } from '../model/pipeline-singleton.js'
import { mapModelLabel } from './ner-entities.js'
```

**Finding-construction pattern** (`layer6a-pii.ts:204-216` — the canonical Finding builder to copy;
NER changes `source:'pii-ner'`, adds explicit `action:'substitute'` per D-02, and the values come
from aggregated spans instead of regex matches):
```typescript
const hash = redactedHash(value)
const fp = fingerprint(`pii:${entity}`, value)
const candidate: Finding = {
  ruleId: `pii:${entity}`,        // NER: `pii:${canonical}` where canonical ∈ PERSON|ORG|LOC
  severity,                        // NER: 'MEDIUM' (D-02 → substitute, never block)
  span: { start: spanStart, end: spanEnd },
  value,
  redactedHash: hash,
  fingerprint: fp,
  source: 'pii-regex',            // NER: 'pii-ner'
  action,                          // NER: explicit 'substitute' (do NOT rely on severity default)
}
```

**Allowlist + sort pattern** (`layer6a-pii.ts:218-226` — copy verbatim):
```typescript
// 5-axis allowlist check (identical to L1-L4; uses shared isAllowlisted)
if (isAllowlisted(candidate, config)) continue
findings.push(candidate)
// ...
return findings.sort((a, b) => a.span.start - b.span.start)
```

**NER-specific (no analog — new code, per RESEARCH Pattern 3 Route B):**
- Signature: `async runLayer6bNer(text, ner, config, coveredSpans?): Promise<{ findings: Finding[]; status: NerStatus }>`
- Two try/catch fail-closed boundaries (load + inference) — see Shared Pattern "Fail-closed-for-NER" below.
- `aggregateBio(rawTokens, text)`: stitch consecutive `B-`/`I-` WordPiece subwords → `{label,start,end,score}`; conservative per-entity score = **min** of subword scores.
- Gate: `if (s.score < ner.confidence) continue` (D-07/D-08 — field is `confidence`, NOT `min_score`).
- Filter: `if (!canonical || !ner.entities.includes(canonical)) continue` (D-09 per-entity toggle).
- `coveredSpans` overlap-skip protocol: reuse `layer6a-pii.ts:100-109` `overlapsCovered()` helper shape.

---

### `src/model/pipeline-singleton.ts` (provider, request-response) — NEW

**Analog A (cached-singleton lifecycle):** `src/detect/index.ts:111-122` (`pool`/`getOrCreatePool`) and
`136-154` (`getOrCreateManager` + `shutdownDetection` reset).

**Cached-singleton pattern** (`index.ts:111-122` — copy the lazy-init + reset shape):
```typescript
let pool: WorkerPool | null = null
export function getOrCreatePool(): WorkerPool {
  if (!pool) pool = new WorkerPool(4)
  return pool
}
// reset on shutdown (index.ts:148-154):
export async function shutdownDetection(): Promise<void> {
  if (pool) { await pool.terminate(); pool = null }
  cachedManagers.clear()
}
```
→ NER mirror: `let instance: Promise<NerPipeline> | null`; `getNerPipeline()` returns cached promise;
`resetNerSingleton()` sets `instance = null` (call from `shutdownMcpSupervisor`).

**Analog B (cache path + zero-ML-dep cold-path safety):** `src/model/constants.ts:51-52` (`MODEL_CACHE_PATH`)
and `src/model/model-cache.ts:14` ("imports ZERO ML deps"). The singleton is the **only** module that
breaks that rule, and only via dynamic `import()`.

**Lazy-import + `env.cacheDir` boundary** (NEW — RESEARCH Pattern 1, D-06/Pitfall 1/2). `env.cacheDir`
MUST be set BEFORE the `pipeline()` call:
```typescript
const { pipeline, env } = await import('@huggingface/transformers')  // ← only lazy import in repo
env.cacheDir = join(homedir(), '.mrclean', 'models')   // BEFORE any load; mirrors MODEL_CACHE_PATH base
env.allowRemoteModels = ner.allowDownload
return (await pipeline('token-classification', ner.model, { dtype: ner.dtype })) as unknown as NerPipeline
```
- `getNerBackend(): string` — captures `env.backends?.onnx ? 'onnxruntime-node' : 'unknown'` for the audit `backend` field (D-12).
- **Anti-pattern (enforce):** no static `@huggingface/transformers` import anywhere cold-path-reachable; the dynamic `import()` lives ONLY here (and the `await import('./layer6b-ner.js')` in `index.ts`).

---

### `src/detect/ner-entities.ts` (utility, transform) — NEW

**Analog:** `src/detect/type-map.ts:86-211` (`RULE_ID_TO_TYPE` frozen map) + `230-235` (`getTypeForRuleId` lookup fn).

**Static-map + lookup-fn pattern** (`type-map.ts` — copy the `Object.freeze` map + pure lookup shape):
```typescript
const RULE_ID_TO_TYPE: Readonly<Record<string, string>> = Object.freeze({ /* ... */ })
export function getTypeForRuleId(ruleId: string): string {
  if (ruleId.startsWith('word:')) return 'WORD'
  return RULE_ID_TO_TYPE[ruleId] ?? 'SECRET'
}
```
→ NER mirror: `mapModelLabel(model: string, label: string): 'PERSON'|'ORG'|'LOC'|null`.
- bert-base-NER: `B-PER/I-PER → PERSON`, `B-ORG/I-ORG → ORG`, `B-LOC/I-LOC → LOC`, `MISC/O → null`.
- piiranha (NER-04, RESEARCH Pitfall 6 — per-MODEL branch): `{GIVENNAME,SURNAME}→PERSON`, `{CITY,STREET,ZIPCODE,BUILDINGNUM}→LOC`, **no ORG** (piiranha has no ORG concept). Keep maps keyed by model id.

---

### `src/detect/ner-overlap.ts` (utility, transform) — NEW

**Analog:** `src/detect/findings.ts:116-118` (`spansOverlap`) and the `dedupBySpan` accumulator at `138-181`.

**Overlap primitive** (`findings.ts:116-118` — copy this exact predicate; D-11 is half-open `[start,end)`):
```typescript
function spansOverlap(a: Finding, b: Finding): boolean {
  return a.span.start < b.span.end && b.span.start < a.span.end
}
```

**D-11 filter** (NEW — RESEARCH Pattern 4. A SEPARATE pass; do **not** special-case a source inside
`dedupBySpan`, whose generic longest-span-wins is shared by L1–L6a and must stay pure):
```typescript
export function dropNerOverlaps(findings: Finding[]): Finding[] {
  const higher = findings.filter(f => f.source !== 'pii-ner')
  return findings.filter(f => {
    if (f.source !== 'pii-ner') return true
    return !higher.some(h => f.span.start < h.span.end && h.span.start < f.span.end)
  })
}
```
Wire in `index.ts` immediately before `dedupBySpan`: `const filtered = dropNerOverlaps(findings); const deduped = dedupBySpan(filtered)`.

---

### `src/detect/index.ts` (controller, orchestrator) — MODIFY

**Analog:** itself — the **L6a guarded-call block** is the exact template for the L6b block, in BOTH
`runDetection` (lines 311-318) and `runDetectionReadOnly` (lines 222-228).

**L6a insertion pattern to mirror** (`index.ts:315-318`):
```typescript
if (config.pii.enabled && config.pii.regex.enabled) {
  const l6a = runLayer6aPii(text, config.pii.regex, config, findings.map((f) => f.span))
  findings.push(...l6a)
}
```
→ L6b block (RESEARCH Pattern 2 — insert AFTER the L6a block, BEFORE the D-11 filter + `dedupBySpan`):
```typescript
// NEW interface: export interface DetectionOptions { ner?: boolean }
// runDetection / runDetectionReadOnly gain a trailing `opts: DetectionOptions = {}` arg.
let nerStatus: NerStatus = 'disabled'
if (opts.ner && config.pii.ner.enabled) {                 // hook handlers never set opts.ner
  const { runLayer6bNer } = await import('./layer6b-ner.js')   // lazy even here
  const out = await runLayer6bNer(text, config.pii.ner, config, findings.map(f => f.span))
  findings.push(...out.findings)
  nerStatus = out.status
}
// then:  const filtered = dropNerOverlaps(findings);  const deduped = dedupBySpan(filtered)
```

**Audit-write step to mirror** (`index.ts:372-376` — add the `provenance` 5th arg for `pii-ner` findings; see Shared Pattern "Audit provenance"):
```typescript
finalFindings.map((f) =>
  writeAuditRecord(ctx.cwd, findingToAuditRecord(f, ctx.sessionId, ctx.hookEvent, f.effectiveAction)),
)
```

**`DetectionResult` extension:** add `nerStatus?: NerStatus` to the return shape (`index.ts:96-105`),
return it from both functions. `runDetectionReadOnly` must apply the SAME L6b + D-11 block (it already mirrors `runDetection` exactly minus the audit step).

**Structural-unreachability proof (RESEARCH Pattern 2):** only `opts.ner` enters the L6b branch; the
dynamic `import('./layer6b-ner.js')` (which transitively imports the pipeline singleton) is the sole
path to `@huggingface/transformers`. Add an import-graph test asserting no hook-reachable module
statically imports `pipeline-singleton.ts`/`layer6b-ner.ts`, plus a perf-gate assertion (hook cold-start unchanged).

---

### `src/mcp/tools/check.ts` + `src/mcp/tools/redact.ts` (controller, MCP tool) — MODIFY

**Analog:** each other + themselves. Both already: build `ctx`, call detection via `supervisedToolCall`,
map findings to a `value`/`span`-free DTO, return `structuredContent`.

**Tool-call + DTO + structuredContent pattern** (`check.ts:101-128` — copy this exact shape; pass `{ ner: true }` as the new opts arg):
```typescript
const outcome = await supervisedToolCall(() =>
  runDetectionReadOnly(text, getConfig(), getSessionState(), ctx),  // redact.ts: runDetection
)
if (!outcome.ok) {
  return { content: [{ type: 'text' as const, text: `mrclean_check error: ${outcome.error}` }], isError: true }
}
const findings = outcome.result.findings.map(toFindingDTO)
const structured = { findings, count: findings.length }     // ADD: nerStatus: outcome.result.nerStatus
return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured }
```

**DTO no-leak guard** (`check.ts:44-50` / `redact.ts:38-44` — `findingSchema` already omits `value`/`span`;
keep it that way for NER, RESEARCH Pitfall 5). Add to the `outputSchema`:
```typescript
nerStatus: z.enum(['ready', 'unavailable', 'loading', 'disabled'])   // discretion D — shape chosen here
```

**Fail-closed note (RESEARCH Pattern 5):** the NER try/catch lives INSIDE `runLayer6bNer`, NOT in
`supervisedToolCall` — `supervisedToolCall` would convert a throw into `isError:true` for the WHOLE
tool, wrongly failing the secret gate. The tools pass `{ner:true}` and surface `nerStatus`; they never
catch NER errors themselves.

---

### `src/mcp/server.ts` (config, boot wiring) — MODIFY

**Analog:** itself — the existing lazy-import + `getConfig`/`getSessionState`/`getCwd` closure + tool
registration block (lines 27-60).

**Lazy-import + closure pattern** (`server.ts:51-59` — thread a `getNerStatus` closure into the two tools the same way `getConfig` is threaded):
```typescript
const { registerCheckTool } = await import('./tools/check.js')
const { registerRedactTool } = await import('./tools/redact.js')
registerCheckTool(server, getConfig, getSessionState, getCwd)   // add getNerStatus arg
registerRedactTool(server, getConfig, getSessionState, getCwd)  // add getNerStatus arg
```

**Eager preload (NEW — RESEARCH Pattern 5 / Pitfall 8, D-04/D-05).** Fire-and-forget so it NEVER blocks
`server.connect()`; flip `nerStatus` `loading→ready|unavailable`; secret tools register/connect immediately:
```typescript
let nerStatus: NerStatus = config.pii.ner.enabled ? 'loading' : 'disabled'
const getNerStatus = () => nerStatus
if (config.pii.ner.enabled) {
  void (async () => {
    try {
      const { getNerPipeline } = await import('../model/pipeline-singleton.js')
      await getNerPipeline(config.pii.ner); nerStatus = 'ready'
    } catch (err) {
      nerStatus = 'unavailable'   // D-05: server STILL serves secrets
      process.stderr.write(`mrclean-mcp: NER unavailable; serving secrets only\n`)  // NO matched text (Pitfall 5)
    }
  })()
}
```

**Shutdown reset (optional, `lifecycle.ts`/`supervisor.ts` path):** call `resetNerSingleton()` inside the
existing `shutdownMcpSupervisor()` chain (`server.ts:71-75`) — mirror how `shutdownDetection()` is invoked there.

---

### `src/audit/log.ts` (model) — MODIFY (populate only; schema already shipped)

**Analog:** itself — `findingToAuditRecord` already accepts the `provenance` arg and destructure-picks the
four fields (lines 160-195). **No schema change.** NER just passes the arg.

**Provenance population pattern** (the LOCKED no-raw destructure-pick at `log.ts:182-193` — do NOT
blind-spread; this is the only no-PII sink point):
```typescript
...(provenance !== undefined
  ? { engine: provenance.engine, model_rev: provenance.model_rev, quant: provenance.quant, backend: provenance.backend }
  : {}),
```
→ caller (in `index.ts` audit step, RESEARCH E5), for `f.source === 'pii-ner'` only:
```typescript
const provenance = f.source === 'pii-ner'
  ? { engine: `pii-ner@${PINNED_MODEL_SHA256.slice(0,12)}`, model_rev: PINNED_MODEL_SHA256,
      quant: config.pii.ner.dtype, backend: getNerBackend() }
  : undefined
```

---

### `src/model/constants.ts` (config) — MODIFY (piiranha tier, NER-04)

**Analog:** itself — the existing `MODEL_ID` / `MODEL_DOWNLOAD_URL` / `PINNED_MODEL_SHA256` / `MODEL_CACHE_PATH(homeDir)` quartet (lines 20-52). Add a parallel piiranha quartet.

**Constant quartet pattern** (`constants.ts:20-52` — copy the shape; piiranha needs its OWN pinned SHA
computed in a Wave-0 task, and its label set has NO ORG — see `ner-entities.ts` + RESEARCH Pitfall 6/7 license gate):
```typescript
export const MODEL_ID = 'Xenova/bert-base-NER'
export const MODEL_DOWNLOAD_URL = 'https://huggingface.co/.../onnx/model_int8.onnx'
export const PINNED_MODEL_SHA256 = '7de0a460...'
export const MODEL_CACHE_PATH = (homeDir: string): string => join(homeDir, '.mrclean', 'models', 'Xenova', 'bert-base-NER', 'onnx', 'model_int8.onnx')
```

---

### `src/config/defaults.ts` (config) — MODIFY (`confidence` 0.9 → 0.7)

**Analog:** itself — the `pii.ner` `Object.freeze` block (lines 52-65). Change ONE value: `confidence: 0.9` → `0.7`
(RESEARCH Pitfall 3 / A4 — keep the field NAME `confidence`; `min_score` in CONTEXT ≡ `pii.ner.confidence` in config; renaming churns `shared/types.ts` + tests). Wave-0 task in 06-01.

---

### `tests/detect/layer6b-ner.test.ts` + `tests/model/pipeline-singleton.test.ts` (test) — NEW

**Analog A:** `tests/detect/layer6a-pii.test.ts` (the sibling engine test — `makeConfig` helper at lines
31-44, AAA structure, per-behavior `it()` cases).

**Config-builder + import pattern** (`layer6a-pii.test.ts:20-44` — copy the `makeConfig` helper, swap `regex`→`ner`):
```typescript
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'
function makeConfig(overrides = {}) {
  return { ...DEFAULT_CONFIG, pii: { ...DEFAULT_CONFIG.pii, enabled: true,
    ner: { ...DEFAULT_CONFIG.pii.ner, enabled: true } }, ...overrides }
}
```

**Mocked-pipeline pattern (NEW — RESEARCH E3/E4; CI must never download the 108 MB model):**
```typescript
vi.mock('../../src/model/pipeline-singleton.js', () => ({
  getNerPipeline: vi.fn(async () => async (_t: string) => ([
    { entity: 'B-PER', score: 0.99, index: 1, word: 'Ada',  start: 0, end: 3 },
    { entity: 'B-ORG', score: 0.55, index: 4, word: 'Acme', start: 12, end: 16 }, // < 0.7 → dropped
  ])),
  getNerBackend: () => 'onnxruntime-node',
  resetNerSingleton: vi.fn(),
}))
```
Fail-closed case (RESEARCH E4): mock `getNerPipeline` to throw → assert `{ findings: [], status: 'unavailable' }`, no throw.

**Analog B:** `tests/model/model-cache.test.ts` (injectable-impl + temp-dir style for the singleton's cache-path/reset behavior).

---

## Shared Patterns

### Fail-closed-for-NER (NER-03)
**Source:** new pattern, but it composes existing primitives. RESEARCH Pattern 5 / Pitfall 1.
**Apply to:** `layer6b-ner.ts` (per-call), `server.ts` (boot preload).
The catch lives INSIDE `runLayer6bNer` (two boundaries: model load + inference), NOT in `supervisedToolCall`
(which would fail the whole tool incl. secrets). Boot preload catches independently (D-05).
```typescript
let pipe
try { pipe = await getNerPipeline(ner) } catch { return { findings: [], status: 'unavailable' } }
let raw
try { raw = (await pipe(text)) as RawToken[] } catch { return { findings: [], status: 'unavailable' } }
```

### Allowlist (5-axis)
**Source:** `src/detect/allowlist.ts:31` — `export function isAllowlisted(finding: Finding, config: MrcleanConfig): boolean`.
**Apply to:** `layer6b-ner.ts` (every candidate, before `findings.push`). Identical call site to `layer6a-pii.ts:219`.

### Finding hashing (no-raw)
**Source:** `src/detect/findings.ts:74-84` — `redactedHash(value)` (16-hex) + `fingerprint(ruleId, value)`.
**Apply to:** every NER Finding. NEVER log/return `value`; only `redactedHash`/`fingerprint` reach audit/DTO (Pitfall 5).

### Audit provenance (MODEL-04 / D-12)
**Source:** `src/audit/log.ts:160-195` — `findingToAuditRecord(f, sessionId, hookEvent, action, provenance?)`,
LOCKED destructure-pick (lines 182-193). Schema fields `engine/model_rev/quant/backend` already present (lines 68-75).
**Apply to:** the `index.ts` audit-write step, `pii-ner` findings only. Provenance carries model-identity ONLY — never matched text.

### Supervised tool isolation
**Source:** `src/mcp/supervisor.ts:49-62` — `supervisedToolCall(fn)` → `{ ok, result } | { ok: false, error }`.
**Apply to:** `check.ts`/`redact.ts` (unchanged usage). Note the fail-closed exception above: NER errors are caught BELOW this layer.

### Cached-singleton + reset-on-shutdown
**Source:** `src/detect/index.ts:111-154` (pool/manager lazy-init + `shutdownDetection` reset);
`src/mcp/server.ts:71-75` (the single `shutdownMcpSupervisor()` chain).
**Apply to:** `pipeline-singleton.ts` (`instance`/`getNerPipeline`/`resetNerSingleton`), reset wired into shutdown.

### Lazy-import cold-path boundary
**Source:** `src/mcp/server.ts:28-29,53-55` (lazy SDK + tool imports) and `model-cache.ts:14` (zero-ML-dep rule).
**Apply to:** `pipeline-singleton.ts` (the ONLY `import('@huggingface/transformers')`) + the `await import('./layer6b-ner.js')` gate in `index.ts`. Keep heavy deps off 100% of users' hook cold path (Anti-Pattern 2).

---

## No Analog Found

None. Every file has a strong in-repo analog. The genuinely *new* logic (subword→span BIO aggregation,
the `env.cacheDir`-before-`pipeline()` lazy boundary, per-model label maps, the D-11 drop pass, and the
fire-and-forget boot preload) has no direct codebase precedent and must follow **RESEARCH Patterns 1–5**
(`06-RESEARCH.md` §Architecture Patterns) rather than a copied analog — but each plugs into an existing seam.

## Metadata

**Analog search scope:** `src/detect/`, `src/model/`, `src/mcp/`, `src/audit/`, `src/config/`, `src/shared/`, `tests/detect/`, `tests/model/`, `tests/mcp/`
**Files scanned:** 14 source + 3 test analogs read in full
**Pattern extraction date:** 2026-06-02
