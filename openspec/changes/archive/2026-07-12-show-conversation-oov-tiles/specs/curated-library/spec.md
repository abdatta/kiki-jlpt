## MODIFIED Requirements

### Requirement: Static library publication
The studio SHALL publish all eligible curated conversations and audio into a versioned static learner manifest. Publication SHALL preserve stable conversation identifiers and prior publication order for unchanged content, include complete enriched future-set and external conversation vocabulary references, and report whether curated and published content are out of sync. Publication MUST leave the existing published manifest untouched and report actionable validation errors when a publishable conversation has an unresolved learner-visible OOV term.

#### Scenario: Curated content changes
- **WHEN** publishable curated timestamps or counts differ from the current manifest
- **THEN** the system reports the published library as stale

#### Scenario: Publish curated content
- **WHEN** an operator publishes a fully resolved curated library
- **THEN** the system rebuilds the learner audio and manifest, includes each conversation's enriched vocabulary references, retains stable identities for unchanged conversations, and reports synchronized counts and timestamps

#### Scenario: Block unresolved publication
- **WHEN** a publishable curated conversation has a learner-visible OOV term without complete canonical spelling, kana reading, and meaning
- **THEN** publication reports the conversation and term, does not publish an incomplete tile, and leaves the existing manifest and audio intact

#### Scenario: Ignore ineligible curated content
- **WHEN** a curated record is not audio-ready or has no audio file reference
- **THEN** the system excludes it from the published learner manifest
