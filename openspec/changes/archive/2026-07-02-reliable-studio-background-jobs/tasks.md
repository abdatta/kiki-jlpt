## 1. Durable Job And Run Foundations

- [x] 1.1 Add shared Studio job, stage, progress, run-shell summary, snapshot, event, and command response types without adding them to Practice entrypoints.
- [x] 1.2 Add filesystem job storage under `outputs/studio-jobs` with idempotency-key lookup, monotonic revisions, bounded recent-terminal listing, and temp-file atomic replacement.
- [x] 1.3 Replace fragmented run writes with one exported per-run mutation coordinator and migrate every workflow, audit, audio, edit, curation-link, reanalysis, and delete path away from uncoordinated `saveRun` calls.
- [x] 1.4 Make run JSON and generated audio replacement atomic, including job-specific temporary audio files that preserve existing final audio until successful rename.
- [x] 1.5 Add startup reconciliation that marks persisted running/pausing jobs and stages interrupted, reconciles job/run checkpoints, and never starts provider work automatically.
- [x] 1.6 Add unit tests for job persistence, idempotent lookup, revision ordering, atomic replacement failure, per-run concurrent mutation preservation, and startup interruption recovery.

## 2. Shared Audio Scheduler

- [x] 2.1 Implement a server-owned audio scheduler with a global concurrency limit of three, fair parent-operation claiming, and durable queued/running/terminal child states.
- [x] 2.2 Deduplicate active audio by `runId:conversationId` so individual, workflow, whole-run, and Add All callers attach to one child job.
- [x] 2.3 Implement parent-scoped stop-on-failure and cooperative pause/resume while allowing already-running provider calls to settle and unrelated parents to continue.
- [x] 2.4 Reconcile audio readiness from persisted `audioFileName`, preserve completed files in resume mode, and retry only unresolved or interrupted child work.
- [x] 2.5 Enforce active-job conflict checks for edit, delete audio, regenerate, add to Library, remove/delete run, and other mutations that could invalidate running work.
- [x] 2.6 Add deterministic scheduler tests for global concurrency, fairness, cross-caller deduplication, parent-scoped failure, pause, refresh-independent execution, and restart reconciliation.

## 3. Durable Generation Workflows

- [x] 3.1 Allocate and persist an idempotent job-backed run shell before standard, balanced-workflow, or library-complement provider calls.
- [x] 3.2 Persist primary generation exchange and normalized conversations immediately, then persist balancing input/output and combined conversations as a separate checkpoint.
- [x] 3.3 Route workflow audio through the shared scheduler and persist live generated/requested counts and per-conversation audit nodes as children settle.
- [x] 3.4 Add manual resume commands that validate current state and continue standard, complement, or balanced generation from the first incomplete checkpoint.
- [x] 3.5 Preserve failed and interrupted shells with model, set, requested count, completed checkpoints, errors, and retry/resume eligibility instead of discarding pre-run work.
- [x] 3.6 Add workflow tests for immediate shell visibility, lost-response idempotency, refresh continuity, generator and balancer checkpoint resume, audio progress, failure, and manual restart recovery.

## 4. Studio Snapshot And Realtime API

- [x] 4.1 Add a Studio snapshot endpoint that merges completed run summaries with active, interrupted, failed, and recent terminal job-backed run shells.
- [x] 4.2 Add a native SSE endpoint with heartbeat handling and sequenced job/run events carrying entity revisions.
- [x] 4.3 Emit events after every durable job, stage, run, and audio-child transition, with persistence remaining authoritative if delivery fails.
- [x] 4.4 Add HTTP commands for idempotent job start, job detail, pause, resume, and any required retry while retaining actionable conflict and validation responses.
- [x] 4.5 Add API tests for snapshot hydration, SSE event shape/order, reconnect convergence, command idempotency, and multi-tab-equivalent duplicate requests.
- [x] 4.6 Add a discard (cancel) command for paused, interrupted, or failed audio parents that cancels unresolved exclusive children, keeps completed audio, blocks later resume, and unpins the job from the tray.
- [x] 4.7 Serialize LLM text-generation jobs through a FIFO generation slot with cooperative pause/discard checkpoints in the runners, sticky terminal cancelled status at the persistence layer, and pause/resume/discard commands and tray controls for generation jobs.

## 5. Studio Live Runs And Background Presentation

- [x] 5.1 Add a Studio-only job client that hydrates the snapshot, opens `EventSource`, applies only newer revisions, reconnects with snapshot recovery, and exposes connection status.
- [x] 5.2 Merge job-backed shells into the Runs column immediately with a spinning icon and live labels for initial generation, balancing, queued audio, `completed/requested` audio, interruption, failure, and completion.
- [x] 5.3 Drive workflow audit panels, run cards, and conversation audio states from the shared job snapshot instead of request-local polling or optimistic-only state.
- [x] 5.4 Add a persistent Studio background-work tray across Studio routes with running and queued summaries, expandable job details, and pause/resume actions where supported.
- [x] 5.5 Add success, failure, and interruption toasts keyed by event id so each terminal transition appears once per tab, including completion while viewing another Studio route.
- [x] 5.6 Remove obsolete workflow and whole-run polling after SSE parity is verified, while retaining snapshot retry as the realtime fallback.
- [x] 5.7 Add component tests for immediate run shells, spinner/stage changes, audio counts, tray persistence across routes, toast deduplication, interruption/resume, and SSE reconnect hydration.
- [x] 5.8 Make tray entries clickable so each job restores its originating foreground UI (run detail, pipeline audit, Add All dialog), and replace the tray header with per-job status icons plus determinate or indeterminate progress bars.

## 6. Add All And Existing Audio Paths

- [x] 6.1 Move Add All audio planning and execution from the React-owned queue to a durable parent job while retaining explicit operator start and the existing recommendation subset.
- [x] 6.2 Reconnect the Add All modal to durable parent/child state so close, navigation, refresh, another tab, pause, resume, and failure all preserve observable progress.
- [x] 6.3 Keep the Library-add phase gated on fresh portfolio-wide audio readiness and retain retry reconciliation that skips existing audio and existing curated links.
- [x] 6.4 Route individual conversation audio and whole-run replace/resume endpoints through the scheduler, returning or attaching to jobs instead of holding long-running HTTP requests open.
- [x] 6.5 Update existing Add All and audio tests to verify durable orchestration without regressing stop-on-failure, pause, resume, existing-audio detection, or Library gating.

## 7. Verification And Compatibility

- [x] 7.1 Run unit tests and add integration coverage that concurrently completes several conversations in one run without lost job, audit, or audio state.
- [x] 7.2 Exercise browser refresh and multi-tab scenarios during generator, balancer, individual audio, whole-run audio, and Add All stages, confirming automatic status and toast updates.
- [x] 7.3 Exercise API restart during every stage, confirming visible interrupted shells, no automatic provider calls, and manual resume from the last durable checkpoint.
- [x] 7.4 Run `npm run test`, `npm run build:practice`, and `npm run library:check-published`, confirming Practice makes no Studio API or SSE connection and published formats remain unchanged.
- [x] 7.5 Document the exact-once crash boundary, job retention behavior, recovery controls, and operational location of durable Studio job records.
