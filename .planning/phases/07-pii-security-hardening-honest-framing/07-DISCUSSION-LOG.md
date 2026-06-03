# Phase 7: PII Security Hardening & Honest Framing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-03
**Phase:** 7-PII Security Hardening & Honest Framing
**Areas discussed:** Leak-test scope & corpus, Structural guard vs test-only, Asterisk surfacing, Banned-phrase enforcement

---

## Leak-test corpus & error-path coverage (PIISEC-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated PII corpus + forced-failure set | Distinct grep-able synthetic SSN/email/name/card through full pipeline; assert none in audit.jsonl OR stderr; representative forced-failure paths; reuse canary-leak harness | ✓ |
| Reuse existing fixture corpus + add PII | Extend fixtures-corpus/canary-leak with PII; less new code but mixed with secret fixtures | |
| Exhaustive — every catch/stderr path | Assert against every catch/stderr in src/; max coverage, brittle/high-maintenance | |

**User's choice:** Dedicated PII corpus + forced-failure set (Recommended)
**Notes:** Representative set of real PII-carrying error paths (corrupt/missing model, NER inference throw, supervisor catch), not exhaustive per-catch enumeration.

---

## Structural guard vs test-only (PIISEC-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Single error-sanitization chokepoint + test | One central sanitizeForOutput() at stderr/error sink + exception formatting; leaks structurally impossible + test proves it | ✓ |
| Test-only (literal PIISEC-01) | Just the regression test, no runtime guard | |
| Audit-sink hardening only | Tighten audit sink + test; stderr/error left test-only | |

**User's choice:** Add a single error-sanitization chokepoint + test (Recommended)
**Notes:** Defense-in-depth chosen over literal-minimalism — a security tool leaking PII via an error message is the worst-case trust failure. Constraint captured: no-detection-context exception paths must not echo raw input; chokepoint stays off the hot path.

---

## Honest-framing asterisk surfacing (PIISEC-02)

| Option | Description | Selected |
|--------|-------------|----------|
| All surfaces, once-per-output + machine flag | README + doctor note + CLI/banner, disclaimer once per output; advisory/bestEffort flag in MCP structuredContent | ✓ |
| Per-NER-finding marker | Visible symbol + per-finding flag on every NER finding; repetitive on prose | |
| Docs + doctor only | README + doctor only; MCP/CLI unmarked (fails SC-3 literally) | |

**User's choice:** All surfaces, once-per-output + machine flag (Recommended)
**Notes:** Once-per-output avoids noise; machine-readable flag satisfies "asterisk visible wherever PII surfaces" programmatically.

---

## Banned-phrase enforcement (PIISEC-02)

| Option | Description | Selected |
|--------|-------------|----------|
| CI grep test for banned phrases | Build fails if user-facing strings contain compliance/guarantee language (redacts all PII, compliant, guarantee, GDPR/HIPAA) | ✓ |
| Docs-only, no gate | Honest framing now, rely on code review for drift | |

**User's choice:** CI grep test for banned phrases (Recommended)
**Notes:** Cheap insurance against future copy drift toward overclaiming.

---

## Claude's Discretion

- `sanitizeForOutput()` signature/location and span-threading mechanism.
- Precise synthetic PII corpus values.
- Exact README PII section / doctor note / CLI disclaimer wording (draft per locked stance, user reviews).
- Banned-phrase regex list + scanned string sources.
- `advisory`/`bestEffort` flag field name/shape in structuredContent.

## Deferred Ideas

None — discussion stayed within phase scope.
