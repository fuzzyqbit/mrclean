---
phase: 01-wired-skeleton
reviewed: 2026-07-13T23:32:33Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/install/settings.ts
  - src/doctor/checks.ts
  - tests/install/settings.test.ts
  - tests/doctor/checks.test.ts
  - tests/install/idempotency.test.ts
  - tests/uat/live-session.test.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-07-13T23:32:33Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Scope is the 01-06/01-07 gap-closure: a fail-closed POSIX `/bin/sh` hook wrapper
in `buildHookCommand()` (`src/install/settings.ts`) plus wrapper-aware path
extraction in `src/doctor/checks.ts`, with matching test updates across the
install, doctor, idempotency, and live-UAT suites.

**The core security claim holds.** I did not just read the comments — I ran the
exact generated argv through `/bin/sh` and empirically confirmed all four
headline guarantees:

- **Injection-safe:** a bin path of `./x; touch PWNED #.js` did *not* execute the
  embedded command (`PWNED` was never created). `"$1" "$2"` are positional-param
  references, not interpolated strings, so path contents cannot break out.
- **Space-safe:** a path under `dir with spaces/` runs cleanly (exit 0).
- **Fail-closed:** a missing bin remaps to `exit 2` (BLOCK).
- **stdin passthrough:** the hook payload piped to the wrapper reaches the inner
  `node <bin> hook` process (`GOT:PAYLOAD_ON_STDIN`).

So there are **no BLOCKER findings** in the changed code and I am not
manufacturing one. The exit-code remap (`|| exit 2`), stdout passthrough
(tested), and idempotent migration of old-shape entries are all correct.

The residual issues are: a doctor FAIL message that **inverts the security
posture on Windows**, a **filename-coupled discriminator** in the doctor's
path extraction that is a latent correctness trap, a **security test-coverage
gap** (the injection/space/stdin guarantees are asserted only in prose, never in
a deterministic test), and three minor robustness/quality notes.

## Warnings

### WR-01: Doctor FAIL message hardcodes POSIX fail-closed language on every platform — inverts the security posture on Windows

**File:** `src/doctor/checks.ts:333-338`
**Issue:** `checkBinsExecutable` is invoked unconditionally by `computeDoctorReport`
(no platform argument). When a registered bin is missing/non-executable it always
emits:

> `... on POSIX the fail-closed hook wrapper now BLOCKS every tool call (exit 2) until restored ...`

But `buildHookCommand()` (`src/install/settings.ts:84-93`) deliberately keeps the
**plain exec form on win32**, which is fail-**OPEN** on spawn failure. So a Windows
operator whose `dist/cli.js` was deleted (the `access()` → ENOENT branch fires on
Windows too) is told mrclean *blocks every tool call* when in reality the tool
calls **silently pass through** and secrets flow to the wire. This is a message
that mis-states the security posture in the dangerous direction — the operator is
falsely reassured. For a data-exfiltration guard, an assurance message that lies
about protection is more than cosmetic.
**Fix:** Thread the platform into the message (or into `checkBinsExecutable`) and
branch the wording:
```ts
const failClosed = process.platform !== 'win32'
detail: failClosed
  ? `registered mrclean binary is missing or not executable: ${binPath} — the fail-closed POSIX hook wrapper now BLOCKS every tool call (exit 2) until restored; run \`mrclean install\` to repair`
  : `registered mrclean binary is missing or not executable: ${binPath} — WARNING: on Windows the hook fails OPEN, so tool calls pass through UNPROTECTED until restored; run \`mrclean install\` to repair`,
```

### WR-02: `extractHookNodeAndBin` discriminates on a filename heuristic (`args[0].endsWith('.js')`) instead of the command shape — a latent path-extraction trap

**File:** `src/doctor/checks.ts:74-95`
**Issue:** The wrapper-vs-legacy discriminator keys on whether `args[0]` ends in
`.js`. Today the bin is always `dist/cli.js` (confirmed via
`resolveMrcleanBinPath()` in `src/install/path-resolver.ts`), so it works. But it
couples doctor correctness to a filename extension rather than to the actual
structural difference (`command === '/bin/sh' && args[0] === '-c'`). If the bin is
ever shipped as `.mjs`, an extensionless launcher, or `realpath()` resolves to a
non-`.js` target, a **legacy/win32** entry (`args = [bin, 'hook']`) would fall
through to the wrapper branch and mis-extract `nodePath = args[len-2] = bin`,
`binPath = args[len-1] = 'hook'`. Doctor would then report a spurious "binary not
executable" FAIL for a perfectly healthy install. Silent mis-scoping in a
diagnostic tool erodes trust.
**Fix:** Discriminate on the shape that actually distinguishes the two forms:
```ts
if (command === '/bin/sh' && args[0] === '-c' && args.length >= 2) {
  return { nodePath: args[args.length - 2], binPath: args[args.length - 1] }
}
// otherwise legacy/win32 plain-exec: node = command, bin = args[0]
if (typeof args[0] === 'string') return { nodePath: command, binPath: args[0] }
return {}
```

### WR-03: Security test-coverage gap — the injection/space/stdin guarantees are asserted only in comments, never in a deterministic test

**File:** `tests/install/settings.test.ts:220-270`
**Issue:** The `spawnSync` remap suite proves exit-code remapping (0/2/missing) and
stdout passthrough, which is good. But the headline security properties of this
change — **injection-safe** and **space-safe** paths, and **stdin passthrough** —
are documented in the `buildHookCommand` JSDoc and nowhere exercised by an
assertion. Consequences:
- A future refactor of `buildHookCommand` back to string interpolation
  (`` `"${nodePath}" "${binPath}" hook || exit 2` ``) would reintroduce shell
  injection and pass 100% of the current suite.
- The entire fail-closed guarantee is transitively dependent on the hook payload
  reaching the inner process via stdin; if stdin passthrough ever broke, the
  hook's own stdin timeout would fire and `process.exit(0)` — a **silent
  fail-OPEN** — and no test would catch it. (I verified passthrough works today;
  the point is that nothing guards it.)
**Fix:** Add deterministic cases to the existing POSIX spawnSync block:
```ts
it('path with spaces + shell metacharacters is passed literally (no injection)', async () => {
  const evil = join(stubDir, 'dir with spaces', 'x; touch PWNED #.js')
  await mkdir(dirname(evil), { recursive: true })
  await writeFile(evil, 'process.exit(0)\n', 'utf8')
  const res = runWrapper(evil)
  expect(res.status).toBe(0)
  expect(existsSync(join(stubDir, 'PWNED'))).toBe(false) // injection did not fire
})

it('hook payload on stdin survives the wrapper', async () => {
  const stub = join(stubDir, 'echo.js')
  await writeFile(stub, 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{process.stdout.write(d);process.exit(0)})\n', 'utf8')
  const cmd = buildHookCommand(process.execPath, stub, 'linux')
  const res = spawnSync(cmd.command, cmd.args, { input: 'PAYLOAD', encoding: 'utf8' })
  expect(res.stdout).toContain('PAYLOAD')
})
```

## Info

### IN-01: win32 hook is fail-OPEN on spawn failure — a documented gap, but observability is missing

**File:** `src/install/settings.ts:84-93`
**Issue:** The win32 branch intentionally ships the plain exec form and therefore
fails OPEN when the bin is deleted/renamed — the exact hole the POSIX wrapper
closes. This is a documented, constraint-deprioritized known-gap, so it is not a
defect in itself. The gap is that it is **invisible at runtime**: nothing warns a
Windows operator that they are running with weaker guarantees. Combined with WR-01,
Windows users get *no* signal and then an actively *wrong* signal from doctor.
**Fix:** Until a tested cmd.exe wrapper ships, have `install`/`doctor` emit a
one-line stderr notice on win32 ("hook runs in fail-OPEN mode on Windows; a missing
bin will not block tool calls"), and fix the doctor message per WR-01.

### IN-02: Fail-closed guarantee transitively depends on `/bin/sh` being spawnable

**File:** `src/install/settings.ts:100`
**Issue:** The wrapper deliberately moves the "must exist" dependency off the
deletable `dist/cli.js` and onto `/bin/sh` — a good trade. The residual risk: if
`/bin/sh` is absent or non-executable (rare: some minimal/distroless containers),
Claude Code cannot spawn the hook command at all, which the same platform contract
treats as non-blocking — i.e. mrclean silently reverts to fail-OPEN. Worth a
one-line acknowledgement in the design notes so the assumption is explicit rather
than implicit.
**Fix:** Document the `/bin/sh` dependency as a stated assumption; optionally have
`doctor` verify `access('/bin/sh', X_OK)` on POSIX and surface a warning if absent.

### IN-03: `timeout: 10` magic number duplicated across both branches of `buildHookCommand`

**File:** `src/install/settings.ts:91, 102`
**Issue:** The hook timeout literal `10` appears in both the win32 and POSIX return
objects. Minor DRY/magic-number smell; a future change to the timeout must be made
in two places.
**Fix:** Hoist a named constant, e.g. `const HOOK_TIMEOUT_SECONDS = 10`, and
reference it in both branches (and note the unit — seconds — since the inner hook's
own stdin timeout is `10_000` ms, an easy-to-confuse parallel).

---

_Reviewed: 2026-07-13T23:32:33Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
