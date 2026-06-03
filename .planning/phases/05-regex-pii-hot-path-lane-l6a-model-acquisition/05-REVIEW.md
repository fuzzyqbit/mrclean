---
phase: 05-regex-pii-hot-path-lane-l6a-model-acquisition
reviewed: 2026-06-02T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/cli.ts
  - src/detect/allowlist.ts
  - src/detect/index.ts
  - src/detect/layer1-regex/index.ts
  - src/detect/layer6a-pii.ts
  - src/doctor/checks.ts
  - src/doctor/index.ts
  - src/model/constants.ts
  - src/model/model-cache.ts
  - tests/detect/allowlist.test.ts
  - tests/detect/layer6a-pii.test.ts
  - tests/detect/orchestrator-pii.test.ts
  - tests/doctor/checks-model.test.ts
  - tests/model/model-cache.test.ts
findings:
  critical: 1
  warning: 5
  info: 4
  total: 10
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-06-02
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Reviewed the Layer 6a regex-PII lane and the model-acquisition infrastructure. The security-critical fail-closed paths (SHA-256 verify-before-rename, temp-file unlink on mismatch, side-load path validation, cold-path ML-dep isolation) are implemented correctly and well-tested. The regex patterns are linear-time with no ReDoS exposure I could construct.

However, there is one BLOCKER: the credit-card detector silently fails to detect any card number written with separators (spaces or hyphens) — the most common real-world format — because the regex matches digits-only while the Luhn gate strips separators. For a PII-leak-prevention tool, a structured-PII false negative is a data-leak defect, not a quality nit. There is also a cross-platform path bug in the model cache that breaks `downloadModel`/`sideLoadModel` on Windows, several robustness gaps, and a doc/count drift.

## Critical Issues

### CR-01: Credit-card detector misses every separator-formatted card number (PII false negative → data leak)

**File:** `src/detect/layer6a-pii.ts:58` (pattern), `:120-136` (luhnCheck), `:189` (gate)
**Issue:** The `credit_card` pattern matches **digits only** — `4[0-9]{12}...`, with no allowance for spaces or hyphens between digit groups. But `luhnCheck` strips all non-digits (`raw.replace(/\D/g, '')`) and explicitly handles spaced input. The two halves disagree: a card written in the universally-common grouped form `4111 1111 1111 1111` or `4111-1111-1111-1111` never matches the regex, so it is never even handed to Luhn — it passes straight through to the wire unredacted.

Verified empirically:
```
"4111 1111 1111 1111" => regex match: null   (luhnCheck on it: true)
"4111-1111-1111-1111" => regex match: null
"4111111111111111"    => regex match: ["4111111111111111"]
```

The test suite (`tests/detect/layer6a-pii.test.ts:96-108`) only exercises the unseparated `4111111111111111` form, so this gap is invisible to CI. This is the single highest-value PII entity (HIGH severity, default action `block`) and the leaking format is the most common one users paste.

**Fix:** Allow optional single space/hyphen separators between groups in the regex, then let `luhnCheck` (which already strips them) validate. Keep the prefix alternation but insert optional `[ -]?` between 4-digit groups, or relax to a bounded `[0-9](?:[ -]?[0-9]){12,18}` candidate and rely on Luhn + length as the real gate:
```ts
// Candidate: 13–19 digits, optionally grouped by single space/hyphen.
// Luhn (strips separators) is the authoritative validity gate.
['credit_card', '(?<![\\d-])(?:[0-9][ -]?){12,18}[0-9](?![\\d-])'],
```
Then add tests for `4111 1111 1111 1111` and `4111-1111-1111-1111` asserting a `pii:credit_card` finding is produced and that the matched `value` (with separators) round-trips through `luhnCheck` and substitution.

## Warnings

### WR-01: `downloadModel` / `sideLoadModel` directory derivation is broken on Windows

**File:** `src/model/model-cache.ts:168` and `:266`
**Issue:** Both functions compute the cache directory with `dest.substring(0, dest.lastIndexOf('/'))`. `MODEL_CACHE_PATH` is built with `path.join`, which emits backslashes on Windows. There, `lastIndexOf('/')` returns `-1`, so `destDir` becomes `''` and `tempPath` is malformed. `mkdir('', { recursive: true })` then fails (or resolves to cwd), breaking model acquisition entirely on Windows. CLAUDE.md commits to a Node 20 cross-platform runtime, so Windows is in scope.

Verified:
```
win path:  C:\Users\me\.mrclean\models\...\model_int8.onnx
lastIndexOf('/'): -1   →  destDir = ""   (should be the parent dir)
```

**Fix:** Use `path.dirname`:
```ts
import { dirname } from 'node:path'
const destDir = dirname(dest)
```
Apply in both `downloadModel` and `sideLoadModel`. (The same `substring(lastIndexOf('/'))` idiom in the test helpers is acceptable since tests run on POSIX CI, but the production code must not depend on `/`.)

### WR-02: `verifyModelIntegrity` uses a non-constant-time hash comparison

**File:** `src/model/model-cache.ts:109` (also `:210`, `:284`)
**Issue:** Integrity checks compare digests with `===` (`hash.digest('hex') === expectedHash`). For a security-sensitive integrity gate the project's own security rules call out crypto correctness; a plain `===` on the hex string is timing-variable. The expected hash here is a public pinned constant, so the practical attack surface is low, but a model-supply-chain integrity check is exactly the place to use a constant-time compare and to avoid normalizing surprises (case, length).

**Fix:** Compare with `crypto.timingSafeEqual` over equal-length buffers, guarding length first:
```ts
import { timingSafeEqual } from 'node:crypto'
const a = Buffer.from(hash.digest('hex'), 'utf8')
const b = Buffer.from(expectedHash, 'utf8')
return a.length === b.length && timingSafeEqual(a, b)
```

### WR-03: `downloadModel` does not validate downloaded size against `content-length`

**File:** `src/model/model-cache.ts:179-217`
**Issue:** `totalBytes` is parsed from the `content-length` header and used only to drive the progress callback. A truncated download (connection dropped mid-stream) is caught **only** by the SHA-256 mismatch, which is correct for integrity — but if the server omits `content-length` (`totalBytes === 0`), the progress callback silently never fires and there is no early/explicit signal distinguishing "truncated transfer" from "wrong file." The integrity check still fails-closed, so this is robustness/observability rather than a security hole, but the failure mode is opaque to the operator (a generic SHA mismatch on a truncated file looks identical to a poisoned file).

**Fix:** When `totalBytes > 0`, after the stream completes assert `writtenBytes === totalBytes` and throw a distinct, clearer error ("download truncated: expected N bytes, got M") before the hash step, so the operator gets an actionable message.

### WR-04: Orchestrator mutates shared `Finding` objects in the warn→audit normalization loop

**File:** `src/detect/index.ts:335-339` and `:232-236`
**Issue:** The normalization loop mutates findings in place (`f.action = 'audit'`). Per the project's CRITICAL immutability rule ("ALWAYS create new objects, NEVER mutate existing ones"), and because `deduped` entries can be the same object references that other layers/tests hold, in-place mutation risks hidden side effects. The downstream `.map((f) => ({ ...f, ... }))` already produces fresh objects, so the mutation is also redundant — the new `effectiveAction` could be derived without rewriting `f.action`.

**Fix:** Fold the warn→audit normalization into the subsequent `map` instead of mutating:
```ts
const resolvedFindings = deduped.map((f) => {
  const normalizedAction = f.action === 'warn' ? 'audit' : f.action
  const effectiveAction = normalizedAction !== undefined
    ? (normalizedAction as 'block' | 'substitute' | 'audit')
    : severityToDefaultAction(f.severity)
  ...
})
```
This removes the mutation in both `runDetection` and `runDetectionReadOnly`.

### WR-05: `block`-action findings are substituted with placeholders identically to `substitute` findings

**File:** `src/detect/index.ts:369-371` → `src/placeholder/substitute.ts:52-70`
**Issue:** `substituteFindings` replaces every finding's span regardless of `effectiveAction`. A `pii:ssn` / `pii:credit_card` finding resolves to `effectiveAction: 'block'`, yet `substitutedText` still receives a placeholder for it just like a `substitute` finding. The distinction between `block` and `substitute` is therefore invisible in the substituted output — the hook handler (Plan 02-05, out of scope here) must be the sole enforcer of the deny path. If a future caller ever sends `substitutedText` downstream on a non-deny path, a `block`-classified secret would be silently treated as merely substituted. This is a latent correctness/security coupling that is not asserted anywhere in the reviewed tests.

**Fix:** Either document explicitly (in `DetectionResult`) that `substitutedText` is only safe to transmit when no finding has `effectiveAction === 'block'`, or have `runDetection` expose a `hasBlockingFinding` boolean so callers cannot accidentally treat a blocked payload as send-safe. At minimum add a test asserting the orchestrator surfaces block findings distinctly.

## Info

### IN-01: Doctor doc comments say "six checks" but seven run

**File:** `src/doctor/index.ts:2-3`, `:73`, `:178` (and `checkModelCache` added at `:142`)
**Issue:** Header comments state "runs all six checks plus the version check" and "Run all six doctor checks," but the body now pushes seven checks (hooks, mcp, bins, hook-canary, mcp-canary, config-load, model-cache). The numbered list at `:76-84` correctly shows seven. Doc drift only.
**Fix:** Update the "six" references to "seven."

### IN-02: SSN pattern accepts mixed separators

**File:** `src/detect/layer6a-pii.ts:54`
**Issue:** `\d{3}[\- ]\d{2}[\- ]\d{4}` independently allows hyphen or space at each position, so `123-45 6789` and `123 45-6789` match. For a sanitizer this is benign over-collection (catching more PII is safe), so this is informational, not a defect — but it contradicts the inline comment "Allows separators: hyphen or space (consistently)," which implies a consistency constraint that the regex does not enforce.
**Fix:** Either accept the over-collection and fix the comment, or use a backreference if true consistency is desired (`(\d{3})([\- ])(\d{2})\2(\d{4})`), noting the perf/readability tradeoff.

### IN-03: IPv4 detector matches version-number-shaped strings

**File:** `src/detect/layer6a-pii.ts:67`
**Issue:** `18.20.4.1` (a plausible software version) matches `pii:ip`. Severity is LOW / action `audit`, so the blast radius is small, but it will generate audit noise on dotted-quad version strings. Acceptable for a sanitizer (over-collection), flagged for awareness.
**Fix:** No change required; if noise becomes a problem, gate IP findings on surrounding context (e.g., require a non-version keyword nearby) in a later phase.

### IN-04: `redactedHash` / `fingerprint` recomputation is duplicated across layers

**File:** `src/detect/layer6a-pii.ts:198-199`
**Issue:** Each layer independently calls `redactedHash(value)` and `fingerprint(\`pii:${entity}\`, value)`. This mirrors L1-L4 and is consistent, so it is not a regression — noting only that a shared `makeFinding(ruleId, value, span, ...)` factory would remove the per-layer boilerplate and prevent a future layer from computing the fingerprint inconsistently.
**Fix:** Optional — extract a `buildFinding` helper in `findings.ts` and have all layers use it.

---

_Reviewed: 2026-06-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
