## 1. Toolbar state and wiring

- [x] 1.1 In `ConversationsPage` (src/consumer/ConsumerApp.tsx), replace the `isStarredModalOpen` boolean with a navigator filter state that also encodes open/closed (`navigatorFilter: 'all' | 'starred' | null`, `null` = closed).
- [x] 1.2 Derive the navigator list as the completion-order prefix plus the current in-progress conversation (`[...conversations.filter(completed), conversations.find(!completed)]`), and a `navigatorStarredCount` for the filter badge / consistency with the toolbar chip.
- [x] 1.3 Make the position chip (`conversationPlaylistStatus`) a `button` that opens the navigator with the `'all'` filter; give it an appropriate `aria-label`.
- [x] 1.4 Change the starred chip (`conversationStarredStatus`) to open the navigator with the `'starred'` filter instead of the old modal.
- [x] 1.5 Update the selection handler to set the selected conversation id and close the navigator by resetting the filter state to `null`.

## 2. Navigator component

- [x] 2.1 Rework `StarredConversationModal` into `ConversationNavigatorModal`, accepting the navigator conversations, starred id set, starred count, active conversation id, initial filter, and `onSelect`/`onClose`.
- [x] 2.2 Render rows numbered by playlist position (`index + 1` over the full navigator list), showing title and scene, preserving the existing active-row check + highlight for the current conversation id.
- [x] 2.3 Add a read-only star indicator on rows whose id is in the starred set (no toggle control).
- [x] 2.4 Add a segmented `All (count) / Starred (count)` filter with local filter state initialized from the entry point; keep numbers stable when the Starred filter narrows the visible rows (do not renumber the subset).
- [x] 2.5 Add empty states: Starred → reuse the existing "Star conversations after listening to revisit them here." copy; All → defensive "Finish a conversation to see it here." (not normally reached, since the current conversation is always listed).
- [x] 2.6 Update dialog title to "Conversations" and `aria-labelledby`/labels to reflect the navigator's broader purpose.
- [x] 2.7 On open, scroll the active conversation into view (center it) via a `useLayoutEffect` that adjusts the scroll panel's `scrollTop`, so the current conversation is visible without manual scrolling.

## 3. Styles

- [x] 3.1 In src/consumer/consumer.css, style the position chip as an interactive button consistent with the starred chip (transparent chrome, pointer cursor, hover/focus color).
- [x] 3.2 Style the segmented All/Starred filter control within the navigator panel.
- [x] 3.3 Style the per-row read-only starred indicator (scoped to out-specify the existing `.starredConversationItem span`/`svg` rules).
- [x] 3.4 Keep the navigator header + All/Starred switcher fixed while the list scrolls: make `.starredConversationPanel` a clipped flex column with a fixed `.navigatorHeader` and an inner-scrolling `.starredConversationList` (own overflow). Avoids the sub-pixel row bleed a sticky-over-padding header produced.
- [x] 3.5 Animate the All↔Starred filter change: (a) a sliding indicator behind the segmented control (`.conversationFilterIndicator`, translateX driven by `data-active`); (b) keep all rows mounted and collapse/fade the non-matching rows via `grid-template-rows: 1fr→0fr` + opacity + margin on `.conversationRow[data-hidden]`, so matching rows rearrange and the modal height follows. Guard with `prefers-reduced-motion`.

## 4. Verify

- [x] 4.1 Open via the position chip: navigator opens on All, lists 23 rows (22 completed + current) in playlist order with correct position numbers; row 23 is the current in-progress conversation and is highlighted.
- [x] 4.2 Open via the star chip: navigator opens pre-filtered to Starred; toggling to All and back preserves each row's number (1, 3, 5, 10, 22).
- [x] 4.3 Starred rows show the indicator on exactly the starred conversations, and the count matches the toolbar chip; confirmed no control to change starred state from the navigator.
- [x] 4.4 Selecting a row navigates to that conversation (position + now-playing update) and dismisses the navigator.
- [x] 4.5 Empty Starred state renders the reused copy with the All tab still populated; the current conversation keeps All non-empty even with zero completed.
- [x] 4.6 `tsc --noEmit` passes; no regressions from the component rename and prop changes.
- [x] 4.7 On open, the navigator scrolls to the active conversation: with the current at row 23 it opens at the bottom with row 23 centered/visible; with a mid-list active row (#10) it opens with that row centered (verified at a 375×812 viewport).
- [x] 4.8 The header + All/Starred switcher stay fixed while the list scrolls internally; `elementFromPoint` sampling confirms no conversation row ever paints above the header at any scroll offset — no leak, including sub-pixel (verified at 375×812).
- [x] 4.9 Filter animation verified (375×812): All→Starred collapses non-starred rows to 0 height + fades them, remaining starred rows rearrange, and the panel animates 760→622px; Starred→All expands back to 760; opening via the star chip renders pre-collapsed (no flash); empty Starred collapses all rows and shrinks the panel to ~220px with the empty copy; sliding indicator tracks `data-active`; auto-scroll-to-active still centers the current row; no console errors.
