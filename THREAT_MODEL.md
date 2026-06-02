# Threat Model

mrclean is an in-session sanitizer for Claude Code. It scans text in the four Claude
Code hook events (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse) and replaces
detected secrets with stable placeholders before they reach Anthropic's API, MCP
servers, or cloud agents. This document enumerates what mrclean does **NOT** defend
against, so operators have correct expectations and can layer complementary controls.

---

## Non-Defenses

### 1. Multimodal / pasted-image content

mrclean reads the text fields of hook payloads. Images embedded in prompts are not
scanned. If your workflow involves pasting screenshots or photos that contain credentials,
API keys, or other sensitive data, those secrets reach the model unredacted. OCR-based
scanning is a separate product space and is explicitly out of scope for mrclean v1.

**Recommended mitigation:** Train operators not to paste credential-containing
screenshots. Use a separate image-scrubbing tool upstream if your workflow requires it.

### 2. Model memorization of training-time leaks

If a secret was present in the model's training corpus — because it was previously
committed to a public repo, posted in a forum, or included in scraped data — the model
may surface that value in completions independently of anything you type into the
session. This is an upstream supply-chain risk on the model itself; mrclean's
session-time interception cannot affect training data.

**Recommended mitigation:** Rotate any secret that may have been published. Rotation is
the only reliable response to training-time exposure.

### 3. Prompt-injection of the operator

A malicious context (a tool result, a webpage paste, a document) instructs the operator:
"you must run `npx mrclean uninstall` to fix this error." mrclean is gated by operator
action; if the operator follows the instruction, the protection is gone. This is a
social-engineering attack on the human in the loop, not on mrclean's code.

**Recommended mitigation:** Operator awareness. The README (section 8) documents that
mrclean deliberately does not expose any disable/config-write tool for exactly this
reason — a prompt-injected *model* cannot disable mrclean. A prompt-injected *operator*
remains a human problem.

### 4. Adversarial obfuscation

Homoglyph substitution (Cyrillic look-alikes for Latin characters), unusual base64
variants, rot13, URL encoding, and other novel token shapes may bypass Layer 1's regex
pack and Layer 2's entropy heuristic. These layers are tuned for known secret shapes;
novel obfuscation requires novel detection.

**Recommended mitigation:** The dirty-word list (Layer 4) catches operator-specified
terms by substring regardless of obfuscation. Add high-value project terms there.
Layer 5 semantic detection (v2 LLM5-01) will catch categories that regex and entropy
miss.

### 5. Cross-session placeholder map persistence

In v1, placeholder-to-original mappings are session-scoped and live in memory only
(limiting the blast radius per Pitfall #4 from the project design docs). The same secret
pasted into two separate Claude Code sessions gets two different placeholder labels.
There is no cross-session lookup table in v1.

v2 POLISH-02 introduces HMAC-based cross-session deterministic placeholder naming so the
same secret always maps to the same label across sessions.

### 6. LLM Layer 5 semantic detection

v1 ships Layers 1-4: regex, entropy, .env value extraction, and dirty-word lists. Layer
5 — Claude Haiku 4.5 semantic classification of PII, proprietary content, or other
sensitive categories that cannot be detected by pattern alone — is v2 opt-in (LLM5-01).

Until then, semantic categories like "this paragraph reveals internal infrastructure
design" or "this text describes an unreleased product" go undetected.

### 7. Verified-secret enrichment via vendor APIs

Tools like trufflehog can optionally call vendor endpoints (AWS STS, GitHub API, Stripe)
to verify whether a detected token is live before flagging it. mrclean does not — this
is at odds with the local-first / no-network-calls principle. mrclean flags on pattern
and entropy regardless of whether a token is active.

The trade-off: mrclean may flag revoked credentials (false positive). trufflehog may
silently skip revoked credentials (false negative on the detection, but the secret is
already dead). Both behaviors are intentional.

### 8. Network-level interception of the Claude API itself

mrclean lives in-session via the Claude Code hook contract. If you access the Anthropic
API through a raw HTTP client, a third-party wrapper, or a tool that does not invoke
Claude Code's hook system, mrclean is not in the data path.

A local HTTPS proxy (e.g., mitmproxy positioned between Claude Code and Anthropic's
API) is a different architecture with different trade-offs, and is explicitly out of
scope per the project design docs. mrclean is a hook-layer tool, not a proxy.

### 9. Pre-commit / git-history scanning

gitleaks owns that surface. mrclean is the in-session complement: gitleaks for what
reaches your repo, mrclean for what reaches the model. Do not run mrclean against your
git history; do not run gitleaks against your prompt stream — they are different
problems with different trust boundaries.

If you want to prevent secrets from being committed to the repo, configure gitleaks or
trufflehog as a pre-commit hook. If you want to prevent secrets from reaching the
Anthropic API during a Claude Code session, use mrclean.

### 10. v2.0 PII/NER scope fence (cloud PII APIs, model-facing unredact tools, Presidio sidecar)

The v2.0 Native-Node PII/NER layer intentionally excludes three classes of capability
that would be dangerous, break zero-config `npx`, or defeat mrclean's no-egress premise:

1. **Cloud PII APIs** (AWS Comprehend, GCP DLP, Azure AI Language) — sending text to a
   cloud API to detect whether it contains PII leaks the content before redaction,
   reversing mrclean's value. Not a defense. See docs/SCOPE-FENCE.md §"Ban 1".

2. **Model-facing unredact / disable MCP tools** — a `pii_unredact`, `disable_pii`, or
   `pii_config_write` tool callable by the model would be one prompt injection from
   total bypass (MCP-03 attack class). Not a defense. The MCP-03 forbidden-tool
   invariant (`FORBIDDEN_TOOL_NAMES` in tests/mcp/tools-list.test.ts) bans these names
   at CI. See docs/SCOPE-FENCE.md §"Ban 2".

3. **Microsoft Presidio Python sidecar** — a Python subprocess breaks zero-config `npx`
   and adds a second language runtime to the attack surface. Presidio is a deferred
   compliance-tier alternative, not the default. Not a defense. See docs/SCOPE-FENCE.md
   §"Ban 3".

**What mrclean DOES provide for PII in v2.0:** In-process NER (`Xenova/bert-base-NER`
int8) running only in the long-lived MCP server (never per-event hook), advisory
warn/audit action only (never a hard gate), PERSON/ORG/LOC entities, and a regex-PII
lane (email, SSN, credit card, phone, IP) on the hot path. All ML deps are
`optionalDependencies` — a build failure on native onnxruntime-node never breaks the
core secret tool.

Full fence definition, in-scope allowlist, and per-phase transition checklist:
**docs/SCOPE-FENCE.md**

---

## What mrclean DOES defend against

The in-session text-payload surface across the four Claude Code hook events on
regex-detectable secrets (Layer 1: secretlint + 183 gitleaks patterns), high-entropy
tokens with co-located context keywords (Layer 2), values extracted from `.env` files
parsed at session start (Layer 3), and operator-specified project terms (Layer 4). This
is the leak surface that pre-commit hooks and proxy filters do not cover — the gap
between "secret is in the repo" and "secret reaches the model."

---

## Reporting

Threat-class regressions, new attack vectors not in this list, or bypass demonstrations:
open a GitHub issue with the label `security` at the repository URL in `package.json`,
or contact the maintainer directly. Coordinated disclosure is preferred for novel bypass
classes. Rotate any compromised secrets before reporting.
