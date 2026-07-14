## ADDED Requirements

### Requirement: Preserved curated quality-label provenance
The curated library SHALL preserve additive historical quality-label provenance on each curated conversation, including `good`, `okay`, or `bad` label and its judgment metadata. Historical labeling MUST NOT alter curated dialogue, audio, ordering, set assignment, source-run linkage, curation timestamp, locking behavior, or published-library state.

#### Scenario: Label a curated conversation
- **WHEN** a historical quality-labeling job judges a curated conversation
- **THEN** the curated record retains its existing content, audio, ordering, and source linkage while gaining only the label and judgment provenance

#### Scenario: Historical bad label remains curated
- **WHEN** a curated conversation receives a `bad` historical quality label
- **THEN** it remains in the curated library and is neither removed nor hidden by the labeling operation

### Requirement: Consistent quality-label presentation
Studio and the learner application SHALL show a stored `good`, `okay`, or `bad` label wherever they present that conversation as a card, detail, navigation item, or practice view. A conversation without a stored label SHALL not display a placeholder quality badge.

#### Scenario: Present a labeled library conversation
- **WHEN** a user opens a labeled conversation from a Studio library card, recommendation, run card, learner navigator, learner practice view, or learner vocabulary detail
- **THEN** the same stored quality label is visibly presented with its corresponding visual treatment

### Requirement: Compact Studio review metadata
Studio SHALL present quality labels in a compact, consistent card-header treatment. A library card SHALL NOT repeat an `in library` state badge. On queue and curation cards, the quality label SHALL be immediately before the source-run date/provenance chip. When review details are available, hovering or focusing the quality label SHALL reveal its verdict rationale, flags, judge, rubric version, and review time without requiring historical rationale fields to be copied into curated-set JSON records.

#### Scenario: Inspect a historical quality label
- **WHEN** an operator hovers or focuses a historically labeled Studio conversation
- **THEN** Studio shows the stored review rationale and provenance from its durable audit record while the curated conversation itself remains compact
