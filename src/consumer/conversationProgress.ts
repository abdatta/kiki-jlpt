import type { ConversationProgress, StaticLibraryConversation } from './types.ts';

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function levelFromPublishedId(id: string): number | null {
  const match = /^set-(\d+)-/.exec(id);
  if (!match) return null;
  const level = Number.parseInt(match[1], 10);
  return Number.isFinite(level) ? level : null;
}

export function completedConversationIds(
  conversations: StaticLibraryConversation[],
  completionOrder: string[]
): Set<string> {
  const availableIds = new Set(conversations.map((conversation) => conversation.id));
  return new Set(uniqueStrings(completionOrder).filter((id) => availableIds.has(id)));
}

export function migrateConversationProgress(
  progress: ConversationProgress,
  conversations: StaticLibraryConversation[]
): ConversationProgress {
  if (progress.completionOrderVersion === 1) return progress;

  const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const completedCountByLevel = new Map<number, number>();

  for (const id of uniqueStrings(progress.completedConversationIds)) {
    const level = conversationsById.get(id)?.level ?? levelFromPublishedId(id);
    if (level === null) continue;
    completedCountByLevel.set(level, (completedCountByLevel.get(level) ?? 0) + 1);
  }

  const migratedIds: string[] = [];
  for (const conversation of conversations) {
    const remaining = completedCountByLevel.get(conversation.level) ?? 0;
    if (remaining <= 0) continue;
    migratedIds.push(conversation.id);
    completedCountByLevel.set(conversation.level, remaining - 1);
  }

  return {
    completionOrderVersion: 1,
    completedConversationIds: migratedIds,
    starredConversationIds: uniqueStrings(progress.starredConversationIds)
  };
}

export function recordConversationCompletion(
  progress: ConversationProgress,
  conversationId: string
): ConversationProgress {
  const completionOrder = uniqueStrings(progress.completedConversationIds);
  if (completionOrder.includes(conversationId)) return progress;

  return {
    ...progress,
    completionOrderVersion: 1,
    completedConversationIds: [...completionOrder, conversationId]
  };
}
