/**
 * Cross-process lock recipe + deadline-degrade wrapper (09-05, REVMODE-04).
 *
 * The ONLY proper-lockfile usage in the codebase (import-graph fence — no
 * lock imports may exist outside src/state/). D-02 pins the semantics: a
 * REAL mutex wraps the allocate-and-persist transaction only — never
 * detection — because write-file-atomic alone is atomic-replace, NOT mutual
 * exclusion.
 *
 * The deadline-degrade wrapper below is the one piece RESEARCH says MUST be
 * hand-built: no library expresses "give up after N ms and fall back to
 * process-local allocation", and that degrade path is what keeps the hook
 * budget safe under pathological contention (T-09-05-03). Acquire failures
 * of ANY class (deadline, ELOCKED retry exhaustion, missing parent dir,
 * EACCES) resolve 'degraded' — never a throw. Errors thrown by `fn` itself
 * DO propagate (after release): the 09-05 facade owns degrade semantics for
 * failed transactions.
 *
 * Crashed-holder recovery (T-09-05-04): `stale: 2500` bounds how long a
 * dead process's lock survives; proper-lockfile additionally releases on
 * signal exit.
 */

import lockfile from 'proper-lockfile'

// ---------------------------------------------------------------------------
// Deadline constants (RESEARCH Open Question 2 — resolved at plan-phase)
// ---------------------------------------------------------------------------

/**
 * UserPromptSubmit-class lock deadline. Unused today — UPS never substitutes
 * (it only blocks/warns) — exported so the budget split is pinned alongside
 * its PostToolUse sibling.
 *
 * Benchmark basis (RESEARCH §Pattern 2, measured live): p95 lock hold
 * <= 2.9 ms at 2000 entries without fsync; 400 contended transactions
 * across 16 processes completed in 117 ms with zero timeouts at a 150 ms
 * deadline. 50 ms fits the < 100 ms UserPromptSubmit budget with margin.
 */
export const UPS_LOCK_DEADLINE_MS = 50

/**
 * PreToolUse/PostToolUse-class lock deadline (event budget 200 ms; measured
 * holds run 1-3 ms — see the benchmark comment on UPS_LOCK_DEADLINE_MS).
 */
export const POST_LOCK_DEADLINE_MS = 100

// ---------------------------------------------------------------------------
// Acquire recipe (RESEARCH Code Example 3 — probed on the installed 4.1.2)
// ---------------------------------------------------------------------------

/**
 * The pinned proper-lockfile recipe. Every field is load-bearing:
 *
 * - `realpath: false` — the map file may not exist yet on the first
 *   transaction; the default config realpaths the target and throws ENOENT
 *   (verified live). NOTE the lock target's PARENT directory must still
 *   exist — the facade pre-creates sessionsDir before locking.
 * - `stale: 2500` — crashed-holder recovery bound (>= the library's 2000 ms
 *   internal clamp).
 * - millisecond-scale retries — the `retry` package defaults are
 *   seconds-scale (minTimeout 1000 ms), which would bust every hook deadline
 *   on the FIRST retry (Pitfall 3). One ladder pass gives up (ELOCKED) after
 *   ~46-190 ms randomized; withMapLock RE-ARMS the ladder on ELOCKED while
 *   wall-clock budget remains (09-08 stress fix), so the deadline is the
 *   effective bound — a low-end randomized ladder can no longer degrade a
 *   contender that still had budget left.
 */
export const LOCK_OPTS = {
  realpath: false,
  stale: 2500,
  retries: { retries: 12, factor: 1.5, minTimeout: 2, maxTimeout: 10, randomize: true },
} as const

// ---------------------------------------------------------------------------
// Deadline-degrade wrapper (the hand-built ~40 lines)
// ---------------------------------------------------------------------------

/** One acquire attempt's outcome, with rejections folded into data. */
type AcquireOutcome =
  | 'deadline'
  | { kind: 'acquired'; releaseLock: () => Promise<void> }
  | { kind: 'failed'; code: string | undefined }

/**
 * Acquire the lock, re-arming proper-lockfile's retry ladder on ELOCKED
 * until the wall-clock deadline expires.
 *
 * Why the loop exists (09-08 stress fix, found by the SC5 16-process gate):
 * one ladder pass gives up with ELOCKED after ~46-190 ms RANDOMIZED. Under a
 * 16-way boot storm a low-end pass can reject while most of the deadline
 * budget remains — treating that first ELOCKED as terminal degraded workers
 * that would have acquired comfortably inside the deadline (5/400 degrades
 * measured). Only ELOCKED re-arms: non-transient classes (ENOENT missing
 * parent, EACCES) keep their immediate-degrade semantics, and each re-arm is
 * separated by the ladder's own internal sleeps — never a hot loop.
 */
async function acquireWithDeadline(
  mapPath: string,
  deadlineMs: number,
): Promise<(() => Promise<void>) | 'degraded'> {
  const deadlineAt = Date.now() + deadlineMs
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => resolve('deadline'), deadlineMs)
  })

  try {
    for (;;) {
      const lockPromise = lockfile.lock(mapPath, LOCK_OPTS)
      const winner: AcquireOutcome = await Promise.race([
        lockPromise.then(
          (releaseLock) => ({ kind: 'acquired' as const, releaseLock }),
          (err: unknown) => ({
            kind: 'failed' as const,
            code: (err as NodeJS.ErrnoException | null)?.code,
          }),
        ),
        deadline,
      ])
      if (winner === 'deadline') {
        // The deadline won while the acquire was still retrying. If the lock
        // lands later anyway, release it immediately; swallow a late ELOCKED
        // so it never surfaces as an unhandled rejection.
        void lockPromise.then(
          (releaseLock) => releaseLock().catch(() => {}),
          () => {},
        )
        return 'degraded'
      }
      if (winner.kind === 'acquired') {
        return winner.releaseLock
      }
      if (winner.code !== 'ELOCKED' || Date.now() >= deadlineAt) {
        // Non-transient acquire failure (missing parent dir ENOENT,
        // permission failure) or budget exhausted. Degrade — the hook never
        // blocks on the lock and never throws from acquisition (Pitfall 3).
        return 'degraded'
      }
      // ELOCKED with budget remaining: re-arm the ladder and race again.
    }
  } catch {
    // Belt-and-braces for a synchronous throw out of lockfile.lock itself.
    return 'degraded'
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

/**
 * Run `fn` while holding the exclusive lock on `mapPath`, giving up after
 * `deadlineMs` with the sentinel 'degraded'.
 *
 * Contract:
 * - acquire success  → `fn`'s resolution passes through; lock ALWAYS
 *   released in finally (release failures swallowed).
 * - deadline expiry  → 'degraded'; if the pending acquire lands afterwards
 *   it is released immediately so no stale lock outlives the call.
 * - ELOCKED before the deadline → the retry ladder is re-armed (see
 *   acquireWithDeadline) so the DEADLINE, not the randomized ladder, is the
 *   effective bound.
 * - non-transient acquire error → 'degraded' (ENOENT, EACCES — immediate).
 * - `fn` throw       → lock released, error PROPAGATES to the caller (the
 *   facade turns it into its own degrade + single warn).
 */
export async function withMapLock<T>(
  mapPath: string,
  deadlineMs: number,
  fn: () => Promise<T>,
): Promise<T | 'degraded'> {
  const release = await acquireWithDeadline(mapPath, deadlineMs)
  if (release === 'degraded') {
    return 'degraded'
  }

  try {
    return await fn()
  } finally {
    await release().catch(() => {})
  }
}
