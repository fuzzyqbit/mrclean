/**
 * Cold-path import-graph fence (Plan 09-07 Task 2 — REVMODE-05, Pitfall 7).
 *
 * Proves that with reversible mode OFF (the shipped default), NOTHING under
 * `src/state/` — nor `proper-lockfile`, nor `write-file-atomic` — can enter
 * the hook-reachable module graph: the one-way cold path stays byte-identical
 * to the pre-Phase-9 shipped behavior (CONTEXT D-10). The state adapter is
 * reachable ONLY through dynamic `await import(...)` expressions gated on
 * `config.reversible.enabled` (handlers) or fired at SessionStart/SessionEnd
 * (janitor — its own module, still lazy).
 *
 * This is a FAST, pure source-reading test (ner-unreachable.test.ts analog):
 * it parses module source text from disk, loads no state module, touches no
 * filesystem outside `src/`, and imports nothing heavy. It FAILS the moment
 * someone plants a static `import ... from '../../state/index.js'` (or a
 * static lockfile/wfa import) in any hook-reachable module — the regression
 * that would put crypto + locking on every one-way hook event.
 *
 * Invariants asserted:
 *   1. No hook-reachable module has a RUNTIME static import matching
 *      `/state/`, `proper-lockfile`, or `write-file-atomic`.
 *   2. Type-only `/state/` imports (erased at compile) exist ONLY in
 *      detect/index.ts and placeholder/manager.ts (the 09-04 seam contracts);
 *      nobody type-imports the lockfile/wfa packages.
 *   3. The substitution handlers reach the state facade via EXACTLY ONE
 *      `await import('../../state/index.js')` (+ one lock.js constant import)
 *      each; SessionStart/SessionEnd reach the janitor the same way.
 *   4. Cipher + lock primitives (createCipheriv / createDecipheriv /
 *      proper-lockfile) appear in `src/` ONLY under `src/state/` (full-tree
 *      source scan with a positive control against vacuity).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(process.cwd(), 'src')

// The hook-reachable module set: entrypoint → dispatcher → handlers →
// orchestrator → placeholder manager (Phase 9 set — adds session-end.ts and
// placeholder/manager.ts to the ner-unreachable.test.ts base set).
const HOOK_REACHABLE = [
  'hook/index.ts',
  'hook/dispatcher.ts',
  'hook/handlers/session-start.ts',
  'hook/handlers/user-prompt-submit.ts',
  'hook/handlers/pre-tool-use.ts',
  'hook/handlers/post-tool-use.ts',
  'hook/handlers/session-end.ts',
  'detect/index.ts',
  'placeholder/manager.ts',
] as const

/** Import specifiers that must NEVER appear as runtime static imports. */
const BANNED_SPECS = ['/state/', 'proper-lockfile', 'write-file-atomic'] as const

/** Modules permitted a TYPE-ONLY `/state/` import (09-04 seam contracts). */
const TYPE_IMPORT_ALLOWED = new Set(['detect/index.ts', 'placeholder/manager.ts'])

/** Tokens that must exist ONLY under src/state/ (crypto + lock chokepoint). */
const CONFINED_TOKENS = ['createCipheriv', 'createDecipheriv', 'proper-lockfile'] as const

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8')
}

/**
 * Strip line + block comments so import-detection regexes never match commented-out or
 * documentation references (e.g. the doc comment in index.ts mentioning `layer6b-ner`).
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/^[ \t]*\/\/.*$/gm, '') // whole-line // comments
}

/** A RUNTIME static `import ... from '<spec>'` (NOT `import type`). */
function hasRuntimeStaticImport(src: string, specSubstring: string): boolean {
  const code = stripComments(src)
  // Match `import <bindings> from '...spec...'` where bindings do NOT begin with `type`.
  const re = /\bimport\s+(?!type\b)([^;'"]*?)\s+from\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    if (m[2]!.includes(specSubstring)) return true
  }
  // Also catch side-effect imports: `import '...spec...'`
  const sideEffect = /\bimport\s+['"]([^'"]+)['"]/g
  while ((m = sideEffect.exec(code)) !== null) {
    if (m[1]!.includes(specSubstring)) return true
  }
  return false
}

/** A `import type ... from '<spec>'` line. */
function hasTypeOnlyImport(src: string, specSubstring: string): boolean {
  const code = stripComments(src)
  const re = /\bimport\s+type\s+[^;'"]*?\s+from\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    if (m[1]!.includes(specSubstring)) return true
  }
  return false
}

/** Count runtime `await import('<exact spec>')` expressions (lazy-fence sites). */
function countAwaitImports(src: string, spec: string): number {
  const code = stripComments(src)
  const escaped = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(String.raw`await\s+import\(\s*['"]${escaped}['"]\s*\)`, 'g')
  return (code.match(re) ?? []).length
}

/** Recursively collect every .ts file under a directory. */
function walkTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('cold-path import-graph fence (state/lockfile/wfa unreachable one-way, REVMODE-05)', () => {
  // -------------------------------------------------------------------------
  // Invariant 1: no hook-reachable module statically (runtime) imports the
  // state adapter or its storage packages.
  // -------------------------------------------------------------------------
  it('no hook-reachable module has a RUNTIME static import of src/state/, proper-lockfile, or write-file-atomic', () => {
    for (const rel of HOOK_REACHABLE) {
      const src = read(rel)
      for (const spec of BANNED_SPECS) {
        expect(
          hasRuntimeStaticImport(src, spec),
          `${rel} must not statically (runtime) import ${spec} — src/state/ is reachable ONLY via dynamic import() gated on config.reversible.enabled`,
        ).toBe(false)
      }
    }
  })

  // -------------------------------------------------------------------------
  // Invariant 2: type-only /state/ imports (erased at compile) only where the
  // 09-04 seam contracts live; the storage packages are never even type-imported.
  // -------------------------------------------------------------------------
  it('type-only /state/ imports exist ONLY in detect/index.ts and placeholder/manager.ts', () => {
    for (const rel of HOOK_REACHABLE) {
      const src = read(rel)
      expect(
        hasTypeOnlyImport(src, '/state/'),
        TYPE_IMPORT_ALLOWED.has(rel)
          ? `${rel} should carry its 09-04 type-only session-map contract import`
          : `${rel} must not reference /state/ even as a type-only import`,
      ).toBe(TYPE_IMPORT_ALLOWED.has(rel))
    }
  })

  it('no hook-reachable module type-imports proper-lockfile or write-file-atomic', () => {
    for (const rel of HOOK_REACHABLE) {
      const src = read(rel)
      for (const spec of ['proper-lockfile', 'write-file-atomic']) {
        expect(
          hasTypeOnlyImport(src, spec),
          `${rel} must not type-import ${spec}`,
        ).toBe(false)
      }
    }
  })

  // -------------------------------------------------------------------------
  // Invariant 3: the lazy fence sites are exact — one facade import per
  // substitution handler (batched single-transaction discipline), one janitor
  // import per lifecycle handler.
  // -------------------------------------------------------------------------
  it('substitution handlers reach the state facade via EXACTLY ONE await import() each', () => {
    for (const rel of ['hook/handlers/pre-tool-use.ts', 'hook/handlers/post-tool-use.ts']) {
      const src = read(rel)
      expect(
        countAwaitImports(src, '../../state/index.js'),
        `${rel} must have exactly one await import('../../state/index.js')`,
      ).toBe(1)
      expect(
        countAwaitImports(src, '../../state/lock.js'),
        `${rel} must have exactly one await import('../../state/lock.js') (deadline constant)`,
      ).toBe(1)
    }
  })

  it('lifecycle handlers reach the janitor via EXACTLY ONE await import() each', () => {
    for (const rel of ['hook/handlers/session-start.ts', 'hook/handlers/session-end.ts']) {
      expect(
        countAwaitImports(read(rel), '../../state/janitor.js'),
        `${rel} must have exactly one await import('../../state/janitor.js')`,
      ).toBe(1)
    }
  })

  // -------------------------------------------------------------------------
  // Invariant 4: cipher + lock primitives are confined to src/state/ —
  // full-tree source scan (comments stripped) with a non-vacuity control.
  // -------------------------------------------------------------------------
  it('createCipheriv / createDecipheriv / proper-lockfile references exist ONLY under src/state/', () => {
    const files = walkTsFiles(SRC)
    expect(files.length, 'src/ walk must find a realistic module count').toBeGreaterThan(50)

    const offenders: string[] = []
    const stateHits = new Set<string>()
    for (const file of files) {
      const rel = relative(SRC, file)
      const code = stripComments(readFileSync(file, 'utf8'))
      for (const token of CONFINED_TOKENS) {
        if (!code.includes(token)) continue
        if (rel.startsWith(`state${'/'}`) || rel.startsWith(`state${'\\'}`)) {
          stateHits.add(token)
        } else {
          offenders.push(`${rel} references ${token}`)
        }
      }
    }

    expect(offenders, 'crypto/lock primitives leaked outside src/state/').toEqual([])
    // Positive control: the scan is not vacuous — every confined token really
    // does exist inside src/state/ (map-store cipher pair + lock.ts lockfile).
    for (const token of CONFINED_TOKENS) {
      expect(stateHits.has(token), `expected ${token} to exist under src/state/`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Phase 10 (Plan 10-07) — restore trust-boundary fences.
//
// STATE.md pins the trust direction: src/restore/ INTRODUCES sensitive data
// (decrypted originals cross into operator-visible output) — the opposite
// direction from src/placeholder/. These fences make that direction a build
// failure instead of a convention:
//
//   Rule 1 (INBOUND, hook set): no hook-reachable module contains the
//     substring '/restore/' in stripped source AT ALL — runtime, type-only,
//     or dynamic (REVMODE-01 zero-model-facing-surface).
//   Rule 2 (INBOUND, full src/): '/restore/' import specifiers are confined
//     to src/cli.ts's ONE sanctioned dynamic `.action()` site — every other
//     module (mcp, detect, config, install, doctor, ...) is an offender.
//   Rule 3 (OUTBOUND allowlist): src/restore/ imports ONLY node: builtins,
//     intra-restore siblings, ../state/, ../detect/findings.js, and
//     ../audit/restore-log.js. A '../config/' or '../hook/' edge would create
//     exactly the shared kill switch REVMODE-08 bans — structural proof that
//     restore failures cannot couple into redaction (Pitfall 6).
//
// Each rule collects offenders (asserted toEqual([])) and carries an
// anti-vacuity positive control so a broken walk can never pass silently.
// ---------------------------------------------------------------------------

/** The restore-import specifier fragment banned outside the sanctioned site. */
const RESTORE_SPEC = '/restore/'

/** The ONE sanctioned importer of src/restore/ (dynamic import in the CLI). */
const SANCTIONED_RESTORE_IMPORTER = 'cli.ts'

/** The exact specifier the CLI's dynamic `.action()` site must use. */
const SANCTIONED_RESTORE_IMPORT = './restore/cli.js'

/**
 * src/restore/ outbound import allowlist (REVMODE-08 no-shared-kill-switch).
 * Exactly five patterns — a new import of e.g. '../config/index.js' or
 * '../hook/index.js' turns CI red by design.
 */
const RESTORE_IMPORT_ALLOWLIST: readonly RegExp[] = [
  /^node:/, // platform builtins only
  /^\.\//, // intra-restore siblings
  /^\.\.\/state\//, // read-side store surface (decrypt chokepoint stays in src/state/)
  /^\.\.\/detect\/findings\.js$/, // redactedHash ONLY (hash-at-the-boundary)
  /^\.\.\/audit\/restore-log\.js$/, // hash-only audit sink
]

/**
 * Every import specifier in stripped source: static runtime imports, type-only
 * imports, side-effect imports, re-exports, and dynamic import() expressions.
 * The rule-2/rule-3 fences must see the TOTAL module-graph edge set — a
 * type-only or re-export edge is still an edge.
 */
function allImportSpecifiers(src: string): string[] {
  const code = stripComments(src)
  const specs: string[] = []
  const patterns = [
    /\bimport\s+[^;'"]*?\s+from\s+['"]([^'"]+)['"]/g, // import ... from '...' (incl. import type)
    /\bexport\s+[^;'"]*?\s+from\s+['"]([^'"]+)['"]/g, // export ... from '...' (re-export edge)
    /\bimport\s+['"]([^'"]+)['"]/g, // side-effect import '...'
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import('...')
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(code)) !== null) {
      specs.push(m[1]!)
    }
  }
  return specs
}

describe('restore trust-boundary fences (Phase 10)', () => {
  // -------------------------------------------------------------------------
  // Rule 1: total '/restore/' ban on the hook-reachable set — stricter than
  // the import-specifier scan below: not even a string mention survives
  // comment-stripping in a hook path.
  // -------------------------------------------------------------------------
  it("no hook-reachable module contains '/restore/' in stripped source (runtime, type-only, or dynamic)", () => {
    const offenders: string[] = []
    for (const rel of HOOK_REACHABLE) {
      if (stripComments(read(rel)).includes(RESTORE_SPEC)) {
        offenders.push(`${rel} references ${RESTORE_SPEC}`)
      }
    }
    expect(
      offenders,
      'src/restore/ must be structurally unreachable from every hook path — restore INTRODUCES sensitive data (REVMODE-01)',
    ).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Rule 2: full-src inbound confinement — the ONLY '/restore/' import
  // specifier outside src/restore/ is cli.ts's sanctioned dynamic site.
  // -------------------------------------------------------------------------
  it("no module outside src/restore/ imports '/restore/' except the sanctioned cli.ts dynamic site", () => {
    const files = walkTsFiles(SRC)
    // Positive control 1: the walk covers the real tree, not an empty dir.
    expect(files.length, 'src/ walk must find a realistic module count').toBeGreaterThanOrEqual(60)

    const offenders: string[] = []
    for (const file of files) {
      const rel = relative(SRC, file)
      if (rel.startsWith(`restore${'/'}`) || rel.startsWith(`restore${'\\'}`)) continue
      if (rel === SANCTIONED_RESTORE_IMPORTER) continue
      for (const spec of allImportSpecifiers(readFileSync(file, 'utf8'))) {
        if (spec.includes(RESTORE_SPEC)) {
          offenders.push(`${rel} imports ${spec}`)
        }
      }
    }
    expect(
      offenders,
      "src/restore/ may be imported ONLY from src/cli.ts's dynamic .action() site — any other importer puts restore on a model-facing or shared path",
    ).toEqual([])

    // Positive control 2: the sanctioned site EXISTS, is dynamic, and is the
    // ONLY restore edge in cli.ts — exactly one await import of exactly the
    // sanctioned specifier, zero static imports.
    const cliSrc = read(SANCTIONED_RESTORE_IMPORTER)
    expect(
      allImportSpecifiers(cliSrc).filter((spec) => spec.includes(RESTORE_SPEC)),
      `cli.ts's restore edge set must be exactly ['${SANCTIONED_RESTORE_IMPORT}']`,
    ).toEqual([SANCTIONED_RESTORE_IMPORT])
    expect(
      countAwaitImports(cliSrc, SANCTIONED_RESTORE_IMPORT),
      `cli.ts must reach restore via EXACTLY ONE await import('${SANCTIONED_RESTORE_IMPORT}')`,
    ).toBe(1)
    expect(
      hasRuntimeStaticImport(cliSrc, RESTORE_SPEC),
      'cli.ts must never STATICALLY import restore — dynamic-only cold-path discipline',
    ).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Rule 3: outbound allowlist — restore reaches NOTHING that could couple
  // its failures to redaction (no config, no hook, no detect engine, no mcp:
  // the REVMODE-08 no-shared-kill-switch structural proof).
  // -------------------------------------------------------------------------
  it('src/restore/ imports ONLY node: builtins, intra-restore siblings, ../state/, ../detect/findings.js, ../audit/restore-log.js', () => {
    const restoreFiles = walkTsFiles(join(SRC, 'restore'))
    // Positive control 3: the shipped restore module set is really walked.
    expect(
      restoreFiles.length,
      'src/restore/ walk must find the shipped module set (index, session-index, cli)',
    ).toBeGreaterThanOrEqual(3)

    const offenders: string[] = []
    for (const file of restoreFiles) {
      const rel = relative(SRC, file)
      for (const spec of allImportSpecifiers(readFileSync(file, 'utf8'))) {
        if (!RESTORE_IMPORT_ALLOWLIST.some((re) => re.test(spec))) {
          offenders.push(`${rel} imports ${spec}`)
        }
      }
    }
    expect(
      offenders,
      'src/restore/ import outside the five-pattern allowlist — a config/hook/detect-engine/mcp edge would couple the REVMODE-08 error domains (shared kill switch)',
    ).toEqual([])
  })
})
