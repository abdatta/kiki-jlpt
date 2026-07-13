## Why

Conversation audits already identify words outside the vocabulary allowed for a generated level, but the learner-facing conversation reference drops that evidence and cannot explain those words. Learners should be able to inspect future-set and genuinely external words where they encounter them without silently adding those words to the vocabulary curriculum or its mastery system.

## What Changes

- Enrich true out-of-vocabulary audit terms with canonical spelling, kana reading, meaning, and available classification metadata from deterministic vocabulary sources.
- Classify enriched terms as future-set vocabulary or external course vocabulary; omit proper nouns and cultural-reference exemptions from the learner-facing collection.
- Persist enriched conversation vocabulary references for future generation and support backfilling existing saved and curated conversations.
- Include enriched references in the published static learner manifest.
- Extend the conversation vocabulary modal with future-set groups under their actual set numbers and a separate Outside Course Vocabulary section.
- Count learning-relevant future-set and external terms in the conversation's words-to-review indicator while keeping them outside vocabulary mastery, flashcards, review statistics, progression, and vocabulary-aware conversation ordering.
- Reject or visibly report unresolved metadata during backfill/publication rather than publishing incomplete learner tiles.
- Make every Japanese vocabulary chip shown from conversation analysis in Studio hoverable and keyboard-focusable with spelling, kana, meaning, set/classification, part of speech, and category metadata, without learner mastery statistics.

## Capabilities

### New Capabilities

- `conversation-vocabulary-reference`: Defines classification, enrichment, publication, backfill, and conversation-only display of learning-relevant vocabulary references.

### Modified Capabilities

- `listening-practice`: Expands conversation reference tools and their words-to-review indicator to include future-set and external course vocabulary without treating those terms as mastered curriculum.
- `curated-library`: Requires enriched vocabulary references to survive curation and static-library publication, with publish-time handling for unresolved metadata.
- `content-generation`: Requires authoritative post-audit enrichment for newly generated, repaired, edited, and reanalyzed conversations.

## Impact

- Changes shared conversation and published-manifest formats to carry enriched vocabulary references.
- Adds server-side resolution against the complete master vocabulary and a reviewed supplemental external-word catalog.
- Affects vocabulary auditing, normalization, run and curated-set reanalysis, curation, static publication, and the learner conversation vocabulary modal.
- Affects Studio analytics, audit evidence, workflow balancing, recommendation, and projected-coverage vocabulary chips.
- Requires a historical backfill/reporting path for saved runs and curated conversations plus manifest republishing.
- Does not change vocabulary flashcards, vocabulary statistics, mastery thresholds, level progression, or audio generation.
