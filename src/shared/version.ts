/**
 * Package version — read from package.json at module load time.
 *
 * Uses `resolveJsonModule: true` from tsconfig + NodeNext import attributes.
 * The `with { type: 'json' }` import assertion is required for NodeNext ESM.
 */
import pkg from '../../package.json' with { type: 'json' }

export const VERSION: string = pkg.version
