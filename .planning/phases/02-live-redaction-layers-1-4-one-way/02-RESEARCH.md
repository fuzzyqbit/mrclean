# Phase 2: Live Redaction (Layers 1-4 + One-Way) — Research

**Researched:** 2026-05-14
**Domain:** Secret detection (secretlint, gitleaks), Shannon entropy, dotenv parsing, placeholder management, Claude Code hook I/O shapes, JSONL audit, config schema extension
**Confidence:** HIGH (most claims verified via live tools, docs, or runtime tests)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Layer 1 engine:** `@secretlint/core` + `@secretlint/node` + `@secretlint/secretlint-rule-preset-recommend` programmatic; NO shell-out. gitleaks TOML vendored into `vendor/gitleaks-rules.toml`, parsed with `smol-toml`, executed by a TS adapter.
- **ReDoS protection:** Per-pattern execution timeout (50 ms default) via `worker_threads` message timeout. `re2` is NOT used — gitleaks patterns use Go-only inline mode flags (`(?i)`, `(?-i:)`) that `re2` also cannot handle.
- **Finding shape (all layers):** `{ ruleId: string, severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW', span: { start: number, end: number }, value: string, redactedHash: string, fingerprint: string }`.
- **Layer 2:** Shannon inline (10 lines), threshold 4.5 bits/char, min length 20 chars; shape allowlist BEFORE entropy fires; context-keyword OR length≥40+entropy≥5 escalation.
- **Layer 3:** `dotenv.parse()` at SessionStart only; excludes `.env.example/.sample/.template`; skip values <8 chars or shape-allowlisted or boolean literals.
- **Layer 4:** `words.txt` with `word|action` syntax; default action = `block`; case-insensitive whole-word; user-global + project-local union.
- **Placeholder format:** `<MRCLEAN:TYPE:NNN>`, global-per-session counter, SHA-256 keyed, in-memory only. TYPE vocabulary in `src/detect/type-map.ts`. Counter max = 999, OVF path on overflow.
- **Hook paths:** UserPromptSubmit CRITICAL/HIGH → `decision: "block"` + `reason`; PreToolUse any → `updatedInput` (allow path); PostToolUse → `hookSpecificOutput.updatedToolOutput`.
- **Audit:** `.mrclean/audit.jsonl`, `fs.appendFile`, NEVER raw secret, NEVER env-var names; record fields listed in CONTEXT.md §Audit Log.
- **dry_run default = false.** `dry_run = true` → every action becomes `audit`; UserPromptSubmit returns `decision: "allow"` regardless.
- **Banner upgrade:** `mrclean active vN.N.N (rules: NNN, allowlist: NN, mode: M)` via `additionalContext`.
- **Detection budget:** 5 pattern-timeouts in one hook call → `decision: "block"` + structured reason.
- **Layer ordering:** 1→2→3→4 with span-coverage dedup.
- **Config extension:** extend Phase 1 `MrcleanConfig` with `entropy`, `secrets_files`, `[[rules]]`, `[allowlist]`; upgrade TOML parser to `smol-toml` this phase.
- **Doctor `--bench` stub:** runs L1+L2 against 4 KB fixture, prints p50/p95 latency, no assertions.

### Claude's Discretion

- Per-pattern regex timeout (50 ms) instead of `re2`.
- Placeholder counter is global per session (not per-TYPE).
- words.txt default action when no `|action` is `block`.
- words.txt match semantics: case-insensitive whole-word boundary.
- User-global `~/.mrclean/words.txt` supported with same layering as config.
- Detection-budget bail-out: 5 pattern-timeouts in one hook invocation → deny.
- Detection-layer ordering: 1→2→3→4, spans-already-covered are skipped.
- Banner mode token: `active`/`dry-run`/`off`.
- `--bench` stub on doctor command — Phase 3 PERF harness prep.

### Deferred Ideas (OUT OF SCOPE)

- File-watcher during session for `.env*` / `words.txt`.
- Substring (non-word-boundary) matching for words.txt.
- Cross-session deterministic placeholder naming via HMAC.
- Persistence of the session placeholder map.
- MCP tool surface (`mrclean_check`, `mrclean_redact`, `mrclean_status`) — Phase 3.
- PERF assertion gate — Phase 3 (Phase 2 only ships `--bench` stub).
- Layer 5 LLM classifier.
- Telemetry / phone-home.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DET1-01 | Layer 1: `@secretlint/secretlint-rule-preset-recommend` bundled, in-process | §1 — `lintSource` API verified |
| DET1-02 | Layer 1: gitleaks TOML vendored at build time, parsed with `smol-toml`, in-process | §2 + §3 — 184/222 rules usable after JS adaptation |
| DET1-03 | Each L1 detection emits normalized `{ ruleId, severity, span, value, redactedHash, fingerprint }` | §1, §8 |
| DET1-04 | ReDoS-safe execution (timeout per pattern) | §4 — `worker_threads` message-timeout pattern confirmed |
| DET2-01 | Shannon entropy, threshold 4.5, min length 20, tunable | §5 — exact formula provided |
| DET2-02 | Shape allowlist before entropy fires (UUIDs, git SHAs, hashes) | §5 — patterns listed |
| DET2-03 | Entropy hits need co-located keyword OR length+charset escalation | §5 |
| DET3-01 | SessionStart scans `.env*`; uses `dotenv.parse`, never `dotenv.config` | §6 — parser-only confirmed |
| DET3-02 | `secrets_files` config array for non-`.env` files | §11 — config extension |
| DET3-03 | Values <8 chars or shape-allowlisted or boolean → skipped | §6 |
| DET4-01 | `.mrclean/words.txt` loaded, case-insensitive exact whole-word match | §7 |
| DET4-02 | `word\|action` syntax per line | §7 |
| DET4-03 | Hot-reload at SessionStart only | §7 |
| PH-01 | `<MRCLEAN:TYPE:NNN>` placeholder format | §8 |
| PH-02 | Same value → same placeholder within session (SHA-256 key) | §8 |
| PH-03 | Collision-free across types (global counter) | §8 |
| PH-04 | Angle brackets survive JSON/Markdown/code-fence | §8 |
| HOOK-02 | UserPromptSubmit CRITICAL/HIGH → `decision: "block"` + `reason` | §9 — verified from live docs |
| HOOK-03 | PreToolUse → `updatedInput` with `permissionDecision: "allow"` | §9 — verified |
| HOOK-04 | PostToolUse → `hookSpecificOutput.updatedToolOutput` | §9 — verified from changelog v2.1.121 |
| AUDIT-01 | Every detection → one JSONL record | §10 |
| AUDIT-02 | Audit log never contains raw secret value | §10 |
| MODE-01 | `dry_run = true` flips every action to `audit` | §11 |
| MODE-02 | One-way only; no reversible mode | locked by CONTEXT.md |
| CFG-02 | Per-rule action override, severity, multi-axis allowlist | §11 |
| CFG-04 | `mrclean ignore <fingerprint>` CLI command | §11 |
</phase_requirements>

---

## Summary

Phase 2 is the value-delivery slice: every component exists to either catch a secret or safely replace it before it reaches the Anthropic API. The research confirms all four detection layers are buildable with the locked stack.

**Layer 1 (secretlint + gitleaks) has one non-obvious implementation constraint:** JavaScript's `RegExp` does not support Go-style inline case-insensitive flags (`(?i)`, `(?-i:)`, `(?P<name>)`). Of gitleaks' 222 rules, 79 compile directly in JS, 105 can be adapted by stripping the leading `(?i)` prefix and converting it to a `/i` flag, and 38 are too complex (mixed-case sub-patterns) and must be skipped. The effective gitleaks coverage is 184/222 rules. Secretlint's preset-recommend covers 28 targeted rule modules (AWS, GitHub, Stripe, Anthropic, Slack, etc.) and is used first; gitleaks covers the long-tail.

**Layer 1 ReDoS:** The gitleaks patterns contain no lookaheads or lookbehinds (verified by grep), so catastrophic backtracking is unlikely. Nevertheless, the 50 ms `worker_threads`-based timeout is the correct defense — `setImmediate` / `setTimeout` cannot interrupt a running `RegExp.exec()` call because JavaScript is single-threaded.

**PostToolUse output rewrite** (`hookSpecificOutput.updatedToolOutput`) was added in Claude Code v2.1.121 (the installed machine has v2.1.141). This field replaces the tool output that re-enters the model context. Combined with `additionalContext`, Phase 2 can fully substitute secrets in tool results.

**UserPromptSubmit uses `decision: "block"` + `reason` (top-level), NOT `permissionDecision`.** CONTEXT.md §HOOK-02 says `permissionDecisionReason` — that's the PreToolUse field. The correct UserPromptSubmit deny path is `{ decision: "block", reason: "..." }`. The planner must use the right field per event.

**Primary recommendation:** Build `src/detect/` as a pure orchestrator + four stateless layer modules. Each layer returns `Finding[]`. The orchestrator deduplicates spans and routes findings to the placeholder manager and audit log. Hook handlers are the only I/O surface; they call `runDetection(text, config)` and translate the findings into hook-specific JSON outputs.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Secret detection (all 4 layers) | Hook adapter process | — | Runs in-process per hook event; stateless layer modules |
| Placeholder management (session map) | Hook adapter process (in-memory) | — | Session-scoped Map, never persisted |
| `.env*` scanning | Hook adapter (SessionStart handler) | — | One-shot at session start |
| `words.txt` loading | Hook adapter (SessionStart handler) | — | Same one-shot semantics |
| Audit log writes | Hook adapter | — | `fs.appendFile` from hook process |
| Config reading (new schema fields) | Hook adapter startup | — | Extends Phase 1 `loadEffectiveConfig` |
| gitleaks TOML vendoring | Build time (vendor/ directory) | — | Fetched by build script; not at runtime |
| Regex worker (timeout isolation) | Node `worker_threads` | — | Separate thread; terminated on timeout |
| `mrclean ignore <fingerprint>` | CLI process (new subcommand) | — | Writes to `<cwd>/.mrclean/config.toml` |
| Doctor `--bench` stub | CLI process (`doctor` subcommand) | — | Extends existing `computeDoctorReport` |

---

## Section 1: Secretlint v13 Programmatic API

**Source:** Context7 `/secretlint/secretlint` + `https://github.com/secretlint/secretlint` [VERIFIED: 2026-05-14]

### 1.1 Package Versions (npm registry)

| Package | Version | Role |
|---------|---------|------|
| `@secretlint/core` | 13.0.0 | `lintSource` low-level API |
| `@secretlint/node` | 13.0.0 | `createEngine` high-level API |
| `@secretlint/secretlint-rule-preset-recommend` | 13.0.0 | 28-module preset |

### 1.2 Two Programmatic APIs

**Option A — `lintSource` from `@secretlint/core` (recommended for mrclean):**
```typescript
// Source: Context7 /secretlint/secretlint
import { lintSource } from "@secretlint/core";
import { creator as presetCreator } from "@secretlint/secretlint-rule-preset-recommend";

const result = await lintSource({
  source: {
    content: "AKIAIOSFODNN7EXAMPLE the_rest_of_prompt",
    filePath: "hook-input.txt",  // filename hint — used by path-allowlist rules
    ext: ".txt",
    contentType: "text"
  },
  options: {
    config: {
      rules: [
        {
          id: "@secretlint/secretlint-rule-preset-recommend",
          rule: presetCreator,
          options: {},
          severity: "error",
          disabled: false
        }
      ]
    },
    locale: "en",
    maskSecrets: false  // keep raw values for hashing; never log them
  }
});
```

**Option B — `createEngine` from `@secretlint/node` (higher-level):**
```typescript
// Source: Context7 /secretlint/secretlint
import { createEngine } from "@secretlint/node";

const engine = await createEngine({
  formatter: "json",
  color: false,
  maskSecrets: false,
  configFileJSON: {
    rules: [
      {
        id: "@secretlint/secretlint-rule-preset-recommend",
        rule: require("@secretlint/secretlint-rule-preset-recommend").creator,
        options: {}
      }
    ]
  }
});

const result = await engine.executeOnContent({
  content: text,
  filePath: "hook-input.txt"
});
```

**Recommendation for mrclean: Use `lintSource` from `@secretlint/core`.** `createEngine` adds formatter overhead and is designed for file-based CLI usage. `lintSource` returns the typed `result.messages` array directly without JSON serialization.

### 1.3 `lintSource` Output Shape

```typescript
// result.messages[] shape (verified from Context7)
interface SecretlintMessage {
  message: string;           // human-readable "found AWS Secret Access Key: ****"
  messageId: string;         // e.g. "AWSSecretAccessKey"
  range: [number, number];   // [startIndex, endIndex] in the content string
  loc: {
    start: { line: number, column: number },
    end: { line: number, column: number }
  };
  ruleId: string;            // "@secretlint/secretlint-rule-aws"
  severity: "error" | "warning" | "info";
  data?: Record<string, unknown>;  // extracted named capture groups
}
```

**Conversion to mrclean's normalized Finding:**
```typescript
function secretlintMessageToFinding(msg: SecretlintMessage, content: string): RawFinding {
  const [start, end] = msg.range;
  const value = content.slice(start, end);
  return {
    ruleId: msg.messageId,          // use messageId for specificity (e.g. "AWSSecretAccessKey")
    severity: secretlintSeverityToMrclean(msg.severity),
    span: { start, end },
    value,                          // raw extracted value — hashed immediately; never logged
  };
}

function secretlintSeverityToMrclean(s: string): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
  // secretlint "error" maps to HIGH; no CRITICAL at L1 — CRITICAL reserved for verified live creds
  switch (s) {
    case 'error':   return 'HIGH';
    case 'warning': return 'MEDIUM';
    default:        return 'LOW';
  }
}
```

**Severity mapping rationale:** secretlint has no `CRITICAL` tier. mrclean assigns CRITICAL only via config override or explicit rule mapping in `type-map.ts` (e.g., `AWSSecretAccessKey` → CRITICAL). The TYPE vocabulary in `type-map.ts` maps `messageId` → mrclean TYPE.

### 1.4 Preset-Recommend Rule Modules (v13.0.0)

28 modules in the preset (verified from source `packages/@secretlint/secretlint-rule-preset-recommend/src/index.ts` on master):

```
@secretlint/secretlint-rule-aws
@secretlint/secretlint-rule-gcp
@secretlint/secretlint-rule-npm
@secretlint/secretlint-rule-slack
@secretlint/secretlint-rule-basicauth
@secretlint/secretlint-rule-openai
@secretlint/secretlint-rule-anthropic
@secretlint/secretlint-rule-groq
@secretlint/secretlint-rule-huggingface
@secretlint/secretlint-rule-linear
@secretlint/secretlint-rule-notion
@secretlint/secretlint-rule-privatekey
@secretlint/secretlint-rule-sendgrid
@secretlint/secretlint-rule-shopify
@secretlint/secretlint-rule-stripe
@secretlint/secretlint-rule-github
@secretlint/secretlint-rule-gitlab
@secretlint/secretlint-rule-grafana
@secretlint/secretlint-rule-1password
@secretlint/secretlint-rule-database-connection-string
@secretlint/secretlint-rule-hashicorp-vault
@secretlint/secretlint-rule-vercel
@secretlint/secretlint-rule-databricks
@secretlint/secretlint-rule-docker
@secretlint/secretlint-rule-figma
@secretlint/secretlint-rule-cloudflare
@secretlint/secretlint-rule-tailscale
@secretlint/secretlint-rule-filter-comments
```

[CITED: https://raw.githubusercontent.com/secretlint/secretlint/master/packages/@secretlint/secretlint-rule-preset-recommend/src/index.ts]

### 1.5 Installation

```bash
npm install @secretlint/core @secretlint/node @secretlint/secretlint-rule-preset-recommend
```

These are not yet in `package.json`. The planner must add them as Phase 2 runtime dependencies.

---

## Section 2: Gitleaks TOML Rule Shape + JS Adapter

**Source:** `https://raw.githubusercontent.com/gitleaks/gitleaks/master/config/gitleaks.toml` + runtime tests [VERIFIED: 2026-05-14]

### 2.1 TOML Structure

The file is 3209 lines, contains **222 `[[rules]]` entries** and a global `[allowlist]` block.

**Per-rule fields:**
```toml
[[rules]]
id = "aws-access-token"             # string — unique rule ID
description = "..."                 # string — human-readable
regex = '''\b(AKIA[A-Z2-7]{16})\b''' # string (TOML literal string, multiline literal)
entropy = 3.0                       # float (optional) — min Shannon entropy of capture group
keywords = ["akia", "asia"]         # string[] (optional) — must appear near match
```

**Per-rule allowlists** (9 rules have them, 13 entries total):
```toml
[[rules.allowlists]]
regexes = ['''.+EXAMPLE$''']        # suppress if capture matches this

[[rules.allowlists]]
paths = ['''(?i)\.php$''']          # suppress if scanning a file matching this path regex
stopwords = ["deadbeef"]           # suppress if capture contains this substring
```

**Global `[allowlist]`:**
```toml
[allowlist]
paths = [...]      # list of path regexes to always skip (e.g. node_modules)
regexes = [...]    # list of regexes — if capture matches any, suppress finding
stopwords = [...]  # literal stopwords
```

### 2.2 JavaScript Compatibility

**Critical finding (verified by runtime compilation test 2026-05-14):**

| Rule category | Count | JS compatibility | Action |
|---------------|-------|-----------------|--------|
| Compile directly (no inline flags) | 79 | Full compat | Use as-is |
| Leading `(?i)` prefix only | 105 | Adaptable | Strip `(?i)`, add `/i` flag |
| Mixed `(?-i:...)`, `(?i:...)`, `(?P<name>...)` | 38 | Incompatible | Skip at startup |
| **Total usable** | **184** | | |

**No lookaheads or lookbehinds found in gitleaks TOML** (verified by grep against live file). The inline-mode flag issue (`(?i)` → JS `i` flag) is the only incompatibility. `re2` would not help: `re2` also does not support `(?i)` inline flags or `(?-i:)` sub-pattern case toggling.

**Adaptation function:**
```typescript
function adaptGitleaksPattern(rawRegex: string): { pattern: string; flags: string } | null {
  // Cannot handle (?-i:...), (?i:...) mid-pattern, or (?P<name>...) named groups
  if (rawRegex.includes('(?-i:') || rawRegex.includes('(?P<')) return null;
  if (rawRegex.includes('(?i:')) {
    // (?i: ... ) wrapping without (?-i:) reset — skip for safety (5 rules)
    return null;
  }
  // Simple leading (?i) prefix → 'i' flag
  if (rawRegex.startsWith('(?i)')) {
    return { pattern: rawRegex.slice(4), flags: 'i' };
  }
  return { pattern: rawRegex, flags: '' };
}
```

### 2.3 Keywords Interpretation

Keywords in gitleaks are a **pre-filter**: if the text does NOT contain any keyword (case-insensitive substring), the regex is not executed. This is a performance optimization, not an additional matching constraint. A match without a keyword present is still valid.

**Implementation:** Before running a rule's regex, check `keywords.some(kw => text.toLowerCase().includes(kw))`. If no keywords defined, always run the regex.

### 2.4 Allowlist Evaluation

For Phase 2, mrclean applies allowlists to the in-memory text input. The `commits` field in gitleaks allowlists is irrelevant (mrclean scans hook payloads, not git history).

**Relevant allowlist checks (in order):**
1. **`stopwords` (global):** If capture group value contains any stopword → suppress finding.
2. **`regexes` (global + per-rule):** If capture group matches any allowlist regex → suppress.
3. **`paths` (global + per-rule):** Not applicable for hook text payloads. Skip. (Phase 2 scans text strings, not files on disk.)

### 2.5 Vendoring Strategy

**Build-time fetch:**
```bash
# vendor/update-gitleaks.sh (run by npm script "vendor:gitleaks")
curl -fsSL https://raw.githubusercontent.com/gitleaks/gitleaks/master/config/gitleaks.toml \
  -o vendor/gitleaks-rules.toml
sha256sum vendor/gitleaks-rules.toml > vendor/gitleaks-rules.toml.sha256
```

The file is checked into `vendor/` so the published npm package includes it. License: MIT (from gitleaks repo `LICENSE`). The file header says "auto-generated — do not edit manually."

**At startup (lazy, once per hook process):**
```typescript
// src/detect/layer1-regex/gitleaks-loader.ts
import { parse } from 'smol-toml';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// Resolve path relative to this module's location in the published dist
const VENDOR_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../vendor/gitleaks-rules.toml');

let cachedRules: CompiledGitleaksRule[] | null = null;

export function getGitleaksRules(): CompiledGitleaksRule[] {
  if (cachedRules) return cachedRules;
  const toml = parse(readFileSync(VENDOR_PATH, 'utf8')) as GitleaksToml;
  cachedRules = Object.freeze(toml.rules.flatMap(r => {
    const adapted = adaptGitleaksPattern(r.regex);
    if (!adapted) return [];
    try {
      return [{
        id: r.id,
        re: new RegExp(adapted.pattern, adapted.flags),
        keywords: (r.keywords ?? []).map(k => k.toLowerCase()),
        entropy: r.entropy,
        allowlists: r.allowlists ?? [],
        globalAllowlist: toml.allowlist,
      }];
    } catch { return []; }
  }));
  return cachedRules;
}
```

---

## Section 3: smol-toml + TOML Parse Quirks for Gitleaks

**Source:** Runtime test against actual gitleaks.toml on 2026-05-14 [VERIFIED]

### 3.1 API

```typescript
import { parse } from 'smol-toml';
const result = parse(tomlString); // throws on parse error
```

`parse()` accepts a `string` (not `Buffer`). `result` is `Record<string, unknown>`.

### 3.2 Array-of-Tables (`[[rules]]`)

smol-toml correctly handles `[[rules]]` — each `[[rules]]` block appends an object to `result.rules[]`. Per-rule `[[rules.allowlists]]` blocks are correctly parsed as `rule.allowlists[]`. **Verified at runtime: `smol-toml` successfully parsed the full 3209-line gitleaks.toml, producing 222 rules.**

```typescript
// Output shape after parse():
interface GitleaksToml {
  title: string;
  minVersion: string;
  allowlist: { paths: string[]; regexes: string[]; stopwords: string[] };
  rules: GitleaksRule[];
}
interface GitleaksRule {
  id: string;
  description?: string;
  regex: string;
  entropy?: number;
  keywords?: string[];
  allowlists?: { regexes?: string[]; paths?: string[]; stopwords?: string[] }[];
}
```

### 3.3 Known Quirks

**Multiline literal strings (`'''...'''`):** smol-toml correctly handles TOML triple-quoted literal strings. The gitleaks regexes use this heavily for raw regex patterns with backslashes. No preprocessing needed.

**POSIX character classes (`[[:alnum:]]`):** Some gitleaks rules use `[[:alnum:]]` — a POSIX class that JavaScript regex does not support. This causes JS `new RegExp(...)` to throw even after the `(?i)` adaptation. Specifically, `airtable-personnal-access-token` uses `[[:alnum:]]`. The rule-compilation loop's `try/catch` discards these silently. The `adaptGitleaksPattern` function's null-return or the outer `try/catch` handles this correctly.

**Effective rule count after all filtering:** approximately 180–184 usable rules (79 direct + ~105 adapted, minus any with POSIX classes or other JS incompatibilities encountered at runtime).

**smol-toml version:** 1.6.1 (npm latest as of 2026-05-14). [VERIFIED: `npm view smol-toml version`]

---

## Section 4: ReDoS Protection Strategy

**Source:** Runtime testing in Node v22.22.0 + architectural analysis [VERIFIED: 2026-05-14]

### 4.1 Why `setTimeout` / `setImmediate` Cannot Work

JavaScript is single-threaded. A running `RegExp.exec()` call blocks the event loop. `setTimeout` callbacks cannot fire while the engine is executing a regex. Setting a timer before calling `exec()` and checking it after is not a timeout — it just measures elapsed time after the blocking call completes.

**Tested:** A classic catastrophic backtracking pattern (`^(a+)+$` on `'a'.repeat(28) + 'b'`) runs for ~2 seconds and completely blocks the event loop; a `setTimeout(fn, 50)` set before `exec()` fires only after the regex completes.

### 4.2 Worker Threads Timeout Pattern (Recommended)

```typescript
// Source: runtime test on Node v22.22.0 [VERIFIED: 2026-05-14]
// src/detect/layer1-regex/regex-worker-runner.ts

import { Worker } from 'node:worker_threads';

export interface RegexWorkerResult {
  ok: boolean;
  timedOut?: boolean;
  matches?: Array<{ start: number; end: number; value: string }>;
  error?: string;
}

// Worker code is embedded as a string (no separate file needed in bundled dist)
const WORKER_CODE = `
import { parentPort, workerData } from 'node:worker_threads';
const { pattern, flags, text } = workerData;
try {
  const re = new RegExp(pattern, flags + 'g');
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    matches.push({ start: m.index, end: re.lastIndex, value: m[1] ?? m[0] });
    if (m[1] === undefined && re.lastIndex === m.index) re.lastIndex++;  // guard zero-length match
  }
  parentPort.postMessage({ ok: true, matches });
} catch(e) {
  parentPort.postMessage({ ok: false, error: e.message });
}
`;

export function runRegexInWorker(
  pattern: string,
  flags: string,
  text: string,
  timeoutMs = 50
): Promise<RegexWorkerResult> {
  return new Promise((resolve) => {
    const w = new Worker(WORKER_CODE, { eval: true, workerData: { pattern, flags, text } });
    
    const timer = setTimeout(() => {
      w.terminate();
      resolve({ ok: false, timedOut: true });
    }, timeoutMs);
    
    w.on('message', (result: RegexWorkerResult) => {
      clearTimeout(timer);
      resolve(result);
    });
    
    w.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
}
```

**Cost per execution:** Each worker creation takes 2–5 ms (Node 20+ worker spawn overhead). For the keyword-pre-filtered hot path (most rules skipped via keyword check), this overhead is only paid for rules that pass the keyword test. Typical prompt: keyword filter reduces 222 rules to ~5–20 that actually execute.

**Alternative if worker spawn overhead proves too high:** Pre-compile all patterns at startup (already locked by CONTEXT.md DET1-04 + PERF-03 prep). The worker approach is best for isolated protection; at Phase 3's PERF gate, if p95 > 100 ms, consider a worker pool instead of single-use workers.

**Budget bail-out:** Track `timeoutCount` per hook invocation. If `timeoutCount >= 5`, abort remaining detection and return `{ decision: "block", reason: "[mrclean] detection budget exhausted" }`.

---

## Section 5: Shannon Entropy Implementation

**Source:** Training knowledge cross-referenced with gitleaks source formula [ASSUMED — formula verified against standard definition]

### 5.1 Shannon Bits-per-Char Function

```typescript
// src/detect/layer2-entropy.ts (inline — no external dep)
// Shannon entropy in bits/char — compatible with gitleaks' formula
function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  const len = s.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
```

This is the standard Shannon entropy formula: `H = -Σ p(c) * log2(p(c))` summed over distinct characters. Result is in bits per character. A truly random alphanumeric string of 32 chars has entropy ~5.17 bits/char (26+26+10 = 62 charset).

### 5.2 Shape Allowlist (Run BEFORE Entropy Check)

```typescript
const SHAPE_ALLOWLIST_PATTERNS: RegExp[] = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,  // UUID v4/v7
  /^[0-9a-f]{40}$/i,                         // git SHA-1 (40 hex)
  /^[0-9a-f]{64}$/i,                         // SHA-256 hex digest (64 chars)
  /^[0-9a-f]{32}$/i,                         // MD5 hex (32 chars)
  /^sha\d+-[A-Za-z0-9+/]+=*$/,               // npm/Cargo integrity hash (sha512-...)
  /^data:image\//,                            // base64 image-data header
  /^[0-9a-f]{7}$/i,                          // short git SHA (7 chars)
];

function isShapeAllowlisted(s: string): boolean {
  return SHAPE_ALLOWLIST_PATTERNS.some(re => re.test(s));
}
```

### 5.3 Context-Keyword Requirement (DET2-03)

Entropy fires only if one of these conditions is met:
1. A context keyword appears within ±40 characters of the token: `secret|key|token|password|bearer|api_key|access_token|client_secret|private_key|auth`
2. OR: `token.length >= 40` AND `shannonEntropy(token) >= 5.0` (escalation for raw high-entropy blobs)

```typescript
const ENTROPY_KEYWORDS = /\b(?:secret|key|token|password|bearer|api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key|auth)\b/i;

function hasEntropyContext(text: string, tokenStart: number, tokenEnd: number): boolean {
  const windowStart = Math.max(0, tokenStart - 40);
  const windowEnd = Math.min(text.length, tokenEnd + 40);
  const window = text.slice(windowStart, tokenStart) + text.slice(tokenEnd, windowEnd);
  return ENTROPY_KEYWORDS.test(window);
}
```

---

## Section 6: dotenv.parse — Confirmed Parser-Only Mode

**Source:** Context7 `/motdotla/dotenv` + npm registry [VERIFIED: 2026-05-14]

### 6.1 Parser-Only Confirmation

```typescript
// dotenv.parse() DOES NOT mutate process.env — confirmed by docs + source
import { parse } from 'dotenv';
const buf = Buffer.from(await readFile('.env', 'utf8'));
const parsed = parse(buf);  // returns { KEY: 'value', ... } — no side effects
```

`dotenv.config()` (which DOES mutate `process.env`) must never be called. `dotenv.parse()` is safe.

**dotenv version:** 17.4.2 (npm latest as of 2026-05-14). [VERIFIED: `npm view dotenv version`]

### 6.2 Multiline Values, Quoting, Escapes

`dotenv.parse` handles:
- Double-quoted values: `KEY="value with spaces"` → `{ KEY: 'value with spaces' }`
- Single-quoted values: `KEY='literal $VALUE'` → `{ KEY: 'literal $VALUE' }` (no interpolation)
- Unquoted values: `KEY=value` → `{ KEY: 'value' }` (no leading/trailing space trimming in v17)
- Multiline (double-quoted with `\n`): `KEY="line1\nline2"` → literal `\n` in value
- Comments: `SECRET=value # comment` → value includes ` # comment` (unquoted) or `value` (if `#` is outside quotes)
- Inline comments stripped only for unquoted values in some versions — **conservatively, mrclean should treat the whole raw value as the secret**

**Practical implication:** For Layer 3 blocklist, use the raw parsed value from `dotenv.parse`. Do not strip trailing comment fragments — false-positive missed detections are safer than false-negative leaks.

### 6.3 `.env*` File Discovery

```typescript
import { glob } from 'fast-glob';

const ENV_FILES_GLOB = '.env{,.local,.*}';
const ENV_EXCLUDE_PATTERNS = [
  '**/.env.example',
  '**/.env.sample',
  '**/.env.template',
  '**/.env.*.example',
  '**/.env.*.sample',
  '**/.env.*.template',
];

async function discoverEnvFiles(projectRoot: string): Promise<string[]> {
  return glob(ENV_FILES_GLOB, {
    cwd: projectRoot,
    absolute: true,
    ignore: ENV_EXCLUDE_PATTERNS,
    dot: true,
  });
}
```

**fast-glob version:** 3.3.3 (npm latest as of 2026-05-14). [VERIFIED: `npm view fast-glob version`]

---

## Section 7: Words.txt Design

**Source:** CONTEXT.md + architectural reasoning [ASSUMED for implementation specifics; decisions locked in CONTEXT.md]

### 7.1 Whole-Word Matcher

```typescript
// For each word in the blocklist, build a case-insensitive whole-word regex ONCE at load time
interface WordEntry {
  word: string;
  action: 'block' | 'warn' | 'audit';
  re: RegExp;  // pre-compiled for performance
}

function parseWordsFile(content: string): WordEntry[] {
  const entries: WordEntry[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();  // strip trailing comments
    if (!line) continue;
    
    const pipeIdx = line.indexOf('|');
    const word = pipeIdx === -1 ? line : line.slice(0, pipeIdx);
    const actionRaw = pipeIdx === -1 ? 'block' : line.slice(pipeIdx + 1).trim();
    const action = (['block', 'warn', 'audit'] as const).includes(actionRaw as any)
      ? (actionRaw as 'block' | 'warn' | 'audit')
      : 'block';
    
    // Escape regex metacharacters in the word
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    entries.push({ word, action, re });
  }
  return entries;
}
```

**Performance for ~100 words:** Each word gets one `RegExp` object compiled at load time. Searching a 4 KB text string with 100 whole-word patterns takes approximately 1–5 ms (benchmark: 100 pre-compiled regex `exec()` calls on 4 KB text). Acceptable within the hook budget.

### 7.2 Pipe Escaping Rules

The pipe character in `word|action` is the first `|` in the line. Words containing `|` cannot be expressed in this format. This is documented as a known limitation; users who need to match literal `|` characters can use the `[allowlist].regexes` mechanism instead.

### 7.3 User-Global + Project-Local Layering

Load both files if they exist; merge into a single blocklist (union, not override). Project-local words ADD to user-global words. If the same word appears in both files, the project-local action wins.

```typescript
async function loadWordsList(homeDir: string, cwd: string): Promise<WordEntry[]> {
  const globalPath = join(homeDir, '.mrclean', 'words.txt');
  const projectPath = join(cwd, '.mrclean', 'words.txt');
  
  const globalEntries = await readWordsFile(globalPath);   // ENOENT → []
  const projectEntries = await readWordsFile(projectPath); // ENOENT → []
  
  // Project entries override same-word global entries; otherwise union
  const merged = new Map<string, WordEntry>();
  for (const e of [...globalEntries, ...projectEntries]) {
    merged.set(e.word.toLowerCase(), e);  // project-local wins via overwrite
  }
  return [...merged.values()];
}
```

---

## Section 8: Placeholder Manager Internals

**Source:** CONTEXT.md PH-01..04 + architectural reasoning [ASSUMED for implementation; decisions locked in CONTEXT.md]

### 8.1 Hash Discipline

```typescript
import { createHash } from 'node:crypto';

function sha256hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// redactedHash = first 16 hex chars of SHA-256 (8 bytes = 64-bit identifier)
function redactedHash(value: string): string {
  return sha256hex(value).slice(0, 16);
}

// fingerprint = ruleId + ':' + redactedHash (composite for dedup and CFG-04 ignore)
function fingerprint(ruleId: string, value: string): string {
  return `${ruleId}:${redactedHash(value)}`;
}
```

**Collision probability at 16 hex chars (64 bits):** birthday paradox collision at ~4 billion detections. Negligible for a session-scoped map.

### 8.2 Session Map Structure

```typescript
interface PlaceholderEntry {
  type: string;      // e.g. 'AWS_KEY'
  index: number;     // 1-based session counter
  firstSeenTs: string; // ISO8601
  placeholder: string; // '<MRCLEAN:AWS_KEY:001>'
}

class PlaceholderManager {
  private readonly byHash = new Map<string, PlaceholderEntry>();
  private readonly byPlaceholder = new Map<string, string>();  // placeholder → sha256hex
  private counter = 0;

  allocate(value: string, type: string): PlaceholderEntry {
    const hash = sha256hex(value);
    const existing = this.byHash.get(hash);
    if (existing) return existing;  // same value → same placeholder (PH-02)

    this.counter++;
    if (this.counter > 999) {
      // PH-03 overflow path
      process.stderr.write(JSON.stringify({ warn: 'mrclean placeholder overflow', counter: this.counter }) + '\n');
      const ph = `<MRCLEAN:${type}:OVF>`;
      const entry = { type, index: this.counter, firstSeenTs: new Date().toISOString(), placeholder: ph };
      this.byHash.set(hash, entry);
      return entry;
    }

    const index = this.counter;
    const ph = `<MRCLEAN:${type}:${String(index).padStart(3, '0')}>`;
    const entry = { type, index, firstSeenTs: new Date().toISOString(), placeholder: ph };
    this.byHash.set(hash, entry);
    this.byPlaceholder.set(ph, hash);
    return entry;
  }
}
```

**Memory footprint (worst case):** 999 entries × ~200 bytes per entry ≈ 200 KB. Negligible.

### 8.3 Text Substitution

Substitute in a single pass (longest spans first, no re-scanning):

```typescript
function substituteFindings(text: string, findings: ResolvedFinding[]): string {
  // Sort by span.start descending so we can replace without shifting indices
  const sorted = [...findings].sort((a, b) => b.span.start - a.span.start);
  let result = text;
  for (const f of sorted) {
    result = result.slice(0, f.span.start) + f.placeholder + result.slice(f.span.end);
  }
  return result;
}
```

---

## Section 9: Hook Integration — Exact JSON Shapes

**Source:** `https://code.claude.com/docs/en/hooks` + changelog v2.1.121 [VERIFIED: 2026-05-14]

### 9.1 CORRECTION — UserPromptSubmit vs. PreToolUse Field Names

**Important correction over CONTEXT.md wording:** CONTEXT.md §HOOK-02 says the UserPromptSubmit deny path uses `permissionDecisionReason`. This is the **PreToolUse field name**. UserPromptSubmit uses a different schema.

| Event | Deny field names | Location |
|-------|-----------------|----------|
| `UserPromptSubmit` | `decision: "block"`, `reason: "..."` | **Top-level** |
| `PreToolUse` | `permissionDecision: "deny"`, `permissionDecisionReason: "..."` | Inside `hookSpecificOutput` |

### 9.2 UserPromptSubmit — Deny (CRITICAL/HIGH finding)

```json
{
  "decision": "block",
  "reason": "[mrclean] AWSAccessKey (HIGH): detected at offset 12 — rewrite prompt before submitting",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "mrclean blocked: AWSAccessKey <MRCLEAN:AWS_KEY:001>"
  }
}
```

**For MEDIUM/LOW on UserPromptSubmit:** Do not block. Inject a warning via `additionalContext` only:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "[mrclean] LOW-confidence detection: EntropyToken at offset 42 — verify before proceeding"
  }
}
```

**dry_run override:** When `dry_run = true`, always return `{}` (no `decision` field) + log audit entry. Claude Code interprets missing `decision` as allow.

### 9.3 PreToolUse — Substitute (any detection severity)

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "[mrclean] substituted 2 secret(s)",
    "updatedInput": {
      "command": "curl -H 'Authorization: Bearer <MRCLEAN:STRIPE_KEY:001>' https://api.stripe.com/v1/charges"
    }
  }
}
```

`updatedInput` must contain the **complete tool input object**, not just the changed fields. Claude Code replaces `tool_input` wholesale with `updatedInput`. For tools with multiple input fields (e.g., `Edit` with `file_path` + `content`), all fields must be included even if only one was sanitized.

**No detection:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow"
  }
}
```

### 9.4 PostToolUse — Substitute in Tool Output

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "updatedToolOutput": "Command output: token=<MRCLEAN:GH_TOKEN:002> expires_in=3600",
    "additionalContext": "[mrclean] substituted 1 secret in tool output"
  }
}
```

`updatedToolOutput` is a **string** (tool outputs are always strings in Claude Code's model context). Added in CC v2.1.121. The machine has v2.1.141. [VERIFIED: changelog]

**No detection on PostToolUse:** Return `null` (empty stdout — pass-through). This is the Phase 1 behavior and remains correct for PostToolUse with zero findings.

### 9.5 Detection Budget Bail-Out

```json
{
  "decision": "block",
  "reason": "[mrclean] detection budget exhausted (5 pattern timeouts) — prompt blocked for safety"
}
```

This is the UserPromptSubmit path. For PreToolUse budget exhaustion:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "[mrclean] detection budget exhausted — tool call blocked for safety"
  }
}
```

### 9.6 Banner Upgrade (HOOK-07 Phase 2 Form)

Emitted via `additionalContext` on both `SessionStart` and the first `UserPromptSubmit` of a session. This replaces the Phase 1 short-form banner.

```typescript
// Computed at hook startup after loading config and rules
const ruleCount = secretlintRuleCount + usableGitleaksRuleCount;  // ~212
const allowlistCount = config.allowlist.rules.length + config.allowlist.stopwords.length + /* etc */;
const mode = config.dry_run ? 'dry-run' : 'active';
const banner = `mrclean active v${VERSION} (rules: ${ruleCount}, allowlist: ${allowlistCount}, mode: ${mode})`;
```

---

## Section 10: Audit Log Append Discipline

**Source:** CONTEXT.md + Node.js fs docs [VERIFIED: standard Node.js behavior]

### 10.1 JSONL Record Schema

```typescript
interface AuditRecord {
  ts: string;           // ISO8601 e.g. "2026-05-14T12:34:56.789Z"
  sessionId: string;    // from hook input session_id
  hookEvent: 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse';
  ruleId: string;       // e.g. "AWSSecretAccessKey" or "gitleaks:aws-access-token"
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  action: 'block' | 'substitute' | 'audit';
  redactedHash: string; // first 16 hex chars of SHA-256 of the raw secret value
  fingerprint: string;  // ruleId + ':' + redactedHash
  location: {
    hookEvent: string;
    offset: number;     // span.start in the scanned text
    length: number;     // span.end - span.start
  };
}
```

**NEVER included:** raw secret value, env-var name (for Layer 3 detections), full file paths from PostToolUse outside project root.

### 10.2 Append Implementation

```typescript
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

async function appendAuditRecord(cwd: string, record: AuditRecord): Promise<void> {
  const logPath = join(cwd, '.mrclean', 'audit.jsonl');
  const line = JSON.stringify(record) + '\n';  // trailing newline — JSONL standard
  await appendFile(logPath, line, { flag: 'a', encoding: 'utf8' });
}
```

**Flush semantics:** `fs.appendFile` is backed by `fs.open` + `fs.write` + `fs.close` on each call. There is no buffering. Each audit record is atomically appended and flushed before the hook responds. This is slightly slower than a write stream but safe across the one-process-per-session model.

**No file lock needed:** There is exactly one mrclean hook process per Claude Code session. Concurrent writes do not occur. [CITED: CONTEXT.md §Audit Log]

**JSONL framing:** One JSON object per line, terminated by `\n` (LF, not CRLF). `JSON.stringify(record) + '\n'` produces the correct framing on all platforms.

---

## Section 11: Config Schema Extension

**Source:** CONTEXT.md §Configuration + Phase 1 `src/config/index.ts` + `src/shared/types.ts` [VERIFIED: file read]

### 11.1 Extended `MrcleanConfig` Interface

```typescript
// src/shared/types.ts — Phase 2 extensions (DO NOT replace Phase 1 fields)
export interface MrcleanEntropyConfig {
  threshold: number;    // default 4.5 bits/char
  min_length: number;   // default 20 chars
}

export interface MrcleanRuleOverride {
  id: string;
  action: 'block' | 'substitute' | 'audit' | 'off';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface MrcleanConfig {
  dry_run: boolean;
  allowlist: MrcleanAllowlist;
  // Phase 2 additions:
  entropy: MrcleanEntropyConfig;
  secrets_files: string[];           // additional KV files for Layer 3
  rules: MrcleanRuleOverride[];      // per-rule action/severity overrides
}
```

### 11.2 TOML Config Shape

```toml
# .mrclean/config.toml — Phase 2 schema
dry_run = false

[entropy]
threshold = 4.5
min_length = 20

[secrets_files]
paths = []   # additional non-.env files for Layer 3

[[rules]]
id = "AWSAccessKeyID"
action = "block"
severity = "CRITICAL"

[allowlist]
rules = []
paths = []
stopwords = []
regexes = []
fingerprints = []
```

### 11.3 smol-toml Upgrade (REQUIRED in Phase 2)

Phase 1 used a hand-rolled ~50 LOC minimal TOML parser. That parser does NOT handle `[[rules]]` array-of-tables (TOML 1.1) or `[entropy]` sub-tables with nested keys. **Phase 2 MUST replace `parseMinimalToml` in `src/config/index.ts` with `smol-toml`'s `parse()`.** The public API (`readConfigLayer`, `mergeConfigs`, `loadEffectiveConfig`) remains unchanged.

```typescript
// src/config/index.ts — Phase 2 change:
// BEFORE: import parseMinimalToml from './minimal-toml-parser.js'
// AFTER:
import { parse } from 'smol-toml';

function parseToml(content: string, filePath: string): Partial<MrcleanConfig> {
  try {
    return parse(content) as Partial<MrcleanConfig>;
  } catch (e) {
    throw new ConfigReadError(filePath, (e as Error).message);
  }
}
```

### 11.4 Array Merge Semantics (Phase 2 Extension)

CONTEXT.md: "concat for allowlist arrays; project wins for `[entropy]` scalar fields."

```typescript
// mergeConfigs extension in Phase 2:
function mergeAllowlists(base: MrcleanAllowlist, override: MrcleanAllowlist): MrcleanAllowlist {
  return {
    rules:        [...(base.rules       ?? []), ...(override.rules       ?? [])],
    paths:        [...(base.paths       ?? []), ...(override.paths       ?? [])],
    stopwords:    [...(base.stopwords   ?? []), ...(override.stopwords   ?? [])],
    regexes:      [...(base.regexes     ?? []), ...(override.regexes     ?? [])],
    fingerprints: [...(base.fingerprints ?? []), ...(override.fingerprints ?? [])],
  };
}
// Entropy scalars: project layer wins (same precedence as dry_run)
```

### 11.5 `mrclean ignore <fingerprint>` (CFG-04)

New CLI subcommand. Logic:

```typescript
async function runIgnore(fingerprint: string, cwd: string): Promise<void> {
  const configPath = join(cwd, '.mrclean', 'config.toml');
  const existing = await readConfigLayer(configPath);  // ENOENT → {}
  
  const fps: string[] = existing.allowlist?.fingerprints ?? [];
  if (fps.includes(fingerprint)) {
    process.stderr.write(`[mrclean] fingerprint already in allowlist: ${fingerprint}\n`);
    return;
  }
  
  fps.push(fingerprint);
  // Write back — simplest approach: append a line if file exists; create minimal file if not
  const lineToAppend = `\n# Added by mrclean ignore\n`;  // TOML append
  // Full smol-toml round-trip or targeted append — planner should decide approach
  process.stderr.write(`[mrclean] added ${fingerprint} to ${configPath}\n`);
}
```

**Implementation note for planner:** Appending to a TOML file in a structured way (targeting the `[allowlist]` section's `fingerprints` array) requires either: (a) full parse + re-serialize with smol-toml (if smol-toml supports serialization — check at implementation time), or (b) targeted string append after detecting the `fingerprints = [...]` line. Option (b) is fragile. Recommend option (a) or building a minimal TOML patcher for this specific field.

---

## Section 12: Test Fixtures

**Source:** Official format documentation + training knowledge [ASSUMED for shapes; all values are synthetic with invalid checksums/formats]

### 12.1 Positive Fixtures (Real Shape, Invalid Value)

All values below have a deliberate character substitution to make them invalid while preserving the detection shape.

| Service | Fixture (synthetic — checksum-flipped) | Rule ID |
|---------|---------------------------------------|---------|
| AWS Access Key ID | `AKIAIOSFODNN7EXAMPLX` (last char changed) | `aws-access-token` |
| AWS Secret Access Key | `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` | `AWSSecretAccessKey` |
| GitHub PAT (classic) | `ghp_1234567890abcdefGHIJKLMNOPQRSTUVWXYZ` (58 chars, no Luhn check) | GitHub rule |
| GitHub Fine-Grained PAT | `github_pat_11ABCDE0000000000000000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` | GitHub rule |
| JWT | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.XXXXXXXXXXXXXXXXXXXXXXXXXXX` | JWT rule |
| Stripe Live Key | `sk_live_0000000000000000000000000000000x` | stripe rule |
| OpenAI Key | `sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` | OpenAI rule |
| Anthropic Key | `sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` | anthropic rule |
| Slack Bot Token | `xoxb-000000000000-000000000000-AAAAAAAAAAAAAAAAAAAAAAAAX` | slack rule |
| dotenv-derived value | `MY_API_KEY=secretvalue12345` (in `.env` fixture) | Layer 3 |
| words.txt term | `ACME_INTERNAL_CODENAME` | Layer 4 |

**Fixture files:** `tests/fixtures/positive/` — one `.txt` file per service type.

**Checksum-flip discipline:** For AWS key IDs, the last character is changed (`E` → `X`). For JWTs, the signature segment is replaced with `X`s. The point is that the detection pattern still matches the shape, but any liveness check against AWS/GitHub APIs would fail.

### 12.2 Negative Fixtures (High-Entropy but Not Secrets)

| Type | Example | Expected result |
|------|---------|-----------------|
| UUID v4 | `550e8400-e29b-41d4-a716-446655440000` | NO DETECTION |
| UUID v7 | `018f4c6a-b420-7e3a-8000-000000000000` | NO DETECTION |
| Git SHA-1 (40 char) | `a94a8fe5ccb19ba61c4c0873d391e987982fbbd3` | NO DETECTION |
| Git SHA-1 (7 char) | `a94a8fe` | NO DETECTION |
| npm integrity hash | `sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==` | NO DETECTION |
| Cargo lock hash | `ab12cd34ef56` (12 hex, low entropy) | NO DETECTION |
| MD5 digest | `5d41402abc4b2a76b9719d911017c592` | NO DETECTION |
| SHA-256 digest | `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824` | NO DETECTION |
| Lorem ipsum | `Lorem ipsum dolor sit amet, consectetur adipiscing elit.` | NO DETECTION |
| Base64 image header | `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAC` | NO DETECTION |

**Fixture files:** `tests/fixtures/negative/` — one `.txt` file per type.

### 12.3 License + Source Documentation

Each fixture file gets a header comment:
```
# mrclean test fixture — synthetic invalid value for detection pattern testing
# Source: [service] token format from official documentation
# Checksum-flip: [description of modification]
# License: test fixture only — not a real credential
```

---

## Section 13: Doctor `--bench` Stub

**Source:** CONTEXT.md §Performance Posture [ASSUMED for implementation specifics; decisions locked in CONTEXT.md]

### 13.1 What It Measures

The `--bench` flag on `mrclean doctor` runs a single-iteration timing of the Layer 1 + Layer 2 detection pipeline against a 4 KB synthetic prompt fixture. It reports p50/p95 over N runs (suggested N=10 for the stub; Phase 3 will increase N and add assertions).

```typescript
// In computeDoctorReport (pure function — no process.exit):
async function runBenchmark(opts: { runsCount?: number } = {}): Promise<BenchmarkResult> {
  const runs = opts.runsCount ?? 10;
  const FIXTURE_4KB = 'This is a synthetic 4KB test prompt. '.repeat(114).slice(0, 4096);
  
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await runDetection(FIXTURE_4KB, DEFAULT_CONFIG, { sessionId: 'bench', hookEvent: 'UserPromptSubmit' });
    times.push(performance.now() - t0);
  }
  
  times.sort((a, b) => a - b);
  return {
    p50: times[Math.floor(runs * 0.5)] ?? 0,
    p95: times[Math.floor(runs * 0.95)] ?? 0,
    runsCount: runs,
  };
}
```

**Phase 2 behavior:** Print numbers. No assertions. No CI failure on slowness. That gate is Phase 3's PERF-02.

---

## Section 14: Open Questions for the Planner

### OQ-1: UserPromptSubmit field names (CONTEXT.md correction needed)

CONTEXT.md §HOOK-02 states: `permissionDecision: "deny"` with `permissionDecisionReason`. **This is incorrect for UserPromptSubmit.** The verified Claude Code hook contract uses `decision: "block"` and `reason` (top-level, not in `hookSpecificOutput`). The planner must use `decision: "block"` for UserPromptSubmit denial.

**The types.ts `UserPromptSubmitOutput` interface from Phase 1 already has `decision?: 'block'` and `reason?: string` — this is correct.**

### OQ-2: gitleaks TOML regex adaptation — 38 skipped rules

38 gitleaks rules use Go-only inline mode syntax and must be skipped. This means some services (Atlassian, HuggingFace, certain JWT patterns) will not be covered by the gitleaks layer. Secretlint's preset-recommend covers many of these overlapping services. The planner should document the skip count and rule IDs in a comment in `gitleaks-loader.ts` for transparency.

### OQ-3: POSIX character class `[[:alnum:]]` in some gitleaks rules

At least one rule (`airtable-personnal-access-token`) uses `[[:alnum:]]` which JS regex doesn't support. The outer `try/catch` in the loader handles this, but the planner should explicitly test that the loader doesn't crash when such rules appear.

### OQ-4: smol-toml serialization support for `mrclean ignore`

Check whether `smol-toml` exports a `stringify()` function for serializing back to TOML. If not, the `mrclean ignore` implementation must use a targeted string manipulation approach for the `fingerprints = [...]` array. Verify at implementation time: `import { stringify } from 'smol-toml'` — if it throws, use string append.

### OQ-5: Worker thread memory overhead per hook invocation

Each regex execution spawns a worker (2–5 ms overhead). For a 4 KB prompt matching 10 keyword-filtered rules, that's 10 worker spawns = 20–50 ms overhead, potentially approaching the 100 ms budget before detection even runs. **Consider a pre-warmed worker pool (3–5 workers) initialized at hook startup.** This is a Phase 2 architecture decision the planner should make explicitly. If time-boxed, use single-worker-per-regex as the default and add the pool in a later plan if benchmarks show it's needed.

### OQ-6: `tool_input` shape for multi-field tool substitution

The `updatedInput` must contain the **complete `tool_input` object**. For `Edit` tool calls with large `content` fields, the substituted `updatedInput` may be significantly larger than the original `tool_input` (every occurrence of a secret is replaced). The hook must pass the complete object, not just the changed fields. Verify with a real `Edit` tool payload.

### OQ-7: PostToolUse `tool_response` type

Phase 1 typed `tool_response` as `unknown`. For PostToolUse substitution, mrclean needs to stringify the tool response (if it's not already a string) before running detection. The hook should safely coerce: `const text = typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response)`.

---

## Project Constraints (from CLAUDE.md)

| Directive | Authority |
|-----------|-----------|
| Node.js >=20.18.0 | LOCKED |
| TypeScript ^5.6.0 | LOCKED |
| `commander ^13.x` | LOCKED |
| `@modelcontextprotocol/sdk ^1.x` | LOCKED — NOT touched in Phase 2 |
| `zod/v4` import | LOCKED |
| `tsup` ESM output target node20 | LOCKED |
| `vitest ^4` | LOCKED |
| `tsx ^4` for dev | LOCKED |
| Zero binary shell-outs | LOCKED — no `gitleaks` binary |
| `@anthropic-ai/sdk` lazy-import ONLY for Layer 5 | LOCKED — NOT used in Phase 2 |
| `@secretlint/core` + `@secretlint/node` + preset-recommend | LOCKED for L1 |
| `smol-toml ^1.4.x` | LOCKED for gitleaks TOML + config |
| `dotenv ^16.x` (now 17.4.2 latest) | LOCKED for L3; `parse()` only |
| `fast-glob ^3.3.x` | LOCKED for `.env*` discovery |
| Shannon entropy inline (no npm pkg) | LOCKED |
| Placeholder map in memory only | LOCKED |
| Audit log never contains raw secret | LOCKED |
| Performance: <100ms UserPromptSubmit, <200ms PostToolUse | TARGET (assertion in Phase 3) |

**New deps to add in Phase 2 (not yet in `package.json`):**
```bash
npm install @secretlint/core @secretlint/node @secretlint/secretlint-rule-preset-recommend \
  smol-toml dotenv fast-glob
```

---

## Standard Stack

### Core (Phase 2 additions)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@secretlint/core` | 13.0.0 | `lintSource` low-level API | Official secretlint programmatic entrypoint |
| `@secretlint/node` | 13.0.0 | `createEngine` alt API | Used if lintSource path doesn't suffice |
| `@secretlint/secretlint-rule-preset-recommend` | 13.0.0 | 28-module preset | Community-maintained preset covering AWS, GH, Stripe, etc. |
| `smol-toml` | 1.6.1 | Parse gitleaks TOML + config | Fastest TOML 1.1 parser; replaces Phase 1 hand-rolled parser |
| `dotenv` | 17.4.2 | `.env*` value extraction | `dotenv.parse()` is parser-only — no `process.env` mutation |
| `fast-glob` | 3.3.3 | `.env*` file discovery | Standard cross-platform glob; used by Vite, ESLint |

### Already Installed (Phase 1)

| Library | Version | Phase 2 Role |
|---------|---------|--------------|
| `node:crypto` | built-in | SHA-256 for hash + fingerprint |
| `node:worker_threads` | built-in | ReDoS timeout isolation |
| `node:fs/promises` | built-in | Audit log append |
| `picocolors` | ^1.1.1 | CLI output (bench results) |

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Secret detection rule set | Custom regex pack from scratch | `@secretlint/secretlint-rule-preset-recommend` + vendored gitleaks TOML | 200+ community-maintained, up-to-date patterns |
| TOML parsing | Extend Phase 1 minimal parser | `smol-toml ^1.6` | Phase 1 parser doesn't handle `[[rules]]` array-of-tables |
| `.env` file parsing | Custom KV parser | `dotenv.parse()` | Handles quoting, multiline, comments correctly |
| File glob | `fs.readdir` recursion | `fast-glob ^3.3` | Cross-platform, handles symlinks, `.dot` files |
| Shannon entropy | npm package | Inline 10-line function | The only npm options are abandoned; the formula is 10 lines |

---

## Common Pitfalls

### Pitfall 1: Using `dotenv.config()` Instead of `dotenv.parse()`

**What goes wrong:** `dotenv.config()` mutates `process.env`. If a `.env` file contains `PATH=somthing_wrong`, the hook process's PATH is corrupted.
**Fix:** Always use `dotenv.parse(buffer)`. Never call `dotenv.config()`.

### Pitfall 2: gitleaks `(?i)` Inline Flag — JS Throws on `new RegExp()`

**What goes wrong:** 138 of 222 gitleaks rules contain `(?i)` or `(?-i:)` — JS regex syntax does not support this. Calling `new RegExp(rule.regex)` throws `SyntaxError: Invalid group`.
**Fix:** The `adaptGitleaksPattern` function strips leading `(?i)` and converts to `/i` flag. Rules with `(?-i:)`, `(?i:)` mid-pattern, `(?P<>)` named groups return `null` and are skipped. The loader's `try/catch` catches residual failures (e.g., POSIX classes).

### Pitfall 3: `setImmediate` / `setTimeout` Cannot Cancel a Running Regex

**What goes wrong:** Developer wraps `regex.exec()` with a timeout using `setTimeout(resolve, 50)`. The timeout never fires while `exec()` is running. The hook hangs for seconds on a ReDoS input.
**Fix:** Use `worker_threads`. The main thread calls `worker.terminate()` after the timeout period; the worker dies even if mid-`exec()`.

### Pitfall 4: `updatedInput` Must be Complete Tool Input Object

**What goes wrong:** Hook only substitutes the changed field and returns `updatedInput: { command: sanitized }` for an `Edit` tool call that also has `file_path` and `content`. Claude Code receives an incomplete input and errors or uses wrong defaults.
**Fix:** Pass the full `tool_input` object with only the affected fields substituted: `updatedInput: { ...input.tool_input, command: sanitizedCommand }`.

### Pitfall 5: UserPromptSubmit Uses `decision`/`reason`, NOT `permissionDecision`/`permissionDecisionReason`

**What goes wrong:** Developer copies PreToolUse deny pattern to UserPromptSubmit. Claude Code ignores the `hookSpecificOutput.permissionDecision` field for UserPromptSubmit events and the prompt passes through unblocked.
**Fix:** UserPromptSubmit block = `{ decision: "block", reason: "..." }` at top level. PreToolUse block = `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "..." } }`.

### Pitfall 6: Span Dedup Must Run BEFORE Placeholder Allocation

**What goes wrong:** Layer 1 finds `sk_live_abc` at [0,12]. Layer 2 entropy finds the same span at [0,12]. Two placeholders are allocated for the same value, causing inconsistency.
**Fix:** After each layer produces findings, filter out any spans already covered by prior layers before passing to the placeholder manager.

### Pitfall 7: PostToolUse `tool_response` May Be Non-String

**What goes wrong:** `tool_response` is typed as `unknown`. Calling `runDetection(input.tool_response)` with a JSON object crashes inside the detection engine.
**Fix:** Coerce to string: `const text = typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response)`.

---

## Code Examples

### Detection Orchestrator Skeleton

```typescript
// src/detect/index.ts
import type { MrcleanConfig } from '../shared/types.js';
import { runLayer1 } from './layer1-regex/index.js';
import { runLayer2Entropy } from './layer2-entropy.js';
import { runLayer3Env } from './layer3-env.js';
import { runLayer4Words } from './layer4-words.js';
import type { Finding } from './findings.js';

export interface DetectionContext {
  sessionId: string;
  hookEvent: string;
  coveredSpans?: Array<{ start: number; end: number }>;
}

export async function runDetection(
  text: string,
  config: MrcleanConfig,
  sessionState: SessionState,
  ctx: DetectionContext
): Promise<Finding[]> {
  const findings: Finding[] = [];
  
  // Layer 1: regex rules (secretlint + gitleaks)
  const l1 = await runLayer1(text, config);
  findings.push(...l1);
  
  // Layer 2: entropy (only on uncovered spans)
  const l2 = await runLayer2Entropy(text, config, coveredSpansFrom(findings));
  findings.push(...l2);
  
  // Layer 3: .env blocklist (only on uncovered spans)
  const l3 = runLayer3Env(text, sessionState.envBlocklist, coveredSpansFrom(findings));
  findings.push(...l3);
  
  // Layer 4: words.txt (only on uncovered spans)
  const l4 = runLayer4Words(text, sessionState.wordEntries, coveredSpansFrom(findings));
  findings.push(...l4);
  
  return findings;
}

function coveredSpansFrom(findings: Finding[]): Array<{ start: number; end: number }> {
  return findings.map(f => f.span);
}
```

### Audit Record Write

```typescript
// src/audit/log.ts
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function writeAuditRecord(
  cwd: string,
  record: {
    ts: string; sessionId: string; hookEvent: string;
    ruleId: string; severity: string; action: string;
    redactedHash: string; fingerprint: string;
    location: { hookEvent: string; offset: number; length: number };
  }
): Promise<void> {
  const logPath = join(cwd, '.mrclean', 'audit.jsonl');
  await appendFile(logPath, JSON.stringify(record) + '\n', { flag: 'a', encoding: 'utf8' });
}
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >=20.18.0 | Runtime | Yes | v22.22.0 | — |
| npm | Package install | Yes | 10.9.4 | — |
| `@secretlint/*` packages | Layer 1 | Not installed | — | Must install (Phase 2 task) |
| `smol-toml` | gitleaks + config | Not installed | — | Must install (Phase 2 task) |
| `dotenv` | Layer 3 | Not installed | — | Must install (Phase 2 task) |
| `fast-glob` | Layer 3 | Not installed | — | Must install (Phase 2 task) |
| `node:worker_threads` | ReDoS timeout | Built-in (Node 20+) | — | — |
| `node:crypto` | SHA-256 | Built-in | — | — |
| gitleaks.toml on master | Vendored at build | Fetchable via curl | 222 rules, 3209 lines | Pin a commit SHA for reproducibility |
| claude binary | Doctor --bench | Yes | 2.1.141 | — |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Shannon formula `H = -Σ p(c) * log2(p(c))` is byte-compatible with gitleaks' Go implementation | §5.1 | Entropy threshold may not match gitleaks' expectations; adjust threshold empirically |
| A2 | smol-toml `stringify()` function exists for TOML serialization in `mrclean ignore` | §11.5, OQ-4 | Must use string-manipulation approach for fingerprints array |
| A3 | `worker_threads` with `{ eval: true }` works cleanly with ESM in tsup-bundled output | §4.2 | May need to write worker code to a temp file or use `data:` URL instead |
| A4 | `fast-glob` pattern `.env{,.local,.*}` catches all `.env*` variants including `.env.local` | §6.3 | Some user files may not be discovered; verify with glob pattern test |
| A5 | Per-rule allowlist `paths` check is safely ignorable for in-memory hook text (no file path) | §2.4 | A rule might suppress a real secret because of a false path allowlist match; low risk |
| A6 | `lintSource` from `@secretlint/core` is purely in-memory and does not write to disk | §1.2 | If secretlint writes temp files, it breaks the zero-disk-write contract |

---

## Sources

### Primary (HIGH confidence — verified live 2026-05-14)

- Context7 `/secretlint/secretlint` — `lintSource` API, `createEngine` API, message output shape, rule preset import pattern
- `https://raw.githubusercontent.com/secretlint/secretlint/master/packages/@secretlint/secretlint-rule-preset-recommend/src/index.ts` — 28 rule modules enumerated
- `https://raw.githubusercontent.com/gitleaks/gitleaks/master/config/gitleaks.toml` — 222 rules, 3209 lines, field shapes, per-rule allowlists structure
- Runtime test: `smol-toml@1.6.1` parsed the full gitleaks.toml successfully (222 rules)
- Runtime test: JS regex compilation of all 222 gitleaks patterns — 79 direct, 105 adaptable, 38 incompatible
- Runtime test: `setImmediate`/`setTimeout` cannot interrupt a blocking `RegExp.exec()`; `worker_threads` terminate() can
- Context7 `/motdotla/dotenv` — `dotenv.parse()` is parser-only, no `process.env` mutation
- `https://code.claude.com/docs/en/hooks` — UserPromptSubmit uses `decision: "block"` + `reason` (top-level); PreToolUse uses `hookSpecificOutput.permissionDecision`; `updatedInput` requires complete tool_input object
- `https://code.claude.com/docs/en/changelog` — `hookSpecificOutput.updatedToolOutput` added in CC v2.1.121; machine has v2.1.141
- `npm view @secretlint/core version` — 13.0.0
- `npm view smol-toml version` — 1.6.1
- `npm view dotenv version` — 17.4.2
- `npm view fast-glob version` — 3.3.3
- Phase 1 source files (`src/config/index.ts`, `src/shared/types.ts`, `src/hook/handlers/*.ts`) — read directly for compatibility

### Secondary (MEDIUM confidence — official docs, Context7)

- WebFetch `https://code.claude.com/docs/en/hooks.md` — PostToolUse `updatedToolOutput` shape confirmed as `hookSpecificOutput.updatedToolOutput: string`
- Context7 — gitleaks TOML POSIX class incompatibility (`[[:alnum:]]`) observed at runtime

### Tertiary (LOW confidence — training + reasoning)

- Shannon entropy 10-line formula (A1 — standard mathematical definition, compatible with gitleaks)
- words.txt whole-word regex performance estimate (100 patterns × 4 KB = 1–5 ms)

---

## Metadata

**Confidence breakdown:**
- Layer 1 secretlint API: HIGH — verified via Context7 + source read
- gitleaks TOML shape + JS compatibility: HIGH — verified by runtime compilation test against live file
- smol-toml parse behavior: HIGH — verified by runtime test
- ReDoS timeout strategy: HIGH — worker_threads terminate confirmed at runtime
- dotenv parse-only: HIGH — verified from Context7 + official docs
- Hook JSON shapes: HIGH — verified from live Claude Code docs + changelog
- Shannon entropy formula: MEDIUM — standard definition, cross-referenced with gitleaks behavior
- worker_threads ESM compatibility in tsup bundle: MEDIUM — flagged as A3 assumption

**Research date:** 2026-05-14
**Valid until:** 2026-06-14 (Claude Code hook contract very stable; secretlint/gitleaks rules update frequently but API shapes are stable; smol-toml API stable)
