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
  },
  format: ['esm'],
  target: 'node20',
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  // Bundle ALL npm dependencies into the output (node builtins stay external
  // automatically). Required for Claude Code plugin distribution: plugins are
  // git-cloned/fetched with NO `npm install`, so dist/cli.js and dist/mcp.js
  // must be fully self-contained. secretlint's preset rules are pulled in via
  // statically-analyzable dynamic import() and bundle cleanly.
  noExternal: [/.*/],
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
