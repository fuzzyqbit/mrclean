# Phase 11: Wire-Safety Verification & Hardening - Research

**Researched:** 2026-07-17
**Domain:** Adversarial end-to-end verification of the shipped reversible surface (Phases 8–10) — live headless canary, fs-write interception, chaos/stress CI elevation, THREAT_MODEL finalization + copy-drift lock
**Confidence:** HIGH (every harness read from source this session; the one genuinely novel mechanism — fs-write interception — verified live with a runnable probe; CI wiring facts read from workflows + demonstrated repo evidence)

## Summary

Phase 11 is a verification-and-hardening phase over an already-shipped surface. Per the roadmap note, every gate extends a shipped harness — and this research confirms that with one clarification that reshapes planning: **SC3 and SC4 are already substantially covered and already CI-reachable.** `npm test` runs all three vitest projects (unit + integration + uat-self-skipped — proven by 10-08's recorded full-suite output "99 passed | 2 skipped (101)" where the 2 skips are the uat files), and `.github/workflows/test.yml` runs `npm test` on every push/PR to main. The 16-process stress gate (`tests/state/stress.test.ts`, integration project) already asserts all four SC4 claims (zero lost, zero dups for distinct originals, identical placeholders for identical originals cross-process, zero degrades); the chaos suite (`tests/state/chaos.test.ts`, unit project) already proves SC3's redacted-canary/never-blocked contract across six corruption shapes. What SC3/SC4 genuinely need is explicit, non-vacuous CI naming (a demonstrated hazard: 10-07 found `npx vitest run <file> --project=integration` exits 0 with ZERO files collected when the file isn't in that project's include list) plus awareness that the milestone branch has never run these gates on ubuntu (workflows trigger only on main push/PR — the 500 ms stress harness deadline was measured on the macOS executor, T-09-08-06).

The two genuinely new mechanisms are SC1 and SC2. **SC1 splits into two legs:** a deterministic dist-spawn parity gate (spawn `node dist/cli.js hook` with a fixed canary-bearing PostToolUse payload under one-way vs reversible sandbox HOMEs; stdout deep-equal after v2 nonce-tail normalization — the shipped-bundle level that caught two real bugs in 09-08) which runs in CI, and an opt-in live headless UAT leg (UAT-2b/contract-verification precedent: fixture MCP echo server carrying the canary, HOME-prefixed hook command for state isolation, transcript + `~/.claude/projects/**/*.jsonl` grep, restore-then-resume re-entry proof, and per-tool `tool_response` shape recording — the re-homed STATE.md todo). Live legs are opt-in by settled repo policy ("never wired into CI" — token spend); the CI half of SC1 is the dist parity gate plus the existing offline suites. **SC2's design hinges on one seam this research verified live:** monkey-patching the builtin `fs`/`fs/promises` CJS export objects plus `module.syncBuiltinESMExports()` intercepts BOTH the SUT's ESM named imports (`writeFile` in map-store's key path) AND write-file-atomic's fd-based `promisify(fs.write)` temp-file writes — a probe run this session captured the atomic-write temp buffer bytes on the actual Node version.

SC5 finalizes THREAT_MODEL.md's reversible section against the shipped implementation — with a booby trap this research located: the existing copy-drift gate **hard-requires the phrase 'design commitment'** (tests/copy-drift.test.ts), which finalization removes; the gate and the doc must change in the same commit. Hardening residuals: adopt IN-02/AR-10-05 (cross-session collision demote-to-unmatched, ~6 lines) and IN-01 (stale counts on error report, ~5 lines); keep AR-10-02 accepted; defer IN-04 and the typecheck-drift chore; explicitly fence out the E1 object-shape emission fix (it rewrites the one-way redaction path and breaks the frozen-tree discipline — upstream #77587 filed, both issues verified still OPEN this session).

**Primary recommendation:** Plan ~4 waves: (1) SC2 fs-interception + SC1 dist-parity (deterministic, new files, CI-gated); (2) hardening adoptions (IN-01/IN-02) + chaos/stress CI explicitness + canary-leak.yml extension; (3) SC1 live UAT leg + tool_response shape recording (opt-in, token-spending, operator-run); (4) THREAT_MODEL finalization + copy-drift extension consuming wave 3's re-stamped evidence.

## Locked Decisions (no CONTEXT.md — constraints from ROADMAP / STATE / PROJECT / shipped artifacts)

No `11-CONTEXT.md` exists (`has_context: false`). Equivalent constraints, all locked upstream — verify and gate, do not re-litigate:

- **T1 (locked):** No in-session restore, no hook-path restore, no `restore` MCP tool. Phase 11 *proves the negative*; it never adds restore surface. `restore` stays on FORBIDDEN_TOOL_NAMES with the tools-list gate.
- **One-way default byte-identical (REVMODE-05):** the v1 code path is regression-locked (cold-path fence, frozen trees). Phase 11 gates must not modify `src/hook`, `src/detect`, `src/placeholder` — parity is asserted THROUGH them, not by editing them.
- **"Hook stdout unchanged by reversible mode" means parity modulo the sanctioned v2 token form.** REVMODE-05 mandates `<MRCLEAN:TYPE:NNN:nonce8>` tokens in reversible sessions, so byte-identity is impossible by design; the established contract (09-08 chaos parity) is deep-equality after stripping nonce tails — same shape, same substitution count, same additionalContext, zero originals. SC1's deterministic leg inherits this exact normalization.
- **Live UAT is opt-in, never CI** (vitest.config `uat` project charter: authenticated `claude`, real token spend, `MRCLEAN_UAT=1`). SC1's "live headless canary gate" is therefore the operator-run harness (Phase 8 REVMODE-10 precedent); CI's proof burden is carried by the deterministic legs.
- **Record-don't-assert for upstream-contract observations** (08-RESEARCH Pattern 2): the per-tool `tool_response` shape survey records verdicts to the findings artifact; only harness integrity and *mrclean-owned invariants* (canary absence) hard-assert.
- **Restore/redact error domains stay separate** — no gate may couple them (the outbound import allowlist fence in cold-path.test.ts is the structural lock).
- **Scope fence:** in-session restore fast-follow, input-side restore, fuzzy matching, keychain custody, Layer 5, and the PostToolUse object-shape emission fix are OUT (see Pitfall 1).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REVMODE-11 | CI proves reversible mode never re-exposes originals on any wire path — hook stdout is unchanged by reversible mode, no plaintext canary appears in any written buffer (including atomic-write temp files), chaos tests show redaction survives a corrupt/missing/chmod'd map, and an 8–16-process concurrency stress test gates the build | §Existing Harness Inventory (all five harnesses located with invocation + assertion detail); §Gap Analysis per Success Criterion (exact delta per SC); §Pattern 1–2 (SC1 dist-parity + live-leg design); §Pattern 3 (SC2 interception seam, VERIFIED live probe); §CI Wiring Facts (what "gates the build" concretely means, incl. the demonstrated vacuous-pass hazard); §Hardening Residuals (adopt/defer with rationale); §Validation Architecture (SC→test map) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SC1 deterministic parity (hook stdout) | Integration test (spawns built `dist/cli.js hook`) | vitest.config routing (dual-list like stress) | Shipped-bundle level — 09-08 proved unit/tsx greens can hide dist-only bugs (tsup shims, `__filename`) |
| SC1 live canary + restore re-entry | UAT harness (`tests/uat/`, opt-in) | Operator (runs `test:uat` at verify-work) | Token spend + authenticated CLI; UAT-2b/contract-verification precedent |
| Per-tool `tool_response` shape survey (re-homed todo) | UAT harness (parallel log-hook fixture) | docs/HOOK-CONTRACT.md (+ findings artifact) | Contract observation → record-don't-assert; doc is the durable output |
| SC2 fs-write interception | Unit test (in-process, monkey-patched builtins) | — | Deterministic; per-file worker isolation makes global patching safe |
| SC3 chaos CI elevation | Existing unit suite + explicit CI step | test.yml / canary-leak.yml | Suite shipped in 09-08; delta is non-vacuous CI naming |
| SC4 stress CI elevation | Existing integration suite + explicit CI step | 500 ms harness-deadline knob note | Suite shipped in 09-08 with all six assertion families |
| SC5 THREAT_MODEL finalization | Repo docs (THREAT_MODEL.md) | tests/copy-drift.test.ts (paired change) | Existing gate REQUIRES 'design commitment' — must evolve in the same commit |
| Copy-drift "encrypted at rest" honesty | tests/copy-drift.test.ts + src/shared/strings.ts | src/doctor/checks.ts copy (new scan source) | Doctor's `encrypted session state adapter active` detail is user-facing encrypted-claim copy |
| Hardening IN-01/IN-02 | `src/restore/cli.ts` / `src/restore/session-index.ts` | Existing test files (extend rows) | Phase-10 files, NOT frozen trees; both fixes fail-safe-direction |

## Standard Stack

### Core

**No new runtime or dev dependencies.** Every mechanism uses the existing stack `[VERIFIED: package.json + source read this session]`:

| Component | Version | Purpose in Phase 11 | Status |
|-----------|---------|--------------------|--------|
| Node.js | v22.22.0 local (floor >=20.18.0) | runtime; `module.syncBuiltinESMExports` (stable since v12.12) is the SC2 seam | `[VERIFIED: node --version + live probe this session]` |
| Vitest ^4.1.6 (projects: unit/integration/uat) | as shipped | all gates | existing |
| tsup ^8.5.1 (`shims: true`) | as shipped | dist build for spawn-level gates | existing |
| `@modelcontextprotocol/sdk` ^1.29 | as shipped (runtime dep) | ~40-line fixture MCP echo server for the live leg | existing dep, new fixture file only |
| Claude Code CLI | **2.1.212 local** (Phase 8 verdicts stamped 2.1.209 — drift, see State of the Art) | live-leg substrate | `[VERIFIED: claude --version, 2026-07-17]` |
| `gh` CLI | authenticated (fuzzyqbit) | upstream issue status re-checks | `[VERIFIED: gh auth status]` |
| GitHub Actions workflows (test/canary-leak/perf) | as shipped | "gates the build" surface | `[VERIFIED: .github/workflows read]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Monkey-patch builtin fs + `syncBuiltinESMExports` (SC2) | `vi.mock('node:fs')` | vi.mock does NOT reach externalized CJS deps — write-file-atomic's `require('fs')` bypasses it unless `server.deps.inline` is reconfigured; the patch approach reaches both channels and was verified live `[VERIFIED: probe this session]` |
| Monkey-patch (SC2) | LD_PRELOAD / strace / dtrace | Not portable (macOS SIP, CI images), external tooling; rejected |
| Transcript + stream-json scan for "next outbound request body" (SC1) | `ANTHROPIC_BASE_URL` capture proxy | Proxy is stronger but new machinery: OAuth-vs-API-key auth ambiguity when overriding base URL, brittle against CC transport changes; the transcript IS the canonical persisted re-ship content per the T1 ratchet analysis, and the SC text offers it as the named observable (`~/.claude/projects/**/*.jsonl`) |
| Fixture MCP echo server for the live canary | Bash tool output as canary carrier | mrclean's shipped PostToolUse emits STRING-form `updatedToolOutput`, which 2.1.209 REJECTS for built-in Bash (E1) — Bash redaction is documented-inert live; MCP tool results accept string content and are HONORED (E1/MCP verdict), making MCP the only reliable live substitution-on-the-wire path. mrclean self-exempts its OWN tools (`MRCLEAN_TOOL_RE`), so the fixture server must be foreign-named |
| `HOME=<sandbox>` prefix baked into the hook command string | Overriding HOME for the whole `claude` process | Whole-process HOME override redirects claude's own `~/.claude` auth/config — breaks the session; the command-string env prefix (fixtureCmd precedent) isolates ONLY mrclean's state/config |

**Installation:** none.

## Package Legitimacy Audit

**This phase installs no external packages.** All work uses existing dependencies (verified against package.json) plus the already-installed `claude` and `gh` CLIs. slopcheck run not required; nothing to audit.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Existing Harness Inventory (the codebase-integration core)

Everything Phase 11 extends, located and characterized from source:

### 1. UAT-2b headless canary + contract-verification harness
- **Files:** `tests/uat/harness.ts` (shared `runClaude`/`assertSessionRan`/StreamEvent parsing, 138 lines), `tests/uat/live-session.test.ts` (UAT-1/2a/2b, incl. the CANARY_FILE-never-reaches-model pattern), `tests/uat/contract-verification.test.ts` (E1–E5, 982 lines), `tests/uat/findings-builder.ts` (carry-forward artifact writer), `tests/uat/fixtures/*.sh` (6 fixture hooks incl. `log-hook.sh` side-file logger), `tests/uat/artifacts/contract-findings.json`.
- **Invocation:** `MRCLEAN_UAT=1 npm run test:uat` (`--project=uat`, fileParallelism false, 180 s timeout, self-skips without the env var, "Never part of CI" charter).
- **Key reusable pieces:** sandbox `--settings`/`--mcp-config --strict-mcp-config` isolation; `findTranscript(sessionId)` scanning `~/.claude/projects/<any>/<sid>.jsonl`; `extractToolResultText`/`extractTranscriptToolData` (stream + transcript scans); `fixtureCmd(script, ENV, val)` env-baked command strings; `buildHookCommand` for registering the REAL fail-closed wrapper in sandbox settings (E5/mrclean leg precedent); resume flow with `--resume <sid>` + fallback (E3).
- **What it asserts:** harness integrity hard-asserted; contract verdicts recorded to the findings artifact (guarded writer — zero-verdict runs refuse to overwrite; unparseable artifact fails loud).

### 2. Leak-grep suites
- **Files:** `src/audit/canary-leak.ts` (`assertNoCanaryLeak(logPath, canaries)` — substring over JSON.stringify per record, ENOENT ⇒ ok, malformed ⇒ leak); `tests/audit/canary-leak.test.ts`, `pii-canary-leak.test.ts` (integration — full NER pipeline), `pii-stderr-leak.test.ts`, `restore-canary-leak.test.ts` (unit, 494 lines, four-surface matrix: success + garbage-key + chmod-000 + hand-poisoned-real-key paths).
- **Pinned Phase-11-reusable canary corpus** (10-08): `zz-canary-project-path-7g2` (WORD), `kim.canary@zz.invalid` (PII_EMAIL), `AKIAIOSFODNN7EXAMPLX` (secret — deliberately non-`EXAMPLE`-suffixed; the AWS-docs key is gitleaks-allowlisted and produces NO findings).
- **CI:** `canary-leak.yml` runs fixtures corpus + pii-canary-leak with **defense-in-depth grep steps** (shell grep of canary values over `.mrclean/audit*.jsonl` — the belt-and-suspenders pattern to extend for the reversible corpus). `restore-canary-leak.test.ts` runs in the unit project → `npm test` → test.yml.

### 3. Copy-drift gate
- **File:** `tests/copy-drift.test.ts` (216 lines, unit project). Scans `SCANNED_SOURCES` (README, THREAT_MODEL, src/shared/strings.ts, session-start.ts, doctor/report.ts, mcp check/redact) for `BANNED_COPY_PHRASES` (imported from `src/shared/strings.ts` — claim SHAPES, never the bare word "guarantee"); disclaimer-presence gate; **THREAT_MODEL reversible-mode presence gate** (requires `## Reversible Mode (v3.0)` + five H3 fragments: blast radius / secret floor / wire re-entry / key-custody / residual risks + the phrases `transcript ratchet` AND **`design commitment`**); HOOK-CONTRACT session-UUID traceability gate (every UUID quoted in the doc must exist in contract-findings.json — matters when the live leg re-stamps evidence).
- **Trap:** SC5's finalization ("shipped facts, not commitments") removes 'design commitment' wording → the gate's `toContain('design commitment')` assertion FAILS unless updated in the same change. This is by design — it forces the paired edit.

### 4. Perf CI
- **Files:** `tests/perf/user-prompt-submit.perf.test.ts`, `post-tool-use.perf.test.ts` (plain `test()` + performance.now() + manual p95, N=50, WARMUP=5, thresholds 100/200 ms; drives `runDetection` directly), `compile-once.test.ts`. Integration project. `perf.yml` runs `npx vitest run --project=integration tests/perf/`.
- **Note:** the perf tests call `runDetection`, NOT `handlePostToolUse` — the reversible persist path (hydrate/lock/persist) is not measured anywhere. STATE.md's metric row "Reversible-mode PostToolUse overhead ~4–8 ms typical / <60 ms contended worst-case — TBD (Phase 9/11)" names this phase as the last landing zone.

### 5. Stress gate (SC4 substrate)
- **File:** `tests/state/stress.test.ts` (integration project, dual-listed: unit-exclude + integration-include) + `tests/state/fixtures/stress-worker.ts` (TEST-ONLY tsup entry → gitignored `dist/state-stress-worker.js`). 16 real spawned processes × 25 txns (20 shared + 5 unique originals), go-file barrier, `WORKER_DEADLINE_MS = 500` (harness-only knob, T-09-08-06 — measured on the macOS executor: 0/400 degrades ×3 runs; production constants 50/100 untouched).
- **Assertion families (all six shipped):** (1) zero lost — exactly 100 entries; (2) counter integrity; (3) zero NNN duplicates (distinct-set size = 100, no OVF) — **this IS SC4's "no duplicate placeholders for distinct originals"**; (4+4b) cross-process identity vs the store's authoritative entry — **this IS SC4's "identical placeholders for identical originals"**; (5) zero degrades (load-bearing anti-vacuity); (6) secret floor under contention.

### 6. Chaos suite (SC3 substrate)
- **File:** `tests/state/chaos.test.ts` (unit project, 321 lines, `describe.skipIf(IS_WIN32)` + visible win32 placeholder; chmod row also skips as root). Six corruption shapes — corrupt byte @CT_OFFSET 37, truncated envelope, chmod 000, map-is-directory, deleted mid-session (+ mid-transaction delete persist proof), garbage key — each driving `handlePostToolUse` (REAL state/placeholder/detect modules, `vi.stubEnv('HOME')` seam) with the secret canary. Asserts: both runs resolve (never throw/block), `JSON.stringify(output)` contains NO raw secret (SC3's "canary is still redacted"), non-vacuity v2-tail probe (reversible branch REALLY engaged), deep-equal parity after nonce-tail strip.
- **SC3's "missing map"** = case (e) deleted + the fresh-session default; **"corrupt"** = (a)/(b)/(f); **"chmod'd"** = (c) — runs on ubuntu CI (non-root). Coverage is complete at handler level.

### 7. Mixed-content canary + inspection + fences (Phase 11 gate substrate by name)
- `tests/restore/mixed-canary.test.ts` — `describe('mixed-content canary (Phase 11 gate substrate)')`, real-pipeline WORD round-trip + secret placeholder byte-survival via `runRestore`.
- `tests/state/inspection.test.ts` — SC1-of-Phase-9 literal dir inspection + 10-08's restore byte-inertness extension (`snapshotStateTree` listings + per-file mtimeMs; post-hoc artifact byte-scan). **This is post-hoc scanning — SC2's interception adds the transient-write dimension** (a plaintext buffer written-then-deleted would evade the post-hoc scan; interception catches it at the write call).
- `tests/state/cold-path.test.ts` — import fences both directions (hook set bans `/restore/`; restore outbound five-pattern allowlist).
- `tests/hook/integration.test.ts` — **the dist-spawn precedent**: `spawnSync(process.execPath, [DIST_CLI, 'hook'], ...)` with sandboxed HOME; integration project owns the build via globalSetup.

### 8. CI wiring facts (what "gates the build" concretely means)

| Workflow | Trigger | Runs | Relevant to Phase 11 |
|----------|---------|------|---------------------|
| `test.yml` | push/PR → **main only** | `npm test` (ALL projects: unit + integration + uat-skipped) ×3 Node versions, QA-02 grep, coverage on 20.x | Already executes chaos (unit), stress (integration), copy-drift, restore leak-grep, mixed-canary, inspection, cold-path on every PR to main |
| `canary-leak.yml` | push/PR → main | fixtures corpus + pii canary (explicit files, integration) + defense-in-depth shell greps | Extension point for reversible canary corpus |
| `perf.yml` | push/PR → main | `tests/perf/` (integration) | Extension point for reversible-overhead row |
| `release*.yml` | release flow | — | untouched |

- **Milestone-branch caveat:** v3.0 work lives on `gsd/v3.0-...`; workflows fire only at PR-to-main (or a push to main). The stress/chaos gates have therefore **never run on ubuntu** — the first CI execution happens at milestone-merge PR time. `[VERIFIED: workflow `on:` blocks]`
- **Demonstrated vacuous-pass hazard:** `npx vitest run <file> --project=X` **exits 0 with ZERO files collected** when the file is not in that project's include list — found empirically in 10-07 (the plan's `--project=integration` invocation of a unit-routed file passed vacuously). Any new explicit-file CI step must confirm routing; vitest.config.ts carries "non-vacuity" comments on the dual-listing pattern for exactly this reason. `[VERIFIED: 10-07-SUMMARY deviation + vitest.config comments]`

## Gap Analysis per Success Criterion

| SC | Already shipped | Genuinely new in Phase 11 |
|----|----------------|---------------------------|
| SC1 | Chaos parity (handler-level); UAT harness + transcript/stream scans; mixed-canary (in-process restore round-trip); hook stdout discipline tests | (a) **dist-spawn parity gate** (CI): shipped-bundle stdout one-way vs reversible, nonce-normalized deep-equal — new `tests/hook/dist-parity.test.ts`, dual-listed into integration; (b) **live wire-safety UAT leg**: fixture MCP echo server carries canaries, real mrclean hook (HOME-prefixed) redacts on the wire, restore runs locally, session resumes, transcript + `~/.claude/projects/**/*.jsonl` grep proves zero canary re-entry; (c) **per-tool `tool_response` shape recording** (re-homed todo) via a parallel log-hook across Bash/Read/Grep/MCP legs → findings artifact + HOOK-CONTRACT.md section |
| SC2 | inspection.test.ts post-hoc byte-scans (final artifacts only) | **fs-write interception test** (`tests/state/fs-interception.test.ts`, unit): patch `fs`/`fs/promises` write APIs + `syncBuiltinESMExports()`, run the real two-event reversible flow + a restore run, assert NO captured buffer carries a canary/`"entries"` marker; non-vacuity probes prove both write channels intercepted (MRCLNMAP envelope magic via `fs.write`, 32-byte key via `promises.writeFile`, audit line via `appendFile`) |
| SC3 | chaos.test.ts: all named shapes, canary-redacted + never-blocked, in unit project → npm test → test.yml | Explicit non-vacuous CI naming (extend canary-leak.yml or a wire-safety step in test.yml invoking the file with routing confirmed); optionally one WORD-canary chaos row (cheap, arguably redundant — detection is store-independent); verify chmod row's root-skip is inert on CI (ubuntu runners are non-root — it is) |
| SC4 | stress.test.ts: all six families incl. both SC4-specific claims; integration project → npm test → test.yml | Explicit CI naming (same pattern); document/mitigate the ubuntu-first-run risk of the 500 ms harness deadline (options in Open Questions); NO new assertions needed — map SC4 wording to families 3/4/4b in the plan text so the verifier can trace it |
| SC5 | THREAT_MODEL `## Reversible Mode (v3.0)` (drafted in 08-06, design-commitment framing); copy-drift presence gate (5 H3 fragments + 2 phrases); BANNED_COPY_PHRASES central constant | Rewrite section to shipped-fact framing (store + restore CLI + doctor/status shipped; cite gates); update residual risks per adopted hardening (IN-02 fix shrinks AR-10-05; AR-10-02/IN-03 documented); **paired copy-drift edit**: replace the `design commitment` required-phrase with shipped-fact anchors, add "encrypted at rest" honesty assertions (require the same-user-attacker qualification fragment near the claim), add `src/doctor/checks.ts` to SCANNED_SOURCES (its `encrypted session state adapter active` detail is user-facing encryption copy), extend BANNED_COPY_PHRASES with encryption-overclaim shapes |

## Architecture Patterns

### System Architecture Diagram

```
                     CI (deterministic — gates the build at PR-to-main)
┌────────────────────────────────────────────────────────────────────────────────┐
│ npm test (test.yml, 3 Node versions)                                           │
│  ├─ unit:  chaos parity ── copy-drift(+SC5 ext) ── restore leak-grep ──        │
│  │         mixed-canary ── cold-path fences ── fs-interception (SC2, NEW)      │
│  ├─ integration (globalSetup: tsup build):                                     │
│  │         stress 16-proc (SC4) ── dist-parity (SC1a, NEW):                    │
│  │           payload.json ─► node dist/cli.js hook  (HOME=oneway-home)  ─► A   │
│  │           payload.json ─► node dist/cli.js hook  (HOME=rev-home)     ─► B   │
│  │           stripNonceTails(B) === A ∧ placeholders present ∧ no canary       │
│  │         perf (+ optional reversible-overhead row)                           │
│  └─ canary-leak.yml: fixtures corpus + pii canary + restore-canary (NEW step)  │
│         + defense-in-depth shell greps (reversible corpus added)               │
└────────────────────────────────────────────────────────────────────────────────┘

                     OPERATOR (opt-in, MRCLEAN_UAT=1 — SC1 live leg)
┌────────────────────────────────────────────────────────────────────────────────┐
│ tests/uat/wire-safety.test.ts (NEW; harness.ts reused)                         │
│                                                                                │
│  sandbox project (.mrclean/config.toml: [reversible] enabled, words canary)    │
│  sandbox mrclean-home (HOME= prefix baked into hook command ONLY)              │
│  fixture MCP echo server (SDK, foreign name) ── emits WORD+secret canaries     │
│        │                                                                       │
│        ▼                 claude -p (real HOME: auth + transcripts intact)      │
│  PostToolUse (mrclean real hook, tee'd stdout side-file)                       │
│        ├─► string updatedToolOutput HONORED for MCP (E1 verdict)               │
│        ├─► reversible map persists in sandbox-home sessions/                   │
│        ▼                                                                       │
│  ASSERT: transcript + stream-json + hook-stdout side-file carry v2 tokens,     │
│          NEVER canary originals; grep ~/.claude/projects/**/*.jsonl = 0 hits   │
│        │                                                                       │
│        ▼  operator restore (LOCAL): HOME=<sandbox> node dist/cli.js restore    │
│  ASSERT: original ON restore stdout (non-vacuity)                             │
│        ▼  claude -p --resume <sid> (post-restore continuation)                 │
│  ASSERT: run-2 transcript/stream still ZERO originals (no re-entry ratchet)    │
│                                                                                │
│  + parallel log-hook legs (Bash/Read/Grep/MCP): raw tool_response JSON per     │
│    tool → findings artifact → docs/HOOK-CONTRACT.md §tool_response shapes      │
└────────────────────────────────────────────────────────────────────────────────┘

                     DOCS LOCK (SC5)
┌────────────────────────────────────────────────────────────────────────────────┐
│ THREAT_MODEL.md reversible section: commitments ─► shipped facts (+gates cited)│
│ tests/copy-drift.test.ts: 'design commitment' requirement REPLACED in the      │
│   SAME commit; +encrypted-at-rest honesty fragments; +doctor copy source;      │
│   +BANNED_COPY_PHRASES encryption-overclaim shapes (src/shared/strings.ts)     │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (Phase 11 delta)

```
tests/
├── hook/dist-parity.test.ts        # NEW — SC1a; DUAL-LIST: unit exclude + integration include
├── state/fs-interception.test.ts   # NEW — SC2 (unit project, in-process)
├── uat/wire-safety.test.ts         # NEW — SC1b live leg + tool_response survey (uat project)
├── uat/fixtures/echo-mcp-server.mjs  # NEW — ~40-line SDK stdio server, canary via env
├── uat/fixtures/postresp-log-hook.sh # NEW — logs raw tool_response JSON per tool (side file)
├── copy-drift.test.ts              # EXTEND — SC5 paired gate changes
├── restore/session-index.test.ts   # EXTEND — IN-02 collision-demote row
├── cli/restore.test.ts (or degrade)# EXTEND — IN-01 zero-counts-on-catch row
└── perf/post-tool-use-reversible.perf.test.ts  # OPTIONAL — closes STATE.md TBD metric
src/
├── restore/session-index.ts        # IN-02: demote duplicate placeholder w/ different original
├── restore/cli.ts                  # IN-01: counts=ZERO_COUNTS in catch + guarded fallback write
└── shared/strings.ts               # SC5: additive BANNED_COPY_PHRASES entries
.github/workflows/
├── test.yml or canary-leak.yml     # EXTEND — explicit wire-safety steps (routing-confirmed)
THREAT_MODEL.md                     # SC5 finalization
docs/HOOK-CONTRACT.md               # tool_response shapes section + re-stamps
vitest.config.ts                    # dist-parity dual-listing (non-vacuity comments per precedent)
```

### Pattern 1: Dist-spawn parity (SC1 deterministic leg)

**What:** Spawn the SHIPPED bundle twice with an identical canary-bearing PostToolUse payload — sandbox HOME A (no `[reversible]`) vs sandbox HOME B (`[reversible] enabled = true` in `<home>/.mrclean/config.toml`) — and assert stdout parity after v2 nonce-tail normalization, plus canary absence in both.
**When to use:** the CI-side proof of "hook stdout is unchanged by reversible mode" at the artifact level (unit-level chaos parity already exists; 09-08's two dist-only bugs justify the spawn level).
**Key mechanics** (all shipped precedents):

```ts
// Source: tests/hook/integration.test.ts spawn recipe + tests/state/chaos.test.ts
// normalization + fixture constants — composed, nothing new invented.
const V2_TAIL_RE = /(<MRCLEAN:[A-Z0-9_]+:(?:\d{3}|OVF)):[a-f0-9]{8}>/g   // duplicate, do not re-derive
const SECRET = 'AKIAIOSFODNN7EXAMPLX'   // canonical detectable positive (EXAMPLE is allowlisted!)

function runHook(home: string, payload: object) {
  return spawnSync(process.execPath, [DIST_CLI, 'hook'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: home },   // POSIX: os.homedir() reads $HOME — win32 skip (chaos precedent)
    timeout: 30_000,
  })
}
// Payload: PostToolUse, tool_name Bash, tool_response carrying SECRET + a session_id (fresh UUID per run).
// Assert: exit 0 both; stdout non-empty both (substitution occurred — non-vacuity);
//         JSON.parse(B).…updatedToolOutput matches V2_TAIL probe (reversible branch REALLY engaged);
//         stripNonceTails(parse(B)) deepEqual parse(A); neither stdout contains SECRET;
//         sandbox-home-B sessions/<sid>.map exists and its raw bytes lack SECRET (spot-check).
```

Routing: integration project (needs `dist/`); dual-list in vitest.config.ts exactly like `tests/state/stress.test.ts` (unit exclude + integration include, with the non-vacuity comment).

### Pattern 2: Live wire-safety leg (SC1 live half + re-homed todo)

**What:** One new opt-in UAT file composing shipped pieces; canaries originate ONLY inside the fixture MCP tool result (never the prompt — otherwise the prompt itself puts the canary into model context and the transcript grep is unwinnable by design).
**Sequencing:**
1. Sandbox project dir with `.mrclean/config.toml` (`[reversible] enabled=true` is read from the PROJECT layer too, but state baseDir derives from HOME — so ALSO bake `HOME=<sandbox-mrclean-home>` into the hook command string via the `fixtureCmd` env-prefix precedent; `claude` itself keeps the real HOME for auth/transcripts). Words file carries `zz-canary-project-path-7g2|warn` so Layer 4 detects the WORD canary (`word|action` grammar `[VERIFIED: src/detect/layer4-words.ts]`).
2. Register mrclean's REAL hook (`buildHookCommand(process.execPath, DIST_CLI)` with the HOME prefix) for PostToolUse in sandbox settings; wrap with a `tee`-style side-file capture of hook stdout if byte-level live stdout evidence is wanted (optional — transcript/stream signals may suffice; decide at plan time).
3. Fixture MCP echo server (`echo-mcp-server.mjs`, `@modelcontextprotocol/sdk` stdio, tool name NOT matching `MRCLEAN_TOOL_RE`) returns text embedding the WORD + secret canaries (canaries passed via env at server registration, never in the prompt).
4. Run 1: prompt = "call the echo tool and quote its output". PostToolUse fires → detection → string `updatedToolOutput` (HONORED for MCP per E1) → placeholders on the wire; reversible map persists in sandbox home.
5. **Hard assertions (mrclean-owned invariants):** v2-token present in transcript/stream tool_result (non-vacuity: reversible engaged + substitution shipped); WORD and secret canaries ABSENT from stream-json, the session transcript, and a full grep of `~/.claude/projects/**/*.jsonl` (canaries are globally unique strings — whole-dir grep is safe and strictly stronger).
6. Restore leg: `spawnSync(process.execPath, [DIST_CLI, 'restore'], { env: {...process.env, HOME: sandboxMrcleanHome}, input: transcriptExtractedTokenDoc })` → assert WORD original ON restore stdout (non-vacuity), secret placeholder byte-survives.
7. Run 2: `claude -p --resume <sid>` follow-up prompt ("summarize the tool result you saw") — assert run-2 stream/transcript delta still contains ZERO canary originals (the post-restore no-re-entry proof; restore is store-byte-inert per 10-08, so the map it read cannot have been altered).
8. Cleanup: delete the sandbox mrclean-home (map+key) and note the sandbox transcript files left under `~/.claude/projects/` (same residue every UAT run already leaves).
**tool_response shape survey (re-homed STATE.md todo):** separate cheap legs — register `postresp-log-hook.sh` (a `log-hook.sh` sibling that appends `{tool_name, typeof tool_response, raw tool_response JSON (truncated)}` to a side file) as an ADDITIONAL PostToolUse hook (hooks run in parallel; each receives the payload) across Bash, Read, Grep, and the MCP tool legs. Record-don't-assert → findings artifact via the guarded builder pattern → new `docs/HOOK-CONTRACT.md` section "Per-tool tool_response shapes (PostToolUse input)" with version stamps. Downstream consumer: documents whether `JSON.stringify` coercion (Step 3 of the handler) is scanning structured shapes adequately per tool.

### Pattern 3: fs-write interception (SC2) — VERIFIED seam

**What:** In-process capture of every buffer handed to a write API during a real reversible flow + restore run.
**Why this seam:** `vi.mock('node:fs')` does not reach externalized CJS deps — write-file-atomic does `require('fs')` and `promisify(fs.write)` per call `[VERIFIED: node_modules/write-file-atomic/lib/index.js:116]`; property-patching the builtin CJS export object reaches it, and `module.syncBuiltinESMExports()` updates the ESM named bindings (`import { writeFile } from 'node:fs/promises'` in map-store.ts) to match.
**Live probe run this session (Node v22.22.0, repo's actual write-file-atomic):** patching `fsPromises.writeFile` + `fs.write` then `syncBuiltinESMExports()` captured BOTH the ESM named-import write AND write-file-atomic's fd-based temp-file write, buffer contents included. `[VERIFIED: probe executed 2026-07-17]`

```ts
// Source: verified probe, 2026-07-17 (this session). Sketch of the test seam:
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'

const captured: Array<{ api: string; target: string; bytes: Buffer }> = []
const originals = { write: fs.write, pWriteFile: fsPromises.writeFile, pAppendFile: fsPromises.appendFile /* +sync & callback variants */ }

fsPromises.writeFile = function (p, data, o) { captured.push({ api: 'p.writeFile', target: String(p), bytes: toBuf(data) }); return originals.pWriteFile.call(this, p, data, o) } as typeof fsPromises.writeFile
fs.write = function (fd, data, ...rest) { captured.push({ api: 'fs.write', target: `fd:${fd}`, bytes: toBuf(data) }); return (originals.write as any).call(this, fd, data, ...rest) } as typeof fs.write
// ...same for appendFile / writeFile / writev / *Sync variants (belt-and-braces)
syncBuiltinESMExports()
try {
  // real two-event facade flow (inspection.test.ts recipe): WORD then AWS_KEY
  // then a real runRestore against the persisted state (audit append included)
} finally {
  fs.write = originals.write; fsPromises.writeFile = originals.pWriteFile; /* restore all */
  syncBuiltinESMExports()
}
// ASSERT: no captured.bytes contains WORD_ORIGINAL / SECRET_ORIGINAL / '"entries"'.
// NON-VACUITY (coverage proof, all three write channels):
//   - some fs.write capture starts with 'MRCLNMAP'      → wfa TEMP-file envelope intercepted
//   - some p.writeFile capture is 32 bytes to *.key.*   → key tmp intercepted (publishKeyOnce)
//   - some appendFile capture targets audit.jsonl        → audit line intercepted (hash-only)
```

**Write-API inventory on the guarded surface** `[VERIFIED: grep this session]`: `fsPromises.writeFile` (key tmp, map-store.ts:210), `fs.write` via wfa (map envelope tmp), `fsPromises.appendFile` (audit log.ts:114 + restore-log.ts:116). `link/rename/mkdir/unlink` carry no buffers. `FileHandle.write` exists only in model-cache (not on the reversible path) — note as a documented non-target with the non-vacuity probes proving the channels that matter are covered. Runs in the unit project — vitest per-file worker isolation makes process-global patching safe; restore in `finally`.

### Pattern 4: Explicit non-vacuous CI steps (SC3/SC4 elevation + leak-grep extension)

**What:** canary-leak.yml-style named steps (explicit file invocation + defense-in-depth shell grep), with routing verified against the demonstrated vacuous-pass hazard.

```yaml
# Pattern source: .github/workflows/canary-leak.yml (shipped)
- name: Wire-safety — restore leak-grep + chaos + dist parity (REVMODE-11)
  run: |
    npx vitest run --project=unit tests/audit/restore-canary-leak.test.ts tests/state/chaos.test.ts
    npx vitest run --project=integration tests/hook/dist-parity.test.ts tests/state/stress.test.ts
- name: Defense-in-depth grep — reversible canary corpus absent from audit logs
  run: |  # extend the existing loop with: zz-canary-project-path-7g2, kim.canary@zz.invalid, AKIAIOSFODNN7EXAMPLX
```

Anti-vacuity: (a) keep files correctly project-routed (dual-listing where dist is needed); (b) optionally assert collected-file count in the step (`| tee /dev/stderr | grep -q "Test Files.*[1-9]"`) or add a tiny unit meta-test asserting vitest.config include/exclude entries for the gate files — 10-07's demonstrated zero-file exit-0 makes this a real failure mode, not paranoia.

### Anti-Patterns to Avoid

- **Fixing the PostToolUse string→object emission in this phase** — see Pitfall 1. Verification phase; frozen trees stay frozen.
- **Hard-asserting upstream contract behavior in the live leg** (e.g., "MCP string form is honored") — that's a recorded verdict; CC 2.1.212 may drift from the 2.1.209 stamps. Hard-assert only harness integrity + mrclean-owned invariants (canary absence, v2-token presence *conditional on the substitution having shipped* — if the MCP leg's verdict flips on 2.1.212, the leg records the drift and the canary-absence assertions still hold or fail honestly).
- **Putting canaries in the prompt** of the live leg — the prompt enters model context before any hook can substitute (UserPromptSubmit only blocks/annotates); transcript greps become unwinnable by design, not by defect.
- **Overriding HOME for the whole `claude` process** — kills auth (`~/.claude`); prefix the hook command only.
- **Weakening the zero-degrade stress assertion to fix ubuntu timing** — the deadline constant is the ONLY knob (T-09-08-06, restated in the test header).
- **Editing `V2_TOKEN_RE`/grammar or re-deriving envelope offsets in new tests** — duplicate the pinned constants (chaos/map-store precedent); the grammar sync-lock test exists for drift.
- **Removing 'design commitment' from THREAT_MODEL without the paired copy-drift edit** — the unit suite fails; do both in one commit with the gate diff explained.
- **New shared state between restore and redact paths while hardening IN-01/IN-02** — the outbound import allowlist fence will (correctly) fail CI.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Live session driving/parsing | new spawn/stream machinery | `tests/uat/harness.ts` (`runClaude`, `assertSessionRan`, StreamEvent) | Shipped; handles auth-failure vacuous-pass trap |
| Transcript location/scanning | cwd-slug derivation | `findTranscript` + `extractTranscriptToolData` (contract-verification.test.ts) | Slug format is undocumented; the UUID scan is proven |
| Findings persistence for the shape survey | ad-hoc JSON writes | `buildFindingsArtifact` guard/carry-forward pattern (findings-builder.ts) | Zero-verdict overwrite protection already solved (WR-01 lineage) |
| Audit leak scanning | new grep code | `assertNoCanaryLeak` (src/audit/canary-leak.ts) | Substring-over-stringify, malformed-line defense shipped |
| MCP fixture server plumbing | raw stdio JSON-RPC | `@modelcontextprotocol/sdk` `McpServer` + `StdioServerTransport` (existing dep; src/mcp.ts precedent) | ~40 lines vs protocol hand-rolling |
| v2-token normalization / parity shape | new regex/diff logic | `V2_TAIL_RE` + `stripNonceTails` (chaos.test.ts) — duplicate verbatim | Pinned; divergence = silent parity weakening |
| Store fixtures for interception/parity | hand-written map JSON | `runReversibleEvent` facade recipe (inspection.test.ts) / seed helpers (chaos.test.ts) | Pitfall 10 lineage: hand-built state bypasses the serializer strip and invalidates the proof |
| CI leak gates | new workflow shape | canary-leak.yml step pattern (vitest + defense-in-depth grep) | Belt-and-suspenders pattern already reviewed/shipped |
| Capturing restore CLI output in-process | new harness | `captureRestoreRun` (inspection.test.ts) / capture harness (tests/cli/restore.test.ts, duplicated-by-value convention) | Exit/stdout/stderr seams solved incl. exitCode discipline |

**Key insight:** Phase 11 composes ten shipped mechanisms; the only novel machinery is the fs-write patch seam (verified live this session) and a ~40-line MCP echo fixture.

## Hardening Residuals — adopt-or-defer (research recommendation, planner confirms)

| Item | Source | Recommendation | Rationale |
|------|--------|----------------|-----------|
| Cross-session token collision → silent last-write-wins | AR-10-05 / review IN-02 (`src/restore/session-index.ts:150` — `placeholders.set` overwrites) | **ADOPT** | AR-10-05 names Phase 11 as "the landing zone if hardening is wanted"; fix is ~6 lines (on duplicate placeholder with a DIFFERENT original: delete from `placeholders` — demote to unmatched, mirroring the OVF ambiguity treatment) + one two-session test row; converts silent wrong-value restore (the exact class the OVF exclusion exists for) into safe pass-through; THREAT_MODEL residual then shrinks to a documented note |
| Stale non-zero counts on error report; fallback write can rethrow | review IN-01 (`src/restore/cli.ts:211-221` — catch path keeps pre-computed `counts`; fallback `stdout.write(input)` unguarded) | **ADOPT** | ~5 lines (reset `counts = ZERO_COUNTS` in the catch; wrap the fallback write in try/catch) + one row in degrade tests; repairs the "cosmetic failure can never produce a nonzero exit" contract; squarely in this phase's degrade-honesty remit |
| Truncated-hash dictionary confirmability | AR-10-02 / IN-03 | **KEEP ACCEPTED** | Matches shipped hook audit discipline; salting breaks operator cross-record correlation; SC5 documents it in the finalized residuals |
| `readRawReversibleKeys` scaffold duplication | IN-04 | **DEFER** | Refactor-only, no security delta, touches the config loader (risk > benefit in a verification phase) |
| Pre-existing typecheck strict-drift (3 test files listed in phase-10 deferred-items; 38-error repo baseline) | 10 deferred-items.md | **DEFER to a quick task** | Not wire-safety; the differential-baseline gate already blocks NEW errors; full cleanup touches LOCKED modules (src/audit/log.ts) |
| Reversible-mode PostToolUse overhead measurement | STATE.md metric "TBD (Phase 9/11)" | **RECOMMEND ADOPT (small)** | Phase 11 is the metric's last named window; one integration perf row driving `handlePostToolUse` with reversible enabled (chaos HOME-stub seam), p95 < 200 ms budget + logged overhead delta; perf.yml picks it up via the existing `tests/perf/` glob — discretionary, cut first if the phase runs long |
| PostToolUse object-shape emission fix (Bash redaction inert on 2.1.209) | THREAT_MODEL §3 mitigation note; #68951/#77587 | **OUT OF SCOPE — explicit fence** | See Pitfall 1 |

## Common Pitfalls

### Pitfall 1: Scope-drifting into the E1 object-shape emission fix
**What goes wrong:** SC1's live leg re-confirms that mrclean's string-form `updatedToolOutput` is rejected for built-in Bash (original stays on the wire), and the temptation is to "fix redaction while we're here."
**Why it happens:** THREAT_MODEL §3's mitigation sentence reads like a work item; the live gate makes the gap vividly observable.
**How to avoid:** REVMODE-11 is about the reversible-mode DELTA and restore re-entry — the Bash gap is identical in one-way mode (parity holds) and is a documented shipped known-gap with upstream #77587 filed (verified OPEN 2026-07-17). The fix rewrites `src/hook/handlers/post-tool-use.ts` emission (frozen-tree discipline, byte-identical one-way locks, doctor copy, chaos normalization) — a dedicated future effort. Plan text should name this fence.
**Warning signs:** any plan task touching Step 7 emission shape or `src/hook/**`.

### Pitfall 2: Vacuous CI steps (demonstrated in this repo)
**What goes wrong:** `npx vitest run <file> --project=X` exits 0 with zero files when the file isn't in project X's include list — 10-07 hit exactly this. A new dist-parity test landing in the unit glob (default `tests/**`) would spawn a possibly-stale `dist/` with no build guarantee, or a CI step naming the wrong project would pass forever while testing nothing.
**How to avoid:** dual-list dist-dependent files (stress.test.ts precedent, with the non-vacuity config comments); grep step output for a non-zero file count or add a config-routing meta-assertion; run each new CI step once with the target file deliberately mis-rooted to see it fail (sabotage spot-check discipline from 10-07).

### Pitfall 3: Live-leg canary placement and UPS interference
**What goes wrong:** placing canaries in the prompt puts them into model context pre-hook (transcript grep fails by design); a `block`-action word canary can get the whole prompt blocked by UserPromptSubmit if it ever appears there.
**How to avoid:** canaries live ONLY in the fixture MCP tool's output (env-fed to the server); word-list entry uses `|warn`; the prompt references the tool by name, never the canary values.

### Pitfall 4: HOME juggling in the live leg
**What goes wrong:** overriding HOME for `claude` breaks `~/.claude` auth; NOT overriding it for the hook writes reversible state into the operator's real `~/.mrclean` (and the real TTL janitor then owns your fixtures).
**How to avoid:** bake `HOME=<sandbox-mrclean-home>` into the hook command string only (fixtureCmd precedent); same env override on the spawned `dist/cli.js restore`. Transcripts still land in the real `~/.claude/projects/` — that residue is the assertion surface and matches existing UAT behavior. win32: HOME env is ignored by `os.homedir()` — POSIX-only legs with visible skips (chaos WR-04 precedent).

### Pitfall 5: Claude Code version drift vs stamped verdicts
**What goes wrong:** local CLI is now 2.1.212; all E1–E5 verdicts are stamped 2.1.209. If 2.1.212 changed shape validation (e.g., #68951 fixed), the live leg's MCP-honored assumption or the Bash-inert observation shifts — a hard-asserting harness would turn contract drift into red CI/UAT.
**How to avoid:** record-don't-assert for contract observations; re-stamp HOOK-CONTRACT.md and contract-findings.json from the run (the findings writer's carry-forward protects interactive-only evidence); the copy-drift UUID-traceability gate means any doc UUID citations must trace to the refreshed artifact — update doc and artifact together.
**Warning signs:** `verbatim_hook_error` absent where expected; Bash leg suddenly showing the rewrite honored.

### Pitfall 6: Stress gate's first-ever ubuntu run happens at milestone-merge PR
**What goes wrong:** the 500 ms harness deadline is macOS-executor-measured; GitHub's 2-core ubuntu runner has different lock-acquire tails. A flake at PR-to-main time blocks the milestone merge with no prior signal.
**How to avoid:** options (planner picks one): (a) add `workflow_dispatch` (and/or a `gsd/**` push trigger) to test.yml and run it once from the milestone branch before the merge PR; (b) pre-emptively raise ONLY the harness deadline knob with a measured-margin comment; (c) accept and document the knob (T-09-08-06 sanctions re-measuring). Never touch the zero-degrade assertion.

### Pitfall 7: SC2 patch hygiene
**What goes wrong:** leaving builtin fs patched after a failing test poisons subsequent tests in the same worker file; patching after the SUT flow started misses early writes; forgetting `syncBuiltinESMExports()` silently misses all ESM named-import writes (the test would then pass vacuously except for the non-vacuity probes — which is why they're mandatory).
**How to avoid:** install patches in the test body before the flow, restore in `finally` + re-sync; the three channel-coverage probes (MRCLNMAP magic via fs.write, 32-byte key via promises.writeFile, audit line via appendFile) are load-bearing, not decoration.

### Pitfall 8: Copy-drift gate self-collision on SC5
**What goes wrong:** finalizing THREAT_MODEL removes 'design commitment' → existing required-phrase assertion fails; conversely, new BANNED phrases for encryption overclaims can flag the honest key-custody prose itself (the "Pitfall 5" lesson inside copy-drift.test.ts: ban claim SHAPES, never the words the honest copy needs).
**How to avoid:** one commit pairs doc + gate; new banned regexes get the same positive-control + honest-copy self-check tests the existing gate has; required fragments chosen from stable phrases the finalized section will genuinely carry (e.g., 'not a defense against local compromise'-class fragment for §4).

### Pitfall 9: Restore-leg non-vacuity in the live gate
**What goes wrong:** if the reversible branch silently didn't engage live (config not picked up through the HOME prefix, sid invalid), the map is empty, restore pass-through "restores" nothing, and every canary-absent assertion passes while proving nothing.
**How to avoid:** chain of non-vacuity gates: v2-tail probe on the transcript tool_result (proves reversible tokens shipped), sandbox sessions/<sid>.map exists, restore stdout CONTAINS the WORD original with `restored>=1` in the summary line — all before any absence assertion (10-08 ordering discipline).

## Code Examples

### SC2 interception probe (executed successfully this session)

```js
// Source: live probe, 2026-07-17, Node v22.22.0, repo's node_modules/write-file-atomic
// Output captured BOTH channels:
//  [promises.writeFile, /tmp/.../esm-out.txt, ESM_NAMED_IMPORT_PAYLOAD]   ← ESM named import
//  [fs.write(fd), fd:13, WFA_TMPFILE_PAYLOAD]                             ← wfa TEMP file bytes
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
const captured = []
const realPWriteFile = fsPromises.writeFile, realWrite = fs.write
fsPromises.writeFile = function (p, d, o) { captured.push(['promises.writeFile', String(p), String(d).slice(0, 40)]); return realPWriteFile.call(this, p, d, o) }
fs.write = function (fd, d, ...r) { captured.push(['fs.write(fd)', 'fd:' + fd, d.toString('utf8').slice(0, 40)]); return realWrite.call(this, fd, d, ...r) }
syncBuiltinESMExports()
```

### Fixture MCP echo server skeleton (live leg)

```js
// tests/uat/fixtures/echo-mcp-server.mjs — Source: @modelcontextprotocol/sdk (existing dep),
// src/mcp.ts registration precedent. Tool name must NOT match MRCLEAN_TOOL_RE
// (mrclean self-exempts its own tools on PostToolUse).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod/v4'
const server = new McpServer({ name: 'wire-canary', version: '0.0.0' })
server.registerTool('echo_project_notes',
  { description: 'returns project notes', inputSchema: {} },
  async () => ({ content: [{ type: 'text', text: process.env.CANARY_TEXT ?? '' }] }))
await server.connect(new StdioServerTransport())
```
(Verify the exact `registerTool` signature against the installed SDK at plan-execution time — src/mcp.ts is the in-repo ground truth to copy from.)

### IN-02 demote-on-conflict (hardening adopt)

```ts
// src/restore/session-index.ts — replace the bare set at line ~150.
// Mirrors the OVF ambiguity treatment: an ambiguous token restores NOTHING.
const existing = placeholders.get(entry.placeholder)
if (existing !== undefined && existing !== entry.original) {
  placeholders.delete(entry.placeholder)   // cross-session collision → demote to unmatched
  continue
}
placeholders.set(entry.placeholder, entry.original)
```
(Note: `delete` alone leaves a later third occurrence free to re-set — track demoted tokens in a local `Set` and check it first; the test row seeds two sessions with a forced identical placeholder via hand-built maps encrypted under real keys, the 10-02 poisoned-map recipe.)

## State of the Art

| Old Approach / Belief | Current Verified Fact | When Verified | Impact |
|--------------|------------------|--------------|--------|
| Phase 8 verdicts current | Local CLI is **2.1.212**; all E1–E5 stamps are 2.1.209 | claude --version, 2026-07-17 | Live leg re-stamps; record-don't-assert protects against drift (Pitfall 5) |
| #68951 (string updatedToolOutput ignored for Bash) possibly fixed | Still **OPEN** | gh issue view, 2026-07-17 | Live-leg canary carrier stays MCP; Bash redaction remains the documented known gap |
| #77587 (mrclean's upstream ask) status unknown | Still **OPEN** | gh issue view, 2026-07-17 | THREAT_MODEL finalization cites it as filed-and-open |
| "Phase 11 elevates the suites to CI" implies they're not in CI yet | chaos/stress/copy-drift/restore-leak already execute under `npm test`, which test.yml runs — but ONLY on push/PR to **main**; the milestone branch has never triggered them on ubuntu | workflows + vitest.config read, 2026-07-17 | SC3/SC4 delta is explicit naming + ubuntu-first-run risk management, not new suites |
| SC2 needs exotic tooling (strace/LD_PRELOAD) | Builtin-fs patch + `syncBuiltinESMExports()` reaches ESM named imports AND wfa's fd writes | live probe, 2026-07-17 | SC2 is a plain unit test |
| THREAT_MODEL reversible section is final | Still carries "not yet built / design commitment" framing for the Phase 9 store + Phase 10 CLI (both now shipped) | file read, 2026-07-17 | SC5 rewrite is real work, with the paired copy-drift edit (Pitfall 8) |

**Deprecated/outdated:** the STATE.md open todo "per-tool empirical verification of structured `tool_response` shapes" was re-homed to this phase by Phase 10 (roadmap note) — it is the live leg's survey, not a CLI concern.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `HOME=` prefix baked into the hook command string isolates mrclean's config/state for the hook process while `claude` keeps real-HOME auth | Pattern 2 | Medium — if the hook wrapper's shell layer drops the prefix, reversible state lands in the real `~/.mrclean` (cleanup + sid-scoped janitor bounds the blast radius); first live run verifies via the sandbox map-exists probe |
| A2 | The MCP-string-form `updatedToolOutput` remains honored on 2.1.212 (E1/MCP verdict from 2.1.209) | Pattern 2 | Medium — if it flipped, the live leg's substitution-on-the-wire carrier vanishes; record-don't-assert converts this to a drift finding, and the deterministic dist-parity leg still carries SC1's CI proof |
| A3 | `claude -p --resume <sid>` works from the sandbox cwd on 2.1.212 (E3 proved it on 2.1.209) | Pattern 2, step 7 | Low — E3's `--continue` fallback is already coded in the shipped harness pattern |
| A4 | ubuntu-latest 2-core handles the 16-process stress burst within the 500 ms harness deadline | Pitfall 6 | Medium — flake at milestone-merge PR; mitigations enumerated (dispatch pre-run / knob re-measure), zero-degrade assertion untouched either way |
| A5 | Hooks registered on the same event all receive the payload (parallel execution) — the shape-survey log-hook can ride alongside mrclean's real hook | Pattern 2 (survey) | Low — documented hook behavior used by 08 experiments; if serialized-with-interference, run survey legs with the log-hook alone (shapes don't need mrclean in the loop) |
| A6 | `registerTool` SDK signature in the sketch matches the installed `@modelcontextprotocol/sdk@^1.29` | Code Examples | Low — copy from src/mcp.ts (in-repo ground truth) at implementation time |

## Open Questions (RESOLVED)

1. **How should the ubuntu-first-run risk for the stress gate be retired?** (Pitfall 6)
   - What we know: 500 ms deadline is macOS-measured; workflows only fire at PR-to-main; T-09-08-06 sanctions re-measuring the knob (never the assertion).
   - Recommendation: add `workflow_dispatch` to test.yml (2-line change) and run once from the milestone branch during this phase; fall back to knob adjustment only on observed evidence.
   - **RESOLVED** (2026-07-17): pinned in ROADMAP.md's Phase 11 planner-pin note — workflow_dispatch + `gsd/**` push triggers on test.yml/canary-leak.yml, one-time milestone-branch pre-run retires the risk (WORKER_DEADLINE_MS the only knob, T-09-08-06); executed by 11-06 Task 2.
2. **Does SC1's live leg need byte-level hook-stdout capture (tee wrapper), or do transcript/stream signals suffice?**
   - What we know: the dist-parity leg already proves stdout parity deterministically at the artifact level; the live leg's transcript/stream scans prove the wire outcome.
   - Recommendation: skip the tee wrapper (it perturbs the fail-closed wrapper shape being tested); treat dist-parity as the stdout proof, live leg as the wire proof. Planner may add the tee as a stretch observation.
   - **RESOLVED** (2026-07-17): pinned in ROADMAP.md's Phase 11 planner-pin note — NO tee wrapper; dist-parity is the stdout proof, the live leg is the wire proof; adopted by 11-05.
3. **Which stable phrase anchors replace 'design commitment' in the copy-drift gate?**
   - What we know: the gate needs greppable fragments the finalized section genuinely carries (Pitfall 8).
   - Recommendation: decide at THREAT_MODEL-rewrite time; candidates: a "verified against the shipped implementation" stamp line, the §4 same-user-attacker fragment, and the existing 'transcript ratchet' phrase (kept).
   - **RESOLVED** (2026-07-17): pinned in ROADMAP.md's Phase 11 planner-pin note — anchors pinned to 'verified against the shipped implementation' + 'not a defense against a same-user local attacker', with 'transcript ratchet' kept; executed by 11-07.
4. **Adopt the optional reversible-overhead perf row?**
   - What we know: STATE.md metric TBD names Phase 9/11; nothing in SC1–SC5 requires it.
   - Recommendation: include as the last, cut-first task; measurement drives `handlePostToolUse` with the chaos HOME-stub seam under the existing 200 ms budget.
   - **RESOLVED** (2026-07-17): pinned in ROADMAP.md's Phase 11 planner-pin note — perf row ADOPTED as the cut-first task; executed by 11-06 Task 3.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 20 | all gates; `syncBuiltinESMExports` | ✓ | v22.22.0 | — |
| Claude Code CLI (authenticated) | SC1 live leg + shape survey | ✓ | 2.1.212 | none for the live leg — but SC1's CI proof (dist-parity) is claude-independent |
| `gh` CLI (authenticated) | upstream issue re-checks in docs | ✓ | account fuzzyqbit | web UI |
| npm scripts (test / test:uat / build / typecheck) | all waves | ✓ | per package.json | — |
| API budget (~5–12 Haiku calls) | live leg (2 sessions + survey legs) | ✓ (operator consent via MRCLEAN_UAT opt-in) | ~cents | reduce survey matrix |
| GitHub Actions (ubuntu-latest) | "gates the build" | ✓ (fires at PR-to-main; dispatch optional) | — | local `npm test` as phase regression gate |
| `~/.claude/projects/` transcript dir | live-leg grep surface | ✓ (prior UAT runs observed) | — | stream-json only (weaker — flag if hit) |

**Missing dependencies with no fallback:** none.

## Validation Architecture

> This phase IS validation — the map below is the phase's deliverable inventory. `workflow.nyquist_validation: true` `[VERIFIED: .planning/config.json]`.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.6 (projects: `unit` parallel / `integration` sequential + tsup globalSetup / `uat` opt-in) |
| Config file | `vitest.config.ts` (edited this phase: dist-parity dual-listing) |
| Quick run command | `npx vitest run --project=unit <file>` |
| Full suite command | `npm test` (baseline entering Phase 11: 944 passed / 18 skipped, 101 files — 10-08 recorded) + `npm run typecheck` (38-error differential baseline) |

### Phase Requirements → Test Map
| Req ID | Behavior (SC) | Test Type | Automated Command | File Exists? |
|--------|--------------|-----------|-------------------|-------------|
| REVMODE-11 / SC1a | Shipped-bundle hook stdout parity one-way vs reversible (nonce-normalized deep-equal, placeholders present, zero canary) | integration (spawn dist) | `npx vitest run tests/hook/dist-parity.test.ts --project=integration` | ❌ Wave 0 (NEW + vitest.config dual-list) |
| REVMODE-11 / SC1b | Live canary never on the wire; restore-then-resume no re-entry; `~/.claude/projects/**/*.jsonl` grep = 0 | live UAT (opt-in, tokens; operator-run at verify-work) | `MRCLEAN_UAT=1 npm run test:uat` (`-t 'wire-safety'`) | ❌ Wave 0 (NEW: tests/uat/wire-safety.test.ts + 2 fixtures) |
| REVMODE-11 / SC1b (survey) | Per-tool `tool_response` shapes recorded (re-homed todo) | live UAT, record-don't-assert → findings artifact + HOOK-CONTRACT section | same run | ❌ Wave 0 (same file) |
| REVMODE-11 / SC2 | No plaintext canary in ANY written buffer incl. atomic-write temp files; channel-coverage probes | unit (in-process patch seam) | `npx vitest run tests/state/fs-interception.test.ts --project=unit` | ❌ Wave 0 (NEW) |
| REVMODE-11 / SC3 | Corrupt/missing/chmod'd map ⇒ canary still redacted, never a block (six shapes, parity) | unit (existing) + explicit CI step | `npx vitest run tests/state/chaos.test.ts --project=unit` | ✅ existing (extend CI wiring only) |
| REVMODE-11 / SC4 | 16-proc: zero lost/corrupted, no dup placeholders for distinct originals (family 3), identical placeholders for identical originals (families 4/4b), zero degrades | integration (existing) + explicit CI step | `npx vitest run tests/state/stress.test.ts --project=integration` | ✅ existing (extend CI wiring only) |
| REVMODE-11 / SC5 | THREAT_MODEL finalized to shipped facts; copy-drift covers encrypted-at-rest + honest framing; doctor copy scanned | unit (extend) | `npx vitest run tests/copy-drift.test.ts --project=unit` | ✅ extend (paired with THREAT_MODEL + strings.ts edits) |
| REVMODE-11 / hardening | IN-02 collision demote-to-unmatched; IN-01 zero-counts + guarded fallback on catch | unit (extend) | `npx vitest run tests/restore/session-index.test.ts tests/restore/degrade.test.ts tests/cli/restore.test.ts --project=unit` | ✅ extend |
| REVMODE-11 / leak-grep CI | restore-canary suite + reversible corpus greps in canary-leak.yml | CI workflow | (CI) `npx vitest run --project=unit tests/audit/restore-canary-leak.test.ts` + grep steps | ✅ suite exists; ❌ workflow step |
| (optional) perf | Reversible PostToolUse overhead p95 < 200 ms (STATE.md TBD metric) | integration perf | `npx vitest run --project=integration tests/perf/` | ❌ optional Wave 0 |

**Manual-only:** SC1b live leg is operator-executed (token spend — settled repo policy); everything else automated.

### Sampling Rate
- **Per task commit:** `npx vitest run --project=unit <touched files>` + `npm run typecheck` (38-error differential; zero Phase 11-file errors)
- **Per wave merge:** `npm test`
- **Phase gate:** full suite green + one operator `MRCLEAN_UAT=1 npm run test:uat` run (SC1b + re-stamps) + frozen-tree zero-diff (`git diff --stat <phase-base> -- src/hook src/detect src/placeholder tests/placeholder tests/detect` empty, EXCEPT sanctioned test additions under tests/hook/ for dist-parity — the plan must name the exact allowed new file) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/hook/dist-parity.test.ts` + vitest.config dual-listing — SC1a
- [ ] `tests/state/fs-interception.test.ts` — SC2
- [ ] `tests/uat/wire-safety.test.ts` + `tests/uat/fixtures/echo-mcp-server.mjs` + `tests/uat/fixtures/postresp-log-hook.sh` — SC1b + survey
- [ ] copy-drift.test.ts SC5 extension rows (paired with THREAT_MODEL + strings.ts)
- [ ] canary-leak.yml / test.yml explicit wire-safety steps (+ optional workflow_dispatch)
- [ ] IN-01/IN-02 test rows in existing restore suites
- Framework install: none.

## Security Domain

`security_enforcement` absent from .planning/config.json → treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | no auth surface |
| V3 Session Management | no (Claude-Code sessions ≠ web sessions; lifecycle already gated in 9/10) | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | New test inputs only: dist-parity payload JSON is fixture-owned; live-leg canaries are synthetic markers (leak-grep discipline — never real secret shapes beyond the pinned fake-AWS canary); IN-02 hardening treats duplicate map tokens as untrusted (demote, never overwrite) |
| V6 Cryptography | yes (verification only) | Never hand-roll: SC2 asserts AGAINST plaintext escaping the shipped AES-256-GCM envelope; no new crypto code — envelope constants duplicated from map-store tests, not re-derived |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Vacuous gate (zero files collected / patch not engaged / reversible branch silently off) | Tampering (of the proof) | Non-vacuity probes everywhere: channel-coverage asserts (SC2), v2-tail probes (SC1a/b), restored>=1 before absence greps, routing meta-checks (Pitfall 2/7/9) |
| Live-leg fixture leaking real secrets into a public transcript dir | Information Disclosure | Marker/synthetic canaries only; canaries env-fed to the fixture server, never in prompts; the fake-AWS canary is the established non-EXAMPLE variant |
| Sandbox contaminating operator state | Tampering | `--settings`/`--mcp-config --strict-mcp-config` isolation (never write `~/.claude/settings.json`); HOME prefix confines mrclean state; cleanup of sandbox map/key |
| Hardening edits weakening the trust fences | Elevation | cold-path both-direction fences run in every suite; IN-01/IN-02 touch only `src/restore/**` (allowlisted imports unchanged) |
| THREAT_MODEL overclaim after finalization | Repudiation/Info disclosure (social) | Copy-drift required-fragments + banned claim-shapes with positive controls and honest-copy self-checks (Pitfall 8) |
| Stress/chaos knob-tuning to green | Tampering (of the gate) | Zero-degrade assertion is never the knob (T-09-08-06, restated in plan text) |

## Sources

### Primary (HIGH confidence — read/executed this session)
- Repo source read: `tests/uat/{harness.ts,live-session.test.ts,contract-verification.test.ts}`, `tests/state/{stress,chaos,inspection,cold-path}.test.ts`, `tests/copy-drift.test.ts`, `tests/audit/restore-canary-leak.test.ts`, `tests/perf/post-tool-use.perf.test.ts`, `src/state/map-store.ts`, `src/hook/handlers/{post-tool-use,user-prompt-submit}.ts`, `src/restore/{cli,session-index,index}.ts`, `src/audit/{canary-leak,restore-log,log}.ts`, `vitest.config.ts`, `package.json`, `.github/workflows/{test,canary-leak,perf}.yml`, `THREAT_MODEL.md`, `docs/HOOK-CONTRACT.md`, `node_modules/write-file-atomic/lib/index.js`, `node_modules/proper-lockfile/lib/lockfile.js`.
- **Live probe executed 2026-07-17:** builtin-fs patch + `syncBuiltinESMExports()` captures ESM named-import writes AND write-file-atomic fd-based temp-file buffers (Node v22.22.0, repo's actual wfa).
- `claude --version` → 2.1.212; `gh issue view 68951 / 77587` → both OPEN (2026-07-17); `gh auth status` OK.
- .planning: REQUIREMENTS.md, ROADMAP.md (Phase 11 + notes), STATE.md, config.json, `10-{SECURITY,REVIEW,VALIDATION}.md`, `10-0{1,2,5,7,8}-SUMMARY.md`, `09-08-SUMMARY.md`, `08-RESEARCH.md`, phase-10 `deferred-items.md`.

### Secondary (MEDIUM confidence)
- Phase 8 empirical verdicts (E1–E5, stamped 2.1.209 in docs/HOOK-CONTRACT.md + contract-findings.json) — treated as hypotheses for the 2.1.212 live run per the doc's own re-verification procedure.
- 10-07 demonstrated vacuous-pass behavior of `--project` + non-included file (recorded deviation; not re-executed this session).

### Tertiary (LOW confidence — the phase's own runs resolve)
- ubuntu stress-timing behavior (A4); 2.1.212 contract drift (A2/A3); per-tool `tool_response` shapes (the survey's whole purpose).

## Metadata

**Confidence breakdown:**
- Harness inventory & CI wiring: HIGH — all read from source; the vacuous-pass hazard has in-repo demonstrated evidence.
- SC2 seam: HIGH — verified with an executed probe against the repo's actual dependency on the actual Node version.
- SC1 live-leg design: MEDIUM-HIGH — every piece has shipped precedent; the HOME-prefix isolation (A1) and MCP-honored-on-2.1.212 (A2) are first-run verifiables with coded fallbacks.
- Hardening recommendations: HIGH — fix sites read at line level; both fixes fail in the safe direction.
- Pitfalls: HIGH — derived from source facts and recorded incidents, not speculation.

**Research date:** 2026-07-17
**Valid until:** ~2026-07-31 (Claude Code releases ~weekly — re-check `claude --version` and #68951/#77587 at plan execution start; a CC change shifts live-leg hypotheses, never the deterministic gates)
