import assert from 'node:assert/strict';
import test from 'node:test';
import type { PracticeConversation, VocabItem } from '../shared/types.ts';
import { analyzeConversationsWithVocabulary } from './vocabAudit.ts';

function vocab(set: number, japanese: string, reading = japanese): VocabItem {
  return {
    set,
    setTheme: `Set ${set}`,
    withinSetNumber: 1,
    japanese,
    reading,
    meaning: japanese,
    partOfSpeech: 'test',
    category: 'test'
  };
}

function conversation(japanese: string): PracticeConversation {
  const timestamp = '2026-01-01T00:00:00.000Z';
  return {
    id: 'conversation-1',
    number: 1,
    title: 'Audit fixture',
    scene: 'Test',
    sampleContext: 'Test',
    text: [{ speaker: 'Speaker 1', tags: ['slow'], japanese }],
    listeningQuestions: [],
    answerKey: [],
    englishTranslation: [],
    vocabularyUsed: [],
    outOfVocabularyAudit: [],
    simplerReplacementSuggestions: [],
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

test('curation evidence deduplicates vocabulary and separates current from cumulative sets', async () => {
  const vocabulary = [
    vocab(1, '本', 'ほん'),
    vocab(1, '本', 'ほん'),
    vocab(1, '来る', 'くる'),
    vocab(2, '食べる', 'たべる'),
    vocab(2, '行く', 'いく')
  ];
  const source = conversation('さくらさんは本を食べません。そして東京へ行きます。ええと、猫が来ます。猫です。');

  const analysis = await analyzeConversationsWithVocabulary(2, vocabulary, [source]);
  const evidence = analysis.evidenceByConversationId[source.id];

  assert.equal(evidence.currentSetTotal, 2);
  assert.deepEqual(evidence.currentSetUniqueWords, ['行く', '食べる'].sort((a, b) => a.localeCompare(b, 'ja')));
  assert.equal(evidence.currentSetUniqueCount, 2);
  assert.equal(evidence.allowedVocabTotal, 4);
  assert.deepEqual(evidence.allowedVocabUniqueWords, ['本', '来る', '行く', '食べる'].sort((a, b) => a.localeCompare(b, 'ja')));
  assert.equal(evidence.allowedVocabUniqueCount, 4);
  assert.equal(evidence.vocabularyOccurrences['食べる'], 1);
});

test('curation evidence excludes prompt allowances and proper names but counts true OOV occurrences', async () => {
  const vocabulary = [
    vocab(1, '本', 'ほん'),
    vocab(1, '来る', 'くる'),
    vocab(2, '食べる', 'たべる'),
    vocab(2, '行く', 'いく')
  ];
  const source = conversation('さくらさんは本を食べません。そして東京へ行きます。ええと、猫が来ます。猫です。');

  const analysis = await analyzeConversationsWithVocabulary(2, vocabulary, [source]);
  const audited = analysis.conversations[0];
  const evidence = analysis.evidenceByConversationId[source.id];

  assert.deepEqual(audited.outOfVocabularyAudit, ['猫']);
  assert.deepEqual(evidence.outOfVocabularyUniqueWords, ['猫']);
  assert.equal(evidence.outOfVocabularyUniqueCount, 1);
  assert.equal(evidence.outOfVocabularyOccurrenceCount, 2);
});
