## MODIFIED Requirements

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
