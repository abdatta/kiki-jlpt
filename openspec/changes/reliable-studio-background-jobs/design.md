## Context

The Studio currently has three different long-running execution models. Balanced workflows are server-owned but tracked only in an in-memory map; standard generation and complement generation hold an HTTP request open; and Add All owns a three-worker queue in React. Whole-run audio has server-side workers but the initiating page polls for progress. Browser refresh therefore loses live attachment, server restart loses workflow identity, and repeated or cross-tab audio requests can invoke speech synthesis more than once for the same conversation.

Run persistence has started to serialize `updateConversation`, but many workflow and bulk-audio paths call `saveRun` directly. JSON and audio are also written directly to their final paths. The static Practice application consumes only published assets and must remain independent of the Studio API.

## Goals / Non-Goals

**Goals:**

- Persist operator intent before the first external provider call and make it visible immediately in Studio.
- Continue work through browser refresh, navigation, and multiple tabs while keeping every tab consistent.
- Deduplicate speech synthesis per run and conversation and cap aggregate speech concurrency at three.
- Preserve completed generation stages and audio, and resume only unresolved work.
- Detect server restart, expose interrupted work, and require explicit manual resume.
- Serialize and atomically persist run, job, and audio state.
- Provide one Studio snapshot and SSE model for the Runs list, workflow audit, background tray, and toasts.

**Non-Goals:**

- Continuing an external provider call across an API process restart.
- Guaranteeing exactly-once provider execution when the process dies after a provider accepts a call but before its result is persisted.
- Adding a distributed queue, database, WebSocket dependency, or multi-host coordination.
- Changing Practice runtime behavior, curated set formats, or the published learner manifest.
- Automatically resuming interrupted work after restart.

## Decisions

### 1. Introduce one filesystem-backed Studio job model

All long-running run generation and audio work will use a common `StudioJob` lifecycle. Jobs have a stable id, idempotency key, kind, status, stage records, optional parent operation, associated set/run/conversation ids, progress counters, error, timestamps, and monotonic revision. Statuses are `queued`, `running`, `pausing`, `paused`, `interrupted`, `succeeded`, and `failed`; stages use pending, running, succeeded, failed, skipped, and interrupted states.

Job records will live below `outputs/studio-jobs/`. A start request allocates both job id and run id and persists the job before dispatching provider work. The run id remains stable through completion. This was chosen over making all `PracticeRun` content optional: completed runs retain their existing strong schema, while the Studio Runs list can merge durable job summaries with completed runs.

An in-memory-only registry was rejected because refresh hydration and restart recovery require durable truth. SQLite or an external queue was rejected as unnecessary for a local, single-process Studio.

### 2. Represent an in-progress run with a job-backed run shell

The Studio Runs summary endpoint will return a discriminated summary for completed runs and job-backed run shells. A shell contains the stable run id, set, model, requested count, lifecycle status, current stage label, progress, and timestamps. It appears in the Runs column immediately and is replaced or enriched by the completed `PracticeRun` without changing identity.

Generation checkpoints persist the primary exchange and normalized conversations as soon as the generator stage completes, then the balancing exchange and combined conversations when balancing completes. Resume starts at the first incomplete stage. Standard text generation and library-complement generation use the same shell and single-stage checkpoint model.

### 3. Make starts idempotent

The browser creates an operation UUID before submitting a start request. The server persists it as an idempotency key and returns the existing job for repeated requests with that key. This covers double clicks, retries after a lost response, and refresh recovery without preventing an operator from intentionally starting another run with a new key.

### 4. Centralize audio in a three-slot server scheduler

Individual audio, workflow audio, whole-run audio, and Add All audio submit child jobs to one scheduler. The active deduplication key is `runId:conversationId`. If queued or running work already owns that key, later requests attach to the existing child job rather than calling the provider again.

The scheduler runs at most three speech calls globally, matching the established workflow and Add All behavior. Parent operations retain their own stop policy: a failure stops unstarted children belonging to that parent, but does not stop unrelated jobs. Pause is cooperative; running calls settle, while unclaimed children remain paused. Existing audio is complete when `audioFileName` exists and is preserved in resume mode.

Unlimited concurrency was rejected because the current product and tests already establish a limit of three, and bounded work makes provider pressure and pending status predictable.

### 5. Use a single mutation coordinator and atomic files

All run mutations will pass through a per-run coordinator that reads the latest state, applies a mutation, recomputes derived status where needed, and atomically replaces `run.json`. Direct workflow calls to `saveRun` will be removed or limited to initial creation under the same coordinator. Job JSON uses the same temp-file-and-rename strategy.

Speech output is written to a job-specific temporary file, validated, and renamed to the conversation's final filename only after success. Regeneration leaves the prior final audio intact until replacement succeeds. Active-job checks are enforced server-side before edit, delete, regenerate, or Library actions.

### 6. Use snapshot hydration plus SSE

Studio mounts by fetching a snapshot containing run summaries and active/recent jobs, then opens a native `EventSource` stream. Every event carries job id, revision, event id, event type, and the changed summary or entity. Clients ignore revisions they have already applied. Reconnect performs another snapshot hydration, so SSE history is not the source of truth and the server need not retain an unbounded event log.

The stream is one-way and native SSE fits the update pattern without a new dependency. WebSockets were rejected because commands continue to use ordinary HTTP endpoints. Polling remains a fallback only when SSE is temporarily disconnected.

### 7. Derive all Studio background presentation from durable state

The Runs column shows a spinner and stage text for active shells, including Initial set generation, Balancing set, and `2/9 audio generated`. Interrupted and failed entries remain visible with appropriate actions. The workflow audit and conversation cards consume the same job snapshot.

A Studio-only background tray remains visible across Studio routes and summarizes running and queued work. Terminal events create success, failure, or interruption toasts. Toasts are deduplicated by event id per tab; hidden tabs retain the durable tray state and do not need to replay every old toast. Practice never mounts the job client.

### 8. Mark work interrupted on startup and resume manually

At API startup, persisted `running` or `pausing` jobs and stages become `interrupted`; no provider work starts automatically. Resume validates current source state, preserves completed checkpoints and audio, creates no duplicate child audio job, and restarts only the interrupted or pending stage. An interrupted provider call may be repeated because provider-side idempotency is unavailable; the UI and audit will make that boundary explicit.

## Risks / Trade-offs

- **A provider accepted work immediately before process death** -> Resume may repeat that one interrupted call; persist results immediately and document that exact-once execution cannot cross process failure.
- **SSE disconnects or events arrive out of order** -> Hydrate snapshots on reconnect and apply only increasing entity revisions.
- **A job record and run update cannot be committed transactionally together** -> Serialize both under the run coordinator, use atomic replacement, and reconcile job/run truth on startup.
- **Three global workers can let one large parent dominate** -> Claim children round-robin by parent operation rather than draining one parent first.
- **Terminal jobs accumulate** -> Keep durable audit records but return only active and a bounded recent-terminal window in the default snapshot.
- **Migrating Add All changes browser-owned pause behavior** -> Preserve explicit start, cooperative pause, stop-on-failure, and fresh reconciliation in server job commands and regression tests.

## Migration Plan

1. Add job types, atomic persistence, startup reconciliation, and the per-run mutation coordinator without changing existing endpoints.
2. Add snapshot/SSE APIs and Studio client state, then render job-backed run shells and the background tray.
3. Move generation entrypoints to durable jobs and add manual resume.
4. Move all audio entrypoints to the shared scheduler, then migrate Add All orchestration.
5. Remove client polling and obsolete in-memory workflow storage after parity tests pass.

Existing completed runs remain compatible. On rollback, completed run and audio files remain valid; unfinished job records can be ignored by the old application. No curated or learner-content migration is required.

## Open Questions

None. The agreed defaults are native SSE, manual restart recovery, a global audio concurrency of three, immediate run-shell visibility, and Studio-only scope.
