## 1. Guarded Status Transitions

- [ ] 1.1 Declare the status transition table in `server/studioJobs.ts` (terminals final; pausing settles to paused, running, or a terminal) and enforce it inside `updateStudioJob`, dropping illegal transitions unchanged and logging job id, from-status, and to-status.
- [ ] 1.2 Replace the ad-hoc sticky-cancelled special case with the table, and remove now-redundant caller-side guards (resume cancelled checks keep their operator-facing 409s).
- [ ] 1.3 Fix `updateWorkflowJob` to submit its intended status through the guard instead of preserving statuses inline, and audit all `updateStudioJob` callers for writes that relied on illegal transitions.
- [ ] 1.4 Add unit tests: terminal finality for succeeded/failed/cancelled, pausing settlement paths, and that a dropped write emits no SSE revision.

## 2. Derived Progress Labels

- [ ] 2.1 Implement `deriveStageLabel(job)` keyed on kind, status, progress, and active stage, with a whitelist for transient free-text labels (for example waiting-for-slot and resuming labels).
- [ ] 2.2 Route `updateParent`, `interruptActiveStudioJobs`, runner stage updates, and pause/resume/cancel endpoints through the derivation instead of authoring label strings, keeping current user-visible phrasing.
- [ ] 2.3 Update existing label assertions in `server/studioJobs.test.ts` and `src/studioCuration.test.tsx`, and add a test that pausing, interrupting, and discarding a mid-progress batch all retain completed-versus-total counts.

## 3. Convergent Batch Starts

- [ ] 3.1 Extract `reconcileAudioChildren(parentJobId)` from the resume path in `server/audioScheduler.ts` and call it from `createAudioBatch` and `createCrossRunAudioBatch` in place of their inline enqueue loops.
- [ ] 3.2 Add a test that a start whose child creation is interrupted partway converges after an idempotent start retry and after a resume, with no duplicate provider calls.

## 4. Unified Notification Policy

- [ ] 4.1 Move the toast eligibility predicate into one shared module and use it from both the SSE job handler and the reload hydration loop in `src/App.tsx`.
- [ ] 4.2 Add a component-level test asserting parent-only, deduplicated notification for a batch whose children reached terminal states.

## 5. Endpoint And Filesystem Coverage

- [ ] 5.1 Split Express app construction from listening so tests can import the app, keeping `npm run start` and `npm run dev:api` behavior identical.
- [ ] 5.2 Add endpoint tests with isolated temp storage and the fake audio executor covering pause, resume, cancel, and idempotent start for audio parents and generation jobs, asserting persisted job files.
- [ ] 5.3 Add a concurrency stress test that interleaves `mutateRun` and `readRun` for several hundred iterations and fails on any surfaced transient filesystem error.

## 6. Written Invariants And Verification

- [ ] 6.1 Document the invariants in `server/STUDIO_JOBS.md`: the transition table, label derivation ownership, single-writer rules per file, Windows atomic-replace semantics and reader retries, and that dev server restarts interrupt live jobs.
- [ ] 6.2 Run `npm run test` and start the dev server for a manual pass over pause, resume, discard, and queued generation flows in the browser.
