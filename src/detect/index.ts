/**
 * Detection orchestrator — Plan 02-04
 *
 * `runDetection` is the single entry point for all hook handlers. It wires
 * together the four detection layers, the placeholder manager, and the audit
 * log writer into one async function.
 *
 * Layer execution order (fixed, locked by CONTEXT §Detection-Layer Ordering):
 *   Layer 1 (secretlint + gitleaks) → Layer 2 (entropy) → Layer 3 (env) → Layer 4 (words)
 *
 * Span-coverage dedup:
 *   After each layer, covered spans are passed to the next layer so it skips
 *   already-claimed regions. `dedupBySpan` is applied after all four layers
 *   as a defense-in-depth pass to remove any residual cross-layer overlaps.
 *
 * Effective-action resolution pipeline (per finding, in this order):
 *   Step 8a — warn→audit normalization: Layer 4 may emit action='warn';
 *             the orchestrator normalises 'warn' → 'audit' BEFORE any other step.
 *   Step 8b — action-defined: if finding.action is set (after 8a) → effectiveAction = finding.action.
 *   Step 8c — severity-default (action undefined): CRITICAL/HIGH → 'block';
 *             MEDIUM → 'substitute'; LOW → 'audit'.
 *   Step 4  — dry_run coercion: if config.dry_run === true, applyDryRun() forces
 *             every effectiveAction to 'audit' and substitution is skipped.
 *
 * Detection-budget bail-out:
 *   If Layer 1 returns timeoutCount >= 5, the result carries budgetExhausted: true.
 *   The hook handlers (Plan 02-05) translate this into a deny path (fail-closed).
 *
 * Audit writes:
 *   One AuditRecord per finding is written via Promise.allSettled (fire-and-collect).
 *   Write failures are logged to stderr as single-line JSON warnings but do NOT throw —
 *   audit-log failures must NEVER break the hook response.
 *
 * WorkerPool lifetime:
 *   Module-level singleton created lazily on first call. Plan 02-05 calls
 *   shutdownDetection() on process exit to terminate pool workers cleanly.
 */

import type { Finding } from './findings.js'
import { dedupBySpan } from './findings.js'
import { runLayer1 } from './layer1-regex/index.js'
import { runLayer2Entropy } from './layer2-entropy.js'
import { runLayer3Env } from './layer3-env.js'
import { runLayer4Words } from './layer4-words.js'
import { WorkerPool } from './layer1-regex/worker-pool.js'
import { PlaceholderManager } from '../placeholder/manager.js'
import { substituteFindings } from '../placeholder/substitute.js'
import { writeAuditRecord, findingToAuditRecord } from '../audit/log.js'
import { getTypeForRuleId } from './type-map.js'
import { applyDryRun } from './dry-run.js'
import type { MrcleanConfig } from '../shared/types.js'
import type { SessionState } from './session-state.js'

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * Context passed into runDetection from the hook handler.
 * Carries the session identity + the hook event name + the project root path.
 */
export interface DetectionContext {
  /** Session UUID from Claude Code hook input (session_id). */
  sessionId: string
  /** The hook event that triggered this detection invocation. */
  hookEvent: 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse'
  /** Project root directory — used to resolve the .mrclean/audit.jsonl path. */
  cwd: string
}

/**
 * A Finding that has been through the full orchestrator pipeline:
 *   - placeholder allocated (stable per session + value)
 *   - effectiveAction resolved (warn normalised, severity-defaulted, dry_run coerced)
 *
 * NOTE: `effectiveAction` is NEVER 'warn' here — the orchestrator normalises Layer 4's
 * 'warn' token to 'audit' in step 8a before this type is produced.
 */
export interface ResolvedFinding extends Finding {
  /** Allocated placeholder string — e.g. '<MRCLEAN:AWS_KEY:001>'. */
  placeholder: string
  /** Post-dry_run-coercion action. Never 'warn'. */
  effectiveAction: 'block' | 'substitute' | 'audit'
}

/**
 * Result returned by runDetection to hook handlers.
 *
 * `substitutedText` is the redacted output to send downstream (or the original
 * text when dry_run is active).
 *
 * `budgetExhausted` signals that >= 5 Layer 1 regex timeouts occurred in this
 * invocation. The hook handler (Plan 02-05) translates this into a deny path.
 */
export interface DetectionResult {
  /** All resolved findings from this invocation. */
  findings: ResolvedFinding[]
  /** Text with placeholder substitutions applied (or original text if dry_run). */
  substitutedText: string
  /** True when Layer 1 returned timeoutCount >= 5 (fail-closed signal for hook). */
  budgetExhausted: boolean
  /** Raw timeout count from Layer 1 — 0 when no gitleaks timeouts occurred. */
  rawTimeoutCount: number
}

// ---------------------------------------------------------------------------
// Module-level singletons
// ---------------------------------------------------------------------------

/** Module-level WorkerPool — created lazily on first runDetection call. */
let pool: WorkerPool | null = null

/**
 * Get or create the module-level WorkerPool.
 *
 * Exported so Plan 02-05 can call terminate() on hook process shutdown.
 */
export function getOrCreatePool(): WorkerPool {
  if (!pool) pool = new WorkerPool(4)
  return pool
}

/** Module-level PlaceholderManager cache, keyed by sessionId. */
const cachedManagers = new Map<string, PlaceholderManager>()

/**
 * Get or create the PlaceholderManager for the given sessionId.
 *
 * Stability: the same PlaceholderManager instance is returned for the same
 * sessionId, ensuring same value → same placeholder across multiple calls
 * within the same process lifetime.
 */
function getOrCreateManager(sessionId: string): PlaceholderManager {
  let manager = cachedManagers.get(sessionId)
  if (!manager) {
    manager = new PlaceholderManager({ sessionId })
    cachedManagers.set(sessionId, manager)
  }
  return manager
}

/**
 * Shut down the module-level WorkerPool and clear the PlaceholderManager cache.
 *
 * Called by Plan 02-05's hook process exit handler to gracefully close workers.
 */
export async function shutdownDetection(): Promise<void> {
  if (pool) {
    await pool.terminate()
    pool = null
  }
  cachedManagers.clear()
}

// ---------------------------------------------------------------------------
// Severity → default action mapping
// ---------------------------------------------------------------------------

/**
 * Derive the default effectiveAction from a finding's severity when no explicit
 * action is set on the finding (step 8c in the resolution pipeline).
 */
function severityToDefaultAction(severity: Finding['severity']): 'block' | 'substitute' | 'audit' {
  switch (severity) {
    case 'CRITICAL':
    case 'HIGH':
      return 'block'
    case 'MEDIUM':
      return 'substitute'
    case 'LOW':
      return 'audit'
  }
}

// ---------------------------------------------------------------------------
// runDetectionReadOnly — audit-skipping variant for mrclean_check (Plan 03-01)
// ---------------------------------------------------------------------------

/**
 * Run all four detection layers against `text` and return a fully-resolved
 * DetectionResult WITHOUT writing any audit log records.
 *
 * This is the read-only variant used by `mrclean_check` (MCP-02). The check tool
 * is speculative — operators may be sampling text — so writing audit records for
 * every call would pollute the audit log with non-actionable entries.
 *
 * Threat model: T-03-01-03 — check.ts audit-log invariant (mrclean_check MUST NOT
 * write audit records). tests/mcp/check.test.ts verifies this at the file-system level.
 *
 * Implementation: identical to runDetection steps 1-11; Step 12 (Promise.allSettled
 * audit writes) is deliberately omitted. The returned DetectionResult shape is the same.
 *
 * @param text         - The raw input text to scan.
 * @param config       - Effective mrclean configuration.
 * @param sessionState - Session-scoped state (envBlocklist, wordEntries).
 * @param ctx          - Detection context (sessionId, hookEvent, cwd).
 * @returns            - DetectionResult with findings + substitutedText but NO audit writes.
 */
export async function runDetectionReadOnly(
  text: string,
  config: MrcleanConfig,
  sessionState: SessionState,
  ctx: DetectionContext,
): Promise<DetectionResult> {
  const workerPool = getOrCreatePool()
  const manager = getOrCreateManager(ctx.sessionId)

  const l1 = await runLayer1(text, config, workerPool)
  const findings: Finding[] = [...l1.findings]
  const timeoutCount = l1.timeoutCount

  const l2 = runLayer2Entropy(text, config, findings.map((f) => f.span))
  findings.push(...l2)

  const l3 = runLayer3Env(text, sessionState.envBlocklist, findings.map((f) => f.span))
  findings.push(...l3)

  const l4 = runLayer4Words(text, sessionState.wordEntries, findings.map((f) => f.span))
  findings.push(...l4)

  const deduped = dedupBySpan(findings)

  for (const f of deduped) {
    if (f.action === 'warn') {
      f.action = 'audit'
    }
  }

  const resolvedFindings: ResolvedFinding[] = deduped.map((f) => {
    const effectiveAction: 'block' | 'substitute' | 'audit' =
      f.action !== undefined
        ? (f.action as 'block' | 'substitute' | 'audit')
        : severityToDefaultAction(f.severity)

    const type = getTypeForRuleId(f.ruleId)
    const entry = manager.allocate(f.value, type)

    return { ...f, placeholder: entry.placeholder, effectiveAction }
  })

  const finalFindings = config.dry_run ? applyDryRun(resolvedFindings) : resolvedFindings

  const substitutedText = config.dry_run
    ? text
    : substituteFindings(text, finalFindings)

  // Step 12 deliberately OMITTED — no audit writes for read-only check tool.

  return {
    findings: finalFindings,
    substitutedText,
    budgetExhausted: timeoutCount >= 5,
    rawTimeoutCount: timeoutCount,
  }
}

// ---------------------------------------------------------------------------
// runDetection — main entry point
// ---------------------------------------------------------------------------

/**
 * Run all four detection layers against `text` and return a fully-resolved
 * DetectionResult ready for the hook handler to consume.
 *
 * @param text         - The raw input text to scan (prompt, tool arg, tool output).
 * @param config       - Effective mrclean configuration (dry_run, entropy, allowlist, rules).
 * @param sessionState - Session-scoped state (envBlocklist from Layer 3, wordEntries from Layer 4).
 * @param ctx          - Hook invocation context (sessionId, hookEvent, cwd).
 * @returns            - DetectionResult with findings, substitutedText, budgetExhausted flag.
 */
export async function runDetection(
  text: string,
  config: MrcleanConfig,
  sessionState: SessionState,
  ctx: DetectionContext,
): Promise<DetectionResult> {
  // Step 1: Get or create the module-level WorkerPool
  const workerPool = getOrCreatePool()

  // Step 2: Get or create the session-scoped PlaceholderManager
  const manager = getOrCreateManager(ctx.sessionId)

  // ---------------------------------------------------------------------------
  // Layer execution: L1 → L2 → L3 → L4 with running span accumulation
  // ---------------------------------------------------------------------------

  // Step 3: Layer 1 — secretlint + gitleaks (async, ReDoS-safe via worker pool)
  const l1 = await runLayer1(text, config, workerPool)
  const findings: Finding[] = [...l1.findings]
  const timeoutCount = l1.timeoutCount

  // Step 4: Layer 2 — Shannon entropy detection (sync)
  const l2 = runLayer2Entropy(text, config, findings.map((f) => f.span))
  findings.push(...l2)

  // Step 5: Layer 3 — env blocklist literal matching (sync)
  const l3 = runLayer3Env(text, sessionState.envBlocklist, findings.map((f) => f.span))
  findings.push(...l3)

  // Step 6: Layer 4 — dirty-word list matching (sync)
  const l4 = runLayer4Words(text, sessionState.wordEntries, findings.map((f) => f.span))
  findings.push(...l4)

  // Step 7: Defense-in-depth dedup — removes any residual cross-layer overlaps
  const deduped = dedupBySpan(findings)

  // ---------------------------------------------------------------------------
  // Step 8a: warn → audit normalization (SINGLE normalization point)
  //
  // Layer 4 may emit Finding.action = 'warn' (user-friendly word-list token).
  // The orchestrator normalises this to 'audit' HERE, before step 8b reads
  // finding.action. This ensures 'warn' NEVER appears on a ResolvedFinding.
  //
  // LOCKED CRITERION: Layer 4 wordEntry.action == 'warn' produces
  //   ResolvedFinding.effectiveAction == 'audit' (proven by orchestrator test 4).
  // ---------------------------------------------------------------------------
  for (const f of deduped) {
    if (f.action === 'warn') {
      f.action = 'audit'
    }
  }

  // ---------------------------------------------------------------------------
  // Steps 8b + 8c + placeholder allocation: resolve effectiveAction per finding
  // ---------------------------------------------------------------------------
  const resolvedFindings: ResolvedFinding[] = deduped.map((f) => {
    // Step 8b: use finding.action if explicitly set (after 8a normalisation)
    // Step 8c: fall back to severity-default when action is undefined
    const effectiveAction: 'block' | 'substitute' | 'audit' =
      f.action !== undefined
        ? (f.action as 'block' | 'substitute' | 'audit')
        : severityToDefaultAction(f.severity)

    // Allocate placeholder (stable: same value → same placeholder per session)
    const type = getTypeForRuleId(f.ruleId)
    const entry = manager.allocate(f.value, type)

    return { ...f, placeholder: entry.placeholder, effectiveAction }
  })

  // ---------------------------------------------------------------------------
  // Step 4 (dry_run): coerce all effectiveActions to 'audit' when dry_run active
  // ---------------------------------------------------------------------------
  const finalFindings = config.dry_run ? applyDryRun(resolvedFindings) : resolvedFindings

  // ---------------------------------------------------------------------------
  // Step 11: Compute substituted text
  // In dry_run mode: substitutedText === original text (placeholders computed but not applied)
  // Otherwise: replace each finding's span with its placeholder string
  // ---------------------------------------------------------------------------
  const substitutedText = config.dry_run
    ? text
    : substituteFindings(text, finalFindings)

  // ---------------------------------------------------------------------------
  // Step 12: Write audit records in parallel (fire-and-collect)
  // Failures are logged to stderr as single-line JSON warnings — never thrown.
  // ---------------------------------------------------------------------------
  const auditResults = await Promise.allSettled(
    finalFindings.map((f) =>
      writeAuditRecord(ctx.cwd, findingToAuditRecord(f, ctx.sessionId, ctx.hookEvent, f.effectiveAction)),
    ),
  )

  for (const outcome of auditResults) {
    if (outcome.status === 'rejected') {
      process.stderr.write(
        JSON.stringify({ warn: 'mrclean audit write failed', reason: String(outcome.reason) }) + '\n',
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Step 13: Return DetectionResult
  // ---------------------------------------------------------------------------
  return {
    findings: finalFindings,
    substitutedText,
    budgetExhausted: timeoutCount >= 5,
    rawTimeoutCount: timeoutCount,
  }
}
