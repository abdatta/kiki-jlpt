## MODIFIED Requirements

### Requirement: Library balancing plan and complement generation
The studio SHALL calculate a balancing plan that identifies zero-coverage, low-coverage, priority, and overrepresented vocabulary and recommends a conversation count. It SHALL support previewing and generating a complementary run based on that plan in either a deterministic stats-only mode or an AI-enabled mode, and SHALL allow the operator to override the recommended conversation count before generating. In AI-enabled mode the studio SHALL ground complement generation in the cached AI-curation snapshot for the set — the existing curated conversations' learning content and per-word library exposure — in addition to the deterministic plan, so the model generates new conversations that fill absent and underexposed current-set vocabulary while avoiding redundancy with existing scenes and over-repetition. In both modes the deterministic balance plan SHALL remain authoritative and the model SHALL NOT recalculate or alter the supplied counts. Generation SHALL produce a normal audited run for review and SHALL NOT automatically add conversations to the curated library.

#### Scenario: Preview a complement
- **WHEN** an operator previews complement generation for a valid set in either mode
- **THEN** the system returns the current balance plan and the model exchange that would target its vocabulary needs

#### Scenario: Generate a stats-only complement
- **WHEN** an operator generates a library complement in deterministic stats-only mode
- **THEN** the system creates an audited run from the deterministic balance plan whose prompt and provider statistics retain the applicable balance context

#### Scenario: Generate an AI-balanced complement
- **WHEN** an operator generates a library complement in AI-enabled mode
- **THEN** the system supplies the deterministic balance plan together with the curated set's conversation content and per-word exposure, instructs the model to author new conversations that fill coverage gaps without duplicating existing scenes or over-repeating words, and creates an audited run whose prompt and provider statistics retain the applicable balance and snapshot context

#### Scenario: Override the recommended conversation count
- **WHEN** an operator sets a conversation count different from the plan's recommendation before generating in either mode
- **THEN** the system generates the operator-specified number of complementary conversations

#### Scenario: Balance generation provider or response failure
- **WHEN** the selected model request fails or returns no usable conversations during complement generation in either mode
- **THEN** the system reports a retryable generation failure and leaves the curated library unchanged
