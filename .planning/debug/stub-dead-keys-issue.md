# DRAFT GitHub issue — file to fuzzyqbit/mrclean

Title: Install stub advertises non-functional [words] and [detection] config keys

---

## Summary

The `.mrclean/config.toml` stub written by `mrclean install` advertises two TOML sections — `[words]` and `[detection]` — that the config parser does not read. Users following the stub's inline guidance will add terms under `[words]` or toggle detection layers under `[detection]` and silently get no effect.

## Where

Stub template: `src/install/project-dir.ts:16-38` (`CONFIG_TOML_STUB`).

The offending sections:

```toml
[words]
# Additional proprietary terms to redact (plain strings).
# words = ["ACME Corp", "internal-api.acme.com"]

[detection]
# Enable/disable individual detection layers.
# layer1_secretlint = true
# layer2_entropy = true
# layer3_env = true
# layer4_words = true
```

## Why it's broken

`parseToml` in `src/config/index.ts:174-230` only handles `dry_run`, `[entropy]`, `[secrets_files]`, `[[rules]]`, and `[allowlist]`. Unknown top-level keys are silently dropped (documented as "forward-compatibility" at line 173). `MrcleanConfig` in `src/shared/types.ts` has no `words` or `detection` field. So both stub sections are dead.

The real custom-term mechanism is the separate `.mrclean/words.txt` file (loaded by `src/detect/layer4-words.ts`), which is richer than the stub's array form — it supports per-entry `word|action` overrides (`block` / `warn` / `audit`). The README documents `words.txt` and the real config keys, but never documents `[words]` or `[detection]`. So the stub contradicts both the code and the docs.

Secondary nit: the stub's header comment links to `https://github.com/mrclean/mrclean#configuration`, but the actual repo is `fuzzyqbit/mrclean`.

## Impact

Misleading first-run UX. A user adds proprietary terms under `[words]`, starts a session, and their terms leak unredacted because the real list lives in `words.txt`. For a security tool this is a confidentiality footgun, not just a doc typo.

## Fix (planned)

Make the stub honest: drop the dead `[words]`/`[detection]` sections, point users to `.mrclean/words.txt` for custom terms, show only the keys the parser actually reads (`dry_run`, `[entropy]`, `[allowlist]`, `[[rules]]`), and correct the repo URL.
