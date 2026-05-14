/**
 * applyDryRun — Plan 02-04
 *
 * MODE-01 semantics: when `config.dry_run === true`, every ResolvedFinding's
 * effectiveAction is coerced to `'audit'`. Detection still runs (Layer 1–4),
 * placeholders are still computed for audit-log accuracy, but substitution is
 * NOT applied to the hook output — the orchestrator returns the original text.
 *
 * This is a pure function: it returns a NEW array with NEW finding objects.
 * The input array and its elements are never mutated (immutable pattern per CLAUDE.md).
 *
 * Usage:
 *   const dryRunFindings = applyDryRun(resolvedFindings)
 *   // dryRunFindings[i].effectiveAction === 'audit' for all i
 *   // resolvedFindings[i].effectiveAction is unchanged
 *
 * Type note: applyDryRun uses a generic constraint `T extends { effectiveAction: ... }`
 * to avoid a circular import with src/detect/index.ts. The ResolvedFinding interface
 * from index.ts satisfies this constraint — callers pass ResolvedFinding[] directly.
 */

/**
 * Coerce every finding's effectiveAction to `'audit'` for dry_run mode.
 *
 * Generic `T extends { effectiveAction: ... }` avoids a circular module import
 * while remaining type-safe for the full ResolvedFinding shape.
 *
 * @param findings - Array of findings with an effectiveAction field.
 * @returns        - New array where each element is a shallow copy with effectiveAction: 'audit'.
 *                  The input array and its elements are NOT mutated.
 */
export function applyDryRun<T extends { effectiveAction: 'block' | 'substitute' | 'audit' }>(
  findings: T[],
): T[] {
  return findings.map((f) => ({ ...f, effectiveAction: 'audit' as const }))
}
