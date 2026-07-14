/**
 * findings-builder.ts — pure findings assembly for the contract-verification
 * harness (Plan 08-08, WR-01).
 *
 * Why this module exists: the pre-08-08 afterAll writer hardcoded
 * `rendering: 'pending-interactive'`, emitted no E1_shape_validation key, and
 * wrote unconditionally — so the documented re-verification procedure
 * (`MRCLEAN_UAT=1 npm run test:uat`) could clobber the exact evidence that
 * THREAT_MODEL.md §Reversible-3, docs/HOOK-CONTRACT.md §E1, and the
 * src/shared/types.ts JSDoc cite (T-08-08-01, Tampering, HIGH).
 *
 * Guarantees (proven offline by findings-builder.test.ts):
 *   - GUARD: returns null when the run recorded ZERO verdicts — the caller
 *     must then leave the committed artifact untouched (beforeAll-throw safe).
 *   - CARRY-FORWARD: for any experiment the run did not produce, the previous
 *     artifact's record is re-emitted verbatim; stubs appear only when
 *     NEITHER side has the record.
 *   - FIELD FALLBACK: E1_shape_validation.verbatim_hook_error (the one
 *     interactively-sourced field) is filled from the previous artifact when
 *     a fresh run record lacks it.
 *
 * Pure module: no I/O, no vitest imports, never mutates its inputs.
 */

export interface ToolVerdict {
  verdict: string
  signals: Record<string, unknown>
  evidence_paths: string[]
}

export interface ExperimentRecord {
  question: string
  verdict: string
  method: string
  claude_version: string
  date: string
  signals: Record<string, unknown>
  evidence_paths: string[]
}

/** Everything a harness run may have recorded. Absent field == experiment not run. */
export interface RunRecords {
  claudeVersion: string
  date: string
  issue68951State: string
  e1Tools: Record<string, ToolVerdict> // keys: Bash | Read | MCP
  shapeValidation?: Record<string, unknown> // E1_shape_validation-shaped (fresh from the object legs)
  e2?: ExperimentRecord
  e3?: ExperimentRecord
  e4?: ExperimentRecord
  e4Control?: ExperimentRecord
  e5Headless?: ExperimentRecord
  e5Noise?: ExperimentRecord
}

const GENERATED_BY = 'tests/uat/contract-verification.test.ts (MRCLEAN_UAT=1 opt-in, record-dont-assert)'
const E1_TOOL_ORDER = ['Bash', 'Read', 'MCP'] as const
/** Last-resort E1.rendering fallback — only when neither previous nor run has one. */
const RENDERING_FALLBACK = 'pending-interactive'

// ---------------------------------------------------------------------------
// Defensive access to the previous artifact (parsed unknown — never throw)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function previousExperiments(previous: unknown): Record<string, unknown> {
  if (!isRecord(previous)) return {}
  const experiments = previous['experiments']
  return isRecord(experiments) ? experiments : {}
}

function recordAt(experiments: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = experiments[key]
  return isRecord(value) ? value : undefined
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

function countRecordedVerdicts(run: RunRecords): number {
  const optionalRecords = [run.shapeValidation, run.e2, run.e3, run.e4, run.e4Control, run.e5Headless, run.e5Noise]
  return Object.keys(run.e1Tools).length + optionalRecords.filter((record) => record !== undefined).length
}

// ---------------------------------------------------------------------------
// Stubs (shape preserved from the pre-08-08 writer)
// ---------------------------------------------------------------------------

function missingRecord(name: string, run: RunRecords): ExperimentRecord {
  return {
    question: `${name} (not recorded)`,
    method: 'live headless session',
    claude_version: run.claudeVersion,
    date: run.date,
    verdict: 'not-recorded (test failed before a verdict was captured — see vitest output)',
    signals: {},
    evidence_paths: [],
  }
}

// ---------------------------------------------------------------------------
// Per-experiment assembly
// ---------------------------------------------------------------------------

function buildE1(run: RunRecords, prevExperiments: Record<string, unknown>): Record<string, unknown> {
  const prevE1 = recordAt(prevExperiments, 'E1')
  const tools = Object.fromEntries(
    E1_TOOL_ORDER.map((tool) => [tool, run.e1Tools[tool] ?? { verdict: 'not-run', signals: {}, evidence_paths: [] }]),
  )
  const verdict = E1_TOOL_ORDER.map((tool) => `${tool}: ${run.e1Tools[tool]?.verdict ?? 'not-run'}`).join('; ')
  // The harness never produces a rendering record (interactively sourced) —
  // carry the previous artifact's; the literal is strictly a last resort.
  const rendering = prevE1?.['rendering'] ?? RENDERING_FALLBACK
  return {
    question: 'Is PostToolUse hookSpecificOutput.updatedToolOutput honored, per tool? Where does the rewrite surface?',
    method:
      'live headless -p sessions; fixture PostToolUse rewrite hook; signals: model quote, transcript jsonl tool_result, stream-json tool_result',
    claude_version: run.claudeVersion,
    date: run.date,
    verdict,
    tools,
    rendering,
  }
}

function buildShapeValidation(run: RunRecords, prevExperiments: Record<string, unknown>): Record<string, unknown> {
  const prev = recordAt(prevExperiments, 'E1_shape_validation')
  if (run.shapeValidation !== undefined) {
    // Run wins — with a field-level fallback for the one interactively-sourced
    // field (verbatim_hook_error) when the fresh run did not observe it.
    const prevError = prev?.['verbatim_hook_error']
    if (run.shapeValidation['verbatim_hook_error'] === undefined && prevError !== undefined) {
      return { ...run.shapeValidation, verbatim_hook_error: prevError }
    }
    return { ...run.shapeValidation }
  }
  if (prev !== undefined) return { ...prev }
  return { ...missingRecord('E1_shape_validation', run) }
}

function resolveExperiment(
  name: string,
  runRecord: ExperimentRecord | undefined,
  prevExperiments: Record<string, unknown>,
  run: RunRecords,
): Record<string, unknown> {
  if (runRecord !== undefined) return { ...runRecord }
  const prev = recordAt(prevExperiments, name)
  if (prev !== undefined) return { ...prev }
  return { ...missingRecord(name, run) }
}

function buildE4(run: RunRecords, prevExperiments: Record<string, unknown>): Record<string, unknown> {
  const prevE4 = recordAt(prevExperiments, 'E4')
  const prevE4Base =
    prevE4 !== undefined
      ? Object.fromEntries(Object.entries(prevE4).filter(([key]) => key !== 'control_additionalContext'))
      : undefined
  const base: Record<string, unknown> = run.e4 !== undefined ? { ...run.e4 } : (prevE4Base ?? { ...missingRecord('E4', run) })
  const control = run.e4Control ?? prevE4?.['control_additionalContext'] ?? 'not-run'
  return { ...base, control_additionalContext: control }
}

function buildE5(run: RunRecords, prevExperiments: Record<string, unknown>): Record<string, unknown> {
  const prevE5 = recordAt(prevExperiments, 'E5')
  // Run contributed nothing → re-emit previous E5 verbatim (version stamps intact).
  if (run.e5Headless === undefined && run.e5Noise === undefined && prevE5 !== undefined) return { ...prevE5 }

  const prevHeadless = recordAt(prevE5 ?? {}, 'headless')
  const prevNoise = recordAt(prevE5 ?? {}, 'mrclean_real_hook')
  const headless: Record<string, unknown> =
    run.e5Headless !== undefined ? { ...run.e5Headless } : (prevHeadless !== undefined ? { ...prevHeadless } : { ...missingRecord('E5-headless', run) })
  const noise: Record<string, unknown> =
    run.e5Noise !== undefined ? { ...run.e5Noise } : (prevNoise !== undefined ? { ...prevNoise } : { ...missingRecord('E5-mrclean-noise', run) })

  const verdictOf = (record: Record<string, unknown>): string =>
    typeof record['verdict'] === 'string' ? record['verdict'] : 'not-recorded'
  return {
    question:
      'Does SessionEnd fire in headless -p mode (which reason)? Does mrclean’s real hook produce exit-2 noise on session start/end?',
    method:
      'live headless -p sessions; log-hook side file (headless firing); mrclean real built hook + stderr scan (SC3 observable)',
    claude_version: run.claudeVersion,
    date: run.date,
    verdict: `headless firing: ${verdictOf(headless)} | mrclean real-hook stderr noise: ${verdictOf(noise)}`,
    headless,
    mrclean_real_hook: noise,
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Pure findings assembly. Returns null when the run recorded ZERO verdicts
 * (caller must then leave the committed artifact untouched).
 * Carry-forward rule: for any experiment the run did not produce, re-emit the
 * previous artifact's record verbatim; stubs only when neither side has it.
 */
export function buildFindingsArtifact(previous: unknown, run: RunRecords): Record<string, unknown> | null {
  if (countRecordedVerdicts(run) === 0) return null
  const prevExperiments = previousExperiments(previous)
  return {
    claude_version: run.claudeVersion,
    date: run.date,
    generated_by: GENERATED_BY,
    issue_68951: run.issue68951State,
    experiments: {
      E1: buildE1(run, prevExperiments),
      E1_shape_validation: buildShapeValidation(run, prevExperiments),
      E2: resolveExperiment('E2', run.e2, prevExperiments, run),
      E3: resolveExperiment('E3', run.e3, prevExperiments, run),
      E4: buildE4(run, prevExperiments),
      E5: buildE5(run, prevExperiments),
    },
  }
}
