/**
 * Audit log appender — Plan 02-03
 *
 * Writes one JSONL record per detection event to `.mrclean/audit.jsonl`.
 *
 * Security contract (AUDIT-01 + AUDIT-02):
 *   - Records contain ONLY safe fields: ts, sessionId, hookEvent, ruleId,
 *     severity, action, redactedHash, fingerprint, location.
 *   - Records NEVER contain: raw secret value, env-var name, or file paths
 *     outside the project root.
 *   - The `findingToAuditRecord` builder is the ONLY point where a Finding
 *     is converted to an AuditRecord. It explicitly excludes `finding.value`.
 *   - The canary-leak helper (src/audit/canary-leak.ts) enforces this at test time.
 *
 * Append semantics:
 *   - `fs.appendFile` with `flag: 'a'` provides OS-level O_APPEND atomicity.
 *   - Concurrent writes from the same process are serialised at the OS level.
 *   - No rotation in v1; `.mrclean/` must exist before first write (created by `mrclean install`).
 */

import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Finding } from '../detect/findings.js'

// ---------------------------------------------------------------------------
// AuditRecord — locked schema (CONTEXT §Audit Log)
// ---------------------------------------------------------------------------

/**
 * A single audit log record. One record per detection event.
 *
 * LOCKED: Do not add fields that could contain raw values, env-var names,
 * or file paths outside the project root. The CI canary-leak test enforces this.
 */
export interface AuditRecord {
  /** ISO8601 timestamp of the detection event (local clock). */
  ts: string
  /** Session UUID — assigned by the PlaceholderManager constructor. */
  sessionId: string
  /** The Claude Code hook event that triggered detection. */
  hookEvent: 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse'
  /** Rule identifier — e.g. 'AWSAccessKeyID', 'entropy:high', 'word:acme'. */
  ruleId: string
  /** Severity assigned by the rule or per-rule config override. */
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  /** Effective action taken for this finding. */
  action: 'block' | 'substitute' | 'audit'
  /** First 16 hex chars of SHA-256(raw value) — safe for logs. */
  redactedHash: string
  /** `${ruleId}:${redactedHash}` — stable composite for per-finding suppression. */
  fingerprint: string
  /** Location metadata for the finding. */
  location: {
    hookEvent: string
    offset: number
    length: number
  }
  /**
   * Optional PII-NER provenance fields — populated only for Layer 6b NER findings
   * (Phase 6). Left undefined for all secret findings to preserve backward compatibility.
   *
   * Required for reproducibility: NER is non-deterministic across model rev/quant/backend
   * (PITFALLS.md Pitfall 6). These fields pin exactly which model produced the finding
   * so audit entries can be audited and reproduced.
   *
   * NEVER use these fields to carry matched text, entity value, or any free-form input.
   */

  /** Detection engine identifier, e.g. 'pii-regex' or 'pii-ner@<sha>' (no raw text). */
  engine?: string
  /** Model revision SHA — pins the NER model for reproducibility (Pitfall 6). */
  model_rev?: string
  /** Quantization level, e.g. 'int8' or 'fp32' (Pitfall 6: affects recall). */
  quant?: string
  /** Inference backend, e.g. 'onnxruntime-node' or 'wasm' (Pitfall 6: affects latency). */
  backend?: string
}

// ---------------------------------------------------------------------------
// AuditWriteError
// ---------------------------------------------------------------------------

/**
 * Thrown by `writeAuditRecord` when the write fails (e.g. `.mrclean/` missing).
 *
 * Extends `Error` so callers can use `instanceof AuditWriteError` to distinguish
 * audit write failures from other errors.
 */
export class AuditWriteError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'AuditWriteError'
  }
}

// ---------------------------------------------------------------------------
// writeAuditRecord
// ---------------------------------------------------------------------------

/**
 * Append one JSONL record to `.mrclean/audit.jsonl` in the given `cwd`.
 *
 * Uses `fs.appendFile` with `flag: 'a'` for O_APPEND atomicity.
 * The `.mrclean/` directory must already exist (created by `mrclean install`).
 *
 * @param cwd    - Project root directory (process.cwd() at install time).
 * @param record - The AuditRecord to write. Must not contain raw secret values.
 * @throws       - `AuditWriteError` if the write fails (including ENOENT for missing dir).
 */
export async function writeAuditRecord(cwd: string, record: AuditRecord): Promise<void> {
  const logPath = join(cwd, '.mrclean', 'audit.jsonl')
  const line = JSON.stringify(record) + '\n'

  try {
    await appendFile(logPath, line, { flag: 'a', encoding: 'utf8' })
  } catch (err) {
    const message =
      isEnoent(err)
        ? `mrclean audit: .mrclean/ not found — run \`mrclean install\``
        : `mrclean audit: failed to write to ${logPath}`
    throw new AuditWriteError(message, err)
  }
}

// ---------------------------------------------------------------------------
// findingToAuditRecord
// ---------------------------------------------------------------------------

/**
 * PII-NER provenance fields for `findingToAuditRecord`.
 * Populated only for Layer 6b NER findings in Phase 6.
 * Each field carries model-identity metadata only — NEVER matched text.
 */
export interface FindingProvenance {
  /** Detection engine identifier, e.g. 'pii-ner@<sha>' (no raw matched text). */
  engine?: string
  /** Model revision SHA for reproducibility (PITFALLS.md Pitfall 6). */
  model_rev?: string
  /** Quantization level, e.g. 'int8' (Pitfall 6: affects recall). */
  quant?: string
  /** Inference backend, e.g. 'onnxruntime-node' or 'wasm' (Pitfall 6: affects latency). */
  backend?: string
}

/**
 * Build an AuditRecord from a Finding — purely a builder, no I/O.
 *
 * LOCKED: NEVER add raw value, env-var name, file path, or raw PII here.
 * CI canary test enforces this at runtime.
 *
 * @param finding    - The detection finding (raw value is intentionally excluded).
 * @param sessionId  - Session UUID from PlaceholderManager.
 * @param hookEvent  - The Claude Code hook event name.
 * @param action     - The effective action taken for this finding.
 * @param provenance - Optional PII-NER provenance (engine/model_rev/quant/backend).
 *                     When absent, the record is byte-identical to v1 (backward-compatible).
 *                     When present, the four provenance fields are spread into the record.
 *                     These fields carry only model-identity metadata, never matched text.
 * @returns          - An AuditRecord ready for `writeAuditRecord`.
 */
export function findingToAuditRecord(
  finding: Finding,
  sessionId: string,
  hookEvent: string,
  action: 'block' | 'substitute' | 'audit',
  provenance?: FindingProvenance,
): AuditRecord {
  // LOCKED: NEVER add raw value, env-var name, file path, or raw PII here. CI canary test enforces this.
  return {
    ts: new Date().toISOString(),
    sessionId,
    hookEvent: hookEvent as AuditRecord['hookEvent'],
    ruleId: finding.ruleId,
    severity: finding.severity,
    action,
    redactedHash: finding.redactedHash,
    fingerprint: finding.fingerprint,
    location: {
      hookEvent,
      offset: finding.span.start,
      length: finding.span.end - finding.span.start,
    },
    // Spread provenance fields only when provided; absent = undefined (omitted in JSON.stringify)
    ...(provenance !== undefined ? provenance : {}),
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}
