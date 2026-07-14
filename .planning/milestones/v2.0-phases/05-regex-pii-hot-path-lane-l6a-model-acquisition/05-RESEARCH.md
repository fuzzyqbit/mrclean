# Phase 5: Regex PII Hot-Path Lane (L6a) + Model Acquisition - Research

**Researched:** 2026-06-02
**Domain:** PII regex detection (hot-path, pure-JS) + model download/cache/integrity infrastructure
**Confidence:** HIGH (L6a stack), HIGH (model infra with one verified caveat noted below)

---

## Summary

Phase 5 has two entirely independent workstreams that MUST be planned as separate plans because they have different risk profiles and zero shared code.

**Workstream 1 — L6a regex PII lane (PII-01, PII-02):** A pure-JS synchronous layer inserted after Layer 4 in the existing detection pipeline. Catches email, US SSN, credit card (with Luhn checksum), US phone, IPv4/IPv6. Five regex patterns + Luhn validation. All output flows through the existing `PlaceholderManager`, audit log, and 5-axis allowlist — ZERO new sink code. The `Finding` shape, `SOURCE_PRECEDENCE` tail, `PII_*` TYPE vocabulary, config sub-table, and action defaults are fully contractualized in Phase 4; this phase only adds the detector that emits findings with those values. Current v1 hot-path headroom is massive: p95 is 17.4ms for `UserPromptSubmit` against a 100ms budget, meaning PII regex can consume up to ~80ms before a budget breach — this is comfortable for 5 compiled patterns on hot text. The primary perf concern is keeping the patterns off the hot path entirely when `config.pii.enabled === false` (the default), which is a single boolean guard.

**Workstream 2 — Model acquisition infra (MODEL-02, MODEL-03):** Pure infrastructure, NOT hot-path. Downloads `Xenova/bert-base-NER` `model_int8.onnx` (108 MB) to `~/.mrclean/models/` on first opt-in. SHA-256-pinned and verified on load. Supports offline/air-gapped side-load. The `npx` cold path with PII disabled never touches network or ML deps. Verifiable via `mrclean doctor`. Critically, `@huggingface/transformers` v4's default `env.cacheDir` is `./.cache` (cwd-relative) — this MUST be overridden to `~/.mrclean/models/` before any download call; failing to do so is the single highest-risk implementation pitfall. No inference in this phase; Phase 6 wires NER inference.

**Primary recommendation:** Plan 05-01 = L6a regex engine (`src/detect/layer6a-pii.ts`) + orchestrator wiring; Plan 05-02 = model acquisition module (`src/model/model-cache.ts`) + doctor checks.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| PII regex detection | API/Backend (hook process) | — | Runs in the per-event hook process like all other sync layers (L2/L3/L4). Must stay below 100/200ms hot-path budgets. |
| PII config gate (`pii.enabled`) | API/Backend (orchestrator) | — | Single boolean guard in `runDetection`/`runDetectionReadOnly` before calling `runLayer6aPii`. Checked before layer runs. |
| Model download + cache | API/Backend (lazy init) | — | Network call happens exactly once, in the MCP server's warm-up path. Never in hook process. |
| SHA-256 integrity check | API/Backend (model-cache.ts) | — | Runs on load in `model-cache.ts`. `node:crypto` createHash. No external dep. |
| Doctor model check | API/Backend (doctor/checks.ts) | — | New `checkModelCache` function added to existing doctor pattern. Returns CheckResult. |
| Layer 6a → existing sinks | API/Backend (detect/index.ts) | — | `runDetection` calls `runLayer6aPii` after L4, before `dedupBySpan`. Same sink path (PlaceholderManager, audit log, allowlist) as L1–L4. |

---

## Standard Stack

### Core (Phase 5 adds no new packages)

All packages are already in `package.json`. Phase 5 uses only stdlib and existing deps.

| Library | Version (installed) | Purpose | Notes |
|---------|---------------------|---------|-------|
| `node:crypto` | built-in (Node ≥20.18) | SHA-256 model integrity | `createHash('sha256')` stream over file chunks. No dep. |
| `node:fs/promises` | built-in | File existence checks, model download writes | Already used throughout `src/`. |
| `node:path` + `node:os` | built-in | Resolve `~/.mrclean/models/` canonical path | `join(homedir(), '.mrclean', 'models')`. |
| `node:https` / `node:stream` | built-in | Download stream (alternative: `fetch` via `node:https`) | Node 20 `fetch` global is stable; prefer `fetch` with `for await` streaming for simpler code. |

### Supporting (already declared as optionalDependencies in Phase 4-03)

| Library | Version (declared) | Registry version | Purpose | Notes |
|---------|-------------------|-----------------|---------|-------|
| `@huggingface/transformers` | `^4.2.0` | `4.2.0` (latest) | `env.cacheDir` config + future Phase 6 pipeline | Phase 5 only configures the cache dir; the actual import is still lazy. |
| `onnxruntime-node` | `^1.24.3` | `1.26.0` (latest) | Native ONNX backend for Phase 6 NER | Phase 5 does NOT import this; model acquisition uses direct HTTP download. |

### No new packages required

The package legitimacy audit is a pass-through: both ML deps were declared in Phase 4-03 and verified at that time. Phase 5 adds zero new dependencies.

**Version note:** `onnxruntime-node` installed latest is `1.26.0`, ahead of declared `^1.24.3` — this is within the `^` range and compatible.

---

## Package Legitimacy Audit

No new packages are introduced in Phase 5. Both ML packages were reviewed in Phase 4-03.

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| `@huggingface/transformers` | npm | ~2 yrs (2024-08-08) | github.com/huggingface/transformers.js | N/A (Phase 4 reviewed) | Approved (Phase 4-03) |
| `onnxruntime-node` | npm | ~5 yrs (2021-05-01) | github.com/Microsoft/onnxruntime | N/A (Phase 4 reviewed) | Approved (Phase 4-03) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Hook event payload
        |
        v
  [runDetection / runDetectionReadOnly]  (src/detect/index.ts)
        |
        +--> Layer 1 (secretlint + gitleaks) -- async
        +--> Layer 2 (entropy) -- sync
        +--> Layer 3 (env blocklist) -- sync
        +--> Layer 4 (words) -- sync
        |
        +-- NEW: config.pii.enabled guard --+
        |                                   |
        |  false (default)                  | true
        |  [skip L6a]                       v
        |                      [runLayer6aPii(text, config.pii, coveredSpans)]
        |                             |
        |                       5 compiled patterns:
        |                         email, SSN, credit_card (+ Luhn), phone, ip
        |                             |
        |                       isShapeAllowlisted() for each candidate
        |                             |
        |                       config.pii.regex.entities filter
        |                             |
        |                       5-axis allowlist via isAllowlisted()
        |                             |
        +<--------------------------findings[]
        |
        v
  dedupBySpan (pii-regex tail — lowest priority after L1-L4)
        |
        v
  PlaceholderManager.allocate() [EXISTING — no changes]
        |
        v
  writeAuditRecord (with engine='pii-regex' provenance) [EXISTING findingToAuditRecord]
        |
        v
  Hook response / substitutedText


MODEL ACQUISITION (NOT hot path — separate module):

  First opt-in to NER (Phase 6) or mrclean doctor --check-model
        |
        v
  [src/model/model-cache.ts] checkModelCache(homeDir)
        |
        +-- model exists at ~/.mrclean/models/Xenova/bert-base-NER/onnx/model_int8.onnx?
        |       |
        |    no | yes
        |       |      +-- verify SHA-256 against PINNED_HASH constant
        |       v      |          |
        |  downloadModel()    match? | mismatch?
        |  (fetch stream to       |        |
        |   tmp file, verify     PASS    integrity error
        |   hash, atomic rename)
        |
        v
  doctor check: checkModelCache(homeDir) --> CheckResult
```

### Recommended Project Structure

```
src/
├── detect/
│   ├── layer6a-pii.ts          # NEW: L6a regex PII engine (PII-01, PII-02)
│   ├── index.ts                # MODIFY: wire L6a after L4 behind pii.enabled guard
│   ├── [existing files unchanged]
├── model/                      # NEW directory
│   ├── model-cache.ts          # NEW: download / verify / status (MODEL-02, MODEL-03)
│   └── constants.ts            # NEW: PINNED_SHA256, MODEL_ID, CACHE_SUBPATH
├── doctor/
│   ├── checks.ts               # MODIFY: add checkModelCache check function
│   └── [existing files unchanged]
tests/
├── detect/
│   ├── layer6a-pii.test.ts     # NEW: unit tests for regex engine
│   └── orchestrator-pii.test.ts # NEW or modify orchestrator.test.ts
├── model/
│   ├── model-cache.test.ts     # NEW: unit tests for cache/verify (mocked download)
└── doctor/
    └── checks-model.test.ts    # NEW or extend checks.test.ts
```

### Pattern 1: L6a Engine Module (mirrors L2/L3/L4 pattern)

The existing sync layers (L2, L3, L4) share a uniform signature: `runLayerN(text, ...configArgs, coveredSpans): Finding[]`. L6a follows the same pattern — synchronous, returns `Finding[]`, never async.

```typescript
// Source: mirrors src/detect/layer2-entropy.ts pattern (verified codebase)

// Module-level compiled patterns (PERF-03: compiled once at startup)
const COMPILED_PATTERNS: ReadonlyMap<string, RegExp> = new Map([
  ['email', /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g],
  ['ssn',   /\b(?!000|666|9\d{2})\d{3}[- \s]\d{2}[- \s](?!0{4})\d{4}\b/g],
  // credit_card: broad digit+separator match; post-filter with Luhn
  ['credit_card', /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})\b/g],
  ['phone', /\b(?:\+1[-.\s]?)?\(?[2-9][0-9]{2}\)?[-.\s]?[2-9][0-9]{2}[-.\s]?[0-9]{4}\b/g],
  ['ip',    /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g],
])

export function runLayer6aPii(
  text: string,
  piiConfig: MrcleanPiiRegexConfig,
  coveredSpans: readonly { start: number; end: number }[] = [],
): Finding[] {
  // early return when disabled (called by orchestrator only when enabled=true, but defensive)
  if (!piiConfig.enabled) return []
  // ... iterate only piiConfig.entities, skip covered spans, apply Luhn for credit_card
}
```

**Critical PERF-03 note:** All 5 RegExp objects MUST be compiled at module load (constant), not inside the function body. The `lastIndex` reset issue with global `/g` patterns requires either `re.exec()` in a loop (each call re-uses the compiled instance) or creating a new `RegExp(source, 'g')` per text invocation — use a fresh RegExp per call from source strings, or use `matchAll()` which is safe. See Pitfall 4 below.

### Pattern 2: Luhn Validation (inline, no dep)

```typescript
// Source: well-known algorithm, inline per CLAUDE.md pattern (verified codebase: shannon entropy inline)
// Normalize: strip spaces/dashes, digits only
export function luhnCheck(raw: string): boolean {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i]!, 10)
    if (alt) { d *= 2; if (d > 9) d -= 9 }
    sum += d
    alt = !alt
  }
  return sum % 10 === 0
}
```

### Pattern 3: Model Cache Module

```typescript
// Source: @huggingface/transformers v4 env docs (VERIFIED: docs.huggingface.co/transformers.js/api/env)
// + node:crypto + node:fs/promises (built-in, verified Node 20)

import { createHash } from 'node:crypto'
import { createWriteStream, rename, unlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Pinned content hash for Xenova/bert-base-NER onnx/model_int8.onnx
// MUST be established from the actual downloaded file on first use and locked into a constant.
// [ASSUMED] — actual SHA-256 must be computed from the live HuggingFace Hub file
// by the plan (download, hash, verify, commit hash as constant).
// Revision: Xenova/bert-base-NER main branch as of research date.
export const PINNED_MODEL_SHA256 = '[ASSUMED — compute during Wave 0 plan task]'
export const MODEL_CACHE_PATH = (homeDir: string) =>
  join(homeDir, '.mrclean', 'models', 'Xenova', 'bert-base-NER', 'onnx', 'model_int8.onnx')

export async function isModelCached(homeDir: string): Promise<boolean> {
  try {
    await import('node:fs/promises').then(fs => fs.access(MODEL_CACHE_PATH(homeDir)))
    return true
  } catch { return false }
}

export async function verifyModelIntegrity(homeDir: string): Promise<boolean> {
  const hash = createHash('sha256')
  const { createReadStream } = await import('node:fs')
  const stream = createReadStream(MODEL_CACHE_PATH(homeDir))
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex') === PINNED_MODEL_SHA256
}
```

### Pattern 4: Wiring L6a in the Orchestrator

The orchestrator (`src/detect/index.ts`) needs one guarded call after L4:

```typescript
// MODIFY src/detect/index.ts — after L4, before dedupBySpan
// Mirrors existing L2/L3/L4 pattern (coveredSpans passed from accumulated findings)

import { runLayer6aPii } from './layer6a-pii.js'  // NEW import

// Inside runDetection and runDetectionReadOnly, after l4 push:
if (config.pii.enabled && config.pii.regex.enabled) {
  const l6a = runLayer6aPii(text, config.pii.regex, config, findings.map((f) => f.span))
  findings.push(...l6a)
}
// then dedupBySpan as before
```

**No changes to PlaceholderManager, audit log, or allowlist needed.** `getTypeForRuleId('pii:email')` already returns `'PII_EMAIL'` (Phase 4-01). `findingToAuditRecord` already accepts `provenance?` (Phase 4-01). The L6a engine emits source `'pii-regex'` (already in `SOURCE_PRECEDENCE`).

### Pattern 5: Doctor Model Check

```typescript
// MODIFY src/doctor/checks.ts — add a new check function (mirrors checkConfigLoad pattern)
export async function checkModelCache(homeDir: string): Promise<CheckResult> {
  const cached = await isModelCached(homeDir)
  if (!cached) {
    return { name: 'model-cache', status: 'SKIP',
             detail: 'NER model not downloaded (PII NER opt-in required)', exitCodeOnFail: 0 }
  }
  const valid = await verifyModelIntegrity(homeDir)
  if (!valid) {
    return { name: 'model-cache', status: 'FAIL',
             detail: 'NER model SHA-256 mismatch — re-download with `mrclean pii-init`', exitCodeOnFail: 6 }
  }
  return { name: 'model-cache', status: 'PASS',
           detail: 'NER model present and SHA-256 verified', exitCodeOnFail: 6 }
}
```

**Doctor exit-code extension:** Current exit-code map goes 0-5. Model integrity failure should be exit code 6 (new). Must update `computeDoctorReport` and `renderReport` to include this check.

**SKIP semantics:** If the model is not downloaded (not opted in), the check returns `SKIP` (not `FAIL`) so `mrclean doctor` stays green for the majority of users who have not enabled NER. `SKIP` does not contribute a non-zero exit code.

### Anti-Patterns to Avoid

- **Global `/g` regex with saved `lastIndex`:** Reusing a module-level global-flag RegExp across invocations means `.exec()` picks up where it left off (non-zero `lastIndex`), causing intermittent misses. Use `String.prototype.matchAll(new RegExp(source, 'g'))` or reset `re.lastIndex = 0` before each text scan. Best practice: store source strings, create fresh RegExp per scan call.
- **Emitting `action` field on PII findings without using config:** The L6a engine must honor `config.pii.regex.actions[entity]` by setting `finding.action` on the Finding, so the orchestrator's step-8b logic uses the PII-specific action (e.g., `'block'` for SSN/CC) rather than falling back to severity-default. Without this, all PII findings default to severity-based action, ignoring the per-entity action config.
- **Calling `env.cacheDir` AFTER the first `pipeline()` call:** `@huggingface/transformers` reads `env.cacheDir` at pipeline instantiation time. Setting it after the first `await pipeline(...)` has no effect. Must set before any `pipeline()` call. See Pitfall 1.
- **Luhn-only gate without regex pre-filter:** Running Luhn against every 13-19 digit sequence in a 50KB payload would cause false alarms and perf overhead. The credit card regex narrows to structurally valid card formats (Visa/MC/Amex/Discover/JCB prefixes) first; Luhn is a secondary gate.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA-256 model integrity | Custom hash lib | `node:crypto` `createHash('sha256')` | Built-in, audited, zero surface |
| Model download progress | Custom streaming download infra | `fetch()` (Node 20 global) + `node:fs/promises` streaming write | Native, already in codebase pattern |
| ONNX model cache path | Custom discovery logic | `env.cacheDir` from `@huggingface/transformers` | Official API — ensures Phase 6 pipeline reads from same location |
| PII regex packs from scratch | Hand-roll 5+ patterns | Adopt patterns from well-documented public PII regex art + Luhn check | PROJECT.md decision: "don't hand-roll the rule pack" — same principle applies to PII patterns |
| Credit card BIN validation | API calls to validate card | Luhn checksum (offline, instant) | Luhn catches format errors; BIN validation = network call = no-egress violation |

---

## Runtime State Inventory

> Skipped — Phase 5 is not a rename/refactor/migration phase. No runtime state inventory required.

---

## Common Pitfalls

### Pitfall 1: env.cacheDir Defaults to `./.cache` (cwd-relative)

**What goes wrong:** `@huggingface/transformers` v4 default `env.cacheDir` is `./.cache` — a path relative to the current working directory of the process that called `pipeline()`. For the MCP server this is wherever the user ran `mrclean-mcp`, which varies. Models download to unpredictable locations, fail to be found on restart, and violate the "never cwd-relative" STATE.md decision.

**Why it happens:** The library was built for browser-first use where a relative cache is fine; the Node.js default inherited this behavior.

**How to avoid:** Set `env.cacheDir = join(homedir(), '.mrclean', 'models')` in `model-cache.ts` initialization, BEFORE any call to `pipeline()` or any HuggingFace model load. Use `import { env } from '@huggingface/transformers'` and set the property. This must happen in the MCP server initialization path, not just in `model-cache.ts`.

**Warning signs:** Model not found after restart; `.cache/` directories appearing in random working dirs.

**Source:** [VERIFIED: docs.huggingface.co/transformers.js/api/env] — `cacheDir` defaults to `./.cache`.

---

### Pitfall 2: JavaScript RegExp Global Flag `lastIndex` State

**What goes wrong:** A module-level `const RE = /pattern/g` has stateful `lastIndex`. If `RE.exec(text1)` is called and then `RE.exec(text2)` is called without resetting, the second call starts from the wrong offset. In tests with short fixtures this fails intermittently.

**Why it happens:** JavaScript's `RegExp` global flag modifies the regex object's `lastIndex` property in-place. This is a well-known JS gotcha.

**How to avoid:** Two safe approaches: (1) Store pattern source strings, create `new RegExp(source, 'g')` inside the function per invocation. (2) Use `[...text.matchAll(new RegExp(source, 'g'))]`. Option 1 is preferable when you also need to control construction. Do NOT store module-level global-flag RegExp objects and reuse them across calls.

**Warning signs:** Tests pass in isolation but fail when run together; intermittent missed detections.

---

### Pitfall 3: Phone Number Regex — False Positives on Version Strings, Port Numbers, Zip Codes

**What goes wrong:** A permissive phone regex like `\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b` matches version strings (`3.14.1592`), port-adjacent numbers, and zip-based fragments.

**Why it happens:** US phone numbers share the 10-digit NNN-NNN-NNNN format with many other numeric patterns.

**How to avoid:** Apply the shape-allowlist-style guard: require area code starts with `[2-9]` (no 0/1 NPA), require exchange starts with `[2-9]` (no 0/1 NXX). Additionally, the existing shape allowlist (`isShapeAllowlisted`) already suppresses common hash/UUID formats. Consider a wrapper that checks the surrounding 20-char context (e.g., `tel:`, `phone`, `call`) to reduce false alarms on bare numeric sequences.

**Warning signs:** False positives on `npm` version strings like `3.2.9106` or port:number combinations.

---

### Pitfall 4: IPv4 Regex Matching Private/Loopback/Version Numbers

**What goes wrong:** Pattern `/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g` matches version numbers like `1.2.3.4` and `127.0.0.1`/`192.168.x.x`. In code contexts, this produces false alarms on semver strings.

**Why it happens:** IPv4 and semver share the dotted-number structure.

**How to avoid:** Use the validated octet pattern `(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)` to restrict each octet to 0-255. Consider excluding private/loopback ranges (10.x, 172.16-31.x, 192.168.x, 127.x) from blocking (these should be `audit` severity at most, which the default config already sets with `ip: 'audit'`). Alternatively, suppress private-range IPs via the allowlist rather than the regex pattern — this is more maintainable.

**Warning signs:** `192.168.1.1` in config files triggers findings; `1.0.0.0` version tag triggers.

---

### Pitfall 5: SSN False Positives Without Negative Lookahead

**What goes wrong:** A naive pattern `/\d{3}-\d{2}-\d{4}/` matches phone-like fragments and invalid SSN ranges (000, 666, 900-999 group numbers; 00 group; 0000 serial).

**Why it happens:** Many 9-digit number sequences in US numeric formatting match the raw shape.

**How to avoid:** Use the structured negative-lookahead SSN pattern:
`/\b(?!000|666|9\d{2})\d{3}[-\s]\d{2}[-\s](?!0{4})\d{4}\b/g`
This rejects group 000, 666, 900-999; rejects group 00; rejects serial 0000. Require exactly one separator (hyphen or space) consistently — mismatched separators are rare in real SSNs.

---

### Pitfall 6: Model SHA-256 Not Pre-Computed — Blocks Plan Execution

**What goes wrong:** If the plan is written with `PINNED_MODEL_SHA256 = 'TBD'`, the implementation task cannot complete without a human downloading the 108 MB file and computing its hash.

**Why it happens:** Hugging Face Hub does not expose SHA-256 in the tree listing UI. The hash must be computed from the actual file bytes.

**How to avoid:** Plan Wave 0 MUST include a task to: (1) download `Xenova/bert-base-NER` `onnx/model_int8.onnx` to a temp location, (2) compute `sha256sum`, (3) commit the hash as `PINNED_MODEL_SHA256` in `src/model/constants.ts` before any implementation tasks. This is a one-time setup task. Alternatively, use the HuggingFace Hub API (`model_info` endpoint) which returns per-file SHA-256 for LFS files — this can be automated.

**Warning signs:** Constant defined as `TODO` or empty string; integrity check always passes/fails.

---

### Pitfall 7: Calling `runLayer6aPii` from the Hook Process During Cold Start

**What goes wrong:** Even though L6a is sync, if it performs any lazy module-level initialization on first call (e.g., reading a config file, importing a large JSON), the first hook invocation in a new process will be slower than subsequent ones. If this cold-start cost exceeds the perf budget, it registers as a regression in the perf gate.

**Why it happens:** Module-level initialization is deferred to first `require`/`import` unless explicitly pre-loaded.

**How to avoid:** Keep all pattern initialization as module-level constants (compile-time literals). No file reads, no network calls, no dynamic imports in `layer6a-pii.ts`. The five patterns are small enough to compile instantly. Benchmark the first call in the perf gate tests.

---

### Pitfall 8: Missing allowlist Pass in L6a

**What goes wrong:** L6a engine emits findings for text that the operator added to `config.allowlist.stopwords` or `config.allowlist.fingerprints`. This creates user-visible inconsistency: L1-L4 respect the allowlist but L6a does not.

**Why it happens:** The 5-axis allowlist check (`isAllowlisted`) is implemented in `src/detect/layer1-regex/index.ts` as a private function. L6a is in a different module and won't get it automatically.

**How to avoid:** Either (a) extract `isAllowlisted` into a shared `src/detect/allowlist.ts` module and import in both L1 and L6a, or (b) pass the config object to `runLayer6aPii` and apply the same logic inline. The `MrcleanConfig` shape already contains `config.allowlist`. The planner should resolve this: the cleanest approach is option (a) — extract the helper once rather than duplicating the logic.

---

## Code Examples

### E1: PII Finding Emission (L6a pattern)

```typescript
// Source: mirrors src/detect/layer2-entropy.ts (verified codebase)
// L6a emits with source: 'pii-regex' and ruleId: 'pii:<entity>'
import { redactedHash, fingerprint } from '../findings.js'

function emitPiiFinding(
  entity: string,          // e.g. 'email', 'ssn', 'credit_card', 'phone', 'ip'
  value: string,
  spanStart: number,
  spanEnd: number,
  action: 'block' | 'warn' | 'audit',
): Finding {
  const ruleId = `pii:${entity}`
  const hash = redactedHash(value)
  const fp = fingerprint(ruleId, value)
  return {
    ruleId,
    severity: entity === 'ssn' || entity === 'credit_card' ? 'HIGH' : 'MEDIUM',
    span: { start: spanStart, end: spanEnd },
    value,
    redactedHash: hash,
    fingerprint: fp,
    source: 'pii-regex',
    action,
  }
}
```

### E2: Severity Assignment Rationale

Based on `DEFAULT_CONFIG.pii.regex.actions` (verified, Phase 4-02):
- `ssn`: action `'block'`, severity `HIGH` — validated checksum, high-confidence PII
- `credit_card`: action `'block'`, severity `HIGH` — Luhn-validated, high-confidence PII
- `email`: action `'warn'`, severity `MEDIUM` — broader false-positive surface
- `phone`: action `'warn'`, severity `MEDIUM` — broader false-positive surface
- `ip`: action `'audit'`, severity `LOW` — frequent in code/logs, often non-sensitive

**Decision:** Severity should be derived from the entity, not from the config action, so it can be overridden independently. The `action` field on the Finding carries the per-entity action from config; the orchestrator's step-8b applies it.

### E3: env.cacheDir Override Before Pipeline Load

```typescript
// Source: [VERIFIED: docs.huggingface.co/transformers.js/en/api/env] + Node tutorial
// Must be called before any pipeline() call in the MCP server init path.
import { env } from '@huggingface/transformers'
import { join } from 'node:path'
import { homedir } from 'node:os'

export function configureMrcleanModelCache(): void {
  env.cacheDir = join(homedir(), '.mrclean', 'models')
  env.allowLocalModels = true
  // Disable remote loading when side-loading:
  // env.allowRemoteModels = false  <- set only in offline/side-load mode
}
```

### E4: ModelRegistry.is_pipeline_cached Check (doctor readiness without forced download)

```typescript
// Source: [VERIFIED: docs.huggingface.co/blog/transformersjs-v4] — v4 ModelRegistry API
// This checks cache without triggering a download.
import { ModelRegistry } from '@huggingface/transformers'

export async function isNerPipelineCached(): Promise<boolean> {
  try {
    return await ModelRegistry.is_pipeline_cached(
      'token-classification',
      'Xenova/bert-base-NER',
      { dtype: 'int8' },
    )
  } catch {
    return false
  }
}
```

**Note:** This requires `@huggingface/transformers` to be installed (optional dep). The doctor check must guard against the import failing with `try/catch` around the dynamic import.

### E5: Side-Load Path

```typescript
// Side-load: operator places model_int8.onnx at the canonical cache path manually.
// mrclean doctor verifies SHA-256 integrity; if the hash matches PINNED_MODEL_SHA256,
// the model is considered valid regardless of how it arrived there.
// No extra CLI flag needed — side-load IS offline-download-by-other-means.

// To support offline environments: set env.allowRemoteModels = false
// and set env.localModelPath to the parent of the Xenova/ dir.
// [ASSUMED] whether localModelPath must include the Xenova/ component — verify against
// the actual downloaded cache directory structure.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@xenova/transformers` (old npm scope) | `@huggingface/transformers` | v3 → v4 (Aug 2024) | Import path changed; old `@xenova/transformers` is the v2/v3 package, now deprecated |
| `env.cacheDir = './.cache'` (relative default) | Must set to `~/.mrclean/models/` explicitly | v1+ | Default unchanged; mrclean overrides it |
| SSE MCP transport | Streamable HTTP (v1.29 SDK) | Nov 2025 MCP spec | Not relevant to Phase 5 — confirmed in Phase 3 |
| `pipeline('ner', ...)` (old task name) | `pipeline('token-classification', ...)` for BERT-based NER | Transformers.js v2+ | Use `'token-classification'` as the task name |

**Deprecated/outdated:**
- `@xenova/transformers`: the pre-Hugging Face npm scope; replaced by `@huggingface/transformers`; package.json already uses the correct scope (verified Phase 4-03).
- `TRANSFORMERS_CACHE` env var: this is the **Python** library's environment variable, NOT the JS library's. The JS library uses `env.cacheDir` programmatic override or `HF_HOME` (undocumented for JS). Do NOT use `TRANSFORMERS_CACHE` as a JS env var — it has no effect.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `PINNED_MODEL_SHA256` for `Xenova/bert-base-NER onnx/model_int8.onnx` is not yet known — must be computed in Wave 0 | Pattern 3, Pitfall 6 | Without the correct hash, integrity verification either always passes (security hole) or always fails (unusable). Wave 0 task must compute and commit it. |
| A2 | `env.allowLocalModels` default is `true` in Node.js environments | Code Example E3 | If false, side-load path fails silently even when model file is present. Verified from official docs table: "true otherwise" (non-browser) — MEDIUM confidence. |
| A3 | `ModelRegistry.is_pipeline_cached()` does NOT trigger a download | Code Example E4 | If it does trigger a download, the doctor check violates MODEL-02 (default cold path must never touch network). Needs code-level verification in Wave 0. |
| A4 | `pipeline('token-classification', ...)` is the correct task name for `Xenova/bert-base-NER` int8 | State of the Art, E4 | Wrong task name means Phase 6 inference fails. Low risk — standard for BERT-NER in transformers.js. |
| A5 | IPv6 detection via a second pattern (not in default entities) | Architecture diagram | The default `entities` array in `DEFAULT_CONFIG.pii.regex.entities` only lists `'ip'` — the engine should treat this as IPv4 by default and IPv6 as an extended opt-in. If the planner conflates them, the IPv6 regex complexity could bloat the pattern or cause ReDoS risk. Keep IPv4 and IPv6 as separate optional entities. |

---

## Open Questions (RESOLVED)

1. **Exact SHA-256 of `Xenova/bert-base-NER onnx/model_int8.onnx`**
   - What we know: File is 108 MB, present at `Xenova/bert-base-NER/tree/main/onnx/model_int8.onnx` on HuggingFace Hub
   - What's unclear: Exact content hash (LFS pointer SHA ≠ file content SHA)
   - Recommendation: Wave 0 task downloads the file via `huggingface_hub` or direct HTTPS to `https://huggingface.co/Xenova/bert-base-NER/resolve/main/onnx/model_int8.onnx` and runs `sha256sum`. Commit result to `src/model/constants.ts`.

2. **HuggingFace Hub API for per-file SHA-256 metadata**
   - What we know: `ModelRegistry.get_file_metadata(modelId, filename)` returns metadata including `size`
   - What's unclear: Whether `get_file_metadata` returns a `sha256` or `etag` field that can substitute for a self-computed hash
   - Recommendation: If available, use Hub-provided hash as the pinned value (reduces the download-to-pin dance). Low priority — self-compute is reliable.

3. **Doctor exit code for model integrity failure**
   - What we know: Current exit codes 0-5 are locked in `checks.ts` and `RESEARCH §4.4`. Model integrity is a new failure category.
   - What's unclear: Whether exit code 6 is acceptable or whether model failures should be a non-fatal `SKIP` when NER is not opted in
   - Recommendation: Use `SKIP` when model not downloaded (user has not opted in — healthy state). Use `FAIL` with exit code 6 only when model IS present but integrity check fails (tampered/corrupted file). This means doctor only fails on model issues when the user has a model to check.

4. **`isAllowlisted` extraction to shared module**
   - What we know: The function is currently private in `src/detect/layer1-regex/index.ts`
   - What's unclear: Whether to extract to `src/detect/allowlist.ts` (plan 05-01 scope) or duplicate it in L6a
   - Recommendation: Extract to `src/detect/allowlist.ts` in plan 05-01. This is a small refactor (50 LOC move) with high long-term value — L6b NER (Phase 6) will also need it.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js ≥20.18.0 | All | ✓ | 20.x (project enforced) | — |
| `node:crypto` | Model SHA-256 | ✓ | Built-in | — |
| `node:fs/promises` | Model download/cache | ✓ | Built-in | — |
| `fetch` (global) | Model HTTP download | ✓ | Node 20 global | `node:https` stream |
| `@huggingface/transformers` installed | `ModelRegistry` API in doctor | ✗ (optional dep, may not be installed) | `^4.2.0` declared | Doctor check must `try { await import(...) } catch` gracefully; returns SKIP if not installed |
| `Xenova/bert-base-NER onnx/model_int8.onnx` | Model integrity test | ✗ (not downloaded yet) | 108 MB | SKIP in doctor if absent |

**Missing dependencies with no fallback:** None that block core functionality.

**Missing dependencies with fallback:**
- `@huggingface/transformers` not installed: doctor `checkModelCache` wraps the import in try/catch and returns `SKIP`
- Model not downloaded: doctor returns `SKIP` (not `FAIL`)

---

## Validation Architecture

> `workflow.nyquist_validation` is `false` in `.planning/config.json` — this section is SKIPPED.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes (regex patterns applied to untrusted hook payloads) | RegExp with anchored patterns; shape allowlist pre-filter; Luhn validation |
| V6 Cryptography | yes (SHA-256 integrity verification of model file) | `node:crypto` `createHash('sha256')` — stdlib, never hand-rolled |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| ReDoS via adversarial PII-shaped input | Denial of Service | L6a runs in the same process as L1-L4; WorkerPool (ReDoS-safe execution) is already available. L6a patterns must be benchmarked or run through a ReDoS analyzer (rxxr2 or safe-regex) before shipping. The credit card pattern is the highest-risk candidate. |
| Model file replacement/tampering | Tampering | SHA-256 pinned constant in `src/model/constants.ts`; verified on every load before Phase 6 inference. FAIL with doctor exit code 6 on mismatch. |
| Raw PII in audit log (AUDIT-02 extension) | Information Disclosure | `findingToAuditRecord` LOCKED comment already covers raw PII (Phase 4-01). L6a emits source `'pii-regex'`; audit writes use `finding.redactedHash` only. Canary-leak test (Phase 7) will verify at runtime. |
| `pii.enabled: true` in a shared global config leaking PII findings to operator output | Information Disclosure | `action: 'block'` for SSN/CC emits only placeholder to the model — the `substitutedText` contains `<MRCLEAN:PII_SSN:001>`. Raw value never leaves the process. |
| Cold-start model download on every hook event | Denial of Service | MODEL-02 contract: model download NEVER happens in the per-event hook process. L6a is purely regex (no model). Model acquisition is isolated to `model-cache.ts` called only from MCP server init or `mrclean pii-init`. |

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED: huggingface.co/docs/transformers.js/api/env] — `env.cacheDir` defaults to `./.cache`, `allowLocalModels`, `allowRemoteModels`, `useFSCache`, `localModelPath`, `customCache` API
- [VERIFIED: huggingface.co/docs/transformers.js/en/tutorials/node] — Import path `from '@huggingface/transformers'`, `env.cacheDir` override, local model path pattern
- [VERIFIED: huggingface.co/blog/transformersjs-v4] — `ModelRegistry.is_pipeline_cached()`, `get_file_metadata()`, `clear_pipeline_cache()`, `useWasmCache`, v4 monorepo structure
- [VERIFIED: huggingface.co/Xenova/bert-base-NER/tree/main/onnx] — `model_int8.onnx` is 108 MB, present in onnx/ directory
- [VERIFIED: npm registry `npm view @huggingface/transformers`] — version 4.2.0, repo github.com/huggingface/transformers.js, created 2024-08-08
- [VERIFIED: npm registry `npm view onnxruntime-node`] — version 1.26.0, repo Microsoft/onnxruntime, created 2021-05-01
- [VERIFIED: codebase] — `src/detect/findings.ts` SOURCE_PRECEDENCE with pii-regex/pii-ner at tail; `src/detect/type-map.ts` pii:* rule-id → PII_* TYPE mappings; `src/config/defaults.ts` DEFAULT_CONFIG.pii; `src/detect/index.ts` L1-L4 orchestrator pattern; `src/detect/layer2-entropy.ts` layer function signature pattern; `src/detect/shape-allowlist.ts` existing shape allowlist; `src/doctor/checks.ts` CheckResult pattern
- [VERIFIED: codebase STATE.md] — v1 p95 17.4ms UserPromptSubmit (current hot-path budget headroom); model cache dir `~/.mrclean/models/` locked decision; pii.enabled=false default is locked
- [VERIFIED: github.com/huggingface/transformers.js release 4.0.0] — monorepo migration, `@huggingface/tokenizers` extracted, WebGPU rewrite, esbuild migration

### Secondary (MEDIUM confidence)
- [CITED: piicrawler.com/blog/regular-expressions-used-in-pii-scanning/] — PII regex pattern art for email, SSN, credit card, phone, IPv4
- [CITED: docs.huggingface.co/docs/transformers.js/en/api/env TransformersEnvironment table] — `allowLocalModels` defaults to `true` in Node.js
- [CITED: ihateregex.io/expr/ssn + geeksforgeeks SSN regex] — SSN negative lookahead patterns, invalid range exclusions

### Tertiary (LOW confidence — verify before implementing)
- [ASSUMED] `ModelRegistry.is_pipeline_cached()` does not trigger download (Assumption A3 — must verify)
- [ASSUMED] `PINNED_MODEL_SHA256` (Assumption A1 — must compute in Wave 0)

---

## Metadata

**Confidence breakdown:**
- L6a regex lane: HIGH — all contracts are Phase 4-verified, layer pattern is established, regex art is well-known
- Model acquisition infra: HIGH with noted assumptions (A1: SHA256 TBD; A3: ModelRegistry behavior unconfirmed without running code)
- Perf budget: HIGH — 82.6ms headroom verified from STATE.md bench data
- HuggingFace transformers v4 import paths: HIGH — verified against official docs

**Research date:** 2026-06-02
**Valid until:** 2026-08-02 (stable; @huggingface/transformers 4.x patch releases expected but no breaking changes)

---

## Phase Requirements

<phase_requirements>

| ID | Description | Research Support |
|----|-------------|------------------|
| PII-01 | Regex/checksum detection of structured PII — email, US SSN, credit card (Luhn-validated), phone, IPv4/IPv6 — pure-JS, in-process, hot-path-capable (no model) | Pattern 1 (L6a engine), Pattern 2 (Luhn), Pitfalls 2-5 (false positive avoidance), Code Examples E1-E2 |
| PII-02 | PII findings emit in the existing normalized finding shape with new `PII_*` TYPE values and a `pii-regex` source, flowing through the existing placeholder manager, audit log, and 5-axis allowlist with no new anonymizer/audit/allowlist code | Pattern 4 (orchestrator wiring), Code Example E1, Architecture Diagram (no new sinks confirmed) |
| MODEL-02 | Model lazy-downloaded on first opt-in to a stable cache (`~/.mrclean/models/`, never cwd-relative) with a one-time progress indicator; the default `npx` cold path never loads ML deps | Pattern 3 (model-cache.ts), Code Example E3 (env.cacheDir override), Pitfall 1 (cacheDir default), Architecture Diagram |
| MODEL-03 | Downloaded model verified against a pinned SHA-256; an offline/air-gapped side-load path is supported; `mrclean doctor` reports model presence/integrity | Pattern 3 (SHA-256 verify), Pattern 5 (doctor check), Code Example E5 (side-load), Open Questions 1-2 (SHA256 pinning), Assumption A1 |

</phase_requirements>
