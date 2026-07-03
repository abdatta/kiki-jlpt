# Studio Background Jobs Specification

## Purpose

Defines the durable Studio background-job system: job capture and idempotency, persistent lifecycle and restart recovery, realtime synchronization, background-work presentation, serialized text generation, bounded audio scheduling, atomic persistence, and Practice isolation.

## Requirements

### Requirement: Durable Studio job capture
The Studio SHALL persist a background job and its operator-supplied idempotency key before starting any external generation or speech request. A repeated start request with the same idempotency key SHALL return the original job and SHALL NOT repeat provider work.

#### Scenario: Start durable work
- **WHEN** an operator starts a supported generation or audio operation
- **THEN** the system persists a trackable job before invoking an external provider

#### Scenario: Retry a start with a lost response
- **WHEN** the client repeats a start request using an idempotency key that already identifies a job
- **THEN** the system returns that job without creating another job or provider call

### Requirement: Persistent lifecycle and restart recovery
The Studio SHALL persist job status, stages, progress, results, errors, and revision after each durable transition. On API startup it SHALL mark work that had been running as interrupted and SHALL require explicit operator action before resuming it.

#### Scenario: Refresh during active work
- **WHEN** the browser refreshes or navigates while a job is queued or running
- **THEN** the server continues the job and the reloaded Studio recovers its current state

#### Scenario: Restart the API during active work
- **WHEN** the API process starts with a persisted job whose last status was running or pausing
- **THEN** the system marks the job and active stage interrupted without automatically invoking a provider

#### Scenario: Resume interrupted work
- **WHEN** the operator resumes an interrupted job
- **THEN** the system preserves completed checkpoints and restarts only unresolved or interrupted work

#### Scenario: Discard remaining work
- **WHEN** the operator discards a paused, interrupted, or failed audio parent job
- **THEN** the system marks the parent and its unresolved exclusive children cancelled, keeps completed audio, releases the run for deletion, and rejects later resume attempts for that job

### Requirement: Job lifecycle integrity
Studio job status changes SHALL follow a declared transition table in which terminal statuses (succeeded, failed, cancelled) are final and pausing may settle only to paused, back to running, or to a terminal status. A write that would perform an illegal transition SHALL be ignored, leaving the persisted job unchanged, and SHALL be observable in server diagnostics.

#### Scenario: Late runner write after discard
- **WHEN** a runner whose provider call was already dispatched writes status or progress after the operator discarded the job
- **THEN** the persisted job remains cancelled with its discard label and no revised revision is broadcast for the ignored write

#### Scenario: Stale write against a paused job
- **WHEN** an asynchronous writer attempts to mark a paused job running without an operator resume
- **THEN** the job remains paused and the attempted transition is recorded in server diagnostics

### Requirement: Derived progress labels
Job progress labels SHALL be derived from persisted status and progress counts by a single derivation rule, so that a status change can never discard completed-versus-total information.

#### Scenario: Pause a batch mid-progress
- **WHEN** an audio batch with completed work is paused, interrupted, or discarded
- **THEN** its label still reports the completed-versus-total count alongside the state

#### Scenario: Two writers race on one job
- **WHEN** a status writer and a progress writer update the same job in either order
- **THEN** the resulting label reflects both the final status and the latest counts

### Requirement: Realtime Studio synchronization
The Studio SHALL expose an initial snapshot of run summaries and relevant jobs and SHALL publish subsequent changes through a Studio-only server-sent event stream. Events SHALL identify the changed entity and revision so clients can ignore duplicates or stale updates.

#### Scenario: Connect a Studio tab
- **WHEN** a Studio tab loads
- **THEN** it hydrates durable state before applying live server-sent updates

#### Scenario: Reconnect after a stream interruption
- **WHEN** the realtime stream disconnects and reconnects
- **THEN** the Studio refreshes its snapshot and converges to current persisted state even if events were missed

#### Scenario: Observe work in multiple tabs
- **WHEN** multiple Studio tabs are open while a job changes state
- **THEN** every connected tab updates to the same persisted status without starting duplicate work

### Requirement: Background work presentation
The Studio SHALL show active job-backed run shells in the Runs list immediately, display their current stage and progress, and present a persistent background-work summary across Studio routes. It SHALL notify the operator when work succeeds, fails, or becomes interrupted.

#### Scenario: Show a newly started run
- **WHEN** a generation start has been durably accepted but no conversations exist yet
- **THEN** the Runs list shows an in-progress entry with a spinning status icon and current stage label

#### Scenario: Show audio progress
- **WHEN** a run has generated some but not all requested audio
- **THEN** the Runs list and background summary show a live completed-versus-requested count

#### Scenario: Complete work away from its page
- **WHEN** a job reaches a terminal state while the operator is on another Studio route
- **THEN** the persistent summary updates and the Studio shows one deduplicated completion, failure, or interruption toast

#### Scenario: Reopen the originating work UI
- **WHEN** the operator clicks a background-work entry
- **THEN** the Studio navigates to and restores the view that originally presented that job, such as the run detail page, the live pipeline audit, or the Add All progress dialog

#### Scenario: Show per-job state in the background summary
- **WHEN** background work is displayed in the persistent summary
- **THEN** each entry indicates its own running, paused, or interrupted state and shows a determinate progress bar when completed-versus-total counts exist, or an indeterminate activity bar while active work lacks measurable progress

### Requirement: Serialized text generation
The Studio SHALL run at most one LLM text-generation job (run generation, workflow generation, or library complement) at a time. Later starts SHALL wait durably in first-in-first-out order, and the operator SHALL be able to pause or discard a waiting or running generation job so a later one can take the slot; a discarded job's already-dispatched provider response is ignored rather than persisted.

#### Scenario: Start a second generation while one is running
- **WHEN** a generation job is started while another holds the generation slot
- **THEN** the new job is durably queued with a waiting label and starts only after the earlier job reaches a terminal, paused, or discarded state

#### Scenario: Prioritize the latest generation
- **WHEN** the operator pauses or discards the slot-holding generation job
- **THEN** the runner stops at its next durable checkpoint, the slot is released, and the next queued generation starts

### Requirement: Convergent batch starts
Audio batch starts SHALL create children through the same reconciliation routine used by resume, so a start whose child creation is interrupted partway SHALL be repaired by a subsequent start retry or resume without duplicate provider work.

#### Scenario: Child creation fails partway through a start
- **WHEN** an audio batch start persists its parent but fails before creating all requested children
- **THEN** a later resume or idempotent start retry creates exactly the missing children, reuses existing audio, and the batch converges to a terminal state

### Requirement: Consistent operator notification policy
The Studio SHALL decide whether a job event notifies the operator using one policy, applied identically to live realtime events and to terminal transitions discovered during reload hydration.

#### Scenario: Batch children reach terminal states after a reload
- **WHEN** the Studio reloads after child jobs of a batch reached terminal states
- **THEN** the operator sees at most one notification for the parent batch and none for its children, exactly as they would have live

### Requirement: Shared bounded audio scheduling
The Studio SHALL route every speech-generation path through one server scheduler with at most three provider calls active globally. It SHALL deduplicate queued or running work by source run and conversation and SHALL preserve parent-operation pause and stop-on-failure boundaries.

#### Scenario: Request the same conversation twice
- **WHEN** the same conversation is requested from repeated clicks, different tabs, or different Studio workflows while its audio job is active
- **THEN** all callers observe the existing job and exactly one new provider call is started

#### Scenario: Request different conversations
- **WHEN** more than three different conversations require audio
- **THEN** at most three provider calls run and the remaining jobs are visibly queued

#### Scenario: One parent operation fails
- **WHEN** a child audio job fails in a parent configured to stop on failure
- **THEN** that parent starts no additional children while unrelated parent operations remain eligible to run

### Requirement: Consistent and atomic Studio persistence
The Studio SHALL serialize mutations to the same run, apply each mutation to the latest persisted state, and replace run, job, and completed audio files atomically. Conflicting mutations SHALL be rejected using active job state rather than relying only on a conversation status label.

#### Scenario: Complete concurrent audio jobs in one run
- **WHEN** different conversation audio jobs finish concurrently for the same run
- **THEN** every successful result remains represented in the final run without lost updates

#### Scenario: Replace existing audio
- **WHEN** regenerated audio succeeds
- **THEN** the system atomically replaces the previous final file only after the new output is complete

#### Scenario: Mutate a conversation with active audio
- **WHEN** an operator attempts to edit, delete, regenerate, or curate a conversation in a way that conflicts with an active audio job
- **THEN** the server rejects the conflicting mutation with an actionable response

### Requirement: Practice application isolation
Background jobs, realtime connections, and Studio notifications SHALL be confined to the Studio application. The Practice application SHALL continue to use static published assets without requiring the Studio API.

#### Scenario: Load Practice
- **WHEN** a learner opens the Practice application
- **THEN** no Studio job snapshot or realtime connection is required
