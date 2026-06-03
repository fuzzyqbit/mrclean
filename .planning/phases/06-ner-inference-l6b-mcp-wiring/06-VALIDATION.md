---
phase: 6
slug: ner-inference-l6b-mcp-wiring
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-02
updated: 2026-06-03
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/detect` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/detect`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 6-01-00 | 01 | 1 | NER-02 | T-06-01-03 | confidence floor default 0.7; no stray dep added by scratch verify | unit | `grep -c "confidence: 0.9" src/config/defaults.ts` == 0 && `git diff --quiet package.json` | ✅ src/config/defaults.ts | ⬜ pending |
| 6-01-01 | 01 | 1 | NER-01 | T-06-01-01, T-06-01-03 | sole dynamic ML-dep import; env.cacheDir before pipeline(); no static transformers import in src/ | unit | `npm test -- pipeline-singleton ner-entities` | ❌ W0 (tests/model/pipeline-singleton.test.ts, tests/detect/ner-entities.test.ts) | ⬜ pending |
| 6-01-02 | 01 | 1 | NER-01, NER-02, NER-03 | T-06-01-02, T-06-01-04 | dual fail-closed boundaries; min_score gate; substitute-only (no block); D-11 drop without touching dedupBySpan | unit | `npm test -- layer6b-ner ner-overlap` | ❌ W0 (tests/detect/layer6b-ner.test.ts, tests/detect/ner-overlap.test.ts) | ⬜ pending |
| 6-02-01 | 02 | 2 | NER-01, MODEL-04 | T-06-02-02, T-06-02-03, T-06-02-04 | opts.ner MCP-only gate; pii-ner audit provenance (no raw value); secret records unchanged | unit | `npm test -- orchestrator-ner orchestrator-pii orchestrator` | ❌ W0 (tests/detect/orchestrator-ner.test.ts) | ⬜ pending |
| 6-02-02 | 02 | 2 | NER-01 | T-06-02-01 | structural unreachability: no static NER import from hook-reachable set; hook p95 ≤ 100ms unchanged | unit + perf | `npm test -- ner-unreachable && npm test --project=integration -- user-prompt-submit` | ❌ W0 (tests/detect/ner-unreachable.test.ts) | ⬜ pending |
| 6-03-01 | 03 | 3 | NER-01 | T-06-03-01, T-06-03-02, T-06-03-03, T-06-03-04 | fire-and-forget fail-closed preload; nerStatus surfaced; DTO PII-free; MCP-03 tool surface unchanged | unit | `npm test -- check-redact-ner server-ner-preload tools-list` | ❌ W0 (tests/mcp/check-redact-ner.test.ts, tests/mcp/server-ner-preload.test.ts) | ⬜ pending |
| 6-03-02 | 03 | 3 | NER-04 | T-06-03-SC, T-06-03-05 | piiranha license + second pinned SHA-256 — blocking human checkpoint (NOT auto-approvable) | checkpoint:human-verify | manual (blocking-human gate) | N/A (human checkpoint) | ⬜ pending |
| 6-03-03 | 03 | 3 | NER-04 | T-06-03-05 | piiranha quartet with real 64-hex pinned hash; PERSON/LOC label remap, no ORG; zero-ML-dep constants | unit | `npm test -- ner-entities-piiranha ner-entities` | ❌ W0 (tests/detect/ner-entities-piiranha.test.ts) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All MISSING (❌ W0) test files above are created RED-first by the owning task before its implementation lands:

- [ ] `tests/model/pipeline-singleton.test.ts` — caching/reset + cacheDir-before-load (NER-01, task 6-01-01)
- [ ] `tests/detect/ner-entities.test.ts` — bert label map (NER-01, task 6-01-01)
- [ ] `tests/detect/layer6b-ner.test.ts` — aggregation + min_score + dual fail-closed (NER-01..03, task 6-01-02)
- [ ] `tests/detect/ner-overlap.test.ts` — D-11 cross-source drop (NER-01, task 6-01-02)
- [ ] `tests/detect/orchestrator-ner.test.ts` — opts.ner gating + provenance (NER-01, MODEL-04, task 6-02-01)
- [ ] `tests/detect/ner-unreachable.test.ts` — import-graph structural unreachability (NER-01, task 6-02-02)
- [ ] `tests/mcp/check-redact-ner.test.ts` — nerStatus surfacing + PII-free DTO (NER-01, task 6-03-01)
- [ ] `tests/mcp/server-ner-preload.test.ts` — fail-closed preload (NER-01, task 6-03-01)
- [ ] `tests/detect/ner-entities-piiranha.test.ts` — piiranha label remap (NER-04, task 6-03-03)
- [x] Existing vitest infrastructure covers framework needs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| piiranha license acceptance + second pinned SHA-256 | NER-04 | License decision + supply-chain hash pin require human judgment; NOT auto-approvable | Task 6-03-02 blocking checkpoint — confirm cc-by-nc-nd-4.0 acceptance (opt-in only) + supply the 64-hex SHA-256 of the piiranha int8 ONNX file |
| Live MCP server NER round-trip under Claude Code | NER-01 | Requires a real Claude Code session with `pii.ner.enabled` + a downloaded model | Run `mrclean-mcp`, connect, call mrclean_check/mrclean_redact on prose with a person/org/location, observe NER findings + nerStatus 'ready' |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (the only non-automated task is the NER-04 license checkpoint, which is human-only by design)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
