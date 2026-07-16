## MODIFIED Requirements

### Requirement: Conversation quality labels
Every accepted conversation SHALL carry persisted quality metadata derived from the decision that accepted its delivered dialogue. A conversation accepted directly from quality triage SHALL be labeled `good` and retain the triage rationale, flags, selected judge identity, resolved model version when reported, rubric version, and review time. A repaired conversation selected by a judge tie-break SHALL retain the picker's `good` or `okay` label together with the selected version, rationale, flags, judge identity, resolved model version when reported, confidence, rubric version, and review time. When deterministic gates decide the selected version without a model tie-break, the label SHALL be derived deterministically: `good` when the selected version resolves all audit findings and triage raised no naturalness concerns, otherwise `okay`, with the provenance marked gate-decided. Provider fallbacks SHALL be marked as fallbacks and MUST NOT be represented as direct model judgments. New generation MUST NOT invoke a separate post-selection model call solely to relabel accepted conversations. There SHALL be no accepted quality state that records a known structural defect. Conversations from runs generated before quality control SHALL be presented without quality labels rather than with defaults.

#### Scenario: Label a passed conversation from triage
- **WHEN** the selected judge returns `pass` for a generated conversation and it is accepted without repair
- **THEN** the conversation is labeled `good` from that triage decision
- **AND** its persisted label provenance identifies the triage judgment and its rationale
- **AND** no post-selection relabel call is made for that conversation

#### Scenario: Label a repaired conversation from the picker
- **WHEN** deterministic gates leave multiple admissible versions and the selected judge picks the delivered version
- **THEN** the conversation carries the picker's `good` or `okay` label, selected version, confidence, rationale, and flags
- **AND** no post-selection relabel call is made for that conversation

#### Scenario: Label a gate-decided repair
- **WHEN** deterministic gates leave exactly one admissible version and no pick model call runs
- **THEN** the conversation is labeled deterministically from the selected version's remaining findings and the original triage concerns
- **AND** its provenance identifies the decision as gate-decided rather than as a direct judge label

#### Scenario: Preserve fallback provenance
- **WHEN** triage or picking uses a deterministic fallback after a provider failure
- **THEN** the accepted conversation retains a fallback-derived label and rationale
- **AND** the metadata does not claim that the unavailable judge directly assigned the label
- **AND** the provider failure remains visible in generation provenance and the final text audit

#### Scenario: Legacy run without quality metadata
- **WHEN** an operator views a run generated before quality control existed
- **THEN** the studio renders it without quality labels and without treating absence as a defect

## REMOVED Requirements

### Requirement: Uniform final dialogue-quality labels
**Reason**: Rejudging every accepted conversation after triage and version selection duplicates the selected judge's earlier decisions, adds latency and cost, can fail an otherwise valid run, and overwrites the provenance of the decision that actually admitted the delivered dialogue.

**Migration**: New generations derive labels from triage, pick, gate, or fallback outcomes. Existing persisted final-label reviews remain readable and are not rewritten; exceptional maintenance can use the command-line backfill helper without restoring a Studio relabel job.
