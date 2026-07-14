## ADDED Requirements

### Requirement: Non-destructive historical quality labeling
The Studio SHALL provide a historical quality-labeling operation that evaluates existing delivered spoken dialogue with the same versioned dialogue-only final-label prompt used by new generations. It SHALL write only additive quality metadata: `good`, `okay`, or `bad` label; `pass`, `repair`, or `regenerate` verdict; rationale; flags; judge identity; rubric version; and review time. It SHALL map `pass` to `good`, `repair` to `okay`, and `regenerate` to `bad`, without preserving or overriding the judge result based on an earlier label.

#### Scenario: Label a historical bad conversation
- **WHEN** the historical judge returns `regenerate` for an existing conversation
- **THEN** the conversation remains present and unchanged with a visible `bad` label and persisted judgment provenance

#### Scenario: Non-dialogue material is excluded
- **WHEN** a historical conversation also has vocabulary evidence, listening questions, answers, translations, generator provenance, or an earlier quality label
- **THEN** those fields are excluded from the final-label prompt and do not affect its judgment

### Requirement: Label-only historical processing
The historical quality-labeling operation MUST NOT repair, regenerate, remove, hide, reorder, edit, recurate, revoice, or republish a conversation. It MUST NOT modify conversation dialogue, questions, answers, translations, vocabulary metadata, audio, curation membership, source linkage, or published learner-library content.

#### Scenario: Complete a historical labeling pass
- **WHEN** a historical labeling job completes for a scope containing good, okay, and bad results
- **THEN** every processed conversation retains its prior content and placement while only quality-label provenance is added

### Requirement: Scoped and repeat-safe historical coverage
The Studio SHALL support a curated-library scope and an all-saved-runs scope for historical quality labeling. The curated-library scope SHALL be available as the initial/default scope. By default, the operation SHALL skip conversations that already have quality-label provenance; it SHALL replace an existing judgment only after an explicit rejudge request.

#### Scenario: Start with the current curated library
- **WHEN** an operator starts historical labeling without selecting a broader scope
- **THEN** the job labels eligible curated-library conversations and does not process unrelated saved-run history

#### Scenario: Repeat a completed label pass
- **WHEN** an operator repeats a scope without requesting rejudgment
- **THEN** already labeled conversations are skipped and their prior judgment provenance remains unchanged

#### Scenario: Explicitly rejudge history
- **WHEN** an operator starts a historical labeling operation with rejudge enabled
- **THEN** eligible existing labels are replaced with a new verdict and provenance while conversation content remains unchanged

### Requirement: Historical-label provenance and failures
The Studio SHALL persist the selected judge model, provider-resolved version when supplied, rubric version, scope, processed/skipped/remaining counts, and any per-batch failures for historical labeling. A judge failure SHALL leave unprocessed conversations unchanged and SHALL be visible with actionable provider feedback.

#### Scenario: Judge call fails mid-backfill
- **WHEN** a historical label batch fails because the judge is unavailable or usage-limited
- **THEN** completed labels remain persisted, unprocessed conversations remain unchanged, and the job reports the failure with its resumable checkpoint
