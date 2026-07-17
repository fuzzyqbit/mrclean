/**
 * Reversible-mode handler behavior suite (Plan 09-07, REVMODE-02/04/05).
 *
 * Proves the ONLY two substitution sites (PreToolUse + PostToolUse) wire the
 * session store correctly:
 *   - gate: config.reversible.enabled OUTERMOST, then the strict UUID sid
 *     allowlist (invalid sid ⇒ one-way, zero facade calls past the gate);
 *   - hydrate BEFORE detection (readSessionMapForHydration → hydrateSessionManager);
 *   - EXACTLY ONE locked persist per hook event, batched across all string
 *     leaves (RESEARCH Pattern 2 — substituteToolInputDeep recurses per leaf);
 *   - reconcile renames applied to the EMITTED payload (updatedInput tree /
 *     updatedToolOutput string) — the wire never carries a provisional token
 *     that lost its race;
 *   - drain-and-DISCARD on the deny (budget) and dry_run paths (T-09-07-04 —
 *     the store only learns allocations that actually shipped);
 *   - ANY facade failure ⇒ one-way behavior, never a throw (Pitfall 6 —
 *     a throw would become blocking exit-2 via installCrashGuards).
 *
 * Seam (session-end.test.ts precedent): vi.mock of src/state/index.js —
 * vitest intercepts the handler's dynamic `await import()` exactly like a
 * static import. isValidSessionId + applyRenames{Deep,ToText} stay REAL
 * (importOriginal spread) so the sid gate and rename application are the
 * shipped implementations; only the store I/O pair is stubbed. The detect
 * seam (runDetection / hydrateSessionManager / drainSessionAllocations) is
 * spied per test on the real module namespace (handlers-detection.test.ts
 * idiom) — allocation mechanics themselves are covered by tests/state/.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock seams (hoisted — factories must not touch file-scope consts)
// ---------------------------------------------------------------------------

vi.mock('../../src/config/index.js', () => ({
  loadEffectiveConfig: vi.fn(),
}))

vi.mock('../../src/detect/session-state.js', () => ({
  initSessionState: vi.fn().mockResolvedValue({
    sessionId: 'cached',
    envBlocklist: new Map(),
    wordEntries: [],
    createdAt: new Date().toISOString(),
  }),
  getCachedSessionState: vi.fn().mockReturnValue({
    sessionId: 'cached',
    envBlocklist: new Map(),
    wordEntries: [],
    createdAt: new Date().toISOString(),
  }),
  setCachedSessionState: vi.fn(),
}))

vi.mock('../../src/state/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state/index.js')>()
  return {
    ...actual, // real isValidSessionId + real applyRenamesDeep/applyRenamesToText
    readSessionMapForHydration: vi.fn(),
    persistAllocations: vi.fn(),
  }
})

import { handlePreToolUse } from '../../src/hook/handlers/pre-tool-use.js'
import { handlePostToolUse } from '../../src/hook/handlers/post-tool-use.js'
import { loadEffectiveConfig } from '../../src/config/index.js'
import { readSessionMapForHydration, persistAllocations } from '../../src/state/index.js'
import { POST_LOCK_DEADLINE_MS } from '../../src/state/lock.js'
import * as detectMod from '../../src/detect/index.js'
import { DEFAULT_CONFIG } from '../../src/config/defaults.js'
import type { MrcleanConfig, PreToolUseInput, PostToolUseInput } from '../../src/shared/types.js'
import type { DetectionResult, ResolvedFinding } from '../../src/detect/index.js'
import type { PendingAllocation, ReversibleHydration } from '../../src/state/session-map.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** UUID-shaped sid — passes the state-layer allowlist (Pitfall 5). */
const UUID_SID = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff'

/** Fails the SESSION_ID_RE allowlist by design (session-end.test.ts note). */
const INVALID_SID = 'test-session'

const SECRET_A = 'sk_live_AAAAAAAAAAAAAAAAAAAA'
const SECRET_B = 'sk_live_BBBBBBBBBBBBBBBBBBBB'

/** Provisional v2 tokens allocated in-process during detection. */
const PROV_A = '<MRCLEAN:GENERIC:001:aaaaaaaa>'
const PROV_B = '<MRCLEAN:GENERIC:002:aaaaaaaa>'

/** Store-authoritative tokens after the locked reconcile (renames applied). */
const FINAL_A = '<MRCLEAN:GENERIC:007:deadbeef>'
const FINAL_B = '<MRCLEAN:GENERIC:008:deadbeef>'

const PENDING: PendingAllocation[] = [
  { value: SECRET_A, type: 'GENERIC', provisionalPlaceholder: PROV_A },
  { value: SECRET_B, type: 'GENERIC', provisionalPlaceholder: PROV_B },
]

const HYDRATION: ReversibleHydration = {
  nonce8: 'deadbeef',
  counterFloor: 6,
  entriesByHmac: new Map(),
  hmacOf: (value: string) => `hmac:${value}`,
  formatToken: (type: string, counter: number) =>
    `<MRCLEAN:${type}:${String(counter).padStart(3, '0')}:deadbeef>`,
}

const REVERSIBLE_ON: MrcleanConfig = {
  ...DEFAULT_CONFIG,
  dry_run: false,
  reversible: { enabled: true, ttl_hours: 24 },
}

const REVERSIBLE_ON_DRY_RUN: MrcleanConfig = {
  ...DEFAULT_CONFIG,
  dry_run: true,
  reversible: { enabled: true, ttl_hours: 24 },
}

const REVERSIBLE_OFF: MrcleanConfig = {
  ...DEFAULT_CONFIG,
  dry_run: false,
  reversible: { enabled: false, ttl_hours: 24 },
}

function makeFinding(value: string, placeholder: string): ResolvedFinding {
  return {
    ruleId: 'gitleaks:generic-api-key',
    severity: 'HIGH',
    span: { start: 0, end: value.length },
    value,
    redactedHash: 'cafe0123cafe0123',
    fingerprint: 'gitleaks:generic-api-key:cafe0123cafe0123',
    source: 'gitleaks',
    placeholder,
    effectiveAction: 'substitute',
  }
}

function makeResult(substitutedText: string, findings: ResolvedFinding[]): DetectionResult {
  return {
    findings,
    substitutedText,
    budgetExhausted: false,
    rawTimeoutCount: 0,
    nerStatus: 'disabled',
  }
}

const BUDGET_EXHAUSTED_RESULT: DetectionResult = {
  findings: [],
  substitutedText: '',
  budgetExhausted: true,
  rawTimeoutCount: 5,
  nerStatus: 'disabled',
}

/** Two string leaves, each carrying a distinct secret (batching fixture). */
function twoLeafInput(sid: string): PreToolUseInput {
  return {
    hook_event_name: 'PreToolUse',
    session_id: sid,
    transcript_path: '/tmp/transcript',
    cwd: '/tmp',
    tool_name: 'Bash',
    tool_input: { command: `deploy --token ${SECRET_A}`, description: `uses ${SECRET_B}` },
    tool_use_id: 'tool-123',
  }
}

/** PostToolUse fixture — single-string path (Step 3 coerces to string). */
function postInput(sid: string, response: unknown): PostToolUseInput {
  return {
    hook_event_name: 'PostToolUse',
    session_id: sid,
    transcript_path: '/tmp/transcript',
    cwd: '/tmp',
    tool_name: 'Bash',
    tool_input: { command: 'deploy' },
    tool_response: response,
    tool_use_id: 'tool-123',
  }
}

/**
 * Per-leaf detection stub: one finding per secret-bearing string, provisional
 * tokens substituted in the returned text (real-orchestrator shape).
 */
function spyDetectionPerLeaf() {
  return vi.spyOn(detectMod, 'runDetection').mockImplementation(async (text) => {
    if (text.includes(SECRET_A)) {
      return makeResult(text.split(SECRET_A).join(PROV_A), [makeFinding(SECRET_A, PROV_A)])
    }
    if (text.includes(SECRET_B)) {
      return makeResult(text.split(SECRET_B).join(PROV_B), [makeFinding(SECRET_B, PROV_B)])
    }
    return makeResult(text, [])
  })
}

function spyHydrate() {
  return vi.spyOn(detectMod, 'hydrateSessionManager').mockImplementation(() => {})
}

function spyDrain(pending: PendingAllocation[] = [...PENDING]) {
  return vi.spyOn(detectMod, 'drainSessionAllocations').mockReturnValue(pending)
}

/** One-way emission for the two-leaf fixture — provisional tokens stand. */
const ONE_WAY_TWO_LEAF_OUTPUT = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    permissionDecisionReason: '[mrclean] substituted 2 secret(s)',
    updatedInput: {
      command: `deploy --token ${PROV_A}`,
      description: `uses ${PROV_B}`,
    },
  },
} as const

beforeEach(() => {
  vi.mocked(loadEffectiveConfig).mockReset()
  vi.mocked(readSessionMapForHydration).mockReset()
  vi.mocked(persistAllocations).mockReset()
  // Defaults — individual tests override
  vi.mocked(readSessionMapForHydration).mockResolvedValue(HYDRATION)
  vi.mocked(persistAllocations).mockResolvedValue({ status: 'ok', renames: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// PreToolUse (Task 1)
// ---------------------------------------------------------------------------

describe('handlePreToolUse — reversible branch (09-07 Task 1)', () => {
  it('enabled + UUID sid + two secret leaves: hydrates once BEFORE detection and persists EXACTLY ONCE with both allocations (batching proof)', async () => {
    // Arrange
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_ON)
    const runSpy = spyDetectionPerLeaf()
    const hydrateSpy = spyHydrate()
    const drainSpy = spyDrain()

    // Act
    await handlePreToolUse(twoLeafInput(UUID_SID))

    // Assert — hydrate: one store read, one manager hydration, BEFORE detection
    expect(readSessionMapForHydration).toHaveBeenCalledTimes(1)
    expect(readSessionMapForHydration).toHaveBeenCalledWith({ sessionId: UUID_SID })
    expect(hydrateSpy).toHaveBeenCalledTimes(1)
    expect(hydrateSpy).toHaveBeenCalledWith(UUID_SID, HYDRATION)
    expect(vi.mocked(readSessionMapForHydration).mock.invocationCallOrder[0]!).toBeLessThan(
      runSpy.mock.invocationCallOrder[0]!,
    )

    // Assert — detection ran per leaf (2 leaves) but drain+persist batched to ONE
    expect(runSpy).toHaveBeenCalledTimes(2)
    expect(drainSpy).toHaveBeenCalledTimes(1)
    expect(persistAllocations).toHaveBeenCalledTimes(1)
    expect(persistAllocations).toHaveBeenCalledWith({
      sessionId: UUID_SID,
      pending: PENDING,
      deadlineMs: POST_LOCK_DEADLINE_MS,
    })
  })

  it('persist renames are applied at every leaf of updatedInput — zero from-tokens anywhere in the response JSON', async () => {
    // Arrange
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_ON)
    spyDetectionPerLeaf()
    spyHydrate()
    spyDrain()
    vi.mocked(persistAllocations).mockResolvedValue({
      status: 'ok',
      renames: [
        { from: PROV_A, to: FINAL_A },
        { from: PROV_B, to: FINAL_B },
      ],
    })

    // Act
    const output = await handlePreToolUse(twoLeafInput(UUID_SID))

    // Assert — every leaf carries the store-authoritative token
    expect(output.hookSpecificOutput.updatedInput).toEqual({
      command: `deploy --token ${FINAL_A}`,
      description: `uses ${FINAL_B}`,
    })
    // Assert — no provisional token survives ANYWHERE on the wire
    const wire = JSON.stringify(output)
    expect(wire).not.toContain(PROV_A)
    expect(wire).not.toContain(PROV_B)
  })

  it("persist status 'degraded': provisional tokens stand, response shape otherwise identical", async () => {
    // Arrange
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_ON)
    spyDetectionPerLeaf()
    spyHydrate()
    spyDrain()
    vi.mocked(persistAllocations).mockResolvedValue({ status: 'degraded', renames: [] })

    // Act
    const output = await handlePreToolUse(twoLeafInput(UUID_SID))

    // Assert — persist WAS attempted, emission is the untouched one-way shape
    expect(persistAllocations).toHaveBeenCalledTimes(1)
    expect(output).toEqual(ONE_WAY_TWO_LEAF_OUTPUT)
  })

  it('enabled + INVALID sid: no facade work past the gate, output identical to one-way', async () => {
    // Arrange
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_ON)
    spyDetectionPerLeaf()
    const hydrateSpy = spyHydrate()
    const drainSpy = spyDrain()

    // Act
    const output = await handlePreToolUse(twoLeafInput(INVALID_SID))

    // Assert — the real isValidSessionId rejects 'test-session'; nothing else runs
    expect(readSessionMapForHydration).not.toHaveBeenCalled()
    expect(persistAllocations).not.toHaveBeenCalled()
    expect(hydrateSpy).not.toHaveBeenCalled()
    expect(drainSpy).not.toHaveBeenCalled()
    expect(output).toEqual(ONE_WAY_TWO_LEAF_OUTPUT)
  })

  it('disabled: readSessionMapForHydration NEVER called, output byte-identical to one-way', async () => {
    // Arrange
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_OFF)
    spyDetectionPerLeaf()
    const hydrateSpy = spyHydrate()
    const drainSpy = spyDrain()

    // Act
    const output = await handlePreToolUse(twoLeafInput(UUID_SID))

    // Assert — zero reversible work
    expect(readSessionMapForHydration).not.toHaveBeenCalled()
    expect(persistAllocations).not.toHaveBeenCalled()
    expect(hydrateSpy).not.toHaveBeenCalled()
    expect(drainSpy).not.toHaveBeenCalled()
    // Byte-identical (D-10): serialized wire form matches one-way exactly
    expect(JSON.stringify(output)).toBe(JSON.stringify(ONE_WAY_TWO_LEAF_OUTPUT))
  })

  it('budget-exhausted deny path with reversible active: drain-DISCARD, no persist, deny response unchanged', async () => {
    // Arrange
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_ON)
    vi.spyOn(detectMod, 'runDetection').mockResolvedValue(BUDGET_EXHAUSTED_RESULT)
    spyHydrate()
    const drainSpy = spyDrain()

    // Act
    const output = await handlePreToolUse(twoLeafInput(UUID_SID))

    // Assert — allocations discarded (T-09-07-04), nothing persisted
    expect(drainSpy).toHaveBeenCalledTimes(1)
    expect(persistAllocations).not.toHaveBeenCalled()
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          '[mrclean] detection budget exhausted — tool call blocked for safety',
      },
    })
  })

  it('dry_run with reversible active: drain-DISCARD, no persist, dry-run response unchanged', async () => {
    // Arrange — dry_run substitutes nothing, so a persisted entry would be an orphan
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_ON_DRY_RUN)
    spyDetectionPerLeaf()
    spyHydrate()
    const drainSpy = spyDrain()

    // Act
    const output = await handlePreToolUse(twoLeafInput(UUID_SID))

    // Assert
    expect(drainSpy).toHaveBeenCalledTimes(1)
    expect(persistAllocations).not.toHaveBeenCalled()
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: '[mrclean] dry_run: 2 detection(s) logged, no substitution',
      },
    })
  })

  it("Step 0 self-exemption (mrclean's own MCP tools) short-circuits BEFORE any reversible work", async () => {
    // Arrange
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_ON)
    const runSpy = spyDetectionPerLeaf()
    const hydrateSpy = spyHydrate()

    // Act
    const output = await handlePreToolUse({
      ...twoLeafInput(UUID_SID),
      tool_name: 'mcp__mrclean__mrclean_redact',
    })

    // Assert — exemption precedes config load, hydration, and detection
    expect(output).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    })
    expect(loadEffectiveConfig).not.toHaveBeenCalled()
    expect(readSessionMapForHydration).not.toHaveBeenCalled()
    expect(hydrateSpy).not.toHaveBeenCalled()
    expect(runSpy).not.toHaveBeenCalled()
  })

  it('facade hydration REJECTS: one-way fallback, never a throw (Pitfall 6 wall)', async () => {
    // Arrange — the read path is total in production; this simulates a facade bug
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_ON)
    vi.mocked(readSessionMapForHydration).mockRejectedValue(new Error('store exploded'))
    spyDetectionPerLeaf()
    const hydrateSpy = spyHydrate()
    const drainSpy = spyDrain()

    // Act — must resolve, not reject (a throw becomes exit-2 via installCrashGuards)
    const output = await handlePreToolUse(twoLeafInput(UUID_SID))

    // Assert — one-way emission, no downstream reversible work
    expect(hydrateSpy).not.toHaveBeenCalled()
    expect(drainSpy).not.toHaveBeenCalled()
    expect(persistAllocations).not.toHaveBeenCalled()
    expect(output).toEqual(ONE_WAY_TWO_LEAF_OUTPUT)
  })
})

// ---------------------------------------------------------------------------
// PostToolUse (Task 2)
// ---------------------------------------------------------------------------

const TOOL_RESPONSE = `log line with ${SECRET_A} token`

const PENDING_SINGLE: PendingAllocation[] = [
  { value: SECRET_A, type: 'GENERIC', provisionalPlaceholder: PROV_A },
]

/** One-way emission for the single-string fixture — provisional token stands. */
const ONE_WAY_POST_OUTPUT = {
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    updatedToolOutput: `log line with ${PROV_A} token`,
    additionalContext: '[mrclean] substituted 1 secret(s) in tool output',
  },
} as const

describe('handlePostToolUse — reversible branch (09-07 Task 2)', () => {
  it('enabled + UUID sid + detectable secret: hydrate BEFORE detection, ONE persist, renames applied to the STRING updatedToolOutput (E1 shape unchanged)', async () => {
    // Arrange
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_ON)
    const runSpy = spyDetectionPerLeaf()
    const hydrateSpy = spyHydrate()
    const drainSpy = spyDrain([...PENDING_SINGLE])
    vi.mocked(persistAllocations).mockResolvedValue({
      status: 'ok',
      renames: [{ from: PROV_A, to: FINAL_A }],
    })

    // Act
    const output = await handlePostToolUse(postInput(UUID_SID, TOOL_RESPONSE))

    // Assert — hydrate happened once, BEFORE runDetection
    expect(readSessionMapForHydration).toHaveBeenCalledTimes(1)
    expect(readSessionMapForHydration).toHaveBeenCalledWith({ sessionId: UUID_SID })
    expect(hydrateSpy).toHaveBeenCalledTimes(1)
    expect(hydrateSpy).toHaveBeenCalledWith(UUID_SID, HYDRATION)
    expect(vi.mocked(readSessionMapForHydration).mock.invocationCallOrder[0]!).toBeLessThan(
      runSpy.mock.invocationCallOrder[0]!,
    )

    // Assert — exactly one drain + one locked persist for the event
    expect(drainSpy).toHaveBeenCalledTimes(1)
    expect(persistAllocations).toHaveBeenCalledTimes(1)
    expect(persistAllocations).toHaveBeenCalledWith({
      sessionId: UUID_SID,
      pending: PENDING_SINGLE,
      deadlineMs: POST_LOCK_DEADLINE_MS,
    })

    // Assert — E1 contract: STRING updatedToolOutput, exact one-way key set
    const hso = output?.hookSpecificOutput
    expect(hso).toBeDefined()
    expect(typeof hso?.updatedToolOutput).toBe('string')
    expect(Object.keys(hso!)).toEqual(['hookEventName', 'updatedToolOutput', 'additionalContext'])

    // Assert — rename applied; provisional token never reaches the wire
    expect(hso?.updatedToolOutput).toBe(`log line with ${FINAL_A} token`)
    expect(JSON.stringify(output)).not.toContain(PROV_A)
  })

  it("persist status 'degraded': provisional token stands, response shape otherwise identical", async () => {
    // Arrange
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_ON)
    spyDetectionPerLeaf()
    spyHydrate()
    spyDrain([...PENDING_SINGLE])
    vi.mocked(persistAllocations).mockResolvedValue({ status: 'degraded', renames: [] })

    // Act
    const output = await handlePostToolUse(postInput(UUID_SID, TOOL_RESPONSE))

    // Assert — persist WAS attempted, emission is the untouched one-way shape
    expect(persistAllocations).toHaveBeenCalledTimes(1)
    expect(output).toEqual(ONE_WAY_POST_OUTPUT)
  })

  it('enabled + INVALID sid: no facade work past the gate, output identical to one-way', async () => {
    // Arrange
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_ON)
    spyDetectionPerLeaf()
    const hydrateSpy = spyHydrate()
    const drainSpy = spyDrain([...PENDING_SINGLE])

    // Act
    const output = await handlePostToolUse(postInput(INVALID_SID, TOOL_RESPONSE))

    // Assert
    expect(readSessionMapForHydration).not.toHaveBeenCalled()
    expect(persistAllocations).not.toHaveBeenCalled()
    expect(hydrateSpy).not.toHaveBeenCalled()
    expect(drainSpy).not.toHaveBeenCalled()
    expect(output).toEqual(ONE_WAY_POST_OUTPUT)
  })

  it('disabled: readSessionMapForHydration NEVER called, output byte-identical to one-way', async () => {
    // Arrange
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_OFF)
    spyDetectionPerLeaf()
    const hydrateSpy = spyHydrate()
    const drainSpy = spyDrain([...PENDING_SINGLE])

    // Act
    const output = await handlePostToolUse(postInput(UUID_SID, TOOL_RESPONSE))

    // Assert — zero reversible work; wire form byte-identical (D-10)
    expect(readSessionMapForHydration).not.toHaveBeenCalled()
    expect(persistAllocations).not.toHaveBeenCalled()
    expect(hydrateSpy).not.toHaveBeenCalled()
    expect(drainSpy).not.toHaveBeenCalled()
    expect(JSON.stringify(output)).toBe(JSON.stringify(ONE_WAY_POST_OUTPUT))
  })

  it('budget-exhausted with reversible active: drain-DISCARD, no persist, null + stderr warn unchanged', async () => {
    // Arrange
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_ON)
    vi.spyOn(detectMod, 'runDetection').mockResolvedValue(BUDGET_EXHAUSTED_RESULT)
    spyHydrate()
    const drainSpy = spyDrain([...PENDING_SINGLE])
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    // Act
    const output = await handlePostToolUse(postInput(UUID_SID, TOOL_RESPONSE))

    // Assert — pass-through null; allocations discarded; warn line preserved
    expect(output).toBeNull()
    expect(drainSpy).toHaveBeenCalledTimes(1)
    expect(persistAllocations).not.toHaveBeenCalled()
    const warnLines = stderrSpy.mock.calls.map((c) => String(c[0]))
    expect(
      warnLines.some((l) => l.includes('mrclean detection budget exhausted on PostToolUse')),
    ).toBe(true)
  })

  it('dry_run with reversible active: drain-DISCARD, no persist, null response unchanged', async () => {
    // Arrange
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_ON_DRY_RUN)
    spyDetectionPerLeaf()
    spyHydrate()
    const drainSpy = spyDrain([...PENDING_SINGLE])

    // Act
    const output = await handlePostToolUse(postInput(UUID_SID, TOOL_RESPONSE))

    // Assert
    expect(output).toBeNull()
    expect(drainSpy).toHaveBeenCalledTimes(1)
    expect(persistAllocations).not.toHaveBeenCalled()
  })

  it('persistAllocations REJECTS: one-way emission, never a throw (Pitfall 6 wall)', async () => {
    // Arrange — the write path degrades in production; this simulates a facade bug
    vi.mocked(loadEffectiveConfig).mockResolvedValue(REVERSIBLE_ON)
    spyDetectionPerLeaf()
    spyHydrate()
    spyDrain([...PENDING_SINGLE])
    vi.mocked(persistAllocations).mockRejectedValue(new Error('lock exploded'))

    // Act — must resolve, not reject
    const output = await handlePostToolUse(postInput(UUID_SID, TOOL_RESPONSE))

    // Assert — provisional token stands, exact one-way shape
    expect(output).toEqual(ONE_WAY_POST_OUTPUT)
  })
})
