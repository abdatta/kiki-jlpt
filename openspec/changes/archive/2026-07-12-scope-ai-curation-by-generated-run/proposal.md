## Why

AI curation currently considers every eligible conversation from every saved run for a set, so an operator cannot exclude experimental, obsolete, or otherwise unwanted generation runs from the model's portfolio decision. Operators need explicit control over which generated runs supply candidates while retaining the existing all-runs workflow as the default.

## What Changes

- Add an AI-curation preflight control for selecting one or more eligible generated runs, with all eligible runs selected by default.
- Restrict the curation candidate snapshot, candidate count, validation, prompt, and resulting portfolio to conversations from the selected runs.
- Persist the selected run scope with each review and restore it when retrying or copying settings from review history.
- Make freshness and reconciliation sensitive to the selected scope: relevant changes within selected runs can stale a review, while unrelated changes in unselected runs do not.
- Represent missing or no-longer-eligible historical run selections clearly and prevent invalid new requests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `curated-library`: AI curation changes from an implicit all-saved-runs candidate pool to an explicit, persisted operator-selected generated-run scope.

## Impact

- Studio only; the learner application, curated content format, and published learner manifest are unchanged.
- Affects shared AI-curation request and review types, candidate snapshot construction and caching, review freshness and reconciliation, Express AI-curation endpoints, and Studio preflight/history controls.
- Persisted reviews gain generated-run scope metadata; compatibility handling is required so older reviews continue to mean all runs captured in their saved candidate snapshot.
- No new external dependency or provider capability is required.
