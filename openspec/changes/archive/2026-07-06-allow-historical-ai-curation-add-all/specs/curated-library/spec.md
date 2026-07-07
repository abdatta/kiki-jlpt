## MODIFIED Requirements

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
