# Generation Audit Graph Specification (Delta)

## ADDED Requirements

### Requirement: One audit node per call and per deterministic step
The studio SHALL record and present the generation pipeline as a flow graph in which every model call — generation, quality triage, each repair candidate, pick tie-break, re-roll, and each audio call — is its own audit node, and every deterministic step — vocabulary audit, dominance gates, final audit — is its own audit node. A model call MUST NOT be presented as an entry nested inside another node's output. Nodes SHALL be grouped by stage (initial, balance) with the re-roll sub-flow presented as a distinct second pass inside its stage, the two repair candidates presented as parallel siblings, and node identifiers SHALL be stable structural identifiers minted by the server, independent of exchange timestamps. Model-call nodes and deterministic-step nodes SHALL be visually distinct, with model name and call duration shown only on model-call nodes.

#### Scenario: Repair candidates are first-class parallel nodes
- **WHEN** an operator views the audit graph for a run whose flagged conversations were repaired
- **THEN** repair candidate 1 and repair candidate 2 appear as two separate sibling nodes between triage and the gates
- **AND** neither is nested inside a stage or generation node

#### Scenario: Deterministic steps are distinguishable at a glance
- **WHEN** an operator views a stage lane
- **THEN** the vocabulary audit, dominance gates, and final audit render as machine-step nodes without a model name or model-call styling
- **AND** model-call nodes show which model ran and how long the call took

#### Scenario: Pipeline shape stays constant
- **WHEN** a run needed no repairs, no tie-break, or no re-roll
- **THEN** the unneeded steps render as skipped nodes with an explanatory summary rather than being removed
- **AND** the flowchart shape remains recognizably the same across runs

### Requirement: Node output summaries with per-kind deep dives
Every audit node SHALL display a one-line summary of its output appropriate to its kind (for example: generation counts and vocabulary findings; triage pass/repair/regenerate tallies; repair candidate out-of-vocabulary deltas; gate eliminations and coverage-loss flags; pick wins by version and quality tallies; re-roll replacements and permanent drops; final-audit accepted-versus-requested, coverage, and threshold outcome; audio duration). Each stage SHALL display a rollup summary of its outcome. Selecting a node SHALL open a deep-dive inspector for exactly that node containing its full evidence: the call's prompt and settings, raw response and metadata for model calls, and kind-appropriate per-conversation detail tables — triage verdicts with rationales, repair before/after differences against the original, gate elimination evidence, pick decisions with the chosen version, decided-by source, quality, confidence, flags, and comparison views, and the complete final-audit report with per-threshold outcomes. Every node and every conversation trace SHALL be addressable by a deep link within the run's audit route.

#### Scenario: Read the pipeline from summaries alone
- **WHEN** an operator scans the audit graph without selecting anything
- **THEN** each completed node shows its one-line output summary and each stage shows its rollup, sufficient to understand what happened at every step

#### Scenario: Deep dive into a pick decision
- **WHEN** an operator selects the pick node
- **THEN** the inspector lists every picked conversation with the chosen version, whether gates or the tie-break decided it, quality, confidence, flags, and rationale
- **AND** each row can expand to compare the original and candidate versions

#### Scenario: Deep link to a node
- **WHEN** an operator opens a URL addressing a specific audit node
- **THEN** the audit view opens with that node selected and its inspector visible

### Requirement: Conversation trace mode
The studio SHALL provide a conversation-level trace through the audit graph. A conversation rail SHALL list every conversation the run produced or dropped, with its quality label and journey markers. Selecting a conversation SHALL annotate the graph with that conversation's per-node facts, de-emphasize nodes that did not touch it, and present a journey view of its history across the pipeline — including verdicts, version-to-version differences from generation through repair and pick, drop rationale when dropped, and its audio outcome. Dropped conversations SHALL remain traceable with their full evidence even though they are absent from the run's accepted conversations.

#### Scenario: Trace a repaired conversation
- **WHEN** an operator selects a conversation that was flagged, repaired, and picked
- **THEN** the triage, repair, gate, and pick nodes show that conversation's specific outcomes
- **AND** the journey view shows the transcript differences between its generated, repaired, and picked versions with the pick reasoning

#### Scenario: Trace a dropped conversation
- **WHEN** an operator selects a conversation that was dropped after regeneration
- **THEN** its journey ends at an explicit dropped step with the verdict rationale
- **AND** its evidence remains inspectable

#### Scenario: Enter a trace from a run conversation
- **WHEN** an operator activates the quality label on a run conversation row
- **THEN** the audit view opens in trace mode for that conversation

### Requirement: Live per-call progress
During a running workflow, the studio SHALL present each pipeline step's node as it starts and completes, over the existing realtime job channel. A stage's fixed steps SHALL be visible as pending nodes as soon as the stage begins. Node summaries SHALL be available live without waiting for the stage to finish. A call that failed but was recovered by a fallback SHALL present in a degraded-warning state distinct from the failure state reserved for errors that stop the run; when a run-stopping failure occurs, downstream nodes SHALL present as skipped. The default inspector selection SHALL follow the processing node during a live run, show the final audit for a completed run, and show the first failed node for a failed run.

#### Scenario: Watch a stage progress call by call
- **WHEN** a workflow stage is running
- **THEN** the operator sees the currently processing node animate, completed nodes show their summaries, and upcoming steps remain visible as pending

#### Scenario: Fallback presents as degraded, not failed
- **WHEN** the triage call fails and the deterministic fallback is applied
- **THEN** the triage node presents in the degraded-warning state with a summary naming the fallback
- **AND** the run continues without the failure state

### Requirement: Paused-for-review presentation
When the final audit pauses the workflow, the final-audit node SHALL present the review inline: the tripped and met thresholds with their measured values, the shortfall and drop summary, and the available actions — approve to proceed to audio, or discard the run — with the full report one selection away. The audio stage SHALL be visibly waiting on the review, and the paused state SHALL be discoverable from the studio's background-job presentation.

#### Scenario: Review a paused run
- **WHEN** the final audit trips a threshold and the job pauses
- **THEN** the final-audit node shows which thresholds tripped with measured versus limit values and offers approve and discard actions
- **AND** the audio stage indicates it is awaiting review

### Requirement: Legacy run rendering
Runs recorded before per-call auditing SHALL render through the same audit view as a reduced graph synthesized from their stored exchanges, clearly marked as recorded before per-call auditing. The studio MUST NOT invent triage, gate, or pick nodes for legacy runs, and legacy node data SHALL NOT be rewritten.

#### Scenario: Open a legacy run's audit
- **WHEN** an operator opens the audit view for a run recorded under the previous three-node model
- **THEN** the view renders its generation, balance, repair, and audio information from stored exchanges with a notice identifying it as a pre-quality-control recording
- **AND** no quality-control steps are fabricated
