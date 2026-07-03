## ADDED Requirements

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
