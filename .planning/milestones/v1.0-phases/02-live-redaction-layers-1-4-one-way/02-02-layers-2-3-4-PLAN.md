---
phase: 02-live-redaction-layers-1-4-one-way
plan: "02"
type: execute
wave: 2
depends_on: ["00"]
files_modified:
  - src/detect/shape-allowlist.ts
  - src/detect/layer2-entropy.ts
  - src/detect/layer3-env.ts
  - src/detect/layer4-words.ts
  - src/detect/session-state.ts
  - tests/detect/layer2-entropy.test.ts
  - tests/detect/layer3-env.test.ts
  - tests/detect/layer4-words.test.ts
  - tests/detect/shape-allowlist.test.ts
autonomous: true
requirements: [DET2-01, DET2-02, DET2-03, DET3-01, DET3-02, DET3-03, DET4-01, DET4-02, DET4-03]
tags: [detection, entropy, dotenv, words, shape-allowlist, layer2, layer3, layer4]
must_haves:
  truths:
    - "Shannon entropy above 4.5 bits/char on 20+ char tokens fires only when a context keyword is co-located OR length>=40 AND entropy>=5.0"
    - "UUIDs, git SHAs, npm integrity hashes, MD5/SHA digests, and base64 image-data headers never trigger Layer 2 (shape allowlist runs FIRST)"
    - ".env, .env.local, .env.foo values are loaded into a session-scoped blocklist at SessionStart but .env.example / .env.sample / .env.template are excluded"
    - "Values shorter than 8 chars, boolean literals, and shape-allowlisted values are skipped from the env blocklist"
    - "words.txt is parsed at SessionStart with case-insensitive whole-word matching and per-line action overrides"
    - "User-global ~/.mrclean/words.txt is layered with project-local .mrclean/words.txt; project entries override same-word global entries"
    - "secrets_files config array supplies additional KV-shaped files to Layer 3 beyond .env*"
    - "Every Layer 2/3/4 detection emits the canonical Finding shape IMPORTED from src/detect/findings.ts (owned by Plan 02-00)"
  artifacts:
    - path: "src/detect/shape-allowlist.ts"
      provides: "Shared shape-allowlist patterns + isShapeAllowlisted helper"
      exports: ["isShapeAllowlisted", "SHAPE_ALLOWLIST_PATTERNS"]
    - path: "src/detect/layer2-entropy.ts"
      provides: "runLayer2Entropy(text, config, coveredSpans) → Finding[]"
      exports: ["runLayer2Entropy", "shannonEntropy"]
    - path: "src/detect/layer3-env.ts"
      provides: "loadEnvBlocklist + runLayer3Env"
      exports: ["loadEnvBlocklist", "runLayer3Env", "EnvBlocklist"]
    - path: "src/detect/layer4-words.ts"
      provides: "loadWordsList + runLayer4Words"
      exports: ["loadWordsList", "runLayer4Words", "WordEntry"]
    - path: "src/detect/session-state.ts"
      provides: "SessionState type — carries envBlocklist + wordEntries between hook invocations"
      exports: ["SessionState", "initSessionState"]
  key_links:
    - from: "src/detect/layer2-entropy.ts"
      to: "src/detect/shape-allowlist.ts"
      via: "isShapeAllowlisted(token) check before entropy fires"
      pattern: "isShapeAllowlisted"
    - from: "src/detect/layer3-env.ts"
      to: "dotenv"
      via: "import { parse } from 'dotenv'"
      pattern: "from 'dotenv'"
    - from: "src/detect/layer3-env.ts"
      to: "fast-glob"
      via: "discoverEnvFiles via fast-glob"
      pattern: "from 'fast-glob'"
    - from: "src/detect/layer2-entropy.ts AND layer3-env.ts AND layer4-words.ts"
      to: "src/detect/findings.ts"
      via: "IMPORT canonical Finding + redactedHash + fingerprint from Plan 02-00"
      pattern: "from './findings'"
---

<objective>
Implement Layers 2 (Shannon entropy), 3 (.env value extraction), and 4 (user dirty-word list) of the detection engine. Each layer is a stateless function returning the canonical `Finding[]` shape from `src/detect/findings.ts` (owned by Plan 02-00). Layer 3 + 4 build their session-scoped state at `SessionStart` and the orchestrator (Plan 02-04) carries that state across PreToolUse / PostToolUse invocations.

Purpose: Satisfies DET2-01..03 (entropy + shape allowlist + keyword requirement), DET3-01..03 (`.env*` discovery + parse-only + skip rules), DET4-01..03 (words.txt + `word|action` syntax + SessionStart hot-reload). Together with Layer 1 these complete the four detection layers required by the Phase 2 success criteria.

Output: Three stateless layer functions, a shared shape-allowlist module, a SessionState contract that Plan 02-04 consumes, and tests covering each layer's positive + negative behavior + the layering semantics.

**Wave 1 → Wave 2 contract:** This plan IMPORTS `Finding`, `redactedHash`, `fingerprint` from `src/detect/findings.ts` (owned by Plan 02-00). DO NOT create or modify that file. If you need a new helper, revise Plan 02-00 first.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md
@.planning/phases/02-live-redaction-layers-1-4-one-way/02-00-deps-config-schema-toml-migration-PLAN.md
@CLAUDE.md

<interfaces>
**OWNED ELSEWHERE (Plan 02-00 — Wave 1; import only, DO NOT CREATE OR MODIFY):**

From `src/detect/findings.ts` (canonical, owned by Plan 02-00):
```typescript
export interface Finding {
  ruleId: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  span: { start: number; end: number }
  value: string
  redactedHash: string
  fingerprint: string
  source: 'secretlint' | 'gitleaks' | 'entropy' | 'env' | 'words'
  action?: 'block' | 'substitute' | 'audit' | 'off' | 'warn'   // 'warn' is Layer 4-emittable; orchestrator (02-04) normalizes to 'audit'
}

export function redactedHash(value: string): string;
export function fingerprint(ruleId: string, value: string): string;
```

This plan IMPORTS the Finding type and the two helpers. It does NOT redefine them. If executor finds `findings.ts` missing, that is an INVARIANT VIOLATION — Plan 02-00 is meant to be Wave 1 and must complete first. STOP and surface a runtime error rather than re-creating a stub.

---

MrcleanConfig fields used (from src/shared/types.ts — Plan 02-00 owns):
- `config.entropy.threshold: number` (default 4.5)
- `config.entropy.min_length: number` (default 20)
- `config.secrets_files: string[]` (additional KV files for Layer 3)
- `config.allowlist.*` (5-axis allowlist, applied by Plan 02-04 orchestrator — NOT by each layer)

Locked behaviors (CONTEXT + RESEARCH):
- Layer 2 keyword set: `secret | key | token | password | bearer | api[_-]?key | access[_-]?token | client[_-]?secret | private[_-]?key | auth` (case-insensitive whole-word; ±40 chars window).
- Layer 2 escalation: length≥40 AND entropy≥5.0 fires even without a keyword.
- Layer 3 exclusion globs: `**/.env.example`, `**/.env.sample`, `**/.env.template`, `**/.env.*.example`, `**/.env.*.sample`, `**/.env.*.template`.
- Layer 3 skip rules: value length <8 OR shape-allowlisted OR value lowercases to one of `true|false|1|0|yes|no|on|off`.
- Layer 4 syntax: `word|action` where action∈{block,warn,audit}; default `block`; case-insensitive whole-word; user-global merge-then-project-overrides.
- Layer 4 also reads `~/.mrclean/words.txt` (user-global) — same syntax — and project-local wins on same-word conflicts.

Shape allowlist patterns (RESEARCH §5.2 — locked literal):
```typescript
const SHAPE_ALLOWLIST_PATTERNS: RegExp[] = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,  // UUID v4/v7
  /^[0-9a-f]{40}$/i,                                                   // git SHA-1 (40 hex)
  /^[0-9a-f]{64}$/i,                                                   // SHA-256 hex (64 chars)
  /^[0-9a-f]{32}$/i,                                                   // MD5 hex (32 chars)
  /^sha\d+-[A-Za-z0-9+/]+=*$/,                                         // npm/Cargo integrity hash
  /^data:image\//,                                                     // base64 image-data header
  /^[0-9a-f]{7}$/i,                                                    // short git SHA (7 chars)
]
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Shape allowlist + Layer 2 entropy</name>
  <files>src/detect/shape-allowlist.ts, src/detect/layer2-entropy.ts, tests/detect/shape-allowlist.test.ts, tests/detect/layer2-entropy.test.ts</files>
  <read_first>
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §5 (Shannon entropy + shape allowlist + keyword requirement)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md §Layer 2
    - **src/detect/findings.ts (Plan 02-00 — IMPORT `Finding`, `redactedHash`, `fingerprint`. DO NOT create or modify.)**
    - src/shared/types.ts (read MrcleanConfig.entropy fields from Plan 02-00 — confirm `threshold: number` and `min_length: number`)
  </read_first>
  <behavior>
    - `isShapeAllowlisted('550e8400-e29b-41d4-a716-446655440000')` returns true (UUID v4).
    - `isShapeAllowlisted('a94a8fe5ccb19ba61c4c0873d391e987982fbbd3')` returns true (git SHA-1).
    - `isShapeAllowlisted('AKIAIOSFODNN7EXAMPLE')` returns false (this is an AWS access key shape, not an allowlist shape — Layer 1 catches it).
    - `shannonEntropy('aaaa')` returns 0; `shannonEntropy('abcd')` returns 2 (log2 4); `shannonEntropy(stringOf64RandomHex)` is approximately 4.0 (entropy of hex charset).
    - `runLayer2Entropy(text, config, coveredSpans)` returns Finding[] with `source: 'entropy'`, `ruleId: 'entropy:high'`, severity `MEDIUM` by default (not CRITICAL — entropy is the broad net).
    - High-entropy token WITHOUT a co-located keyword and length<40 → 0 findings (DET2-03).
    - High-entropy token WITH keyword `secret=` within ±40 chars → 1 finding (DET2-03).
    - High-entropy token with length≥40 AND entropy≥5.0 → 1 finding even without keyword (escalation).
    - Shape-allowlisted token (UUID) → 0 findings even at high entropy + keyword present (DET2-02 — shape check runs FIRST).
    - Spans already covered (passed in as `coveredSpans`) → skipped.
    - Tunable: `config.entropy.threshold = 5.0` raises the bar; what was a hit at 4.5 may not be at 5.0.
  </behavior>
  <action>
    Step 1 — `src/detect/shape-allowlist.ts`:
    - Export `SHAPE_ALLOWLIST_PATTERNS: readonly RegExp[]` exactly per RESEARCH §5.2 (locked literal in interfaces block).
    - Export `isShapeAllowlisted(value: string): boolean` that checks all patterns; returns true on any match.

    Step 2 — `src/detect/layer2-entropy.ts`:
    - **Imports:** `import type { Finding } from './findings.js'; import { redactedHash, fingerprint } from './findings.js'; import { isShapeAllowlisted } from './shape-allowlist.js';`
    - Inline `shannonEntropy(s: string): number` per RESEARCH §5.1 (the 10-line implementation; no external pkg per CLAUDE.md). Export it for re-use and testing.
    - Inline `ENTROPY_KEYWORDS` regex per RESEARCH §5.3: `/\b(?:secret|key|token|password|bearer|api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key|auth)\b/i`.
    - Inline `hasEntropyContext(text, tokenStart, tokenEnd)` per RESEARCH §5.3 — checks ±40 chars (excluding the token itself) for any keyword.
    - Export `runLayer2Entropy(text: string, config: MrcleanConfig, coveredSpans: { start: number; end: number }[] = []): Finding[]`.
    - Algorithm:
      1. Token-extract candidates: split on non-alphanumeric-and-non-dash-underscore boundaries (use regex `/[A-Za-z0-9_\-./+=]{N,}/g` where `N = config.entropy.min_length`). Each match yields a candidate span.
      2. For each candidate:
        - Skip if any coveredSpan overlaps (helper `overlapsCovered`).
        - Skip if length < `config.entropy.min_length`.
        - Skip if `isShapeAllowlisted(value)` (DET2-02 — runs BEFORE entropy check).
        - Compute `entropy = shannonEntropy(value)`.
        - Fire only if:
          - (entropy ≥ `config.entropy.threshold` AND `hasEntropyContext(text, span.start, span.end)`) OR
          - (value.length ≥ 40 AND entropy ≥ 5.0)
        - Build Finding: `ruleId: 'entropy:high'`, severity `MEDIUM` (no CRITICAL for entropy — too noisy a tier), `source: 'entropy'`, `value`, `redactedHash`, `fingerprint`.
      3. Return findings sorted by span.start ascending.

    Step 3 — `tests/detect/shape-allowlist.test.ts` (~5 tests):
    - UUID v4 → true. UUID v7 → true. git SHA-1 → true. SHA-256 hex → true. AWS access key (`AKIA...`) → false. Lorem ipsum word → false.

    Step 4 — `tests/detect/layer2-entropy.test.ts` (~8 tests):
    - `shannonEntropy('aaaa')` ≈ 0.
    - `shannonEntropy('abcd')` ≈ 2.
    - High-entropy token without keyword and length 20 → 0 findings.
    - High-entropy token with `secret=<token>` (keyword within ±40 chars) → 1 finding with `source: 'entropy'`.
    - 40+ char token with entropy ≥ 5.0 and NO keyword → 1 finding (escalation path).
    - UUID v4 with `secret=` prefix → 0 findings (shape allowlist runs first).
    - `coveredSpans: [{start:0, end:50}]` → 0 findings inside that span even with keyword.
    - Tunable: passing `config.entropy.threshold = 7.0` (impossibly high) → 0 findings on a real-shape token.

    Run `npx vitest run tests/detect/shape-allowlist.test.ts tests/detect/layer2-entropy.test.ts` — all pass.

    Commit as `feat(02-02): shape allowlist + Layer 2 entropy detection`.
  </action>
  <verify>
    <automated>
      grep -c "export function isShapeAllowlisted" src/detect/shape-allowlist.ts &&
      grep -cE "SHAPE_ALLOWLIST_PATTERNS" src/detect/shape-allowlist.ts &&
      grep -cE "export function shannonEntropy|export function runLayer2Entropy" src/detect/layer2-entropy.ts &&
      grep -c "ENTROPY_KEYWORDS\|api_key\|access_token" src/detect/layer2-entropy.ts &&
      grep -cE "from ['\"]\\./findings" src/detect/layer2-entropy.ts &&
      test -f src/detect/findings.ts &&
      npx vitest run tests/detect/shape-allowlist.test.ts tests/detect/layer2-entropy.test.ts 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      git log -1 --format=%s | grep -E "^feat\(02-02\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - `src/detect/shape-allowlist.ts` exports `isShapeAllowlisted` and `SHAPE_ALLOWLIST_PATTERNS`.
    - `src/detect/layer2-entropy.ts` exports `shannonEntropy`, `runLayer2Entropy`; contains an ENTROPY_KEYWORDS regex that includes `secret`, `key`, `token`, `password`, `bearer`.
    - `src/detect/layer2-entropy.ts` calls `isShapeAllowlisted` before any entropy comparison (grep `isShapeAllowlisted`).
    - `src/detect/layer2-entropy.ts` imports `Finding`, `redactedHash`, `fingerprint` from `./findings` (grep verified).
    - `src/detect/findings.ts` exists (Plan 02-00 invariant) — verified by `test -f`.

    Behavior assertions:
    - All ~13 tests across shape-allowlist + layer2-entropy pass.
    - UUID + git SHA negatives are robust (covered by shape-allowlist test cases).
    - Keyword requirement + length-escalation are both proven (DET2-03 verified end-to-end).

    Commit assertion:
    - `git log -1 --format=%s` matches `^feat\(02-02\)`.
  </acceptance_criteria>
  <done>Shape allowlist + Layer 2 entropy implemented per RESEARCH §5; DET2-01..03 all proven by tests. Finding shape IMPORTED from Plan 02-00.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Layer 3 (.env value extraction) + Layer 4 (words.txt) + SessionState</name>
  <files>src/detect/layer3-env.ts, src/detect/layer4-words.ts, src/detect/session-state.ts, tests/detect/layer3-env.test.ts, tests/detect/layer4-words.test.ts</files>
  <read_first>
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-RESEARCH.md §6 (dotenv + fast-glob) + §7 (words.txt parser)
    - .planning/phases/02-live-redaction-layers-1-4-one-way/02-CONTEXT.md §Layer 3 + §Layer 4
    - src/detect/shape-allowlist.ts (Task 1 — re-use for DET3-03 skip rule)
    - **src/detect/findings.ts (Plan 02-00 — IMPORT `Finding`, `redactedHash`, `fingerprint`. DO NOT create.)**
    - src/config/index.ts (loadEffectiveConfig — Plan 02-00 extension; this task does NOT call it, but its caller will)
  </read_first>
  <behavior>
    Layer 3 (env):
    - `loadEnvBlocklist({ cwd, secretsFiles })` discovers `.env`, `.env.local`, `.env.foo` via fast-glob; excludes `.env.example`, `.env.sample`, `.env.template` and their variants.
    - For each discovered file: `dotenv.parse(buffer)` (NEVER `dotenv.config()`); for each KV pair, apply skip rules (length<8, shape-allowlisted, boolean literal); add survivors to a `Set<string>` AND a `Map<value, { sourceFile: string }>` for audit-log location info.
    - Additional files from `config.secrets_files` are loaded the same way (DET3-02). The function does NOT validate that those files exist beyond what dotenv.parse handles (missing → empty result).
    - Returns `EnvBlocklist = { values: Set<string>; meta: Map<string, { sourceFile: string }> }`.
    - `runLayer3Env(text, envBlocklist, coveredSpans)` scans for occurrences of any blocklisted value in `text` (literal substring; case-sensitive — env values are case-sensitive). Each occurrence emits a Finding with `source: 'env'`, `ruleId: 'env:literal'`, severity `HIGH` (env values are typically real secrets — opt-in by the operator). Spans inside `coveredSpans` are skipped.

    Layer 4 (words):
    - `loadWordsList({ homeDir, cwd })` reads `~/.mrclean/words.txt` (user-global) AND `<cwd>/.mrclean/words.txt` (project-local). Missing files → `[]`.
    - `parseWordsFile(content)` per RESEARCH §7.1: strip trailing `# comment`, ignore blanks, parse `word|action` with default action `block`, action ∈ {block, warn, audit} (other actions default to `block`); escape regex metachars; compile case-insensitive whole-word regex once.
    - Merge: project-local entries OVERRIDE same-word global entries (lowercased word as map key); union otherwise.
    - Returns `WordEntry[]` (where `WordEntry = { word: string; action: 'block'|'warn'|'audit'; re: RegExp }`).
    - `runLayer4Words(text, wordEntries, coveredSpans)` runs each entry's regex against text via `.exec` loop; each match → Finding with `source: 'words'`, `ruleId: 'word:<lowercased-word>'`, severity HIGH (operator added them deliberately).

    SessionState:
    - `interface SessionState { sessionId: string; envBlocklist: EnvBlocklist; wordEntries: WordEntry[]; createdAt: string }`.
    - `async function initSessionState({ sessionId, homeDir, cwd, config }): Promise<SessionState>` is the one-shot SessionStart bootstrap. Plan 02-04's orchestrator calls this and threads the result through PreToolUse / PostToolUse invocations within the same process.
    - **Important caveat:** the Phase 1 hook is one-process-per-event (spawn-per-invocation per the install settings.json); SessionState as defined here is per-invocation, NOT process-persistent. CONTEXT §Layer 3 + §Layer 4 still requires SessionStart-only reload (no per-prompt reload). Resolution: SessionState is rebuilt at every hook invocation BUT cached on a per-process basis via module-level `let cachedSessionState: SessionState | null = null` with sessionId-keyed invalidation. The first invocation builds it; subsequent invocations in the same process re-use; new processes (new Claude session) build fresh. This is documented in src/detect/session-state.ts with a `// HOOK-PROCESS LIFETIME` comment. Per-invocation cost is non-trivial but acceptable for v1 (Phase 3 PERF gate will revisit).
  </behavior>
  <action>
    Step 1 — `src/detect/layer3-env.ts`:
    - **Imports:** `import type { Finding } from './findings.js'; import { redactedHash, fingerprint } from './findings.js'; import { isShapeAllowlisted } from './shape-allowlist.js'; import fastGlob from 'fast-glob'; import { parse as dotenvParse } from 'dotenv';`
    - Define and export `EnvBlocklist` interface above.
    - Define exclusion glob list (locked literal from RESEARCH §6.3):
      ```
      const ENV_EXCLUDE_GLOBS = [
        '**/.env.example', '**/.env.sample', '**/.env.template',
        '**/.env.*.example', '**/.env.*.sample', '**/.env.*.template',
      ]
      ```
    - `async function discoverEnvFiles(cwd: string): Promise<string[]>` — uses `fast-glob` with pattern `'.env{,.local,.*}'`, `cwd: cwd`, `absolute: true`, `dot: true`, `ignore: ENV_EXCLUDE_GLOBS`.
    - `async function loadEnvBlocklist({ cwd, secretsFiles = [] }: { cwd: string; secretsFiles?: string[] }): Promise<EnvBlocklist>`:
      1. discoverEnvFiles(cwd) → file list
      2. Add secretsFiles (resolved relative to cwd) to the file list (NOT applying the exclusion filter — operator explicitly opted in to those files; DET3-02).
      3. For each file: `readFile(file, 'utf8')`. If ENOENT → skip silently. `parse(buffer)` → `{ KEY: value }`.
      4. For each value, apply skip rules:
        - `value.length < 8` → skip
        - `isShapeAllowlisted(value)` → skip
        - `['true','false','1','0','yes','no','on','off'].includes(value.toLowerCase())` → skip
      5. Add survivors to a `Set<string>`. Track sourceFile in `Map<value, { sourceFile }>` for audit.
      6. Return `{ values, meta }`.
    - `function runLayer3Env(text: string, blocklist: EnvBlocklist, coveredSpans: { start: number; end: number }[] = []): Finding[]`:
      - For each value in `blocklist.values`, find all occurrences in `text` via `text.indexOf(value, position)` loop (case-sensitive; env values are case-sensitive).
      - For each occurrence at offset `i` with length `value.length`:
        - Skip if overlaps any coveredSpan.
        - Build Finding: `source: 'env'`, `ruleId: 'env:literal'`, severity `HIGH`, span `[i, i+value.length]`, value, redactedHash, fingerprint.
      - Audit-log integration (Plan 02-03 will consume): the Finding does NOT carry the sourceFile NAME — RESEARCH and CONTEXT both lock that env-var names are NEVER in the audit log. The `blocklist.meta` Map is consulted by Plan 02-03 to populate `location.hookEvent` only (NOT a file path).

    Step 2 — `src/detect/layer4-words.ts`:
    - **Imports:** `import type { Finding } from './findings.js'; import { redactedHash, fingerprint } from './findings.js';`
    - `interface WordEntry { word: string; action: 'block'|'warn'|'audit'; re: RegExp }`.
    - `function parseWordsFile(content: string): WordEntry[]` — per RESEARCH §7.1:
      - Split lines; strip `# trailing comment` (regex `/#.*$/`); trim; skip blanks.
      - Find first `|`; left side = word, right side = action.
      - Validate action ∈ {block, warn, audit}; default `block` on omission or invalid token.
      - Escape regex metachars in word; compile `new RegExp(\`\\b${escaped}\\b\`, 'gi')`.
      - Return WordEntry[] in file order.
    - `async function loadWordsList({ homeDir, cwd }): Promise<WordEntry[]>`:
      - Try read `<homeDir>/.mrclean/words.txt` and `<cwd>/.mrclean/words.txt`. ENOENT → empty.
      - Parse each → WordEntry[].
      - Merge into a `Map<lowercased-word, WordEntry>`. Apply global first, project second; project wins.
      - Return `[...map.values()]`.
    - `function runLayer4Words(text: string, entries: WordEntry[], coveredSpans = []): Finding[]`:
      - For each entry, run `entry.re.exec(text)` in a loop. For each match, build Finding: `source: 'words'`, `ruleId: 'word:' + entry.word.toLowerCase()`, severity HIGH, action `entry.action`, span, value (the matched text), redactedHash, fingerprint.
      - Skip if span overlaps coveredSpans.
      - The Finding.action field IS set here directly (Layer 4 owns the per-word action mapping; Plan 02-04 orchestrator does NOT override; orchestrator DOES normalize `'warn'` → `'audit'` for downstream effectiveAction).

    Step 3 — `src/detect/session-state.ts`:
    - Export the SessionState interface from interfaces block.
    - Export `async function initSessionState({ sessionId, homeDir, cwd, config }): Promise<SessionState>`:
      - Calls `loadEnvBlocklist({ cwd, secretsFiles: config.secrets_files })`.
      - Calls `loadWordsList({ homeDir, cwd })`.
      - Returns `{ sessionId, envBlocklist, wordEntries, createdAt: new Date().toISOString() }`.
    - Module-level `let cachedSessionState: SessionState | null = null` and an exported `function getCachedSessionState(sessionId: string): SessionState | null` that returns the cache IF sessionId matches; export `function setCachedSessionState(state: SessionState): void`. These are consumed by Plan 02-04 / 02-05 to avoid re-reading files on every hook invocation within the same process.
    - Add HOOK-PROCESS-LIFETIME comment explaining the rebuild semantics + sessionId-keyed invalidation.

    Step 4 — `tests/detect/layer3-env.test.ts` (~6 tests):
    - Create a tempdir with `.env` (value `MY_API_KEY=secretvalue12345`), `.env.example` (value `MY_API_KEY=ignored`), and `.env.local` (value `OTHER=truevaluexyzlong`). Call `loadEnvBlocklist({ cwd: tmpDir })`.
    - Assert: blocklist contains `secretvalue12345` and `truevaluexyzlong` but NOT `ignored` (.env.example excluded).
    - Skip rules: a `.env` with `SHORT=abc` (3 chars) → not in blocklist.
    - Skip rules: `.env` with `BOOL=true` → not in blocklist.
    - Skip rules: `.env` with `UUID=550e8400-e29b-41d4-a716-446655440000` → not in blocklist (shape allowlist).
    - secrets_files: tmpDir/custom.env with `K=alongvalue12345`, passed as `secretsFiles: ['custom.env']` → in blocklist.
    - `runLayer3Env`: text `"the secretvalue12345 is here"` returns 1 finding with span covering positions [4, 20].

    Step 5 — `tests/detect/layer4-words.test.ts` (~6 tests):
    - `parseWordsFile('ACME\nFooBar|warn\n# comment\n\nNEWWORD|audit\nbadaction|xyz')` returns 4 entries: ACME/block, FooBar/warn, NEWWORD/audit, badaction/block (xyz coerced to block).
    - Whole-word match: text `"ACMEFOO"` against word `ACME` → 0 findings (whole-word boundary). Text `"foo ACME bar"` → 1 finding.
    - Case-insensitive: text `"acme"` against word `ACME` → 1 finding.
    - User-global vs project-local: tmp with `~/.mrclean/words.txt = "foo|warn"` and `cwd/.mrclean/words.txt = "foo|audit"` → loadWordsList returns 1 entry with action=`audit` (project wins).
    - User-global + project-local union: tmp with global `foo|warn` and project `bar|audit` → 2 entries.
    - `runLayer4Words` finding shape: source='words', ruleId='word:foo', action=entry.action.

    Run `npx vitest run tests/detect/layer3-env.test.ts tests/detect/layer4-words.test.ts` — all pass.

    Commit as `feat(02-02): Layer 3 .env extraction + Layer 4 words.txt + SessionState bootstrap`.
  </action>
  <verify>
    <automated>
      grep -c "from 'dotenv'" src/detect/layer3-env.ts &&
      grep -c "from 'fast-glob'" src/detect/layer3-env.ts &&
      grep -cE "ENV_EXCLUDE_GLOBS|env.example" src/detect/layer3-env.ts &&
      grep -c "isShapeAllowlisted" src/detect/layer3-env.ts &&
      grep -cE "from ['\"]\\./findings" src/detect/layer3-env.ts &&
      grep -cE "from ['\"]\\./findings" src/detect/layer4-words.ts &&
      grep -cE "export function parseWordsFile|export async function loadWordsList|export function runLayer4Words" src/detect/layer4-words.ts &&
      grep -cE "^export interface SessionState|^export async function initSessionState" src/detect/session-state.ts &&
      grep -v '^#' src/detect/layer3-env.ts | grep -cE "dotenv\.config" | grep -E "^0$" &&
      npx vitest run tests/detect/layer3-env.test.ts tests/detect/layer4-words.test.ts 2>&1 | grep -E "Tests +[0-9]+ passed" &&
      git log -1 --format=%s | grep -E "^feat\(02-02\)"
    </automated>
  </verify>
  <acceptance_criteria>
    Source assertions:
    - `src/detect/layer3-env.ts` imports `dotenv` and `fast-glob`; uses `dotenv.parse` and NEVER `dotenv.config` (grep-verified: 0 occurrences of `dotenv.config` after stripping `#` comment lines).
    - `src/detect/layer3-env.ts` imports `Finding`, `redactedHash`, `fingerprint` from `./findings` (grep verified — Plan 02-00 module).
    - `src/detect/layer3-env.ts` calls `isShapeAllowlisted` in the skip-rule pipeline.
    - `src/detect/layer3-env.ts` declares exclusion globs covering `.env.example`, `.env.sample`, `.env.template`.
    - `src/detect/layer4-words.ts` exports `parseWordsFile`, `loadWordsList`, `runLayer4Words`, `WordEntry`.
    - `src/detect/layer4-words.ts` imports `Finding`, `redactedHash`, `fingerprint` from `./findings` (grep verified — Plan 02-00 module).
    - `src/detect/layer4-words.ts` compiles regexes with `'gi'` flag (case-insensitive global) — grep `'gi'`.
    - `src/detect/session-state.ts` exports `SessionState`, `initSessionState`, `getCachedSessionState`, `setCachedSessionState`.
    - **Wave 1 contract:** `src/detect/findings.ts` is NOT in this plan's git diff (Plan 02-00 owns it).

    Behavior assertions:
    - All 12+ Layer 3/4 tests pass.
    - `.env.example` is excluded (proven by test).
    - `secrets_files` from config feeds into the blocklist (proven by test).
    - Skip rules (length, boolean, shape) all proven (3 tests).
    - words.txt syntax handles all 4 cases: word-only, word|action, comment, blank (proven by parseWordsFile test).
    - User-global + project-local merge with project-wins (proven by test).

    Commit assertion:
    - `git log -1 --format=%s` matches `^feat\(02-02\):`.
  </acceptance_criteria>
  <done>Layers 3 and 4 implemented per RESEARCH §6–§7; SessionState bootstrap exported for Plan 02-04 to consume; DET3-01..03 and DET4-01..03 all proven by tests. Finding shape IMPORTED from Plan 02-00.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| filesystem→hook | `.env*` and `words.txt` files are operator-owned. Layer 3 reads VALUES (not env names) and adds them to an in-memory blocklist. |
| `.env` parsing | `dotenv.parse` runs in-process; if it had a parser exploit, the hook process is compromised. dotenv 17.x has no known vulns. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-02-01 | Tampering | A malicious user adds a `.env` file with `PATH=evil` and the hook accidentally calls `dotenv.config()` mutating process.env | mitigate | The code grep gate asserts zero occurrences of `dotenv.config` (skipping `#` comment lines). `dotenv.parse()` is the ONLY allowed entry. The acceptance criteria includes this grep gate. |
| T-02-02-02 | Information disclosure | The audit log (Plan 02-03 consumer) accidentally includes the env-var NAME or sourceFile path | mitigate | `EnvBlocklist.meta` is intentionally a private side-channel — Plan 02-03's audit log writer is contractually forbidden (per CONTEXT §Audit Log) from using sourceFile names. This plan does NOT pass env names anywhere; only values flow into Findings. |
| T-02-02-03 | DoS | A 100 MB `.env` file or a words.txt with 1 million entries exhausts memory at SessionStart | accept | The operator controls these files; if they create a 100 MB .env they have already won/lost. No size cap in v1. |
| T-02-02-04 | Tampering | `.mrclean/words.txt` is committed to a public repo, leaking the operator's proprietary terms | accept | The `.mrclean/` directory is `.gitignored` by default (Phase 1 INST-07 locked). Operator must explicitly remove the gitignore entry to commit it; documented behavior. |
| T-02-02-05 | DoS | A pathological word in words.txt with thousands of repeated chars compiles to a ReDoS-prone regex | accept | Whole-word boundary `\b` + escaped literal prevents catastrophic backtracking by construction; the worst case is linear scan over the input. No worker isolation needed for Layer 4. |
| T-02-02-06 | Information disclosure | shape-allowlist false positive: a real secret coincidentally shaped like a UUID gets dropped | accept | Documented v1 limitation. Operator can add the value to `.mrclean/words.txt` to force detection. Listed as a known tradeoff in RESEARCH §5.2. |
</threat_model>

<verification>
- `grep -v '^#' src/detect/layer3-env.ts | grep -c "dotenv\.config"` = 0 (NEVER mutates process.env).
- `grep -v '^#' src/detect/layer3-env.ts | grep -c "dotenv.parse"` >= 1.
- All Layer 2/3/4 tests pass: ~21 tests across the four test files.
- shape-allowlist correctly drops UUID, git SHA, npm integrity, MD5/SHA, base64-image headers.
- words.txt parser handles word-only, `word|action`, comments, blanks, and invalid actions (default to block).
- Plan 02-04 can import `runLayer2Entropy`, `runLayer3Env`, `runLayer4Words`, `initSessionState`, `getCachedSessionState`, `setCachedSessionState` from this plan's outputs.
- The Wave 1 contract is honored: `src/detect/findings.ts` is owned by Plan 02-00, NOT touched here.
</verification>

<success_criteria>
- DET2-01: entropy threshold 4.5, min length 20, tunable via `config.entropy`.
- DET2-02: shape allowlist runs BEFORE entropy (test proves UUID + git SHA + base64-image header are silenced).
- DET2-03: keyword requirement + length-escalation both proven.
- DET3-01: `.env*` parsed via `dotenv.parse()` at SessionStart; never `dotenv.config()`.
- DET3-02: `secrets_files` config array consumed.
- DET3-03: skip rules (length, shape, boolean) applied.
- DET4-01: words.txt parsed, case-insensitive whole-word matching.
- DET4-02: `word|action` syntax with default `block`.
- DET4-03: hot-reload at SessionStart (init via initSessionState; cached per-process keyed by sessionId).
- Plan 02-04 has all the inputs it needs to assemble the orchestrator.
</success_criteria>

<output>
After completion, create `.planning/phases/02-live-redaction-layers-1-4-one-way/02-02-SUMMARY.md` documenting:
- Shape allowlist patterns + entropy thresholds + keyword requirement.
- `.env*` discovery rules + skip semantics + secrets_files behavior.
- words.txt grammar + layering semantics (user-global + project-local).
- SessionState contract for Plan 02-04 consumption.
- Confirmation that this plan imports Finding/redactedHash/fingerprint from `src/detect/findings.ts` (Plan 02-00 owned) — no duplicate definitions.
</output>
