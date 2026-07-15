/**
 * Contract-verification UAT — E1–E5 live experiments (Plan 08-04, REVMODE-10).
 *
 * Settles the four LOW-confidence hook-contract questions empirically in live
 * headless sessions, plus the SessionEnd firing/reason bonus check:
 *
 *   E1 — is `updatedToolOutput` honored, per tool (Bash / Read / MCP)? Which
 *        surfaces show the rewrite (model quote, transcript, stream-json)?
 *        (Hypothesis: STRING form rejected by per-tool shape validation —
 *        #68951 reports the string form.) Object-shape legs: E1/Bash-object
 *        probes the {stdout, stderr, interrupted, isImage} payload 2.1.209
 *        honors for Bash; E1/Read-object probes the same payload on a Read
 *        matcher (closes the read_object_shape follow-up). Together they
 *        assemble the E1_shape_validation record.
 *   E2 — does PreToolUse `updatedInput` echo into the transcript / model
 *        context, or is the original command preserved?
 *   E3 — is `session_id` continuous across `--resume` (hook-payload proof),
 *        with a `--fork-session` control expecting a NEW id?
 *   E4 — does the documented 10K-char hook-output cap bind `updatedToolOutput`
 *        (unlisted in docs)? Gated on the object-shape leg: when Bash-object
 *        is honored, the run uses a >10K OBJECT-shaped payload
 *        (e4-object-large-output-hook.sh); legacy string-form gating is the
 *        fallback. Control: >10K `additionalContext` (documented capped).
 *   E5 — does SessionEnd fire in headless -p mode, with which reason? Plus the
 *        SC3 live observable: mrclean's REAL hook on SessionStart (widened
 *        matcher) + SessionEnd produces zero exit-2/hook-error stderr noise.
 *
 * RECORD-DON'T-ASSERT (RESEARCH Pattern 2): contract verdicts are RECORDED to
 * tests/uat/artifacts/contract-findings.json — never hard-asserted. A "failing"
 * contract answer (e.g. updatedToolOutput ignored) is a FINDING, not a test
 * failure. Only harness integrity is hard-asserted (session ran, fixture hook
 * fired, side file written, no mrclean hook noise). The harness is rerunnable
 * on Claude Code upgrades and reports drift instead of breaking CI. Filtered
 * reruns (e.g. `vitest -t 'E4'`): legs gated on module state set by the
 * E1/Bash-object leg record NOTHING when that gate leg did not run in this
 * process — builder carry-forward preserves the committed evidence (WR-01).
 *
 * OPT-IN ONLY: self-skips unless MRCLEAN_UAT=1 (authenticated `claude` binary
 * required; ~10–20 Haiku calls, cents). Never wired into CI.
 *
 * Isolation: every settings JSON lives in a mkdtemp sandbox and is passed via
 * --settings; MCP via --mcp-config + --strict-mcp-config. The operator's
 * ~/.claude/settings.json and ~/.claude.json are NEVER touched.
 *
 * Marker strings only — never real secret shapes (leak-grep discipline).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

import { buildHookCommand } from '../../src/install/settings.js'
import { buildFindingsArtifact, type ExperimentRecord, type ToolVerdict } from './findings-builder.js'
import { runClaude, assertSessionRan, type ClaudeRun } from './harness.js'

const UAT_ENABLED = process.env.MRCLEAN_UAT === '1'

const REPO_ROOT = process.cwd()
const DIST_CLI = path.resolve(REPO_ROOT, 'dist/cli.js')
const DIST_MCP = path.resolve(REPO_ROOT, 'dist/mcp.js')
const FIXTURES_DIR = path.resolve(REPO_ROOT, 'tests/uat/fixtures')
const ARTIFACTS_DIR = path.resolve(REPO_ROOT, 'tests/uat/artifacts')
const FINDINGS_PATH = path.join(ARTIFACTS_DIR, 'contract-findings.json')

const E1_HOOK = path.join(FIXTURES_DIR, 'e1-rewrite-hook.sh')
const E1_OBJECT_HOOK = path.join(FIXTURES_DIR, 'e1-object-rewrite-hook.sh')
const E2_HOOK = path.join(FIXTURES_DIR, 'e2-updated-input-hook.sh')
const E4_HOOK = path.join(FIXTURES_DIR, 'e4-large-output-hook.sh')
const E4_OBJECT_HOOK = path.join(FIXTURES_DIR, 'e4-object-large-output-hook.sh')
const LOG_HOOK = path.join(FIXTURES_DIR, 'log-hook.sh')

/** Markers (MUST match the fixture scripts — never real secret shapes). */
const E1_ORIGINAL = 'ORIGINAL_E1_MARKER_q7v4'
const E1_REWRITTEN = 'REWRITTEN_E1_MARKER_x9k2'
const E2_ORIG = 'INPUT_ORIG_MARKER_e2'
const E2_UPDATED = 'INPUT_UPDATED_MARKER_e2'
const E4_HEAD = 'E4_HEAD_MARKER'
const E4_TAIL = 'E4_TAIL_MARKER'
const E4C_HEAD = 'E4C_HEAD_MARKER'
const E4C_TAIL = 'E4C_TAIL_MARKER'

// ---------------------------------------------------------------------------
// Findings state (module-level; assembled via buildFindingsArtifact in
// afterAll — the pure builder owns the guard + carry-forward + merge logic)
// ---------------------------------------------------------------------------

let claudeVersion = 'unknown'
let issue68951State = 'not-checked'
const e1Tools: Record<string, ToolVerdict> = {}
let e1ObjectBash: ToolVerdict | undefined
/** Stashed by E1/Bash so the object leg can scan the string-leg transcript for the shape-rejection error. */
let e1BashTranscriptPath: string | null = null
let bashObjectSessionId: string | undefined
let stringShapeHookError: string | undefined
let shapeValidationRecord: Record<string, unknown> | undefined
let e2Record: ExperimentRecord | undefined
let e3Record: ExperimentRecord | undefined
let e4Record: ExperimentRecord | undefined
let e4ControlRecord: ExperimentRecord | undefined
let e5HeadlessRecord: ExperimentRecord | undefined
let e5NoiseRecord: ExperimentRecord | undefined

let sandbox: string
let projectDir: string
let mcpConfigPath: string

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function baseRecord(question: string, method: string): Pick<ExperimentRecord, 'question' | 'method' | 'claude_version' | 'date'> {
  return { question, method, claude_version: claudeVersion, date: todayIso() }
}

/** Sandbox settings writer — never touches ~/.claude/settings.json. */
function writeSettings(name: string, hooks: Record<string, unknown>): string {
  const p = path.join(sandbox, name)
  writeFileSync(p, JSON.stringify({ hooks }, null, 2))
  return p
}

/** Single hook entry; matcher omitted entirely when undefined (SessionEnd/UserPromptSubmit shape). */
function hookEntry(command: string, matcher?: string): Record<string, unknown> {
  const entry: Record<string, unknown> = { hooks: [{ type: 'command', command, timeout: 30 }] }
  if (matcher !== undefined) entry['matcher'] = matcher
  return entry
}

/** Fixture invocation with a side-file env var baked into the command (no env passthrough dependence). */
function fixtureCmd(scriptPath: string, envVar: string, envValue: string): string {
  return `${envVar}="${envValue}" "${scriptPath}"`
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

/** Serialized tool_result contents from stream-json user events (the model-facing signal). */
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

/** Serialized tool_use inputs from stream-json assistant events (what the model requested). */
function extractToolUseInputs(run: ClaudeRun): string {
  const chunks: string[] = []
  for (const e of run.events) {
    if (e.type !== 'assistant') continue
    for (const block of blocksOf(e.message)) {
      if (block.type === 'tool_use') chunks.push(JSON.stringify(block.input ?? ''))
    }
  }
  return chunks.join('\n')
}

/**
 * Locate the session transcript. The cwd-slug format is undocumented, so scan
 * ~/.claude/projects/<any>/<session_id>.jsonl — session IDs are UUIDs (unique).
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

/** tool_result contents + tool_use inputs from a transcript jsonl (the persisted, re-shipped view). */
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

interface LogEntry {
  e?: string
  sid?: string
  src?: string | null
}

function readLogEntries(logPath: string): LogEntry[] {
  if (!existsSync(logPath)) return []
  const out: LogEntry[] = []
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      out.push(JSON.parse(line) as LogEntry)
    } catch {
      // tolerate partial writes
    }
  }
  return out
}

/**
 * E1 verdict from the three signals. `originalDetectable` is false for tools
 * whose un-rewritten output does not echo the input marker (mrclean_check
 * returns findings JSON, not the scanned text).
 */
function buildE1Verdict(run: ClaudeRun, originalDetectable: boolean): ToolVerdict {
  const sid = run.init?.session_id
  const transcriptPath = findTranscript(sid)
  const t = extractTranscriptToolData(transcriptPath)
  const streamResults = extractToolResultText(run)

  const rewrittenSeen = streamResults.includes(E1_REWRITTEN) || t.toolResults.includes(E1_REWRITTEN)
  const originalSeen = streamResults.includes(E1_ORIGINAL) || t.toolResults.includes(E1_ORIGINAL)

  const signals: Record<string, unknown> = {
    model_reply_excerpt: run.resultText.slice(0, 500),
    model_reply_contains_rewritten: run.resultText.includes(E1_REWRITTEN),
    model_reply_contains_original: run.resultText.includes(E1_ORIGINAL),
    stream_tool_result_contains_rewritten: streamResults.includes(E1_REWRITTEN),
    stream_tool_result_contains_original: streamResults.includes(E1_ORIGINAL),
    stream_tool_result_excerpt: streamResults.slice(0, 400),
    transcript_found: t.found,
    transcript_tool_result_contains_rewritten: t.toolResults.includes(E1_REWRITTEN),
    transcript_tool_result_contains_original: t.toolResults.includes(E1_ORIGINAL),
  }

  let verdict: string
  if (rewrittenSeen && !originalSeen) verdict = 'honored'
  else if (rewrittenSeen && originalSeen) verdict = 'partially-honored (both markers observed — inspect evidence)'
  else if (originalSeen) verdict = 'ignored (original output reached the model unchanged)'
  else if (!originalDetectable && streamResults.length > 0)
    verdict = 'ignored (rewrite marker absent from tool_result; un-rewritten tool output observed)'
  else verdict = 'indeterminate (neither marker observed in tool_result)'

  return { verdict, signals, evidence_paths: transcriptPath !== null ? [transcriptPath] : [] }
}

/**
 * Regex-scan a transcript's raw text for the updatedToolOutput shape-rejection
 * hook error (zod: "does not match" / "invalid_type"). Returns a trimmed
 * excerpt (<= 600 chars) starting at the match, or undefined when absent.
 */
function scanHookErrorExcerpt(transcriptPath: string | null): string | undefined {
  if (transcriptPath === null || !existsSync(transcriptPath)) return undefined
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return undefined
  }
  const match = /updatedToolOutput[\s\S]{0,500}?(?:does not match|invalid_type)/.exec(raw)
  if (match === null) return undefined
  return raw.slice(match.index, match.index + 600).trim()
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!UAT_ENABLED)('@uat contract verification (E1–E5, REVMODE-10)', () => {
  beforeAll(() => {
    // Preflight: authenticated claude CLI must exist. Fail loudly, never skip.
    const version = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 30_000 })
    if (version.status !== 0) {
      throw new Error(
        `'claude --version' failed (status ${version.status}) — install/authenticate the Claude Code CLI before running test:uat`,
      )
    }
    claudeVersion = (version.stdout ?? '').trim()

    // Validity-window check (RESEARCH §Metadata): record #68951 state alongside
    // the findings. Best-effort — the harness stays rerunnable without gh.
    const gh = spawnSync(
      'gh',
      ['issue', 'view', '68951', '--repo', 'anthropics/claude-code', '--json', 'state,title'],
      { encoding: 'utf8', timeout: 30_000 },
    )
    issue68951State = gh.status === 0 ? (gh.stdout ?? '').trim() : `unavailable (gh exit ${String(gh.status)})`

    // Fresh build unless the operator opts out (mirrors live-session suite).
    if (process.env.SKIP_BUILD !== '1') {
      const build = spawnSync('npm', ['run', 'build'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120_000 })
      if (build.status !== 0) {
        throw new Error(`npm run build failed:\n${build.stderr}`)
      }
    }

    sandbox = mkdtempSync(path.join(tmpdir(), 'mrclean-contract-'))
    projectDir = path.join(sandbox, 'project')
    mkdirSync(projectDir, { recursive: true })

    // E1/Read substrate: a file whose contents ARE the original marker.
    writeFileSync(path.join(projectDir, 'e1-read-marker.txt'), `${E1_ORIGINAL}\n`)
    // E4/Read substrate: >10K of content in case Read is the honored tool.
    const bigLines = Array.from({ length: 3000 }, (_, i) => `line-${String(i + 1)}`).join('\n')
    writeFileSync(path.join(projectDir, 'e4-large.txt'), `${bigLines}\n`)

    // MCP config for the E1 MCP-tool matrix entry (mrclean's own dist server;
    // the FIXTURE hook does the rewriting, so MRCLEAN_TOOL_RE self-exemption
    // does not apply to the instrument).
    mcpConfigPath = path.join(sandbox, 'mcp.json')
    writeFileSync(
      mcpConfigPath,
      JSON.stringify(
        { mcpServers: { mrclean: { type: 'stdio', command: process.execPath, args: [DIST_MCP] } } },
        null,
        2,
      ),
    )
  }, 240_000)

  afterAll(() => {
    try {
      // Findings writer — the durable output (docs-wave input). All assembly
      // lives in the pure, unit-tested buildFindingsArtifact (WR-01): guard
      // (null on zero verdicts), carry-forward of run-absent experiments, and
      // the E1_shape_validation verbatim_hook_error field fallback.
      let previous: unknown
      try {
        if (existsSync(FINDINGS_PATH)) previous = JSON.parse(readFileSync(FINDINGS_PATH, 'utf8'))
      } catch {
        previous = undefined // malformed committed artifact → treat as absent
      }

      const findings = buildFindingsArtifact(previous, {
        claudeVersion,
        date: todayIso(),
        issue68951State,
        e1Tools,
        shapeValidation: shapeValidationRecord,
        e2: e2Record,
        e3: e3Record,
        e4: e4Record,
        e4Control: e4ControlRecord,
        e5Headless: e5HeadlessRecord,
        e5Noise: e5NoiseRecord,
      })

      if (findings === null) {
        console.warn('mrclean findings: no experiment recorded a verdict — artifact left untouched')
        return
      }

      mkdirSync(ARTIFACTS_DIR, { recursive: true })
      writeFileSync(FINDINGS_PATH, `${JSON.stringify(findings, null, 2)}\n`)

      // Human-readable summary for the operator's terminal.
      const experiments = findings['experiments'] as Record<string, { verdict?: unknown }>
      console.table(
        ['E1', 'E2', 'E3', 'E4', 'E5'].map((experiment) => ({
          experiment,
          verdict: String(experiments[experiment]?.verdict ?? 'not-recorded'),
        })),
      )
      console.log(`contract findings written: ${FINDINGS_PATH}`)
    } finally {
      if (sandbox) rmSync(sandbox, { recursive: true, force: true })
    }
  })

  // -------------------------------------------------------------------------
  // E1 — updatedToolOutput honored, per tool?
  // -------------------------------------------------------------------------

  test('E1/Bash: updatedToolOutput for built-in Bash (hypothesis: ignored, #68951)', () => {
    const hookLog = path.join(sandbox, 'e1-bash-hook.log')
    const settings = writeSettings('settings-e1-bash.json', {
      PostToolUse: [hookEntry(fixtureCmd(E1_HOOK, 'HOOK_LOG', hookLog), 'Bash')],
    })

    const run = runClaude(
      `Run the bash command \`echo ${E1_ORIGINAL}\` and then repeat back, verbatim, the exact output the tool returned to you.`,
      settings,
      { cwd: projectDir, extraArgs: ['--allowedTools', 'Bash'] },
    )

    // Harness integrity (hard): session ran, fixture hook actually fired.
    assertSessionRan(run)
    expect(existsSync(hookLog), 'harness integrity: e1-rewrite-hook never fired for Bash (no HOOK_LOG side file)').toBe(true)

    // Contract verdict (recorded, never asserted).
    e1Tools['Bash'] = buildE1Verdict(run, true)
    // Stash the string-leg transcript for the object leg's rejection-evidence scan.
    e1BashTranscriptPath = findTranscript(run.init?.session_id)
  }, 240_000)

  test('E1/Bash-object: OBJECT-shaped updatedToolOutput for built-in Bash (the shape 2.1.209 honors)', () => {
    const hookLog = path.join(sandbox, 'e1-bash-object-hook.log')
    const settings = writeSettings('settings-e1-bash-object.json', {
      PostToolUse: [hookEntry(fixtureCmd(E1_OBJECT_HOOK, 'HOOK_LOG', hookLog), 'Bash')],
    })

    const run = runClaude(
      `Run the bash command \`echo ${E1_ORIGINAL}\` and then repeat back, verbatim, the exact output the tool returned to you.`,
      settings,
      { cwd: projectDir, extraArgs: ['--allowedTools', 'Bash'] },
    )

    // Harness integrity (hard): session ran, fixture hook actually fired.
    assertSessionRan(run)
    expect(existsSync(hookLog), 'harness integrity: e1-object-rewrite-hook never fired for Bash (no HOOK_LOG side file)').toBe(true)

    // Contract verdict (recorded, never asserted) — the E1_shape_validation
    // object-probe leg, and the gate E4 checks first.
    e1ObjectBash = buildE1Verdict(run, true)
    bashObjectSessionId = run.init?.session_id

    // String-leg rejection evidence: the E1/Bash (string form) transcript
    // carries the shape-rejection hook error when validation rejected it.
    stringShapeHookError = scanHookErrorExcerpt(e1BashTranscriptPath)
  }, 240_000)

  test('E1/Read-object: Bash-style OBJECT payload on a Read matcher (probe — closes the read_object_shape follow-up)', () => {
    const hookLog = path.join(sandbox, 'e1-read-object-hook.log')
    const settings = writeSettings('settings-e1-read-object.json', {
      PostToolUse: [hookEntry(fixtureCmd(E1_OBJECT_HOOK, 'HOOK_LOG', hookLog), 'Read')],
    })

    const run = runClaude(
      `Read the file ${path.join(projectDir, 'e1-read-marker.txt')} and quote back, verbatim, the exact contents the tool returned to you.`,
      settings,
      { cwd: projectDir, extraArgs: ['--allowedTools', 'Read'] },
    )

    // Harness integrity only (record-don't-assert): either probe outcome is an
    // answer — a rejection error that names Read's expected shape is itself
    // the empirical close of the open follow-up.
    assertSessionRan(run)
    expect(existsSync(hookLog), 'harness integrity: e1-object-rewrite-hook never fired for Read (no HOOK_LOG side file)').toBe(true)

    const transcriptPath = findTranscript(run.init?.session_id)
    const t = extractTranscriptToolData(transcriptPath)
    const streamResults = extractToolResultText(run)
    const rewrittenSeen = streamResults.includes(E1_REWRITTEN) || t.toolResults.includes(E1_REWRITTEN)

    let readObjectVerdict: string
    let readObjectHookError: string | undefined
    if (rewrittenSeen) {
      readObjectVerdict = 'honored (Bash-style object accepted for Read)'
    } else {
      readObjectHookError = scanHookErrorExcerpt(transcriptPath)
      readObjectVerdict =
        readObjectHookError !== undefined
          ? "rejected — zod error names Read's expected output shape (see verbatim excerpt)"
          : 'indeterminate'
    }

    // Record-nothing gate (08-11, WR-01): the E1_shape_validation record is
    // only assemblable when the Bash-object gate leg ran in THIS process.
    // When it did not (filtered rerun, or an upgrade run where E1 legs failed
    // before recording), every field the record would carry —
    // object_probe_honored: false, string_shape_rejected from an unstashed
    // transcript, the "NOT reproduced this run" verdict — would be fabricated,
    // and run-wins would overwrite the committed shape-validation answer.
    // Record nothing; buildShapeValidation's carry-forward preserves the
    // committed record verbatim. This leg's own readObjectVerdict observation
    // is intentionally dropped in this degenerate case because its host record
    // would otherwise be fabricated. Contrast: ran-and-not-honored falls
    // through and IS recorded below (genuine drift finding).
    if (e1ObjectBash === undefined) {
      return
    }

    // Both object legs have run — assemble the E1_shape_validation record.
    const objectHonored = e1ObjectBash?.verdict === 'honored'
    // Round-2 WR-01: "rejection excerpt not found" only means "string form not
    // rejected" when the E1/Bash string leg actually ran in THIS process and
    // stashed its transcript. A filtered `vitest -t 'object'` rerun (both
    // object legs ran, string leg did not) must not flip the committed
    // string_shape_rejected: true to an unmeasured false.
    const stringLegObserved = e1BashTranscriptPath !== null
    const stringRejected = stringShapeHookError !== undefined

    let shapeVerdict: string
    if (objectHonored && stringRejected) {
      shapeVerdict =
        'Claude Code SHAPE-VALIDATES updatedToolOutput per tool: STRING payloads are REJECTED for Bash (zod invalid_type, expected object) with a warning and the original output is used; OBJECT-shaped payloads ({stdout, stderr, interrupted, isImage}) are HONORED for Bash. The channel is NOT dead for built-ins.'
    } else if (objectHonored) {
      shapeVerdict =
        'object shape HONORED for Bash this run; the string-shape rejection error was not re-observed in the E1/Bash transcript (committed verbatim_hook_error carries the prior observation)'
    } else {
      shapeVerdict = `shape-validation conclusion NOT reproduced this run — Bash-object verdict: ${e1ObjectBash?.verdict ?? 'not-run'}; inspect evidence`
    }

    shapeValidationRecord = {
      ...baseRecord(
        "Discovery behind the E1 'ignored for Bash/Read' verdicts: does Claude Code shape-validate updatedToolOutput per tool?",
        'headless -p probes: OBJECT-shaped updatedToolOutput fixture on Bash + Read matchers (tests/uat/fixtures/e1-object-rewrite-hook.sh); string-leg rejection evidence regex-scanned from the E1/Bash transcript',
      ),
      verdict: shapeVerdict,
      // undefined when not observed this run — the builder's field-level
      // fallback preserves the committed verbatim excerpt (WR-01, Test 4).
      verbatim_hook_error: stringShapeHookError,
      fixture_path: 'tests/uat/fixtures/e1-object-rewrite-hook.sh',
      signals: {
        object_probe_honored: objectHonored,
        object_probe_session_id: bashObjectSessionId ?? null,
        object_probe_payload:
          '{"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":{"stdout":"REWRITTEN_E1_MARKER_x9k2","stderr":"","interrupted":false,"isImage":false}}}',
        // Honest about observation state (WR-01): only a run that scanned the
        // string-leg transcript may claim a boolean; corroborated by the
        // string leg's own verdict (catches error-wording drift where the
        // excerpt regex misses but the leg still observed rejection).
        string_shape_rejected: stringLegObserved ? stringRejected : 'not-observed-this-run',
        string_leg_verdict: e1Tools['Bash']?.verdict ?? 'not-run',
        read_object_verdict: readObjectVerdict,
        read_object_hook_error: readObjectHookError ?? null,
      },
      evidence_paths: [...(e1ObjectBash?.evidence_paths ?? []), ...(transcriptPath !== null ? [transcriptPath] : [])],
      reinterpretation_notes: {
        E1_bash_read_verdicts:
          "E1 Bash/Read 'ignored' verdicts mean 'string-form rejected by per-tool output-shape validation' — not 'channel dead'",
        issue_68951: '#68951 likely reports the string form',
        mcp_honored: 'MCP honored because MCP accepts string content',
        E4: 'answerable via object-shaped Bash payload — E4 leg now gated on the object verdict',
        read_object_shape: `Read object-shape probe recorded this run: ${readObjectVerdict}`,
      },
    }
  }, 240_000)

  test('E1/Read: updatedToolOutput for built-in Read', () => {
    const hookLog = path.join(sandbox, 'e1-read-hook.log')
    const settings = writeSettings('settings-e1-read.json', {
      PostToolUse: [hookEntry(fixtureCmd(E1_HOOK, 'HOOK_LOG', hookLog), 'Read')],
    })

    const run = runClaude(
      `Read the file ${path.join(projectDir, 'e1-read-marker.txt')} and quote back, verbatim, the exact contents the tool returned to you.`,
      settings,
      { cwd: projectDir, extraArgs: ['--allowedTools', 'Read'] },
    )

    assertSessionRan(run)
    expect(existsSync(hookLog), 'harness integrity: e1-rewrite-hook never fired for Read (no HOOK_LOG side file)').toBe(true)

    e1Tools['Read'] = buildE1Verdict(run, true)
  }, 240_000)

  test('E1/MCP: updatedToolOutput for an MCP tool (mrclean_check via fixture rewrite hook)', () => {
    const hookLog = path.join(sandbox, 'e1-mcp-hook.log')
    const settings = writeSettings('settings-e1-mcp.json', {
      PostToolUse: [hookEntry(fixtureCmd(E1_HOOK, 'HOOK_LOG', hookLog), 'mcp__mrclean__.*')],
    })

    // Harness-integrity fixes observed on 2.1.209:
    //  - ENABLE_TOOL_SEARCH=false: MCP tool schemas are deferred behind
    //    ToolSearch by default; Haiku retrieved the schema but then failed to
    //    invoke the tool (looped or claimed it could not call MCP tools).
    //    Eager loading makes the direct call land on the first turn.
    //  - Direct-call prompt + Task disallowed: a loose prompt made the nested
    //    session delegate to a Task subagent that burned the spawn timeout.
    const run = runClaude(
      `Call the MCP tool named mcp__mrclean__mrclean_check (from the connected mrclean MCP server) with the text argument "${E1_ORIGINAL}". Call the tool directly yourself — do not delegate to a subagent. Then quote back, verbatim, exactly what the tool returned to you.`,
      settings,
      {
        cwd: projectDir,
        mcpConfigPath,
        extraArgs: ['--allowedTools', 'mcp__mrclean__mrclean_check', '--disallowedTools', 'Task'],
        env: { ENABLE_TOOL_SEARCH: 'false' },
        maxTurns: 6,
        timeoutMs: 220_000,
      },
    )

    assertSessionRan(run)
    const servers = run.init?.mcp_servers ?? []
    const mrclean = servers.find((s) => s.name === 'mrclean')
    expect(mrclean?.status, `harness integrity: mrclean MCP server not connected: ${JSON.stringify(servers)}`).toBe('connected')
    expect(existsSync(hookLog), 'harness integrity: e1-rewrite-hook never fired for the MCP tool (no HOOK_LOG side file)').toBe(true)

    // mrclean_check's un-rewritten output is findings JSON (the scanned text is
    // not echoed), so the ORIGINAL marker is not detectable in tool_result.
    e1Tools['MCP'] = buildE1Verdict(run, false)
  }, 300_000)

  // -------------------------------------------------------------------------
  // E2 — PreToolUse updatedInput: context echo?
  // -------------------------------------------------------------------------

  test('E2: PreToolUse updatedInput — executed command vs transcript tool_use echo', () => {
    const hookLog = path.join(sandbox, 'e2-hook.log')
    const settings = writeSettings('settings-e2.json', {
      PreToolUse: [hookEntry(fixtureCmd(E2_HOOK, 'HOOK_LOG', hookLog), 'Bash')],
    })

    const run = runClaude(
      `Run the bash command \`echo ${E2_ORIG}\`. Then report two things, clearly labeled: (1) the exact command you ran, quoted verbatim; (2) the exact output the tool returned, quoted verbatim.`,
      settings,
      { cwd: projectDir, extraArgs: ['--allowedTools', 'Bash'] },
    )

    assertSessionRan(run)
    expect(existsSync(hookLog), 'harness integrity: e2-updated-input-hook never fired (no HOOK_LOG side file)').toBe(true)

    const sid = run.init?.session_id
    const transcriptPath = findTranscript(sid)
    const t = extractTranscriptToolData(transcriptPath)
    const streamResults = extractToolResultText(run)
    const streamInputs = extractToolUseInputs(run)

    const rewriteExecuted = streamResults.includes(E2_UPDATED) || t.toolResults.includes(E2_UPDATED)
    const transcriptInputHasUpdated = t.toolUseInputs.includes(E2_UPDATED)
    const transcriptInputHasOriginal = t.toolUseInputs.includes(E2_ORIG)

    let echoVerdict: string
    if (transcriptInputHasUpdated && !transcriptInputHasOriginal)
      echoVerdict = 'updatedInput ECHOES: transcript tool_use input shows the UPDATED command (input-side restore would ratchet)'
    else if (transcriptInputHasOriginal && !transcriptInputHasUpdated)
      echoVerdict = 'no echo: transcript tool_use input preserves the ORIGINAL command'
    else if (transcriptInputHasOriginal && transcriptInputHasUpdated)
      echoVerdict = 'both commands observed in transcript tool_use inputs — inspect evidence'
    else echoVerdict = 'indeterminate (no marker observed in transcript tool_use inputs)'

    e2Record = {
      ...baseRecord(
        'Does PreToolUse hookSpecificOutput.updatedInput echo into the transcript / model context, or is the original preserved?',
        'live headless -p session; fixture PreToolUse allow+updatedInput hook (complete tool_input object); signals: tool output marker, transcript tool_use input, model quote',
      ),
      verdict: `rewrite executed: ${String(rewriteExecuted)}; ${echoVerdict}`,
      signals: {
        rewrite_executed: rewriteExecuted,
        stream_tool_result_contains_updated: streamResults.includes(E2_UPDATED),
        stream_tool_result_contains_original: streamResults.includes(E2_ORIG),
        stream_tool_use_input_contains_original: streamInputs.includes(E2_ORIG),
        stream_tool_use_input_contains_updated: streamInputs.includes(E2_UPDATED),
        transcript_found: t.found,
        transcript_tool_use_input_contains_original: transcriptInputHasOriginal,
        transcript_tool_use_input_contains_updated: transcriptInputHasUpdated,
        model_reply_excerpt: run.resultText.slice(0, 600),
      },
      evidence_paths: transcriptPath !== null ? [transcriptPath] : [],
    }
  }, 240_000)

  // -------------------------------------------------------------------------
  // E3 — session_id continuity across --resume (+ --fork-session control)
  // -------------------------------------------------------------------------

  test('E3: session_id continuity across --resume, with --fork-session control', () => {
    const e3Log = path.join(sandbox, 'e3-log.jsonl')
    const logCmd = fixtureCmd(LOG_HOOK, 'E_LOG', e3Log)
    const settings = writeSettings('settings-e3.json', {
      // Widened matcher — doubles as live proof the 08-02 registration pattern
      // fires on source:resume via sandbox settings.
      SessionStart: [hookEntry(logCmd, 'startup|resume|clear|compact')],
      UserPromptSubmit: [hookEntry(logCmd)],
    })

    // Run 1 — fresh session; capture sid from init event + hook side file.
    const run1 = runClaude('Reply with exactly: OK', settings, { cwd: projectDir })
    assertSessionRan(run1)
    const entriesAfter1 = readLogEntries(e3Log)
    expect(entriesAfter1.length, 'harness integrity: log-hook wrote no entries in run 1').toBeGreaterThan(0)

    const sid1 = run1.init?.session_id ?? entriesAfter1.find((x) => typeof x.sid === 'string')?.sid
    if (sid1 === undefined) {
      throw new Error('BLOCKER (harness integrity): could not determine run-1 session_id from init event or side file')
    }

    // Run 2 — plain --resume (A3 fallback: --continue if resume misbehaves in print mode).
    let resumeMethod = 'claude -p --resume <sid>'
    let run2 = runClaude('Reply with exactly: OK AGAIN', settings, {
      cwd: projectDir,
      extraArgs: ['--resume', sid1],
    })
    if (run2.resultEvent === undefined) {
      resumeMethod = 'claude -p --continue (FALLBACK: --resume <sid> produced no result event in print mode — recorded limitation)'
      run2 = runClaude('Reply with exactly: OK AGAIN', settings, { cwd: projectDir, extraArgs: ['--continue'] })
    }
    assertSessionRan(run2)
    const entriesAfter2 = readLogEntries(e3Log)
    const run2Entries = entriesAfter2.slice(entriesAfter1.length)
    const run2HookSids = [...new Set(run2Entries.map((x) => x.sid).filter((s): s is string => typeof s === 'string'))]
    const sid2 = run2.init?.session_id
    const resumeReusesId = run2HookSids.length > 0 ? run2HookSids.every((s) => s === sid1) : sid2 === sid1
    const resumeSourceObserved = run2Entries.some((x) => x.e === 'SessionStart' && x.src === 'resume')

    // Run 3 — control: --fork-session must mint a NEW id (recorded, not asserted).
    const run3 = runClaude('Reply with exactly: OK FORK', settings, {
      cwd: projectDir,
      extraArgs: ['--resume', sid1, '--fork-session'],
    })
    const entriesAfter3 = readLogEntries(e3Log)
    const run3Entries = entriesAfter3.slice(entriesAfter2.length)
    const sid3 = run3.init?.session_id ?? run3Entries.find((x) => typeof x.sid === 'string')?.sid
    const forkRan = run3.resultEvent !== undefined
    const forkMintedNewId = typeof sid3 === 'string' && sid3 !== sid1

    e3Record = {
      ...baseRecord(
        'Is session_id continuous across --resume in hook payloads (T5 rehydration gate)? Control: --fork-session mints a NEW id.',
        `live headless sessions from the same cwd; log-hook side file on SessionStart+UserPromptSubmit; ${resumeMethod}; control: --resume <sid> --fork-session`,
      ),
      verdict: `plain resume reuses session_id: ${String(resumeReusesId)}; fork-session mints new id: ${forkRan ? String(forkMintedNewId) : 'control run produced no result event (not observable)'}; SessionStart source:resume observed via widened matcher: ${String(resumeSourceObserved)}`,
      signals: {
        sid_run1: sid1,
        sid_run2_init: sid2 ?? null,
        sid_run2_hook_payloads: run2HookSids,
        resume_method: resumeMethod,
        resume_reuses_session_id: resumeReusesId,
        sessionstart_source_resume_observed: resumeSourceObserved,
        fork_control_ran: forkRan,
        sid_run3: sid3 ?? null,
        fork_minted_new_id: forkRan ? forkMintedNewId : null,
        side_file_entries: entriesAfter3,
      },
      evidence_paths: [e3Log],
    }
  }, 600_000)

  // -------------------------------------------------------------------------
  // E4 — 10K-char cap vs updatedToolOutput (+ additionalContext control)
  // -------------------------------------------------------------------------

  test('E4: 10K cap vs ~15K updatedToolOutput (object-gated: prefers the honored E1/Bash-object leg)', () => {
    // FIRST preference: the object-shape Bash leg — the payload form 2.1.209
    // honors for built-in Bash (see E1_shape_validation).
    const objectLeg = e1ObjectBash?.verdict === 'honored'
    // Fallback: the legacy string-form gating, unchanged.
    const stringHonored = objectLeg ? undefined : (['Bash', 'Read'] as const).find((t) => e1Tools[t]?.verdict === 'honored')

    if (!objectLeg && stringHonored === undefined) {
      // Record-nothing gate (08-11 WR-01, round-2 CR-01): distinguish
      // ran-and-not-honored (genuine drift — record it below) from
      // not-run-in-this-process (no new gate information). In a filtered rerun
      // (`vitest -t 'E4'`), an upgrade run where the E1 legs fail at
      // assertSessionRan, or a mixed run where ONLY the Bash-object leg flaked,
      // e1ObjectBash is never set — fabricating "unanswerable" here would
      // define run.e4 and run-wins would destroy the committed E4 answer
      // (T-08-08-01). Gate on the object leg alone: e1Tools being non-empty
      // says nothing about whether the GATE leg ran. Leaving e4Record
      // undefined lets buildE4's carry-forward preserve the committed verdict.
      if (e1ObjectBash === undefined) {
        return
      }
      const mcpHonored = e1Tools['MCP']?.verdict === 'honored'
      e4Record = {
        ...baseRecord(
          'Does the documented 10K-char hook-output cap bind updatedToolOutput (unlisted in docs)?',
          'gated on E1: requires a tool+shape where updatedToolOutput is honored (object-shape Bash leg preferred)',
        ),
        verdict: mcpHonored
          ? `unanswerable for built-in tools on this CC version — object-shaped updatedToolOutput not honored for Bash in this run (Bash-object verdict: ${e1ObjectBash?.verdict ?? 'not-run'}; see E1_shape_validation) and no string-form leg honored; honored only for MCP, which this harness does not exercise for the cap question`
          : `unanswerable on this CC version — object-shaped updatedToolOutput not honored for Bash in this run (Bash-object verdict: ${e1ObjectBash?.verdict ?? 'not-run'}; see E1_shape_validation), and no string-form leg was honored`,
        signals: {
          e1_bash_object_verdict: e1ObjectBash?.verdict ?? 'not-run',
          e1_bash_verdict: e1Tools['Bash']?.verdict ?? 'not-run',
          e1_read_verdict: e1Tools['Read']?.verdict ?? 'not-run',
          e1_mcp_verdict: e1Tools['MCP']?.verdict ?? 'not-run',
        },
        evidence_paths: [],
      }
      return
    }

    // objectLeg → Bash with the OBJECT-shaped fixture; else the string leg.
    const tool: 'Bash' | 'Read' = objectLeg ? 'Bash' : (stringHonored ?? 'Bash')
    const e4Hook = objectLeg ? E4_OBJECT_HOOK : E4_HOOK

    const hookLog = path.join(sandbox, 'e4-hook.log')
    const settings = writeSettings('settings-e4.json', {
      PostToolUse: [hookEntry(fixtureCmd(e4Hook, 'HOOK_LOG', hookLog), tool)],
    })

    const prompt =
      tool === 'Bash'
        ? 'Run the bash command `seq 1 3000` and then report the first 40 characters and the last 40 characters of the tool output you saw, quoted verbatim.'
        : `Read the file ${path.join(projectDir, 'e4-large.txt')} and then report the first 40 characters and the last 40 characters of the tool output you saw, quoted verbatim.`

    const run = runClaude(prompt, settings, {
      cwd: projectDir,
      extraArgs: ['--allowedTools', tool],
    })

    assertSessionRan(run)
    expect(existsSync(hookLog), `harness integrity: ${path.basename(e4Hook)} never fired (no HOOK_LOG side file)`).toBe(true)

    const sid = run.init?.session_id
    const transcriptPath = findTranscript(sid)
    const t = extractTranscriptToolData(transcriptPath)
    const streamResults = extractToolResultText(run)

    const headSeen = streamResults.includes(E4_HEAD) || t.toolResults.includes(E4_HEAD)
    const tailSeen = streamResults.includes(E4_TAIL) || t.toolResults.includes(E4_TAIL)

    let verdict: string
    if (headSeen && tailSeen) verdict = `cap does NOT bind updatedToolOutput (~15K survived intact for ${tool})`
    else if (headSeen && !tailSeen) verdict = `capped/truncated: HEAD survived, TAIL lost (~10K cap appears to bind updatedToolOutput for ${tool})`
    else verdict = `indeterminate for ${tool}: neither/only-tail marker observed in tool_result — inspect evidence`

    e4Record = {
      ...baseRecord(
        'Does the documented 10K-char hook-output cap bind updatedToolOutput (unlisted in docs)?',
        objectLeg
          ? 'live headless -p session; Bash produces >10K output; fixture hook returns ~15K OBJECT-shaped updatedToolOutput ({stdout,...}) with HEAD/TAIL markers (fixture tests/uat/fixtures/e4-object-large-output-hook.sh)'
          : `live headless -p session; ${tool} produces >10K output; fixture hook returns ~15K updatedToolOutput with HEAD/TAIL markers`,
      ),
      verdict,
      signals: {
        tool_used: tool,
        payload_shape: objectLeg ? 'object ({stdout, stderr, interrupted, isImage})' : 'string',
        head_marker_seen: headSeen,
        tail_marker_seen: tailSeen,
        stream_tool_result_char_length: streamResults.length,
        stream_tool_result_excerpt_head: streamResults.slice(0, 300),
        stream_tool_result_excerpt_tail: streamResults.slice(-300),
        model_reply_excerpt: run.resultText.slice(0, 500),
      },
      evidence_paths: transcriptPath !== null ? [transcriptPath] : [],
    }
  }, 400_000)

  test('E4-control: >10K additionalContext (documented capped — validates the harness observes the cap)', () => {
    // Inline hook: single-quoted node program survives sh -c; no fixture file
    // needed for the control (documented-capped field).
    const e4cCommand = `node -e 'const f="y".repeat(15000); process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:"${E4C_HEAD} "+f+" ${E4C_TAIL}"}}))'`
    const settings = writeSettings('settings-e4-control.json', {
      UserPromptSubmit: [hookEntry(e4cCommand)],
    })

    const run = runClaude(
      `Your context may contain injected text with the markers ${E4C_HEAD} and ${E4C_TAIL}. Reply with exactly two words separated by a space: YES or NO for whether you can see ${E4C_HEAD}, then YES or NO for whether you can see ${E4C_TAIL}.`,
      settings,
      { cwd: projectDir },
    )

    assertSessionRan(run)

    const sid = run.init?.session_id
    const transcriptPath = findTranscript(sid)
    const transcriptRaw = transcriptPath !== null ? readFileSync(transcriptPath, 'utf8') : ''
    const headInTranscript = transcriptRaw.includes(E4C_HEAD)
    const tailInTranscript = transcriptRaw.includes(E4C_TAIL)

    e4ControlRecord = {
      ...baseRecord(
        'Control: is >10K additionalContext capped as documented (file + preview replacement)?',
        'live headless -p session; inline UserPromptSubmit hook emits ~15K additionalContext with HEAD/TAIL markers',
      ),
      verdict:
        headInTranscript && tailInTranscript
          ? 'NOT capped in this observation: both markers present in transcript (documented cap not observed at ~15K)'
          : headInTranscript && !tailInTranscript
            ? 'capped as documented: HEAD present, TAIL absent from transcript (preview/file replacement or truncation observed)'
            : 'indeterminate: HEAD marker not found in transcript — inspect evidence',
      signals: {
        model_reply: run.resultText.slice(0, 200),
        head_in_transcript: headInTranscript,
        tail_in_transcript: tailInTranscript,
        transcript_found: transcriptPath !== null,
      },
      evidence_paths: transcriptPath !== null ? [transcriptPath] : [],
    }
  }, 240_000)

  // -------------------------------------------------------------------------
  // E5 — SessionEnd firing/reason + mrclean real-hook noise (SC3 observable)
  // -------------------------------------------------------------------------

  test('E5/headless: does SessionEnd fire in -p mode, and with which reason?', () => {
    const e5Log = path.join(sandbox, 'e5-log.jsonl')
    const settings = writeSettings('settings-e5.json', {
      // No matcher — SessionEnd matchers filter on `reason`; observe ALL reasons.
      SessionEnd: [hookEntry(fixtureCmd(LOG_HOOK, 'E_LOG', e5Log))],
    })

    const run = runClaude('Reply with exactly: DONE', settings, { cwd: projectDir })
    assertSessionRan(run)

    const entries = readLogEntries(e5Log)
    const sessionEnd = entries.find((x) => x.e === 'SessionEnd')

    e5HeadlessRecord = {
      ...baseRecord(
        'Does SessionEnd fire at the end of a headless -p session (A4)? Which reason?',
        'live headless -p session; log-hook on SessionEnd (no matcher) appending to a side file',
      ),
      verdict:
        sessionEnd !== undefined
          ? `SessionEnd FIRES headlessly (reason: ${String(sessionEnd.src)})`
          : 'SessionEnd did NOT fire in headless -p mode (Phase 9 janitor must lean on the TTL sweep; SC3 verified via stderr scan instead)',
      signals: {
        side_file_written: existsSync(e5Log),
        entries,
      },
      evidence_paths: [e5Log],
    }
  }, 240_000)

  test('E5/mrclean: real built hook on SessionStart (widened matcher) + SessionEnd — zero exit-2 noise (SC3)', () => {
    // The real fail-closed wrapper, exactly as `mrclean install` writes it —
    // but registered ONLY in sandbox settings (operator config never touched).
    const hookCommand = buildHookCommand(process.execPath, DIST_CLI)
    const settings = writeSettings('settings-e5-mrclean.json', {
      SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [hookCommand] }],
      SessionEnd: [{ hooks: [hookCommand] }],
    })

    const run = runClaude('Reply with exactly: OK', settings, { cwd: projectDir })

    // Harness integrity + the SC3 live observable (this one IS hard-asserted:
    // it is mrclean's own shipped behavior, not an upstream contract question).
    assertSessionRan(run)
    const noiseRe = /hook.*(error|fail|block)|exit code 2|exited with (?:status|code) 2/i
    expect(
      noiseRe.test(run.rawStderr),
      `SC3 violation: hook-error/exit-2 noise on session start/end.\nstderr:\n${run.rawStderr}`,
    ).toBe(false)

    e5NoiseRecord = {
      ...baseRecord(
        'Does mrclean’s real hook (SessionStart widened matcher + SessionEnd no-op) produce exit-2/hook-error noise in a live session?',
        'live headless -p session; buildHookCommand fail-closed wrapper registered for SessionStart+SessionEnd in sandbox settings; stderr scanned',
      ),
      verdict: 'zero hook-error/exit-2 stderr noise observed (SC3 live observable satisfied)',
      signals: {
        stderr_excerpt: run.rawStderr.slice(0, 800),
        exit_status: run.status,
        model_reply: run.resultText.slice(0, 200),
      },
      evidence_paths: [],
    }
  }, 240_000)
})
