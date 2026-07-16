## 1. Shared model and judgment data

- [x] 1.1 Extend shared request, run, conversation, exchange, quality, curated-record, and Studio-job types with additive generator/judge roles and historical `good`/`okay`/`bad` judgment provenance while preserving legacy `textModel` and absent labels.
- [x] 1.2 Add storage compatibility/defaulting for legacy run and curated data, including exact preservation of content, audio, source linkage, ordering, and publication state when only a historical judgment is written.
- [x] 1.3 Add unit coverage for role-model and historical-judgment serialization, resolved model versions, and legacy records without the new fields.

## 2. Generator and judge selection with preflight

- [x] 2.1 Add the GPT-5.6-Sol judge default (`codex:gpt-5.6-sol`) to model-selection defaults while retaining provider-grouped options and a clear unavailable-model state.
- [x] 2.2 Extend generation and workflow request validation/context resolution to accept independent generator and judge model IDs, resolving both again at start time.
- [x] 2.3 Implement a disposable server preflight that invokes and validates minimal generator-shaped and judge-shaped structured responses without persisting any run, exchange, audit node, or job.
- [x] 2.4 Add the generator and judge controls, per-role preflight progress/failure presentation, and start gating to the generation modal; retain the selected models in the client request/session presentation.
- [x] 2.5 Add API and UI tests for default judge selection, identical-model two-role probing, invalid selection, provider/auth/usage-limit failures, and the guarantee that failed preflight creates no job or run.

## 3. Role-specific generation quality control

- [x] 3.1 Refactor generation contexts and `generateTextBatch` to carry generator and judge models through standard, workflow, and library-complement entrypoints.
- [x] 3.2 Route initial generation, repair candidates, and re-rolls through the generator; route triage and version picks through the judge, including rerun-repair behavior for saved runs.
- [x] 3.3 Persist both selected model identities and resolved versions on new runs and expose role/model identity on the generation audit, run details, and per-call exchanges.
- [x] 3.4 Extend quality-control, Studio API, workflow, and UI tests to verify call routing, fallback behavior, legacy rendering, and inspectable role provenance.

## 4. Historical label-only backfill

- [x] 4.1 Add a versioned historical-labeling service that recomputes authoritative vocabulary evidence, batches triage through the selected judge, and atomically writes only label/verdict/rationale/flags/judge/rubric/time provenance.
- [x] 4.2 Map historical verdicts to `good`, `okay`, and `bad`; implement default skip behavior and explicit rejudge replacement without entering repair, pick, or re-roll flows.
- [x] 4.3 Add durable, serialized, resumable Studio job support for curated-library-first and all-saved-runs scopes, with idempotency, batch checkpoints, progress counts, pause/resume/discard, restart recovery, and provider failure reporting.
- [x] 4.4 Add Studio controls and progress/results presentation for starting, resuming, and inspecting historical label jobs, including scope, selected judge, skipped/rejudged counts, and failures.
- [x] 4.5 Add tests proving `bad` historical conversations remain visible and unchanged, labels do not alter dialogue/audio/order/source linkage/curation membership, completed batches survive failure and resume, and repeated non-rejudge jobs do not replace labels.

## 5. Verification and operational checks

- [x] 5.1 Run unit, API, and Studio UI test suites covering model probes, role routing, and historical-label job recovery.
- [x] 5.2 Run type checking and production builds for both Studio and learner applications.
- [x] 5.3 Exercise a curated-library historical-label dry run or fixture-backed end-to-end job and verify the published learner manifest is not rewritten or changed by the label-only pass.

## 6. Uniform final-label calibration

- [x] 6.1 Replace historical-label preservation overrides with a single versioned dialogue-only rubric calibrated to discourse success and meaningful learner impact.
- [x] 6.2 Apply that exact final-label prompt after new-generation repair and selection, retaining operational vocabulary/repair triage as a separate concern.
- [x] 6.3 Rejudge every Set 2+ saved conversation with GPT-5.6-Sol, apply only the direct results, and verify content preservation, uniform provenance, distributions, tests, and production build.

## 7. Quality-label presentation

- [x] 7.1 Present stored conversation quality labels consistently across Studio cards/workflow views and learner cards/navigation/details, omitting the badge for unlabeled records.
- [x] 7.2 Publish existing curated quality labels into the learner manifest and verify the rebuilt learner application.

## 8. Quality-label inspection and card metadata

- [x] 8.1 Remove redundant library-state metadata, normalize Studio card-header chip geometry, and keep the quality label directly beside source provenance on queue and curation cards.
- [x] 8.2 Add a keyboard-accessible Studio quality-review popup backed by inline review data or the separate historical audit index, without expanding curated-set JSON records.
