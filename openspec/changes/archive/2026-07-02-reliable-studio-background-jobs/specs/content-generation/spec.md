## ADDED Requirements

### Requirement: Durable generation entrypoints
Every Studio entrypoint that creates a generated run, including standard generation and library-complement generation, SHALL create a durable job-backed run shell before invoking a text provider. The shell SHALL retain the requested set, model, count, operation kind, status, and failure information until the run completes or the operator deletes it.

#### Scenario: Start standard generation
- **WHEN** the operator submits standard text generation
- **THEN** an in-progress run appears immediately and remains discoverable after browser refresh

#### Scenario: Start library-complement generation
- **WHEN** the operator submits a library-complement generation request
- **THEN** a durable run shell records the operation before the complementary text provider call begins

#### Scenario: Text generation fails before conversations exist
- **WHEN** a text provider fails before a run can contain conversations
- **THEN** the run shell remains visible with failure and retry information rather than disappearing

## MODIFIED Requirements

### Requirement: Balanced generation workflow
The studio SHALL support a workflow that assigns two thirds of the requested total, rounded up, to a primary batch and assigns the remainder to a complementary balancing batch. It SHALL calculate vocabulary-distribution needs between batches and optionally generate audio for a requested subset. Fixed audio mode SHALL accept zero through five audio targets, while maximum audio mode SHALL target the requested conversation total. The workflow SHALL preserve a combined run, durable stage checkpoints, and stage-level audit record. It SHALL expose the run immediately, continue through browser refresh, and permit manual resume from the first incomplete stage after interruption.

#### Scenario: Generate with balancing
- **WHEN** an operator starts a workflow for a requested total conversation count
- **THEN** the system generates the primary and balancing portions, combines and renumbers their conversations, and records distribution analytics

#### Scenario: Start workflow asynchronously
- **WHEN** an operator starts the background workflow
- **THEN** the system immediately persists and returns a trackable run job before the primary provider call and makes its evolving status available until completion, failure, or interruption

#### Scenario: Persist the primary checkpoint
- **WHEN** primary generation completes successfully
- **THEN** the system persists its exchange and normalized conversations before beginning balancing

#### Scenario: Resume after balancing was interrupted
- **WHEN** the primary checkpoint exists and the operator resumes an interruption in the balancing stage
- **THEN** the system reuses the primary checkpoint and does not repeat primary generation

#### Scenario: Report live workflow progress
- **WHEN** generator, balancer, or audio stages change state
- **THEN** the Studio updates the run stage and audio count through the shared realtime job channel

### Requirement: Individual audio generation recovery
The studio SHALL allow audio to be generated or regenerated for an eligible individual conversation through the shared durable audio scheduler and SHALL persist queued, active, success, failure, or interruption state. A request for a conversation that already has queued or running audio SHALL attach to that work without another provider call. A failed or interrupted request SHALL retain an actionable error and allow a later retry.

#### Scenario: Audio generation succeeds
- **WHEN** the speech provider successfully generates audio for an eligible conversation
- **THEN** the system atomically stores the audio reference and marks the conversation audio-ready

#### Scenario: Audio generation fails
- **WHEN** the speech provider fails to generate audio
- **THEN** the system marks the conversation audio-failed, records the error, and publishes the updated run and job state

#### Scenario: Duplicate audio request
- **WHEN** audio is requested again for a conversation whose audio job is queued or running
- **THEN** the request returns the existing job and does not invoke the speech provider again

#### Scenario: Refresh during individual audio
- **WHEN** the browser refreshes while individual audio is active
- **THEN** generation continues on the server and the reloaded Studio recovers its live state

### Requirement: Batch audio generation recovery
The studio SHALL support replacing all run audio or resuming only missing audio through the shared durable audio scheduler. Resume mode SHALL preserve existing completed audio. Batch processing SHALL run at most three speech calls globally, persist each successful call as it completes, identify failures, and mark work not started after a stopping failure as skipped rather than falsely complete. Browser refresh SHALL not stop the batch, and an interrupted batch SHALL be manually resumable from persisted file readiness.

#### Scenario: Resume missing audio
- **WHEN** an operator resumes audio generation for a partially voiced run
- **THEN** the system targets only conversations without audio and retains existing audio

#### Scenario: Batch audio call fails
- **WHEN** an audio request fails during a batch configured to stop starting new work
- **THEN** the system preserves prior successes, records the failed conversation, skips unstarted targets in that batch, and reports a partial failure

#### Scenario: Refresh during batch audio
- **WHEN** the browser refreshes while a batch has running or queued audio
- **THEN** the server continues scheduling the batch and the Studio rehydrates its current counts and row statuses

#### Scenario: Resume an interrupted batch
- **WHEN** the operator resumes a batch interrupted by an API restart
- **THEN** the system reconciles persisted files and schedules only unresolved conversations
