## 1. Restructure the repair fork into three ordered phases

- [x] 1.1 In `server/qualityControl.ts` `qualityPass`, replace the single `for (const candidateIndex of [1, 2])` await loop with an **announce** pass that iterates `[1, 2]` and `await publish(... 'processing' ...)` for each candidate (with its pending exchange prepared) before any generator call resolves.
- [x] 1.2 Add a **generate** phase that creates the two generator promises in candidate-index order (same `repairPrompt` and `options.textModel`) and awaits them together with `Promise.allSettled`.
- [x] 1.3 Add a **reduce** phase that walks the settled results in candidate-index order and, per candidate, runs the existing success path (normalize + `preserveIdentity` + length/empty validation → push `candidate{n}` set, push completed exchange, publish `done` node) and the existing failure path (record `failures` entry, push failed exchange, publish `repairWarning` node) unchanged in behavior.
- [x] 1.4 Confirm the post-loop exchange annotation and node re-publish (~627–675) still resolve each exchange by its `repairCandidate` stat and require no change; adjust only if the restructure altered a variable it reads.
- [x] 1.5 Verify by inspection that the pass-2 re-roll fork inherits the change through the shared `qualityPass` (no separate edit needed).

## 2. Tests

- [x] 2.1 Update/confirm the existing repair tests in `server/qualityControl.test.ts` (two-candidate success, one-candidate failure, both-candidate failure) still pass, relying on the mock generator being consumed in promise-creation order.
- [x] 2.2 Add a test asserting the emitted node events keep candidate 1's `processing` before candidate 2's `processing`, and that each candidate emits its own terminal event — i.e. ordered announce/terminal despite concurrent generation.
- [x] 2.3 Add a test that the two candidate generator calls are dispatched concurrently (e.g. the second call is initiated before the first resolves, using a deferred/gated mock generator), and that swapping the two calls' resolution order yields identical `candidateSets`, picks, and per-exchange `repairCandidate` stats.
- [x] 2.4 Run the full server test suite and confirm no regression in `qualityControl.test.ts`, `studioApi.test.ts`, or `studioCuration.test.tsx`.

## 3. Per-call completion timing (each candidate finishes on its own clock)

- [x] 3.1 Replace the batch reduce with per-candidate concurrent tasks: each candidate publishes its own `done`/`repairWarning` node the instant its own call settles, while `exchanges`/`candidateSets`/`failures` are assembled from the `Promise.all` result in fixed index order.
- [x] 3.2 In `server/index.ts` make `updateWorkflowNode` stamp `completedAt` once (preserved across the post-pick enrichment re-publish, reset on re-entering `processing`); extract it as the pure exported `resolveStickyCompletedAt` helper.
- [x] 3.3 Add a `qualityControl.test.ts` test (gated generator) proving the first-settled candidate reports `done` before the slower one, and a deterministic `studioApi.test.ts` unit test for `resolveStickyCompletedAt` (first-completion stamps, enrichment preserves, re-run resets).
- [x] 3.4 Re-run the full unit suite and `tsc --noEmit`.

## 4. Spec validation

- [x] 4.1 Run `openspec validate parallelize-repair-candidates --strict` and resolve any issues.
- [x] 4.2 Manually confirm the delta specs match the shipped behavior: `generation-quality-control` (concurrent dispatch + order-independent outcome + preserved partial-failure) and `generation-audit-graph` (both repair nodes process at once, each finishes on its own clock with its own duration, inspector follows the lower-index one).
