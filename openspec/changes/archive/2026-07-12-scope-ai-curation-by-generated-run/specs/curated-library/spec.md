## MODIFIED Requirements

### Requirement: Coverage-based recommendations
The studio SHALL use an operator-selected configured text model to recommend an ordered portfolio containing exactly the operator-selected number of conversations from eligible, non-curated conversations in one or more operator-selected saved runs for the selected set. The selected-run scope SHALL contain only existing runs for that set and SHALL contain at least one run with an eligible candidate. The recommendation SHALL be grounded in the current curated library, complete candidate dialogue and learning material, authoritative deterministic curation evidence, and per-word library exposure. Audio readiness and audio status SHALL NOT be supplied to the model or influence selection because audio can be generated after curation. The curator SHALL prioritize meaningful current-set learning and treat absent and underexposed current-set words as the strongest coverage opportunities while considering naturalness, repetition, comprehension quality, situation variety, and redundancy across both the library and proposed portfolio. The result SHALL identify source conversations and explain each recommendation without automatically changing the curated library.

#### Scenario: Request AI-assisted recommendations from selected runs
- **WHEN** an operator invokes AI curation after selecting one or more generated runs for a set
- **THEN** the system considers every eligible candidate in those selected runs, excludes candidates from unselected runs, and returns an ordered, reviewable portfolio with candidate identities, rationales, strengths, concerns, and vocabulary contributions

#### Scenario: Default to all eligible runs
- **WHEN** the operator opens preflight controls for a set with eligible candidates from saved runs and has not restored another scope
- **THEN** every run containing an eligible candidate is selected so submission preserves the previous all-runs behavior

#### Scenario: Reject an empty or invalid run scope
- **WHEN** the operator submits no selected run, a run belonging to another set, a missing run, or a selection with no eligible candidates
- **THEN** the system rejects the request before invoking the text model and explains how to choose a valid scope

#### Scenario: Select a complementary portfolio
- **WHEN** individually strong candidates substantially duplicate vocabulary, situations, or learning value
- **THEN** the model evaluates their collection-level contribution and may prefer a more complementary candidate instead of preserving an independent numeric ranking

#### Scenario: Focus on the selected set without forcing coverage
- **WHEN** a candidate contains many current-set words but uses them unnaturally or only incidentally
- **THEN** the curator can rank it below a more coherent candidate with fewer but more meaningful current-set exposures and explains the trade-off

#### Scenario: Exclude already curated sources
- **WHEN** a saved conversation in a selected run is already represented in the curated set
- **THEN** the system excludes that source conversation from the candidate snapshot supplied for recommendation

#### Scenario: Select independently of audio readiness
- **WHEN** eligible candidates differ only in whether audio has already been generated
- **THEN** the model receives no audio-readiness information and judges them only from their learning content and deterministic vocabulary evidence

#### Scenario: Enforce exact portfolio size
- **WHEN** the operator requests a portfolio of N conversations from the selected-run candidate scope
- **THEN** the model is instructed to return exactly N unique recommendations and the server rejects a request or response whose size exceeds or differs from the scoped eligible candidate count

#### Scenario: Provider or response failure
- **WHEN** the selected model request fails or returns malformed, fabricated, duplicate, or ineligible candidate identities
- **THEN** the system reports a retryable curation failure and leaves the curated library unchanged

### Requirement: AI curation provenance and freshness
The studio SHALL retain each AI curation review's selected provider and model, selected generated-run identifiers, prompt and raw output, request timing and available statistics, deterministic evidence version, complete scoped candidate accounting, curated-library snapshot, validated recommendations, and status. It SHALL identify a completed review as stale when a relevant candidate within its selected-run scope or the selected curated set changes after the captured snapshot. Candidate changes confined to unselected runs SHALL NOT make the review stale.

#### Scenario: Inspect a completed curation review
- **WHEN** an operator opens a saved AI curation result
- **THEN** the studio exposes its recommendation, model provenance, selected generated runs, captured library context, and scoped candidate accounting needed to understand how it was produced

#### Scenario: Library changes after recommendation
- **WHEN** a conversation is added to or removed from the relevant curated set after a review completes
- **THEN** the studio marks the review stale and prompts the operator to generate an updated recommendation

#### Scenario: Selected candidate changes after recommendation
- **WHEN** a source conversation within a review's selected-run scope is edited, deleted, newly curated, or added after the review completes
- **THEN** the studio marks the review stale and does not present it as a current portfolio assessment

#### Scenario: Unselected run changes after recommendation
- **WHEN** a conversation is added, edited, deleted, or newly curated only in a run outside the review's selected-run scope
- **THEN** the review remains current because that conversation was not eligible for the scoped curation decision

#### Scenario: Candidate audio changes after recommendation
- **WHEN** audio is generated, regenerated, or removed without changing a referenced conversation's learning content
- **THEN** the review remains current because audio readiness was not part of the curation decision

#### Scenario: Retry a failed review
- **WHEN** an AI curation review fails because of provider, parsing, or validation error and its selected runs remain available
- **THEN** the studio preserves failure details for inspection and allows the operator to retry with the same selected-run scope without changing the library

### Requirement: AI curation review history
The studio SHALL retain every persisted AI curation review and expose a newest-first set-scoped history containing its date, model, exact requested size, status, recommendation count, scoped candidate count, selected generated runs, and current freshness. Opening a historical review SHALL display its captured result, audit information, selected-run scope, current freshness, and live recommendation reconciliation without making it the latest review. A completed historical review MAY offer Add All or Add Remaining only after live reconciliation confirms that the actionable recommendations still resolve safely from current persisted state. The operator MAY copy a historical review's model, exact-size setting, and selected-run scope into the preflight controls for a new curation request. A legacy review without explicit selected-run metadata SHALL derive its historical scope from the source runs represented in its captured candidate snapshot.

#### Scenario: Browse saved reviews
- **WHEN** an operator opens curation history for a set
- **THEN** the studio lists every persisted review newest first with enough provenance, selected-run scope, and status information to distinguish reviews

#### Scenario: Open an older review
- **WHEN** the operator selects a review that is not the newest review
- **THEN** the studio renders its captured recommendation, selected-run scope, stale status, and live reconciliation summary without presenting the review as a current portfolio assessment

#### Scenario: Reconcile an actionable historical review
- **WHEN** a completed historical review contains recommendations whose source conversations still exist and whose learning content still matches the review snapshot
- **THEN** the studio identifies recommendations already in Library, recommendations remaining to add, recommendations with existing audio, recommendations needing audio, and stale context within the review's selected scope or Library since the review
- **AND** the studio allows the operator to explicitly continue with Add All or Add Remaining after showing those warnings

#### Scenario: Block an unreconciled historical review
- **WHEN** a historical review is failed, has no recommendations, references a missing source run or conversation, or references source learning content that changed since the review
- **THEN** the studio explains the blocking condition and does not allow Add All, per-conversation Library addition, or audio mutation from that historical snapshot

#### Scenario: Reuse historical settings
- **WHEN** the operator chooses Use Settings on a historical review whose selected runs still exist and contain eligible candidates
- **THEN** the preflight model, exact-size, and selected-run controls adopt that review's settings without starting curation until the operator explicitly submits the form

#### Scenario: Restore unavailable historical selection
- **WHEN** a historical review's selected run has been deleted or no longer belongs to the selected set
- **THEN** the studio identifies the unavailable selection, restores the remaining available settings, and requires the operator to choose a valid scope before starting a new review

#### Scenario: Open a legacy review
- **WHEN** the operator opens a review saved before explicit selected-run scope was persisted
- **THEN** the studio treats the unique source runs in its captured candidates as its historical scope and preserves its existing result and freshness interpretation

### Requirement: Separate deterministic and AI recommendation views
The Queue view SHALL load and display deterministic coverage recommendations by default and SHALL NOT start an AI curation model request or generate a review. The Queue MAY prefetch saved AI curation context in the background to make opening the AI curation view responsive. Invoking AI Curate SHALL navigate to a dedicated set-scoped AI curation view without starting a model request. The AI curation view SHALL display the latest saved review when one exists and SHALL require the operator to select a configured text model, one or more generated runs, and an exact portfolio size before starting a new or replacement review. The run selector SHALL expose each eligible run's identifying provenance and eligible candidate count and SHALL provide select-all and clear actions.

#### Scenario: Open the Queue
- **WHEN** an operator navigates to the Queue for a set
- **THEN** the studio shows deterministic least-covered vocabulary and deterministic candidate ordering and does not start an AI curation model request

#### Scenario: Open AI curation
- **WHEN** the operator invokes AI Curate from the Queue
- **THEN** the studio opens the dedicated AI curation route and shows the saved review or pre-curation controls without automatically beginning a model request

#### Scenario: Inspect and change generated-run scope
- **WHEN** eligible candidates originate from one or more generated runs
- **THEN** the preflight controls show those runs with provenance and eligible counts and let the operator select all, clear all, or independently include each run

#### Scenario: Validate exact portfolio size before curation
- **WHEN** the operator configures a new or replacement AI review
- **THEN** the form requires an integer from 1 through the eligible candidate count derived from the selected runs and prevents submission when the requested size exceeds that scoped count

### Requirement: Efficient curation context loading
The studio SHALL derive AI curation freshness from the curated-library, vocabulary, and candidate state within each review's selected generated-run scope and SHALL reuse previously computed curation evidence when none of those relevant inputs have changed. The studio SHALL prepare a set's all-eligible-runs curation context when its deterministic Queue is opened so that opening AI curation is responsive, and SHALL filter or incrementally compose selected-run snapshots without repeating unchanged deterministic conversation analysis. Freshness and recommendation results SHALL remain authoritative; reuse SHALL NOT serve a result that no longer matches the selected-run scope and current relevant state.

#### Scenario: Reopen a review without relevant input changes
- **WHEN** an operator reopens, refreshes, or switches between saved AI curation reviews whose selected-run candidates, curated-library, and vocabulary inputs are unchanged
- **THEN** the studio reports each review's freshness without recomputing candidate and library evidence from scratch for every request

#### Scenario: Recompute after relevant input changes
- **WHEN** a candidate within the selected-run scope, the curated set, or the allowed vocabulary for a set changes
- **THEN** the next curation context request recomputes or invalidates the affected evidence and freshness from the updated state

#### Scenario: Ignore unselected candidate changes for freshness
- **WHEN** only a candidate outside a review's selected-run scope changes
- **THEN** the studio does not invalidate that review's scoped snapshot or mark it stale

#### Scenario: Prepare curation context from the Queue
- **WHEN** an operator opens the deterministic Queue for a set
- **THEN** the studio prepares reusable AI curation evidence for that set in the background without starting a model request, so opening AI curation can present all eligible runs and counts without unnecessary recomputation
