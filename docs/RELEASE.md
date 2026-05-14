# Release process

## First publish (manual, one-time)

The 1.0.0-rc.1 first-publish runs from the maintainer's local machine because
`npm publish --provenance` requires a GitHub Actions OIDC token (RESEARCH §Pitfall 5).
Subsequent versions auto-publish via the Release workflow with full provenance.

Prerequisites:
- npm account with publish rights for `mrclean-claude`
- 2FA device if the account has 2FA enabled (RESEARCH §OQ-4)
- Green main branch (test.yml + perf.yml + canary-leak.yml all passing)

Steps:
1. `npm whoami` — confirm you are logged in. If not: `npm login`.
2. `git checkout main && git pull`
3. `npm ci`
4. `npm run build`
5. `npm test` — must pass
6. `npm run test:coverage` — must pass
7. `npm pack --dry-run` — review the tarball file list; must match package.json#files
8. `npm publish --access public` — NOTE: NO `--provenance` flag for the local publish
9. Verify: `npm view mrclean-claude` shows version 1.0.0-rc.1
10. `git tag v1.0.0-rc.1 && git push --tags`

## Subsequent publishes (automated via changesets/action)

Per-PR contributor flow:
- Add a changeset: `npx changeset add` — prompts for bump level + summary
- Commit the generated `.changeset/<slug>.md`
- Open a PR, get it reviewed, merge to main

Post-merge:
- The Release workflow runs on push to main.
- changesets/action sees the new `.changeset/*.md` file and opens a "Version Packages" PR.
- A maintainer reviews the version-PR; the PR will update package.json#version + CHANGELOG.md.
- Merge the version-PR.
- The Release workflow runs again. This time there are no pending changesets, so it runs the publish step.
- `npm run release` (defined in package.json) executes: `npm run build && changeset publish --provenance --access public`.
- The release-smoke workflow fires automatically on the Release workflow's successful completion.

## 1.0.0-rc.1 -> 1.0.0 transition

Special case: the initial changeset `.changeset/initial-release.md` is shipped in
the repo (created by plan 03-05). The FIRST run of the Release workflow on main
consumes it and opens a version-PR bumping to 1.0.0. After merge, the next Release
workflow run does the 1.0.0 publish.

## Rollback

If a published version is broken:
- `npm dist-tag rm mrclean-claude latest` — un-default the broken version
- `npm dist-tag add mrclean-claude@<previous-good-version> latest` — restore a good default
- npm policy forbids unpublishing after 72 hours; for emergency rollbacks within 72 hours: `npm unpublish mrclean-claude@<version>`
- For provenance-attested broken versions: see https://docs.npmjs.com/policies/security
