## MODIFIED Requirements

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
- **THEN** the studio refreshes the recommended source conversations, treats each persisted audio file as completed audio, and opens a portfolio progress modal without issuing any speech-generation or Library-add requests
- **AND** the modal requires an explicit operator action to generate only missing recommendation audio, or to begin adding when the complete portfolio is already audio-ready
- **AND** the studio shows the same per-conversation audio statuses, completed count, active-work visibility, and completed, failed, or stopped stage language used by LLM Audit bulk audio before showing per-conversation Library progress

#### Scenario: AI curation does not start audio
- **WHEN** an operator starts or repeats AI curation with AI Curate or Re-curate
- **THEN** the studio may generate the text-only recommendation review but does not issue speech-generation requests

#### Scenario: Start Add All audio explicitly
- **WHEN** the Add All modal has reconciled a portfolio with missing audio and the operator chooses Start generation
- **THEN** the studio starts at most three missing recommendation audio requests concurrently and changes the modal control to Pause

#### Scenario: Pause Add All audio gracefully
- **WHEN** the operator chooses Pause while Add All audio generation is active
- **THEN** the modal shows Pausing, the studio starts no additional audio requests, and already-started requests are allowed to succeed or fail before the workflow becomes paused

#### Scenario: Resume paused Add All audio
- **WHEN** the Add All workflow is paused and the operator chooses Resume
- **THEN** the studio refreshes persisted source state, preserves completed audio, and resumes only conversations that still lack audio

#### Scenario: Add All encounters existing audio
- **WHEN** one or more recommended conversations already have persisted audio files when Add All starts or retries
- **THEN** the studio preserves those files, marks those conversations audio-complete, and does not issue speech-generation requests for them

#### Scenario: Add All audio generation fails
- **WHEN** a recommended conversation fails audio generation during Add All
- **THEN** the studio stops starting additional audio work, allows already-started audio requests to settle, preserves every successful audio file, marks the failed and unstarted conversations distinctly, and does not begin the Library-add phase

#### Scenario: Retry an incomplete Add All workflow
- **WHEN** the operator retries Add All after an audio or Library failure
- **THEN** the studio rechecks current persisted source and Library state, skips completed audio and existing Library additions, and resumes only unresolved work

#### Scenario: Add All source is no longer available
- **WHEN** a recommended source run or conversation cannot be resolved from current persisted state
- **THEN** the studio identifies the affected recommendation, performs no Library additions, and leaves the workflow retryable
