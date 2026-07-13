## MODIFIED Requirements

### Requirement: Deterministic conversation curation evidence
The studio SHALL calculate authoritative per-conversation curation evidence from the conversation text, vocabulary source, shared language policy, reviewed morphology policy, and generated metadata. The evidence SHALL report unique current-set vocabulary, unique cumulative allowed vocabulary, true out-of-allowed content words and occurrences, and any non-vocabulary exemptions that explain why a token was not counted as true OOV. Unique vocabulary SHALL be deduplicated by canonical Japanese spelling. Out-of-vocabulary evidence SHALL exclude shared prompt-permitted grammar and function expressions, valid conjugations, reviewed lexical allomorphs, reviewed compositional morphology, tokenizer-recognized proper nouns and fillers, invalid non-lexical tokenizer fragments, approved generated names, validated approved-name surfaces with honorific suffixes, and declared proper nouns or cultural references that pass audit guardrails. Model-declared proper nouns and cultural references SHALL be treated as helper metadata only and MUST NOT count as vocabulary coverage.

#### Scenario: Inspect an analyzed conversation
- **WHEN** an operator reviews a generated, recommended, or curated conversation
- **THEN** the studio exposes its current-set unique count and words, cumulative allowed unique count and words, true out-of-allowed content evidence, and validated exemption evidence

#### Scenario: Distinguish current and earlier sets
- **WHEN** a Set 2 conversation uses words from Sets 1 and 2
- **THEN** its current-set evidence counts only unique Set 2 spellings while its cumulative evidence counts unique allowed spellings from both sets

#### Scenario: Audit permitted language
- **WHEN** a conversation contains a permitted grammar expression, valid conjugation, reviewed equivalent or composition, filler, or approved proper name that is not a literal vocabulary-table entry
- **THEN** the system does not count that permitted content as true out-of-allowed content

#### Scenario: Reject non-lexical tokenizer output
- **WHEN** tokenization produces punctuation-like debris from otherwise permitted filler text
- **THEN** the system excludes it from true OOV evidence and aggregate totals

#### Scenario: Audit approved name with honorific suffix
- **WHEN** a conversation contains an approved generated name with a permitted honorific suffix such as `さん`
- **THEN** the system treats that surface as an approved-name exemption rather than true out-of-allowed content

#### Scenario: Audit declared cultural reference
- **WHEN** a conversation contains a declared cultural proper noun or cultural reference outside the vocabulary table
- **THEN** the system treats that surface as a cultural-reference exemption rather than true out-of-allowed content when it appears in the conversation and passes audit guardrails
- **AND** does not count it as current-set or cumulative vocabulary coverage

#### Scenario: Validate model-declared proper nouns
- **WHEN** a generation response declares a proper noun or cultural reference that appears in the conversation and fits an allowed declaration category
- **THEN** the system may record it as a validated exemption
- **AND** excludes it from true out-of-allowed content analytics

#### Scenario: Reject invalid proper-noun declarations
- **WHEN** a generation response declares an ordinary content word as a proper noun or cultural reference but the audit guardrails reject that declaration
- **THEN** the system counts the word according to deterministic audit rules and does not let the declaration suppress true out-of-allowed content evidence

#### Scenario: Refresh evidence after content or policy changes
- **WHEN** a conversation is edited or an operator reanalyzes a saved run or curated set
- **THEN** the studio recalculates curation evidence and vocabulary references using the current vocabulary, shared language policy, reviewed morphology policy, and validated metadata

#### Scenario: Supply evidence to a model
- **WHEN** deterministic evidence is included in a generation audit, repair request, or AI curation request
- **THEN** server-calculated values remain authoritative and model-returned counts cannot replace them
