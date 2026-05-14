---
phase: 02-live-redaction-layers-1-4-one-way
verified: 2026-05-14T11:40:00Z
status: passed
score: 6/6 success criteria verified
overrides_applied: 0
---

# Phase 2: Live Redaction (Layers 1-4 + One-Way) — Verification Report

**Phase Goal:** Real secrets pasted into a Claude Code session are blocked-with-reason on prompts and substituted with stable `<MRCLEAN:TYPE:NNN>` placeholders in tool calls; `.env` values, regex hits, entropy, and project word-list all caught; audit log records hash-only entries.
**Verified:** 2026-05-14T11:40:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## 1. Test Suite

**Command:** `npx vitest run --no-file-parallelism`
**Result:** 359 tests across 49 test files — all PASS. Duration 22.69 s.
**Build:** `npm run build` succeeds. Artifacts: `dist/cli.js` (94.65 KB), `dist/mcp.js` (7.08 KB), `dist/detect-layer1.js` (15.01 KB). All ESM + `.d.ts`. `cli.js` and `mcp.js` have `#!/usr/bin/env node` shebangs. `detect-layer1.js` is a library bundle (no shebang — correct, not a bin entrypoint).

---

## 2. Observable Truths (6 ROADMAP Success Criteria)

| # | Success Criterion | Status | Evidence |
|---|-------------------|--------|----------|
| SC1 | AWS key in prompt → blocked with top-level `decision:"block"` + `reason` naming rule | VERIFIED | `user-prompt-submit.ts` lines 63-66, 96-103: `{ decision: 'block', reason: '[mrclean] …' }`. `permissionDecision` count in non-comment lines: 0 (grep gate confirmed). `handlers-detection.test.ts` Test 2 explicitly asserts `output.decision === 'block'` and `output.permissionDecision === undefined`. |
| SC2 | PreToolUse Bash call with `Bearer sk_live_…` → `hookSpecificOutput.updatedInput` with `<MRCLEAN:STRIPE_KEY:001>`; same token twice = same placeholder | VERIFIED | `pre-tool-use.ts` line 176: `updatedInput: updatedToolInput`. `integration-detection.test.ts` Test 2 uses fixture `sk_live_testABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef`, asserts `hookSpecificOutput.updatedInput` is defined and contains placeholder. `orchestrator.test.ts` Test 7 asserts same sessionId + same value → same placeholder (PH-02). `placeholder/manager.test.ts` Test 2 directly asserts `first === second` for same value. |
| SC3 | `.env` value + `.mrclean/words.txt` term → both caught by L3/L4 on SessionStart | VERIFIED | `layer3-env.ts`: `loadEnvBlocklist()` runs at SessionStart via `session-state.ts`. `layer4-words.ts`: `loadWordsList()` also runs at SessionStart. `session-start.ts` calls `initSessionState()` which loads both. `layer3-env.test.ts` covers loading from `.env` files. `layer4-words.test.ts` covers parsing words.txt with `|action` syntax. |
| SC4 | Positive corpus (12 secret types) → 100% recall; negative corpus (10 non-secrets) → 0 false positives | VERIFIED | `fixtures-corpus.test.ts` (24 tests, all passing): 12 positive fixtures covering AWS access key, AWS secret key, GitHub PAT classic/fine-grained, JWT, Stripe live key, OpenAI key, Anthropic key, Slack bot token, PEM private key, dotenv-derived, words-term. 10 negative fixtures covering UUIDs, git SHAs (7 and 40 char), MD5, SHA-256, npm integrity sha512, Cargo hash, base64 image header, lorem ipsum. STATE.md confirms: 100% recall (12/12), 0% FP (0/10). |
| SC5 | `.mrclean/audit.jsonl` contains `redactedHash` + `fingerprint` only; grep for fixture secret → 0 hits | VERIFIED | `audit/log.ts`: `findingToAuditRecord()` explicitly maps only `ts, sessionId, hookEvent, ruleId, severity, action, redactedHash, fingerprint, location` — `finding.value` is excluded with LOCKED comment. `audit/log.test.ts` Test "excludes raw secret value" asserts `serialised.includes(secretValue) === false`. `audit/canary-leak.ts` implements `assertNoCanaryLeak()` for substring-based audit scan. `fixtures-corpus.test.ts` runs canary-leak check against audit.jsonl with all 12 fixture values and asserts `result.ok === true`. |
| SC6 | `dry_run = true` in config → detections in audit log but no block/substitution | VERIFIED | `user-prompt-submit.ts` lines 70-82: `config.dry_run` → returns `hookSpecificOutput.additionalContext` (warning) with no top-level `decision`. `dry-run.ts`: `applyDryRun()` coerces all `effectiveAction` to `'audit'` (immutable). `detect/index.ts` line 269: `substitutedText = text` when `dry_run`. `integration-detection.test.ts` Test 5 asserts `parsed.decision === undefined` when `dry_run = true` is in config and a detectable key is in the prompt. |

**Score: 6/6 success criteria verified.**

---

## 3. RESEARCH-Locked Technical Decisions

| Decision | Status | Evidence |
|----------|--------|----------|
| UserPromptSubmit deny uses top-level `decision: "block"` + `reason` (NOT `permissionDecision`) | VERIFIED | `user-prompt-submit.ts` lines 64, 97. Grep gate: 0 occurrences of `permissionDecision` in non-comment lines. |
| PreToolUse uses `hookSpecificOutput.updatedInput` | VERIFIED | `pre-tool-use.ts` line 176: `updatedInput: updatedToolInput`. `handlers-detection.test.ts` Test 4 asserts `hookSpecificOutput.updatedInput` is defined. |
| PostToolUse uses `hookSpecificOutput.updatedToolOutput` (CC >= v2.1.121) | VERIFIED | `post-tool-use.ts` line 82: `updatedToolOutput: result.substitutedText`. `version-check.ts` floor: `patch >= 121` for green status. |
| ReDoS protection via `worker_threads` + `worker.terminate()` (50ms per-pattern) | VERIFIED | `worker-pool.ts`: `new Worker(POOL_WORKER_CODE, { eval: true })`, timeout of 50ms (default), `w.terminate()` on timeout (line 166), replaces terminated worker with fresh one. |
| 39 gitleaks rules unadaptable to JS — documented in `vendor/SKIPPED_GITLEAKS_RULES.md` | VERIFIED | `vendor/SKIPPED_GITLEAKS_RULES.md` table: 222 total, 39 skipped, 183 usable. Exactly 39 entries in the skipped rules table. Runtime log confirms "183 rules compiled, 39 skipped". |
| smol-toml replaces Phase 1 hand-rolled TOML parser | VERIFIED | `src/config/index.ts` line 29: `import { parse } from 'smol-toml'`. `gitleaks-adapter.ts` and `install/ignore.ts` also import from `smol-toml`. No hand-rolled parser remains. |
| Claude Code compat floor bumped to >= 2.1.121 for PostToolUse `updatedToolOutput` | VERIFIED | `version-check.ts` lines 106-109: `patch >= 121` condition for `isFullyCompatible`. Yellow status for < 2.1.121. |

---

## 4. Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/detect/layer1-regex/index.ts` | VERIFIED | Layer 1 orchestrator, secretlint + gitleaks engines |
| `src/detect/layer1-regex/secretlint-engine.ts` | VERIFIED | `@secretlint/node` programmatic integration |
| `src/detect/layer1-regex/gitleaks-engine.ts` | VERIFIED | Gitleaks TOML rule runner |
| `src/detect/layer1-regex/gitleaks-adapter.ts` | VERIFIED | JS regex adaptation (183/222 rules) |
| `src/detect/layer1-regex/worker-pool.ts` | VERIFIED | WorkerPool (size 4, 50ms timeout, terminate on timeout) |
| `src/detect/layer1-regex/redos-worker.ts` | VERIFIED | Single-shot worker code |
| `src/detect/layer2-entropy.ts` | VERIFIED | Shannon entropy (inline 10-line), shape allowlist integration, keyword+escalation |
| `src/detect/layer3-env.ts` | VERIFIED | `dotenv.parse()` (never `.config()`), `fast-glob`, exclusion of `.env.example/sample/template` |
| `src/detect/layer4-words.ts` | VERIFIED | `word|action` syntax, case-insensitive whole-word, user-global + project-local merge |
| `src/detect/shape-allowlist.ts` | VERIFIED | UUID, git SHA (7+40), MD5, SHA-256, npm/Cargo integrity, base64 image header |
| `src/detect/findings.ts` | VERIFIED | Normalized finding shape `{ruleId, severity, span, value, redactedHash, fingerprint}` |
| `src/detect/type-map.ts` | VERIFIED | TYPE vocabulary for placeholder labels |
| `src/detect/index.ts` (orchestrator) | VERIFIED | Layer 1→2→3→4, span dedup, warn→audit normalize, dry_run coercion, audit writes |
| `src/detect/dry-run.ts` | VERIFIED | `applyDryRun()` pure function (immutable), generic constraint avoids circular import |
| `src/detect/session-state.ts` | VERIFIED | `initSessionState()` loads L3 env blocklist + L4 words at SessionStart |
| `src/placeholder/manager.ts` | VERIFIED | `<MRCLEAN:TYPE:NNN>` format, SHA-256 keyed stability, global counter, OVF path |
| `src/placeholder/substitute.ts` | VERIFIED | Span-ordered substitution |
| `src/audit/log.ts` | VERIFIED | `writeAuditRecord()`, `findingToAuditRecord()` (no raw value), `AuditRecord` schema |
| `src/audit/canary-leak.ts` | VERIFIED | `assertNoCanaryLeak()`: substring scan of JSON.stringify(record), ENOENT → ok:true |
| `src/hook/handlers/user-prompt-submit.ts` | VERIFIED | top-level `decision:'block'`, dry_run path, MEDIUM/LOW allow path |
| `src/hook/handlers/pre-tool-use.ts` | VERIFIED | `updatedInput` on substitution path, `permissionDecision:'allow'/'deny'` |
| `src/hook/handlers/post-tool-use.ts` | VERIFIED | `updatedToolOutput`, string coercion of tool_response |
| `src/hook/handlers/session-start.ts` | VERIFIED | SessionState init (L3+L4), long-form banner (HOOK-07) |
| `src/doctor/version-check.ts` | VERIFIED | Green for >= 2.1.121, yellow for < 2.1.121, red for < 2.0.0 |
| `vendor/gitleaks-rules.toml` | VERIFIED | Pinned at SHA 9febafb621f407ec7fd0d398783fa3a63418f694, 222 rules |
| `vendor/SKIPPED_GITLEAKS_RULES.md` | VERIFIED | 39 skipped rules documented with reason |
| `tests/fixtures/positive/` (12 files) | VERIFIED | Checksum-flipped synthetic values; headers indicate real-shape-but-invalid |
| `tests/fixtures/negative/` (10 files) | VERIFIED | UUIDs, git SHAs, hashes, lorem ipsum |
| `tests/fixtures-corpus.test.ts` | VERIFIED | 24 tests, 100% recall, 0 FP, canary-leak guard, audit line-count guard |

---

## 5. Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `user-prompt-submit.ts` | `detect/index.ts` | `runDetection(input.prompt, ...)` | VERIFIED |
| `pre-tool-use.ts` | `detect/index.ts` | `runDetection` per string leaf via `substituteToolInputDeep` | VERIFIED |
| `post-tool-use.ts` | `detect/index.ts` | `runDetection(text, ...)` after string coercion | VERIFIED |
| `session-start.ts` | `detect/session-state.ts` | `initSessionState()` | VERIFIED |
| `detect/index.ts` | `placeholder/manager.ts` | `getOrCreateManager(sessionId).allocate(value, type)` | VERIFIED |
| `detect/index.ts` | `audit/log.ts` | `writeAuditRecord` + `findingToAuditRecord` per finding | VERIFIED |
| `detect/index.ts` | `detect/dry-run.ts` | `applyDryRun(resolvedFindings)` when `config.dry_run` | VERIFIED |
| `layer1-regex/index.ts` | `worker-pool.ts` | `WorkerPool.runRegex()` | VERIFIED |
| `layer2-entropy.ts` | `shape-allowlist.ts` | `isShapeAllowlisted(value)` before entropy fires | VERIFIED |
| `layer3-env.ts` | `fast-glob` | `fastGlob('.env{,.local,.*}', ...)` | VERIFIED |
| `layer3-env.ts` | `dotenv` | `dotenvParse(content)` (never `dotenv.config`) | VERIFIED |
| `config/index.ts` | `smol-toml` | `parse(content)` | VERIFIED |
| `gitleaks-adapter.ts` | `smol-toml` | `parse(tomlContent)` | VERIFIED |

---

## 6. Requirements Coverage (26 Phase 2 REQ-IDs)

| Requirement | Status | Key Evidence |
|-------------|--------|--------------|
| DET1-01 (secretlint preset, in-process) | VERIFIED | `secretlint-engine.ts`: `lintSource()` API, no shell-out. |
| DET1-02 (gitleaks TOML vendored, smol-toml, in-process) | VERIFIED | `gitleaks-adapter.ts`: `parse()` from `smol-toml`. `vendor/gitleaks-rules.toml` pinned. |
| DET1-03 (normalized finding shape) | VERIFIED | `findings.ts`: `Finding` interface. All layers emit same shape. |
| DET1-04 (ReDoS-safe worker_threads + timeout) | VERIFIED | `worker-pool.ts`: 50ms timeout, `w.terminate()` on timeout, worker replaced. |
| DET2-01 (entropy threshold/min_length tunable) | VERIFIED | `layer2-entropy.ts`: reads `config.entropy.threshold` and `config.entropy.min_length`. Test: `threshold: 7.0` produces 0 findings. |
| DET2-02 (shape allowlist before entropy) | VERIFIED | `layer2-entropy.ts` line 165: `if (isShapeAllowlisted(value)) continue`. `shape-allowlist.ts` covers UUID, git SHA, MD5, SHA-256, npm integrity, base64 image. |
| DET2-03 (entropy requires keyword or escalation) | VERIFIED | `layer2-entropy.ts` lines 172-176: `keywordFired` OR `escalationFired`. Test: no keyword + <40 chars → 0 findings. |
| DET3-01 (SessionStart dotenv.parse, no dotenv.config) | VERIFIED | `layer3-env.ts`: `dotenvParse(content)`. Grep gate: 0 occurrences of `dotenv.config` in non-comment lines. |
| DET3-02 (secrets_files config list) | VERIFIED | `layer3-env.ts`: `secretsFiles` param in `loadEnvBlocklist`. `layer3-env.test.ts` Test "loads additional files". |
| DET3-03 (skip <8 chars, shape-allowlisted, booleans) | VERIFIED | `layer3-env.ts` lines 164-170: `MIN_VALUE_LENGTH = 8`, `isShapeAllowlisted`, `BOOLEAN_LITERALS` checks. |
| DET4-01 (words.txt case-insensitive whole-word) | VERIFIED | `layer4-words.ts` line 90: `new RegExp(\`\\\\b${escaped}\\\\b\`, 'gi')`. |
| DET4-02 (word|action syntax) | VERIFIED | `parseWordsFile()`: pipe split, validates action in `{block, warn, audit}`, defaults to `block`. |
| DET4-03 (hot-reload at SessionStart) | VERIFIED | `session-state.ts` calls `loadWordsList()` in `initSessionState()` which runs at every `SessionStart`. |
| PH-01 (`<MRCLEAN:TYPE:NNN>` format) | VERIFIED | `manager.ts` line 96: `` `<MRCLEAN:${type}:${String(this.counter).padStart(3, '0')}>` ``. `manager.test.ts` asserts `<MRCLEAN:AWS_KEY:001>`. |
| PH-02 (same value → same placeholder within session) | VERIFIED | `manager.ts` line 73: SHA-256 keyed `byHash` Map lookup. `manager.test.ts` Test 2. |
| PH-03 (collision-free across types, global counter) | VERIFIED | `manager.ts`: single `this.counter` (not per-TYPE). `manager.test.ts` Test 3. |
| PH-04 (angle brackets survive JSON/Markdown/code-fence) | VERIFIED | Format `<MRCLEAN:TYPE:NNN>` uses `<` `>` which are safe in all target contexts. `placeholder/substitute.ts` confirmed. |
| HOOK-02 (UserPromptSubmit deny → top-level `decision:'block'`) | VERIFIED | `user-prompt-submit.ts`. RESEARCH grep gate: 0 non-comment `permissionDecision` occurrences. |
| HOOK-03 (PreToolUse → `updatedInput`) | VERIFIED | `pre-tool-use.ts` line 176. |
| HOOK-04 (PostToolUse → `updatedToolOutput`) | VERIFIED | `post-tool-use.ts` line 82. |
| AUDIT-01 (JSONL record per detection with locked fields) | VERIFIED | `audit/log.ts`: `findingToAuditRecord` maps to `{ts, sessionId, hookEvent, ruleId, severity, action, redactedHash, fingerprint, location}`. |
| AUDIT-02 (no raw secret in audit log) | VERIFIED | `findingToAuditRecord` excludes `finding.value`. LOCKED comment. `log.test.ts` asserts secret not in serialised record. `fixtures-corpus.test.ts` canary-leak guard. |
| MODE-01 (`dry_run = true` → all actions → audit, no block/substitution) | VERIFIED | `dry-run.ts` `applyDryRun()`. `detect/index.ts` line 269: `substitutedText = text` when `dry_run`. `user-prompt-submit.ts` dry_run branch returns no `decision`. |
| MODE-02 (one-way only; no reversible mode) | VERIFIED | No restore path in hook handlers. `placeholder/manager.ts` has `getByPlaceholder()` but PostToolUse does not call it. REVMODE explicitly deferred to v2. |
| CFG-02 (per-rule action, severity, multi-axis allowlist) | VERIFIED | `shared/types.ts`: `MrcleanAllowlist` (5 axes), `MrcleanRuleConfig` (action + severity). `config/index.ts`: `[[rules]]` array-of-tables support via smol-toml. |
| CFG-04 (`mrclean ignore <fingerprint>` appends to allowlist) | VERIFIED | `cli.ts` line 59-63: `ignore` subcommand. `install/ignore.ts` implements `runIgnore()`. `cli/ignore.test.ts` covers it. |

**26/26 Phase 2 REQ-IDs verified.**

---

## 7. CLAUDE.md Dependency Compliance

| Dependency | Required Version | Installed | Status |
|------------|-----------------|-----------|--------|
| `smol-toml` | `^1.4.x` | `^1.6.1` | VERIFIED |
| `dotenv` | `^16.x` | `^17.4.2` | VERIFIED (RESEARCH allowed 17.x; backward-compatible for parse-only) |
| `fast-glob` | `^3.3.x` | `^3.3.3` | VERIFIED |
| `@secretlint/core` | `^13.x` | `^13.0.0` | VERIFIED |
| `@secretlint/node` | `^13.x` | `^13.0.0` | VERIFIED |
| `@secretlint/secretlint-rule-preset-recommend` | `^13.x` | `^13.0.0` | VERIFIED |
| `zod` (imported as `zod/v4`) | `^4.4.x` | `^4.4.3` | VERIFIED |
| `vitest` | `^4.x` | `^4.1.6` | VERIFIED |
| Node.js engines | `>=20.18.0` | declared in `package.json` | VERIFIED |

---

## 8. Anti-Pattern Scan

No `TBD`, `FIXME`, or `XXX` markers found in any Phase 2 source file under `src/detect/`, `src/hook/`, `src/placeholder/`, `src/audit/`.

No stub implementations, empty handlers, or `return null` without documented rationale found in Phase 2 paths.

**No `dotenv.config()` calls** in `src/` (security gate confirmed).

Fixture files in `tests/fixtures/positive/` are checksum-flipped (last character altered, headers document the mutation). No real credentials committed.

---

## 9. No New MCP Tools

Phase 3 owns MCP-02 and MCP-03 (mrclean_check, mrclean_redact, mrclean_status). Phase 2 left the three Phase 1 stub tools (`sanitize`, `restore`, `audit-query`) unchanged. No new MCP tool registrations added in Phase 2. Confirmed via `grep -rn "registerTool" src/mcp/` — only 3 tools exist, all pre-dating Phase 2.

---

## 10. Build Artifact Verification

| Artifact | Shebang | Size | Status |
|----------|---------|------|--------|
| `dist/cli.js` | `#!/usr/bin/env node` | 94.65 KB | VERIFIED |
| `dist/mcp.js` | `#!/usr/bin/env node` | 7.08 KB | VERIFIED |
| `dist/detect-layer1.js` | None (library bundle) | 15.01 KB | VERIFIED (test-only entry, not a bin, excluded from npm `files`) |

---

## Summary

All 6 ROADMAP success criteria are observably true in the codebase. All 26 Phase 2 REQ-IDs have implementing code and passing tests. All RESEARCH-locked technical decisions are honored. The build succeeds, 359 tests pass in serialized mode, fixtures produce 100% recall + 0 false positives, and the canary-leak guard confirms no raw secret value reaches the audit log.

**Phase 2 goal is achieved. Phase 3 may proceed.**

---

*Verified: 2026-05-14T11:40:00Z*
*Verifier: Claude (gsd-verifier)*
