## 1. Scope Model and Compatibility

- [x] 1.1 Extend shared AI-curation request, snapshot/review, and history-summary types with selected generated-run scope and run-level eligible counts needed by the Studio.
- [x] 1.2 Add normalization and legacy inference that derives selected run IDs from captured candidate snapshots when reading reviews without explicit scope metadata.
- [x] 1.3 Add serialization and compatibility tests proving both scoped and legacy persisted reviews load without changing their captured results.

## 2. Scoped Candidate Construction

- [x] 2.1 Refactor candidate discovery to expose eligible candidates grouped by source run while preserving current eligibility and deterministic ordering rules.
- [x] 2.2 Validate submitted run IDs for non-empty selection, uniqueness, selected-set membership, existence, and at least one eligible candidate before invoking a provider.
- [x] 2.3 Build AI-curation snapshots, candidate counts, prompts, and output validation from only the selected runs while retaining the complete curated-library comparison context.
- [x] 2.4 Update snapshot fingerprints and freshness checks so selected-run membership/content changes invalidate a review and unselected-run-only changes do not.
- [x] 2.5 Rework snapshot/evidence caching to support multiple run scopes and reuse unchanged per-run deterministic analysis after Queue prefetch.

## 3. API, Retry, and Reconciliation

- [x] 3.1 Accept explicit selected run IDs on new and retry AI-curation endpoints and return actionable client errors for invalid or raced scopes.
- [x] 3.2 Persist selected scope on successful and failed reviews and include scoped counts and provenance in latest-review and history responses.
- [x] 3.3 Make retry reuse the original review scope and make historical reconciliation report selected-run changes without treating unrelated runs as stale context.
- [x] 3.4 Add server tests for subset selection, all-runs default compatibility, invalid scopes, exact-size bounds, provider non-invocation on validation failure, scoped freshness, retry, and reconciliation.

## 4. Studio Run Selection

- [x] 4.1 Add AI-curation preflight state that groups eligible candidates by run, defaults all eligible runs selected on initial/set load, and retains deliberate empty or subset selections.
- [x] 4.2 Render generated-run selection controls with run provenance, eligible counts, independent toggles, Select All, Clear, and unavailable historical selections.
- [x] 4.3 Derive the visible candidate count and portfolio-size limits from selected runs, disable invalid submission, and send selected run IDs with curation requests.
- [x] 4.4 Show selected-run provenance on saved reviews and restore model, exact size, and available run scope through Retry and Use Settings without automatically submitting.
- [x] 4.5 Add Studio tests for defaults, toggling, clear/select-all, scoped size validation, request payloads, history restoration, missing runs, and legacy reviews.

## 5. Verification

- [x] 5.1 Run AI-curation, Studio curation, API, and snapshot/freshness unit tests and resolve regressions.
- [x] 5.2 Run the complete unit suite and TypeScript/Vite builds.
- [x] 5.3 Run the curated-library publication consistency check and confirm this Studio-only change produces no curated or published manifest changes.
