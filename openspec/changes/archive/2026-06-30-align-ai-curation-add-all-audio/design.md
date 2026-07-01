## Context

AI Curation recommendations can point to conversations across several persisted runs. Add All currently fetches those runs, then calls the single-conversation audio endpoint for every recommendation whose state is not exactly `audio_ready` with a file name. The loop records failures but continues through the portfolio. Its modal uses a separate table presentation from the LLM Audit bulk-audio stage.

The LLM Audit flow already establishes the desired model: the existence of an audio file determines readiness, missing work is visible per conversation, a bounded set of requests may be active, the first failure stops new work from starting, prior successes remain persisted, and a later resume skips completed audio. Add All must apply those semantics to a recommendation subset spanning multiple source runs, then retain its separate Library-add phase.

## Goals / Non-Goals

**Goals:**

- Use the latest persisted source-run state to classify recommended audio on every initial attempt and retry.
- Generate only missing recommendation audio and stop dequeuing work after the first synthesis failure.
- Give Add All the same recognizable audio-stage states, live counts, row statuses, and active-item scrolling as LLM Audit.
- Preserve completed audio and make retry resume unresolved audio before entering the Library phase.
- Keep Library additions observable and safely retryable after audio is complete.
- Require an explicit modal action before audio or Library mutation and support cooperative pause/resume without cancelling provider calls.

**Non-Goals:**

- Regenerating audio that already has a persisted file.
- Generating missing audio for non-recommended conversations from the same source runs.
- Changing speech providers, audio formats, curated-library schemas, or publication behavior.
- Persisting Add All itself as a new long-running server job.
- Changing historical AI curation reviews from read-only snapshots.

## Decisions

### 1. Plan from persisted file readiness, not the conversation status label

At the start of Add All and every retry, refresh each represented source run and map every recommendation to its current conversation. A conversation with `audioFileName` is audio-complete even if an older status value is inconsistent; a recommendation without a file is queued. A missing source conversation is an immediate planning failure.

This matches `runHasMissingAudio` in the LLM Audit flow and avoids unnecessary replacement of usable audio. Trusting both `status === 'audio_ready'` and the file name was rejected because the status is redundant and can be stale. Trusting only the review snapshot was rejected because recommendations intentionally omit mutable audio state.

### 2. Extract a reusable stop-on-failure audio queue in the Studio

Run the queued recommendation subset through a small orchestration helper with the same maximum concurrency as LLM Audit (three workers). Workers claim one queued item at a time and call the existing individual audio endpoint. On the first rejection, set a shared stop flag; already-started requests may settle, but workers claim no more items. Mark the failed item as failed and all never-started items as stopped/skipped.

This keeps the target set exact across multiple source runs and requires no new API or persisted job format. Calling the existing whole-run resume endpoint was rejected because it would also synthesize non-recommended conversations. A new cross-run batch endpoint was rejected as disproportionate for this local Studio workflow; individual calls already persist every success and failure, so retry can reconstruct truth after interruption.

The queue helper will be isolated from React state so stop, concurrency, and result classification can be unit tested deterministically.

### 3. Share the LLM Audit audio-progress presentation

Extract the generic conversation audio list and summary behavior from the LLM Audit stage so both surfaces derive title, completed count, active state, failure/stopped state, status icons, and automatic scrolling from the same presentation logic. Add All adapts recommendation progress into that shared row model.

The Add All modal remains because it also owns the subsequent Library phase. During audio work it displays the shared audio-stage presentation; once every recommendation has a file, it transitions to a distinct Library-add list/status section. This avoids forcing Library concepts into the LLM Audit graph while preventing the two audio experiences from drifting again.

### 4. Retry is a fresh reconciliation, not a replay of in-memory statuses

Retry re-fetches all source runs, clears transient errors, and recomputes both phases. Audio with a persisted file is marked complete without a provider call. A conversation already linked to the curated library is marked Library-complete without another add request. Only unresolved Library additions are submitted after all audio is ready.

This makes retry resilient to successes from the failed attempt, page-local stale state, or other Studio actions. Replaying only rows previously labeled failed was rejected because it can miss stopped work and can duplicate successful Library writes.

### 5. Gate Library mutation on reconciled portfolio-wide audio readiness

The Library phase begins only when every current recommendation resolves to a source conversation with an audio file. Any source lookup or audio failure leaves every not-yet-added Library row waiting and keeps the modal retryable. Library additions continue through the existing per-conversation validation endpoint and retain independent per-row failure reporting.

### 6. Separate preview from execution and pause cooperatively

Choosing Add All performs only source reconciliation and opens the modal in a ready state. No speech or Library request starts until the operator uses the modal's primary action. AI Curate and Re-curate remain text-only review operations and never call the audio runner.

The queue accepts a synchronous pause signal owned by the active modal run. Choosing Pause changes the modal to `pausing` immediately and prevents workers from claiming another item. Requests already claimed are not cancelled; after they settle, unclaimed items receive a paused status and the modal becomes `paused`. Resume performs the same fresh reconciliation as retry, converts persisted files back to completed rows, and queues only unresolved audio. A provider failure takes precedence over a simultaneous pause so recovery remains explicit.

This cooperative approach is preferred over aborting fetches because cancellation does not guarantee cancellation of provider-side synthesis and could obscure successfully persisted audio. It also preserves the existing stop-on-failure queue model.

## Risks / Trade-offs

- **[Several requests can already be in flight when one fails]** → Limit concurrency to the established value of three, allow those requests to settle, and clearly distinguish failed from stopped rows.
- **[The Add All modal is not persisted across a refresh]** → Every provider and Library result is persisted by existing endpoints; reopening Add All or retrying reconstructs progress from current runs and curated links.
- **[Sharing the presentation could accidentally change LLM Audit styling or labels]** → Preserve the existing LLM Audit props and rendered states while extracting the common component, and add rendering tests for both consumers.
- **[A source conversation can change or disappear after the review]** → Reconcile before work, surface the specific row as failed, and do not begin the Library phase.
- **[Library additions can partially succeed]** → Preserve their existing non-transactional behavior, show each result, and make retry skip conversations already curated.
- **[Pause can be requested just as a worker completes]** → Read the pause signal before every claim; any item claimed before the signal is in flight and is allowed to settle, while later items remain paused.

## Migration Plan

No data migration is required. Ship the shared progress presentation, queue helper, and Add All reconciliation together. Existing reviews and runs remain compatible because readiness and retry are derived from fields already persisted. Rollback consists of restoring the previous Studio orchestration and modal; generated audio and Library entries remain valid.

## Open Questions

None. The established LLM Audit concurrency limit and persisted audio-file readiness rule are reused directly.
