/**
 * src/placeholder/type-map.ts
 *
 * Thin re-export of the canonical type-map from src/detect/type-map.ts (Plan 02-00 owned).
 * This file exists so callers can import getTypeForRuleId from `src/placeholder/`
 * without crossing into `src/detect/`. Behaviour is identical — Plan 02-00 is the source of truth.
 *
 * DO NOT add new mappings here. Revise Plan 02-00 and src/detect/type-map.ts instead.
 */
export { getTypeForRuleId, TYPE_VOCABULARY } from '../detect/type-map.js'
