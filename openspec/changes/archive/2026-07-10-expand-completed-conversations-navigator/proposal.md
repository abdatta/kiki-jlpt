## Why

Learners can only jump between conversations they have starred; there is no way to revisit the conversations they have already completed. The completion progress indicator in the conversation toolbar is also inert — it displays position but cannot be acted on. Learners who want to replay an earlier conversation must page through it with Prev/Next.

## What Changes

- The conversation toolbar's position chip (the "current / total" indicator, e.g. "23 / 40") becomes a button that opens a conversation navigator popup.
- The existing starred-count chip continues to open the same popup, but pre-filtered to starred conversations.
- The popup (today "Starred conversations") becomes a **conversation navigator**: it lists every conversation the learner has completed at the current level plus the current in-progress conversation, in playlist order, numbered by their stable playlist position (so the list runs `1..N+1` and its last row matches the toolbar's position).
- Each row shows a star icon as a read-only indicator when that conversation is starred. Starring/unstarring is unchanged and still happens from the conversation view, not the popup.
- The popup gains a segmented "All / Starred" filter. The entry point sets the initial filter (position chip → All, star chip → Starred). Filtering to Starred preserves each row's original playlist number. Because the only starrable conversations are the completed ones plus the current one, the Starred filter always matches the toolbar's starred count.
- Selecting any row navigates to that conversation and closes the popup.
- Empty states: the Starred filter reuses the existing "star conversations after listening" copy; the All filter carries a defensive "finish a conversation" fallback (not normally reached, since the current conversation is always listed).
- Scope stays per-level, matching today's toolbar and starred behavior. No changes to persisted progress data, curated content, or the published manifest.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `listening-practice`: The conversation reference tools requirement extends from a starred-only picker to a completed-conversations navigator with an All/Starred filter and a read-only starred indicator, reachable from both toolbar chips.

## Impact

- Learner application only. No studio, curated-content, or published-manifest changes.
- `src/consumer/ConsumerApp.tsx`: toolbar chip wiring and the modal component (`StarredConversationModal` → completed-conversations navigator with filter state).
- `src/consumer/consumer.css`: position-chip button styles, the segmented filter control, and the per-row starred indicator.
- No changes to `storage.ts`, `types.ts`, or `conversationProgress.ts`; the popup is derived entirely from existing in-memory state (completed ids, starred ids, ordered conversations).
