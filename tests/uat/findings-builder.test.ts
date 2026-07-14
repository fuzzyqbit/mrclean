/**
 * findings-builder unit tests (Plan 08-08, WR-01).
 *
 * Proves the guard + carry-forward + merge logic of buildFindingsArtifact
 * OFFLINE — no live sessions, no tokens, no claude spawns. Deliberately NOT
 * gated on MRCLEAN_UAT: this file is pure logic and must run in every
 * `--project=uat` invocation so the writer's durability is verifiable
 * before any live rerun (plan 08-09) touches the committed artifact.
 */

import { describe, test, expect } from 'vitest'

import {
  buildFindingsArtifact,
  type RunRecords,
  type ToolVerdict,
  type ExperimentRecord,
} from './findings-builder.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function emptyRun(): RunRecords {
  return {
    claudeVersion: '2.1.209 (Claude Code)',
    date: '2026-07-14',
    issue68951State: 'not-checked',
    e1Tools: {},
  }
}

function bashVerdict(): ToolVerdict {
  return {
    verdict: 'honored',
    signals: { stream_tool_result_contains_rewritten: true },
    evidence_paths: ['/tmp/transcript-bash.jsonl'],
  }
}

function previousRendering(): Record<string, unknown> {
  return {
    verdict:
      'honored rewrite (object shape) → terminal renders REWRITTEN output; display follows the model-facing value',
    claude_version: '2.1.209 (Claude Code)',
    date: '2026-07-14',
    method: 'operator-directed automated PTY observation (tmux capture-pane)',
    evidence: {
      object_shape_session_id: 'e244a7f9-6296-4413-a636-efea169636e2',
      evidence_paths: ['/tmp/prev-rendering.jsonl'],
    },
  }
}

function previousShapeValidation(): Record<string, unknown> {
  return {
    question:
      "Discovery behind the E1 'ignored for Bash/Read' verdicts: does Claude Code shape-validate updatedToolOutput per tool?",
    method: 'interactive string-shape transcript inspection + headless -p object probe',
    claude_version: '2.1.209 (Claude Code)',
    date: '2026-07-14',
    verdict: 'Claude Code 2.1.209 SHAPE-VALIDATES updatedToolOutput per tool',
    verbatim_hook_error:
      "PostToolUse hook returned updatedToolOutput that does not match Bash's output shape; using original output. [invalid_type: expected object, received string]",
    fixture_path: 'tests/uat/fixtures/e1-object-rewrite-hook.sh',
    signals: { object_probe_honored: true, string_shape_rejected: true },
    evidence_paths: ['/tmp/prev-shape.jsonl'],
    reinterpretation_notes: { issue_68951: '#68951 likely reports the string form' },
  }
}

function previousArtifact(): Record<string, unknown> {
  return {
    claude_version: '2.1.209 (Claude Code)',
    date: '2026-07-14',
    generated_by: 'tests/uat/contract-verification.test.ts (MRCLEAN_UAT=1 opt-in, record-dont-assert)',
    issue_68951: '{"state":"OPEN"}',
    experiments: {
      E1: {
        question: 'Is PostToolUse hookSpecificOutput.updatedToolOutput honored, per tool?',
        verdict: 'Bash: ignored; Read: ignored; MCP: honored',
        tools: {},
        rendering: previousRendering(),
      },
      E1_shape_validation: previousShapeValidation(),
    },
  }
}

function experimentsOf(result: Record<string, unknown> | null): Record<string, unknown> {
  expect(result).not.toBeNull()
  const experiments = (result as Record<string, unknown>)['experiments']
  expect(experiments).toBeTypeOf('object')
  return experiments as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildFindingsArtifact', () => {
  test('returns null when the run recorded zero verdicts (guard — skipped/beforeAll-broken runs cannot clobber the artifact)', () => {
    // Arrange
    const run = emptyRun()
    const previous = previousArtifact()

    // Act
    const result = buildFindingsArtifact(previous, run)

    // Assert
    expect(result).toBeNull()
  })

  test('carries forward previous E1.rendering and E1_shape_validation verbatim when the run did not produce them', () => {
    // Arrange
    const run: RunRecords = { ...emptyRun(), e1Tools: { Bash: bashVerdict() } }
    const previous = previousArtifact()

    // Act
    const experiments = experimentsOf(buildFindingsArtifact(previous, run))

    // Assert
    const e1 = experiments['E1'] as Record<string, unknown>
    expect(e1['rendering']).toEqual(previousRendering())
    expect(experiments['E1_shape_validation']).toEqual(previousShapeValidation())
  })

  test('uses the run shapeValidation record when defined (run wins over previous)', () => {
    // Arrange
    const freshShape: Record<string, unknown> = {
      question: 'shape validation (fresh)',
      verdict: 'object shape HONORED for Bash this run',
      verbatim_hook_error: 'fresh verbatim excerpt from this run',
      signals: { object_probe_honored: true },
    }
    const run: RunRecords = { ...emptyRun(), e1Tools: { Bash: bashVerdict() }, shapeValidation: freshShape }
    const previous = previousArtifact()

    // Act
    const experiments = experimentsOf(buildFindingsArtifact(previous, run))

    // Assert
    expect(experiments['E1_shape_validation']).toEqual(freshShape)
  })

  test('fills verbatim_hook_error from previous when the run shapeValidation record lacks it (field-level fallback)', () => {
    // Arrange
    const freshShape: Record<string, unknown> = {
      question: 'shape validation (fresh, no verbatim error observed)',
      verdict: 'object shape HONORED for Bash this run',
      verbatim_hook_error: undefined,
      signals: { object_probe_honored: true, string_shape_rejected: false },
    }
    const run: RunRecords = { ...emptyRun(), e1Tools: { Bash: bashVerdict() }, shapeValidation: freshShape }
    const previous = previousArtifact()

    // Act
    const experiments = experimentsOf(buildFindingsArtifact(previous, run))

    // Assert
    const shape = experiments['E1_shape_validation'] as Record<string, unknown>
    expect(shape['verbatim_hook_error']).toBe(previousShapeValidation()['verbatim_hook_error'])
    expect(shape['question']).toBe('shape validation (fresh, no verbatim error observed)')
    expect(shape['verdict']).toBe('object shape HONORED for Bash this run')
    expect(shape['signals']).toEqual({ object_probe_honored: true, string_shape_rejected: false })
  })

  test("emits a 'not-recorded' stub when an experiment is absent from BOTH previous and run", () => {
    // Arrange — previous artifact has no E2; run has no e2 record.
    const run: RunRecords = { ...emptyRun(), e1Tools: { Bash: bashVerdict() } }
    const previous = previousArtifact()

    // Act
    const experiments = experimentsOf(buildFindingsArtifact(previous, run))

    // Assert — missingRecord shape preserved from the pre-08-08 writer.
    const e2 = experiments['E2'] as ExperimentRecord
    expect(e2.question).toBe('E2 (not recorded)')
    expect(e2.verdict).toBe('not-recorded (test failed before a verdict was captured — see vitest output)')
    expect(e2.method).toBe('live headless session')
    expect(e2.claude_version).toBe('2.1.209 (Claude Code)')
    expect(e2.signals).toEqual({})
    expect(e2.evidence_paths).toEqual([])
  })

  test("falls back to the literal 'pending-interactive' rendering only when previous is undefined and the run produced none", () => {
    // Arrange
    const run: RunRecords = { ...emptyRun(), e1Tools: { Bash: bashVerdict() } }

    // Act
    const experiments = experimentsOf(buildFindingsArtifact(undefined, run))

    // Assert
    const e1 = experiments['E1'] as Record<string, unknown>
    expect(e1['rendering']).toBe('pending-interactive')
  })
})
