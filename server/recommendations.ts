import type { LibraryRecommendationCandidate, LibraryRecommendations, LibraryRecommendationWord, PracticeConversation, VocabItem } from '../shared/types.ts';
import { makeCuratedId, readCuratedSet } from './library.ts';
import { listRuns } from './storage.ts';
import { getAllowedVocabulary } from './vocab.ts';
import { analyzeConversationsWithVocabulary } from './vocabAudit.ts';

function uniqueWords(words: string[]): string[] {
  return [...new Set(words.map((word) => word.trim()).filter(Boolean))];
}

function wordFrequency(words: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of words) {
    const cleaned = word.trim();
    if (!cleaned) continue;
    counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
  }
  return counts;
}

function uniqueVocabularyByWord(vocabulary: VocabItem[]): VocabItem[] {
  const seen = new Set<string>();
  return vocabulary.filter((item) => {
    if (seen.has(item.japanese)) return false;
    seen.add(item.japanese);
    return true;
  });
}

function countLibraryWords(targetWords: Set<string>, conversations: PracticeConversation[]): Map<string, number> {
  const counts = new Map([...targetWords].map((word) => [word, 0]));

  for (const conversation of conversations) {
    for (const word of uniqueWords(conversation.vocabularyUsed)) {
      if (!targetWords.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return counts;
}

function toRecommendationWord(item: VocabItem, libraryCount: number): LibraryRecommendationWord {
  return {
    japanese: item.japanese,
    reading: item.reading,
    meaning: item.meaning,
    partOfSpeech: item.partOfSpeech,
    category: item.category,
    libraryCount
  };
}

function sortWordsByCoverage(words: LibraryRecommendationWord[]): LibraryRecommendationWord[] {
  return [...words].sort((a, b) => (
    a.libraryCount - b.libraryCount
    || a.japanese.localeCompare(b.japanese, 'ja')
  ));
}

function coverageWeight(libraryCount: number): number {
  if (libraryCount <= 0) return 20;
  if (libraryCount === 1) return 6;
  if (libraryCount === 2) return 3;
  if (libraryCount === 3) return 2;
  return 1;
}

export async function recommendLibraryConversations(setNumber: number): Promise<LibraryRecommendations> {
  const allowedVocabulary = await getAllowedVocabulary(setNumber);
  const targetVocabulary = uniqueVocabularyByWord(allowedVocabulary.filter((item) => item.set === setNumber));
  const targetByWord = new Map(targetVocabulary.map((item) => [item.japanese, item]));
  const targetWords = new Set(targetByWord.keys());
  const librarySet = await readCuratedSet(setNumber);
  const libraryWordCounts = countLibraryWords(targetWords, librarySet.conversations);
  const leastCoveredWords = sortWordsByCoverage(
    targetVocabulary.map((item) => toRecommendationWord(item, libraryWordCounts.get(item.japanese) ?? 0))
  );
  const curatedSourceIds = new Set(librarySet.conversations.map((conversation) => `${conversation.sourceRunId}:${conversation.sourceConversationId}`));
  const runs = (await listRuns()).filter((run) => run.setNumber === setNumber);
  const recommendations: LibraryRecommendationCandidate[] = [];
  const eligibleCountByRun = new Map<string, number>();

  for (const run of runs) {
    const evidenceByConversationId = (
      await analyzeConversationsWithVocabulary(setNumber, allowedVocabulary, run.conversations)
    ).evidenceByConversationId;
    for (const conversation of run.conversations) {
      if (conversation.curatedId || curatedSourceIds.has(`${run.id}:${conversation.id}`)) continue;
      if (librarySet.conversations.some((curated) => curated.id === makeCuratedId(run.id, conversation.id))) continue;
      eligibleCountByRun.set(run.id, (eligibleCountByRun.get(run.id) ?? 0) + 1);

      const conversationWordCounts = wordFrequency(conversation.vocabularyUsed);
      const conversationTargetWords = [...conversationWordCounts.keys()].filter((word) => targetWords.has(word));
      if (!conversationTargetWords.length) continue;

      const words = sortWordsByCoverage(
        conversationTargetWords.map((word) => {
          const vocab = targetByWord.get(word);
          if (!vocab) return null;
          return toRecommendationWord(vocab, libraryWordCounts.get(word) ?? 0);
        }).filter((word): word is LibraryRecommendationWord => Boolean(word))
      );
      const score = words.reduce((total, word) => {
        const increase = Math.min(conversationWordCounts.get(word.japanese) ?? 1, 3);
        return total + coverageWeight(word.libraryCount) * increase;
      }, 0);

      recommendations.push({
        sourceRunId: run.id,
        sourceRunCreatedAt: run.createdAt,
        score,
        targetWordCount: words.length,
        uncoveredWordCount: words.filter((word) => word.libraryCount === 0).length,
        leastCoveredWords: words,
        evidence: evidenceByConversationId[conversation.id],
        conversation
      });
    }
  }

  recommendations.sort((a, b) => (
    b.score - a.score
    || b.uncoveredWordCount - a.uncoveredWordCount
    || b.targetWordCount - a.targetWordCount
    || b.sourceRunCreatedAt.localeCompare(a.sourceRunCreatedAt)
    || a.conversation.number - b.conversation.number
  ));

  const runById = new Map(runs.map((run) => [run.id, run]));
  const eligibleRuns = [...eligibleCountByRun].map(([runId, eligibleCandidateCount]) => {
    const run = runById.get(runId)!;
    return { runId, createdAt: run.createdAt, textModel: run.textModel, eligibleCandidateCount };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.runId.localeCompare(b.runId));

  return {
    setNumber,
    targetWordCount: targetVocabulary.length,
    libraryConversationCount: librarySet.conversations.length,
    candidateCount: recommendations.length,
    eligibleRuns,
    leastCoveredWords: leastCoveredWords.slice(0, 40),
    recommendations: recommendations.slice(0, 30)
  };
}
