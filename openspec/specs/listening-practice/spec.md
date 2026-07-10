# Listening Practice Specification

## Purpose

Defines how learners access, hear, review, complete, revisit, and organize published listening conversations.

## Requirements

### Requirement: Published conversation library
The learner application SHALL load practice conversations from the published static library manifest without relying on a cached response. A missing manifest SHALL be treated as an empty library, while other load failures SHALL be surfaced as an error state.

#### Scenario: Published library is available
- **WHEN** the learner application loads a valid published manifest
- **THEN** it makes the manifest's conversations available for their assigned levels

#### Scenario: Published library has not been created
- **WHEN** loading the manifest returns a not-found response
- **THEN** the system presents an empty-library state rather than failing the application

### Requirement: Sequential conversation access
Within a level, the learner application SHALL unlock the first available conversation and SHALL unlock each subsequent conversation only after all preceding conversations in the active order are complete. Completed conversations SHALL remain accessible.

#### Scenario: Begin a listening level
- **WHEN** an eligible learner has not completed any conversation in a level
- **THEN** only the first conversation in the active order is available to begin

#### Scenario: Complete the current conversation
- **WHEN** the learner completes an unlocked conversation
- **THEN** the next conversation in the active order becomes accessible

### Requirement: Vocabulary-aware conversation ordering
The learner application SHALL preserve the learner's completion order for completed conversations and SHALL order remaining conversations by the number of vocabulary terms already classified as strong, using publication order to break ties.

#### Scenario: Prefer familiar vocabulary
- **WHEN** two uncompleted conversations are available and one contains more mastered vocabulary terms
- **THEN** the system places the conversation with more mastered terms earlier

#### Scenario: Preserve completed history
- **WHEN** the learner has completed conversations in a recorded order
- **THEN** those conversations remain at the start of the active order in that completion order

### Requirement: Controlled audio listening
The learner application SHALL provide play, pause, replay, seek, and playback-speed controls for conversation audio. Supported speeds SHALL be 0.5x, 0.75x, 1x, and 1.25x, and the selected speed SHALL be reused for later conversations.

#### Scenario: Change playback speed
- **WHEN** the learner selects a supported playback speed
- **THEN** the system applies it to the current audio and persists it for later listening

#### Scenario: Audio playback fails to start
- **WHEN** the browser rejects an attempt to play conversation audio
- **THEN** the system returns the player to a non-playing state without marking the conversation complete

### Requirement: Listen before assessment
For a conversation with audio, the learner application SHALL withhold comprehension questions until the initial audio playback finishes. The learner SHALL be able to reveal each answer and assess their response as remembered or missed.

#### Scenario: Audio has not finished
- **WHEN** the learner is listening to a conversation for the first time and playback has not ended
- **THEN** the system keeps the comprehension questions unavailable

#### Scenario: Audio finishes
- **WHEN** the initial playback reaches the end
- **THEN** the system exposes the conversation's comprehension questions

### Requirement: Listening completion and review
The learner application SHALL mark a conversation complete after every comprehension question has been assessed. For a conversation without questions, completing playback SHALL complete the conversation. The transcript SHALL become visible after completion or after all questions have been assessed, and a retry SHALL reset the current attempt without erasing previously persisted completion.

#### Scenario: Assess all questions
- **WHEN** the learner has assessed every comprehension question
- **THEN** the system records the conversation as complete and exposes its transcript

#### Scenario: Retry an attempt
- **WHEN** the learner chooses to retry a conversation
- **THEN** the system rewinds and pauses the audio and clears the attempt's revealed answers and translations

### Requirement: Conversation reference tools
The learner application SHALL show vocabulary used by a conversation, distinguish mastered from unmastered terms, allow line-by-line translation visibility after the transcript is available, and allow an eligible conversation to be starred or unstarred.

#### Scenario: Inspect conversation vocabulary
- **WHEN** the learner opens a conversation's vocabulary list
- **THEN** the system identifies each known vocabulary term and whether all matching cards through that level are strong

#### Scenario: Star an eligible conversation
- **WHEN** the conversation is complete or its initial audio playback has finished and the learner stars it
- **THEN** the system adds it to the persistent starred-conversation list

### Requirement: Completed conversation navigator
The learner application SHALL provide a navigator that lists the conversations the learner has completed at the current level plus the current in-progress conversation, in playlist order, numbered by their stable playlist position. The navigator SHALL be reachable from both the conversation-position indicator and the starred-count indicator in the conversation toolbar. Each listed conversation that is starred SHALL display a read-only starred indicator; the navigator SHALL NOT change a conversation's starred state. Selecting a listed conversation SHALL make it the active conversation and dismiss the navigator. The navigator SHALL be scoped to the current level.

#### Scenario: Open the navigator from the position indicator
- **WHEN** the learner activates the conversation-position indicator in the toolbar
- **THEN** the navigator opens with the All filter active, listing the completed conversations and the current in-progress conversation in playlist order

#### Scenario: Open the navigator pre-filtered to starred
- **WHEN** the learner activates the starred-count indicator in the toolbar
- **THEN** the navigator opens with the Starred filter active, showing only listed conversations the learner has starred

#### Scenario: Starred count is consistent between the toolbar and the navigator
- **WHEN** the learner has starred conversations at the current level
- **THEN** the starred count shown on the toolbar indicator matches the number of conversations shown under the navigator's Starred filter, because every starrable conversation is either completed or the current in-progress conversation

#### Scenario: Starred conversations are marked
- **WHEN** the navigator lists a conversation that the learner has starred
- **THEN** the conversation row shows a read-only starred indicator and provides no control to change its starred state

#### Scenario: Filtering preserves position numbers
- **WHEN** the learner switches between the All and Starred filters
- **THEN** each conversation keeps its playlist position number rather than being renumbered within the filtered subset

#### Scenario: Navigate to a listed conversation
- **WHEN** the learner selects a conversation from the navigator
- **THEN** that conversation becomes the active conversation and the navigator is dismissed

#### Scenario: Opening the navigator reveals the active conversation
- **WHEN** the navigator opens and the active conversation would otherwise be scrolled out of view
- **THEN** the list is scrolled so the active conversation is visible without further interaction

#### Scenario: No conversations starred yet
- **WHEN** the Starred filter is active and the learner has starred no conversations at the current level
- **THEN** the navigator shows guidance to star conversations after listening instead of an empty list
