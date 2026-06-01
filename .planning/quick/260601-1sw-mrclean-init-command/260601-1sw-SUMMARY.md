---
quick_id: 260601-1sw
slug: mrclean-init-command
date: 2026-06-01
status: complete
commit: 0d12c88
---

# Summary: `mrclean init` CLI subcommand + `/mrclean:mrclean-init` slash command

## What changed

- `src/install/init-project.ts` (new) — `WORDS_TXT_STUB` (comment-only seed) +
  `runInit({cwd})`. Reuses `createProjectDir` (dir + config stub) and
  `addGitignoreEntries`; seeds `words.txt` only if absent; prints a per-artifact
  summary; returns `{ dir, configCreated, wordsCreated }`. Idempotent, no clobber.
- `src/cli.ts` — registered the `init` subcommand (lazy-imports `runInit`).
- `commands/mrclean-init.md` (new, plugin root) — slash command, auto-discovered as
  `/mrclean:mrclean-init`, `allowed-tools: Bash(npx mrclean init)`,
  `disable-model-invocation: true`. Body shells the CLI and explains words.txt.
- `README.md` — documented `mrclean init` in §4 (Configure) and §5 (Dirty word list).
- `tests/install/init-project.test.ts`, `tests/cli/init-command.test.ts` (new).

## Design decision (security)

Original request was an MCP tool `mrclean_init`. Rejected: the MCP surface enforces the
**MCP-03 invariant** — exactly three tools, all `readOnlyHint`, with a `FORBIDDEN_TOOL_NAMES`
guard banning write/config tools (`tests/mcp/tools-list.test.ts`, `src/mcp/server.ts:13-16`).
The invariant exists to close a prompt-injection surface (a malicious prompt invoking a
write tool to weaken redaction). A disk-writing MCP tool would break it. Put the
deterministic logic in the CLI instead; the slash command shells it. MCP surface unchanged.

## Verification

- TDD: wrote `init-project` + `init-command` tests first (red — module missing, `init`
  not registered), then implemented (green).
- New tests: 5 passed. Full suite: **382 passed** (was 377). `tsup` build: success.
- Seed-correctness test: `loadWordsList` over the seeded `words.txt` returns `[]` — the
  comment-only seed injects no accidental blocklist terms.
- Live CLI smoke test (`node dist/cli.js init` in a temp dir): created config.toml +
  words.txt, added the `.mrclean/` managed block to `.gitignore`; re-run reported
  "already present" with no clobber.

## Notes

- MCP tool surface intentionally untouched — still exactly three read-only tools.
- `commands/` ships with the plugin (repo is the plugin); not part of the npm `files` list.
