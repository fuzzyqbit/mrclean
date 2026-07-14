# Phase 6: NER Inference (L6b) + MCP Wiring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-02
**Phase:** 6-NER Inference (L6b) + MCP Wiring
**Areas discussed:** Redact vs advise, Warm-up timing, min_score + entities, Overlap precedence

---

## Redact vs advise

| Option | Description | Selected |
|--------|-------------|----------|
| Substitute (placeholders) | redact replaces names/orgs/locations with `<MRCLEAN:PII_*:NNN>` via PlaceholderManager, same as secrets | ✓ |
| Advise-only (no substitution) | NER reported as metadata only; redact leaves prose untouched | |
| Substitute, gated by min_score | substitute only above a confidence floor, else advisory | |

**User's choice:** Substitute (placeholders)
**Notes:** Clarified the nuance — NER substitutes (scrubs from the wire) but never DENIES/blocks the request; the hard deny gate stays deterministic-only. One-way substitution (reversibility deferred this milestone). The min_score gating still applies as the floor for whether an entity is acted on at all (see min_score area).

---

## Warm-up timing

| Option | Description | Selected |
|--------|-------------|----------|
| Lazy on first NER call | Instant server start; model cold-loads on first NER call | |
| Eager at server startup | Model loads at MCP boot; first call already warm | ✓ |
| Eager only if config opts in | Lazy by default + optional preload flag | |

**User's choice:** Eager at server startup
**Notes:** Cost is one-time per long-lived MCP process (never per hook event). Fail-closed-for-NER preserved: if eager load fails, the server still starts and serves secret detection; NER reports unavailable.

---

## min_score + entities

| Option | Description | Selected |
|--------|-------------|----------|
| Balanced ~0.7 | Moderate floor balancing precision/recall under substitution | ✓ |
| Precision-leaning ~0.9 | Only very confident entities substitute | |
| Recall-leaning ~0.5 | Catch as much as possible, more false-positive redactions | |

**User's choice:** Balanced ~0.7 (tunable)

| Option | Description | Selected |
|--------|-------------|----------|
| All three (PER/ORG/LOC) | All on by default, each toggleable | ✓ |
| PERSON + ORG only | LOCATION off by default | |
| PERSON only | Narrowest default | |

**User's choice:** All three (PER/ORG/LOC), individually toggleable via config
**Notes:** Both are starting defaults chosen with substitution in mind; config-tunable, revisitable empirically after Phase 6.

---

## Overlap precedence

| Option | Description | Selected |
|--------|-------------|----------|
| Drop NER entirely | Any NER span overlapping a higher-precedence span is discarded regardless of length | ✓ |
| Keep non-overlapping remainder | Substitute only the non-overlapping part (fragmented spans) | |
| Longest-span-wins as-is | Pure dedupBySpan length rule, NER can override deterministic if longer | |

**User's choice:** Drop NER entirely
**Notes:** A deliberate exception to pure longest-span-wins, scoped to the pii-ner source. `SOURCE_PRECEDENCE` gains `pii-regex > pii-ner` at the tail; pii-ner never wins a region against a deterministic/regex-PII span. Realizes the locked "NER excluded from `<MRCLEAN:*>` ranges" invariant.

---

## Claude's Discretion

- Mechanism for threading the MCP-only NER opt-in into detection (DetectionContext flag vs new param), provided the hook path can never reach L6b.
- `nerStatus` response shape and placement in check/redact structuredContent.
- Whether eager preload awaits load before serving or loads async with a `loading` status.
- Subword→entity span reconstruction / aggregation strategy in the transformers.js pipeline.

## Deferred Ideas

None — discussion stayed within phase scope.
