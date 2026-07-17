# Generation Audit Graph Specification

## Purpose

Defines the Studio's per-call generation flow graph, node summaries and inspectors, conversation tracing, live progress, review pauses, and legacy-run compatibility.

## Requirements

### Requirement: One audit node per call and per deterministic step
The studio SHALL record and present the generation pipeline as a flow graph in which every model call that actually runs—generation, quality triage, each repair candidate, pick tie-break, re-roll, and each audio call—is its own audit node, and every deterministic step—vocabulary audit, dominance gates, and final text audit—is its own audit node. New generations MUST NOT create a final-dialogue-label node when accepted labels are reused from triage, pick, gate, or fallback outcomes. A model call MUST NOT be presented as an entry nested inside another node's output. Nodes SHALL be grouped by stage (initial, balance) with the re-roll sub-flow presented as a distinct second pass inside its stage, the two repair candidates presented as parallel siblings, and node identifiers SHALL be stable structural identifiers minted by the server, independent of exchange timestamps. Within each stage, nodes SHALL be presented in actual execution order. The run-level deterministic final text audit SHALL appear after both text stages and immediately before the audio stage. Model-call nodes and deterministic-step nodes SHALL be visually distinct, with model name and call duration shown only on model-call nodes.

#### Scenario: Repair candidates are first-class parallel nodes
- **WHEN** an operator views the audit graph for a run whose flagged conversations were repaired
- **THEN** repair candidate 1 and repair candidate 2 appear as two separate sibling nodes between triage and the gates
- **AND** neither is nested inside a stage or generation node

#### Scenario: Re-roll and stage completion use execution order
- **WHEN** a stage performs or skips its re-roll sub-flow
- **THEN** the stage presents pass 1 followed by pass 2
- **AND** any compatibility-only final-label node stored on an older run appears after both passes rather than between triage and repair

#### Scenario: Final text audit is the terminal text step
- **WHEN** both generation stages complete
- **THEN** the deterministic final text audit appears after the balance stage and before audio
- **AND** a newly generated run has no separate final-dialogue-label node

#### Scenario: Deterministic steps are distinguishable at a glance
- **WHEN** an operator views a stage lane
- **THEN** vocabulary audit and dominance gates render as machine-step nodes without a model name or model-call styling
- **AND** the run-level final text audit renders as the terminal machine step before audio
- **AND** model-call nodes show which model ran and how long the call took

#### Scenario: Pipeline shape stays constant
- **WHEN** a run needed no repairs, no tie-break, or no re-roll
- **THEN** the unneeded quality-control steps render as skipped nodes rather than being removed—presented compactly, and collapsed into an expandable summary row when an entire pass was skipped—with their explanatory summaries available on expansion or inspection
- **AND** the flowchart shape remains recognizably the same across runs without inventing a relabel call that did not run

#### Scenario: Flow adapts to the available width
- **WHEN** the audit graph is shown at different viewport widths
- **THEN** each stage lays its nodes out as a snake that wraps to as many nodes per row as the width allows, with alternate rows reversed so the flow turns down and doubles back rather than jumping to the left edge
- **AND** below a minimum node width the stage scrolls horizontally instead of shrinking the nodes further

### Requirement: Node output summaries with per-kind deep dives
Every audit node SHALL display a compact summary of its output appropriate to its kind—a single stat line for most nodes, and a short per-version stat stack for the version-comparing nodes (dominance gates: eliminations and coverage losses per repair candidate; version pick: picks and quality tallies for the original and each repair candidate). Examples of kind-appropriate content: generation counts and vocabulary findings; triage pass/repair/regenerate tallies; repair candidate out-of-vocabulary deltas; re-roll replacements and permanent drops; final-audit accepted-versus-requested, coverage, and threshold outcome; audio duration. Stacked summaries SHALL fit within the node footprint the single-line layout establishes rather than enlarging the node. Each stage SHALL display a rollup summary of its outcome. Selecting a node SHALL open a deep-dive inspector, presented as a transient modal dialog dismissible by close button, backdrop, or Escape, for exactly that node containing its full evidence: the call's prompt and settings, raw response and metadata for model calls, and kind-appropriate per-conversation detail tables—triage verdicts with rationales, repair before/after differences against the original, gate elimination evidence, pick decisions with the chosen version, decided-by source, quality, confidence, flags, and comparison views, and the complete final-audit report with per-threshold outcomes. The per-node inspector is transient and SHALL NOT be URL-addressable; each conversation trace SHALL be addressable by a deep link within the run's audit route.

#### Scenario: Read the pipeline from summaries alone
- **WHEN** an operator scans the audit graph without selecting anything
- **THEN** each completed node shows its output summary (single line or per-version stack) and each stage shows its rollup, sufficient to understand what happened at every step

#### Scenario: Deep dive into a pick decision
- **WHEN** an operator selects the pick node
- **THEN** the inspector lists every picked conversation with the chosen version, whether gates or the tie-break decided it, quality, confidence, flags, and rationale
- **AND** each row can expand to compare the original and candidate versions

#### Scenario: Deep link to a conversation trace
- **WHEN** an operator opens a URL addressing a specific conversation trace
- **THEN** the audit view opens in trace mode for that conversation
- **AND** the per-node inspector remains closed until a node is selected

### Requirement: Conversation trace mode
The studio SHALL provide a conversation-level trace through the audit graph. A conversation selector, accompanied by a short explanation of what tracing reveals, SHALL list every conversation the run produced or dropped with its quality label and journey markers. Selecting a conversation SHALL annotate the graph with that conversation's per-node facts, de-emphasize nodes that did not touch it, and present a journey view of its history across the pipeline—including verdicts, version-to-version differences from generation through repair and pick, drop rationale when dropped, and its audio outcome. Dropped conversations SHALL remain traceable with their full evidence even though they are absent from the run's accepted conversations.

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
During a running workflow, the studio SHALL present each pipeline step's node as it starts and completes, over the existing realtime job channel. A stage's fixed steps SHALL be visible as pending nodes as soon as the stage begins. Node summaries SHALL be available live without waiting for the stage to finish. Steps that the pipeline dispatches concurrently—specifically the two repair candidates—MAY be in the processing state at the same time. Each such node SHALL transition from processing to its own terminal state as soon as its own call settles, so the first call to finish stops animating and records its own duration while the slower call's node keeps animating until its own call settles. A node's recorded completion time SHALL be established when its own call settles and SHALL NOT be reset by later output enrichment (such as attaching the pick outcome), so each concurrent sibling reflects its own real duration rather than a shared time. Each concurrent step SHALL still be announced as processing before any of them completes, preserving stable per-node identity and sibling order. A call that failed but was recovered by a fallback SHALL present in a degraded-warning state distinct from the failure state reserved for errors that stop the run; when a run-stopping failure occurs, downstream nodes SHALL present as skipped. The default inspector selection SHALL follow a processing node during a live run—the lowest-index one when several nodes are processing concurrently—show the final audit for a completed run, and show the first failed node for a failed run.

#### Scenario: Watch a stage progress call by call
- **WHEN** a workflow stage is running
- **THEN** the operator sees the currently processing node animate, completed nodes show their summaries, and upcoming steps remain visible as pending

#### Scenario: Concurrent repair candidates finish independently
- **WHEN** a stage's repair fork runs with both candidates in flight and one call finishes before the other
- **THEN** both repair candidate nodes can appear in the processing state at the same time
- **AND** the candidate whose call settles first is marked done with its own duration while the other keeps animating until its own call settles
- **AND** each node's recorded duration reflects only its own call and is not overwritten when the pick outcome is later attached
- **AND** the default live inspector follows the lower-index candidate while both are processing

#### Scenario: Fallback presents as degraded, not failed
- **WHEN** the triage call fails and the deterministic fallback is applied
- **THEN** the triage node presents in the degraded-warning state with a summary naming the fallback
- **AND** the run continues without the failure state

### Requirement: Paused-for-review presentation
When the final audit pauses the workflow, the final-audit node SHALL present the review inline: the tripped and met thresholds with their measured values, the shortfall and drop summary, and the available actions—approve to proceed to audio, or discard the run—with the full report one selection away. The audio stage SHALL be visibly waiting on the review, and the paused state SHALL be discoverable from the studio's background-job presentation.

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
