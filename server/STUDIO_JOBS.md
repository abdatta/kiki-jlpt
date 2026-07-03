# Studio Background Jobs

Studio generation and speech work is persisted under `outputs/studio-jobs/`. Each JSON file is the durable source of truth for one parent or child job. Completed practice runs remain under `outputs/runs/`; Practice continues to consume only the published static library.

## Recovery

- Browser refresh and navigation do not stop jobs. Studio hydrates `/api/studio/snapshot` and reconnects to `/api/studio/events`.
- API startup marks queued, running, and pausing jobs interrupted. It never resumes provider work automatically.
- Use the Studio Resume action to continue an interrupted generation checkpoint or to reconcile and queue unresolved audio.
- Use the Studio Discard action on a paused, interrupted, or failed audio parent to cancel its unresolved children. Completed audio is kept, the job becomes terminal (`cancelled`), and it can no longer be resumed.
- A provider call interrupted after the provider accepted it but before its result was persisted may run again. Provider-side idempotency is unavailable, so exactly-once execution cannot be guaranteed across process death.

## Scheduling

- Text generation (run generation, workflow generation, library complement) is serialized: one job holds the global generation slot, later starts wait queued in FIFO order.
- A queued or running generation job can be paused or discarded. Runners honor this at durable checkpoints; a provider response already in flight is discarded, not persisted. Cancelled is terminal and sticky - late runner writes cannot revive the job.
- Speech work uses three global workers.
- Active speech is deduplicated by `runId:conversationId` across tabs and parent workflows.
- Parent stop-on-failure and pause state do not stop unrelated parent jobs.
- Existing audio remains in place until a complete replacement has been written and renamed.

## Invariants

These rules are enforced in code (`studioJobs.ts`, `audioScheduler.ts`, `atomic.ts`) and must survive future changes:

- **Status transitions follow the table in `studioJobs.ts` (`LEGAL_TRANSITIONS`).** Terminal statuses are final: `succeeded` accepts payload-only updates, `cancelled` is fully frozen, and `failed` stays resumable. A write attempting an illegal transition is dropped unchanged (no revision bump, no SSE event) and logged with job id, from-status, and to-status. Writers submit intent; the persistence layer decides.
- **Progress labels are derived, not authored.** `deriveStageLabel` in `studioJobs.ts` formats every count-bearing state from `status` + `progress`, so no status write can lose completed-versus-total counts. Free-text labels are allowed only for transient information state cannot express (waiting-for-slot, resuming, runner stage names).
- **One writer per file, serialized per key.** Run mutations go through `mutateRun`'s per-run queue; job writes through `updateStudioJob`'s per-job queue. Never write these files directly.
- **Starts and resumes converge through one reconciler.** `reconcileAudioChildren` recreates children missing versus the parent's persisted request. Start paths do not reuse existing audio (replace semantics); resume paths do. A batch interrupted mid-start is repaired by any later idempotent start retry or resume.
- **Windows atomic replacement has a retry contract.** `atomicWriteFile` retries the gap-free rename before falling back to the backup swap (which briefly leaves the destination missing); readers (`readRun`, `readStudioJob`) retry transient `ENOENT`/`EPERM`/`EBUSY` so they self-heal across that window. New readers of these files must use the same helpers.
- **Operator notification policy lives in `src/studioNotifications.ts`.** Children never toast on their own; both the realtime and hydration paths call the same predicate.
- **Dev restarts interrupt live jobs.** `tsx watch` restarts the API on every server-file edit, and startup marks queued/running/pausing jobs interrupted. Do not debug job behavior while editing server files.

## Retention

Job files are retained as local audit records. The default Studio snapshot returns all active/interrupted/failed work plus a bounded recent terminal window. Job files may be archived or removed manually only when no related work is active.
