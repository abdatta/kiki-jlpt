## ADDED Requirements

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
