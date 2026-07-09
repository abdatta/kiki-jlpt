## ADDED Requirements

### Requirement: Studio set-scoped run selection
The Studio interface SHALL keep the operator-selected vocabulary set as the active generation context in Runs mode. When the selected set has generated runs, the Studio MAY select the newest matching run. When the selected set has no generated runs, the Studio SHALL keep that set selected and show the empty run state instead of switching to a different set's run.

#### Scenario: Selected set has generated runs
- **WHEN** an operator selects a set that has one or more generated runs
- **THEN** the Studio selects a run from that set
- **AND** keeps the sidebar set selector on that set

#### Scenario: Selected set has no generated runs
- **WHEN** an operator selects a set that has no generated runs
- **THEN** the Studio keeps the sidebar set selector on the selected set
- **AND** shows the empty run state for that set
- **AND** does not switch to another set because that set has a newer run
