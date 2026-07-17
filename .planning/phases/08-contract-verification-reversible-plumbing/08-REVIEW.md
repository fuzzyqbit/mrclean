---
phase: 08-contract-verification-reversible-plumbing
reviewed: 2026-07-17T00:55:05Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/install/atomic-json.ts
  - src/install/settings.ts
  - src/install/index.ts
  - tests/install/atomic-json.test.ts
  - tests/install/fresh-home.test.ts
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: issues_found
---

# Phase 8: Code Review Report (Round 3 — gap-closure review of plan 08-12)

**Reviewed:** 2026-07-17T00:55:05Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Scope: commits after `b3d8e1d` — `d0fdd6b` (RED tests), `73e006f` (mkdir in `atomicWriteJson` + banner count from `HOOK_EVENTS.length`), `0c0a7f7` (dist rebuild). Focus areas per the review request: mkdir-before-tmp-write (error handling, TOCTOU, permissions), the exported `HOOK_EVENTS` + banner interpolation, and the two new/extended test files.

**Verified sound (traced, not assumed):**

- **Both UAT gaps are genuinely closed.** Gap 1: `atomicWriteJson` now runs `mkdir(dir, { recursive: true })` before the tmp write (`src/install/atomic-json.ts:48`), and the fresh-HOME test creates `tempHome` *without* `.claude` and asserts the full install round-trip. Gap 2: the banner interpolates `HOOK_EVENTS.length` (`src/install/index.ts:81`) from the now-exported single source of truth (`src/install/settings.ts:22`); the stale `hooks: 4` literal is gone.
- **Dist is in sync with src.** The committed `dist/cli.js` contains the mkdir call (bundle line 3539) and the derived banner interpolation (bundle line 3943), and a full `tsup` rebuild during this review left the git tree byte-identical — commit `0c0a7f7` is an honest rebuild.
- **Tests pass and are honest tripwires:** both suites executed during review — 14/14 pass. The banner test is *not* circular: `bannerCount` and `registeredEvents` both ultimately derive from `HOOK_EVENTS`, but the hardcoded `toHaveLength(5)` at `tests/install/fresh-home.test.ts:133` breaks the circularity, and the duplicated `EXPECTED_HOOK_EVENTS` mirror in the same file means list drift fails a test rather than silently passing.
- **TOCTOU / atomicity of the mkdir change:** the mkdir is create-then-use (not check-then-use), is idempotent under `recursive: true`, and sits correctly *outside* the try block (no tmp file exists yet to clean up). If the directory is removed between mkdir and the tmp write, `writeFile` rejects with ENOENT and the error propagates — fail-loud, no silent bypass. Concurrent `atomicWriteJson` calls use UUID-unique tmp names + atomic rename → last-writer-wins, no torn file.
- **mkdir directory mode:** the created `~/.claude` gets Node's default `0o777 & ~umask` (typically 755). Ground-truthed against the live machine: Claude Code's own `~/.claude` is `drwxr-xr-x` (755), so mrclean matches platform-owner behavior rather than diverging. Not a defect.
- **Uninstall does not spuriously create directories:** `removeHookEntries`/`removeMcpServerEntry` early-return before any write when there is nothing to remove, so the mkdir-in-primitive change cannot materialize `~/.claude` on an uninstall of a clean machine.

**Prior rounds:** round-2 findings (CR-01/02, WR-01..04) targeted `tests/uat/` rendering modules — all recorded as resolved in git history (`79705c1`..`14707d2`) and out of this round's file scope; not re-reviewed.

The four warnings below are robustness/security-hardening gaps in the reviewed files. Two (WR-01, WR-03) are directly implicated by this round's mkdir change; two (WR-02, WR-04) are pre-existing defects in the reviewed files surfaced by standard-depth tracing. None is a regression introduced by 08-12's diff, and none blocks ship — but WR-01 and WR-02 sit in the shared primitive every config write flows through and are cheap to fix.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: atomicWriteJson silently resets the target file's permission bits to 644 on every rewrite

**File:** `src/install/atomic-json.ts:48-52` (affects `src/install/settings.ts:166,202` and `src/install/mcp-config.ts:75,107` — i.e. `~/.claude/settings.json` and `~/.claude.json`)
**Issue:** The atomic-rename pattern replaces the target's inode with the tmp file's inode. The tmp file is created by `writeFile` with the default mode `0o666 & ~umask` (typically 644), so after `rename` the target carries 644 **regardless of its previous mode**. A user who hardened `~/.claude.json` or `~/.claude/settings.json` to 600 (reasonable — `~/.claude.json` carries account metadata and per-project state, and hooks in settings.json can embed env-derived values) has that hardening silently undone by any `mrclean install`/`uninstall`. For a tool whose entire brand is "secrets never leak," widening a user-tightened config file back to world-readable without notice is a hardening regression. Notably `backupJson` does NOT have this problem (`copyFile` preserves the source mode), so only the live file is loosened — the backup stays hardened, which makes the asymmetry more surprising. The review request explicitly asked about permissions of the mkdir path; the directory mode is fine (see Summary), but the file-mode non-preservation is the real gap.
**Fix:** Stat the target before writing and give the tmp file the same permission bits (mode applies at creation; `undefined` falls back to the default):

```ts
import { readFile, writeFile, rename, copyFile, mkdir, readdir, unlink, stat } from 'node:fs/promises'

export async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const dir = dirname(path)
  const tmpPath = join(dir, `.mrclean-tmp-${randomUUID()}.json`)

  await mkdir(dir, { recursive: true })

  // Preserve existing permission bits: a user-hardened 600 config must not
  // silently widen to 644 because the tmp file's default mode survives rename.
  let mode: number | undefined
  try {
    mode = (await stat(path)).mode & 0o777
  } catch {
    // Target does not exist yet — default mode is fine
  }

  try {
    await writeFile(tmpPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode })
    await rename(tmpPath, path)
  } catch (err) {
    try { await unlink(tmpPath) } catch { /* ignore cleanup errors */ }
    throw err
  }
}
```

### WR-02: readJsonOrEmpty returns non-object JSON as `Record`, producing a raw TypeError, an unlabeled SyntaxError, or a silent fail-open install

**File:** `src/install/atomic-json.ts:20-31` (consumed at `src/install/settings.ts:128-134`, `src/install/mcp-config.ts:39-54`, `src/doctor/checks.ts:127+`)
**Issue:** The function casts `JSON.parse(raw)` straight to `Record<string, unknown>` without validating it is a plain object. Three concrete failure paths, all at a system boundary parsing external file content (the user hand-edits these files):
1. `settings.json` containing `null` → `writeHookEntries` line 131 reads `data.hooks` on `null` → raw `TypeError: Cannot read properties of null` crash.
2. **Empty file** (`touch ~/.claude/settings.json` — entirely plausible) → `JSON.parse('')` throws `SyntaxError: Unexpected end of JSON input`, rethrown with **no indication of which file** is broken. Same raw-stack symptom class UAT gap 1 complained about.
3. `settings.json` containing a top-level **array** → `data.hooks = {}` attaches a non-index property to the array, all five hook entries are written onto it, then `JSON.stringify(data)` serializes only the array indices and **drops the entire `hooks` property**. Net effect: the original array is written back unchanged, no hook is registered, and the success banner still prints `(hooks: 5, ...)` — a silent fail-open install for a fail-closed security tool.
**Fix:** Validate the parsed shape and attach file context to parse errors:

```ts
export async function readJsonOrEmpty(path: string): Promise<Record<string, unknown>> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`mrclean: ${path} is not valid JSON (${(err as Error).message}) — fix or remove it, then re-run`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`mrclean: expected a JSON object in ${path}, found ${Array.isArray(parsed) ? 'an array' : String(parsed === null ? 'null' : typeof parsed)}`)
  }
  return parsed as Record<string, unknown>
}
```

### WR-03: install failure modes still surface as raw Node stacks — the new mkdir adds fresh untranslated errno sources and nothing catches them

**File:** `src/install/index.ts:57-84` (mkdir source at `src/install/atomic-json.ts:48`; uncaught top-level `await program.parseAsync(process.argv)` at `src/cli.ts:124`)
**Issue:** UAT gap 1's symptom was "crashes with a raw Node ENOENT stack." The 08-12 fix removes the *trigger* (missing `~/.claude`) but not the *symptom class*: `runInstall` has no error contextualization, and `src/cli.ts:124` awaits `parseAsync` bare at module top level, so any rejection prints an unhandled-rejection stack. The new `mkdir(dir, { recursive: true })` call itself introduces new members of this class: if `~/.claude` exists as a regular **file** (or a path component is a file), mkdir throws raw `EEXIST`/`ENOTDIR`; `EACCES`, `EROFS`, and `ENOSPC` on the tmp write behave the same. Combined with WR-02's unlabeled `SyntaxError`, the next UAT-style report will look identical to gap 1 with a different errno. Project error-handling rules require user-friendly messages in UI-facing code paths.
**Fix:** Catch in the install/uninstall `.action()` handlers (NOT around `parseAsync` globally — the `hook` subcommand owns exit-code semantics where exit 2 means BLOCK, and a blanket catch risks remapping those):

```ts
.action(async (opts: { scope: string }) => {
  const { runInstall } = await import('./install/index.js')
  const scope = opts.scope === 'project' ? 'project' : 'user'
  try {
    await runInstall({ scope })
  } catch (err) {
    process.stderr.write(`mrclean install failed: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  }
})
```

### WR-04: no locking around read→mutate→write of live shared config files — concurrent Claude Code sessions can silently lose the install (pre-existing)

**File:** `src/install/settings.ts:122-167` (same pattern at `src/install/mcp-config.ts:33-76`)
**Issue:** `writeHookEntries` reads `settings.json`, mutates in memory, backs up, then rewrites the whole file. There is no lock and no re-read verification, and the target files are live-written by a normally-running application: Claude Code appends "always allow" permission rules to `~/.claude/settings.json` mid-session and rewrites `~/.claude.json` frequently (project state/history). Running `mrclean install` while a Claude Code session is open can (a) clobber a settings update Claude Code made between mrclean's read and write, or (b) have mrclean's freshly written hook/MCP entries clobbered moments later by Claude Code flushing *its* in-memory copy — while the banner has already reported success. For a fail-closed tool, (b) is a silent-protection-absent outcome. Pre-existing design (not introduced by 08-12; atomicity-per-write was in scope for RESEARCH §3.3, cross-process coordination was not), and timestamped backups bound the damage — but the failure is silent.
**Fix:** Minimum viable: document "run `mrclean install` with Claude Code closed" and point users at `mrclean doctor` to verify registration post-install (doctor already re-reads both files). Robust: take an exclusive-create lock sentinel around the read→write window:

```ts
const lock = `${settingsPath}.mrclean-lock`
const fh = await open(lock, 'wx')          // fails EEXIST if another writer holds it
try { /* read → mutate → backup → atomicWriteJson */ }
finally { await fh.close(); await unlink(lock).catch(() => {}) }
```

## Info

### IN-01: stale docstring — cleanup happens in a `catch` block, not a `finally` block

**File:** `src/install/atomic-json.ts:37-38`
**Issue:** The docstring says "the tmp file is cleaned up in a finally block." The implementation (correctly) uses `catch` — a `finally` would attempt to unlink the already-renamed tmp on the success path. Wrong docs on the shared write primitive invite a "fix" toward the worse shape.
**Fix:** Change the sentence to "…the tmp file is cleaned up before the error is re-thrown."

### IN-02: banner-count assertion collapses "regex didn't match" into "expected NaN to be 5", obscuring triage

**File:** `tests/install/fresh-home.test.ts:137-139`
**Issue:** `const bannerCount = Number(match?.[1] ?? NaN)` means a banner *format* drift (e.g. wording change breaking the `\(hooks: (\d+), MCP server: mrclean\)` regex) fails with the same message as a genuine count mismatch. The failure mode misdirects the fixer toward the count logic when the format changed.
**Fix:** Assert the match exists first so the two failure causes are distinguishable:

```ts
const match = banner.match(/\(hooks: (\d+), MCP server: mrclean\)/)
expect(match, `banner did not contain the hooks-count segment: ${banner}`).not.toBeNull()
expect(Number(match![1])).toBe(registeredEvents.length)
```

---

_Reviewed: 2026-07-17T00:55:05Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
