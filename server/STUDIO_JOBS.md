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

## Retention

Job files are retained as local audit records. The default Studio snapshot returns all active/interrupted/failed work plus a bounded recent terminal window. Job files may be archived or removed manually only when no related work is active.
