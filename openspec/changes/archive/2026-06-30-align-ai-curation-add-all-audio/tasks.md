## 1. Reusable Audio Batch Behavior

- [x] 1.1 Extract Add All planning helpers that reconcile recommendations against freshly loaded source runs, use `audioFileName` as the readiness check, detect missing sources, and recognize already-curated conversations.
- [x] 1.2 Implement a framework-independent three-worker audio queue that stops claiming new items after the first failure, allows in-flight requests to settle, and returns completed, failed, and stopped results.
- [x] 1.3 Add unit tests covering existing-audio skips, recommendation-only targeting across source runs, concurrency bounds, first-failure stopping, in-flight completion, and missing-source failures.

## 2. Shared Audio Progress UI

- [x] 2.1 Extract the reusable conversation audio summary/list from the LLM Audit stage while preserving its counts, status titles and icons, selection behavior, and active-item auto-scroll.
- [x] 2.2 Adapt the Add All progress model and modal to render the shared audio presentation during preparation and synthesis, including distinct complete, failed, and stopped rows.
- [x] 2.3 Retain a separate per-conversation Library phase in the modal with unambiguous waiting, working, already-added, done, and failed labels.
- [x] 2.4 Extend Studio rendering tests to verify equivalent LLM Audit/Add All audio states and the Add All transition to Library progress.

## 3. Add All Reconciliation and Recovery

- [x] 3.1 Replace the sequential generate-everything loop with the reconciled recommendation plan and stop-on-failure queue, updating modal progress as workers start and settle.
- [x] 3.2 Prevent the Library phase whenever any recommendation is missing, failed, or stopped, while preserving successful audio and exposing retry.
- [x] 3.3 Make every retry refresh persisted source state, skip conversations with audio files, resume stopped or failed audio, and enter the Library phase only after portfolio-wide audio readiness is confirmed.
- [x] 3.4 Reconcile Library state before adding, skip recommendations already curated, submit only unresolved additions through the existing validation endpoint, and preserve per-row retryable failures.
- [x] 3.5 Refresh runs, recommendations, curation history, Library balance, and publish status after completion or partial Library mutation so the Studio reflects persisted results.

## 4. Verification

- [x] 4.1 Run `npm run test:unit` and fix all regressions.
- [x] 4.2 Run `npm run build` to verify TypeScript and the Studio production bundle.
- [x] 4.3 Run `npm run library:check-published` to confirm the change does not alter curated or published learner content.
- [x] 4.4 Manually exercise Add All with a mixed ready/missing portfolio and an injected audio failure, confirming existing audio is untouched, new work stops, retry resumes, and Library additions start only after all audio is ready.

## 5. Explicit Start and Cooperative Pause

- [x] 5.1 Extend the reusable audio queue with a cooperative pause signal and paused results while preserving three-worker concurrency and failure precedence.
- [x] 5.2 Add deterministic queue tests proving pause starts no new work, waits for in-flight work, distinguishes pause from failure, and resumes through fresh planning.
- [x] 5.3 Extend Add All progress and modal controls with ready, pausing, and paused states plus Start generation, Pause, Pausing..., Resume, and all-audio-ready actions.
- [x] 5.4 Refactor Add All so opening the modal only reconciles state, explicit start/resume runs audio, and AI Curate/Re-curate remain free of audio side effects.
- [x] 5.5 Extend rendering tests for the complete control-state sequence and run the unit, build, and published-library checks.
- [x] 5.6 Exercise the ready/start/pause/resume flow in the browser and confirm pausing waits for active requests without starting queued work or entering the Library phase.
