## Why

Generation and quality judgment currently use the same selected model, which makes it difficult to compare generated runs fairly and ties quality assessment to the generator's availability. Historical conversations created before quality control also lack the good/okay/bad labels now needed for review.

## What Changes

- Separate the generation-model selection from the quality-judge selection for new Studio runs. The judge defaults to GPT-5.6-Sol (`codex:gpt-5.6-sol`).
- Route content-producing calls (initial generation, repairs, and re-rolls) through the generator, and judgment calls (triage and version picks) through the judge; retain both model identities in run and exchange provenance.
- Require a successful, role-appropriate probe of both selected models before a new run can start, with actionable per-model failure feedback.
- Add a durable, resumable historical quality-labeling operation. It labels existing curated conversations first and can label all saved-run history, but it never changes, removes, hides, repairs, regenerates, reorders, or republishes conversation content.
- Extend historical labels to `good`, `okay`, or `bad`, recording the quality verdict, rationale, flags, judge identity, rubric version, and review time. Existing labels are skipped unless an operator explicitly requests rejudgment.
- Use one versioned dialogue-only final-label rubric for both historical rejudgment and the final labels on future generations, so labels remain comparable independently of repair routing or generator identity.
- Show a conversation's stored quality label wherever that conversation is presented in Studio or the learner app.
- Make Studio quality-label cards compact and consistent: remove redundant library-state metadata, align header chips, place the label next to source provenance in curation views, and expose stored review rationale/provenance in an on-hover quality popup without expanding curated JSON records.

## Capabilities

### New Capabilities

- `historical-quality-labeling`: Non-destructive, resumable quality labeling and provenance for existing curated and saved-run conversations.

### Modified Capabilities

- `content-generation`: Collect, validate, probe, persist, and present distinct generator and judge model selections for new runs.
- `generation-quality-control`: Apply the selected judge only to quality decisions while retaining the generator for content-producing quality-control calls.
- `curated-library`: Preserve historical quality labels and their provenance on curated conversations without changing their content or publication state.
- `studio-background-jobs`: Support durable, resumable, idempotent historical quality-labeling work and its progress presentation.

## Impact

- Studio generation modal and its generation/preview/start APIs.
- Shared run, conversation, request, exchange, quality-audit, curated-set, and job types; existing persisted data remains readable.
- Text-model resolution and provider invocation paths for model probes and role-specific generation/quality calls.
- Run and curated-set persistence, Studio job recovery/progress UI, and generation audit/run-detail displays.
- The learner application and existing conversation text, audio, order, curation membership, and published library content are not changed by the historical labeling operation.
