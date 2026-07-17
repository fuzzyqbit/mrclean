import { defineConfig } from 'tsup'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    mcp: 'src/mcp.ts',
    // TEST-ONLY entry: detect-layer1 is compiled for bundle-worker integration tests
    // It is NOT shipped to npm consumers — excluded via package.json#files enumeration.
    // See vendor/SKIPPED_GITLEAKS_RULES.md acceptance criterion grep gate.
    'detect-layer1': 'src/detect/layer1-regex/index.ts',
    // TEST-ONLY entry: state-stress-worker is the SC5 16-process stress fixture
    // spawned by tests/state/stress.test.ts (Plan 09-08). It is NOT shipped to
    // npm consumers — package.json#files is an explicit enumeration that already
    // excludes new dist artifacts; do NOT "fix" files[] to include it.
    'state-stress-worker': 'tests/state/fixtures/stress-worker.ts',
  },
  format: ['esm'],
  target: 'node20',
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  // CJS-global shims for the ESM bundle (Plan 09-08, found by the SC5 stress
  // gate): bundled CJS deps reference __filename/__dirname as free variables —
  // write-file-atomic's getTmpname() does — and esbuild only auto-shims those
  // for cjs OUTPUT format. Without this, every reversible persist through the
  // dist bundle threw `ReferenceError: __filename is not defined` inside the
  // locked transaction and degraded (source runs under vitest/tsx never hit
  // it, which is why unit suites stayed green). tsup injects the shim only
  // into modules that use the globals.
  shims: true,
  // Bundle ALL npm dependencies into the output (node builtins stay external
  // automatically), EXCEPT the Layer 6b ML stack. Required for Claude Code plugin
  // distribution: plugins are git-cloned/fetched with NO `npm install`, so dist/cli.js and
  // dist/mcp.js must be fully self-contained. secretlint's preset rules are pulled in via
  // statically-analyzable dynamic import() and bundle cleanly.
  //
  // The negative lookahead excludes `@huggingface/transformers` + `onnxruntime-node` from
  // bundling. They are optionalDependencies, NOT installed by default (PII off by default),
  // and reached ONLY via the lazy dynamic import('@huggingface/transformers') in
  // pipeline-singleton.ts behind the MCP-only opts.ner gate. Bundling a 108 MB ONNX dep that
  // may be absent would (a) break the build when it is uninstalled and (b) balloon the bundle.
  // Keeping them external leaves the dynamic import unresolved in the bundle, satisfied at
  // runtime only when the user opts in (Plan 06-01/06-02; matches the lazy-import tech-stack rule).
  noExternal: [/^(?!@huggingface\/transformers$|onnxruntime-node$).*/],
  external: ['@huggingface/transformers', 'onnxruntime-node'],
  // Bundled CJS deps (commander, @secretlint/*) call require('events') etc. at
  // runtime. In an ESM bundle there is no `require`, so esbuild's interop stub
  // throws "Dynamic require of X is not supported". Inject a real require built
  // from createRequire — esbuild's shim then delegates to it for node builtins.
  banner: {
    js: "import { createRequire as __mrcleanCreateRequire } from 'module'; const require = __mrcleanCreateRequire(import.meta.url);",
  },
  // tsup auto-detects #!/usr/bin/env node shebang and makes output executable
  onSuccess: async () => {
    // Copy vendor/ directory into dist/ so the bundled detect-layer1.js can find gitleaks-rules.toml
    // (The adapter resolves the vendor path relative to import.meta.url; in the bundle dist/ context
    //  it looks for dist/vendor/gitleaks-rules.toml as one candidate path.)
    const vendorSrc = join(process.cwd(), 'vendor')
    const vendorDst = join(process.cwd(), 'dist', 'vendor')
    if (existsSync(vendorSrc)) {
      mkdirSync(vendorDst, { recursive: true })
      for (const file of ['gitleaks-rules.toml', 'gitleaks-rules.toml.sha256', 'SKIPPED_GITLEAKS_RULES.md']) {
        const src = join(vendorSrc, file)
        const dst = join(vendorDst, file)
        if (existsSync(src)) {
          copyFileSync(src, dst)
        }
      }
    }
  },
})
