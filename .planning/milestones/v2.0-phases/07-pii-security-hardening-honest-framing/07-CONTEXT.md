# Phase 7: PII Security Hardening & Honest Framing - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the security and trust surface a security tool is held to, auditing the fully-integrated
PII surface (secrets + regex-PII + NER) end-to-end. Two deliverables:

1. **PIISEC-01 — leak-grep regression test:** known PII (synthetic SSN/email/name/card) fed
   through the full pipeline, asserting none of those raw values appear anywhere in
   `.mrclean/audit.jsonl` OR in stderr/error/diagnostic output — including deliberately-triggered
   exception paths (corrupt/missing model, NER inference failure, supervisor catch).
2. **PIISEC-02 — honest framing:** all user-facing copy frames the PII/NER layer as a best-effort
   ML recall aid (NER false negatives CAN leak), explicitly NOT a guarantee, with secrets +
   `words.txt` + deterministic layers as the real must-not-leak mechanism. Framing consistent
   across README, CLI, `mrclean doctor`, and MCP tool output.

Requirements: PIISEC-01, PIISEC-02 (2).

**Out of scope (other phases / locked fences):** no new detection capability, no NER tuning,
no reversible PII placeholders, no cloud PII APIs, no model-facing unredact tool, no Presidio
sidecar (PIISEC-03 scope fence locked in Phase 4). This phase HARDENS and FRAMES the existing
surface — it does not extend detection.
</domain>

<decisions>
## Implementation Decisions

### Leak-grep regression test (PIISEC-01)
- **D-01:** Build a **dedicated PII leak corpus** — distinct, easy-to-grep synthetic values
  (test SSN, email, person name, credit-card number) chosen so a grep for each raw string is
  unambiguous. Fed through the full pipeline; assert none appear in `audit.jsonl` OR stderr.
  Reuse the existing `tests/audit/canary-leak.test.ts` harness rather than inventing a new one.
- **D-02:** Cover a **representative set of deliberately-triggered failure paths**, not every
  catch block. Required forced-failures: corrupt/missing model, NER inference throw, supervisor
  catch. Rationale: exhaustive per-catch enumeration is brittle and high-maintenance as code
  grows; a representative set of the real PII-carrying error paths gives the guarantee without
  the churn.

### Structural guard — error-sanitization chokepoint (PIISEC-01)
- **D-03:** Go **beyond test-only**: add ONE central `sanitizeForOutput()` chokepoint applied at
  the stderr/error sink and exception formatting, scrubbing anything matching detected spans
  before it is written. Leaks become structurally impossible (defense-in-depth for a security
  tool), AND the D-01 test proves it. Single chokepoint — not scattered guards.
- **D-04 (constraint for planner):** Exception paths that fire WITHOUT a detection context
  (e.g. model-load failure before any PII is parsed) have no spans to scrub — the chokepoint
  must additionally ensure error messages from those paths **never echo raw input text**
  (emit structured/static messages, not the offending payload). The chokepoint lives on error
  paths only — it must NOT touch the < 100 ms hook hot path or the secret-detection gate.

### Honest-framing surfacing (PIISEC-02)
- **D-05:** Disclaimer surfaces on **all surfaces, once per output**: README PII section +
  one-line `mrclean doctor` note + CLI/banner line. Disclaimer appears ONCE per output, NOT
  per finding (avoids noise on prose with many entities).
- **D-06:** Add a **stable machine-readable flag** (e.g. `advisory` / `bestEffort: true`) on NER
  findings in MCP `check`/`redact` `structuredContent`, so the best-effort asterisk is present
  wherever NER findings surface programmatically — satisfying SC-3 ("probabilistic asterisk
  visible wherever PII results surface") without per-finding visual repetition.
- **D-07:** Framing content stance (locked): "best-effort ML PII hint, not a guarantee"; NER
  false negatives can leak; `words.txt` + deterministic layers (secrets + checksum'd PII) are
  the real must-not-leak mechanism; secrets remain the deterministic guarantee. No language
  drifting toward "redacts all PII" or compliance claims.

### Banned-phrase enforcement (PIISEC-02)
- **D-08:** Add a **CI grep test** that fails the build if user-facing strings (README PII
  section, CLI output, doctor output, MCP tool descriptions) contain compliance/guarantee
  language — e.g. "redacts all PII", "compliant", "guarantee(s)", "GDPR", "HIPAA". Cheap
  insurance against future copy drift toward overclaiming. (Planner: define the banned-phrase
  list + which string sources are scanned.)

### Claude's Discretion
- Exact `sanitizeForOutput()` signature, location, and how detected spans are threaded to it.
- Precise synthetic PII corpus values (must be obviously fake yet realistic-shaped).
- Exact wording of the README PII section, doctor note, and CLI/banner disclaimer line —
  draft per D-07 stance; user reviews.
- Exact banned-phrase regex list and the set of string sources the CI test scans.
- Response-field name/shape for the `advisory`/`bestEffort` flag in structuredContent.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §PIISEC-01, §PIISEC-02 — the 2 phase requirements verbatim
  (PIISEC-03 scope fence already satisfied in Phase 4 — do not re-implement).
- `.planning/ROADMAP.md` §"Phase 7" — goal + 3 success criteria.

### Prior decisions this phase frames honestly
- `.planning/phases/06-ner-inference-l6b-mcp-wiring/06-CONTEXT.md` — D-02 (NER substitutes but
  NEVER blocks — advisory), and the `<specifics>` note that the substitution-vs-advisory tension
  must be framed honestly here (recall is best-effort, false negatives can leak).
- `.planning/research/ARCHITECTURE-v2-pii.md` — "NER is a best-effort recall aid, secrets are
  the deterministic gate" framing rationale; the two-lane Layer 6 design.

### Implementation surfaces (existing code Phase 7 hardens/frames)
- `src/audit/log.ts` — `AuditRecord` + `findingToAuditRecord` (LOCKED no-raw-value sink;
  excludes `finding.value`). The leak-test asserts this holds for PII too.
- `tests/audit/canary-leak.test.ts` — existing secrets leak-grep harness to EXTEND with PII.
- `tests/fixtures-corpus.test.ts` — existing positive/negative corpus pattern for reference.
- `src/mcp/supervisor.ts` — `supervisedToolCall` catch boundary (a forced-failure path; also a
  candidate `sanitizeForOutput()` integration point for tool errors).
- `src/detect/layer6b-ner.ts` + the pipeline/model-load path — NER inference-failure paths to
  exercise; source of the `advisory`/`bestEffort` flag.
- `src/mcp/tools/check.ts` + `src/mcp/tools/redact.ts` — structuredContent surfaces for D-06 flag.
- `src/doctor/index.ts` + `src/doctor/checks.ts` — doctor output for the D-05 framing note.
- `src/cli.ts` — CLI/banner output + a stderr/error sink (chokepoint + banned-phrase target).
- `README.md` — §10 "What this does NOT defend against" + §11 exist; NEW PII framing section to
  add (currently the PII/NER layer is UNMENTIONED in user copy — framing is greenfield).
- `docs/SCOPE-FENCE.md` — existing scope-fence doc (Phase 4); align framing, do not contradict.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tests/audit/canary-leak.test.ts` — secrets-only leak-grep test; the PII leak test reuses its
  harness/assertion shape (feed corpus → run pipeline → grep audit.jsonl for raw values).
- `findingToAuditRecord` + `AuditRecord` (`src/audit/log.ts`) — already LOCKED to hash/fingerprint
  only; PII inherits the no-raw guarantee, the test verifies it end-to-end.
- `supervisedToolCall` (`src/mcp/supervisor.ts`) — existing Promise-isolation catch boundary;
  natural home for routing tool-error output through `sanitizeForOutput()`.

### Established Patterns
- Audit no-raw-value rule is enforced at a SINGLE sink (`findingToAuditRecord`) — mirror that
  single-chokepoint discipline for the new error-output guard (D-03).
- Positive/negative fixture-corpus testing pattern (`tests/fixtures-corpus.test.ts`) is the model
  for the dedicated PII leak corpus.

### Integration Points
- New: a `sanitizeForOutput()` helper (single chokepoint) on the stderr/error + exception path.
- New: PII leak-grep test (extends `tests/audit/canary-leak.test.ts`).
- New: banned-phrase CI grep test over user-facing string sources.
- New: README PII framing section + doctor note + CLI/banner disclaimer line + structuredContent
  `advisory`/`bestEffort` flag.
</code_context>

<specifics>
## Specific Ideas

- The honest-framing stance is deliberately asymmetric: **secrets = deterministic guarantee,
  PII/NER = best-effort recall aid that can have false negatives.** Copy must never blur the two
  into "mrclean redacts your PII." The disclaimer points users to `words.txt` + deterministic
  layers as the real must-not-leak lever.
- Defense-in-depth was chosen over literal-minimalism for PIISEC-01: a runtime chokepoint PLUS
  the test, because a security tool leaking the very PII it claims to scrub — via an error
  message — is the worst-case trust failure.
</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Reversible PII placeholders, additional model
tiers, cloud PII APIs, unredact tool, and Presidio sidecar remain explicitly out of scope per
the locked Phase 4 scope fence.)
</deferred>

---

*Phase: 7-PII Security Hardening & Honest Framing*
*Context gathered: 2026-06-03*
