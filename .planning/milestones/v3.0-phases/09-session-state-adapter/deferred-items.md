# Deferred Items — Phase 9

Out-of-scope discoveries logged during execution. Per executor scope boundary,
these are NOT fixed inline — they pre-date Phase 9 work and live in files
unrelated to the executing plans.

## Typecheck baseline drift: 36 → 38 (discovered during 09-01, 2026-07-17)

The Phase 8 deferred-items doc records a **36-error** `npm run typecheck`
baseline (at 6f8706b). At the Phase 9 base commit (b5a16b0) with a fresh
`npm install`, the count is **38** — the same 36 documented errors plus 2 new
pre-existing errors in `src/model/pipeline-singleton.ts`:

| Location | Error | Flavor |
|----------|-------|--------|
| `src/model/pipeline-singleton.ts:147` | TS2578 | Unused `@ts-expect-error` directive |
| `src/model/pipeline-singleton.ts:166` | TS2322 | `string` not assignable to the transformers `DType` union |

**Cause:** `@huggingface/transformers` is an optionalDependency at `^4.2.0`;
a fresh install resolves a newer 4.x whose type surface changed (the DType
union widened/reshuffled, making the old suppression unused and a plain
string assignment invalid). These errors exist at the base commit before any
09-01 change — verified by capturing the baseline error set prior to edits.

**Disposition:** NOT fixed in 09-01 (scope boundary — `src/model/` is
unrelated to the executing plan). Plan 09-01's differential gate was applied
against the actual 38-error base set: the post-change error set is
byte-identical (zero new, zero resolved). Suggested fix in a chore/quick task:
re-pin or update the suppression in `pipeline-singleton.ts` against the
currently-resolving transformers minor.
