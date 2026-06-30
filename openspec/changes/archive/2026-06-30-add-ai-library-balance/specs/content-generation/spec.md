## MODIFIED Requirements

### Requirement: Natural current-set generation guidance
The studio SHALL instruct standard and complementary conversation-generation models to prioritize meaningful use of vocabulary from the selected current set while using earlier allowed sets as supporting language. The guidance SHALL favor coherent beginner conversations, natural repetition, and varied situations over forcing priority words into unsuitable dialogue, while retaining aggregate vocabulary coverage as a batch objective. When an AI-balanced complementary prompt is prepared, the studio SHALL additionally supply the existing curated library's conversation content and per-word exposure so the model can author conversations that improve coverage of absent and underexposed current-set words while avoiding redundancy with existing scenes and over-repetition, treating the deterministic plan and exposure as authoritative inputs it does not recalculate.

#### Scenario: Generate a standard batch
- **WHEN** the studio prepares a standard or primary generation prompt for a selected set
- **THEN** the prompt identifies current-set vocabulary as the primary learning focus and instructs the model to use it naturally and meaningfully rather than maximizing isolated mentions

#### Scenario: Generate a complementary batch
- **WHEN** the studio prepares a complementary prompt from zero-coverage and underexposed vocabulary
- **THEN** the prompt supplies those priorities but permits the model to omit or redistribute a word when including it would produce an unnatural conversation

#### Scenario: Generate an AI-balanced complementary batch
- **WHEN** the studio prepares an AI-balanced complementary prompt for a set
- **THEN** the prompt supplies the deterministic zero-coverage and underexposed priorities together with the existing library conversations' learning content and per-word exposure, and instructs the model to author new conversations that fill those gaps while diversifying scenes away from existing ones and repeating focal words only where natural

#### Scenario: Reuse earlier vocabulary
- **WHEN** a generated conversation needs supporting language from an earlier allowed set
- **THEN** the prompt permits that vocabulary without treating it as equivalent to meaningful current-set exposure
