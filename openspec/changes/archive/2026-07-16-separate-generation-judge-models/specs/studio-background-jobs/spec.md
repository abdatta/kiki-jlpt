## ADDED Requirements

### Requirement: Durable historical quality-label jobs
The Studio SHALL create an idempotent durable background job before historical quality labeling invokes a judge provider. The job SHALL persist its scope, selected judge, rejudge mode, checkpoints, processed/skipped/remaining counts, failures, and terminal result; it SHALL support pause, resume, discard, restart recovery, and realtime progress using the Studio job lifecycle.

#### Scenario: Resume an interrupted label job
- **WHEN** the API restarts or an operator pauses a historical label job after completed batches
- **THEN** resuming retains completed labels and continues only unresolved conversations

#### Scenario: Idempotent label-job start
- **WHEN** the client repeats a historical labeling start with the same idempotency key
- **THEN** the system returns the existing job and does not submit duplicate judge batches

### Requirement: Serialized historical judge work
Historical quality-label jobs SHALL use the shared serialized text-work queue and SHALL not run concurrently with an active text-generation job.

#### Scenario: Queue labeling behind generation
- **WHEN** an operator starts historical quality labeling while a generation job holds the text-work slot
- **THEN** the label job persists as queued and starts only after the earlier text work releases the slot
