## Why

AI Curation's Add All workflow currently attempts audio generation independently for every recommendation, can regenerate conversations that already have usable audio, and continues issuing speech requests after a failure. This is inconsistent with the LLM Audit bulk-audio flow, wastes provider work, and makes partial failures harder to understand and recover from.

## What Changes

- Make Add All classify each recommended conversation from current persisted run state and generate audio only for recommendations without a usable audio file.
- Stop starting additional audio work after the first synthesis failure, while allowing already-started work to settle and preserving successful audio.
- Keep the Library phase gated on complete audio readiness; when audio is incomplete, identify failed and unstarted conversations and offer a retry that rechecks persisted state and resumes only missing audio.
- Make Add All open a reconciled portfolio preview without starting speech generation; require an explicit modal action to start missing audio or proceed when all audio is already ready.
- Let the operator cooperatively pause an active audio batch: stop claiming new work, allow the current requests to settle, show `Pausing...`, and offer `Resume` for the remaining conversations.
- Replace the current table-like Add All audio presentation with the same status language and conversation-list behavior used by LLM Audit bulk audio, including live counts, active/failed/stopped/completed states, and automatic visibility of active work.
- Retain a distinct Library-add phase and report its per-conversation progress after all recommended audio is ready.
- Add regression coverage for existing-audio detection, stop-on-failure behavior, retry/resume behavior, and the revised progress UI.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `curated-library`: Refine Add All so it uses persisted audio-file readiness, follows the LLM Audit stop-and-resume batch semantics, and presents equivalent observable audio progress before adding the portfolio.

## Impact

- Studio only; the learner application is unaffected.
- Affects the React AI Curation Add All orchestration and progress modal, plus shared queue control needed to make stop-on-failure and cooperative pause behavior authoritative and testable.
- Reuses existing run audio status concepts and speech-generation endpoints where practical; no new external dependency is expected.
- Curated source files and published learner-library formats do not change. Library additions continue through the existing validation path, and publication remains a separate operator action.
