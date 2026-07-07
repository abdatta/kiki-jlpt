# Curated Library Specification

## Purpose

Defines how generated conversations are curated, analyzed, balanced, recommended, and published for learner practice.

## Requirements

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
The studio SHALL use an operator-selected configured text model to recommend an ordered portfolio containing exactly the operator-selected number of conversations from every eligible, non-curated conversation in saved runs for the selected set. The recommendation SHALL be grounded in the current curated library, complete candidate dialogue and learning material, authoritative deterministic curation evidence, and per-word library exposure. Audio readiness and audio status SHALL NOT be supplied to the model or influence selection because audio can be generated after curation. The curator SHALL prioritize meaningful current-set learning and treat absent and underexposed current-set words as the strongest coverage opportunities while considering naturalness, repetition, comprehension quality, situation variety, and redundancy across both the library and proposed portfolio. The result SHALL identify source conversations and explain each recommendation without automatically changing the curated library.

#### Scenario: Request AI-assisted recommendations
- **WHEN** an operator invokes AI curation for a selected set with eligible saved conversations
- **THEN** the system considers every eligible candidate and returns an ordered, reviewable portfolio with candidate identities, rationales, strengths, concerns, and vocabulary contributions

#### Scenario: Select a complementary portfolio
- **WHEN** individually strong candidates substantially duplicate vocabulary, situations, or learning value
- **THEN** the model evaluates their collection-level contribution and may prefer a more complementary candidate instead of preserving an independent numeric ranking

#### Scenario: Focus on the selected set without forcing coverage
- **WHEN** a candidate contains many current-set words but uses them unnaturally or only incidentally
- **THEN** the curator can rank it below a more coherent candidate with fewer but more meaningful current-set exposures and explains the trade-off

#### Scenario: Exclude already curated sources
- **WHEN** a saved conversation is already represented in the curated set
- **THEN** the system excludes that source conversation from the candidate snapshot supplied for recommendation

#### Scenario: Select independently of audio readiness
- **WHEN** eligible candidates differ only in whether audio has already been generated
- **THEN** the model receives no audio-readiness information and judges them only from their learning content and deterministic vocabulary evidence

#### Scenario: Enforce exact portfolio size
- **WHEN** the operator requests a portfolio of N eligible conversations
- **THEN** the model is instructed to return exactly N unique recommendations and the server rejects a response containing any other number

#### Scenario: Provider or response failure
- **WHEN** the selected model request fails or returns malformed, fabricated, duplicate, or ineligible candidate identities
- **THEN** the system reports a retryable curation failure and leaves the curated library unchanged

### Requirement: Library balancing plan and complement generation
The studio SHALL calculate a balancing plan that identifies zero-coverage, low-coverage, priority, and overrepresented vocabulary and recommends a conversation count. It SHALL support previewing and generating a complementary run based on that plan in either a deterministic stats-only mode or an AI-enabled mode, and SHALL allow the operator to override the recommended conversation count before generating. In AI-enabled mode the studio SHALL ground complement generation in the cached AI-curation snapshot for the set — the existing curated conversations' learning content and per-word library exposure — in addition to the deterministic plan, so the model generates new conversations that fill absent and underexposed current-set vocabulary while avoiding redundancy with existing scenes and over-repetition. In both modes the deterministic balance plan SHALL remain authoritative and the model SHALL NOT recalculate or alter the supplied counts. Generation SHALL produce a normal audited run for review and SHALL NOT automatically add conversations to the curated library.

#### Scenario: Preview a complement
- **WHEN** an operator previews complement generation for a valid set in either mode
- **THEN** the system returns the current balance plan and the model exchange that would target its vocabulary needs

#### Scenario: Generate a stats-only complement
- **WHEN** an operator generates a library complement in deterministic stats-only mode
- **THEN** the system creates an audited run from the deterministic balance plan whose prompt and provider statistics retain the applicable balance context

#### Scenario: Generate an AI-balanced complement
- **WHEN** an operator generates a library complement in AI-enabled mode
- **THEN** the system supplies the deterministic balance plan together with the curated set's conversation content and per-word exposure, instructs the model to author new conversations that fill coverage gaps without duplicating existing scenes or over-repeating words, and creates an audited run whose prompt and provider statistics retain the applicable balance and snapshot context

#### Scenario: Override the recommended conversation count
- **WHEN** an operator sets a conversation count different from the plan's recommendation before generating in either mode
- **THEN** the system generates the operator-specified number of complementary conversations

#### Scenario: Balance generation provider or response failure
- **WHEN** the selected model request fails or returns no usable conversations during complement generation in either mode
- **THEN** the system reports a retryable generation failure and leaves the curated library unchanged

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

### Requirement: AI curation provenance and freshness
The studio SHALL retain each AI curation review's selected provider and model, prompt and raw output, request timing and available statistics, deterministic evidence version, complete candidate accounting, curated-library snapshot, validated recommendations, and status. It SHALL identify a completed review as stale when a relevant candidate or the selected curated set changes after the captured snapshot.

#### Scenario: Inspect a completed curation review
- **WHEN** an operator opens a saved AI curation result
- **THEN** the studio exposes its recommendation, model provenance, captured library context, and candidate accounting needed to understand how it was produced

#### Scenario: Library changes after recommendation
- **WHEN** a conversation is added to or removed from the relevant curated set after a review completes
- **THEN** the studio marks the review stale and prompts the operator to generate an updated recommendation

#### Scenario: Candidate changes after recommendation
- **WHEN** a referenced source conversation's learning content is edited, deleted, or newly curated after a review completes
- **THEN** the studio marks the review stale and does not present it as a current portfolio assessment

#### Scenario: Candidate audio changes after recommendation
- **WHEN** audio is generated, regenerated, or removed without changing a referenced conversation's learning content
- **THEN** the review remains current because audio readiness was not part of the curation decision

#### Scenario: Retry a failed review
- **WHEN** an AI curation review fails because of provider, parsing, or validation error
- **THEN** the studio preserves failure details for inspection and allows the operator to retry without changing the library

### Requirement: AI curation review history
The studio SHALL retain every persisted AI curation review and expose a newest-first set-scoped history containing its date, model, exact requested size, status, recommendation count, candidate count, and current freshness. Opening a historical review SHALL display its captured result, audit information, current freshness, and live recommendation reconciliation without making it the latest review. A completed historical review MAY offer Add All or Add Remaining only after live reconciliation confirms that the actionable recommendations still resolve safely from current persisted state. The operator MAY copy a historical review's model and exact-size settings into the preflight controls for a new curation request.

#### Scenario: Browse saved reviews
- **WHEN** an operator opens curation history for a set
- **THEN** the studio lists every persisted review newest first with enough provenance and status information to distinguish runs

#### Scenario: Open an older review
- **WHEN** the operator selects a review that is not the newest review
- **THEN** the studio renders its captured recommendation, stale status, and live reconciliation summary without presenting the review as a current portfolio assessment

#### Scenario: Reconcile an actionable historical review
- **WHEN** a completed historical review contains recommendations whose source conversations still exist and whose learning content still matches the review snapshot
- **THEN** the studio identifies recommendations already in Library, recommendations remaining to add, recommendations with existing audio, recommendations needing audio, and stale context such as newer candidates or Library changes since the review
- **AND** the studio allows the operator to explicitly continue with Add All or Add Remaining after showing those warnings

#### Scenario: Block an unreconciled historical review
- **WHEN** a historical review is failed, has no recommendations, references a missing source run or conversation, or references source learning content that changed since the review
- **THEN** the studio explains the blocking condition and does not allow Add All, per-conversation Library addition, or audio mutation from that historical snapshot

#### Scenario: Reuse historical settings
- **WHEN** the operator chooses Use Settings on a historical review
- **THEN** the preflight model and exact-size controls adopt that review's settings without starting curation until the operator explicitly submits the form

### Requirement: Operator-controlled recommendation actions
AI curation results SHALL remain advisory. The studio SHALL require the operator to review and explicitly add each recommended conversation through the existing curated-library validation path. Add All audio SHALL execute as a durable Studio background job through the shared bounded audio scheduler while retaining explicit start, cooperative pause, stop-on-failure, reconciliation, and portfolio-wide Library gating. Completed historical AI curation reviews SHALL use live reconciliation before any Add All or Add Remaining action and SHALL skip recommendations already represented in the Library.

#### Scenario: Review recommendations without applying them
- **WHEN** an AI curation review completes
- **THEN** no conversation is added, removed, reordered, or published solely because of the model result

#### Scenario: Add a recommended conversation
- **WHEN** an operator chooses to add a recommended audio-ready conversation
- **THEN** the system applies the existing duplicate, source-traceability, and audio-readiness checks before changing the curated library

#### Scenario: Add the complete recommended portfolio
- **WHEN** an operator explicitly chooses Add All on a current AI curation review or a reconciled historical AI curation review
- **THEN** the studio refreshes the recommended source conversations, treats each persisted audio file as completed audio, skips recommendations already in Library, and opens a portfolio progress modal without issuing any speech-generation or Library-add requests
- **AND** the modal requires an explicit operator action to generate only missing recommendation audio, or to begin adding when the complete remaining portfolio is already audio-ready
- **AND** the studio shows the same per-conversation audio statuses, completed count, active-work visibility, and completed, failed, or stopped stage language used by LLM Audit bulk audio before showing per-conversation Library progress

#### Scenario: Add remaining recommendations from a partially applied historical review
- **WHEN** a reconciled historical review contains one or more recommendations already in Library and one or more valid recommendations not yet in Library
- **THEN** the studio labels the action as adding the remaining recommendations, reports the already-added count, and performs no audio or Library work for already-curated recommendations

#### Scenario: Warn before applying stale historical recommendations
- **WHEN** a reconciled historical review is stale because the curated Library changed or because newer candidates were added after the review
- **THEN** the studio warns that the original AI ranking did not evaluate the current full context and requires explicit operator confirmation before starting Add All or Add Remaining

#### Scenario: AI curation does not start audio
- **WHEN** an operator starts or repeats AI curation with AI Curate or Re-curate
- **THEN** the studio may generate the text-only recommendation review but does not issue speech-generation requests

#### Scenario: Start Add All audio explicitly
- **WHEN** the Add All modal has reconciled a portfolio with missing audio and the operator chooses Start generation
- **THEN** the studio persists a parent job, submits only missing recommendation audio to the shared scheduler, runs at most three speech requests globally, and changes the modal control to Pause

#### Scenario: Refresh during Add All audio
- **WHEN** the browser refreshes or navigates after Add All audio has started
- **THEN** the durable parent and child jobs continue on the server and remain visible in the Studio background summary

#### Scenario: Pause Add All audio gracefully
- **WHEN** the operator chooses Pause while Add All audio generation is active
- **THEN** the durable job shows Pausing, the scheduler starts no additional child requests for that parent, and already-started requests are allowed to succeed or fail before the workflow becomes paused

#### Scenario: Resume paused Add All audio
- **WHEN** the operator chooses Resume for a paused or interrupted Add All workflow
- **THEN** the studio refreshes persisted source state, preserves completed audio, and resumes only recommendations that still lack audio

#### Scenario: Add All encounters existing audio
- **WHEN** one or more recommended conversations already have persisted audio files when Add All starts or retries
- **THEN** the studio preserves those files, marks those conversations audio-complete, and does not issue speech-generation requests for them

#### Scenario: Add All audio generation fails
- **WHEN** a recommended conversation fails audio generation during Add All
- **THEN** the studio stops starting additional audio work for that Add All parent, allows already-started requests to settle, preserves every successful audio file, marks the failed and unstarted conversations distinctly, and does not begin the Library-add phase

#### Scenario: Retry an incomplete Add All workflow
- **WHEN** the operator retries Add All after an audio or Library failure
- **THEN** the studio rechecks current persisted source and Library state, skips completed audio and existing Library additions, and resumes only unresolved work

#### Scenario: Add All source is no longer available
- **WHEN** a recommended source run or conversation cannot be resolved from current persisted state
- **THEN** the studio identifies the affected recommendation, performs no Library additions, and leaves the workflow retryable

### Requirement: Separate deterministic and AI recommendation views
The Queue view SHALL load and display deterministic coverage recommendations by default and SHALL NOT start an AI curation model request or generate a review. The Queue MAY prefetch saved AI curation context in the background to make opening the AI curation view responsive. Invoking AI Curate SHALL navigate to a dedicated set-scoped AI curation view without starting a model request. The AI curation view SHALL display the latest saved review when one exists and SHALL require the operator to select a configured text model and exact portfolio size before starting a new or replacement review.

#### Scenario: Open the Queue
- **WHEN** an operator navigates to the Queue for a set
- **THEN** the studio shows deterministic least-covered vocabulary and deterministic candidate ordering and does not start an AI curation model request

#### Scenario: Open AI curation
- **WHEN** the operator invokes AI Curate from the Queue
- **THEN** the studio opens the dedicated AI curation route and shows the saved review or pre-curation controls without automatically beginning a model request

#### Scenario: Validate exact portfolio size before curation
- **WHEN** the operator configures a new or replacement AI review
- **THEN** the form requires an integer from 1 through the current eligible candidate count and prevents submission when the requested size exceeds that count

### Requirement: Projected portfolio coverage
The studio SHALL deterministically calculate and display the vocabulary that would be least covered after adding every recommendation in a current AI portfolio or every remaining valid recommendation in a reconciled historical AI portfolio. The projection SHALL start from current library conversation-level exposure and add at most one exposure per recommended conversation for each current-set word. When displaying a historical review, the studio SHALL distinguish original snapshot coverage from current recomputed coverage.

#### Scenario: Inspect projected coverage for a current review
- **WHEN** a current AI curation review contains one or more recommendations
- **THEN** the AI curation view shows the projected least-covered words and their projected conversation counts after Add All

#### Scenario: Inspect projected coverage for a historical review
- **WHEN** a reconciled historical AI curation review contains one or more remaining valid recommendations
- **THEN** the AI curation view shows current recomputed projected least-covered words for the remaining portfolio and identifies the original saved projection as historical snapshot data

#### Scenario: Recompute historical stats after Library changes
- **WHEN** the operator requests current stats for a historical review whose original Library context is stale
- **THEN** the studio recomputes the projected coverage from the current curated Library and the review's still-valid recommendations without changing the saved review record

### Requirement: Efficient curation context loading
The studio SHALL derive AI curation freshness from the current candidate, curated-library, and vocabulary state and SHALL reuse a previously computed curation snapshot instead of recomputing candidate and library evidence when none of those inputs have changed. The studio SHALL prepare a set's curation context when its deterministic Queue is opened so that opening AI curation is responsive without an additional recomputation when inputs are unchanged. Freshness and recommendation results SHALL remain authoritative; reuse SHALL NOT serve a result that no longer matches the current candidate and library state.

#### Scenario: Reopen a review without input changes
- **WHEN** an operator reopens, refreshes, or switches between saved AI curation reviews for a set whose candidate, curated-library, and vocabulary inputs are unchanged
- **THEN** the studio reports each review's freshness without recomputing candidate and library evidence from scratch for every request

#### Scenario: Recompute after relevant input changes
- **WHEN** a candidate conversation, the curated set, or the allowed vocabulary for a set changes
- **THEN** the next curation context request recomputes candidate and library evidence and freshness from the updated state

#### Scenario: Prepare curation context from the Queue
- **WHEN** an operator opens the deterministic Queue for a set
- **THEN** the studio prepares that set's AI curation context in the background without starting a model request, so opening AI curation requires no additional recomputation when inputs are unchanged
