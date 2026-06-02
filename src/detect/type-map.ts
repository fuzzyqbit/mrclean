/**
 * Canonical TYPE vocabulary and rule-id → TYPE mapping for mrclean detection layers.
 *
 * THIS MODULE IS OWNED BY PLAN 02-00 (Wave 1).
 * Wave 2 plans (02-01, 02-03) IMPORT from here — do NOT re-create or modify
 * without revising plan 02-00 first.
 *
 * To add a new TYPE in a future plan:
 *   1. Add the TYPE string to TYPE_VOCABULARY (and update the count assertion in tests).
 *   2. Add the rule-id → TYPE entry to RULE_ID_TO_TYPE.
 *   3. Update the JSDoc in this file.
 *
 * Exports:
 *   TYPE_VOCABULARY    — frozen array of 25 TYPE strings (locked vocabulary; 17 secret/layer + 8 PII)
 *   getTypeForRuleId   — map a rule-id to its TYPE (with word: prefix + SECRET fallback)
 */

// ---------------------------------------------------------------------------
// TYPE vocabulary (locked — CONTEXT §Placeholder Manager)
// ---------------------------------------------------------------------------

/**
 * Locked TYPE vocabulary for the `<MRCLEAN:TYPE:NNN>` placeholder format.
 *
 * 25 entries:
 *   - 14 secret-type TYPEs: AWS_KEY, AWS_SECRET, GH_TOKEN, JWT, STRIPE_KEY,
 *     OPENAI_KEY, ANTHROPIC_KEY, PRIVATE_KEY, SLACK_TOKEN, GCP_KEY,
 *     DATABRICKS_KEY, AZURE_KEY, CF_KEY + SECRET (fallback)
 *   - 3 layer-specific TYPEs: ENV (Layer 3), WORD (Layer 4), ENTROPY (Layer 2)
 *   - 8 PII TYPEs (v2.0 — Phase 4 contract addition):
 *     PII_EMAIL, PII_SSN, PII_CREDIT_CARD, PII_PHONE, PII_IP (Layer 6a regex)
 *     PII_PERSON, PII_ORG, PII_LOC (Layer 6b NER)
 *
 * If a new TYPE is introduced in a later plan, add it here first.
 * Existing entries MUST NOT be removed or reordered (stable placeholder format).
 */
export const TYPE_VOCABULARY = Object.freeze([
  'AWS_KEY',
  'AWS_SECRET',
  'GH_TOKEN',
  'JWT',
  'STRIPE_KEY',
  'OPENAI_KEY',
  'ANTHROPIC_KEY',
  'PRIVATE_KEY',
  'SLACK_TOKEN',
  'GCP_KEY',
  'DATABRICKS_KEY',
  'AZURE_KEY',
  'CF_KEY',
  'ENV',
  'WORD',
  'ENTROPY',
  'SECRET',
  // PII TYPEs — appended at tail (v2.0 Phase 4 contract; no detectors emit these yet)
  // Layer 6a regex-PII (ARCHITECTURE-v2-pii.md §Component Responsibilities)
  'PII_EMAIL',
  'PII_SSN',
  'PII_CREDIT_CARD',
  'PII_PHONE',
  'PII_IP',
  // Layer 6b NER-PII (ARCHITECTURE-v2-pii.md §Config Surface)
  'PII_PERSON',
  'PII_ORG',
  'PII_LOC',
] as const)

// ---------------------------------------------------------------------------
// Rule-id → TYPE explicit mapping
// ---------------------------------------------------------------------------

/**
 * Static mapping from rule-id strings to TYPE_VOCABULARY entries.
 *
 * Covers:
 *   - Layer 1 secretlint messageIds (from @secretlint/secretlint-rule-preset-recommend v13)
 *   - Layer 1 gitleaks namespaced rule-ids (from vendor/gitleaks-rules.toml)
 *   - Layer 2/3 synthetic rule-ids (entropy:high, env:literal)
 *
 * Layer 4 (word:*) rule-ids use the `word:` prefix-match in getTypeForRuleId
 * and do NOT need entries here.
 *
 * Unknown rule-ids that are not listed here and do not start with `word:` fall
 * back to `'SECRET'` via the `getTypeForRuleId` function.
 */
const RULE_ID_TO_TYPE: Readonly<Record<string, string>> = Object.freeze({
  // -------------------------------------------------------------------------
  // Layer 2 / Layer 3 synthetic rule-ids (LOCKED — only these IDs are emitted)
  // -------------------------------------------------------------------------
  'entropy:high': 'ENTROPY',
  'env:literal': 'ENV',

  // -------------------------------------------------------------------------
  // Layer 1 — secretlint messageIds
  // (@secretlint/secretlint-rule-preset-recommend v13 — RESEARCH §1.4)
  // -------------------------------------------------------------------------

  // AWS
  'AWSAccessKeyID': 'AWS_KEY',
  'AWSSecretAccessKey': 'AWS_SECRET',

  // GitHub
  'GitHubPersonalAccessToken': 'GH_TOKEN',
  'GitHubFineGrainedPersonalAccessToken': 'GH_TOKEN',
  'GitHubOAuth': 'GH_TOKEN',
  'GitHubAppToken': 'GH_TOKEN',
  'GitHubRefreshToken': 'GH_TOKEN',

  // Stripe
  'StripeAccessToken': 'STRIPE_KEY',
  'StripeRestrictedAPIKey': 'STRIPE_KEY',

  // OpenAI
  'OpenAIAPIKey': 'OPENAI_KEY',

  // Anthropic
  'AnthropicAPIKey': 'ANTHROPIC_KEY',

  // Slack
  'SlackToken': 'SLACK_TOKEN',
  'SlackWebhookURL': 'SLACK_TOKEN',

  // GCP
  'GCPServiceAccountKey': 'GCP_KEY',
  'GCPAPIKey': 'GCP_KEY',

  // Databricks
  'DatabricksToken': 'DATABRICKS_KEY',

  // Azure
  'AzureSubscriptionKey': 'AZURE_KEY',

  // Cloudflare
  'CloudflareAPIKey': 'CF_KEY',

  // Private key (PEM) — also CRITICAL severity promotion in Layer 1
  'PrivateKey': 'PRIVATE_KEY',

  // JWT
  'JsonWebToken': 'JWT',
  'JWT': 'JWT',

  // -------------------------------------------------------------------------
  // Layer 1 — gitleaks namespaced rule-ids
  // (sampled from vendor/gitleaks-rules.toml — RESEARCH §2)
  // Unknown gitleaks rule-ids fall back to SECRET via the catch-all below.
  // -------------------------------------------------------------------------

  // AWS
  'gitleaks:aws-access-token': 'AWS_KEY',
  'gitleaks:aws-secret-key': 'AWS_SECRET',

  // GitHub
  'gitleaks:github-pat': 'GH_TOKEN',
  'gitleaks:github-fine-grained-pat': 'GH_TOKEN',
  'gitleaks:github-oauth': 'GH_TOKEN',
  'gitleaks:github-app-token': 'GH_TOKEN',

  // Stripe
  'gitleaks:stripe-access-token': 'STRIPE_KEY',

  // OpenAI
  'gitleaks:openai-api-key': 'OPENAI_KEY',

  // Anthropic
  'gitleaks:anthropic-api-key': 'ANTHROPIC_KEY',

  // Slack
  'gitleaks:slack-bot-token': 'SLACK_TOKEN',
  'gitleaks:slack-user-token': 'SLACK_TOKEN',
  'gitleaks:slack-webhook-url': 'SLACK_TOKEN',

  // GCP
  'gitleaks:gcp-api-key': 'GCP_KEY',
  'gitleaks:gcp-service-account': 'GCP_KEY',

  // Databricks
  'gitleaks:databricks-api-token': 'DATABRICKS_KEY',

  // Azure
  'gitleaks:azure-ad-client-secret': 'AZURE_KEY',

  // Cloudflare
  'gitleaks:cloudflare-api-key': 'CF_KEY',

  // Private key
  'gitleaks:private-key': 'PRIVATE_KEY',

  // JWT
  'gitleaks:jwt': 'JWT',

  // -------------------------------------------------------------------------
  // Layer 6a — PII regex rule-ids
  // Lowercase snake tokens matching [pii.regex].entities config tokens
  // (ARCHITECTURE-v2-pii.md §Config Surface; no detectors emit these until Phase 5)
  // -------------------------------------------------------------------------
  'pii:email': 'PII_EMAIL',
  'pii:ssn': 'PII_SSN',
  'pii:credit_card': 'PII_CREDIT_CARD',
  'pii:phone': 'PII_PHONE',
  'pii:ip': 'PII_IP',

  // -------------------------------------------------------------------------
  // Layer 6b — PII NER rule-ids
  // Upper-case model labels matching the bert-base-NER entity set
  // (ARCHITECTURE-v2-pii.md §Config Surface; no detectors emit these until Phase 6)
  // -------------------------------------------------------------------------
  'pii:PERSON': 'PII_PERSON',
  'pii:ORG': 'PII_ORG',
  'pii:LOC': 'PII_LOC',
})

// ---------------------------------------------------------------------------
// getTypeForRuleId
// ---------------------------------------------------------------------------

/**
 * Map a rule-id string to its canonical TYPE string from TYPE_VOCABULARY.
 *
 * Resolution order:
 *   1. `word:` prefix — Layer 4 emits `word:<lowercased-term>` for every dirty-word
 *      match. ALL such rule-ids map to `'WORD'` without requiring explicit entries.
 *   2. Explicit map lookup in RULE_ID_TO_TYPE.
 *   3. Fallback — any unknown rule-id (including unknown gitleaks rules) → `'SECRET'`.
 *
 * @param ruleId - The rule identifier from a Finding (e.g. "AWSSecretAccessKey",
 *                 "gitleaks:aws-access-token", "entropy:high", "word:acme-corp").
 * @returns      - A string from TYPE_VOCABULARY, never undefined.
 */
export function getTypeForRuleId(ruleId: string): string {
  // Layer 4 word: prefix shortcut — matches any lowercased word term
  if (ruleId.startsWith('word:')) return 'WORD'

  return RULE_ID_TO_TYPE[ruleId] ?? 'SECRET'
}
