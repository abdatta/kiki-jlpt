## Why

Set 3 generation can currently cover all current-set words while still introducing dozens of out-of-allowed content words, mostly later-set N5 vocabulary and a few tokenizer/proper-name artifacts. Set 2 is smaller but should follow the same low-OOV discipline now that repair is best-effort rather than blocking. This weakens controlled listening practice just as the cumulative allowed vocabulary becomes large enough that conversations should stay almost entirely within bounds.

## What Changes

- Tighten standard, workflow-primary, and complementary generation prompts so models treat the allowed vocabulary table as a hard content-word boundary, including common later-set N5 words.
- Let generation models creatively use a restrained number of common Japanese cultural proper nouns and cultural references, such as places, cities, landmarks, and foods, when they fit the scene naturally.
- Add deterministic post-generation vocabulary quality checks that classify audit findings into true out-of-allowed content, permitted person names, approved cultural terms, and known prompt-policy exemptions.
- Add an audit-aware, best-effort repair path that asks the selected text model once to rewrite offending conversation lines when true out-of-allowed content remains, then re-audits and saves the best available batch with remaining findings visible.
- Require generation responses to declare model-selected proper nouns and cultural references, while keeping server-side audit evidence authoritative and separating declared cultural references from true vocabulary leaks.
- Improve Studio wording and evidence so operators can distinguish out-of-allowed vocabulary from approved names, approved cultural terms, or audit artifacts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `content-generation`: Generation SHALL constrain out-of-allowed vocabulary, attempt one auditable repair when needed, and persist the best audited result, while audit evidence SHALL account for declared proper-noun and cultural-reference exemptions separately from learned vocabulary.

## Impact

- Affects the Studio generation pipeline, including standard generation, workflow primary generation, library-complement generation, and generation provenance.
- Updates prompt templates and generated conversation normalization/storage for optional proper-noun metadata.
- Updates vocabulary audit policy and analytics terminology; existing runs and curated content remain readable and can be reanalyzed under the new rules.
- Does not require learner-app behavior changes except through future published content quality; no breaking change to curated or published library content is intended.
