# Content Generation Specification (Delta)

## MODIFIED Requirements

### Requirement: Conversation generation and normalization
The studio SHALL invoke the selected provider, normalize usable conversations from its response, audit their vocabulary deterministically, and pass the audited batch through the generation quality-control flow (evidence-grounded triage, scoped balanced repair with independent candidates, dominance-gated pick, and bounded regeneration with reported shortfall, as defined by the generation-quality-control capability) before persisting accepted conversations as a run. For Set 2 and later, generated batches SHOULD target zero true out-of-allowed content words after deterministic prompt-policy, validated proper-noun, and declared cultural-reference exemptions, but remaining true OOV findings SHALL be treated as auditable quality findings rather than a hard generation failure. Repair MUST NOT resubmit or alter conversations whose triage verdict is `pass`. It SHALL reject a provider response that contains no usable conversations.

#### Scenario: Provider returns usable conversations within vocabulary targets
- **WHEN** a configured provider returns at least one usable generated conversation whose deterministic audit has no true out-of-allowed content findings and whose triage verdict is `pass`
- **THEN** the system normalizes and audits the conversations and saves a run with generation analytics and quality labels

#### Scenario: Provider returns repairable content
- **WHEN** a generated batch contains conversations with true out-of-allowed content words or repairable quality findings
- **THEN** the system sends only the flagged conversations, their audit findings, triage rationales, and allowed-vocabulary constraints for balanced repair
- **AND** re-normalizes and re-audits each repair candidate before picking

#### Scenario: Pick improves a flagged conversation
- **WHEN** a repair candidate for a flagged conversation survives the deterministic gates and is selected by the pick
- **THEN** the system persists the selected candidate for that conversation with its quality label and pick provenance

#### Scenario: Repair does not improve a flagged conversation
- **WHEN** no repair candidate for a flagged conversation is admissible or preferred over the original
- **THEN** the system retains the original conversation for that slot
- **AND** exposes the repair exchanges and remaining findings in generation provenance and analytics

#### Scenario: Passing conversations are never degraded by repair
- **WHEN** repair runs for a batch containing conversations with `pass` verdicts
- **THEN** those conversations are persisted exactly as generated regardless of repair outcomes for other conversations

#### Scenario: Provider returns no usable conversations
- **WHEN** the provider response cannot produce any usable conversation
- **THEN** the system reports a generation failure and does not save an empty successful run

### Requirement: Generation provenance and auditability
The studio SHALL retain the selected provider and model, prompts, outputs, request and response times, available provider statistics, vocabulary analytics, vocabulary quality results, quality triage verdicts and rationales, repair-candidate exchanges, pick outcomes, repair attempts, final text audit reports, and workflow-stage state needed to inspect how a run was produced. Workflow provenance SHALL be recorded at per-call granularity: each model call and each deterministic step is its own audit node with a stable structural identifier, stage membership, ordering, and an output summary, and each model-call node carries exactly one exchange (per the generation-audit-graph capability). When repair occurs, the initial generation exchange and each repair-candidate exchange SHALL remain inspectable in order, per-conversation pick decisions SHALL identify which version was selected and why, and final run analytics SHALL be calculated from the selected final audited conversations rather than from superseded text.

#### Scenario: Inspect a completed generation without repair
- **WHEN** an operator opens the audit information for a generated run that did not need repair
- **THEN** the system exposes its model exchange, vocabulary analytics, vocabulary quality result, and triage verdicts

#### Scenario: Inspect a completed generation with repair
- **WHEN** an operator opens the audit information for a generated run that required repair
- **THEN** the system exposes the initial generation exchange, each repair-candidate exchange, the per-conversation pick decisions, and the final vocabulary analytics used to save the run

#### Scenario: Inspect a completed generation with remaining vocabulary findings
- **WHEN** a generation completes with true out-of-allowed content remaining after the quality-control flow
- **THEN** the durable run exposes the original exchange, repair-candidate exchanges, selected final payload, remaining true out-of-allowed content findings, and pick outcomes needed to adjust the prompt

#### Scenario: Rerun a failed saved repair
- **WHEN** an operator inspects a saved workflow whose latest repair attempt failed or did not improve the audit
- **THEN** the affected repair node (or, for a legacy run, the synthesized node's attempts view) identifies the unresolved repair problem
- **AND** the operator can rerun repair when the run has no unfinished background work and the run retains the required prompt, conversation, and audit data
- **AND** a successful rerun appends the new repair nodes and exchanges, updates the selected final payload, refreshes analytics, and clears stale audio from changed conversations

#### Scenario: Inspect an in-progress workflow
- **WHEN** an asynchronous workflow is running
- **THEN** the system reports the pending, processing, completed, failed, or skipped state of each per-call workflow node as calls start and finish, not only at stage completion

### Requirement: Balanced generation workflow
The studio SHALL support a workflow that assigns two thirds of the requested total, rounded up, to a primary batch and assigns the remainder to a complementary balancing batch. It SHALL calculate vocabulary-distribution needs between batches and optionally generate audio for a requested subset. Fixed audio mode SHALL accept zero through five audio targets, while maximum audio mode SHALL target the requested conversation total. After both text stages, the workflow SHALL compute the final text audit before any audio work: when no warning threshold trips, audio SHALL proceed automatically; when a warning threshold trips, the job SHALL pause for operator review with the audit report, and resuming SHALL proceed to audio. Dropped conversations SHALL reduce the combined run's conversation count rather than being backfilled across stages, and the audit SHALL report accepted versus requested totals. The workflow SHALL preserve a combined run, durable stage checkpoints, and stage-level audit record. It SHALL expose the run immediately, continue through browser refresh, and permit manual resume from the first incomplete stage after interruption.

#### Scenario: Generate with balancing
- **WHEN** an operator starts a workflow for a requested total conversation count
- **THEN** the system generates the primary and balancing portions through the quality-control flow, combines and renumbers their accepted conversations, and records distribution analytics

#### Scenario: Start workflow asynchronously
- **WHEN** an operator starts the background workflow
- **THEN** the system immediately persists and returns a trackable run job before the primary provider call and makes its evolving status available until completion, failure, or interruption

#### Scenario: Persist the primary checkpoint
- **WHEN** primary generation completes successfully
- **THEN** the system persists its exchange and normalized conversations before beginning balancing

#### Scenario: Resume after balancing was interrupted
- **WHEN** the primary checkpoint exists and the operator resumes an interruption in the balancing stage
- **THEN** the system reuses the primary checkpoint and does not repeat primary generation

#### Scenario: Clean audit proceeds to audio
- **WHEN** both text stages complete and the final text audit trips no warning threshold
- **THEN** the workflow proceeds to its audio stage automatically

#### Scenario: Audit warning pauses before audio
- **WHEN** the final text audit trips a warning threshold such as excessive shortfall
- **THEN** the job pauses before any audio work with a stage label directing the operator to the audit report
- **AND** resuming the job proceeds to audio while discarding cancels the workflow

#### Scenario: Report live workflow progress
- **WHEN** any per-call node in the generation, balance, final-audit, or audio stages changes state
- **THEN** the Studio updates the run stage, node states, and audio count through the shared realtime job channel
