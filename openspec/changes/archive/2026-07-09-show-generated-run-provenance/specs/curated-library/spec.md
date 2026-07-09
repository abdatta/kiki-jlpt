## ADDED Requirements

### Requirement: Mixed-list source run provenance
The Studio SHALL expose source generated-run provenance when it displays curated or recommended conversations outside their own generated run context. Provenance labels SHALL use the same compact relative timestamp format as generated run titles, such as `Today, 00:28`, `Yesterday, 17:57`, or `Jul 2, 12:44`. When the source run can be resolved, the provenance label SHALL navigate to that generated run.

#### Scenario: View a curated conversation in Library
- **WHEN** an operator opens a Library set containing a curated conversation with source-run traceability
- **THEN** the conversation card shows a compact source generated-run timestamp
- **AND** selecting that timestamp opens the source generated run when it is available

#### Scenario: View deterministic recommendations
- **WHEN** an operator opens the Queue for a set with deterministic recommendations from saved generated runs
- **THEN** each recommended conversation shows the compact timestamp for its source generated run
- **AND** selecting that timestamp opens the source generated run when it is available

#### Scenario: View AI curation recommendations
- **WHEN** an operator opens a current or historical AI curation review containing recommended conversations
- **THEN** each recommended conversation shows the compact timestamp for its source generated run
- **AND** historical read-only state does not prevent navigating to an available source generated run

#### Scenario: Source run is unavailable
- **WHEN** a curated or recommended conversation references a source generated run that cannot be resolved from current Studio state
- **THEN** the Studio still shows a compact unresolved-source label
- **AND** the unresolved label does not offer broken navigation

### Requirement: Mixed-list source run distribution
The Studio SHALL provide a collapsed-by-default source generated-run distribution for mixed curated and recommendation lists. The distribution SHALL group the visible conversations by source generated run and show each source run's compact timestamp label, contribution count, and percentage share of the visible list.

#### Scenario: Open a mixed Library list
- **WHEN** an operator opens a Library set whose visible conversations come from more than one source generated run
- **THEN** the Studio offers a control to show the source generated-run distribution
- **AND** the distribution is hidden until the operator expands it

#### Scenario: Open a mixed recommendation list
- **WHEN** an operator opens deterministic Queue or AI curation recommendations whose visible conversations come from more than one source generated run
- **THEN** the Studio offers a control to show the source generated-run distribution
- **AND** the expanded distribution reports the count and percentage contributed by each source generated run

#### Scenario: List has a single source run
- **WHEN** the visible curated or recommendation list contains conversations from only one source generated run
- **THEN** the Studio may omit the distribution control or show a one-source distribution without implying the list is mixed

#### Scenario: Distribution follows the visible portfolio
- **WHEN** a historical AI curation review reconciles to a remaining addable portfolio or a view otherwise filters the rendered conversations
- **THEN** the distribution reflects the conversations currently shown in that list rather than all candidates or all saved runs
