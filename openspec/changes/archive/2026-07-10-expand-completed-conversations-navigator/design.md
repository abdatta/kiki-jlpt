## Context

In the learner application, `ConversationsPage` (src/consumer/ConsumerApp.tsx) renders a conversation toolbar: `Prev | [position chip] [starred chip] | Next`. The position chip (`conversationPlaylistStatus`) shows `currentConversationIndex / conversations.length` (e.g. "23 / 40") and is not interactive. The starred chip (`conversationStarredStatus`) is a button showing the starred count; it opens `StarredConversationModal`, which lists only starred conversations for the current level.

Conversation order comes from `orderConversations`, which returns `[...completed (in completion order), ...remaining (re-sorted by vocabulary mastery)]`. The completed conversations therefore occupy a **stable prefix** of the ordered list (positions `1..N`), while the remaining tail re-sorts as mastery changes. All state the navigator needs already exists in `ConversationsPage`: `conversations` (ordered), `completedIds`, `starredIds`, and `starredConversations`.

This is a UI-only change to the learner app. No persisted progress, curated content, or published-manifest formats change.

## Goals / Non-Goals

**Goals:**
- Let learners browse and jump to any conversation they have completed at the current level.
- Make the position chip a second entry point into the same popup the starred chip opens.
- Show which completed conversations are starred, using a read-only indicator.
- Offer an All/Starred filter, with the entry point choosing the initial filter.

**Non-Goals:**
- Listing the *remaining* not-yet-reached conversations (the tail is unstable, so its numbering would drift and mislead). The single current in-progress conversation is included; the rest of the tail is not.
- Starring/unstarring from inside the popup (stays in the conversation view).
- Cross-level or global "everything I ever finished" browsing (scope stays per-level).
- Any change to the "23 / 40" text, storage schema, or `conversationProgress` logic.

## Decisions

### One popup, two entry points, one filter state
The position chip becomes a button; both chips render the same modal. A single filter state (`'all' | 'starred'`) is initialized from the entry point: position chip → `'all'`, star chip → `'starred'`. Track it alongside the existing open flag (e.g. lift `isStarredModalOpen` to a `navigatorFilter: 'all' | 'starred' | null`, where `null` means closed).

_Alternative considered:_ keep the star chip as a pure filter shortcut with separate behavior. Rejected — two entry points to one surface is simpler to reason about and preserves the existing one-tap-to-starred muscle memory.

### List = completed prefix + current in-progress conversation
The rows are `conversations.filter((c) => completedIds.has(c.id))` (the completion-order prefix) followed by the first not-completed conversation, i.e. `[...completed, conversations.find((c) => !completedIds.has(c.id))]` (omitting the tail when the level is finished). Because `orderConversations` places completed conversations first, this yields positions `1..N` for the finished conversations and `N+1` for the one the learner is currently on — matching the toolbar's `N+1` position exactly. Each row's index (`+1`) is its true playlist position; no separate sort needed.

**Why include the current conversation:** starring requires *viewing* a conversation, viewing requires it to be *unlocked*, and sequential access means the only unlocked-but-not-completed conversation is the current first-uncompleted one. So `{completed} ∪ {current}` is precisely the set of conversations that can ever be starred. This makes the navigator's Starred filter equal to *all* starred conversations, so the toolbar star chip count and the Starred-filter count are always consistent — no starred conversation can go missing, and the chip can never read a higher number than the filter shows.

_Alternative considered:_ completed-only. Rejected — a conversation starred while in progress (starring unlocks after the initial playthrough, before all questions are answered) would vanish from the navigator and desync the star-chip count from the Starred filter.

### Numbers are playlist positions, not filtered ranks
Row numbers come from the position in the full completed list and are held constant when the Starred filter narrows the visible rows (e.g. "3. Opening" stays 3). This keeps the popup consistent with the toolbar's position semantics: the popup is rows `1..N`, and the toolbar points at `N+1`.

_Alternative considered:_ renumber `1..M` within the starred subset. Rejected — it would divorce the popup number from the playlist position the learner sees elsewhere.

### Star icon is a read-only indicator
Starred rows render a non-interactive star. Toggling remains in the conversation view. Keeps the popup a pure navigation/overview surface and avoids a second, competing star affordance.

### Rename the component
`StarredConversationModal` → a completed-conversations navigator component (e.g. `CompletedConversationModal`). It takes the completed conversations, the starred id set, the active conversation id, the initial/selected filter, and `onSelect` / `onClose` callbacks.

## Risks / Trade-offs

- **"23 / 40" vs the popup count** → No mismatch. The popup lists rows `1..23` (finished prefix `1..22` plus the current conversation at `23`), and the toolbar points at `23`, which is the last, highlighted row. No relabeling is done.
- **Position number drift** → Only the remaining tail re-sorts by mastery; the completed prefix plus the single current row have stable numbering, so navigator numbers do not jump.
- **Toolbar visible with zero completed** → The toolbar renders whenever listening is unlocked and conversations exist. Because the current in-progress conversation is always included, the All list is non-empty whenever the toolbar is shown, so its empty-state copy ("Finish a conversation to see it here") is a defensive fallback that is not normally reached. The Starred filter still reaches its empty state (reusing the existing star-after-listening copy) when nothing is starred.

## Migration Plan

Not applicable — client-only UI change with no data migration. Rollback is reverting the component and toolbar wiring; persisted progress is untouched and forward/backward compatible.

## Open Questions

None. All product decisions were resolved during exploration.
