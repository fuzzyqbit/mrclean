/**
 * Structural-unreachability import-graph proof (Plan 06-02, Task 2).
 *
 * Proves the Layer 6b NER engine — and through it `@huggingface/transformers` + the 108 MB ONNX
 * model — is UNREACHABLE from the per-event hook cold path via any STATIC import (NER-01, D-04,
 * T-06-02-01). The engine is reached ONLY through the dynamic `await import('./layer6b-ner.js')`
 * inside the MCP-gated `opts.ner` branch in src/detect/index.ts.
 *
 * This is a FAST, pure source-reading test: it parses module source text from disk. It loads NO
 * model, spawns NO process, and imports nothing heavy. It is designed to FAIL the moment someone
 * adds a static `import { ... } from './layer6b-ner.js'` (or a static `@huggingface/transformers`
 * import) to any hook-reachable module — the regression that would put the ML dep on the cold path.
 *
 * Invariants asserted:
 *   1. No hook-reachable module (src/hook/index.ts + dispatcher + handlers/*.ts + src/detect/index.ts)
 *      contains a RUNTIME static import of `layer6b-ner` — a `import type { NerStatus }` line in
 *      index.ts is the ONLY permitted reference.
 *   2. `@huggingface/transformers` appears in src/ ONLY as a dynamic `import(...)` expression, and
 *      ONLY in src/model/pipeline-singleton.ts (the sole ML-dep boundary).
 *   3. src/model/pipeline-singleton.ts has ZERO static `@huggingface/transformers` import — which is
 *      why src/detect/index.ts may statically import getNerBackend/resetNerSingleton from it safely.
 *   4. The only references to `layer6b-ner` in src/ are dynamic `import(...)` expressions
 *      (plus the single `import type` line in index.ts).
 *   5. No hook handler call site passes a 5th argument to runDetection (the 4-arg cold-path shape).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')

// The hook-reachable module set: entrypoint → dispatcher → handlers → orchestrator.
const HOOK_REACHABLE = [
  'hook/index.ts',
  'hook/dispatcher.ts',
  'hook/handlers/session-start.ts',
  'hook/handlers/user-prompt-submit.ts',
  'hook/handlers/pre-tool-use.ts',
  'hook/handlers/post-tool-use.ts',
  'detect/index.ts',
] as const

// Hook handlers that call runDetection — used for the 4-arg call-shape assertion.
const HANDLER_FILES = [
  'hook/handlers/user-prompt-submit.ts',
  'hook/handlers/pre-tool-use.ts',
  'hook/handlers/post-tool-use.ts',
] as const

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

describe('NER structural unreachability (import-graph proof)', () => {
  // -------------------------------------------------------------------------
  // Invariant 1: no hook-reachable module statically (runtime) imports the engine.
  // -------------------------------------------------------------------------
  it('no hook-reachable module has a RUNTIME static import of layer6b-ner', () => {
    for (const rel of HOOK_REACHABLE) {
      const src = read(rel)
      expect(
        hasRuntimeStaticImport(src, 'layer6b-ner'),
        `${rel} must not statically (runtime) import layer6b-ner — it is reachable ONLY via dynamic import()`,
      ).toBe(false)
    }
  })

  it('the ONLY static reference to layer6b-ner in the hook-reachable set is the import type line in detect/index.ts', () => {
    // detect/index.ts is permitted exactly ONE type-only import of the NerStatus union.
    expect(hasTypeOnlyImport(read('detect/index.ts'), 'layer6b-ner')).toBe(true)
    // Every OTHER hook-reachable module must not even type-import the engine.
    for (const rel of HOOK_REACHABLE) {
      if (rel === 'detect/index.ts') continue
      expect(
        hasTypeOnlyImport(read(rel), 'layer6b-ner'),
        `${rel} should have no reference to layer6b-ner at all`,
      ).toBe(false)
    }
  })

  // -------------------------------------------------------------------------
  // Invariant 2 + 3: @huggingface/transformers is dynamic-only and isolated to the singleton.
  // -------------------------------------------------------------------------
  it('@huggingface/transformers appears in src/ ONLY as a dynamic import in pipeline-singleton.ts', () => {
    const singleton = read('model/pipeline-singleton.ts')

    // Invariant 3: the singleton has NO static transformers import (only the dynamic one).
    expect(hasRuntimeStaticImport(singleton, '@huggingface/transformers')).toBe(false)
    expect(hasTypeOnlyImport(singleton, '@huggingface/transformers')).toBe(false)

    // The dynamic import() must be present in the singleton (the sole ML-dep boundary).
    expect(stripComments(singleton)).toMatch(/import\(\s*['"]@huggingface\/transformers['"]\s*\)/)

    // No OTHER hook-reachable module references the transformers package at all.
    for (const rel of HOOK_REACHABLE) {
      expect(
        stripComments(read(rel)).includes('@huggingface/transformers'),
        `${rel} must not reference @huggingface/transformers`,
      ).toBe(false)
    }
  })

  // -------------------------------------------------------------------------
  // Invariant 4: the engine is reached in detect/index.ts ONLY via dynamic import().
  // -------------------------------------------------------------------------
  it('detect/index.ts reaches the engine ONLY via dynamic import(./layer6b-ner.js)', () => {
    const code = stripComments(read('detect/index.ts'))
    // Exactly two dynamic imports of the engine (one per orchestrator function).
    const dynamicCount = (code.match(/import\(\s*['"]\.\/layer6b-ner\.js['"]\s*\)/g) ?? []).length
    expect(dynamicCount).toBe(2)
    // And zero runtime static imports of it.
    expect(hasRuntimeStaticImport(read('detect/index.ts'), 'layer6b-ner')).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Invariant 5: no hook handler passes a 5th argument (opts.ner) to runDetection.
  // -------------------------------------------------------------------------
  it('no hook handler call site passes a 5th argument to runDetection', () => {
    for (const rel of HANDLER_FILES) {
      const code = stripComments(read(rel))
      // Find each runDetection( ... ) call and verify its argument list has exactly 4 top-level args.
      const idx = code.indexOf('runDetection(')
      expect(idx, `${rel} should call runDetection`).toBeGreaterThanOrEqual(0)

      let i = idx
      while (i !== -1) {
        const argStr = extractCallArgs(code, i + 'runDetection'.length)
        const argCount = countTopLevelArgs(argStr)
        expect(
          argCount,
          `${rel}: runDetection must be called with exactly 4 args (no opts.ner) — found ${argCount}`,
        ).toBe(4)
        i = code.indexOf('runDetection(', i + 1)
      }
    }
  })
})

/**
 * Extract the substring inside the balanced parentheses of a call, given the index of the opening `(`.
 * Handles nested parens/braces/brackets and string literals so an object-literal 4th arg with commas
 * does not inflate the argument count.
 */
function extractCallArgs(code: string, openParenIdx: number): string {
  let depth = 0
  let start = -1
  for (let i = openParenIdx; i < code.length; i++) {
    const ch = code[i]
    if (ch === '(') {
      if (depth === 0) start = i + 1
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) return code.slice(start, i)
    }
  }
  return ''
}

/** Count top-level (comma-separated, depth-0) arguments in a call-argument string. */
function countTopLevelArgs(argStr: string): number {
  const trimmed = argStr.trim()
  if (trimmed.length === 0) return 0
  let depth = 0
  let args = 1
  let inStr: string | null = null
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!
    const prev = trimmed[i - 1]
    if (inStr) {
      if (ch === inStr && prev !== '\\') inStr = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inStr = ch
    } else if (ch === '(' || ch === '{' || ch === '[') {
      depth++
    } else if (ch === ')' || ch === '}' || ch === ']') {
      depth--
    } else if (ch === ',' && depth === 0) {
      args++
    }
  }
  return args
}
