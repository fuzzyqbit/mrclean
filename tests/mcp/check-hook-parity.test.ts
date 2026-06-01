/**
 * Parity test: mrclean_check (runDetectionReadOnly) vs the hook path (runDetection).
 *
 * Regression guard for the "mrclean_check under-detects" report. The reported
 * zero-finding behaviour was NOT a defect in runDetectionReadOnly — it was an
 * artifact of feeding ALREADY-REDACTED placeholder text into the function.
 *
 * This test proves, on REAL fixture bytes read from disk, that:
 *   1. runDetectionReadOnly (the mrclean_check code path) detects the same findings
 *      as runDetection (the PreToolUse / PostToolUse hook code path) — full parity.
 *   2. Both return a NON-EMPTY findings array for known-positive fixtures.
 *
 * Fixtures are read from FILES (never embedded as string literals) so the running
 * mrclean hook does not redact the secret-shaped values before the test sees them.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  runDetection,
  runDetectionReadOnly,
  shutdownDetection,
} from '../../src/detect/index.js'
import { initSessionState } from '../../src/detect/session-state.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'
import type { DetectionContext } from '../../src/detect/index.js'

const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'positive')

const POSITIVE_FIXTURES = [
  'github-pat-classic.txt',
  'stripe-live-key.txt',
  'openai-key.txt',
  'aws-access-key.txt',
] as const

const config = { ...DEFAULT_CONFIG, secrets_files: [] as string[] }

/** Sort key for stable finding comparison (placeholder index may differ across calls). */
function comparable(findings: ReadonlyArray<{ ruleId: string; fingerprint: string; severity: string }>) {
  return findings
    .map((f) => `${f.ruleId}|${f.fingerprint}|${f.severity}`)
    .sort()
}

afterAll(async () => {
  await shutdownDetection()
})

describe('mrclean_check ⇄ hook path detection parity', () => {
  for (const file of POSITIVE_FIXTURES) {
    it(`detects the same findings via runDetectionReadOnly and runDetection: ${file}`, async () => {
      const text = readFileSync(join(FIXTURE_DIR, file), 'utf8')

      const sessionState = await initSessionState({
        sessionId: `parity-${file}`,
        homeDir: process.env['HOME'] ?? process.cwd(),
        cwd: process.cwd(),
        config,
      })
      const ctx: DetectionContext = {
        sessionId: `parity-${file}`,
        hookEvent: 'UserPromptSubmit',
        cwd: process.cwd(),
      }

      const hookResult = await runDetection(text, config, sessionState, ctx)
      const checkResult = await runDetectionReadOnly(text, config, sessionState, ctx)

      // 1. Non-empty: the check path must actually find the planted secret.
      expect(checkResult.findings.length).toBeGreaterThanOrEqual(1)

      // 2. Parity: identical rule/fingerprint/severity set across both code paths.
      expect(comparable(checkResult.findings)).toEqual(comparable(hookResult.findings))
    })
  }

  it('PreToolUse exempts mrclean MCP tools in BOTH install namespaces, but NOT foreign tools', async () => {
    // The self-exemption guard must fire regardless of how the MCP server was installed:
    //   - plugin install (live deployment): mcp__plugin_mrclean_mrclean__mrclean_<tool>
    //   - CLI install (`mrclean install`):   mcp__mrclean__mrclean_<tool>
    // and must NOT exempt a foreign server that exposes a similarly-named tool.
    const { handlePreToolUse } = await import('../../src/hook/handlers/pre-tool-use.js')

    // Real secret-shaped text so that, IF the guard fails to fire, substitution happens
    // and updatedInput becomes defined — surfacing the leak immediately.
    const stripeKey = ['sk', 'live', '51H8h2kLqVb3xYzPq4r5T6u7'].join('_')

    // Exempt cases: both namespaces, all three tools → passed through verbatim.
    for (const toolName of [
      'mcp__plugin_mrclean_mrclean__mrclean_redact',
      'mcp__plugin_mrclean_mrclean__mrclean_check',
      'mcp__plugin_mrclean_mrclean__mrclean_status',
      'mcp__mrclean__mrclean_redact',
      'mcp__mrclean__mrclean_check',
      'mcp__mrclean__mrclean_status',
    ]) {
      const output = await handlePreToolUse({
        session_id: 'parity-exempt',
        transcript_path: '/tmp/transcript',
        cwd: process.cwd(),
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
        tool_input: { text: stripeKey },
        tool_use_id: 'tool-self-parity',
      })
      expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
      expect(output.hookSpecificOutput.updatedInput).toBeUndefined()
    }

    // Negative case: a foreign server's lookalike tool is NOT exempt → substitution applied.
    const foreign = await handlePreToolUse({
      session_id: 'parity-foreign',
      transcript_path: '/tmp/transcript',
      cwd: process.cwd(),
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__notmrclean__mrclean_check',
      tool_input: { text: stripeKey },
      tool_use_id: 'tool-foreign-parity',
    })
    expect(foreign.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(foreign.hookSpecificOutput.updatedInput).toBeDefined()
    const updated = foreign.hookSpecificOutput.updatedInput as Record<string, unknown>
    expect(updated['text']).toContain('<MRCLEAN:')
  })

  it('returns ZERO findings on already-redacted placeholder text (documents the report artifact)', async () => {
    // This is what the tool actually received in the bug report: placeholder-only
    // text (the real secret was redacted upstream by the PreToolUse hook). Zero
    // findings here is CORRECT behaviour, not a defect.
    const alreadyRedacted =
      'here is <MRCLEAN:SECRET:001> and <MRCLEAN:SECRET:002> in a sentence'

    const sessionState = await initSessionState({
      sessionId: 'parity-redacted',
      homeDir: process.env['HOME'] ?? process.cwd(),
      cwd: process.cwd(),
      config,
    })
    const ctx: DetectionContext = {
      sessionId: 'parity-redacted',
      hookEvent: 'UserPromptSubmit',
      cwd: process.cwd(),
    }

    const checkResult = await runDetectionReadOnly(alreadyRedacted, config, sessionState, ctx)
    expect(checkResult.findings).toEqual([])
  })
})
