# mrclean v2.0 Scope Fence

This document defines the **enforceable bans** and **in-scope allowlist** for the
v2.0 Native-Node PII/NER Layer milestone. It exists because the easiest way to drift
from "a focused in-session sanitizer with opt-in PII detection" into "a worse Presidio
in Node" is for each phase to make one small exception that looks harmless in isolation.
The fence makes the collective boundary legible and enforces it at every phase transition.

**Authority:** The Hard Scope Fence decision is locked in STATE.md §"Decisions Made" and
is a non-defense in THREAT_MODEL.md §Non-Defenses ###10. Any amendment requires updating
both this document and the STATE.md decision entry.

---

## Banned Categories

### Ban 1: Cloud PII APIs

**Status:** BANNED in the default distribution.

**Covers:** AWS Comprehend, GCP Cloud DLP, Azure AI Language (and any other cloud-hosted
NLP/PII classification service that receives user text as input).

**Rationale:** Sending text to a cloud API to detect whether it contains PII **defeats the
no-egress premise** that is mrclean's core value proposition. The entire point of mrclean
is that real secrets and proprietary terms never reach the wire. Routing text through a
cloud PII API would leak the very content mrclean is supposed to protect — before the
redaction has been applied.

Even if the cloud vendor promises to not retain data, the network call itself is an
egress event that:
1. Bypasses the local hook interception model.
2. Introduces latency that violates the < 100 ms UserPromptSubmit budget.
3. Creates a new data-handling liability for the operator.

**What to do instead:** Use the in-process NER model (`Xenova/bert-base-NER` int8 via
`@huggingface/transformers`) in the long-lived MCP server. It runs entirely on-device, is
perf-exempt (MCP server is a warm singleton, not the per-event hook), and has no network
footprint.

**Transition checklist item:** `[ ] no cloud API client added` (see below).

---

### Ban 2: Model-Facing Unredact / Disable MCP Tool

**Status:** BANNED. No MCP tool with an unredact, disable, or config-write purpose may
appear in the MCP server's `tools/list` response.

**Covers:** Any tool whose purpose is to reverse a redaction applied by mrclean, disable
the sanitizer, suppress detection for a category, or write new detection rules — when
that tool is callable by the model (i.e., exposed via MCP `tools/list`).

**Examples of banned tool names:**
- `pii_unredact`, `mrclean_pii_unredact`
- `unredact`, `mrclean_unredact` (already banned — MCP-03 pre-v2.0)
- `disable_pii`, `disable`
- `add_pii_word`, `add_word`
- `pii_config_write`, `config_write`

**Rationale:** A model-facing unredact/disable tool is **one prompt injection away from
total bypass**. The attack is trivial: a malicious tool result or pasted document tells
the model to call `pii_unredact` on the redacted content, and the user's redaction is
reversed before it reaches the model's context. mrclean's read/transform-only invariant
(MCP-03) is the architectural guarantee against this attack class.

The MCP-03 forbidden-tool invariant test (`tests/mcp/tools-list.test.ts` T2b) enforces
this at every CI run. The `FORBIDDEN_TOOL_NAMES` list in that test is extended with all
PII-write/unredact names in Phase 4 (this phase).

**Permitted:** Operator-facing CLI commands that restore redacted text ARE permitted (they
require explicit local operator action, not a model call). Only the MCP tool surface is
banned.

**Transition checklist item:** `[ ] no write/unredact MCP tool` (see below).

---

### Ban 3: Microsoft Presidio Python Sidecar (Default Distribution)

**Status:** BANNED in the default distribution.

**Covers:** A Python sidecar process running Microsoft Presidio (or any Python-runtime
NLP library: spaCy, Flair, transformers via pip) launched by mrclean on first run.

**Rationale:** A Python sidecar **breaks the zero-config `npx` UX**. Users install mrclean
with a single `npx mrclean install` command. Requiring Python 3.x + pip + a separate
`pip install presidio-analyzer` step destroys the zero-friction install promise and
introduces a Python runtime as a system dependency. It also adds a second language
ecosystem to the attack surface and dependency chain.

Microsoft Presidio is an excellent tool for compliance workloads that need custom
recognizers, 50+ entity types, and multi-language support. That is a different product
than mrclean. mrclean is focused on the developer-session leak surface with a narrow
entity set (the entities that actually appear in Claude Code sessions: names, orgs,
locations, emails, SSNs, credit cards, phone numbers, IPs).

**Deferred path:** Presidio is explicitly noted as a compliance-tier alternative in
PROJECT.md. It may be added as an optional sidecar integration (not the default) in a
future milestone, behind a `--presidio` flag, with the operator responsible for having
Python + Presidio installed. This is not v2.0 scope.

**Transition checklist item:** `[ ] no Presidio/Python sidecar in default distribution` (see below).

---

## In-Scope Allowlist

These are the **only** PII/NER capabilities in scope for the v2.0 milestone:

| Feature | Detail | Phase |
|---------|--------|-------|
| Default NER model | `Xenova/bert-base-NER` int8 (~108 MB, ONNX) | Phase 6 |
| Optional piiranha tier | piiranha-v1-detect-personal-information (higher recall, larger) | Phase 6 (opt-in) |
| NER entity types | PERSON, ORG, LOC only | Phase 6 |
| Regex structured-PII (L6a) | email, US SSN, credit card + Luhn, phone, IP address | Phase 5 |
| ML dependency declaration | `@huggingface/transformers@^4.2.0`, `onnxruntime-node@^1.24.3` as `optionalDependencies` | Phase 4 (this phase) |
| PII placeholder format | `<MRCLEAN:PII:NNN>` reusing existing PlaceholderManager | Phase 5/6 |
| PII audit log fields | `engine`, `model_rev`, `quant`, `backend` appended to existing schema | Phase 4 |
| NER execution location | Long-lived MCP server ONLY (never per-event hook) | Phase 6 |
| NER action default | warn/audit (advisory, never a hard gate) | Phase 6 |

**Explicitly not in v2.0 scope:** multi-language NER, custom entity recognizer DSL,
model zoo / multiple default models, PII placeholder reversibility, cloud PII APIs,
Presidio sidecar, GLiNER models, more than the listed entity types.

---

## Transition Checklist

Run this checklist at **every phase boundary** (before `/gsd-transition`) for v2.0
Phases 4 through 7. If any item cannot be checked off, it is a scope-fence violation
that must be resolved before the phase can close.

```
v2.0 Scope Fence — Phase Boundary Checklist
Phase: ____

[ ] No new entity type added beyond the locked set (PERSON, ORG, LOC, email, SSN,
    CC+Luhn, phone, IP) without a formal fence amendment in this document + STATE.md.

[ ] No cloud API client added (no AWS SDK, GCP SDK, Azure AI SDK, or any HTTP client
    call to a cloud NLP endpoint touching user text).

[ ] No write/unredact MCP tool (no tool in tools/list with unredact, disable, or
    config-write purpose; FORBIDDEN_TOOL_NAMES in tests/mcp/tools-list.test.ts must
    still pass T2b).

[ ] No Presidio/Python sidecar in default distribution (no Python subprocess spawned
    on the default install path; optional sidecar integration, if any, must be gated
    behind an explicit opt-in flag and documented as not-default).

[ ] ML deps still declared as optionalDependencies (not promoted to dependencies);
    tests/install/optional-deps.test.ts still green.

[ ] Core install verified ML-dep-absent: `npm install --no-optional && node -e
    "require('./dist/cli.js')"` succeeds without @huggingface/transformers or
    onnxruntime-node present.

[ ] No static import of @huggingface/transformers or onnxruntime-node on any cold
    path (hook binary entry, MCP server startup, CLI startup). Only lazy/dynamic
    import inside the NER singleton (Phase 6+) is permitted.

Signed off by: __________________  Date: __________
```

---

## Cross-References

| Reference | Location | Why |
|-----------|----------|-----|
| MODEL-01 requirement | REQUIREMENTS.md | ML deps declared optional; core install ML-dep-absent |
| PIISEC-03 requirement | REQUIREMENTS.md | No cloud PII API, no model-facing unredact tool |
| Hard scope fence decision | STATE.md §Decisions Made | Authoritative decision record |
| MCP-03 forbidden-tool invariant | tests/mcp/tools-list.test.ts T2b | CI enforcement of Ban 2 |
| MODEL-01 dep structure invariant | tests/install/optional-deps.test.ts | CI enforcement of optionalDependencies |
| Non-Defense entry | THREAT_MODEL.md ###10 | Threat model cross-link |
| Pitfall 2 (ML deps optional) | .planning/research/PITFALLS.md | Research basis for Ban 3 optionality |
| Pitfall 7 (cloud PII ban) | .planning/research/PITFALLS.md | Research basis for Ban 1 |
| Pitfall 11 (scope creep) | .planning/research/PITFALLS.md | Research basis for the fence itself |

---

*Document created: Phase 4, Plan 03 — PII Contracts & Architecture Foundations*
*Amendment history: none (initial version)*
