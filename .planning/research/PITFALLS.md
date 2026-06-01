# Pitfalls Research

**Domain:** Adding in-process ML (transformers.js ONNX NER) + regex PII detection to an existing Node secret-sanitizer that runs as Claude Code hooks (one-process-per-event, <100 ms hot-path budget, zero-config `npx`, deterministic-with-reproducible-audit ethos)
**Researched:** 2026-06-01 (milestone v2.0 — Native-Node PII/NER Layer)
**Confidence:** HIGH on the architectural / latency / supply-chain pitfalls (confirmed against onnxruntime/transformers.js/claude-code issue trackers and the dslim/bert-base-NER model card); MEDIUM on exact ms figures (hardware-dependent — must be measured in Phase 1).

> The v1 (secret-sanitizer) pitfalls research is preserved at `.planning/research/PITFALLS.v1.md`. This file is scoped to the v2.0 PII/NER milestone.

> **The one-sentence summary:** The single most dangerous mistake is loading a 108–317 MB ONNX model *inside a per-event hook process*. Claude Code spawns a fresh process per hook invocation ([anthropics/claude-code#39391](https://github.com/anthropics/claude-code/issues/39391)), and onnxruntime-node session creation + model load is 100s of ms to seconds — so a naive integration adds **that cost to every single prompt and tool result**, not the <100 ms budget. NER must live behind a warm, persistent process (the MCP server) or it must not be on the hook hot path at all.

---

## Critical Pitfalls

### Pitfall 1: Loading the ONNX model inside the per-event hook process

**What goes wrong:**
The Claude Code hook contract spawns a **new OS process for every matching event** (UserPromptSubmit, PreToolUse, PostToolUse) — confirmed in [anthropics/claude-code#39391](https://github.com/anthropics/claude-code/issues/39391) ("Each hook invocation spawns a fresh process … 10-50ms per native process spawn"). If the NER pipeline `pipeline('token-classification', 'Xenova/bert-base-NER')` runs inside that process, you pay Node cold start **+ onnxruntime-node native addon load + 108–317 MB model deserialization + InferenceSession construction** on *every* prompt and *every* tool result. That is measured in hundreds of milliseconds to multiple seconds — 10–100× over the <100 ms / <200 ms budgets. Users disable the tool within a day.

**Why it happens:**
The existing v1 secret layers (secretlint, gitleaks regex, entropy) are genuinely stateless and cheap, so the team's mental model is "the hook bin is a pure stdin→stdout function." That model is correct for regex but catastrophic for a stateful ML runtime. The convenience of `lazy-import inside runDetection` (the v1 pattern in CLAUDE.md for `@anthropic-ai/sdk`) does **not** transfer: lazy-importing still re-loads the model per process.

**How to avoid:**
- The NER layer runs **only** inside the already-persistent MCP server process (`McpServer` over stdio / Streamable HTTP), which loads the model **once at warm-up** and reuses one `InferenceSession` across calls. The hook bin must **not** instantiate a pipeline.
- If the hook hot path needs PII verdicts, the hook process talks to the warm MCP server (local IPC / loopback HTTP) instead of loading a model. Round-trip to a warm in-process session is ~tens of ms vs. the full reload.
- Keep the deterministic regex-PII (email/SSN/CC/phone/IP) on the hook path (cheap, stateless); keep **NER off the synchronous hook path entirely**. NER is the "Layer-5 style, perf-exempt, opt-in" tier per the milestone goal — treat exempt as *literally not in the <100 ms accounting*, which is only honest if it is not blocking the hook.

**Warning signs:**
- A benchmark of `hook` cold-start that jumps from ~50 ms to 500 ms+ once `@xenova/transformers` is imported at module top level.
- `npx mrclean check` latency p50 fine but p99 terrible (model-load amortization illusion in tests that reuse a process — production hooks never reuse a process).
- Any code path where `pipeline(...)` or `AutoModel.from_pretrained` is reachable from `cli.ts hook`.

**Phase to address:**
**Phase 1 (architecture / placement).** This is the load-bearing decision the whole milestone hinges on; get it wrong and everything downstream is wasted.

---

### Pitfall 2: onnxruntime-node native-binary install failing or breaking zero-config `npx`

**What goes wrong:**
`onnxruntime-node` ships **prebuilt native addons per platform/arch** (macOS arm64/x64, Windows x64, Linux x64/arm64) and is **glibc-linked on Linux**. On a platform with no prebuilt (musl/Alpine, Termux/Android, older glibc, uncommon arch) install falls back to download-then-`node-gyp` source compile, which needs a toolchain most users don't have — so `npx mrclean` either fails to install or installs but throws at first NER call. Claude Code *itself* hit exactly this class of bug going to a glibc-only native binary ([anthropics/claude-code#50270](https://github.com/anthropics/claude-code/issues/50270) — "native binary requires glibc, no JS fallback"). Unlike browsers, **onnxruntime-node does not silently fall back to WASM** — that fallback is an onnxruntime-*web* feature, and transformers.js's backend handler picks `onnxruntime-node` in Node and stays there.

**Why it happens:**
The zero-config promise ("`npx mrclean install` wires everything") assumes pure-JS deps. Adding a native addon silently moves mrclean from "works anywhere Node works" to "works only where a prebuilt onnxruntime exists." The failure is invisible on the dev's own macOS ARM machine and only surfaces on a user's Alpine container or corporate Linux.

**How to avoid:**
- **Make NER strictly optional and lazy at the dependency layer.** `onnxruntime-node` / `@xenova/transformers` must be `optionalDependencies` (or a separate `mrclean-pii` add-on package), so a failed native install **never** breaks the core secret-sanitizer install. Core mrclean must install and run with zero ML deps present.
- Detect at runtime: if the native addon won't load, surface a clear "PII layer unavailable on this platform (no onnxruntime prebuild); secret protection unaffected" message and continue — **never** crash the hook.
- Optionally support a WASM backend path (`onnxruntime-web` in Node) as the documented fallback for musl/exotic platforms, accepting the ~2–10× slower inference — acceptable because NER is off the hot path (see Pitfall 1).
- Test the install matrix in CI: macOS arm64, Linux glibc x64, Linux **musl/Alpine**, Windows x64. Don't just test the dev's machine.

**Warning signs:**
- Install logs containing `node-gyp`, `prebuild-install warn`, or `Falling back to source`.
- An issue report "works on my Mac, crashes on our Linux CI / Docker image."
- Alpine-based Claude Code containers (common) throwing `Error: ... cannot open shared object file` or `Error loading shared library ld-linux`.

**Phase to address:**
**Phase 1 (dependency strategy)** for the optionalDependencies decision; **Phase 2 (platform hardening)** for the install matrix CI and WASM fallback.

---

### Pitfall 3: Bundling the model vs. lazy-download breaking the air-gapped / offline first run

**What goes wrong:**
Two failure modes pull in opposite directions:
1. **Bundle the model** → the npm package balloons by 108–317 MB, `npx mrclean` becomes a multi-hundred-MB download, install is slow, and it violates the zero-config-lightweight ethos.
2. **Lazy-download on first opt-in** (the milestone's chosen UX) → the first NER use silently reaches out to `huggingface.co`. In an **air-gapped / offline / corp-proxy** environment that download hangs or fails, and — worse for a *security* tool — an unexpected outbound network call from a product whose whole value prop is "no data egress" is a credibility-killer and may itself be blocked by the user's egress policy.

Also note: transformers.js v3 has had **broken/hard-coded cache paths** ([huggingface/transformers.js#997](https://github.com/huggingface/transformers.js/issues/997)) and a default cache of `./.cache` (cwd-relative!) unless `env.cacheDir` is set — so the model can land in the user's *repo working directory* and get committed or scanned by mrclean itself.

**Why it happens:**
"Lazy-download" sounds zero-config but quietly introduces a network dependency and a writable-cache-dir dependency that the team doesn't think of as config. The default cwd-relative cache is a footgun nobody notices until a `.cache/` folder shows up in `git status`.

**How to avoid:**
- **Explicit, consented, one-time fetch.** First opt-in prints exactly what will be downloaded (model, repo, size, SHA) and from where, then fetches. Never download implicitly inside a hook.
- Pin `env.cacheDir` to a stable user-level location (`~/.cache/mrclean/models` or `$XDG_CACHE_HOME`), **never** the cwd-relative `./.cache`. Add `.cache` to mrclean's own ignore set so the model never gets scanned or committed.
- Support **fully offline install**: a documented `mrclean pii fetch-model --from <path>` to side-load the ONNX file, plus `env.allowRemoteModels = false` so an air-gapped run never attempts network. Once cached, set local-files-only so steady state is offline.
- Ship a **manifest with the expected model SHA-256** in the package; verify after download (see Pitfall 7).

**Warning signs:**
- A `.cache/` directory appearing in users' repos.
- First-NER-use latency dominated by a network download; failures behind corporate proxies.
- Any outbound connection from mrclean that the user didn't explicitly trigger — this is reputationally fatal for a no-egress security tool.

**Phase to address:**
**Phase 2 (model acquisition UX).** Air-gapped/offline support and cache-dir pinning are explicit acceptance criteria, not nice-to-haves, given the security-tool positioning.

---

### Pitfall 4: NER false negatives leak names/orgs — the "must-not-leak" risk treated as if NER were a hard gate

**What goes wrong:**
`dslim/bert-base-NER` (the basis for `Xenova/bert-base-NER`) reports CoNLL-2003 recall of ~0.98 PER, ~0.94 ORG, ~0.97 LOC (per the [model card](https://huggingface.co/dslim/bert-base-NER)) — **on CoNLL-2003 newswire**. On real Claude Code content (code identifiers, internal hostnames, customer names embedded in JSON/logs, non-Western names, novel codenames) recall **drops substantially** — the model card itself warns performance "might drop on domain-specific texts not covered by CoNLL-2003." Every missed entity is a name/org that **leaks to the wire**. If the product narrative implies "mrclean now redacts PII," users will trust it as a guarantee and stop self-censoring — so a false negative becomes an *induced* leak the user would otherwise have caught.

**Why it happens:**
ML recall numbers look reassuringly high in benchmarks, so teams quietly promote a probabilistic detector to a guarantee. NER is also fundamentally an *open-class* problem (any string can be a name) — unlike secrets, there is no checksum or format to anchor on.

**How to avoid:**
- **Never let NER be the hard gate.** Keep the deterministic layers (secretlint + gitleaks regex + entropy + `.env` blocklist + `words.txt`) as the *only* block-on-detect gate. NER is advisory: it can *suggest* redactions, default to **warn/audit**, but block only when paired with a deterministic signal.
- For names/orgs the user *knows* are sensitive (customer names, codenames, internal hostnames), the **deterministic `words.txt` layer is the real guarantee** — document that NER augments, but `words.txt` is what you rely on for the must-not-leak set.
- Be ruthlessly honest in copy: "ML-assisted PII *hinting*, best-effort, not a guarantee" — never "PII protection." Misframing here is the difference between a useful feature and a liability.
- Consider entity-type scoping: enable PER/ORG/LOC selectively; the model's MISC class (~0.83–0.90 F1) is noisy.

**Warning signs:**
- Marketing/README language drifting toward "redacts all PII" or "GDPR/HIPAA compliant."
- Users disabling their own manual redaction habits because "mrclean handles it."
- A test corpus of non-CoNLL-style names (code, logs, non-Western, fictional codenames) showing recall well below the headline numbers.

**Phase to address:**
**Phase 1 (gate semantics — NER is advisory, deterministic layers stay the gate)** and **Phase 3 (accuracy evaluation harness + honest copy).**

---

### Pitfall 5: NER false-positive flood drowning the redaction stream and corrupting payloads

**What goes wrong:**
NER over-fires on ordinary tokens: capitalized words, code identifiers (`ProductService`, `UserController`), common-word names ("Will", "Mark", "May"), enums, and string literals all get tagged PER/ORG. If those become `<MRCLEAN:PII:NNN>` placeholders, you **shred code and structured payloads**. Spike 001 already documented mrclean's substitution being "real and aggressive — it can mangle structured payloads when a secret abuts delimiters" (it broke a JSON corpus twice). Adding open-class NER multiplies that surface enormously: every `ClassName` in a code diff could be redacted, making the round-tripped content useless and the agent confused.

**Why it happens:**
Code and logs are wildly out-of-distribution for a newswire-trained NER model. The cost asymmetry is brutal: a false negative is a silent leak (Pitfall 4) but a false positive is *loud, visible breakage* that the agent and user both see immediately — so over-aggressive default actions destroy trust fast.

**How to avoid:**
- **Default NER action = audit/warn, not redact-and-substitute.** Substitution (especially in reversible mode where it must round-trip) should require high confidence and ideally corroboration.
- Apply a **confidence threshold** and a **stop-list** for code-shaped tokens (camelCase/PascalCase identifiers, language keywords, single common first names) before substituting.
- Reuse the v1 allowlist machinery (5-axis allowlist) and extend it for NER, so users can quickly suppress noisy categories.
- **Skip NER on obviously-code content** (tool inputs that are diffs/source, fenced code blocks) — scope NER to prose-ish text where it's accurate, not to source code where it isn't.
- Carry forward the spike's hard-won lesson: test substitution on **structured payloads** (JSON, code) and assert they remain parseable after redaction.

**Warning signs:**
- Audit log showing high PII match counts dominated by code identifiers / common words.
- Round-tripped tool results with mangled JSON or code that no longer compiles.
- The agent asking "what is `<MRCLEAN:PII:042>`?" because a class name got redacted mid-diff.

**Phase to address:**
**Phase 3 (action defaults, thresholds, code-skip, structured-payload safety tests).**

---

### Pitfall 6: Non-determinism breaking the reproducible-audit ethos

**What goes wrong:**
mrclean's identity is **deterministic detection with reproducible audit logs** (`.mrclean/audit.jsonl`, "rule, severity, redacted token hash"). NER is non-deterministic across (a) **model versions** (a `Xenova/bert-base-NER` revision bump changes predictions), (b) **quantization** (int8 vs fp32 give different outputs), (c) **backend** (onnxruntime-node native vs WASM fallback can differ in low bits), and (d) **tokenizer/normalization** changes. The same prompt audited twice — or audited by two users — can produce *different* PII findings, undermining the "reproducible" promise and making audit logs non-comparable.

**Why it happens:**
Teams treat the model as a fixed function. It isn't: revisions, quantization variants, and execution providers all perturb outputs, and `transformers.js` will happily pull `main` of a repo if you don't pin a revision.

**How to avoid:**
- **Pin the model by exact revision/commit SHA**, not a moving tag, and record that SHA + the quantization variant + backend (native/WASM) in **every** audit-log entry. Reproducibility = "same input + same pinned model rev + same backend → same output."
- Treat any model-rev or backend change as a **versioned, logged event** (like a rule-pack bump), surfaced to the user — never a silent upgrade.
- Keep the **deterministic layers as the audit's reproducible backbone**; tag NER findings explicitly as `engine: "ner@<sha>"` so they're distinguishable from deterministic matches and auditors know which findings carry a probabilistic asterisk.
- For true byte-reproducibility, prefer the same backend everywhere (e.g., always WASM, or always native) and document that mixing backends can shift results.

**Warning signs:**
- Audit entries for the same content differing between runs or machines.
- No model-revision/backend field in the audit schema.
- A dependency update silently changing which model revision resolves.

**Phase to address:**
**Phase 1 (audit schema: add model-rev/quant/backend fields; pin revision)** and **Phase 3 (cross-machine reproducibility test).**

---

### Pitfall 7: Supply-chain — unverified model download + ML deps widening attack surface

**What goes wrong:**
A security tool that *fetches a 100+ MB binary blob from the internet and loads it into its own process* is itself an attack vector. Risks: (a) a compromised/spoofed model file (HF supports malicious-config attacks — see [arxiv 2505.01067 "A Rusty Link in the AI Supply Chain"](https://arxiv.org/pdf/2505.01067); note also [CVE-2026-1839 HuggingFace Transformers RCE](https://www.sentinelone.com/vulnerability-database/cve-2026-1839/)); (b) MITM on the download (HTTPS protects the channel but you still need a checksum to prove *what* you got); (c) the new dep tree (`@xenova/transformers`, `onnxruntime-node`) massively widens the supply-chain surface of a tool that previously prided itself on minimal deps (`picocolors` over `chalk`, etc.).

**Why it happens:**
"Just `pipeline(...)` and it downloads the model" is the documented happy path — and it does **no integrity verification by default** ([huggingface_hub#2364](https://github.com/huggingface/huggingface_hub/issues/2364): checksums aren't enforced). The convenience hides that you've added an unauthenticated remote-code/data load to a security product.

**How to avoid:**
- **Ship a pinned manifest with the expected SHA-256** of the exact model file (from the official HF model page, pinned revision) and **verify after download / on load**; refuse to load on mismatch. This is non-negotiable for a security tool.
- Pin model **revision SHA** (also serves Pitfall 6). HTTPS-only; never HTTP.
- Use ONNX (not pickle/`.pth`) — ONNX is a safer format than pickle (no arbitrary code on load), which is a point in transformers.js's favor; still verify the file.
- Keep ML deps in `optionalDependencies` / a separate add-on so the **core secret tool's** supply chain stays minimal and auditable. Pin exact versions, enable lockfile + `npm audit` in CI for the add-on.
- Document the model provenance and SHA in the repo so users can independently verify.

**Warning signs:**
- Model loaded without any checksum check.
- Model resolved from a moving tag/`main` rather than a pinned SHA.
- `npm ls` for core mrclean showing the ML subtree pulled in unconditionally.

**Phase to address:**
**Phase 2 (integrity-verified model fetch with pinned SHA manifest; optionalDependencies isolation).**

---

### Pitfall 8: Raw PII in the audit log (and in crash/error paths)

**What goes wrong:**
The CLAUDE.md security constraint says the audit log must never contain raw secret values. Adding PII detection re-opens this: it's tempting to log the matched name/email/SSN "for debugging," or to dump the model's input span on error. Now `.mrclean/audit.jsonl` becomes a **plaintext PII database sitting in the user's repo** — a worse leak than the one mrclean prevents, and a compliance landmine.

**Why it happens:**
Debugging NER false positives makes you *want* the raw span. Error/exception paths often log the offending input by default. The reversible-mode placeholder→original map is, by definition, a map of raw PII that must be protected exactly like the secret map.

**How to avoid:**
- Extend the existing "never log raw secret" rule to **never log raw PII** — audit entries carry only `{entity_type, severity, token_hash, engine, model_rev, offset}`, never the matched text.
- Scrub PII from **all error/exception/debug paths**, not just the happy path. Add a test that feeds known PII and greps the audit log + stderr for it.
- The reversible-mode PII placeholder map inherits the secret map's rules: **in-memory only by default; if persisted, encrypted at rest and removed on session exit** (per CLAUDE.md). Don't create a second, looser store for PII.

**Warning signs:**
- A grep of `audit.jsonl` or logs surfacing a test SSN/email/name.
- `catch` blocks logging the raw input text.
- A PII map persisted unencrypted "temporarily."

**Phase to address:**
**Phase 1 (audit schema — hash-only, extend the no-raw rule to PII)** and **Phase 4 (security hardening + leak-grep test).**

---

### Pitfall 9: Long-running MCP process memory growth from onnxruntime sessions

**What goes wrong:**
Solving Pitfall 1 by keeping a warm MCP process introduces the opposite problem: onnxruntime-node has **documented memory leaks** where session memory isn't returned even after `release()` ([microsoft/onnxruntime#26831](https://github.com/microsoft/onnxruntime/issues/26831), [#25325](https://github.com/microsoft/onnxruntime/issues/25325), [#22271](https://github.com/microsoft/onnxruntime/issues/22271) — RSS grows continuously across runs). A persistent mrclean MCP server doing NER on every prompt over an 8-hour coding session can balloon RSS, eventually getting OOM-killed or degrading the whole session.

**Why it happens:**
ONNX session/tensor lifetimes are managed by a native addon; JS GC doesn't see them, and the addon's own release path is known-leaky. "Load once, run forever" assumes clean per-inference cleanup that doesn't fully exist.

**How to avoid:**
- **Load the InferenceSession exactly once and reuse it** (don't create/destroy per request — that's the worst leak pattern in the issues). One long-lived session leaks far less than churning sessions.
- Explicitly dispose input/output **tensors** after each inference where the API allows.
- Add a **memory watchdog + worker recycling**: monitor RSS; when it crosses a threshold, gracefully recycle the NER worker (spawn fresh, hand off, kill old). Run NER in a `worker_thread` / child process so recycling doesn't drop the MCP server.
- Bound concurrency: one inference at a time per worker (a token-classification model isn't meant for parallel calls in-process).

**Warning signs:**
- RSS of the mrclean MCP process climbing monotonically over a session.
- OOM kills in long sessions or memory-constrained containers.
- Memory growth correlating with NER call count, not idle time.

**Phase to address:**
**Phase 2 (warm-process memory management: single session, tensor disposal, worker recycling, RSS watchdog).**

---

### Pitfall 10: Placeholder collisions / reversibility breakage with existing `<MRCLEAN:*>` tokens

**What goes wrong:**
PII findings introduce a new `<MRCLEAN:PII:NNN>` namespace alongside the existing `<MRCLEAN:SECRET:NNN>` / `<MRCLEAN:ENTROPY:NNN>` / `word:` tokens. Failure modes: (a) **overlapping spans** — a string is both a secret (deterministic) and an NER hit, and two layers both try to substitute the same bytes, producing nested/corrupt tokens like `<MRCLEAN:PII:<MRCLEAN:SECRET:001>>`; (b) **counter collisions** if PII and secret layers don't share one allocator; (c) **NER firing on already-substituted placeholders** — `<MRCLEAN:SECRET:001>` contains capitalized tokens that NER may tag as ORG, re-redacting a placeholder; (d) reversible-mode restore mapping the wrong original back because spans were computed pre-substitution but applied post-substitution, breaking the path/name round-trip the milestone promises.

**Why it happens:**
The v1 pipeline was built for non-overlapping deterministic matches. NER produces overlapping, lower-confidence, open-class spans that don't compose cleanly with regex spans, and ordering (which layer substitutes first) silently determines correctness.

**How to avoid:**
- **Single, ordered substitution pass with one global token allocator** across all layers. Deterministic secret layers substitute **first** (they're the hard gate); NER runs on the *remaining* unsubstituted text and **must skip any region already inside a `<MRCLEAN:*>` token** (exclude placeholder ranges from NER input).
- Resolve **span overlaps** with a deterministic precedence rule (secret > entropy > env > words > PII) and never double-wrap.
- Build the reversible map from **immutable original→placeholder records with original offsets**, applied in one pass, so restore is unambiguous (matches the user's immutability coding rule).
- Add explicit tests: secret-and-PII overlapping span; NER input containing existing placeholders; round-trip restore correctness on mixed content.

**Warning signs:**
- Nested/malformed `<MRCLEAN:...<MRCLEAN:...>...>` tokens in output.
- Reversible restore returning the wrong original or leaving placeholders unresolved.
- Two layers reporting matches on the same byte range with conflicting tokens.

**Phase to address:**
**Phase 3 (unified substitution/restore pipeline integration + overlap/round-trip tests).**

---

### Pitfall 11: Scope creep — the PII layer becoming a second product

**What goes wrong:**
PII/NER is a deep, open-ended domain (Presidio has dozens of entity types, recognizers, context enhancers, languages, anonymize operators). Spike 001 explicitly framed mrclean and Presidio as **complementary, not competing**, and the milestone says "secrets remain mrclean's core, PII off by default." The risk: the team chases NER accuracy, adds entity types, multi-language models, custom-recognizer frameworks — and the project drifts from "secret exfiltration prevention with an *opt-in PII hint*" into "a worse Presidio in Node," blowing the install size, latency budget, and supply-chain minimalism that are mrclean's actual differentiators.

**Why it happens:**
ML features are seductive and the accuracy gap (Pitfall 4) creates endless "just one more model / entity type" pressure. The deterministic core is "boring" by comparison.

**How to avoid:**
- **Hard scope fence from the milestone:** one model (`Xenova/bert-base-NER` int8), PER/ORG/LOC + the listed regex-PII (email/SSN/CC/phone/IP). Off by default. No multi-language, no custom-recognizer DSL, no model zoo in v2.0.
- Any "improve PII accuracy" request that means a bigger model or Python sidecar → route to the **deferred Presidio compliance-tier** (already the documented escape hatch), not into mrclean's core.
- Keep the success metric anchored on **secrets** (the validated core); PII is explicitly best-effort. Don't let PII accuracy become a release gate.

**Warning signs:**
- Backlog filling with entity-type requests, language support, recognizer frameworks.
- Install size / latency budgets being renegotiated to fit PII features.
- The README's headline shifting from "secret sanitizer" to "PII/secret platform."

**Phase to address:**
**Phase 1 (scope fence in requirements/acceptance criteria)** — enforce continuously at every phase transition.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Load model in the hook process (no warm server) | Simpler — reuses v1's stdin→stdout bin shape | Adds full model-load latency to **every** event; misses the <100 ms budget by 10–100× | **Never** — this is the cardinal sin (Pitfall 1) |
| Lazy-download model with no SHA verification | Fastest to ship the "zero-config" UX | Unauthenticated remote blob loaded into a security tool's process | **Never** for a security tool (Pitfall 7) |
| Make ML deps regular (not optional) dependencies | One package, simpler install docs | Native-install failure breaks the **core** secret tool on musl/exotic platforms | **Never** — core must install without ML deps (Pitfall 2) |
| Default NER action = redact/substitute | "PII gets protected out of the box" | Code/JSON shredding, false-positive flood, lost trust | Only behind high-confidence threshold + code-skip; default should be warn/audit |
| Log raw matched span for NER debugging | Easy false-positive triage | Plaintext PII DB in the repo; compliance landmine | Only in an ephemeral, opt-in, local debug mode that never writes to `audit.jsonl` |
| Resolve model from moving tag (`main`/latest) | No revision bookkeeping | Silent prediction drift breaks reproducible audit | **Never** — pin revision SHA (Pitfalls 6, 7) |
| Create/destroy InferenceSession per request | "Clean" lifecycle | Hits the documented onnxruntime release leak hard | **Never** — load once, reuse (Pitfall 9) |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code hooks (per-event process) | Treating hook process as cheap enough to host a model | Model lives in the warm MCP server; hook calls out or stays regex-only (Pitfall 1) |
| `@xenova/transformers` backend selection | Expecting WASM auto-fallback in Node like in browser | Node picks `onnxruntime-node` (native) and stays; configure WASM explicitly if needed (Pitfall 2) |
| transformers.js `env.cacheDir` | Leaving default `./.cache` (cwd-relative) | Pin to `~/.cache/mrclean/models`; exclude from scanning/commits (Pitfall 3) |
| transformers.js `env.allowRemoteModels` | Leaving remote-loading on, breaking air-gapped runs | Side-load + `allowRemoteModels = false` for offline; explicit consented fetch otherwise (Pitfall 3) |
| HF model download | Trusting size/HTTPS as integrity | Verify pinned SHA-256 from official model page; refuse on mismatch (Pitfall 7) |
| onnxruntime-node sessions | Churning sessions / not disposing tensors | Single long-lived session + tensor disposal + worker recycling (Pitfall 9) |
| Existing `<MRCLEAN:*>` substitution | Running NER over text that already contains placeholders | Exclude placeholder ranges from NER input; single ordered pass (Pitfall 10) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Model load on hot path | p99 hook latency in 100s of ms–seconds; users disable tool | Warm MCP process; NER off synchronous hook path | Immediately, on the very first prompt in production |
| WASM fallback on hot path | Slower-than-native inference blocking events | Keep NER off the hook hot path regardless of backend | When deployed on musl/no-prebuild platforms |
| Per-request session churn | RSS climbs, eventual OOM | Load session once, reuse | Hours into a long coding session |
| Unbounded NER input | Latency scales with prompt size; large tool outputs stall | Cap NER input to suspect spans / prose; skip code; chunk | On large diffs / big tool results |
| Native addon cold start counted as "exempt" | "Exempt" layer still blocks the hook synchronously | Make exempt mean *off the synchronous path*, measured separately | When perf budget is audited honestly |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Unverified model download | Spoofed/poisoned model loaded into the security tool's process | Pinned SHA-256 manifest verified on load (Pitfall 7) |
| Raw PII in audit log / error paths | `audit.jsonl` becomes a plaintext PII DB in the repo | Hash-only audit; scrub all error paths; leak-grep test (Pitfall 8) |
| Unencrypted reversible PII map on disk | PII map leak = exactly the breach mrclean prevents | In-memory default; encrypted-at-rest + session-exit wipe if persisted |
| ML deps in core dependency tree | Wider, harder-to-audit supply chain for the core secret tool | optionalDependencies / separate add-on package; pinned versions (Pitfalls 2, 7) |
| Unexpected outbound network from a no-egress tool | Credibility loss + may violate user egress policy | Explicit consented fetch only; never implicit network in a hook (Pitfall 3) |
| Moving model revision | Silent behavior change in a tool users audit | Pin revision SHA, log it (Pitfalls 6, 7) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Framing NER as a PII *guarantee* | Users stop self-censoring; induced leaks (Pitfall 4) | Copy: "best-effort ML PII *hint*, not a guarantee"; `words.txt` is the real guarantee |
| Redact-by-default flooding output | Code/JSON shredded; agent confused; trust lost | Default warn/audit; high-confidence + code-skip before substitute (Pitfall 5) |
| Silent model download on first opt-in | Hang/failure on air-gapped/proxy; surprise egress | Print what/where/size/SHA; explicit consent; offline side-load path (Pitfall 3) |
| Crashing the hook when ONNX unavailable | Loses **secret** protection on unsupported platforms | Degrade gracefully: "PII layer unavailable, secrets unaffected" (Pitfall 2) |
| No way to suppress noisy categories | Audit log unusable, users disable PII entirely | Extend the 5-axis allowlist to NER; per-entity-type toggles (Pitfall 5) |

## "Looks Done But Isn't" Checklist

- [ ] **NER integration:** Often missing the warm-process placement — verify NER is **never** loaded inside the per-event hook process (grep `cli.ts hook` path for any pipeline/model import).
- [ ] **Install:** Often missing the platform matrix — verify core mrclean installs and runs with ML deps absent / native build failed (test on musl/Alpine, not just dev macOS).
- [ ] **Offline:** Often missing air-gapped support — verify NER works with `allowRemoteModels=false` after a side-loaded model and never makes an unexpected outbound call.
- [ ] **Audit reproducibility:** Often missing model-rev/quant/backend fields — verify the same input + pinned model produces identical audit entries across two machines.
- [ ] **Audit privacy:** Often missing error-path scrubbing — verify a known test SSN/email/name appears **nowhere** in `audit.jsonl` or stderr, including exception paths.
- [ ] **Model integrity:** Often missing checksum enforcement — verify load **refuses** a tampered/wrong-SHA model file.
- [ ] **Substitution safety:** Often missing structured-payload tests — verify redacting JSON/code leaves it parseable and that NER skips existing `<MRCLEAN:*>` tokens.
- [ ] **Reversible round-trip:** Often missing mixed-content tests — verify a payload with both secret and PII placeholders restores correctly.
- [ ] **Memory:** Often missing long-run testing — verify MCP-process RSS is stable (or recycled) over thousands of NER calls.
- [ ] **Gate semantics:** Often missing the "advisory not gate" rule — verify a NER-only finding (no deterministic signal) does not hard-block by default.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Model on hot path (Pitfall 1) | HIGH | Re-architect to warm MCP process; move NER off the synchronous hook path — touches the core integration, hence Phase-1-critical |
| Native install breaks core (Pitfall 2) | MEDIUM | Move ML to optionalDependencies / add-on; add runtime guard + graceful degrade; ship patch release |
| Surprise egress / cwd cache (Pitfall 3) | LOW–MEDIUM | Pin `cacheDir`, gate download behind consent, add offline flag; ignore `.cache` |
| NER over-redaction shipped (Pitfall 5) | MEDIUM | Flip default to audit; add threshold + code-skip; allowlist; reassure users |
| Raw PII in audit (Pitfall 8) | HIGH | Treat as a breach: rotate/scrub logs, notify, add leak-grep regression test; embarrassing for a security tool |
| Non-reproducible audit (Pitfall 6) | MEDIUM | Add model-rev/backend to schema; pin revision; re-baseline; communicate the engine change |
| Placeholder collision (Pitfall 10) | MEDIUM | Unify into single ordered pass with one allocator; add overlap/round-trip tests |
| Memory growth (Pitfall 9) | MEDIUM | Single reused session; tensor disposal; worker recycling + RSS watchdog |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Model on per-event hook process | **Phase 1** (architecture) | Hook cold-start benchmark unchanged; no model import reachable from `hook` path |
| 2. Native-binary install / zero-config break | **Phase 1** (optionalDeps) + **Phase 2** (matrix CI) | Core installs+runs on musl/Alpine with ML deps absent; graceful degrade message |
| 3. Bundle-vs-download / offline / cache | **Phase 2** (model acquisition UX) | Air-gapped run works with `allowRemoteModels=false`; no `.cache` in cwd; no unexpected egress |
| 4. NER false negatives as a "gate" | **Phase 1** (gate semantics) + **Phase 3** (eval + copy) | NER-only finding doesn't hard-block; recall measured on non-CoNLL corpus; copy says "best-effort" |
| 5. False-positive flood / payload corruption | **Phase 3** (defaults/thresholds/code-skip) | JSON/code stays parseable post-redaction; default action = audit/warn |
| 6. Non-determinism vs reproducible audit | **Phase 1** (audit schema + pin) + **Phase 3** (cross-machine test) | Same input + pinned model → identical audit entries across machines |
| 7. Supply-chain / unverified model | **Phase 2** (SHA manifest + optionalDeps) | Load refuses wrong-SHA model; revision pinned; core dep tree minimal |
| 8. Raw PII in audit/error paths | **Phase 1** (hash-only schema) + **Phase 4** (leak-grep) | Test PII absent from `audit.jsonl` + stderr incl. exceptions |
| 9. Warm-process memory growth | **Phase 2** (session reuse + recycling) | RSS stable / recycled over thousands of NER calls |
| 10. Placeholder collisions / reversibility | **Phase 3** (unified pipeline) | No nested tokens; mixed secret+PII round-trip restores correctly |
| 11. Scope creep (second product) | **Phase 1** (scope fence) + every transition | Backlog stays within one model + listed entities; budgets not renegotiated |

## Sources

### Primary / Official (HIGH confidence)
- [anthropics/claude-code#39391 — Hook performance: persistent daemon eliminates process spawning overhead](https://github.com/anthropics/claude-code/issues/39391) — confirms each hook invocation spawns a fresh process; 10–50 ms native spawn cost; warm daemon → sub-ms. Foundational to Pitfall 1.
- [anthropics/claude-code#50270 — native binary requires glibc, no JS fallback](https://github.com/anthropics/claude-code/issues/50270) — real example of glibc-only native binary breaking a platform with no fallback (Pitfall 2).
- [dslim/bert-base-NER model card (Hugging Face)](https://huggingface.co/dslim/bert-base-NER) — CoNLL-2003 metrics (PER ~0.98, ORG ~0.94, LOC ~0.97 recall) and the explicit warning that performance drops on domain-specific text (Pitfall 4).
- [microsoft/onnxruntime#26831](https://github.com/microsoft/onnxruntime/issues/26831), [#25325](https://github.com/microsoft/onnxruntime/issues/25325), [#22271](https://github.com/microsoft/onnxruntime/issues/22271) — Node.js binding memory leaks; RSS not released after session/env release (Pitfall 9).
- [huggingface/huggingface_hub#2364 — checksum validation not enforced on download](https://github.com/huggingface/huggingface_hub/issues/2364) — confirms no default integrity check (Pitfall 7).
- [huggingface/transformers.js#997 — hard-coded/broken cache path in v3 CJS](https://github.com/huggingface/transformers.js/issues/997) and [transformers.js env docs](https://huggingface.co/docs/transformers.js/api/env) — default `./.cache` cwd-relative; `env.cacheDir`, `env.allowRemoteModels` (Pitfall 3).
- [transformers.js backends/onnx docs](https://huggingface.co/docs/transformers.js/en/api/backends/onnx) + [Backend Architecture (DeepWiki)](https://deepwiki.com/huggingface/transformers.js/8.2-backend-architecture) — Node uses `onnxruntime-node`; WASM is the web/browser backend, not an automatic Node fallback (Pitfall 2).
- Spike 001 (`.planning/spikes/001-vs-presidio/README.md`) — self-redaction corrupting structured payloads; hex evading the 4.5 entropy floor; example-key allowlist; complementary-not-competing framing (Pitfalls 5, 10, 11).

### Secondary / Comparative (MEDIUM confidence)
- [arxiv 2505.01067 — "A Rusty Link in the AI Supply Chain: Detecting Evil Configurations in Model Repositories"](https://arxiv.org/pdf/2505.01067) — malicious model-repo configs (Pitfall 7).
- [CVE-2026-1839 — HuggingFace Transformers RCE](https://www.sentinelone.com/vulnerability-database/cve-2026-1839/) — recent HF-ecosystem RCE class; argues for ONNX-not-pickle + verification (Pitfall 7).
- [How to Verify AI Model Downloads (QWE)](https://www.qwe.edu.pl/tutorial/how-to-verify-ai-model-download/) — checksum-not-size, official-source-not-mirror guidance (Pitfall 7).
- [Optimizing Transformers.js for Production (SitePoint)](https://www.sitepoint.com/optimizing-transformers-js-production/) and [transformers.js#1016 — onnxruntime-web version incompat](https://github.com/huggingface/transformers.js/issues/1016) — backend/version coupling pain (Pitfalls 2, 6).
- [CoNLL# corrected test set (arxiv 2405.11865)](https://arxiv.org/pdf/2405.11865) — even CoNLL-2003 has label errors; benchmark numbers overstate real-world recall (Pitfall 4).

### Open Questions / LOW confidence (measure in Phase 1)
- **Exact onnxruntime-node cold-load + first-inference latency** for `Xenova/bert-base-NER` int8 on macOS ARM / Linux glibc — public ms figures are hardware-specific; benchmark on target hardware in Phase 1 to size the warm-process round-trip budget.
- **WASM-backend inference latency** for the same model in Node — needed to decide whether musl/exotic platforms get NER at all or just regex-PII.
- **Whether int8 quantization meaningfully degrades PER/ORG recall** vs fp32 on mrclean-style content — affects the false-negative posture (Pitfall 4) and reproducibility variant choice (Pitfall 6).

---
*Pitfalls research for: adding native-Node transformers.js ONNX NER + regex PII to a Claude-Code-hook secret sanitizer (milestone v2.0)*
*Researched: 2026-06-01*
