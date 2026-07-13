## Why

Historical analysis found that deterministic auditing still reports several permitted forms as OOV, including the `よい` allomorph of allowed `いい`, polite wrappers around allowed kinship terms, adverbial `本当 + に`, and tokenizer debris from fillers. Other surface variants are legitimate future vocabulary but resolve as external because they do not exactly match the master entry.

## What Changes

- Treat reviewed lexical allomorphs of allowed words, beginning with `いい` / `よい`, as the same curriculum vocabulary across inflections.
- Permit reviewed compositional morphology: `お + allowed kinship term + さん` and adverbial `に` on an allowed adjectival noun such as `本当`.
- Prevent non-lexical tokenizer fragments such as a standalone prolonged-sound mark from entering true OOV evidence or totals.
- Resolve reviewed surface variants such as `すぐ` / `すぐに` and `ゆっくり` / `ゆっくりと` to their actual future course entries instead of external vocabulary.
- Reanalyze saved runs and curated sets, report before/after changes, refresh references, and republish the validated learner library.
- Preserve semantically distinct derivations and compounds such as noun `話`, noun `遊び`, `二つ`, `もう一度`, `食べ物`, and `飲み物` as legitimate OOV until their course entries are allowed.

## Capabilities

### New Capabilities
- `oov-morphology-policy`: Defines reviewed equivalence, compositional morphology, non-lexical rejection, and future-entry alias resolution for deterministic OOV auditing.

### Modified Capabilities
- `content-generation`: Requires final deterministic evidence to apply the reviewed morphology policy consistently during generation, repair, editing, and reanalysis.

## Impact

- Affects server vocabulary matching, canonicalization, enriched-reference resolution, audit caching/versioning, and regression tests.
- Changes historical OOV totals and enriched references without changing conversation transcripts or audio.
- Requires saved-run and curated-set reanalysis plus static learner-manifest republication.
- Does not add words to mastery, flashcards, progression, or the official vocabulary CSV.
