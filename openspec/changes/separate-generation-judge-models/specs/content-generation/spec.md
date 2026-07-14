## MODIFIED Requirements

### Requirement: Provider-grouped model selection
Studio text-model pickers SHALL present model options grouped under provider headings, ordered Gemini, GPT, Claude, with each option listed inside its provider's group. The generation modal SHALL present separate Generator model and Judge model pickers using those grouped options. The Judge model SHALL default to GPT-5.6-Sol (`codex:gpt-5.6-sol`) and an operator MAY select a different available model. A historical run whose generator or judge model is absent from the current option list SHALL remain selectable or displayable inside its provider's group.

#### Scenario: Grouped generator and judge pickers
- **WHEN** the operator opens the generation modal
- **THEN** both model pickers show options under Gemini, GPT, and Claude group headings in that order
- **AND** the Judge model defaults to GPT-5.6-Sol

#### Scenario: Historical model stays selectable
- **WHEN** the operator views a run generated or judged with a model no longer offered
- **THEN** that model appears selectable or displayable within its provider's group

### Requirement: Validated generation requests
The studio SHALL require a positive vocabulary set containing vocabulary, resolvable generator and judge models, successful role-appropriate model probes, and an integer conversation count within the supported mode's range before generation. Standard generation SHALL accept 4 through 30 conversations; workflow generation SHALL accept 6 through 30 total conversations. Generated conversation vocabulary SHALL be constrained and audited against the vocabulary allowed through the selected set. The start endpoint SHALL resolve both selected models again and SHALL reject an invalid request without creating a run.

#### Scenario: Valid generation request
- **WHEN** an operator selects a valid set, an in-range conversation count, and available generator and judge models whose probes succeeded
- **THEN** the system prepares generation using vocabulary allowed through that set

#### Scenario: Probe blocks a start
- **WHEN** either the generator or judge probe fails because of authentication, usage limits, model availability, or invalid structured output
- **THEN** the Studio identifies the failing role with actionable feedback and does not create a generation job

#### Scenario: Invalid generation request
- **WHEN** the set, count, generator model, or judge model is invalid at start time
- **THEN** the system rejects the request with a descriptive validation error and does not create a run

### Requirement: Generation provenance and auditability
The studio SHALL retain the selected generator and judge provider/model identities, prompts, outputs, request and response times, available provider statistics, vocabulary analytics, vocabulary quality results, quality triage verdicts and rationales, repair-candidate exchanges, pick outcomes, repair attempts, final text audit reports, and workflow-stage state needed to inspect how a run was produced. A provider-resolved model version SHALL be retained on the associated role and exchange when supplied. Workflow provenance SHALL be recorded at per-call granularity: each model call and each deterministic step is its own audit node with a stable structural identifier, stage membership, ordering, and an output summary, and each model-call node carries exactly one exchange (per the generation-audit-graph capability). When repair occurs, the initial generation exchange and each repair-candidate exchange SHALL remain inspectable in order, per-conversation pick decisions SHALL identify which version was selected and why, and final run analytics SHALL be calculated from the selected final audited conversations rather than from superseded text.

#### Scenario: Inspect a completed generation without repair
- **WHEN** an operator opens the audit information for a generated run that did not need repair
- **THEN** the system exposes the generator and judge identities, their role-specific exchanges, vocabulary analytics, vocabulary quality result, and triage verdicts

#### Scenario: Inspect a completed generation with repair
- **WHEN** an operator opens the audit information for a generated run that required repair
- **THEN** the system exposes the initial generation exchange, each generator-backed repair-candidate exchange, each judge-backed quality exchange, the per-conversation pick decisions, and the final vocabulary analytics used to save the run

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

## ADDED Requirements

### Requirement: Role-appropriate model preflight
Before accepting a new standard or workflow generation start, the Studio SHALL perform a disposable generator probe using the normal structured conversation-generation invocation path and a disposable judge probe using the normal structured quality-judgment invocation path. Each probe SHALL validate a minimal response for its role and SHALL persist no run, conversation, exchange, audit node, or background job. The Studio SHALL present per-role progress and results.

#### Scenario: Both role probes succeed
- **WHEN** the selected generator and judge each produce valid minimal responses through their role-specific invocation paths
- **THEN** the Studio enables the operator to start the requested generation

#### Scenario: Identical model selected for both roles
- **WHEN** an operator selects the same model as generator and judge
- **THEN** the Studio runs and reports both role-specific probes before enabling start
