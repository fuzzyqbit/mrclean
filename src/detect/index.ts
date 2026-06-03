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
import { runLayer6aPii } from './layer6a-pii.js'
import { dropNerOverlaps } from './ner-overlap.js'
import { WorkerPool } from './layer1-regex/worker-pool.js'
import { PlaceholderManager } from '../placeholder/manager.js'
import { substituteFindings } from '../placeholder/substitute.js'
import { writeAuditRecord, findingToAuditRecord } from '../audit/log.js'
import type { FindingProvenance } from '../audit/log.js'
import { getTypeForRuleId } from './type-map.js'
import { applyDryRun } from './dry-run.js'
import { getNerBackend, resetNerSingleton } from '../model/pipeline-singleton.js'
import { PINNED_MODEL_SHA256 } from '../model/constants.js'
import type { MrcleanConfig } from '../shared/types.js'
import type { SessionState } from './session-state.js'
// TYPE-ONLY import of the NER status union. The NER engine module (layer6b-ner.ts) and its
// `@huggingface/transformers` dynamic import are reached ONLY via a dynamic import inside the
// MCP-gated L6b branch below — never as a runtime static import (cold-path safety, T-06-02-01).
import type { NerStatus } from './layer6b-ner.js'

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
  /**
   * Lifecycle status of the Layer 6b NER pass (D-03/D-05). 'disabled' when the L6b branch
   * was not entered (the cold/hook path always yields 'disabled'); 'ready'/'unavailable'
   * reflect the engine outcome when opts.ner && config.pii.ner.enabled. 06-03 surfaces this
   * in the check/redact structuredContent.
   */
  nerStatus: NerStatus
}

/**
 * Per-call detection options. The `ner` flag is the MCP-only opt-in gate for Layer 6b.
 *
 * Hook handlers (src/hook/handlers/*.ts) call runDetection WITHOUT opts, so `opts.ner` is
 * `undefined` and the L6b branch — the ONLY place layer6b-ner.js (and its dynamic
 * `@huggingface/transformers` import) is reached — is structurally unreachable from the cold
 * path (NER-01, D-04, T-06-02-01). Only the MCP check/redact tools pass `{ ner: true }`.
 */
export interface DetectionOptions {
  /** Enable the Layer 6b NER pass for this call. MCP-only — never set by hook handlers. */
  ner?: boolean
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
  // Clear the warm NER pipeline singleton so the next process/MCP boot rebuilds cleanly.
  // supervisor.ts re-exports shutdownDetection as shutdownMcpSupervisor, so the MCP shutdown
  // chain clears the singleton here. resetNerSingleton() touches NO transformers runtime — it
  // only nulls a module-level cached promise — so it is cold-path-safe to import statically.
  resetNerSingleton()
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
  opts: DetectionOptions = {},
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

  // Layer 6a — regex-PII hot-path lane (Plan 05-01)
  // Guarded by pii.enabled && pii.regex.enabled; skipped entirely on default config (pii off).
  // The 3rd argument `config` threads the 5-axis allowlist into L6a (PII-02).
  if (config.pii.enabled && config.pii.regex.enabled) {
    const l6a = runLayer6aPii(text, config.pii.regex, config, findings.map((f) => f.span))
    findings.push(...l6a)
  }

  // Layer 6b — NER lane (Plan 06-02, MCP-only). Entered ONLY when the caller opts in AND the
  // config enables NER. layer6b-ner.js (and its `@huggingface/transformers` dynamic import) is
  // reached EXCLUSIVELY through this `await import` — never a static import (NER-01, T-06-02-01).
  let nerStatus: NerStatus = 'disabled'
  if (opts.ner && config.pii.ner.enabled) {
    const { runLayer6bNer } = await import('./layer6b-ner.js')
    const out = await runLayer6bNer(text, config.pii.ner, config, findings.map((f) => f.span))
    findings.push(...out.findings)
    nerStatus = out.status
  }

  // D-11 cross-source NER overlap drop — runs IMMEDIATELY before dedupBySpan so the generic
  // dedup stays pure. A no-op when no pii-ner findings are present (cold/hook path).
  const filtered = dropNerOverlaps(findings)
  const deduped = dedupBySpan(filtered)

  const resolvedFindings: ResolvedFinding[] = deduped.map((f) => {
    // Step 8a — warn→audit normalization, done immutably (never mutate the shared
    // Finding; the prior in-place loop violated the project immutability rule and was
    // redundant with this spread).
    const action = f.action === 'warn' ? 'audit' : f.action
    const effectiveAction: 'block' | 'substitute' | 'audit' =
      action !== undefined
        ? (action as 'block' | 'substitute' | 'audit')
        : severityToDefaultAction(f.severity)

    const type = getTypeForRuleId(f.ruleId)
    const entry = manager.allocate(f.value, type)

    return { ...f, action, placeholder: entry.placeholder, effectiveAction }
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
    nerStatus,
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
  opts: DetectionOptions = {},
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

  // Step 6a: Layer 6a — regex-PII hot-path lane (Plan 05-01)
  // Guarded by pii.enabled && pii.regex.enabled; skipped entirely on default config (pii off).
  // The 3rd argument `config` threads the 5-axis allowlist into L6a (PII-02).
  // INSERT after L4, before dedupBySpan — per orchestrator wiring spec.
  if (config.pii.enabled && config.pii.regex.enabled) {
    const l6a = runLayer6aPii(text, config.pii.regex, config, findings.map((f) => f.span))
    findings.push(...l6a)
  }

  // Step 6b: Layer 6b — NER lane (Plan 06-02, MCP-only).
  // Entered ONLY when the caller opts in (opts.ner) AND config.pii.ner.enabled. Hook handlers
  // never pass opts, so opts.ner is undefined here on the cold path and this branch is dead code.
  // layer6b-ner.js (and its `@huggingface/transformers` dynamic import) is reached EXCLUSIVELY
  // through this `await import` — never via a static import (NER-01, D-04, T-06-02-01).
  let nerStatus: NerStatus = 'disabled'
  if (opts.ner && config.pii.ner.enabled) {
    const { runLayer6bNer } = await import('./layer6b-ner.js')
    const out = await runLayer6bNer(text, config.pii.ner, config, findings.map((f) => f.span))
    findings.push(...out.findings)
    nerStatus = out.status
  }

  // Step 6c: D-11 cross-source NER overlap drop — runs IMMEDIATELY before dedupBySpan so the
  // generic dedup stays pure. A no-op when no pii-ner findings are present (cold/hook path).
  const filtered = dropNerOverlaps(findings)

  // Step 7: Defense-in-depth dedup — removes any residual cross-layer overlaps
  const deduped = dedupBySpan(filtered)

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
  // ---------------------------------------------------------------------------
  // Steps 8a + 8b + 8c + placeholder allocation: resolve effectiveAction per finding
  // ---------------------------------------------------------------------------
  const resolvedFindings: ResolvedFinding[] = deduped.map((f) => {
    // Step 8a: warn→audit normalization, done immutably (never mutate the shared
    // Finding). 'warn' NEVER appears on a ResolvedFinding's action or effectiveAction.
    const action = f.action === 'warn' ? 'audit' : f.action
    // Step 8b: use finding.action if explicitly set (after 8a normalisation)
    // Step 8c: fall back to severity-default when action is undefined
    const effectiveAction: 'block' | 'substitute' | 'audit' =
      action !== undefined
        ? (action as 'block' | 'substitute' | 'audit')
        : severityToDefaultAction(f.severity)

    // Allocate placeholder (stable: same value → same placeholder per session)
    const type = getTypeForRuleId(f.ruleId)
    const entry = manager.allocate(f.value, type)

    return { ...f, action, placeholder: entry.placeholder, effectiveAction }
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
  // Provenance is populated ONLY for pii-ner findings (MODEL-04 / D-12). The four fields carry
  // model-identity metadata derived from constants + config + the backend label — NEVER finding.value
  // (findingToAuditRecord destructure-picks only these keys, so no raw PII can leak). Non-NER
  // findings pass `undefined`, keeping their audit records byte-identical to v1.
  const nerProvenance: FindingProvenance = {
    engine: `pii-ner@${PINNED_MODEL_SHA256.slice(0, 12)}`,
    model_rev: PINNED_MODEL_SHA256,
    quant: config.pii.ner.dtype,
    backend: getNerBackend(),
  }

  const auditResults = await Promise.allSettled(
    finalFindings.map((f) =>
      writeAuditRecord(
        ctx.cwd,
        findingToAuditRecord(
          f,
          ctx.sessionId,
          ctx.hookEvent,
          f.effectiveAction,
          f.source === 'pii-ner' ? nerProvenance : undefined,
        ),
      ),
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
    nerStatus,
  }
}
