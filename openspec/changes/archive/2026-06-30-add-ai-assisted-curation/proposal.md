## Why

Coverage-only ranking can identify vocabulary gaps, but it cannot reliably judge whether target words are used naturally, meaningfully, and in conversations that form a strong learning collection together. The studio should combine trusted vocabulary measurements with model judgment so generation favors pedagogically useful current-set exposure and operators can request library-aware recommendations across all saved candidates.

## What Changes

- Refine standard and complementary generation guidance so current-set words are meaningful focal vocabulary, repetition and scene variety are natural, and aggregate coverage is not achieved by forcing words into weak conversations.
- Produce deterministic per-conversation curation evidence for unique current-set vocabulary, unique cumulative allowed vocabulary, and out-of-vocabulary content after excluding permitted grammar, fillers, conjugations, and approved proper names.
- Add an AI curation action for a selected set that considers every eligible saved conversation, the actual dialogue and learning material, deterministic evidence, and the current curated library.
- Keep the existing deterministic Queue as the default recommendation view and open AI curation on a dedicated route only after an explicit operator action.
- Require the operator to choose the text model and an exact portfolio size before starting curation, with form validation preventing a size larger than the eligible candidate pool.
- Return an ordered, reviewable portfolio of recommended next additions with candidate identities, rationales, strengths, concerns, and vocabulary contribution rather than automatically mutating the library.
- Exclude audio readiness from AI inputs and selection because missing audio can be generated after a content decision.
- Show projected least-covered vocabulary after the whole AI portfolio is added, and provide an explicit Add All workflow that generates missing audio before adding every recommendation with visible progress.
- Preserve model provenance and the library/candidate snapshot used for each AI curation result, detect stale results after relevant library changes, and allow failed or invalid model responses to be retried safely.
- Retain and expose curation history so operators can revisit older reviews read-only and reuse an older review's model and exact-size settings for a new run.
- Keep the existing deterministic coverage analysis as authoritative input to the curator instead of asking the model to calculate vocabulary statistics.
- Limit the change to the content studio and its server APIs. The curated conversation format and published learner-library format do not change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `content-generation`: Generation prompts and vocabulary auditing will expose and apply natural, current-set-focused curation guidance and trustworthy per-conversation evidence.
- `curated-library`: Coverage-based recommendations will become AI-assisted, library-aware portfolio recommendations grounded in deterministic evidence and complete candidate content.

## Impact

- Affects the React content studio, Express API, generation and complement prompts, vocabulary audit/analytics, recommendation services, shared domain types, model-exchange handling, and persisted studio recommendation provenance.
- Uses the existing configured Gemini and Codex text-model providers; no new external provider is required.
- Adds structured API data for per-conversation evidence and AI curation results.
- Does not automatically add, remove, publish, or reorder curated conversations, and does not alter learner progress or the static learner manifest schema.
