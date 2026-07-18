---
status: diagnosed
trigger: "CI matrix leg node-version=20.18 fails npm test with 'Cannot find native binding' / 'Cannot find module @rolldown/binding-linux-x64-gnu' while 20.x (resolves 20.20.2) and 22.x pass. Previous fix attempt (force npm@latest) was WRONG and reverted — it broke Node 20 support entirely. Need real root cause before any second fix attempt."
created: 2026-07-18T14:41:00Z
updated: 2026-07-18T15:10:00Z
---

## Current Focus

hypothesis: CONFIRMED — see Resolution below.
test: n/a — investigation complete, diagnose-only mode (no file edits made).
expecting: n/a
next_action: Return DIAGNOSIS COMPLETE to caller. Do not implement fix (out of scope for this session).

## Symptoms

expected: `npm test` (vitest run) should pass on all three CI matrix legs: node-version 20.18, 20.x, 22.x.
actual: Fails ONLY on the 20.18 leg with a native-binding resolution error at vitest/vite startup. 20.x (resolves to Node v20.20.2) and 22.x pass clean.
errors: |
  Error: Cannot find native binding. npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828)
  [cause]: Error: Cannot find module '@rolldown/binding-linux-x64-gnu'
  cause: Error: Cannot find module '../rolldown-binding.linux-x64-gnu.node'
reproduction: Run CI matrix on ubuntu-latest with node-version 20.18 (resolves 20.18.3) — 100% deterministic, confirmed via isolated `gh run rerun --failed` with no concurrent matrix legs (rules out cache race).
started: Discovered when `.github/workflows/test.yml` matrix included 20.18 as the explicit floor-pin leg alongside floating 20.x and 22.x.

## Eliminated

- hypothesis: Older npm (bundled with Node 20.18.x) has the optional-deps bug from npm/cli#4828, and upgrading npm fixes it.
  evidence: Both the 20.18 leg (Node v20.18.3) and 20.x leg (Node v20.20.2) reported IDENTICAL bundled npm version `10.8.2`. Forcing `npm install -g npm@latest` (npm v12) was tried and reverted — it dropped Node 20 support entirely (npm v12 requires a higher Node floor), breaking a previously-passing leg. npm version is not the differentiator.
  timestamp: 2026-07-18T14:41:00Z (established as confirmed_fact prior to this session; formally eliminated by direct source-code evidence below)

- hypothesis: npm/cli#4828 (incomplete package-lock.json from platform-specific optional deps being regenerated with only the current machine's arch/OS present) is the actual mechanism, as the error message itself suggests.
  evidence: Inspected package-lock.json directly — the `rolldown@1.0.0` optionalDependencies list contains ALL 15 platform binding packages (android-arm64, darwin-arm64/x64, freebsd-x64, linux-arm-gnueabihf, linux-arm64-gnu/musl, linux-ppc64-gnu, linux-s390x-gnu, linux-x64-gnu/musl, openharmony-arm64, wasm32-wasi, win32-arm64-msvc/x64-msvc), each with correct `os`/`cpu`/`engines` fields recorded. The lockfile is complete, not regenerated-incomplete. #4828 is a different bug (lockfile regeneration with existing node_modules present) and does not apply here — the error message's citation of #4828 is a generic troubleshooting hint baked into rolldown/rollup-style error reporting, not an accurate diagnosis of this specific failure.
  timestamp: 2026-07-18T15:05:00Z

## Evidence

- timestamp: 2026-07-18T14:50:00Z
  checked: package-lock.json, node_modules/@rolldown/binding-linux-x64-gnu entry (line 1899)
  found: |
    "node_modules/@rolldown/binding-linux-x64-gnu": {
      "version": "1.0.0", "cpu": ["x64"], "os": ["linux"], "optional": true,
      "engines": { "node": "^20.19.0 || >=22.12.0" }
    }
  implication: This optional package declares its OWN engines.node floor of 20.19.0 — one patch above the CI's 20.18 leg.

- timestamp: 2026-07-18T14:52:00Z
  checked: package-lock.json, node_modules/rolldown entry (line ~5629) and node_modules/vite entry (line 6638)
  found: |
    "vite@8.0.12" declares "dependencies": { "rolldown": "1.0.0", ... } (rolldown is a HARD, non-optional dependency of vite 8 — vite 8 made rolldown its default/only bundler, replacing rollup+esbuild) and "engines": { "node": "^20.19.0 || >=22.12.0" }.
    "rolldown@1.0.0" itself declares "engines": { "node": "^20.19.0 || >=22.12.0" } and lists all 15 platform binding packages under its own "optionalDependencies" (napi-rs multi-platform pattern — one binding package per OS/CPU, each individually optional).
    vite 8 is pulled in transitively because vitest@4.1.6 has vite as an unbundled peer dependency (per project tech-stack doc: "Vitest 4.1 reuses the host project's installed Vite instead of bundling its own").
  implication: The engines floor of 20.19.0 originates in vite 8 / rolldown themselves, not in mrclean's own code or CI config. mrclean's package.json engines.node (`>=20.18.0`) is now stale relative to what the actual devDependency graph requires for testing.

- timestamp: 2026-07-18T14:58:00Z
  checked: npm registry API directly — `curl https://registry.npmjs.org/@rolldown%2fbinding-linux-x64-gnu/1.0.0`
  found: Published package.json confirms `"engines":{"node":"^20.19.0 || >=22.12.0"}` verbatim, matching the lockfile record exactly (not a lockfile transcription error).
  implication: This is the actual, registry-authoritative constraint, not an artifact of a stale/regenerated lockfile.

- timestamp: 2026-07-18T15:02:00Z
  checked: npm/cli source — `workspaces/arborist/lib/arborist/build-ideal-tree.js`, method `#checkEngineAndPlatform()` (fetched directly from github.com/npm/cli, `latest` branch)
  found: |
    for (const node of this.idealTree.inventory.values()) {
      if (!node.optional && !node.shouldOmit(omitSet)) {
        // non-optional path: checkEngine failure -> log.warn only (unless --engine-strict)
        ...
      }
      if (node.optional && !node.inert) {
        // Mark any optional packages we can't install as inert.
        // We ignore the --force and --engine-strict flags.
        try {
          checkEngine(node.package, npmVersion, nodeVersion, false)
          checkPlatform(node.package, false, { cpu, os, libc })
        } catch (error) {
          const set = optionalSet(node)
          for (const node of set) { node.inert = true }
        }
      }
    }
  implication: |
    THIS IS THE MECHANISM. For nodes under optionalDependencies, npm's arborist calls checkEngine() with force HARD-CODED to false (comment: "We ignore the --force and --engine-strict flags"). checkEngine() (from npm-install-checks, verified via `curl raw.githubusercontent.com/npm/npm-install-checks/main/lib/index.js`) does `semver.satisfies(nodeVer, eng.node)` and throws EBADENGINE on mismatch. When it throws for an optional node, arborist catches it SILENTLY (no warning, no error, no log line) and marks the entire optional-dependency subtree "inert" — meaning npm simply never installs it. This is npm's documented, intentional, version-independent behavior for gating optional platform/engine-specific packages (the same mechanism that makes only the correct OS/CPU rollup/esbuild/napi-rs binary get installed on any given machine — it now also gates on `engines`).

- timestamp: 2026-07-18T15:04:00Z
  checked: npm/cli source — `workspaces/arborist/lib/arborist/index.js` line 100
  found: `nodeVersion: process.version` — the default value arborist uses for the engine check is the LITERAL running Node.js binary's own version string.
  implication: |
    This directly answers the "why does it differ between 20.18.3 and 20.20.2 despite identical npm 10.8.2" question. The differentiator was NEVER the npm binary version — it is `process.version` of whichever Node.js binary is currently executing `npm install`/`npm ci`. 20.18.3 fails `semver.satisfies('20.18.3', '^20.19.0 || >=22.12.0')` (false — 20.18.3 < 20.19.0). 20.20.2 passes (`^20.19.0` = `>=20.19.0 <21.0.0`, and 20.20.2 is in range). Any current 22.x resolves well above 22.12.0 (LTS baseline was Nov 2024) and passes the second branch of the OR.

- timestamp: 2026-07-18T15:07:00Z
  checked: WebSearch — rolldown/rolldown issues #9068, #9098; vuejs/vitepress #5067; lazarv/react-server discussion #334
  found: Multiple independent reports of the identical failure signature (`Cannot find module '@rolldown/binding-<platform>'`) across different package managers (pnpm, npm) and platforms (linux-x64-gnu, darwin-arm64, win32-x64-msvc), consistently traced by reporters to the native binding package not being installed due to platform/engine constraints not being satisfied by the resolving environment.
  implication: Corroborates that this is a known, reproducible class of issue in the rolldown ecosystem, not an mrclean-specific fluke or environment corruption.

## Resolution

root_cause: |
  npm's arborist silently skips installing an `optionalDependencies` package when that package's own `engines.node` field does not match the CURRENTLY RUNNING Node.js binary's `process.version` (not the npm binary's version, and independent of `--force`/`--engine-strict` flags, which npm explicitly ignores for this specific check per its own source comment).

  In this repo: vitest@4.1.6 pulls in vite@8.0.12 transitively as an unbundled peer. Vite 8 made `rolldown` a hard (non-optional) dependency, replacing rollup/esbuild as its default bundler. `rolldown@1.0.0` declares `engines.node: "^20.19.0 || >=22.12.0"` on itself AND on every one of its own platform-specific native binding packages (e.g. `@rolldown/binding-linux-x64-gnu@1.0.0`, verified against the live npm registry).

  On the `20.18` CI matrix leg (resolves to Node v20.18.3), `20.18.3` fails `semver.satisfies(nodeVer, '^20.19.0 || >=22.12.0')` — it is one patch version below the `^20.19.0` floor. npm's `#checkEngineAndPlatform()` step (workspaces/arborist/lib/arborist/build-ideal-tree.js) catches this failure for the optional binding node and marks it (and its optional-dependency-set boundary) `inert`, meaning it is never written to node_modules — with NO warning printed, because the warning-log branch only fires for non-optional nodes. On the `20.x` leg (resolves to v20.20.2) and `22.x` leg, the same check passes, so the binding installs normally.

  At runtime, rolldown's binding loader does `require('@rolldown/binding-linux-x64-gnu')` (resolving internally to `rolldown-binding.linux-x64-gnu.node`), finds it absent from node_modules, and throws "Cannot find native binding" — vite/vitest then fails to start. The error message's citation of npm/cli#4828 is a generic, inaccurate troubleshooting hint (that issue is about a DIFFERENT bug — incomplete lockfile regeneration — which was explicitly ruled out here: this repo's lockfile is complete for all 15 platform variants).

  This is why forcing `npm install -g npm@latest` did NOT fix it (npm version was never the variable) and additionally broke things (npm v12 itself requires a Node floor above 20.18, so it made an unrelated, previously-working thing worse).

fix: NOT APPLIED — this session is diagnose-only per objective constraints. No files edited, no CI triggered.
verification: N/A — no fix applied in this session.
files_changed: []
