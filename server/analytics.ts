import type { PracticeConversation, RunAnalytics } from '../shared/types.ts';
import type { VocabItem } from '../shared/types.ts';

function cleanAuditWord(word: string): string | null {
  const cleaned = word.trim().replace(/^["'“”‘’]+|["'“”‘’.,。]+$/g, '');
  if (!cleaned || /^none\.?$/i.test(cleaned)) return null;
  return cleaned;
}

function uniqueSorted(words: Iterable<string>): string[] {
  return [...new Set([...words].map((word) => word.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
}

export function calculateRunAnalytics(setNumber: number, allowedVocabulary: VocabItem[], conversations: PracticeConversation[]): RunAnalytics {
  const allowedWords = new Set(allowedVocabulary.map((item) => item.japanese));
  const currentSetWords = allowedVocabulary.filter((item) => item.set === setNumber).map((item) => item.japanese);
  const usedWords = uniqueSorted(conversations.flatMap((conversation) => conversation.vocabularyUsed));
  const usedWordSet = new Set(usedWords);
  const usedAllowedWords = allowedVocabulary.filter((item) => usedWordSet.has(item.japanese));
  const missingCurrentSetWords = currentSetWords.filter((word) => !usedWordSet.has(word));
  const auditedOutOfAllowed = conversations
    .flatMap((conversation) => conversation.outOfVocabularyAudit)
    .map(cleanAuditWord)
    .filter((word): word is string => Boolean(word))
    .filter((word) => !allowedWords.has(word));
  const vocabularyClaimOutOfAllowed = usedWords.filter((word) => !allowedWords.has(word));
  const outOfAllowedWords = uniqueSorted([...auditedOutOfAllowed, ...vocabularyClaimOutOfAllowed]);
  const allowedVocabUsedPercentage = allowedVocabulary.length ? Math.round((usedAllowedWords.length / allowedVocabulary.length) * 1000) / 10 : 0;

  return {
    currentSetTotal: currentSetWords.length,
    currentSetUsedCount: currentSetWords.length - missingCurrentSetWords.length,
    currentSetMissingCount: missingCurrentSetWords.length,
    currentSetMissingWords: missingCurrentSetWords,
    allowedVocabTotal: allowedVocabulary.length,
    allowedVocabUsedCount: usedAllowedWords.length,
    allowedVocabUsedPercentage,
    outOfAllowedCount: outOfAllowedWords.length,
    outOfAllowedWords
  };
}
