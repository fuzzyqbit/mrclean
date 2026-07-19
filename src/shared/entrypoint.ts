/**
 * Entrypoint-main-module guard shared by the bin entry modules (src/cli.ts,
 * src/mcp.ts).
 *
 * Node realpaths and percent-encodes the ESM entry URL, while process.argv[1]
 * is the raw invocation path. The former naive comparison
 * (`import.meta.url === `file://${process.argv[1]}``) therefore failed — and
 * the bin registered its commands, never parsed argv, and exited 0 with no
 * output — whenever the bin was invoked:
 *   - through a symlink, exactly how npm/npx wire `bin` entries on POSIX
 *     (node_modules/.bin/mrclean -> dist/cli.js);
 *   - through a path with URL-escapable characters (space -> %20) or a
 *     symlinked prefix (macOS /tmp -> /private/tmp);
 *   - on Windows, where `file://C:\...` never matches a `file:///C:/...` URL.
 * (Phase 10 review CR-01.)
 */

import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * True iff the module whose `import.meta.url` is `importMetaUrl` is the
 * process entry module (`process.argv[1]`).
 *
 * Both sides are compared in canonical file-URL form: argv[1] is converted
 * via pathToFileURL (percent-encoding, Windows drive-letter form) and, when
 * the direct form does not match, realpathed first (Node's default ESM entry
 * resolution follows symlinks; keeping the direct comparison also leaves the
 * guard correct under `--preserve-symlinks-main`). Any fs failure (argv[1]
 * missing or unreadable) means "not the entry module" — the safe direction:
 * the module behaves exactly as when imported by tests.
 */
export function isMainEntry(importMetaUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) {
    return false
  }
  try {
    if (importMetaUrl === pathToFileURL(argv1).href) {
      return true
    }
    return importMetaUrl === pathToFileURL(realpathSync(argv1)).href
  } catch {
    return false
  }
}
