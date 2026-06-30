## ADDED Requirements

### Requirement: Level-specific vocabulary sessions
The learner application SHALL create vocabulary practice sessions from the vocabulary assigned to the selected unlocked level. A session SHALL contain no more than 15 cards and SHALL favor words classified as weak or improving while retaining a limited mix of new and strong words when available.

#### Scenario: Start a normal practice session
- **WHEN** a learner opens vocabulary practice for a level with more than 15 vocabulary cards
- **THEN** the system presents a shuffled session of 15 cards weighted toward weak and improving words

#### Scenario: Practice a small level
- **WHEN** the selected level contains 15 or fewer vocabulary cards
- **THEN** the system includes every card from that level in shuffled order

### Requirement: Vocabulary answer assessment
The learner application SHALL allow the learner to assess each reviewed word as remembered or missed and SHALL advance to the next card after the assessment.

#### Scenario: Learner remembers a word
- **WHEN** the learner marks a vocabulary card as remembered
- **THEN** the system records a successful review and advances to the next card

#### Scenario: Learner misses a word
- **WHEN** the learner marks a vocabulary card as missed
- **THEN** the system records an unsuccessful review and advances to the next card

### Requirement: Adaptive review state
The system SHALL maintain per-word review count, recent outcomes, streak, ease, review interval, last-review time, and next-due time. Successful reviews SHALL increase the streak and schedule a future review, while a missed review SHALL make the word immediately due and reduce its strength.

#### Scenario: Successful review is scheduled
- **WHEN** a learner successfully reviews a word
- **THEN** the system increases its successful streak and assigns a future due time based on its review history

#### Scenario: Missed review becomes due
- **WHEN** a learner misses a word
- **THEN** the system records a negative streak and makes the word immediately eligible for review

### Requirement: Vocabulary strength classification
The system SHALL classify vocabulary as new, weak, improving, or strong using its review history, recent accuracy, and streak. A word SHALL remain non-strong until it has sufficient recent review evidence.

#### Scenario: Unreviewed word classification
- **WHEN** a word has no recorded reviews
- **THEN** the system classifies it as new

#### Scenario: Consistently successful word classification
- **WHEN** a word has at least five recent results, greater than 80 percent recent accuracy, and a streak of at least three
- **THEN** the system classifies it as strong

#### Scenario: Struggling word classification
- **WHEN** a reviewed word has less than 60 percent recent accuracy or a negative streak
- **THEN** the system classifies it as weak

### Requirement: Vocabulary progress inspection
The learner application SHALL expose vocabulary totals and per-word learning details for the selected level, including strength category and available review statistics.

#### Scenario: Inspect reviewed vocabulary
- **WHEN** a learner opens vocabulary statistics and selects a reviewed word
- **THEN** the system shows its reading, meaning, review count, streak, accuracy, and strength category

#### Scenario: Inspect an unreviewed word
- **WHEN** a learner selects a new word
- **THEN** the system shows its vocabulary details and identifies it as new without fabricating review history
