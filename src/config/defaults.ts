/**
 * Bundled defaults for the mrclean configuration (Phase 2 schema).
 *
 * DEFAULT_CONFIG is the first layer in any mergeConfigs call:
 *   mergeConfigs(DEFAULT_CONFIG, userLayer, projectLayer)
 *
 * It is Object.freeze'd (including nested objects and arrays) so accidental
 * mutation in callers is caught at runtime (immutability rule from coding-style).
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
  entropy: Object.freeze({
    threshold: 4.5,
    min_length: 20,
  }) as unknown as import('../shared/types.js').MrcleanEntropyConfig,
  secrets_files: Object.freeze([]) as unknown as string[],
  rules: Object.freeze([]) as unknown as import('../shared/types.js').MrcleanRuleOverride[],
}) as unknown as MrcleanConfig
