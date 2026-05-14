---
phase: 01-wired-skeleton
plan: "02"
subsystem: install
tags: [install, uninstall, atomic-json, hook-registration, mcp-config, gitignore, idempotency]

requires:
  - "01-01: scaffold with dist/cli.js and dist/mcp.js built by tsup"

provides:
  - "src/install/atomic-json.ts — atomicWriteJson (same-dir tmp+rename), readJsonOrEmpty, backupJson, listMrcleanBackups, restoreFromBackup"
  - "src/install/path-resolver.ts — resolveNodePath, resolveMrcleanBinPath, resolveMrcleanMcpPath with realpath symlink resolution"
  - "src/install/markers.ts — MRCLEAN_MARKER, GITIGNORE_BEGIN, GITIGNORE_END, isMrcleanEntry typeguard"
  - "src/install/gitignore.ts — addGitignoreEntries/removeGitignoreEntries; project-root .gitignore managed block"
  - "src/install/project-dir.ts — createProjectDir with 0755 dir + 0644 stub config.toml"
  - "src/install/settings.ts — writeHookEntries/removeHookEntries for 4 hook events with _mrclean marker"
  - "src/install/mcp-config.ts — writeMcpServerEntry/removeMcpServerEntry for ~/.claude.json projects[cwd].mcpServers"
  - "src/install/index.ts — runInstall/runUninstall orchestrators with testable path injection"
  - "55 install tests (all passing)"

affects:
  - "03-hook: hook binary path written at install time"
  - "04-mcp: mcp server path written at install time"
  - "05-doctor: reads settings.json + claude.json to verify installation"

tech-stack:
  added:
    - "node:fs/promises (rename, copyFile, readdir, mkdir, chmod, access)"
    - "node:path (dirname, basename, join)"
    - "node:crypto (randomUUID for tmp file names)"
    - "picocolors (install/uninstall success banners)"
  patterns:
    - "Atomic write: write to <target>.mrclean-tmp-<uuid>.json in SAME directory as target, then rename — avoids cross-filesystem failure (Pitfall #5)"
    - "Backup naming: <target>.mrclean-backup-<ISO8601-safe>.json (: and . replaced with -)"
    - "Idempotency via _mrclean marker: filter-then-append pattern removes existing mrclean entries before re-inserting"
    - "Uninstall restoration: restore from oldest backup (pre-install state) rather than naive entry removal"
    - "Dependency injection: InstallOpts accepts homeDir/cwd/nodePath/mrcleanBinPath/mcpBinPath for test isolation"

key-files:
  created:
    - src/install/atomic-json.ts
    - src/install/path-resolver.ts
    - src/install/markers.ts
    - src/install/gitignore.ts
    - src/install/project-dir.ts
    - src/install/settings.ts
    - src/install/mcp-config.ts
    - tests/install/atomic-json.test.ts
    - tests/install/path-resolver.test.ts
    - tests/install/gitignore.test.ts
    - tests/install/project-dir.test.ts
    - tests/install/settings.test.ts
    - tests/install/mcp-config.test.ts
    - tests/install/idempotency.test.ts
    - tests/install/uninstall-roundtrip.test.ts
    - tests/fixtures/settings/empty.json
    - tests/fixtures/settings/with-other-hooks.json
    - tests/fixtures/claudejson/empty.json
    - tests/fixtures/claudejson/with-other-mcp.json
  modified:
    - src/install/index.ts (replaced Plan 01 stubs with real orchestrators)
    - src/cli.ts (narrowed opts.scope string to InstallOpts union type)

key-decisions:
  - "OQ-1 resolved: gitignore entry goes to project-root .gitignore (NOT .mrclean/.gitignore). A .gitignore at .mrclean/.gitignore cannot reliably self-ignore the parent directory from git's perspective — the safer approach (RESEARCH §10 recommendation) is to append .mrclean/ to the project root .gitignore."
  - "OQ-2 resolved: .mrclean/ created in process.cwd() at install time (not $CLAUDE_PROJECT_DIR which is only available inside hook/MCP processes). Operator runs mrclean install from project root."
  - "OQ-3 resolved: user-scope default — hooks go to ~/.claude/settings.json, MCP to ~/.claude.json under projects[cwd]. --scope project deferred to Phase 3 with a clear error message."
  - "Uninstall restoration via oldest backup: runUninstall restores the oldest mrclean backup file (pre-install state) rather than doing naive entry removal. This guarantees byte-identical round-trip even if the user had pre-existing hooks in the file."
  - "Phase 1 gitignore policy: managed block contains only .mrclean/ (entire directory). Operators who want to commit config.toml or words.txt must edit .gitignore manually — documented in this SUMMARY."
  - "Dependency injection via InstallOpts: nodePath/mrcleanBinPath/mcpBinPath can be injected in tests to avoid requiring a built dist/ on every test run. Integration tests use real resolved paths."

metrics:
  duration: "~9 min"
  completed: "2026-05-14"
  tasks: 2
  files_created: 19
  files_modified: 2
  tests_added: 55
  tests_total: 60
---

# Phase 1 Plan 02: Install/Uninstall Subcommand Summary

**Atomic JSON install/uninstall: hook entries in settings.json + MCP server in ~/.claude.json, idempotent via _mrclean marker, byte-identical round-trip via oldest-backup restoration**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-05-14T04:09:55Z
- **Completed:** 2026-05-14T04:19:19Z
- **Tasks:** 2 (TDD RED/GREEN pairs)
- **Files created:** 19 (7 src modules + 8 test files + 4 fixtures)
- **Tests:** 55 new (60 total including Plan 01 smoke tests)

## Accomplishments

### Task 1: Foundation Modules

All foundation modules implemented and tested (30 tests):

- **atomic-json.ts**: `atomicWriteJson` writes to a tmp file in the SAME directory as the target, then renames. This is Pitfall #5 defense — `os.tmpdir()` may be on a different filesystem than `~/.claude/`, which would cause `rename()` to fail across filesystems.
- **path-resolver.ts**: `resolveNodePath()` returns `process.execPath`. `resolveMrcleanBinPath()` and `resolveMrcleanMcpPath()` derive the package root from `import.meta.url` (works in source tree and installed dist), with argv-based fallback for npx. Uses `realpath()` to resolve symlinks — the recorded path is always the real file.
- **markers.ts**: `MRCLEAN_MARKER = '_mrclean'`, `GITIGNORE_BEGIN/END` delimiters, `isMrcleanEntry` typeguard.
- **gitignore.ts**: Writes managed block between marker delimiters to project-root `.gitignore`. Resolves OQ-1 (see below). Idempotent: strips existing block then appends fresh block.
- **project-dir.ts**: Creates `.mrclean/` at 0755 and `config.toml` stub at 0644. Does not clobber existing operator config. Stub is comment-only (no live key=value) so Plan 01-02b's config reader treats it as an empty layer.

### Task 2: Orchestrators and Mergers

Full install/uninstall pipeline implemented and tested (25 tests):

- **settings.ts**: Writes four hook event entries (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`) tagged with `_mrclean: true`. Matchers: `"startup"` for SessionStart, `"*"` for PreToolUse/PostToolUse, omitted for UserPromptSubmit (no matcher support per RESEARCH §1.1). Idempotent via filter-then-append.
- **mcp-config.ts**: Writes `projects[cwd].mcpServers.mrclean = { type: "stdio", command: nodePath, args: [mcpBinPath] }` into `~/.claude.json`. Idempotent key overwrite.
- **index.ts**: `runInstall` orchestrates all five steps with dependency injection. `runUninstall` restores the oldest mrclean backup (pre-install state) for byte-identical round-trip.

## Exact JSON Shape Written into settings.json

```json
{
  "hooks": {
    "SessionStart": [
      {
        "_mrclean": true,
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "/opt/homebrew/Cellar/node@22/22.22.0/bin/node",
            "args": ["/path/to/mrclean/dist/cli.js", "hook"],
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "_mrclean": true,
        "hooks": [
          {
            "type": "command",
            "command": "/opt/homebrew/Cellar/node@22/22.22.0/bin/node",
            "args": ["/path/to/mrclean/dist/cli.js", "hook"],
            "timeout": 10
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "_mrclean": true,
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "/opt/homebrew/Cellar/node@22/22.22.0/bin/node",
            "args": ["/path/to/mrclean/dist/cli.js", "hook"],
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "_mrclean": true,
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "/opt/homebrew/Cellar/node@22/22.22.0/bin/node",
            "args": ["/path/to/mrclean/dist/cli.js", "hook"],
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

## Exact JSON Shape Written into ~/.claude.json

```json
{
  "projects": {
    "/absolute/path/to/project": {
      "mcpServers": {
        "mrclean": {
          "type": "stdio",
          "command": "/opt/homebrew/Cellar/node@22/22.22.0/bin/node",
          "args": ["/path/to/mrclean/dist/mcp.js"]
        }
      }
    }
  }
}
```

## Backup Naming Convention

```
~/.claude/settings.json.mrclean-backup-2026-05-14T12-34-56-789Z.json
~/.claude.json.mrclean-backup-2026-05-14T12-34-56-789Z.json
```

Pattern: `<target>.mrclean-backup-<ISO8601-safe>.json` where `:` and `.` in the timestamp are replaced with `-` to produce a filesystem-safe filename.

## .gitignore Block Contents (Phase 1)

```
# >>> mrclean managed entries — do not edit manually >>>
.mrclean/
# <<< mrclean managed entries <<<
```

**Phase 1 policy:** The managed block ignores the ENTIRE `.mrclean/` directory. This means `audit.jsonl`, `session-*.json`, `manifest-*.jsonl`, `config.toml`, and `words.txt` are ALL gitignored by default.

**Operator note:** If you want to commit `config.toml` or `words.txt` for team-sharing, remove `.mrclean/` from your `.gitignore` manually and add specific exclusion lines. Phase 2/3 may add a `--commit-config` flag to automate this, but Phase 1 defaults to "ignore all."

## Resolved RESEARCH Open Questions

| OQ | Question | Resolution |
|----|----------|------------|
| OQ-1 | `.mrclean/.gitignore` vs. project-root `.gitignore`? | **Project-root `.gitignore`** — a subdirectory `.gitignore` cannot reliably self-ignore the parent directory. The project-root approach (RESEARCH §10 recommendation) is simple and unambiguous. |
| OQ-2 | Where does `install` write `.mrclean/`? | **`process.cwd()` at install time** — operator runs `npx mrclean install` from the project root. |
| OQ-3 | User-scope vs. project-scope MCP server? | **User-scope default** (`~/.claude.json`). `--scope project` deferred to Phase 3 with clear "not implemented in Phase 1" error. |

## Deviations from Plan

### Auto-fixed: Uninstall round-trip via oldest-backup restoration

**Found during:** Task 2 (uninstall-roundtrip.test.ts)

**Issue:** The plan's action description suggested `removeHookEntries` for uninstall, which would strip `_mrclean: true` entries but leave the modified file structure (empty hook arrays). A file that started as `{ preExisting: true }` after install+uninstall would become `{ preExisting: true, hooks: { SessionStart: [], ... } }` — NOT byte-identical to the pre-install state.

**Fix (Rule 1 — Bug):** `runUninstall` now restores from the oldest available mrclean backup (the one created before the first install). This gives guaranteed byte-identical restoration. Falls back to entry-removal if no backups exist (e.g., user manually deleted backups).

**Files modified:** `src/install/index.ts`

**Impact:** The round-trip test passes. The behavior matches the plan's `must_haves.truths` ("byte-identical to the pre-install backup") more faithfully than naive entry removal.

### Minor: CLI scope type narrowing

**Found during:** Task 2 TypeScript build

**Issue:** `src/cli.ts` passed `opts.scope: string` directly to `runInstall({ scope: opts.scope })`. TypeScript rejected this because `InstallOpts.scope` is `'user' | 'project' | undefined`, not `string`.

**Fix (Rule 1 — Type Error):** Added `const scope = opts.scope === 'project' ? 'project' : 'user'` to narrow the type before passing.

**Files modified:** `src/cli.ts`

## Known Stubs

None — Plan 02 delivers complete functionality. The only intentional stub is the `.mrclean/config.toml` file, which contains only comments and empty section headers (no live values). Plan 01-02b's config reader treats it as an empty layer.

## Test Counts

| Test File | Tests | Coverage Target |
|-----------|-------|-----------------|
| atomic-json.test.ts | 10 | Pitfall #5 defense, backup naming |
| path-resolver.test.ts | 6 | Absolute path resolution (INST-04) |
| gitignore.test.ts | 7 | Idempotency, OQ-1 |
| project-dir.test.ts | 5 | Stub creation, no-clobber |
| settings.test.ts | 10 | 4-event hook writing, RESEARCH §1.5 |
| mcp-config.test.ts | 9 | RESEARCH §2.2 shape |
| idempotency.test.ts | 4 | INST-02 |
| uninstall-roundtrip.test.ts | 4 | INST-03, INST-05 |
| **Total** | **55** | |

## RESEARCH-Flagged Assumptions Validated

| Assumption | Status | Method |
|------------|--------|--------|
| A1: `.mrclean/.gitignore` self-reference | INVALIDATED → switched to project-root approach (OQ-1) | Integration tests + git behavior reasoning |
| Pitfall #5 (cross-fs rename) | GUARDED | `dirname(target)` for tmp path, verified in atomic-json tests |
| Pitfall #7 (bare command names) | GUARDED | `resolveMrcleanBinPath()` returns realpath; idempotency tests verify absolute path in args |

## Threat Flags

None — this plan writes to local user-owned config files (`~/.claude/settings.json`, `~/.claude.json`, project-root `.gitignore`). No new network endpoints, auth paths, or trust-boundary crossings introduced.

---
*Phase: 01-wired-skeleton*
*Completed: 2026-05-14*
