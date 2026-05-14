/**
 * Marker constants and typeguards for mrclean-managed entries.
 *
 * Used to identify and filter mrclean-owned JSON entries in settings.json
 * and to delimit the managed block in .gitignore files.
 */

/** Property key written into every mrclean-owned settings entry. */
export const MRCLEAN_MARKER = '_mrclean'

/** Opening delimiter for the mrclean-managed block in .gitignore files. */
export const GITIGNORE_BEGIN = '# >>> mrclean managed entries — do not edit manually >>>'

/** Closing delimiter for the mrclean-managed block in .gitignore files. */
export const GITIGNORE_END = '# <<< mrclean managed entries <<<'

/**
 * Typeguard: returns true if `obj` is an object with `_mrclean: true`.
 * Used to identify mrclean-owned hook entries in settings.json.
 */
export function isMrcleanEntry(obj: unknown): obj is Record<string, unknown> & { _mrclean: true } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    '_mrclean' in obj &&
    (obj as Record<string, unknown>)['_mrclean'] === true
  )
}
