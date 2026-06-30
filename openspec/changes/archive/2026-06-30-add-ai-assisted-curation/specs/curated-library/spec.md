## MODIFIED Requirements

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

## ADDED Requirements

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
The studio SHALL retain every persisted AI curation review and expose a newest-first set-scoped history containing its date, model, exact requested size, status, recommendation count, candidate count, and current freshness. Opening a historical review SHALL display its captured result and audit information read-only without making it the latest review or changing the curated library. The operator MAY copy a historical review's model and exact-size settings into the preflight controls for a new curation request.

#### Scenario: Browse saved reviews
- **WHEN** an operator opens curation history for a set
- **THEN** the studio lists every persisted review newest first with enough provenance and status information to distinguish runs

#### Scenario: Open an older review
- **WHEN** the operator selects a review that is not the newest review
- **THEN** the studio renders its captured recommendation and stale status without allowing Add All, per-conversation library addition, or audio mutation from that historical snapshot

#### Scenario: Reuse historical settings
- **WHEN** the operator chooses Use Settings on a historical review
- **THEN** the preflight model and exact-size controls adopt that review's settings without starting curation until the operator explicitly submits the form

### Requirement: Operator-controlled recommendation actions
AI curation results SHALL remain advisory. The studio SHALL require the operator to review and explicitly add each recommended conversation through the existing curated-library validation path.

#### Scenario: Review recommendations without applying them
- **WHEN** an AI curation review completes
- **THEN** no conversation is added, removed, reordered, or published solely because of the model result

#### Scenario: Add a recommended conversation
- **WHEN** an operator chooses to add a recommended audio-ready conversation
- **THEN** the system applies the existing duplicate, source-traceability, and audio-readiness checks before changing the curated library

#### Scenario: Add the complete recommended portfolio
- **WHEN** an operator explicitly chooses Add All on a current AI curation review
- **THEN** the studio first generates audio for every recommended conversation that lacks it, then adds every recommendation through the existing curated-library validation path, and shows per-conversation progress for both phases

#### Scenario: Add All audio generation fails
- **WHEN** one or more recommended conversations fail audio generation during Add All
- **THEN** the studio does not begin the library-add phase, identifies each failure in the progress modal, preserves successful audio, and allows the operator to retry

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
The studio SHALL deterministically calculate and display the vocabulary that would be least covered after adding every recommendation in a current AI portfolio. The projection SHALL start from current library conversation-level exposure and add at most one exposure per recommended conversation for each current-set word.

#### Scenario: Inspect projected coverage
- **WHEN** an AI curation review contains one or more recommendations
- **THEN** the AI curation view shows the projected least-covered words and their projected conversation counts after Add All

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
