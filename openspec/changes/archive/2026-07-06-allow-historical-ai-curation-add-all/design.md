## Context

AI curation reviews are persisted as time-stamped snapshots containing the candidate pool, curated-library context, model provenance, recommendations, and projected coverage from the moment of review. The Studio currently treats every non-latest review as read-only, which prevents applying still-valid recommendations from older reviews.

The existing Add All workflow already reconciles recommended source conversations before doing work: it detects existing audio, existing Library membership, unavailable runs/conversations, pauses, failures, and retries. The missing piece is an explicit reconciliation layer for historical reviews that explains how the saved portfolio relates to current state before the operator chooses to proceed.

## Goals / Non-Goals

**Goals:**

- Allow operators to Add All/Add Remaining from completed historical reviews when recommended sources still resolve safely.
- Preserve the historical review as evidence of the original AI judgment while computing the execution plan from current persisted runs and Library state.
- Show why a review is stale in operator terms: already-added recommendations, source changes, source disappearance, changed candidate pool, changed curated set, and newer candidates not evaluated.
- Recompute current projected coverage for the selected historical portfolio without mutating the stored review.
- Keep all existing Add All safety gates for audio generation, duplicate prevention, source traceability, explicit start, pause, failure, and retry.

**Non-Goals:**

- Re-rank or reinterpret a historical portfolio with a model.
- Automatically apply historical recommendations without explicit operator confirmation.
- Change curated Library or published learner manifest formats.
- Treat static learner publication status as an AI curation freshness input.

## Decisions

### Separate historical judgment from live execution

The saved review remains the source of truth for ranking, rationale, model provenance, and original snapshot statistics. A new live reconciliation result determines whether actions are currently possible and what work remains.

Alternative considered: mark an old review current when its recommended conversations still exist. That hides important context, especially when newer candidates were added after the model request. Keeping the review historical but actionable is more honest.

### Reconcile every recommendation before enabling Add All

Before Add All/Add Remaining is offered for a historical review, the Studio SHALL compare each recommendation with current persisted runs and the current curated set. The reconciliation result should classify recommendations as:

- already in Library
- addable and audio-ready
- addable but missing audio
- source run or conversation missing
- source content changed since the review snapshot
- no longer a current candidate for another reason

Recommendations already in Library are skipped. Missing sources or changed content do not block inspecting the review, but they should block a portfolio-wide Add All until the operator either reruns curation or the implementation offers a narrower "add valid remaining only" choice. For this change, keep the workflow conservative: any missing source or changed content prevents Add All from starting.

Alternative considered: let Add All proceed with all valid rows while skipping broken rows. That would make "Add All" mean "best effort," which is less predictable and harder to audit. Failed reconciliation can still be retried after source state changes or by rerunning curation.

### Explain stale causes, not just stale status

The current boolean stale flag is not enough for an actionable historical workflow. The UI should surface concise counts and warnings:

- newer candidates were not evaluated
- the curated Library changed since the review
- some reviewed candidates are already curated
- some reviewed candidates are no longer current candidates
- source content changed

The warning copy should distinguish "statistics may be stale" from "the AI did not evaluate newer candidates." The latter affects portfolio quality, not just display numbers.

### Recompute current projected coverage as derived data

For historical reviews, "After Add All" should default to current recomputed projection after reconciliation. The original snapshot projection should remain inspectable as historical context, but should not be used to describe the current effect of pressing Add All.

The recomputed projection can be derived by taking current curated-library exposure and adding at most one exposure per still-valid recommendation for each current-set word, matching the existing projected-coverage rule.

Alternative considered: persist recomputed projections as new review versions. Recalculation is deterministic and tied to current Library state, so persisting it would create another freshness problem without clear benefit.

### Keep retry and current-review behavior unchanged

Current, fresh reviews should behave as they do today, except they may also show the same reconciliation summary for consistency. Failed reviews remain non-actionable. Re-curate remains the path for asking the model to consider the latest complete candidate pool.

## Risks / Trade-offs

- **Operators may over-trust an old AI ranking** -> Show the candidate-pool delta and explicitly state when newer candidates were not evaluated.
- **Historical Add All may feel different from current Add All** -> Use a shared reconciliation summary and shared modal language, with only the stale warnings differing.
- **Source content can diverge from saved rationale** -> Detect content changes and prevent portfolio-wide Add All for that review.
- **More UI states around Add All** -> Keep states count-based and action-oriented: already added, ready, needs audio, blocked.
- **Recomputed stats may be expensive if done repeatedly** -> Reuse the existing AI curation snapshot/cache and compute projections only for the selected review.
