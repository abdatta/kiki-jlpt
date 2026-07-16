## MODIFIED Requirements

### Requirement: Preserved curated quality-label provenance
The curated library SHALL preserve additive quality-label provenance on each curated conversation, including its `good`, `okay`, or `bad` label and available judgment metadata. Persisting or presenting quality metadata MUST NOT alter curated dialogue, audio, ordering, set assignment, source-run linkage, curation timestamp, locking behavior, or published-library state. Existing historical review provenance SHALL remain readable without requiring a Studio relabel operation.

#### Scenario: Preserve a curated conversation's quality metadata
- **WHEN** a labeled source conversation is curated or existing curated quality metadata is read
- **THEN** the curated record retains its content, audio, ordering, and source linkage together with its available label provenance

#### Scenario: Stored bad label remains curated
- **WHEN** a curated conversation has a stored `bad` quality label
- **THEN** it remains in the curated library and is neither removed nor hidden because of that label

### Requirement: Compact Studio review metadata
Studio SHALL present quality labels in a compact, consistent card-header treatment. A library card SHALL NOT repeat an `in library` state badge. On queue and curation cards, the quality label SHALL be immediately before the source-run date/provenance chip. When review details are available, hovering or focusing the quality label SHALL reveal its verdict rationale, flags, decision source, judge when applicable, rubric version, and review time without requiring historical rationale fields to be copied into curated-set JSON records.

#### Scenario: Inspect stored quality provenance
- **WHEN** an operator hovers or focuses a labeled Studio conversation
- **THEN** Studio shows the stored review rationale and available provenance from its durable audit record while the curated conversation itself remains compact
