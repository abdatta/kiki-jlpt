## 1. Provenance Helpers

- [x] 1.1 Add a reusable source-run metadata helper that resolves a conversation or recommendation source to a compact run-title label, target route, and unresolved fallback.
- [x] 1.2 Reuse the existing generated-run title date formatter for all source-run labels.
- [x] 1.3 Add a reusable visible-list distribution helper that groups items by source run and calculates count and whole-number percentage share.

## 2. Conversation Card UI

- [x] 2.1 Show a compact source-run timestamp link on Library conversation cards when the source run is available.
- [x] 2.2 Show the same compact source-run timestamp link on deterministic Queue recommendation cards.
- [x] 2.3 Show the same compact source-run timestamp link on current and historical AI curation recommendation cards without disabling navigation for historical read-only reviews.
- [x] 2.4 Show a non-link unresolved-source label when a source run cannot be resolved.
- [x] 2.5 Keep generated-run cards free of redundant source labels when they are shown inside their own run.

## 3. Distribution UI

- [x] 3.1 Add a collapsed-by-default source-run distribution panel for the Library view when the visible list has mixed source runs.
- [x] 3.2 Add the same distribution panel for deterministic Queue recommendations.
- [x] 3.3 Add the same distribution panel for current and historical AI curation recommendations, based on the currently visible recommendation list.
- [x] 3.4 Display each distribution row with compact run timestamp, count, percentage, and available navigation to the source run.
- [x] 3.5 Style the provenance links and distribution panel so they fit dense Studio review screens without introducing layout overlap on mobile or desktop widths.

## 4. Verification

- [x] 4.1 Add or update Studio tests covering source label rendering for Library, deterministic recommendations, AI recommendations, and unresolved sources.
- [x] 4.2 Add or update Studio tests covering distribution grouping, percentages, collapsed default state, and visible-list filtering behavior.
- [x] 4.3 Run the relevant unit tests.
- [x] 4.4 Run `npm run build`.
