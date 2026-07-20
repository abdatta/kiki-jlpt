// Single source of truth for conversation-count limits, shared by the client
// modals and the server request validators. To change an allowed range, edit
// the numbers here — nothing else needs to move.

export interface ConversationCountRange {
  readonly min: number;
  readonly max: number;
}

// Bounds for the "Start a run" conversation count (text-only and workflow runs).
export const RUN_CONVERSATION_COUNT_RANGE: ConversationCountRange = { min: 10, max: 100 };

// Bounds for the library balance/complement top-up count. The minimum stays low
// on purpose so an operator can top up a nearly-complete set by a few conversations.
export const BALANCE_CONVERSATION_COUNT_RANGE: ConversationCountRange = { min: 1, max: 100 };

// "10-100" — for placeholders and range hints.
export function formatCountRange(range: ConversationCountRange): string {
  return `${range.min}-${range.max}`;
}

// "between 10 and 100" — for validation error messages.
export function describeCountRange(range: ConversationCountRange): string {
  return `between ${range.min} and ${range.max}`;
}
