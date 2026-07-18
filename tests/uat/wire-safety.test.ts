/**
 * Wire-safety UAT — SC1b live canary gate + restore-then-resume re-entry
 * proof + per-tool tool_response shape survey (Plan 11-05, REVMODE-11).
 *
 * WHAT THIS PROVES (the live half of SC1 — the deterministic dist-parity
 * gate is the hook STDOUT proof; this leg is the WIRE proof through a real
 * Claude Code session; planner pin: NO tee wrapper on hook stdout):
 *
 *   1. Run-unique canaries ride a foreign-named fixture MCP tool's output
 *      (env-fed via the sandbox --mcp-config — NEVER in prompts, Pitfall 3)
 *      through mrclean's REAL shipped hook (buildHookCommand fail-closed
 *      wrapper, HOME-prefixed inside the command string only).
 *   2. NON-VACUITY CHAIN, ordered BEFORE any absence assertion (Pitfall 9,
 *      10-08 discipline): v2 tokens observed on the wire → sandbox sessions
 *      map exists (A1) → restore stdout carries the WORD original with
 *      restored>=1 and the secret-class token byte-surviving → only then the
 *      canary-absence greps.
 *   3. ABSENCE (hard-asserted, mrclean-owned invariant): canary originals
 *      absent from run-1 stream-json, the run-1 transcript, and EVERY file
 *      under ~/.claude/projects/**\/*.jsonl (whole-tree grep).
 *   4. Run 2 (--resume, with the E3 --continue fallback): after the LOCAL
 *      restore, the resumed wire still carries zero canary originals —
 *      restore is store-byte-inert (10-08), so it can never re-enter.
 *   5. SURVEY (record-don't-assert; the re-homed STATE.md Phase 10 todo):
 *      per-tool typeof/shape of the PostToolUse tool_response INPUT for
 *      Bash / Read / Grep / MCP via postresp-log-hook.sh side files →
 *      recorded to tests/uat/artifacts/contract-findings.json; the
 *      docs/HOOK-CONTRACT.md "Per-tool tool_response shapes" matrix consumes
 *      the re-stamps at the operator's verify-work run.
 *
 * CANARY UNIQUENESS (planner pin): the pinned unit-corpus canary strings
 * appear in this repo's planning docs, which prior GSD sessions have read
 * into transcripts under ~/.claude/projects — a whole-dir grep for those
 * strings would false-fail. This leg therefore MINTS run-unique canaries,
 * restoring the global-uniqueness premise the whole-tree grep needs. The
 * pinned corpus remains authoritative for all deterministic gates.
 *
 * RECORD-DON'T-ASSERT boundary (Pitfall 5 — local CLI 2.1.212 vs the
 * 2.1.209 E1–E5 stamps): upstream contract claims (A2: MCP string-form
 * updatedToolOutput honored) are recorded as findings; a contract-drift
 * verdict is written to the findings artifact BEFORE the v2 probe fails so
 * the red is honest, never mysterious. Canary absence and harness integrity
 * stay HARD-asserted — they are mrclean-owned invariants.
 *
 * OPT-IN ONLY: self-skips unless MRCLEAN_UAT=1 — never wired into CI
 * (settled repo policy: token spend). Operator runs at verify-work:
 *
 *   MRCLEAN_UAT=1 npm run test:uat -t 'wire safety'
 *
 * (~6 Haiku sessions, cents.)
 *
 * Isolation: sandbox --settings / --mcp-config --strict-mcp-config; the
 * HOME prefix rides INSIDE the hook command string ONLY — a whole-process
 * HOME override would kill claude auth/transcripts (Pitfall 4). mrclean
 * state (map + key) lands in the sandbox mrclean-home, removed in afterAll.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

import { buildHookCommand } from '../../src/install/settings.js'
import type { ToolVerdict } from './findings-builder.js'
import { runClaude, assertSessionRan, type ClaudeRun } from './harness.js'

const UAT_ENABLED = process.env.MRCLEAN_UAT === '1'

const REPO_ROOT = process.cwd()
const DIST_CLI = path.resolve(REPO_ROOT, 'dist/cli.js')
const FIXTURES_DIR = path.resolve(REPO_ROOT, 'tests/uat/fixtures')
const ECHO_SERVER = path.join(FIXTURES_DIR, 'echo-mcp-server.mjs')
const POSTRESP_HOOK = path.join(FIXTURES_DIR, 'postresp-log-hook.sh')
const ARTIFACTS_DIR = path.resolve(REPO_ROOT, 'tests/uat/artifacts')
const FINDINGS_PATH = path.join(ARTIFACTS_DIR, 'contract-findings.json')

// ---------------------------------------------------------------------------
// Run-unique canaries (planner pin — minted per run, never the pinned corpus)
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/**
 * Mint the run-unique AWS-shaped canary: 'AKIA' + EXACTLY 16 chars from the
 * base32 alphabet [A-Z2-7], derived deterministically from runToken.
 *
 * DUAL-ENGINE BAIT (load-bearing): [A-Z2-7] is a strict subset of [A-Z0-9],
 * so the minted key trips BOTH shipped detectors — secretlint's aws rule
 * ([A-Z0-9] body, enableIDScanRule on) AND the vendored gitleaks rule
 * (AKIA[A-Z2-7]{16}, entropy >= 3). Any 0/1/8/9 digit would silently drop
 * the gitleaks engine from the live proof.
 *
 * The +2i position spread keeps the 16 chars diverse even for degenerate
 * hex slices (a constant-value runToken still yields 16 distinct chars), so
 * the gitleaks entropy>=3 gate holds; the mint-integrity test below guards
 * the astronomically-unlikely adversarial residue loudly. The tail cannot
 * end in 'EXAMPLE' (the gitleaks rule allowlists '.+EXAMPLE$') — guarded
 * explicitly below as belt-and-braces.
 */
function mintSecretLive(token: string): string {
  let body = ''
  for (let i = 0; i < 16; i++) {
    const hexChar = token[i % token.length] ?? '0'
    const parsed = Number.parseInt(hexChar, 16)
    const value = Number.isNaN(parsed) ? 0 : parsed
    body += BASE32_ALPHABET[(value + 2 * i) % 32] ?? 'A'
  }
  return `AKIA${body}`
}

/** Shannon bits/char (gitleaks' own entropy formula) — inline per repo policy. */
function shannonBitsPerChar(s: string): number {
  const freq = new Map<string, number>()
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1)
  let h = 0
  for (const count of freq.values()) {
    const p = count / s.length
    h -= p * Math.log2(p)
  }
  return h
}

const runToken = randomUUID().slice(0, 8)
const WORD_LIVE = `zz-wire-canary-${runToken}`
const SECRET_LIVE = mintSecretLive(runToken)

// ---------------------------------------------------------------------------
// Pinned shapes — duplicated, not re-derived / not imported
// ---------------------------------------------------------------------------

/**
 * Duplicated from src/hook/handlers/post-tool-use.ts (duplicate, do not
 * re-derive — chaos.test.ts constants discipline). mrclean self-exempts its
 * OWN MCP tools on PostToolUse; a fixture name matching this regex would
 * silently skip substitution and vacuous-pass the entire live leg.
 */
const MRCLEAN_TOOL_RE = /^mcp__(plugin_mrclean_mrclean|mrclean)__mrclean_(check|redact|status)$/
const FIXTURE_TOOL_NAME = 'mcp__wire-canary__echo_project_notes'

/**
 * Duplicated from tests/state/chaos.test.ts — duplicated, not re-derived
 * (the grammar sync-lock test guards drift). Non-global copy for .test()
 * (a /g regex carries lastIndex across calls); separate global copy for
 * whole-transcript token extraction.
 */
const V2_TAIL_PROBE = /<MRCLEAN:[A-Z0-9_]+:(?:\d{3}|OVF):[a-f0-9]{8}>/
const V2_TOKEN_RE_G = /<MRCLEAN:[A-Z0-9_]+:(?:\d{3}|OVF):[a-f0-9]{8}>/g

// ---------------------------------------------------------------------------
// Deterministic guards — run in EVERY mode (no tokens, no claude, no network)
// ---------------------------------------------------------------------------

describe('wire-safety deterministic guards (token-free)', () => {
  test('mint integrity: SECRET_LIVE is AKIA + 16 x [A-Z2-7], entropic, non-EXAMPLE tail', () => {
    expect(SECRET_LIVE).toMatch(/^AKIA[A-Z2-7]{16}$/)
    expect(SECRET_LIVE.endsWith('EXAMPLE')).toBe(false)
    // The vendored gitleaks aws-access-token rule requires entropy >= 3 over
    // the match — a degenerate mint would silently drop the gitleaks engine
    // from the live proof, so fail LOUD here instead (rerun mints fresh).
    expect(shannonBitsPerChar(SECRET_LIVE)).toBeGreaterThan(3)
    expect(WORD_LIVE).toMatch(/^zz-wire-canary-[0-9a-f]{8}$/)
  })

  test('fixture tool name is NOT self-exempted by MRCLEAN_TOOL_RE (vacuous-pass guard)', () => {
    expect(
      MRCLEAN_TOOL_RE.test(FIXTURE_TOOL_NAME),
      `${FIXTURE_TOOL_NAME} matches MRCLEAN_TOOL_RE — mrclean would pass the fixture output through untouched`,
    ).toBe(false)
    // Positive control: the regex DOES match mrclean's own tool names.
    expect(MRCLEAN_TOOL_RE.test('mcp__mrclean__mrclean_check')).toBe(true)
    expect(MRCLEAN_TOOL_RE.test('mcp__plugin_mrclean_mrclean__mrclean_redact')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Visible skip placeholder (operator-facing skip signal)
// ---------------------------------------------------------------------------

describe.skipIf(UAT_ENABLED)('@uat wire safety — SKIPPED (set MRCLEAN_UAT=1; operator-run at verify-work)', () => {
  test('self-skip placeholder: live leg requires MRCLEAN_UAT=1 + authenticated claude CLI', () => {
    expect(UAT_ENABLED).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Live suite
// ---------------------------------------------------------------------------

describe.skipIf(!UAT_ENABLED)('@uat wire safety (REVMODE-11 SC1b)', () => {
  let claudeVersion = 'unknown'
  let sandbox: string
  let projectDir: string
  let sandboxMrcleanHome: string
  let mcpConfigPath: string
  let settingsMainPath: string
  let mcpShapeLog: string

  // Cross-test state (tests in this file run sequentially, in source order —
  // the uat project sets fileParallelism: false and no test is concurrent).
  let run1: ClaudeRun | undefined
  let sid1: string | undefined
  let transcriptPath1: string | null = null
  let restoreSummary:
    | { restored: number; unmatched: number; secretSkipped: number; sessions: number }
    | undefined
  let resumeMethod = 'not-run'
  let run2SessionId: string | null = null
  const surveyVerdicts: Record<string, ToolVerdict> = {}
  let wireRecord: Record<string, unknown> | undefined
  let driftRecorded = false

  // -------------------------------------------------------------------------
  // Helpers (duplicated by value from contract-verification.test.ts per the
  // c-v convention — never cross-imported between suites)
  // -------------------------------------------------------------------------

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10)
  }

  /** Sandbox settings writer — never touches ~/.claude/settings.json. */
  function writeSettings(name: string, hooks: Record<string, unknown>): string {
    const p = path.join(sandbox, name)
    writeFileSync(p, JSON.stringify({ hooks }, null, 2))
    return p
  }

  /** Single string-command hook entry; matcher omitted entirely when undefined. */
  function hookEntry(command: string, matcher?: string): Record<string, unknown> {
    const entry: Record<string, unknown> = { hooks: [{ type: 'command', command, timeout: 30 }] }
    if (matcher !== undefined) entry['matcher'] = matcher
    return entry
  }

  /** Fixture invocation with the side-file env var baked into the command string. */
  function fixtureCmd(scriptPath: string, envVar: string, envValue: string): string {
    return `${envVar}="${envValue}" "${scriptPath}"`
  }

  /** Hook entry wrapping a full command OBJECT (live-session buildHookSettings shape). */
  function rawHookEntry(commandObj: Record<string, unknown>, matcher?: string): Record<string, unknown> {
    const entry: Record<string, unknown> = { hooks: [commandObj] }
    if (matcher !== undefined) entry['matcher'] = matcher
    return entry
  }

  /**
   * mrclean's REAL fail-closed wrapper with the sandbox HOME prefix injected
   * INSIDE the sh -c script (A1):
   *
   *   HOME="<sandboxMrcleanHome>" "$1" "$2" hook || exit 2
   *
   * The prefix rides the hook COMMAND STRING ONLY — runClaude itself receives
   * no HOME override, so `claude` keeps real-HOME auth and transcripts
   * (Pitfall 4). buildHookCommand stays the single source of truth for the
   * wrapper shape; only the sh env-assignment prefix is added here.
   */
  function homePrefixedMrcleanHook(): Record<string, unknown> {
    const base = buildHookCommand(process.execPath, DIST_CLI)
    if (base.command !== '/bin/sh') {
      throw new Error(
        'wire-safety live leg is POSIX-only: HOME-prefix injection requires the /bin/sh fail-closed wrapper (win32 hook is plain-exec)',
      )
    }
    const dashC = base.args[0] ?? '-c'
    const script = base.args[1] ?? ''
    return {
      ...base,
      args: [dashC, `HOME="${sandboxMrcleanHome}" ${script}`, ...base.args.slice(2)],
    }
  }

  interface ContentBlock {
    type?: string
    content?: unknown
    text?: string
    input?: unknown
    name?: string
  }

  function blocksOf(message: { content?: unknown } | undefined): ContentBlock[] {
    const content = message?.content
    return Array.isArray(content) ? (content as ContentBlock[]) : []
  }

  /** Serialized tool_result contents from stream-json user events (model-facing signal). */
  function extractToolResultText(run: ClaudeRun): string {
    const chunks: string[] = []
    for (const e of run.events) {
      if (e.type !== 'user') continue
      for (const block of blocksOf(e.message)) {
        if (block.type === 'tool_result') chunks.push(JSON.stringify(block.content ?? ''))
      }
    }
    return chunks.join('\n')
  }

  /**
   * Locate the session transcript. The cwd-slug format is undocumented, so
   * scan ~/.claude/projects/<any>/<session_id>.jsonl — session IDs are UUIDs.
   */
  function findTranscript(sessionId: string | undefined): string | null {
    if (sessionId === undefined || sessionId === '') return null
    const projectsDir = path.join(homedir(), '.claude', 'projects')
    let dirs: string[] = []
    try {
      dirs = readdirSync(projectsDir)
    } catch {
      return null
    }
    for (const d of dirs) {
      const candidate = path.join(projectsDir, d, `${sessionId}.jsonl`)
      if (existsSync(candidate)) return candidate
    }
    return null
  }

  interface TranscriptToolData {
    found: boolean
    toolResults: string
    toolUseInputs: string
  }

  /** tool_result contents + tool_use inputs from a transcript jsonl. */
  function extractTranscriptToolData(transcriptPath: string | null): TranscriptToolData {
    if (transcriptPath === null) return { found: false, toolResults: '', toolUseInputs: '' }
    const results: string[] = []
    const inputs: string[] = []
    for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      let obj: unknown
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      const message = (obj as { message?: { content?: unknown } }).message
      for (const block of blocksOf(message)) {
        if (block.type === 'tool_result') results.push(JSON.stringify(block.content ?? ''))
        if (block.type === 'tool_use') inputs.push(JSON.stringify(block.input ?? ''))
      }
    }
    return { found: true, toolResults: results.join('\n'), toolUseInputs: inputs.join('\n') }
  }

  /** Replace canary values before anything is recorded to the COMMITTED artifact. */
  function sanitizeForArtifact(textValue: string): string {
    return textValue.split(WORD_LIVE).join('<CANARY_WORD>').split(SECRET_LIVE).join('<CANARY_SECRET>')
  }

  /** Hard absence assertion — the mrclean-owned invariant of this suite. */
  function expectNoCanaries(textValue: string, label: string): void {
    expect(textValue.includes(WORD_LIVE), `${label}: WORD_LIVE canary original found on the wire`).toBe(false)
    expect(textValue.includes(SECRET_LIVE), `${label}: SECRET_LIVE canary original found on the wire`).toBe(false)
  }

  /**
   * Whole-tree grep: EVERY *.jsonl under ~/.claude/projects. Safe and
   * strictly stronger than per-transcript greps ONLY because the canaries
   * are minted run-unique (planner pin — see file header).
   */
  function grepProjectsTreeForCanaries(label: string): void {
    const projectsDir = path.join(homedir(), '.claude', 'projects')
    let names: string[] = []
    try {
      names = readdirSync(projectsDir, { recursive: true, encoding: 'utf8' })
    } catch (error) {
      throw new Error(`harness integrity: cannot walk ${projectsDir} (${String(error)})`)
    }
    const jsonlFiles = names.filter((n) => n.endsWith('.jsonl'))
    expect(
      jsonlFiles.length,
      'harness integrity: zero transcript jsonl files under ~/.claude/projects',
    ).toBeGreaterThan(0)
    const hits: string[] = []
    for (const rel of jsonlFiles) {
      const full = path.join(projectsDir, rel)
      let raw = ''
      try {
        raw = readFileSync(full, 'utf8')
      } catch {
        continue
      }
      if (raw.includes(WORD_LIVE)) hits.push(`${full} [WORD_LIVE]`)
      if (raw.includes(SECRET_LIVE)) hits.push(`${full} [SECRET_LIVE]`)
    }
    expect(hits, `${label}: canary originals found under ~/.claude/projects`).toEqual([])
  }

  // Survey side-file parsing (readLogEntries shape, duplicated by value —
  // the postresp-log-hook.sh field set differs from log-hook.sh's).
  interface ShapeEntry {
    tool_name?: string
    t?: string
    raw?: string
  }

  function readShapeEntries(logPath: string): ShapeEntry[] {
    if (!existsSync(logPath)) return []
    const out: ShapeEntry[] = []
    for (const line of readFileSync(logPath, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      try {
        out.push(JSON.parse(line) as ShapeEntry)
      } catch {
        // tolerate partial writes
      }
    }
    return out
  }

  function summarizeShape(entry: ShapeEntry): string {
    const raw = entry.raw ?? ''
    if (entry.t === 'string') {
      return raw.length === 2000
        ? 'string (raw excerpt truncated at 2000 chars)'
        : `string (raw JSON length ${raw.length})`
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return `array (length ${parsed.length})`
      if (parsed !== null && typeof parsed === 'object') {
        return `object with top-level keys [${Object.keys(parsed).join(', ')}]`
      }
      return typeof parsed
    } catch {
      return `${entry.t ?? 'unknown'} (raw truncated at 2000 chars — excerpt unparseable)`
    }
  }

  /**
   * Record-don't-assert: the ONLY hard assertion on a survey leg is harness
   * integrity (the observer wrote entries). The verdict goes to the findings
   * artifact; excerpt fields are sanitized so run-unique canaries never land
   * in the COMMITTED artifact (T-11-05-01).
   */
  function recordSurveyVerdict(toolName: string, logPath: string): void {
    const entries = readShapeEntries(logPath)
    expect(
      entries.length,
      `harness integrity: postresp-log-hook wrote no entries to ${logPath}`,
    ).toBeGreaterThan(0)
    const entry = entries.find((e) => e.tool_name === toolName) ?? entries[0]
    if (entry === undefined) return
    surveyVerdicts[toolName] = {
      verdict: `typeof tool_response = ${entry.t ?? 'unknown'}; ${summarizeShape(entry)}`,
      signals: {
        typeof_tool_response: entry.t ?? 'unknown',
        shape_summary: summarizeShape(entry),
        raw_excerpt_sanitized: sanitizeForArtifact((entry.raw ?? '').slice(0, 400)),
        entries_observed: entries.length,
        observed_tool_names: [...new Set(entries.map((e) => e.tool_name ?? 'unknown'))],
        cc_version: claudeVersion,
      },
      // Side-file logs live in the mkdtemp sandbox (removed in afterAll) —
      // the durable evidence is the sanitized excerpt above; no dangling paths.
      evidence_paths: [],
    }
  }

  /**
   * Findings writer — mirrors the contract-verification afterAll discipline:
   * a zero-verdict run leaves the artifact untouched; a present-but-
   * unparseable artifact fails LOUD and refuses the write (WR-04 lineage).
   *
   * Deliberate delta from buildFindingsArtifact (documented in the 11-05
   * SUMMARY): the pure builder rebuilds ONLY the E1–E5 experiment keys, so
   * routing these records through it would either corrupt E1 semantics
   * (survey verdicts are tool_response INPUT shapes, not updatedToolOutput
   * verdicts) or drop them at the next rebuild. This writer spread-merges
   * over the previous artifact instead — every committed key (E1–E5 and any
   * other) is preserved VERBATIM; only the two wire-safety keys are
   * added/replaced. NOTE: a later full contract-verification rerun rebuilds
   * via buildFindingsArtifact and drops these keys — re-run this suite
   * afterwards to re-stamp (doc + artifact updated together per the
   * HOOK-CONTRACT re-verification procedure).
   */
  function writeWireFindings(): void {
    const verdictCount = Object.keys(surveyVerdicts).length + (wireRecord !== undefined ? 1 : 0)
    if (verdictCount === 0) {
      console.warn('mrclean wire-safety findings: no verdict recorded — artifact left untouched')
      return
    }

    let previous: Record<string, unknown> = {}
    if (existsSync(FINDINGS_PATH)) {
      let parsed: unknown
      try {
        parsed = JSON.parse(readFileSync(FINDINGS_PATH, 'utf8'))
      } catch (error) {
        console.error(
          `mrclean wire-safety findings: committed artifact at ${FINDINGS_PATH} is unparseable — refusing to overwrite; fix or delete it first (${String(error)})`,
        )
        return
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        console.error(
          `mrclean wire-safety findings: ${FINDINGS_PATH} is not a JSON object — refusing to overwrite`,
        )
        return
      }
      previous = parsed as Record<string, unknown>
    }

    const prevExperimentsRaw = previous['experiments']
    const prevExperiments =
      typeof prevExperimentsRaw === 'object' && prevExperimentsRaw !== null && !Array.isArray(prevExperimentsRaw)
        ? (prevExperimentsRaw as Record<string, unknown>)
        : {}

    const experiments: Record<string, unknown> = { ...prevExperiments }
    if (Object.keys(surveyVerdicts).length > 0) {
      experiments['tool_response_shapes'] = {
        question:
          'Per-tool PostToolUse tool_response INPUT shapes: does the handler Step 3 JSON.stringify coercion scan structured shapes adequately per tool? (re-homed Phase 10 STATE.md todo)',
        method:
          'live headless -p sessions; tests/uat/fixtures/postresp-log-hook.sh parallel observer appends {tool_name, typeof tool_response, truncated raw JSON} per PostToolUse event; record-dont-assert',
        claude_version: claudeVersion,
        date: todayIso(),
        verdict: Object.entries(surveyVerdicts)
          .map(([toolName, v]) => `${toolName}: ${v.verdict}`)
          .join('; '),
        tools: surveyVerdicts,
        generated_by: 'tests/uat/wire-safety.test.ts (MRCLEAN_UAT=1 opt-in, record-dont-assert)',
      }
    }
    if (wireRecord !== undefined) {
      experiments['wire_safety'] = wireRecord
    }

    mkdirSync(ARTIFACTS_DIR, { recursive: true })
    writeFileSync(FINDINGS_PATH, `${JSON.stringify({ ...previous, experiments }, null, 2)}\n`)
    console.log(`wire-safety findings written: ${FINDINGS_PATH}`)
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  beforeAll(() => {
    // Preflight: authenticated claude CLI must exist. Fail LOUD, never skip —
    // the operator explicitly opted in with MRCLEAN_UAT=1.
    const version = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 30_000 })
    if (version.status !== 0) {
      throw new Error(
        `'claude --version' failed (status ${String(version.status)}) — install/authenticate the Claude Code CLI before running test:uat`,
      )
    }
    claudeVersion = (version.stdout ?? '').trim()

    // Fresh build unless the operator opts out (mirrors the sibling suites).
    if (process.env.SKIP_BUILD !== '1') {
      const build = spawnSync('npm', ['run', 'build'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 120_000,
      })
      if (build.status !== 0) {
        throw new Error(`npm run build failed:\n${build.stderr}`)
      }
    }

    sandbox = mkdtempSync(path.join(tmpdir(), 'mrclean-wire-'))
    projectDir = path.join(sandbox, 'project')
    sandboxMrcleanHome = path.join(sandbox, 'mrclean-home')
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(sandboxMrcleanHome, { recursive: true })
    mcpShapeLog = path.join(sandbox, 'shape-mcp.jsonl')

    // Sandbox project config: reversible ON (read from the project layer);
    // WORD_LIVE in the project words file with |warn so UserPromptSubmit can
    // never block (Pitfall 3 — the word|action grammar of layer4-words).
    const mrcleanDir = path.join(projectDir, '.mrclean')
    mkdirSync(mrcleanDir, { recursive: true })
    writeFileSync(path.join(mrcleanDir, 'config.toml'), '[reversible]\nenabled = true\n')
    writeFileSync(path.join(mrcleanDir, 'words.txt'), `${WORD_LIVE}|warn\n`)

    // Canary-free substrate for the Read/Grep survey legs.
    writeFileSync(
      path.join(projectDir, 'notes.txt'),
      'survey-ok: plain fixture notes for the Read/Grep shape legs\n',
    )

    // MCP config: the foreign-named fixture stdio server. Canaries are
    // env-fed HERE — never in any prompt (Pitfall 3).
    mcpConfigPath = path.join(sandbox, 'mcp.json')
    writeFileSync(
      mcpConfigPath,
      JSON.stringify(
        {
          mcpServers: {
            'wire-canary': {
              type: 'stdio',
              command: process.execPath,
              args: [ECHO_SERVER],
              env: { CANARY_TEXT: `project notes: path ${WORD_LIVE} key ${SECRET_LIVE}` },
            },
          },
        },
        null,
        2,
      ),
    )

    // Run-1/run-2 settings: mrclean's REAL hook (HOME-prefixed command) plus
    // the shape observer riding the same event (A5 — parallel hooks each
    // receive the payload; the observer sees the raw pre-substitution shape).
    settingsMainPath = writeSettings('settings-wire-main.json', {
      PostToolUse: [
        rawHookEntry(homePrefixedMrcleanHook()),
        hookEntry(fixtureCmd(POSTRESP_HOOK, 'E_LOG', mcpShapeLog)),
      ],
    })
  }, 240_000)

  afterAll(() => {
    try {
      writeWireFindings()
    } finally {
      // Removes the sandbox mrclean-home (session map + key) with the whole
      // sandbox. Transcript residue under ~/.claude/projects is the standing
      // UAT behavior and IS the assertion surface of this suite (Pitfall 4).
      if (sandbox) rmSync(sandbox, { recursive: true, force: true })
    }
  })

  // -------------------------------------------------------------------------
  // SC1b chain — source order IS execution order (sequential file)
  // -------------------------------------------------------------------------

  test('run 1: canaries ride the fixture MCP tool through mrclean\'s REAL hook', { timeout: 300_000 }, () => {
    const run = runClaude(
      `Call the MCP tool named ${FIXTURE_TOOL_NAME} (from the connected wire-canary MCP server) and quote back, verbatim, exactly what the tool returned to you. Call the tool directly yourself — do not delegate to a subagent.`,
      settingsMainPath,
      {
        cwd: projectDir,
        mcpConfigPath,
        extraArgs: ['--allowedTools', FIXTURE_TOOL_NAME, '--disallowedTools', 'Task'],
        // Eager MCP tool discovery — deferred ToolSearch burns turns before
        // the call lands (2.1.209 harness-integrity fix from the E1/MCP leg).
        env: { ENABLE_TOOL_SEARCH: 'false' },
        maxTurns: 6,
        timeoutMs: 220_000,
      },
    )
    assertSessionRan(run)
    const servers = run.init?.mcp_servers ?? []
    const wireCanary = servers.find((s) => s.name === 'wire-canary')
    expect(
      wireCanary?.status,
      `harness integrity: wire-canary MCP server not connected: ${JSON.stringify(servers)}`,
    ).toBe('connected')

    run1 = run
    sid1 = run.init?.session_id
    if (sid1 === undefined || sid1 === '') {
      throw new Error('BLOCKER (harness integrity): run 1 produced no session_id on the init event')
    }
    transcriptPath1 = findTranscript(sid1)
  })

  test('non-vacuity chain (ordered BEFORE all absence asserts): v2 on the wire -> sandbox map exists -> restore restores locally', { timeout: 120_000 }, () => {
    const firstRun = run1
    const sid = sid1
    if (firstRun === undefined || sid === undefined) {
      throw new Error('run 1 did not complete — see the prior failure')
    }

    // (1) v2-token probe: reversible substitution actually shipped on the wire.
    const streamToolResults = extractToolResultText(firstRun)
    const t1 = extractTranscriptToolData(transcriptPath1)
    const wireText = `${streamToolResults}\n${t1.toolResults}`
    const v2Shipped = V2_TAIL_PROBE.test(wireText)
    if (!v2Shipped) {
      // Record-don't-assert applies to the UPSTREAM claim (A2: MCP string-form
      // updatedToolOutput honored, stamped on 2.1.209): write the drift
      // verdict BEFORE the hard failure below so the red is honest, never
      // mysterious. Canary absence stays hard-asserted as mrclean-owned.
      wireRecord = {
        question:
          'A2 drift probe: is MCP string-form updatedToolOutput still honored (2.1.209 E1/MCP stamp)?',
        method:
          'live wire-safety run 1 (fixture MCP echo + real HOME-prefixed mrclean hook); v2-token probe over stream/transcript tool_result',
        claude_version: claudeVersion,
        date: todayIso(),
        verdict: `CONTRACT DRIFT: no v2 placeholder token observed in run-1 tool_result on ${claudeVersion} — the 2.1.209 E1/MCP 'honored' verdict did not reproduce; the live substitution carrier is gone (see docs/HOOK-CONTRACT.md E1)`,
        signals: {
          stream_tool_result_excerpt: sanitizeForArtifact(streamToolResults.slice(0, 400)),
          transcript_found: t1.found,
        },
        evidence_paths: transcriptPath1 !== null ? [transcriptPath1] : [],
      }
      driftRecorded = true
    }
    expect(
      v2Shipped,
      'non-vacuity (1): no v2 placeholder token in run-1 tool_result — reversible substitution did NOT ship on the wire (contract-drift verdict recorded to contract-findings.json)',
    ).toBe(true)

    // (2) sandbox map probe (A1): the HOME prefix isolated mrclean state —
    // the reversible store persisted under the sandbox home, not the real one.
    const mapPath = path.join(sandboxMrcleanHome, '.mrclean', 'sessions', `${sid}.map`)
    expect(
      existsSync(mapPath),
      `non-vacuity (2): sandbox session map missing at ${mapPath} — the HOME prefix did not isolate mrclean state (A1)`,
    ).toBe(true)

    // (3) restore leg: the operator-local round trip. Input doc = the v2
    // tokens extracted from the run-1 transcript.
    const tp = transcriptPath1
    expect(tp, 'harness integrity: run-1 transcript not found under ~/.claude/projects').not.toBeNull()
    const transcriptRaw = tp !== null ? readFileSync(tp, 'utf8') : ''
    const tokens = [...new Set(transcriptRaw.match(V2_TOKEN_RE_G) ?? [])]
    const wordTokens = tokens.filter((tok) => tok.includes(':WORD:'))
    const secretTokens = tokens.filter((tok) => !tok.includes(':WORD:'))
    expect(wordTokens.length, 'non-vacuity (3): no WORD-class v2 token in the run-1 transcript').toBeGreaterThanOrEqual(1)
    expect(secretTokens.length, 'non-vacuity (3): no secret-class v2 token in the run-1 transcript').toBeGreaterThanOrEqual(1)

    const doc = `wire-safety restore probe\n${tokens.join('\n')}\n`
    const restore = spawnSync(process.execPath, [DIST_CLI, 'restore'], {
      input: doc,
      encoding: 'utf8',
      timeout: 30_000,
      cwd: projectDir,
      // Sandbox HOME for the SPAWNED restore process only — the exact mirror
      // of the hook command prefix (Pitfall 4).
      env: { ...process.env, HOME: sandboxMrcleanHome, USERPROFILE: sandboxMrcleanHome },
    })
    expect(restore.status, `restore leg exited ${String(restore.status)}:\n${restore.stderr}`).toBe(0)
    expect(
      restore.stdout.includes(WORD_LIVE),
      'non-vacuity (3): restore stdout does not carry the WORD original',
    ).toBe(true)

    const summaryMatch = /restored=(\d+) unmatched=(\d+) secret-skipped=(\d+) sessions=(\d+)/.exec(
      restore.stderr,
    )
    if (summaryMatch === null) {
      throw new Error(`restore summary line missing from stderr:\n${restore.stderr}`)
    }
    const restored = Number(summaryMatch[1] ?? '0')
    expect(restored, 'non-vacuity (3): restore summary reports restored=0').toBeGreaterThanOrEqual(1)

    // Secret floor: the secret-class placeholder byte-survives unrestored;
    // the secret original NEVER appears (write-time floor — it was never in
    // the map at all).
    for (const tok of secretTokens) {
      expect(restore.stdout.includes(tok), `secret-class token ${tok} did not byte-survive restore`).toBe(true)
    }
    expect(restore.stdout.includes(SECRET_LIVE), 'secret original appeared on restore stdout').toBe(false)

    restoreSummary = {
      restored,
      unmatched: Number(summaryMatch[2] ?? '0'),
      secretSkipped: Number(summaryMatch[3] ?? '0'),
      sessions: Number(summaryMatch[4] ?? '0'),
    }
  })

  test('absence (hard, mrclean-owned): canaries never on the wire — stream, transcript, whole ~/.claude/projects tree', { timeout: 120_000 }, () => {
    const firstRun = run1
    if (firstRun === undefined) {
      throw new Error('run 1 did not complete — see the prior failure')
    }

    // Stream-json: the full model-facing event stream of run 1.
    expectNoCanaries(firstRun.rawStdout, 'run-1 stream-json')

    // The run-1 transcript: raw bytes + the extracted tool surfaces.
    const tp = transcriptPath1
    expect(tp, 'harness integrity: run-1 transcript not found under ~/.claude/projects').not.toBeNull()
    if (tp !== null) {
      expectNoCanaries(readFileSync(tp, 'utf8'), 'run-1 transcript (raw)')
      const t1 = extractTranscriptToolData(tp)
      expectNoCanaries(`${t1.toolResults}\n${t1.toolUseInputs}`, 'run-1 transcript (tool surfaces)')
    }

    // The whole ~/.claude/projects tree (strictly stronger — run-unique mint).
    grepProjectsTreeForCanaries('post-run-1')
  })

  test('run 2 (restore-then-resume): the local restore never re-enters the wire', { timeout: 600_000 }, () => {
    const sid = sid1
    if (sid === undefined) {
      throw new Error('run 1 did not complete — see the prior failure')
    }

    const followUp = 'Summarize, in one sentence, the tool result you saw earlier in this conversation.'
    resumeMethod = 'claude -p --resume <sid1>'
    let run2 = runClaude(followUp, settingsMainPath, {
      cwd: projectDir,
      mcpConfigPath,
      extraArgs: ['--resume', sid, '--disallowedTools', 'Task'],
      env: { ENABLE_TOOL_SEARCH: 'false' },
      maxTurns: 6,
      timeoutMs: 220_000,
    })
    if (run2.resultEvent === undefined) {
      // E3 fallback (A3): --resume can misbehave in print mode. The survey
      // legs run AFTER this test, so run 1 is still the most recent session
      // in this sandbox cwd — --continue targets it.
      resumeMethod = 'claude -p --continue (FALLBACK: --resume produced no result event)'
      run2 = runClaude(followUp, settingsMainPath, {
        cwd: projectDir,
        mcpConfigPath,
        extraArgs: ['--continue', '--disallowedTools', 'Task'],
        env: { ENABLE_TOOL_SEARCH: 'false' },
        maxTurns: 6,
        timeoutMs: 220_000,
      })
    }
    assertSessionRan(run2)
    run2SessionId = run2.init?.session_id ?? null

    // Re-entry ratchet proof: BOTH absence greps re-run after the local
    // restore. Restore is store-byte-inert (10-08) — zero hits here proves
    // the restored originals stayed operator-local.
    expectNoCanaries(run2.rawStdout, 'run-2 stream-json')
    grepProjectsTreeForCanaries('post-restore-resume')

    // Assemble the SC1b findings record — only when the full non-vacuity
    // chain completed (a drift verdict from the v2 probe is never overwritten).
    if (!driftRecorded && restoreSummary !== undefined) {
      wireRecord = {
        question:
          'SC1b: do canary originals ever reach the wire, and does a local restore re-enter it after --resume?',
        method: `live wire-safety legs: fixture MCP echo (env-fed run-unique canaries) + real HOME-prefixed mrclean hook; non-vacuity chain (v2 probe -> sandbox map -> restore restored>=1) before absence greps (stream / transcript / whole ~/.claude/projects tree); ${resumeMethod} re-entry proof`,
        claude_version: claudeVersion,
        date: todayIso(),
        verdict:
          'PASS: zero canary originals on the wire across run 1 and the post-restore resume; reversible substitution + operator-local restore round trip proven non-vacuously',
        signals: {
          resume_method: resumeMethod,
          restore_summary: restoreSummary,
          word_canary_shape: 'zz-wire-canary-<runToken8> (run-unique mint)',
          secret_canary_shape: 'AKIA + 16 x [A-Z2-7] (dual-engine bait), non-EXAMPLE tail (run-unique mint)',
          run1_session_id: sid,
          run2_session_id: run2SessionId,
        },
        evidence_paths: transcriptPath1 !== null ? [transcriptPath1] : [],
      }
    }
  })

  // -------------------------------------------------------------------------
  // tool_response shape survey (record-don't-assert; re-homed STATE.md todo).
  // Cheap legs run with ONLY the observer registered — shapes don't need
  // mrclean in the loop (A5 fallback). The MCP shape rides run 1's log.
  // -------------------------------------------------------------------------

  test('survey/Bash: tool_response shape (record-don\'t-assert)', { timeout: 240_000 }, () => {
    const logPath = path.join(sandbox, 'shape-bash.jsonl')
    const settings = writeSettings('settings-shape-bash.json', {
      PostToolUse: [hookEntry(fixtureCmd(POSTRESP_HOOK, 'E_LOG', logPath))],
    })
    const run = runClaude(
      'Run the bash command `echo survey-ok` and reply with the exact output.',
      settings,
      { cwd: projectDir, extraArgs: ['--allowedTools', 'Bash', '--disallowedTools', 'Task'] },
    )
    assertSessionRan(run)
    recordSurveyVerdict('Bash', logPath)
  })

  test('survey/Read: tool_response shape (record-don\'t-assert)', { timeout: 240_000 }, () => {
    const logPath = path.join(sandbox, 'shape-read.jsonl')
    const settings = writeSettings('settings-shape-read.json', {
      PostToolUse: [hookEntry(fixtureCmd(POSTRESP_HOOK, 'E_LOG', logPath))],
    })
    const run = runClaude(
      `Read the file ${path.join(projectDir, 'notes.txt')} and quote back its contents.`,
      settings,
      { cwd: projectDir, extraArgs: ['--allowedTools', 'Read', '--disallowedTools', 'Task'] },
    )
    assertSessionRan(run)
    recordSurveyVerdict('Read', logPath)
  })

  test('survey/Grep: tool_response shape (record-don\'t-assert)', { timeout: 240_000 }, () => {
    const logPath = path.join(sandbox, 'shape-grep.jsonl')
    const settings = writeSettings('settings-shape-grep.json', {
      PostToolUse: [hookEntry(fixtureCmd(POSTRESP_HOOK, 'E_LOG', logPath))],
    })
    const run = runClaude(
      'Use the Grep tool to search this project for the string survey-ok and report which file contains it.',
      settings,
      { cwd: projectDir, extraArgs: ['--allowedTools', 'Grep', '--disallowedTools', 'Task'] },
    )
    assertSessionRan(run)
    recordSurveyVerdict('Grep', logPath)
  })

  test('survey/MCP: tool_response shape from the run-1 observer log (record-don\'t-assert)', () => {
    if (run1 === undefined) {
      throw new Error('run 1 did not complete — see the prior failure')
    }
    recordSurveyVerdict(FIXTURE_TOOL_NAME, mcpShapeLog)
  })
})
