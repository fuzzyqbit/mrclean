# Feature Research — v2.0 Native-Node PII/NER Layer

**Domain:** Opt-in PII/NER detection-and-redaction layer for an in-session LLM-boundary sanitizer (mrclean v2.0)
**Researched:** 2026-06-01
**Confidence:** HIGH (Presidio entity set + detection-method split verified via official docs; transformers.js NER path verified via HF model card + Xenova model; integration constraints drawn from existing mrclean PROJECT.md/REQUIREMENTS.md/spike 001)

> **Milestone scope:** This file covers ONLY the NEW PII/NER feature surface for v2.0. The v1 feature landscape (whole-product) is preserved in `FEATURES.v1.md`. Existing v1 machinery — secret regex/entropy/`.env`/`words.txt` layers, `<MRCLEAN:TYPE:NNN>` placeholders, audit log, 5-axis allowlist, dry-run/one-way modes, hook + MCP wiring — is treated as a fixed substrate the PII layer plugs into, not re-researched.

---

## How PII/NER Redaction Works (Reference Model: Microsoft Presidio)

Presidio is the de-facto open-source reference for "detect PII in free text and replace it." It frames the feature set as two cooperating stages. mrclean should mirror the *feature behavior* without adopting the Python stack (PROJECT.md defers a Presidio sidecar as a compliance-tier alternative, not the default).

**Stage 1 — Analyze (detect):** A set of recognizers each emit findings `{ entity_type, start, end, score }`. Recognizers come in three kinds, and the kind determines what can be caught:

| Recognizer kind | Catches | How | Examples in Presidio |
|-----------------|---------|-----|----------------------|
| **Pattern (regex + checksum)** | *Structured* PII with predictable shape | Regex match, often validated by a checksum (Luhn for cards, mod-97 for IBAN) | `CREDIT_CARD`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IP_ADDRESS`, `US_SSN`, `IBAN_CODE`, `CRYPTO` |
| **NER (ML model)** | *Unstructured* PII with no fixed shape | spaCy/transformers token classification | `PERSON`, `LOCATION`, `NRP`/org, medical entities |
| **Context enhancement** | Boosts a low-confidence pattern hit when nearby words support it | Scans a window around the span for keywords (`ssn`, `card`, `dob`) and raises `score` | layered on top of pattern recognizers |

**Why you need both regex AND NER (the load-bearing insight):** A person's name (`Sarah Chen`), an org (`Northwind Traders`), or a street address has *no regex signature* — it is identified only by linguistic role, which is exactly what NER does. Conversely, an SSN or credit-card number *does* have a signature and a checksum, and throwing an ML model at it is slower and *less* reliable than a regex+Luhn check. Presidio uses NER for the open-class entities and regex+checksum for the closed-class ones. mrclean's v1 already has the regex engine; the v2 gap is purely the NER half (names/orgs/locations).

**Confidence scores + thresholds:** Every finding carries a `score` (0.0–1.0). The tool applies a `score_threshold` (Presidio's documented default is low, ~0.35; for a *blocking* boundary tool a higher per-entity floor of 0.5–0.85 is appropriate) below which findings are dropped. Context words bump the score of marginal pattern hits over the line. This threshold mechanism is what keeps a PII layer from drowning the user in false positives — and it maps cleanly onto mrclean's existing per-rule severity/action model.

**Stage 2 — Anonymize (operate):** Presidio's operators — `replace`, `redact`, `mask`, `hash`, `encrypt`, `keep` — plus a `DeanonymizeEngine` that `decrypt`s with a key for reversibility. **mrclean already owns this entire stage:** its placeholder substitution = `replace`, its audit-hash = `hash`, its reversible-mode map = the `encrypt`/`decrypt` analog. **The PII layer does not need to build Stage 2 — it only needs to emit findings in the existing normalized `{ ruleId, severity, span, value, redactedHash, fingerprint }` shape (DET1-03) so the existing pipeline anonymizes, audits, and allowlists them.**

---

## Feature Landscape

### Table Stakes (Users Expect These)

A privacy tool that claims "PII detection" but misses an email or SSN feels broken. These are the closed-class, regex+checksum entities every comparable tool ships, plus the single most-expected NER entity (PERSON).

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **EMAIL_ADDRESS** detection | Most common PII in dev chatter; trivially regexable | LOW | Pure regex; reuse v1 Layer-1 ReDoS-safe engine. No model. |
| **PHONE_NUMBER** (US/NANP + E.164) | Ubiquitous; users assume it's caught | LOW–MED | Regex + light validation. NANP + E.164 covers the bulk; full international = differentiator. |
| **US_SSN** | The canonical "PII" example; high blocking value | LOW | Regex + format/area-number sanity check. High severity by default. |
| **CREDIT_CARD** | PCI-adjacent; must be caught | LOW | Regex + **Luhn checksum** to kill false positives (any 16-digit number). |
| **IP_ADDRESS** (v4 + v6) | Expected; cheap | LOW | Regex. High FP risk on version strings / `127.0.0.1` — allowlist private/loopback by default. |
| **PERSON** (names) via NER | The headline reason to add a *PII* layer at all — names are why regex isn't enough | **HIGH** | Requires the ONNX NER model (`Xenova/bert-base-NER`, CoNLL-2003 PER/ORG/LOC/MISC). This one item pulls in the entire ML runtime. |
| **Per-entity confidence threshold** | Without it the layer is unusable (FP avalanche) | MED | Each PII rule needs a tunable `min_score`; mirrors v1's entropy threshold pattern (DET2-01). |
| **Opt-in, default OFF** | Users opted into mrclean for *secrets*; PII must not silently change behavior or download a 100 MB model unasked | LOW | Config flag / `--pii`. Perf-exempt like Layer 5. Non-negotiable per PROJECT.md guardrails. |
| **Findings flow through existing placeholder + audit + allowlist** | A PII hit should behave exactly like a secret hit | LOW–MED | Emit v1 normalized finding shape; new `TYPE` values (`PII_PERSON`, `PII_EMAIL`, …). No new anonymizer code. |

### Differentiators (Competitive Advantage)

These set mrclean apart from "yet another PII regex pack" and lean into the Core Value (nothing leaves the box). Not required for a useful first PII release.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **ORG + LOCATION** via NER | Catches company names + internal place/codename leakage — overlaps mrclean's `words.txt` proprietary-term mission | LOW (incremental) | Same model already emits ORG/LOC/MISC tokens; cost is config + threshold tuning, not new runtime. High value for near-zero added cost. |
| **Fully local NER (no cloud PII API)** | The entire pitch: detect leakage without *causing* leakage | HIGH (already paid by PERSON) | transformers.js + ONNX runs in-process. The architectural differentiator vs every SaaS PII tool. |
| **Context-word score boosting** | Promotes marginal pattern hits (`dob: 01/02/90`), suppresses bare numbers | MED | Presidio's context-enhancer pattern; reuses the keyword-proximity idea already in entropy Layer 2 (DET2-03). |
| **IBAN / crypto-address** detection | Financial PII beyond US; checksum-validated | LOW–MED | Regex + mod-97 (IBAN) / base58check (crypto). Closed-class, no model. |
| **Per-entity action override (block/warn/audit)** | Treat PERSON as warn-only but US_SSN as hard-block — matches real risk tiers | LOW | Reuses v1 per-rule action config (CFG-02). PII entities are just more rule IDs. |
| **Zero-config lazy model fetch + cache** | Keeps `npx` install tiny; model downloads only on first opt-in | MED | Lazy-fetch `Xenova/bert-base-NER` int8 (~108 MB) to a cache dir on first PII-enabled session; never bundled. Critical to preserve zero-config UX. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Cloud PII API (AWS Comprehend / GCP DLP / Azure PII)** | "Best accuracy, no model to ship" | **Defeats the entire purpose** — sends the very text you're keeping local off-box to a third party. Self-contradiction for a privacy boundary tool. | Local ONNX NER only. Explicitly banned in PROJECT.md. |
| **Bundling the NER model in the npm package** | "Works offline instantly, no first-run download" | Breaks zero-config `npx` (100+ MB tarball); most users never opt into PII yet pay the weight. | Lazy-fetch + cache on first opt-in. |
| **PII layer as a hard blocking gate by default** | "Maximum safety" | NER is probabilistic; false positives on common words/names would block legitimate prompts and train users to disable mrclean. Secrets are deterministic and *earn* hard-block; PII does not. | Default OFF; when on, default action `warn`/`audit` for NER entities, `block` reserved for high-confidence checksum'd entities (SSN/card). Secrets remain the only default hard gate. |
| **Running NER on every hook event incl. 50 KB PostToolUse payloads** | "Catch PII everywhere" | A BERT forward pass over 50 KB of tool output blows the <200 ms PostToolUse budget by orders of magnitude. | Perf-exempt opt-in; run NER on UserPromptSubmit (bounded prompt) + size/span-gated. Regex PII can run on all events (cheap). |
| **DATE_TIME / age / generic quasi-identifier redaction** | "GDPR completeness" | Dates/ages are pervasive in code/logs (timestamps, versions); redacting them shreds context and floods the audit log. | Leave out of default set; offer as explicit opt-in entities only. |
| **Multi-language NER models by default** | "Support non-English repos" | Multilingual models are larger and slower; English `bert-base-NER` covers the dominant case. | English default; multi-language as a `v2+` configurable model swap. |
| **Model-facing `unredact`/`disable_pii` MCP tool** | "Let Claude restore names" | One prompt-injection from total bypass — same reasoning as v1 MCP-03. | Restoration stays deterministic in PostToolUse; MCP surface stays read/transform only. |

---

## Feature Dependencies

```
[PERSON / ORG / LOCATION (NER)]
    └──requires──> [ONNX NER runtime: transformers.js + Xenova/bert-base-NER]
                       └──requires──> [Lazy model fetch + cache (zero-config UX)]
    └──requires──> [Per-entity confidence threshold]
                       └──enhanced-by──> [Context-word score boosting]

[All PII entities]
    └──requires──> [v1 normalized finding shape {ruleId,severity,span,value,redactedHash,fingerprint}]
                       └──feeds──> [v1 placeholder substitution  (TYPE = PII_*)]
                       └──feeds──> [v1 audit log (AUDIT-01/02)]
                       └──gated-by──> [v1 5-axis allowlist (rules/paths/stopwords/regexes/fingerprints)]
                       └──configured-by──> [v1 per-rule action + severity (CFG-02)]

[Opt-in flag (default OFF)] ──gates──> [entire PII layer]
    └──parallels──> [v1 Layer-5 --deep opt-in + perf-exempt model]

[Regex PII (email/phone/ssn/card/ip/iban)]
    └──reuses──> [v1 Layer-1 ReDoS-safe regex engine (DET1-04)]
    └──NO dependency on the NER runtime  (ships independently, cheaper, runs on all hook events)

[NER PII] ──conflicts-with──> [<100ms / <200ms hook budget]
    (resolved by perf-exempt opt-in + event/size gating)
```

### Dependency Notes

- **NER entities require the ONNX runtime; regex entities do not.** The single most important scoping fact: email/phone/SSN/card/IP/IBAN can ship as a pure-regex sub-feature reusing the v1 Layer-1 engine with *zero* new heavy dependencies, while PERSON/ORG/LOCATION drag in transformers.js + a ~108 MB model. Scope them as two separate requirement clusters so the cheap half can land independently.
- **Everything reuses Stage-2 machinery.** PII findings are anonymized, audited, and allowlisted by the *existing* v1 pipeline. The only integration contract is the normalized finding shape (DET1-03) + new `TYPE` strings. No new placeholder/audit/allowlist code.
- **Opt-in mirrors Layer 5.** The `--deep`/LLM5 opt-in + perf-exempt pattern is the precedent; the PII layer is "Layer 6"-shaped — off by default, exempt from the latency gate, lazy-loaded.
- **NER conflicts with the perf budget,** resolved by (a) opt-in exemption, (b) running NER only on bounded events (UserPromptSubmit) or size-capped spans, (c) keeping regex PII on the cheap path so the always-affordable entities are still covered when NER is off.
- **Allowlist interplay:** the 5-axis allowlist must apply to PII rules identically — `stopwords` to whitelist a common name that is actually a code symbol (`README`, `Mark` as a git verb), `rules` to disable a noisy entity, `fingerprints` for one-off FP feedback via `mrclean ignore`.

---

## MVP Definition

### Launch With (v2.0 PII MVP)

- [ ] **Opt-in flag, default OFF, perf-exempt** — non-negotiable guardrail; without it the layer can't ship safely.
- [ ] **Regex PII pack (email, US phone, US_SSN, credit-card+Luhn, IPv4/IPv6)** — high value, low cost, no model dependency; this alone is a shippable PII story.
- [ ] **PERSON via `Xenova/bert-base-NER` (int8 ONNX) on transformers.js** — the reason this is a *PII/NER* milestone, not just more regex.
- [ ] **Lazy model fetch + cache on first opt-in** — protects zero-config `npx`.
- [ ] **Per-entity confidence threshold + per-entity action (block/warn/audit)** — usability floor; NER without a threshold is unshippable.
- [ ] **Emit into existing finding shape → placeholder (`PII_*` TYPE) + audit + allowlist** — integration contract; "free" because it reuses v1.
- [ ] **NER runs on UserPromptSubmit (bounded); regex PII on all events** — keeps the perf story honest.

### Add After Validation (v2.x)

- [ ] **ORG + LOCATION entities** — same model, mostly threshold tuning; split out to validate PERSON FP rate first. Trigger: PERSON detection proves low-noise in real sessions.
- [ ] **Context-word score boosting** — add once real FP/FN data shows which marginal hits need promotion. Trigger: measured FP/FN on the SSN/phone classes.
- [ ] **IBAN + crypto-address (checksum-validated)** — extend regex pack. Trigger: user demand / non-US finance use.
- [ ] **NER on size-capped PostToolUse spans** — Trigger: profiling shows a safe span budget under the perf-exempt path.

### Future Consideration (v3+)

- [ ] **Multi-language / swappable NER model** — defer; English covers the dominant case and larger models hurt footprint. Trigger: non-English repo demand.
- [ ] **Medical / PHI entities (NER)** — Presidio uses dedicated medical NER models; a compliance-tier feature, likely the deferred Presidio-sidecar path in PROJECT.md, not native.
- [ ] **Country-specific gov IDs (UK NHS/NINO, passports, etc.)** — long-tail; Presidio's deferred-compliance-tier territory.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Opt-in flag / default OFF / perf-exempt | HIGH | LOW | P1 |
| Regex PII (email/phone/SSN/card/IP) | HIGH | LOW | P1 |
| PERSON via ONNX NER | HIGH | HIGH | P1 |
| Lazy model fetch + cache | HIGH | MEDIUM | P1 |
| Per-entity threshold + action override | HIGH | MEDIUM | P1 |
| Flow into placeholder/audit/allowlist | HIGH | LOW | P1 |
| ORG + LOCATION (NER) | MEDIUM | LOW | P2 |
| Context-word score boosting | MEDIUM | MEDIUM | P2 |
| IBAN + crypto-address | MEDIUM | LOW | P2 |
| NER on capped PostToolUse spans | MEDIUM | MEDIUM | P2 |
| Multi-language NER | LOW | HIGH | P3 |
| Medical/PHI entities | LOW | HIGH | P3 |
| Country-specific gov IDs | LOW | MEDIUM | P3 |

**Priority key:** P1 = must have for v2.0 launch · P2 = should have, add post-validation · P3 = future consideration.

---

## Competitor / Reference Feature Analysis

| Feature | Microsoft Presidio (reference) | Cloud PII (AWS Comprehend / GCP DLP) | mrclean v2 Approach |
|---------|-------------------------------|--------------------------------------|---------------------|
| Engine | spaCy/transformers NER + regex + context + checksums (Python, heavy) | Managed ML, off-box | **Local ONNX NER (transformers.js) + v1 regex** — Presidio's *behavior*, not its stack |
| Structured PII (email/ssn/card) | Pattern recognizers + checksums | Server-side | Reuse v1 regex engine + Luhn/mod checks |
| Names/orgs/locations | NER model required | Server-side ML | `Xenova/bert-base-NER` int8, lazy-fetched |
| Reversibility | `encrypt` → `DeanonymizeEngine.decrypt` (key) | n/a | Existing in-memory placeholder map (one-way default; reversible = v1.x REVMODE) |
| Confidence / threshold | Per-finding `score` + `score_threshold` + context boost | confidence scores | Per-entity `min_score` + reuse entropy-style context keywords |
| Where it runs | Explicit SDK call in your pipeline | API call | **In-the-wire** Claude Code hook + MCP, automatic when opted in |
| Footprint | `pip` + hundreds of MB model | zero local | Tiny npm + lazy ~108 MB model only on opt-in |
| Default posture | n/a (library) | n/a | **OFF by default; secrets remain the hard gate, PII defaults to warn/audit for NER** |

---

## Sources

- [Microsoft Presidio — Supported PII Entities](https://microsoft.github.io/presidio/supported_entities/) — HIGH: verified the global vs US vs country-specific entity split and that most entities use "pattern match and context" while medical entities use HuggingFace NER models.
- mrclean spike 001 `vs-presidio` (`.planning/spikes/001-vs-presidio/README.md`) — HIGH: complementary-coverage finding, Presidio entity list + anonymizer operators, mrclean's zero-PII baseline confirmed live.
- [Xenova/bert-base-NER (Hugging Face)](https://huggingface.co/Xenova/bert-base-NER) and base [dslim/bert-base-NER](https://huggingface.co/dslim/bert-base-NER) — HIGH: ONNX/transformers.js token-classification model; CoNLL-2003 PER/ORG/LOC/MISC entity classes.
- [Transformers.js docs](https://huggingface.co/docs/transformers.js/en/index) and [@huggingface/transformers npm](https://www.npmjs.com/package/@xenova/transformers) — HIGH: in-process ONNX NER in Node, `pipeline('token-classification', ...)` API, same code browser/Node.
- mrclean `PROJECT.md` + `REQUIREMENTS.md` — HIGH: opt-in/perf-exempt precedent (Layer 5), normalized finding shape (DET1-03), 5-axis allowlist (CFG-02), placeholder format (PH-01), MCP read/transform-only guardrail (MCP-03), zero-config + no-cloud-PII guardrails.

---
*Feature research for: opt-in native-Node PII/NER layer at the LLM boundary (mrclean v2.0)*
*Researched: 2026-06-01*
