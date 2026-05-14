# Performance Gate — tests/perf/

## Reference Machine

All CI assertions are calibrated against **GitHub Actions `ubuntu-latest` (2-core, x86_64)**.

Numbers measured on the maintainer's local dev machine are informational only — the gate
enforces the threshold on the CI reference machine. Local measurements may differ due to
hardware, OS, and process-level JIT variance.

## Thresholds

| Hook event | p95 budget | Fixture size | Requirement |
|---|---|---|---|
| `UserPromptSubmit` | 100 ms | 4 KB | PERF-01a |
| `PostToolUse` | 200 ms | 50 KB | PERF-01b |

Source: REQUIREMENTS.md PERF-01.

## Measured Baselines (informational)

- **Phase 2 maintainer-local:** UserPromptSubmit p95 = 17.4 ms (doctor --bench, 2026-05-14,
  single run on maintainer's dev machine).
- **Plan 03-02 executor machine:** UserPromptSubmit p95 = 2.91 ms (50 iterations, 2026-05-14).
- **Plan 03-02 executor machine:** PostToolUse p95 = 4.82 ms (50 iterations, 2026-05-14).

Both measured values are well under their respective thresholds — 97% and 98% headroom
respectively. Under the worst-case 5x CI runner slowdown (RESEARCH §OQ-3), expected CI
p95 values are ~15 ms (UserPromptSubmit) and ~25 ms (PostToolUse) — still under 100 ms
and 200 ms.

## Why test() not bench()

Vitest's `bench()` API does **not** expose p95. The `TaskResult` object only contains
p50, p75, p99, p995, and p999. Additionally, `bench()` lifecycle hooks (`beforeAll`,
`afterAll`) do not fire inside bench suites in Vitest 4. See RESEARCH §Pitfall 1 and
§Pattern 3.

The assertion gate uses plain `test()` + `performance.now()` + manual percentile
computation (matching `src/doctor/bench.ts`):

```
function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.ceil(0.95 * sorted.length) - 1
  return sorted[Math.max(0, idx)] ?? 0
}
```

## Flakiness Policy

If the gate fails in CI:

1. **First action:** Re-run the workflow. Ubuntu-latest variance is up to 27% (RESEARCH §OQ-3).
2. **If persistent (3+ consecutive failures):** Capture 10 consecutive runs' p95 from
   workflow logs. If median p95 > 80 ms, raise `THRESHOLD` in
   `tests/perf/user-prompt-submit.perf.test.ts` to 150 ms and document in a new
   research note. The 100 ms gate is the REQUIREMENTS.md PERF-01 contract; bumping past
   150 ms requires a phase replan.
3. **Do NOT lower iteration count** below N=50 — this is the statistical floor for p95.
4. **Do NOT add `it.skip` or `test.fails`** — the assertion IS the gate.

## Compile-Once Enforcement (PERF-03)

`tests/perf/compile-once.test.ts` asserts that every `new RegExp(` in `src/detect/`
either:

- Is at module scope (zero indentation), OR
- Lives inside a function matching `/lazy|once|memo|create.*Pool|get.*Pool/i`, OR
- Is annotated with `// PERF-03: <reason>` on the same line (line-level opt-out), OR
- Is in a file annotated with `// PERF-03-FILE-EXEMPT: <reason>` (file-level opt-out,
  reserved for files where `new RegExp(` appears inside template literal worker source
  code, not as an actual runtime call).

File-level exemptions are used for `worker-pool.ts` and `redos-worker.ts` which contain
`new RegExp(` inside stringified worker source code (not runtime regex compilation).

## Local Run

```sh
npx vitest run tests/perf/
```

Runs all three gates (UserPromptSubmit, PostToolUse, compile-once). Expect ~5-15 seconds
total on a modern dev machine (50 iterations × ~3-5 ms each × 2 + grep walk).
