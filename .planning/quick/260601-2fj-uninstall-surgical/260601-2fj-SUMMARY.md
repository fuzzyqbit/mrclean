---
quick_id: 260601-2fj
slug: uninstall-surgical
date: 2026-06-01
status: complete
commit: ca2891a
---

# Summary: uninstall surgically removes only mrclean entries

## Bug

`runUninstall` restored the entire `settings.json` / `~/.claude.json` from the oldest
mrclean backup snapshot. Any unrelated change made after install was silently clobbered.
Observed live: uninstall dropped an unrelated plugin enablement and re-enabled a plugin
the user had disabled.

## Fix

- `src/install/index.ts`: `runUninstall` now calls the surgical removers directly —
  `removeHookEntries` (filters the `_mrclean` marker), `removeMcpServerEntry` (deletes the
  `mrclean` key), `removeGitignoreEntries`. Removed the `restoreOrRemoveHooks` /
  `restoreOrRemoveMcp` backup-restore helpers and the now-unused `listMrcleanBackups` /
  `restoreFromBackup` import. Install still writes timestamped backups (manual safety net);
  uninstall just never auto-restores them.
- `tests/install/uninstall-roundtrip.test.ts`: replaced the byte-identity assertion (which
  encoded the buggy wholesale-restore) with a regression test — pre-install keys AND a
  post-install change both survive uninstall, mrclean hook entries gone. Kept the
  .gitignore-restore and .mrclean-retained tests.

## Verification

- TDD: new regression test red on old code (post-install `baz@qux` was dropped), green after fix.
- Install suite: 59 passed. Full suite: **382 passed**. `tsup` build: success.

## Notes

- Benign empty-array residue (`hooks:{event:[]}`, `mcpServers:{}`) is left in place — that
  is `removeHookEntries`' existing documented contract (settings.test.ts) and is a no-op for
  Claude Code. Pruning it was out of scope to avoid churning unrelated test contracts.
- This was the bug behind the earlier "plugin failing state" cleanup: the uninstall I ran to
  remove a duplicate install also reverted unrelated `enabledPlugins` changes, which I then
  had to repair by hand. This fix prevents that.
