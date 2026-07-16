## Why

New generation currently asks the selected judge to classify dialogue during quality triage and version picking, then makes another judge call after selection to relabel the same accepted conversations. This duplicate pass adds cost and latency, can fail an otherwise successful run, overwrites useful decision provenance, and is displayed out of sequence in the audit graph.

## What Changes

- Remove the separate `Final dialogue labels` model call from new standard, workflow, and library-complement generation.
- Persist accepted originals as `good` from the selected judge's triage verdict and persist repaired conversations as `good` or `okay` from the selected judge's version-pick decision.
- Preserve the originating triage or pick rationale, flags, judge identity, resolved model version, rubric version, and review time as the conversation's label provenance.
- Keep deterministic gate-only and provider-fallback decisions explicitly marked as such; do not imply that a model directly assigned those labels.
- Remove the Studio `Label Library`, `Label Saved Runs`, and `Rejudge Library` controls and their dedicated API/job orchestration now that past runs are labeled; retain the reusable command-line backfill helper for exceptional maintenance.
- Retain the deterministic final text audit and its warning gate before audio.
- Remove final-label nodes from newly created audit graphs so each stage ends with its actual last selection step and the run-level final text audit remains the final text step.
- Preserve existing stored final-label nodes and reviews when rendering historical runs; no run or curated-content migration is required.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `generation-quality-control`: Make triage and version-pick outcomes authoritative for new-generation quality labels and remove the mandatory post-selection relabel pass.
- `generation-audit-graph`: Remove the redundant final-label call node from new graphs, preserve accurate execution order, and keep the deterministic final text audit as the terminal text step.
- `historical-quality-labeling`: Remove the operator-facing historical label/relabel capability.
- `studio-background-jobs`: Remove the dedicated durable historical-label job kind and queue behavior.
- `curated-library`: Preserve and present existing quality provenance without depending on a relabel operation.

## Impact

- Studio generation orchestration, quality-control metadata, workflow node construction, audit rendering, and generation tests.
- Fewer judge-provider calls: one eliminated per generated stage, normally two per balanced workflow.
- Removes the dedicated historical-label start API; generation request shapes are unchanged and no dependencies are added.
- Studio behavior changes; learner behavior does not.
- Existing run, curated-set, and published-library formats remain readable. New conversations continue to use the existing quality fields, with provenance sourced from triage or pick instead of a post-selection relabel call. Published content is not rewritten by this change.
