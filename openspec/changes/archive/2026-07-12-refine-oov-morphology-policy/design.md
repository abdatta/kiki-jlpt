## Context

The audit matches tokenizer forms against allowed vocabulary patterns, then canonicalizes remaining OOV tokens against the complete master vocabulary. Historical inspection found 13 false-positive records across five surfaces and two external references that should resolve to future course entries. The policy must be deliberately narrow: shared stems do not automatically make nouns, compounds, or counters equivalent vocabulary.

## Goals / Non-Goals

**Goals:**

- Remove confirmed false positives for `いい`/`よい`, reviewed kinship politeness, `本当`/`本当に`, and standalone filler debris.
- Resolve `すぐ` to `すぐに` and `ゆっくり` to `ゆっくりと` as future-set variants.
- Apply the same deterministic behavior to generation, repair, editing, saved runs, curated sets, references, and aggregate analytics.
- Preserve traceable before/after historical results.

**Non-Goals:**

- General stem-based acceptance of nominalizations, compounds, or counters.
- Editing the official vocabulary CSV.
- Treating `話` as equivalent to `話す`, `遊び` as equivalent to `遊ぶ`, or component words as coverage for explicit compounds.
- Changing learner mastery or progression behavior.

## Decisions

### Use reviewed equivalence and composition rules

Represent the accepted relationships as explicit deterministic rules rather than generic substring matching. `いい` and tokenizer basic form `よい` share the allowed canonical entry. `本当に` is accepted only when `本当` is allowed. Polite kinship matching recognizes complete `お + kinship + さん` spans and credits the allowed base kinship word.

Generic stemming was rejected because it would incorrectly accept semantically distinct forms such as noun `話`, noun `遊び`, and later-set compounds.

### Reject invalid lexical candidates during audit

Standalone punctuation-like tokenizer content, including `ー` extracted from a filler, is discarded before OOV occurrence counting. This is stronger than merely hiding the term from learner references because Studio OOV totals should also be correct.

### Keep future aliases separate from allowed equivalence

Reviewed course aliases map `すぐ` to Set 6 `すぐに` and `ゆっくり` to Set 8 `ゆっくりと` only during complete-vocabulary resolution. They remain OOV below those sets and produce future-set references rather than being permitted early.

### Version audit and resolver evidence

The curation evidence and resolver cache keys change with this policy so reanalysis cannot reuse stale results. The existing batch command refreshes saved and curated records without changing transcripts or audio.

## Risks / Trade-offs

- [An explicit alias list can miss another legitimate variant] → Keep it reviewed and extend it only from corpus evidence with regression tests.
- [Kinship politeness could over-credit distinct course entries] → Limit composition to the reviewed kinship set and preserve the encountered surface in evidence.
- [Tokenizer output changes] → Test complete transcript surfaces and canonical audit outputs rather than relying only on a single token shape.
- [Historical totals change] → Produce per-record before/after reporting and verify a second run is unchanged.

## Migration Plan

1. Add policy rules and focused audit/resolver tests.
2. Run the complete unit and build suite.
3. Backfill every saved run and curated set and review changed, unresolved, and discarded results.
4. Republish and validate the static learner library.
5. Roll back by reverting the policy rules and re-running the same idempotent backfill.

## Open Questions

None. Future morphology candidates require separate corpus evidence and review.
