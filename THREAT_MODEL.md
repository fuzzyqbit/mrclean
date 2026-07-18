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

## Reversible Mode (v3.0)

v3.0 ships an opt-in reversible-redaction mode: a session-scoped, encrypted
placeholder→original map (the Phase 9 session store) plus an operator-only
`mrclean restore` CLI and its `mrclean doctor` reversible-state check (Phase 10).
The default remains one-way — no map exists at all unless the operator opts in —
and the reversible code provably leaves the one-way path alone:
tests/hook/dist-parity.test.ts spawns the shipped `dist/cli.js` hook and asserts
one-way and reversible stdouts are deep-equal (after v2 nonce-tail normalization)
with the raw secret canary absent from both, and tests/state/cold-path.test.ts
fences state/lockfile/atomic-write imports out of the hook-reachable module graph
in both directions.

This section was finalized on 2026-07-17, with every claim below
verified against the shipped implementation: it is an audit of code that
exists, and the CI gate that locks each claim is cited inline.

### 1. Map blast radius

Opting into reversible mode consents to encrypted, session-scoped disk state: a
per-session map file under `~/.mrclean/sessions/` (AES-256-GCM, key material in a
separate directory outside the project tree, removed on session end or by the TTL
orphan sweep). The threat question: what does an attacker who obtains a fully
exfiltrated, fully decrypted map actually get?

One session's restorable vocabulary — the file paths, names, and project identifiers
that were placeholder-swapped in that session — and nothing from any other session.
Maps are session-scoped (T2): there is no cross-session lookup table, so N leaked
maps expose N sessions' terms, never the whole project history. Secret-class
originals are structurally absent from the map (see the secret floor below), so a
leaked map never contains keys, tokens, or credentials.

Redaction never depends on the map. tests/state/chaos.test.ts drives the real
PostToolUse handler against six map-corruption shapes (corrupt byte, truncated
envelope, chmod 000, path-is-directory, mid-session delete, garbage key) and
asserts the hook response stays deep-equal to the one-way baseline — restore fails
one-way while redaction stays fail-closed. tests/state/stress.test.ts holds the
store's integrity under a 16-process contention burst (400 contended transactions,
zero lost entries, zero degrades).

**Consequence:** the worst-case map leak is a confidentiality loss over one session's
naming vocabulary — comparable to leaking that session's prompt text — not a
credential compromise. Nothing needs rotation; treat it as a proprietary-terms
disclosure.

### 2. The structural secret floor

Restorability has a hardcoded floor (T3), shipped in the Phase 9 store: secret-class
originals — every secret TYPE from Layers 1–2 (regex and entropy findings),
`.env`-extracted values (ENV), and checksum-validated PII (SSN, credit card) — are
never persisted to the map. This is structural, not a filter: map entries for these
classes are written without an `original` field at all, so there is nothing to
decrypt, subpoena, or exfiltrate. No configuration key can widen the restorable set;
configuration can only narrow it further.

Three gates lock the floor. tests/audit/restore-canary-leak.test.ts greps the
integrated restore surface — stdout, stderr, audit records, error paths — for
planted canaries (secret canaries forbidden on every surface).
tests/restore/mixed-canary.test.ts round-trips a mixed payload through the real
reversible pipeline and the real operator CLI: path/name placeholders restore,
secret placeholders byte-survive as placeholders. tests/state/fs-interception.test.ts
captures every buffer handed to an fs write API during a real reversible flow —
atomic-write temp files included — and asserts no plaintext canary original ever
reaches a write call.

Ecosystem contrast: no reference tool in this space ships a non-configurable
exclusion class — where comparable tools offer reversibility, a config flag can
extend it to everything they detect. mrclean's floor is deliberately not a setting.

**Consequence:** even a same-user attacker holding both the map and the key (see
key-custody below) recovers paths and names, never secrets. The one-way handling of
secret-class findings survives every opt-in.

### 3. Wire re-entry: why in-session restore is deferred

The only hook channel that rewrites tool output — PostToolUse
`hookSpecificOutput.updatedToolOutput` — is model-facing, and no display-only
alternative exists. Verified live on Claude Code 2.1.209 (2026-07-14; full verdicts,
method, and the filed upstream feature request are recorded in
docs/HOOK-CONTRACT.md): the channel is not dead for built-in tools — Claude Code
shape-validates `updatedToolOutput` per tool. String payloads are rejected for Bash
(zod `invalid_type`: "expected object, received string") with an easy-to-miss hook
warning, and the original output is used; object-shaped payloads
(`{stdout, stderr, interrupted, isImage}`) are honored for Bash — the model received
the rewrite and the terminal rendered it. In both cases the terminal renders the
model-facing value: user view == model view.

Restoring placeholders through this channel would therefore hand the model the
original values, and the transcript ratchet makes that permanent: conversation
history re-ships to the API on every subsequent request and again on `--resume`, so a
single restored value re-enters the wire for the remaining life of the session and
all of its resumes. That defeats the core value — originals never reach the wire —
which is why in-session restore is deferred (T1) until upstream ships a display-only
rewrite channel. Restore ships instead as the operator-only `mrclean restore` CLI
(shipped in Phase 10), which reads the local map and never touches a hook payload.

The live wire gate proves the loop end-to-end: tests/uat/wire-safety.test.ts
(operator-run, opt-in via `MRCLEAN_UAT=1` — never wired into CI) rides run-unique
canaries through a real headless Claude Code session, hard-asserts that canary
originals are absent from the stream-json output and every transcript file while
v2 tokens are observed on the wire, then restores locally and resumes the
session — the resumed wire still carries zero canary originals, because restore
is store-byte-inert and never touches a hook payload.

Shipped-behavior caveat (redaction direction): the same finding cuts the other way
for mrclean's own PostToolUse *redaction* of built-in Bash output — it is achievable,
but only when the hook emits the tool-specific object shape. String-form emission on
2.1.209 silently no-ops: per-tool shape validation rejects it, the only signal is a
hook warning, and the original output stays on the wire. Upstream issue #68951
("updatedToolOutput silently ignored" for built-in Bash; still open as of
2026-07-17) most likely reproduces the string form. The failure mode to defend against is not a
dead channel — it is silent-ish shape rejection.

**Mitigation:** mrclean's PostToolUse hook must emit per-tool object shapes for
built-in tools (MCP tool results accept string content), and must treat any
shape-validation warning as a redaction failure, not a cosmetic notice.

### 4. Key-custody honesty

The reversible map is encrypted at rest (AES-256-GCM) with key material stored in
a separate directory from the map files, outside the project tree. Be precise
about what file-based key custody stops and what it does not:

- **Stopped:** casual single-artifact exfiltration — a backup job, sync client, or
  copy-paste that scoops the sessions directory (or one map file) without the key
  directory yields ciphertext only.
- **Not stopped:** a same-user local attacker — any process or person running as your
  user who can read both directories can decrypt every live map. File-based key
  custody provides no isolation boundary against same-user access; that would require
  OS keychain custody (deferred, POLISH-03) or hardware-backed keys.

**Consequence:** "encrypted at rest" raises the cost of accidental and single-file
leaks; it is not a defense against a same-user local attacker. Copy that claims
more than this overstates the shipped design.

### 5. Accepted residual risks

Reversible mode accepts the following residuals deliberately rather than papering
over them:

- **Retain-on-resume TTL window.** Maps are retained when a session ends with
  `reason: resume` so the resumed session can rehydrate (T5 — `session_id` continuity
  across `--resume` verified live on 2.1.209). Until the resume happens or the TTL
  sweep fires, the encrypted map sits on disk. The window is bounded by the TTL, not
  eliminated.
- **Enumeration residual under v2 tokens.** Reversible sessions use session-tagged
  tokens (`<MRCLEAN:TYPE:NNN:nonce8>`); the per-session CSPRNG nonce kills
  cross-session planted-token deanonymization, but within one session the sequential
  `NNN` still leaks the ordering and count of findings.
- **SessionEnd is best-effort.** Cleanup on SessionEnd cannot be the only janitor: a
  crash skips it, and — verified live on 2.1.209 — SessionEnd does not fire at all in
  headless `-p` mode. The TTL orphan sweep is the mandatory backstop (and the primary
  cleanup mechanism for headless runs), not an optional extra.
- **win32 fail-open interaction.** The fail-closed hook wrapper is POSIX; win32
  remains a documented fail-open known-gap. On win32, a missing or renamed mrclean
  bin means hooks silently do not run: no redaction, and in reversible mode also no
  map lifecycle management. Reversible mode inherits the known-gap; it does not widen
  it.
- **Cross-session token collision — shrunk to a note (AR-10-05).** Two sessions'
  maps can mint the same placeholder for different originals (birthday-bounded,
  ~2⁻³² per session pair). Phase 11 hardening (IN-02, shipped in 11-03) demotes
  any placeholder carrying conflicting originals across the restore union index
  to unmatched — an ambiguous token restores nothing, mirroring the OVF
  treatment — so the former silent wrong-value-restore residual is now a benign
  pass-through, recorded as a documented note rather than an accepted
  wrong-restore risk.
- **Truncated-hash dictionary confirmability (AR-10-02, stays accepted).**
  Restore audit records carry 16-hex truncated hashes; an attacker holding
  candidate plaintexts can hash them and confirm membership. This matches the
  shipped hook audit discipline, and salting would break the cross-record
  correlation operators rely on — accepted as-is (IN-03).
- **Bash redaction shape gap — explicitly out of v3.0 scope.** String-form
  `updatedToolOutput` is rejected for built-in Bash (upstream #68951), and
  mrclean's upstream ask for a display-only rewrite channel is #77587 — both
  filed and open as of 2026-07-17. The per-tool object-shape emission fix stays
  fenced out of v3.0: the gap is identical in one-way mode — the parity gates
  above prove reversible mode leaves emission unchanged — so it is not a
  reversible-mode delta.

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
