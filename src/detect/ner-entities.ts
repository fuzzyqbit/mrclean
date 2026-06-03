/**
 * NER model-label → canonical entity mapping (Layer 6b).
 *
 * Maps a per-model NER label (e.g. bert-base-NER's BIO labels `B-PER`, `I-ORG`, …)
 * to the canonical mrclean entity class `'PERSON' | 'ORG' | 'LOC'`, or `null` when the
 * label is not a substitutable entity (MISC / O / unknown).
 *
 * Mirrors the static-map + pure-lookup shape of src/detect/type-map.ts (RULE_ID_TO_TYPE +
 * getTypeForRuleId). Maps are keyed by MODEL ID so a future model tier (piiranha, added in
 * Plan 06-03 — a DIFFERENT label space with no ORG concept) can be added as a new branch
 * WITHOUT touching the bert branch.
 *
 * Canonical labels are PERSON/ORG/LOC — matching the config `pii.ner.entities` array and the
 * `pii:PERSON|ORG|LOC` keys already present in type-map.ts (Phase 4 contract). D-09.
 *
 * bert-base-NER id2label (VERIFIED, HF Hub config.json):
 *   O, B-MISC, I-MISC, B-PER, I-PER, B-ORG, I-ORG, B-LOC, I-LOC
 *
 * Plan 06-01 — implements NER-01 (label map) / D-09.
 */

/** Canonical entity classes mrclean substitutes (matches pii.ner.entities + type-map keys). */
export type CanonicalEntity = 'PERSON' | 'ORG' | 'LOC'

/**
 * Per-model BIO-label → canonical-entity map.
 *
 * Keyed by HuggingFace model id. Each value is a frozen map from the model's OWN labels
 * (already stripped of the `B-`/`I-` BIO prefix at lookup time) to a canonical entity.
 * Labels not present here (MISC, O, unknowns) resolve to `null` — i.e. NOT substitutable.
 */
const MODEL_LABEL_MAPS: Readonly<Record<string, Readonly<Record<string, CanonicalEntity>>>> = Object.freeze({
  // bert-base-NER: PER/ORG/LOC are substitutable; MISC + O are intentionally absent → null.
  'Xenova/bert-base-NER': Object.freeze({
    PER: 'PERSON',
    ORG: 'ORG',
    LOC: 'LOC',
  }),
  // piiranha (a DIFFERENT label space, no ORG concept) is added in Plan 06-03 (NER-04).
})

/**
 * Strip the BIO prefix (`B-`/`I-`) from a NER label, leaving the bare entity tag.
 *
 * `'B-PER' → 'PER'`, `'I-ORG' → 'ORG'`, `'O' → 'O'`, `'' → ''`.
 */
function stripBio(label: string): string {
  if (label.startsWith('B-') || label.startsWith('I-')) return label.slice(2)
  return label
}

/**
 * Map a model's NER label to a canonical entity class, or `null` if not substitutable.
 *
 * Resolution:
 *   1. Look up the per-model label map by `model` id. Unknown model → `null` for every label.
 *   2. Strip the `B-`/`I-` BIO prefix from `label`.
 *   3. Return the canonical entity for the bare tag, or `null` (covers MISC, O, unknown tags).
 *
 * @param model - HuggingFace model id (e.g. `'Xenova/bert-base-NER'`).
 * @param label - A raw model NER label (e.g. `'B-PER'`, `'I-ORG'`, `'O'`).
 * @returns       `'PERSON' | 'ORG' | 'LOC'`, or `null` when the label is not a substitutable entity.
 */
export function mapModelLabel(model: string, label: string): CanonicalEntity | null {
  const labelMap = MODEL_LABEL_MAPS[model]
  if (!labelMap) return null // defensive: unknown model → no canonical entities

  const tag = stripBio(label)
  return labelMap[tag] ?? null
}
