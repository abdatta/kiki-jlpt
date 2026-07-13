## Context

AI curation currently builds one set-wide snapshot by selecting every eligible non-curated conversation across saved runs. That snapshot is both the model input and the basis for candidate counts, persistence, freshness, history, reconciliation, and cache reuse. The Studio preflight exposes only model and portfolio size.

Run scoping crosses shared types, server snapshot construction, cache/fingerprint semantics, persisted review compatibility, API validation, and Studio controls. The curated library remains the full comparison baseline: selecting source runs limits candidate supply, not the existing library context against which candidates are judged.

## Goals / Non-Goals

**Goals:**

- Let operators explicitly include one or more generated runs in each AI-curation request.
- Preserve current behavior by initially selecting all runs that have eligible candidates.
- Make the scoped eligible count authoritative for request validation and model output validation.
- Persist enough scope provenance to reproduce, inspect, retry, and assess freshness for a review.
- Avoid making reviews stale because unrelated unselected runs changed.
- Keep legacy persisted reviews readable and actionable under their captured candidate scope.

**Non-Goals:**

- Selecting individual conversations independently of generated runs.
- Changing deterministic Queue recommendations or generated-run content.
- Filtering the curated-library comparison context.
- Changing Add All, audio scheduling, curated records, or the learner manifest.
- Automatically running curation when the selection changes.

## Decisions

### Persist selected run IDs as first-class review provenance

The request accepts `selectedRunIds`, and completed or failed reviews persist a normalized ordered list alongside the snapshot. IDs are validated server-side for set membership and current existence before any provider call. The server, rather than the client, remains authoritative for scope and eligibility.

Alternative: persist only candidate keys. Candidate keys describe the evaluated leaf records but do not preserve the operator's intent when a new candidate is later added to a selected run. First-class run IDs support correct freshness semantics and understandable history.

### Build the review snapshot from the selected scope while retaining the full library baseline

Candidate selection first filters saved runs by the validated selected ID set, then applies existing set, already-curated, ordering, and evidence rules. Candidate count and keys therefore describe exactly what the model receives. Library exposure and curated conversations remain unfiltered because portfolio quality must still be evaluated against the complete set library.

The selected run list is included in the snapshot fingerprint. The fingerprint contains the current eligible learning content from selected runs plus the existing library and evidence-version inputs. Changes in unselected runs are absent by construction.

Alternative: build the global snapshot and merely filter candidates in the prompt. This risks mismatches among validation, fingerprinting, history, and model input, and would continue to stale reviews for unrelated changes.

### Separate reusable evidence from scoped snapshot identity

Keep deterministic analysis reusable per set/run and compose a lightweight scoped snapshot from that evidence. Cache keys include the set, selected normalized run IDs, relevant candidate content, library state, and vocabulary state. The Queue may warm the all-runs evidence/cache, after which selecting a subset should reuse analyzed conversations instead of retokenizing them.

Alternative: maintain only one snapshot per set. That cannot safely cache multiple scopes and encourages global invalidation. A scope-keyed cache is simpler semantically, with bounded memory acceptable for this local Studio; stale entries can be replaced or held in a small per-set map.

### Scope freshness to operator intent

A review becomes stale when the curated library or allowed vocabulary changes, or when eligible candidate membership or learning content changes inside a selected run. A new, edited, deleted, or newly curated conversation within a selected run matters even if it was not in the old captured candidate list. Changes confined to unselected runs do not matter.

Live recommendation reconciliation still checks the actual recommended source records regardless of general freshness, preserving safety for Add All and historical actions.

### Default and restore selection in Studio state

The preflight derives selectable runs from current eligible candidates grouped by source run. On first entry or set change, all eligible runs are selected. Operators can select all, clear all, or toggle runs. The scoped candidate count is the sum of eligible candidates in selected runs, and portfolio size is clamped or rejected against that count.

Retry reuses the failed review's scope. “Use Settings” restores model, size, and scope but never submits automatically. Unavailable historical IDs remain visible as unavailable provenance and block a new submission until the operator chooses a valid available scope.

Alternative: store selection only in transient checkboxes and default again after every review. That makes retry and historical reproduction misleading.

### Treat legacy review scope as the unique source runs in its captured candidates

On read, reviews without explicit run scope derive it from `snapshot.candidates[].sourceRunId`. Files need not be eagerly rewritten. This exactly represents what older reviews evaluated, retains their result, and provides deterministic freshness behavior without a bulk migration.

## Risks / Trade-offs

- [Many distinct run selections can create many cache entries] → Keep cache entries scope-keyed but bounded per set, or cache expensive per-run evidence separately and compose snapshots cheaply.
- [A run can change between preflight loading and submission] → Re-read and validate runs server-side, return the authoritative scoped candidate count, and invoke no model on invalid input.
- [Portfolio size becomes invalid after toggling runs] → Update the visible maximum immediately and require an in-range value at submission; do not silently change persisted user intent during a provider request.
- [Legacy scope inference cannot express runs that had zero eligible candidates] → Infer from captured candidates because zero-candidate runs could not have influenced the historical model decision.
- [Selected-run changes may surprise operators by staling a review even when recommendations are untouched] → Show scope provenance and distinguish review freshness from live recommendation reconciliation.

## Migration Plan

1. Add optional scope fields and legacy inference to shared review parsing/handling so existing review files remain readable.
2. Add scoped snapshot construction, validation, cache keys, and freshness behavior while retaining all-runs defaults for callers that have not yet supplied selection.
3. Update API requests and Studio controls to send explicit selections and display scope provenance.
4. Add server and UI regression tests covering selected/unselected changes, invalid scopes, retry/history restoration, and legacy reviews.
5. Rollback is code-only: persisted reviews with added scope metadata remain structurally additive and older code can ignore the field.

## Open Questions

None. The proposed defaults and legacy rules preserve existing behavior while making the new scope explicit.
