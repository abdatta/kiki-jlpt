## MODIFIED Requirements

### Requirement: Deterministic conversation curation evidence
The studio SHALL calculate authoritative per-conversation curation evidence from the conversation text, vocabulary source, shared language policy, and generated metadata. The evidence SHALL report unique current-set vocabulary, unique cumulative allowed vocabulary, true out-of-allowed content words and occurrences, and any non-vocabulary exemptions that explain why a token was not counted as true OOV. Unique vocabulary SHALL be deduplicated by canonical Japanese spelling. Out-of-vocabulary evidence SHALL exclude shared prompt-permitted grammar and function expressions, valid conjugations, tokenizer-recognized proper nouns and fillers, approved generated names, validated approved-name surfaces with honorific suffixes, and declared proper nouns or cultural references that pass audit guardrails. Model-declared proper nouns and cultural references SHALL be treated as helper metadata only and MUST NOT count as vocabulary coverage. After each final audit produced by generation, quality repair, editing, or reanalysis, the studio SHALL enrich true OOV terms from deterministic vocabulary sources and persist complete future-set or external conversation references; generation-model self-reporting MUST NOT replace this enrichment.

#### Scenario: Inspect an analyzed conversation
- **WHEN** an operator reviews a generated, recommended, or curated conversation
- **THEN** the studio exposes its current-set unique count and words, cumulative allowed unique count and words, true out-of-allowed content evidence, validated exemption evidence, and resolved learner-facing references

#### Scenario: Distinguish current and earlier sets
- **WHEN** a Set 2 conversation uses words from Sets 1 and 2
- **THEN** its current-set evidence counts only unique Set 2 spellings while its cumulative evidence counts unique allowed spellings from both sets

#### Scenario: Audit permitted language
- **WHEN** a conversation contains a permitted grammar expression, valid conjugation, filler, or approved proper name that is not a vocabulary-table entry
- **THEN** the system does not count that permitted content as true out-of-allowed content

#### Scenario: Audit a productive vocabulary pattern
- **WHEN** an allowed vocabulary entry contains a `～` prefix or suffix marker and a conversation uses a matching compound in one or multiple tokenizer tokens
- **THEN** the system credits the pattern entry and does not count the matching compound as true out-of-allowed content

#### Scenario: Audit an approved name split by the tokenizer
- **WHEN** an approved name surface spans multiple tokenizer tokens
- **THEN** the system exempts the complete name span and does not report its token fragments as true out-of-allowed content

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

#### Scenario: Enrich after final audit
- **WHEN** generation, quality repair, editing, or reanalysis produces a final true OOV list
- **THEN** the studio resolves and persists future-set and external references from deterministic vocabulary sources after the transcript is final

#### Scenario: Refresh evidence after content or policy changes
- **WHEN** a conversation is edited or an operator reanalyzes a saved run or curated set
- **THEN** the studio recalculates curation evidence and enriched references using the current vocabulary, shared language policy, validated metadata, and reviewed supplemental catalog

#### Scenario: Supply evidence to a model
- **WHEN** deterministic evidence is included in a generation audit, repair request, or AI curation request
- **THEN** server-calculated values remain authoritative and model-returned counts cannot replace them
