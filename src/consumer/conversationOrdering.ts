import type { StatsMap, StaticLibraryConversation, VocabCard } from './types.ts';
import { getBucket, getStats } from './deck.ts';

export interface ConversationVocabularyTerm {
  japanese: string;
  variants: VocabCard[];
  mastered: boolean;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function conversationVocabularyTerms(
  conversation: StaticLibraryConversation,
  cards: VocabCard[],
  stats: StatsMap
): ConversationVocabularyTerm[] {
  const eligibleCards = cards.filter((card) => card.level <= conversation.level);

  return uniqueStrings(conversation.vocabularyUsed ?? []).map((japanese) => {
    const variants = eligibleCards.filter((card) => card.japanese === japanese);
    return {
      japanese,
      variants,
      mastered: variants.length > 0 && variants.every((card) => getBucket(getStats(stats, card.id)) === 'strong')
    };
  });
}

export function sortUnmasteredVocabularyCards(cards: VocabCard[], stats: StatsMap): VocabCard[] {
  const priority = {
    improving: 0,
    weak: 1,
    new: 2,
    strong: 3
  } as const;

  return [...cards].sort((a, b) => {
    const bucketDifference = priority[getBucket(getStats(stats, a.id))] - priority[getBucket(getStats(stats, b.id))];
    return bucketDifference || a.withinSetNumber - b.withinSetNumber || a.id.localeCompare(b.id);
  });
}

export function orderConversations(
  conversations: StaticLibraryConversation[],
  completionOrder: string[],
  cards: VocabCard[],
  stats: StatsMap
): StaticLibraryConversation[] {
  const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const completed = uniqueStrings(completionOrder)
    .map((id) => conversationsById.get(id))
    .filter((conversation): conversation is StaticLibraryConversation => Boolean(conversation));
  const completedIds = new Set(completed.map((conversation) => conversation.id));

  const remaining = conversations
    .map((conversation, publishOrder) => ({
      conversation,
      publishOrder,
      masteredWordCount: conversationVocabularyTerms(conversation, cards, stats)
        .filter((term) => term.mastered)
        .length
    }))
    .filter(({ conversation }) => !completedIds.has(conversation.id))
    .sort((a, b) => b.masteredWordCount - a.masteredWordCount || a.publishOrder - b.publishOrder)
    .map(({ conversation }) => conversation);

  return [...completed, ...remaining];
}
