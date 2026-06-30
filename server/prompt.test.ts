import assert from 'node:assert/strict';
import test from 'node:test';
import type { LibraryBalancePlan, VocabItem } from '../shared/types.ts';
import { buildGenerationPrompt, buildLibraryComplementPrompt } from './prompt.ts';

const vocabulary: VocabItem[] = [
  { set: 1, setTheme: 'Basics', withinSetNumber: 1, japanese: '本', reading: 'ほん', meaning: 'book', partOfSpeech: 'noun', category: 'object' },
  { set: 2, setTheme: 'Actions', withinSetNumber: 1, japanese: '読む', reading: 'よむ', meaning: 'read', partOfSpeech: 'verb', category: 'action' }
];

const balance: LibraryBalancePlan = {
  setNumber: 2,
  targetWordCount: 1,
  libraryConversationCount: 0,
  zeroCount: 1,
  lowCoverageCount: 0,
  meanCount: 0,
  standardDeviation: 0,
  targetCount: 1,
  preferredMaxConversationCount: 10,
  suggestedConversationCount: 1,
  requiredZeroWords: [{ japanese: '読む', reading: 'よむ', meaning: 'read', partOfSpeech: 'verb', category: 'action', libraryCount: 0, targetCount: 1, neededCount: 1 }],
  priorityWords: [{ japanese: '読む', reading: 'よむ', meaning: 'read', partOfSpeech: 'verb', category: 'action', libraryCount: 0, targetCount: 1, neededCount: 1 }],
  overrepresentedWords: []
};

test('standard prompt emphasizes natural current-set focus and shared language policy', async () => {
  const prompt = await buildGenerationPrompt(2, 4, vocabulary);

  assert.match(prompt, /current Set 2 is the primary learning focus/i);
  assert.match(prompt, /never force a word into an unnatural line/i);
  assert.match(prompt, /earlier-set vocabulary as natural supporting language/i);
  assert.match(prompt, /Conversation fillers:/);
  assert.match(prompt, /Speaker 1 female names: さくら/);
  assert.doesNotMatch(prompt, /\{\{languagePolicy\}\}/);
});

test('complement prompt preserves priorities while allowing natural omissions', () => {
  const prompt = buildLibraryComplementPrompt(2, vocabulary, balance);

  assert.match(prompt, /strong coverage priority/i);
  assert.match(prompt, /do not force an awkward use/i);
  assert.match(prompt, /omit or redistribute a priority word/i);
  assert.match(prompt, /Conversation fillers:/);
  assert.match(prompt, /読む/);
});
