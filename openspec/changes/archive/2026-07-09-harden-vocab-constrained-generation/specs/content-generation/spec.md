## MODIFIED Requirements

### Requirement: Conversation generation and normalization
The studio SHALL invoke the selected provider, normalize usable conversations from its response, audit their vocabulary, attempt one repair when true out-of-allowed content vocabulary remains, and persist the best audited usable result as a run. For Set 2 and later, generated batches SHOULD target zero true out-of-allowed content words after deterministic prompt-policy, validated proper-noun, and declared cultural-reference exemptions, but remaining true OOV findings SHALL be treated as auditable quality findings rather than a hard generation failure. It SHALL reject a provider response that contains no usable conversations.

#### Scenario: Provider returns usable conversations within vocabulary targets
- **WHEN** a configured provider returns at least one usable generated conversation whose deterministic audit has no true out-of-allowed content findings
- **THEN** the system normalizes and audits the conversations and saves a run with generation analytics

#### Scenario: Provider returns repairable out-of-allowed content
- **WHEN** a generated batch contains true out-of-allowed content words
- **THEN** the system sends the offending conversations, offending line context, audit findings, and allowed-vocabulary constraints to the selected text provider for repair
- **AND** re-normalizes and re-audits the repaired conversations before saving the run

#### Scenario: Repair removes true out-of-allowed content
- **WHEN** a repair attempt returns usable conversations with fewer vocabulary quality findings than the original batch
- **THEN** the system persists the repaired audited conversations as the successful generated run

#### Scenario: Repair does not improve the audit
- **WHEN** the repair attempt fails, returns no usable conversations, or does not reduce vocabulary quality findings
- **THEN** the system persists the original usable audited conversations
- **AND** exposes the repair exchange and remaining true out-of-allowed content findings in generation provenance and analytics

#### Scenario: Provider returns no usable conversations
- **WHEN** the provider response cannot produce any usable conversation
- **THEN** the system reports a generation failure and does not save an empty successful run

### Requirement: Generation provenance and auditability
The studio SHALL retain the selected provider and model, prompts, outputs, request and response times, available provider statistics, vocabulary analytics, vocabulary quality results, repair attempts, and workflow-stage state needed to inspect how a run was produced. When repair occurs, the initial generation exchange and each repair exchange SHALL remain inspectable in order, and final run analytics SHALL be calculated from the selected final audited conversations rather than from superseded text.

#### Scenario: Inspect a completed generation without repair
- **WHEN** an operator opens the audit information for a generated run that did not need repair
- **THEN** the system exposes its model exchange, vocabulary analytics, and vocabulary quality result

#### Scenario: Inspect a completed generation with repair
- **WHEN** an operator opens the audit information for a generated run that required repair
- **THEN** the system exposes the initial generation exchange, each repair exchange, and the final vocabulary analytics used to save the run

#### Scenario: Inspect a completed generation with remaining vocabulary findings
- **WHEN** a generation completes after a repair attempt did not remove all true out-of-allowed content
- **THEN** the durable run exposes the original exchange, repair exchange, selected final payload, remaining true out-of-allowed content findings, and repair outcome needed to adjust the prompt

#### Scenario: Rerun a failed saved repair
- **WHEN** an operator inspects a saved workflow text-generation node whose latest repair attempt failed or did not improve the audit
- **THEN** the audit node and Attempts tab identify the unresolved repair problem
- **AND** the operator can rerun repair when the run has no unfinished background work and the node retains the required prompt, conversation, and audit data
- **AND** a successful rerun appends the new repair exchange, updates the selected final payload, refreshes analytics, and clears stale audio from changed conversations

#### Scenario: Inspect an in-progress workflow
- **WHEN** an asynchronous workflow is running
- **THEN** the system reports the pending, processing, completed, failed, or skipped state of each workflow stage

### Requirement: Natural current-set generation guidance
The studio SHALL instruct standard and complementary conversation-generation models to prioritize meaningful use of vocabulary from the selected current set while using earlier allowed sets as supporting language. The guidance SHALL treat the allowed vocabulary table as the hard boundary for Japanese content words except for a restrained number of model-selected proper nouns and cultural references that are explicitly declared in the response. If a natural line would require an unlisted content word that is neither allowed vocabulary nor a declared proper noun or cultural reference, the model SHALL choose simpler wording or a different scene instead of introducing that word. Common later-set N5 words SHALL remain forbidden until their set is reached unless they are functioning as a declared cultural reference rather than ordinary vocabulary. The guidance SHALL encourage limited, natural use of common Japanese cultural references for immersion, while making clear that they do not count toward vocabulary coverage. The guidance SHALL favor coherent beginner conversations, natural repetition, and varied situations over forcing priority words into unsuitable dialogue, while retaining aggregate vocabulary coverage as a batch objective. When an AI-balanced complementary prompt is prepared, the studio SHALL additionally supply the existing curated library's conversation content and per-word exposure so the model can author conversations that improve coverage of absent and underexposed current-set words while avoiding redundancy with existing scenes and over-repetition, treating the deterministic plan and exposure as authoritative inputs it does not recalculate.

#### Scenario: Generate a standard batch
- **WHEN** the studio prepares a standard or primary generation prompt for a selected set
- **THEN** the prompt identifies current-set vocabulary as the primary learning focus and instructs the model to use it naturally and meaningfully rather than maximizing isolated mentions
- **AND** instructs the model not to introduce Japanese content words outside the allowed vocabulary table
- **AND** permits the model to choose and declare a restrained number of common Japanese proper nouns or cultural references for immersion without counting them as vocabulary coverage

#### Scenario: Generate a complementary batch
- **WHEN** the studio prepares a complementary prompt from zero-coverage and underexposed vocabulary
- **THEN** the prompt supplies those priorities but permits the model to omit or redistribute a word when including it would produce an unnatural conversation
- **AND** instructs the model to choose a different line or scene rather than use unlisted Japanese content words
- **AND** permits declared cultural references only when they fit the scene naturally

#### Scenario: Generate an AI-balanced complementary batch
- **WHEN** the studio prepares an AI-balanced complementary prompt for a set
- **THEN** the prompt supplies the deterministic zero-coverage and underexposed priorities together with the existing library conversations' learning content and per-word exposure, and instructs the model to author new conversations that fill those gaps while diversifying scenes away from existing ones and repeating focal words only where natural
- **AND** treats later-set vocabulary as unavailable even when it would be common or convenient

#### Scenario: Reuse earlier vocabulary
- **WHEN** a generated conversation needs supporting language from an earlier allowed set
- **THEN** the prompt permits that vocabulary without treating it as equivalent to meaningful current-set exposure

#### Scenario: Natural wording would need unavailable vocabulary
- **WHEN** a conversation idea would require a Japanese content word outside the allowed vocabulary table
- **THEN** the prompt instructs the model to use the word only if it is functioning as a proper noun or cultural reference and is declared in the response metadata
- **AND** otherwise simplify the wording or choose a different everyday situation

#### Scenario: Use model-selected cultural references
- **WHEN** the studio prepares a generation prompt
- **THEN** the prompt may encourage restrained model-selected use of common Japanese cultural references such as places, cities, landmarks, or foods
- **AND** requires the response to declare each such reference with a category and short rationale
- **AND** states that those references are audit exemptions rather than learned vocabulary coverage

### Requirement: Deterministic conversation curation evidence
The studio SHALL calculate authoritative per-conversation curation evidence from the conversation text, vocabulary source, shared language policy, and generated metadata. The evidence SHALL report unique current-set vocabulary, unique cumulative allowed vocabulary, true out-of-allowed content words and occurrences, and any non-vocabulary exemptions that explain why a token was not counted as true OOV. Unique vocabulary SHALL be deduplicated by canonical Japanese spelling. Out-of-vocabulary evidence SHALL exclude shared prompt-permitted grammar and function expressions, valid conjugations, tokenizer-recognized proper nouns and fillers, approved generated names, validated approved-name surfaces with honorific suffixes, and declared proper nouns or cultural references that pass audit guardrails. Model-declared proper nouns and cultural references SHALL be treated as helper metadata only and MUST NOT count as vocabulary coverage.

#### Scenario: Inspect an analyzed conversation
- **WHEN** an operator reviews a generated, recommended, or curated conversation
- **THEN** the studio exposes its current-set unique count and words, cumulative allowed unique count and words, true out-of-allowed content evidence, and validated exemption evidence

#### Scenario: Distinguish current and earlier sets
- **WHEN** a Set 2 conversation uses words from Sets 1 and 2
- **THEN** its current-set evidence counts only unique Set 2 spellings while its cumulative evidence counts unique allowed spellings from both sets

#### Scenario: Audit permitted language
- **WHEN** a conversation contains a permitted grammar expression, valid conjugation, filler, or approved proper name that is not a vocabulary-table entry
- **THEN** the system does not count that permitted content as true out-of-allowed content

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
- **THEN** the studio recalculates curation evidence using the current vocabulary, shared language policy, and validated metadata

#### Scenario: Supply evidence to a model
- **WHEN** deterministic evidence is included in a generation audit, repair request, or AI curation request
- **THEN** server-calculated values remain authoritative and model-returned counts cannot replace them
