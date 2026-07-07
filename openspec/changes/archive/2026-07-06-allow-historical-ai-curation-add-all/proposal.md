## Why

Historical AI curation reviews can still contain useful, operator-reviewed recommendations, but the Studio currently blocks Add All from every non-latest review even when the sources still exist and only some items remain to be added. This change lets operators apply valid remaining recommendations from older reviews while making any stale assumptions explicit before Library or audio work begins.

## What Changes

- Allow completed historical AI curation reviews to offer Add All/Add Remaining when their recommended source conversations can be reconciled against current persisted state.
- Replace blanket historical read-only behavior with live reconciliation that reports already-curated recommendations, remaining addable recommendations, missing audio, missing sources, changed source content, stale review causes, and newer candidates not evaluated by the old AI review.
- Keep failed reviews and unreconciled portfolios non-actionable.
- Recompute and display current projected coverage for a historical portfolio separately from the original saved snapshot projection.
- Preserve existing audio readiness, duplicate prevention, source traceability, explicit start, pause, retry, and stop-on-failure behavior for Add All.
- No breaking changes to curated or published learner content formats.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `curated-library`: Historical AI curation reviews may be actionable after live reconciliation, and projected portfolio coverage must distinguish original snapshot data from current recomputed stats.

## Impact

- Studio AI curation view and Add All modal behavior.
- AI curation review/history API payloads or client-side reconciliation data structures.
- Add All planning and tests for historical, stale, partially-applied, and source-missing portfolios.
- No learner application impact and no dependency changes expected.
