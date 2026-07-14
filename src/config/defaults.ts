/**
 * Bundled defaults for the mrclean configuration (Phase 2 schema + Phase 4-02 pii).
 *
 * DEFAULT_CONFIG is the first layer in any mergeConfigs call:
 *   mergeConfigs(DEFAULT_CONFIG, userLayer, projectLayer)
 *
 * It is Object.freeze'd (including nested objects and arrays) so accidental
 * mutation in callers is caught at runtime (immutability rule from coding-style).
 *
 * PII defaults (Phase 4-02, PII-03):
 *   pii.enabled = false  ← master switch OFF; absent-[pii] == v1 guarantee
 *   pii.regex.actions: ssn/credit_card → block (checksum-validated); email/phone → warn; ip → audit
 *   pii.ner.actions: PERSON/ORG → warn; LOC → audit  (NER is advisory, never a hard gate)
 *
 * Reversible defaults (Phase 8-01, REVMODE-02 groundwork):
 *   reversible.enabled = false  ← master switch OFF; absent-[reversible] == shipped one-way guarantee
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
  pii: Object.freeze({
    enabled: false,
    regex: Object.freeze({
      enabled: true,
      entities: Object.freeze([
        'email',
        'ssn',
        'credit_card',
        'phone',
        'ip',
      ]) as unknown as string[],
      actions: Object.freeze({
        ssn: 'block',
        credit_card: 'block',
        email: 'warn',
        phone: 'warn',
        ip: 'audit',
      }) as unknown as Record<string, import('../shared/types.js').PiiAction>,
    }) as unknown as import('../shared/types.js').MrcleanPiiRegexConfig,
    ner: Object.freeze({
      enabled: false,
      model: 'Xenova/bert-base-NER',
      dtype: 'int8',
      entities: Object.freeze(['PERSON', 'ORG', 'LOC']) as unknown as string[],
      confidence: 0.7,
      allowDownload: true,
      warmOnBoot: false,
      actions: Object.freeze({
        PERSON: 'warn',
        ORG: 'warn',
        LOC: 'audit',
      }) as unknown as Record<string, import('../shared/types.js').PiiAction>,
    }) as unknown as import('../shared/types.js').MrcleanPiiNerConfig,
  }) as unknown as import('../shared/types.js').MrcleanPiiConfig,
  reversible: Object.freeze({
    enabled: false, // master switch OFF; absent-[reversible] == shipped one-way guarantee
  }) as unknown as import('../shared/types.js').MrcleanReversibleConfig,
}) as unknown as MrcleanConfig
