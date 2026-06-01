# Spike Manifest

## Idea

Position mrclean against adjacent data-protection tooling to clarify what it is (and isn't),
where it wins, and where a complementary tool or a new mrclean layer would add value.

## Requirements

- mrclean's scope is secrets / credentials / proprietary terms at the Claude Code boundary —
  NOT general PII/PHI. Any PII coverage is a deliberate future addition (e.g. the opt-in Layer 5
  LLM pass), not a reframing of the core product.
- Comparisons are doc-grounded (Context7/official docs) when a live run is impractical, and that
  limitation is stated explicitly — no silent gaps.

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | vs-presidio | comparison | Same corpus through mrclean (live) vs Presidio (doc): coverage, architecture, threat model | ✅ VALIDATED — complementary, not competing | comparison, presidio, pii, secrets, entropy |

## Proposed follow-ups (not yet run)

- **002 vs-presidio-empirical** — `pip install presidio-analyzer` + spaCy model, run the *same*
  corpus through Presidio live to replace the doc-grounded column with measured results.
- **002b secret-coverage-probe** — feed several real-shaped GitHub PATs / JWTs to isolate the
  github-pat & jwt misses (synthetic-data artifact vs rule-coverage gap), and decide whether to
  add a hex-aware secret rule (hex evades the 4.5 entropy floor).
