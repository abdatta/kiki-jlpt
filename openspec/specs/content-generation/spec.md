# Content Generation Specification

## Purpose

Defines how the studio validates, generates, audits, edits, voices, and manages practice-conversation runs.

## Requirements

### Requirement: Validated generation requests
The studio SHALL require a positive vocabulary set containing vocabulary, a resolvable text model, and an integer conversation count within the supported mode's range before generation. Standard generation SHALL accept 4 through 30 conversations; workflow generation SHALL accept 6 through 30 total conversations. Generated conversation vocabulary SHALL be constrained and audited against the vocabulary allowed through the selected set.

#### Scenario: Valid generation request
- **WHEN** an operator selects a valid set, an in-range conversation count, and an available model
- **THEN** the system prepares generation using vocabulary allowed through that set

#### Scenario: Invalid generation request
- **WHEN** the set, count, or requested model is invalid
- **THEN** the system rejects the request with a descriptive validation error and does not create a run

### Requirement: Conversation generation and normalization
The studio SHALL invoke the selected provider, normalize usable conversations from its response, audit their vocabulary, and persist the result as a run. It SHALL reject a provider response that contains no usable conversations.

#### Scenario: Provider returns usable conversations
- **WHEN** a configured provider returns at least one usable generated conversation
- **THEN** the system normalizes and audits the conversations and saves a run with generation analytics

#### Scenario: Provider returns no usable conversations
- **WHEN** the provider response cannot produce any usable conversation
- **THEN** the system reports a generation failure and does not save an empty successful run

### Requirement: Generation provenance and auditability
The studio SHALL retain the selected provider and model, prompt, output, request and response times, available provider statistics, vocabulary analytics, and workflow-stage state needed to inspect how a run was produced.

#### Scenario: Inspect a completed generation
- **WHEN** an operator opens the audit information for a generated run
- **THEN** the system exposes its model exchange and vocabulary analytics

#### Scenario: Inspect an in-progress workflow
- **WHEN** an asynchronous workflow is running
- **THEN** the system reports the pending, processing, completed, failed, or skipped state of each workflow stage

### Requirement: Balanced generation workflow
The studio SHALL support a workflow that assigns two thirds of the requested total, rounded up, to a primary batch and assigns the remainder to a complementary balancing batch. It SHALL calculate vocabulary-distribution needs between batches and optionally generate audio for a requested subset. Fixed audio mode SHALL accept zero through five audio targets, while maximum audio mode SHALL target the requested conversation total. The workflow SHALL preserve a combined run and stage-level audit record.

#### Scenario: Generate with balancing
- **WHEN** an operator starts a workflow for a requested total conversation count
- **THEN** the system generates the primary and balancing portions, combines and renumbers their conversations, and records distribution analytics

#### Scenario: Start workflow asynchronously
- **WHEN** an operator starts the background workflow
- **THEN** the system immediately returns a trackable job and makes its evolving status available until completion or failure

### Requirement: Conversation editing invalidates audio
The studio SHALL allow title, scene, context, and transcript edits on a non-curated conversation. A content edit SHALL remove the conversation's generated audio reference, return it to draft state, and require audio regeneration.

#### Scenario: Edit a draft or voiced conversation
- **WHEN** an operator saves content changes to a non-curated conversation
- **THEN** the system persists the text changes and clears any prior audio and audio error

#### Scenario: Edit a curated conversation
- **WHEN** an operator attempts to edit a conversation currently in the curated library
- **THEN** the system rejects the edit because the source is read-only while curated

### Requirement: Individual audio generation recovery
The studio SHALL allow audio to be generated or regenerated for an eligible individual conversation and SHALL persist success or failure state. A failed request SHALL retain an actionable error and allow a later retry.

#### Scenario: Audio generation succeeds
- **WHEN** the speech provider successfully generates audio for an eligible conversation
- **THEN** the system stores the audio reference and marks the conversation audio-ready

#### Scenario: Audio generation fails
- **WHEN** the speech provider fails to generate audio
- **THEN** the system marks the conversation audio-failed, records the error, and returns a failure response containing the updated run

### Requirement: Batch audio generation recovery
The studio SHALL support replacing all run audio or resuming only missing audio. Resume mode SHALL preserve existing completed audio. Batch processing SHALL persist successful calls, identify failures, and mark work not started after a stopping failure as skipped or draft rather than falsely complete.

#### Scenario: Resume missing audio
- **WHEN** an operator resumes audio generation for a partially voiced run
- **THEN** the system targets only conversations without audio and retains existing audio

#### Scenario: Batch audio call fails
- **WHEN** an audio request fails during a batch configured to stop starting new work
- **THEN** the system preserves prior successes, records the failed conversation, skips unstarted targets, and reports a partial failure

### Requirement: Run lifecycle management
The studio SHALL list, retrieve, reanalyze, and delete persisted runs. Reanalysis SHALL recompute vocabulary audits and analytics from current vocabulary rules without regenerating conversation text.

#### Scenario: Reanalyze a run
- **WHEN** an operator requests reanalysis of a saved run
- **THEN** the system refreshes its conversation audits and aggregate analytics while retaining its generated content

#### Scenario: Delete a run
- **WHEN** an operator deletes an eligible run
- **THEN** the system removes its persisted run data and associated generated audio

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
