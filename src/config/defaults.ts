/**
 * Bundled defaults for the mrclean configuration (Phase 1 schema only).
 *
 * DEFAULT_CONFIG is the first layer in any mergeConfigs call:
 *   mergeConfigs(DEFAULT_CONFIG, userLayer, projectLayer)
 *
 * It is Object.freeze'd so accidental mutation in callers is caught at runtime
 * (immutability rule from coding-style). Phase 2 will extend MrcleanConfig and
 * add corresponding defaults here without changing the merge mechanics.
 */

import type { MrcleanConfig } from '../shared/types.js'

export const DEFAULT_CONFIG: MrcleanConfig = Object.freeze({
  dry_run: false,
  allowlist: Object.freeze({
    rules: Object.freeze([]) as unknown as string[],
    paths: Object.freeze([]) as unknown as string[],
    stopwords: Object.freeze([]) as unknown as string[],
    regexes: Object.freeze([]) as unknown as string[],
    fingerprints: Object.freeze([]) as unknown as string[],
  }) as unknown as import('../shared/types.js').MrcleanAllowlist,
}) as unknown as MrcleanConfig
