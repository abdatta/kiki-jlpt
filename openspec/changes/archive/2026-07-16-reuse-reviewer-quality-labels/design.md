## Context

The generation quality pipeline currently asks the selected judge to classify every generated conversation during triage. Conversations that pass are accepted and initially labeled `good`. Repair-marked conversations receive two generator-produced candidates; deterministic gates remove inferior versions, and the selected judge resolves remaining ties while returning the chosen version's `good` or `okay` quality. After the bounded re-roll flow completes, `runQualityControl` makes another batched judge call over every accepted conversation using the historical-label rubric and overwrites the earlier labels and rationales.

That last call is represented by a `final-label` node. Although it executes after both pass 1 and pass 2 within a stage, the current lane renderer classifies it as a pass-1 pre-repair node, so the graph displays it between triage and repair. A separate deterministic `final-audit` step already runs after the initial and balance stages and gates audio; that audit remains necessary.

The completed `separate-generation-judge-models` change introduced the duplicate final-label pass to make new and historical labels use an identical prompt. This change intentionally supersedes that uniform-relabel decision while retaining independent generator/judge routing. Once the one-time historical labeling work completed, the operator-facing label/relabel jobs also became unnecessary.

## Goals / Non-Goals

**Goals:**

- Eliminate the post-selection final-label provider call from every new-generation path.
- Make the label assigned by the admitting triage, pick, gate, or fallback decision durable and inspectable.
- Save one judge call per generated stage—normally two calls in a balanced workflow—without weakening repair routing or the run-level final audit.
- Make the audit graph reflect the actual execution order and show the deterministic final text audit as the last text step.
- Keep existing runs, final-label exchanges, curated records, and published learner data readable without migration.

**Non-Goals:**

- Remove or redesign evidence-grounded triage, repair candidates, dominance gates, picker tie-breaks, bounded re-rolls, or final audit thresholds.
- Rejudge, rewrite, or republish existing conversations.
- Guarantee that labels produced by different operational prompts are perfectly comparable to historical-label-rubric results.

## Decisions

### D1. The decision that admits the delivered dialogue owns its label

For an unrepaired conversation, the judge's triage `pass` becomes `good`. For a repaired conversation selected through a judge tie-break, the picker's `selectedQuality` becomes the durable label. These are already the values used before the final-label overwrite and they evaluate the exact dialogue version being admitted at their respective decision point.

For a gate-only selection, retain the existing deterministic rule: `good` only when the selected version has no remaining deterministic findings and triage identified no naturalness concern; otherwise `okay`. A provider fallback remains conservative and explicitly marked as fallback-derived.

Running a shortened final-label prompt, relabeling only repaired conversations, and merging two competing labels were rejected because each preserves duplicate judgment and creates ambiguity about which decision is authoritative.

### D2. Persist provenance at the point of triage or pick

The quality-control result will attach review metadata when the admitting decision is made instead of waiting until the end of the stage. Direct model decisions retain their rationale, flags, judge model, provider-reported resolved version, rubric identifier, review time, and source (`triage` or `pick`). Gate and fallback decisions retain their rationale and flags with an explicit non-model source (`gate` or `fallback`); they must not masquerade as direct judge outputs.

The persisted representation should remain backward compatible. Existing `quality`, `qualityDecision`, `qualityFlags`, `pickerSelected`, `pickerConfidence`, and `qualityReview` data remain readable. Any provenance discriminator added to shared types is additive, and older final-label reviews remain valid historical records.

Leaving only the compact label without rationale was rejected because it would make new labels less inspectable than historical labels. Copying the configured judge identity onto gate/fallback decisions without a source discriminator was rejected because no judge assigned those values.

### D3. Remove final-label execution but retain compatibility types

`runQualityControl` will stop constructing the historical-label prompt, invoking the judge, publishing `final-label` progress, appending a final-label exchange, and failing the stage when relabeling fails. Workflow node templates will stop creating pending final-label nodes for new jobs.

The `final-label` call kind and renderer support remain readable for existing stored jobs and runs. This avoids a data migration and preserves their audit history. The stage renderer will treat any stored compatibility final-label node as a terminal stage node rendered after pass 2, fixing the misleading placement in existing graphs.

Deleting the call kind from shared unions was rejected because persisted runs may contain it. Hiding old final-label calls was rejected because they are real historical provider exchanges and should remain inspectable.

### D4. Keep the run-level final text audit unchanged

The deterministic final text audit still aggregates accepted counts, drops, label tallies, remaining OOV findings, coverage, distribution, failures, fallbacks, and picker statistics. It continues to execute after both text stages, persist on the run, and pause the workflow before audio when a threshold trips.

The graph will continue to render this run-level node in its own band between the stage lanes and audio. “Final dialogue labels” and “Final text audit” are separate concepts; only the redundant model relabel is removed.

### D5. Remove routine historical relabel operations after backfill

The completed backfill means routine Studio controls for labeling the library, labeling saved runs, or rejudging the library no longer justify a second mutation path. Remove those controls together with their dedicated start endpoint, resumable job kind, scope orchestration service, and styles. Existing stored labels and their review index remain readable and inspectable.

The generic label-only batching helper and command-line backfill tool remain available for exceptional maintenance without exposing a routine relabel action in Studio. Automatically scheduling historical rejudgment after generation remains rejected because it recreates the removed duplicate pass.

## Risks / Trade-offs

- [New labels no longer all use the exact historical-label prompt] → Record the decision source and rubric version so comparisons can distinguish triage, pick, gate, fallback, and stored historical reviews.
- [Triage evaluates originals while a deterministic gate may select a repaired version] → Use the conservative gate-derived label rule and retain the triage and gate rationales; only a judge tie-break may directly label a repaired version `good` or `okay`.
- [Existing runs contain final-label nodes that new runs do not] → Preserve compatibility rendering and place those nodes at their true terminal stage position.
- [Downstream code assumes every new conversation has `qualityReview.judgeModel`] → Use an explicit provenance source and make model-specific fields conditional for gate/fallback decisions; add serialization and UI coverage for all sources.
- [Removing a failure point changes job recovery checkpoints] → Update resume tests so legacy checkpoints remain consumable and new jobs do not wait for or replay final labeling.

## Migration Plan

1. Add backward-compatible label-source provenance and teach readers to handle model and non-model decisions.
2. Attach durable label provenance during triage, pick, gate, and fallback decisions.
3. Stop executing and publishing final-label calls, and stop creating their nodes for new jobs.
4. Update the graph to render stored legacy final-label nodes after both stage passes while keeping the final text audit before audio.
5. Remove the Studio historical label/relabel controls and their dedicated API, job kind, and scope service while retaining stored review inspection and the maintenance backfill helper.
6. Verify standard, workflow, complement, interruption/resume, maintenance backfill, and legacy audit rendering.

Rollback can restore the post-selection call and node creation without rewriting data produced while this change is active. Reviewer-derived labels remain valid quality metadata, and existing final-label records remain untouched throughout deployment and rollback.

## Open Questions

None. The accepted trade-off is that operational reviewer labels retain their originating rubric rather than being normalized by another provider pass.
