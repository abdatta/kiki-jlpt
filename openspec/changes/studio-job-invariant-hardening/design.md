## Context

The durable Studio job system (introduced by `reliable-studio-background-jobs`) persists each job as a JSON file, serializes writes per job through `updateStudioJob`, and broadcasts revisions over SSE. It works, but its correctness rules are enforced only by the discipline of each caller:

- Roughly twenty call sites write `status` directly through `updateStudioJob`. Terminal finality for `cancelled` was retrofitted as a special case inside `updateStudioJob`; nothing guards other illegal transitions (`succeeded` back to `running`, `paused` overwritten by a stale runner write, `updateWorkflowJob` force-writing `running`).
- `stageLabel` is authored prose at every writer. `updateParent` once replaced `2/9 audio generated` with plain `Audio paused`, losing the count; the fix duplicated count-formatting into more writers rather than removing the duplication.
- Audio batch start enqueues children in a loop. When a transient filesystem error killed the loop partway, the parent was stranded with fewer children than its total and could not converge; resume gained a self-healing reconciler, but start still uses its own loop.
- The "which job events toast the operator" policy exists twice (SSE handler and reload hydration) and has already diverged once.
- The Express endpoints and the concurrent filesystem behavior (atomic replace on Windows versus concurrent readers) have no test coverage; both produced user-visible bugs.

This change is a hardening pass over the same code, intended to land after `reliable-studio-background-jobs` and before that change is archived.

## Goals / Non-Goals

**Goals:**

- One guarded transition function through which every job status change flows, enforcing a declared transition table.
- One label-derivation function so completed-versus-total counts can never be lost by a status write.
- One child-reconciliation routine shared by audio batch start and resume.
- One toast-eligibility predicate shared by the realtime and hydration paths.
- Test coverage for the job command endpoints and for concurrent read/replace filesystem behavior.
- Written invariants in `server/STUDIO_JOBS.md` so future changes preserve them.

**Non-Goals:**

- No rearchitecture: job files, SSE delivery, the three-worker audio pool, and the generation gate keep their current shapes.
- No API surface changes and no new job statuses or kinds.
- No learner application, curated content, or published manifest changes.
- No attempt at exactly-once provider execution across process death (documented crash boundary stands).

## Decisions

1. **Transition table lives in `studioJobs.ts` as data, enforced in `updateStudioJob`.** A `Record<StudioJobStatus, StudioJobStatus[]>` names the legal next statuses (terminals map to an empty list; `pausing` may settle to `paused`, `running`, or a terminal). `updateStudioJob` compares the updater's result against the table: an illegal status change is dropped (the current job is returned unchanged, matching today's sticky-cancelled behavior) rather than thrown, because callers are fire-and-forget runners whose late writes are expected noise, not bugs. Alternative considered: a separate `transitionStudioJob(jobId, to, patch)` API and leaving `updateStudioJob` unguarded - rejected because nothing would stop new code from calling the unguarded path.

2. **Labels are derived, not authored.** A `deriveStageLabel(job)` function formats the display label from `status`, `progress`, and the active stage; writers set data, not prose. Kind-specific phrasing (audio versus generation wording) keys off `job.kind`. Free-text labels remain only where they carry information state cannot (transient labels such as `Waiting for earlier generation`), and those are whitelisted in the derivation function. Alternative considered: deriving labels client-side only - rejected because labels also land in persisted job files and API responses that tests and operators read.

3. **Start calls the resume reconciler.** `createAudioBatch` and `createCrossRunAudioBatch` delegate child creation to the same `reconcileAudioChildren(parent)` routine resume uses (enqueue missing children from the parent's persisted request, mark children whose audio already exists succeeded). A start interrupted partway is then repaired by any later start retry or resume with no special casing.

4. **Toast policy is one exported predicate.** `shouldNotifyJobEvent(job)` (top-level job, terminal-or-interrupted status) moves next to the shared types or a small client module and both the SSE handler and hydration loop call it.

5. **Endpoint tests run the real Express app in-process.** The app is exported (listen split from construction) and tests drive `pause`/`resume`/`cancel`/start routes with isolated temp storage and the fake audio executor, asserting persisted job files rather than HTTP bodies alone. Alternative considered: spawning the server as a subprocess - rejected as slower and harder to isolate.

6. **Filesystem stress test, not mocks.** A test hammers `mutateRun` while concurrently calling `readRun` for a few hundred iterations; it fails if any read surfaces ENOENT/EPERM after retries. This pins the Windows atomic-replace behavior that caused the original ENOENT bug.

## Risks / Trade-offs

- [Dropped illegal writes hide runner bugs] → The guard logs each dropped transition (job id, from, to) so a misbehaving writer is visible in server output instead of silently ignored.
- [Label derivation changes exact strings] → Existing tests assert current label text; update assertions alongside the derivation function in the same task, and keep the user-visible phrasing identical where tests or operators depend on it.
- [Exporting the app for tests touches server startup] → Keep `index.ts` as the entry point that imports and listens; construction moves, behavior does not. Verify with `npm run test` and a manual dev-server start.
- [Transition table too strict for an unforeseen path] → The table is data; loosening it is a one-line, reviewable change with the invariant doc updated in the same commit.
