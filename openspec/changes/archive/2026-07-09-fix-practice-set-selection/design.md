## Context

In Studio Runs mode, changing the sidebar set updates `setNumber` and navigates to either a run route for a matching run or the generic runs route when no matching run exists. A later route synchronization effect handles the generic runs route by choosing `runs[0]` globally. In the current data that global newest run belongs to Set 2, so selecting Set 3+ with no runs is immediately overwritten back to Set 2.

## Goals / Non-Goals

**Goals:**

- Preserve the operator-selected Studio set in Runs mode when that set has no matching runs.
- Continue to select an existing run when the chosen set has generated runs.
- Keep Queue, AI Curation, Library, and learner practice behavior unchanged.

**Non-Goals:**

- Change generated run ordering.
- Create placeholder runs for empty sets.
- Change generation, curation, library, or published practice data formats.

## Decisions

- In generic Runs routes, choose the first run whose `setNumber` matches the currently selected Studio set instead of using the first run globally.
  - Rationale: the sidebar selection is the operator's active context; a missing run for that set should render an empty state, not rewrite the context.
  - Alternative considered: always route to a set-specific URL. That is a larger navigation change and unnecessary for this bug.
- Extract the run-selection rule into a pure helper for regression coverage.
  - Rationale: the bug is a state-selection policy, and testing it directly avoids browser-route test scaffolding.

## Risks / Trade-offs

- Opening `#/studio/runs` after already selecting an empty set will show an empty run state instead of jumping to the newest run. Mitigation: this matches the visible set selector and the Generate button remains available.
