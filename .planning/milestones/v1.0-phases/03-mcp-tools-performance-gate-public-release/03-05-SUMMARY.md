---
phase: 03-mcp-tools-performance-gate-public-release
plan: "05"
subsystem: infra
tags: [changesets, npm-publish, provenance, release-smoke, github-actions, oidc]

# Dependency graph
requires:
  - phase: 03-mcp-tools-performance-gate-public-release
    provides: "03-00: package metadata + scripts.release; 03-03: LICENSE + CHANGELOG + .changeset/ scaffold; 03-04: CI green gates (test.yml + canary-leak.yml + perf.yml)"
provides:
  - .github/workflows/release.yml — changesets/action@v1 automated version-PR + npm publish pipeline
  - .github/workflows/release-smoke.yml — post-publish artifact verification on fresh runner
  - .changeset/initial-release.md — descriptor for rc.1 -> 1.0.0 major bump
  - docs/RELEASE.md — maintainer reference for first-manual-publish + automated subsequent publish
affects: [first-publish, npm-registry, 1.0.0-release, release-smoke]

# Tech tracking
tech-stack:
  added: [changesets/action@v1, github-actions-workflow_run, npm-oidc-provenance]
  patterns:
    - changesets version-PR workflow (pending changeset -> version-PR -> publish on merge)
    - workflow_run trigger for post-publish smoke test
    - NPM_TOKEN + NODE_AUTH_TOKEN dual env pattern for OIDC + actions/setup-node

key-files:
  created:
    - .github/workflows/release.yml
    - .github/workflows/release-smoke.yml
    - .changeset/initial-release.md
    - docs/RELEASE.md
  modified: []

key-decisions:
  - "docs/ directory not in package.json#files — RELEASE.md is maintainer-only, never published to npm"
  - "release-smoke uses workflow_run trigger on Release workflow — smoke only fires after successful publish, not on every push"
  - "90s sleep in release-smoke covers npm CDN propagation lag before npm install -g"
  - "Local first-publish (1.0.0-rc.1) omits --provenance — OIDC token unavailable locally; documented in RELEASE.md §Pitfall 5"
  - "NODE_AUTH_TOKEN must duplicate NPM_TOKEN — actions/setup-node with registry-url reads NODE_AUTH_TOKEN, not NPM_TOKEN"

patterns-established:
  - "Release pipeline: changesets/action@v1 creates version-PR or publishes depending on pending changeset state"
  - "Post-publish smoke: workflow_run trigger with conclusion==success guard + CDN sleep + global install on fresh runner"

requirements-completed: [DOC-03]

# Metrics
duration: 15min
completed: 2026-05-14
---

# Phase 3 Plan 05: Release Pipeline Summary

**changesets/action@v1 release workflow + post-publish smoke suite + initial-release.md for rc.1 -> 1.0.0 automated bump**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-14T15:30:00Z
- **Completed:** 2026-05-14T15:45:00Z
- **Tasks:** 2 auto + 1 checkpoint (human-action — manual first publish)
- **Files created:** 4

## Accomplishments

- Release workflow (`.github/workflows/release.yml`) ships changesets/action@v1 with full OIDC provenance permissions: `id-token: write`, `contents: write`, `pull-requests: write`. Runs `npm test` before changesets step — broken builds cannot publish.
- Release-smoke workflow (`.github/workflows/release-smoke.yml`) fires automatically on successful Release completion; exercises Phase 1 install/doctor + Phase 2 hook canary (Stripe shape) + MCP tools/list on a fresh ubuntu-latest runner.
- Initial changeset (`.changeset/initial-release.md`) is committed and ready; the FIRST Release workflow run on main will consume it and open a "Version Packages" PR bumping from `1.0.0-rc.1` to `1.0.0`.
- `docs/RELEASE.md` documents both the one-time manual first-publish flow (no `--provenance` locally) and the automated subsequent-publish flow via changesets.
- `npm run build` and `npm test` (53 test files, 367 tests) are green as of this plan's execution.

## Task Commits

Each task was committed atomically:

1. **Task 1: release.yml + initial-release.md + docs/RELEASE.md** — `4f46507` (feat)
2. **Task 2: release-smoke.yml** — `e0d735b` (feat)
3. **Task 3: Maintainer first publish** — checkpoint:human-action (pending operator action)

## Files Created

- `.github/workflows/release.yml` — changesets/action@v1 on push to main; permissions: id-token+contents+pull-requests write; env: GITHUB_TOKEN + NPM_TOKEN + NODE_AUTH_TOKEN; runs build + test before publish
- `.github/workflows/release-smoke.yml` — workflow_run trigger on Release workflow success; installs mrclean-claude@latest on fresh runner; tests Phase 1 + Phase 2 success criteria headlessly
- `.changeset/initial-release.md` — `"mrclean-claude": major` changeset; will be consumed by changesets/action to open version-PR for 1.0.0
- `docs/RELEASE.md` — maintainer reference: first-manual-publish steps + automated subsequent-publish flow + rollback procedure

## Decisions Made

- `docs/` directory is NOT in `package.json#files` — confirmed from 03-00 plan; RELEASE.md stays repo-only, never enters the npm tarball.
- `release-smoke.yml` uses `workflow_run` trigger (not `on: push`) so the smoke only fires after a live publish — no false-positive runs on every PR.
- 90-second sleep before `npm install -g` gives npm CDN time to propagate the freshly-published package; prevents race condition where the runner installs the previous version.
- `NODE_AUTH_TOKEN` is set to `${{ secrets.NPM_TOKEN }}` in addition to `NPM_TOKEN` because `actions/setup-node` with `registry-url` reads `NODE_AUTH_TOKEN` to authenticate push operations (RESEARCH §Pitfall 6).
- First manual publish (1.0.0-rc.1) MUST omit `--provenance` — OIDC token only available in GitHub Actions, not on local machines (RESEARCH §Pitfall 5). Documented explicitly in RELEASE.md.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

Task 3 is a `checkpoint:human-action` — the maintainer must:

1. Verify CI gates are green on main (test.yml + perf.yml + canary-leak.yml).
2. Create an npm Automation token at npmjs.com and add it as `NPM_TOKEN` GitHub repository secret.
3. Run the manual first publish from their local machine (see `docs/RELEASE.md §First publish (manual, one-time)`):
   - `npm whoami` / `npm login`
   - `npm ci && npm run build && npm test`
   - `npm pack --dry-run` to review tarball contents
   - `npm publish --access public` (NO `--provenance` flag)
   - `git tag v1.0.0-rc.1 && git push --tags`
4. After the next push to main, the Release workflow will consume `.changeset/initial-release.md` and open a version-PR bumping to 1.0.0. Merge it. The subsequent Release run publishes 1.0.0 with full provenance.

## Next Phase Readiness

Phase 3 is complete. All five ROADMAP success criteria are addressed:
1. `mrclean install` wires hooks + MCP (Phase 1)
2. `mrclean doctor` reports green (Phase 1)
3. Hook detects and blocks real secrets (Phase 2)
4. `npm install -g mrclean-claude` reproduces Phase 1+2 criteria on a clean machine (Phase 3 — verified by release-smoke.yml after first publish)
5. Changesets pipeline automates version-PR + provenance publish on subsequent releases (Phase 3 — this plan)

Remaining blocker: maintainer must complete the Task 3 manual first-publish checkpoint before the package is live on npm.

---
*Phase: 03-mcp-tools-performance-gate-public-release*
*Completed: 2026-05-14*
