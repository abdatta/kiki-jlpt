## Context

The Studio already preserves source-run traceability for curated conversations and recommendations. Curated items include `sourceRunId` and `sourceConversationId`, deterministic recommendations include `sourceRunId` and `sourceRunCreatedAt`, and AI curation recommendations include source identifiers. Generated run list entries already use a compact relative timestamp formatter for their visible title.

The missing behavior is presentation: once conversations are mixed into Library, Queue, or AI curation views, operators cannot quickly see the source-run composition of the visible portfolio, and Library cards do not consistently provide a compact link back to their source run.

## Goals / Non-Goals

**Goals:**

- Show each mixed-list conversation's generated run using the same timestamp label used in the run list.
- Make that timestamp a link to the generated run when the source run can be resolved.
- Provide a collapsed-by-default distribution view for mixed lists that groups visible conversations by generated run and reports count and share.
- Keep the solution client-side where current response shapes already contain the required source identifiers.

**Non-Goals:**

- Do not rename the underlying domain concept from run to generated set in storage or APIs.
- Do not alter recommendation ranking, curation validation, audio generation, or publication.
- Do not add provenance to conversations shown inside their own generated run, because the run context is already explicit.
- Do not change the learner application or published static library manifest.

## Decisions

1. Reuse the generated run title formatter for provenance labels.

   The provenance label should match the run list exactly, for example `Today, 00:28`, `Yesterday, 17:57`, or `Jul 2, 12:44`. This keeps the source chip short and makes it visually consistent with the existing run sidebar. The alternative was a longer label such as `From Run Jul 2, 12:44`; that was rejected because it adds repeated low-value text to every card.

2. Compute distribution from the visible list rather than adding API fields.

   Library conversations, deterministic recommendations, and AI recommendations already carry enough source identifiers to group visible items. The UI can derive `{sourceRunId, label, count, percentage}` from the currently rendered items and the known run list. The alternative was adding server-side summary payloads for each endpoint; that would duplicate simple view-specific aggregation and increase API surface area without improving correctness.

3. Treat unresolved source runs gracefully.

   If a mixed item has a source identifier but the source run is not available in the loaded run list, the UI should still group it under a fallback compact identifier and avoid a broken link. This preserves visibility even after source deletion or partial loading. The alternative was hiding provenance when a run cannot be resolved; that would conceal the exact case where provenance is most useful.

4. Use one reusable mixed-source distribution component.

   Library, deterministic Queue, and AI curation can share the same distribution calculation and presentation, with each view passing the visible items. This avoids separate interpretations of count and percentage. The alternative was embedding one-off summaries in each view; that would be quicker initially but easier to drift.

## Risks / Trade-offs

- Source run metadata may not be loaded when a card first renders -> Use the available source timestamp from recommendations where present, fall back to a short source ID label, and update when run metadata becomes available.
- Historical AI curation can reference source runs that no longer exist -> Keep the provenance display read-only and group unresolved sources without offering a broken navigation link.
- The distribution panel could add visual noise to already dense review screens -> Keep it collapsed by default and expose it through an explicit button.
- Percentages on small lists can overstate precision -> Display whole-number shares alongside counts, with counts as the authoritative value.
