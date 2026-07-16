## 1. Label provenance model

- [x] 1.1 Extend the shared conversation quality-review metadata with a backward-compatible decision source for `triage`, `pick`, `gate`, and `fallback`, making model-specific provenance conditional where no model directly assigned the label.
- [x] 1.2 Add quality-control helpers that convert triage verdicts and pick outcomes into durable `good`/`okay` labels with rationale, flags, judge identity, resolved version, rubric version, confidence, and review time where applicable.
- [x] 1.3 Preserve gate-only and provider-fallback rationales as explicitly non-model provenance while keeping existing compact quality, decision, selected-version, confidence, and flag fields compatible with saved and curated records.

## 2. Remove redundant final labeling

- [x] 2.1 Update `runQualityControl` to persist labels at triage or selection time and remove the post-selection historical-label prompt, judge invocation, label overwrite, final-label exchange, and run-stopping relabel failure.
- [x] 2.2 Stop creating and publishing `final-label` nodes for new standard, workflow, and library-complement jobs while retaining the persisted call-kind and reader compatibility for older runs.
- [x] 2.3 Verify interrupted workflow resume reuses existing checkpoints without waiting for or replaying a final-label step, including compatibility with checkpoints that already contain historical final-label nodes or exchanges.
- [x] 2.4 Keep the reusable dialogue-only historical labeling helper and maintenance backfill path without automatically invoking them after new generation.

## 3. Correct audit graph ordering

- [x] 3.1 Update stage-lane composition so pass 1 is followed by pass 2 and any stored compatibility final-label node is rendered after both passes rather than between triage and repair.
- [x] 3.2 Keep the deterministic run-level final text audit in its terminal text band after both generation stages and immediately before the audio lane.
- [x] 3.3 Update node summaries, conversation traces, and inspector behavior so new runs omit the removed call while legacy final-label evidence remains inspectable.

## 4. Verification

- [x] 4.1 Add quality-control unit tests proving direct passes reuse triage labels, judge-resolved repairs reuse picker labels, gate/fallback labels identify their true source, and no final-label provider call occurs.
- [x] 4.2 Add Studio API tests covering standard, balanced workflow, complement, failure, and resume paths with reduced judge-call counts and unchanged deterministic final-audit gating.
- [x] 4.3 Add Studio rendering tests proving new graphs have no final-label node, stored legacy final-label nodes render at the end of their stage, and final text audit remains before audio.
- [x] 4.4 Run the complete unit test suite and production Studio build.
- [x] 4.5 Run the learner/library publication checks and verify this Studio-only behavior change does not rewrite curated content or the published learner manifest.

## 5. Retire routine historical relabeling

- [x] 5.1 Remove the `Label Library`, `Label Saved Runs`, and `Rejudge Library` controls, their client handler, and their dedicated styles.
- [x] 5.2 Remove the historical-label start endpoint, resumable Studio job kind, runner, and scope orchestration service while retaining existing stored review inspection.
- [x] 5.3 Keep the generic command-line backfill utility usable through the shared dialogue-quality rubric and verify the full Studio and Practice builds.
