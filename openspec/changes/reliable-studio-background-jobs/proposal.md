## Why

Studio generation and audio work is currently attached to the browser session or an in-memory server job, so refreshes, multiple tabs, duplicate requests, and server restarts can hide work, repeat provider calls, overwrite run state, or leave stale generating statuses. Studio operators need durable, live, resumable background work from the moment they start an operation, without introducing any server dependency into the learner application.

## What Changes

- Add a durable Studio background-job system for run generation, balancing, library-complement generation, individual audio, whole-run audio, and Add All audio.
- Persist an in-progress run shell before the first provider call and expose it immediately in the Runs list with live stage and audio-count progress.
- Deliver job and run updates over a Studio-only server-sent event stream, with snapshot hydration after refresh or reconnect.
- Add a persistent Studio background-work tray and completion, failure, and interruption toasts across Studio routes.
- Deduplicate audio generation by source run and conversation across tabs, workflows, and repeated requests, while scheduling different conversations through the established three-worker pool.
- Persist completed workflow stages and support manual resume from the last durable checkpoint after a server restart marks active work interrupted.
- Make workflow starts idempotent and serialize all run mutations so retries and concurrent jobs cannot create duplicate runs or overwrite state.
- Write run metadata and generated audio through temporary files followed by atomic replacement.
- Keep the static learner application, curated content format, and published learner manifest unchanged.

## Capabilities

### New Capabilities
- `studio-background-jobs`: Durable Studio job lifecycle, realtime delivery, hydration, interruption recovery, idempotency, and background-work presentation.

### Modified Capabilities
- `content-generation`: Make generation and audio workflows immediately visible, durable across browser refreshes, deduplicated, race-free, live-updating, and manually resumable after server interruption.
- `curated-library`: Move Add All audio execution onto the durable shared Studio scheduler while preserving explicit operator start, pause, stop-on-failure, reconciliation, and Library gating behavior.

## Impact

- Affects the React Studio, Express API, shared Studio job/run types, run and audio persistence, workflow orchestration, and Studio tests.
- Adds Studio API endpoints for job snapshots, SSE updates, idempotent starts, and resume actions; existing synchronous long-running endpoints will become job-oriented or delegate to the shared scheduler.
- Does not add APIs to Practice, alter curated set JSON, or alter `public/library/library.json`.
- Uses native SSE and filesystem persistence; no WebSocket or external queue dependency is required.
