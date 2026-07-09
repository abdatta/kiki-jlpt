## Why

Studio operators can choose vocabulary sets from the sidebar, but selecting a set with no generated run can immediately revert the dropdown to the most recent run's set. This makes Set 3 and later difficult to generate from when the existing run history is concentrated in Set 2.

## What Changes

- Update Studio run selection so the sidebar set dropdown remains on the operator-selected set even when that set has no runs yet.
- Keep existing route behavior for Queue, AI Curation, and Library views.
- Add regression coverage for Studio run-mode selection when the chosen set has no matching run.
- No curated or published content format changes.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `content-generation`: Studio set selection in Runs mode should remain stable for sets that do not yet have generated runs.

## Impact

- Affects only the Studio sidebar set selection and run-list defaulting behavior.
- Adds focused unit coverage for selecting a Studio set without matching runs.
- No learner application, API, storage format, dependency, or generated library changes.
