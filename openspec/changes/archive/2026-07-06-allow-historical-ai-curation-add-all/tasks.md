## 1. Reconciliation Model

- [x] 1.1 Add shared types for historical curation reconciliation summaries, per-recommendation live status, stale-context warnings, and recomputed projected coverage.
- [x] 1.2 Implement a deterministic reconciliation helper that compares a review's recommendations with current persisted runs, current curated Library sources, and current AI curation candidate keys.
- [x] 1.3 Classify recommendations as already in Library, addable with audio, addable missing audio, changed source content, or no longer current candidate.
- [x] 1.4 Derive concise stale-context counts for newer candidates not evaluated, Library changes since review, already-added recommendations, and stale source/content blockers.

## 2. Server And Data Flow

- [x] 2.1 Return reconciliation data when loading a saved AI curation review or curation history detail, without mutating the saved review record.
- [x] 2.2 Recompute current projected least-covered words for valid remaining recommendations using current curated-library exposure.
- [x] 2.3 Preserve existing freshness behavior for latest reviews and failed reviews while marking failed or blocked historical reviews non-actionable.

## 3. Studio Experience

- [x] 3.1 Replace the blanket historical read-only state with a historical snapshot notice plus live reconciliation summary.
- [x] 3.2 Show Add All for actionable historical reviews with no already-curated recommendations and Add Remaining when some recommendations are already in Library.
- [x] 3.3 Keep Add All/Add Remaining disabled for failed reviews, missing sources, changed source content, and reviews with no remaining valid recommendations.
- [x] 3.4 Update the Add All preparation and run paths to accept reconciled historical reviews, skip already-curated recommendations, and preserve the existing audio and Library progress lifecycle.
- [x] 3.5 Display warnings for stale historical context, including newer candidates not evaluated and changed Library context.
- [x] 3.6 Display current recomputed projected coverage for historical reviews while keeping original snapshot coverage identifiable as historical data.

## 4. Verification

- [x] 4.1 Add unit coverage for reconciliation classification, including partially-applied reviews, fully-applied reviews, missing sources, changed source content, and newer candidates.
- [x] 4.2 Add Studio rendering coverage for actionable historical Add All/Add Remaining, blocked historical reviews, warning copy, and recomputed coverage labels.
- [x] 4.3 Run focused unit tests for AI curation, Add All planning, and Studio curation rendering.
- [x] 4.4 Run the full build/test command and library publication check.
