## Why

The reliable-studio-background-jobs work surfaced a class of defects that all share one root cause: the correctness rules of the Studio job system (which status transitions are legal, who may author progress labels, how a partially started batch recovers) live implicitly across many call sites instead of being enforced in one place. Each seam produced a real bug during development: a cancelled job could be revived by a late runner write until stickiness was patched in, a paused batch lost its completed-versus-total label, a batch whose child enqueue failed partway was stuck unresumable, and the SSE and hydration notification paths disagreed about which jobs deserve toasts. This change hardens those invariants centrally and writes them down so future work cannot reintroduce the same defect classes.

## What Changes

- Add a single guarded transition function for Studio job status changes that enforces an allowed-transition table (terminal states are final; `pausing` may only settle to `paused`, a terminal state, or back to `running` on resume) and route all existing status writers through it.
- Derive job progress labels from durable state (`status`, `progress`, active stage) in one shared function instead of hand-authoring label strings at every writer, so counts can never be lost by an overwriting update.
- Extract one child-reconciliation routine for audio parents, used by both batch start and resume, so a start interrupted partway through child enqueue is repaired by the same code path that resume already uses.
- Unify the toast eligibility policy (which job events notify the operator) into one predicate used by both the realtime event path and the reload hydration path.
- Add API-level tests that exercise the pause, resume, cancel, and start endpoints against the real Express app, and a filesystem stress test that reads run state concurrently with atomic replacement writes.
- Document the Studio job system invariants (single-writer rules, transition table, label derivation, Windows rename semantics, dev-restart behavior) in the change design and in `server/STUDIO_JOBS.md`.
- Studio only; no learner application, curated content, or published manifest changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `studio-background-jobs`: Add a job lifecycle integrity requirement - status changes follow a declared transition table with final terminal states, progress labels are derived from durable progress data and never lose completed-versus-total counts, interrupted batch starts are repaired on resume by shared reconciliation, and operator notification policy is identical regardless of whether a terminal transition is observed live or after a reload.

## Impact

- Affects `server/studioJobs.ts` (transition guard), `server/audioScheduler.ts` (label derivation, shared reconciler), `server/index.ts` (status writers, endpoint tests), `src/App.tsx` (shared toast predicate already partially extracted), and `server/STUDIO_JOBS.md`.
- No API surface changes; endpoint behavior becomes stricter only where transitions were previously illegal (for example reviving a cancelled job).
- Builds on the in-flight `reliable-studio-background-jobs` change and should land after it; its delta spec extends the same `studio-background-jobs` capability.
- No changes to Practice, curated set JSON, or `public/library/library.json`.
