# mrclean Test Fixtures

This directory contains two corpora of synthetic test inputs used to prove Phase 2
success criterion #4: **100% recall on positive fixtures + 0 false positives on negative fixtures**.

---

## Checksum-Flip Discipline

**Never commit real credentials — even in tests.**

Every positive fixture contains a checksum-flipped value: the token *shape* is preserved
(so detection rules match) but the value is deliberately invalidated (so the credential cannot
be used against any real service). The flip is documented in each file's header comment under
`# Checksum-flip:`.

Common checksum-flip strategies used:

| Strategy | Example | Applied to |
|----------|---------|------------|
| Last char substitution | `EXAMPLX` (was `EXAMPLE`) | AWS Access Key ID |
| Body replaced with `A` padding | `sk-ant-api03-AAAA...` | Anthropic, OpenAI keys |
| Signature replaced with `X` chars | `XXXX...` (third JWT segment) | JWT |
| All-zero body | `sk_live_0000...0x` | Stripe live key |
| Non-valid base64 padding | PEM body that does not decode to a real key | Private key PEM |

---

## Positive Fixtures (`tests/fixtures/positive/`)

Each file contains a realistic natural-language sentence embedding a synthetic secret so that
detection layers see realistic keyword context.

| File | Token Type | Detection Layer | Checksum-Flip Description |
|------|-----------|-----------------|--------------------------|
| `aws-access-key.txt` | AWS Access Key ID | Layer 1 (gitleaks `aws-access-token`) | Last char `E` → `X` |
| `aws-secret-key.txt` | AWS Secret Access Key | Layer 1 (secretlint `AWSSecretAccessKey`) | Last 3 chars changed to `KEY` |
| `github-pat-classic.txt` | GitHub PAT (classic) | Layer 1 (secretlint GitHub rule) | Random body — no valid token |
| `github-pat-fine-grained.txt` | GitHub Fine-Grained PAT | Layer 1 (secretlint GitHub rule) | All-`A` body — invalid checksum |
| `jwt.txt` | JSON Web Token | Layer 1 (gitleaks JWT rule) | Signature segment is `X` chars |
| `stripe-live-key.txt` | Stripe Live Secret Key | Layer 1 (secretlint stripe rule) | All-zero body + `x` at end |
| `openai-key.txt` | OpenAI API Key | Layer 1 (secretlint openai rule) | All-`A` body |
| `anthropic-key.txt` | Anthropic API Key | Layer 1 (secretlint anthropic rule) | All-`A` body |
| `slack-bot-token.txt` | Slack Bot Token | Layer 1 (secretlint slack rule) | Last char `X` instead of valid |
| `private-key-pem.txt` | Private Key (PEM) | Layer 1 (secretlint privatekey rule) | Base64 body does not decode to real key |
| `dotenv-derived.txt` | `.env`-derived value | Layer 3 (env blocklist) | N/A — exact value from `.env` fixture |
| `words-term.txt` | User dirty-word | Layer 4 (words.txt match) | N/A — exact term from `words.txt` fixture |

### Layer 3 + Layer 4 Setup

The corpus test (`tests/fixtures-corpus.test.ts`) creates a temporary directory with:
- `.env` file containing `MY_API_KEY=secretvalue12345` — this value is loaded into the Layer 3
  env blocklist via `initSessionState`
- `.mrclean/words.txt` containing `ACME_INTERNAL_CODENAME` — loaded into the Layer 4 word list

The `dotenv-derived.txt` fixture contains `secretvalue12345` (the value, not the key name).
The `words-term.txt` fixture contains `ACME_INTERNAL_CODENAME`.

---

## Negative Fixtures (`tests/fixtures/negative/`)

Each file contains a value that resembles a secret in entropy or length but is NOT one.
These values exercise Layer 2's shape allowlist and entropy thresholds.

**Rule for negative fixture text:** NEVER include entropy keywords (`secret`, `key`, `token`,
`password`, `bearer`, `api_key`, `auth`, etc.) adjacent to the value — Layer 2's context-keyword
requirement would then fire and produce a false positive. Keep surrounding text neutral.

| File | Value Type | Why Not a Secret |
|------|-----------|-----------------|
| `uuid-v4.txt` | UUID v4 | UUID shape is explicitly allowlisted in Layer 2 |
| `uuid-v7.txt` | UUID v7 | UUID shape is explicitly allowlisted in Layer 2 |
| `git-sha-40.txt` | 40-char git SHA | 40-char hex digest shape is allowlisted in Layer 2 |
| `git-sha-7.txt` | 7-char short SHA | Below Layer 2 `min_length` threshold (20 chars) |
| `npm-integrity-sha512.txt` | npm `sha512-...` hash | npm integrity hash shape is allowlisted in Layer 2 |
| `cargo-lock-hash.txt` | 12-char hex | Low entropy + below min_length |
| `md5-digest.txt` | MD5 (32-char hex) | Digest shape is allowlisted in Layer 2 |
| `sha256-digest.txt` | SHA-256 (64-char hex) | Digest shape is allowlisted in Layer 2 |
| `base64-image-header.txt` | `data:image/png;base64,...` | Data URI shape is allowlisted in Layer 2 |
| `lorem-ipsum.txt` | Latin placeholder text | Low entropy natural language |

---

## Adding New Fixtures

1. **Positive fixture:** Create `tests/fixtures/positive/<service-name>.txt`.
   - Use the standard header format (see existing files).
   - Apply a checksum-flip and document it in `# Checksum-flip:`.
   - Embed the value in a natural sentence with at least one contextual keyword nearby.
   - Add the raw (checksum-flipped) value string to `ALL_FIXTURE_VALUES` in `tests/fixtures-corpus.test.ts`.
   - Add a test case to the positive-fixtures loop in `tests/fixtures-corpus.test.ts`.
   - Run the corpus test to confirm the new fixture achieves recall.

2. **Negative fixture:** Create `tests/fixtures/negative/<type-name>.txt`.
   - Use the standard header format.
   - Explain WHY the value is not flagged (which allowlist or threshold catches it).
   - DO NOT include entropy keywords in the surrounding text.
   - Add a test case to the negative-fixtures loop in `tests/fixtures-corpus.test.ts`.
   - Confirm 0 findings.

3. **Update FIXTURES.md** with the new entry in the appropriate table.

---

## References

- Layer 2 shape allowlist: `src/detect/layer2-entropy.ts` (UUID, git SHA, digest, image URI patterns)
- Layer 2 context-keyword list: `src/detect/layer2-entropy.ts` (`secret|key|token|password|bearer|...`)
- Layer 3 env blocklist: `src/detect/layer3-env.ts` (`loadEnvBlocklist`)
- Layer 4 word list: `src/detect/layer4-words.ts` (`loadWordsList`)
- Corpus test: `tests/fixtures-corpus.test.ts`
- Bundle smoke test: `tests/fixtures-corpus-bundle.test.ts`
