## Why

The two repair candidates in the quality-control repair fork are generated one after the other by a `for`-`await` loop, even though the UI presents them as a parallel fork. They use an identical prompt and model with no data dependency between them, so the serial dispatch adds a full extra generation round-trip to the critical path of every repair-bearing stage for no benefit. Repair calls are full conversation regenerations, so on a stage that triggers repair this is a meaningful, avoidable chunk of tail latency.

## What Changes

- Dispatch the two repair candidate generator calls **concurrently** instead of serially, awaiting both with `Promise.allSettled` so a failure in one candidate never rejects the other.
- Preserve the existing partial-failure contract exactly: one candidate failing still leaves the surviving candidate in the pick pool; both failing still falls back to the originals.
- Preserve per-candidate audit output: each candidate keeps emitting its own `processing` → `done`/`repairWarning` node transitions, keeps stable node identity, and its exchange stays keyed by the `repairCandidate` stat rather than array push order.
- Report each candidate's completion independently: whichever call finishes first has its node marked done with its own duration while the other keeps animating, and a node's recorded completion time is stamped once and not reset by the later pick-outcome re-publish (so the two siblings no longer show an identical, flattened time).
- Apply the change to **both** repair forks — the initial repair pass and the pass-2 re-roll repair pass — since both run through the same `qualityPass` code path.
- During a live run the operator may now see **both** repair candidate nodes in the processing state at the same time, rather than one processing while the other waits.
- No change to repair *outcomes*: the candidate pool, dominance gates, picker decisions, final labels, and accepted conversations are identical to today. This is an execution-timing change only.

## Capabilities

### New Capabilities

_None. This change modifies the execution timing of existing behavior._

### Modified Capabilities

- `generation-quality-control`: the scoped-repair requirement gains an explicit guarantee that the two independent candidate calls are dispatched concurrently, and that the one-fails / both-fail fallback behavior holds regardless of dispatch concurrency.
- `generation-audit-graph`: the live-progress behavior is refined so that concurrently running sibling repair candidate nodes may both be in the processing state simultaneously, while each still records ordered per-node `processing` → terminal transitions.

## Impact

- **Surface**: Studio content generation only. The learner application is unaffected.
- **Content formats**: No change to curated or published content. Accepted conversations, quality labels, picker statistics, and stored exchanges are byte-for-byte equivalent to the serial path.
- **Code**: `server/qualityControl.ts` — the repair candidate loop in `qualityPass` (and, transitively, the pass-2 re-roll fork that reuses it). The post-loop exchange-annotation and node-publish logic already key off the `repairCandidate` stat, so it is order-independent and needs no behavioral change. `server/index.ts` — `updateWorkflowNode` makes a node's `completedAt` sticky so the post-pick re-publish no longer flattens the two candidates to a shared duration (extracted as `resolveStickyCompletedAt`).
- **Providers**: Instantaneous text-generation load against the configured provider doubles during the repair fork (two concurrent calls instead of one). This runs inside a single already-held generation slot, so it does not change cross-job serialization.
- **Tests**: `server/qualityControl.test.ts` — the repair, one-candidate-failure, and both-candidates-failure cases must continue to pass under concurrent dispatch.
