## 1. Domain Model and Resolution

- [x] 1.1 Add versioned shared types for future-set and external conversation vocabulary references, resolution sources, and validation failures.
- [x] 1.2 Add a reviewed supplemental external-vocabulary catalog format with canonical forms, aliases, kana readings, meanings, and optional classifications.
- [x] 1.3 Implement deterministic resolution against the complete master vocabulary first and the supplemental catalog second, preserving surfaces, prioritizing exact Japanese over reading aliases, and deduplicating canonical words.
- [x] 1.4 Add resolver tests for exact later-set matches, safe kana aliases, homophones, repeated occurrences, external terms, exemptions, and malformed non-lexical tokens.

## 2. Audit and Persistence Integration

- [x] 2.1 Extend final conversation analysis to build enriched references only from authoritative true OOV evidence after exemptions.
- [x] 2.2 Integrate reference refresh into standard generation, workflow generation, quality repair, conversation editing, run reanalysis, and curated-set reanalysis paths.
- [x] 2.3 Update normalization and legacy reads so conversations without enriched references remain readable and are refreshed on their next audit.
- [x] 2.4 Add tests proving references refresh after transcript or policy changes and never replace coverage evidence or accept model-returned counts.
- [x] 2.5 Preserve productive `～` vocabulary matching across single and split tokenizer tokens and exempt approved names across complete token spans, with regression tests.

## 3. Historical Backfill and Validation

- [x] 3.1 Add an idempotent operator batch command or API that reanalyzes every saved run and curated set without changing generated content.
- [x] 3.2 Record and report per-record before/after OOV totals plus resolved, unresolved, and discarded terms.
- [x] 3.3 Add validation that identifies conversation IDs and surfaces with incomplete learner-visible metadata.
- [x] 3.4 Test repeated backfills, partial failures, malformed historical audit data, and unchanged reruns.

## 4. Curation and Static Publication

- [x] 4.1 Preserve enriched references when copying generated conversations into curated sets.
- [x] 4.2 Extend the static learner manifest and compatibility loader with enriched references while retaining support for the current manifest version during migration.
- [x] 4.3 Make publication fail atomically with actionable validation details when publishable conversations contain unresolved learner-visible terms.
- [x] 4.4 Add publication tests for future-set and external metadata, exempt-term omission, stable IDs/order, validation failure, and preservation of the prior manifest/audio.

## 5. Learner Conversation Experience

- [x] 5.1 Extend the conversation vocabulary model to combine in-course mastery terms with informational future-set and external references without creating review state.
- [x] 5.2 Rename the conversation control language to words to review and count non-strong in-course, future-set, and external terms while excluding mastered and exempt terms.
- [x] 5.3 Render future-set tiles beneath their actual set headings and external tiles beneath Outside Course Vocabulary, reusing the word-detail view for spelling, kana, meaning, and classification.
- [x] 5.4 Keep informational references out of vocabulary flashcards, statistics, progression calculations, and vocabulary-aware conversation ordering, with focused unit tests.
- [x] 5.5 Add responsive and accessibility checks for mixed, empty, mastered-only, future-only, and external-only vocabulary modal states.

## 6. Verification and Rollout

- [x] 6.1 Run the complete unit suite and TypeScript/Vite builds and resolve regressions.
- [x] 6.2 Run the historical batch, review its unresolved/discarded report, and complete the supplemental catalog until curated content validates.
- [x] 6.3 Reanalyze curated sets, rebuild the static practice library, and run published-library consistency checks.
- [x] 6.4 Verify representative conversations in the learner app and document the backfill and publication results.

## 7. Studio Vocabulary Metadata Cards

- [x] 7.1 Route every conversation-derived Japanese vocabulary chip in Studio analytics, evidence, workflow balancing, recommendations, and projected coverage through the shared hover/focus metadata card.
- [x] 7.2 Preserve count/status adornments, exclude non-word chips and learner statistics, and add focused rendering/build verification.
