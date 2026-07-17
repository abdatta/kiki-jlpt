## MODIFIED Requirements

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
