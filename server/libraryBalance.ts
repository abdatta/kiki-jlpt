import type { LibraryBalancePlan, LibraryBalanceWord, PracticeConversation, VocabItem } from '../shared/types.ts';
import { readCuratedSet } from './library.ts';
import { getAllowedVocabulary } from './vocab.ts';

const PREFERRED_MAX_CONVERSATIONS = 10;
const HARD_MAX_CONVERSATIONS = 30;
const REQUIRED_ZERO_WORDS_PER_CONVERSATION = 6;
const TARGET_WORDS_PER_CONVERSATION = 8;

function uniqueWords(words: string[]): string[] {
  return [...new Set(words.map((word) => word.trim()).filter(Boolean))];
}

function uniqueVocabularyByWord(vocabulary: VocabItem[]): VocabItem[] {
  const seen = new Set<string>();
  return vocabulary.filter((item) => {
    if (seen.has(item.japanese)) return false;
    seen.add(item.japanese);
    return true;
  });
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values: number[], average: number): number {
  if (!values.length) return 0;
  const variance = values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function countLibraryWords(targetWords: Set<string>, conversations: Array<{ vocabularyUsed: string[] }>): Map<string, number> {
  const counts = new Map([...targetWords].map((word) => [word, 0]));

  for (const conversation of conversations) {
    for (const word of uniqueWords(conversation.vocabularyUsed)) {
      if (!targetWords.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return counts;
}

function buildBalancePlanFromConversations(
  setNumber: number,
  allowedVocabulary: VocabItem[],
  conversations: Array<Pick<PracticeConversation, 'vocabularyUsed'>>,
  conversationCount: number
): LibraryBalancePlan {
  const targetVocabulary = uniqueVocabularyByWord(allowedVocabulary.filter((item) => item.set === setNumber));
  const targetWords = new Set(targetVocabulary.map((item) => item.japanese));
  const counts = countLibraryWords(targetWords, conversations);
  const countValues = targetVocabulary.map((item) => counts.get(item.japanese) ?? 0);
  const average = mean(countValues);
  const deviation = standardDeviation(countValues, average);
  const targetCount = chooseTargetCount(countValues);
  const words = targetVocabulary.map((item) => toBalanceWord(item, counts.get(item.japanese) ?? 0, targetCount));
  const requiredZeroWords = sortByNeed(words.filter((word) => word.libraryCount === 0));
  const priorityWords = sortByNeed(words.filter((word) => word.neededCount > 0));
  const lowCoverageCount = words.filter((word) => word.libraryCount > 0 && word.libraryCount < targetCount).length;
  const overrepresentedWords = sortOverrepresented(words.filter((word) => word.libraryCount > targetCount + Math.max(1, deviation)));

  return {
    setNumber,
    targetWordCount: targetVocabulary.length,
    libraryConversationCount: conversations.length,
    zeroCount: requiredZeroWords.length,
    lowCoverageCount,
    meanCount: roundMetric(average),
    standardDeviation: roundMetric(deviation),
    targetCount,
    preferredMaxConversationCount: PREFERRED_MAX_CONVERSATIONS,
    suggestedConversationCount: conversationCount,
    requiredZeroWords,
    priorityWords,
    overrepresentedWords: overrepresentedWords.slice(0, 30)
  };
}

function toBalanceWord(item: VocabItem, libraryCount: number, targetCount: number): LibraryBalanceWord {
  return {
    japanese: item.japanese,
    reading: item.reading,
    meaning: item.meaning,
    partOfSpeech: item.partOfSpeech,
    category: item.category,
    libraryCount,
    targetCount,
    neededCount: Math.max(0, targetCount - libraryCount)
  };
}

function sortByNeed(words: LibraryBalanceWord[]): LibraryBalanceWord[] {
  return [...words].sort((a, b) => (
    b.neededCount - a.neededCount
    || a.libraryCount - b.libraryCount
    || a.japanese.localeCompare(b.japanese, 'ja')
  ));
}

function sortOverrepresented(words: LibraryBalanceWord[]): LibraryBalanceWord[] {
  return [...words].sort((a, b) => (
    b.libraryCount - a.libraryCount
    || a.japanese.localeCompare(b.japanese, 'ja')
  ));
}

function chooseTargetCount(counts: number[]): number {
  if (!counts.length) return 1;
  const average = mean(counts);
  const sorted = [...counts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return clamp(Math.max(1, Math.round(Math.min(average, median || average))), 1, 4);
}

function chooseConversationCount(words: LibraryBalanceWord[], zeroCount: number): number {
  const totalNeeded = words.reduce((total, word) => total + word.neededCount, 0);
  if (totalNeeded <= 0) return 1;

  const zeroFloor = Math.ceil(zeroCount / REQUIRED_ZERO_WORDS_PER_CONVERSATION);
  const balanceNeed = Math.ceil(totalNeeded / TARGET_WORDS_PER_CONVERSATION);
  const needed = Math.max(1, zeroFloor, balanceNeed);
  const preferred = zeroFloor <= PREFERRED_MAX_CONVERSATIONS ? Math.min(needed, PREFERRED_MAX_CONVERSATIONS) : needed;
  return clamp(preferred, 1, HARD_MAX_CONVERSATIONS);
}

export async function buildLibraryBalancePlan(setNumber: number): Promise<LibraryBalancePlan> {
  const allowedVocabulary = await getAllowedVocabulary(setNumber);
  const librarySet = await readCuratedSet(setNumber);
  const initialPlan = buildBalancePlanFromConversations(setNumber, allowedVocabulary, librarySet.conversations, 1);
  return {
    ...initialPlan,
    suggestedConversationCount: chooseConversationCount(initialPlan.priorityWords, initialPlan.requiredZeroWords.length)
  };
}

export function buildGeneratedRunBalancePlan(
  setNumber: number,
  allowedVocabulary: VocabItem[],
  conversations: Array<Pick<PracticeConversation, 'vocabularyUsed'>>,
  conversationCount: number
): LibraryBalancePlan {
  return buildBalancePlanFromConversations(setNumber, allowedVocabulary, conversations, conversationCount);
}
