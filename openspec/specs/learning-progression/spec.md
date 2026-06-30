# Learning Progression Specification

## Purpose

Defines how learner state, practice eligibility, level completion, and sequential progression are persisted and evaluated.

## Requirements

### Requirement: Browser-local learning state
The learner application SHALL persist the selected level, vocabulary review state, conversation completion order, starred conversations, and conversation playback speed in browser-local storage. Missing values and values that cannot be parsed SHALL fall back to safe defaults rather than preventing practice, and stored conversation identifiers SHALL be normalized to unique strings.

#### Scenario: Return to practice
- **WHEN** a learner reopens the application in the same browser profile
- **THEN** the system restores valid saved learning state and preferences

#### Scenario: Stored state is unreadable
- **WHEN** a stored value is missing or cannot be parsed as JSON
- **THEN** the system uses the corresponding default state and remains usable

### Requirement: Listening practice eligibility
The system SHALL lock a level's listening practice until the learner has made the configured proportion of that level's vocabulary strong. The default required proportion SHALL be 50 percent.

#### Scenario: Vocabulary threshold is not met
- **WHEN** fewer than the required proportion of the selected level's vocabulary cards are strong
- **THEN** the system keeps listening practice locked and reports the remaining strong-word requirement

#### Scenario: Vocabulary threshold is met
- **WHEN** the strong-vocabulary proportion reaches the configured listening threshold
- **THEN** the system unlocks listening practice for that level

### Requirement: Level completion
The system SHALL consider a level complete only when both its vocabulary-mastery requirement and its listening-completion requirement are met. By default, the learner MUST make 90 percent of the level's vocabulary strong and complete 20 listening conversations.

#### Scenario: Only vocabulary is complete
- **WHEN** the learner meets the vocabulary requirement but has completed fewer than 20 conversations
- **THEN** the level remains incomplete and the system reports the remaining listening requirement

#### Scenario: Both requirements are complete
- **WHEN** the learner meets the configured vocabulary requirement and completes at least 20 conversations
- **THEN** the system marks the level complete

### Requirement: Sequential level unlocking
The system SHALL unlock the first level and SHALL unlock each later level only when every earlier level is complete.

#### Scenario: Previous level is incomplete
- **WHEN** a learner attempts to select a level whose predecessor is incomplete
- **THEN** the system keeps the requested level locked

#### Scenario: Previous levels are complete
- **WHEN** all levels before a requested level are complete
- **THEN** the system allows the learner to select that level

### Requirement: Stable conversation completion history
The system SHALL record each conversation's completion at most once and preserve the order of first completion. It SHALL migrate legacy unordered completion data to the current published conversation order as a one-time compatibility operation.

#### Scenario: Complete the same conversation again
- **WHEN** an already completed conversation is completed or retried again
- **THEN** the system does not add a duplicate completion or change its original position

#### Scenario: Load legacy completion data
- **WHEN** stored conversation progress predates ordered completion tracking
- **THEN** the system maps the recorded per-level completion counts onto currently published conversations in publication order and stores the migrated version
