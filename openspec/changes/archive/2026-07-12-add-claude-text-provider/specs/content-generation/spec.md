# Content Generation Delta: Add Claude Text Provider

## ADDED Requirements

### Requirement: Provider-grouped model selection
Studio text-model pickers SHALL present model options grouped under provider headings, ordered Gemini, GPT, Claude, with each option listed inside its provider's group. A historical run whose model is absent from the current option list SHALL remain selectable inside its provider's group.

#### Scenario: Grouped picker rendering
- **WHEN** the operator opens a text-model picker
- **THEN** options appear under Gemini, GPT, and Claude group headings in that order

#### Scenario: Historical model stays selectable
- **WHEN** the operator views a run generated with a model no longer offered
- **THEN** that model appears selectable within its provider's group

### Requirement: Resolved model version provenance
When a provider reports the exact model version that served a generation, the generation exchange SHALL record that resolved version, and the run's stored model information SHALL be stamped with the resolved version from its first successful generation exchange. Surfaces that display a run's or exchange's model identity SHALL show the resolved version when present, and MAY present it in a shortened human-readable form (model family and version, date suffix omitted) provided the exact identifier remains inspectable in the exchange statistics.

#### Scenario: Run stamped with resolved version
- **WHEN** a run is generated with a model alias and the provider reports the exact serving model version
- **THEN** the persisted run's model information includes the resolved version alongside the alias-based selection

#### Scenario: Audit shows the per-call version
- **WHEN** the operator inspects a generation exchange whose provider reported a resolved model version
- **THEN** the audit surface displays that resolved version
