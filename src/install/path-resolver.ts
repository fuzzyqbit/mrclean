/**
 * Absolute path resolution for the Node.js binary and mrclean bin entries.
 *
 * The paths written into settings.json MUST be absolute at install time (INST-04).
 * Using bare command names (e.g., "mrclean") causes silent failures when Claude Code
 * spawns hooks with a restricted PATH (Pitfall #7).
 *
 * RESEARCH.md §3.4 (cross-platform resolution), §8.1 (Pitfall #7).
 */

import { access, constants, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

/**
 * Return the absolute path to the running Node.js binary.
 * `process.execPath` is always the absolute path of the current Node binary.
 */
export function resolveNodePath(): string {
  return process.execPath
}

/**
 * Locate the mrclean bin (dist/cli.js) as an absolute path.
 *
 * Strategy (tries in order):
 * 1. Resolve relative to `import.meta.url` — works when running from source tree
 *    or from the built dist/ directory.
 * 2. Derive from `process.argv[1]` (the executing script) — works for npx and
 *    global installs where argv[1] IS the bin script.
 *
 * Uses `fs.realpath` to resolve symlinks so the recorded path is always the real file.
 * Throws a clear error if no candidate resolves to an existing file.
 */
export async function resolveMrcleanBinPath(): Promise<string> {
  const candidates = buildBinCandidates('dist/cli.js')
  return resolveFirstExisting(candidates, 'dist/cli.js')
}

/**
 * Locate the mrclean-mcp bin (dist/mcp.js) as an absolute path.
 * Same strategy as resolveMrcleanBinPath.
 */
export async function resolveMrcleanMcpPath(): Promise<string> {
  const candidates = buildBinCandidates('dist/mcp.js')
  return resolveFirstExisting(candidates, 'dist/mcp.js')
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build candidate absolute paths for a dist file (e.g., 'dist/cli.js').
 *
 * Order: source-tree location first (most reliable during dev + installed),
 * then argv[1]-derived location (npx / global install).
 */
function buildBinCandidates(distFile: string): string[] {
  const candidates: string[] = []

  // 1. Derive from import.meta.url: this file lives at src/install/path-resolver.ts
  //    (or dist/install/path-resolver.js after build). Walk up two levels to get the
  //    package root, then append the dist file.
  try {
    const thisFile = fileURLToPath(import.meta.url)
    // src/install/ → src/ → <package-root>
    const packageRoot = dirname(dirname(thisFile))
    candidates.push(join(packageRoot, distFile))
  } catch {
    // import.meta.url unavailable in some edge cases
  }

  // 2. Derive from process.argv[1]: when run via npx or as a global bin,
  //    argv[1] is the executing script. Walk up from it to find the package root.
  if (process.argv[1]) {
    const scriptPath = resolve(process.argv[1])
    // Walk up the directory tree looking for package.json
    let current = dirname(scriptPath)
    for (let i = 0; i < 5; i++) {
      candidates.push(join(current, distFile))
      const parent = dirname(current)
      if (parent === current) break // filesystem root
      current = parent
    }
  }

  return candidates
}

/**
 * Try each candidate path in order; return the first one that exists.
 * Uses realpath to resolve symlinks.
 */
async function resolveFirstExisting(candidates: string[], label: string): Promise<string> {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.F_OK)
      const real = await realpath(candidate)
      return real
    } catch {
      // Not found at this candidate — try the next
    }
  }

  throw new Error(
    `mrclean: cannot locate ${label}. ` +
    `Run 'npm run build' to generate the dist/ files before installing. ` +
    `Tried: ${candidates.join(', ')}`
  )
}
