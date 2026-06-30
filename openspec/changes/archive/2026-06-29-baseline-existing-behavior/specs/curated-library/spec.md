## ADDED Requirements

### Requirement: Curate only audio-ready conversations
The studio SHALL add a generated conversation to the curated library only when it has successfully generated audio. Curation SHALL copy the audio into curated storage, preserve source-run traceability, and prevent duplicate curation of the same source conversation.

#### Scenario: Curate an audio-ready conversation
- **WHEN** an operator adds an audio-ready generated conversation to the library
- **THEN** the system creates a curated copy with its audio, set assignment, source identifiers, and curation timestamp

#### Scenario: Curate a conversation without audio
- **WHEN** an operator attempts to curate a conversation that is not audio-ready
- **THEN** the system rejects the operation and instructs the operator to generate audio first

#### Scenario: Curate the same source twice
- **WHEN** the same source run and conversation are submitted for curation again
- **THEN** the system returns the existing curated item without creating a duplicate

### Requirement: Curated source locking
While a source conversation is represented in the curated library, the studio SHALL prevent edits, audio deletion, and audio regeneration that would diverge the source from its curated copy.

#### Scenario: Modify a curated source
- **WHEN** an operator attempts to edit or replace audio on a curated source conversation
- **THEN** the system rejects the operation as read-only

#### Scenario: Remove a curated item
- **WHEN** an operator removes a conversation from the curated library
- **THEN** the system deletes its curated metadata and audio and, when the original source run remains available and linked, unlocks that source conversation

### Requirement: Curated vocabulary analysis
The studio SHALL calculate per-set vocabulary coverage and out-of-vocabulary analytics for curated conversations and SHALL support reanalysis using the current vocabulary source.

#### Scenario: View a curated set
- **WHEN** an operator opens a curated vocabulary set
- **THEN** the system reports its current conversations and aggregate vocabulary analytics

#### Scenario: Reanalyze a curated set
- **WHEN** an operator requests reanalysis after vocabulary rules change
- **THEN** the system refreshes each conversation audit and the set's aggregate analytics without regenerating content

### Requirement: Coverage-based recommendations
The studio SHALL rank eligible, non-curated conversations from saved runs according to how strongly they cover the current set's least-covered vocabulary, giving greatest priority to vocabulary absent from the curated set.

#### Scenario: Request recommendations
- **WHEN** an operator requests recommendations for a set with coverage gaps
- **THEN** the system returns least-covered words and candidate conversations ordered by their weighted contribution to those gaps

#### Scenario: Exclude already curated sources
- **WHEN** a saved conversation is already represented in the curated set
- **THEN** the system excludes that source conversation from recommendation candidates

### Requirement: Library balancing plan and complement generation
The studio SHALL calculate a balancing plan that identifies zero-coverage, low-coverage, priority, and overrepresented vocabulary and recommends a conversation count. It SHALL support previewing and generating a complementary run based on that plan.

#### Scenario: Preview a complement
- **WHEN** an operator previews complement generation for a valid set
- **THEN** the system returns the current balance plan and the model exchange that would target its vocabulary needs

#### Scenario: Generate a complement
- **WHEN** an operator generates a library complement
- **THEN** the system creates an audited run whose prompt and provider statistics retain the applicable balance context

### Requirement: Static library publication
The studio SHALL publish all eligible curated conversations and audio into a versioned static learner manifest. Publication SHALL preserve stable conversation identifiers and prior publication order for unchanged content and SHALL report whether curated and published content are out of sync.

#### Scenario: Curated content changes
- **WHEN** publishable curated timestamps or counts differ from the current manifest
- **THEN** the system reports the published library as stale

#### Scenario: Publish curated content
- **WHEN** an operator publishes the curated library
- **THEN** the system rebuilds the learner audio and manifest, retains stable identities for unchanged conversations, and reports synchronized counts and timestamps

#### Scenario: Ignore ineligible curated content
- **WHEN** a curated record is not audio-ready or has no audio file reference
- **THEN** the system excludes it from the published learner manifest
