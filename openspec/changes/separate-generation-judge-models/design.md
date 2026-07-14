## Context

Every generation path currently resolves one `textModel` and passes it through initial generation, quality triage, repair candidates, version picks, and re-rolls. As a result, a run does not distinguish the model that authored content from the model that judged it. The existing quality-control design explicitly chose this as a v1 simplification.

The Studio already has provider-grouped model options, provider-specific structured invocation, durable job persistence, and batched quality triage. Historical run and curated-set records predate quality labels in many cases. The historical pass must classify content without changing the conversation, audio, curation membership, ordering, or published learner library.

## Goals / Non-Goals

**Goals:**

- Let an operator choose independent generator and judge models for each new run, defaulting the judge to GPT-5.6-Sol (`codex:gpt-5.6-sol`).
- Verify both role-specific model paths before a generation job is created.
- Preserve role and resolved-version provenance for every model call and at run level.
- Label historical curated and saved-run conversations as `good`, `okay`, or `bad` through resumable, non-destructive work.
- Make historical judgments inspectable and idempotent.

**Non-Goals:**

- Change the current bounded repair/re-roll behavior for newly generated conversations; a newly generated `regenerate` verdict remains a dropped stage result.
- Repair, regenerate, remove, hide, reorder, recurate, revoice, or republish any conversation during historical labeling.
- Change learner-app behavior or require a published-library rebuild after a label-only pass.
- Guarantee a model remains available after a successful probe.

## Decisions

### D1. Persist distinct generator and judge identities, retaining the legacy generator field

`PracticeRun.textModel` remains the generator identity for backward compatibility. A new additive judge-model field records the requested and resolved judge identity for new runs; each exchange already records its actual provider/model and gains an explicit role where needed. Generation, repair candidates, and re-rolls use the generator. Triage and version picks use the judge.

This preserves old records and makes model-comparison queries unambiguous without inferring role from prompt text. Replacing `textModel` with a new paired shape was rejected because it would force a migration and break existing run views.

### D2. Use role-appropriate, disposable preflight probes

Before submitting a generation job, the modal sends the selected generator and judge to a server preflight endpoint. The generator probe uses the same structured conversation-generation path and validates one minimal usable conversation; the judge probe uses the same structured-quality path and validates its minimal JSON response. Neither probe writes a run, conversation, exchange, audit node, or job.

Both probes run for a selected model even if their IDs match, because the generator and judge exercise different prompts, instructions, and parsers. The UI shows individual progress and error results, and start is disabled until both succeed. The subsequent start endpoint resolves and validates both models again; preflight is an availability check, not a reservation. A provider failure after preflight remains a normal auditable generation failure.

Checking only the configured model list was rejected because it cannot detect authentication, quota, rate-limit, provider outage, or role-specific structured-output failures. Reusing a real batch generation as the probe was rejected because it would create unnecessary content and cost.

### D3. Historical labeling is a verdict-only batch flow

The backfill recomputes current deterministic vocabulary evidence, then submits bounded batches to the selected judge using the existing quality-triage rubric. It maps `pass` to `good`, `repair` to `okay`, and `regenerate` to `bad`. It does not enter repair, candidate-pick, or re-roll paths.

Each classified conversation receives additive review provenance: verdict, label, rationale, flags, judge model (including resolved version when supplied), rubric version, and review time. Existing quality labels are skipped by default; an explicit rejudge request is required to replace them. A `bad` historical label is visible metadata and never triggers deletion, concealment, or publishing behavior.

Reusing the full quality-control flow was rejected because repairs and re-rolls mutate or replace content. Applying labels without deterministic evidence was rejected because it would make historical judgments inconsistent with current triage and remove authoritative vocabulary context.

### D4. Backfill scope starts with curated content and can extend to saved runs

The Studio exposes a historical-labeling operation with a curated-library scope as the first/default operation, followed by an all-saved-runs scope for remaining legacy history. Scope, selected judge, counts, checkpoints, and failures are persisted. A run or curated batch is checkpointed only after labels have been atomically saved, so resume retries only unresolved conversations.

Curated records are updated in place only with additive label/provenance fields. The operation does not touch source audio, source-run locking, aggregate ordering, or the published manifest. Saved-run records receive the same additive fields. This offers immediate coverage for the active library while keeping broader historical work available without a bespoke migration script.

### D5. Treat historical labeling as serialized durable text work

Historical labeling uses the existing durable Studio-job lifecycle and the shared serialized text-work slot. Its checkpoints occur between judge batches; pause, resume, discard, restart recovery, idempotency, progress, and realtime events use existing job semantics. It is queued behind active generation work so a large backfill cannot compete with an operator's live generation calls.

Running labels synchronously in a request was rejected because hundreds of conversations and provider limits make it unreliable and non-resumable. A one-off filesystem script was rejected because it would not expose progress, model failures, provenance, or repeat-safe recovery in the Studio.

### D6. Use one dialogue-only rubric for every final quality label

Operational generation triage may still combine subjective findings with deterministic vocabulary evidence to decide whether repair is required. That operational decision is not the durable `good`/`okay`/`bad` label. After generation and any repair/pick work, the selected conversations receive a final dialogue-only judgment through the same versioned prompt used by historical rejudgment. The prompt receives only the delivered spoken dialogue and applies the same thresholds without generator-specific rules, preserved-label overrides, or target distributions.

`good` is based on successful discourse and learner value within beginner vocabulary constraints, not native-copyediting perfection. An isolated recoverable non-idiomatic expression, literal phrasing, ellipsis, abrupt detail, or plausible unstated inference may remain `good`; `okay` requires a defect that meaningfully impairs the intended exchange or a repeated/sustained pattern that noticeably degrades it. This avoids grading questions, translations, vocabulary coverage, or repair history while retaining `bad` for structurally unusable dialogue.

### D7. Keep historical rationale outside compact content records

Historical run and curated records retain their compact label fields. Studio reads the completed versioned backfill report as an audit index when a record has no inline `qualityReview`, so the quality-chip popup can show rationale, flags, judge, rubric, and review time without copying that provenance into every curated-set JSON entry. Inline reviews on newly generated conversations take precedence.

## Risks / Trade-offs

- [Preflight consumes provider calls and cannot reserve capacity] → Keep probes minimal, do not persist them, surface their cost/availability purpose, and revalidate at start.
- [A judge model can be unavailable from the option-list fetch] → Keep the recommended `codex:gpt-5.6-sol` as a resolvable default and show preflight failure rather than silently substituting a different judge.
- [Historical judgments can differ from original human expectations] → Persist rationale, flags, exact judge identity, and rubric version; skip labels by default so rejudgment is explicit.
- [Backfill competes for limited model capacity] → Serialize it with text work and checkpoint per batch.
- [Label fields reach curated storage] → Make them additive only and do not rebuild or alter the learner manifest during the operation.

## Migration Plan

1. Add additive request, run, conversation, exchange, and job fields while keeping legacy `textModel` and absent label data readable.
2. Release distinct model controls and role-specific preflight for new generation without rewriting prior runs.
3. Release the curated-library historical-label job, then allow an explicit all-saved-runs job. The default skips already labeled conversations.
4. Rollback consists of disabling new starts/backfills; persisted additive model and judgment metadata remains safely ignored by the earlier code. No rollback deletes labels or changes content.

## Open Questions

- None for the agreed scope. The initial historical pass is explicitly label-only and retains `bad` conversations.
