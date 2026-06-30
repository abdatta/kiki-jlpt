## ADDED Requirements

### Requirement: Natural current-set generation guidance
The studio SHALL instruct standard and complementary conversation-generation models to prioritize meaningful use of vocabulary from the selected current set while using earlier allowed sets as supporting language. The guidance SHALL favor coherent beginner conversations, natural repetition, and varied situations over forcing priority words into unsuitable dialogue, while retaining aggregate vocabulary coverage as a batch objective.

#### Scenario: Generate a standard batch
- **WHEN** the studio prepares a standard or primary generation prompt for a selected set
- **THEN** the prompt identifies current-set vocabulary as the primary learning focus and instructs the model to use it naturally and meaningfully rather than maximizing isolated mentions

#### Scenario: Generate a complementary batch
- **WHEN** the studio prepares a complementary prompt from zero-coverage and underexposed vocabulary
- **THEN** the prompt supplies those priorities but permits the model to omit or redistribute a word when including it would produce an unnatural conversation

#### Scenario: Reuse earlier vocabulary
- **WHEN** a generated conversation needs supporting language from an earlier allowed set
- **THEN** the prompt permits that vocabulary without treating it as equivalent to meaningful current-set exposure

### Requirement: Deterministic conversation curation evidence
The studio SHALL calculate authoritative per-conversation curation evidence from the conversation text and vocabulary source. The evidence SHALL report unique current-set vocabulary, unique cumulative allowed vocabulary, and out-of-vocabulary words and occurrences. Unique vocabulary SHALL be deduplicated by canonical Japanese spelling. Out-of-vocabulary evidence SHALL exclude shared prompt-permitted grammar and function expressions, valid conjugations, tokenizer-recognized proper nouns and fillers, and approved generated names.

#### Scenario: Inspect an analyzed conversation
- **WHEN** an operator reviews a generated, recommended, or curated conversation
- **THEN** the studio exposes its current-set unique count and words, cumulative allowed unique count and words, and out-of-vocabulary evidence

#### Scenario: Distinguish current and earlier sets
- **WHEN** a Set 2 conversation uses words from Sets 1 and 2
- **THEN** its current-set evidence counts only unique Set 2 spellings while its cumulative evidence counts unique allowed spellings from both sets

#### Scenario: Audit permitted language
- **WHEN** a conversation contains a permitted grammar expression, valid conjugation, filler, or approved proper name that is not a vocabulary-table entry
- **THEN** the system does not count that permitted content as out of vocabulary

#### Scenario: Refresh evidence after content or policy changes
- **WHEN** a conversation is edited or an operator reanalyzes a saved run or curated set
- **THEN** the studio recalculates curation evidence using the current vocabulary and shared language policy

#### Scenario: Supply evidence to a model
- **WHEN** deterministic evidence is included in a generation audit or AI curation request
- **THEN** server-calculated values remain authoritative and model-returned counts cannot replace them
