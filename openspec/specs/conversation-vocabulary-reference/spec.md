# Conversation Vocabulary Reference Specification

## Purpose

Defines enrichment, presentation, validation, and historical backfill of learner-facing vocabulary references derived from conversation audits.

## Requirements
### Requirement: Authoritative conversation vocabulary enrichment
The system SHALL derive learner-facing conversation vocabulary references from the final deterministic true out-of-vocabulary audit. It SHALL resolve terms found in the complete course vocabulary as `future_set` references with their actual set metadata and SHALL resolve remaining legitimate terms from a reviewed supplemental catalog as `external` references. Each resolved reference SHALL include encountered surface, canonical Japanese spelling, kana reading, meaning, classification, and metadata source.

#### Scenario: Resolve a later-set word
- **WHEN** a Set 1 conversation's final audit contains a word assigned to Set 4 in the complete master vocabulary
- **THEN** the system records one future-set reference carrying the Set 4 reading, meaning, and set number

#### Scenario: Resolve a word outside the course
- **WHEN** a final audited OOV word is absent from the complete master vocabulary but present in the reviewed supplemental catalog
- **THEN** the system records one external reference carrying its reviewed canonical form, reading, and meaning

#### Scenario: Deduplicate repeated surface forms
- **WHEN** an OOV word occurs multiple times in a conversation
- **THEN** the system retains occurrence evidence while producing one learner-facing reference for the canonical word

#### Scenario: Canonicalize a kana spelling
- **WHEN** an audited kana form unambiguously matches the reading of a course vocabulary entry such as `わかる` and `分かる`
- **THEN** the system uses the course entry's Japanese spelling as the canonical reference

#### Scenario: Preserve homophonous kanji words
- **WHEN** an audited Japanese word shares a reading with a different course word
- **THEN** exact Japanese and tokenizer basic forms take precedence and the system does not merge the homophones

### Requirement: Exclude non-learning references
The system SHALL omit validated proper nouns, approved names, cultural references, language-policy exemptions, punctuation, and invalid non-lexical tokens from learner-facing future-set and external references.

#### Scenario: Conversation contains exempt references
- **WHEN** a conversation contains a validated person name and cultural term outside the allowed vocabulary
- **THEN** neither term appears in or contributes to the learner-facing words-to-review collection

#### Scenario: Historical audit contains an invalid token
- **WHEN** reanalysis encounters punctuation or malformed non-lexical content in historical audit data
- **THEN** the system does not create a learner-facing tile for that content and reports the discarded candidate in the batch result

### Requirement: Conversation-only learning boundary
Future-set and external vocabulary references SHALL be informational conversation material only. They MUST NOT create flashcards, review statistics, mastery state, level-progress credit, or vocabulary-aware conversation-ordering credit.

#### Scenario: Inspect an OOV tile
- **WHEN** a learner opens and inspects a future-set or external word tile
- **THEN** the system shows its spelling, kana reading, meaning, and available classification without offering or recording a flashcard assessment

#### Scenario: OOV references do not change progression
- **WHEN** a learner views conversations containing future-set or external references
- **THEN** vocabulary mastery, level progression, and conversation familiarity ordering remain based only on the existing in-course vocabulary cards

### Requirement: Complete metadata validation
The system SHALL identify every learner-visible audited OOV term that cannot be resolved to complete canonical spelling, kana reading, and meaning metadata. It SHALL expose actionable conversation and word identifiers and MUST NOT silently publish an incomplete tile.

#### Scenario: Supplemental metadata is missing
- **WHEN** an audited external word has no complete reviewed catalog entry
- **THEN** validation reports the conversation and surface as unresolved instead of fabricating metadata

### Requirement: Studio vocabulary-chip metadata
Every Studio chip that represents a Japanese vocabulary word derived from a conversation, run, curated set, audit, workflow balance, recommendation, or projected coverage SHALL expose a hoverable and keyboard-focusable lexical metadata card. The card SHALL show canonical spelling, kana reading, meaning, course set or outside-course classification, and available part of speech and category. It MUST NOT show learner mastery, review history, or learner statistics.

#### Scenario: Inspect any conversation vocabulary chip
- **WHEN** an operator hovers or focuses a Japanese word chip in Studio analytics, evidence, workflow balancing, recommendations, or projected coverage
- **THEN** the system displays the word's lexical metadata using the shared card presentation

#### Scenario: Ignore non-word chips
- **WHEN** a chip represents a count, state, action, or other non-vocabulary label
- **THEN** the system leaves it as a normal informational chip without a vocabulary metadata card

### Requirement: Historical vocabulary-reference backfill
The studio SHALL support an idempotent batch reanalysis and enrichment of all saved runs and curated sets. The result SHALL retain generated content, report before and after OOV totals for changed records, and summarize resolved, unresolved, and discarded terms.

#### Scenario: Backfill historical conversations
- **WHEN** an operator runs the batch against existing saved and curated conversations
- **THEN** the system re-audits their unchanged transcripts with current rules, refreshes enriched references, and reports every record whose OOV total changed

#### Scenario: Repeat the backfill
- **WHEN** the operator repeats the batch without vocabulary, policy, catalog, or transcript changes
- **THEN** persisted references and reported OOV totals remain unchanged
