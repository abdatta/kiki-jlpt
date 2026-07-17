## Context

The repair fork in `server/qualityControl.ts` (`qualityPass`) generates two repair candidates with a `for (const candidateIndex of [1, 2])` loop that `await`s each generator call before starting the next. Both calls use the same `repairPrompt` and model and are independent samples; nothing downstream depends on their relative timing. The pass-2 re-roll fork reuses the same `qualityPass`, so it inherits the same serial behavior.

The loop currently interleaves three ordered concerns per iteration:
1. Publishing a `processing` audit node event, then later a `done`/`repairWarning` event (consumed as an ordered SSE stream by the Studio graph).
2. Awaiting the generator call.
3. Pushing the resulting `LlmExchange` onto the `exchanges` array.

Downstream, the post-loop annotation and node re-publish (`qualityControl.ts` ~627–675) already locate each exchange by its `repairCandidate` stat, not by array position — so that logic is already order-independent. The dominance gates, picker, and labeling operate on `candidateSets` keyed by `source` (`candidate1`/`candidate2`), also position-independent.

The test double in `qualityControl.test.ts` (`generator`) returns queued `outputs` via `.shift()` with no internal await, so it hands out results in the order the generator promises are *created*.

## Goals / Non-Goals

**Goals:**
- Dispatch the two repair candidate generator calls concurrently so the repair fork's wall-clock is one generation round-trip, not two.
- Preserve, byte-for-byte, the outcome of the serial path: candidate pool, gate eliminations, picker decisions, labels, accepted conversations, and persisted exchanges/stats.
- Preserve the ordered live audit stream: candidate 1's `processing` event is still emitted before candidate 2's, and each candidate still emits its own terminal event.
- Preserve per-candidate partial-failure semantics: one failure leaves the survivor in the pool; both failures fall back to originals; neither fails the run.
- Apply to both the initial and pass-2 re-roll repair forks via the shared `qualityPass`.

**Non-Goals:**
- Changing which candidate wins, how gates/picker decide, or any quality label.
- Parallelizing anything else (triage, pick, re-roll generation, cross-stage work).
- Touching the global generation slot / cross-job serialization (`generationGate.ts`). The two calls run inside one already-held slot.
- Adding a concurrency library, worker pool, or provider-side rate limiting.

## Decisions

### Decision: Announce ordered, report per-call, assemble ordered

Split the two *separable* concerns instead of conflating them: **live event timing** (must reflect each call's real duration) and **outcome-data ordering** (must be deterministic). The repair section runs in three parts:

1. **Announce (ordered):** iterate `[1, 2]` and `await publish(... 'processing' ...)` for each candidate before any call settles. This keeps the `processing` events in 1-before-2 order and satisfies the audit-graph requirement that each concurrent step is announced processing before any completes; both nodes then spin together.
2. **Generate + report (concurrent):** run both candidates as independent async tasks via `Promise.all`. Each task awaits its *own* generator call and, the instant that call settles, builds its exchange and publishes its *own* `done`/`repairWarning` node — so the faster call's node stops animating and records its own duration while the slower one keeps spinning. Each task is total (its own try/catch, always returns an outcome object, never throws), so `Promise.all` behaves like `allSettled` here: one candidate failing never rejects the other.
3. **Assemble (ordered):** `Promise.all` preserves *input* order, so the returned outcomes are always `[candidate1, candidate2]` regardless of which settled first. Fold them back in that order to push `exchanges`, `candidateSets`, and `failures` — making the recorded pool independent of completion order.

**Why this supersedes the first-cut "batch reduce" (publish both terminal events after `allSettled`):** that stamped both nodes' `completedAt` at the same post-join moment, so both showed an identical duration and stopped spinning together — a real bug. Reporting inside each task fixes it while step 3 still guarantees deterministic outcome data. Event timing and data ordering are genuinely independent, so there is no need to trade one for the other.

### Decision: Node completion time is sticky

The card duration is `node.completedAt − node.startedAt`, both stamped server-side when the `processing` and terminal events arrive. But after the pick, each repair node is *re-published* to attach its selection facts — and that re-publish re-stamped `completedAt` for both candidates in one synchronous loop, re-flattening the durations even with per-call reporting. `updateWorkflowNode` therefore stamps `completedAt` only on a node's first completion and preserves it across later terminal re-publishes; re-entering `processing` (a repair re-run) clears it so the next completion starts a fresh window. Extracted as the pure, unit-tested `resolveStickyCompletedAt` helper.

### Decision: Keep candidate-index ordering as the outcome's source of truth

Completion order is observed *only* for live event timing (deliberately). Every persisted effect — `exchanges`, `candidateSets`, `failures`, and the post-pick annotation keyed by the `repairCandidate` stat — is assembled in fixed `[1, 2]` order, so the outcome is provably identical to the serial path and existing position-sensitive tests keep passing unchanged.

## Risks / Trade-offs

- **Doubled instantaneous provider load during the repair fork** → Acceptable and bounded: exactly two concurrent calls, inside one held generation slot, only when a stage actually has repair-flagged conversations. No change to cross-job concurrency. If a provider tier can't sustain two concurrent text calls, that surfaces as two independent failures which the existing fallback already tolerates (both fail → originals retained).
- **Non-deterministic outcome data if assembly isn't kept ordered** → Mitigated by assembling `exchanges`/`candidateSets`/`failures` from the `Promise.all` result (input order), never from completion order. Only the live node events are allowed to reflect completion order.
- **Concurrent `publish` calls racing the job state** → `updateWorkflowJob` reads-updates-writes the in-memory job map synchronously (no `await` between get and set), so two concurrent publishes each apply atomically; the fire-and-forget persistence is unaffected.
- **Test doubles that assume serial call completion** → The mock resolves synchronously and is consumed in promise-creation order; creating the tasks in index order preserves its behavior. The one-candidate-failure and both-candidate-failure tests assert on the surviving/fallback outcome, which is unchanged.
- **Partial-failure regressions** → Each per-candidate task reuses the existing try/catch bodies verbatim, so provenance (`failures`, failed exchanges) and fallback wording are preserved.
- **Re-flattened durations via node re-publish** → Addressed by sticky `completedAt` (`resolveStickyCompletedAt`); guarded by a deterministic unit test.

## Migration Plan

Pure in-process behavior change across two functions (`qualityPass` in `qualityControl.ts`, `updateWorkflowNode` in `index.ts`); no data model, persisted format, or API change, so no migration or rollback tooling is needed. Rollback is reverting the two edits. Existing persisted runs are unaffected — their stored exchanges and nodes are identical in shape to what the concurrent path produces.

## Open Questions

- None blocking. Optional future follow-up: if repair ever grows beyond two candidates, the announce/report/assemble structure generalizes to `N`, but that is out of scope here.
