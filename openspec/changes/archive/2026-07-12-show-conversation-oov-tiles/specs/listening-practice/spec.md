## MODIFIED Requirements

### Requirement: Conversation reference tools
The learner application SHALL show words used by a conversation through a words-to-review control. It SHALL distinguish mastered from unmastered in-course terms, group future-set references beneath their actual set numbers, and group other legitimate external references beneath an Outside Course Vocabulary section. The control count SHALL include non-strong in-course terms, future-set references, and external references, while excluding mastered in-course terms, proper nouns, and cultural references. The learner application SHALL allow line-by-line translation visibility after the transcript is available and allow an eligible conversation to be starred or unstarred.

#### Scenario: Inspect in-course conversation vocabulary
- **WHEN** the learner opens a conversation's vocabulary list
- **THEN** the system identifies each in-course vocabulary term and whether all matching cards through that level are strong

#### Scenario: Inspect future-set vocabulary
- **WHEN** a conversation contains an audited word assigned to a later course set
- **THEN** the vocabulary list shows its informational tile beneath that later set number with spelling, kana reading, and meaning

#### Scenario: Inspect external vocabulary
- **WHEN** a conversation contains a resolved legitimate word outside the complete course vocabulary
- **THEN** the vocabulary list shows its informational tile beneath Outside Course Vocabulary with spelling, kana reading, and meaning

#### Scenario: Count words to review
- **WHEN** a conversation contains non-strong in-course terms, future-set references, external references, and exempt proper or cultural terms
- **THEN** the words-to-review indicator counts the first three categories and excludes the exempt terms

#### Scenario: Star an eligible conversation
- **WHEN** the conversation is complete or its initial audio playback has finished and the learner stars it
- **THEN** the system adds it to the persistent starred-conversation list
